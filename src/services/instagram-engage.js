const { IgApiClient } = require('instagram-private-api');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const STATE_FILE = path.join(__dirname, '../../ig_state.json');

const ig = new IgApiClient();

// Helper: Random sleep to look human
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomSleep = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1) + min));

const COMMENTS = [
  "Such a beautiful capture of Morocco! 🇲🇦",
  "Absolutely love this spot! Great photo.",
  "Morocco never stops amazing me. Beautiful!",
  "Great family travel inspiration! Love seeing this.",
  "Stunning! Which city was this taken in?",
  "This is exactly why we love Morocco! 🤩",
  "Wow, the colors here are incredible 🇲🇦",
  "Adding this to our next itinerary for sure!",
  "Beautiful perspective on a classic spot.",
  "Love this so much! Morocco is magic.",
  "What an incredible experience that must have been!",
  "Perfect shot! Made me miss Morocco.",
  "This captures the vibe perfectly. Great job!",
  "Incredible travel memories 🇲🇦✨",
  "I always tell visitors to go here. Great photo!"
];

async function loginToInstagram() {
  const username = process.env.IG_USERNAME;
  const password = process.env.IG_PASSWORD;

  if (!username || !password) {
    throw new Error('IG_USERNAME or IG_PASSWORD not set in .env');
  }

  ig.state.generateDevice(username);

  // Load session if it exists to avoid repeated logins
  let loggedIn = false;
  if (fs.existsSync(STATE_FILE)) {
    try {
      const savedState = await fs.promises.readFile(STATE_FILE, 'utf8');
      await ig.state.deserialize(savedState);
      
      // Basic check if session is still alive
      await ig.user.info(ig.state.cookieUserId);
      console.log('✅ Restored Instagram session from cache.');
      loggedIn = true;
    } catch (e) {
      console.log('Cache invalid or expired. Logging in fresh...');
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    }
  }

  if (!loggedIn) {
    console.log(`Logging into Instagram as ${username}...`);
    // Simulate real app flow
    await ig.simulate.preLoginFlow();
    await ig.account.login(username, password);
    process.nextTick(async () => await ig.simulate.postLoginFlow());

    // Save session right after login
    const serialized = await ig.state.serialize();
    delete serialized.constants; // Delete constants from state per docs
    await fs.promises.writeFile(STATE_FILE, JSON.stringify(serialized));
    console.log('✅ Instagram login successful. Session saved.');
  }
}

async function runInstagramEngagement() {
  await loginToInstagram();

  // Pick a random hashtag
  const tags = ['morocco', 'moroccotravel', 'visitmorocco', 'familytravel', 'marrakech'];
  const targetTag = tags[Math.floor(Math.random() * tags.length)];

  console.log(`🔍 Searching for fresh posts in #${targetTag}...`);
  const feed = ig.feed.tags(targetTag, 'recent');
  
  // Get first page
  const items = await feed.items();
  console.log(`Found ${items.length} recent posts. Filtering for engagement...`);

  // Filter for non-ads, reasonably engaged posts (to avoid commenting on spam)
  const candidatePosts = items.filter(item => 
    item.like_count > 20 && 
    item.like_count < 2000 && // Avoid mega-influencers where our comment gets lost
    item.comments_disabled === false
  );

  if (candidatePosts.length === 0) {
    console.log('🤷‍♂️ No suitable candidate posts found this run. Skipping.');
    return;
  }

  // Shuffle and pick the top 1 or 2
  const shuffled = candidatePosts.sort(() => 0.5 - Math.random());
  const maxCommentsPerRun = 1; // Strict safety limit: 1 comment per run to avoid bans
  const selectedPosts = shuffled.slice(0, maxCommentsPerRun);

  for (const post of selectedPosts) {
    const randomComment = COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
    const username = post.user.username;

    console.log(`💬 Found target! Post by @${username} (${post.like_count} likes).`);
    console.log(`⏳ Waiting 15-30 seconds to look human before commenting...`);
    await randomSleep(15000, 30000);

    try {
      await ig.media.comment({
        mediaId: post.id,
        text: randomComment,
      });
      console.log(`✅ Success! Commented on @${username}'s post: "${randomComment}"`);
      
      // Optionally like the post too
      await randomSleep(2000, 5000);
      await ig.media.like({
        mediaId: post.id,
        moduleInfo: {
          module_name: 'profile',
          user_id: post.user.pk,
          username: post.user.username,
        },
        d: 1, // Double tap indicator
      });
      console.log(`❤️ Liked @${username}'s post.`);
      
    } catch (err) {
      console.error(`❌ Failed to comment/like: ${err.message}`);
    }
  }

  console.log('--- Engagement Run Complete ---');
}

module.exports = {
  runInstagramEngagement
};
