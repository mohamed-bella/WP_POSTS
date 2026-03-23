const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

// Read at call time so dashboard config changes take effect
function getAuth() {
  const wpUrl = process.env.WP_URL;
  const wpUser = process.env.WP_USERNAME;
  const wpPass = process.env.WP_APPLICATION_PASSWORD;
  if (!wpUrl || !wpUser || !wpPass) {
    throw new Error('Missing WordPress credentials: WP_URL, WP_USERNAME, or WP_APPLICATION_PASSWORD not set in .env');
  }
  return Buffer.from(`${wpUser}:${wpPass}`).toString('base64');
}

function getWpUrl() {
  return process.env.WP_URL;
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

    const response = await axios.post(`${getWpUrl()}/wp-json/wp/v2/media`, form, {
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

  // Handle Multiple JSON-LD Schemas (FAQ and Review)
  let schemaHtml = '';
  if (faqSchema) {
    try {
      // If it's the new nested object format
      if (faqSchema.faq) {
        schemaHtml += `\n<script type="application/ld+json">\n${JSON.stringify(faqSchema.faq, null, 2)}\n</script>\n`;
      } else if (Array.isArray(faqSchema)) {
         // Old format compatibility: convert array of {question, answer} to FAQPage schema
         const oldFaq = {
           "@context": "https://schema.org",
           "@type": "FAQPage",
           "mainEntity": faqSchema.map(item => ({
             "@type": "Question",
             "name": item.question,
             "acceptedAnswer": { "@type": "Answer", "text": item.answer }
           }))
         };
         schemaHtml += `\n<script type="application/ld+json">\n${JSON.stringify(oldFaq, null, 2)}\n</script>\n`;
      }
  
      if (faqSchema.review) {
        schemaHtml += `\n<script type="application/ld+json">\n${JSON.stringify(faqSchema.review, null, 2)}\n</script>\n`;
      }
    } catch (e) {
      console.warn('Could not serialize faqSchema:', e.message);
    }
  }

  const finalContent = `${content}\n${schemaHtml}`;

  const postContent = `<div class="mte-content-zone"><div class="mte-story-body">${finalContent}</div></div>`;

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
      story_content:  finalContent,
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
      `${getWpUrl()}/wp-json/wp/v2/mte_story`,
      payload,
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } },
    );

    return response.data;
  } catch (error) {
    console.error('Error creating story:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetches all published mte_story posts (id, title, link, slug, content).
 * Handles pagination automatically.
 */
async function getAllPosts() {
  const auth = getAuth();
  let allPosts = [];
  let page = 1;
  const perPage = 100; // max allowed byWP API

  try {
    while (true) {
      console.log(`[WP] Fetching stories page ${page}...`);
      const response = await axios.get(
        `${getWpUrl()}/wp-json/wp/v2/mte_story?status=publish&per_page=${perPage}&page=${page}&_fields=id,title,link,slug`,
        { headers: { Authorization: `Basic ${auth}` } }
      );
      
      const posts = response.data;
      if (!posts || posts.length === 0) break;
      allPosts = allPosts.concat(posts);
      
      const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
      if (page >= totalPages) break;
      page++;
    }
    console.log(`[WP] Retrieved ${allPosts.length} published stories.`);
    return allPosts;
  } catch (error) {
    if (error.response?.data?.code === 'rest_post_invalid_page_number') {
      return allPosts; // Reached end
    }
    console.error('[WP] Error fetching all posts:', error.response?.data || error.message);
    return allPosts;
  }
}

/**
 * Updates an existing WP post (PATCH).
 */
async function updatePost(postId, payload) {
  const auth = getAuth();
  try {
    const response = await axios.post(
      `${getWpUrl()}/wp-json/wp/v2/mte_story/${postId}`,
      payload,
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } }
    );
    return response.data;
  } catch (error) {
    console.error(`[WP] Error updating post ${postId}:`, error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  uploadMedia,
  createPost,
  getAllPosts,
  updatePost,
};
