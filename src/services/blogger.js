const { google } = require('googleapis');
require('dotenv').config();

/**
 * Creates a post on a Blogger website.
 * @param {string} blogId The ID of the Blogger blog.
 * @param {string} title The title of the post.
 * @param {string} content The HTML content of the post.
 * @returns {Promise<string|null>} The URL of the published post, or null on failure.
 */
async function createBloggerPost(blogId, title, content) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.warn('GOOGLE_SERVICE_ACCOUNT_JSON is missing. Skipping Blogger post.');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const jwt = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      ['https://www.googleapis.com/auth/blogger']
    );

    const blogger = google.blogger({
      version: 'v3',
      auth: jwt,
    });

    // We add a disclaimer linking back to the original post for SEO purposes
    const seoDisclaimer = `<p><br/><em>Originally published on Morocco Travel Experts.</em></p>`;

    const response = await blogger.posts.insert({
      blogId: blogId.trim(),
      isDraft: false,
      requestBody: {
        title: title,
        content: content + seoDisclaimer,
      },
    });

    console.log(`Successfully published to Blogger (${blogId}): ${response.data.url}`);
    return response.data.url;
  } catch (error) {
    console.error(`Error posting to Blogger (blogId: ${blogId}):`, error.response?.data?.error?.message || error.message);
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

module.exports = {
  publishToMultipleBloggers,
};
