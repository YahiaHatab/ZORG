/**
 * ZORG-Ω Custom Engine
 * Target: Las Vegas Market — Exhibitor A-Z Directory
 * Type: GENERAL ENGINE — paste any cURL from the Network tab, zero hardcoding needed.
 *
 * UI Input (1 field):
 *   customInputs[0] — Raw cURL command copied from the browser Network tab (any letter is fine)
 */

const axios = require('axios');

// ---------------------------------------------------------------------------
// cURL PARSER
// Extracts: url, headers, cookies, query params
// ---------------------------------------------------------------------------
function parseCurl(curlString) {
    const result = { url: '', headers: {}, params: {} };

    // Normalize line continuations
    const normalized = curlString.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();

    // --- URL ---
    const urlMatch = normalized.match(/curl\s+'([^']+)'/) || normalized.match(/curl\s+"([^"]+)"/) || normalized.match(/curl\s+(https?:\/\/\S+)/);
    if (!urlMatch) throw new Error("Could not find URL in cURL command.");
    const rawUrl = urlMatch[1];

    // Split URL and inline query params
    const [baseWithPath, queryString] = rawUrl.split('?');
    result.url = baseWithPath;

    if (queryString) {
        queryString.split('&').forEach(pair => {
            const [k, v] = pair.split('=');
            if (k) result.params[decodeURIComponent(k)] = decodeURIComponent(v || '');
        });
    }

    // --- HEADERS (-H flags) ---
    const headerRegex = /-H\s+'([^']+)'/g;
    let hMatch;
    while ((hMatch = headerRegex.exec(normalized)) !== null) {
        const raw = hMatch[1];
        const colonIdx = raw.indexOf(':');
        if (colonIdx === -1) continue;
        const key   = raw.slice(0, colonIdx).trim().toLowerCase();
        const value = raw.slice(colonIdx + 1).trim();
        if (key === 'cookie') {
            result.headers['cookie'] = value;
        } else {
            result.headers[key] = value;
        }
    }

    // --- COOKIES (-b flag) ---
    const cookieMatch = normalized.match(/-b\s+'([^']+)'/);
    if (cookieMatch) {
        result.headers['cookie'] = cookieMatch[1];
    }

    return result;
}

// ---------------------------------------------------------------------------
// Detect the "az" param key and API key param from the parsed params
// ---------------------------------------------------------------------------
function detectAzParam(params) {
    // Common names for the letter param
    const candidates = ['az', 'char', 'letter', 'alpha', 'index'];
    for (const c of candidates) {
        if (params[c] !== undefined) return c;
    }
    // Fallback: any single-letter value param
    for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string' && v.length === 1 && /[A-Za-z]/.test(v)) return k;
    }
    return 'az'; // default assumption
}

// ---------------------------------------------------------------------------
// Response normalizer — handles wrapped or bare arrays
// ---------------------------------------------------------------------------
function extractExhibitors(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    // Check common wrapper keys first
    for (const key of ['exhibitors', 'results', 'data', 'items', 'records']) {
        if (Array.isArray(data[key])) return data[key];
    }
    // Fallback: first array value found
    const arrayVal = Object.values(data).find(v => Array.isArray(v));
    return arrayVal || [];
}

// ---------------------------------------------------------------------------
// MAIN ENGINE
// ---------------------------------------------------------------------------
module.exports = async function scrapeLasVegasMarketGeneral(params, emitLog, runState) {
    emitLog("🚀 Initializing Las Vegas Market General Engine...");

    const curlInput = (params.customInputs?.[0] || params.customInput || '').trim();
    if (!curlInput) {
        throw new Error("No cURL provided. Please paste the cURL command into the input field.");
    }

    // --- Parse cURL ---
    let parsed;
    try {
        parsed = parseCurl(curlInput);
        emitLog(`✅ cURL parsed successfully. Base URL: ${parsed.url}`);
    } catch (err) {
        throw new Error(`cURL parsing failed: ${err.message}`);
    }

    const { url, headers, params: queryParams } = parsed;
    const azKey = detectAzParam(queryParams);
    emitLog(`🔍 Detected pagination param: "${azKey}"`);

    // Build the reusable param set (remove the letter param — we'll inject it per loop)
    const baseParams = { ...queryParams };
    delete baseParams[azKey];

    const ALPHABET = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
    const rawRecords = [];

    try {
        for (const letter of ALPHABET) {

            if (runState && runState.aborted) {
                emitLog("⛔ Aborted by user. Halting gracefully.");
                break;
            }

            emitLog(`📄 Fetching letter: ${letter}...`);

            let response;
            try {
                response = await axios.get(url, {
                    params: { ...baseParams, [azKey]: letter },
                    headers,
                    timeout: 15000
                });
            } catch (err) {
                emitLog(`⚠️  Failed on letter ${letter}: ${err.message}. Skipping...`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            const exhibitors = extractExhibitors(response.data);

            if (exhibitors.length === 0) {
                emitLog(`   ↳ No results for letter ${letter}.`);
            } else {
                emitLog(`   ↳ ${exhibitors.length} exhibitors found.`);
            }

            for (const item of exhibitors) {
                if (runState && runState.aborted) break;

                rawRecords.push({
                    "Company Name": item.name || item.exhibitorName || item.companyName || "N/A",
                    "Exhibitor ID":  item.exhibitorId  || "",
                    "Type":          item.type         || "",
                    "Phone":         item.phone        || "",
                    "Country":       item.country      || "",
                    "Contact Name":  item.contactName  || "",
                    "Email":         item.email        || "",
                    "Address":       item.address      || "",
                    "City":          item.city         || "",
                    "Booth":         item.booth        || item.boothNumber || "",
                    "Website":       item.website      || item.url        || ""
                });
            }

            await new Promise(r => setTimeout(r, 700));
        }

    } catch (error) {
        emitLog(`❌ FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`✅ Done. ${rawRecords.length} total records passed to Standardizer.`);
    return rawRecords;
};