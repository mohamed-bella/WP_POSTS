const fs = require('fs').promises;
const path = require('path');

const TOPICS_FILE = path.join(__dirname, '../../topics.json');

/**
 * Gets all topics from the JSON file.
 */
async function getTopics() {
  try {
    const data = await fs.readFile(TOPICS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading topics file:', error);
    return [];
  }
}

/**
 * Saves all topics to the JSON file.
 */
async function saveTopics(topics) {
  try {
    await fs.writeFile(TOPICS_FILE, JSON.stringify(topics, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving topics file:', error);
  }
}

/**
 * Gets the next pending topic.
 */
async function getNextPendingTopic() {
  const topics = await getTopics();
  return topics.find(t => t.status === 'pending') || null;
}

/**
 * Marks a topic as published.
 */
async function markAsPublished(id, url) {
  const topics = await getTopics();
  const index = topics.findIndex(t => t.id === id);
  if (index !== -1) {
    topics[index].status = 'published';
    topics[index].publishedUrl = url;
    topics[index].publishedAt = new Date().toISOString();
    await saveTopics(topics);
  }
}

module.exports = {
  getNextPendingTopic,
  markAsPublished,
};
