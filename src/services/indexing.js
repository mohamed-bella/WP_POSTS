const axios = require('axios');
const { google } = require('googleapis');
require('dotenv').config();

// ──────────────────────────────────────────────────────
// 1. GOOGLE INDEXING API  (WordPress URL only)
//    Requires a Service Account with "Owner" access on
//    Google Search Console for the WP property.
// ──────────────────────────────────────────────────────
async function pingGoogleIndexingAPI(url) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.warn('[IndexingAPI] GOOGLE_SERVICE_ACCOUNT_JSON missing. Skipping.');
    return;
  }

  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const jwt = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      ['https://www.googleapis.com/auth/indexing']
    );

    const accessToken = await jwt.getAccessToken();

    await axios.post(
      'https://indexing.googleapis.com/v3/urlNotifications:publish',
      { url, type: 'URL_UPDATED' },
      { headers: { Authorization: `Bearer ${accessToken.token}`, 'Content-Type': 'application/json' } }
    );

    console.log(`[IndexingAPI] ✅ Pinged Google Indexing API: ${url}`);
  } catch (error) {
    console.error('[IndexingAPI] ❌ Failed:', error.response?.data?.error?.message || error.message);
  }
}

// ──────────────────────────────────────────────────────
// 2. INDEXNOW  (all published URLs — WP + Bloggers)
//    Supports Bing, Yandex, and other IndexNow partners.
//    Set INDEXNOW_KEY in .env and place the key file on
//    your site: https://moroccotravelexperts.com/{key}.txt
// ──────────────────────────────────────────────────────
async function pingIndexNow(urls) {
  const key = process.env.INDEXNOW_KEY;
  const host = 'moroccotravelexperts.com';

  if (!key) {
    console.warn('[IndexNow] INDEXNOW_KEY missing. Skipping.');
    return;
  }

  const validUrls = urls.filter(u => u && u.startsWith('http'));
  if (validUrls.length === 0) {
    console.warn('[IndexNow] No valid URLs to submit.');
    return;
  }

  try {
    await axios.post('https://api.indexnow.org/indexnow', {
      host,
      key,
      keyLocation: `https://${host}/${key}.txt`,
      urlList: validUrls,
    }, {
      headers: { 'Content-Type': 'application/json' },
    });

    console.log(`[IndexNow] ✅ Submitted ${validUrls.length} URL(s) to IndexNow:`);
    validUrls.forEach(u => console.log(`   → ${u}`));
  } catch (error) {
    const msg = error.response?.status
      ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error.message;
    console.error('[IndexNow] ❌ Failed:', msg);
  }
}

// ──────────────────────────────────────────────────────
// 3. SITEMAP PING  (Google + Bing)
// ──────────────────────────────────────────────────────
async function pingSitemaps() {
  const sitemapUrl = encodeURIComponent(
    process.env.WP_SITEMAP_URL || 'https://moroccotravelexperts.com/sitemap.xml'
  );

  const endpoints = [
    `https://www.google.com/ping?sitemap=${sitemapUrl}`,
    `https://www.bing.com/ping?sitemap=${sitemapUrl}`,
  ];

  for (const endpoint of endpoints) {
    try {
      await axios.get(endpoint, { timeout: 10000 });
      console.log(`[Sitemap] ✅ Pinged: ${endpoint}`);
    } catch (error) {
      // Google/Bing sometimes return non-200 but still process the ping
      console.warn(`[Sitemap] ⚠️  ${endpoint} — ${error.response?.status || error.message}`);
    }
  }
}

// ──────────────────────────────────────────────────────
// Combined: run all three in order
// ──────────────────────────────────────────────────────
async function runIndexingPipeline(wpUrl, allUrls) {
  console.log('\n--- Running SEO Indexing Pipeline ---');

  // 1. Google Indexing API — WordPress only
  if (wpUrl) {
    await pingGoogleIndexingAPI(wpUrl);
  }

  // 2. IndexNow — all URLs
  if (allUrls && allUrls.length > 0) {
    await pingIndexNow(allUrls);
  }

  // 3. Sitemap ping
  await pingSitemaps();

  console.log('--- Indexing Pipeline Complete ---\n');
}

module.exports = {
  runIndexingPipeline,
};
