// Import dotenv to load the .env file
const dotenv = require('dotenv');
const path = require('path');

// Load the .env file from the current directory
// __dirname is available directly in CommonJS modules
// and refers to the directory of the current file.
const envPath = path.resolve(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`Warning: Could not load .env file from ${envPath}:`, result.error.message);
  // You might want to throw an error here if the .env file is critical
}

module.exports = {
  apps: [{
    name: 'ss-api', // The name for your process in pm2
    script: './app.js', // The path to your app's entry point, relative to this file
    cwd: __dirname, // Set the current working directory for the app
    env: {
      NODE_ENV: process.env.NODE_ENV || 'production', // Default NODE_ENV
      // Explicitly pass the DATABASE_URL loaded by dotenv in this file
      // to the environment of the actual app process.
      DATABASE_URL: process.env.DATABASE_URL
      // Explicitly pass the DATABASE_URL loaded by dotenv in this file
      // to the environment of the actual app process.
      // Since dotenv.config() ran above, process.env should be populated
      // for the pm2 process itself, which then passes it to the app.
    }
  }]
};