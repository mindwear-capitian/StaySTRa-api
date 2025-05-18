// file: ss-api/routes/location-details.js
// File name: location-details.js
// This file contains the route for fetching location details
// for a specific area_id. It queries multiple tables to gather
// the necessary information and returns it in a structured JSON format.
import express from 'express';
import { getPool } from '../db.js'; // Assuming your pg pool is exported from db.js

const router = express.Router();
const pool = getPool();

router.get('/:area_id', async (req, res) => {
    const { area_id } = req.params;
    const areaIdInt = parseInt(area_id, 10);

    if (isNaN(areaIdInt)) {
        return res.status(400).json({ error: 'Invalid area_id format. Must be an integer.' });
    }

    try {
        // 1. Fetch from `areas` table
        const areaInfoQuery = `
            SELECT area_id, city_name, state_name 
            FROM areas
            WHERE area_id = $1;
        `;
        const areaInfoResult = await pool.query(areaInfoQuery, [areaIdInt]);

        if (areaInfoResult.rowCount === 0) {
            return res.status(404).json({ error: `Area with ID ${areaIdInt} not found.` });
        }
        const areaBaseInfo = areaInfoResult.rows[0];

        // 2. Fetch from `area_profiles` table
        const areaProfileQuery = `
            SELECT population, annual_visitors, regulations_text, top_attractions, visitor_profile_summary
            FROM area_profiles
            WHERE area_id = $1;
        `;
        const areaProfileResult = await pool.query(areaProfileQuery, [areaIdInt]);
        const areaProfileInfo = areaProfileResult.rows[0] || {};

        // 3. Fetch from `rental_growth` (Latest Total STRs for market_summary)
        const latestRentalGrowthQuery = `
            SELECT listing_count
            FROM rental_growth
            WHERE area_id = $1
            ORDER BY snapshot_date DESC
            LIMIT 1;
        `;
        const latestRentalGrowthResult = await pool.query(latestRentalGrowthQuery, [areaIdInt]);
        const totalStrs = latestRentalGrowthResult.rows[0] ? parseInt(latestRentalGrowthResult.rows[0].listing_count, 10) : null;

        // 4. Fetch from `monthly_market_metrics` (Latest single values for market_summary)
        const latestMetricsQuery = `
            SELECT adr, occupancy, revenue AS avg_monthly_revenue_per_property
            FROM monthly_market_metrics
            WHERE area_id = $1
            ORDER BY year DESC, month DESC
            LIMIT 1;
        `;
        const latestMetricsResult = await pool.query(latestMetricsQuery, [areaIdInt]);
        const latestMarketMetrics = latestMetricsResult.rows[0] || {};

        // 5. Fetch from `monthly_market_metrics` (Last 12 months for charts)
        const historicalPerformanceQuery = `
            SELECT year, month, adr, occupancy, revenue AS avg_monthly_revenue_per_property
            FROM monthly_market_metrics
            WHERE area_id = $1
            ORDER BY year DESC, month DESC
            LIMIT 12;
        `;
        const historicalPerformanceResult = await pool.query(historicalPerformanceQuery, [areaIdInt]);
        const monthlyPerformanceMetrics = historicalPerformanceResult.rows.reverse().map(row => ({
            year: parseInt(row.year, 10),
            month: parseInt(row.month, 10),
            adr: parseFloat(row.adr) || 0,
            occupancy: parseFloat(row.occupancy) || 0,
            avg_monthly_revenue_per_property: parseFloat(row.avg_monthly_revenue_per_property) || 0
        }));

        
        // 6. Fetch from `active_listings` (Latest breakdown by bedroom count)
        const activeListingsQuery = `
            SELECT
                COALESCE(entire_place_0, 0) AS entire_place_0_beds,
                COALESCE(entire_place_1, 0) AS entire_place_1_beds,
                COALESCE(entire_place_2, 0) AS entire_place_2_beds,
                COALESCE(entire_place_3, 0) AS entire_place_3_beds,
                COALESCE(entire_place_4, 0) AS entire_place_4_beds,
                COALESCE(entire_place_5, 0) AS entire_place_5_plus_beds,
                COALESCE(entire_place_all, 0) AS entire_place_total_listings,
                COALESCE(private_room_0, 0) AS private_room_0_beds,
                COALESCE(private_room_1, 0) AS private_room_1_beds,
                COALESCE(private_room_2, 0) AS private_room_2_beds,
                COALESCE(private_room_3, 0) AS private_room_3_beds,
                COALESCE(private_room_4, 0) AS private_room_4_beds,
                COALESCE(private_room_5, 0) AS private_room_5_plus_beds,
                COALESCE(private_room_all, 0) AS private_room_total_listings,
                COALESCE(hotel_room_1, 0) AS hotel_room_1_beds,
                COALESCE(hotel_room_2, 0) AS hotel_room_2_beds,
                COALESCE(hotel_room_3, 0) AS hotel_room_3_beds,
                COALESCE(hotel_room_4, 0) AS hotel_room_4_beds,
                COALESCE(hotel_room_5, 0) AS hotel_room_5_plus_beds,
                COALESCE(hotel_room_all, 0) AS hotel_room_total_listings,
                COALESCE(shared_room_0, 0) AS shared_room_0_beds,
                COALESCE(shared_room_1, 0) AS shared_room_1_beds,
                COALESCE(shared_room_2, 0) AS shared_room_2_beds,
                COALESCE(shared_room_all, 0) AS shared_room_total_listings
            FROM active_listings
            WHERE area_id = $1
            ORDER BY year DESC, month DESC
            LIMIT 1;
        `;
        const activeListingsResult = await pool.query(activeListingsQuery, [areaIdInt]);
        const listingsBreakdown = activeListingsResult.rows[0] || {};

        let byBedroomArray = [];
        if (listingsBreakdown) {
             byBedroomArray = [ // This needs to be refined based on how you want to sum different room types per bedroom count
                { bedrooms: "Studio/0bd", count: parseInt(listingsBreakdown.entire_place_0_count || 0, 10) },
                { bedrooms: "1bd", count: parseInt(listingsBreakdown.entire_place_1_count || 0, 10) },
                { bedrooms: "2bd", count: parseInt(listingsBreakdown.entire_place_2_count || 0, 10) },
                { bedrooms: "3bd", count: parseInt(listingsBreakdown.entire_place_3_count || 0, 10) },
                { bedrooms: "4bd", count: parseInt(listingsBreakdown.entire_place_4_count || 0, 10) },
                { bedrooms: "5bd+", count: parseInt(listingsBreakdown.entire_place_5_count || 0, 10) }
            ];
        }

        // 7. Fetch from `market_grades` (Rental Demand for market_summary)
        const marketGradesQuery = `
            SELECT rental_demand
            FROM market_grades
            WHERE area_id = $1
            ORDER BY snapshot_date DESC
            LIMIT 1;
        `;
        const marketGradesResult = await pool.query(marketGradesQuery, [areaIdInt]);
        const rentalDemandScore = marketGradesResult.rows[0] ? parseFloat(marketGradesResult.rows[0].rental_demand) : null;

        // --- NEW QUERIES START HERE ---

        // 8. Fetch Rental Growth (Quarterly for up to last 10 years)
        const rentalGrowthQueryHistorical = `
            SELECT
                DATE_PART('year', snapshot_date) AS year,
                DATE_PART('quarter', snapshot_date) AS quarter,
                AVG(listing_count)::numeric(10,0) AS avg_listing_count 
            FROM rental_growth
            WHERE area_id = $1 AND snapshot_date >= NOW() - INTERVAL '10 years'
            GROUP BY DATE_PART('year', snapshot_date), DATE_PART('quarter', snapshot_date)
            ORDER BY year DESC, quarter DESC;
        `;
        const rentalGrowthHistoricalResult = await pool.query(rentalGrowthQueryHistorical, [areaIdInt]);
        const rentalGrowthData = rentalGrowthHistoricalResult.rows.map(r => ({
            year: parseInt(r.year, 10),
            quarter: parseInt(r.quarter, 10),
            listing_count: parseInt(r.avg_listing_count, 10)
        }));

        // 9. Fetch LTM Metrics (Latest record)
        const ltmMetricsQuery = `
            SELECT ltm_adr, ltm_occupancy, ltm_revenue, year AS as_of_year, month AS as_of_month, created_at AS snapshot_date
            FROM ltm_metrics
            WHERE area_id = $1
            ORDER BY year DESC, month DESC, created_at DESC
            LIMIT 1;
        `;
        const ltmMetricsResult = await pool.query(ltmMetricsQuery, [areaIdInt]);
        const ltmData = ltmMetricsResult.rows[0] || {};

        // 10. Fetch Rental Activity (Latest record) - Select all columns
        const rentalActivityQuery = `SELECT * FROM rental_activity WHERE area_id = $1 ORDER BY snapshot_date DESC, created_at DESC LIMIT 1;`;
        const rentalActivityResult = await pool.query(rentalActivityQuery, [areaIdInt]);
        const rentalActivityData = rentalActivityResult.rows[0] || {};

        // 11. Fetch Rental Amenities (Latest record) - Select all columns
        const rentalAmenitiesQuery = `SELECT * FROM rental_amenities WHERE area_id = $1 ORDER BY snapshot_date DESC, created_at DESC LIMIT 1;`;
        const rentalAmenitiesResult = await pool.query(rentalAmenitiesQuery, [areaIdInt]);
        const rentalAmenitiesData = rentalAmenitiesResult.rows[0] || {};

        // 12. Fetch Rental Ratings (Latest record) - Select all columns
        const rentalRatingsQuery = `SELECT * FROM rental_ratings WHERE area_id = $1 ORDER BY snapshot_date DESC, created_at DESC LIMIT 1;`;
        const rentalRatingsResult = await pool.query(rentalRatingsQuery, [areaIdInt]);
        const rentalRatingsData = rentalRatingsResult.rows[0] || {};

        // 13. Fetch Rental Settings (Latest record) - Select all columns
        const rentalSettingsQuery = `SELECT * FROM rental_settings WHERE area_id = $1 ORDER BY snapshot_date DESC, created_at DESC LIMIT 1;`;
        const rentalSettingsResult = await pool.query(rentalSettingsQuery, [areaIdInt]);
        const rentalSettingsData = rentalSettingsResult.rows[0] || {};

        // --- END OF NEW QUERIES ---

        // Assemble the final JSON response
        const responseJson = {
            area_id: areaBaseInfo.area_id,
            name: areaBaseInfo.city_name,
            slug: null, 
            state: areaBaseInfo.state_name,
            profile: {
                population: areaProfileInfo.population || null,
                annual_visitors: areaProfileInfo.annual_visitors || null,
                regulations_text: areaProfileInfo.regulations_text || null,
                top_attractions: areaProfileInfo.top_attractions || null,
                visitor_profile_summary: areaProfileInfo.visitor_profile_summary || null,
            },
            market_summary: {
                total_strs: totalStrs,
                adr: parseFloat(latestMarketMetrics.adr) || null,
                occupancy_rate: parseFloat(latestMarketMetrics.occupancy) || null,
                avg_monthly_revenue_per_property: parseFloat(latestMarketMetrics.avg_monthly_revenue_per_property) || null,
                rental_demand_score: rentalDemandScore,
            },
            by_bedroom_distribution: listingsBreakdown,
            historical_performance_monthly: {
                description: "Last 12 individual months of performance metrics.",
                metrics: monthlyPerformanceMetrics
            },
            rental_growth_quarterly: {
                description: "Quarterly listing counts for up to the last 10 years.",
                metrics: rentalGrowthData
            },
            ltm_metrics: {
                description: "Latest aggregated Last Twelve Months (LTM) performance metrics.",
                adr: parseFloat(ltmData.ltm_adr) || null,
                occupancy_rate: parseFloat(ltmData.ltm_occupancy) || null,
                revenue: parseFloat(ltmData.ltm_revenue) || null,
                as_of_year: parseInt(ltmData.as_of_year, 10) || null,
                as_of_month: parseInt(ltmData.as_of_month, 10) || null,
                snapshot_date: ltmData.snapshot_date || null
            },
            rental_activity: { // Spreading data, ensure no sensitive/unwanted columns like 'id', 'area_id' if not desired
                description: "Latest snapshot of rental booking activity patterns.",
                ...rentalActivityData
            },
            rental_amenities_distribution: {
                description: "Latest snapshot of percentage of listings offering specific amenities.",
                ...rentalAmenitiesData
            },
            guest_ratings_summary: {
                description: "Latest snapshot of guest rating scores and distribution.",
                ...rentalRatingsData
            },
            rental_settings_summary: {
                description: "Latest snapshot of common rental settings like cancellation policies and minimum stays.",
                ...rentalSettingsData
            }
        };

        res.json(responseJson);

    } catch (err) {
        console.error(`API Error fetching details for area_id ${areaIdInt}:`, err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export { router as locationDetailsRouter };