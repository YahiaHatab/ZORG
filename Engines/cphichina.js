/**
 * ZORG-Ω Engine: CPHI China (Shanghai) API - High Velocity
 * @param {Object} params - params.token (The Cookie)
 * @param {Function} emitLog - UI Telemetry
 * @param {Object} runState - State object to monitor cancellation
 * @returns {Array} Standardized exhibitor records
 */
module.exports = async function scrapeCPHIChina(params, emitLog, runState) {
    emitLog("🚀 Initializing CPHI China High-Velocity Engine (50/page)...");

    const cookie = params.token || params.customInput || (params.customInputs && params.customInputs[0]);
    if (!cookie) throw new Error("Missing required Cookie in input fields.");

    const rawRecords = [];
    let page = 1;
    let hasMore = true;
    const limit = 50; // Set to max allowed by the platform

    try {
        while (hasMore) {
            if (runState && runState.aborted) {
                emitLog("Stop command received. Finalizing collected data...");
                break; 
            }

            emitLog(`Fetching Page ${page} (Batch size: ${limit})...`);

            const response = await fetch('https://exhibitors.cphi-china.cn/api/front/index', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Cookie': cookie,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                    'Origin': 'https://exhibitors.cphi-china.cn',
                    'Referer': 'https://exhibitors.cphi-china.cn/shanghai?language=en'
                },
                body: `page=${page}&limit=${limit}&exhitor=shanghai`
            });

            if (!response.ok) {
                emitLog(`⚠️ Server Error ${response.status}. Batch failed.`);
                break;
            }

            const json = await response.json();
            
            // Extract the list from any of the possible JSON structures
            const items = json.data?.data || json.data || json.list || [];

            if (items.length === 0) {
                emitLog("Reached end of directory list.");
                hasMore = false;
                break;
            }

            for (const item of items) {
                const co = item.company || {};
                rawRecords.push({
                    "Company Name": item.cc_company_name_en || item.cc_company_name || co.company_name || "N/A",
                    "Phone": co.company_telephone || "N/A",
                    "Country": item.country_en || item.country || co.country || "N/A",
                    "Contact Name": co.contactor_name || "N/A",
                    "Email": co.message_email || co.email || "N/A",
                    "Address": co.full_address || co.detail_address || "N/A",
                    "City": co.city || "N/A",
                    "Booth": item.booth_no || "N/A",
                    "Website": co.website_url || item.homepage_en || "N/A"
                });
            }

            emitLog(`📊 Progress: ${rawRecords.length} exhibitors scraped.`);
            
            // Estimate progress based on ~3,600 total exhibitors
            runState?.updateProgress?.(rawRecords.length, 3600);

            page++;
            // 1 second delay to prevent "429 Too Many Requests" errors
            await new Promise(r => setTimeout(r, 1000)); 
        }
    } catch (error) {
        emitLog(`❌ SCRAPE ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`✅ SUCCESS: ${rawRecords.length} exhibitors extracted.`);
    return rawRecords;
};