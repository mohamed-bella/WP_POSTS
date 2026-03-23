const fs = require('fs');
const path = require('path');
const process = require('process');

const LOCK_FILE = path.join(process.cwd(), 'bot.lock');

/**
 * Ensures only one instance of the bot is running.
 */
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const oldPid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    try {
      // Check if process is still alive (Windows & Unix compatible)
      process.kill(parseInt(oldPid, 10), 0);
      
      console.error(`\n⚠️  [FATAL ERROR] Another instance of the bot is already running (PID: ${oldPid}).`);
      console.error(`   To fix this, please close all existing 'npm start' or 'node engage.js' processes.`);
      console.error(`   If you believe this is an error, delete the file: ${LOCK_FILE}\n`);
      process.exit(1);
    } catch (e) {
      // Process is dead, stale lock
      console.log(`[Startup] Found stale lockfile (PID: ${oldPid}). Overwriting...`);
      fs.unlinkSync(LOCK_FILE);
    }
  }

  // Create new lock
  fs.writeFileSync(LOCK_FILE, process.pid.toString());
  console.log(`[Startup] Instance lock acquired (PID: ${process.pid}).`);

  // Cleanup on exit
  const cleanup = () => {
    if (fs.existsSync(LOCK_FILE)) {
      const currentPid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      if (currentPid === process.pid.toString()) {
        fs.unlinkSync(LOCK_FILE);
        console.log('[Shutdown] Instance lock released.');
      }
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(); });
  process.on('SIGTERM', () => { cleanup(); process.exit(); });
  process.on('SIGHUP', () => { cleanup(); process.exit(); });
  
  // Handle uncaught exceptions just in case
  process.on('uncaughtException', (err) => {
    cleanup();
    console.error('[Uncaught Exception]', err.message);
    process.exit(1);
  });
}

module.exports = { acquireLock };
