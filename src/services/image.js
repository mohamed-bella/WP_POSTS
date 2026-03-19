const axios = require('axios');
require('dotenv').config();

const PEXELS_API_URL = 'https://api.pexels.com/v1/search';
const UNSPLASH_API_URL = 'https://api.unsplash.com/search/photos';

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

/**
 * Fetches a relevant stock photo from Unsplash.
 * @param {string} query The search query for the image.
 * @returns {Promise<{url: string, author: string, alt: string}|null>} The URL of the image and metadata, or null if not found.
 */
async function fetchUnsplashImage(query) {
  if (!process.env.UNSPLASH_ACCESS_KEY) {
    console.warn('UNSPLASH_ACCESS_KEY is missing. Skipping Unsplash image fetch.');
    return null;
  }

  try {
    const response = await axios.get(UNSPLASH_API_URL, {
      params: {
        query: query,
        per_page: 1,
        orientation: 'landscape',
      },
      headers: {
        Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
      },
    });

    if (response.data.results && response.data.results.length > 0) {
      const img = response.data.results[0];
      return {
        url: img.urls.regular,
        author: img.user.name,
        alt: img.alt_description || query,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching image from Unsplash:', error.response?.data || error.message);
    return null;
  }
}

module.exports = {
  fetchStockImage,
  fetchUnsplashImage,
};
