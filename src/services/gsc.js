const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { logAction } = require('./db');
require('dotenv').config();

const GSC_DATA_FILE = path.join(__dirname, '../../data/gsc.json');

// GSC uses 'sc-domain:example.com' for domain properties, or 'https://example.com/' for URL-prefix properties.
// Most modern setups use domain properties. If GSC_SITE_URL isn't explicitly set in .env, we default to sc-domain.
let GSC_SITE_URL = process.env.GSC_SITE_URL;
if (!GSC_SITE_URL) {
  const wpUrl = process.env.WP_URL || 'https://moroccotravelexperts.com';
  const domain = wpUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  GSC_SITE_URL = `sc-domain:${domain}`;
}

/**
 * Create an authenticated Search Console client using the existing service account
 */
function getSearchConsoleClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set in .env');
  }

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });

  return google.searchconsole({ version: 'v1', auth });
}

/**
 * Helper: format date as YYYY-MM-DD
 */
function fmtDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Helper: get date N days ago
 */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ══════════════════════════════════════════
//  CORE DATA FETCHING
// ══════════════════════════════════════════

/**
 * Fetch search analytics data from GSC
 * @param {object} options
 * @param {string} options.startDate - YYYY-MM-DD
 * @param {string} options.endDate - YYYY-MM-DD
 * @param {string[]} options.dimensions - ['query'], ['page'], ['query','page'], etc.
 * @param {number} options.rowLimit - max rows (default 100)
 * @param {string} options.type - 'web', 'image', 'video' (default 'web')
 * @returns {Promise<Array>} rows with keys, clicks, impressions, ctr, position
 */
async function fetchSearchAnalytics({
  startDate,
  endDate,
  dimensions = ['query'],
  rowLimit = 100,
  type = 'web',
  dimensionFilterGroups = [],
} = {}) {
  const client = getSearchConsoleClient();

  const start = startDate || fmtDate(daysAgo(28));
  const end = endDate || fmtDate(daysAgo(3)); // GSC data has ~3 day lag

  try {
    const response = await client.searchanalytics.query({
      siteUrl: GSC_SITE_URL,
      requestBody: {
        startDate: start,
        endDate: end,
        dimensions,
        rowLimit,
        type,
        dimensionFilterGroups: dimensionFilterGroups.length > 0 ? dimensionFilterGroups : undefined,
      },
    });

    const rows = (response.data.rows || []).map(row => ({
      keys: row.keys,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: Math.round(row.ctr * 10000) / 100, // Convert to percentage (e.g. 3.45%)
      position: Math.round(row.position * 10) / 10,
    }));

    return rows;
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    console.error('[GSC] ❌ Failed to fetch search analytics:', msg);
    throw error;
  }
}

// ══════════════════════════════════════════
//  HIGH-LEVEL FUNCTIONS
// ══════════════════════════════════════════

/**
 * Get top queries sorted by clicks (last 28 days)
 */
