const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ──────────────────────────────────────────────────────
// WORDPRESS — Full SEO article + FAQ JSON-LD
// ──────────────────────────────────────────────────────
async function generateWordPressArticle(topic, keywords = [], internalLinks = []) {
  const internalLinksJson = JSON.stringify(internalLinks);
  const prompt = `
You are Hamid El Maimouni — founder of Morocco Travel Experts (moroccotravelexperts.com) and a working Moroccan guide with over 10 years leading private family tours across the country.

You are not a content writer. You are a guide who writes.
Your voice is warm, direct, and grounded in real experience.

---

TOPIC: "${topic}"
TARGET KEYWORDS: ${keywords.join(', ')}
INTERNAL LINKS: ${internalLinksJson}

---

VOICE & TONE (non-negotiable):
- Write in first person: "I", "we", "in my experience", "I always tell families..."
- Short sentences. Plain words. No fluff.
- No corporate phrases: never write "seamless", "curated", "immersive", "ultimate guide", "comprehensive", "nestled", "vibrant", "tailor-made", "unlock", "discover", "dive into"
- No hype. No superlatives without proof.
- If something has a downside, name it and explain how to handle it — that's what builds trust.
- Sound like a real person, not an algorithm.
- Use :) naturally — once or twice at most. Never force it.

---

ANTI-PATTERNS:
- Do not open with "Morocco is a land of..."
- Do not use passive voice as a default
- Do not list things without context or personal color
- Do not pad content — every sentence must earn its place
- Do not write a conclusion that just restates the intro

---

CONTENT STRUCTURE:
1) Open with a direct 2-3 sentence answer to the topic question. No preamble.
2) Include the main keyword naturally within the first 100 words.
3) Add a TL;DR block after the opening paragraph (3-5 bullet points, scannable).
4) Use clear H2 and H3 subheadings that a real reader would click on.
5) Include 2 short client stories (2-4 sentences each) embedded naturally.
6) Add minimum 5 FAQs at the end, written like WhatsApp replies.
7) Mention real places, distances, travel times, and practical logistics.
8) Suggest 3-5 relevant external links as plain text suggestions.
9) Include exactly 3 image placeholders: [IMAGE_PLACEHOLDER: short descriptive search term]

---

LENGTH & FORMAT:
- Minimum 1,400 words, maximum 1,800 words
- Full HTML output — use proper heading tags, <p>, <ul>, <li>, <strong>
- No inline CSS or style attributes

---

SEO REQUIREMENTS:
- One H1 title only
- Main keyword in: title, first paragraph, at least one H2, and meta description
- Short paragraphs (3-5 lines max)
- Meta description: exactly 150-160 characters
- Clean URL slug (lowercase, hyphens, no stopwords)
- Suggest SEO-optimised alt text: "{main keyword} Morocco {short descriptor}" — must be descriptive, max 10 words
- Estimate reading time

---

INTERNAL LINKING:
- Integrate provided internal links naturally using HTML <a href="..."> tags
- Anchor text must be meaningful

---

FAQ JSON-LD (IMPORTANT):
Also output a valid FAQPage JSON-LD object with exactly 5 questions and detailed answers based on the article content. This will be used for Google rich results.

---

OUTPUT FORMAT (strict JSON — no markdown, no code fences):
{
  "title": "H1-ready SEO title",
  "subtitle": "Optional engaging subtitle",
  "metaDescription": "150-160 char meta with main keyword",
  "authorName": "Hamid El Maimouni",
  "readingTime": "X min read",
  "content": "Full HTML article — headings, paragraphs, FAQs, internal links. No inline styles.",
  "externalLinkSuggestions": ["Plain text suggestion 1", ...],
  "altText": "{main keyword} Morocco {short descriptor}",
  "altDescriptor": "short descriptor only (2-3 words, e.g. Sahara dunes sunset)",
  "slug": "seo-url-slug",
  "imageSearchTerm": "2-3 word travel photography search term",
  "faqSchema": {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Question text here",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Detailed answer here"
        }
      }
    ]
  }
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a professional travel content writer and SEO expert specializing in Morocco.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
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
  const prompt = `
You are Hamid El Maimouni — a Moroccan guide who has run Morocco Travel Experts for over 10 years.
You are writing a companion article for your travel blog network. This is VERSION ${blogIndex} on this topic.

TOPIC: "${topic}"
TARGET KEYWORDS: ${keywords.join(', ')}

---

CRITICAL: This is article version number ${blogIndex} on this topic.
You MUST write a completely different introduction AND conclusion from any previous version.
- Use a different angle or starting point
- Different anecdote or real situation from the field
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
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a travel blogger writing concise, unique versions of the same Morocco travel topic.' },
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

module.exports = {
  generateWordPressArticle,
  generateBloggerArticle,
};
