// /srv/staystra/ss-api/db.js - COMPLETE CORRECTED VERSION
import pg from 'pg'; // Assuming you use 'pg' (node-postgres)

// --- db.js Module Load ---
// Log message indicating the file itself is being loaded by Node.
console.log('--- db.js Module is being loaded ---');

// Destructure Pool from pg
const { Pool } = pg;

// Declare the pool variable globally within the module scope, but initialize it to null.
// This ensures there's only one pool instance created (singleton pattern).
let pool = null;

// Define the function responsible for getting the pool instance.
// This function will initialize the pool only on the first call.
function getPool() {
  // Check if the pool instance has already been created.
  if (!pool) {
    console.log('--- Initializing pg.Pool (first time access) ---');

    // Read the DATABASE_URL environment variable *at the time of initialization*.
    // By this point, pm2 should have injected the variable.
    const connectionString = process.env.DATABASE_URL;

    // Log the connection string being used (or lack thereof) for debugging
    // Avoid logging the full string in production if possible for security.
    console.log(`DATABASE_URL retrieved for pool creation: ${connectionString ? 'Found' : 'Not Found!'}`);

    // Critical check: Ensure the connection string is actually available BEFORE creating the pool.
    if (!connectionString) {
      console.error('*** CRITICAL ERROR: DATABASE_URL environment variable is not defined when attempting to create the database pool. Check .env file, ecosystem config, and pm2 setup. ***');
      // Throwing an error is generally preferred over process.exit in library code.
      // This allows the calling code (e.g., your app's startup routine or a request handler)
      // to decide how to handle the failure (e.g., log, retry, shut down gracefully).
      throw new Error('Database configuration (DATABASE_URL) is missing.');
    }

    // Create the actual Pool instance.
    // Assign it to the `pool` variable declared in the outer scope.
    pool = new Pool({
      connectionString: connectionString,

      // --- Standard Pool Options (Examples - Adjust as needed) ---
      // maximum number of clients the pool should contain
      max: 10, // Example: Set based on your expected load and DB limits
      // number of milliseconds a client must sit idle in the pool and not be checked out
      // before it is disconnected from the backend and discarded
      idleTimeoutMillis: 30000, // 30 seconds
      // number of milliseconds to wait before timing out when connecting a new client
      connectionTimeoutMillis: 5000, // 5 seconds
      // --- End of Standard Pool Options ---
    });

    // --- Pool Event Listeners (Important for Monitoring) ---

    // Emitted when a client is acquired from the pool. Good for debugging pool usage.
    pool.on('acquire', (client) => {
      // console.log('Client acquired from pool. Total count:', pool.totalCount, 'Idle count:', pool.idleCount, 'Waiting count:', pool.waitingCount);
    });

    // Emitted when a client is connected to the database backend.
    pool.on('connect', (client) => {
      console.log('Client connected to the database');
    });

    // Emitted when a client encounters an error. Essential for stability.
    pool.on('error', (err, client) => {
      console.error('!!! Unexpected error on idle database client !!!', err);
      // Consider logging details about the client if available
      // Depending on the error, advanced strategies might be needed, but logging is key.
      // Avoid process.exit here unless absolutely necessary and handled carefully.
    });

    // Emitted when a client is returned to the pool.
    pool.on('release', (err, client) => {
      // console.log('Client released back to pool. Total count:', pool.totalCount, 'Idle count:', pool.idleCount, 'Waiting count:', pool.waitingCount);
       if (err) {
          console.error('Error releasing client:', err);
       }
    });

    // --- End of Pool Event Listeners ---

    console.log('--- pg.Pool created successfully ---');
    // Log the actual options the pool was configured with for verification, obfuscating sensitive parts.
    let logOptions = { ...pool.options };
    if (logOptions.connectionString) {
        // Basic attempt to hide password in logs
        logOptions.connectionString = logOptions.connectionString.replace(/:([^:]*)@/, ':***@');
    }
    console.log('Pool configuration used:', logOptions);
    console.log('---------------------------------');

  } // End of if (!pool) block

  // Return the singleton pool instance (either newly created or the existing one).
  return pool;
}

// Export ONLY the function that retrieves the pool.
// This enforces the lazy initialization pattern.
export { getPool };