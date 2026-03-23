const { OpenAI } = require('openai');
require('dotenv').config();

// Factory function: picks up API key changes at runtime
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

// ──────────────────────────────────────────────────────
// WORDPRESS — Full SEO article + FAQ JSON-LD
// ──────────────────────────────────────────────────────
async function generateWordPressArticle(topic, keywords = [], internalLinks = [], externalLinks = []) {
  const author = process.env.DEFAULT_AUTHOR || 'Hamid El Maimouni';
  const company = process.env.COMPANY_NAME || 'Morocco Travel Experts';
  const url = process.env.COMPANY_URL || 'moroccotravelexperts.com';
  const niche = process.env.TARGET_NICHE || 'Travel';
  const location = process.env.TARGET_LOCATION || 'Morocco';
  const ctaNum = process.env.CTA_WHATSAPP || '+212 7 21 65 35 72';

  const internalLinksJson = JSON.stringify(internalLinks);
  const externalLinksJson = JSON.stringify(externalLinks);

  const prompt = `
You are ${author} — ${company} (${url}).
This article must be the ULTIMATE "Premium Master Resource Hub"—an insanely comprehensive, richly styled, and aggressively long article (9,000+ words). You are building a wikipedia-level pillar page designed to outrank every single competitor on Google.

TOPIC: "${topic}"
TARGET KEYWORDS: ${keywords.join(', ')}
INTERNAL LINKS (USE THESE): ${internalLinksJson}
CUSTOM EXTERNAL LINKS (MANDATORY TO USE THESE): ${externalLinksJson}

---

STYLING & DESIGN (Premium Inline CSS):
- **Tables**: Use '<table style="width:100%; border-collapse: collapse; margin: 20px 0; background: #fafafa; border-radius: 12px; overflow: hidden;">' with styled 'th' and 'td'.
- **FAQ Block**: Wrap FAQs in a styled div with a light-blue or sand-colored background to make them "pop".
- **Itineraries/Guides**: Use ul with 'style="list-style:none; padding-left:0;"' and 'li' with a styled border/padding to look like a timeline.
- **CTA Section**: Insert exactly ONE "Contact Us" block at a random, natural location in the content. Use a styled div with a call-to-action like "Ready for your private ${location} ${niche} experience? Marhaba! WhatsApp me at ${ctaNum}".

---

VOICE & TONE:
- First-person ("I", "my team"). Warm, professional, and honest.
- Native ${location} flavor (Ahlan, local secrets).

---

SEO & STRUCTURE:
1. **ULTRA-LONG FORM (9,000+ WORDS MAXIMIZED)**: 
   - DO NOT hold back. Write 9,000+ words. Break the topic down into exhaustive granular detail.
   - Include complete histories, multi-day itineraries (e.g. 3-day, 7-day, 10-day variations), deep cultural nuances, seasonal packing lists, cost breakdowns, and local secrets.
   - Every single H2 should have at least 6 paragraphs and multiple H3s. Expand on every single thought.
2. **LINKING**: 
   - **Internal**: Naturally link to the articles provided in the INTERNAL LINKS section.
   - **Custom External**: You MUST naturally embed every URL provided in the CUSTOM EXTERNAL LINKS section using highly relevant, contextual anchor text. Never dump them as a raw list.
   - **General External**: Feel free to include 1-2 other high-authority external links (like Wikipedia or official tourism boards) if it aids the reader.
3. **HEAVY MULTIMEDIA INTEGRATION (NO HTML WRAPPING)**:
   - You MUST include at least 4 YouTube videos, 3 Maps, and 5 Images spread throughout the content. 
   - Placeholders to use organically between paragraphs:
      [YOUTUBE_PLACEHOLDER: detailed search query]
      [MAP_PLACEHOLDER: detailed location name]
      [IMAGE_PLACEHOLDER: descriptive image query]
      [GALLERY_PLACEHOLDER: detailed gallery theme]
4. **FEATURED ELEMENTS**:
   - 3-paragraph direct answer opening (TL;DR).
   - "Local Guide Pro-Tips" in <blockquote> with inline styling.
   - A gigantic "Ultimate FAQ" section with 15+ detailed questions and robust 2-paragraph answers.
   - **Advanced Schema**: Generate a second JSON-LD block for a 'Review'. The 'itemReviewed' MUST be of '"@type": "CreativeWorkSeries"' to represent the article/guide itself. This avoids "Invalid object type" errors in Google Search Console.

---

OUTPUT FORMAT (strict JSON — no code fences):
{
  "title": "H1 SEO Master Title",
  "metaDescription": "150-160 chars",
  "content": "Full rich HTML with inline CSS and plain-text placeholders.",
  "slug": "url-slug",
  "faqSchema": { ... },
  "reviewSchema": { 
     "@context": "https://schema.org",
     "@type": "Review",
     "itemReviewed": { "@type": "CreativeWorkSeries", "name": "Article/Guide Title" },
     "reviewRating": { "@type": "Rating", "ratingValue": "4.9", "bestRating": "5" },
     "author": { "@type": "Person", "name": "${author}" },
     "reviewBody": "Deep expert assessment of this content..."
  },
  "imageSearchTerm": "Featured image query",
  "seoScore": 98,
  "keywordDensity": "2.4%"
}
`;

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `You are an elite SEO ${location} ${niche} copywriter capable of producing 10,000-word masterclass pillar content covering every granular detail.` },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 16000,
      temperature: 0.7
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error generating WordPress article with OpenAI:', error);
    throw error;
  }
}

