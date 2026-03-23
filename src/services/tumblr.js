const tumblr = require('tumblr.js');
const { logAction } = require('./db');
require('dotenv').config();

/**
 * Get Tumblr Client
 */
function getClient() {
  const { TUMBLR_CONSUMER_KEY, TUMBLR_CONSUMER_SECRET, TUMBLR_TOKEN, TUMBLR_TOKEN_SECRET } = process.env;
  
  if (!TUMBLR_CONSUMER_KEY || !TUMBLR_CONSUMER_SECRET) {
     throw new Error('Tumblr Credentials Missing in .env');
  }

  return tumblr.createClient({
    consumer_key: TUMBLR_CONSUMER_KEY,
    consumer_secret: TUMBLR_CONSUMER_SECRET,
    token: TUMBLR_TOKEN,
    token_secret: TUMBLR_TOKEN_SECRET,
  });
}

/**
 * Post to Tumblr
 * @param {string} title
 * @param {string} content - HTML or text
 * @param {string} tags - comma separated
 * @param {string} canonicalUrl
 */
async function postToTumblr(title, content, tags = '', canonicalUrl = '') {
  const blogName = process.env.TUMBLR_BLOG_NAME;
  if (!blogName) throw new Error('TUMBLR_BLOG_NAME is required in .env');

  const client = getClient();
  const caption = `${content}\n\n<p><a href="${canonicalUrl}">Read full story on MTE ↗</a></p>`;

  const tagArray = tags ? tags.split(',').map(t => t.trim()) : [];

  return new Promise((resolve, reject) => {
    client.createLegacyPost(blogName, {
      type: 'text',
      title: title,
      body: caption,
      tags: tagArray,
      format: 'html',
      source_url: canonicalUrl
    }, async (err, res) => {
      if (err) {
        console.error('[Tumblr] ❌ Post failed:', err);
        logAction('tumblr_post', 'error', { title, error: err.message || err });
        return reject(err);
      }
      
      let postId = res.id;
      try {
         // The legacy post response doesn't include id_string, and JavaScript rounds the large ID.
         // Tumblr API has eventual consistency, so we poll for a few seconds if it's not instantly there.
         let attempts = 0;
         let found = false;
         while (attempts < 5 && !found) {
            await new Promise(r => setTimeout(r, 1500)); // wait 1.5s per attempt
            const recent = await new Promise((resQueue, rejQueue) => {
               client.blogPosts(blogName, { limit: 2 }, (e, r) => e ? rejQueue(e) : resQueue(r));
            });
            if (recent && recent.posts) {
               // Check the 2 most recent posts in case of rapid posting
               for (const p of recent.posts) {
                  if (Math.abs(Number(p.id_string) - res.id) < 50000) {
                     postId = p.id_string;
                     found = true;
                     break;
                  }
               }
            }
            attempts++;
         }
      } catch (e) {
         console.warn('[Tumblr] Could not fetch true id_string, falling back to parsed id.');
      }
      
      console.log('[Tumblr] ✅ Posted successfully:', postId);
      logAction('tumblr_post', 'success', { title, postId: String(postId), url: `https://${blogName}.tumblr.com/post/${postId}` });
      resolve(res);
    });
  });
}

/**
 * Test Connection
 */
async function testTumblrConnection() {
    const client = getClient();
    return new Promise((resolve, reject) => {
        client.userInfo((err, data) => {
            if (err) return reject(err);
            resolve(data.user.name);
        });
    });
}

module.exports = { postToTumblr, testTumblrConnection };
