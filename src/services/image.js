const axios = require('axios');
require('dotenv').config();

const PEXELS_API_URL = 'https://api.pexels.com/v1/search';

/**
 * Fetches a relevant stock photo from Pexels.
 * @param {string} query The search query for the image.
 * @returns {Promise<string|null>} The URL of the image, or null if not found.
 */
async function fetchStockImage(query) {
  if (!process.env.PEXELS_API_KEY) {
    console.warn('PEXELS_API_KEY is missing. Skipping image fetch.');
    return null;
  }

  try {
    const response = await axios.get(PEXELS_API_URL, {
      params: {
        query: query,
        per_page: 1,
        orientation: 'landscape',
      },
      headers: {
        Authorization: process.env.PEXELS_API_KEY,
      },
    });

    if (response.data.photos && response.data.photos.length > 0) {
      // Use the 'large' or 'original' size depending on preference
      return response.data.photos[0].src.large;
    }

    return null;
  } catch (error) {
    console.error('Error fetching image from Pexels:', error.message);
    return null;
  }
}

module.exports = {
  fetchStockImage,
};
