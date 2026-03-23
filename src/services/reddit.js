const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { logAction } = require('./db');
require('dotenv').config();

puppeteer.use(StealthPlugin());

// Consistent with Instagram: Use a root cookies file for easy manual import if needed
const COOKIES_FILE = path.join(__dirname, '../../reddit_cookies.json');

/**
 * Persists the current browser session to disk.
 */
async function saveSession(page) {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
        console.log('[Reddit] 💾 Session cookies refreshed and saved.');
    } catch (e) {
        console.error('[Reddit] ⚠️ Failed to save session cookies:', e.message);
    }
}

/**
 * Stealth login fallback if cookies are missing or expired.
 */
async function loginToReddit(page) {
    const { REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;

    if (!REDDIT_USERNAME || !REDDIT_PASSWORD) {
        throw new Error('REDDIT_USERNAME or REDDIT_PASSWORD missing in .env');
    }

    console.log('[Reddit] 🔐 Attempting Stealth Login as:', REDDIT_USERNAME);
    await page.goto('https://www.reddit.com/login/', { waitUntil: 'networkidle2' });

    try {
        await page.waitForSelector('#loginUsername', { timeout: 15000 });
        await page.type('#loginUsername', REDDIT_USERNAME, { delay: 100 });
        await page.type('#loginPassword', REDDIT_PASSWORD, { delay: 100 });
        
        // Human-like delay before clicking
        await new Promise(r => setTimeout(r, 2000));
        await page.click('button[type="submit"]');

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 });
    } catch (e) {
        console.error('[Reddit] ❌ Login sequence failed or CAPTCHA detected:', e.message);
        await page.screenshot({ path: path.join(__dirname, '../../reddit-login-error.png') });
    }

    // Check if truly logged in (User menu usually present)
    const isLoggedIn = await page.evaluate(() => {
        // old.reddit.com auth indicators
        return !!document.querySelector('.user.loggedin') ||
               !!document.querySelector('#header-bottom-right .user a');
    });

    if (isLoggedIn) {
        console.log('[Reddit] ✅ Login successful.');
        await saveSession(page);
    } else {
        throw new Error('Reddit Login failed. Please provide manual cookies in reddit_cookies.json if you see a CAPTCHA.');
    }
}

/**
 * Main posting function using Stealth Browser + Cookie Persistence.
 */
async function postToSubreddits(title, url, subreddits = []) {
    if (subreddits.length === 0) {
        console.warn('[Reddit] No subreddits targetted.');
        return [];
    }

    console.log('[Reddit] 🚀 Launching Stealth Browser for Posting...');
    const browser = await puppeteer.launch({
        headless: true, // Set to false to debug visually
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--window-size=1280,800'
        ]
    });

    const results = [];

    try {
        const page = await browser.newPage();
        
        // Standard high-authority User Agent
        const userAgent = process.env.REDDIT_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
        await page.setUserAgent(userAgent);
        await page.setViewport({ width: 1280, height: 800 });

        // 1. Load Session (Cookie Flow)
        if (fs.existsSync(COOKIES_FILE)) {
            console.log('[Reddit] 🍪 Injecting session cookies from reddit_cookies.json...');
            const cookiesData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
            // Map cookies correctly to Puppeteer format (handle both 'expires' and 'expirationDate')
            const puppeteerCookies = cookiesData.map(c => ({
                name: c.name,
                value: c.value,
                domain: c.domain || '.reddit.com',
                path: c.path || '/',
                expires: c.expires || c.expirationDate || -1
            }));
            await page.setCookie(...puppeteerCookies);
        }

        // 2. Initial Auth Check
        await page.goto('https://old.reddit.com/', { waitUntil: 'networkidle2' });
        const needsLogin = await page.evaluate(() => {
            // old.reddit.com: logged-in users have .user.loggedin in the header
            return !document.querySelector('.user.loggedin') &&
                   !document.querySelector('#header-bottom-right .user a');
        });

        if (needsLogin) {
            console.log('[Reddit] ⚠️ Session expired or missing. Falling back to stealth login...');
            await loginToReddit(page);
        } else {
            console.log('[Reddit] ✅ session valid. Resuming as logged-in user.');
        }

        // 3. Posting Loop
        for (const sub of subreddits) {
            const cleanSub = sub.replace(/^r\//, '').trim();
            if (!cleanSub) continue;

            console.log(`[Reddit] 📎 Navigating to r/${cleanSub} submit page...`);

            try {
                // Use old.reddit.com submit page — reliable selectors, no React
                const submitUrl = `https://old.reddit.com/r/${cleanSub}/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
                await page.goto(submitUrl, { waitUntil: 'networkidle2' });

                // old.reddit.com pre-fills fields from query params — just verify they're there
                await page.waitForSelector('#url', { timeout: 20000 });
                // Clear and retype URL in case it wasn't pre-filled
                await page.$eval('#url', el => el.value = '');
                await page.type('#url', url, { delay: 40 });

                await page.waitForSelector('#title', { timeout: 10000 });
                await page.$eval('#title', el => el.value = '');
                await page.type('#title', title, { delay: 40 });

                // Small delay to simulate "thinking"
                await new Promise(r => setTimeout(r, 3000));

                // Submit
                console.log(`[Reddit] 📤 Submitting post to r/${cleanSub}...`);
                // old.reddit.com uses an input[type=submit] inside the link-form
                const submitBtn = await page.$('#newlink button[type="submit"], input[type="submit"][value="Submit"]');
                
                if (submitBtn) {
                    await submitBtn.click();
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 40000 });
                    
                    const finalUrl = page.url();
                    console.log(`[Reddit] ✅ Success: ${finalUrl}`);
                    logAction('reddit_post', 'success', { subreddit: cleanSub, title, url: finalUrl });
                    results.push(finalUrl);
                    
                    // Refresh session after success to keep it alive
                    await saveSession(page);
                } else {
                    throw new Error('Submit button disabled. Likely rules violation or low karma.');
                }

                // Random delay between subreddits (5-10s)
                const delay = Math.floor(Math.random() * 5000) + 5000;
                await new Promise(r => setTimeout(r, delay));

            } catch (err) {
                console.error(`[Reddit] ❌ Failed to post in r/${cleanSub}:`, err.message);
                logAction('reddit_post', 'error', { subreddit: cleanSub, error: err.message });
            }
        }

    } catch (globalError) {
        console.error('[Reddit] ❌ Critical Browser Error:', globalError.message);
    } finally {
        await browser.close();
        console.log('[Reddit] 🏁 Browser closed.');
    }

    return results;
}

module.exports = {
    postToSubreddits
};
