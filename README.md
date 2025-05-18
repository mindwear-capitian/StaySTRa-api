# StaySTRa API (ss-api)

The StaySTRa API provides backend services for short-term rental (STR) analysis. It offers endpoints for market statistics, individual property analysis, and detailed location insights. The API is built with Node.js and Express, and it utilizes external services for comprehensive data.

## Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v20 or higher, as per `Dockerfile`)
- npm (comes with Node.js)
- Docker & Docker Compose (v2 or later, for containerized deployment and management)
- PostgreSQL (database server, typically run as a Docker container via Docker Compose)
- PM2 (Process Manager for Node.js - used within the Docker container for running the app)

## Project Structure

The API code resides in the `/srv/staystra/ss-api` directory on the deployment server. It is managed as part of a larger Docker Compose setup defined in `/srv/staystra/docker-compose.unified.yml`.

## Setup & Environment Variables

1.  **Clone the repository (if setting up from scratch):**
    ```bash
    git clone https://github.com/mindwear-capitian/StaySTRa-api.git
    cd StaySTRa-api 
    ```
    *(Note: On the production server, this code is likely already present at `/srv/staystra/ss-api/`)*

2.  **Environment Variables**:
    The API requires several environment variables for configuration. These are primarily managed through:
    *   The main `.env` file in the `/srv/staystra/` directory (used by Docker Compose).
    *   A service-specific `.env` file at `/srv/staystra/ss-api/.env` (referenced by `env_file` in `docker-compose.unified.yml` for the `ss-api` service).

    Key environment variables needed by `ss-api` include:
    *   `DATABASE_URL`: Connection string for your PostgreSQL database (e.g., `postgresql://staystra:yourpassword@ss-postgres:5432/staystra?sslmode=disable`).
    *   `PORT`: The internal port the application will listen on (e.g., `3000`).
    *   `YOUR_API_KEY_NAME_FOR_RAPIDAPI`: (Replace with actual variable name) Your API key for RapidAPI services (like AirDNA).
    *   `EXTERNAL_ANALYSIS_BASE_URL`: Base URL for the external analysis service (e.g., AirDNA).
    *   `EXTERNAL_ANALYSIS_API_HOST`: Host for the external analysis service (e.g., `airdna1.p.rapidapi.com`).
    *   *(Add any other critical environment variables your ss-api directly uses)*

## Running the API (with Docker Compose on Hostinger VPS)

The primary way this API is run and managed is via Docker Compose using the `docker-compose.unified.yml` file located in `/srv/staystra/`.

1.  **Navigate to the Docker Compose directory:**
    ```bash
    cd /srv/staystra/
    ```

2.  **Build/Rebuild the `ss-api` image (if code changes are made):**
    ```bash
    docker compose -f docker-compose.unified.yml build ss-api
    ```

3.  **Start/Restart the `ss-api` service (and its dependencies):**
    To start all services defined in the compose file:
    ```bash
    docker compose -f docker-compose.unified.yml up -d
    ```
    To specifically (re)start and recreate only the `ss-api` service after a build:
    ```bash
    docker compose -f docker-compose.unified.yml up -d --force-recreate ss-api
    ```

4.  **View Logs:**
    ```bash
    docker logs staystra-ss-api --tail 100 --timestamps
    ```

## API Endpoints

All API endpoints (except `/health`) require an API key for authentication. The key must be passed in the `X-API-KEY` HTTP header (or the specific header name configured in `middleware/auth.js`).

### Health Check

*   **Endpoint**: `GET /health`
*   **Description**: Checks the operational status of the API.
*   **Authentication**: None.
*   **Success Response (200 OK)**:
    ```json
    { "status": "ok" }
    ```

### Location Details

*   **Endpoint**: `GET /api/v1/location-details/:area_id`
*   **Description**: Retrieves comprehensive market data, statistics, and profile information for a specific geographic area.
*   **Authentication**: `X-API-KEY` header required.
*   **URL Parameters**:
    *   `area_id` (integer, required): The unique identifier for the area from the `areas` table.
*   **Success Response (200 OK)**:
    *Refer to the example JSON output provided during testing. Key sections include:*
    ```json
    {
      "area_id": 79503,
      "name": "Austin",
      "slug": null, // Currently null, may be populated in future
      "state": "Texas",
      "profile": { /* ... population, visitor info, regulations ... */ },
      "market_summary": { /* ... total_strs, adr, occupancy, avg_revenue, demand_score ... */ },
      "by_bedroom_distribution": { /* ... detailed counts for entire_place_X_beds, private_room_X_beds, etc. ... */ },
      "historical_performance_monthly": { /* ... last 12 months ADR, occupancy, revenue ... */ },
      "rental_growth_quarterly": { /* ... last 10 years quarterly listing counts ... */ },
      "ltm_metrics": { /* ... latest LTM ADR, occupancy, revenue ... */ },
      "rental_activity": { /* ... latest snapshot of booking activity ... */ },
      "rental_amenities_distribution": { /* ... latest snapshot of amenity percentages ... */ },
      "guest_ratings_summary": { /* ... latest snapshot of guest ratings ... */ },
      "rental_settings_summary": { /* ... latest snapshot of cancellation/min_stay policies ... */ }
    }
    ```
*   **Error Responses**:
    *   `400 Bad Request`: If `area_id` is not a valid integer.
    *   `401 Unauthorized`: If API key is missing or invalid.
    *   `404 Not Found`: If the `area_id` does not exist.
    *   `500 Internal Server Error`: If an unexpected error occurs on the server.

### Market Statistics (from `routes/stats.js`)

*   **Base Path**: `/api/v1/markets` (as defined in `app.js` for `statsRouter`)
*   **Authentication**: `X-API-KEY` header required.
*   **Endpoints**:
    *   **GET `/`**: Retrieves all rows from `active_listings`. *(Consider if this is too much data or if it needs refinement/pagination)*.
    *   **GET `/:slug/stats`**: Retrieves `id` from `areas` table based on `slug`, then all `active_listings` for that `area_id`. *(This also returns raw listings; consider if aggregations are needed here too)*.

### Property Analysis (from `routes/property-analysis.js`)

*   **Base Path**: `/api/v1/property` (as defined in `app.js` for `propertyAnalysisRouter`)
*   **Authentication**: `X-API-KEY` header required.
*   **Endpoints**:
    *   **POST `/analyze`**: (Assuming method is POST based on typical analysis requests)
        *   Description: Performs a short-term rental analysis for a given property.
        *   Request Body (JSON):
            ```json
            {
              "address": "123 Main St, Anytown, USA",
              "bedrooms": 3,
              "bathrooms": 2,
              "accommodates": 6
              // ... any other relevant parameters ...
            }
            ```
        *   *(Describe success response structure)*