// ──────────────────────────────────────────────────────
// BLOGGER — Shorter unique rewrite per blog site
// ──────────────────────────────────────────────────────
async function generateBloggerArticle(topic, keywords = [], blogIndex = 1) {
  const author = process.env.DEFAULT_AUTHOR || 'Hamid El Maimouni';
  const company = process.env.COMPANY_NAME || 'Morocco Travel Experts';
  const location = process.env.TARGET_LOCATION || 'Morocco';
  const niche = process.env.TARGET_NICHE || 'Travel';

  const prompt = `
You are ${author} — a ${location} guide who has run ${company} for over 10 years.
You are writing a companion article for your travel blog network. This is VERSION ${blogIndex} on this topic.

TOPIC: "${topic}"
TARGET KEYWORDS: ${keywords.join(', ')}

---

CRITICAL: This is article version number ${blogIndex} on this topic.
You MUST write a completely different introduction AND conclusion from any previous version.
- Use a different angle or starting point
- Different anecdote or real situation from the field in ${location}
- Different ending that leaves the reader with a different takeaway
- Same helpful information core, but different framing and voice

VOICE & TONE:
- First person: "I", "in my experience", "I always tell families..."
- Conversational and direct, like advice from a friend
- No corporate travel blog phrases
- Real, specific, practical

CONTENT STRUCTURE:
- UNIQUE opening paragraph (2-3 sentences) — must differ from the full article version
- 2-3 H2 sections with practical advice
- One short personal client anecdote (2-3 sentences)
- UNIQUE closing paragraph with a different takeaway angle

LENGTH: 600–800 words exactly.

FORMAT:
- Full HTML (headings, <p>, <ul>, <li>, <strong>)
- No inline CSS
- Include 1 image placeholder: [IMAGE_PLACEHOLDER: short Unsplash search term]

OUTPUT (strict JSON — no code fences):
{
  "title": "Engaging blog title for this version",
  "content": "Full HTML content (600-800 words)"
}
`;

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `You are a ${niche} blogger writing concise, unique versions of the same ${location} topic.` },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error(`Error generating Blogger article (version ${blogIndex}) with OpenAI:`, error);
    throw error;
  }
}

// ──────────────────────────────────────────────────────
// CONTENT REFRESH — Update declining content
// ──────────────────────────────────────────────────────
async function generateRefreshContent(title, existingContent) {
  const author = process.env.DEFAULT_AUTHOR || 'Hamid El Maimouni';
  const location = process.env.TARGET_LOCATION || 'Morocco';

  const prompt = `
You are ${author}, expert ${location} travel guide.
This existing article on "${title}" has been dropping in search rankings, meaning it's getting stale. 
You need to REFRESH it.

DO NOT completely rewrite the whole article from scratch. Instead, ENHANCE it:
1. Keep the core structure, but expand thin sections.
2. Add a new "2026 Update" or similar recent perspective paragraph.
3. Add 2 new highly specific subheadings with fresh practical advice.
4. Improve the FAQs (add 2 more new questions).
5. Ensure the tone remains personal, direct, and hype-free.

EXISTING HTML CONTENT:
${existingContent}

---

OUTPUT FORMAT (strict JSON — no code fences):
{
  "updatedContent": "The full, rich HTML string of the newly refreshed article. Include all your new sections seamlessly."
}
`;

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `You are an SEO content updater specializing in expanding and refreshing stale ${location} travel articles.` },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });
    return JSON.parse(response.choices[0].message.content).updatedContent;
  } catch (error) {
    console.error('Error generating refreshed content with OpenAI:', error);
    throw error;
  }
}

module.exports = {
  generateWordPressArticle,
  generateBloggerArticle,
  generateRefreshContent,
};
