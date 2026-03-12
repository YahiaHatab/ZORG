/**
 * ZORG-Ω Custom Scraper: Salone Del Mobile 2026
 * Target: AWS Execute-API (exhibitorSearch)
 */
const axios = require('axios');

module.exports = async function scrapeSaloneDelMobile(params, emitLog, runState) {
    emitLog("🚀 Initializing Salone Del Mobile 2026 Engine...");

    // The user provides the base params string from the network payload
    // Example: "anno=2026&evento=SMI|CDA|...&pageSize=12"
    const baseParams = params.customInput;

    if (!baseParams) {
        throw new Error("Missing 'params' string in Custom Input. See instructions.");
    }

    const API_URL = 'https://hzh2dgp2ke.execute-api.eu-west-1.amazonaws.com/main/exhibitorSearch';
    const rawRecords = [];
    let currentPage = 1;
    let keepGoing = true;

    try {
        while (keepGoing) {
            // 🛑 Check for User Abort
            if (runState && runState.aborted) {
                emitLog("🛑 Abort signal received. Terminating scrape gracefully...");
                break;
            }

            emitLog(`📡 Requesting Page ${currentPage}...`);

            // We replace or append the pageNumber to the user's base params
            const requestParams = `${baseParams.replace(/&pageNumber=\d+/, '')}&pageNumber=${currentPage}`;

            const response = await axios.post(API_URL, {
                params: requestParams
            }, {
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'content-type': 'application/json; charset=UTF-8',
                    'origin': 'https://www.salonemilano.it',
                    'referer': 'https://www.salonemilano.it/',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });

            const items = response.data?.data;

            if (items && Array.isArray(items) && items.length > 0) {
                // Map to ZORG-Ω Standard Schema
                const mapped = items.map(ex => ({
                    "Company Name": ex.nomeEspositore || "N/A",
                    "Phone": ex.telefono || "N/A",
                    "Country": ex.nazioneIso3AlphaCode || "N/A",
                    "Contact Name": "N/A", // Not provided in this specific API endpoint
                    "Email": ex.email || ex.emailDigitale || "N/A",
                    "Address": ex.indirizzo || "N/A",
                    "City": ex.comune || "N/A",
                    "Booth": (ex.hall && ex.stand) ? `Hall ${ex.hall} - ${ex.stand}` : (ex.stand || "N/A"),
                    "Website": ex.sitoInternet || "N/A"
                }));

                rawRecords.push(...mapped);
                
                // UI Telemetry
                emitLog(`✅ Page ${currentPage}: Extracted ${mapped.length} records. (Total: ${rawRecords.length})`);
                
                // Update Progress Bar (assuming ~100 pages based on catalog size)
                runState?.updateProgress?.(currentPage, 100);

                currentPage++;
                
                // Anti-throttling
                await new Promise(r => setTimeout(r, 400));
            } else {
                emitLog("🏁 End of catalog reached or no more data.");
                keepGoing = false;
            }
        }
    } catch (error) {
        emitLog(`❌ FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`🏆 Mission Complete. Total Exhibitors: ${rawRecords.length}`);
    return rawRecords;
};
