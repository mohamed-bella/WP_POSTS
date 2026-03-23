require('dotenv').config({ quiet: true });
const { getSupabase } = require('./src/services/supabase');
const fs = require('fs');

async function testFetch(label) {
  try {
    await getSupabase().from('settings').select('*').limit(1);
    console.log(label + ': FETCH O.K.');
  } catch(e) {
    fs.writeFileSync('fetch-error.txt', label + '\nMessage: ' + e.message + '\nCause: ' + (e.cause ? e.cause.toString() : 'none') + '\nStack: ' + e.stack);
  }
}

(async () => {
   await testFetch('BASELINE');

   require('./src/dashboard-server');
   await testFetch('DASHBOARD');

   require('./src/services/whatsapp');
   await testFetch('WHATSAPP');

   require('./src/services/gsc');
   await testFetch('GSC');

   require('./src/index');
   await testFetch('INDEX');

   require('./src/services/instagram-stealth');
   await testFetch('IG STEALTH');
   
   process.exit(0);
})();
