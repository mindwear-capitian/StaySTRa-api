// Load libraries using ESM syntax
import express from 'express';
import axios from 'axios';

const router = express.Router();

// 🔧 CONFIG: Replace with actual values later or use .env
const AIRDNA_BASE_URL = process.env.AIRDNA_BASE_URL || 'https://airdna1.p.rapidapi.com/rentalizer';
const AIRDNA_API_KEY = process.env.AIRDNA_API_KEY || 'ab72a7d6b2mshb4e817ee05e7d7cp1832fdjsn89ea5865c862';

// Fields you want to randomize slightly
const FIELDS_TO_RANDOMIZE = ['avg_daily_rate', 'occupancy_rate', 'revenue'];

// CORS Middleware
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Utility: Randomize a number by ± up to 10%
function randomizeValue(value) {
  if (typeof value !== 'number') return value;
  const delta = value * (Math.random() * 0.2 - 0.1); // ±10%
  return Math.round((value + delta) * 100) / 100;
}

// Test route to confirm it's working
router.get('/test', (req, res) => {
  res.json({ message: '✅ Plugin proxy route is working!' });
});

// Main proxy handler
router.get('/', async (req, res) => {
  try {
    const queryParams = new URLSearchParams(req.query);
    const targetUrl = `${AIRDNA_BASE_URL}?${queryParams.toString()}`;

    const response = await axios.get(targetUrl, {
      headers: {
        'Authorization': `Bearer ${AIRDNA_API_KEY}`,
        'Accept': 'application/json'
      }
    });

    const data = response.data;

    // Randomize key values
    function recursivelyRandomize(obj) {
      for (const key in obj) {
        if (FIELDS_TO_RANDOMIZE.includes(key) && typeof obj[key] === 'number') {
          obj[key] = randomizeValue(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          recursivelyRandomize(obj[key]);
        }
      }
    }

    recursivelyRandomize(data);

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(data);

  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({
      error: 'Proxy failed',
      message: error.message
    });
  }
});

export default router;
