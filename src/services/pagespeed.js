const axios = require('axios');
const { readSettings } = require('./db');
require('dotenv').config();

/**
 * Fetch SEO and Performance scores from Google PageSpeed Insights
 * @param {string} url The live URL to audit
 */
async function runPageSpeedAudit(url, strategy = 'mobile') {
  if (!url) throw new Error('URL is required for PageSpeed audit');

  const apiKey = process.env.PAGESPEED_API_KEY || '';
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=SEO&category=PERFORMANCE&category=BEST_PRACTICES&category=ACCESSIBILITY&strategy=${strategy}${apiKey ? `&key=${apiKey}` : ''}`;

  console.log(`[PageSpeed] 🔍 Auditing: ${url}...`);
  
  try {
    const response = await axios.get(apiUrl);
    const { lighthouseResult } = response.data;
    const audits = lighthouseResult?.audits || {};
    
    const scores = {
      seo: Math.round((lighthouseResult?.categories?.seo?.score || 0) * 100),
      performance: Math.round((lighthouseResult?.categories?.performance?.score || 0) * 100),
      bestPractices: Math.round((lighthouseResult?.categories?.['best-practices']?.score || 0) * 100),
      accessibility: Math.round((lighthouseResult?.categories?.accessibility?.score || 0) * 100),
      metrics: {
        fcp: audits['first-contentful-paint']?.displayValue || 'N/A',
        lcp: audits['largest-contentful-paint']?.displayValue || 'N/A',
        cls: audits['cumulative-layout-shift']?.displayValue || 'N/A',
        speedIndex: audits['speed-index']?.displayValue || 'N/A',
        tbt: audits['total-blocking-time']?.displayValue || 'N/A'
      },
      timestamp: new Date().toISOString()
    };

    console.log(`[PageSpeed] ✅ Audit complete for ${url}: SEO=${scores.seo}, Perf=${scores.performance}`);
    return scores;
  } catch (error) {
    let msg = error.response?.data?.error?.message || error.message;
    if (msg.includes('Quota exceeded')) {
      msg = 'Google Quota Exceeded. Please add a PAGESPEED_API_KEY to your .env file to get 25,000 free audits/day.';
    }
    console.error(`[PageSpeed] ❌ Audit failed for ${url}:`, msg);
    throw new Error(msg);
  }
}

module.exports = { runPageSpeedAudit };
