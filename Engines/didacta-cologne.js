/**
 * ZORG-Ω Module: Didacta Cologne Scraper (V2 - High Resiliency)
 * @param {Object} params - Payload containing params.token (PHPSESSID)
 * @param {Function} emitLog - Real-time telemetry function
 */
const axios = require('axios');

module.exports = async function scrapeDidacta(params, emitLog) {
    emitLog("Initializing Resilient ZORG-Ω Didacta Engine...");

    const sessionCookie = params.token || 'PHPSESSID=l0stpu70bace7ociddc6o7thnj;';
    const BASE_URL = 'https://www.didacta-cologne.com/didacta-exhibitors/list-of-exhibitors/';
    
    const UAs = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ];

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    let allExhibitors = [];
    let start = 0; // Set this to 620 if you want to resume manually
    let hasMore = true;

    try {
        while (hasMore) {
            let retryCount = 0;
            let success = false;
            let response;

            while (retryCount < 3 && !success) {
                try {
                    emitLog(`Fetching offset ${start} (Attempt ${retryCount + 1})...`);
                    response = await axios.get(`${BASE_URL}?route=aussteller/blaettern&fw_ajax=1&paginatevalues={"stichwort":"","suchart":"alle"}&start=${start}&dat=342244`, { 
                        headers: { 
                            'accept': 'text/html, */*; q=0.01',
                            'referer': BASE_URL,
                            'x-requested-with': 'XMLHttpRequest',
                            'Cookie': sessionCookie,
                            'user-agent': UAs[Math.floor(Math.random() * UAs.length)] 
                        },
                        timeout: 30000 // Increased timeout to 30s
                    });
                    success = true;
                } catch (err) {
                    retryCount++;
                    emitLog(`Timeout/Error at ${start}. Retrying in ${retryCount * 5}s...`);
                    await sleep(retryCount * 5000);
                }
            }

            if (!success) throw new Error(`Failed to fetch offset ${start} after 3 attempts.`);

            const html = response.data;
            const blocks = html.split('<div class="item');

            if (blocks.length <= 1 || !html.includes('class="item')) {
                emitLog("EndOfList: No more exhibitors found.");
                hasMore = false;
                break;
            }

            blocks.shift();
            blocks.forEach(block => {
                const nameMatch = block.match(/<strong[^>]*>(.*?)<\/strong>/);
                const countryMatch = block.match(/<p>\s*([A-Za-z\s]+)\s*<\/p>/);
                const boothMatch = block.match(/<span>(Hall.*?)<\/a>/);

                if (nameMatch) {
                    allExhibitors.push({
                        "Company Name": nameMatch[1].trim(),
                        "Country": countryMatch ? countryMatch[1].trim() : "N/A",
                        "Booth": boothMatch ? boothMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim() : "N/A",
                        "Phone": "N/A", "Contact Name": "N/A", "Email": "N/A", "Address": "N/A", "City": "N/A", "Website": "N/A"
                    });
                }
            });

            emitLog(`Extracted: ${allExhibitors.length} total.`);
            start += 20;
            await sleep(Math.floor(Math.random() * 2000) + 3000); // 3-5s randomized cooldown
        }

    } catch (error) {
        emitLog(`FATAL: ${error.message}`);
        throw error;
    }

    return allExhibitors;
};