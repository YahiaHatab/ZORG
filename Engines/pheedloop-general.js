/**
 * ZORG-Ω Engine — PheedLoop
 * Generated from Network Spy recon: cdnapi.pheedloop.com
 * Engine Type: General
 * Records per page: Single dump (all sponsors in one response)
 */

const axios = require('axios');

module.exports = async function scrapePheedloopGeneral(params, emitLog, runState) {
    // ── Inputs ──────────────────────────────────────────────────────────────
    const eventCode = params.customInputs && params.customInputs[0]
        ? params.customInputs[0].trim()
        : null;

    if (!eventCode) {
        throw new Error('Missing required input: Event Code (e.g. EVESGTJPGNDWF). Paste it into Field 1.');
    }

    emitLog(`[PheedLoop] Starting extraction for event: ${eventCode}`);

    const rawRecords = [];

    const headers = {
        'accept': 'application/json',
        'accept-language': 'en-US,en;q=0.7',
        'cache-control': 'no-cache',
        'origin': 'https://site.pheedloop.com',
        'pragma': 'no-cache',
        'referer': 'https://site.pheedloop.com/',
        'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'sec-gpc': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
    };

    try {
        // ── Fetch all sponsors in one call ───────────────────────────────────
        const url = `https://cdnapi.pheedloop.com/api/site/${eventCode}/sponsors/`;
        emitLog(`[PheedLoop] GET ${url}`);

        const response = await axios.get(url, { headers });

        if (!Array.isArray(response.data)) {
            throw new Error(`Unexpected response shape — expected array, got: ${typeof response.data}`);
        }

        const sponsors = response.data;
        emitLog(`[PheedLoop] Received ${sponsors.length} sponsor/exhibitor records.`);

        if (runState && runState.aborted) {
            emitLog('Extraction aborted by user. Halting gracefully.');
            return rawRecords;
        }

        // ── Map each record ──────────────────────────────────────────────────
        for (const s of sponsors) {
            if (runState && runState.aborted) {
                emitLog('Extraction aborted by user. Halting gracefully.');
                break;
            }

            // Phone — prefer work phone, fall back to mobile
            const phone = (s.addressPhoneWork && s.addressPhoneWork.trim())
                ? s.addressPhoneWork.trim()
                : (s.addressPhoneMobile && s.addressPhoneMobile.trim())
                    ? s.addressPhoneMobile.trim()
                    : 'N/A';

            // Address — combine line1 + line2, city, state, zip
            const addrParts = [
                s.addressLine_1,
                s.addressLine_2,
                s.addressCity,
                s.addressState,
                s.addressZip
            ].map(p => (p || '').trim()).filter(Boolean);
            const address = addrParts.length > 0 ? addrParts.join(', ') : 'N/A';

            // Contact name — from first representative if available
            let contactName = 'N/A';
            if (Array.isArray(s.representatives) && s.representatives.length > 0) {
                const rep = s.representatives[0];
                const fn = (rep.firstName || '').trim();
                const ln = (rep.lastName || '').trim();
                if (fn || ln) contactName = `${fn} ${ln}`.trim();
            }

            // Sponsor tier — stored as "Booth" equivalent for categorization
            let tier = 'N/A';
            if (Array.isArray(s.tiers) && s.tiers.length > 0) {
                tier = s.tiers.map(t => t.name).filter(Boolean).join(', ') || 'N/A';
            }

            rawRecords.push({
                'Company Name': (s.name && s.name.trim()) ? s.name.trim() : 'N/A',
                'Phone':        phone,
                'Country':      (s.addressCountry && s.addressCountry.trim()) ? s.addressCountry.trim() : 'N/A',
                'Contact Name': contactName,
                'Email':        (s.email && s.email.trim()) ? s.email.trim() : 'N/A',
                'Address':      address,
                'Booth':        tier,
                'Website':      (s.website && s.website.trim()) ? s.website.trim() : 'N/A'
            });
        }

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};