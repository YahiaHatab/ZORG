const axios = require('axios');
const pLimit = require('p-limit');
const limit = (typeof pLimit === 'function') ? pLimit(25) : pLimit.default(25);

async function scrapeMapDynamics(showId, cookie, emitLog) {
    emitLog(`Initializing Map-Dynamics for Show ID: ${showId}...`);
    const START_URL = 'https://homebase.map-dynamics.com/components/marketplace/start.marketplace.php';
    const PROFILE_URL = 'https://homebase.map-dynamics.com/components/marketplace/profile.marketplace.php';
    const headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'cookie': cookie, 'user-agent': 'Mozilla/5.0', 'x-requested-with': 'XMLHttpRequest' };

    emitLog("Fetching Master Exhibitor List...");
    const listRes = await axios.post(START_URL, `Show_ID=${showId}`, { headers });
    const exhibitorMap = new Map();
    const regex = /record-id='(\d+)'\s+record-title="([^"]+)"/g;
    let match;
    while ((match = regex.exec(listRes.data)) !== null) exhibitorMap.set(match[1], match[2]);

    const total = exhibitorMap.size;
    emitLog(`Master List acquired. Found ${total} exhibitors.`);
    emitLog("Initiating Deep Profile Extraction...");

    let processed = 0;
    const tasks = Array.from(exhibitorMap.entries()).map(([id, name]) => limit(async () => {
        try {
            await new Promise(r => setTimeout(r, Math.random() * 800));
            const profileRes = await axios.post(PROFILE_URL, `Show_ID=${showId}&ID=${id}&Tab=1`, { headers, timeout: 15000 });
            const html = profileRes.data;

            const extract = (patterns) => {
                for (let p of patterns) {
                    const m = html.match(p);
                    if (m && m[1]) return m[1].replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ').trim();
                }
                return 'N/A';
            };

            processed++;
            if (processed % 25 === 0 || processed === total) emitLog(`Processed ${processed}/${total} profiles...`);

            return {
                "Company Name": name,
                "Contact Name": extract([/Contact:?<\/b>\s*([^<]+)/i, /Contact:?\s*<\/b>\s*([^<]+)/i, /profile-contact-name">([^<]+)/i]),
                "Title": extract([/Title:?<\/b>\s*([^<]+)/i, /Position:?<\/b>\s*([^<]+)/i]),
                "Email": extract([/mailto:([^'"]+)/i]),
                "Phone": extract([/\(P\):?<\/b>\s*([^<]+)/i, /Phone:?<\/b>\s*([^<]+)/i]),
                "Website": extract([/href="([^"]+)"[^>]*target='_blank'/i]),
                "Booth": extract([/Booth:?<\/b>\s*([^<]+)/i, /Location:?<\/b>\s*([^<]+)/i])
            };
        } catch (e) {
            emitLog(`Failed to extract profile: ${name}`);
            return null;
        }
    }));
    return (await Promise.all(tasks)).filter(Boolean);
}

module.exports = scrapeMapDynamics;