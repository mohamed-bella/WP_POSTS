const { runInstagramStealth } = require('./services/instagram-stealth');
const { runInstagramPoster } = require('./services/instagram-poster');
const { connectToWhatsApp, sendWhatsAppUpdate, waitForWhatsAppConnection } = require('./services/whatsapp');
const { startDashboard, registerBotFunction } = require('./dashboard-server');
const { logAction, readSettings } = require('./services/db');
const { pullDailySnapshot } = require('./services/gsc');
const { runAutoPoster } = require('./index');
require('dotenv').config();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Generate exactly N random times today between startHour and endHour
function generateDailySchedule(numRuns = 4, startHour = 8, endHour = 22) {
  const times = [];
  const now = new Date();
  
  for (let i = 0; i < numRuns; i++) {
    const target = new Date();
    // Random hour
    const hour = Math.floor(Math.random() * (endHour - startHour + 1)) + startHour;
    // Random minute & second
    const minute = Math.floor(Math.random() * 60);
    const second = Math.floor(Math.random() * 60);

    target.setHours(hour, minute, second, 0);

    // Only add if it's in the future, if it's already past for today, skip it.
    if (target > now) {
      times.push(target);
    }
  }

  // Sort chronologically
  return times.sort((a, b) => a - b);
}

// Format nicely
function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute:'2-digit' });
}

/**
 * Main PM2 loop
 */
async function startScheduler() {
  console.log('--- Starting Social Media Engagement Bot ---');

  while (true) {
    const settings = await readSettings();
    if (!settings.workflows?.instagram_engage) {
      console.log('Instagram engagement is disabled in settings. Sleeping for 1 hour...');
      await sleep(60 * 60 * 1000);
      continue;
    }

    // 1. Generate schedule for today
    const schedule = generateDailySchedule(3, 9, 21); // 3 runs, 9 AM to 9 PM
    
    if (schedule.length === 0) {
      console.log('All scheduled times for today have passed. Waiting until midnight to generate new schedule...');
      
      // Calculate ms until midnight
      const now = new Date();
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const msUntilMidnight = midnight - now;
      
      await sleep(msUntilMidnight + 10000); // 10s extra safety buffer
      continue;
    }

    console.log(`\n📅 Engagement Schedule for today:`);
    schedule.forEach((t, i) => console.log(`   Run ${i+1}: ${formatTime(t)}`));

    // 2. Wait for each target time and execute
    for (const targetTime of schedule) {
      const msToWait = targetTime - new Date();
      if (msToWait > 0) {
        console.log(`\n⏳ Next run at ${formatTime(targetTime)}. Sleeping for ${Math.floor(msToWait / 60000)} minutes...`);
        await sleep(msToWait);
      }

      console.log(`\n🚀 It's time! Initiating engagement run...`);
      try {
        await runInstagramStealth();
        logAction('instagram_engage', 'success', { trigger: 'scheduler' });
      } catch (err) {
        console.error('Engagement failed:', err.message);
        console.error('Will retry on the next scheduled run.');
        logAction('instagram_engage', 'error', { trigger: 'scheduler', error: err.message });
      }
    }

    // 3. After finishing all runs for the day, wait until midnight to restart the loop
    const now2 = new Date();
    const midnight2 = new Date();
    midnight2.setHours(24, 0, 0, 0);
    const msUntilMidnight2 = midnight2 - now2;
    
    console.log(`\n🌙 All runs finished for today. Sleeping until midnight (${Math.floor(msUntilMidnight2 / 60000)} mins)...`);
    await sleep(msUntilMidnight2 + 10000);
  }
}

