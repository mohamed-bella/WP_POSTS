const cron = require('node-cron');
const { generateArticle } = require('./services/openai');
const { fetchStockImage, fetchUnsplashImage } = require('./services/image');
const { uploadMedia, createPost } = require('./services/wordpress');
const { getNextPendingTopic, markAsPublished } = require('./services/google-sheets');
const { createPin } = require('./services/pinterest');
const { publishToMultipleBloggers } = require('./services/blogger');
require('dotenv').config();

/**
 * Main function to run the auto-posting workflow.
 */
async function runAutoPoster() {
  console.log('--- Starting WordPress Auto-Poster Workflow (Google Sheets + SEO Expert) ---');
  const startTime = new Date();

  try {
    // 1. Get the next pending topic from Google Sheets
    const topicData = await getNextPendingTopic();

    if (!topicData) {
      console.log('No pending topics found in Google Sheets. Workflow cancelled.');
      return;
    }

    const { _row, topic, keywords, internalLinks } = topicData;
    console.log(`Topic selected: "${topic}"`);
    const focusKeyword = keywords.length > 0 ? keywords[0] : topic;

    // 2. Generate content with OpenAI (SEO Optimized)
    console.log('Generating SEO-optimized content with OpenAI...');
    const article = await generateArticle(topic, keywords, internalLinks);
    console.log(`Article generated: "${article.title}"`);

    // 2.5 Replace Unsplash image placeholders in the content
    const placeholderRegex = /\[IMAGE_PLACEHOLDER:\s*(.*?)\]/g;
    let match;
    while ((match = placeholderRegex.exec(article.content)) !== null) {
      const query = match[1];
      console.log(`Fetching Unsplash image for placeholder: "${query}"...`);
      const unsplashData = await fetchUnsplashImage(query);
      
      let imgHtml = '';
      if (unsplashData) {
        imgHtml = `
          <figure class="wp-block-image size-large">
            <img src="${unsplashData.url}" alt="${unsplashData.alt}">
            <figcaption>Photo by ${unsplashData.author} on Unsplash</figcaption>
          </figure>
        `;
      } else {
        console.warn(`Could not fetch Unsplash image for: "${query}"`);
      }
      
      // Replace only this exact match instance per iteration
      article.content = article.content.replace(match[0], imgHtml);
    }

    // 3. Fetch image from Pexels
    let featuredMediaId = null;
    let featuredImageUrl = null;
    if (article.imageSearchTerm) {
      console.log(`Fetching stock image for: "${article.imageSearchTerm}"...`);
      const imageUrl = await fetchStockImage(article.imageSearchTerm);
      
      if (imageUrl) {
        featuredImageUrl = imageUrl;
        console.log(`Image found: ${imageUrl}. Uploading to WordPress with alt text...`);
        featuredMediaId = await uploadMedia(
          imageUrl, 
          `${article.slug}.jpg`, 
          article.altText
        );
      } else {
        console.warn('No image found for search term.');
      }
    }

    // 4. Create post in WordPress with SEO metadata
    console.log('Publishing story to WordPress with SEO metadata...');
    const post = await createPost({
      title: article.title,
      subtitle: article.subtitle,
      authorName: article.authorName,
      readingTime: article.readingTime,
      content: article.content,
      featuredMediaId: featuredMediaId,
      metaDescription: article.metaDescription,
      focusKeyword: focusKeyword,             // <-- Rank Math focus keyword
      slug: article.slug,
    });

    console.log(`Post published successfully! URL: ${post.link}`);

    // 5. Update Google Sheets
    console.log(`Updating Google Sheet...`);
    await markAsPublished(_row, post.link);

    // 6. Share on Pinterest
    if (featuredImageUrl) {
      console.log('Sharing article on Pinterest...');
      await createPin({
        title: article.title,
        description: article.metaDescription, // Using meta description for Pinterest
        link: post.link,
        imageUrl: featuredImageUrl
      });
    } else {
      console.log('Skipping Pinterest share because no image is available.');
    }

    // 7. Publish to Blogger sites
    const bloggerIdsRaw = process.env.BLOGGER_IDS;
    if (bloggerIdsRaw) {
      const blogIds = bloggerIdsRaw.split(',').map(id => id.trim()).filter(id => id);
      if (blogIds.length > 0) {
        console.log(`Publishing article to ${blogIds.length} Blogger website(s)...`);
        
        // We include a link back to the original post on WP for Canonical SEO value
        const contentForBlogger = `
          ${article.content}
          <hr/>
          <p>Read the full original article here: <a href="${post.link}">${post.link}</a></p>
        `;
        
        await publishToMultipleBloggers(blogIds, article.title, contentForBlogger);
      }
    }
  } catch (error) {
    console.error('Workflow failed:', error.message);
  }

  const endTime = new Date();
  const duration = (endTime - startTime) / 1000;
  console.log(`--- Workflow Finished in ${duration}s ---`);
}

// 5. Schedule the daily task
const schedule = process.env.CRON_SCHEDULE || '0 9 * * *'; // Default to 9:00 AM daily
console.log(`Scheduling auto-poster with cron: "${schedule}"`);

cron.schedule(schedule, () => {
  console.log(`[Cron Job triggered at ${new Date().toLocaleString('en-MA', { timeZone: 'Africa/Casablanca' })}]`);
  runAutoPoster();
}, {
  scheduled: true,
  timezone: "Africa/Casablanca"
});

// For testing purposes: Option to run once immediately if an argument is passed
if (process.argv.includes('--now')) {
  console.log('Manual trigger detected. Running once now...');
  runAutoPoster();
}
