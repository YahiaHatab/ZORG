/**
 * ZORG-Ω Custom Engine: Expo-Genie (Embedded JSON) - V4 (Floor Plan Booth)
 * Booth numbers are stored in mxFloorPlanXml, NOT in mxgetAllusersData.
 * Strategy: Parse the floor plan XML to build a boothOwner→boothLabel map,
 * then join it against the user records during mapping.
 */
const axios = require('axios');

module.exports = async function scrapeExpoGenie(params, emitLog, runState) {
    emitLog("Initializing Expo-Genie Extraction Engine (V4-FloorPlan)...");
    const targetUrl = params.customInputs?.[0] || params.customInput;
    if (!targetUrl) throw new Error("No Target URL provided.");
    const rawRecords = [];

    // --- FLOOR PLAN BOOTH LOOKUP BUILDER ---
    // Parses mxFloorPlanXml and returns a Map of { boothOwnerUserId → boothLabel }
    // Each <MyNode> has boothOwner="203" mylabel="735" — we invert this into a lookup.
    function buildBoothMap(html) {
        const boothMap = new Map();

        // Extract the raw mxFloorPlanXml string from the page
        const xmlRegex = /mxFloorPlanXml\s*=\s*'([\s\S]*?)';/;
        const xmlMatch = html.match(xmlRegex);
        if (!xmlMatch || !xmlMatch[1]) {
            emitLog("WARNING: mxFloorPlanXml not found. Booth column will be empty.");
            return boothMap;
        }

        const xmlString = xmlMatch[1];

        // Extract every <MyNode ...> attribute block using a regex.
        // We pull mylabel and boothOwner from each node.
        // boothOwner can be a numeric user ID or "none" (unoccupied booth).
        const nodeRegex = /<MyNode\s([^>]*?)>/g;
        let nodeMatch;

        while ((nodeMatch = nodeRegex.exec(xmlString)) !== null) {
            const attrs = nodeMatch[1];

            // Extract mylabel — this is the booth number displayed on the floor plan
            const labelMatch = attrs.match(/mylabel="([^"]*)"/);
            // Extract boothOwner — this is the user ID from mxgetAllusersData
            const ownerMatch = attrs.match(/boothOwner="([^"]*)"/);

            if (!labelMatch || !ownerMatch) continue;

            const boothLabel = labelMatch[1].trim();
            const boothOwner = ownerMatch[1].trim();

            // Skip unoccupied booths ("none") and non-booth labels (e.g. "BAR", "NJAA Booth")
            if (!boothOwner || boothOwner === 'none') continue;
            if (!boothLabel || isNaN(boothLabel) && !/^\d+[A-Za-z]?$/.test(boothLabel)) {
                // Allow numeric labels like "735", "4A", "4B" — skip pure text like "BAR"
                if (!/^\d/.test(boothLabel)) continue;
            }

            // A user can theoretically own multiple booths — store as comma-separated if so
            if (boothMap.has(boothOwner)) {
                boothMap.set(boothOwner, boothMap.get(boothOwner) + ', ' + boothLabel);
            } else {
                boothMap.set(boothOwner, boothLabel);
            }
        }

        emitLog(`Floor plan parsed: ${boothMap.size} occupied booth assignments found.`);
        return boothMap;
    }

    try {
        emitLog(`Fetching source HTML...`);
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = response.data;

        // 1. Build the booth lookup map from the floor plan BEFORE processing user records
        emitLog("Parsing floor plan XML for booth assignments...");
        const boothMap = buildBoothMap(html);

        // 2. Locate mxgetAllusersData
        emitLog("Searching for embedded user dataset...");
        const regex = /mxgetAllusersData\s*=\s*'(.*?)';/s;
        const match = html.match(regex);
        if (!match || !match[1]) {
            throw new Error("Could not find 'mxgetAllusersData' variable.");
        }
        let rawString = match[1];

        // 3. Parse user JSON (three-pass strategy preserved from V2)
        emitLog("Cleaning data for JSON parsing...");
        let jsonData;
        try {
            jsonData = JSON.parse(rawString);
        } catch (e) {
            try {
                let cleaned = rawString
                    .replace(/\\'/g, "'")
                    .replace(/\\\\/g, "\\")
                    .replace(/\\"/g, '"');
                jsonData = JSON.parse(cleaned);
            } catch (e2) {
                emitLog("Standard cleaning failed. Using manual field recovery...");
                const objectRegex = /"(\d+)":(\{.*?\})(?=,"|$)/g;
                let recoveredMatch;
                jsonData = {};
                while ((recoveredMatch = objectRegex.exec(rawString)) !== null) {
                    try {
                        jsonData[recoveredMatch[1]] = JSON.parse(recoveredMatch[2]);
                    } catch (innerError) {
                        // Skip broken individual records
                    }
                }
            }
        }

        const userIds = Object.keys(jsonData);
        if (userIds.length === 0) throw new Error("Parsed successfully but no records were found.");
        emitLog(`Extracted ${userIds.length} user records. Mapping with booth data...`);

        // 4. Map user records, joining booth number from the floor plan lookup
        let boothFoundCount = 0;
        for (const id of userIds) {
            if (runState && runState.aborted) {
                emitLog("Extraction aborted by user. Halting gracefully.");
                break;
            }
            const entry = jsonData[id];
            if (!entry || !entry.companyname) continue;

            // The key in boothMap is the boothOwner value from the XML,
            // which corresponds to the numeric user ID (the key in mxgetAllusersData).
            const booth = boothMap.get(id) || boothMap.get(String(entry.user_id)) || "";
            if (booth) boothFoundCount++;

            rawRecords.push({
                "Company Name": entry.companyname,
                "Phone": entry.COP || entry.user_phone_1 || "",
                "Country": entry.usercountry || "USA",
                "Contact Name": entry.CON || `${entry.first_name || ''} ${entry.last_name || ''}`.trim() || "N/A",
                "Email": entry.COE || "",
                "Address": entry.address_line_1 || "",
                "City": entry.usercity || "",
                "State": entry.userstate || "",
                "Zip": entry.userzipcode || "",
                "Website": entry.COW || "",
                "Description": entry.COD ? entry.COD.replace(/\\n/g, ' ') : "",
                "Booth": booth
            });
        }

        emitLog(`Booth numbers matched for ${boothFoundCount} of ${rawRecords.length} records.`);

    } catch (error) {
        emitLog(`FATAL ERROR: ${error.message}`);
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};