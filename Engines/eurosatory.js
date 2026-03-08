const axios = require('axios');

/**
 * Custom ZORG-Ω Scraper Engine for Eurosatory
 * * @param {Object} params - The payload containing inputs (e.g., customInput, domain, token).
 * @param {Function} emitLog - Function to log real-time telemetry strings.
 * @param {Object} runState - State object to monitor cancellation (runState.aborted).
 * @returns {Array} An array of raw exhibitor objects.
 */
module.exports = async function scrapeCustomEvent(params, emitLog, runState) {
    emitLog("Initializing Eurosatory Scraper Engine...");

    const apiUrl = "https://eurosatory.finderr.cloud/api/catalog/search_exhibitors";
    // Using the hardcoded payload from your original script
    const payload = { "search": "", "size": 2000, "from": 0, "sort": "name.keyword", "order": "asc" };

    const rawRecords = [];

    try {
        // 🛑 Check if user aborted before we even start
        if (runState && runState.aborted) {
            emitLog("Extraction aborted by user gracefully. Exiting.");
            return rawRecords;
        }

        emitLog("Connecting to Eurosatory API and requesting up to 2000 records...");
        
        // 🟢 Update Progress Bar (Since it's one large call, we simulate a 0-to-1 progress)
        runState?.updateProgress?.(0, 1);

        const response = await axios.post(apiUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (response.data && response.data.ListDetailsExhibitors) {
            const exhibitors = response.data.ListDetailsExhibitors;
            emitLog(`Success! Processing ${exhibitors.length} exhibitors...`);

            // Loop through the array to process data and check for aborts
            for (let i = 0; i < exhibitors.length; i++) {
                
                // 🛑 CRITICAL: Check if the user aborted the scrape during processing!
                if (runState && runState.aborted) {
                    emitLog("Extraction aborted by user gracefully. Exiting loop.");
                    break; 
                }

                const ex = exhibitors[i];
                const booth = (ex.Stands && ex.Stands.length > 0) ? ex.Stands[0].Stan_Name : "N/A";
                
                // Push standard records mapping to strict required keys
                rawRecords.push({
                    "Company Name": ex.Exhi_CompanyName || "N/A",
                    "Phone": ex.Exhi_Phone || "N/A",
                    "Country": ex.Exhi_Country_CodeISO2 || "N/A",
                    "Contact Name": "N/A", // Not provided in original API response mapping
                    "Email": "N/A",        // Not provided in original API response mapping
                    "Address": "N/A",      // Not provided in original API response mapping
                    "City": "N/A",         // Not provided in original API response mapping
                    "Booth": booth,
                    "Website": ex.Exhi_Website || "N/A"
                });
            }

            // 🟢 Finish Progress Bar
            runState?.updateProgress?.(1, 1);
        } else {
            emitLog("Warning: No exhibitor data found in the response.");
        }

    } catch (error) {
        emitLog(`FATAL ERROR during scraping: ${error.message}`);
        throw error; // Rethrow so the backend catches it and UI displays it
    }

    emitLog("Custom Engine finished. Passing data to Standardizer.");
    
    // The Standardizer in app.js will handle the Excel generation automatically.
    return rawRecords;
};