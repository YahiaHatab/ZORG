/**
 * ZORG-Ω Engine — ExpoPlatform
 * Generated from cURL recon: 2026-fespa.expoplatform.com
 * Engine Type: Specific
 * Records per page: 12 — paginated (max page 60, total ~653)
 */

const axios = require('axios');

module.exports = async function scrapeFespa2026(params, emitLog, runState) {
    const rawRecords = [];

    const BASE_URL = 'https://2026-fespa.expoplatform.com/api/v1/search/exhibitors';
    const LIMIT = 60; // max allowed per page
    const MAX_PAGES = 20; // safety ceiling (60 limit × 20 pages = 1200 slots, well above 653 total)

    const headers = {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.5',
        'content-type': 'application/json',
        'origin': 'https://2026-fespa.expoplatform.com',
        'priority': 'u=1, i',
        'referer': 'https://2026-fespa.expoplatform.com/newfront/widgets/marketplace',
        'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sec-gpc': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'x-application': '3',
        'x-fp': 'b19e1cc36285bff45edcb507b10b5e17',
        'x-lang': 'en',
        'cookie': 'PHPSESSID=glka8pe2vfkp0gp639qhgt76ih; customCss=on; customJS=on; customMeta=on; checkedSession=glka8pe2vfkp0gp639qhgt76ih; CHECKED_PHPSESSID=glka8pe2vfkp0gp639qhgt76ih; fingerprint={%22hash%22:%22b19e1cc36285bff45edcb507b10b5e17%22%2C%22expire%22:1774288635525}; AWSALB=SBzEVCB32LWtQRp97FUw80uus3J9Hjr3myYry+k0kIvbsuaOahp3UpsGdtC5PLfG9PlAgogYEBx2qTcxrkV7tz1WyMn+h7V6EwjlZ4wZ+XiX8LFZpnTDDGad68c5; AWSALBCORS=SBzEVCB32LWtQRp97FUw80uus3J9Hjr3myYry+k0kIvbsuaOahp3UpsGdtC5PLfG9PlAgogYEBx2qTcxrkV7tz1WyMn+h7V6EwjlZ4wZ+XiX8LFZpnTDDGad68c5'
    };

    try {
        let page = 1;
        let totalFetched = 0;
        let totalRecords = null;

        while (page <= MAX_PAGES) {
            if (runState && runState.aborted) {
                emitLog('Extraction aborted by user. Halting gracefully.');
                break;
            }

            emitLog(`Fetching page ${page} (limit: ${LIMIT})...`);

            const response = await axios.post(
                BASE_URL,
                { page, limit: LIMIT },
                { headers }
            );

            const data = response.data;

            if (!data || data.code !== 200 || !data.data) {
                emitLog(`Unexpected response on page ${page}. Stopping.`);
                break;
            }

            if (totalRecords === null) {
                totalRecords = data.data.total || 0;
                emitLog(`Total exhibitors reported by API: ${totalRecords}`);
            }

            const list = data.data.list || [];

            if (list.length === 0) {
                emitLog(`Empty page ${page}. All records fetched.`);
                break;
            }

            for (const ex of list) {
                // Extract booth info from stands array
                let boothStr = 'N/A';
                if (ex.stands && ex.stands.length > 0) {
                    const boothParts = ex.stands.map(s => {
                        const hall = s.hall ? `Hall ${s.hall}` : '';
                        const stand = s.stand || '';
                        return hall && stand ? `${hall} - ${stand}` : (stand || hall);
                    });
                    boothStr = boothParts.join('; ') || 'N/A';
                }

                // Strip HTML tags from "about" for a clean description (not a standard field, skip)
                const country = ex.country || 'N/A';
                const city = ex.city || 'N/A';

                rawRecords.push({
                    'Company Name': ex.name || 'N/A',
                    'Phone':        'N/A',
                    'Country':      country,
                    'Contact Name': 'N/A',
                    'Email':        'N/A',
                    'Address':      city !== 'N/A' ? city : 'N/A',
                    'Booth':        boothStr,
                    'Website':      ex.url ? `https://2026-fespa.expoplatform.com/newfront/en/${ex.url}` : 'N/A'
                });
            }

            totalFetched += list.length;
            emitLog(`Page ${page} done — ${list.length} records. Running total: ${totalFetched}`);

            if (totalFetched >= totalRecords) {
                emitLog('All records fetched. Done.');
                break;
            }

            page++;
            await new Promise(r => setTimeout(r, 700));
        }

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};