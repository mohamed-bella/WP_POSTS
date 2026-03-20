# Hetzner Setup Guide for WP Auto-Poster

Follow these steps to deploy your Node.js automation on a Hetzner VPS.

### 1. Initial Server Setup
Connect to your server via SSH:
```bash
ssh root@your_hetzner_ip
```
Update your system:
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js
We recommend using **NVM** (Node Version Manager) to install and manage Node.js versions:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 3. Clone Your Repository
Clone the project from GitHub:
```bash
git clone https://github.com/mohamed-bella/WP_POSTS.git
cd WP_POSTS
```

### 4. Install Dependencies
```bash
npm install
```

### 5. Setup Environment Variables
Create the `.env` file on the server:
```bash
nano .env
```
Copy and paste the contents of your local `.env` file into it. Use `Ctrl+O`, `Enter`, then `Ctrl+X` to save and exit.

## 🚀 Deployment to Hetzner (Always-On)

To keep your bot running 24/7 and performing automated actions (Instagram, WhatsApp, Blogger), follow these steps:

### 1. Prerequisites on Server
```bash
sudo apt update
sudo apt install -y nodejs npm
sudo npm install -g pm2
```

### 2. Transfer the Session (Crucial)
To avoid scanning the QR code again, you MUST copy these from your local machine to the server:
- `.env` (Your configuration)
- `cookies.json` (Instagram login)
- `auth_info_baileys/` (WhatsApp connection folder)

### 3. Start with PM2
In your project directory on the server:
```bash
npm install
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```
This will ensure the bot restarts automatically if the server reboots.

### 4. Monitoring
- `pm2 logs`: See real-time updates and WhatsApp notifications status.
- `pm2 status`: See if the bot is running.

### 5. Automated Scheduling
The bot handles its own scheduling based on the times defined in `src/engage.js`. As long as PM2 is running, it will post and engage at the correct times.

### 6. Keep the Process Running with PM2
Install PM2 globally:
```bash
npm install -g pm2
```
Start your application:
```bash
pm2 start src/index.js --name wp-poster
```
To ensure PM2 starts automatically if the server reboots:
```bash
pm2 startup
# (Run the command PM2 prints in the output)
pm2 save
```

### 7. View Logs
To see the logs of your running app:
```bash
pm2 logs wp-poster
```

---
### 🔄 How to Update the App (When you push changes)
Whenever you push new code to GitHub (e.g., from your local machine), run these commands on your Hetzner server:
1. **Pull the latest code:**
   ```bash
   git pull origin master
   ```
2. **Restart the app to apply changes:**
   ```bash
   pm2 restart wp-poster
   ```

**💡 Pro-tip:** If you added new dependencies, run `npm install` before restarting.
