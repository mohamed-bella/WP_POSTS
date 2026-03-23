const { TwitterApi } = require('twitter-api-v2');
const { logAction } = require('./db');
require('dotenv').config();

/**
 * Posts an update to Twitter/X.
 * @param {string} text - The tweet text (max 280 chars total, including URL)
 * @param {string} link - The URL to include in the tweet
 * @returns {Promise<string>} The ID of the created tweet
 */
async function postToTwitter(text, link = '') {
  try {
    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const tweetText = link ? `${text}\n\n${link}` : text;

    console.log(`[Twitter] Posting tweet: "${tweetText.substring(0, 50)}..."`);
    const { data } = await client.v2.tweet(tweetText);
    
    console.log(`[Twitter] ✅ Tweet successful! ID: ${data.id}`);
    logAction('twitter_post', 'success', { id: data.id, text, url: `https://twitter.com/user/status/${data.id}` });
    return data.id;

  } catch (error) {
    console.error('[Twitter] ❌ Failed to post:', error.message);
    if (error.data) {
      console.error(error.data);
    }
    logAction('twitter_post', 'error', { error: error.message });
    throw error;
  }
}

module.exports = { postToTwitter };
