const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { logAction, readSettings } = require('./db');
require('dotenv').config();

// getNotifSettings is now handled via async readSettings in callers


let sock;
let isConnected = false;
let isConnecting = false;
let lastStartedMsgTime = 0;
let latestQr = null;
let pairingCode = null;
let shouldWipeSession = false;
let isManualLinking = false;

/**
 * Initialize WhatsApp connection
 */
async function connectToWhatsApp() {
    if (isConnected || isConnecting) return;
    isConnecting = true;

    const authPath = path.join(process.cwd(), 'auth_info_baileys');

    // Clean up existing socket if any
    if (sock) {
        try {
            sock.ev.removeAllListeners('connection.update');
            sock.ev.removeAllListeners('creds.update');
            sock.terminate();
        } catch (e) {}
        sock = null;
    }

    if (shouldWipeSession) {
        console.log('[WhatsApp] 🧹 Performing deferred session wipe...');
        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
                console.log('✅ Session folder cleared.');
            } catch (e) {
                console.error('Failed to clear session folder:', e.message);
            }
        }
        shouldWipeSession = false;
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    console.log('📱 Connecting to WhatsApp...');
    
    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
    });

    const requestPairing = async (forcedNumber) => {
        const targetNumber = forcedNumber || process.env.WHATSAPP_NUMBER;
        if (targetNumber && (!sock.authState.creds.registered || forcedNumber)) {
            try {
                // Wait for socket to be somewhat ready
                await new Promise(r => setTimeout(r, 2000));
                pairingCode = await sock.requestPairingCode(targetNumber);
                console.log(`\n🔗 WhatsApp Pairing Code: *${pairingCode}*`);
                console.log('👉 Enter this code in WhatsApp (Linked Devices -> Link with phone number)\n');
                return pairingCode;
            } catch (err) {
                console.error('❌ Failed to request pairing code:', err.message);
                pairingCode = null; // Clear it if failed
                if (err.message.includes('Connection Closed')) {
                    // Don't auto-retry with timeout if it crashed last time
                    // The dashboard-server will retry if requested
                }
            }
        }
    };

    // Trigger pairing if needed (Safe Startup)
    // Only auto-trigger if no manual linking is in progress and we have a number
    if (process.env.WHATSAPP_NUMBER && !sock.authState.creds.registered && !isManualLinking) {
        setTimeout(() => {
            if (!isConnected && !isManualLinking) {
                sock.requestPairing();
            }
        }, 5000);
    }
    
    // Attach to sock for runtime access
    sock.requestPairing = requestPairing;

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            latestQr = qr;
            console.log('🤳 WhatsApp QR Code updated (Available for scanning)');
            if (!process.env.WHATSAPP_NUMBER) {
                qrcode.generate(qr, { small: true });
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLogout = statusCode === DisconnectReason.loggedOut || statusCode === 401;
            const shouldReconnect = !isLogout && statusCode !== 440;
            
            if (isLogout) {
                console.log('⚠️ WhatsApp Session Expired/Logged Out (401). Flagging for wipe...');
                shouldWipeSession = true;
            }
            
            if (statusCode === 440) {
                console.error('⚠️ WhatsApp Conflict (440): Another instance is running.');
            } else if (!isLogout) {
                console.log(`🔌 WhatsApp connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
            }

            isConnected = false;
            isConnecting = false;
            pairingCode = null;

            if (shouldReconnect) {
                const delay = 10000;
                setTimeout(connectToWhatsApp, delay);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection opened!');
            isConnected = true;
            isConnecting = false;
            isManualLinking = false;
            pairingCode = null;
            latestQr = null;

            // Debounce the startup message (once every 30 minutes max)
            const now = Date.now();
            if (now - lastStartedMsgTime > 1800000) {
                lastStartedMsgTime = now;
                readSettings().then(settings => {
                    const notif = settings.notifications || {};
                    const shouldSend = notif.sendLogsToOwner !== false;
                    if (shouldSend) {
                        sendWhatsAppUpdate('🚀 *Automation Bot Started!* I will send updates here.');
                    }
                }).catch(e => console.error('Failed to read settings on startup:', e.message));
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    return sock;
}

/**
 * Promise that resolves when WhatsApp is connected
 */
async function waitForWhatsAppConnection(timeoutMs = 60000) {
    if (isConnected) return;
    console.log('⏳ Waiting for WhatsApp connection to be established...');
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            clearInterval(interval);
            reject(new Error('WhatsApp connection timed out after ' + (timeoutMs / 1000) + 's'));
        }, timeoutMs);

        const interval = setInterval(() => {
            if (isConnected) {
                clearInterval(interval);
                clearTimeout(timeout);
                resolve();
            }
        }, 2000);
    });
}

/**
 * Send a message to a WhatsApp number (defaults to WHATSAPP_NUMBER in .env)
 */
/**
 * Send a message to a WhatsApp number (defaults to WHATSAPP_NUMBER in .env)
 */
async function sendWhatsAppUpdate(message, targetNumber = null) {
  // Auto-connect if not connected and we have a number
  if (!sock && !isConnecting) {
    console.log('[WhatsApp] 🔄 Offline. Attempting auto-connection to send message...');
    await connectToWhatsApp();
    // Wait a bit for connection, but don't block forever
    let attempts = 0;
    while (!isConnected && attempts < 5) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }
  }

  if (!sock || !isConnected) {
    console.log('[WhatsApp] ⚠️ Cannot send message: Still not connected.');
    return;
  }

  const settings = await readSettings();
  const notif = settings.notifications || {};

  // Resolve the number: explicit arg > settings.ownerWhatsApp > env var
  const number = targetNumber
    || notif.ownerWhatsApp
    || process.env.WHATSAPP_NUMBER;

  if (!number) {
    console.warn('⚠️ [WhatsApp] No destination number found in settings or environment.');
    return;
  }

  // If sending to owner (no explicit targetNumber), check sendLogsToOwner flag
  if (!targetNumber && notif.sendLogsToOwner === false) {
    return; // silently skip — user turned off notifications
  }

  // Format number to JID
  const cleanNumber = number.toString().replace(/[^0-9]/g, '');
  if (!cleanNumber) return;
  
  const jid = cleanNumber + '@s.whatsapp.net';

  try {
    await sock.sendMessage(jid, { text: `🤖 *Bot Update:*\n${message}` });
    console.log(`[WhatsApp] ✅ Message sent to ${cleanNumber}`);
  } catch (error) {
    console.error('❌ [WhatsApp] Failed to send update:', error.message);
    if (error.message.includes('not opened')) {
        isConnected = false;
    }
  }
}

function getWhatsAppStatus() {
    return {
        connected: isConnected,
        connecting: isConnecting,
        qr: latestQr,
        pairingCode: pairingCode,
        number: process.env.WHATSAPP_NUMBER || null
    };
}

async function requestPairing(number) {
    if (!number) return { error: 'Phone number required' };
    
    // Convert to target format (clean number)
    const cleanNumber = number.toString().replace(/[^0-9]/g, '');
    
    console.log(`[WhatsApp] 🔗 Forced Pairing Request for: ${cleanNumber}`);
    isManualLinking = true; // Set flag to block auto-trigger

    // If already connected/connecting, we should probably RESET if the number is different
    // or if the user explicitly wants to "re-link"
    if (sock) {
        try {
            console.log('[WhatsApp] Resetting socket for new pairing request...');
            isConnected = false;
            isConnecting = false;
            sock.ev.removeAllListeners('connection.update');
            sock.ev.removeAllListeners('creds.update');
            sock.terminate();
        } catch (e) {}
        sock = null;
    }

    // Force wipe for manual link requests to ensure a clean slate
    shouldWipeSession = true;

    // Process.env update for the new target
    process.env.WHATSAPP_NUMBER = cleanNumber;

    // Start a fresh connection
    // We don't call connectToWhatsApp directly here because we want to await the pairing code
    // Let's create a temporary promise to wait for the code
    return new Promise(async (resolve) => {
        try {
            await connectToWhatsApp();
            
            // Wait a few seconds for socket to be ready for pairing request
            let attempts = 0;
            const checkReady = async () => {
                if (sock && sock.requestPairingCode) {
                    try {
                        console.log(`[WhatsApp] Requesting code for ${cleanNumber}...`);
                        const code = await sock.requestPairingCode(cleanNumber);
                        pairingCode = code;
                        console.log(`[WhatsApp] Code generated: ${code}`);
                        resolve({ ok: true, code });
                    } catch (err) {
                        if (attempts < 5 && err.message.includes('Connection Closed')) {
                            attempts++;
                            setTimeout(checkReady, 3000);
                        } else {
                            resolve({ error: err.message });
                        }
                    }
                } else {
                    if (attempts < 10) {
                        attempts++;
                        setTimeout(checkReady, 2000);
                    } else {
                        resolve({ error: 'Socket initialization timeout' });
                    }
                }
            };
            setTimeout(checkReady, 3000);
        } catch (e) {
            isManualLinking = false;
            resolve({ error: e.message });
        }
    });
}

async function disconnectWhatsApp() {
    try {
        console.log('[WhatsApp] ⛔ Manual disconnect requested. Wiping session...');
        isConnected = false;
        isConnecting = false;
        latestQr = null;
        pairingCode = null;

        if (sock) {
            try {
                sock.ev.removeAllListeners('connection.update');
                sock.ev.removeAllListeners('creds.update');
                // Use a short timeout for logout to not block the response
                if (sock.logout) await Promise.race([sock.logout(), new Promise(r => setTimeout(r, 2000))]).catch(() => {});
                if (sock.terminate) sock.terminate();
            } catch (e) {
                console.warn('[WhatsApp] Warning during socket logout:', e.message);
            }
            sock = null;
        }

        const authPath = path.join(process.cwd(), 'auth_info_baileys');
        if (fs.existsSync(authPath)) {
            try {
                // Give OS a moment to close files
                await new Promise(r => setTimeout(r, 1000));
                fs.rmSync(authPath, { recursive: true, force: true });
                console.log('✅ WhatsApp session wiped successfully.');
                return { ok: true, message: 'Disconnected and session wiped.' };
            } catch (e) {
                console.error('Failed to clear session folder:', e.message);
                // Fallback: If it's locked, we set a flag to wipe it on next startup
                shouldWipeSession = true;
                return { ok: true, message: 'Disconnected, session wipe deferred (files locked).' };
            }
        }
        return { ok: true, message: 'Disconnected.' };
    } catch (e) {
        console.error('[WhatsApp] Disconnect fatal error:', e.message);
        return { ok: false, error: 'Critical failure during disconnect: ' + e.message };
    }
}

async function requestQr() {
    console.log('[WhatsApp] 🤳 Forced QR request initiated...');
    isManualLinking = true; // Use flag to skip auto-link 5s timeout
    pairingCode = null;
    latestQr = null;

    if (sock) {
        try {
            sock.ev.removeAllListeners('connection.update');
            sock.ev.removeAllListeners('creds.update');
            sock.terminate();
        } catch (e) {}
        sock = null;
    }
    
    // Clear registration intent to force QR
    shouldWipeSession = true;
    
    await connectToWhatsApp();
    return { ok: true, message: 'QR session initiated. Check dashboard for code.' };
}

module.exports = { 
    connectToWhatsApp, 
    sendWhatsAppUpdate, 
    waitForWhatsAppConnection,
    getWhatsAppStatus,
    requestPairing,
    disconnectWhatsApp,
    requestQr
};
