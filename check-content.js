const axios = require('axios');
require('dotenv').config();

async function checkLatestPost() {
  const WP_URL = process.env.WP_URL;
  const auth = Buffer.from(`${process.env.WP_USERNAME}:${process.env.WP_APPLICATION_PASSWORD}`).toString('base64');

  try {
    const response = await axios.get(`${WP_URL}/wp-json/wp/v2/mte_story?per_page=1`, {
      headers: { Authorization: `Basic ${auth}` }
    });

    if (response.data.length === 0) {
      console.log('No posts found.');
      return;
    }

    const post = response.data[0];
    console.log('--- LATEST POST ---');
    console.log('Title:', post.title.rendered);
    console.log('Date:', post.date);
    console.log('--- CONTENT START ---');
    console.log(post.content.rendered);
    console.log('--- CONTENT END ---');

    // Check for placeholders
    const placeholders = [
        '[YOUTUBE_PLACEHOLDER]',
        '[MAP_PLACEHOLDER]',
        '[GALLERY_PLACEHOLDER]',
        '[IMAGE_PLACEHOLDER]'
    ];

    placeholders.forEach(p => {
        if (post.content.rendered.includes(p)) {
            console.log(`[!] FOUND UNRESOLVED PLACEHOLDER: ${p}`);
        }
    });

    if (post.content.rendered.includes('iframe')) {
        console.log('[+] Found iframes (Maps/YouTube)');
    } else {
        console.log('[!] NO IFRAMES FOUND');
    }

    if (post.content.rendered.includes('wp-block-gallery')) {
        console.log('[+] Found Gallery');
    } else {
        console.log('[!] NO GALLERY FOUND');
    }

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkLatestPost();
