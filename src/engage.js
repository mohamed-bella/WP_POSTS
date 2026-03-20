const { runInstagramEngagement } = require('./services/instagram-engage');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const settingsPath = path.join(__dirname, '../settings.json');

// Helper to delay
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
    let settings = { workflows: { instagram_engage: false } };
    try {
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch (e) {
      console.warn('Could not read settings.json');
    }

    if (!settings.workflows?.instagram_engage) {
      console.log('Instagram engagement is disabled in settings.json. Sleeping for 1 hour...');
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
        await runInstagramEngagement();
      } catch (err) {
        console.error('Engagement failed:', err.message);
        console.error('Will retry on the next scheduled run.');
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

// Start immediately if executed directly
if (require.main === module) {
  startScheduler();
}

module.exports = { startScheduler };
