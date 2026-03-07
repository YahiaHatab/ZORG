const express = require('express');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// --- IMPORT STANDALONE ENGINES ---
const scrapeMapDynamics = require('./Engines/MapDynamics');
const scrapeDusseldorf = require('./Engines/Dusseldorf');
const scrapeEshow = require('./Engines/Eshow');
const scrapeCadmium = require('./Engines/Cadmium');
const scrapeInforma = require('./Engines/Informa');
const scrapeNuernberg = require('./Engines/Algolia');

const app = express();
const PORT = 3000;

app.use(express.json());

// --- DYNAMIC ENGINES ---
const enginesFile = path.join(__dirname, 'engines.json');
let customEngines = [];
function loadEngines() {
    try {
        if (!fs.existsSync(enginesFile)) {
            fs.writeFileSync(enginesFile, JSON.stringify([]));
        }
        customEngines = JSON.parse(fs.readFileSync(enginesFile, 'utf8'));
    } catch (err) {
        console.error("Failed to load custom engines:", err);
    }
}
loadEngines();

// --- TELEMETRY ENGINE ---
let globalLogs = [];
function emitLog(msg) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logLine = `[${time}] > ${msg}`;
    globalLogs.push(logLine);
    console.log(logLine);
}

app.get('/logs', (req, res) => {
    res.json({ logs: globalLogs });
});

// --- ASSETS & FAVICON SUPPORT ---
app.use('/Icons', express.static(path.join(__dirname, 'Icons')));

app.get('/favicon.ico', (req, res) => {
    const iconPath = path.join(__dirname, 'Icons', 'favicon.ico');
    if (fs.existsSync(iconPath)) res.sendFile(iconPath);
    else res.status(404).end();
});

