# 🧪 Testing Every Workflow

Use these commands to verify each part of the automation system individually.

## 1. 📱 Full Automation (All-in-One)
Starts everything: Instagram posting, engagement, and WhatsApp notifications.
```bash
npm start
```

## 2. 📸 Instagram Auto-Poster (Manual Trigger)
Fetches a Morocco image from Unsplash and posts it immediately.
```bash
npm run poster
```

## 3. 💬 Instagram Engagement (Manual Trigger)
Searches hashtags and comments on posts immediately.
```bash
npm run now
```

## 4. 📝 Blogger & SEO Indexing Test
Publishes a test post to Blogger and triggers the Google/Bing indexing pipeline.
```bash
node src/services/blogger.js --test
```
*(Note: Requires `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env`)*

## 🤳 WhatsApp Pairing
If you need to re-link or see the pairing code again:
1. Delete the `auth_info_baileys` folder.
2. Run `npm start`.
3. Check `whatsapp_code.txt` for the pairing code.

## 🕵️ Debugging
All logs are saved automatically if running with PM2:
- **Error Logs**: `tail -f logs/err.log`
- **Activity Logs**: `tail -f logs/out.log`
- **Screenshots**: Check `debug-*.png` in the project root for Instagram UI state.
