const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let sock;
let isConnected = false;
let isConnecting = false;
let lastStartedMsgTime = 0;

/**
 * Initialize WhatsApp connection
 */
async function connectToWhatsApp() {
    if (isConnected || isConnecting) return;
    isConnecting = true;

    // Clean up existing socket if any
    if (sock) {
        try {
            sock.ev.removeAllListeners('connection.update');
            sock.ev.removeAllListeners('creds.update');
            sock.terminate();
        } catch (e) {}
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    console.log('📱 Connecting to WhatsApp...');
    
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: !process.env.WHATSAPP_NUMBER,
        logger: pino({ level: 'silent' }),
    });

    const requestPairing = async () => {
        if (process.env.WHATSAPP_NUMBER && !sock.authState.creds.registered) {
            try {
                const code = await sock.requestPairingCode(process.env.WHATSAPP_NUMBER);
                console.log(`\n🔗 WhatsApp Pairing Code: *${code}*`);
                fs.writeFileSync('whatsapp_code.txt', code); 
                console.log('👉 Enter this code in WhatsApp (Linked Devices -> Link with phone number)\n');
            } catch (err) {
                console.error('❌ Failed to request pairing code:', err.message);
                if (err.message.includes('Connection Closed')) {
                    setTimeout(requestPairing, 15000);
                }
            }
        }
    };

    // Trigger pairing if needed
    if (process.env.WHATSAPP_NUMBER && !sock.authState.creds.registered) {
        setTimeout(requestPairing, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && !process.env.WHATSAPP_NUMBER) {
            console.log('🤳 Scan the QR code below to link the WhatsApp bot:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 440;
            
            if (statusCode === 440) {
                console.error('⚠️ WhatsApp Conflict (440): Another instance of this bot is already running. This instance will NOT send notifications.');
            } else {
                console.log(`🔌 WhatsApp connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
            }

            isConnected = false;
            isConnecting = false;

            if (shouldReconnect) {
                const delay = 10000;
                setTimeout(connectToWhatsApp, delay);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection opened!');
            isConnected = true;
            isConnecting = false;

            // Debounce the startup message (once every 30 minutes max)
            const now = Date.now();
            if (now - lastStartedMsgTime > 1800000) {
                lastStartedMsgTime = now;
                sendWhatsAppUpdate('🚀 *Automation Bot Started!* I will send updates here.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    return sock;
}

/**
 * Promise that resolves when WhatsApp is connected
 */
async function waitForWhatsAppConnection() {
    if (isConnected) return;
    console.log('⏳ Waiting for WhatsApp connection to be established...');
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (isConnected) {
                clearInterval(interval);
                resolve();
            }
        }, 2000);
    });
}

/**
 * Send a message to the owner's WhatsApp
 */
async function sendWhatsAppUpdate(message) {
    if (!sock || !isConnected) {
        // console.warn('⚠️ WhatsApp not connected. Skipping message:', message);
        return;
    }

    const number = process.env.WHATSAPP_NUMBER;
    if (!number) {
        console.warn('⚠️ WHATSAPP_NUMBER not set in .env');
        return;
    }

    // Format number to JID (e.g. 212600000000@s.whatsapp.net)
    const jid = number.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

    try {
        await sock.sendMessage(jid, { text: `🤖 *Bot Update:*\n${message}` });
        // console.log('📨 WhatsApp update sent.');
    } catch (error) {
        console.error('❌ Failed to send WhatsApp update:', error.message);
    }
}

module.exports = { connectToWhatsApp, sendWhatsAppUpdate, waitForWhatsAppConnection };
