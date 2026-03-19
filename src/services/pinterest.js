const axios = require('axios');
require('dotenv').config();

/**
 * Creates a Pin on Pinterest.
 * @param {string} title The title of the pin (max 100 chars).
 * @param {string} description The description of the pin (max 500 chars).
 * @param {string} link The link to the published article.
 * @param {string} imageUrl The URL of the image to feature on the pin.
 * @returns {Promise<string|null>} The ID of the created Pin, or null on failure.
 */
async function createPin({ title, description, link, imageUrl }) {
  const accessToken = process.env.PINTEREST_ACCESS_TOKEN;
  const boardId = process.env.PINTEREST_BOARD_ID;
  const environment = process.env.PINTEREST_ENVIRONMENT || 'sandbox'; // Default to sandbox because of trial access

  const PINTEREST_API_URL = environment === 'production' 
    ? 'https://api.pinterest.com/v5/pins' 
    : 'https://api-sandbox.pinterest.com/v5/pins';

  if (!accessToken || !boardId) {
    console.warn('PINTEREST_ACCESS_TOKEN or PINTEREST_BOARD_ID is missing. Skipping Pinterest publish.');
    return null;
  }

  if (!imageUrl) {
    console.warn('No image URL provided. Pinterest requires an image. Skipping Pinterest publish.');
    return null;
  }

  // Enforce Pinterest API limits
  const safeTitle = title.length > 100 ? title.substring(0, 97) + '...' : title;
  const safeDescription = description.length > 500 ? description.substring(0, 497) + '...' : description;

  const payload = {
    title: safeTitle,
    description: safeDescription,
    link: link,
    board_id: boardId,
    media_source: {
      source_type: 'image_url',
      url: imageUrl,
    },
  };

  try {
    const response = await axios.post(PINTEREST_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`Pin created successfully! Pin ID: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('Error creating Pin on Pinterest:', errorMsg);
    if (error.response?.data) {
      console.error('Pinterest API details:', error.response.data);
    }
    return null;
  }
}

module.exports = {
  createPin,
};
