// File name: app.js
// Load environment variables FIRST
//import dotenv from 'dotenv';
//dotenv.config({ path: '/app/.env' });

// Now do other imports
import express from 'express';
import statsRouter from './routes/stats.js';
import propertyAnalysisRouter from './routes/property-analysis.js';
import { locationDetailsRouter } from './routes/location-details.js';
import propertyAnalysisV2Routes from './routes/property-analysis-v2.js'; 
//import wordpressPluginProxy from './routes/wordpress_plugin_proxy.js';

// Now when 'auth' is imported, process.env.DATABASE_URL should already be loaded
import auth from './middleware/auth.js';

// --- REMOVED the manual process.env.DATABASE_URL line ---

const app = express();
// Use PORT AFTER dotenv has loaded it
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  // Basic health check, does not require auth
  res.json({ status: 'ok' });
});

// Apply API key middleware AFTER public routes like /health
app.use(auth);

app.use('/api/v1/markets', statsRouter);
app.use('/api/v1/property', propertyAnalysisRouter);
app.use('/api/v2/property', propertyAnalysisV2Routes);
app.use('/api/v1/location-details', locationDetailsRouter);

app.listen(PORT, () => {
  console.log(`🚀 API running on http://localhost:${PORT}`);
});
