const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Custom ZORG-Ω Scraper Engine for Expotracker Floorplans
 * @param {Object} params - The payload containing inputs (params.customInputs array).
 * @param {Function} emitLog - Function to log real-time telemetry strings.
 * @param {Object} runState - State object to monitor cancellation (runState.aborted).
 * @returns {Array} An array of raw exhibitor objects.
 */
module.exports = async function scrapeCustomEvent(params, emitLog, runState) {
    emitLog("Initializing Expotracker Generic Scraper Engine...");

    // 🔍 DEBUG LOGGER: Show received array length to ensure input logic is correct
    if (params.customInputs) {
        emitLog(`DEBUG - Received customInputs array with ${params.customInputs.length} items.`);
    } else {
        emitLog("DEBUG - WARNING: customInputs array is undefined!");
    }

    // Map the new array logic: [0] is URL, [1] is Cookie
    const url = params.customInputs && params.customInputs[0] ? params.customInputs[0].trim() : null;
    let cookie = params.customInputs && params.customInputs[1] ? params.customInputs[1].trim() : null;

    if (!url) {
        throw new Error("Missing required input: URL in first custom input field.");
    }
    if (!cookie) {
        throw new Error("Missing required input: Session Cookie in second custom input field.");
    }

    // Smart formatting: Automatically prepend the ASP.NET prefix if the user only pasted the raw value
    if (!cookie.includes('ASP.NET_SessionId=')) {
        cookie = `ASP.NET_SessionId=${cookie}`;
        emitLog("Auto-formatted raw cookie string with ASP.NET_SessionId prefix.");
    }

    emitLog(`Target URL: ${url}`);
    emitLog("Using provided session cookie to bypass authentication.");

    const rawRecords = [];

    try {
        // 🛑 CRITICAL: Check abortion state
        if (runState && runState.aborted) {
            emitLog("Extraction aborted by user gracefully before HTTP request.");
            return rawRecords;
        }

        // 🟢 Update Progress Bar (Starting)
        runState?.updateProgress?.(0, 1);

        emitLog("Fetching floorplan HTML payload...");
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Cookie': cookie
            }
        });

        emitLog("HTML fetched successfully. Initializing Cheerio parser...");
        const $ = cheerio.load(response.data);

        const booths = $('.Booth');
        const totalBooths = booths.length;

        if (totalBooths === 0) {
            emitLog("⚠️ No exhibitors found. Check if the session Cookie has expired or if the URL is correct.");
            return rawRecords; 
        }

        emitLog(`Found ${totalBooths} potential booth elements. Extracting ZORG-compliant data...`);

        // Use a standard for loop instead of .each() so we can break out if aborted
        for (let i = 0; i < totalBooths; i++) {
            
            // 🛑 CRITICAL: Check if the user aborted mid-parse!
            if (runState && runState.aborted) {
                emitLog("Extraction aborted by user gracefully. Halting DOM parsing.");
                break; 
            }

            const el = booths[i];
            const $el = $(el);
            
            // Company name is our anchor. If missing, skip.
            const company = $el.find('.BoothCompany').text().trim();

            if (company) {
                const boothNumber = $el.find('.BoothNumber').text().replace('Booth #', '').trim() || $el.attr('booth') || "N/A";
                const website = $el.find('.BoothURL').text().trim() || "N/A";
                
                // Push standard ZORG-Ω schema with strict defaults
                rawRecords.push({
                    "Company Name": company,
                    "Phone": "N/A",
                    "Country": "N/A",
                    "Contact Name": "N/A",
                    "Email": "N/A",
                    "Address": "N/A",
                    "City": "N/A",
                    "Booth": boothNumber,
                    "Website": website
                });
            }
        }

        // 🟢 Update Progress Bar (Finished)
        runState?.updateProgress?.(1, 1);
        emitLog(`✅ Successfully mapped ${rawRecords.length} compliant records.`);

    } catch (error) {
        emitLog(`FATAL ERROR during scraping: ${error.message}`);
        if (error.response && (error.response.status === 403 || error.response.status === 401)) {
            emitLog('💡 Tip: Your Cookie might be stale, or the server blocked the request.');
        }
        throw error; 
    }

    emitLog("Custom Engine finished. Passing data to Standardizer.");
    return rawRecords;
};