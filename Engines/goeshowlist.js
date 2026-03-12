/**
 * ZORG-Ω Scraper Engine: GoEshow List Extractor (Resilient Version)
 * * @param {Object} params - params.customInput (The URL of the exhibitor list)
 * @param {Function} emitLog - Real-time telemetry
 * @param {Object} runState - Abort and Progress monitoring
 * @returns {Array} Standardized exhibitor objects
 */
const axios = require('axios');

module.exports = async function scrapeGoEshowList(params, emitLog, runState) {
    emitLog("Initializing Resilient GoEshow Engine...");

    const targetUrl = params.customInput;
    if (!targetUrl) throw new Error("Missing target URL in Custom Input.");

    const rawRecords = [];

    try {
        emitLog(`Fetching source: ${targetUrl}`);
        
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 30000
        });

        const html = response.data;
        
        // Split HTML by table rows to isolate each exhibitor
        const rows = html.split('<tr');
        emitLog(`Processing ${rows.length} potential rows...`);

        for (let i = 0; i < rows.length; i++) {
            if (runState && runState.aborted) break;

            const row = rows[i];

            // Only process rows containing the exhibitor popup link
            if (row.includes('ExhibitorPopup')) {
                try {
                    // 1. Extract the URL
                    const urlMatch = row.match(/ExhibitorPopup\s*\(\s*'([^']+)'/);
                    const profileUrl = urlMatch ? urlMatch[1] : "N/A";

                    // 2. Extract the Company Name (Inside the <a> tag)
                    const nameMatch = row.match(/<a[^>]*>([\s\S]*?)<\/a>/);
                    let companyName = nameMatch ? nameMatch[1].replace(/<[^>]*>?/gm, '').trim() : "N/A";

                    // 3. Extract the Booth Number 
                    // Usually found in the td immediately preceding the name td
                    const boothMatch = row.match(/<td[^>]*tb-text-center[^>]*>([\s\S]*?)<\/td>/);
                    let booth = boothMatch ? boothMatch[1].replace(/&nbsp;|\s/g, '').trim() : "N/A";

                    if (companyName !== "N/A") {
                        rawRecords.push({
                            "Company Name": companyName,
                            "Phone": "N/A",
                            "Country": "N/A",
                            "Contact Name": "N/A",
                            "Email": "N/A",
                            "Address": "N/A",
                            "City": "N/A",
                            "Booth": booth,
                            "Website": profileUrl
                        });
                    }
                } catch (innerErr) {
                    continue; // Skip malformed rows
                }
            }
            
            // UI Feedback
            if (i % 100 === 0) {
                runState?.updateProgress?.(i, rows.length);
                emitLog(`Analyzed ${i} rows... Found ${rawRecords.length} records so far.`);
            }
        }

        emitLog(`Extraction Complete. Final Count: ${rawRecords.length}`);

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    return rawRecords;
};