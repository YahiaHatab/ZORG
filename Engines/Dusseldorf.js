const axios = require('axios');

async function scrapeDusseldorf(domain, emitLog, runState) {
    let allExhibitors = [];
    let start = 0;
    const cleanDomain = domain.replace(/^(https?:\/\/)?/, '').split('/')[0];
    const headers = { 'X-Vis-Domain': cleanDomain, 'Referer': `https://${cleanDomain}/`, 'User-Agent': 'Mozilla/5.0' };

    emitLog(`Initializing Düsseldorf Engine for ${cleanDomain}...`);

    while (true) {
        if (runState && runState.aborted) {
            emitLog("Extraction aborted by user gracefully. Exiting loop.");
            break;
        }
        try {
            emitLog(`Fetching records starting at offset ${start}...`);
            const res = await axios.get(`https://${cleanDomain}/vis-api/vis/v3/en/search`, {
                params: { '_rows': 100, '_start': start, 'f_type': 'profile', 'ticket': 'g_u_e_s_t' },
                headers: headers, timeout: 15000
            });
            const docs = res.data.docs || [];
            if (docs.length === 0) {
                emitLog("End of dataset reached.");
                break;
            }

            docs.forEach(item => {
                allExhibitors.push({
                    "Company Name": item.exhName || item.title || 'N/A',
                    "Booth": item.location || 'N/A',
                    "City": item.primaryCity || "",
                    "Country": item.primaryCountry || 'N/A',
                    "Website": item.url || (item.exhSeoId ? `https://${cleanDomain}/vis/v1/en/exhibitors/${item.exhSeoId}` : ""),
                    "Email": 'N/A', "Phone": 'N/A'
                });
            });

            emitLog(`Total accumulated: ${allExhibitors.length} records.`);
            start += 100;
            if (start > 15000) break;
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            emitLog(`Connection interrupted at offset ${start}. Stopping pagination.`);
            break;
        }
    }
    return allExhibitors;
}

module.exports = scrapeDusseldorf;