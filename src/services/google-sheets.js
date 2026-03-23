const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { sendWhatsAppUpdate } = require('./whatsapp');
require('dotenv').config();

// ─── Shared Auth Helper (Fix #15: avoid creating new JWT on every call) ──────
let _cachedDoc = null;
let _cachedSheetId = null;

async function getSheet() {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  // Re-create if sheet ID changed or first call
  if (!_cachedDoc || _cachedSheetId !== sheetId) {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const jwt = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    _cachedDoc = new GoogleSpreadsheet(sheetId, jwt);
    _cachedSheetId = sheetId;
    await _cachedDoc.loadInfo();
  }
  return _cachedDoc.sheetsByIndex[0];
}

/**
 * Fetches all rows from the Google Sheet.
 */
async function getAllRows() {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    
    return rows.map(row => ({
      index: row.rowNumber,
      topic: row.get('Topic') || '',
      keywords: row.get('Keywords') || '',
      internalLinks: row.get('Internal Links') || '',
      status: row.get('Status') || '',
      publishedUrl: row.get('Published URL') || '',
      publishedDate: row.get('Published Date') || '',
      seoScore: row.get('SEO Score') || '',
      keywordDensity: row.get('KW Density') || '',
    }));
  } catch (error) {
    console.error('Error fetching all rows:', error);
    throw error;
  }
}

/**
 * Adds a new row to the Google Sheet.
 */
async function addRow(data) {
  try {
    const sheet = await getSheet();
    await sheet.addRow({
      'Topic': data.topic,
      'Keywords': data.keywords || '',
      'Internal Links': data.internalLinks || '[]',
      'Status': data.status || 'pending',
      'Published URL': '',
      'Published Date': '',
      'SEO Score': '',
      'KW Density': ''
    });
    const topicText = typeof data.topic === 'string' ? data.topic.substring(0, 50) : 'Row';
    await sendWhatsAppUpdate(`📊 *Sheet Updated:* New draft created.\n📌 Topic: "${topicText}"`);
    return { ok: true };
  } catch (error) {
    console.error('Error adding row:', error);
    throw error;
  }
}

/**
 * Updates an existing row in the Google Sheet.
 */
async function updateRow(rowIndex, data) {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const targetRow = rows.find(r => r.rowNumber == rowIndex);
    
    if (targetRow) {
      if (data.topic !== undefined) targetRow.set('Topic', data.topic);
      if (data.keywords !== undefined) targetRow.set('Keywords', data.keywords);
      if (data.internalLinks !== undefined) targetRow.set('Internal Links', data.internalLinks);
      if (data.status !== undefined) targetRow.set('Status', data.status);
      if (data.seoScore !== undefined) targetRow.set('SEO Score', data.seoScore);
      await targetRow.save();
      await sendWhatsAppUpdate(`✍️ *Sheet Edits:* Row ${rowIndex} modified via dashboard.\nStatus: ${data.status || 'Updated'}`);
      return { ok: true };
    }
    throw new Error('Row not found');
  } catch (error) {
    console.error('Error updating row:', error);
    throw error;
  }
}

/**
 * Deletes a row from the Google Sheet.
 */
async function deleteRow(rowIndex) {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();
    const targetRow = rows.find(r => r.rowNumber == rowIndex);
    
    if (targetRow) {
      await targetRow.delete();
      await sendWhatsAppUpdate(`🗑️ *Sheet Cleanup:* Row ${rowIndex} permanently deleted from planner.`);
      return { ok: true };
    }
    throw new Error('Row not found');
  } catch (error) {
    console.error('Error deleting row:', error);
    throw error;
  }
}

/**
 * Connects to the Google Sheet and returns the next pending topic.
 */
async function getNextPendingTopic() {
  try {
    const sheet = await getSheet();
    const rows = await sheet.getRows();

    const pendingRow = rows.find(row => {
      const status = (row.get('Status') || '').toString().trim().toLowerCase();
      return status === 'pending' || status === '';
    });
    if (pendingRow) {
      return {
        id: pendingRow.rowNumber,
        topic: pendingRow.get('Topic'),
        keywords: pendingRow.get('Keywords') ? pendingRow.get('Keywords').split(',').map(k => k.trim()) : [],
        internalLinks: pendingRow.get('Internal Links') ? JSON.parse(pendingRow.get('Internal Links')) : [],
        _row: pendingRow,
      };
    }
    return null;
  } catch (error) {
    console.error('Error connecting to Google Sheets:', error);
    throw error;
  }
}

/**
 * Marks a topic as published in Google Sheets and saves SEO metrics.
 */
async function markAsPublished(row, url, metrics = {}) {
  try {
    row.set('Status', 'published');
    row.set('Published URL', url);
    row.set('Published Date', new Date().toISOString());
    if (metrics.seoScore) row.set('SEO Score', metrics.seoScore);
    if (metrics.keywordDensity) row.set('KW Density', metrics.keywordDensity);
    await row.save();
  } catch (error) {
    console.error('Error updating Google Sheets row:', error);
  }
}

module.exports = {
  getNextPendingTopic,
  markAsPublished,
  getAllRows,
  addRow,
  updateRow,
  deleteRow,
};
