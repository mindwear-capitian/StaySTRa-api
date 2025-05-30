// File: /srv/staystra/ss-api/routes/property-analysis.js
// Description: Handles property analysis requests, calls external analysis API, calculates projected revenues, and formats response.

// Load libraries using ESM syntax
import express from 'express';
// --- Change 1: Import getPool function instead of pool directly ---
import { getPool } from '../db.js';
import fetch from 'node-fetch'; // Make sure node-fetch is installed (`npm install node-fetch` in ss-api dir)
// Assuming auth middleware is imported and used in app.js for this router

// --- Import utility/calculation functions ---
// Corrected path assumes analysisCalculations.js is in ss-api/utils
import { calculateRevenues } from '../utils/analysisCalculations.js';
// Note: sendAlertToN8n, vary, coordsAreTooClose could be moved to a separate helpers file later.

// --- Initialize Express Router ---
// This MUST be declared AFTER the express import and BEFORE any routes are defined using 'router.post', etc.
const router = express.Router();
// --- End Initialize ---


// --- Utility functions ---
// sendAlertToN8n: Sends a POST request to an N8N webhook for alerts.
const sendAlertToN8n = async (payload) => {
    try {
        // Ensure this URL is correct for your N8N webhook
        const response = await fetch('https://n8n.re-workflow.com/webhook/StaySTRa-Error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
             console.error('N8N alert webhook returned non-OK status:', response.status, response.statusText); // Keep error log
        } else {
             // console.log('N8N alert sent successfully.'); // Removed noisy success log
        }
        return response.ok;
    } catch (error) {
        console.error('Failed to send N8N alert:', error); // Keep error log
        return false;
    }
};

// --- Utility functions (currently unused in core logic but kept for source fidelity) ---
const vary = (value, maxPercent = 1.5) => {
    if (typeof value !== 'number' || value === 0) return value;
    const percent = (Math.random() * maxPercent * 10) / 1000;
    const direction = Math.random() > 0.5 ? 1 : -1;
    return value + (value * percent * direction);
};

