import pg from 'pg';

// This code runs only when db.js is imported.
// dotenv.config() should have run BEFORE this module is imported in app.js
console.log('--- db.js Module Load ---');
console.log('DATABASE_URL in db.js:', process.env.DATABASE_URL); // Check value here
console.log('-------------------------');

const { Pool } = pg;

// Check if DATABASE_URL is loaded before creating the pool
if (!process.env.DATABASE_URL) {
  console.error('*** FATAL ERROR: DATABASE_URL is not defined! Check .env file and load order. ***');
  // Optionally exit if the DB URL isn't loaded - prevents pool trying localhost
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

console.log('--- pg.Pool created in db.js ---');
console.log('Pool options:', pool.options);
console.log('--------------------------------');

// Export the single configured pool instance
export default pool;
