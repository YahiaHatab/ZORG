/**
 * ZORG-Ω Custom Engine: Eurosatory (finderr.cloud) - V3
 * Fixed: correct booth fields (Stands[].Name + Stands[].Hall).
 * No user inputs required -- fully hardcoded for Eurosatory.
 */
const axios = require('axios');

module.exports = async function scrapeEurosatory(params, emitLog, runState) {
    emitLog("Initializing Eurosatory Extraction Engine (V3)...");

    const API_URL   = "https://eurosatory.finderr.cloud/api/catalog/search_exhibitors";
    const API_KEY   = "9532b2dbcb94ddfb48bf4f6b240b856575f6ad5a3f0a70a618608e4cbe23c15e";
    const PAGE_SIZE = 50;
    const TIMEOUT   = 90000;

    const axiosInstance = axios.create({
        timeout: TIMEOUT,
        headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
            'authorization': 'Bearer null',
            'cache-control': 'no-cache',
            'content-type': 'application/json',
            'origin': 'https://eurosatory.finderr.cloud',
            'pragma': 'no-cache',
            'referer': 'https://eurosatory.finderr.cloud/welcome-exhibitor?lang=en',
            'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
            'x-api-key': API_KEY
        }
    });

    const rawRecords = [];
    let pageIndex = 0;
    let totalKnown = null;

    try {
        while (true) {
            if (runState && runState.aborted) {
                emitLog("Extraction aborted by user. Halting gracefully.");
                break;
            }

            emitLog(`Fetching page ${pageIndex + 1}${totalKnown ? ' of ~' + Math.ceil(totalKnown / PAGE_SIZE) : ''} (${rawRecords.length} records so far)...`);

            const payload = {
                CurrentLanguage: "en",
                NbElementsPerPage: PAGE_SIZE,
                PageIndex: pageIndex,
                GetAll: false
            };

            const response = await axiosInstance.post(API_URL, payload);
            const data = response.data;

            const exhibitors = data.ListDetailsExhibitors
                || data.Exhibitors
                || data.exhibitors
                || data.results
                || data.Results
                || (Array.isArray(data) ? data : null);

            if (!exhibitors) {
                emitLog("WARNING: Could not find exhibitor array in response. Dumping preview:");
                emitLog(JSON.stringify(data).substring(0, 600));
                break;
            }

            if (totalKnown === null) {
                totalKnown = data.total || data.Total || data.TotalCount || data.totalCount || null;
                if (totalKnown) emitLog(`Total exhibitors reported by API: ${totalKnown}`);
            }

            emitLog(`Page ${pageIndex + 1}: ${exhibitors.length} records received.`);

            if (exhibitors.length === 0) {
                emitLog("Empty page -- all records collected.");
                break;
            }

            for (const ex of exhibitors) {
                if (runState && runState.aborted) break;

                // Booth: Stands: [{ Hall: "Hall 4", Name: "G325" }]
                let booth = "";
                if (ex.Stands && ex.Stands.length > 0) {
                    booth = ex.Stands
                        .map(s => {
                            const name = s.Name || "";
                            const hall = s.Hall || "";
                            return hall ? `${hall} - ${name}` : name;
                        })
                        .filter(Boolean)
                        .join(', ');
                }

                rawRecords.push({
                    "Company Name": ex.Exhi_CompanyName       || "",
                    "Phone":        ex.Exhi_Phone             || "",
                    "Country":      ex.Exhi_Country_CodeISO2  || "",
                    "Contact Name": "",
                    "Email":        "",
                    "Address":      ex.Exhi_Address           || "",
                    "City":         ex.Exhi_City              || "",
                    "State":        "",
                    "Zip":          ex.Exhi_ZipCode           || "",
                    "Booth":        booth,
                    "Website":      ex.Exhi_Website           || "",
                    "Description":  ex.ShortPresentation      || ex.OneLiner || ""
                });
            }

            emitLog(`Running total: ${rawRecords.length} records.`);

            if (totalKnown && rawRecords.length >= totalKnown) {
                emitLog("Reached reported total. Done.");
                break;
            }
            if (exhibitors.length < PAGE_SIZE) {
                emitLog("Short page received -- end of results.");
                break;
            }
            if (pageIndex >= 200) {
                emitLog("WARNING: Reached page 200 safety cap. Stopping.");
                break;
            }

            pageIndex++;
            await new Promise(r => setTimeout(r, 500));
        }

    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            emitLog("ERROR: Request timed out after 90s. Try again.");
        } else if (error.response?.status === 401 || error.response?.status === 403) {
            emitLog(`ERROR ${error.response.status}: API key rejected or expired.`);
        } else {
            emitLog(`FATAL ERROR: ${error.message}`);
        }
        throw error;
    }

    emitLog(`Success. Passing ${rawRecords.length} records to Standardizer.`);
    return rawRecords;
};
