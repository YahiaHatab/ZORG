/**
 * Custom ZORG-Ω Scraper Engine: Conference Harvester (V2)
 * * @param {Object} params - The payload containing inputs (params.customInput = POST payload, params.token = Cookie string).
 * @param {Function} emitLog - Function to log real-time telemetry strings.
 * @param {Object} runState - State object to monitor cancellation (runState.aborted).
 * @returns {Array} An array of raw exhibitor objects.
 */
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = async function scrapeCustomEvent(params, emitLog, runState) {
    emitLog("Initializing Conference Harvester Engine (V2)...");

    const payloadString = params.customInput;
    if (!payloadString) {
        throw new Error("Missing required POST payload in customInput.");
    }

    // We will use the 'token' field in the UI to pass the raw Cookie string
    const cookieString = params.token || "";
    if (!cookieString) {
        emitLog("WARNING: No cookies provided in the Token field. The server might reject the request.");
    }

    emitLog("Extracting EventKey from payload...");
    const urlParams = new URLSearchParams(payloadString);
    const eventKey = urlParams.get('EventKey');

    if (!eventKey) {
        throw new Error("Could not find EventKey in the provided payload string.");
    }

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

        // FIXED: Access the 'boothDivs' property based on the network preview
        const boothsData = boothsResponse.data.boothDivs;
        
        if (!boothsData || !Array.isArray(boothsData)) {
            emitLog(`Debug - Raw Response Keys: ${Object.keys(boothsResponse.data).join(', ')}`);
            throw new Error("Unexpected response format. Expected 'boothDivs' array inside the response.");
        }

        // Filter for booths that have a boothID and seem to be assigned/unavailable
        const assignedBooths = boothsData.filter(b => b.boothID && (b.boothStatus === "Unavailable" || b.boothStatus === "Rented"));
        const totalBooths = assignedBooths.length;

        emitLog(`Successfully parsed response. Found ${totalBooths} rented/unavailable booths to process.`);

        // Step 2: Loop through assigned booths to fetch exhibitor info
        for (let i = 0; i < totalBooths; i++) {
            
            // 🛑 CRITICAL: Check if the user aborted the scrape!
            if (runState && runState.aborted) {
                emitLog("Extraction aborted by user gracefully. Exiting loop.");
                break; 
            }

            // 🟢 Update Progress Bar
            runState?.updateProgress?.(i + 1, totalBooths);

            const booth = assignedBooths[i];
            emitLog(`[${i + 1}/${totalBooths}] Fetching data for Booth #${booth.boothNumber || 'Unknown'} (ID: ${booth.boothID})...`);

            const popupUrl = `https://www.conferenceharvester.com/floorplan/v2/ajaxcalls/ExhibitorInfoPopup.asp?BoothID=${booth.boothID}&EventKey=${eventKey}`;
            
            try {
                const popupResponse = await axios.get(popupUrl, {
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Cookie': cookieString
                    }
                });

                const $ = cheerio.load(popupResponse.data);
                
                // Initialize default standard fields
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

                // Extract Company Name
                const companyName = $('h1.text-left').text().trim();
                if (companyName) record["Company Name"] = companyName;

                // Extract Details from Address Block
                const addressHtml = $('.ExhibitorAddress1').html();
                
                if (addressHtml) {
                    const lines = addressHtml.split(/<br\s*\/?>/i)
                                             .map(line => cheerio.load(line).text().trim())
                                             .filter(line => line.length > 0);

                    lines.forEach(line => {
                        if (/(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/.test(line)) {
                            record["Phone"] = line;
                        } else if (line.includes('@') && line.includes('.')) {
                            const emailMatch = line.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
                            if (emailMatch) record["Email"] = emailMatch[0];
                        } else if (line.toLowerCase().includes('http') || line.toLowerCase().includes('www.')) {
                            record["Website"] = line;
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

                rawRecords.push(record);

            } catch (err) {
                emitLog(`Error fetching Booth ${booth.boothID}: ${err.message}. Skipping...`);
            }
            
            // Respect rate limits
            await new Promise(r => setTimeout(r, 600)); 
        }

    } catch (error) {
        emitLog(`FATAL ERROR during scraping: ${error.message}`);
        throw error; 
    }

    emitLog("Conference Harvester Engine finished. Passing data to Standardizer.");
    return rawRecords;
};