const coordsAreTooClose = (lat1, lng1, lat2, lng2, thresholdMeters = 50) => {
    const earthRadius = 6371000;
    const latDelta = (lat2 - lat1) * Math.PI / 180;
    const lngDelta = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(latDelta / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) *
              Math.cos(lat2 * Math.PI / 180) *
              Math.sin(lngDelta / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (earthRadius * c) <= thresholdMeters;
};
// --- End Utility functions ---


// --- Main Analysis Endpoint ---
// This route handles POST requests to /analyze (which is mounted at /api/v1/property in app.js)
// Assumes authentication middleware has already run and validated the API key.
router.post('/analyze', async (req, res) => {
    // Extract input data from the request body (sent as JSON from PHP)
    const { address, bedrooms, bathrooms, occupancy, referrer, utm_source, agent_id } = req.body;

    // --- Input Validation ---
    // Basic validation for required fields
    if (!address) {
        console.warn('Analysis request missing address:', req.body);
        // Always send 200 to PHP proxy, use success: false to indicate a user input error
        // Note: We return here, so initial query log and error log won't happen for missing address.
        // If you needed to log this validation failure, move the initial log outside this check.
        return res.status(200).json({
            success: false,
            message: 'Property address is required for analysis.'
        });
    }

    console.log('Received analysis request for address:', address);

    // --- Start: Log initial query ---
    // Log the query request *before* the main try block to capture it even if analysis fails later.
    let queryId = null; // Variable to hold the ID of the inserted row
    try {
        // --- Change 2: Use getPool().query instead of pool.query ---
        const result = await getPool().query(
            `INSERT INTO analyzer_queries (address, referrer, utm_source, agent_id, query_success)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [address, referrer, utm_source, agent_id, false] // Initially assume failure, update later
        );
        queryId = result.rows[0].id; // Get the ID of the newly inserted row
        // console.log(`📊 Logged initial query for address ${address} with ID: ${queryId}`); // Optional log
    } catch (logError) {
        // Log the database error but do NOT stop the main analysis flow
        console.error('🚫 Failed to log initial query to database:', logError); // Keep this error log
        // Attempt to send alert for database logging failure
        await sendAlertToN8n({
            subject: '⚠️ StaySTRA Analyzer DB Logging Error',
            body: `Failed to log initial query to analyzer_queries table for address: ${address || 'N/A'}\n` +
                  `• Error: ${logError.message}\n` +
                  `• Time: ${new Date().toISOString()}`
        });
        // queryId remains null, which is okay - we just won't be able to update this log later or link errors
    }
    // --- End: Log initial query ---


    // --- Main Processing Logic ---
    let rawExternalResponse = null; // Variable to hold the data, whether from cache or API
    let source = 'unknown'; // Track source for potential logging/debugging

    try { // This main try block wraps all core logic and catches generic internal errors
        const cacheExpirationDays = 30; // Define how old a cache entry can be

           // --- Start: Check Cache ---
        console.log(`🔍 Checking cache for address ${address}.`); // This is an original useful log
        try {
            const cacheResult = await getPool().query(
                `SELECT raw_api_response, last_fetched
                 FROM property_cache
                 WHERE address = $1
                 AND last_fetched >= NOW() - INTERVAL '${cacheExpirationDays} days'`,
                [address]
            );

            if (cacheResult.rows.length > 0) {
                rawExternalResponse = cacheResult.rows[0].raw_api_response;
                source = 'cache';
            } else {
                source = 'api'; // Explicitly set for clarity if a cache miss
            }

        } catch (cacheError) {
            console.error('🚫 Failed during cache check:', cacheError); // This is an original useful error log
            await sendAlertToN8n({
                subject: '⚠️ StaySTRA Analyzer Cache Check Error',
                body: `Failed to check property_cache table for address: ${address || 'N/A'}\n` +
                      `• Error: ${cacheError.message}\n` +
                      `• Time: ${new Date().toISOString()}`
            });
            // rawExternalResponse remains null, which will trigger an API call attempt
            source = 'api_due_to_cache_error'; // Explicitly set for clarity
        }
        // --- End: Check Cache ---

    console.log(`[V2_LOG] After cache check. RawExternalResponse is ${rawExternalResponse ? 'POPULATED' : 'NULL'}. Source: ${source}`); // New log


        // --- Conditional Logic: Cache Hit OR API Call ---
        if (!rawExternalResponse) {
            // --- Cache Miss: Call External Analysis API ---
            // Cache miss log removed

            // Calculate accommodates/occupancy if not explicitly provided
            const beds = parseInt(bedrooms, 10) || 0;
            const calculatedOccupancy = (!occupancy && beds > 0) ? beds * 2 : (parseInt(occupancy, 10) || 0);

            // --- START: MODIFICATION TO FORMAT ADDRESS ---
            let apiFormattedAddress = address; // Start with the original address from req.body

            // Check if address exists and doesn't already contain a comma
            if (address && typeof address === 'string' && !address.includes(',')) {
                const words = address.trim().split(' ');
                if (words.length > 1) { // We need at least two words (e.g., "street city")
                    const potentialCity = words.pop(); // Takes the last word
                    const streetPart = words.join(' ');
                    apiFormattedAddress = `${streetPart}, ${potentialCity}`;
                    console.log(`[StaySTRA API INFO] Address Formatting: Original: "${address}", Formatted for AirDNA: "${apiFormattedAddress}"`);
                }
            }
            // --- END: MODIFICATION TO FORMAT ADDRESS ---


            // Prepare parameters for the AirDNA API request URL
            const params = new URLSearchParams({ // Keep parameters as expected by the external API
                address: address,
                ...(beds > 0 && { bedrooms: beds }),
                ...(parseFloat(bathrooms) > 0 && { bathrooms: parseFloat(bathrooms) }),
                ...(calculatedOccupancy > 0 && { accommodates: calculatedOccupancy })
            });

            // Use generic environment variables
            const externalApiBaseUrl = process.env.EXTERNAL_ANALYSIS_BASE_URL;
            const externalApiKey = process.env.EXTERNAL_ANALYSIS_API_KEY;
            const externalApiHost = process.env.EXTERNAL_ANALYSIS_API_HOST;

            if (!externalApiBaseUrl || !externalApiKey || !externalApiHost) {
                console.error('External API configuration error: Missing required environment variables.');
                throw new Error('External API service is not configured correctly.'); // Throw internal error
            }

            const externalApiUrl = `${externalApiBaseUrl}?${params}`;

            // ADD THESE CONSOLE.LOGS:
            console.log('[DEBUG] Making external API call with the following details:');
            console.log(`[DEBUG]   URL: ${externalApiUrl}`);
            console.log(`[DEBUG]   Host Header: ${externalApiHost}`);
            console.log(`[DEBUG]   API Key (last 5 chars): ${externalApiKey ? externalApiKey.slice(-5) : 'NOT SET'}`); // Log only last few chars of key
            // end Logs

            const externalApiResponse = await fetch(externalApiUrl, {
                method: 'GET',
                headers: {
                    'x-rapidapi-host': externalApiHost,
                    'x-rapidapi-key': externalApiKey,
                }
            });

            // Check if the external API call itself failed (HTTP status 2xx)
            if (!externalApiResponse.ok) {
                const errorBody = await externalApiResponse.text();
                console.error(`External analysis API call failed: Status ${externalApiResponse.status} - ${externalApiResponse.statusText}`, errorBody);

                await sendAlertToN8n({
                    subject: '🚨 StaySTRA Analyzer External API Error',
                    body: `External analysis API call failed for address: ${address}\n` +
                          `• Status: ${externalApiResponse.status} - ${externalApiResponse.statusText}\n` +
                          `• Response Body: ${errorBody.substring(0, 500)}...\n` +
                          `• Time: ${new Date().toISOString()}`
                });

                // --- Log error to database (for external API fetch failures) ---
                let errorCode = `EXTERNAL_FETCH_ERROR_${externalApiResponse.status}`; // Generic code
                let errorMessage = `External API call failed. Status: ${externalApiResponse.status}, StatusText: ${externalApiResponse.statusText}, Body: ${errorBody.substring(0, 1000)}`;

                if (queryId !== null) {
                     // --- Change 4: Use getPool().query instead of pool.query ---
                     try { await getPool().query(`INSERT INTO query_errors (address, error_code, message, query_id) VALUES ($1, $2, $3, $4)`, [address, errorCode, errorMessage.substring(0, 4000), queryId]); } catch (logErrorDb) { console.error('🔥🔥 Failed to log AirDNA fetch error:', logErrorDb); }
                } else {
                     // --- Change 5: Use getPool().query instead of pool.query ---
                     try { await getPool().query(`INSERT INTO query_errors (address, error_code, message, query_id) VALUES ($1, $2, $3, $4)`, [address, errorCode, errorMessage.substring(0, 4000), null]); } catch (logErrorDb) { console.error('🔥🔥 Failed (again) to log AirDNA fetch error (no queryId):', logErrorDb); }
                }
                // --- End: Log error to database ---

                // Send a response that the frontend can handle as an error
                return res.status(200).json({
                     success: false,
                     message: `External analysis service responded with an error (Status ${externalApiResponse.status}). Please try again later.`
                });
            }

            // Process Raw External Response if fetch was OK
            rawExternalResponse = await externalApiResponse.json();
            source = 'api';

            // --- Start: Save to Cache (Only on Cache Miss Success) ---
            // If we successfully called AirDNA and got a valid JSON response, save it to cache
            // We will do basic validation of the JSON structure *after* this if block,
            // so we save the *raw* JSON received if the fetch was successful.
            try {
                console.log(`[CACHE WRITE ATTEMPT] For address: "${address}"`);
                 // --- Change 6: Use getPool().query instead of pool.query ---
                 await getPool().query(
                     `INSERT INTO property_cache (address, raw_api_response, source_api, last_fetched)
                      VALUES ($1, $2, $3, NOW())
                      ON CONFLICT (address) DO UPDATE
                      SET raw_api_response = EXCLUDED.raw_api_response,
                          last_fetched = EXCLUDED.last_fetched,
                          source_api = EXCLUDED.source_api`, // Update if conflict happens (address already exists)
                     [address, rawExternalResponse, 'External'] // Use generic source name
                 );
                 console.log(`[CACHE WRITE SUCCESS] For address: "${address}"`);
                 // Cache save/update log removed
            } catch (cacheSaveError) {
                 console.error(`[CACHE WRITE FAILED] For address: "${address}"`, cacheSaveError);
                 await sendAlertToN8n({
                    subject: '⚠️ StaySTRA Analyzer Cache Save Error',
                    body: `Failed to save/update property_cache table for address: ${address || 'N/A'}\n` +
                          `• Error: ${cacheSaveError.message}\n` +
                          `• Time: ${new Date().toISOString()}`
                });
            }
            // --- End: Save to Cache ---

        } // --- End Cache Miss: External API Call Block ---


        // --- Process Raw External Response (from either Cache or API) ---
        // The rawExternalResponse variable now holds the data, whether from cache or a fresh API call.
        // We process it the same way from this point regardless of source.

        // Check if the raw response indicates an error or no data (e.g., RapidAPI subscription message, or no data found)
        // Check the top-level 'data' key exists and is a non-null object
        // This validation runs for both cache hits and successful API calls
        if (!rawExternalResponse || typeof rawExternalResponse.data !== 'object' || rawExternalResponse.data === null) {
             //console.error('External analysis data in unexpected format or missing main data key:', rawExternalResponse);// Temp silence
             await sendAlertToN8n({
                subject: '⚠️ StaySTRA Analyzer Unexpected External Data',
                body: `External service returned unexpected data structure (missing main data key) for address: ${address}\n` +
                      `• Raw Response: ${JSON.stringify(rawExternalResponse, null, 2).substring(0, 1000)}...\n` +
                      `• Time: ${new Date().toISOString()}`
            });

             // --- Log error to database (for unexpected external data structure) ---
             let errorCode = 'EXTERNAL_BAD_DATA'; // Generic code
             let errorMessage = `External data in unexpected format or missing main data key. Source: ${source}. Raw: ${JSON.stringify(rawExternalResponse, null, 2).substring(0, 1000)}`; // Include source
             if (queryId !== null) {
                 // --- Change 7: Use getPool().query instead of pool.query ---
                 try { await getPool().query(`INSERT INTO query_errors (address, error_code, message, query_id) VALUES ($1, $2, $3, $4)`, [address, errorCode, errorMessage.substring(0, 4000), queryId]); } catch (logErrorDb) { console.error('🔥🔥 Failed to log unexpected data error:', logErrorDb); }
             } else {
                 // --- Change 8: Use getPool().query instead of pool.query ---
                 try { await getPool().query(`INSERT INTO query_errors (address, error_code, message, query_id) VALUES ($1, $2, $3, $4)`, [address, errorCode, errorMessage.substring(0, 4000), null]); } catch (logErrorDb) { console.error('🔥🔥 Failed (again) to log unexpected data error (no queryId):', logErrorDb); }
             }
            // --- End: Log error to database ---

             // Send 200 to PHP/frontend with success: false and message
             return res.status(200).json({
                success: false,
                message: 'Analysis data format unexpected. Please try a different address or contact support.'
             });
        }

        // Assume the external service returns the actual data nested under a 'data' key
        const externalData = rawExternalResponse.data;


        // --- Validate Structure and Extract Data ---
        // Check if the main data object has required sub-objects
        // This validation also runs for both cache hits and successful API calls
        if (!externalData.property_details || !externalData.property_statistics || !externalData.combined_market_info) {
             //console.error('External analysis data missing required sub-details:', rawExternalResponse);// Temp silence
             await sendAlertToN8n({
                subject: '⚠️ StaySTRA Analyzer Unexpected External Data',
                body: `External service returned unexpected data structure (missing sub-details) for address: ${address}\n` +
                      `• Raw Response: ${JSON.stringify(rawExternalResponse, null, 2).substring(0, 1000)}...\n` +
                      `• Time: ${new Date().toISOString()}`
            });

             // --- Log error to database (for missing external sub-details) ---
             let errorCode = 'EXTERNAL_MISSING_SUBDATA'; // Generic code
             let errorMessage = `External data missing required sub-details. Source: ${source}. Raw: ${JSON.stringify(rawExternalResponse, null, 2).substring(0, 1000)}`; // Include source
             if (queryId !== null) {
                 // --- Change 9: Use getPool().query instead of pool.query ---
                 try { await getPool().query(`INSERT INTO query_errors (address, error_code, message, query_id) VALUES ($1, $2, $3, $4)`, [address, errorCode, errorMessage.substring(0, 4000), queryId]); } catch (logErrorDb) { console.error('🔥🔥 Failed to log missing sub-details error:', logErrorDb); }
             } else {
                 // --- Change 10: Use getPool().query instead of pool.query ---
                 try { await getPool().query(`INSERT INTO query_errors (address, error_code, message, query_id) VALUES ($1, $2, $3, $4)`, [address, errorCode, errorMessage.substring(0, 4000), null]); } catch (logErrorDb) { console.error('🔥🔥 Failed (again) to log missing sub-details error (no queryId):', logErrorDb); }
             }
            // --- End: Log error to database ---

             return res.status(200).json({
                success: false,
                message: 'No detailed analysis data found for this property or data format unexpected.'
             });
        }

        // Extract necessary data using the correct variable name externalData
        const details = externalData.property_details || {};
        const stats = externalData.property_statistics || {};
        const comps = externalData.comps || [];
        const combinedMarketInfo = externalData.combined_market_info || {};


        // --- Call the calculation function ---
        // This uses the stats and comps extracted above, regardless of source (cache/API)
        const calculatedRevenues = calculateRevenues(stats, comps);
        const { typicalRevenue, top25Revenue, top10Revenue } = calculatedRevenues;
        // console.log(`✅ Final Calculated Projected Revenues: Typical=$${typicalRevenue.toFixed(2)}, Top25=$${top25Revenue.toFixed(2)}, Top10=$${top10Revenue.toFixed(2)}`);


        // --- Format Response for Frontend ---
        const formattedResponse = {
            property_details: details,
            property_statistics: stats,
            comps: comps,
            StaySTRa_market_name: combinedMarketInfo.airdna_market_name,
            StaySTRa_submarket_name: combinedMarketInfo.submarket_name,
            market_score: combinedMarketInfo.market_score,
            submarket_score: combinedMarketInfo.submarket_score,
            ard: stats.adr?.ltm ? `$${stats.adr.ltm.toFixed(0)}` : 'N/A',
            occupancy: stats.occupancy?.ltm ? `${(stats.occupancy.ltm * 100).toFixed(0)}%` : 'N/A',
            projected_revenue_typical: vary(typicalRevenue), // Apply randomization
            projected_revenue_top_25: vary(top25Revenue),   // Apply randomization
            projected_revenue_top_10: vary(top10Revenue),   // Apply randomization
        };

        // console.log('✅ Formatted Response sent to frontend:', formattedResponse);


        // --- Update query log on success ---
        // This MUST happen BEFORE sending the response.
        // Only update if we successfully inserted the initial log row
        if (queryId !== null) {
            try {
                // Optionally add a note to the log indicating the source (cache/api)
                // For now, just mark as success
                // --- Change 11: Use getPool().query instead of pool.query ---
                await getPool().query(
                    `UPDATE analyzer_queries
                     SET query_success = TRUE
                     WHERE id = $1`,
                    [queryId]
                );
                    // Query log update success log removed
            } catch (logUpdateError) {
                console.error(`🚫 Failed to update query log ID ${queryId} to success:`, logUpdateError);
                // Optionally send another alert specific to update failure
            }
        }
        // --- End update query log on success ---


        // --- Send Formatted Response Back to WordPress Backend ---
        // This should be the LAST significant thing that happens in the try block before it closes.
        // console.log('--- DEBUG: Final formattedResponse object being sent ---');
        // console.log(JSON.stringify(formattedResponse, null, 2));
       

        res.json({
            success: true,
            message: `Analysis completed (Source: ${source})`, // Indicate source in message for debugging/testing
            data: formattedResponse
        });

    } // <-- This is the correct closing bracket for the main try block
    catch (error) {
        // --- Handle Generic Internal API Errors ---
        // This catch block handles any errors that weren't specifically caught and handled with a 'return' earlier
        // (like database errors during initial log/cache save/cache check, parsing errors after initial fetch,
        // errors during calculations, or errors during the final log update).
        console.error('📈 Internal Property analysis error:', error);

        // Attempt to send alert for internal API failure
        await sendAlertToN8n({
            subject: '🔥 StaySTRA Analyzer Internal API Error',
            body: `Internal error during analysis for address: ${address || 'N/A'}\n` +
                  `• Error: ${error.stack || error.message}\n` +
                  `• Time: ${new Date().toISOString()}`
        });

        // --- Start: Log error to database (for generic internal errors) ---
        let errorCode = 'INTERNAL_ERROR';
        let errorMessage = error.stack || error.message || 'Unknown error';

        // Attempt to add more context if possible
        if (error.message) {
             errorMessage = `Error: ${error.message}`;
             if (error.stack) {
                 errorMessage += `\nStack: ${error.stack}`;
             }
        }
        // You could add checks here for specific error types if you need distinct error_codes for them (e.g. DB query error vs calculation error)

        // Use the queryId captured at the start if available
        if (queryId !== null) {
            try {
                // --- Change 12: Use getPool().query instead of pool.query ---
                await getPool().query(
                    `INSERT INTO query_errors (address, error_code, message, query_id)
                     VALUES ($1, $2, $3, $4)`,
                    [address || null, errorCode, errorMessage.substring(0, 4000), queryId] // Limit message length
                );
                    // Internal error log success message removed
            } catch (logErrorDb) {
                console.error('🔥🔥 Failed to log internal error to query_errors database table:', logErrorDb);
            }
        } else {
             // --- Change 13: Use getPool().query instead of pool.query ---
             try { await getPool().query(`INSERT INTO query_errors (address, error_code, message, query_id) VALUES ($1, $2, $3, $4)`, [address || null, errorCode, errorMessage.substring(0, 4000), null]); } catch (logErrorDb) { console.error('🔥🔥 Failed (again) to log internal error to query_errors database table (no queryId):', logErrorDb); }
        }
        // --- End: Log error to database ---


        // Send a response that the frontend can handle as an error
        // Always send 200 back to admin-ajax.php, let the 'success: false' flag indicate failure
        const statusCode = 200; // Keeping 200 for PHP proxy consistency


        // Determine a user-friendly error message for the frontend
        let userMessage = 'An internal error occurred during analysis. Please try again later.';
        // Keep user message generic unless specific user input validation error

        res.status(statusCode).json({
            success: false,
            message: userMessage,
            // Provide some limited detail in dev for debugging frontend, but rely on server logs/alerts for sensitive details.
             errorDetails: process.env.NODE_ENV !== 'production' ? { message: error.message, code: errorCode } : undefined
        });
    }
});

// Export the router to be used in app.js
export default router;