// ─── Poster scheduler: 2 posts per day ─────────────────────────
async function startPosterScheduler() {
  console.log('--- Starting Instagram Auto-Poster ---');
  while (true) {
    const settings = await readSettings();
    if (!settings.workflows?.instagram_poster) {
      console.log('[Poster] Disabled in settings. Sleeping 1h...');
      await sleep(60 * 60 * 1000);
      continue;
    }

    const schedule = generateDailySchedule(2, 9, 20);
    if (schedule.length === 0) {
      const midnight = new Date(); midnight.setHours(24,0,0,0);
      await sleep(midnight - new Date() + 10000);
      continue;
    }

    console.log('[Poster] 📅 Post schedule for today:');
    schedule.forEach((t, i) => console.log(`   Post ${i+1}: ${formatTime(t)}`));

    for (const targetTime of schedule) {
      const msToWait = targetTime - new Date();
      if (msToWait > 0) {
        console.log(`[Poster] ⏳ Next post at ${formatTime(targetTime)}...`);
        await sleep(msToWait);
      }
      console.log('[Poster] 🚀 Posting to Instagram now...');
      try {
        await runInstagramPoster();
        logAction('instagram_post', 'success', { trigger: 'scheduler' });
      } catch(err) {
        console.error('[Poster] ❌', err.message);
        logAction('instagram_post', 'error', { trigger: 'scheduler', error: err.message });
      }
    }

    const midnight = new Date(); midnight.setHours(24,0,0,0);
    await sleep(midnight - new Date() + 10000);
  }
}

// ─── GSC Scheduler: Daily Snapshot ─────────────────────────────
async function startGscScheduler() {
  console.log('--- Starting GSC Daily Snapshot Scheduler ---');
  while (true) {
    const now = new Date();
    const target = new Date();
    target.setHours(6, 0, 0, 0); // 6 AM
    
    if (now > target) {
       target.setDate(target.getDate() + 1);
    }
    
    const msToWait = target - now;
    console.log(`[GSC] ⏳ Next snapshot scheduled for ${formatTime(target)} (${Math.floor(msToWait / 3600000)}h from now)`);
    await sleep(msToWait);
    
    try {
      await pullDailySnapshot();
    } catch (err) {
      console.error('[GSC] ❌ Scheduled snapshot failed:', err.message);
    }
  }
}

// ─── Content Refresher Scheduler: Weekly Audit ─────────────────
async function startRefresherScheduler() {
  console.log('--- Starting Content Refresh Scheduler ---');
  const { runRefreshPipeline } = require('./services/refresher');
  
  while (true) {
    let target = new Date();
    target.setHours(4, 0, 0, 0); // 4 AM
    
    // Find next Sunday
    target.setDate(target.getDate() + ((7 - target.getDay()) % 7));
    if (target <= new Date()) {
       target.setDate(target.getDate() + 7);
    }
    
    const msToWait = target - new Date();
    console.log(`[Refresher] ⏳ Next site audit scheduled for ${formatTime(target)} (${Math.floor(msToWait / 3600000 / 24)} days from now)`);
    await sleep(msToWait);
    
    try {
      await runRefreshPipeline(2); // Auto-refresh max 2 posts per week
    } catch (err) {
      console.error('[Refresher] ❌ Scheduled pipeline failed:', err.message);
    }
  }
}

/**
 * Executes the entire suite of automation tasks sequentially.
 * Used for full workflow testing from the dashboard.
 */
