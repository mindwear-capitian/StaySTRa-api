// Load environment variables FIRST
import dotenv from 'dotenv';
dotenv.config({ path: '/app/.env' }); // <--- MOVED TO TOP

// Now do other imports
import express from 'express';
import statsRouter from './routes/stats.js';
import propertyAnalysisRouter from './routes/property-analysis.js';
import wordpressPluginProxy from './routes/wordpress_plugin_proxy.js';

// Now when 'auth' is imported, process.env.DATABASE_URL should already be loaded
import auth from './middleware/auth.js';

// --- REMOVED the manual process.env.DATABASE_URL line ---

const app = express();
// Use PORT AFTER dotenv has loaded it
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(auth); // Apply API key middleware
app.use('/api/proxy', wordpressPluginProxy);


app.get('/health', (req, res) => {
  // Modify health check to show success if auth passed
  res.json({ status: 'ok', message: 'Auth middleware passed' });
});

app.use('/api/v1/markets', statsRouter);
app.use('/api/v1/property', propertyAnalysisRouter);

app.listen(PORT, () => {
  console.log(`🚀 API running on http://localhost:${PORT}`);
});
