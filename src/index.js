const cron = require('node-cron');
const { generateWordPressArticle, generateBloggerArticle } = require('./services/openai');
const { fetchStockImage, fetchUnsplashImage } = require('./services/image');
const { uploadMedia, createPost } = require('./services/wordpress');
const { getNextPendingTopic, markAsPublished } = require('./services/google-sheets');
const { createPin } = require('./services/pinterest');
const { publishToMultipleBloggers } = require('./services/blogger');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const settingsPath = path.join(__dirname, '../settings.json');

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
 * Main function to run the auto-posting workflow.
 */
async function runAutoPoster() {
  console.log('--- Starting WordPress Auto-Poster Workflow ---');
  const startTime = new Date();

  try {
    // Read workflow settings
    let settings = { workflows: { wordpress: true, pinterest: false, blogger: true } };
    try {
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch (err) {
      console.warn('Failed to read settings.json. Using defaults.');
    }

    // 1. Get the next pending topic from Google Sheets
    const topicData = await getNextPendingTopic();
    if (!topicData) {
      console.log('No pending topics found in Google Sheets. Workflow cancelled.');
      return;
    }

    const { _row, topic, keywords, internalLinks } = topicData;
    console.log(`Topic selected: "${topic}"`);
    const focusKeyword = keywords.length > 0 ? keywords[0] : topic;

    // ─────────────────────────────────────────────────────────
    // 2. Generate the WordPress article (full SEO + FAQ schema)
    // ─────────────────────────────────────────────────────────
    console.log('Generating WordPress SEO article with OpenAI...');
    const wpArticle = await generateWordPressArticle(topic, keywords, internalLinks);
    console.log(`WP Article generated: "${wpArticle.title}"`);

    // Resolve Unsplash image placeholders inside WP article
    wpArticle.content = await resolveImagePlaceholders(wpArticle.content);

    // Build structured alt text: "{keyword} Morocco {descriptor}"
    const altDescriptor = wpArticle.altDescriptor || wpArticle.imageSearchTerm || 'travel scene';
    const structuredAltText = `${focusKeyword} Morocco ${altDescriptor}`;

    // ─────────────────────────────────────────────────────────
    // 3. Fetch featured image from Pexels (hero image for both WP and Pinterest)
    // ─────────────────────────────────────────────────────────
    let featuredMediaId = null;
    let featuredImageUrl = null;

    if (settings.workflows.wordpress || settings.workflows.pinterest) {
      if (wpArticle.imageSearchTerm) {
        console.log(`Fetching stock image for: "${wpArticle.imageSearchTerm}"...`);
        const imageUrl = await fetchStockImage(wpArticle.imageSearchTerm);

        if (imageUrl) {
          featuredImageUrl = imageUrl;

          if (settings.workflows.wordpress) {
            console.log(`Image found. Uploading to WordPress...`);
            featuredMediaId = await uploadMedia(
              imageUrl,
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
    // 4. Publish to WordPress
    // ─────────────────────────────────────────────────────────
    let wpPostLink = '';

    if (settings.workflows.wordpress) {
      console.log('Publishing story to WordPress...');
      const post = await createPost({
        title:          wpArticle.title,
        subtitle:       wpArticle.subtitle,
        authorName:     wpArticle.authorName,
        readingTime:    wpArticle.readingTime,
        content:        wpArticle.content,
        faqSchema:      wpArticle.faqSchema,
        featuredMediaId,
        metaDescription: wpArticle.metaDescription,
        focusKeyword,
        slug:           wpArticle.slug,
      });

      wpPostLink = post.link;
      console.log(`Post published successfully! URL: ${wpPostLink}`);

      // 5. Update Google Sheets
      console.log('Updating Google Sheet...');
      await markAsPublished(_row, wpPostLink);
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

          console.log(`Generating unique Blogger article version ${blogIndex} for blog ${blogId}...`);
          const bloggerArticle = await generateBloggerArticle(topic, keywords, blogIndex);

          // Resolve Unsplash placeholders in this version too
          let bloggerContent = await resolveImagePlaceholders(bloggerArticle.content);

          // Add canonical backlink to WP if available
          if (wpPostLink) {
            bloggerContent += `
              <hr/>
              <p>Read the full original article here: <a href="${wpPostLink}">${wpPostLink}</a></p>
            `;
          }

          await publishToMultipleBloggers([blogId], bloggerArticle.title, bloggerContent);
        }
      }
    } else {
      console.log('Skipping Blogger publishing (disabled in settings.json).');
    }

  } catch (error) {
    console.error('Workflow failed:', error.message);
    console.error(error.stack);
  }

  const endTime = new Date();
  const duration = (endTime - startTime) / 1000;
  console.log(`--- Workflow Finished in ${duration}s ---`);
}

// Schedule the daily task
const schedule = process.env.CRON_SCHEDULE || '0 9 * * *';
console.log(`Scheduling auto-poster with cron: "${schedule}"`);

cron.schedule(schedule, () => {
  console.log(`[Cron Job triggered at ${new Date().toLocaleString('en-MA', { timeZone: 'Africa/Casablanca' })}]`);
  runAutoPoster();
}, {
  scheduled: true,
  timezone: 'Africa/Casablanca',
});

// Manual trigger
if (process.argv.includes('--now')) {
  console.log('Manual trigger detected. Running once now...');
  runAutoPoster();
}
