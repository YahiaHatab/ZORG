/**
 * ZORG-Ω Engine — ExpoFP
 * Generated from Network Spy recon: automanet.expofp.com
 * Engine Type: General
 * Records per page: Single dump (all exhibitors in one JS file)
 */

const axios = require('axios');

module.exports = async function scrapeExpoFP(params, emitLog, runState) {
    // params.customInputs[0] — ExpoFP show slug (e.g. "automanet" from automanet.expofp.com)

    const slug = (params.customInputs && params.customInputs[0] || '').trim();
    if (!slug) {
        throw new Error('ExpoFP slug is required. Enter the subdomain prefix (e.g. "automanet" from automanet.expofp.com).');
    }

    const dataUrl = `https://${slug}.expofp.com/data/data.js`;
    const rawRecords = [];

    emitLog(`ExpoFP General Engine — starting`);
    emitLog(`Target URL: ${dataUrl}`);

    try {
        emitLog(`Fetching data.js...`);

        const response = await axios.get(dataUrl, {
            headers: {
                'accept': '*/*',
                'accept-language': 'en-US,en;q=0.9',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'referer': 'https://app.expofp.com/',
                'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'script',
                'sec-fetch-mode': 'no-cors',
                'sec-fetch-site': 'same-site',
                'sec-gpc': '1',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
            },
            responseType: 'text',
            timeout: 30000
        });

        const jsText = response.data;
        emitLog(`data.js fetched (${(jsText.length / 1024).toFixed(1)} KB). Parsing...`);

        // Try multiple known ExpoFP wrapper patterns
        let jsonStr = null;

        // Pattern 1: var __data = {...}
        const m1 = jsText.match(/var\s+__data\s*=\s*([\s\S]+?);?\s*$/);
        if (m1) { jsonStr = m1[1]; emitLog('[DEBUG] Matched pattern 1: var __data = ...'); }

        // Pattern 2: __data = {...}
        if (!jsonStr) {
            const m2 = jsText.match(/__data\s*=\s*([\s\S]+?);?\s*$/);
            if (m2) { jsonStr = m2[1]; emitLog('[DEBUG] Matched pattern 2: __data = ...'); }
        }

        // Pattern 3: pure JSON
        if (!jsonStr) {
            const trimmed = jsText.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                jsonStr = trimmed;
                emitLog('[DEBUG] Matched pattern 3: raw JSON');
            }
        }

        // Pattern 4: window.__data or self.__data
        if (!jsonStr) {
            const m4 = jsText.match(/(?:window|self)\.__data\s*=\s*([\s\S]+?);?\s*$/);
            if (m4) { jsonStr = m4[1]; emitLog('[DEBUG] Matched pattern 4: window/__data = ...'); }
        }

        if (!jsonStr) {
            emitLog(`[DEBUG] First 300 chars: ${jsText.slice(0, 300).replace(/\n/g, '\\n')}`);
            emitLog(`[DEBUG] Last 200 chars: ${jsText.slice(-200).replace(/\n/g, '\\n')}`);
            throw new Error('Could not parse __data from data.js — check DEBUG lines above.');
        }

        let data;
        try {
            data = JSON.parse(jsonStr);
        } catch (parseErr) {
            emitLog(`[DEBUG] JSON parse error: ${parseErr.message}`);
            emitLog(`[DEBUG] jsonStr first 300: ${jsonStr.slice(0, 300).replace(/\n/g, '\\n')}`);
            throw new Error(`JSON parse failed after stripping JS wrapper: ${parseErr.message}`);
        }

        const exhibitors = data.exhibitors;
        if (!Array.isArray(exhibitors)) {
            throw new Error('No exhibitors array found in __data. Check the slug or the show structure.');
        }

        emitLog(`Found ${exhibitors.length} exhibitor records.`);

        // Build a booth lookup map: exhibitor id -> booth label(s)
        const boothMap = {};
        if (Array.isArray(data.booths)) {
            for (const booth of data.booths) {
                const label = booth.externalId || booth.name || 'N/A';
                if (Array.isArray(booth.exhibitors)) {
                    for (const exhibitorId of booth.exhibitors) {
                        if (!boothMap[exhibitorId]) boothMap[exhibitorId] = [];
                        boothMap[exhibitorId].push(label);
                    }
                }
            }
        }
        emitLog(`Booth map built for ${Object.keys(boothMap).length} exhibitor IDs.`);

        for (const ex of exhibitors) {
            if (runState && runState.aborted) {
                emitLog('Extraction aborted by user. Halting gracefully.');
                break;
            }

            const id = ex.id || ex.externalId || null;
            const boothLabels = (id && boothMap[id]) ? boothMap[id].join(', ') : 'N/A';

            // Address: street address + city + state (country goes to its own field)
            const addressParts = [ex.address, ex.city, ex.state].filter(v => v && v !== '');
            const address = addressParts.length > 0 ? addressParts.join(', ') : 'N/A';

            rawRecords.push({
                'Company Name': ex.name || 'N/A',
                'Phone':        ex.phone1 || ex.phone || ex.tel || 'N/A',
                'Country':      ex.country || 'N/A',
                'Contact Name': ex.contactName || ex.contact || 'N/A',
                'Email':        ex.email || ex.privateEmail || 'N/A',
                'Address':      address,
                'Booth':        boothLabels,
                'Website':      ex.website || ex.customButtonUrl || ex.url || ex.profileUrl || 'N/A'
            });
        }

        emitLog(`Mapped ${rawRecords.length} records.`);

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};