const { findDecliningPages } = require('./gsc');
const { getAllPosts, updatePost } = require('./wordpress');
const { generateRefreshContent } = require('./openai');
const { runIndexingPipeline } = require('./indexing');
const { logAction } = require('./db');
const { sendWhatsAppUpdate } = require('./whatsapp');
require('dotenv').config();

/**
 * End-to-end pipeline to find stale/declining articles and organically refresh them.
 * 
 * Flow:
 * 1. Find pages that dropped >30% in clicks over the past 14 days vs the 14 days prior.
 * 2. Match URLs to WP Posts.
 * 3. Use AI to expand, update, and improve the article body.
 * 4. Patch the WP Post.
 * 5. Re-index via IndexNow.
 */
async function runRefreshPipeline(maxRefreshes = 2) {
  console.log('--- Starting Content Refresh Pipeline ---');
  
  try {
    // 1. Find declining URLs from GSC
    const decliningPages = await findDecliningPages(14, 28);
    
    if (!decliningPages || decliningPages.length === 0) {
      console.log('[Refresher] No declining pages found. SEO is healthy! 🚀');
      return;
    }
    
    console.log(`[Refresher] Found ${decliningPages.length} pages needing a refresh.`);
    
    // 2. Map URLs to WP Posts
    const wpPosts = await getAllPosts();
    let refreshedCount = 0;
    
    for (const declining of decliningPages) {
      if (refreshedCount >= maxRefreshes) break; // Don't overwhelm APIs or WP
      
      const targetUrl = declining.page;
      
      // Try to find matching post by URL
      const post = wpPosts.find(p => p.link === targetUrl || targetUrl.includes(p.slug));
      
      if (!post) {
        console.warn(`[Refresher] Could not find WP post ID for URL: ${targetUrl}`);
        continue;
      }
      
      console.log(`[Refresher] 🔄 Refreshing post: "${post.title?.rendered}" (Traffic dropped ${declining.changePct}%)`);
      const existingContent = post.content?.rendered || '';
      
      // 3. Generate expanded content
      try {
        const newContent = await generateRefreshContent(post.title?.rendered, existingContent);
        
        // 4. Update WordPress
        await updatePost(post.id, { content: newContent });
        console.log(`[Refresher] ✅ Post updated successfully: ${targetUrl}`);
        
        logAction('seo_indexing', 'success', { 
          action: 'content_refresh', 
          url: targetUrl, 
          title: post.title?.rendered,
          dropPct: declining.changePct
        });
        
        if (process.env.WHATSAPP_NUMBER) {
          await sendWhatsAppUpdate(`🔄 *Content Refreshed!*\nI noticed traffic dropped ${declining.changePct}% for:\n_${post.title?.rendered}_\n\nI just rewrote and expanded the article to win back rankings!`);
        }
        
        // 5. Submit for re-indexing immediately
        await runIndexingPipeline(targetUrl, [targetUrl]);
        
        refreshedCount++;
        
      } catch (err) {
        console.error(`[Refresher] ❌ Failed to refresh ${targetUrl}:`, err.message);
        logAction('seo_indexing', 'error', { action: 'content_refresh', url: targetUrl, error: err.message });
      }
    }
    
    console.log(`--- Refresh Pipeline Complete. Refreshed ${refreshedCount} articles. ---`);
    
  } catch (error) {
    console.error('[Refresher] Pipeline failed:', error.message);
    logAction('seo_indexing', 'error', { action: 'content_refresh', error: error.message });
  }
}

module.exports = {
  runRefreshPipeline
};
