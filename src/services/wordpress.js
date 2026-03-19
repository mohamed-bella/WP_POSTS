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
 * @param {string} altText   SEO-optimised alt text.
 * @returns {Promise<number|null>} The media attachment ID, or null on failure.
 */
async function uploadMedia(imageUrl, fileName, altText) {
  try {
    const auth = getAuth();
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(imageResponse.data, 'binary');

    const form = new FormData();
    form.append('file', buffer, { filename: fileName, contentType: 'image/jpeg' });
    form.append('alt_text', altText);

    const response = await axios.post(`${WP_URL}/wp-json/wp/v2/media`, form, {
      headers: { ...form.getHeaders(), Authorization: `Basic ${auth}` },
    });

    console.log(`Media uploaded. ID: ${response.data.id}, Alt: "${altText}"`);
    return response.data.id;
  } catch (error) {
    console.error('Error uploading media:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Creates a new "mte_story" post in WordPress.
 * Fills all ACF fields and Rank Math SEO meta.
 *
 * ACF field map:
 *  subtitle        => field_mte_story_subtitle  (text)
 *  author_name     => field_mte_author_name     (text)
 *  reading_time    => field_mte_reading_time    (text)
 *  hero_image      => field_mte_hero_image      (image – expects integer attachment ID)
 *  story_content   => field_mte_story_content   (wysiwyg – raw HTML)
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
  featuredMediaId,
  metaDescription,
  focusKeyword,   // Primary Rank Math focus keyword (first in the comma list)
  slug,
}) {
  const auth = getAuth();

  // hero_image ACF field uses return_format:'array', but when WRITING via REST
  // you pass just the integer attachment ID -- ACF handles the rest.
  const heroImageId = featuredMediaId ? parseInt(featuredMediaId, 10) : null;

  // story_content is a wysiwyg field; send the raw HTML without extra wrappers
  // so WP / ACF doesn't double-wrap it.
  const storyContentHtml = content;

  // The main post content area can include the wrapper div for front-end rendering.
  const postContent = `<div class="mte-content-zone"><div class="mte-story-body">${content}</div></div>`;

  const payload = {
    title,
    content: postContent,
    status: 'publish',
    slug,
    featured_media: heroImageId,

    // -----------------------------------------------------------
    // ACF fields — sent via the 'acf' key (requires ACF PRO + REST)
    // Each key must match the ACF field 'name' (not key/label).
    // -----------------------------------------------------------
    acf: {
      subtitle:       subtitle      || '',
      author_name:    authorName    || 'Hamid El Maimouni',
      reading_time:   readingTime   || '',
      hero_image:     heroImageId,          // integer ID for image fields
      story_content:  storyContentHtml,     // raw HTML for wysiwyg
    },

    // -----------------------------------------------------------
    // SEO Meta
    // Rank Math uses public meta keys (no leading underscore) exposed
    // via its own REST endpoint modifier. Yoast keys are also included
    // as a fallback.
    // -----------------------------------------------------------
    meta: {
      // Rank Math
      'rank_math_focus_keyword':   focusKeyword    || '',
      'rank_math_description':     metaDescription || '',
      'rank_math_title':           title,
      // Yoast (fallback)
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
