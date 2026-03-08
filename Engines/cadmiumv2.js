/**
 * Custom ZORG-Ω Scraper Engine: Conference Harvester (V5 - High Speed Concurrency)
 * * @param {Object} params - The payload containing inputs (customInput = POST payload, token = Cookie).
 * @param {Function} emitLog - Function to log real-time telemetry strings.
 * @param {Object} runState - State object to monitor cancellation (runState.aborted).
 * @returns {Array} An array of raw exhibitor objects.
 */
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async function scrapeCustomEvent(params, emitLog, runState) {
    emitLog("Initializing Conference Harvester Engine (V5 - High Speed Concurrency)...");

    const payloadString = params.customInput;
    if (!payloadString) throw new Error("Missing required POST payload in customInput.");

    const cookieString = params.token || "";
    if (!cookieString) emitLog("WARNING: No cookies provided. The server might reject the request.");

    emitLog("Extracting EventKey from payload...");
    const urlParams = new URLSearchParams(payloadString);
    const eventKey = urlParams.get('EventKey');

    if (!eventKey) throw new Error("Could not find EventKey in the provided payload string.");

    emitLog(`Starting extraction for EventKey: ${eventKey}...`);

    const rawRecords = [];

    try {
        // Step 1: Fetch all booths
        emitLog("Fetching booth layout and IDs...");
        const boothsUrl = "https://www.conferenceharvester.com/floorplan/v2/ajaxcalls/CreateBoothDivs.asp";
        
        const boothsResponse = await axios.post(boothsUrl, payloadString, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Cookie': cookieString,
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        const boothsData = boothsResponse.data.boothDivs;
        if (!boothsData || !Array.isArray(boothsData)) {
            throw new Error("Unexpected response format. Expected 'boothDivs' array inside the response.");
        }

        const assignedBooths = boothsData.filter(b => b.boothID && (b.boothStatus === "Unavailable" || b.boothStatus === "Rented"));
        const totalBooths = assignedBooths.length;

        emitLog(`Successfully parsed response. Found ${totalBooths} rented/unavailable booths to process.`);

        // Step 2: Concurrent Batch Processing
        const CONCURRENCY_LIMIT = 5; // Process 5 booths at the same time
        
        for (let i = 0; i < totalBooths; i += CONCURRENCY_LIMIT) {
            
            // 🛑 CRITICAL: Check if the user aborted the scrape!
            if (runState && runState.aborted) {
                emitLog("Extraction aborted by user gracefully. Exiting loop.");
                break; 
            }

            const chunk = assignedBooths.slice(i, i + CONCURRENCY_LIMIT);
            const currentMax = Math.min(i + CONCURRENCY_LIMIT, totalBooths);
            
            emitLog(`Fetching batch of booths ${i + 1} to ${currentMax} of ${totalBooths}...`);

            // Create an array of promises for this chunk
            const chunkPromises = chunk.map(async (booth) => {
                const popupUrl = `https://www.conferenceharvester.com/floorplan/v2/ajaxcalls/ExhibitorInfoPopup.asp?BoothID=${booth.boothID}&EventKey=${eventKey}`;
                
                try {
                    const popupResponse = await axios.get(popupUrl, {
                        headers: { 
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                            'Cookie': cookieString
                        }
                    });

                    const $ = cheerio.load(popupResponse.data);
                    
                    let record = {
                        "Company Name": "N/A",
                        "Phone": "N/A",
                        "Country": "N/A",
                        "Contact Name": "N/A",
                        "Email": "N/A",
                        "Address": "N/A",
                        "City": "N/A",
                        "Booth": booth.boothNumber || "N/A",
                        "Website": "N/A"
                    };

                    const companyName = $('h1').first().text().trim();
                    if (companyName) record["Company Name"] = companyName;

                    const addressHtml = $('.ExhibitorAddress1').html();
                    
                    if (addressHtml) {
                        const lines = addressHtml.split(/<br\s*\/?>/i)
                                                 .map(line => cheerio.load(line).text().trim())
                                                 .filter(line => line.length > 0);

                        lines.forEach(line => {
                            const phoneRegex = /(?:(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\b\+?\d{8,15}\b)(?:\s*(?:ext|x|ex)\.?\s*\d+)?/i;
                            
                            if (line.includes('@') && line.includes('.')) {
                                const emailMatch = line.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
                                if (emailMatch) record["Email"] = emailMatch[0];
                            } else if (line.toLowerCase().includes('http') || line.toLowerCase().includes('www.')) {
                                record["Website"] = line;
                            } else if (phoneRegex.test(line)) {
                                record["Phone"] = line;
                            } else if (/[A-Z]{2}\s+\d{5}/.test(line) || line.includes(',')) {
                                if (record["City"] === "N/A" && line !== record["Company Name"]) {
                                    record["City"] = line;
                                }
                            } else {
                                if (record["Address"] === "N/A" && line !== record["Company Name"]) {
                                    record["Address"] = line;
                                }
                            }
                        });
                    }
                    return record; // Return valid record
                } catch (err) {
                    emitLog(`Error fetching Booth ${booth.boothID}: ${err.message}. Skipping...`);
                    return null; // Return null if this specific request failed
                }
            });

            // Wait for all 5 requests in this batch to finish simultaneously
            const results = await Promise.all(chunkPromises);
            
            // Add valid results to our main array
            results.forEach(record => {
                if (record) rawRecords.push(record);
            });

            // 🟢 Update Progress Bar
            runState?.updateProgress?.(currentMax, totalBooths);
            
            // Wait 1 second between batches to mimic human behavior and avoid bans
            await new Promise(r => setTimeout(r, 1000)); 
        }

    } catch (error) {
        emitLog(`FATAL ERROR during scraping: ${error.message}`);
        throw error; 
    }

    emitLog("Conference Harvester Engine V5 finished. Passing data to Standardizer.");
    return rawRecords;
};