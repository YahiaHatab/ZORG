# ZORG-Ω | Architect v6.0 Modular

## Project Overview
**ZORG-Ω** is a specialized, modular data scraping and standardization suite built with **Node.js** and **Express**. It is designed to harvest exhibitor information from various trade show and exhibition platforms (e.g., Messe Düsseldorf, Informa Markets, Map-Dynamics) and output standardized, deduplicated Excel files.

The project features a sleek, TailwindCSS-powered frontend integrated directly into the backend for a seamless "Architect" experience.

### Main Technologies
- **Backend:** Node.js, Express
- **Scraping/HTTP:** Axios, p-limit (concurrency management)
- **Data Processing:** XLSX, ExcelJS
- **Frontend:** HTML5, TailwindCSS (via CDN), Live Telemetry (real-time logging)

## Project Structure
- `app.js`: The central hub containing the Express server, API routes (`/run`, `/logs`, `/shutdown`), and the embedded frontend UI.
- `Engines/`: A directory of modular scraper "engines." Each file handles the logic for a specific platform:
  - `Algolia.js`: Targets NürnbergMesse (via Algolia API).
  - `Cadmium.js`: Harvester for Cadmium-based event sites.
  - `Dusseldorf.js`: Specifically for the Messe Düsseldorf API.
  - `Eshow.js`: Concurrent scraper for eShow platforms using Bearer tokens.
  - `Informa.js`: API-based scraper for Informa Markets.
  - `MapDynamics.js`: Scraper for Map-Dynamics marketplaces with "Deep Recovery."
- `Utils/`: Utility functions.
  - `helpers.js`: Contains `findBoothDeeply`, a recursive object traverser for finding booth numbers in complex JSON responses.
- `Icons/`: Static assets like `favicon.ico`.

## Building and Running

### Prerequisites
- Node.js (Version 24.x included in the project directory)

### Installation
Install the necessary dependencies from `package.json`:
```powershell
npm install
```
Alternatively, use the provided batch file:
```powershell
.\install_requirements.bat
```

### Running the Application
Start the server:
```powershell
node app.js
```
Or use the start script:
```powershell
.\Start.bat
```
The application will be available at `http://localhost:3000`.

## Development Conventions

### Standardized Output
All engines are expected to return an array of objects that the main `/run` route in `app.js` then standardizes into the following columns:
- `Exhibitor Name`
- `Phone Number`
- `Country`
- `Contact Name`
- `Email`
- `Mails` (Address/City)
- `Booth`
- `Website`

### Telemetry & Logging
The project uses a global `emitLog` function to send real-time updates to the frontend's "Live Telemetry" box. New engines should accept `emitLog` as a parameter to maintain visibility into the scraping process.

### Modularity
When adding a new engine:
1. Create a new `.js` file in `Engines/`.
2. Export a single async function that takes the necessary credentials/IDs and `emitLog`.
3. Import and wire the engine into the `/run` route and the frontend `<select>` in `app.js`.
