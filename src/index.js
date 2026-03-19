const cron = require('node-cron');
const { generateArticle } = require('./services/openai');
const { fetchStockImage } = require('./services/image');
const { uploadMedia, createPost } = require('./services/wordpress');
const { getNextPendingTopic, markAsPublished } = require('./services/google-sheets');
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

    // 3. Fetch image from Pexels
    let featuredMediaId = null;
    if (article.imageSearchTerm) {
      console.log(`Fetching stock image for: "${article.imageSearchTerm}"...`);
      const imageUrl = await fetchStockImage(article.imageSearchTerm);
      
      if (imageUrl) {
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
  console.log(`[Cron Job triggered at ${new Date().toISOString()}]`);
  runAutoPoster();
});

// For testing purposes: Option to run once immediately if an argument is passed
if (process.argv.includes('--now')) {
  console.log('Manual trigger detected. Running once now...');
  runAutoPoster();
}
