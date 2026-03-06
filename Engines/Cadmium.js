const axios = require('axios');
const pLimit = require('p-limit');
const limit = (typeof pLimit === 'function') ? pLimit(25) : pLimit.default(25);

async function scrapeCadmium(eventId, clientId, eventKey, emitLog) {
    emitLog(`Initializing Cadmium Harvester for Event: ${eventId}...`);
    const postData = `EventID=${eventId}&EventClientID=${clientId}&EventKey=${eventKey}&ShowLogos=Yes&LogoLocation=1&RentedBoothPopupLink=ajaxcalls/ExhibitorInfoPopup.asp?&ShowCompanyWithNegativeBalance=1&BlockLogosBeforeLogoTaskCompletion=false`;

    emitLog("Generating Rented Booth List...");
    const response = await axios.post("https://www.conferenceharvester.com/floorplan/v2/ajaxcalls/CreateRentedBoothList.asp", postData, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const boothList = response.data.boothList || [];
    const total = boothList.length;

    emitLog(`Success: Discovered ${total} Booth Nodes. Initiating HTML extraction...`);

    let processed = 0;
    const tasks = boothList.map((ex) => limit(async () => {
        try {
            const detailRes = await axios.get(`https://www.conferenceharvester.com/floorplan/v2/${ex.boothURL}`);
            const html = detailRes.data;

            processed++;
            if (processed % 25 === 0 || processed === total) emitLog(`Extracted ${processed}/${total} profiles...`);

            return {
                "Company Name": (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || ex.exhibitorName).replace(/<[^>]*>/g, '').trim(),
                "Booth": ex.boothNumber || "N/A",
                "Website": (html.match(/<a[^>]*href="(http[^"]*)"[^>]*exhibitorInfoBtn/)?.[1] || "N/A"),
                "Email": (html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] || "N/A")
            };
        } catch (e) { return null; }
    }));
    return (await Promise.all(tasks)).filter(Boolean);
}

module.exports = scrapeCadmium;