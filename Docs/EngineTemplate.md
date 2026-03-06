# ZORG-Ω Engine Development Template

Use this template when generating new scraping engines for ZORG-Ω. 

## 1. Engine Structure

Every custom engine **MUST** export a single asynchronous function. The function will be called by `app.js` and receives two arguments:
1. `params`: An object containing the frontend inputs.
2. `emitLog`: A function `(message: string) => void` used to send real-time telemetry back to the UI.

```javascript
/**
 * Custom ZORG-Ω Scraper Engine
 * 
 * @param {Object} params - The payload from the frontend.
 * @param {Function} emitLog - Function to log telemetry to the frontend.
 * @returns {Array} An array of raw exhibitor objects.
 */
module.exports = async function scrapeCustomEvent(params, emitLog) {
    emitLog("Initializing Custom Scraper Engine...");

    // 1. Extract inputs from params
    // Depending on what you configure in the Upload UI, you might use:
    // params.customInput, params.domain, params.curlCommand, params.token, etc.
    const input = params.customInput; 

    if (!input) {
        throw new Error("Missing required input parameter.");
    }

    emitLog(`Starting extraction using input: ${input.substring(0, 50)}...`);

    const rawRecords = [];

    try {
        // ------------------------------------------------------------------
        // 2. YOUR SCRAPING LOGIC HERE
        // E.g., Use Axios, Fetch, or parse JSON directly, page through APIs.
        // Make sure you await any asynchronous actions.
        // emitLog("Fetching page 1...");
        // ------------------------------------------------------------------
        
        // Mocking a scraped result for structural example:
        const mockItem = {
            "Company Name": "Acme Corp",       // REQUIRED (Maps to 'Exhibitor Name')
            "Phone": "+1-800-555-0199",
            "Country": "USA",
            "Contact Name": "John Doe",
            "Email": "contact@acmecorp.com",
            "Address": "123 Scraper Ave",      // Maps to 'Mails'
            "City": "Techville",               // Maps to 'Mails' if Address is missing
            "Booth": "A-100",
            "Website": "https://acmecorp.com"
        };
        
        rawRecords.push(mockItem);
        emitLog(`Extracted 1 records...`);

    } catch (error) {
        emitLog(`FATAL ERROR during scraping: ${error.message}`);
        throw error; // Rethrow to let the main app handle and abort cleanly
    }

    emitLog("Custom Engine finished. Passing data to Standardizer.");
    
    // 3. Return the array of objects
    // The Standardizer in app.js will automatically deduplicate and format to exactly 8 requested columns.
    return rawRecords;
};
```

## 2. Requirements for the AI Gem

When creating an engine, ensure that:
1. **No Frontend Code is generated:** Only provide the `module.exports` Node.js code. The "Architect" already has a universal Standardizer and UI.
2. **Column Names:** Return objects with keys matching: `"Company Name"`, `"Phone"`, `"Country"`, `"Contact Name"`, `"Email"`, `"Address"`, `"City"`, `"Booth"`, `"Website"`. You don't need to format them perfectly, the standardizer will do it, but use these specific keys.
3. **Telemetry:** Ensure you use `emitLog(msg)` frequently to inform the user of the progress (e.g., `"Fetched page 2 of 10..."`, `"Extracted 524 profiles..."`).
4. **Error Handling:** Catch errors gracefully and use `throw new Error("user friendly message")` so the frontend UI can catch it.
5. **No 3rd Party Puppeteer:** Only use pre-installed HTTP clients like `axios` or standard Node capabilities (`fetch`), as this relies on API responses or static scraping.

## 3. Uploading to ZORG-Ω

1. Open the Architect interface (`http://localhost:3000`).
2. Click **"➕ Upload Custom Script"**.
3. Provide an **ID**, **Display Name**, **Instructions** (for the UI), and the name of the input field (e.g. `Custom API Key`).
4. Paste the generated JS script.
5. Click **Upload & Install**. The script will instantly be available in the dropdown!
