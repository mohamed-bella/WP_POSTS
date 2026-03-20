const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const COOKIES_FILE = path.join(__dirname, '../../cookies.json');

// Morocco-focused Unsplash queries, rotated randomly
const QUERIES = [
  'morocco travel',
  'marrakech morocco',
  'sahara desert morocco',
  'morocco medina',
  'fes morocco',
  'chefchaouen morocco',
  'morocco architecture',
  'atlas mountains morocco',
  'morocco streets',
  'moroccan food',
  'morocco landscape',
  'essaouira morocco',
];

// Caption templates — {query} gets replaced
const CAPTIONS = [
  "✨ The magic of {location} never gets old. Book your Morocco adventure with us! 🇲🇦\n\n#Morocco #MoroccoTravel #VisitMorocco #MoroccoFamilyTravel #AfricaTravel #TravelInspiration #DiscoverMorocco #Wanderlust #TravelPhotography #NorthAfrica #HiddenGems #TravelBlogger",
  "🌍 {location} captured perfectly. This is why Morocco is one of the most magical destinations in the world 🇲🇦\n\n#Morocco #MoroccoVibes #MoroccoGram #MarrakechMorocco #TravelPhotography #Wanderlust #AfricaTravel #VisitMorocco #ExploreMoreMorocco #TravelBlogger",
  "🇲🇦 Lost in the beauty of {location}. Where would you go first in Morocco?\n\n#Morocco #MoroccoTravel #VisitMorocco #FamilyTravel #MoroccoFamilyTours #BestOfMorocco #AfricaTravel #TravelGoals #Explore",
  "From the ancient medinas to the endless Sahara, Morocco will take your breath away. This is {location} 🌅\n\n#Morocco #Sahara #DesertTravel #VisitMorocco #MoroccoGram #ExploreAfrica #TravelBlogger #Wanderlust",
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomSleep = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1) + min));

async function fetchUnsplashImage() {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) throw new Error('UNSPLASH_ACCESS_KEY is missing from .env');

  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  console.log(`🔎 Fetching Unsplash image for query: "${query}"`);

  const response = await axios.get('https://api.unsplash.com/photos/random', {
    params: { query, orientation: 'squarish', content_filter: 'high' },
    headers: { Authorization: `Client-ID ${accessKey}` },
  });

  const photo = response.data;
  const imageUrl = photo.urls.regular;
  const photographer = photo.user.name;
  const description = photo.description || photo.alt_description || query;

  // Download the image to a temp file
  const tmpFile = path.join(os.tmpdir(), `ig_post_${Date.now()}.jpg`);
  const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  fs.writeFileSync(tmpFile, Buffer.from(imageResponse.data));

  console.log(`📸 Image saved to temp file (by ${photographer}): ${tmpFile}`);
  return { tmpFile, query, description };
}

function buildCaption(query) {
  const template = CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)];
  const locationName = query.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return template.replace('{location}', locationName);
}

