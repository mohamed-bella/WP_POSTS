const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let supabaseInstance = null;
let lastUrl = null;
let lastKey = null;

/**
 * Returns a Supabase client instance, re-initializing if credentials changed in process.env
 */
function getSupabase() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_ANON_KEY || '').trim();

  if (!url || !key) {
    if (supabaseInstance) {
      console.warn('⚠️ Supabase credentials removed from process.env. Client may fail.');
    }
    return supabaseInstance; // Return existing or null
  }

  // Re-initialize if the URL or Key changed (e.g. via Dashboard Settings)
  if (!supabaseInstance || url !== lastUrl || key !== lastKey) {
    console.log(`[Supabase] Initializing client for: ${url} (Key length: ${key.length})`);
    


    supabaseInstance = createClient(url, key);
    lastUrl = url;
    lastKey = key;
  }

  return supabaseInstance;
}

// Export a proxy or getter-based object for ease of use
module.exports = {
  get supabase() { return getSupabase(); },
  getSupabase
};
