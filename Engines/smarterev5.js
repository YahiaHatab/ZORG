/**
 * ZORG-Ω Custom Engine: Smartere (thesmartere.de) - V5 (General, Final)
 * Platform: thesmartere.de — paginated POST search with HTML response.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  ZORG UI INPUTS (paste fresh values from network tab each run)  │
 * │                                                                 │
 * │  customInputs[0] — menuPageId                                   │
 * │                    Found in: Network tab → execute → Payload    │
 * │                    e.g. "5f59eef0a57002294671be62"              │
 * │                                                                 │
 * │  customInputs[1] — X-CSRF-TOKEN                                 │
 * │                    Found in: Network tab → execute → Headers    │
 * │                    e.g. "88ddcd6e-9b2a-4f16-83a8-ed638f4efc64" │
 * │                                                                 │
 * │  customInputs[2] — Cookie string                                │
 * │                    Found in: Copy as cURL → the -b '...' value  │
 * │                    Paste the full cookie string as-is.          │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * HOW TO GET FRESH VALUES (do this once before each scrape):
 *   1. Open the show's exhibitor list in Chrome
 *   2. Open DevTools (F12) → Network tab
 *   3. Scroll down once to trigger a load
 *   4. Find the "execute" POST request
 *   5. Right-click → Copy → Copy as cURL (bash)
 *   6. From the cURL extract:
 *        - --data-raw payload  → copy menuPageId value → customInputs[0]
 *        - X-CSRF-TOKEN header → customInputs[1]
 *        - -b '...' cookie     → customInputs[2]
 */
const axios = require('axios');

module.exports = async function scrapeSmarterE(params, emitLog, runState) {
    emitLog("Initializing Smartere Extraction Engine (V5-General)...");

    const menuPageId = params.customInputs?.[0]?.trim();
    const csrfToken  = params.customInputs?.[1]?.trim();
    const cookieRaw  = params.customInputs?.[2]?.trim();

    if (!menuPageId) throw new Error("Missing customInputs[0]: menuPageId. See engine header for instructions.");
    if (!csrfToken)  throw new Error("Missing customInputs[1]: X-CSRF-TOKEN. See engine header for instructions.");
    if (!cookieRaw)  throw new Error("Missing customInputs[2]: Cookie string. See engine header for instructions.");

    const BASE_URL        = 'https://www.thesmartere.de';
    const ENDPOINT        = `${BASE_URL}/search/execute`;
    const MENU_PAGE_TYPES = ['5ef3588ed984e36063189652']; // Hardcoded — same across all Smartere shows

    const headers = {
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': 'application/json; charset=UTF-8',
        'Origin': BASE_URL,
        'Pragma': 'no-cache',
        'Referer': `${BASE_URL}/exhibitorlist`,
        'X-CSRF-TOKEN': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cookie': cookieRaw
    };

    // --- EXTRACTION FUNCTION ---
    // Splits HTML on data-content-id boundaries — one chunk per exhibitor.
    function extractFromPage(html) {
        const records = [];
        const chunks = html.split(/(?=<a\s[^>]*data-content-id="[^"]+")/) ;

        for (const chunk of chunks) {
            if (!chunk.includes('class="teaser"')) continue;
            if (!chunk.includes('/exhibitorlist/')) continue;

            // Profile URL — from the opening <a> tag, strip tracking ref param
            const hrefMatch = chunk.match(/^<a\s[^>]*href="(\/exhibitorlist\/[^"]+)"/);
            if (!hrefMatch) continue;
            const profileUrl = `${BASE_URL}${hrefMatch[1].split('?')[0]}`;

            // Booth — <span class="h2">B5.151</span>
            const boothMatch = chunk.match(/<span class="h2">([^<]*)<\/span>/);
            const booth = boothMatch ? boothMatch[1].trim() : "";

            // Company name — <span class="h1">Arch Meter Corporation</span>
            const companyMatch = chunk.match(/<span class="h1">([^<]*)<\/span>/);
            const company = companyMatch ? companyMatch[1].trim() : "";
            if (!company) continue;

            // Show name — <p class="teaser-meta-line1">EM-Power Europe</p>
            const showMatch = chunk.match(/<p class="teaser-meta-line1">([^<]*)<\/p>/);
            const showName = showMatch ? showMatch[1].trim() : "";

            // Country — <p class="teaser-meta-line2">Taiwan ...</p>
            const countryBlockMatch = chunk.match(/<p class="teaser-meta-line2">([\s\S]*?)<\/p>/);
            let country = "";
            if (countryBlockMatch) {
                country = countryBlockMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            }

            records.push({
                "Company Name": company,
                "Booth":        booth,
                "Country":      country,
                "Show":         showName,
                "Website":      profileUrl,
                "Phone":        "",
                "Email":        "",
                "Contact Name": "",
                "Address":      "",
                "City":         "",
                "State":        "",
                "Zip":          "",
                "Description":  ""
            });
        }

        return records;
    }

    const rawRecords = [];
    let page = 1;

    try {
        while (true) {
            if (runState && runState.aborted) {
                emitLog("Extraction aborted by user. Halting gracefully.");
                break;
            }

            emitLog(`Fetching page ${page} (${rawRecords.length} records so far)...`);

            const payload = {
                page,
                menuPageId,
                menuPageTypes: MENU_PAGE_TYPES,
                term: "",
                sortBy: "ALPHA",
                displayType: "condensed"
            };

            const response = await axios.post(ENDPOINT, payload, { headers });
            const html = typeof response.data === 'string'
                ? response.data
                : JSON.stringify(response.data);

            const pageRecords = extractFromPage(html);
            emitLog(`Page ${page}: ${pageRecords.length} exhibitors extracted.`);

            if (pageRecords.length === 0) {
                emitLog("Empty page — all results collected.");
                break;
            }

            rawRecords.push(...pageRecords);

            if (page >= 500) {
                emitLog("WARNING: Reached page 500 safety cap. Stopping.");
                break;
            }

            page++;
            await new Promise(r => setTimeout(r, 700));
        }

    } catch (error) {
        if (error.response?.status === 403) {
            emitLog("ERROR 403: Session expired. Grab a fresh cURL and update customInputs[1] (CSRF) and customInputs[2] (Cookie).");
        }
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};