const axios = require('axios');
const cheerio = require('cheerio');

/**
 * ZORG-Ω Module: Sensor+Test Alphabetical Scraper
 * * @param {Object} params - Payload from frontend (uses params.token if PHPSESSID is needed).
 * @param {Function} emitLog - Telemetry function for real-time UI updates.
 * @returns {Array} Raw exhibitor objects for the ZORG-Ω Standardizer.
 */
module.exports = async function scrapeSensorTest(params, emitLog, runState) {
    emitLog("🚀 Initializing Sensor+Test Alphabetical Engine...");

    const BASE_URL = 'https://www.sensor-test.de';
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    const allExhibitors = [];

    // Allow dynamic session token from params, fallback to hardcoded if necessary
    const sessionId = params.token || 'rn2hva5em5hga0oc7019v9fdhm';

    try {
        for (const char of alphabet) {
            if (runState && runState.aborted) {
                emitLog("Extraction aborted by user gracefully. Exiting loop.");
                break;
            }
            emitLog(`Processing Letter: ${char}...`);

            const response = await axios.get(`${BASE_URL}/en/exhibitors/search-ep/exhibitors/${char}`, {
                headers: {
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'cookie': `PHPSESSID=${sessionId};`,
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                    'referer': 'https://www.sensor-test.de/en/exhibitors/search-ep/exhibitors/'
                },
                timeout: 10000
            });

            const $ = cheerio.load(response.data);
            const exhibitorCards = $('.exhibitor');

            if (exhibitorCards.length === 0) {
                emitLog(`No exhibitors found for letter ${char}.`);
                continue;
            }

            exhibitorCards.each((i, el) => {
                const companyName = $(el).find('.title').text().trim();
                const location = $(el).find('.place').text().trim(); // Often contains City/Country
                const hall = $(el).find('.hall').text().trim().replace(/\s+/g, ' ');
                const stand = $(el).find('.stand').text().trim().replace(/\s+/g, ' ');
                const relativePath = $(el).find('a').attr('href');

                if (companyName) {
                    // Mapping to ZORG-Ω Standard Keys
                    allExhibitors.push({
                        "Company Name": companyName,
                        "Phone": "N/A",
                        "Country": "N/A", // Standardizer will attempt to parse from Address/City
                        "Contact Name": "N/A",
                        "Email": "N/A",
                        "Address": location || "N/A",
                        "City": "N/A",
                        "Booth": `${hall} ${stand}`.trim(),
                        "Website": relativePath ? `${BASE_URL}${relativePath}` : "N/A"
                    });
                }
            });

            emitLog(`Progress: Extracted ${allExhibitors.length} total records...`);

            // Respectful delay to prevent WAF trigger
            await new Promise(r => setTimeout(r, 800));
        }

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw new Error(`Scraper failed at letter level: ${error.message}`);
    }

    if (allExhibitors.length === 0) {
        throw new Error("Extraction complete but 0 records found. Check session cookie/selectors.");
    }

    emitLog(`✅ Success! Total Found: ${allExhibitors.length}. Passing to Standardizer...`);
    return allExhibitors;
};