async function runFullSuite() {
  const secondaryNumber = process.env.SECONDARY_WHATSAPP_NUMBER || null;
  console.log('\n🌟 --- STARTING FULL WORKFLOW SUITE --- 🌟');
  await sendWhatsAppUpdate('🚀 *Full Workflow Test Started!*');
  
  let resume = `📝 *FULL WORKFLOW RESUME*\n---\n`;

  try {
    // 1. Content Pipeline
    console.log('\n[Full Suite] (1/4) Starting Content Pipeline...');
    const wpResults = await runAutoPoster(); 
    resume += `✅ *Content Pipeline*: Done\n`;
    if (wpResults && wpResults.length > 0) {
        resume += `🔗 *New Posts*:\n${wpResults.map(url => `• ${url}`).join('\n')}\n`;
    }
    
    // 2. Instagram Engagement
    console.log('\n[Full Suite] (2/4) Starting Instagram Engagement...');
    await runInstagramStealth();
    resume += `✅ *IG Stealth*: Completed\n`;
    
    // 3. Instagram Posting
    console.log('\n[Full Suite] (3/4) Starting Instagram Posting...');
    const igPost = await runInstagramPoster();
    resume += `✅ *IG Photo*: Uploaded\n`;
    
    // 4. GSC Snapshot
    console.log('\n[Full Suite] (4/5) Starting GSC Snapshot...');
    await pullDailySnapshot();
    resume += `✅ *GSC Stats*: Synced\n`;

    // 5. Tumblr is now natively handled by runAutoPoster pipeline
    console.log('\n[Full Suite] Skipping standalone Tumblr step (now integrated in Content Pipeline)...');
    resume += `✅ *Tumblr*: Published (Via Pipeline)\n`;
    
    console.log('\n✨ --- FULL WORKFLOW SUITE COMPLETED --- ✨');
    const finalMsg = `${resume}\n✨ *STATUS: SUCCESS*`;
    
    await sendWhatsAppUpdate(finalMsg); // Send to owner
    if (secondaryNumber) {
      await sendWhatsAppUpdate(finalMsg, secondaryNumber); // Send to secondary number
    }
    
    logAction('full_workflow_test', 'success', { details: 'All stages executed' });
  } catch (error) {
    console.error('\n❌ --- FULL WORKFLOW SUITE FAILED --- ❌');
    const failMsg = `❌ *FULL WORKFLOW FAILED*\nError: ${error.message}`;
    await sendWhatsAppUpdate(failMsg);
    if (secondaryNumber) {
      await sendWhatsAppUpdate(failMsg, secondaryNumber);
    }
    logAction('full_workflow_test', 'error', { error: error.message });
    throw error;
  }
}

// Start the flow
(async () => {
  // 🛡️ Prevent multiple instance from running (Fix for 440 Conflict)
  const { acquireLock } = require('./utils/lock');
  acquireLock();

  // Warm up the DB sequentially to prevent 'fetch failed' DNS race conditions in Node
  try { await readSettings(); } catch(e) {}

  // Start the dashboard server
  startDashboard();

  // Register functions in dashboard
  try {
    registerBotFunction('runAutoPoster', runAutoPoster);
    registerBotFunction('runFullSuite', runFullSuite);
  } catch (e) {
    console.warn('Could not register functions for dashboard tests.');
  }

  // Initialize WhatsApp if enabled (Safe Startup)
  const startupSettings = await readSettings();
  if (startupSettings.workflows?.whatsapp_notifications) {
    try {
      console.log('[Startup] Initializing WhatsApp Notification Engine...');
      await connectToWhatsApp();
      // We don't await waitForWhatsAppConnection here to avoid blocking the whole bot if the user hasn't scanned yet
      waitForWhatsAppConnection().then(() => {
        console.log('[Startup] WhatsApp connected and ready.');
      }).catch(e => {
        console.warn('[Startup] WhatsApp connection timed out or failed in background:', e.message);
      });
    } catch (err) {
      console.error('❌ Failed to start WhatsApp bot:', err.message);
      console.log('Bot will continue without WhatsApp notifications.');
    }
  }

  if (process.argv.includes('--post-now')) {
    console.log('Manual trigger: posting a photo to Instagram NOW...');
    await sendWhatsAppUpdate('🎯 *Manual Trigger:* Starting Instagram post upload...');
    await runInstagramPoster();
    logAction('instagram_post', 'success', { trigger: 'manual_cli' });
    console.log('Manual post done.');
    process.exit(0);
  } else if (process.argv.includes('--now')) {
    console.log('Manual trigger detected. Running stealth engagement ONCE now...');
    await sendWhatsAppUpdate('🎯 *Manual Trigger:* Starting Instagram engagement...');
    runInstagramStealth().then(() => {
      logAction('instagram_engage', 'success', { trigger: 'manual_cli' });
      console.log('Manual run finished.');
      process.exit(0);
    }).catch(err => {
      logAction('instagram_engage', 'error', { trigger: 'manual_cli', error: err.message });
      console.error(err);
      process.exit(1);
    });
  } else {
    // Run all schedulers in parallel
    Promise.all([
      startScheduler(),
      startPosterScheduler(),
      startGscScheduler(),
      startRefresherScheduler()
    ]);
  }
})();

module.exports = { startScheduler };
