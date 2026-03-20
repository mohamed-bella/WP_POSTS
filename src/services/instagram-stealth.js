const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const COOKIES_FILE = path.join(__dirname, '../../cookies.json');

const COMMENTS = [
  "Such a beautiful capture of Morocco! \uD83C\uDDF2\uD83C\uDDE6",
  "Absolutely love this spot! Great photo.",
  "Morocco never stops amazing me. Beautiful!",
  "Great family travel inspiration! Love seeing this.",
  "Stunning! Which city was this taken in?",
  "This is exactly why we love Morocco! \uD83E\uDD29",
  "Wow, the colors here are incredible \uD83C\uDDF2\uD83C\uDDE6",
  "Adding this to our next itinerary for sure!",
  "Beautiful perspective on a classic spot.",
  "Love this so much! Morocco is magic.",
  "What an incredible experience that must have been!",
  "Perfect shot! Made me miss Morocco.",
  "This captures the vibe perfectly. Great job!",
  "Incredible travel memories \uD83C\uDDF2\uD83C\uDDE6✨",
  "I always tell visitors to go here. Great photo!"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomSleep = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1) + min));

async function runInstagramStealth() {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.error('\n❌ CRITICAL: Missing cookies.json file!');
    console.error('You must run an extension like "EditThisCookie" on your personal Chrome, export your Instagram cookies, and save them in a file named cookies.json in the project root.\n');
    return;
  }

  console.log('🚀 Launching stealth browser...');
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications', '--window-size=1280,800']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // 1. Inject cookies
    const cookiesString = fs.readFileSync(COOKIES_FILE, 'utf8');
    let cookies = [];
    try {
      cookies = JSON.parse(cookiesString);
    } catch(e) {
      console.error('❌ cookies.json is not valid JSON');
      return;
    }
    
    // Some cookie exporters format differently. Ensure standard puppeteer format.
    const puppeteerCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.instagram.com',
      path: c.path || '/',
    }));

    await page.setCookie(...puppeteerCookies);
    console.log('🍪 Cookies injected. Simulating navigation...');

    // 2. Go to Instagram to verify login
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
    await randomSleep(2000, 4000);

    const isLoginPage = await page.$('input[name="username"]');
    if (isLoginPage) {
      console.error('❌ Browser arrived at the login page! Your cookies.json is invalid or expired. Export fresh cookies from Chrome into cookies.json and run again.');
      await browser.close();
      return;
    }
    console.log('✅ Successfully bypassed login natively via cookies.');

    // 3. Search a random hashtag
    const tags = ['morocco', 'moroccotravel', 'visitmorocco', 'familytravel', 'marrakech'];
    const targetTag = tags[Math.floor(Math.random() * tags.length)];

    console.log(`🔍 Navigating to explore page for #${targetTag}...`);
    await page.goto(`https://www.instagram.com/explore/tags/${targetTag}/`, { waitUntil: 'networkidle2' });
    await randomSleep(3000, 5000);

    // 4. Wait for posts to appear (can be /p/ or /reel/)
    const postSelector = 'a[href*="/p/"], a[href*="/reel/"]';
    await page.waitForSelector(postSelector, { timeout: 15000 });
    const posts = await page.$$(postSelector);

    if (posts.length === 0) {
      console.log('🤷‍♂️ No posts found on the tag page. Try again later.');
      await browser.close();
      return;
    }

    // 5. Select a random post (skip the first viral one, pick one from the next few)
    const targetIndex = Math.floor(Math.random() * 5) + 1; 
    const targetPost = posts[targetIndex] || posts[0];
    
    console.log(`🖱️  Clicking post #${targetIndex + 1} on the grid...`);
    await targetPost.click();
    await randomSleep(3000, 6000);

    // 6. Like the post (SVG heart)
    try {
      const likeButton = await page.$('svg[aria-label="Like"]');
      if (likeButton) {
        // Need to click the parent button of the SVG usually
        const btn = await likeButton.evaluateHandle(el => el.closest('button'));
        if (btn) await btn.click();
        console.log('❤️  Liked the post.');
      }
    } catch(e) {
      // ignore
    }
    await randomSleep(1500, 3000);

    // 7. Find comment box
    const commentBoxSelector = 'textarea'; // The comment input is typically the only textarea
    await page.waitForSelector(commentBoxSelector, { timeout: 10000 });
    const commentBox = await page.$(commentBoxSelector);

    if (!commentBox) {
      console.log('❌ Could not find the comment box (comments might be disabled).');
      return;
    }

    // 8. Type comment
    const randomComment = COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
    console.log(`💬 Typing human-like comment: "${randomComment}" ...`);
    
    await commentBox.click();
    await randomSleep(500, 1500);
    await page.type(commentBoxSelector, randomComment, { delay: 85 });
    await randomSleep(1000, 2000);

    // Hit Enter to submit
    await page.keyboard.press('Enter');
    console.log('✅ Comment submitted successfully!');
    
    // Wait for the request to finalize
    await randomSleep(5000, 8000);

  } catch (error) {
    console.error('\n❌ Headless browser execution failed:', error.message);
    try {
      const pages = await browser.pages();
      if (pages.length > 0) {
        await pages[0].screenshot({ path: 'debug-error.png' });
        console.log('📸 Saved debug screenshot to debug-error.png');
      }
    } catch(e) {}
  } finally {
    console.log('🧹 Closing browser...');
    await browser.close();
  }
}

module.exports = {
  runInstagramStealth
};
