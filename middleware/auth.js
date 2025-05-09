import { getPool } from '../db.js';

export default async function auth(req, res, next) {
  // Skip auth for health check endpoint
  if (req.path === '/health') {
    return next();
  }

console.log('🔑 Checking API key from header:', req.headers['x-api-key']); // Log where we are checking

const key = req.headers['x-api-key']; // <-- CORRECTED: Read key from 'x-api-key' header

  if (!key) {
    return res.status(401).json({ error: 'API key required' });
  }

  try {
    // --- Change: Use getPool() to get the pool instance ---
    const result = await getPool().query(
      'SELECT id FROM ss_api_keys WHERE key = $1',
      [key]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    req.apiKeyId = result.rows[0].id;
    next();
  } catch (err) {
    console.error('Error during DB query in auth middleware:', err);
    res.status(500).json({ error: 'Auth error' });
  }
}
