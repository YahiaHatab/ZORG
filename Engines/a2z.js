/**
 * ZORG-Ω Engine: A2Z / a2zinc General Engine v11
 * Platform: a2zinc.net floorplan + SmallWorld detail pages
 *
 * Inputs:
 *   customInputs[0] — cURL command (required)
 *                     F12 → Network → filter "api/exhibitor" → right-click → Copy as cURL (bash)
 *   customInputs[1] — SmallWorld BoothClick URL (optional, only needed if auto-detection fails)
 *                     Find it by: opening the floorplan page → F12 → Sources tab →
 *                     search for "strBoothClickURL" → copy the value (e.g. https://fall2026.smallworldlabs.com/?page_id=2424&boothId=)
 */

const axios = require('axios');

module.exports = async function scrapeA2Z(params, emitLog, runState) {
    emitLog("⚙️  A2Z Engine v11 initializing...");

    // ─── 1. PARSE INPUTS ──────────────────────────────────────────────────────
    const curlInput         = (params.customInputs?.[0] || params.customInput || '').trim();
    let manualBoothClickUrl = (params.customInputs?.[1] || '').trim();

    if (!curlInput) throw new Error("Input 1 missing: Paste the cURL command for the api/exhibitor request.");

    // Auto-decode manual input if URL-encoded
    if (manualBoothClickUrl && manualBoothClickUrl.includes('%')) {
        try { manualBoothClickUrl = decodeURIComponent(manualBoothClickUrl); } catch (e) {}
    }

    // ─── 2. PARSE cURL ────────────────────────────────────────────────────────
    const curlUrlMatch = curlInput.match(/curl\s+['"]?(https?:\/\/[^\s'"\\]+)['"]?/i);
    if (!curlUrlMatch) throw new Error("Could not find a URL in the pasted cURL command.");

    let apiUrl;
    try { apiUrl = new URL(curlUrlMatch[1]); }
    catch (e) { throw new Error("Could not parse the URL from cURL command."); }

    // Extract referer from cURL headers
    const refererMatch  = curlInput.match(/-H\s+['"]referer:\s*(https?:\/\/[^'"]+)['"]/i);
    const floorplanPage = refererMatch ? refererMatch[1].trim() : null;
    if (!floorplanPage) throw new Error("Could not find 'referer' header in cURL. Make sure you copied the full cURL (bash) command.");

    // Parse API params
    const qs         = apiUrl.searchParams;
    const mapId      = qs.get('mapId');
    const eventId    = qs.get('eventId');
    const appId      = qs.get('appId');
    const langId     = qs.get('langId') || '1';
    const fpViewType = qs.get('floorplanViewType') || 'VIEW3';
    const imgHost    = apiUrl.hostname;

    if (!mapId || !eventId || !appId) throw new Error("Could not parse mapId/eventId/appId from cURL URL.");

    // ─── 3. DERIVE SITE BASE (with fallback) ──────────────────────────────────
    // Try to extract /clients/ORG/SHOW/public from the referer
    let siteBase = null;
    try {
        const fpUrl     = new URL(floorplanPage);
        const pathMatch = fpUrl.pathname.match(/^(\/clients\/[^/]+\/[^/]+\/public)/i);
        if (pathMatch) {
            siteBase = `${fpUrl.protocol}//${fpUrl.host}${pathMatch[1]}`;
        }
    } catch (e) {}

    if (siteBase) {
        emitLog(`🏗️  Site base: ${siteBase}`);
    } else {
        emitLog(`⚠️  Could not derive site base from referer — continuing without it (not required for SmallWorld scraping).`);
    }

    emitLog(`📡 ${imgHost} | mapId=${mapId} | eventId=${eventId}`);
    emitLog(`🌐 Floorplan: ${floorplanPage}`);

    // ─── 4. GET strBoothClickURL ──────────────────────────────────────────────
    let boothClickUrl = null;

    if (manualBoothClickUrl) {
        // Manual override provided — skip auto-detection
        boothClickUrl = manualBoothClickUrl;
        emitLog(`🔗 Using manual BoothClickURL: ${boothClickUrl}`);
    } else {
        // Auto-detect from floorplan page source
        emitLog("🔍 Auto-detecting strBoothClickURL from floorplan page source...");
        try {
            const browserHeaders = {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
                'cache-control': 'no-cache',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
            };
            const pageResp   = await axios.get(floorplanPage, { headers: browserHeaders, timeout: 30000, maxRedirects: 5 });
            const pageSource = typeof pageResp.data === 'string' ? pageResp.data : JSON.stringify(pageResp.data);

            const boothClickMatch = pageSource.match(/strBoothClickURL\s*=\s*["']([^"']+)["']/i);
            if (boothClickMatch) {
                boothClickUrl = boothClickMatch[1].trim();
                if (boothClickUrl.includes('%')) {
                    try { boothClickUrl = decodeURIComponent(boothClickUrl); } catch (e) {}
                }
                emitLog(`✅ Auto-detected BoothClickURL: ${boothClickUrl}`);
            } else {
                emitLog(`⚠️  strBoothClickURL not found in page source.`);
            }
        } catch (e) {
            emitLog(`⚠️  Could not fetch floorplan page: ${e.message}`);
        }

        if (!boothClickUrl) {
            throw new Error(
                "Could not auto-detect strBoothClickURL.\n" +
                "➡️  Fix: Open the floorplan page → F12 → Sources tab (or Debugger) → " +
                "search for 'strBoothClickURL' → copy the value → paste it into Input 2 and re-run."
            );
        }
    }

    // ─── 5. FETCH EXHIBITOR LIST (JSONP) ──────────────────────────────────────
    emitLog("📦 Fetching exhibitor list...");

    const apiHeaders = {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'referer': floorplanPage,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
    };

    const listUrl = new URL(`https://${imgHost}/api/exhibitor`);
    listUrl.searchParams.set('callback', `zorgCb_${Date.now()}`);
    listUrl.searchParams.set('mapId', mapId);
    listUrl.searchParams.set('eventId', eventId);
    listUrl.searchParams.set('appId', appId);
    listUrl.searchParams.set('floorplanViewType', fpViewType);
    listUrl.searchParams.set('langId', langId);
    listUrl.searchParams.set('boothId', '');
    listUrl.searchParams.set('shMode', '');
    listUrl.searchParams.set('minLblSize', '2');
    listUrl.searchParams.set('maxLblSize', '10');
    listUrl.searchParams.set('minCnSize', '2');
    listUrl.searchParams.set('maxCnSize', '11');
    listUrl.searchParams.set('_', Date.now().toString());

    let exhibitorList = [];
    try {
        const listResp = await axios.get(listUrl.toString(), { headers: apiHeaders, timeout: 30000 });
        const raw      = typeof listResp.data === 'string' ? listResp.data : JSON.stringify(listResp.data);
        const startIdx = raw.indexOf('[');
        const endIdx   = raw.lastIndexOf(']');
        if (startIdx === -1 || endIdx === -1) throw new Error("Could not locate JSON array in response.");
        exhibitorList = JSON.parse(raw.substring(startIdx, endIdx + 1));
        if (!Array.isArray(exhibitorList)) throw new Error("Parsed value is not an array.");
    } catch (e) {
        throw new Error(`Floorplan API fetch failed: ${e.message}`);
    }

    emitLog(`✅ ${exhibitorList.length} exhibitors found.`);

    // ─── 6. HTML PARSING UTILITIES ────────────────────────────────────────────
    function stripHtml(str) {
        return str
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#039;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function parseFormatA(html) {
        const pairs = {};
        const rowRe = /<div[^>]*class="[^"]*text-secondary[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*class="[^"]*profileResponse[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
        let m;
        while ((m = rowRe.exec(html)) !== null) {
            const label = stripHtml(m[1]).toLowerCase().trim();
            const value = stripHtml(m[2]).trim();
            if (label && value) pairs[label] = value;
        }
        return pairs;
    }

    function parseFormatB(html) {
        const pairs      = parseFormatA(html);
        const contactRe  = /<div[^>]*class="[^"]*clickable_card[^"]*"[\s\S]*?<h6[^>]*data-generic-layout="heading"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i;
        const contactMatch = html.match(contactRe);
        if (contactMatch) {
            const name = stripHtml(contactMatch[1]).trim();
            if (name) pairs['contact'] = name;
        }
        return pairs;
    }

    function extractFields(pairs) {
        const get = (...keys) => {
            for (const k of keys) {
                const val = pairs[k.toLowerCase()];
                if (val && val.trim().length > 0) return val.trim();
            }
            return 'N/A';
        };
        return {
            phone:       get('phone', 'telephone', 'mobile', 'cell', 'phone number'),
            email:       get('email', 'e-mail', 'email address'),
            contactName: get('contact', 'contact name', 'name', 'representative', 'rep', 'primary contact'),
            address:     get('address', 'street', 'location', 'mailing address'),
            country:     get('country', 'nation'),
            website:     get('website', 'web site', 'url', 'web address', 'homepage', 'web')
        };
    }

    function parsePage(html) {
        const isFormatB = /data-generic-layout="heading"|clickable_card/i.test(html);
        return extractFields(isFormatB ? parseFormatB(html) : parseFormatA(html));
    }

    // ─── 7. DETAIL PAGE FETCHER ───────────────────────────────────────────────
    const pageHeaders = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
    };

    async function fetchExhibitor(exh) {
        const hlValue    = exh.hyperLinkFieldValue || String(exh.id);
        const profileUrl = boothClickUrl + hlValue;
        const boothLabel = exh.label?.text || '';

        let phone = 'N/A', email = 'N/A', contactName = 'N/A',
            address = 'N/A', country = 'N/A';

        try {
            const resp = await axios.get(profileUrl, {
                headers: pageHeaders, timeout: 20000, maxRedirects: 5
            });
            const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
            if (!/company not found|no exhibitor|not available/i.test(html)) {
                const fields = parsePage(html);
                phone        = fields.phone;
                email        = fields.email;
                contactName  = fields.contactName;
                address      = fields.address;
                country      = fields.country;
            }
        } catch (e) { /* non-fatal */ }

        return {
            "Company Name":  exh.name || '',
            "Phone":         phone,
            "Country":       country,
            "Contact Name":  contactName,
            "Email":         email,
            "Address":       address,
            "Booth":         boothLabel,
            "Website":       profileUrl
        };
    }

    // ─── 8. CONCURRENT EXTRACTION LOOP ────────────────────────────────────────
    const CONCURRENCY = 6;
    const DELAY_MS    = 300;
    const rawRecords  = [];

    emitLog(`🚀 Scraping ${exhibitorList.length} SmallWorld profiles (batch: ${CONCURRENCY})...`);

    for (let i = 0; i < exhibitorList.length; i += CONCURRENCY) {
        if (runState && runState.aborted) { emitLog("⛔ Aborted."); break; }
        const results = await Promise.all(exhibitorList.slice(i, i + CONCURRENCY).map(fetchExhibitor));
        rawRecords.push(...results);
        emitLog(`📊 ${Math.min(i + CONCURRENCY, exhibitorList.length)} / ${exhibitorList.length}`);
        await new Promise(r => setTimeout(r, DELAY_MS));
    }

    emitLog(`✅ Done. ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};