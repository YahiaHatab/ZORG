const axios = require('axios');
const pLimit = require('p-limit');
const limit = (typeof pLimit === 'function') ? pLimit(25) : pLimit.default(25);

async function scrapeEshow(token, emitLog, runState) {
    emitLog("Initializing eShow Engine...");
    const headers = { "Authorization": `Bearer ${token}`, "Origin": "https://maps.goeshow.com", "Referer": "https://maps.goeshow.com/" };

    emitLog("Fetching Floor Space Keys...");
    const listRes = await axios.get(`https://s2.goeshow.com/webservices/eshow/floor_space.cfc?method=getExhibitorList`, { headers });
    const keys = (listRes.data.EXHIBITORS || []).map(ex => ex.EXHIBITOR_KEY).filter(Boolean);
    const total = keys.length;

    emitLog(`Success: ${total} Exhibitor Keys found. Processing...`);

    let processed = 0;
    const tasks = keys.map((key) => limit(async () => {
        if (runState && runState.aborted) return null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await axios.get(`https://s2.goeshow.com/webservices/eshow/floor_space.cfc?method=getExhibitor&exhibitor_key=${key}`, { headers, timeout: 10000 });
                const ex = res.data.EXHIBITOR || {};
                const dir = ex.DIRECTORY || {};

                processed++;
                if (processed % 25 === 0 || processed === total) emitLog(`Processed ${processed}/${total} eShow profiles...`);

                return {
                    "Company Name": ex.COMPANY_NAME || "N/A",
                    "Booth": ex.PRIMARY_BOOTH || (ex.BOOTHS && ex.BOOTHS[0] ? ex.BOOTHS[0].BOOTH_NO : "N/A"),
                    "Contact Person": `${dir.FIRST_NAME || ""} ${dir.LAST_NAME || ""}`.trim() || "N/A",
                    "Phone": dir.PHONE || "N/A",
                    "Email": dir.EMAIL || "N/A",
                    "City": dir.CITY || "N/A"
                };
            } catch (e) {
                if (e.response && e.response.status === 429) {
                    if (attempt === 0) emitLog(`Rate limit hit (429). Throttling connections...`);
                    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
                } else {
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        }
        emitLog(`Failed to fetch key: ${key} after 3 attempts.`);
        return null;
    }));

    return (await Promise.all(tasks)).filter(Boolean);
}

module.exports = scrapeEshow;