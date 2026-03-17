const express = require('express');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

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

// --- FILE UPLOAD CONFIGURATION ---
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Sanitize filename to prevent weird character bugs
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, Date.now() + '-' + safeName);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

app.post('/upload-bulletin-file', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    res.json({
        url: `/uploads/${req.file.filename}`,
        originalName: req.file.originalname
    });
});

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

        // Notify the user who ran the scraper that it has completed
        if (socketId && socketId !== "unknown-socket") {
            io.to(socketId).emit('scraper-complete', {
                engineName: engName,
                recordCount: standardizedRecords.length,
                fileName: fileName || defaultFileName
            });
        }
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

// --- CHAT SYSTEM LOGIC ---
const chatFile = path.join(__dirname, 'chat.json');
let chatHistory = {};
try {
    if (fs.existsSync(chatFile)) chatHistory = JSON.parse(fs.readFileSync(chatFile, 'utf8'));
    else fs.writeFileSync(chatFile, JSON.stringify({}));
} catch (e) { console.error("Error loading chat.json", e); }

// Helper to alphabetically link two names together for a unique chat room
function getChatKey(name1, name2) {
    return [name1, name2].sort().join(':');
}

const activeUsers = {};
const activeEngines = {};

// --- BULLETIN BOARD LOGIC ---
const bulletinFile = path.join(__dirname, 'bulletin.json');
let bulletinPosts = [];
try {
    if (fs.existsSync(bulletinFile)) {
        const parsed = JSON.parse(fs.readFileSync(bulletinFile, 'utf8'));
        bulletinPosts = Array.isArray(parsed) ? parsed : [];
        if (!Array.isArray(parsed)) {
            fs.writeFileSync(bulletinFile, JSON.stringify([], null, 2));
        }
    } else {
        bulletinPosts = [
            { id: 101, author: "System", text: "📌 Tax Quiz scheduled for March 17th.", timestamp: Date.now() },
            { id: 102, author: "System", text: "🔗 College Drive Updates Folder: [Awaiting Link]", timestamp: Date.now() }
        ];
        fs.writeFileSync(bulletinFile, JSON.stringify(bulletinPosts, null, 2));
    }
} catch (e) { console.error("Error loading bulletin.json", e); bulletinPosts = []; }

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

    let html = '';
    for (const [cat, engines] of Object.entries(allCategories)) {
        const isGeneral = cat === 'General';
        html += `
            <div style="border-bottom:1px solid rgba(255,255,255,0.07);">
                <div onclick="toggleCategory('${cat}')" class="cat-header">
                    <span class="cat-label">${cat}</span>
                    <svg id="icon-${cat}" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" class="cat-chevron ${isGeneral ? 'open' : ''}"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </div>
                <div id="cat-${cat}" style="background:rgba(8,9,13,0.3);" class="${isGeneral ? '' : 'hidden'}">
                    ${engines.map(e => {
            const editBtn = isAdmin ? `<button onclick="editEngine(event,'${e.id}')" style="color:#3d4260;background:none;border:none;cursor:pointer;display:flex;padding:4px;border-radius:5px;transition:color 0.15s;" onmouseover="this.style.color='#6382ff'" onmouseout="this.style.color='#3d4260'" title="Edit"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>` : '';
            const delBtn = isAdmin ? `<button onclick="deleteEngine(event,'${e.id}')" style="color:#3d4260;background:none;border:none;cursor:pointer;display:flex;padding:4px;border-radius:5px;transition:color 0.15s;" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#3d4260'" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : '';
            return `
                        <div class="dropdown-engine-item" onclick="selectEngine('${e.id}','${e.name.replace(/'/g, "\\'")}')" data-engine-name="${e.name.toLowerCase()}">
                            <div style="display:flex;align-items:center;gap:8px;pointer-events:none;">
                                <span style="width:5px;height:5px;border-radius:50%;background:${e.isCustom ? '#b97cf3' : '#6382ff'};flex-shrink:0;"></span>
                                ${e.name}
                            </div>
                            <div class="action-btns">${editBtn}${delBtn}</div>
                        </div>`;
        }).join('')}
                </div>
            </div>`;
    }
    return html;
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

    // --- BULLETIN BOARD ROUTES ---
    socket.on('add-bulletin', (data) => {
        const sender = activeUsers[socket.id];
        if (!sender || !data) return;

        // Admin only
        const userEntry = savedUsers[ip];
        const isUserAdmin = userEntry && typeof userEntry === 'object' && userEntry.role === 'admin';
        if (!isUserAdmin) return;

        // Safely extract text to prevent server crashes if it's empty
        const safeText = (data.text || '').trim();

        if (!safeText && !data.fileUrl) return; // Ignore completely blank pins

        const newPin = {
            id: Date.now(),
            author: sender.name,
            text: safeText,
            fileUrl: data.fileUrl || null,
            fileName: data.fileName || null,
            timestamp: Date.now()
        };

        bulletinPosts.unshift(newPin);
        if (bulletinPosts.length > 30) bulletinPosts.pop();

        fs.writeFileSync(bulletinFile, JSON.stringify(bulletinPosts, null, 2));
        io.emit('new-bulletin', newPin);
    });

    socket.on('delete-bulletin', (id) => {
        // Allow the author or an admin to delete a pin
        const sender = activeUsers[socket.id];
        const userEntry = savedUsers[ip];
        const isUserAdmin = userEntry && typeof userEntry === 'object' && userEntry.role === 'admin';

        const postIndex = bulletinPosts.findIndex(p => p.id === id);
        if (postIndex === -1) return;

        if (isUserAdmin || bulletinPosts[postIndex].author === sender.name) {
            bulletinPosts.splice(postIndex, 1);
            fs.writeFileSync(bulletinFile, JSON.stringify(bulletinPosts, null, 2));
            io.emit('remove-bulletin', id);
        }
    });

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
        userName: uName || "Agent",
        bulletinPosts: bulletinPosts // <-- ADD THIS LINE
    });

    if (uName) {
        const savedColor = (savedUsers[ip] && typeof savedUsers[ip] === 'object') ? savedUsers[ip].avatarColor || null : null;
        activeUsers[socket.id] = { id: socket.id, name: uName, ip: ip, status: 'online', avatarColor: savedColor, scrapeCount: 0, viewing: null };
        io.emit('online-users', Object.values(activeUsers));
    } else {
        socket.emit('request-name');
    }

    socket.on('register-name', (name) => {
        if (!name || !name.trim()) return;
        const cleanName = name.trim();
        savedUsers[ip] = { name: cleanName, role: 'user' };
        fs.writeFileSync(usersFile, JSON.stringify(savedUsers, null, 2));

        activeUsers[socket.id] = { id: socket.id, name: cleanName, ip: ip, status: 'online', avatarColor: null, scrapeCount: 0, viewing: null };
        io.emit('online-users', Object.values(activeUsers));

        socket.emit('init-data', {
            isAdmin: false,
            logs: systemLogs.slice(0, 10),
            activeEngines,
            engineCount,
            customDropdownHtml: generateDropdownHtml(false),
            dynamicEngineData: generateDynamicEngineData(),
            userName: cleanName,
            bulletinPosts: bulletinPosts // <-- ADD THIS LINE
        });
    });

    // --- ADMIN GLOBAL REFRESH ---
    socket.on('admin-force-refresh', () => {
        // 1. Verify Admin status based on IP
        let ip = socket.handshake.address || '';
        if (ip.startsWith('::ffff:')) ip = ip.substring(7);

        let userEntry = savedUsers[ip];
        if (userEntry && typeof userEntry === 'object' && userEntry.role === 'admin') {
            // 2. Broadcast the execution signal to ALL connected clients
            // We pass Date.now() to act as our automated cache-buster!
            io.emit('execute-global-refresh', Date.now());
        }
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

    socket.on('update-avatar-color', (color) => {
        if (activeUsers[socket.id] && /^#[0-9a-fA-F]{6}$/.test(color)) {
            activeUsers[socket.id].avatarColor = color;
            // Persist color to user record
            if (savedUsers[ip] && typeof savedUsers[ip] === 'object') {
                savedUsers[ip].avatarColor = color;
                fs.writeFileSync(usersFile, JSON.stringify(savedUsers, null, 2));
            }
            io.emit('online-users', Object.values(activeUsers));
        }
    });

    socket.on('update-scrape-count', (count) => {
        if (activeUsers[socket.id]) {
            activeUsers[socket.id].scrapeCount = parseInt(count) || 0;
            io.emit('online-users', Object.values(activeUsers));
        }
    });

    socket.on('update-viewing', (engineName) => {
        if (activeUsers[socket.id]) {
            activeUsers[socket.id].viewing = engineName || null;
            io.emit('online-users', Object.values(activeUsers));
        }
    });

    socket.on('typing-start', ({ targetName }) => {
        const sender = activeUsers[socket.id];
        if (!sender) return;
        const targetUser = Object.values(activeUsers).find(u => u.name === targetName);
        if (targetUser) {
            io.to(targetUser.id).emit('user-typing', { from: sender.name });
        }
    });

    socket.on('typing-stop', ({ targetName }) => {
        const sender = activeUsers[socket.id];
        if (!sender) return;
        const targetUser = Object.values(activeUsers).find(u => u.name === targetName);
        if (targetUser) {
            io.to(targetUser.id).emit('user-stopped-typing', { from: sender.name });
        }
    });

    // --- PERSISTENT CHAT ROUTING ---
    socket.on('request-chat-history', (targetName) => {
        const sender = activeUsers[socket.id];
        if (!sender || !targetName) return;
        const key = getChatKey(sender.name, targetName);
        socket.emit('chat-history', { targetName, history: chatHistory[key] || [] });
    });

    socket.on('send-private-msg', ({ targetName, message }) => {
        const sender = activeUsers[socket.id];
        if (!sender || !targetName) return;

        const key = getChatKey(sender.name, targetName);
        if (!chatHistory[key]) chatHistory[key] = [];

        const msgObj = { from: sender.name, to: targetName, text: message, timestamp: Date.now() };
        chatHistory[key].push(msgObj);

        // Keep file at a reasonable size (last 100 messages per chat)
        if (chatHistory[key].length > 100) chatHistory[key] = chatHistory[key].slice(-100);
        fs.writeFileSync(chatFile, JSON.stringify(chatHistory, null, 2));

        // 1. Send it back to the sender so their screen updates instantly
        socket.emit('receive-private-msg', msgObj);

        // 2. Find the target user's current live socket ID and send it to them
        const targetUser = Object.values(activeUsers).find(u => u.name === targetName);
        if (targetUser) {
            io.to(targetUser.id).emit('receive-private-msg', msgObj);
        }
    });
});

// Serve frontend
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 ZORG-Ω Architect Online: http://localhost:${PORT}`));