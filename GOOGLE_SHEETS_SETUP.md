# Google Sheets Setup Guide

To use an external Google Sheet for your automation, follow these steps:

### 1. Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., "WP Auto-Post").
3. Search for **"Google Sheets API"** and click **Enable**.

### 2. Create a Service Account
1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > Service Account**.
3. Give it a name and click **Create and Continue**.
4. In the "Grant this service account access to project" section, roles are not strictly required, just click **Done**.
5. Click on the email of the Service Account you just created.
6. Go to the **Keys** tab, click **Add Key > Create New Key**, select **JSON**, and click **Create**.
7. Keep this JSON file safe! You will need its contents for your `.env` file.

### 3. Prepare Your Google Sheet
1. Create a new Google Sheet.
2. Share the sheet with the **Service Account Email** (the one you saw in step 2.5) and give it **Editor** access.
3. Your sheet must have the following column headers in the first row (Row 1):
   - `Topic`
   - `Keywords`
   - `Internal Links` (Format: `[{"text": "Link", "url": "..."}]`)
   - `Status` (Set to `pending` for new topics)
   - `Published URL`
   - `Published Date`

### 4. Update Your `.env` File
1. Copy the **Spreadsheet ID** from the URL of your Google Sheet. It's the long string between `/d/` and `/edit`.
2. Add it to your `.env`: `GOOGLE_SHEET_ID=your_id_here`.
3. Copy the entire contents of the JSON key file you downloaded and paste it as a single line into `GOOGLE_SERVICE_ACCOUNT_JSON` in your `.env`.

---
### 🛠️ Example Internal Links Format
To provide internal links, enter them in the `Internal Links` column like this:
`[{"text": "Morocco Experts", "url": "https://site.com"}]`
