const express = require('express');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const axios = require('axios');

const asyncLocalStorage = new AsyncLocalStorage();

// --- GLOBAL INTERCEPTORS ---
// Automatically abort any network requests from any engine without code changes!
axios.interceptors.request.use(config => {
    const store = asyncLocalStorage.getStore();
    if (store && store.runState && store.runState.aborted) {
        throw new axios.Cancel("OPERATION_ABORTED_BY_SYSTEM");
    }
    return config;
});

if (typeof global.fetch === 'function') {
    const originalFetch = global.fetch;
    global.fetch = async function (...args) {
        const store = asyncLocalStorage.getStore();
        if (store && store.runState && store.runState.aborted) {
            throw new Error("OPERATION_ABORTED_BY_SYSTEM");
        }
        return originalFetch.apply(this, args);
    };
}

// --- DYNAMIC ENGINES INJECTION READY ---

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
    const { mode, domain, fileName, curlCommand, token, cadEventId, cadClientId, cadEventKey, dynamicShowId, cookie, customInput, testMode } = req.body;
    let rawRecords = [];

    let runState = { aborted: false };

    // Listen for explicit abort requests from the client (fetch aborted)
    req.on('aborted', () => {
        runState.aborted = true;
        emitLog("Client manually aborted the request. Halting operation...");
    });

    // Also catch if the underlying socket closes before we could send the response
    res.on('close', () => {
        if (!res.writableEnded && !runState.aborted) {
            runState.aborted = true;
            emitLog("Client connection lost early. Operation ABORTED.");
        }
    });

    globalLogs = []; // Reset telemetry for new run
    emitLog(`--- RUN PROTOCOL STARTED: ${mode.toUpperCase()} ---`);

    let originalPush = Array.prototype.push;
    let testRecordsCaptured = [];

    try {
        const reqEngine = async (file, ...args) => {
            const p = path.join(__dirname, 'Engines', file);
            if (!fs.existsSync(p)) throw new Error(`Engine file ${file} not found.`);
            delete require.cache[require.resolve(p)];
            return await require(p)(...args);
        };

        if (testMode) {
            emitLog("🧪 TEST MODE PROTOCOL ACTIVE: Hijacking Engine array memory to force aggressive early exit at 5 records...");
            Array.prototype.push = function (...args) {
                let resOutput = originalPush.apply(this, args);
                if (args.length > 0 && args[0] && typeof args[0] === 'object' && ('Company Name' in args[0])) {
                    if (!testRecordsCaptured.includes(args[0])) {
                        testRecordsCaptured[testRecordsCaptured.length] = args[0];
                    }
                    if (testRecordsCaptured.length >= 5) {
                        throw new Error("TEST_MODE_LIMIT_MET");
                    }
                }
                return resOutput;
            };
        }

        try {
            await asyncLocalStorage.run({ runState }, async () => {
                if (mode === 'marketplace') rawRecords = await reqEngine('MapDynamics.js', dynamicShowId, cookie, emitLog, runState);
                else if (mode === 'dusseldorf') rawRecords = await reqEngine('Dusseldorf.js', domain, emitLog, runState);
                else if (mode === 'eshow') rawRecords = await reqEngine('Eshow.js', token, emitLog, runState);
                else if (mode === 'cadmium') rawRecords = await reqEngine('Cadmium.js', cadEventId, cadClientId, cadEventKey, emitLog, runState);
                else if (mode === 'informa') rawRecords = await reqEngine('Informa.js', curlCommand, emitLog, runState);
                else if (mode === 'algolia') {
                    const appId = curlCommand.match(/x-algolia-application-id[=:]\s*([a-zA-Z0-9]+)/i)?.[1];
                    const apiKey = curlCommand.match(/x-algolia-api-key[=:]\s*([a-zA-Z0-9]+)/i)?.[1];
                    const indexName = curlCommand.match(/"indexName"\s*:\s*"([^"]+)"/)?.[1];
                    const filters = curlCommand.match(/"filters"\s*:\s*"([^"]+)"/)?.[1];
                    if (!appId || !apiKey) throw new Error("Could not parse Algolia App ID or API Key from cURL.");
                    rawRecords = await reqEngine('Algolia.js', { appId, apiKey, indexName, filters }, emitLog, runState);
                } else {
                    const customEntry = customEngines.find(e => e.id === mode);
                    if (customEntry) {
                        const scriptPath = path.join(__dirname, 'Engines', `${customEntry.id}.js`);
                        if (fs.existsSync(scriptPath)) {
                            delete require.cache[require.resolve(scriptPath)];
                            const customScrape = require(scriptPath);
                            rawRecords = await customScrape(req.body, emitLog, runState);
                        } else {
                            throw new Error(`Engine file for ${customEntry.name} not found.`);
                        }
                    } else {
                        throw new Error("Unknown mode selected.");
                    }
                }
            });
        } catch (engineErr) {
            if (testMode && engineErr.message && engineErr.message.includes("TEST_MODE_LIMIT_MET")) {
                emitLog("🧪 TEST MODE FULFILLED: Limit hit. Engine operation gracefully short-circuited.");
                rawRecords = testRecordsCaptured;
            } else {
                throw engineErr;
            }
        } finally {
            if (testMode) Array.prototype.push = originalPush;
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
        res.setHeader('Access-Control-Expose-Headers', 'X-Record-Count');
        res.setHeader('X-Record-Count', standardizedRecords.length);
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

        const defaultScriptMap = {
            'marketplace': 'MapDynamics.js',
            'dusseldorf': 'Dusseldorf.js',
            'algolia': 'Algolia.js',
            'informa': 'Informa.js',
            'eshow': 'Eshow.js',
            'cadmium': 'Cadmium.js'
        };

        const scriptPath = defaultScriptMap[safeId] ? path.join(enginesDir, defaultScriptMap[safeId]) : path.join(enginesDir, `${safeId}.js`);
        fs.writeFileSync(scriptPath, code);

        const existingIndex = customEngines.findIndex(e => e.id === safeId);
        const engineData = {
            id: safeId,
            name,
            instruction: instruction || '',
            inputType: inputType !== undefined ? inputType : '',
            category: category || 'Custom'
        };

        let msgType = existingIndex >= 0 ? 'UPDATED' : 'INSTALLED';
        if (existingIndex >= 0) {
            customEngines[existingIndex] = engineData;
        } else {
            customEngines.push(engineData);
        }

        fs.writeFileSync(enginesFile, JSON.stringify(customEngines, null, 2));

        if (defaultScriptMap[safeId]) {
            let delList = [];
            const delFile = path.join(__dirname, 'deleted_engines.json');
            if (fs.existsSync(delFile)) {
                try { delList = JSON.parse(fs.readFileSync(delFile, 'utf8')); } catch (e) { }
            }
            if (delList.includes(safeId)) {
                delList = delList.filter(id => id !== safeId);
                fs.writeFileSync(delFile, JSON.stringify(delList));
            }
        }

        emitLog(`Engine '${name}' (${safeId}) has been successfully ${msgType}.`);
        res.json({ success: true, message: `Engine ${name} ${msgType.toLowerCase()} successfully.` });
    } catch (err) {
        emitLog(`SYSTEM ERROR (Upload): ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// --- ENGINE FETCH ROUTE FOR EDITING ---
app.get('/engine/:id', (req, res) => {
    try {
        const id = req.params.id;
        let entry = customEngines.find(e => e.id === id);
        const defaultScriptMap = {
            'marketplace': { file: 'MapDynamics.js', name: 'Map-Dynamics (Marketplace)' },
            'dusseldorf': { file: 'Dusseldorf.js', name: 'Messe Düsseldorf' },
            'algolia': { file: 'Algolia.js', name: 'NürnbergMesse (Algolia)' },
            'informa': { file: 'Informa.js', name: 'Informa Markets (cURL)' },
            'eshow': { file: 'Eshow.js', name: 'eShow (Concurrent)' },
            'cadmium': { file: 'Cadmium.js', name: 'Cadmium (Harvester)' }
        };

        let scriptPath;
        if (entry) {
            scriptPath = defaultScriptMap[id] ? path.join(__dirname, 'Engines', defaultScriptMap[id].file) : path.join(__dirname, 'Engines', `${id}.js`);
        } else if (defaultScriptMap[id]) {
            entry = { id: id, name: defaultScriptMap[id].name, category: 'General', inputType: '', instruction: '' };
            scriptPath = path.join(__dirname, 'Engines', defaultScriptMap[id].file);
        } else {
            return res.status(404).json({ error: 'Engine metadata not found.' });
        }

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

        const defaultScriptMap = {
            'marketplace': 'MapDynamics.js',
            'dusseldorf': 'Dusseldorf.js',
            'algolia': 'Algolia.js',
            'informa': 'Informa.js',
            'eshow': 'Eshow.js',
            'cadmium': 'Cadmium.js'
        };

        if (index === -1 && !defaultScriptMap[id]) {
            return res.status(404).json({ error: 'Engine not found.' });
        }

        let engineName = id;
        if (index !== -1) {
            engineName = customEngines[index].name;
            customEngines.splice(index, 1);
            fs.writeFileSync(enginesFile, JSON.stringify(customEngines, null, 2));
        } else if (defaultScriptMap[id]) {
            engineName = id;
        }

        if (defaultScriptMap[id]) {
            let delList = [];
            const delFile = path.join(__dirname, 'deleted_engines.json');
            if (fs.existsSync(delFile)) {
                try { delList = JSON.parse(fs.readFileSync(delFile, 'utf8')); } catch (e) { }
            }
            if (!delList.includes(id)) {
                delList.push(id);
                fs.writeFileSync(delFile, JSON.stringify(delList));
            }
        }

        const scriptPath = defaultScriptMap[id] ? path.join(__dirname, 'Engines', defaultScriptMap[id]) : path.join(__dirname, 'Engines', `${id}.js`);
        if (fs.existsSync(scriptPath)) {
            fs.unlinkSync(scriptPath);
        }

        emitLog(`Engine '${engineName}' (${id}) has been DELETED.`);
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
    let deletedEngines = [];
    try {
        const delFile = path.join(__dirname, 'deleted_engines.json');
        if (fs.existsSync(delFile)) deletedEngines = JSON.parse(fs.readFileSync(delFile, 'utf8'));
    } catch (e) { }

    const defaultEnginesBase = [
        { id: 'marketplace', name: 'Map-Dynamics (Marketplace)' },
        { id: 'dusseldorf', name: 'Messe Düsseldorf' },
        { id: 'algolia', name: 'NürnbergMesse (Algolia)' },
        { id: 'informa', name: 'Informa Markets (cURL)' },
        { id: 'eshow', name: 'eShow (Concurrent)' },
        { id: 'cadmium', name: 'Cadmium (Harvester)' }
    ];

    const allCategories = {
        'General': []
    };

    defaultEnginesBase.forEach(def => {
        if (deletedEngines.includes(def.id)) return;
        const customOverride = customEngines.find(e => e.id === def.id);
        if (customOverride) {
            const cat = customOverride.category || 'General';
            if (!allCategories[cat]) allCategories[cat] = [];
            allCategories[cat].push({ id: def.id, name: customOverride.name, isCustom: false }); // keep false so dot stays blue
        } else {
            allCategories['General'].push({ id: def.id, name: def.name, isCustom: false });
        }
    });

    customEngines.forEach(e => {
        if (defaultEnginesBase.some(def => def.id === e.id)) return; // Handled above
        if (deletedEngines.includes(e.id)) return;
        const cat = e.category || 'Custom';
        if (!allCategories[cat]) allCategories[cat] = [];
        allCategories[cat].push({ id: e.id, name: e.name, isCustom: true });
    });

    let customDropdownHtml = '';
    for (const [cat, engines] of Object.entries(allCategories)) {
        const isGeneral = cat === 'General';
        customDropdownHtml += `
            <div class="border-b border-slate-700/50 last:border-b-0">
                <div onclick="toggleCategory('${cat}')" class="bg-slate-800 hover:bg-slate-700/50 p-3 flex justify-between items-center cursor-pointer transition-colors group category-header" data-cat-name="${cat.toLowerCase()}">
                    <span class="text-slate-400 font-bold text-[10px] uppercase tracking-widest group-hover:text-slate-300">${cat}</span>
                    <svg id="icon-${cat}" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-slate-500 transition-transform duration-200 ${isGeneral ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
                <div id="cat-${cat}" class="${isGeneral ? '' : 'hidden'} bg-slate-900/50">
                    ${engines.map(e => `
                        <div class="engine-item group p-3 pl-5 hover:bg-slate-800 cursor-pointer text-blue-400 font-bold text-sm border-t border-slate-800 transition-colors flex items-center justify-between" onclick="selectEngine('${e.id}', '${e.name.replace(/'/g, "\\'")}')" data-engine-name="${e.name.toLowerCase()}">
                            <div class="flex flex-row items-center gap-2">
                                <span class="w-1.5 h-1.5 rounded-full ${e.isCustom ? 'bg-purple-500' : 'bg-blue-500'}"></span>
                                ${e.name}
                            </div>
                            <div class="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                <button onclick="editEngine(event, '${e.id}')" class="text-slate-500 hover:text-blue-400 transition-colors flex items-center justify-center p-1" title="Edit Engine">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                                <button onclick="deleteEngine(event, '${e.id}')" class="text-slate-500 hover:text-red-400 transition-colors flex items-center justify-center p-1" title="Delete Engine">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    let customInstStr = customEngines.map(e => `inst["${e.id}"] = ${JSON.stringify(e.instruction || '')};`).join('\n');
    let customToggleStr = customEngines.map(e => {
        let input = (e.inputType || '').trim();
        if (input === '' || input.toLowerCase() === 'none') {
            return `if(m === '${e.id}') { document.getElementById('customInputBox').innerHTML = ''; document.getElementById('customInputBox').classList.add('hidden'); }`;
        } else {
            const inputs = input.split(',').map(s => s.trim()).filter(s => s);
            const inputHtml = inputs.map((placeholder, idx) =>
                '<input id="customInput_' + idx + '" type="text" placeholder="' + placeholder.replace(/"/g, '&quot;').replace(/'/g, "\\'") + '" class="custom-dynamic-input w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none">'
            ).join('');
            return `if(m === '${e.id}') { document.getElementById('customInputBox').innerHTML = '${inputHtml}'; document.getElementById('customInputBox').classList.remove('hidden'); }`;
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
                /* Custom style for search input expansion */
                #searchInput { transition: width 0.3s ease, opacity 0.3s ease, padding 0.3s ease; }
                #searchInput.expanded { width: 14rem; opacity: 1; padding: 0.5rem 1rem; }
                #searchInput.collapsed { width: 0; opacity: 0; padding: 0; border: none; }
                
                /* Custom styles to make default dropdown look more like a custom select */
                select#upCategory {
                    -webkit-appearance: none;
                    background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
                    background-repeat: no-repeat;
                    background-position: right 1rem top 50%;
                    background-size: 0.65em auto;
                }
                select#upCategory option {
                    background-color: #1e293b;
                    color: white;
                }
            </style>
        </head>
        <body class="bg-slate-950 bg-[url('/Icons/Background.png')] bg-cover bg-center bg-fixed bg-no-repeat text-white min-h-screen flex items-center justify-center p-6 relative font-sans before:fixed before:inset-0 before:bg-slate-950/60 before:-z-10">
            <!-- CUSTOM MESSAGES / PROMPTS MODAL -->
            <div id="customDialogModal" class="fixed inset-0 bg-black/80 hidden items-center justify-center z-[100] p-4">
                <div class="bg-slate-900/95 backdrop-blur-2xl p-6 rounded-2xl border border-blue-500/50 shadow-[0_0_50px_rgba(0,0,0,0.8)] w-full max-w-sm transform transition-all">
                    <h3 id="dialogTitle" class="text-xl font-black text-blue-400 mb-3 italic tracking-tighter uppercase">Notice</h3>
                    <p id="dialogMessage" class="text-sm text-slate-300 mb-5 font-medium"></p>
                    
                    <input id="dialogInput" type="password" placeholder="Password..." class="hidden w-full p-3 mb-5 rounded-xl bg-slate-950 border border-slate-700 outline-none text-sm text-center font-mono focus:border-blue-500/50 transition-colors">
                    
                    <div class="flex gap-3 justify-end">
                        <button id="dialogCancelBtn" class="px-5 py-2.5 rounded-xl bg-slate-800 text-slate-400 font-bold hover:bg-slate-700 hover:text-white transition-all text-sm hidden">Cancel</button>
                        <button id="dialogConfirmBtn" class="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-black hover:bg-blue-500 transition-all text-sm uppercase tracking-wider">OK</button>
                    </div>
                </div>
            </div>

            <!-- TOAST CONTAINER -->
            <div id="toastContainer" class="fixed bottom-6 right-6 z-[200] flex flex-col items-end gap-3 pointer-events-none"></div>

            <!-- POST-EXECUTION DASHBOARD MODAL -->
            <div id="successModal" class="fixed inset-0 bg-black/80 hidden items-center justify-center z-[150] p-4 backdrop-blur-sm">
                <div class="bg-slate-900/90 backdrop-blur-2xl p-8 rounded-3xl border border-emerald-500/50 shadow-[0_0_80px_rgba(16,185,129,0.2)] w-full max-w-md transform transition-all text-center">
                    <div class="mx-auto w-20 h-20 bg-emerald-900/50 rounded-full flex items-center justify-center mb-6 border border-emerald-500/30 shadow-inner">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <h2 class="text-3xl font-black text-emerald-400 mb-2 italic tracking-tighter uppercase drop-shadow-md">Extraction Complete!</h2>
                    <p id="successModalDesc" class="text-slate-300 font-medium mb-8 text-lg">0 Distinct Records Assembled. Exporting...</p>
                    <button onclick="closeSuccessModal()" class="w-full bg-emerald-600 p-4 rounded-xl font-black text-lg text-white hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-900/20 active:scale-95 tracking-tight uppercase">Acknowledge</button>
                </div>
            </div>

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
                                <div class="relative">
                                    <select id="upCategory" class="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 outline-none text-sm text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all shadow-inner appearance-none cursor-pointer">
                                        <option value="Custom" class="bg-slate-800 text-white">Custom</option>
                                        <option value="General" class="bg-slate-800 text-white">General</option>
                                    </select>
                                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                                    </div>
                                </div>
                            </div>
                            <div class="flex-1">
                                <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Input Field Names (Comma Separated)</label>
                                <input id="upInputType" type="text" placeholder="e.g. Target URL, Username, Password" class="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 outline-none text-sm">
                            </div>
                        </div>
                        <div>
                            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1 mb-1 block">Instructions String</label>
                            <textarea id="upInst" placeholder="Instructions displayed when engine is selected... (Supports multiple lines)" class="w-full p-3 h-24 rounded-xl bg-slate-800 border border-slate-700 outline-none text-sm"></textarea>
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
                    <div id="instructionContent" class="text-[11px] text-slate-400 leading-relaxed italic whitespace-pre-wrap"></div>
                </div>

                <div class="space-y-4">
                    
                    <div class="flex gap-3 items-center relative">
                        <input type="hidden" id="mode" value="marketplace">
                        
                        <!-- CUSTOM DROPDOWN BUTTON -->
                        <div class="flex-1 relative">
                            <button id="dropdownBtn" onclick="toggleDropdownMenu()" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 text-blue-400 font-bold text-left flex justify-between items-center hover:bg-slate-700/50 transition-colors shadow-inner relative z-30">
                                <span id="dropdownBtnText">Map-Dynamics (Marketplace)</span>
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                            </button>
                            
                            <!-- DROPDOWN MENU PANEL -->
                            <div id="dropdownMenu" class="hidden absolute top-full left-0 w-full mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-40 overflow-hidden flex flex-col max-h-[24rem]">
                                <!-- SEARCH BAR WITHIN DROPDOWN -->
                                <div class="p-3 border-b border-slate-700/50 bg-slate-800/80 sticky top-0 z-10 hidden" id="searchContainer">
                                    <div class="relative">
                                        <input type="text" id="engineSearchInput" onkeyup="filterEngines()" placeholder="Search engines..." class="w-full p-2 pl-9 bg-slate-900/50 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500/50 transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 absolute left-3 top-2.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                    </div>
                                </div>
                                <div class="overflow-y-auto dropdown-scroll flex-1">
                                    ${customDropdownHtml}
                                </div>
                                <div id="noResults" class="hidden text-center p-4 text-slate-500 text-sm font-mono italic">No engines found</div>
                            </div>
                        </div>
                        
                        <!-- SEARCH TOGGLE BUTTON -->
                        <div class="flex items-center gap-2">
                            <button onclick="toggleSearch()" class="w-12 h-12 bg-slate-800 text-slate-400 rounded-xl hover:bg-slate-700 hover:text-blue-400 transition-all border border-slate-700 hover:border-slate-500/50 flex items-center justify-center shrink-0 shadow-lg shadow-black/40 z-20" title="Search Engines">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            </button>
                        </div>
                        
                        <!-- SLEEK + UPLOAD BUTTON -->
                        <button onclick="openUploadModal()" class="w-12 h-12 bg-slate-800 text-blue-500 rounded-xl hover:bg-slate-700 hover:text-blue-400 transition-all border border-slate-700 hover:border-blue-500/50 flex items-center justify-center shrink-0 shadow-lg shadow-black/40 z-20" title="Upload Custom Script">
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
                    <div id="customInputBox" class="hidden space-y-3"></div>

                    <input id="file" type="text" placeholder="Output Filename (Optional) - Defaults to Show URL/ID" class="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none">
                    
                    <div class="flex gap-3 relative">
                        <button id="btn" onclick="run()" class="w-full bg-blue-600 p-5 rounded-xl font-black text-xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/20 active:scale-95 tracking-tight">EXECUTE ARCHITECT</button>
                        
                        <!-- TEST MODE TOGGLE -->
                        <div class="flex items-center justify-center bg-slate-800 border border-slate-700 rounded-xl px-4 shadow-lg shadow-black/40" title="Test Mode (Max 5 items extracted)">
                             <label class="relative inline-flex items-center cursor-pointer group">
                                 <input type="checkbox" id="testModeToggle" class="sr-only peer">
                                 <div class="w-11 h-6 bg-slate-900 border border-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-400 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 peer-checked:after:bg-white shadow-inner"></div>
                                 <span class="ml-2 mt-0.5 text-[10px] font-black uppercase tracking-widest text-slate-500 select-none peer-checked:text-purple-400 transition-colors">Test</span>
                             </label>
                        </div>

                        <button id="stopBtn" onclick="stopRun()" class="w-20 bg-slate-800 text-red-500 border border-slate-700 hover:border-red-500/50 hover:bg-slate-700 transition-all rounded-xl focus:outline-none flex items-center justify-center shrink-0 shadow-lg shadow-black/40 pointer-events-none opacity-50" title="Emergency Stop">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
                        </button>
                    </div>
                    
                    <div id="telemetryBox" class="hidden mt-4 relative group">
                        <div class="flex justify-between items-end mb-1 pl-1 pr-1">
                            <p class="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Live Telemetry</p>
                            <div class="opacity-0 group-hover:opacity-100 transition-opacity flex gap-3 text-[9px] font-bold uppercase tracking-widest">
                                <button onclick="copyTelemetry()" class="text-slate-400 hover:text-blue-400 transition-colors flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Copy All
                                </button>
                                <button onclick="clearTelemetry()" class="text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> Clear
                                </button>
                                <button id="pauseTelemetryBtn" onclick="toggleTelemetryScroll()" class="text-slate-400 hover:text-yellow-400 transition-colors flex items-center gap-1">
                                    <svg id="pauseIcon" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> <span id="pauseText">Pause</span>
                                </button>
                            </div>
                        </div>
                        <div id="telemetry" class="bg-black border border-slate-700 rounded-xl p-3 h-40 overflow-y-auto font-mono text-[10px] text-green-400 shadow-inner break-words"></div>
                    </div>
                </div>
                <div class="mt-8 flex justify-center"><button onclick="shutdown()" class="text-slate-600 hover:text-red-500 text-[10px] font-bold transition-colors">TERMINATE SESSION</button></div>
            </div>

            <script>
                // -- DROPDOWN LOGIC --
                let searchActive = false;
                
                function toggleSearch() {
                    searchActive = !searchActive;
                    const searchContainer = document.getElementById('searchContainer');
                    const dropdownMenu = document.getElementById('dropdownMenu');
                    const searchInput = document.getElementById('engineSearchInput');
                    
                    if (searchActive) {
                        searchContainer.classList.remove('hidden');
                        dropdownMenu.classList.remove('hidden');
                        searchInput.focus();
                    } else {
                        searchContainer.classList.add('hidden');
                        searchInput.value = '';
                        filterEngines(); // reset filter
                    }
                }
                
                // -- CUSTOM DIALOG LOGIC --
                function showToast(message, type = 'success') {
                    return new Promise(resolve => {
                        const container = document.getElementById('toastContainer');
                        const toast = document.createElement('div');
                        
                        const bgClass = type === 'success' ? 'bg-emerald-900/95 border-emerald-500/50 shadow-emerald-900/50' : 'bg-red-900/95 border-red-500/50 shadow-red-900/50';
                        const iconClass = type === 'success' ? 'text-emerald-400' : 'text-red-400';
                        const title = type === 'success' ? 'SUCCESS' : 'ERROR';
                        const iconSvg = type === 'success' 
                            ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>'
                            : '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>';

                        toast.className = 'transform transition-all duration-300 translate-x-12 opacity-0 flex items-start gap-4 p-4 rounded-xl border shadow-2xl backdrop-blur-xl w-80 ' + bgClass;
                        toast.innerHTML = 
                            '<div class="shrink-0 ' + iconClass + ' mt-0.5">' + iconSvg + '</div>' +
                            '<div class="flex-1">' +
                                '<h4 class="' + iconClass + ' font-black text-xs uppercase tracking-widest mb-1 italic">' + title + '</h4>' +
                                '<p class="text-slate-200 text-sm font-medium">' + message + '</p>' +
                            '</div>';
                        
                        container.appendChild(toast);
                        
                        requestAnimationFrame(() => {
                            toast.classList.remove('translate-x-12', 'opacity-0');
                        });
                        
                        setTimeout(() => {
                            toast.classList.add('translate-x-12', 'opacity-0');
                            setTimeout(() => {
                                toast.remove();
                                resolve();
                            }, 300);
                        }, 4000);
                    });
                }
                
                function customConfirm(message, title = "Confirm Action") {
                    return new Promise(resolve => {
                        const modal = document.getElementById('customDialogModal');
                        document.getElementById('dialogTitle').innerText = title;
                        document.getElementById('dialogTitle').className = "text-xl font-black text-yellow-500 mb-3 italic tracking-tighter uppercase";
                        document.getElementById('dialogMessage').innerText = message;
                        document.getElementById('dialogInput').classList.add('hidden');
                        
                        const cancelBtn = document.getElementById('dialogCancelBtn');
                        cancelBtn.classList.remove('hidden');
                        
                        const confirmBtn = document.getElementById('dialogConfirmBtn');
                        confirmBtn.className = "px-5 py-2.5 rounded-xl bg-red-600 text-white font-black hover:bg-red-500 transition-all text-sm uppercase tracking-wider shadow-lg shadow-red-900/20";
                        confirmBtn.innerText = "Proceed";
                        
                        const handleConfirm = () => { cleanup(); resolve(true); };
                        const handleCancel = () => { cleanup(); resolve(false); };
                        
                        const cleanup = () => {
                            modal.classList.replace('flex', 'hidden');
                            confirmBtn.removeEventListener('click', handleConfirm);
                            cancelBtn.removeEventListener('click', handleCancel);
                        };
                        
                        confirmBtn.addEventListener('click', handleConfirm);
                        cancelBtn.addEventListener('click', handleCancel);
                        modal.classList.replace('hidden', 'flex');
                    });
                }
                
                function customPrompt(message, title = "Authentication Required") {
                    return new Promise(resolve => {
                        const modal = document.getElementById('customDialogModal');
                        document.getElementById('dialogTitle').innerText = title;
                        document.getElementById('dialogTitle').className = "text-xl font-black text-purple-500 mb-3 italic tracking-tighter uppercase";
                        document.getElementById('dialogMessage').innerText = message;
                        
                        const input = document.getElementById('dialogInput');
                        input.value = '';
                        input.classList.remove('hidden');
                        
                        const cancelBtn = document.getElementById('dialogCancelBtn');
                        cancelBtn.classList.remove('hidden');
                        
                        const confirmBtn = document.getElementById('dialogConfirmBtn');
                        confirmBtn.className = "px-5 py-2.5 rounded-xl bg-purple-600 text-white font-black hover:bg-purple-500 transition-all text-sm uppercase tracking-wider shadow-lg shadow-purple-900/20";
                        confirmBtn.innerText = "Submit";
                        
                        const handleConfirm = () => { cleanup(); resolve(input.value); };
                        const handleCancel = () => { cleanup(); resolve(null); };
                        const handleEnter = (e) => { if(e.key === 'Enter') handleConfirm(); };
                        
                        const cleanup = () => {
                            modal.classList.replace('flex', 'hidden');
                            confirmBtn.removeEventListener('click', handleConfirm);
                            cancelBtn.removeEventListener('click', handleCancel);
                            input.removeEventListener('keypress', handleEnter);
                        };
                        
                        confirmBtn.addEventListener('click', handleConfirm);
                        cancelBtn.addEventListener('click', handleCancel);
                        input.addEventListener('keypress', handleEnter);
                        
                        modal.classList.replace('hidden', 'flex');
                        setTimeout(() => input.focus(), 50);
                    });
                }

                function filterEngines() {
                    const term = document.getElementById('engineSearchInput').value.toLowerCase();
                    const items = document.querySelectorAll('.engine-item');
                    let anyVisible = false;
                    
                    if (term === '') {
                        // Reset everything back to visible
                        items.forEach(item => item.style.display = 'flex');
                        const categories = document.querySelectorAll('.border-b.border-slate-700\\/50');
                        categories.forEach(cat => {
                            if (cat === document.getElementById('searchContainer').parentElement) return; 
                            cat.style.display = 'block';
                        });
                        document.getElementById('noResults').classList.add('hidden');
                        return;
                    }
                    
                    items.forEach(item => {
                        const name = item.getAttribute('data-engine-name');
                        if (name.includes(term)) {
                            item.style.display = 'flex';
                            anyVisible = true;
                            // Ensure parent category is visible if it matches
                            const parentCat = item.closest('.bg-slate-900\\/50');
                            if (term !== '' && parentCat) {
                                parentCat.classList.remove('hidden');
                                const headerId = parentCat.id.replace('cat-', 'icon-');
                                document.getElementById(headerId).classList.add('rotate-180');
                            }
                        } else {
                            item.style.display = 'none';
                        }
                    });
                    
                    // Toggle No Results
                    document.getElementById('noResults').classList.toggle('hidden', !!anyVisible || items.length === 0);
                    
                    // Toggle categories if empty
                    const categories = document.querySelectorAll('.border-b.border-slate-700\\/50');
                    categories.forEach(cat => {
                        if (cat === document.getElementById('searchContainer').parentElement) return; // skip search barrier
                        const visibleItems = cat.querySelectorAll('.engine-item[style="display: flex;"], .engine-item:not([style="display: none;"])');
                        cat.style.display = visibleItems.length > 0 ? 'block' : 'none';
                    });
                }
                
                function toggleDropdownMenu() {
                    document.getElementById('dropdownMenu').classList.toggle('hidden');
                    if(searchActive) setTimeout(() => document.getElementById('engineSearchInput').focus(), 50);
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
                    const searchBtn = document.querySelector('button[title="Search Engines"]');
                    const uploadModal = document.getElementById('uploadModal');
                    
                    if (!dropdownBtn.contains(event.target) && !dropdownMenu.contains(event.target) && (!searchBtn || !searchBtn.contains(event.target))) {
                        dropdownMenu.classList.add('hidden');
                        if(searchActive) { /* optional: close search on click outside */ }
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

                function showSuccessModal(count) {
                    const formattedCount = parseInt(count || 0).toLocaleString();
                    document.getElementById('successModalDesc').innerText = formattedCount + ' Distinct Records Assembled. Exporting...';
                    document.getElementById('successModal').classList.replace('hidden', 'flex');
                }
                
                function closeSuccessModal() {
                    document.getElementById('successModal').classList.replace('flex', 'hidden');
                }
                
                async function editEngine(e, id) {
                    e.stopPropagation(); // Prevent dropdown from closing / selecting
                    
                    const pwd = await customPrompt("Verify administrative permission to modify existing framework parameters.", "Security Check");
                    if (pwd !== "1532") {
                        if (pwd !== null) showToast("Invalid credentials supplied. Access denied.", "error");
                        return;
                    }
                    
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
                        showToast(err.message, "error");
                    }
                }

                async function deleteEngine(e, id) {
                    e.stopPropagation();
                    const pwd = await customPrompt("Verify administrative permission to obliterate engine: " + id, "Security Check");
                    if (pwd !== "1532") {
                        if (pwd !== null) showToast("Invalid credentials supplied. Access denied.", "error");
                        return;
                    }
                    
                    const isConfirmed = await customConfirm("Are you sure you want to delete engine '" + id + "'? This action is permanent and cannot be undone.", "Confirm Deletion");
                    if (isConfirmed) {
                        try {
                            const res = await fetch('/delete-engine/' + id, { method: 'DELETE' });
                            const data = await res.json();
                            if(!res.ok) throw new Error(data.error || "Failed to delete.");
                            await showToast(data.message, "success");
                            window.location.reload();
                        } catch (err) {
                            showToast("Error: " + err.message, "error");
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
                    if(!payload.id || !payload.name || !payload.code) {
                        showToast("ID, Name, and Code fields are strictly required prior to injection.", "error");
                        return;
                    }
                    
                    try {
                        const res = await fetch('/upload-engine', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify(payload)
                        });
                        const data = await res.json();
                        if(!res.ok) throw new Error(data.error);
                        
                        closeUploadModal();
                        await showToast(data.message, "success");
                        window.location.reload();
                    } catch (e) {
                        showToast("Error: " + e.message, "error");
                    }
                }

                let logInterval;
                let abortController;
                let autoScrollTelemetry = true;

                function copyTelemetry() {
                    const text = document.getElementById('telemetry').innerText;
                    navigator.clipboard.writeText(text).then(() => showToast("Telemetry copied to clipboard.", "success"));
                }
                
                function clearTelemetry() {
                    document.getElementById('telemetry').innerHTML = '';
                    showToast("Telemetry cleared.", "success");
                }
                
                function toggleTelemetryScroll() {
                    autoScrollTelemetry = !autoScrollTelemetry;
                    const btnSpan = document.getElementById('pauseText');
                    const icon = document.getElementById('pauseIcon');
                    if(autoScrollTelemetry) {
                        btnSpan.innerText = 'Pause';
                        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />';
                        document.getElementById('telemetry').scrollTop = document.getElementById('telemetry').scrollHeight;
                    } else {
                        btnSpan.innerText = 'Resume';
                        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
                    }
                }

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
                                if (autoScrollTelemetry) {
                                    telemetry.scrollTop = telemetry.scrollHeight;
                                }
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
                                customInput: Array.from(document.querySelectorAll('.custom-dynamic-input')).map(el => el.value)[0] || '',
                                customInputs: Array.from(document.querySelectorAll('.custom-dynamic-input')).map(el => el.value),
                                fileName: document.getElementById('file').value,
                                testMode: document.getElementById('testModeToggle').checked
                            })
                        });
                        
                        if (!response.ok) {
                            const errData = await response.json();
                            throw new Error(errData.error || 'Crawl Failed.');
                        }
                        
                        const recordCount = response.headers.get('X-Record-Count') || 0;
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = (document.getElementById('file').value || 'Scrape') + '.xlsx'; 
                        a.click();
                        
                        loader.classList.add('hidden');
                        completeText.classList.remove('hidden');
                        showSuccessModal(recordCount);
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
                    const isConfirmed = await customConfirm("Are you certain you wish to terminate the ZORG-Ω instance?", "System Shutdown");
                    if(isConfirmed) { 
                        await fetch('/shutdown', {method:'POST'}); 
                        document.body.innerHTML = '<div style="display:flex; height:100vh; align-items:center; justify-content:center; font-weight:bold; font-size:24px; color:#fff;">OFFLINE</div>'; 
                    } 
                }
                
                toggle();
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ZORG-Ω Architect Online: http://localhost:${PORT}`));
