/**
 * ZORG-Ω Engine — Zendesk EKR (Exhibitor Platform)
 * Generated from Network Spy recon: ekr.zdassets.com
 * Engine Type: Specific
 * Records per page: Single dump (Product Bootstrap)
 */
const axios = require('axios');

module.exports = async function scrapeZendeskExhibitor(params, emitLog, runState) {
    const rawRecords = [];
    const targetUrl = "https://ekr.zdassets.com/compose/6aa1b400-96db-4e28-9cd0-833b3dceb3d2";

    try {
        emitLog("Initiating extraction from Zendesk EKR endpoint...");

        const response = await axios({
            method: 'GET',
            url: targetUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                'Referer': 'https://exhibitors.vitafoods.eu.com/',
                'Accept': 'application/json'
            },
            timeout: 10000
        });

        if (!response.data || !response.data.products) {
            throw new Error("Invalid response structure: 'products' field missing.");
        }

        const items = response.data.products;
        emitLog(`Found ${items.length} raw product records.`);

        for (const item of items) {
            // Check for user abort in loop
            if (runState && runState.aborted) {
                emitLog("Extraction aborted by user. Halting gracefully.");
                break;
            }

            // Mapping based on recon best_field_mapping and detectedKeys
            rawRecords.push({
                "Company Name": item.name || 'N/A',
                "Phone":        'N/A',
                "Country":      'N/A',
                "Contact Name": 'N/A',
                "Email":        'N/A',
                "Address":      item.id || 'N/A', 
                "Booth":        'N/A',
                "Website":      item.url || 'N/A'
            });
        }

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};