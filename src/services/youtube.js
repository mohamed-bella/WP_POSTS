const axios = require('axios');

/**
 * Searches YouTube for a query and returns the first found video ID.
 * Uses a keyless scraping approach for simplicity and immediate use.
 * @param {string} query The search query.
 * @returns {Promise<string|null>} The first video's ID or null if not found.
 */
async function searchYouTubeVideo(query) {
  console.log(`[YouTube] Searching for: "${query}"...`);
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const html = response.data;
    
    // Look for /watch?v=VIDEO_ID in the HTML
    const videoIdMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
    
    if (videoIdMatch && videoIdMatch[1]) {
      const videoId = videoIdMatch[1];
      console.log(`[YouTube] Found video ID: ${videoId} for "${query}"`);
      return videoId;
    }

    console.log('[YouTube] No video ID found in search results.');
    return null;
  } catch (error) {
    console.error('[YouTube] Error searching video:', error.message);
    return null;
  }
}

module.exports = { searchYouTubeVideo };
