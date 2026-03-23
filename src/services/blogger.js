const { google } = require('googleapis');
const { sendWhatsAppUpdate } = require('./whatsapp');
const { logAction } = require('./db');
const fs = require('fs');
require('dotenv').config();

/**
 * Retries an async operation if a network error (like EAI_AGAIN) occurs.
 */
/**
 * Retries an async operation if a network error (like EAI_AGAIN) occurs.
 */
async function executeWithRetry(operation, maxRetries = 5, delayMs = 10000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err) {
      const errMsg = err.message || '';
      const isNetworkErr = (
        err.code === 'EAI_AGAIN' || 
        err.code === 'ECONNRESET' || 
        err.code === 'ETIMEDOUT' || 
        err.code === 'ENOTFOUND' ||
        errMsg.includes('EAI_AGAIN') ||
        errMsg.includes('getaddrinfo')
      );

      if (isNetworkErr && i < maxRetries - 1) {
        console.warn(`⚠️ [Network] ${err.code || 'DNS'} error. Retrying in ${delayMs / 1000}s... (Attempt ${i + 1} of ${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        // Exponential backoff
        delayMs *= 1.5;
      } else {
        throw err;
      }
    }
  }
}

/**
 * Creates a post on a Blogger website.
 * @param {string} blogId The ID of the Blogger blog.
 * @param {string} title The title of the post.
 * @param {string} content The HTML content of the post.
 * @returns {Promise<string|null>} The URL of the published post, or null on failure.
 */
async function createBloggerPost(blogId, title, content) {
  const { BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET, BLOGGER_REFRESH_TOKEN } = process.env;

  if (!BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET || !BLOGGER_REFRESH_TOKEN) {
    console.warn('Blogger OAuth credentials are missing. Skipping Blogger post.');
    return null;
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      BLOGGER_CLIENT_ID,
      BLOGGER_CLIENT_SECRET,
      'http://localhost'
    );

    oauth2Client.setCredentials({
      refresh_token: BLOGGER_REFRESH_TOKEN,
    });

    const blogger = google.blogger({
      version: 'v3',
      auth: oauth2Client,
    });

    // We add a disclaimer linking back to the original post for SEO purposes
    const seoDisclaimer = `<p><br/><em>Originally published on Morocco Travel Experts.</em></p>`;

    const response = await executeWithRetry(() => blogger.posts.insert({
      blogId: blogId.trim(),
      isDraft: false,
      requestBody: {
        title: title,
        content: content + seoDisclaimer,
      },
    }));

    console.log(`✅ Post published to Blogger (${blogId}): ${response.data.url}`);
    await sendWhatsAppUpdate(`📝 *Blogger Published:* ${response.data.title}\n🔗 ${response.data.url}`);
    logAction('blogger_post', 'success', { blogId, title, url: response.data.url });
    return response.data.url;
  } catch (error) {
    console.error(`Error posting to Blogger (blogId: ${blogId}):`, error.response?.data?.error?.message || error.message);
    logAction('blogger_post', 'error', { blogId, title, error: error.response?.data?.error?.message || error.message });
    return null;
  }
}

/**
 * Publishes the article to multiple Blogger sites.
 * @param {string[]} blogIds Array of Blogger IDs
 * @param {Object} article Object containing title and content
 */
async function publishToMultipleBloggers(blogIds, title, content) {
  const publishedUrls = [];
  for (const blogId of blogIds) {
    if (blogId) {
      console.log(`Publishing to Blogger ID: ${blogId}...`);
      const url = await createBloggerPost(blogId, title, content);
      if (url) publishedUrls.push(url);
    }
  }
  return publishedUrls;
}

module.exports = { publishToMultipleBloggers, createBloggerPost };
