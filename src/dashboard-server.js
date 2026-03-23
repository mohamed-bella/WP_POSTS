const express = require('express');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const cookieParser = require('cookie-parser');
const svgCaptcha = require('svg-captcha');
const { logAction, getActions, getStats, markBotStarted, getStrategy, addPillar, addToCluster, readSettings, writeSettings } = require('./services/db');
const { getWhatsAppStatus, requestPairing, disconnectWhatsApp, requestQr } = require('./services/whatsapp');
require('dotenv').config();
const { getEnv, updateEnv } = require('./services/config');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3456;

app.use(express.json());
app.use(cookieParser());
app.use(session({
  store: new FileStore({ path: './sessions', logFn: () => {} }),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Protect all API routes except login/captcha
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';

function requireAuth(req, res, next) {
  // Allow unauthenticated access to login, captcha, and session-status
  const publicPaths = ['/api/login', '/api/captcha', '/api/session-status', '/api/logout', '/api/health'];
  if (publicPaths.includes(req.path)) return next();
  // Allow static files
  if (!req.path.startsWith('/api')) return next();
  // Check session authentication
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all for SPA routing (must be after other routes but before static)
// Actually we have static above, let's move catch-all to the end of routes

// ── In-memory log buffer for SSE streaming ──
const logBuffer = [];
const MAX_LOG_LINES = 200;
const sseClients = [];

// Capture console output and push to SSE
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function pushLog(level, args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const entry = { timestamp: new Date().toISOString(), level, message: msg };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();

  // Broadcast to SSE clients
  sseClients.forEach(res => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });
}

console.log = (...args) => { originalLog.apply(console, args); pushLog('info', args); };
console.error = (...args) => { originalError.apply(console, args); pushLog('error', args); };
console.warn = (...args) => { originalWarn.apply(console, args); pushLog('warn', args); };

// ── Settings are now managed via Supabase (see services/db.js) ──
// readSettings and writeSettings are imported from db.js above

// ══════════════════════════════════════════
//  AUTHENTICATION ROUTES
// ══════════════════════════════════════════

app.get('/api/captcha', (req, res) => {
  const captcha = svgCaptcha.create({
    size: 5,
    ignoreChars: '0o1il',
    noise: 2,
    color: true,
    background: '#faf9f6'
  });
  req.session.captcha = captcha.text.toLowerCase();
  res.type('svg');
  res.status(200).send(captcha.data);
});

app.post('/api/login', (req, res) => {
  const { password, captcha } = req.body;
  
  if (!req.session.captcha || !captcha || captcha.toLowerCase() !== req.session.captcha) {
    return res.status(401).json({ ok: false, error: 'Invalid CAPTCHA' });
  }
  
  if (password === DASHBOARD_PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Invalid password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/session-status', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// ══════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════

// Dashboard page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SEO Performance Route
app.get('/seo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'seo.html'));
});

// Bot status
app.get('/api/status', async (req, res) => {
  try {
    const [stats, settings] = await Promise.all([getStats(), readSettings()]);
    res.json({
      uptime: process.uptime(),
      settings: settings.workflows,
      stats,
      whatsapp: getWhatsAppStatus()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', async (req, res) => {
  const { checkConnection } = require('./services/db');
  const health = await checkConnection();
  res.json(health);
});

app.get('/api/whatsapp/status', (req, res) => {
  res.json(getWhatsAppStatus());
});

app.post('/api/whatsapp/link', requireAuth, async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Phone number required' });
  const result = await requestPairing(number);
  res.json(result);
});

app.post('/api/whatsapp/disconnect', requireAuth, async (req, res) => {
  const result = await disconnectWhatsApp();
  res.json(result);
});

app.post('/api/whatsapp/qr', requireAuth, async (req, res) => {
  const result = await requestQr();
  res.json(result);
});

// Action history
app.get('/api/actions', async (req, res) => {
  const { type, status, limit } = req.query;
  const actions = await getActions({
    type: type || undefined,
    status: status || undefined,
    limit: limit ? parseInt(limit) : 50,
  });
  res.json(actions);
});

// Settings
app.get('/api/settings', async (req, res) => {
  try {
    res.json(await readSettings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid settings payload' });
    }
    const merged = await writeSettings(req.body);
    logAction('settings_change', 'success', { updated: Object.keys(req.body) });
    res.json({ ok: true, settings: merged });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── SaaS Configuration (Dynamic .env) ───

// Sensitive keys that should be masked in the API response
const SENSITIVE_KEYS = [
  'OPENAI_API_KEY', 'PEXELS_API_KEY', 'UNSPLASH_ACCESS_KEY',
  'WP_APPLICATION_PASSWORD', 'SUPABASE_ANON_KEY',
  'GOOGLE_SERVICE_ACCOUNT_JSON', 'BLOGGER_CLIENT_SECRET', 'BLOGGER_REFRESH_TOKEN',
  'REDDIT_CLIENT_SECRET', 'REDDIT_PASSWORD',
  'PINTEREST_ACCESS_TOKEN', 'PAGESPEED_API_KEY', 'INDEXNOW_KEY',
  'BING_WEBMASTER_API_KEY', 'OPENPAGERANK_API_KEY',
  'SESSION_SECRET', 'DASHBOARD_PASSWORD',
  'GA4_PRIVATE_KEY', 'LINKEDIN_PASSWORD',
];

function maskSensitiveValue(key, value) {
  if (!value || typeof value !== 'string') return value;
  if (SENSITIVE_KEYS.includes(key)) {
    if (value.length <= 8) return '••••••••';
    return value.substring(0, 4) + '••••••••' + value.substring(value.length - 4);
  }
  return value;
}

app.get('/api/config', requireAuth, (req, res) => {
  try {
    const env = getEnv();
    const masked = {};
    for (const [key, value] of Object.entries(env)) {
      masked[key] = maskSensitiveValue(key, value);
    }
    res.json(masked);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config', requireAuth, (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid config payload' });
    }
    updateEnv(req.body);
    res.json({ ok: true, message: 'Configuration updated and .env file saved.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Connection Testers
 */
app.post('/api/config/test', requireAuth, async (req, res) => {
  const { service } = req.body;
  const env = getEnv();

  try {
    switch (service) {
      case 'openai': {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        await openai.models.list();
        return res.json({ ok: true, message: 'OpenAI Connection Successful!' });
      }
      case 'wordpress': {
        const auth = Buffer.from(`${env.WP_USERNAME}:${env.WP_APPLICATION_PASSWORD}`).toString('base64');
        const r = await axios.get(`${env.WP_URL}/wp-json/wp/v2/users/me`, {
          headers: { Authorization: `Basic ${auth}` }
        });
        return res.json({ ok: true, message: `Connected to WP as: ${r.data.name}` });
      }
      case 'database':
      case 'supabase': {
         const { createClient } = require('@supabase/supabase-js');
         if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error('Missing Supabase credentials');
         const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
         const { error } = await sb.from('actions').select('count', { count: 'exact', head: true });
         if (error) throw error;
         return res.json({ ok: true, message: 'Supabase DB Connection Successful!' });
      }
      case 'pagespeed': {
        const key = env.PAGESPEED_API_KEY;
        const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://google.com&category=SEO&strategy=mobile${key ? `&key=${key}` : ''}`;
        await axios.get(url);
        return res.json({ ok: true, message: 'PageSpeed API Connection Successful!' });
      }
      case 'google-sheets':
      case 'content': {
        const { google } = require('googleapis');
        const auth = new google.auth.GoogleAuth({
          credentials: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON),
          scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.get({ spreadsheetId: env.GOOGLE_SHEET_ID });
        return res.json({ ok: true, message: 'Google Sheets Access Successful!' });
      }
      case 'pinterest': {
        if (!env.PINTEREST_ACCESS_TOKEN) throw new Error('Missing Pinterest Access Token');
        await axios.get('https://api.pinterest.com/v5/user_account', {
          headers: { Authorization: `Bearer ${env.PINTEREST_ACCESS_TOKEN}` }
        });
        return res.json({ ok: true, message: 'Pinterest API Connection Successful!' });
      }
      case 'reddit': {
        if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) throw new Error('Missing Reddit Credentials');
        return res.json({ ok: true, message: 'Reddit Credentials saved (Test not available without full OAuth/UA).' });
      }
      case 'blogger': {
        if (!env.BLOGGER_CLIENT_ID || !env.BLOGGER_REFRESH_TOKEN) throw new Error('Missing Blogger credentials');
        return res.json({ ok: true, message: 'Blogger Configuration saved.' });
      }
      case 'tumblr': {
        const { testTumblrConnection } = require('./services/tumblr');
        const user = await testTumblrConnection();
        return res.json({ ok: true, message: `Tumblr Connected as ${user}!` });
      }
      default:
        return res.json({ ok: false, message: `Tester for ${service} coming soon.` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message || 'Connection Failed' });
  }
});


// ── Test triggers ──

// Store references to bot functions (injected by engage.js)
const botFunctions = {};

app.post('/api/test/full', async (req, res) => {
  try {
    logAction('full_workflow_test', 'running', { trigger: 'dashboard_manual' });
    res.json({ ok: true, message: 'Full workflow test initiated. This covers all stages and will take several minutes. Follow logs for progress.' });

    if (botFunctions.runFullSuite) {
      try {
        await botFunctions.runFullSuite();
        logAction('full_workflow_test', 'success', { trigger: 'dashboard_manual' });
      } catch (e) {
        logAction('full_workflow_test', 'error', { trigger: 'dashboard_manual', error: e.message });
      }
    } else {
      logAction('full_workflow_test', 'error', { trigger: 'dashboard_manual', error: 'runFullSuite not available' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/test/wordpress', async (req, res) => {
  try {
    logAction('wordpress_post', 'running', { trigger: 'dashboard_test' });
    res.json({ ok: true, message: 'WordPress workflow triggered. Check logs for progress.' });

    // Run async — don't block the response
    if (botFunctions.runAutoPoster) {
      try {
        await botFunctions.runAutoPoster();
        logAction('wordpress_post', 'success', { trigger: 'dashboard_test' });
      } catch (e) {
        logAction('wordpress_post', 'error', { trigger: 'dashboard_test', error: e.message });
      }
    } else {
      logAction('wordpress_post', 'error', { trigger: 'dashboard_test', error: 'runAutoPoster not available — run from engage.js entry point' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/test/blogger', async (req, res) => {
  try {
    logAction('blogger_post', 'running', { trigger: 'dashboard_test' });
    res.json({ ok: true, message: 'Blogger test triggered. Check logs.' });

    const { createBloggerPost } = require('./services/blogger');
    const blogId = (process.env.BLOGGER_IDS || '').split(',')[0]?.trim();
    if (blogId) {
      const url = await createBloggerPost(blogId, 'Dashboard Test Post', `<p>Test from dashboard at ${new Date().toISOString()}</p>`);
      logAction('blogger_post', url ? 'success' : 'error', { trigger: 'dashboard_test', url });
    }
  } catch (e) {
    logAction('blogger_post', 'error', { trigger: 'dashboard_test', error: e.message });
  }
});

app.post('/api/test/instagram-engage', async (req, res) => {
  try {
    logAction('instagram_engage', 'running', { trigger: 'dashboard_test' });
    res.json({ ok: true, message: 'Instagram engagement triggered.' });

    const { runInstagramStealth } = require('./services/instagram-stealth');
    await runInstagramStealth();
    logAction('instagram_engage', 'success', { trigger: 'dashboard_test' });
  } catch (e) {
    logAction('instagram_engage', 'error', { trigger: 'dashboard_test', error: e.message });
  }
});

app.post('/api/test/instagram-post', async (req, res) => {
  try {
    logAction('instagram_post', 'running', { trigger: 'dashboard_test' });
    res.json({ ok: true, message: 'Instagram post triggered.' });

    const { runInstagramPoster } = require('./services/instagram-poster');
    await runInstagramPoster();
    logAction('instagram_post', 'success', { trigger: 'dashboard_test' });
  } catch (e) {
    logAction('instagram_post', 'error', { trigger: 'dashboard_test', error: e.message });
  }
});

app.post('/api/test/reddit', async (req, res) => {
  try {
    logAction('reddit_post', 'running', { trigger: 'dashboard_test' });
    res.json({ ok: true, message: 'Reddit test triggered (Headless Browser). Follow logs.' });

    const { postToSubreddits } = require('./services/reddit');
    const settings = await readSettings();
    const sub = (settings.workflows.reddit_subreddits || 'Morocco').split('\n')[0].trim();
    
    if (sub) {
      const urls = await postToSubreddits(
        'Testing MTE Automation Post', 
        'https://moroccotravelexperts.com/', 
        [sub]
      );
      logAction('reddit_post', urls.length > 0 ? 'success' : 'error', { trigger: 'dashboard_test', sub, urls });
    }
  } catch (e) {
    logAction('reddit_post', 'error', { trigger: 'dashboard_test', error: e.message });
  }
});

app.post('/api/test/linkedin', async (req, res) => {
  try {
    logAction('linkedin_post', 'running', { trigger: 'dashboard_test' });
    res.json({ ok: true, message: 'LinkedIn test triggered (Headless Browser). Follow logs.' });

    const { postToLinkedIn } = require('./services/linkedin');
    const success = await postToLinkedIn('Testing MTE Automation Post', 'https://moroccotravelexperts.com/');
    logAction('linkedin_post', success ? 'success' : 'error', { trigger: 'dashboard_test' });
  } catch (e) {
    logAction('linkedin_post', 'error', { trigger: 'dashboard_test', error: e.message });
  }
});

app.post('/api/test/tumblr', async (req, res) => {
  try {
    const { postToTumblr } = require('./services/tumblr');
    logAction('tumblr_post', 'running', { trigger: 'dashboard_test' });
    res.json({ ok: true, message: 'Tumblr post triggered.' });
    
    await postToTumblr('Testing MTE Bot', 'This is a test post from my new MTE dashboard!', 'mte, test, automation', 'https://moroccotravelexperts.com/');
    logAction('tumblr_post', 'success', { trigger: 'dashboard_test' });
  } catch (e) {
    logAction('tumblr_post', 'error', { trigger: 'dashboard_test', error: e.message });
  }
});

app.post('/api/test/twitter', async (req, res) => {
  try {
    const { postToTwitter } = require('./services/twitter');
    logAction('twitter_post', 'running', { trigger: 'dashboard_test' });
    res.json({ ok: true, message: 'Twitter post triggered.' });
    
    await postToTwitter('🤖 MTE Bot Testing: Automated X/Twitter workflow active!', 'https://moroccotravelexperts.com/');
    // Logging is handled inside the postToTwitter service securely
  } catch (e) {
    logAction('twitter_post', 'error', { trigger: 'dashboard_test', error: e.message });
  }
});

app.post('/api/test/whatsapp', async (req, res) => {
  try {
    const { sendWhatsAppUpdate } = require('./services/whatsapp');
    await sendWhatsAppUpdate('🧪 *Dashboard Test:* This is a test message from the dashboard!');
    logAction('whatsapp_message', 'success', { trigger: 'dashboard_test', message: 'Test message sent' });
    res.json({ ok: true, message: 'WhatsApp test message sent!' });
  } catch (e) {
    logAction('whatsapp_message', 'error', { trigger: 'dashboard_test', error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Live logs via Server-Sent Events ──
app.get('/api/logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send existing buffer
  logBuffer.forEach(entry => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  sseClients.push(res);

  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// Recent logs (non-streaming)
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(logBuffer.slice(-limit));
});

// ══════════════════════════════════════════
//  GSC ROUTES
// ══════════════════════════════════════════

const { getLatestSnapshot, pullDailySnapshot, inspectUrlIndexStatus } = require('./services/gsc');
const { runIndexingPipeline } = require('./services/indexing');

app.get('/api/gsc/snapshot', (req, res) => {
  const snapshot = getLatestSnapshot();
  if (snapshot) {
    res.json(snapshot);
  } else {
    res.status(404).json({ error: 'No GSC data available yet.' });
  }
});

app.post('/api/gsc/refresh', async (req, res) => {
  try {
    logAction('gsc_snapshot', 'running', { trigger: 'manual_refresh' });
    // Don't await the full pull here to keep the request fast,
    // or we can await it if we want to return the new data.
    // Let's await it so the frontend can reload immediately.
    const snapshot = await pullDailySnapshot();
    res.json({ ok: true, snapshot });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/gsc/inspect', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const result = await inspectUrlIndexStatus(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/index/request', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    await runIndexingPipeline(url, [url]);
    res.json({ ok: true, message: 'Indexing request sent successfully via API' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════
//  INTERNAL LINKING ROUTES
// ══════════════════════════════════════════

const { loadIndex, buildLinkIndex, scanExistingPosts } = require('./services/linker');

app.get('/api/links/index', async (req, res) => {
  try {
    const index = await loadIndex();
    res.json(index);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/links/build', async (req, res) => {
  try {
    logAction('seo_indexing', 'running', { trigger: 'manual_link_build' });
    const index = await buildLinkIndex();
    res.json({ ok: true, index });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/links/audit', async (req, res) => {
  try {
    const opportunities = await scanExistingPosts();
    res.json(opportunities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════
//  SPREADSHEET ROUTES
// ══════════════════════════════════════════

const googleSheets = require('./services/google-sheets');

app.get('/api/spreadsheet', async (req, res) => {
  try {
    const rows = await googleSheets.getAllRows();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/spreadsheet', async (req, res) => {
  try {
    if (!req.body || !req.body.topic) {
      return res.status(400).json({ ok: false, error: 'Topic is required' });
    }
    const result = await googleSheets.addRow(req.body);
    logAction('spreadsheet_add', 'success', { topic: req.body.topic });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.put('/api/spreadsheet/:index', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid update payload' });
    }
    const result = await googleSheets.updateRow(req.params.index, req.body);
    logAction('spreadsheet_update', 'success', { index: req.params.index, topic: req.body.topic });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete('/api/spreadsheet/:index', async (req, res) => {
  try {
    const result = await googleSheets.deleteRow(req.params.index);
    logAction('spreadsheet_delete', 'success', { index: req.params.index });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ══════════════════════════════════════════
//  SEO & PAGESPEED ROUTES
// ══════════════════════════════════════════

const { runPageSpeedAudit } = require('./services/pagespeed');

app.post('/api/seo/audit', async (req, res) => {
  try {
    const { url, index } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    logAction('seo_audit', 'running', { url, index });
    const stages = {};
    
    // 1. PageSpeed
    const ps = await runPageSpeedAudit(url);
    stages.pagespeed = ps.seo;

    // 2. GSC CTR (Search Console)
    let ctr = 0;
    try {
      const gsc = require('./services/gsc');
      const snapshot = gsc.getLatestSnapshot();
      if (snapshot && snapshot.pages) {
        const pageData = snapshot.pages.find(p => p.page === url);
        if (pageData) ctr = pageData.ctr;
      }
    } catch (e) {
      console.warn('[SEO Audit] Could not fetch GSC data for score:', e.message);
    }
    stages.ctr = ctr;

    // 3. Combined Score (Weighted: 70% PageSpeed, 30% GSC Engagement/CTR)
    // Note: CTR is capped at 10% for scoring weight purposes (10% CTR is excellent)
    const normalizedCtr = Math.min(ctr * 10, 100); 
    const finalScore = Math.round((ps.seo * 0.7) + (normalizedCtr * 0.3)) || 0;
    console.log(`[SEO API] Final Score for ${url}: ${finalScore} (PS: ${ps.seo}, CTR: ${ctr})`);

    // Update spreadsheet row if index provided
    if (index !== undefined && index !== null) {
      const googleSheets = require('./services/google-sheets');
      await googleSheets.updateRow(index, { seoScore: finalScore });
      logAction('seo_audit', 'success', { url, index, score: finalScore, pagespeed: ps.seo, ctr, accessibility: ps.accessibility, metrics: ps.metrics });
    } else {
      logAction('seo_audit', 'success', { url, score: finalScore, pagespeed: ps.seo, ctr, accessibility: ps.accessibility, metrics: ps.metrics });
    }

    res.json({ ok: true, score: finalScore, details: { pagespeed: ps.seo, ctr, accessibility: ps.accessibility, metrics: ps.metrics } });
  } catch (error) {
    logAction('seo_audit', 'error', { url: req.body.url, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// GET historical audits from actions table
app.get('/api/seo/history', async (req, res) => {
  try {
    const { getActions } = require('./services/db');
    const logs = await getActions({ type: 'seo_audit', limit: 500 }); // fetch up to 500 audits for chart
    
    // Process logs into a time-series array
    const history = logs
      .filter(l => l.status === 'success' && l.details?.url)
      .map(l => ({
        timestamp: l.timestamp,
        url: l.details.url,
        score: l.details.score || 0,
        pagespeed: l.details.pagespeed || 0,
        ctr: l.details.ctr || 0,
        accessibility: l.details.accessibility || 'N/A',
        metrics: l.details.metrics || {}
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({ ok: true, history });
  } catch (error) {
    console.error('[SEO] Failed to fetch history:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST bulk audit endpoint
app.post('/api/seo/bulk', async (req, res) => {
  try {
    const googleSheets = require('./services/google-sheets');
    const rows = await googleSheets.getAllRows();
    const published = rows.filter(r => r.status === 'published' && r.publishedUrl);

    if (!published.length) return res.json({ ok: true, message: 'No published articles to audit.' });

    // Respond immediately, run audits in background
    res.json({ ok: true, message: `Bulk audit started for ${published.length} live articles. This will take a few minutes.` });

    // Background process
    console.log(`[SEO] Starting Bulk Audit for ${published.length} articles...`);
    const { runPageSpeedAudit } = require('./services/pagespeed');
    const gsc = require('./services/gsc');
    const snapshot = gsc.getLatestSnapshot() || { pages: [] };

    for (const row of published) {
      if (!row.publishedUrl) continue;
      
      try {
        console.log(`[Bulk Audit] Auditing -> ${row.publishedUrl}`);
        logAction('seo_bulk_audit', 'running', { url: row.publishedUrl, index: row.index });
        
        const ps = await runPageSpeedAudit(row.publishedUrl);
        let ctr = 0;
        const pageData = snapshot.pages.find(p => p.page === row.publishedUrl);
        if (pageData) ctr = pageData.ctr;
        
        const normalizedCtr = Math.min(ctr * 10, 100); 
        const finalScore = Math.round((ps.seo * 0.7) + (normalizedCtr * 0.3)) || 0;

        await googleSheets.updateRow(row.index, { seoScore: finalScore });
        logAction('seo_audit', 'success', { url: row.publishedUrl, index: row.index, score: finalScore, pagespeed: ps.seo, ctr, bulk: true, accessibility: ps.accessibility, metrics: ps.metrics });
        
        // Wait 3 seconds between requests to respect Quota limits
        await new Promise(r => setTimeout(r, 3000));
        
      } catch (e) {
        logAction('seo_audit', 'error', { url: row.publishedUrl, error: e.message, bulk: true });
      }
    }
    console.log(`[SEO] ✅ Bulk Audit completed.`);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET advanced page details (Dual PageSpeed + GSC)
app.post('/api/seo/page-details', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    const { runPageSpeedAudit } = require('./services/pagespeed');
    const gsc = require('./services/gsc');

    // Run Mobile and Desktop audits simultaneously
    const [mobPs, dtPs, gscQueries] = await Promise.all([
      runPageSpeedAudit(url, 'mobile').catch(() => null),
      runPageSpeedAudit(url, 'desktop').catch(() => null),
      gsc.getQueriesForPage(url).catch(() => [])
    ]);

    // Format metrics
    const payload = {
      url,
      pagespeed: { mobile: mobPs, desktop: dtPs },
      gsc: { queries: gscQueries, impressions: 0, clicks: 0, ctr: 0, position: 0 }
    };

    // Calculate totals for GSC for this specific page
    if (gscQueries.length > 0) {
      let totalImps = 0, totalClks = 0, totalPos = 0;
      gscQueries.forEach(q => { totalImps += q.impressions; totalClks += q.clicks; totalPos += q.position; });
      payload.gsc = {
        queries: gscQueries.slice(0, 15), // top 15 queries shown in UI
        impressions: totalImps,
        clicks: totalClks,
        ctr: ((totalClks / totalImps) * 100).toFixed(2),
        position: (totalPos / gscQueries.length).toFixed(1)
      };
    }

    res.json(payload);
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════
//  CONTENT STRATEGY ROUTES (Pillar & Cluster)
// ══════════════════════════════════════════

app.get('/api/strategy', async (req, res) => {
  res.json(await getStrategy());
});

app.post('/api/strategy/pillar', (req, res) => {
  const { title, url } = req.body;
  if (!title || !url) return res.status(400).json({ error: 'Title and URL required' });
  addPillar(title, url);
  res.json({ ok: true });
});

app.post('/api/strategy/cluster', (req, res) => {
  const { pillarUrl, title, url } = req.body;
  if (!pillarUrl || !title || !url) return res.status(400).json({ error: 'Pillar URL, Title, and URL required' });
  addToCluster(pillarUrl, title, url);
  res.json({ ok: true });
});

app.post('/api/strategy/suggest', async (req, res) => {
  try {
    const { suggestClusterLinking } = require('./services/linker');
    const suggestions = await suggestClusterLinking();
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Catch-all route to serve index.html for any UI route (SPA support)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global Error Handler for the Process
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] 🔴 Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] 🔴 Uncaught Exception:', err.message);
  // We don't exit(1) here to keep the dashboard alive even if a service fails
});

function startDashboard() {
  markBotStarted();
  app.listen(PORT, () => {
    console.log(`\n🖥️  Dashboard running at http://localhost:${PORT}\n`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ [PORT CONFLICT] Port ${PORT} is already in use.`);
      console.error(`   Another instance is likely running. Check for hidden 'node' processes in Task Manager.`);
      process.exit(1);
    } else {
      console.error('[Dashboard] ❌ Failed to start server:', err.message);
    }
  });
}

// Allow injecting bot functions after startup
function registerBotFunction(name, fn) {
  botFunctions[name] = fn;
}

module.exports = { startDashboard, registerBotFunction };

// If run directly: node src/dashboard-server.js
if (require.main === module) {
  startDashboard();
}
