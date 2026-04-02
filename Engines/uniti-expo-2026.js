/**
 * ZORG-Ω Engine — UNITI expo 2026 (TYPO3 / comatecexpo plugin)
 * Target: www.uniti-expo.de/en/trade-fair/exhibitor-directory
 * Engine Type: Specific (session cookie required as input)
 * Total exhibitors: ~523, 20 per page
 * v3: full rewrite of parser based on confirmed HTML structure
 *     - entry wrapper: .exhibitor-directory-entry
 *     - company name:  .exhibitor-directory-entry-header .company-name
 *     - booth:         .stand-data span span
 *     - contact block: .exhibitor-directory-entry-body .contact-data p
 */

const axios   = require('axios');
const cheerio = require('cheerio');

module.exports = async function scrapeUnitiExpo2026(params, emitLog, runState) {
    const rawRecords = [];

    // ── Input validation ──────────────────────────────────────────────────────
    const cookieString = (params.customInputs && params.customInputs[0] || '').trim();
    if (!cookieString) {
        throw new Error(
            'Input required: paste the full cookie string from DevTools ' +
            '(fe_typo_user + all __Secure-typo3nonce_* values).'
        );
    }

    // ── Constants ─────────────────────────────────────────────────────────────
    const FIRST_PAGE_URL = 'https://www.uniti-expo.de/en/trade-fair/exhibitor-directory';
    const LOAD_MORE_URL  =
        'https://www.uniti-expo.de/en/trade-fair/exhibitor-directory' +
        '?tx_comatecexpo_exhibitordirectory%5Bcontroller%5D=ExhibitorDirectory' +
        '&tx_comatecexpo_exhibitordirectory%5Baction%5D=loadMore';

    const MAX_PAGES = 80;

    const COMMON_HEADERS = {
        'accept-language':    'en-US,en;q=0.9,ar;q=0.8',
        'cache-control':      'no-cache',
        'pragma':             'no-cache',
        'priority':           'u=1, i',
        'sec-ch-ua':          '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        'sec-ch-ua-mobile':   '?0',
        'sec-ch-ua-platform': '"Windows"',
        'user-agent':         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'cookie':             cookieString
    };

    // ── HTML parser ───────────────────────────────────────────────────────────
    function parseExhibitors(html) {
        const $       = cheerio.load(html);
        const results = [];

        $('.exhibitor-directory-entry').each((_, entry) => {
            const $entry = $(entry);

            // ── Header: company name + booth ──────────────────────────────────
            const companyName = $entry.find('.company-name').first().text().trim() || 'N/A';

            // Booth lives in .stand-data — grab deepest text, strip whitespace
            const boothRaw = $entry.find('.stand-data').first().text().trim();
            const booth    = boothRaw.replace(/\s+/g, ' ').trim() || 'N/A';

            // ── Body: contact data ────────────────────────────────────────────
            const $contactP = $entry.find('.contact-data p').first();

            let cityZip        = 'N/A';
            let country        = 'N/A';
            let phone          = 'N/A';
            let website        = 'N/A';

            if ($contactP.length) {
                // Split on <br> to get individual lines
                const rawHtml = $contactP.html() || '';
                const lines   = rawHtml
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]+>/g, ' ')
                    .split('\n')
                    .map(l => l.replace(/\s+/g, ' ').trim())
                    .filter(l => l && l !== companyName);

                let unlabelledSeen = 0;

                for (const line of lines) {
                    const lower = line.toLowerCase();
                    if (lower.startsWith('phone:')) {
                        phone = line.replace(/^phone:\s*/i, '').trim() || 'N/A';
                    } else if (lower.startsWith('web:')) {
                        const anchor = $contactP.find('a').first();
                        website = (anchor.attr('href') || line.replace(/^web:\s*/i, '')).trim() || 'N/A';
                    } else if (lower.startsWith('fax:') || lower.startsWith('e-mail:') || lower.startsWith('email:')) {
                        // skip fax; email not shown in directory listing
                    } else {
                        if (unlabelledSeen === 0) {
                            cityZip = line; // e.g. "40024 Castel San Pietro Terme"
                        } else if (unlabelledSeen === 1) {
                            country = line; // e.g. "Italy"
                        }
                        unlabelledSeen++;
                    }
                }
            }

            results.push({
                'Company Name': companyName,
                'Phone':        phone,
                'Country':      country,
                'Contact Name': 'N/A',
                'Email':        'N/A',
                'Address':      cityZip,
                'Booth':        booth,
                'Website':      website
            });
        });

        return results;
    }

    // ── Extraction ────────────────────────────────────────────────────────────
    try {
        emitLog('ZORG-Ω ▸ UNITI expo 2026 (TYPO3 / comatecexpo) — Specific Engine v3');
        emitLog('Step 1: Fetching first page (server-rendered HTML)...');

        // ── Page 1: GET full page ─────────────────────────────────────────────
        let firstResponse;
        try {
            firstResponse = await axios.get(FIRST_PAGE_URL, {
                headers: {
                    ...COMMON_HEADERS,
                    'accept':         'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'sec-fetch-dest': 'document',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'none',
                    'sec-fetch-user': '?1',
                    'upgrade-insecure-requests': '1'
                },
                responseType: 'text'
            });
        } catch (err) {
            const status = err.response ? err.response.status : 'network error';
            emitLog(`First page fetch failed: HTTP ${status}. Cookie may be expired.`);
            throw err;
        }

        const firstHtml = firstResponse.data || '';

        // Read total + page size from Load More button attributes
        const cntMatch  = firstHtml.match(/data-cnt="(\d+)"/);
        const showMatch = firstHtml.match(/data-show="(\d+)"/);
        const total     = cntMatch  ? parseInt(cntMatch[1],  10) : 523;
        const pageSize  = showMatch ? parseInt(showMatch[1], 10) : 20;
        const totalPages = Math.ceil(total / pageSize);

        emitLog(`Total exhibitors: ${total} | Page size: ${pageSize} | Pages: ${totalPages}`);

        const firstPageRecords = parseExhibitors(firstHtml);
        emitLog(`Page 1: ${firstPageRecords.length} records parsed.`);
        rawRecords.push(...firstPageRecords);

        await new Promise(r => setTimeout(r, 700));

        // ── Pages 2..N: POST loadMore ─────────────────────────────────────────
        for (let page = 2; page <= Math.min(totalPages, MAX_PAGES); page++) {
            if (runState && runState.aborted) {
                emitLog('Extraction aborted by user. Halting gracefully.');
                break;
            }

            emitLog(`Fetching page ${page}/${totalPages}...`);

            const body = new URLSearchParams();
            body.append('page',          String(page));
            body.append('search',        '');
            body.append('initialLetter', '');

            let response;
            try {
                response = await axios.post(LOAD_MORE_URL, body.toString(), {
                    headers: {
                        ...COMMON_HEADERS,
                        'accept':           '*/*',
                        'content-type':     'application/x-www-form-urlencoded; charset=UTF-8',
                        'origin':           'https://www.uniti-expo.de',
                        'referer':          'https://www.uniti-expo.de/en/trade-fair/exhibitor-directory',
                        'sec-fetch-dest':   'empty',
                        'sec-fetch-mode':   'cors',
                        'sec-fetch-site':   'same-origin',
                        'x-requested-with': 'XMLHttpRequest'
                    },
                    responseType: 'text'
                });
            } catch (err) {
                const status = err.response ? err.response.status : 'network error';
                emitLog(`Request error on page ${page}: HTTP ${status}`);
                throw err;
            }

            const pageHtml = response.data || '';
            const records  = parseExhibitors(pageHtml);

            if (records.length === 0) {
                emitLog(`Page ${page} returned 0 records — end of data.`);
                break;
            }

            emitLog(`Page ${page}: ${records.length} records parsed.`);
            rawRecords.push(...records);

            await new Promise(r => setTimeout(r, 700));
        }

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};