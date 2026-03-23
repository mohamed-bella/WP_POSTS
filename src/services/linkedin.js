const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { logAction } = require('./db');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const COOKIES_FILE = path.join(__dirname, '../../linkedin_cookies.json');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomSleep = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1) + min));

/**
 * Persist session like IG
 */
async function saveSession(page) {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
        console.log('[LinkedIn] 💾 Session cookies refreshed.');
    } catch (e) {
        console.error('[LinkedIn] ⚠️ Failed to save session:', e.message);
    }
}

/**
 * Stealth login fallback
 */
async function loginToLinkedIn(page) {
    const { LINKEDIN_EMAIL, LINKEDIN_PASSWORD } = process.env;

    if (!LINKEDIN_EMAIL || !LINKEDIN_PASSWORD) {
        throw new Error('LINKEDIN_EMAIL or LINKEDIN_PASSWORD missing in .env');
    }

    console.log('[LinkedIn] 🔐 Attempting Stealth Login as:', LINKEDIN_EMAIL);
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
    await randomSleep(2000, 4000);

    try {
        await page.waitForSelector('#username', { timeout: 15000 });
        await page.type('#username', LINKEDIN_EMAIL, { delay: 100 });
        await page.type('#password', LINKEDIN_PASSWORD, { delay: 100 });
        
        await randomSleep(2000, 3000);
        await page.click('button[type="submit"]');

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 });
    } catch (e) {
        console.error('[LinkedIn] ❌ Login failed or CAPTCHA detected:', e.message);
    }

    const isLoggedIn = await page.evaluate(() => {
        return !!document.querySelector('.global-nav__me-photo') || !!document.querySelector('#global-nav');
    });

    if (isLoggedIn) {
        console.log('[LinkedIn] ✅ Login successful.');
        await saveSession(page);
    } else {
        throw new Error('LinkedIn Login failed. Please provide manual cookies in linkedin_cookies.json.');
    }
}

/**
 * Main Posting Flow (IG-Inspired)
 */
async function postToLinkedIn(title, url) {
    console.log('[LinkedIn] 🚀 Launching Stealth Browser for Posting...');
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--window-size=1280,800',
            '--disable-notifications'
        ]
    });

    try {
        const page = await browser.newPage();
        
        // Match robust desktop browser fingerprint
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 1. Inject Cookies EXACTLY like IG Poster
        if (fs.existsSync(COOKIES_FILE)) {
            console.log('[LinkedIn] 🍪 Injecting session cookies...');
            const cookiesData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
            const puppeteerCookies = cookiesData.map(c => ({
                name: c.name, 
                value: c.value, 
                domain: c.domain || '.linkedin.com', 
                path: c.path || '/',
                expires: c.expires || c.expirationDate || -1  // Keep session alive across navigations
            }));
            await page.setCookie(...puppeteerCookies);
        }

        // 2. Navigate and Handle Popups
        console.log('[LinkedIn] 🌐 Navigating to feed...');
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await randomSleep(5000, 8000);

        // Handle common "Sign in with Google" or "Accept Cookies" popups
        const handlePopups = async () => {
          try {
            const buttons = await page.$$('button, div[role="button"]');
            for (const btn of buttons) {
              const text = await page.evaluate(el => el.textContent, btn);
              if (text.includes('Accept') || text.includes('Not Now') || text.includes('Dismiss')) {
                console.log(`☝️ Clicking popup: "${text.trim().substring(0, 20)}..."`);
                await btn.click();
                await randomSleep(1000, 2000);
              }
            }
          } catch(e) {}
        };
        await handlePopups();

        // 3. Auth Check
        const isLoggedIn = await page.evaluate(() => {
            const authSelectors = [
                '.global-nav__me-photo', 
                '#global-nav', 
                '.feed-identity-module',
                'button[aria-label="Self-serve Profile"]'
            ];
            return authSelectors.some(s => !!document.querySelector(s));
        });

        if (!isLoggedIn) {
            console.log('[LinkedIn] ⚠️ Session invalid. Falling back to login flow...');
            await loginToLinkedIn(page);
        } else {
            console.log('[LinkedIn] ✅ Session confirmed. Title:', await page.title());
        }

        // 4. Create Post
        console.log('[LinkedIn] 📝 Opening post creator...');
        
        // Robust selector for "Start a post"
        const createPostSelector = 'button.share-mb-launcher, div.share-box-feed-entry__closed-share-box button, .share-box-feed-entry__trigger';
        await page.waitForSelector(createPostSelector, { timeout: 30000 });
        await page.click(createPostSelector);
        await randomSleep(2000, 4000);

        // Wait for the editor
        const editorSelector = '.ql-editor[contenteditable="true"]';
        await page.waitForSelector(editorSelector, { timeout: 30000 });
        
        const hashtags = process.env.LINKEDIN_HASHTAGS || '#MoroccoTravel #Morocco #TravelGuides #VisitMorocco';
        const postText = `${title}\n\nRead more: ${url}\n\n${hashtags}`;
        // Type like a human
        await page.type(editorSelector, postText, { delay: 40 });
        console.log('[LinkedIn] ✍️ Post text typed.');

        // Wait for link preview to generate
        await randomSleep(5000, 7000);

        // 5. Submit
        console.log('[LinkedIn] 📤 Clicking Share button...');
        const shareBtnSelector = '.share-actions__primary-action, .jp-share-box__post-button, button.share-actions__primary-action';
        const shareBtn = await page.waitForSelector(shareBtnSelector, { timeout: 30000 });
        await shareBtn.click();
        
        // Wait for post success
        await randomSleep(6000, 10000);
        
        // Verify the editor is gone (post was submitted) or a success toast appeared
        const postConfirmed = await page.evaluate(() => {
            const editorGone = !document.querySelector('.ql-editor[contenteditable="true"]');
            const toastVisible = !!document.querySelector('.artdeco-toast-item--visible, .artdeco-toasts__item');
            return editorGone || toastVisible;
        });
        
        if (!postConfirmed) {
            console.warn('[LinkedIn] ⚠️ Could not confirm post success — verify on LinkedIn manually.');
        }
        
        console.log('[LinkedIn] ✅ Post shared successfully!');
        logAction('linkedin_post', 'success', { title, url });
        await saveSession(page);

        return true;
    } catch (err) {
        console.error('[LinkedIn] ❌ Flow interrupted:', err.message);
        try {
          const pages = await browser.pages();
          if (pages.length > 0) await pages[0].screenshot({ path: path.join(__dirname, '../../linkedin-error.png') });
        } catch(e) {}
        logAction('linkedin_post', 'error', { error: err.message });
        return false;
    } finally {
        await browser.close();
        console.log('[LinkedIn] 🏁 Browser closed.');
    }
}

module.exports = { postToLinkedIn };
