const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
require('dotenv').config();

/**
 * Connects to the Google Sheet and returns the next pending topic.
 */
async function getNextPendingTopic() {
  const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const jwt = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, jwt);

  try {
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0]; // Assume first sheet
    const rows = await sheet.getRows();

    const pendingRow = rows.find(row => row.get('Status') === 'pending');
    if (pendingRow) {
      return {
        id: pendingRow.rowNumber,
        topic: pendingRow.get('Topic'),
        keywords: pendingRow.get('Keywords') ? pendingRow.get('Keywords').split(',').map(k => k.trim()) : [],
        internalLinks: pendingRow.get('Internal Links') ? JSON.parse(pendingRow.get('Internal Links')) : [],
        _row: pendingRow, // Keep reference to the row to update it later
      };
    }
    return null;
  } catch (error) {
    console.error('Error connecting to Google Sheets:', error);
    throw error;
  }
}

/**
 * Marks a topic as published in Google Sheets.
 */
async function markAsPublished(row, url) {
  try {
    row.set('Status', 'published');
    row.set('Published URL', url);
    row.set('Published Date', new Date().toISOString());
    await row.save();
  } catch (error) {
    console.error('Error updating Google Sheets row:', error);
  }
}

module.exports = {
  getNextPendingTopic,
  markAsPublished,
};
