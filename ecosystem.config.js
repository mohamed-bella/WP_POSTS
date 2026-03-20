module.exports = {
  apps: [
    {
      name: 'morocco-family-bot',
      script: 'src/engage.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      // Ensure it waits for networking to be up
      exp_backoff_restart_delay: 100,
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ],
};
