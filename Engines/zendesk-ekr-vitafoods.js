const axios = require('axios');

module.exports = async function scrapeZendeskWidget(params, emitLog, runState) {

const rawRecords = [];

try {

    const url = "https://ekr.zdassets.com/compose/6aa1b400-96db-4e28-9cd0-833b3dceb3d2";

    const headers = {
        "Referer": "https://exhibitors.vitafoods.eu.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "sec-ch-ua": "\"Chromium\";v=\"146\", \"Not-A.Brand\";v=\"24\", \"Brave\";v=\"146\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\""
    };

    emitLog("Fetching data...");

    const response = await axios.get(url, { headers });

    await new Promise(r => setTimeout(r, 600));

    if (!response.data || !response.data.products) {
        emitLog("No products found.");
        return rawRecords;
    }

    const products = response.data.products;

    for (let i = 0; i < products.length; i++) {

        if (runState && runState.aborted) {
            emitLog("Extraction aborted by user.");
            break;
        }

        const record = products[i];

        rawRecords.push({
            "Company Name": record.name || 'N/A',
            "Phone": 'N/A',
            "Country": 'N/A',
            "Contact Name": 'N/A',
            "Email": 'N/A',
            "Address": 'N/A',
            "Booth": 'N/A',
            "Website": record.url || 'N/A'
        });
    }

} catch (error) {
    emitLog(`FATAL ERROR: ${error.message}`);
    throw error;
}

emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
return rawRecords;

};