async function runInstagramPoster() {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.error('\n❌ CRITICAL: Missing cookies.json file!');
    return;
  }

  // 1. Fetch image
  let imageData;
  try {
    imageData = await fetchUnsplashImage();
  } catch (err) {
    console.error('❌ Failed to fetch Unsplash image:', err.message);
    return;
  }

  const { tmpFile, query } = imageData;
  const caption = buildCaption(query);

  console.log('\n🚀 Launching stealth browser for posting...');
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications', '--window-size=375,812'],
  });

  try {
    const page = await browser.newPage();

    // Use a mobile viewport — Instagram only allows posting from mobile
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    );

    // 2. Inject cookies
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    const puppeteerCookies = cookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain || '.instagram.com', path: c.path || '/',
    }));
    await page.setCookie(...puppeteerCookies);

    // 3. Go to Instagram homepage
    console.log('🌐 Navigating to Instagram home...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await randomSleep(5000, 8000);

    const content = await page.content();
    console.log(`📄 Page content length: ${content.length}`);
    
    // 3.1. Handle common popups: "Save Login Info", "Turn on Notifications", "Get App"
    const popupSelectors = [
      'button:contains("Not Now")', 
      'button:contains("Never")',
      'a[href*="/accounts/login/"]', // In case login failed
    ];

    console.log('🕵️ Checking for popups or "Not Now" buttons...');
    await randomSleep(3000, 5000);
    
    // A more robust way to find "Not Now" buttons (by text)
    const handlePopups = async () => {
      const buttons = await page.$$('button, div[role="button"]');
      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Not Now') || text.includes('Cancel')) {
          console.log(`☝️ Clicking popup button with text: "${text}"`);
          await btn.click();
          await randomSleep(2000, 3000);
        }
      }
    };
    await handlePopups();

    // Verify logged in
    const isLoginPage = await page.$('input[name="username"]');
    if (isLoginPage) {
      console.error('❌ Cookies invalid or expired. Browser is at the login page.');
      await browser.close();
      return;
    }

    // Log all button text to see what we CAN click
    const allButtons = await page.$$eval('button, div[role="button"], a', (btns) => btns.map(b => b.innerText).filter(t => t.length > 0));
    console.log('🔘 Available buttons/links on page:', allButtons.slice(0, 15));

    console.log(`✅ Logged in via cookies. Title: "${await page.title()}"`);

    // 4. Click the "+" create button (mobile has several potential selectors)
    console.log('🔍 Searching for the "+" Create button via aria-labels...');
    const findCreateBtn = async () => {
      return await page.evaluateHandle(() => {
        const all = document.querySelectorAll('*');
        return Array.from(all).find(el => {
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          return label === 'new post' || label === 'create' || label.includes('create');
        });
      });
    };

    let createBtn = await findCreateBtn();
    
    // If not found, try a direct navigation fallback (sometimes works on mobile web)
    if (!createBtn.remoteObject().objectId) { 
      console.log('⚠️ Could not find button by label. Trying direct navigation to /create/select/ as fallback...');
      await page.goto('https://www.instagram.com/create/select/', { waitUntil: 'networkidle2' });
      await randomSleep(3000, 5000);
      // Check if we arrived at an upload screen
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        console.log('✅ Direct navigation to /create/select/ worked!');
      } else {
        throw new Error('Failed to reach upload screen via button or direct URL.');
      }
    } else {
       const parentBtn = await createBtn.evaluateHandle(el => el.closest('div[role="button"], a, button') || el);
       await parentBtn.click();
       console.log('✅ Clicked Create button.');
       await randomSleep(3000, 5000);
    }

    console.log('📂 Looking for file input...');
    const fileInputSelector = 'input[type="file"]';
    await page.waitForSelector(fileInputSelector, { timeout: 15000 });
    
    // 5. Choose the file input and upload the temp image
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 10000 }),
      page.click(fileInputSelector).catch(() => page.evaluate(() => document.querySelector('input[type="file"]').click()))
    ]);

    await fileChooser.accept([tmpFile]);
    console.log('✅ Image file accepted by browser.');
    await randomSleep(3000, 5000);

    // 6. Proceed through multi-step flow: Crop → Filter → Caption
    const nextBtnText = 'Next';
    // Click "Next" twice (Crop → Filters → Caption)
    for (let step = 0; step < 2; step++) {
      const nextBtn = await page.evaluateHandle((text) => {
        const buttons = [...document.querySelectorAll('button, div[role="button"]')];
        return buttons.find(b => b.textContent.trim() === text);
      }, nextBtnText);
      if (nextBtn) {
        await nextBtn.click();
        await randomSleep(2000, 3000);
        console.log(`👉 Clicked "${nextBtnText}" (step ${step + 1}/2)`);
      }
    }

    // 7. Type caption
    const captionSelector = 'textarea[aria-label="Write a caption..."], div[aria-label="Write a caption..."], [contenteditable="true"]';
    await page.waitForSelector(captionSelector, { timeout: 10000 });
    await page.click(captionSelector);
    await randomSleep(500, 1000);
    await page.type(captionSelector, caption, { delay: 40 });
    console.log('✍️  Caption typed.');

    await randomSleep(1000, 2000);

    // 8. Click "Share"
    const shareBtn = await page.evaluateHandle(() => {
      const buttons = [...document.querySelectorAll('button, div[role="button"]')];
      return buttons.find(b => b.textContent.trim() === 'Share');
    });
    if (shareBtn) {
      await shareBtn.click();
      console.log('📤 Clicked Share button!');
    } else {
      console.warn('⚠️  Could not find Share button. Saved a debug screenshot.');
      await page.screenshot({ path: 'debug-post.png' });
    }

    await randomSleep(6000, 10000);
    console.log('✅ Post should now be live on Instagram!');

  } catch (error) {
    console.error('\n❌ Instagram poster failed:', error.message);
    try {
      const pages = await browser.pages();
      if (pages.length > 0) await pages[0].screenshot({ path: 'debug-post.png' });
      console.log('📸 Saved debug screenshot to debug-post.png');
    } catch(e) {}
  } finally {
    await browser.close();
    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch(e) {}
    console.log('🧹 Browser closed and temp file cleaned up.');
  }
}

module.exports = { runInstagramPoster };