async function getTopQueries(limit = 50) {
  console.log('[GSC] Fetching top queries...');
  const rows = await fetchSearchAnalytics({
    dimensions: ['query'],
    rowLimit: limit,
  });
  return rows.map(r => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

/**
 * Get top pages sorted by clicks (last 28 days)
 */
async function getTopPages(limit = 30) {
  console.log('[GSC] Fetching top pages...');
  const rows = await fetchSearchAnalytics({
    dimensions: ['page'],
    rowLimit: limit,
  });
  return rows.map(r => ({
    page: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

/**
 * Get "almost ranking" opportunities — queries at positions 8-20 with decent impressions.
 * These are goldmine topics: write better content to push them to page 1.
 */
async function getOpportunities(limit = 30) {
  console.log('[GSC] Finding ranking opportunities (pos 8-20)...');
  const rows = await fetchSearchAnalytics({
    dimensions: ['query'],
    rowLimit: 200, // Fetch more to filter
  });

  // Filter: position 8-20 and at least 10 impressions
  const opportunities = rows
    .filter(r => r.position >= 8 && r.position <= 20 && r.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
    .map(r => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      potential: Math.round(r.impressions * 0.3), // Estimated clicks if moved to top 3
    }));

  return opportunities;
}

/**
 * Get query data for a specific page
 */
async function getQueriesForPage(pageUrl, limit = 20) {
  console.log(`[GSC] Fetching queries for page: ${pageUrl}`);
  const rows = await fetchSearchAnalytics({
    dimensions: ['query'],
    rowLimit: limit,
    dimensionFilterGroups: [{
      filters: [{
        dimension: 'page',
        operator: 'equals',
        expression: pageUrl,
      }],
    }],
  });
  return rows.map(r => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

/**
 * Compare performance between two date ranges to find declining content
 * @param {number} recentDays - recent period (default 14 days)
 * @param {number} previousDays - comparison period offset (default 28 days ago to 14 days ago)
 */
async function findDecliningPages(recentDays = 14, previousDays = 28) {
  console.log('[GSC] Comparing recent vs previous performance...');

  const recentRows = await fetchSearchAnalytics({
    startDate: fmtDate(daysAgo(recentDays + 3)),
    endDate: fmtDate(daysAgo(3)),
    dimensions: ['page'],
    rowLimit: 200,
  });

  const previousRows = await fetchSearchAnalytics({
    startDate: fmtDate(daysAgo(previousDays + 3)),
    endDate: fmtDate(daysAgo(recentDays + 3)),
    dimensions: ['page'],
    rowLimit: 200,
  });

  // Build lookup for previous period
  const previousMap = {};
  for (const row of previousRows) {
    previousMap[row.keys[0]] = row;
  }

  // Find pages with significant decline
  const declining = [];
  for (const row of recentRows) {
    const url = row.keys[0];
    const prev = previousMap[url];
    if (prev && prev.clicks > 5) {
      const clickChange = ((row.clicks - prev.clicks) / prev.clicks) * 100;
      if (clickChange < -30) { // More than 30% drop
        declining.push({
          page: url,
          recentClicks: row.clicks,
          previousClicks: prev.clicks,
          changePct: Math.round(clickChange),
          recentPosition: row.position,
          previousPosition: prev.position,
        });
      }
    }
  }

  return declining.sort((a, b) => a.changePct - b.changePct); // Most declined first
}

/**
 * Inspects a URL using the GSC Index Inspection API to see if it's indexed and why.
 */
async function inspectUrlIndexStatus(url) {
  const client = getSearchConsoleClient();
  try {
    const res = await client.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: url,
        siteUrl: GSC_SITE_URL,
        languageCode: 'en-US' // for string responses from Google
      }
    });

    const result = res.data.inspectionResult;
    // indexStatusResult.coverageState = "Indexed", "Crawled - currently not indexed", "Discovered - currently not indexed", etc.
    const coverage = result.indexStatusResult?.coverageState || 'Unknown';
    const isIndexed = coverage.toLowerCase().includes('indexed');
    const lastCrawl = result.indexStatusResult?.lastCrawlTime || null;

    return {
      url,
      isIndexed,
      coverageState: coverage,
      lastCrawlTime: lastCrawl,
      raw: result
    };
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    console.error(`[GSC] ❌ Index inspection failed for ${url}:`, msg);
    return { url, isIndexed: false, coverageState: 'API Error: ' + msg, lastCrawlTime: null };
  }
}

// ══════════════════════════════════════════
//  SNAPSHOT STORAGE
// ══════════════════════════════════════════

/**
 * Pull a full daily snapshot and store it in data/gsc.json
 */
async function pullDailySnapshot() {
  console.log('[GSC] 📊 Pulling daily snapshot...');

  try {
    const [queries, pages, opportunities] = await Promise.all([
      getTopQueries(50),
      getTopPages(30),
      getOpportunities(20),
    ]);

    const snapshot = {
      date: fmtDate(new Date()),
      pulledAt: new Date().toISOString(),
      queries,
      pages,
      opportunities,
    };

    // Load existing data
    let data = { snapshots: [] };
    try {
      if (fs.existsSync(GSC_DATA_FILE)) {
        data = JSON.parse(fs.readFileSync(GSC_DATA_FILE, 'utf8'));
      }
    } catch (e) {}

    // Add new snapshot, keep last 90 days
    data.snapshots.unshift(snapshot);
    if (data.snapshots.length > 90) {
      data.snapshots = data.snapshots.slice(0, 90);
    }

    // Ensure data directory exists
    const dataDir = path.dirname(GSC_DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(GSC_DATA_FILE, JSON.stringify(data, null, 2));

    console.log(`[GSC] ✅ Snapshot saved: ${queries.length} queries, ${pages.length} pages, ${opportunities.length} opportunities`);
    logAction('gsc_snapshot', 'success', {
      queries: queries.length,
      pages: pages.length,
      opportunities: opportunities.length,
    });

    return snapshot;
  } catch (error) {
    console.error('[GSC] ❌ Daily snapshot failed:', error.message);
    logAction('gsc_snapshot', 'error', { error: error.message });
    throw error;
  }
}

/**
 * Get the latest stored snapshot (no API call)
 */
function getLatestSnapshot() {
  try {
    if (fs.existsSync(GSC_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(GSC_DATA_FILE, 'utf8'));
      return data.snapshots?.[0] || null;
    }
  } catch (e) {}
  return null;
}

/**
 * Get all stored snapshots (for trends)
 */
function getAllSnapshots() {
  try {
    if (fs.existsSync(GSC_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(GSC_DATA_FILE, 'utf8'));
      return data.snapshots || [];
    }
  } catch (e) {}
  return [];
}

module.exports = {
  fetchSearchAnalytics,
  getTopQueries,
  getTopPages,
  getOpportunities,
  getQueriesForPage,
  findDecliningPages,
  pullDailySnapshot,
  getLatestSnapshot,
  getAllSnapshots,
  inspectUrlIndexStatus,
};
