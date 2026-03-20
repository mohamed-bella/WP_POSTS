const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const WP_URL = process.env.WP_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_PASSWORD = process.env.WP_APPLICATION_PASSWORD;

// Basic Auth for WP REST API
function getAuth() {
  if (!WP_URL || !WP_USERNAME || !WP_PASSWORD) {
    throw new Error('Missing WordPress credentials: WP_URL, WP_USERNAME, or WP_APPLICATION_PASSWORD not set in .env');
  }
  return Buffer.from(`${WP_USERNAME}:${WP_PASSWORD}`).toString('base64');
}

/**
 * Uploads an image to WordPress media library.
 * @param {string} imageUrl  URL of the image to download.
 * @param {string} fileName  Filename to store in WP.
 * @param {string} altText   SEO-optimised alt text (format: "{keyword} Morocco {descriptor}").
 * @param {string} imageTitle The title to set for the media item.
 * @returns {Promise<number|null>} The media attachment ID, or null on failure.
 */
async function uploadMedia(imageUrl, fileName, altText, imageTitle) {
  try {
    const auth = getAuth();
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(imageResponse.data, 'binary');

    const form = new FormData();
    form.append('file', buffer, { filename: fileName, contentType: 'image/jpeg' });
    form.append('alt_text', altText);
    form.append('title', imageTitle || fileName);

    const response = await axios.post(`${WP_URL}/wp-json/wp/v2/media`, form, {
      headers: { ...form.getHeaders(), Authorization: `Basic ${auth}` },
    });

    const mediaId = response.data.id;
    console.log(`Media uploaded. ID: ${mediaId}, Alt: "${altText}", Title: "${imageTitle}"`);
    return mediaId;
  } catch (error) {
    console.error('Error uploading media:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Creates a new "mte_story" post in WordPress.
 * Fills all ACF fields, Rank Math SEO meta, and injects FAQ JSON-LD schema.
 *
 * @param {Object} storyData
 * @returns {Promise<Object>} The created WP post object.
 */
async function createPost({
  title,
  subtitle,
  authorName,
  readingTime,
  content,
  faqSchema,       // FAQPage JSON-LD object from OpenAI
  featuredMediaId,
  metaDescription,
  focusKeyword,
  slug,
}) {
  const auth = getAuth();

  const heroImageId = featuredMediaId ? parseInt(featuredMediaId, 10) : null;

  // Build the FAQ JSON-LD script block and append to the content
  let contentWithFaq = content;
  if (faqSchema) {
    try {
      const faqJson = typeof faqSchema === 'string' ? faqSchema : JSON.stringify(faqSchema, null, 2);
      contentWithFaq += `\n<script type="application/ld+json">\n${faqJson}\n</script>`;
    } catch (e) {
      console.warn('Could not serialize faqSchema:', e.message);
    }
  }

  const postContent = `<div class="mte-content-zone"><div class="mte-story-body">${contentWithFaq}</div></div>`;

  const payload = {
    title,
    content: postContent,
    status: 'publish',
    slug,
    featured_media: heroImageId,

    // ACF fields
    acf: {
      subtitle:       subtitle      || '',
      author_name:    authorName    || 'Hamid El Maimouni',
      reading_time:   readingTime   || '',
      hero_image:     heroImageId,
      story_content:  contentWithFaq,
    },

    // SEO meta
    meta: {
      'rank_math_focus_keyword':   focusKeyword    || '',
      'rank_math_description':     metaDescription || '',
      'rank_math_title':           title,
      '_yoast_wpseo_metadesc':     metaDescription || '',
      '_yoast_wpseo_focuskw':      focusKeyword    || '',
    },
  };

  try {
    const response = await axios.post(
      `${WP_URL}/wp-json/wp/v2/mte_story`,
      payload,
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } },
    );

    return response.data;
  } catch (error) {
    console.error('Error creating story:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  uploadMedia,
  createPost,
};
