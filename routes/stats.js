import express from 'express';
import pg from 'pg';

const router = express.Router();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// New endpoint for all markets
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM active_listings'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Keep existing endpoint
router.get('/:slug/stats', async (req, res) => {
  const { slug } = req.params;
  try {
    const marketResult = await pool.query(
      'SELECT id FROM areas WHERE slug = $1',
      [slug]
    );

    if (marketResult.rowCount === 0) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const marketId = marketResult.rows[0].id;
    const statsResult = await pool.query(
      `SELECT * FROM active_listings WHERE area_id = $1`,
      [marketId]
    );

    res.json({ market: slug, data: statsResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
