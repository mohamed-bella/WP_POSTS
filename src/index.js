const cron = require('node-cron');
const { generateWordPressArticle, generateBloggerArticle } = require('./services/openai');
const { fetchUnsplashImage } = require('./services/image');
const { uploadMedia, createPost } = require('./services/wordpress');
const { getNextPendingTopic, markAsPublished } = require('./services/google-sheets');
const { createPin } = require('./services/pinterest');
const { publishToMultipleBloggers } = require('./services/blogger');
const { injectLinks, findRelevantLinks, getRelevantInternalLinks } = require('./services/linker');
const { searchYouTubeVideo } = require('./services/youtube');
const { sendWhatsAppUpdate } = require('./services/whatsapp');
const { runIndexingPipeline } = require('./services/indexing');
const { logAction, readSettings } = require('./services/db');
const { postToSubreddits } = require('./services/reddit');
require('dotenv').config();

/**
 * Replaces [IMAGE_PLACEHOLDER: query] tags with real Unsplash image HTML.
 */
async function resolveImagePlaceholders(htmlContent) {
  const placeholderRegex = /\[IMAGE_PLACEHOLDER:\s*(.*?)\]/g;
  let result = htmlContent;
  let match;

  // Collect all matches first so regex index stays stable
  const matches = [];
  while ((match = placeholderRegex.exec(htmlContent)) !== null) {
    matches.push({ full: match[0], query: match[1] });
  }

  for (const { full, query } of matches) {
    console.log(`Fetching Unsplash image for placeholder: "${query}"...`);
    const unsplashData = await fetchUnsplashImage(query);

    const imgHtml = unsplashData
      ? `<figure class="wp-block-image size-large">
           <img src="${unsplashData.url}" alt="${unsplashData.alt}">
           <figcaption>Photo by ${unsplashData.author} on Unsplash</figcaption>
         </figure>`
      : '';

    result = result.replace(full, imgHtml);
  }

  return result;
}

/**
 * Replaces [YOUTUBE_PLACEHOLDER: query] tags with real YouTube embeds.
 */
async function resolveYoutubePlaceholders(htmlContent) {
  const regex = /\[YOUTUBE_PLACEHOLDER:\s*(.*?)\]/g;
  let result = htmlContent;
  let match;
  const matches = [];
  while ((match = regex.exec(htmlContent)) !== null) {
    matches.push({ full: match[0], query: match[1] });
  }

  for (const { full, query } of matches) {
    const videoId = await searchYouTubeVideo(query);
    if (videoId) {
      const embedHtml = `
      <div class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio my-8">
        <div class="wp-block-embed__wrapper">
          <iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="rounded-2xl shadow-lg border-4 border-white"></iframe>
        </div>
      </div>`;
      result = result.replace(full, embedHtml);
    } else {
      result = result.replace(full, ''); // Remove if no video found
    }
  }
  return result;
}

/**
 * Replaces [MAP_PLACEHOLDER: location] tags with Google Maps embeds.
 */
async function resolveMapPlaceholders(htmlContent) {
  const regex = /\[MAP_PLACEHOLDER:\s*(.*?)\]/g;
  let result = htmlContent;
  let match;
  const matches = [];
  while ((match = regex.exec(htmlContent)) !== null) {
    matches.push({ full: match[0], location: match[1] });
  }

  const targetLocation = process.env.TARGET_LOCATION || 'Morocco';
  for (const { full, location } of matches) {
    const encodedLocation = encodeURIComponent(location + ', ' + targetLocation);
    const mapHtml = `
      <div class="google-map-container my-8 rounded-2xl overflow-hidden border border-slate-200">
        <iframe width="100%" height="450" style="border:0" loading="lazy" allowfullscreen src="https://maps.google.com/maps?q=${encodedLocation}&t=&z=13&ie=UTF8&iwloc=&output=embed"></iframe>
      </div>`;
    result = result.replace(full, mapHtml);
  }
  return result;
}

/**
 * Replaces [GALLERY_PLACEHOLDER: theme] tags with a 3-image Unsplash gallery.
 */
async function resolveGalleryPlaceholders(htmlContent) {
  const regex = /\[GALLERY_PLACEHOLDER:\s*(.*?)\]/g;
  let result = htmlContent;
  let match;
  const matches = [];
  while ((match = regex.exec(htmlContent)) !== null) {
    matches.push({ full: match[0], query: match[1] });
  }

  for (const { full, query } of matches) {
    console.log(`Building gallery for: "${query}"...`);
    // Fetch 3 unique images
    const images = [];
    for (let i = 0; i < 3; i++) {
        const img = await fetchUnsplashImage(query + ' ' + (i + 1));
        if (img) images.push(img);
    }

    if (images.length > 0) {
      const galleryHtml = `
        <figure class="wp-block-gallery has-nested-images columns-3 is-cropped my-8">
          ${images.map(img => `
            <figure class="wp-block-image size-large">
              <img src="${img.url}" alt="${img.alt}" class="rounded-xl shadow-sm">
            </figure>
          `).join('')}
          <figcaption class="text-center italic text-sm text-slate-500 mt-2">Gallery: ${query}</figcaption>
        </figure>`;
      result = result.replace(full, galleryHtml);
    } else {
      result = result.replace(full, '');
    }
  }
  return result;
}

