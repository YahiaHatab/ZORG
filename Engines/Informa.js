const axios = require('axios');

async function scrapeInforma(curlInput, emitLog, runState) {
    emitLog("Initializing Informa Engine...");
    const urlMatch = curlInput.match(/'(https:\/\/exhibitors\.informamarkets-info\.com\/api[^']+)'/);
    const cookieMatch = curlInput.match(/-H\s+'cookie:\s*([^']+)'/i) || curlInput.match(/cookie:\s*([^']+)/i);
    const refererMatch = curlInput.match(/-H\s+'referer:\s*([^']+)'/i) || curlInput.match(/referer:\s*([^']+)/i);

    if (!urlMatch) throw new Error("Invalid cURL. Make sure you copied the API request 'as cURL (bash)'.");

    const fullApiUrl = urlMatch[1];
    const headers = {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        'cookie': cookieMatch ? cookieMatch[1] : '',
        'referer': refererMatch ? refererMatch[1] : 'https://exhibitors.informamarkets-info.com/'
    };

    emitLog("Connecting to Informa API...");
    if (runState && runState.aborted) return [];
    const response = await axios.get(fullApiUrl, { headers });
    const exhibitors = response.data.data || [];

    emitLog(`Found ${exhibitors.length} total records.`);

    return exhibitors.map(item => ({
        'Company Name': item.ExhibitorNameEn || item.ExhibitorNameChs || 'N/A',
        'Booth': item.StandNoStr ? item.StandNoStr.replace(/~/g, ' ').trim() : (item.StandNo || 'N/A'),
        'Country': item.CountryEn || 'N/A',
        'Website': item.LinkEn || item.LinkChs || 'N/A',
        'Contact Person': item.ContactPerson || 'N/A',
        'Phone': item.ContactPhone || 'N/A',
        'Address': item.Field01 ? item.Field01.replace(/\r\n/g, ' ').trim() : 'N/A',
        'Description': item.DescEn ? item.DescEn.replace(/<\/?[^>]+(>|$)/g, "") : 'N/A'
    }));
}

module.exports = scrapeInforma;