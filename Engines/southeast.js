/**
 * ZORG-Ω Module: SouthEast Green 2026 (Robust Version)
 * @param {Object} params - The payload from the frontend.
 * @param {Function} emitLog - Function to log telemetry to the frontend.
 * @returns {Array} An array of raw exhibitor objects.
 */
module.exports = async function scrapeSouthEastGreen(params, emitLog) {
    emitLog("Initializing Robust SouthEast Green Engine...");

    const url = 'https://www.southeastgreen.org/2026-exhibitor-map';
    const rawRecords = [];

    try {
        emitLog("Requesting HTML via native fetch...");
        const response = await fetch(url, {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
            }
        });

        const html = await response.text();
        emitLog(`HTML received (${(html.length / 1024).toFixed(2)} KB). Scanning for Data Blocks...`);

        // WIX/VELO detection: Find the largest JSON-like block containing "company" and "boothNumbers"
        // We split by the unique key provided in your sample to isolate the objects
        const segments = html.split(/"[a-f0-9-]{36}":\s*{/);
        
        if (segments.length < 2) {
            emitLog("Primary block not found. Attempting deep string scan...");
        }

        segments.forEach((segment, index) => {
            // Filter segments that actually contain exhibitor data
            if (segment.includes('"company":') && segment.includes('"boothNumbers":')) {
                try {
                    // Extract fields using non-greedy string matching
                    const company = segment.match(/"company":\s*"([^"]+)"/)?.[1];
                    const booth = segment.match(/"boothNumbers":\s*"([^"]+)"/)?.[1];
                    const site = segment.match(/"companyWebsite":\s*"([^"]+)"/)?.[1];

                    if (company) {
                        rawRecords.push({
                            "Company Name": company,
                            "Phone": "N/A",
                            "Country": "N/A",
                            "Contact Name": "N/A",
                            "Email": "N/A",
                            "Address": "N/A",
                            "City": "N/A",
                            "Booth": booth || "N/A",
                            "Website": site ? site.replace(/\\/g, '') : "N/A"
                        });
                    }
                } catch (e) {
                    // Individual segment fail - move to next
                }
            }
        });

        if (rawRecords.length === 0) {
            emitLog("ERR: No data extracted. Structure may have shifted.");
            throw new Error("Zero records found. Wix data structure has changed.");
        }

        emitLog(`Success! Extracted ${rawRecords.length} exhibitors.`);
        return rawRecords;

    } catch (error) {
        emitLog(`FATAL: ${error.message}`);
        throw error;
    }
};