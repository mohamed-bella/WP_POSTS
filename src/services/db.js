const client = require('./supabase');
const crypto = require('crypto');

// Helper to get active client
const getSupa = () => client.supabase;

// ─── Actions / Logging ──────────────────────────────────────────────────────

/**
 * Log an action to Supabase
 */
async function logAction(type, status, details = {}) {
  const action = {
    id: crypto.randomBytes(6).toString('hex'),
    timestamp: new Date().toISOString(),
    type,
    status,
    details,
  };

  const supa = getSupa();
  if (!supa) return;
  const { error } = await supa.from('actions').insert([action]);
  if (error) {
    console.error('[DB] Failed to log action to Supabase:', error.message);
  }

  // WhatsApp notification (skip for WA actions to avoid infinite loop)
  if (type !== 'whatsapp_message' && type !== 'whatsapp_error') {
    const typeFormatted = type.replace(/_/g, ' ').toUpperCase();
    let waMsg = `⚙️ *System Action:* [${typeFormatted}]\n🚦 *Status:* ${status.toUpperCase()}`;
    if (details.topic) waMsg += `\n📌 ${details.topic}`;
    if (details.url)   waMsg += `\n🔗 ${details.url}`;
    if (details.error) waMsg += `\n❌ ${details.error}`;

    try {
      const wa = require('./whatsapp');
      if (wa && typeof wa.sendWhatsAppUpdate === 'function') {
        wa.sendWhatsAppUpdate(waMsg).catch(e => console.error('WA Notify Error:', e.message));
      }
    } catch (e) {
      console.error('WA Late-bind Error:', e.message);
    }
  }

  return action;
}

/**
 * Get actions with optional filters
 */
async function getActions({ type, status, limit = 50 } = {}) {
  const supa = getSupa();
  if (!supa) return [];

  let query = supa
    .from('actions')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (type)   query = query.eq('type', type);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    console.error('[DB] Failed to fetch actions:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Get aggregated stats
 */
async function getStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const supa = getSupa();
  if (!supa) return { total: 0, today: {}, week: {} };

  // Fetch only the last 7 days of data using server-side filter (not all rows)
  const [{ count: totalCount }, { data: weekActions, error }] = await Promise.all([
    supa.from('actions').select('*', { count: 'exact', head: true }),
    supa.from('actions')
      .select('type,status,timestamp')
      .gte('timestamp', weekAgo)
      .order('timestamp', { ascending: false }),
  ]);

  if (error) {
    console.error('[DB] getStats error:', error.message);
    return { total: 0, today: {}, week: {} };
  }

  const allWeekActions = weekActions || [];
  const todayActions = allWeekActions.filter(a => a.timestamp >= todayStart);

  const countByType = (actions, t) => actions.filter(a => a.type === t).length;
  const countErrors = (actions)    => actions.filter(a => a.status === 'error').length;

  return {
    total: totalCount || 0,
    today: {
      total:             todayActions.length,
      wordpress:         countByType(todayActions, 'wordpress_post'),
      blogger:           countByType(todayActions, 'blogger_post'),
      instagram_engage:  countByType(todayActions, 'instagram_engage'),
      instagram_post:    countByType(todayActions, 'instagram_post'),
      whatsapp:          countByType(todayActions, 'whatsapp_message'),
      errors:            countErrors(todayActions),
    },
    week: {
      total:             allWeekActions.length,
      wordpress:         countByType(allWeekActions, 'wordpress_post'),
      blogger:           countByType(allWeekActions, 'blogger_post'),
      instagram_engage:  countByType(allWeekActions, 'instagram_engage'),
      instagram_post:    countByType(allWeekActions, 'instagram_post'),
      whatsapp:          countByType(allWeekActions, 'whatsapp_message'),
      errors:            countErrors(allWeekActions),
    },
  };
}

/**
 * Update bot started timestamp inside the settings row
 */
async function markBotStarted() {
  const supa = getSupa();
  if (!supa) return;
  const { error } = await supa
    .from('settings')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) console.error('[DB] markBotStarted error:', error.message);
}

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Read all settings from Supabase (returns the full row, or defaults)
 */
