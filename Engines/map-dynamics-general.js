/**
 * ZORG-Ω Engine — Map-Dynamics (homebase.map-dynamics.com)
 * Generated from: homebase.map-dynamics.com
 * Engine Type: General
 */

const axios = require('axios');
const pLimit = require('p-limit');
const limit = (typeof pLimit === 'function') ? pLimit(25) : pLimit.default(25);

module.exports = async function MapDynamicsEngine(params, emitLog, runState) {
    const rawRecords = [];

    // --- INPUT VALIDATION (Rule #9) ---
    if (!params.customInputs || params.customInputs.length === 0 || !params.customInputs[0]) {
        throw new Error('Missing required input: Show ID must be provided in Field 1.');
    }

    // --- STRICT VARIABLE MAPPING ---
    const showId = params.customInputs[0].trim();
    const cookie = (params.customInputs[1] || '').trim();

    try {
        emitLog(`Initializing Map-Dynamics for Show ID: ${showId}...`);

        const START_URL   = 'https://homebase.map-dynamics.com/components/marketplace/start.marketplace.php';
        const PROFILE_URL = 'https://homebase.map-dynamics.com/components/marketplace/profile.marketplace.php';

        const headers = {
            'content-type':    'application/x-www-form-urlencoded;charset=UTF-8',
            'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'x-requested-with': 'XMLHttpRequest',
        };
        if (cookie) headers['cookie'] = cookie;

        emitLog('Fetching Master Exhibitor List...');
        const listRes = await axios.post(START_URL, `Show_ID=${showId}`, { headers, timeout: 20000 });

        const exhibitorMap = new Map();
        const regex = /record-id='(\d+)'\s+record-title="([^"]+)"/g;
        let match;

        while ((match = regex.exec(listRes.data)) !== null) {
            if (runState && runState.aborted) break;
            exhibitorMap.set(match[1], match[2]);
        }

        const total = exhibitorMap.size;
        if (total === 0) {
            emitLog('WARNING: No exhibitors found. Check Show ID or cookie.');
            return rawRecords;
        }
        emitLog(`Master List acquired. Found ${total} exhibitors.`);
        emitLog('Initiating Deep Profile Extraction...');

        let processed = 0;

        const tasks = Array.from(exhibitorMap.entries()).map(([id, name]) =>
            limit(async () => {
                if (runState && runState.aborted) {
                    emitLog('Extraction aborted by user. Halting gracefully.');
                    return null;
                }

                try {
                    await new Promise(r => setTimeout(r, 600 + Math.random() * 400));

                    const profileRes = await axios.post(
                        PROFILE_URL,
                        `Show_ID=${showId}&ID=${id}&Tab=1`,
                        { headers, timeout: 15000 }
                    );
                    const html = profileRes.data;

                    const extract = (patterns) => {
                        for (const p of patterns) {
                            const m = html.match(p);
                            if (m && m[1]) {
                                return m[1].replace(/<[^>]*>/gm, '').replace(/&nbsp;/g, ' ').trim();
                            }
                        }
                        return 'N/A';
                    };

                    processed++;
                    if (processed % 25 === 0 || processed === total) {
                        emitLog(`Processed ${processed}/${total} profiles...`);
                    }

                    const record = {
                        "Company Name":  name || 'N/A',
                        "Contact Name":  extract([/Contact:?<\/b>\s*([^<]+)/i, /Contact:?\s*<\/b>\s*([^<]+)/i, /profile-contact-name">([^<]+)/i]),
                        "Email":         extract([/mailto:([^'">\s]+)/i]),
                        "Phone":         extract([/\(P\):?<\/b>\s*([^<]+)/i, /Phone:?<\/b>\s*([^<]+)/i]),
                        "Website":       extract([/href="(https?:\/\/[^"]+)"[^>]*target=['"]_blank['"]/i]),
                        "Booth":         extract([/Booth:?<\/b>\s*([^<]+)/i, /Location:?<\/b>\s*([^<]+)/i]),
                        "Address":       'N/A',
                        "Country":       'N/A',
                    };

                    rawRecords.push(record);
                    return record;

                } catch (e) {
                    emitLog(`Failed to extract profile for: ${name} — ${e.message}`);
                    return null;
                }
            })
        );

        await Promise.all(tasks);

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};