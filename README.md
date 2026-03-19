# WordPress Auto-Poster

A Node.js application that automatically generates and posts SEO-optimized articles to WordPress every day.

## Features
- **AI-Powered Content**: Uses OpenAI (GPT-4o) to generate HTML-formatted articles based on a topic.
- **Dynamic Images**: Fetches relevant stock photos from Pexels based on the article's theme.
- **Automated Publishing**: Uploads images and creates posts via the WordPress REST API.
- **Scheduled Posting**: Uses `node-cron` to run the workflow automatically every day.

## Setup Instructions

1.  **Clone/Copy the project** to your desired location.
2.  **WordPress Configuration**:
    - Ensure your `mte_story` CPT is registered (as you provided).
    - **IMPORTANT**: In ACF, go to your "Story Details" field group and ensure **"Show in REST API"** is toggled **ON**.
    - Verify that the field names in ACF match exactly: `subtitle`, `author_name`, `reading_time`, `hero_image`, `story_content`.
3.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Configure Environment Variables**:
    - Rename `.env.example` to `.env`.
    - Fill in your API keys and WordPress credentials:
      - `OPENAI_API_KEY`: From [OpenAI](https://platform.openai.com/).
      - `PEXELS_API_KEY`: From [Pexels API](https://www.pexels.com/api/).
      - `WP_URL`: Your full WordPress site URL (e.g., `https://myblog.com`).
      - `WP_USERNAME`: Your WordPress username.
      - `WP_APPLICATION_PASSWORD`: Generate this in your WordPress profile (Users > Profile > Application Passwords).

4.  **Run the application**:
    - To start the daily scheduler:
      ```bash
      node src/index.js
      ```
    - To trigger a post **immediately** (for testing):
      ```bash
      node src/index.js --now
      ```

## Project Structure
- `src/index.js`: Main orchestration and scheduling logic.
- `src/services/openai.js`: OpenAI integration for content.
- `src/services/image.js`: Pexels integration for stock photos.
- `src/services/wordpress.js`: WordPress REST API integration.
