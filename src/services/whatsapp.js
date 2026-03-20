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

/**
 * Initialize WhatsApp connection
 */
async function connectToWhatsApp() {
    if (isConnected || isConnecting) return;
    isConnecting = true;

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
                // Retry in 10s if it failed due to connection
                setTimeout(requestPairing, 10000);
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
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`🔌 WhatsApp connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
            isConnected = false;
            isConnecting = false;

            if (statusCode === 401) {
                console.error('❌ WhatsApp Session Invalid (401).');
            }

            if (shouldReconnect) {
                // Add a delay to prevent 440 Conflict loops
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection opened!');
            isConnected = true;
            isConnecting = false;
            sendWhatsAppUpdate('🚀 *Automation Bot Started!* I will send updates here.');
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
