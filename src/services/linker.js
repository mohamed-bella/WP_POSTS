const { getAllPosts } = require('./wordpress');
const { getStrategy } = require('./db');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const LINK_INDEX_FILE = path.join(__dirname, '../../data/link-index.json');

// Factory: re-creates client if API key changes at runtime
let _openaiClient = null;
let _lastApiKey = null;

function getOpenAIClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!_openaiClient || key !== _lastApiKey) {
    _openaiClient = new OpenAI({ apiKey: key });
    _lastApiKey = key;
  }
  return _openaiClient;
}

/**
 * Fetches all existing posts and uses AI to find the top 3 most relevant internal links for a new topic.
 * @param {string} newTopic The topic of the article being generated.
 * @returns {Promise<Array<{title: string, url: string}>>}
 */
async function getRelevantInternalLinks(newTopic) {
  console.log(`[Linker] Finding relevant internal links for: "${newTopic}"...`);
  
  try {
    const strategy = await getStrategy();
    const allPosts = await getAllPosts();
    if (!allPosts || allPosts.length === 0) {
      console.log('[Linker] No existing posts found to link to.');
      return [];
    }

    const corpus = allPosts.map(p => ({
      title: p.title.rendered,
      url: p.link
    }));

    let priorityLinks = [];

    // 1. STRATEGY CHECK: Is this new topic part of a cluster?
    // (We match by title similarity for simplicity in this flow)
    const clusterMatch = strategy.clusters.find(c => 
      newTopic.toLowerCase().includes(c.title.toLowerCase()) || 
      c.title.toLowerCase().includes(newTopic.toLowerCase())
    );

    if (clusterMatch) {
      console.log(`[Linker] Topic identified as cluster for pillar: ${clusterMatch.pillarUrl}`);
      priorityLinks.push({ title: "Main Guide", url: clusterMatch.pillarUrl });
    }

    // 2. STRATEGY CHECK: Is this a pillar topic?
    const pillarMatch = strategy.pillars.find(p => 
      newTopic.toLowerCase().includes(p.title.toLowerCase()) ||
      p.title.toLowerCase().includes(newTopic.toLowerCase())
    );

    if (pillarMatch) {
      console.log(`[Linker] Topic identified as Pillar. Adding its cluster spokes...`);
      const spokes = strategy.clusters
        .filter(c => c.pillarUrl === pillarMatch.url)
        .map(c => ({ title: c.title, url: c.url }));
      priorityLinks.push(...spokes);
    }

    // 3. AI SEMANTIC SEARCH (for the remaining slots)
    const remainingCount = 3 - priorityLinks.length;
    let finalLinks = [...priorityLinks];

    if (remainingCount > 0) {
      const prompt = `
You are an SEO expert. New topic: "${newTopic}"
Select the top ${remainingCount} most relevant articles from the list below. 
Return only a JSON array of objects with "title" and "url".

EXISTING ARTICLES:
${JSON.stringify(corpus.slice(0, 100))}

RETURN FORMAT:
[{"title": "...", "url": "..."}]
`;

      const response = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });

      const recommendation = JSON.parse(response.choices[0].message.content);
      const aiLinks = Array.isArray(recommendation) ? recommendation : (recommendation.links || []);
      finalLinks.push(...aiLinks);
    }

    console.log(`[Linker] Final internal links: ${finalLinks.length}`);
    return finalLinks.slice(0, 3);

  } catch (error) {
    console.error('[Linker] Error finding relevant links:', error.message);
    return [];
  }
}

/**
 * Finds relevant links for a given keyword (compatibility for old index.js calls).
 */
async function findRelevantLinks(keyword, count = 3) {
  return getRelevantInternalLinks(keyword);
}

/**
 * Uses AI to naturally inject internal links into the HTML content.
 * @param {string} content HTML content of the article.
 * @param {Array<{title: string, url: string}>} links Array of links to inject.
 * @returns {Promise<string>} The HTML with injected links.
 */
async function injectLinks(content, links = []) {
  if (!links || links.length === 0) return content;
  
  console.log(`[Linker] Injecting ${links.length} links into content...`);

  const prompt = `
You are an SEO editor. I will provide an HTML article and a list of internal links.
Your task: Naturally insert these links into the article as <a> tags across the text where they fit best.
- Select relevant anchor text (2-4 words).
- Distribute them evenly.
- Do not change any other HTML (headers, style, etc.).
- Return only the full updated HTML.

LINKS TO INJECT:
${JSON.stringify(links)}

ARTICLE HTML:
${content}
`;

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'You are an SEO editor that inserts internal links into HTML without breaking styling.' }, { role: 'user', content: prompt }]
    });

    let updatedHtml = response.choices[0].message.content;
    // Clean up markdown code blocks if AI included them
    updatedHtml = updatedHtml.replace(/^```html/, '').replace(/```$/, '').trim();
    
    return updatedHtml;
  } catch (error) {
    console.error('[Linker] Error injecting links:', error.message);
    return content;
  }
}

