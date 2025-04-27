// File: /srv/staystra/ss-api/src/utils/analysisCalculations.js
// Description: Contains functions for calculating projected revenues based on AirDNA data.

/**
 * Calculates typical, top 25%, and top 10% projected gross revenues
 * based on AirDNA property statistics and comparable properties (comps).
 * Applies a small random variation to the final results.
 *
 * @param {object} stats - The property_statistics object from AirDNA response.
 * @param {Array<object>} comps - The comps array from AirDNA response.
 * @returns {object} An object containing the calculated revenue figures.
 */
export function calculateRevenues(stats, comps) {

    // Extract necessary market stats for calculation from the 'stats' input object
    // Use default values (0) if data is missing to prevent errors
    const marketRevenueLTM = stats?.revenue?.ltm || 0; // Last Twelve Months Revenue (used for Typical)
    const marketCleaningLTM = stats?.cleaning_fee?.ltm || 0; // Last Twelve Months Cleaning Fee (used in all calculations)
    const marketOccupancyLTM = stats?.occupancy?.ltm || 0; // Last Twelve Months Occupancy (as decimal, e.g., 0.54)

    // console.log(`📊 Market Stats for Calculation: Revenue LTM=${marketRevenueLTM.toFixed(2)}, Cleaning LTM=${marketCleaningLTM.toFixed(2)}, Occupancy LTM=${(marketOccupancyLTM*100).toFixed(2)}%`); // Re-add if needed for debugging this file


    // 1. Calculate Average (Typical/50%) Projected Gross Revenue
    // Formula: property_statistics.revenue.ltm + property_statistics.cleaning_fee.ltm
    let calculatedRevenueTypical = marketRevenueLTM + marketCleaningLTM;
    // console.log(`📊 Calculated Revenue Typical (revenue.ltm + cleaning_fee.ltm): ${marketRevenueLTM.toFixed(2)} + ${marketCleaningLTM.toFixed(2)} = ${calculatedRevenueTypical.toFixed(2)}`); // Re-add if needed for debugging this file


    // 2. Calculate Top 25% and Top 10% Projected Gross Revenue
    let calculatedRevenueTop25 = 0;
    let calculatedRevenueTop10 = 0;

    // Filter comps to only include those with valid ADR > 0 for percentile calculation
    const compsWithADR = comps.filter(comp => comp.stats?.adr?.ltm > 0);
    // console.log(`📊 Found ${compsWithADR.length} comps with valid ADR for percentile calculation.`); // Re-add if needed for debugging this file


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

         // Get the top comps arrays by slicing the sorted array
         const top25Comps = compsWithADR.slice(0, actualNumTop25);
         const top10Comps = compsWithADR.slice(0, actualNumTop10);


         // Calculate average ADR for each subset
         const avgADRTop25 = top25Comps.length > 0 ? top25Comps.reduce((sum, comp) => sum + comp.stats.adr.ltm, 0) / top25Comps.length : 0;
         const avgADRTop10 = top10Comps.length > 0 ? top10Comps.reduce((sum, comp) => sum + comp.stats.adr.ltm, 0) / top10Comps.length : 0;

         // console.log(`📊 Avg ADR Top 25% (${top25Comps.length} comps): ${avgADRTop25.toFixed(2)}`); // Re-add if needed for debugging this file
         // console.log(`📊 Avg ADR Top 10% (${top10Comps.length} comps): ${avgADRTop10.toFixed(2)}`); // Re-add if needed for debugging this file


         // Calculate projected revenue for top tiers
         // Formula: AvgADR * MarketOccupancy * 365 + MarketCleaningFee
         calculatedRevenueTop25 = (avgADRTop25 * marketOccupancyLTM * 365) + marketCleaningLTM;
         calculatedRevenueTop10 = (avgADRTop10 * marketOccupancyLTM * 365) + marketCleaningLTM;

         // console.log(`📊 Calculated Revenue Top 25%: (${avgADRTop25.toFixed(2)} * ${(marketOccupancyLTM*100).toFixed(2)}% * 365) + ${marketCleaningLTM.toFixed(2)} = ${calculatedRevenueTop25.toFixed(2)}`); // Re-add if needed for debugging this file
         // console.log(`📊 Calculated Revenue Top 10%: (${avgADRTop10.toFixed(2)} * ${(marketOccupancyLTM*100).toFixed(2)}% * 365) + ${marketCleaningLTM.toFixed(2)} = ${calculatedRevenueTop10.toFixed(2)}`); // Re-add if needed for debugging this file

    } else {
         // Console.warn is fine here as it's internal calculation logic
         console.warn('⚠️ analysisCalculations: Not enough comps with ADR or market occupancy is zero to calculate top percentile revenues. Setting Top 25% and Top 10% to 0.');
    }

    // 3. Apply Randomness (+/- 0-1%)
    // The randomness factor should be between -0.01 and +0.01 (for +/- 1%)
    // Applies only if the calculated value is > 0.
    const applyRandomness = (value) => {
         if (value <= 0) return value; // Don't apply randomness to zero or negative values
         const randomFactor = (Math.random() * 0.02) - 0.01; // Generates a number between -0.01 and +0.01
         const result = value * (1 + randomFactor);
         // console.log(`✨ Applying randomness to ${value.toFixed(2)}. Factor: ${(randomFactor*100).toFixed(2)}%. Result: ${result.toFixed(2)}`); // Re-add if needed for debugging this file
         return result; // Return as number
    };

    // Apply randomness to the calculated values
    calculatedRevenueTypical = applyRandomness(calculatedRevenueTypical);
    calculatedRevenueTop25 = applyRandomness(calculatedRevenueTop25);
    calculatedRevenueTop10 = applyRandomness(calculatedRevenueTop10);

    // console.log(`✅ analysisCalculations: Final Calculated Projected Revenues: Typical=$${calculatedRevenueTypical.toFixed(2)}, Top25=$${calculatedRevenueTop25.toFixed(2)}, Top10=$${calculatedRevenueTop10.toFixed(2)}`); // Re-add if needed for debugging this file


    // Return the final calculated revenue figures
    return {
        typicalRevenue: calculatedRevenueTypical,
        top25Revenue: calculatedRevenueTop25,
        top10Revenue: calculatedRevenueTop10,
        // Note: projectedADR is not calculated here based on your original code.
        // It seems to be taken directly from stats.adr.ltm in property-analysis.js
    };
}