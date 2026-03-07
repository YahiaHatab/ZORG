/**
 * ZORG-Ω Scraper Engine: WindEurope Annual 2026 (Updated with Phone Support)
 * Target: Static HTML Directory with Pagination
 */

const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async function scrapeWindEurope(params, emitLog, runState) {
    emitLog("Initializing WindEurope 2026 Engine...");

    const rawRecords = [];
    const baseUrl = "https://annual2026.windeurope.org/edirectory/list";
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'Cookie': params.token || '_clck=1hyg6lu%5E2%5Eg45%5E0%5E2257; cf_clearance=uXAU.aQ8eh0ll1rSUreyXD6rExrj4I1JfU0PmOtYWvQ-1772846693-1.2.1.1-qM3lfsCgNiLGxJH41oVyiy.SAMOfrgbyx4706QtLZp9YDiJ.06GbDLgCA37JBJRdGZr3vjqAN0znnl6Lrs6eQYl3oUvG9Qd31asQZu0y7t0WvWIle4PGZKqxhhLMEZR6mmw5DuPnV.DSWANgKmdMJWROxaFSEVrC0VwDgW2bLzAIfiLHy8_3Ohlr2B7v4eu4sATUqJHTIyzcscvi2l_9AxDGF.wcT.0cTkRLY5QrBEY; SESS7ca16459f1cb31a8fd592b9c00bd1c7d=a62nv4cjo44dakcc4o53tmvv17;',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Referer': 'https://windeurope.org/'
    };

    try {
        let currentPage = 0;
        let hasNextPage = true;

        while (hasNextPage) {
            if (runState && runState.aborted) {
                emitLog("🛑 Operation aborted by user. Cleaning up...");
                break;
            }

            const url = currentPage === 0 ? baseUrl : `${baseUrl}?page=${currentPage}`;
            emitLog(`Fetching Page ${currentPage + 1}...`);

            const response = await axios.get(url, { headers, timeout: 20000 });
            const $ = cheerio.load(response.data);

            const exhibitorCards = $('.ExhiDirDetails');
            
            if (exhibitorCards.length === 0) {
                emitLog("No more exhibitors found or session expired.");
                break;
            }

            exhibitorCards.each((i, el) => {
                const card = $(el);
                
                // 1. Basic Info
                const companyName = card.find('.companyName h4 b').text().trim() || "N/A";
                const country = card.find('.countryName').text().trim() || "N/A";
                const website = card.find('.contactDetailValue a[href^="http"]').first().attr('href') || "N/A";
                const boothRaw = card.find('h4:contains("Stand")').text() || "N/A";
                const booth = boothRaw.replace(/Stand\(s\)/i, '').trim();

                // 2. Contact Details (Address & Phone)
                const rawAddress = card.find('label:contains("Address:")').next('.contactDetailValue').text();
                const cleanAddress = rawAddress ? rawAddress.replace(/\s+/g, ' ').trim() : "N/A";
                
                const rawPhone = card.find('label:contains("Telephone:")').next('.contactDetailValue').text();
                const phone = rawPhone ? rawPhone.replace(/\s+/g, ' ').trim() : "N/A";

                // 3. City Extraction Logic
                let city = "N/A";
                if (cleanAddress !== "N/A") {
                    const addrParts = cleanAddress.split(',');
                    // Usually City is the second to last part before the Zip code
                    if (addrParts.length >= 2) {
                        city = addrParts[addrParts.length - 2].trim();
                    }
                }

                // 4. Email Fallback
                let email = "N/A";
                const emailOnClick = card.find('.emailLink a').attr('onclick');
                if (emailOnClick && emailOnClick.includes('mailto')) {
                    const matches = emailOnClick.match(/'([^']+)'/);
                    email = matches ? `Portal Link: ${matches[1]}` : "Available via Portal";
                }

                rawRecords.push({
                    "Company Name": companyName,
                    "Phone": phone,
                    "Country": country,
                    "Contact Name": "N/A",
                    "Email": email,
                    "Address": cleanAddress,
                    "City": city,
                    "Booth": booth,
                    "Website": website
                });
            });

            emitLog(`Parsed ${exhibitorCards.length} exhibitors from page ${currentPage + 1}.`);

            // Pagination Check
            const nextButton = $('li.pager-next a');
            if (nextButton.length > 0) {
                currentPage++;
                await new Promise(r => setTimeout(r, 1500)); // Respectful rate limiting
            } else {
                hasNextPage = false;
            }
        }

    } catch (error) {
        emitLog(`❌ Error: ${error.message}`);
        throw error;
    }

    emitLog(`Finished. Total records extracted: ${rawRecords.length}`);
    return rawRecords;
};