/**
 * Uses AI to scan all existing posts and suggest Pillar/Cluster organizations.
 */
async function suggestClusterLinking() {
  console.log('[Linker] Analyzing site content for Pillar/Cluster suggestions...');
  try {
    const allPosts = await getAllPosts();
    if (!allPosts || allPosts.length === 0) return { suggestions: [] };

    const prompt = `
You are an SEO Strategist. Analyze these article titles and group them into "Pillar & Cluster" structures.
Identify "Pillar" articles (broad, authoritative hubs) and their "Cluster" articles (specific, supporting spokes).

ARTICLES:
${allPosts.map(p => `- ${p.title.rendered} (${p.link})`).join('\n')}

RETURN FORMAT (JSON):
{
  "suggestions": [
    {
      "pillar": {"title": "Main Guide", "url": "..."},
      "clusters": [{"title": "Sub Article", "url": "..."}, ...]
    }
  ]
}
`;

    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o', // Use a smarter model for strategic grouping
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('[Linker] Suggestion error:', error.message);
    return { suggestions: [] };
  }
}

/**
 * Load the saved link index from disk.
 */
function loadIndex() {
  try {
    if (fs.existsSync(LINK_INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(LINK_INDEX_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[Linker] Could not read link index:', e.message);
  }
  return { posts: [], builtAt: null };
}

/**
 * Fetches all WP posts and saves a link index to disk.
 */
async function buildLinkIndex() {
  console.log('[Linker] Building link index from WordPress...');
  const allPosts = await getAllPosts();
  const index = {
    builtAt: new Date().toISOString(),
    posts: allPosts.map(p => ({
      id: p.id,
      title: p.title?.rendered || '',
      url: p.link,
      slug: p.slug,
    }))
  };
  const dataDir = path.dirname(LINK_INDEX_FILE);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(LINK_INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(`[Linker] Index built: ${index.posts.length} posts saved.`);
  return index;
}

/**
 * Scans existing posts for internal linking opportunities.
 */
/**
 * Scans existing posts for internal linking opportunities using AI semantic matching.
 */
async function scanExistingPosts() {
  console.log('[Linker] Performing Smart AI scan for linking opportunities...');
  const index = loadIndex();
  if (!index.posts || index.posts.length === 0) {
    return { message: 'No index found. Build the link index first.', opportunities: [] };
  }

  try {
    const prompt = `
You are an SEO Internal Linking Strategist. I have a list of blog post titles and URLs.
Your task: For each post, identify the top 3 most relevant "Related Posts" from the same list that it should link to for optimal SEO juice and user navigation.
Group them effectively into Pillar/Cluster flows where possible.

ARTICLES:
${index.posts.map(p => `- ${p.title} (${p.url})`).join('\n')}

RETURN FORMAT (JSON):
{
  "opportunities": [
    {
      "post": {"title": "...", "url": "..."},
      "related": [{"title": "...", "url": "..."}, ...]
    }
  ]
}
`;

    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'You are an SEO internal linking expert. Identify deep semantic connections between travel articles.' }, { role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content);
    return { total: (result.opportunities || []).length, opportunities: (result.opportunities || []) };
  } catch (error) {
    console.error('[Linker] Smart scan failed:', error.message);
    // Fallback to simple matching if AI fails
    console.log('[Linker] Falling back to manual keyword matching...');
    const opportunities = index.posts.map(post => {
      const related = index.posts
        .filter(other => other.id !== post.id)
        .filter(other => {
          const wordsA = post.title.toLowerCase().split(/\s+/).filter(w => w.length > 5);
          return wordsA.some(w => other.title.toLowerCase().includes(w));
        })
        .slice(0, 3);
      return { post: { title: post.title, url: post.url }, related };
    }).filter(o => o.related.length > 0);

    return { total: opportunities.length, opportunities };
  }
}

module.exports = { getRelevantInternalLinks, findRelevantLinks, injectLinks, suggestClusterLinking, loadIndex, buildLinkIndex, scanExistingPosts };

