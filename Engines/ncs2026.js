/**
 * ZORG-Ω Custom Scraper: National Convenience Show 2026
 * Target: Algolia Search API (Enhanced Booth Extraction)
 */
const axios = require('axios');

module.exports = async function scrapeNCS(params, emitLog, runState) {
    emitLog("🚀 Initializing NCS 2026 Engine with Enhanced Booth Detection...");

    const appId = "9WUDIPIUPO";
    const apiKey = "df8a06b8eb5d9bd0839e88fc7606560f";
    const apiUrl = `https://9wudipiupo-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=${apiKey}&x-algolia-application-id=${appId}`;
    const indexName = "production-12-e475644e-686b-11f0-83f0-000000000000-exhibitors-2026-national-convenience-show";

    const rawRecords = [];
    let page = 0;
    let hasMore = true;

    try {
        while (hasMore) {
            if (runState && runState.aborted) {
                emitLog("🛑 Abort signal received. Exiting...");
                break;
            }

            emitLog(`📡 Fetching Page ${page}...`);

            const payload = {
                "requests": [{
                    "indexName": indexName,
                    "params": `query=&hitsPerPage=500&page=${page}`
                }]
            };

            const response = await axios.post(apiUrl, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });

            const results = response.data?.results?.[0];
            const hits = results?.hits || [];
            const nbPages = results?.nbPages || 1;

            if (hits.length === 0) break;

            const mapped = hits.map(ex => {
                // --- ROBUST BOOTH DETECTION ---
                let standNum = "N/A";
                
                if (ex.stands && Array.isArray(ex.stands) && ex.stands.length > 0) {
                    const firstStand = ex.stands[0];
                    // Algolia objects usually hide the booth in one of these three keys
                    standNum = firstStand.name || firstStand.number || firstStand.label || 
                               (typeof firstStand === 'string' ? firstStand : "N/A");
                } else if (ex.booth_number) {
                    standNum = ex.booth_number;
                } else if (ex.location) {
                    standNum = ex.location;
                }

                return {
                    "Company Name": ex.name || "N/A",
                    "Phone": ex.phone || ex.telephone || "N/A",
                    "Country": ex.country || "N/A",
                    "Contact Name": ex.contact_person || ex.contact_name || "N/A",
                    "Email": ex.email || "N/A",
                    "Address": ex.address || "N/A",
                    "City": ex.city || "N/A",
                    "Booth": standNum,
                    "Website": (ex.social_links && ex.social_links.website) ? ex.social_links.website : (ex.website || "N/A")
                };
            });

            rawRecords.push(...mapped);
            emitLog(`✅ Page ${page}: Captured ${mapped.length} exhibitors (Booth detected for most).`);

            runState?.updateProgress?.(page + 1, nbPages);

            if (page >= nbPages - 1) {
                hasMore = false;
            } else {
                page++;
                await new Promise(r => setTimeout(r, 300));
            }
        }
    } catch (error) {
        emitLog(`❌ SCRAPE ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`🏆 Total records found: ${rawRecords.length}`);
    return rawRecords;
};