/**
 * Helper to update both Google Sheets Status and fire a WhatsApp notification 
 */
async function updateStatus(row, msg) {
  console.log(`[Progress] ${msg}`);
  await sendWhatsAppUpdate(`⏳ *Progress:* ${msg}`);
  if (row) {
    try {
      row.set('Status', msg);
      await row.save();
    } catch (e) {
      console.error('Failed to update row status', e.message);
    }
  }
}

/**
 * Main function to run the auto-posting workflow.
 */
async function runAutoPoster() {
  console.log('--- Starting WordPress Auto-Poster Workflow ---');
  const startTime = new Date();
  const publishedUrls = []; // Collect all published URLs for IndexNow

  try {
    // Read workflow settings from Supabase
    const settings = await readSettings();

    // 1. Get the next pending topic from Google Sheets
    const topicData = await getNextPendingTopic();
    if (!topicData) {
      console.log('No pending topics found in Google Sheets. Workflow cancelled.');
      return;
    }

    // getNextPendingTopic already returns keywords as an array
    const { _row, topic: targetTopic, keywords, internalLinks: manualInternalLinks } = topicData;
    console.log(`Topic selected: "${targetTopic}"`);
    const focusKeyword = keywords.length > 0 ? keywords[0] : targetTopic;

    await updateStatus(_row, `Found topic: "${targetTopic}". Assembling links...`);

    // 2. NEW Feature: Get Smart Internal Links
    const autoLinks = await getRelevantInternalLinks(targetTopic);
    const combinedLinks = [
      ...manualInternalLinks.map(url => ({ url, context: "Provided manually" })),
      ...autoLinks.map(l => ({ url: l.url, context: l.title }))
    ];

    // 3. Generate WordPress Article with Smart Links
    await updateStatus(_row, `Calling OpenAI to generate 9000-word masterclass...`);
    
    let externalDynamicLinks = [];
    if (settings.linking && settings.linking.customTargets) {
      const allTargets = settings.linking.customTargets.split('\n').map(l => l.trim()).filter(l => l);
      // Shuffle and pick 3-5 random high-authority targets to keep it natural
      externalDynamicLinks = allTargets
        .sort(() => 0.5 - Math.random())
        .slice(0, Math.min(5, allTargets.length));
      console.log(`[Linker] Selected ${externalDynamicLinks.length} dynamic targets for this post.`);
    }
    const wpArticle = await generateWordPressArticle(targetTopic, keywords, combinedLinks, externalDynamicLinks);
    
    await updateStatus(_row, `OpenAI generation complete. Title: "${wpArticle.title}"`);

    // Resolve all multimedia placeholders inside WP article
    wpArticle.content = await resolveImagePlaceholders(wpArticle.content);
    wpArticle.content = await resolveYoutubePlaceholders(wpArticle.content);
    wpArticle.content = await resolveMapPlaceholders(wpArticle.content);
    wpArticle.content = await resolveGalleryPlaceholders(wpArticle.content);

    // Build structured alt text: "{keyword} {location} {descriptor}"
    const targetLocation = process.env.TARGET_LOCATION || 'Morocco';
    const altDescriptor = wpArticle.altDescriptor || wpArticle.imageSearchTerm || 'travel scene';
    const structuredAltText = `${focusKeyword} ${targetLocation} ${altDescriptor}`;

    // ─────────────────────────────────────────────────────────
    // 4. Fetch featured image from Unsplash (hero image for both WP and Pinterest)
    // ─────────────────────────────────────────────────────────
    let featuredMediaId = null;
    let featuredImageUrl = null;

    if (settings.workflows.wordpress || settings.workflows.pinterest) {
      if (wpArticle.imageSearchTerm) {
        console.log(`Fetching Unsplash image for: "${wpArticle.imageSearchTerm}"...`);
        const unsplashData = await fetchUnsplashImage(wpArticle.imageSearchTerm);

        if (unsplashData && unsplashData.url) {
          featuredImageUrl = unsplashData.url;

          if (settings.workflows.wordpress) {
            console.log(`Image found. Uploading to WordPress...`);
            featuredMediaId = await uploadMedia(
              unsplashData.url,
              `${wpArticle.slug}.jpg`,
              structuredAltText,
              wpArticle.title // Image title = article title
            );
          }
        } else {
          console.warn('No featured image found.');
        }
      }
    }

    // ─────────────────────────────────────────────────────────
    // 5. Publish to WordPress
    // ─────────────────────────────────────────────────────────
    let wpPostLink = '';

    if (settings.workflows.wordpress) {
      await updateStatus(_row, `Publishing article to WordPress...`);
      
      // Inject internal links before publishing
      console.log('Running Internal Linking Engine...');
      const linksForInjection = combinedLinks.map(l => ({ title: l.context, url: l.url }));
      const linkedContent = await injectLinks(wpArticle.content, linksForInjection);

      // 5. Create the WordPress Post (passing double Schema)

      const createdPost = await createPost({
        title: wpArticle.title,
        subtitle: wpArticle.subtitle || '',
        authorName: wpArticle.authorName || (process.env.DEFAULT_AUTHOR || 'Hamid El Maimouni'),
        readingTime: wpArticle.readingTime || '',
        content: linkedContent,
        faqSchema: {
           faq: wpArticle.faqSchema,
           review: wpArticle.reviewSchema
        },
        featuredMediaId: featuredMediaId,
        metaDescription: wpArticle.metaDescription,
        focusKeyword: focusKeyword,
        slug: wpArticle.slug,
      });

      wpPostLink = createdPost.link;
      publishedUrls.push(wpPostLink);
      await updateStatus(_row, `Successfully live on WordPress: ${wpPostLink}`);
      
      // 5. Update Google Sheets final stats
      await markAsPublished(_row, wpPostLink, {
        seoScore: wpArticle.seoScore,
        keywordDensity: wpArticle.keywordDensity
      });
    } else {
      console.log('Skipping WordPress publishing (disabled in settings.json).');
    }

    // ─────────────────────────────────────────────────────────
    // 6. Share on Pinterest
    // ─────────────────────────────────────────────────────────
    if (settings.workflows.pinterest) {
      if (featuredImageUrl && wpPostLink) {
        console.log('Sharing on Pinterest...');
        await createPin({
          title:       wpArticle.title,
          description: wpArticle.metaDescription,
          link:        wpPostLink,
          imageUrl:    featuredImageUrl,
        });
      } else {
        console.log('Skipping Pinterest: no image or WP link available.');
      }
    } else {
      console.log('Skipping Pinterest (disabled in settings.json).');
    }

    // ─────────────────────────────────────────────────────────
    // 7. Publish unique rewritten versions to each Blogger site
    // ─────────────────────────────────────────────────────────
    if (settings.workflows.blogger) {
      const bloggerIdsRaw = process.env.BLOGGER_IDS;
      if (bloggerIdsRaw) {
        const blogIds = bloggerIdsRaw.split(',').map(id => id.trim()).filter(id => id);

        for (let i = 0; i < blogIds.length; i++) {
          const blogId = blogIds[i];
          const blogIndex = i + 1;

          await updateStatus(_row, `Generating unique snippet for Blogger site ${blogIndex}...`);
          const bloggerArticle = await generateBloggerArticle(targetTopic, keywords, blogIndex);

          // Resolve Unsplash placeholders in this version too
          let bloggerContent = await resolveImagePlaceholders(bloggerArticle.content);

          // Add canonical backlink to WP if available
          if (wpPostLink) {
            bloggerContent += `
              <hr/>
              <p>Read the full original article here: <a href="${wpPostLink}">${wpPostLink}</a></p>
            `;
          }

          await updateStatus(_row, `Publishing to Blogger site ${blogIndex}...`);
          const blogUrls = await publishToMultipleBloggers([blogId], bloggerArticle.title, bloggerContent);
          publishedUrls.push(...blogUrls);
        }
      }
    } else {
      console.log('Skipping Blogger publishing (disabled in settings.json).');
    }

    // ─────────────────────────────────────────────────────────
    // 8. Share on Reddit Communities
    // ─────────────────────────────────────────────────────────
    if (settings.workflows.reddit && wpPostLink) {
      const subreddits = (settings.workflows.reddit_subreddits || 'Morocco')
        .split('\n')
        .map(s => s.trim())
        .filter(s => s);
      
      await updateStatus(_row, `Sharing to ${subreddits.length} Reddit communities...`);
      await postToSubreddits(wpArticle.title, wpPostLink, subreddits);
    } else {
      console.log('Skipping Reddit (disabled or no WP link).');
    }

    // ─────────────────────────────────────────────────────────
    // 9. Share on LinkedIn
    // ─────────────────────────────────────────────────────────
    if (settings.workflows.linkedin && wpPostLink) {
      const { postToLinkedIn } = require('./services/linkedin');
      await updateStatus(_row, `Sharing on LinkedIn...`);
      await postToLinkedIn(wpArticle.title, wpPostLink);
    } else {
      console.log('Skipping LinkedIn (disabled or no WP link).');
    }

    // ─────────────────────────────────────────────────────────
    // 9.5. Share on Tumblr
    // ─────────────────────────────────────────────────────────
    if (settings.workflows.tumblr && wpPostLink) {
      const { postToTumblr } = require('./services/tumblr');
      await updateStatus(_row, `Sharing on Tumblr...`);
      await postToTumblr(wpArticle.title, wpArticle.metaDescription || `Read our latest article on ${targetTopic} right now.`, keywords.join(', '), wpPostLink);
    } else {
      console.log('Skipping Tumblr (disabled or no WP link).');
    }

    // ─────────────────────────────────────────────────────────
    // 9.6. Share on Twitter / X
    // ─────────────────────────────────────────────────────────
    if (settings.workflows.twitter && wpPostLink) {
      const { postToTwitter } = require('./services/twitter');
      await updateStatus(_row, `Sharing on Twitter/X...`);
      // Keeping it within 280 characters + hashtags
      const hashtags = keywords.slice(0,3).map(k => '#' + k.replace(/\s+/g,'')).join(' ');
      const tweetText = `${wpArticle.title}\n\n${wpArticle.metaDescription || ''}\n\n${hashtags}`;
      await postToTwitter(tweetText, wpPostLink);
    } else {
      console.log('Skipping Twitter (disabled or no WP link).');
    }

    // ─────────────────────────────────────────────────────────
    // 10. SEO Indexing Pipeline
    // ─────────────────────────────────────────────────────────
    await updateStatus(_row, `Pushing URLs to Google/Bing Indexing APIs...`);
    await runIndexingPipeline(wpPostLink, publishedUrls);

  } catch (error) {
    console.error('Workflow failed:', error.message);
    console.error(error.stack);
    logAction('wordpress_post', 'error', { error: error.message });
    await sendWhatsAppUpdate(`❌ *Workflow Error:* ${error.message}`);
  }

  const endTime = new Date();
  const duration = (endTime - startTime) / 1000;
  await sendWhatsAppUpdate(`✅ *Workflow Fully Completed in ${Math.round(duration)} seconds!*`);
  console.log(`--- Workflow Finished in ${duration}s ---`);
  return publishedUrls;
}


