// File: /srv/staystra/ss-api/routes/property-analysis.js
// Description: Handles property analysis requests, calls AirDNA API, calculates projected revenues, and formats response.

// Load libraries using ESM syntax
import express from 'express';
import pool from '../db.js'; // Assuming db.js is needed for potential future features like rate limiting or history logging
import fetch from 'node-fetch'; // Make sure node-fetch is installed (`npm install node-fetch` in ss-api dir)
// Assuming auth middleware is imported and used in app.js for this router

const router = express.Router();

// --- Utility functions ---

// vary: Applies a small random percentage variation (currently not used in the main analysis logic, but kept as it was in source)
const vary = (value, maxPercent = 1.5) => {
    const percent = (Math.random() * maxPercent * 10) / 1000; // Generates a value between 0 and maxPercent/100
    const direction = Math.random() > 0.5 ? 1 : -1; // Randomly choose positive or negative direction
    // Apply variation only if value is a number and not zero
    if (typeof value !== 'number' || value === 0) return value;
    return value + (value * percent * direction);
};

// coordsAreTooClose: Calculates distance between two sets of coordinates (currently not used in analysis logic, kept for source fidelity)
const coordsAreTooClose = (lat1, lng1, lat2, lng2, thresholdMeters = 50) => {
    const earthRadius = 6371000; // in meters
    const latDelta = (lat2 - lat1) * Math.PI / 180;
    const lngDelta = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(latDelta / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) *
              Math.cos(lat2 * Math.PI / 180) *
              Math.sin(lngDelta / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (earthRadius * c) <= thresholdMeters;
};

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


// --- Main Analysis Endpoint ---
// This route handles POST requests to /analyze (which is mounted at /api/v1/property in app.js)
// Assumes authentication middleware has already run and validated the API key.
router.post('/analyze', async (req, res) => {
    // Extract input data from the request body (sent as JSON from PHP)
    const { address, bedrooms, bathrooms, occupancy } = req.body;

    // --- Input Validation ---
    // Basic validation for required fields
    if (!address) {
        console.warn('Analysis request missing address:', req.body); // Keep this warning
        // Always send 200 to PHP proxy, use success: false to indicate a user input error
        return res.status(200).json({
            success: false,
            message: 'Property address is required for analysis.' // User-friendly message for the frontend
        });
    }

    console.log('Received analysis request for address:', address); // Keep this log, helpful for tracking requests by address

    try {
        // --- Prepare & Call External API (AirDNA via RapidAPI) ---

        // Calculate accommodates/occupancy if not explicitly provided
        const beds = parseInt(bedrooms, 10) || 0;
        const calculatedOccupancy = (!occupancy && beds > 0) ? beds * 2 : (parseInt(occupancy, 10) || 0);

        // Prepare parameters for the AirDNA API request URL (expects query parameters for rentalizer endpoint)
        const params = new URLSearchParams({
            address: address,
            ...(beds > 0 && { bedrooms: beds }), // Only add if beds > 0
            ...(parseFloat(bathrooms) > 0 && { bathrooms: parseFloat(bathrooms) }), // Only add if bathrooms > 0
            ...(calculatedOccupancy > 0 && { accommodates: calculatedOccupancy }) // Only add if calculated occupancy > 0
        });

        // Construct the full AirDNA API URL
        const airdnaApiUrl = `${process.env.AIRDNA_BASE_URL || 'https://airdna1.p.rapidapi.com/rentalizer'}?${params}`;
        // console.log('🌐 Calling AirDNA API:', airdnaApiUrl); // Removed noisy log

        // Make the request to the AirDNA RapidAPI endpoint
        const airdnaResponse = await fetch(airdnaApiUrl, {
            method: 'GET', // Based on typical RapidAPI usage for rentalizer endpoint
            headers: {
                'x-rapidapi-host': 'airdna1.p.rapidapi.com',
                'x-rapidapi-key': process.env.RAPIDAPI_KEY, // Use the key from .env
                'User-Agent': 'StaySTRAAnalyzer/0.3' // Custom User-Agent
            }
        });

        // Check if the AirDNA API call itself was successful (HTTP status 2xx)
        if (!airdnaResponse.ok) {
            const errorBody = await airdnaResponse.text(); // Get raw error body
            console.error(`AirDNA RapidAPI call failed: Status ${airdnaResponse.status} - ${airdnaResponse.statusText}`, errorBody); // Keep error log

            // Attempt to send alert for external API failure
            await sendAlertToN8n({
                subject: '🚨 StaySTRA Analyzer External API Error',
                body: `AirDNA RapidAPI call failed for address: ${address}\n` +
                      `• Status: ${airdnaResponse.status} - ${airdnaResponse.statusText}\n` +
                      `• Response Body: ${errorBody.substring(0, 500)}...\n` + // Limit body length
                      `• Time: ${new Date().toISOString()}`
            });

            // Send a response that the frontend can handle as an error (200 status to PHP, success: false in JSON)
            return res.status(200).json({
                 success: false,
                 message: `External analysis service responded with an error (Status ${airdnaResponse.status}). Please try again later.` // User-friendly message
            });
        }


        // --- Process Raw AirDNA Response ---
        // Parse the JSON response from AirDNA
        const rawAirDnaResponse = await airdnaResponse.json();

        // Console log the raw response only in development environment for debugging if needed
        if (process.env.NODE_ENV !== 'production') {
             console.log('📦 Raw AirDNA Response (DEV ONLY):', JSON.stringify(rawAirDnaResponse, null, 2));
        }


        // Check if the raw response indicates an error or no data (e.g., RapidAPI subscription message, or no data found)
        // Check the top-level 'data' key exists and is a non-null object
        if (!rawAirDnaResponse || typeof rawAirDnaResponse.data !== 'object' || rawAirDnaResponse.data === null) {
             console.error('AirDNA returned data in unexpected format or missing main data key:', rawAirDnaResponse); // Keep error log
             // Attempt to send alert for unexpected data structure
             await sendAlertToN8n({
                subject: '⚠️ StaySTRA Analyzer Unexpected AirDNA Data',
                body: `AirDNA returned unexpected data structure (missing main data key) for address: ${address}\n` +
                      `• Raw Response: ${JSON.stringify(rawAirDnaResponse, null, 2).substring(0, 1000)}...\n` + // Limit body length
                      `• Time: ${new Date().toISOString()}`
            });
             // Send 200 to PHP/frontend with success: false and message
             return res.status(200).json({
                success: false,
                message: 'Analysis data format unexpected. Please try a different address or contact support.' // User-friendly message
             });
        }

        // AirDNA returns the actual data nested under a 'data' key
        const airDnaData = rawAirDnaResponse.data;


        // --- START: Validate Structure and Calculate Projected Revenues ---
        // Check if the main data object has required sub-objects like property_details, property_statistics, combined_market_info
        if (!airDnaData.property_details || !airDnaData.property_statistics || !airDnaData.combined_market_info) {
             console.error('AirDNA returned data in unexpected format or missing required sub-details (property_details, property_statistics, combined_market_info):', rawAirDnaResponse); // Keep error log
             // Attempt to send alert for unexpected data structure
             await sendAlertToN8n({
                subject: '⚠️ StaySTRA Analyzer Unexpected AirDNA Data',
                body: `AirDNA returned unexpected data structure (missing sub-details) for address: ${address}\n` +
                      `• Raw Response: ${JSON.stringify(rawAirDnaResponse, null, 2).substring(0, 1000)}...\n` + // Limit body length
                      `• Time: ${new Date().toISOString()}`
            });
             // Send 200 to PHP/frontend with success: false and message
             return res.status(200).json({
                success: false,
                message: 'No detailed analysis data found for this property or data format unexpected.' // User-friendly message
             });
        }


        // Extract necessary data using the correct variable name airDnaData
        const details = airDnaData.property_details || {};
        const stats = airDnaData.property_statistics || {};
        const comps = airDnaData.comps || []; // comps array is needed for percentile calculation
        const combinedMarketInfo = airDnaData.combined_market_info || {}; // For market names & scores

        // Ensure we have necessary market stats for calculation
        // Using optional chaining (?.) for safety if the structure is slightly off
        const marketRevenueLTM = stats.revenue?.ltm || 0; // For Typical calculation
        const marketCleaningLTM = stats.cleaning_fee?.ltm || 0; // For all calculations
        const marketOccupancyLTM = stats.occupancy?.ltm || 0; // For Top 25%/10% calculation (expressed as a decimal, e.g., 0.54)

        // console.log(`📊 Market Stats for Calculation: Revenue LTM=${marketRevenueLTM.toFixed(2)}, Cleaning LTM=${marketCleaningLTM.toFixed(2)}, Occupancy LTM=${(marketOccupancyLTM*100).toFixed(2)}%`); // Removed noisy log


        // 1. Calculate Average (Typical/50%) Projected Gross Revenue
        // Formula: property_statistics.revenue.ltm + property_statistics.cleaning_fee.ltm
        let calculatedRevenueTypical = marketRevenueLTM + marketCleaningLTM;
        // console.log(`📊 Calculated Revenue Typical (revenue.ltm + cleaning_fee.ltm): ${marketRevenueLTM.toFixed(2)} + ${marketCleaningLTM.toFixed(2)} = ${calculatedRevenueTypical.toFixed(2)}`); // Removed noisy log


        // 2. Calculate Top 25% and Top 10% Projected Gross Revenue
        let calculatedRevenueTop25 = 0;
        let calculatedRevenueTop10 = 0;

        // Filter comps to only include those with valid ADR > 0 for percentile calculation
        const compsWithADR = comps.filter(comp => comp.stats?.adr?.ltm > 0);
        // console.log(`📊 Found ${compsWithADR.length} comps with valid ADR for percentile calculation.`); // Removed noisy log


        // Perform top percentile calculation only if there are comps with ADR and market occupancy is positive
        if (compsWithADR.length > 0 && marketOccupancyLTM > 0) {
             // Sort comps by ADR descending (highest first)
             compsWithADR.sort((a, b) => b.stats.adr.ltm - a.stats.adr.ltm);

             // Determine the number of comps for the top 25% and top 10%.
             // Use Math.ceil to round up, ensuring at least one comp is included if compsWithADR.length > 0.
             // Use Math.max(1, ...) to ensure we take at least 1 comp if available.
             const numTop25 = Math.max(1, Math.ceil(compsWithADR.length * 0.25));
             const numTop10 = Math.max(1, Math.ceil(compsWithADR.length * 0.10));

             // Ensure we don't try to slice more comps than exist (slice handles exceeding array length gracefully, but explicit check is clearer)
             const actualNumTop25 = Math.min(numTop25, compsWithADR.length);
             const actualNumTop10 = Math.min(numTop10, compsWithADR.length);

             // Get the top comps arrays
             const top25Comps = compsWithADR.slice(0, actualNumTop25);
             const top10Comps = compsWithADR.slice(0, actualNumTop10);


             // Calculate average ADR for each subset
             const avgADRTop25 = top25Comps.length > 0 ? top25Comps.reduce((sum, comp) => sum + comp.stats.adr.ltm, 0) / top25Comps.length : 0;
             const avgADRTop10 = top10Comps.length > 0 ? top10Comps.reduce((sum, comp) => sum + comp.stats.adr.ltm, 0) / top10Comps.length : 0;

             // console.log(`📊 Avg ADR Top 25% (${top25Comps.length} comps): ${avgADRTop25.toFixed(2)}`); // Removed noisy log
             // console.log(`📊 Avg ADR Top 10% (${top10Comps.length} comps): ${avgADRTop10.toFixed(2)}`); // Removed noisy log


             // Calculate projected revenue for top tiers
             // Formula: AvgADR * MarketOccupancy * 365 + MarketCleaningFee
             calculatedRevenueTop25 = (avgADRTop25 * marketOccupancyLTM * 365) + marketCleaningLTM;
             calculatedRevenueTop10 = (avgADRTop10 * marketOccupancyLTM * 365) + marketCleaningLTM;

             // console.log(`📊 Calculated Revenue Top 25%: (${avgADRTop25.toFixed(2)} * ${(marketOccupancyLTM*100).toFixed(2)}% * 365) + ${marketCleaningLTM.toFixed(2)} = ${calculatedRevenueTop25.toFixed(2)}`); // Removed noisy log
             // console.log(`📊 Calculated Revenue Top 10%: (${avgADRTop10.toFixed(2)} * ${(marketOccupancyLTM*100).toFixed(2)}% * 365) + ${marketCleaningLTM.toFixed(2)} = ${calculatedRevenueTop10.toFixed(2)}`); // Removed noisy log

        } else {
             console.warn('⚠️ Not enough comps with ADR or market occupancy is zero to calculate top percentile revenues. Setting Top 25% and Top 10% to 0.'); // Keep this warning
        }

        // 3. Apply Randomness (+/- 0-1%)
        // The randomness factor should be between -0.01 and +0.01 (for +/- 1%)
        // Applies only if the calculated value is > 0.
        const applyRandomness = (value) => {
             if (value <= 0) return value; // Don't apply randomness to zero or negative values
             const randomFactor = (Math.random() * 0.02) - 0.01; // Generates a number between -0.01 and +0.01
             const result = value * (1 + randomFactor);
             // console.log(`✨ Applying randomness to ${value.toFixed(2)}. Factor: ${(randomFactor*100).toFixed(2)}%. Result: ${result.toFixed(2)}`); // Removed noisy log
             return result; // Return as number
        };

        calculatedRevenueTypical = applyRandomness(calculatedRevenueTypical);
        calculatedRevenueTop25 = applyRandomness(calculatedRevenueTop25);
        calculatedRevenueTop10 = applyRandomness(calculatedRevenueTop10);

        console.log(`✅ Final Calculated Projected Revenues: Typical=$${calculatedRevenueTypical.toFixed(2)}, Top25=$${calculatedRevenueTop25.toFixed(2)}, Top10=$${calculatedRevenueTop10.toFixed(2)}`); // Keep this log, shows the final calculated numbers


        // --- END: Validate Structure and Calculate Projected Revenues ---


        // --- Format Response for Frontend ---
        // Structure the data to send back to the frontend JavaScript.
        // This object will be the 'data' property inside the { success: true, data: ... } payload sent to PHP
        const formattedResponse = {
            // Include the core data extracted from AirDNA that the frontend needs
            // Accessing these directly from airDnaData aliases
            property_details: details, // Using the 'details' alias created above
            property_statistics: stats, // Using the 'stats' alias created above
            comps: comps, // frontend needs the full comps array for the list display, using the 'comps' alias
            airdna_market_name: combinedMarketInfo.airdna_market_name, // Using 'combinedMarketInfo' alias
            airdna_submarket_name: combinedMarketInfo.submarket_name, // Using 'combinedMarketInfo' alias - CORRECTED: submarket_name
            market_score: combinedMarketInfo.market_score, // Using 'combinedMarketInfo' alias
            submarket_score: combinedMarketInfo.submarket_score, // Using 'combinedMarketInfo' alias

            // Add calculated simple ARD/Occupancy strings for backward compatibility if needed, or remove if frontend calculates
            // The frontend currently derives/formats these from property_statistics, so can keep or remove here. Keeping for robustness.
            ard: stats.adr?.ltm ? `$${stats.adr.ltm.toFixed(0)}` : 'N/A', // Using 'stats' alias
            occupancy: stats.occupancy?.ltm ? `${(stats.occupancy.ltm * 100).toFixed(0)}%` : 'N/A', // Using 'stats' alias


            // === ADD THE CALCULATED REVENUE FIELDS TO THE RESPONSE ===
            // Ensure these keys match exactly what the frontend analyzer.js expects (projected_revenue_typical, etc.)
            projected_revenue_typical: calculatedRevenueTypical,
            projected_revenue_top_25: calculatedRevenueTop25,
            projected_revenue_top_10: calculatedRevenueTop10,
            // ==========================================================
        };

        // console.log('✅ Formatted Response sent to frontend:', formattedResponse); // Removed noisy log


        // --- Send Formatted Response Back to WordPress Backend ---
        // Your API's successful response should wrap the formatted data
        // This response structure ({ success: true, data: ... }) is expected by the frontend/PHP proxy
        res.json({
            success: true, // Indicate success from your API's perspective
            message: 'Analysis completed', // Optional success message
            data: formattedResponse // Send the newly formatted data payload
        });


    } catch (error) {
        // --- Handle Internal API Errors (e.g., network issues before fetch, parsing errors, DB errors if added) ---
        console.error('📈 Internal Property analysis error:', error); // Keep this error log

        // Attempt to send alert for internal API failure
        await sendAlertToN8n({
            subject: '🔥 StaySTRA Analyzer Internal API Error',
            body: `Internal error during analysis for address: ${address || 'N/A'}\n` + // address might be undefined
                  `• Error: ${error.stack || error.message}\n` + // Include stack trace if available
                  `• Time: ${new Date().toISOString()}`
        });

        // Send a response that the frontend can handle as an error
        // Always send 200 back to admin-ajax.php, let the 'success: false' flag indicate failure
        const statusCode = 200; // Keeping 200 for PHP proxy consistency


        // Determine a user-friendly error message
        let userMessage = 'An internal error occurred during analysis. Please try again later.';
         if (process.env.NODE_ENV !== 'production' && error.message) {
             userMessage += ` (Details: ${error.message})`; // Add details in non-prod logs/alerts, NOT typically in the user message itself
         }

        res.status(statusCode).json({
            success: false, // Indicate failure from your API's perspective
            message: userMessage, // User-friendly message for the frontend
            // Optionally include detailed error in non-prod env, but better to rely on logs/alerts
            // error: process.env.NODE_ENV !== 'production' ? { message: error.message, stack: error.stack } : undefined
        });
    }
});

// Export the router to be used in app.js
export default router;