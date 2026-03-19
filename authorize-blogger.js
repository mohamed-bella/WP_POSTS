const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

const { BLOGGER_CLIENT_ID, BLOGGER_CLIENT_SECRET } = process.env;

if (!BLOGGER_CLIENT_ID || !BLOGGER_CLIENT_SECRET) {
  console.error('Please set BLOGGER_CLIENT_ID and BLOGGER_CLIENT_SECRET in your .env file first.');
  console.error('You can get these from Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs (Desktop App).');
  process.exit(1);
}

// Ensure the redirect URI matches what is allowed for Desktop apps
const redirectUri = 'http://localhost';

const oauth2Client = new google.auth.OAuth2(
  BLOGGER_CLIENT_ID,
  BLOGGER_CLIENT_SECRET,
  redirectUri
);

const scopes = [
  'https://www.googleapis.com/auth/blogger'
];

const url = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent' // Forces a refresh token to be generated
});

console.log('====================================================');
console.log('1. Go to this URL in your browser:');
console.log(url);
console.log('====================================================');
console.log('2. Log in with the Google Account that owns the Blogger sites.');
console.log('3. Allow the permissions.');
console.log('4. You will be redirected to http://localhost/?code=...');
console.log('5. Copy ONLY the code from the URL and paste it below.');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('\nEnter the authorization code: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(decodeURIComponent(code));
    if (tokens.refresh_token) {
      console.log('\n✅ SUCCESS!');
      console.log('Your Refresh Token is:');
      console.log('------------------------------------------------');
      console.log(tokens.refresh_token);
      console.log('------------------------------------------------');
      console.log('Add this to your .env file as BLOGGER_REFRESH_TOKEN=...');
    } else {
      console.log('\n❌ No refresh token was returned. You must revoke the app access in your Google Account and try again.');
    }
  } catch (error) {
    console.error('\n❌ Error retrieving access token:', error.message);
  } finally {
    rl.close();
  }
});
