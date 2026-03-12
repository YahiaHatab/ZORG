const express = require('express');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');

const asyncLocalStorage = new AsyncLocalStorage();

// --- GLOBAL INTERCEPTORS ---
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

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public'))); // CRITICAL: Serves index.html, style.css, client.js
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

    // --- LOCK REGISTRATION ---
    let ip = req.socket.remoteAddress || req.ip;
    if (ip && ip.startsWith('::ffff:')) ip = ip.substring(7);
    let currentUser = Object.values(activeUsers).find(u => u.ip === ip);
    let username = currentUser ? currentUser.name : (savedUsers[ip] ? savedUsers[ip].name : "Unknown");
    let socketId = currentUser ? currentUser.id : "unknown-socket";

    if (activeEngines[mode] && activeEngines[mode].socketId !== socketId) {
        return res.status(409).json({ error: `Engine is currently in use by ${activeEngines[mode].startedBy}.` });
    }

    const defaultScriptMap = {
        'marketplace': 'Map-Dynamics (Marketplace)',
        'dusseldorf': 'Messe Düsseldorf',
        'algolia': 'NürnbergMesse (Algolia)',
        'informa': 'Informa Markets (cURL)',
        'eshow': 'eShow (Concurrent)',
        'cadmium': 'Cadmium (Harvester)'
    };
    let engName = defaultScriptMap[mode];
    if (!engName) {
        const ce = customEngines.find(e => e.id === mode);
        if (ce) engName = ce.name;
        else engName = mode;
    }

    activeEngines[mode] = { startedBy: username, socketId: socketId, engineName: engName, startTime: Date.now(), mode: mode };
    io.emit('engine-registry-update', activeEngines);

    let runState = { aborted: false };

    req.on('aborted', () => {
        runState.aborted = true;
        emitLog("Client manually aborted the request. Halting operation...");
    });

    res.on('close', () => {
        if (!res.writableEnded && !runState.aborted) {
            runState.aborted = true;
            emitLog("Client connection lost early. Operation ABORTED.");
        }
    });

    globalLogs = [];
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
            if (activeEngines[mode] && activeEngines[mode].socketId === socketId) {
                delete activeEngines[mode];
                io.emit('engine-registry-update', activeEngines);
            }
        }

        if (!rawRecords || !rawRecords.length) {
            emitLog("CRITICAL: Scraper returned 0 valid records.");
            return res.status(404).json({ error: "No data found or request expired." });
        }

        emitLog(`Structuring, standardizing, and deduplicating ${rawRecords.length} items...`);

        const clean = (val) => {
            if (val === undefined || val === null) return 'N/A';
            const str = String(val).trim();
            if (str === '' || str.toUpperCase() === 'N/A' || str.toUpperCase() === 'NULL' || str.toUpperCase() === 'UNDEFINED') return 'N/A';
            return str;
        };
        const mergedRecordsMap = new Map();

        rawRecords.forEach(item => {
            const rawName = item["Company Name"];
            const cleanName = clean(rawName);
            if (cleanName === 'N/A') return;

            const uniqueKey = cleanName.toLowerCase();

            if (mergedRecordsMap.has(uniqueKey)) {
                const existingEntry = mergedRecordsMap.get(uniqueKey);
                const newBooth = clean(item["Booth"]);

                if (newBooth !== 'N/A' && !existingEntry["Booth"].includes(newBooth)) {
                    existingEntry["Booth"] = existingEntry["Booth"] !== 'N/A'
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

// --- ENGINE ROUTES ---
app.post('/upload-engine', (req, res) => {
    try {
        const { id, name, instruction, inputType, category, code } = req.body;
        if (!id || !name || !code) throw new Error("Missing required fields. ID, Name, and Code are mandatory.");

        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
        const enginesDir = path.join(__dirname, 'Engines');
        if (!fs.existsSync(enginesDir)) fs.mkdirSync(enginesDir);

        const defaultScriptMap = {
            'marketplace': 'MapDynamics.js', 'dusseldorf': 'Dusseldorf.js', 'algolia': 'Algolia.js',
            'informa': 'Informa.js', 'eshow': 'Eshow.js', 'cadmium': 'Cadmium.js'
        };

        const scriptPath = defaultScriptMap[safeId] ? path.join(enginesDir, defaultScriptMap[safeId]) : path.join(enginesDir, `${safeId}.js`);
        fs.writeFileSync(scriptPath, code);

        const existingIndex = customEngines.findIndex(e => e.id === safeId);
        const engineData = { id: safeId, name, instruction: instruction || '', inputType: inputType !== undefined ? inputType : '', category: category || 'Custom' };

        let msgType = existingIndex >= 0 ? 'UPDATED' : 'INSTALLED';
        if (existingIndex >= 0) customEngines[existingIndex] = engineData;
        else customEngines.push(engineData);

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

        let currDel = [];
        try { if (fs.existsSync(path.join(__dirname, 'deleted_engines.json'))) currDel = JSON.parse(fs.readFileSync(path.join(__dirname, 'deleted_engines.json'), 'utf8')); } catch (e) { }
        const newCount = 6 + customEngines.length - currDel.length;
        io.emit('update-engine-count', newCount);

        emitLog(`Engine '${name}' (${safeId}) has been successfully ${msgType}.`);
        res.json({ success: true, message: `Engine ${name} ${msgType.toLowerCase()} successfully.` });
    } catch (err) {
        emitLog(`SYSTEM ERROR (Upload): ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

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

app.delete('/delete-engine/:id', (req, res) => {
    try {
        const id = req.params.id;
        const index = customEngines.findIndex(e => e.id === id);

        const defaultScriptMap = {
            'marketplace': 'MapDynamics.js', 'dusseldorf': 'Dusseldorf.js', 'algolia': 'Algolia.js',
            'informa': 'Informa.js', 'eshow': 'Eshow.js', 'cadmium': 'Cadmium.js'
        };

        if (index === -1 && !defaultScriptMap[id]) return res.status(404).json({ error: 'Engine not found.' });

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
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

        let currDel = [];
        try { if (fs.existsSync(path.join(__dirname, 'deleted_engines.json'))) currDel = JSON.parse(fs.readFileSync(path.join(__dirname, 'deleted_engines.json'), 'utf8')); } catch (e) { }
        const newCount = 6 + customEngines.length - currDel.length;
        io.emit('update-engine-count', newCount);

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

// --- SYSTEM UPDATES LOGIC ---
const logsFile = path.join(__dirname, 'logs.json');
let systemLogs = [];
try {
    if (fs.existsSync(logsFile)) {
        systemLogs = JSON.parse(fs.readFileSync(logsFile, 'utf8'));
        let modified = false;
        systemLogs = systemLogs.map((log, index) => {
            if (!log.id) { log.id = Date.now() + index; modified = true; }
            return log;
        });
        if (modified) fs.writeFileSync(logsFile, JSON.stringify(systemLogs, null, 2));
    } else {
        fs.writeFileSync(logsFile, JSON.stringify([]));
    }
} catch (e) { console.error("Error loading logs.json", e); }

app.post('/admin/add-log', (req, res) => {
    let ip = req.socket.remoteAddress || req.ip;
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);

    let userEntry = savedUsers[ip];
    let isAdmin = false;
    let authorName = "Admin";
    if (userEntry && typeof userEntry === 'object' && userEntry.role === 'admin') {
        isAdmin = true;
        authorName = userEntry.name;
    }

    if (!isAdmin) return res.status(403).json({ error: "Unauthorized. Admin privileges required." });

    const { text, category } = req.body;
    if (!text || !category) return res.status(400).json({ error: "Missing text or category." });

    const newUpdate = { id: Date.now(), text, category, date: new Date().toISOString(), author: authorName };

    systemLogs.unshift(newUpdate);
    if (systemLogs.length > 50) systemLogs = systemLogs.slice(0, 50);
    fs.writeFileSync(logsFile, JSON.stringify(systemLogs, null, 2));

    io.emit('new-system-update', newUpdate);
    res.json({ success: true, message: "System update broadcasted." });
});

app.post('/admin/clear-logs', (req, res) => {
    let ip = req.socket.remoteAddress || req.ip;
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    let userEntry = savedUsers[ip];
    if (!userEntry || userEntry.role !== 'admin') return res.status(403).json({ error: "Unauthorized." });

    systemLogs = [];
    fs.writeFileSync(logsFile, JSON.stringify([]));
    io.emit('clear-logs');
    res.json({ success: true });
});

app.delete('/admin/delete-log/:id', (req, res) => {
    let ip = req.socket.remoteAddress || req.ip;
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    let userEntry = savedUsers[ip];
    if (!userEntry || userEntry.role !== 'admin') return res.status(403).json({ error: "Unauthorized." });

    const id = parseInt(req.params.id);
    systemLogs = systemLogs.filter(log => log.id !== id);
    fs.writeFileSync(logsFile, JSON.stringify(systemLogs, null, 2));

    io.emit('delete-log', id);
    res.json({ success: true });
});

// --- SOCKET.IO REAL-TIME SYSTEM & HTML GENERATOR ---
const usersFile = path.join(__dirname, 'users.json');
let savedUsers = {};
try {
    if (fs.existsSync(usersFile)) savedUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
} catch (e) { console.error("Error loading users.json", e); }

const activeUsers = {};
const activeEngines = {};

function generateDropdownHtml(isAdmin) {
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

    const allCategories = { 'General': [] };

    defaultEnginesBase.forEach(def => {
        if (deletedEngines.includes(def.id)) return;
        const customOverride = customEngines.find(e => e.id === def.id);
        if (customOverride) {
            const cat = customOverride.category || 'General';
            if (!allCategories[cat]) allCategories[cat] = [];
            allCategories[cat].push({ id: def.id, name: customOverride.name, isCustom: false });
        } else {
            allCategories['General'].push({ id: def.id, name: def.name, isCustom: false });
        }
    });

    customEngines.forEach(e => {
        if (defaultEnginesBase.some(def => def.id === e.id)) return;
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
                    ${engines.map(e => {
            const editBtn = isAdmin ? `<button onclick="editEngine(event, '${e.id}')" class="text-slate-500 hover:text-blue-400 transition-colors flex items-center justify-center p-1" title="Edit Engine"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>` : '';
            const delBtn = isAdmin ? `<button onclick="deleteEngine(event, '${e.id}')" class="text-slate-500 hover:text-red-400 transition-colors flex items-center justify-center p-1" title="Delete Engine"><svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>` : '';

            return `
                        <div class="engine-item group p-3 pl-5 hover:bg-slate-800 cursor-pointer text-blue-400 font-bold text-sm border-t border-slate-800 transition-colors flex items-center justify-between" onclick="selectEngine('${e.id}', '${e.name.replace(/'/g, "\\'")}')" data-engine-name="${e.name.toLowerCase()}">
                            <div class="flex flex-row items-center gap-2">
                                <span class="w-1.5 h-1.5 rounded-full ${e.isCustom ? 'bg-purple-500' : 'bg-blue-500'}"></span>
                                ${e.name}
                            </div>
                            <div class="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                ${editBtn}${delBtn}
                            </div>
                        </div>
                    `}).join('')}
                </div>
            </div>
        `;
    }
    return customDropdownHtml;
}

function generateDynamicEngineData() {
    const inst = {};
    const toggleLogic = {};

    customEngines.forEach(e => {
        inst[e.id] = e.instruction || '';
        let input = (e.inputType || '').trim();
        if (input === '' || input.toLowerCase() === 'none') {
            toggleLogic[e.id] = { type: 'none' };
        } else {
            const inputs = input.split(',').map(s => s.trim()).filter(s => s);
            toggleLogic[e.id] = { type: 'custom', inputs: inputs };
        }
    });
    return { instructions: inst, logic: toggleLogic };
}

io.on('connection', (socket) => {
    let ip = socket.handshake.address || '';
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);

    let userEntry = savedUsers[ip];
    let uName = "";
    let isAdmin = false;

    if (userEntry) {
        if (typeof userEntry === 'string') { uName = userEntry; }
        else { uName = userEntry.name; if (userEntry.role === 'admin') isAdmin = true; }
    }

    let deletedEnginesCount = 0;
    try { if (fs.existsSync(path.join(__dirname, 'deleted_engines.json'))) deletedEnginesCount = JSON.parse(fs.readFileSync(path.join(__dirname, 'deleted_engines.json'), 'utf8')).length; } catch (e) { }
    const engineCount = 6 + customEngines.length - deletedEnginesCount;

    // Send payload on connect
    socket.emit('init-data', {
        isAdmin,
        logs: systemLogs.slice(0, 10),
        activeEngines,
        engineCount,
        customDropdownHtml: generateDropdownHtml(isAdmin),
        dynamicEngineData: generateDynamicEngineData(),
        userName: uName || "Agent"
    });

    if (uName) {
        activeUsers[socket.id] = { id: socket.id, name: uName, ip: ip, status: 'online' };
        io.emit('online-users', Object.values(activeUsers));
    } else {
        socket.emit('request-name');
    }

    socket.on('register-name', (name) => {
        if (!name || !name.trim()) return;
        const cleanName = name.trim();
        savedUsers[ip] = { name: cleanName, role: 'user' };
        fs.writeFileSync(usersFile, JSON.stringify(savedUsers, null, 2));

        activeUsers[socket.id] = { id: socket.id, name: cleanName, ip: ip, status: 'online' };
        io.emit('online-users', Object.values(activeUsers));

        socket.emit('init-data', {
            isAdmin: false,
            logs: systemLogs.slice(0, 10),
            activeEngines,
            engineCount,
            customDropdownHtml: generateDropdownHtml(false),
            dynamicEngineData: generateDynamicEngineData(),
            userName: cleanName
        });
    });

    socket.on('disconnect', () => {
        if (activeUsers[socket.id]) {
            delete activeUsers[socket.id];
            io.emit('online-users', Object.values(activeUsers));
        }
    });

    socket.on('update-presence', (status) => {
        if (activeUsers[socket.id]) {
            activeUsers[socket.id].status = status;
            io.emit('online-users', Object.values(activeUsers));
        }
    });

    socket.on('send-private-msg', ({ targetId, message }) => {
        const sender = activeUsers[socket.id];
        if (sender && activeUsers[targetId]) {
            io.to(targetId).emit('receive-private-msg', {
                from: sender.name,
                message: message,
                fromId: socket.id
            });
        }
    });
});

// Serve frontend
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 ZORG-Ω Architect Online: http://localhost:${PORT}`));