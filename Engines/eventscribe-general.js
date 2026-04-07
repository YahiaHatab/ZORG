/**
 * ZORG-Ω Engine — EventScribe / Cadmium
 * Generated from Network Spy recon: *.eventscribe.net
 * Engine Type: General
 * Records per page: Single dump (all exhibitors on one page) + per-booth detail fetch
 */

const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async function scrapeEventScribe(params, emitLog, runState) {
    const baseUrl = (params.customInputs[0] || '').trim().replace(/\/$/, '');
    const cookieString = (params.customInputs[1] || '').trim();

    if (!baseUrl) throw new Error('Input 1 (Base URL) is required. e.g. https://phccconnect2026.eventscribe.net');
    if (!cookieString) throw new Error('Input 2 (Cookie string) is required. Paste your full browser cookie.');

    const rawRecords = [];

    const commonHeaders = {
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'cookie': cookieString
    };

    // ── PASS 1: Fetch exhibitor list and extract BoothID + name + booth number ──
    emitLog('PASS 1: Fetching exhibitor list page...');

    let listHtml;
    try {
        const listResp = await axios.get(`${baseUrl}/SearchByExpoCompany.asp`, {
            params: { pfp: 'BrowseByCompany' },
            headers: {
                ...commonHeaders,
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1'
            }
        });
        listHtml = listResp.data;
    } catch (err) {
        emitLog(`FATAL: Could not fetch exhibitor list — ${err.message}`);
        throw err;
    }

    const $ = cheerio.load(listHtml);

    // EventScribe structure: each exhibitor is a <li> containing:
    //   - an <a href="/ajaxcalls/ExhibitorInfo.asp?rnd=...&BoothID=XXXXX"> wrapping both the booth label and company name
    // We grab all unique hrefs matching that pattern
    const exhibitors = [];
    const seen = new Set();

    $('a[href*="ExhibitorInfo.asp"][href*="BoothID="]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const boothMatch = href.match(/BoothID=(\d+)/i);
        if (!boothMatch) return;

        const boothId = boothMatch[1];
        if (seen.has(boothId)) return;
        seen.add(boothId);

        // Within the same <li>, the first <a> child holds both the booth label
        // (short text like "V5", "134") and the company name as separate text nodes / spans.
        // Grab all text from this <a>:
        const linkText = $(el).text().trim();

        // The booth number is the first token (before the company name)
        // EventScribe renders: "V5\n  A. O. Smith" — split on newline or grab from parent <li>
        const $li = $(el).closest('li');
        // The booth label <a> and name <a> share the same href — get first text node as booth
        const liText = $li.text().replace(/Favorite/gi, '').trim();

        // First non-empty line = booth number, subsequent = company name
        const lines = liText.split(/\n+/).map(l => l.trim()).filter(Boolean);
        const boothNum = lines[0] || 'N/A';
        const companyName = lines[1] || linkText.trim() || 'N/A';

        exhibitors.push({ boothId, boothNum, companyName });
    });

    emitLog(`PASS 1 complete. Found ${exhibitors.length} unique exhibitors.`);

    if (exhibitors.length === 0) {
        emitLog('WARNING: No exhibitors found. Check base URL or cookie validity.');
        return rawRecords;
    }

    // ── PASS 2: Fetch detail popup for each BoothID ──────────────────────────
    emitLog('PASS 2: Fetching exhibitor detail popups...');

    for (let i = 0; i < exhibitors.length; i++) {
        if (runState && runState.aborted) {
            emitLog('Extraction aborted by user. Halting gracefully.');
            break;
        }

        const { boothId, boothNum, companyName } = exhibitors[i];
        const rnd = Math.random().toFixed(7);

        try {
            const detailResp = await axios.get(`${baseUrl}/ajaxcalls/ExhibitorInfo.asp`, {
                params: { rnd, BoothID: boothId },
                headers: {
                    ...commonHeaders,
                    'accept': 'text/html, */*; q=0.01',
                    'referer': `${baseUrl}/SearchByExpoCompany.asp?pfp=BrowseByCompany`,
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    'x-requested-with': 'XMLHttpRequest'
                }
            });

            const html = detailResp.data;
            const d = cheerio.load(html);

            // ── Address block ────────────────────────────────────────────────
            // EventScribe renders a <p> or <strong> block with address, then
            // "Telephone: ..." and "Email: ..." as plain text lines
            const bodyText = d('body').text();

            // Phone: "Telephone: (615) 310-6224"
            let phone = 'N/A';
            const phoneMatch = bodyText.match(/Telephone[:\s]+([^\n\r]+)/i);
            if (phoneMatch) phone = phoneMatch[1].trim();

            // Email: from mailto link (most reliable)
            let email = 'N/A';
            d('a[href^="mailto:"]').each((_, el) => {
                email = (d(el).attr('href') || '').replace('mailto:', '').trim();
                return false; // first only
            });

            // Website: first external link that isn't eventscribe/conferenceharvester/tracking
            let website = 'N/A';
            d('a[href^="http"]').each((_, el) => {
                const href = d(el).attr('href') || '';
                if (
                    !href.includes('eventscribe.net') &&
                    !href.includes('conferenceharvester.com') &&
                    !href.includes('/tracking/') &&
                    !href.includes('GoCadmium')
                ) {
                    website = href;
                    return false;
                }
            });
            // Fallback: tracking redirect links contain the real URL encoded
            if (website === 'N/A') {
                d('a[href*="exhibitorAssetTracking"]').each((_, el) => {
                    // The visible text of the website link is the URL itself
                    const linkText = d(el).text().trim();
                    if (linkText.startsWith('http')) {
                        website = linkText;
                        return false;
                    }
                });
            }

            // Address: lines between company name and "Telephone:"
            let address = 'N/A';
            const addrMatch = bodyText.match(/(?:^|\n)\s*([A-Z][^\n]{5,}(?:\n[^\n]{3,}){0,3})\s*\n\s*(?:Telephone|Tel|Phone)/im);
            if (addrMatch) {
                address = addrMatch[1].replace(/\s+/g, ' ').trim();
            }

            // Country: EventScribe doesn't have a dedicated country field.
            // Extract state/country from address if possible.
            let country = 'N/A';
            const usStateMatch = bodyText.match(/,\s*([A-Z]{2})\s+\d{5}/);
            if (usStateMatch) {
                country = 'United States';
            } else {
                // Look for explicit country line after address
                const countryMatch = bodyText.match(/(?:Country|Nation)[:\s]+([^\n\r]+)/i);
                if (countryMatch) country = countryMatch[1].trim();
            }

            emitLog(`[${i + 1}/${exhibitors.length}] ${companyName} — Booth ${boothNum}`);

            rawRecords.push({
                'Company Name': companyName,
                'Phone':        phone,
                'Country':      country,
                'Contact Name': 'N/A',
                'Email':        email,
                'Address':      address,
                'Booth':        boothNum,
                'Website':      website
            });

        } catch (err) {
            emitLog(`[${i + 1}/${exhibitors.length}] ERROR on BoothID ${boothId}: ${err.message}`);
            rawRecords.push({
                'Company Name': companyName || `[ERROR] BoothID ${boothId}`,
                'Phone':        'N/A',
                'Country':      'N/A',
                'Contact Name': 'N/A',
                'Email':        'N/A',
                'Address':      'N/A',
                'Booth':        boothNum || boothId,
                'Website':      'N/A'
            });
        }

        await new Promise(r => setTimeout(r, 800));
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};