// --- EXECUTION ROUTE & STANDARDIZER ---
app.post('/run', async (req, res) => {
    const { mode, domain, fileName, curlCommand, token, cadEventId, cadClientId, cadEventKey, dynamicShowId, cookie, customInput } = req.body;
    let rawRecords = [];

    globalLogs = []; // Reset telemetry for new run
    emitLog(`--- RUN PROTOCOL STARTED: ${mode.toUpperCase()} ---`);

    try {
        if (mode === 'marketplace') rawRecords = await scrapeMapDynamics(dynamicShowId, cookie, emitLog);
        else if (mode === 'dusseldorf') rawRecords = await scrapeDusseldorf(domain, emitLog);
        else if (mode === 'eshow') rawRecords = await scrapeEshow(token, emitLog);
        else if (mode === 'cadmium') rawRecords = await scrapeCadmium(cadEventId, cadClientId, cadEventKey, emitLog);
        else if (mode === 'informa') rawRecords = await scrapeInforma(curlCommand, emitLog);
        else if (mode === 'algolia') {
            const appId = curlCommand.match(/x-algolia-application-id[=:]\s*([a-zA-Z0-9]+)/i)?.[1];
            const apiKey = curlCommand.match(/x-algolia-api-key[=:]\s*([a-zA-Z0-9]+)/i)?.[1];
            const indexName = curlCommand.match(/"indexName"\s*:\s*"([^"]+)"/)?.[1];
            const filters = curlCommand.match(/"filters"\s*:\s*"([^"]+)"/)?.[1];
            if (!appId || !apiKey) throw new Error("Could not parse Algolia App ID or API Key from cURL.");
            rawRecords = await scrapeNuernberg({ appId, apiKey, indexName, filters }, emitLog);
        } else {
            const customEntry = customEngines.find(e => e.id === mode);
            if (customEntry) {
                const scriptPath = path.join(__dirname, 'Engines', `${customEntry.id}.js`);
                if (fs.existsSync(scriptPath)) {
                    delete require.cache[require.resolve(scriptPath)];
                    const customScrape = require(scriptPath);
                    rawRecords = await customScrape(req.body, emitLog);
                } else {
                    throw new Error(`Engine file for ${customEntry.name} not found.`);
                }
            } else {
                throw new Error("Unknown mode selected.");
            }
        }

        if (!rawRecords || !rawRecords.length) {
            emitLog("CRITICAL: Scraper returned 0 valid records.");
            return res.status(404).json({ error: "No data found or request expired." });
        }

        emitLog(`Structuring, standardizing, and deduplicating ${rawRecords.length} items...`);

        const clean = (val) => (val === 'N/A' || !val) ? '' : String(val).trim();
        const mergedRecordsMap = new Map();

        rawRecords.forEach(item => {
            const rawName = item["Company Name"];
            const cleanName = clean(rawName);
            if (!cleanName) return;

            const uniqueKey = cleanName.toLowerCase();

            if (mergedRecordsMap.has(uniqueKey)) {
                const existingEntry = mergedRecordsMap.get(uniqueKey);
                const newBooth = clean(item["Booth"]);

                if (newBooth && !existingEntry["Booth"].includes(newBooth)) {
                    existingEntry["Booth"] = existingEntry["Booth"]
                        ? `${existingEntry["Booth"]}, ${newBooth}`
                        : newBooth;
                }
            } else {
                mergedRecordsMap.set(uniqueKey, {
                    "Exhibitor Name": cleanName,
                    "Phone Number": clean(item["Phone"]),
                    "Country": clean(item["Country"]),
                    "Contact Name": clean(item["Contact Name"] || item["Contact Person"]),
                    "Email": clean(item["Email"]),
                    "Mails": clean(item["Address"] || item["City"]),
                    "Booth": clean(item["Booth"]),
                    "Website": clean(item["Website"])
                });
            }
        });

        const standardizedRecords = Array.from(mergedRecordsMap.values());
        emitLog(`Deduplication complete. Final distinct record count: ${standardizedRecords.length}.`);

        const ws = XLSX.utils.json_to_sheet(standardizedRecords);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Exhibitors");

        emitLog("Building binary buffer stream...");
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        let defaultFileName = domain || token || dynamicShowId || cadEventId || customInput || mode;
        if (defaultFileName) {
            defaultFileName = String(defaultFileName).replace(/[^a-zA-Z0-9_\-\.]/g, '_').substring(0, 40);
        } else {
            defaultFileName = 'ZORG_Data';
        }

        emitLog("Transmission ready. Awaiting frontend receipt.");
        res.setHeader('Content-Disposition', `attachment; filename="${fileName || defaultFileName}.xlsx"`);
        res.send(buf);
    } catch (err) {
        emitLog(`SYSTEM ERROR: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// --- ENGINE UPLOAD ROUTE ---
app.post('/upload-engine', (req, res) => {
    try {
        const { id, name, instruction, inputType, category, code } = req.body;
        if (!id || !name || !code) {
            throw new Error("Missing required fields. ID, Name, and Code are mandatory.");
        }

        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
        const enginesDir = path.join(__dirname, 'Engines');
        if (!fs.existsSync(enginesDir)) fs.mkdirSync(enginesDir);

        const scriptPath = path.join(enginesDir, `${safeId}.js`);
        fs.writeFileSync(scriptPath, code);

        const existingIndex = customEngines.findIndex(e => e.id === safeId);
        const engineData = {
            id: safeId,
            name,
            instruction: instruction || '',
            inputType: inputType !== undefined ? inputType : '',
            category: category || 'Custom'
        };

        if (existingIndex >= 0) {
            customEngines[existingIndex] = engineData;
            emitLog(`Custom engine '${name}' (${safeId}) has been successfully UPDATED.`);
            res.json({ success: true, message: `Engine ${name} updated successfully.` });
        } else {
            customEngines.push(engineData);
            emitLog(`Custom engine '${name}' (${safeId}) has been successfully INSTALLED.`);
            res.json({ success: true, message: `Engine ${name} installed successfully.` });
        }

        fs.writeFileSync(enginesFile, JSON.stringify(customEngines, null, 2));
    } catch (err) {
        emitLog(`SYSTEM ERROR (Upload): ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// --- ENGINE FETCH ROUTE FOR EDITING ---
app.get('/engine/:id', (req, res) => {
    try {
        const id = req.params.id;
        const entry = customEngines.find(e => e.id === id);
        if (!entry) return res.status(404).json({ error: 'Engine metadata not found.' });

        const scriptPath = path.join(__dirname, 'Engines', `${id}.js`);
        if (!fs.existsSync(scriptPath)) return res.status(404).json({ error: 'Script file not found.' });

        const codeString = fs.readFileSync(scriptPath, 'utf8');
        res.json({ ...entry, code: codeString });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ENGINE DELETE ROUTE ---
app.delete('/delete-engine/:id', (req, res) => {
    try {
        const id = req.params.id;
        const index = customEngines.findIndex(e => e.id === id);

        if (index === -1) {
            return res.status(404).json({ error: 'Engine not found.' });
        }

        const engineName = customEngines[index].name;

        const scriptPath = path.join(__dirname, 'Engines', `${id}.js`);
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath);
        }

        customEngines.splice(index, 1);
        fs.writeFileSync(enginesFile, JSON.stringify(customEngines, null, 2));

        emitLog(`Custom engine '${engineName}' (${id}) has been DELETED.`);
        res.json({ success: true, message: `Engine ${engineName} deleted successfully.` });
    } catch (err) {
        emitLog(`SYSTEM ERROR (Delete): ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.post('/shutdown', (req, res) => {
    res.send({ status: 'off' });
    setTimeout(() => process.exit(0), 1000);
});

// --- FRONTEND UI ---
app.get('/', (req, res) => {
    // Group all engines
    const defaultEngines = [
        { id: 'marketplace', name: 'Map-Dynamics (Marketplace)' },
        { id: 'dusseldorf', name: 'Messe Düsseldorf' },
        { id: 'algolia', name: 'NürnbergMesse (Algolia)' },
        { id: 'informa', name: 'Informa Markets (cURL)' },
        { id: 'eshow', name: 'eShow (Concurrent)' },
        { id: 'cadmium', name: 'Cadmium (Harvester)' }
    ];

    const allCategories = {
        'General': defaultEngines
    };

    customEngines.forEach(e => {
        const cat = e.category || 'Custom';
        if (!allCategories[cat]) allCategories[cat] = [];
        allCategories[cat].push({ id: e.id, name: e.name, isCustom: true });
    });

    let customDropdownHtml = '';
    for (const [cat, engines] of Object.entries(allCategories)) {
        const isGeneral = cat === 'General';
        customDropdownHtml += `
            <div class="border-b border-slate-700/50 last:border-b-0">
                <div onclick="toggleCategory('${cat}')" class="bg-slate-800 hover:bg-slate-700/50 p-3 flex justify-between items-center cursor-pointer transition-colors group">
                    <span class="text-slate-400 font-bold text-[10px] uppercase tracking-widest group-hover:text-slate-300">${cat}</span>
                    <svg id="icon-${cat}" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500 transition-transform duration-200 ${isGeneral ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
                <div id="cat-${cat}" class="${isGeneral ? '' : 'hidden'} bg-slate-900/50">
                    ${engines.map(e => `
                        <div class="group p-3 pl-5 hover:bg-slate-800 cursor-pointer text-blue-400 font-bold text-sm border-t border-slate-800 transition-colors flex items-center justify-between" onclick="selectEngine('${e.id}', '${e.name.replace(/'/g, "\\'")}')">
                            <div class="flex flex-row items-center gap-2">
                                <span class="w-1.5 h-1.5 rounded-full ${e.isCustom ? 'bg-purple-500' : 'bg-blue-500'}"></span>
                                ${e.name}
                            </div>
                            ${e.isCustom ? `
                            <div class="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                <button onclick="editEngine(event, '${e.id}')" class="text-slate-500 hover:text-blue-400 transition-colors flex items-center justify-center p-1" title="Edit Engine">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                                <button onclick="deleteEngine(event, '${e.id}')" class="text-slate-500 hover:text-red-400 transition-colors flex items-center justify-center p-1" title="Delete Engine">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    let customInstStr = customEngines.map(e => `inst["${e.id}"] = "${e.instruction.replace(/"/g, '\\"')}";`).join('\n');
    let customToggleStr = customEngines.map(e => {
        let input = (e.inputType || '').trim();
        if (input === '' || input.toLowerCase() === 'none') {
            return `if(m === '${e.id}') { document.getElementById('customInputBox').classList.add('hidden'); }`;
        } else {
            return `if(m === '${e.id}') { document.getElementById('customInputBox').classList.remove('hidden'); document.getElementById('customInput').placeholder = "${input.replace(/"/g, '\\"')}"; }`;
        }
    }).join('\n');

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>ZORG-Ω | Architect</title>
            <link rel="icon" type="image/x-icon" href="/Icons/favicon.ico">
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                @keyframes bounce { 0%, 80%, 100% { transform: scale(0); opacity: 0.3; } 40% { transform: scale(1.0); opacity: 1; } }
                .dot { display: inline-block; width: 10px; height: 10px; background-color: #10b981; border-radius: 100%; animation: bounce 1.4s infinite ease-in-out both; }
                .dot1 { animation-delay: -0.32s; } .dot2 { animation-delay: -0.16s; }
                #telemetry::-webkit-scrollbar { width: 6px; }
                #telemetry::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
                /* Custom scrollbar for dropdown */
                .dropdown-scroll::-webkit-scrollbar { width: 4px; }
                .dropdown-scroll::-webkit-scrollbar-thumb { background: #475569; border-radius: 10px; }
            </style>
        </head>
        <body class="bg-slate-950 bg-[url('/Icons/Background.png')] bg-cover bg-center bg-fixed bg-no-repeat text-white min-h-screen flex items-center justify-center p-6 relative font-sans before:fixed before:inset-0 before:bg-slate-950/60 before:-z-10">
            <!-- UPLOAD / EDIT MODAL -->
            <div id="uploadModal" class="fixed inset-0 bg-black/80 hidden items-center justify-center z-50 p-4">
                <div class="bg-slate-900/90 backdrop-blur-2xl p-6 rounded-2xl border border-blue-900/80 shadow-[0_0_50px_rgba(0,0,0,0.7)] w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
                    <button onclick="closeUploadModal()" class="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    <h2 id="modalTitle" class="text-2xl font-black text-blue-400 mb-4 italic tracking-tighter uppercase">Register New Engine</h2>
                    <div class="space-y-4">
                        <div class="flex gap-4">
                            <div class="flex-1">
                                <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Engine ID (<span class="text-emerald-400">Re-use ID to Update</span>)</label>
                                <input id="upId" type="text" placeholder="e.g. custom_bot" class="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 outline-none text-sm font-mono">
                            </div>
                            <div class="flex-1">
                                <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Display Name</label>
                                <input id="upName" type="text" placeholder="e.g. TradeShow Bot" class="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 outline-none text-sm">
                            </div>
                        </div>
                        <div class="flex gap-4">
                            <div class="flex-1">
                                <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Category</label>
                                <select id="upCategory" class="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 outline-none text-sm appearance-none cursor-pointer text-white">
                                    <option value="Custom">Custom</option>
                                    <option value="General">General</option>
                                </select>
                            </div>
                            <div class="flex-1">
                                <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Input Field Name</label>
                                <input id="upInputType" type="text" placeholder="e.g. Target URL (Leave blank if none)" class="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 outline-none text-sm">
                            </div>
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Instructions String</label>
                            <input id="upInst" type="text" placeholder="Instructions displayed when engine is selected..." class="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 outline-none text-sm">
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 flex justify-between">
                                <span>Engine Code (Node.js)</span>
                                <span class="text-blue-500 font-normal normal-case italic">Follow EngineTemplate.md</span>
                            </label>
                            <textarea id="upCode" placeholder="module.exports = async function(params, emitLog) { ... };" class="w-full p-4 h-64 rounded-xl bg-slate-950 border border-slate-700 outline-none text-[11px] font-mono whitespace-pre text-green-400"></textarea>
                        </div>
                        <button onclick="submitUpload()" class="w-full bg-blue-600 p-4 rounded-xl font-black text-lg hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/20 active:scale-95 tracking-tight uppercase">Inject / Update Engine into Core</button>
                    </div>
                </div>
            </div>

            <div class="absolute bottom-4 right-6 text-slate-400/50 text-sm font-bold uppercase tracking-widest italic z-0 drop-shadow-lg">Powered by YahiaH</div>
            <div class="bg-slate-900/85 backdrop-blur-xl p-8 rounded-2xl border border-slate-800/80 w-full max-w-xl shadow-[0_0_50px_rgba(0,0,0,0.5)] z-10">
                <div class="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
                    <div>
                        <h1 class="text-4xl font-black text-blue-500 tracking-tighter italic">ZORG-Ω</h1>
                        <p class="text-[10px] text-slate-500 font-mono uppercase">Architect v6.0 Modular | Standardizer Active</p>
                    </div>
                    <div id="counterArea" class="text-right hidden">
                        <div id="loader" class="flex items-center space-x-1 mb-1">
                            <span class="dot dot1"></span><span class="dot dot2"></span><span class="dot"></span>
                        </div>
                        <div id="completeText" class="hidden text-emerald-400 font-black text-xl italic uppercase tracking-tighter shadow-emerald-900/50 drop-shadow-md">Complete</div>
                        <div id="errorText" class="hidden text-red-500 font-black text-xl italic uppercase tracking-tighter shadow-red-900/50 drop-shadow-md">Error</div>
                    </div>
                </div>

                <div id="instructionPanel" class="mb-4 p-4 bg-slate-950/40 rounded-xl border border-blue-900/20">
                    <h3 class="text-[10px] font-bold text-blue-400 uppercase mb-1 tracking-widest">Protocol</h3>
                    <div id="instructionContent" class="text-[11px] text-slate-400 leading-relaxed italic"></div>
                </div>

                <div class="space-y-4">
                    
                    <div class="flex gap-3 items-center relative">
                        <input type="hidden" id="mode" value="marketplace">
                        
                        <!-- CUSTOM DROPDOWN BUTTON -->
                        <div class="flex-1 relative">
                            <button id="dropdownBtn" onclick="toggleDropdownMenu()" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 text-blue-400 font-bold text-left flex justify-between items-center hover:bg-slate-700/50 transition-colors shadow-inner">
                                <span id="dropdownBtnText">Map-Dynamics (Marketplace)</span>
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                            </button>
                            
                            <!-- DROPDOWN MENU PANEL -->
                            <div id="dropdownMenu" class="hidden absolute top-full left-0 w-full mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-40 overflow-hidden max-h-80 overflow-y-auto dropdown-scroll">
                                ${customDropdownHtml}
                            </div>
                        </div>
                        
                        <!-- SLEEK + UPLOAD BUTTON -->
                        <button onclick="openUploadModal()" class="w-12 h-12 bg-slate-800 text-blue-500 rounded-xl hover:bg-slate-700 hover:text-blue-400 transition-all border border-slate-700 hover:border-blue-500/50 flex items-center justify-center shrink-0 shadow-lg shadow-black/40" title="Upload Custom Script">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                        </button>
                    </div>

                    <div id="standardBox" class="hidden"><input id="url" type="text" placeholder="Domain (e.g. www.wire.de)" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none"></div>
                    <div id="curlBox" class="hidden"><textarea id="curl" placeholder="Paste cURL Command here..." class="w-full p-4 h-24 rounded-xl bg-slate-800 border border-slate-700 outline-none text-xs font-mono"></textarea></div>
                    <div id="eshowBox" class="hidden"><input id="token" type="text" placeholder="Bearer Token" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none"></div>
                    <div id="cadBox" class="hidden space-y-3">
                        <input id="cadEventId" type="text" placeholder="Event ID" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none">
                        <input id="cadClientId" type="text" placeholder="Client ID" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700">
                        <input id="cadEventKey" type="text" placeholder="Event Key" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700">
                    </div>
                    <div id="marketBox" class="space-y-3">
                        <input id="dynamicShowId" type="text" placeholder="Show ID" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none">
                        <input id="cookie" type="text" placeholder="PHPSESSID Cookie" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none">
                    </div>
                    <div id="customInputBox" class="hidden"><input id="customInput" type="text" placeholder="Custom Input" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none"></div>

                    <input id="file" type="text" placeholder="Output Filename (Optional) - Defaults to Show URL/ID" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none">
                    
                    <div class="flex gap-3 relative">
                        <button id="btn" onclick="run()" class="w-full bg-blue-600 p-5 rounded-xl font-black text-xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/20 active:scale-95 tracking-tight">EXECUTE ARCHITECT</button>
                        <button id="stopBtn" onclick="stopRun()" class="w-20 bg-slate-800 text-red-500 border border-slate-700 hover:border-red-500/50 hover:bg-slate-700 transition-all rounded-xl focus:outline-none flex items-center justify-center shrink-0 shadow-lg shadow-black/40 pointer-events-none opacity-50" title="Emergency Stop">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
                        </button>
                    </div>
                    
                    <div id="telemetryBox" class="hidden mt-4">
                        <p class="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1 pl-1">Live Telemetry</p>
                        <div id="telemetry" class="bg-black border border-slate-700 rounded-xl p-3 h-40 overflow-y-auto font-mono text-[10px] text-green-400 shadow-inner break-words"></div>
                    </div>
                </div>
                <div class="mt-8 flex justify-center"><button onclick="shutdown()" class="text-slate-600 hover:text-red-500 text-[10px] font-bold transition-colors">TERMINATE SESSION</button></div>
            </div>

            <script>
                // -- DROPDOWN LOGIC --
                function toggleDropdownMenu() {
                    document.getElementById('dropdownMenu').classList.toggle('hidden');
                }
                
                function toggleCategory(cat) {
                    const catDiv = document.getElementById('cat-' + cat);
                    const iconDiv = document.getElementById('icon-' + cat);
                    if (catDiv.classList.contains('hidden')) {
                        catDiv.classList.remove('hidden');
                        iconDiv.classList.add('rotate-180');
                    } else {
                        catDiv.classList.add('hidden');
                        iconDiv.classList.remove('rotate-180');
                    }
                }

                function selectEngine(id, name) {
                    document.getElementById('mode').value = id;
                    document.getElementById('dropdownBtnText').innerText = name;
                    document.getElementById('dropdownMenu').classList.add('hidden');
                    toggle(); 
                }
                
                document.addEventListener('click', function(event) {
                    const dropdownBtn = document.getElementById('dropdownBtn');
                    const dropdownMenu = document.getElementById('dropdownMenu');
                    const uploadModal = document.getElementById('uploadModal');
                    
                    if (!dropdownBtn.contains(event.target) && !dropdownMenu.contains(event.target)) {
                        dropdownMenu.classList.add('hidden');
                    }
                });

                // -- EXISTING LOGIC --
                const inst = {
                    marketplace: "Provide the Show ID and your PHPSESSID cookie. Uses Deep Recovery for contact names.",
                    dusseldorf: "Provide the base domain. Targets /vis-api/ search.",
                    algolia: "Paste the Algolia API cURL command (Copy as cURL bash) from your network tab.",
                    informa: "Paste the Informa API cURL command (Copy as cURL bash) from your network tab.",
                    eshow: "Copy the Bearer Token from floor_space.cfc headers.",
                    cadmium: "Extract Event ID, Client ID, and Event Key from CreateRentedBoothList.asp."
                };
                ${customInstStr}

                function toggle() {
                    const m = document.getElementById('mode').value;
                    document.getElementById('instructionContent').innerText = inst[m] || "No instructions provided.";
                    
                    document.getElementById('marketBox').classList.toggle('hidden', m !== 'marketplace');
                    document.getElementById('standardBox').classList.toggle('hidden', !['dusseldorf'].includes(m));
                    document.getElementById('curlBox').classList.toggle('hidden', !['algolia', 'informa'].includes(m));
                    document.getElementById('eshowBox').classList.toggle('hidden', m !== 'eshow');
                    document.getElementById('cadBox').classList.toggle('hidden', m !== 'cadmium');
                    document.getElementById('customInputBox').classList.add('hidden');

                    if(m === 'algolia') document.getElementById('curl').placeholder = "Paste Algolia API cURL here...";
                    if(m === 'informa') document.getElementById('curl').placeholder = "Paste Informa API cURL here...";

                    ${customToggleStr}
                }

                // --- MODAL / EDIT FUNCTIONS ---
                function openUploadModal() { 
                    document.getElementById('modalTitle').innerText = "Register New Engine";
                    document.getElementById('upId').value = "";
                    document.getElementById('upId').readOnly = false; // allow editing new IDs
                    document.getElementById('upName').value = "";
                    document.getElementById('upCategory').value = "";
                    document.getElementById('upInputType').value = "";
                    document.getElementById('upInst').value = "";
                    document.getElementById('upCode').value = "";
                    
                    document.getElementById('uploadModal').classList.replace('hidden', 'flex'); 
                }
                
                function closeUploadModal() { 
                    document.getElementById('uploadModal').classList.replace('flex', 'hidden'); 
                }
                
                async function editEngine(e, id) {
                    e.stopPropagation(); // Prevent dropdown from closing / selecting
                    try {
                        const res = await fetch('/engine/' + id);
                        if (!res.ok) throw new Error("Could not fetch engine data.");
                        const data = await res.json();
                        
                        document.getElementById('modalTitle').innerText = "Edit Engine: " + id;
                        document.getElementById('upId').value = data.id;
                        document.getElementById('upId').readOnly = true; // prevent changing ID of existing engine
                        document.getElementById('upName').value = data.name;
                        document.getElementById('upCategory').value = data.category || "Custom";
                        document.getElementById('upInputType').value = data.inputType || "Custom Input";
                        document.getElementById('upInst').value = data.instruction || "";
                        document.getElementById('upCode').value = data.code;
                        
                        document.getElementById('uploadModal').classList.replace('hidden', 'flex'); 
                        document.getElementById('dropdownMenu').classList.add('hidden');
                    } catch (err) {
                        alert(err.message);
                    }
                }

                async function deleteEngine(e, id) {
                    e.stopPropagation();
                    const pwd = prompt("Enter password to delete engine:");
                    if (pwd !== "1532") {
                        if (pwd !== null) alert("Incorrect password.");
                        return;
                    }
                    
                    if (confirm("Are you sure you want to delete engine '" + id + "'? This cannot be undone.")) {
                        try {
                            const res = await fetch('/delete-engine/' + id, { method: 'DELETE' });
                            const data = await res.json();
                            if(!res.ok) throw new Error(data.error || "Failed to delete.");
                            alert(data.message);
                            window.location.reload();
                        } catch (err) {
                            alert("Error: " + err.message);
                        }
                    }
                }

                async function submitUpload() {
                    const payload = {
                        id: document.getElementById('upId').value,
                        name: document.getElementById('upName').value,
                        category: document.getElementById('upCategory').value,
                        inputType: document.getElementById('upInputType').value,
                        instruction: document.getElementById('upInst').value,
                        code: document.getElementById('upCode').value
                    };
                    if(!payload.id || !payload.name || !payload.code) return alert("ID, Name, and Code are required.");
                    
                    try {
                        const res = await fetch('/upload-engine', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify(payload)
                        });
                        const data = await res.json();
                        if(!res.ok) throw new Error(data.error);
                        alert(data.message);
                        window.location.reload();
                    } catch (e) {
                        alert("Error: " + e.message);
                    }
                }

                let logInterval;
                let abortController;

                function stopRun() {
                    if (abortController) abortController.abort();
                    clearInterval(logInterval);
                    document.getElementById('telemetry').innerHTML += '<br><span style="color:red;">> [ERROR] OPERATION ABORTED BY USER (Client Side Halt)</span>';
                    document.getElementById('loader').classList.add('hidden');
                    document.getElementById('errorText').classList.remove('hidden');
                    document.getElementById('btn').disabled = false;
                    
                    const stopBtn = document.getElementById('stopBtn');
                    stopBtn.classList.add('pointer-events-none', 'opacity-50');
                    stopBtn.classList.remove('bg-red-600/20', 'border-red-500');
                }

                async function run() {
                    const btn = document.getElementById('btn');
                    const stopBtn = document.getElementById('stopBtn');
                    const counterArea = document.getElementById('counterArea');
                    const loader = document.getElementById('loader');
                    const completeText = document.getElementById('completeText');
                    const errorText = document.getElementById('errorText');
                    const telemetryBox = document.getElementById('telemetryBox');
                    const telemetry = document.getElementById('telemetry');

                    btn.disabled = true;
                    stopBtn.classList.remove('pointer-events-none', 'opacity-50');
                    stopBtn.classList.add('bg-red-600/20', 'border-red-500');
                    
                    counterArea.classList.remove('hidden');
                    loader.classList.remove('hidden');
                    completeText.classList.add('hidden');
                    errorText.classList.add('hidden');
                    
                    telemetryBox.classList.remove('hidden');
                    telemetry.innerHTML = '';

                    logInterval = setInterval(async () => {
                        try {
                            const res = await fetch('/logs');
                            const data = await res.json();
                            if (data.logs.length > 0) {
                                telemetry.innerHTML = data.logs.join('<br>');
                                telemetry.scrollTop = telemetry.scrollHeight;
                            }
                        } catch(e) {}
                    }, 800);

                    try {
                        abortController = new AbortController();
                        const response = await fetch('/run', {
                            method: 'POST',
                            signal: abortController.signal,
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                mode: document.getElementById('mode').value,
                                domain: document.getElementById('url').value,
                                curlCommand: document.getElementById('curl').value,
                                token: document.getElementById('token').value,
                                cadEventId: document.getElementById('cadEventId').value,
                                cadClientId: document.getElementById('cadClientId').value,
                                cadEventKey: document.getElementById('cadEventKey').value,
                                dynamicShowId: document.getElementById('dynamicShowId').value,
                                cookie: document.getElementById('cookie').value,
                                customInput: document.getElementById('customInput').value,
                                fileName: document.getElementById('file').value
                            })
                        });
                        
                        if (!response.ok) {
                            const errData = await response.json();
                            throw new Error(errData.error || 'Crawl Failed.');
                        }
                        
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = (document.getElementById('file').value || 'Scrape') + '.xlsx'; 
                        a.click();
                        
                        loader.classList.add('hidden');
                        completeText.classList.remove('hidden');
                    } catch (err) {
                        if (err.name === 'AbortError') return;
                        loader.classList.add('hidden');
                        errorText.classList.remove('hidden');
                        telemetry.innerHTML += '<br><span style="color:red;">> [ERROR] ' + err.message + '</span>';
                        telemetry.scrollTop = telemetry.scrollHeight;
                    } finally { 
                        btn.disabled = false;
                        stopBtn.classList.add('pointer-events-none', 'opacity-50');
                        stopBtn.classList.remove('bg-red-600/20', 'border-red-500');
                        setTimeout(() => clearInterval(logInterval), 1500);
                    }
                }
                
                async function shutdown() { 
                    if(confirm('Shutdown?')) { 
                        await fetch('/shutdown', {method:'POST'}); 
                        document.body.innerHTML = '<div style="display:flex; height:100vh; align-items:center; justify-content:center; font-weight:bold; font-size:24px;">OFFLINE</div>'; 
                    } 
                }
                
                toggle();
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ZORG-Ω Architect Online: http://localhost:${PORT}`));