// ─── Dynamic scheduler ─────────────────────────────────────────
// Reads schedule settings at startup and reschedules every 24h.
// Changes made in the dashboard take effect the next cycle.

const activeCronJobs = [];

async function buildCronJobs() {
  // Cancel any existing jobs
  activeCronJobs.forEach(j => j.stop());
  activeCronJobs.length = 0;

  let sched = { postsPerDay: 1, postHour: 9, postMinute: 0 };
  try {
    const s = await readSettings();
    if (s.schedule) sched = { ...sched, ...s.schedule };
  } catch (e) {}

  const count   = Math.max(1, Math.min(10, parseInt(sched.postsPerDay) || 1));
  const hour    = Math.max(0, Math.min(23, parseInt(sched.postHour)    || 9));
  const minute  = Math.max(0, Math.min(59, parseInt(sched.postMinute)  || 0));

  // Spread runs evenly across the day from postHour up to hour 22
  const gap = Math.floor((22 - hour) / count);

  for (let i = 0; i < count; i++) {
    const runHour   = Math.min(22, hour + i * gap);
    const runMinute = minute;
    const expression = `${runMinute} ${runHour} * * *`;

    console.log(`[Scheduler] Job ${i + 1}/${count}: cron "${expression}" (${process.env.DEFAULT_TIME_ZONE || 'Africa/Casablanca'})`);

    const job = cron.schedule(expression, () => {
      console.log(`[Cron Job ${i + 1}/${count} triggered at ${new Date().toLocaleString('en-MA', { timeZone: process.env.DEFAULT_TIME_ZONE || 'Africa/Casablanca' })}]`);
      runAutoPoster();
    }, {
      scheduled: true,
      timezone: process.env.DEFAULT_TIME_ZONE || 'Africa/Casablanca',
    });

    activeCronJobs.push(job);
  }

  console.log(`[Scheduler] ${count} post(s)/day scheduled starting at ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);
}

// Only start cron when run directly (not when imported by engage.js)
function startContentScheduler() {
  buildCronJobs();
  // Rebuild schedule every 24h so dashboard changes take effect
  setInterval(buildCronJobs, 24 * 60 * 60 * 1000);
}

// Manual trigger
if (require.main === module) {
  if (process.argv.includes('--now')) {
    console.log('Manual trigger detected. Running once now...');
    runAutoPoster();
  } else {
    startContentScheduler();
  }
}

module.exports = { runAutoPoster, startContentScheduler };
