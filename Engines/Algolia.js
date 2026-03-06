const axios = require('axios');
const { findBoothDeeply } = require('../utils/helpers');

async function scrapeNuernberg(config, emitLog) {
    emitLog("Initializing Algolia Extraction Matrix...");
    const { appId, apiKey, indexName, filters } = config;
    const apiUrl = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
    const searchTerms = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('').concat([""]);
    let uniqueExhibitors = new Map();

    for (const char of searchTerms) {
        try {
            emitLog(`Executing Query Vector: [${char || 'EMPTY'}]...`);
            const payload = { "requests": [{ "indexName": indexName, "params": `query=${encodeURIComponent(char)}&hitsPerPage=1000&filters=${encodeURIComponent(filters || "")}` }] };
            const res = await axios.post(apiUrl, payload, { params: { "x-algolia-api-key": apiKey, "x-algolia-application-id": appId } });

            const hits = res.data.results[0].hits;
            emitLog(`Vector [${char || 'EMPTY'}] returned ${hits.length} hits.`);

            hits.forEach(item => {
                const id = item.objectID || item.uuid || item.name;
                if (id && !uniqueExhibitors.has(id)) uniqueExhibitors.set(id, item);
            });
        } catch (e) {
            emitLog(`Error on Vector [${char || 'EMPTY'}]: ${e.message}`);
        }
    }

    emitLog(`Algolia Sequence Complete. Found ${uniqueExhibitors.size} unique entities.`);

    return Array.from(uniqueExhibitors.values()).map(item => ({
        "Company Name": (item.companyName || item.name || 'N/A').split('|')[0].trim(),
        "Booth": findBoothDeeply(item), "City": item.city || '', "Country": item.country || '',
        "Website": item.url || item.website || '', "Email": item.email || '', "Phone": item.phone || 'N/A'
    }));
}

module.exports = scrapeNuernberg;