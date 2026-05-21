/**
 * PM2 Ecosystem Configuration
 *
 * Run both the API server and background workers together:
 *   pm2 start ecosystem.config.js
 *
 * Or run individually:
 *   pm2 start ecosystem.config.js --only pw-api
 *   pm2 start ecosystem.config.js --only pw-workers
 *
 * For development (without PM2):
 *   npm run dev          # API server with hot reload
 *   npm run worker:dev   # Workers with hot reload (separate terminal)
 */
module.exports = {
  apps: [
    {
      name: 'pw-api',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'pw-workers',
      script: 'dist/workers/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      watch: false,
      max_memory_restart: '300M',
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      merge_logs: true,
      time: true,
      // Restart workers if they crash
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
