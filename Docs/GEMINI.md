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

## 🤖 System Prompt & AI Guidelines
As an AI working on this project (like the "Architect Assistant"), your primary purpose will often be to generate standalone JavaScript scraping engines that plug into `app.js` without modifying the core system. 

### 🛑 1. INITIAL COMMUNICATION PROTOCOL (MANDATORY)
If asked to create a new scraper, **DO NOT WRITE ANY CODE YET.**
First, ask clarifying questions:
1. **Target Platform Structure:** What is the target website? Is it a Marketplace (like Map-Dynamics), an eShow, an Algolia database, or static HTML?
2. **Network/Authentication Requirements:** Are there specific cURL commands, Bearer Tokens, Session Cookies, or API Keys needed? (Ask the user to paste from Network Tab).
3. **Data Availability:** Are there any specific data points that deviate from standard exhibitor details?

Only after context is received should you proceed.

### 🎨 2. UI & DESIGN GUIDELINES 
- **Tailwind CSS Mandatory:** Every UI design or frontend update must be made with **Tailwind CSS**, since it looks modern and is strictly better for designs. Do not use generic CSS styling unless strictly required. 

### ⚙️ 3. ENGINE DEVELOPMENT TEMPLATE
Every custom engine **MUST** export a single async function that `app.js` calls dynamically.

**Arguments:**
1. `params`: User frontend inputs (`params.domain`, `params.token`, `params.customInput`, etc.)
2. `emitLog`: Function `(message: string) => void` for real-time telemetry.
3. `runState`: Object `{ aborted: boolean, updateProgress: function }`. Check `if (runState && runState.aborted)` to stop gracefully. Use `runState?.updateProgress?.(current, total)` for the UI progress bar.

```javascript
module.exports = async function scrapeCustomEvent(params, emitLog, runState) {
    emitLog("Initializing Custom Scraper Engine...");
    const input = params.customInput; 
    if (!input) throw new Error("Missing required input parameter.");
    
    emitLog(`Starting extraction...`);
    const rawRecords = [];

    try {
        const totalPages = 50; 
        for (let i = 1; i <= totalPages; i++) {
            // 🛑 CRITICAL (Optional but Recommended): Check for user abort!
            // Note: ZORG-Ω Architect automatically aborts any active `axios` or `fetch` requests when the user clicks Abort.
            // Explicitly checking `runState.aborted` is only necessary to break out of heavy CPU loops.
            if (runState && runState.aborted) {
                emitLog("Extraction aborted gracefully.");
                break; 
            }
            
            // 🟢 Update Progress Bar
            runState?.updateProgress?.(i, totalPages);
            
            emitLog(`Fetching page ${i} of ${totalPages}...`);
            // await axios.get(...)
            
            rawRecords.push({
                "Company Name": "Acme Corp",       // REQUIRED
                "Phone": "+1-800-555-0199",
                "Country": "USA",
                "Contact Name": "John Doe",
                "Email": "contact@acmecorp.com",
                "Address": "123 Scraper Ave",      
                "City": "Techville",               
                "Booth": "A-100",
                "Website": "https://acmecorp.com"
            });
            
            // Respect rate limits!
            await new Promise(r => setTimeout(r, 500)); 
        }
    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error; 
    }

    emitLog("Custom Engine finished.");
    return rawRecords;
};
```

### 🚫 4. STRICT REQUIREMENTS FOR SCRAPERS
1. **Required Columns:** Regardless of target names, map data to these exact JSON keys: `"Company Name"`, `"Phone"`, `"Country"`, `"Contact Name"`, `"Email"`, `"Address"`, `"City"`, `"Booth"`, `"Website"`. Return `"N/A"` if unavailable.
2. **Telemetry (`emitLog`):** Fire it often so the UI doesn't look frozen.
3. **No Puppeteer/Playwright:** ZORG-Ω relies strictly on HTTP clients (`axios`, standard `fetch`). Extract through API calls or static parsing.
4. **Output Only:** Do not ask the user to manually install the Node.js script into `app.js`. The user uses an "Architect Upload UI" where they can paste the new script directly.

## Building and Running

### Installation
```powershell
npm install
# Or: .\install_requirements.bat
```

### Running the Application
```powershell
node app.js
# Or: .\Start.bat
```
The application will be available at `http://localhost:3000`.