async function readSettings() {
  const supa = getSupa();
  if (!supa) return { workflows: {}, schedule: {}, notifications: {}, linking: {}, config: {} };

  const { data, error } = await supa
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !data) {
    if (error?.code === 'PGRST116' || !data) {
       console.log('[DB] Settings table is empty. Initializing default row...');
       const defaultSettings = {
         id: 1,
         workflows: {},
         schedule: {},
         notifications: {},
         linking: {},
         config: {}
       };
       const { error: insertError } = await supa.from('settings').insert([defaultSettings]);
       if (insertError) {
         console.warn('[DB] Failed to initialize settings row:', insertError.message);
       } else {
         return defaultSettings;
       }
    }
    console.warn('[DB] Could not read settings from Supabase, using defaults.');
    return { workflows: {}, schedule: {}, notifications: {}, linking: {}, config: {} };
  }

  return {
    workflows:     data.workflows     || {},
    schedule:      data.schedule      || {},
    notifications: data.notifications || {},
    linking:       data.linking       || {},
    config:        data.config        || {},
  };
}

/**
 * Write (merge) settings to Supabase
 */
async function writeSettings(incoming) {
  const current = await readSettings();
  const merged  = { ...current };

  if (incoming.workflows)     merged.workflows     = { ...current.workflows,     ...incoming.workflows };
  if (incoming.schedule)      merged.schedule      = { ...current.schedule,      ...incoming.schedule };
  if (incoming.notifications) merged.notifications = { ...current.notifications, ...incoming.notifications };
  if (incoming.linking)       merged.linking       = { ...current.linking,       ...incoming.linking };
  if (incoming.config)        merged.config        = { ...current.config,        ...incoming.config };

  const supa = getSupa();
  if (!supa) return;

  // Build a safe update payload based on what exists in 'current'
  // If current[col] is undefined, it means the column likely doesn't exist in the DB
  const updatePayload = { updated_at: new Date().toISOString() };
  if (current.workflows !== undefined)     updatePayload.workflows = merged.workflows;
  if (current.schedule !== undefined)      updatePayload.schedule  = merged.schedule;
  if (current.notifications !== undefined) updatePayload.notifications = merged.notifications;
  if (current.linking !== undefined)       updatePayload.linking = merged.linking;
  if (current.config !== undefined)        updatePayload.config = merged.config;

  const { error } = await supa
    .from('settings')
    .update(updatePayload)
    .eq('id', 1);

  if (error) {
     console.error('[DB] writeSettings error:', error.message);
     // If the error persists despite surgical selection, it might be a connectivity issue
  }
  
  return merged;
}

// ─── SEO Strategy (Pillar & Cluster) ─────────────────────────────────────────

/**
 * Fetch pillar and cluster data from Supabase
 */
async function getStrategy() {
  const supa = getSupa();
  if (!supa) return { pillars: [], clusters: [] };

  const [{ data: pillars, error: pe }, { data: clusters, error: ce }] = await Promise.all([
    supa.from('pillars').select('*').order('created_at'),
    supa.from('clusters').select('*').order('created_at'),
  ]);

  if (pe) console.error('[DB] getStrategy pillars error:', pe.message);
  if (ce) console.error('[DB] getStrategy clusters error:', ce.message);

  return {
    pillars:  pillars  || [],
    clusters: clusters || [],
  };
}

async function addPillar(title, url) {
  const supa = getSupa();
  if (!supa) return;

  const { error } = await supa.from('pillars').upsert([{
    id:         crypto.randomBytes(4).toString('hex'),
    title,
    url,
    created_at: new Date().toISOString(),
  }], { onConflict: 'url', ignoreDuplicates: true });

  if (error) console.error('[DB] addPillar error:', error.message);
}

async function addToCluster(pillarUrl, title, url) {
  const supa = getSupa();
  if (!supa) return;

  const { error } = await supa.from('clusters').upsert([{
    pillar_url:  pillarUrl,
    title,
    url,
    created_at: new Date().toISOString(),
  }], { onConflict: 'url', ignoreDuplicates: true });

  if (error) console.error('[DB] addToCluster error:', error.message);
}

/**
 * Simple health check for Supabase
 */
async function checkConnection() {
  const supa = getSupa();
  if (!supa) return { ok: false, error: 'Supabase client not initialized' };
  try {
    // Check the settings table (which we know we initialized)
    const { error } = await supa.from('settings').select('id').limit(1).single();
    if (error && error.code !== 'PGRST116') { // PGRST116 means table is empty but connection is fine
       return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  logAction,
  getActions,
  getStats,
  markBotStarted,
  readSettings,
  writeSettings,
  getStrategy,
  addPillar,
  addToCluster,
  checkConnection
};
