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
