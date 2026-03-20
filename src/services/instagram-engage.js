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
  const username = process.env.IG_USERNAME ? process.env.IG_USERNAME.trim() : null;
  const password = process.env.IG_PASSWORD ? process.env.IG_PASSWORD.trim() : null;

  if (!username || !password) {
    throw new Error('IG_USERNAME or IG_PASSWORD not set in .env');
  }

  ig.state.generateDevice(username);

  // Catch checkpoint requests (sometimes IG lies and says bad password when it's just a checkpoint)
  ig.request.end$.subscribe(async () => {
    const serialized = await ig.state.serialize();
    delete serialized.constants;
    if (serialized) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(serialized), 'utf8');
    }
  });

  let loggedIn = false;
  if (fs.existsSync(STATE_FILE)) {
    try {
      const savedState = fs.readFileSync(STATE_FILE, 'utf8');
      await ig.state.deserialize(savedState);
      await ig.user.info(ig.state.cookieUserId);
      console.log('✅ Restored Instagram session from cache.');
      loggedIn = true;
    } catch (e) {
      console.log('Cache invalid or expired. Logging in fresh...');
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    }
  }

  if (!loggedIn) {
    console.log(`Logging into Instagram as '${username}'...`);
    
    try {
      await ig.simulate.preLoginFlow();
      await sleep(2000); // 2 second delay to let preLoginFlow settle before hitting login
      
      const loggedInUser = await ig.account.login(username, password);
      console.log(`✅ successfully logged in as ${loggedInUser.username}`);
      
      try {
        await ig.simulate.postLoginFlow();
      } catch (e) {
        console.warn('⚠️ non-critical error during postLoginFlow automatically skipped:', e.message);
      }
    } catch (error) {
      if (error.name === 'IgCheckpointError' || (error.message && error.message.includes('checkpoint_required'))) {
        console.log('\n⚠️ Instagram Checkpoint Alert! Instagram wants to verify your identity.');
        console.log('Check your email/SMS or open the app on your phone to approve the login.');
        console.log('If you see a "Was this you?" prompt from a Germany/Finland/Hetzner location, click "This Was Me".');
        throw new Error('Checkpoint hit. Please approve the login on your phone.');
      } else if (error.name === 'IgLoginBadPasswordError') {
        console.error('\n❌ CRITICAL: Instagram is actively rejecting this password.');
        console.error('If you are 100% sure the password is correct, Instagram has "Soft Banned" this IP from logging in.');
        console.error('Wait 12-24 hours before trying again, or log into the real app on your phone, change your password, and update the .env file.');
        throw error;
      } else {
        throw error;
      }
    }
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
  let items = [];
  try {
    items = await feed.items();
    console.log(`Found ${items.length} recent posts. Filtering for engagement...`);
  } catch (feedError) {
    console.error(`\n❌ Error fetching posts for #${targetTag}:`);
    console.error(feedError.name, feedError.message);
    if (feedError.response && feedError.response.body) {
      console.error(feedError.response.body);
    }
    return;
  }

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
