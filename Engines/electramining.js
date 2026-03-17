/**
 * ZORG-Ω Custom Engine
 * Show: Electra Mining 2026
 * URL: https://www.electramining.co.za/visit/exhibitor-list
 * Type: SPECIFIC ENGINE — No user input required.
 */

const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async function scrapeElectraMining(params, emitLog, runState) {
    emitLog("🔌 Initializing Electra Mining Extraction Engine...");

    const BASE_URL = "https://www.electramining.co.za/visit/exhibitor-list";
    const SEARCH_GROUP = "21010716-exhibitors";

    const HEADERS = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=0, i',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'cookie': 'cfid=8ab39791-b9ca-4f8d-828e-876e6bfef74a; cftoken=0; CFID=8ab39791-b9ca-4f8d-828e-876e6bfef74a; CFTOKEN=0; visitorSession={}; _ga=GA1.1.1757307065.1773691041'
    };

    const rawRecords = [];

    try {
        // --- STEP 1: Detect total number of pages ---
        emitLog("📡 Fetching page 1 to determine total pages...");

        const firstPageUrl = `${BASE_URL}?&sortby=title%20asc%2Ctitle%20asc&page=1&searchgroup=${SEARCH_GROUP}`;
        const firstRes = await axios.get(firstPageUrl, { headers: HEADERS });
        const $first = cheerio.load(firstRes.data);

        // Try to find last page number from pagination
        let totalPages = 1;
        $first('.pagination a, .m-pagination a, [class*="pagination"] a').each((_, el) => {
            const txt = $first(el).text().trim();
            const num = parseInt(txt, 10);
            if (!isNaN(num) && num > totalPages) totalPages = num;
        });

        // Fallback: look for any element with a high page number in href
        $first('a[href*="page="]').each((_, el) => {
            const href = $first(el).attr('href') || '';
            const match = href.match(/page=(\d+)/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (!isNaN(num) && num > totalPages) totalPages = num;
            }
        });

        emitLog(`📄 Detected ${totalPages} page(s). Starting extraction...`);

        // Parse page 1 immediately
        parseExhibitors($first, rawRecords, emitLog, 1);

        // --- STEP 2: Loop through remaining pages ---
        for (let page = 2; page <= totalPages; page++) {

            if (runState && runState.aborted) {
                emitLog("🛑 Extraction aborted by user. Halting gracefully.");
                break;
            }

            emitLog(`📥 Fetching page ${page} of ${totalPages}...`);

            const pageUrl = `${BASE_URL}?&sortby=title%20asc%2Ctitle%20asc&page=${page}&searchgroup=${SEARCH_GROUP}`;

            try {
                const res = await axios.get(pageUrl, { headers: HEADERS });
                const $ = cheerio.load(res.data);
                parseExhibitors($, rawRecords, emitLog, page);
            } catch (pageErr) {
                emitLog(`⚠️ Warning: Failed to fetch page ${page} — ${pageErr.message}. Skipping.`);
            }

            // Respectful delay
            await new Promise(r => setTimeout(r, 900));
        }

    } catch (error) {
        emitLog(`❌ FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`✅ Extraction complete. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};


/**
 * Parses exhibitors from a loaded Cheerio instance and pushes to rawRecords.
 * Each exhibitor is wrapped in an <article class="m-exhibitors-list__list__items__item ...">
 * A <script type="application/ld+json"> inside each article contains structured data
 * including website URL, description, and address country.
 */
function parseExhibitors($, rawRecords, emitLog, pageNum) {
    let count = 0;

    // The real wrapper is <article class="m-exhibitors-list__list__items__item ...">
    $('article.m-exhibitors-list__list__items__item').each((_, item) => {
        const $item = $(item);

        // --- Company Name ---
        const companyName = $item
            .find('a.m-exhibitors-list__list__items__item__header__title__link')
            .text().trim();

        if (!companyName) return; // skip empty

        // --- Hall & Stand ---
        const standRaw = $item
            .find('span.m-exhibitors-list__list__items__item__header__meta__stand')
            .text().trim();

        let hall = '';
        let stand = '';
        const hallMatch = standRaw.match(/Hall:\s*([^\s,]+)/i);
        const standMatch = standRaw.match(/Stand:\s*([^\s,]+)/i);
        if (hallMatch) hall = hallMatch[1].trim();
        if (standMatch) stand = standMatch[1].trim();
        const booth = hall && stand ? `Hall ${hall} - Stand ${stand}` : standRaw;

        // --- JSON-LD structured data (goldmine: url, description, address) ---
        let website = '';
        let description = '';
        let country = 'South Africa';
        let city = '';
        let address = '';

        const ldJson = $item.find('script[type="application/ld+json"]').html();
        if (ldJson) {
            try {
                const ld = JSON.parse(ldJson);
                const entity = ld.mainEntity || ld;
                website    = entity.url         || '';
                description = entity.description || '';
                // Clean HTML entities from description
                description = description.replace(/&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&[a-z]+;/gi, '');
                if (entity.address) {
                    country = entity.address.addressCountry || country;
                    city    = entity.address.addressLocality || '';
                    address = entity.address.streetAddress   || '';
                }
            } catch (e) {
                // JSON parse failed — no structured data available, continue
            }
        }

        // --- Exhibitor tier/zone label (e.g. "Standard", "Premium") ---
        const tier = $item.find('.p-label').text().trim();

        rawRecords.push({
            "Company Name": companyName,
            "Booth":        booth,
            "Hall":         hall,
            "Stand":        stand,
            "Website":      website,
            "Description":  description,
            "Tier":         tier,
            "Phone":        "",
            "Email":        "",
            "Country":      country,
            "Contact Name": "",
            "Address":      address,
            "City":         city || "Johannesburg"
        });

        count++;
    });

    emitLog(`   ↳ Page ${pageNum}: extracted ${count} exhibitors.`);
}