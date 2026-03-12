let searchActive = false;
let dynamicInstructions = {};
let dynamicLogic = {};

// --- SOCKET & INIT ---
window.zorgSocket = io();

window.zorgSocket.on('connect', () => {
    console.log('Connected to ZORG-Ω Network.');
});

window.zorgSocket.on('init-data', (data) => {
    // 1. Update Username
    const welcomeTag = document.getElementById('welcome-user');
    if (welcomeTag) welcomeTag.innerText = data.userName;

    // 2. Admin Privileges
    isUserAdmin = data.isAdmin;
    if (data.isAdmin) {
        document.getElementById('adminUpdatePanel').classList.remove('hidden');
    }

    // 3. Render Logs
    if (data.logs && data.logs.length > 0) {
        document.getElementById('updatesList').innerHTML = data.logs.map((log, idx) => createUpdateHtml(log, idx)).join('');
    } else {
        document.getElementById('updatesList').innerHTML = '';
    }

    // 4. Render Dropdown Engines
    if (data.customDropdownHtml) {
        document.getElementById('engineListContainer').innerHTML = data.customDropdownHtml;
    }

    // 5. Store Dynamic Logic & Instructions
    if (data.dynamicEngineData) {
        dynamicInstructions = data.dynamicEngineData.instructions;
        dynamicLogic = data.dynamicEngineData.logic;
    }

    // 6. Update Stats
    if (data.activeEngines) {
        activeEnginesMap = data.activeEngines;
        syncEngineUI();
    }
    if (data.engineCount !== undefined) {
        document.getElementById('engineCountBadge').innerText = data.engineCount;
    }
    toggle(); // re-run toggle to apply new logic
});

// -- DROPDOWN & SEARCH --
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
        filterEngines();
    }
}

function filterEngines() {
    const term = document.getElementById('engineSearchInput').value.toLowerCase();
    const items = document.querySelectorAll('.engine-item');
    let anyVisible = false;

    if (term === '') {
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

    document.getElementById('noResults').classList.toggle('hidden', !!anyVisible || items.length === 0);

    const categories = document.querySelectorAll('.border-b.border-slate-700\\/50');
    categories.forEach(cat => {
        if (cat === document.getElementById('searchContainer').parentElement) return;
        const visibleItems = cat.querySelectorAll('.engine-item[style="display: flex;"], .engine-item:not([style="display: none;"])');
        cat.style.display = visibleItems.length > 0 ? 'block' : 'none';
    });
}

function toggleDropdownMenu() {
    document.getElementById('dropdownMenu').classList.toggle('hidden');
    if (searchActive) setTimeout(() => document.getElementById('engineSearchInput').focus(), 50);
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

document.addEventListener('click', function (event) {
    const dropdownBtn = document.getElementById('dropdownBtn');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const searchBtn = document.querySelector('button[title="Search Engines"]');

    if (dropdownBtn && dropdownMenu && !dropdownBtn.contains(event.target) && !dropdownMenu.contains(event.target) && (!searchBtn || !searchBtn.contains(event.target))) {
        dropdownMenu.classList.add('hidden');
    }
});

// -- DYNAMIC TOGGLE LOGIC --
function toggle() {
    const m = document.getElementById('mode').value;

    // Instructions
    const defaultInst = {
        marketplace: "Provide the Show ID and your PHPSESSID cookie. Uses Deep Recovery for contact names.",
        dusseldorf: "Provide the base domain. Targets /vis-api/ search.",
        algolia: "Paste the Algolia API cURL command (Copy as cURL bash) from your network tab.",
        informa: "Paste the Informa API cURL command (Copy as cURL bash) from your network tab.",
        eshow: "Copy the Bearer Token from floor_space.cfc headers.",
        cadmium: "Extract Event ID, Client ID, and Event Key from CreateRentedBoothList.asp."
    };
    document.getElementById('instructionContent').innerText = defaultInst[m] || dynamicInstructions[m] || "No instructions provided.";

    // Built-in boxes
    document.getElementById('marketBox').classList.toggle('hidden', m !== 'marketplace');
    document.getElementById('standardBox').classList.toggle('hidden', !['dusseldorf'].includes(m));
    document.getElementById('curlBox').classList.toggle('hidden', !['algolia', 'informa'].includes(m));
    document.getElementById('eshowBox').classList.toggle('hidden', m !== 'eshow');
    document.getElementById('cadBox').classList.toggle('hidden', m !== 'cadmium');

    if (m === 'algolia') document.getElementById('curl').placeholder = "Paste Algolia API cURL here...";
    if (m === 'informa') document.getElementById('curl').placeholder = "Paste Informa API cURL here...";

    // Dynamic boxes
    const customBox = document.getElementById('customInputBox');
    if (dynamicLogic[m]) {
        if (dynamicLogic[m].type === 'none') {
            customBox.innerHTML = '';
            customBox.classList.add('hidden');
        } else if (dynamicLogic[m].type === 'custom') {
            const inputs = dynamicLogic[m].inputs;
            const inputHtml = inputs.map((placeholder, idx) =>
                '<input id="customInput_' + idx + '" type="text" placeholder="' + placeholder.replace(/"/g, '&quot;').replace(/'/g, "\\'") + '" class="custom-dynamic-input w-full p-4 rounded-xl bg-slate-800 border border-slate-700 outline-none">'
            ).join('');
            customBox.innerHTML = inputHtml;
            customBox.classList.remove('hidden');
        }
    } else {
        customBox.classList.add('hidden');
    }

    if (typeof syncEngineUI === 'function') syncEngineUI();
}

// -- CUSTOM DIALOGS --
function showToast(message, type = 'success', onClickAction = '') {
    return new Promise(resolve => {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');

        let bgClass = '';
        let iconClass = '';
        let titleStr = '';
        let iconSvg = '';

        if (type === 'success') {
            bgClass = 'bg-emerald-900/95 border-emerald-500/50 shadow-emerald-900/50';
            iconClass = 'text-emerald-400';
            titleStr = 'SUCCESS';
            iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>';
        } else if (type === 'error') {
            bgClass = 'bg-red-900/95 border-red-500/50 shadow-red-900/50';
            iconClass = 'text-red-400';
            titleStr = 'ERROR';
            iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>';
        } else if (type === 'whisper') {
            bgClass = 'bg-purple-900/95 border-purple-500/50 shadow-purple-900/50 hover:bg-purple-800/95 cursor-pointer';
            iconClass = 'text-purple-400';
            titleStr = 'TRANSMISSION';
            iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM7 8H5v2h2V8zm2 0h2v2H9V8zm6 0h-2v2h2V8z" clip-rule="evenodd" /></svg>';
        }

        toast.className = 'transform transition-all duration-300 translate-x-12 opacity-0 flex items-start gap-4 p-4 rounded-xl border shadow-2xl backdrop-blur-xl w-80 pointer-events-auto ' + bgClass;
        if (onClickAction) toast.setAttribute('onclick', onClickAction);
        toast.innerHTML =
            '<div class="shrink-0 ' + iconClass + ' mt-0.5">' + iconSvg + '</div>' +
            '<div class="flex-1">' +
            '<h4 class="' + iconClass + ' font-black text-xs uppercase tracking-widest mb-1 italic">' + titleStr + '</h4>' +
            '<p class="text-slate-200 text-sm font-medium">' + message + '</p>' +
            '</div>';

        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.remove('translate-x-12', 'opacity-0'));
        setTimeout(() => {
            toast.classList.add('translate-x-12', 'opacity-0');
            setTimeout(() => { toast.remove(); resolve(); }, 300);
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
        const handleEnter = (e) => { if (e.key === 'Enter') handleConfirm(); };

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

// -- ENGINE MANAGEMENT --
function openUploadModal() {
    document.getElementById('modalTitle').innerText = "Register New Engine";
    document.getElementById('upId').value = "";
    document.getElementById('upId').readOnly = false;
    document.getElementById('upName').value = "";
    document.getElementById('upCategory').value = "Custom";
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
    e.stopPropagation();
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
        document.getElementById('upId').readOnly = true;
        document.getElementById('upName').value = data.name;
        document.getElementById('upCategory').value = data.category || "Custom";
        document.getElementById('upInputType').value = data.inputType !== undefined ? data.inputType : "Custom Input";
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
            if (!res.ok) throw new Error(data.error || "Failed to delete.");
            showToast(data.message, "success");
            setTimeout(() => window.location.reload(), 800);
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
    if (!payload.id || !payload.name || !payload.code) {
        showToast("ID, Name, and Code fields are strictly required prior to injection.", "error");
        return;
    }

    try {
        const res = await fetch('/upload-engine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        closeUploadModal();
        showToast(data.message, "success");
        setTimeout(() => window.location.reload(), 800);
    } catch (e) {
        showToast("Error: " + e.message, "error");
    }
}

// -- PROFILE --
let zUsername = '';
let zScrapeCount = 0;

function initProfile() {
    const storedDate = localStorage.getItem('zorg_last_scrape_date');
    const storedCount = localStorage.getItem('zorg_scrape_count');
    const today = new Date().toDateString();

    if (storedDate !== today) {
        zScrapeCount = 0;
        localStorage.setItem('zorg_last_scrape_date', today);
        localStorage.setItem('zorg_scrape_count', '0');
    } else {
        zScrapeCount = parseInt(storedCount) || 0;
    }

    document.getElementById('scrapeCount').innerText = zScrapeCount;
}

function handleLogin() {
    const nameInput = document.getElementById('loginName').value.trim();
    if (!nameInput) {
        showToast("Designation required.", "error");
        return;
    }

    zUsername = nameInput;
    requestNotificationPermission();
    if (window.zorgSocket) window.zorgSocket.emit('register-name', nameInput);

    document.getElementById('loginOverlay').classList.add('opacity-0');
    setTimeout(() => {
        document.getElementById('loginOverlay').classList.add('hidden');
        updateProfileUI();
        showToast(`Welcome to the network, Agent ${zUsername}.`, "success");
    }, 500);
}

function updateProfileUI() {
    document.getElementById('userProfile').classList.remove('hidden');
    document.getElementById('notificationWidget').classList.remove('hidden');
    document.getElementById('profileName').innerHTML = `${zUsername} <span class="text-[0.6rem] ml-1">🟢</span>`;
    document.getElementById('scrapeCount').innerText = zScrapeCount;
}

function incrementScrapeCount() {
    zScrapeCount++;
    document.getElementById('scrapeCount').innerText = zScrapeCount;
    localStorage.setItem('zorg_scrape_count', zScrapeCount.toString());
}

initProfile();

// -- EXECUTION & TELEMETRY --
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
    if (autoScrollTelemetry) {
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

function clearInputs() {
    const idsToClear = ['url', 'curl', 'token', 'cadEventId', 'cadClientId', 'cadEventKey', 'dynamicShowId', 'cookie', 'file'];
    idsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.querySelectorAll('.custom-dynamic-input').forEach(el => el.value = '');
    showToast("Input fields cleared.", "success");
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
        } catch (e) { }
    }, 800);

    try {
        abortController = new AbortController();
        const response = await fetch('/run', {
            method: 'POST',
            signal: abortController.signal,
            headers: { 'Content-Type': 'application/json' },
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

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (document.getElementById('file').value || 'Scrape') + '.xlsx';
        a.click();

        loader.classList.add('hidden');
        completeText.classList.remove('hidden');
        incrementScrapeCount();
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
    if (isConfirmed) {
        await fetch('/shutdown', { method: 'POST' });
        document.body.innerHTML = '<div style="display:flex; height:100vh; align-items:center; justify-content:center; font-weight:bold; font-size:24px; color:#fff;">OFFLINE</div>';
    }
}

// -- PRESENCE & WHISPERS --
window.zorgSocket.on('request-name', () => {
    document.getElementById('loginOverlay').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('loginOverlay').classList.remove('opacity-0');
        document.getElementById('loginName').focus();
    }, 50);
});

function requestNotificationPermission() {
    if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }
}

let currentOnlineUsers = [];
let activeEnginesMap = {};
let isManualAway = false;

function toggleStatusManual() {
    isManualAway = !isManualAway;
    const newStatus = isManualAway ? 'away' : 'online';
    window.zorgSocket.emit('update-presence', newStatus);
}

document.addEventListener('visibilitychange', () => {
    if (isManualAway) return;
    if (document.visibilityState === 'hidden') {
        window.zorgSocket.emit('update-presence', 'away');
    } else if (document.visibilityState === 'visible') {
        window.zorgSocket.emit('update-presence', 'online');
    }
});

function renderOnlineUsers() {
    const listEl = document.getElementById('onlineList');
    if (!listEl) return;
    listEl.innerHTML = Object.values(currentOnlineUsers).map(u => {
        const isMe = u.id === window.zorgSocket.id;
        const initial = (u.name || "?").charAt(0).toUpperCase();

        let engStatusText = '🟢 Online';
        let engStatusColor = 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)] animate-pulse';

        if (u.status === 'away') {
            engStatusText = '🌙 Away';
            engStatusColor = 'bg-amber-500 shadow-[0_0_5px_rgba(245,158,11,0.8)]';
        }

        const engEntry = Object.values(activeEnginesMap).find(e => e.socketId === u.id);
        if (engEntry) {
            engStatusText = '🛠️ Using ' + (engEntry.engineName || engEntry.mode);
            engStatusColor = 'bg-orange-500 shadow-[0_0_5px_rgba(249,115,22,0.8)] animate-pulse';
        }

        let dotHtml = `<div class="w-2 h-2 rounded-full ${engStatusColor} shrink-0"></div>`;
        if (isMe) {
            dotHtml = `<button onclick="toggleStatusManual()" class="w-4 h-4 flex items-center justify-center rounded-full hover:scale-125 transition-transform shrink-0" title="Click to manually toggle Away/Online"><div class="w-2 h-2 rounded-full ${engStatusColor} pointer-events-none"></div></button>`;
        }

        let clickHandler = '';
        if (!isMe) {
            const safeName = (u.name || "?").replace(/'/g, "\\'");
            clickHandler = `onclick="setChatTarget('${safeName}')" class="cursor-pointer flex items-center gap-3 p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:bg-slate-700/80 transition-colors shadow-inner"`;
        } else {
            clickHandler = `class="flex items-center gap-3 p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:bg-slate-700/80 transition-colors shadow-inner border-blue-500/30 bg-blue-900/10"`;
        }

        return `
            <div id="user-card-${u.id}" ${clickHandler}>
                <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center border border-blue-500/30 shrink-0 shadow-lg shadow-black/20">
                    <span class="text-xs font-black text-blue-400">${initial}</span>
                </div>
                <div class="flex-1 overflow-hidden pointer-events-none">
                    <div class="text-[11px] font-bold truncate ${isMe ? 'text-blue-400' : 'text-slate-200'}">${u.name} ${isMe ? '<span class="text-[9px] text-slate-500 font-mono ml-1">(You)</span>' : ''}</div>
                    <div class="text-[9px] font-mono text-slate-400 font-bold truncate">${engStatusText}</div>
                </div>
                ${dotHtml}
            </div>
        `;
    }).join('');
}

let activeChatTargetName = null;

window.setChatTarget = function (targetName) {
    activeChatTargetName = targetName;
    document.getElementById('chatTargetName').innerText = targetName;

    const chatBox = document.getElementById('chatBox');
    chatBox.classList.replace('hidden', 'flex');
    document.getElementById('chatMessages').innerHTML = '<div class="text-center text-[10px] text-slate-500 mt-4 font-mono animate-pulse">Decrypting history...</div>';

    // Ask server for past messages
    window.zorgSocket.emit('request-chat-history', targetName);

    setTimeout(() => {
        document.getElementById('chatInput').focus();
    }, 50);
};

function closeChat() {
    activeChatTargetName = null;
    document.getElementById('chatBox').classList.replace('flex', 'hidden');
}

function sendChatMessage() {
    if (!activeChatTargetName) return;
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;

    window.zorgSocket.emit('send-private-msg', { targetName: activeChatTargetName, message: msg });
    input.value = '';
}

function renderMessageBubble(msgObj) {
    const isMe = msgObj.from === zUsername;
    const time = new Date(msgObj.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const alignment = isMe ? 'self-end' : 'self-start';
    const bgColor = isMe ? 'bg-blue-600/90 text-white' : 'bg-slate-800 border border-slate-700 text-slate-200';
    const borderRadius = isMe ? 'rounded-2xl rounded-tr-sm' : 'rounded-2xl rounded-tl-sm';
    const nameColor = isMe ? 'text-blue-300' : 'text-purple-400';

    return `
        <div class="flex flex-col max-w-[85%] ${alignment} fade-in-up">
            <div class="flex items-baseline gap-2 mb-1 ${isMe ? 'justify-end' : 'justify-start'} px-1">
                <span class="text-[9px] font-black uppercase tracking-widest ${nameColor}">${msgObj.from}</span>
                <span class="text-[8px] font-mono text-slate-500">${time}</span>
            </div>
            <div class="px-3 py-2 text-[11px] font-medium shadow-md ${bgColor} ${borderRadius} break-words leading-relaxed">
                ${msgObj.text}
            </div>
        </div>
    `;
}

window.zorgSocket.on('chat-history', (data) => {
    if (data.targetName !== activeChatTargetName) return;
    const container = document.getElementById('chatMessages');
    if (data.history.length === 0) {
        container.innerHTML = '<div class="text-center text-[10px] text-slate-500 mt-4 font-mono italic">No recorded transmissions.</div>';
    } else {
        container.innerHTML = data.history.map(renderMessageBubble).join('');
        container.scrollTop = container.scrollHeight;
    }
});

window.zorgSocket.on('receive-private-msg', (msgObj) => {
    // Render bubble if chat is open with this person
    if (activeChatTargetName && (msgObj.from === activeChatTargetName || (msgObj.from === zUsername && msgObj.to === activeChatTargetName))) {
        const container = document.getElementById('chatMessages');
        if (container.innerHTML.includes('No recorded transmissions')) container.innerHTML = '';

        container.insertAdjacentHTML('beforeend', renderMessageBubble(msgObj));
        container.scrollTop = container.scrollHeight;
    }

    // Trigger notification ONLY if received from someone else
    if (msgObj.from !== zUsername) {
        try {
            const AudioContextConfig = window.AudioContext || window.webkitAudioContext;
            if (AudioContextConfig) {
                const ctx = new AudioContextConfig();
                const osc = ctx.createOscillator();
                const gainNode = ctx.createGain();
                osc.connect(gainNode); gainNode.connect(ctx.destination);
                osc.type = 'sine'; osc.frequency.setValueAtTime(800, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
                osc.start(); osc.stop(ctx.currentTime + 0.5);
            }
        } catch (e) { }

        const safeName = msgObj.from.replace(/'/g, "\\'");
        const toastHtml = `<span class="text-slate-400 text-[10px] block mb-1">Transmission from ${msgObj.from}: <i class="text-slate-500 lowercase">(Click to view)</i></span> <span class="text-white">${msgObj.text}</span>`;

        if (activeChatTargetName !== msgObj.from) {
            showToast(toastHtml, 'whisper', `setChatTarget('${safeName}')`);

            addNotification(`Message: ${msgObj.from}`, msgObj.text, false);

        }

        if (document.visibilityState === 'hidden' && "Notification" in window && Notification.permission === "granted") {
            const notification = new Notification("ZORG-Ω Message", {
                body: `${msgObj.from}: ${msgObj.text}`, icon: '/Icons/favicon.ico'
            });
            notification.onclick = function () { window.focus(); setChatTarget(safeName); this.close(); };
        }
    }
});

function syncEngineUI() {
    const loader = document.getElementById('loader');
    if (loader && !loader.classList.contains('hidden')) return;

    const m = document.getElementById('mode').value;
    const btn = document.getElementById('btn');
    if (activeEnginesMap[m] && activeEnginesMap[m].socketId !== window.zorgSocket.id) {
        btn.disabled = true;
        btn.innerText = `ENGINE IN USE BY ${activeEnginesMap[m].startedBy.toUpperCase()}`;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.classList.remove('hover:bg-blue-500', 'active:scale-95');
    } else {
        btn.disabled = false;
        btn.innerText = 'EXECUTE ARCHITECT';
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        btn.classList.add('hover:bg-blue-500', 'active:scale-95');
    }
}

window.zorgSocket.on('engine-registry-update', (engines) => {
    activeEnginesMap = engines;
    renderOnlineUsers();
    syncEngineUI();
});

window.zorgSocket.on('online-users', (users) => {
    currentOnlineUsers = users;
    const me = users.find(u => u.id === window.zorgSocket.id);
    if (me && me.name) {
        zUsername = me.name;
        updateProfileUI();
    }
    renderOnlineUsers();
});

// -- SYSTEM ADMIN LOGS --
let isUserAdmin = false;

function createUpdateHtml(u, idx) {
    const date = new Date(u.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let color = "text-purple-400";
    let bg = "bg-purple-900/10";
    let border = "border-purple-500/20";
    if (u.category === 'Alert') { color = "text-red-400"; bg = "bg-red-900/10"; border = "border-red-500/20"; }
    if (u.category === 'Fix') { color = "text-emerald-400"; bg = "bg-emerald-900/10"; border = "border-emerald-500/20"; }

    const deleteBtn = isUserAdmin ? `
        <button onclick="deleteSystemLog(${u.id})" class="absolute top-1.5 right-1.5 text-slate-500 hover:text-red-400 transition-colors p-1" title="Delete Log">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>` : '';

    return `
        <div class="p-3 rounded-xl border ${border} ${bg} shadow-inner fade-in-up relative pr-7" id="log-${u.id}">
            ${deleteBtn}
            <div class="flex justify-between items-center mb-1">
                <span class="text-[9px] font-black uppercase tracking-widest ${color}">${u.category}</span>
                <span class="text-[8px] font-mono text-slate-500 mr-2">${date}</span>
            </div>
            <p class="text-[11px] text-slate-300 font-medium leading-tight">${u.text}</p>
            <div class="text-[8px] text-slate-500 font-bold uppercase tracking-widest mt-1.5 text-right">- ${u.author}</div>
        </div>
    `;
}

window.zorgSocket.on('new-system-update', (log) => {
    const listEl = document.getElementById('updatesList');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = createUpdateHtml(log, log.id);
    listEl.prepend(wrapper.firstElementChild);
    showToast(`[${log.category.toUpperCase()}] System Update Broadcasted`, log.category === 'Alert' ? 'error' : 'success');
});

window.zorgSocket.on('clear-logs', () => {
    document.getElementById('updatesList').innerHTML = '';
});

window.zorgSocket.on('delete-log', (id) => {
    const logEl = document.getElementById('log-' + id);
    if (logEl) logEl.remove();
});

function toggleAdminPanel() {
    const inputs = document.getElementById('adminUpdateInputs');
    if (inputs.classList.contains('max-w-0')) {
        inputs.classList.remove('max-w-0', 'opacity-0');
        inputs.classList.add('max-w-[500px]', 'opacity-100');
        setTimeout(() => document.getElementById('adminUpdateText').focus(), 300);
    } else {
        inputs.classList.add('max-w-0', 'opacity-0');
        inputs.classList.remove('max-w-[500px]', 'opacity-100');
    }
}

async function broadcastUpdate() {
    const text = document.getElementById('adminUpdateText').value.trim();
    const category = document.getElementById('adminUpdateCategory').value;
    if (!text) return;

    try {
        const res = await fetch('/admin/add-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, category })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        document.getElementById('adminUpdateText').value = '';
        toggleAdminPanel();
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function clearSystemLogs() {
    const isConfirmed = await customConfirm("Are you sure you want to clear ALL system updates? This action cannot be undone.", "Clear All Logs");
    if (!isConfirmed) return;

    try {
        const res = await fetch('/admin/clear-logs', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast("All system logs wiped.", "success");
    } catch (e) {
        showToast(e.message, "error");
    }
}

async function deleteSystemLog(logId) {
    const isConfirmed = await customConfirm("Are you sure you want to delete this specific system update log?", "Delete System Log");
    if (!isConfirmed) return;

    try {
        const res = await fetch(`/admin/delete-log/${logId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
    } catch (e) {
        showToast(e.message, "error");
    }
}

// -- NOTIFICATIONS SYSTEM --
let unreadNotifs = 0;

function toggleNotifications() {
    const panel = document.getElementById('notificationPanel');
    panel.classList.toggle('hidden');

    if (!panel.classList.contains('hidden')) {
        // Clear the red badge when opened
        unreadNotifs = 0;
        document.getElementById('notifBadge').classList.add('hidden');
    }
}

function clearNotifications() {
    document.getElementById('notificationList').innerHTML = '<div class="text-center p-4 text-[10px] font-mono italic text-slate-600 pointer-events-none">No active alerts.</div>';
    unreadNotifs = 0;
    document.getElementById('notifBadge').classList.add('hidden');
}

function addNotification(title, message, isError = false) {
    const list = document.getElementById('notificationList');
    const badge = document.getElementById('notifBadge');

    // Remove empty state if present
    if (list.innerHTML.includes('No active alerts')) list.innerHTML = '';

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const colorClass = isError ? 'text-red-400' : 'text-blue-400';
    const borderClass = isError ? 'border-red-900/30 bg-red-900/10' : 'border-blue-900/30 bg-blue-900/10';

    const notifHtml = `
        <div class="p-3 rounded-xl border ${borderClass} shadow-inner fade-in-up">
            <div class="flex justify-between items-start mb-1">
                <span class="text-[10px] font-black uppercase tracking-widest ${colorClass}">${title}</span>
                <span class="text-[8px] font-mono text-slate-500">${time}</span>
            </div>
            <p class="text-[11px] text-slate-300 font-medium leading-tight">${message}</p>
        </div>
    `;

    list.insertAdjacentHTML('afterbegin', notifHtml);

    // Ping the red badge
    unreadNotifs++;
    badge.classList.remove('hidden');
}

// Reveal the widget once logged in
window.zorgSocket.on('init-data', (data) => {
    // (Existing init logic...)
    document.getElementById('notificationWidget').classList.remove('hidden');
});

// Close panel if clicked outside
document.addEventListener('click', function (event) {
    const widget = document.getElementById('notificationWidget');
    const panel = document.getElementById('notificationPanel');
    if (widget && !widget.contains(event.target) && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
    }
});

// -- BULLETIN BOARD SYSTEM --

// -- BULLETIN BOARD SYSTEM --
let selectedBulletinFile = null;

function toggleBulletinInput() {
    const container = document.getElementById('bulletinInputContainer');
    container.classList.toggle('hidden');
    container.classList.toggle('flex');
    if (!container.classList.contains('hidden')) {
        document.getElementById('bulletinTextInput').focus();
    }
}

function handleBulletinFileSelect(input) {
    if (input.files && input.files[0]) {
        selectedBulletinFile = input.files[0];
        document.getElementById('bulletinFileName').innerText = selectedBulletinFile.name;
        document.getElementById('bulletinFilePreview').classList.remove('hidden');
        document.getElementById('bulletinFilePreview').classList.add('flex');
    }
}

function removeBulletinFile() {
    selectedBulletinFile = null;
    document.getElementById('bulletinFileInput').value = '';
    document.getElementById('bulletinFilePreview').classList.add('hidden');
    document.getElementById('bulletinFilePreview').classList.remove('flex');
}

async function submitBulletin() {
    const textInput = document.getElementById('bulletinTextInput');
    const text = textInput.value.trim();
    const btn = document.getElementById('bulletinSubmitBtn');

    if (!text && !selectedBulletinFile) return;

    btn.disabled = true;
    btn.innerText = "UPLOADING...";
    btn.classList.add('opacity-50');

    let fileUrl = null;
    let fileName = null;

    try {
        if (selectedBulletinFile) {
            const formData = new FormData();
            formData.append('file', selectedBulletinFile);

            const response = await fetch('/upload-bulletin-file', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error("File upload failed.");
            const data = await response.json();
            fileUrl = data.url;
            fileName = data.originalName;
        }

        // Package everything together and send to server
        window.zorgSocket.emit('add-bulletin', { text: text, fileUrl: fileUrl, fileName: fileName });

        // Clean up UI
        textInput.value = '';
        removeBulletinFile();
        toggleBulletinInput();

    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = "Push to Board";
        btn.classList.remove('opacity-50');
    }
}

function deleteBulletin(id) {
    window.zorgSocket.emit('delete-bulletin', id);
}

function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function (url) {
        return `<a href="${url}" target="_blank" class="text-blue-400 underline hover:text-blue-300 pointer-events-auto break-all">${url}</a>`;
    });
}

function createBulletinHtml(pin) {
    const date = new Date(pin.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = new Date(pin.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const canDelete = isUserAdmin || pin.author === zUsername;
    const deleteBtn = canDelete ? `
        <button onclick="deleteBulletin(${pin.id})" class="absolute top-2 right-2 text-slate-500 hover:text-red-400 transition-colors pointer-events-auto" title="Delete Pin">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>` : '';

    // Create the File Attachment HTML if a file exists
    let fileHtml = '';
    if (pin.fileUrl) {
        fileHtml = `
            <a href="${pin.fileUrl}" target="_blank" download="${pin.fileName}" class="mt-2 flex items-center gap-2 bg-slate-900 border border-slate-700 hover:border-amber-500/50 p-2 rounded-lg group transition-colors pointer-events-auto shadow-inner">
                <div class="bg-amber-500/20 text-amber-400 p-1.5 rounded-md group-hover:bg-amber-500 group-hover:text-white transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-[10px] font-bold text-slate-300 truncate">${pin.fileName}</p>
                    <p class="text-[8px] text-slate-500 uppercase tracking-widest">Click to Download</p>
                </div>
            </a>
        `;
    }

    // Only render the text paragraph if there's actual text
    const textHtml = pin.text ? `<p class="text-xs text-slate-200 font-medium leading-relaxed whitespace-pre-wrap mt-1">${linkify(pin.text)}</p>` : '';

    return `
        <div class="relative p-3 rounded-xl border border-amber-500/20 bg-amber-900/10 shadow-inner fade-in-up group pr-6" id="pin-${pin.id}">
            ${deleteBtn}
            <div class="flex items-baseline gap-2 mb-1.5">
                <span class="text-[9px] font-black uppercase tracking-widest text-amber-500">${pin.author}</span>
                <span class="text-[8px] font-mono text-slate-500">${date} - ${time}</span>
            </div>
            ${textHtml}
            ${fileHtml}
        </div>
    `;
}

function deleteBulletin(id) {
    window.zorgSocket.emit('delete-bulletin', id);
}

// Automatically detect URLs and make them clickable
function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function (url) {
        return `<a href="${url}" target="_blank" class="text-blue-400 underline hover:text-blue-300 pointer-events-auto break-all">${url}</a>`;
    });
}

function createBulletinHtml(pin) {
    const date = new Date(pin.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = new Date(pin.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const canDelete = isUserAdmin || pin.author === zUsername;
    const deleteBtn = canDelete ? `
        <button onclick="deleteBulletin(${pin.id})" class="absolute top-2 right-2 text-slate-500 hover:text-red-400 transition-colors pointer-events-auto" title="Delete Pin">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>` : '';

    let fileHtml = '';
    // This is the part your browser was missing!
    if (pin.fileUrl) {
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(pin.fileName);

        if (isImage) {
            fileHtml = `
                <div class="mt-2 rounded-lg overflow-hidden border border-slate-700/50 shadow-md pointer-events-auto">
                    <a href="${pin.fileUrl}" target="_blank" title="Click to view full size">
                        <img src="${pin.fileUrl}" alt="${pin.fileName}" class="w-full max-h-48 object-cover hover:opacity-80 transition-opacity">
                    </a>
                </div>
            `;
        } else {
            fileHtml = `
                <a href="${pin.fileUrl}" target="_blank" download="${pin.fileName}" class="mt-2 flex items-center gap-2 bg-slate-900 border border-slate-700 hover:border-amber-500/50 p-2 rounded-lg group transition-colors pointer-events-auto shadow-inner">
                    <div class="bg-amber-500/20 text-amber-400 p-1.5 rounded-md group-hover:bg-amber-500 group-hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[10px] font-bold text-slate-300 truncate">${pin.fileName}</p>
                        <p class="text-[8px] text-slate-500 uppercase tracking-widest">Click to Download</p>
                    </div>
                </a>
            `;
        }
    }

    const textHtml = pin.text ? `<p class="text-xs text-slate-200 font-medium leading-relaxed whitespace-pre-wrap mt-1">${linkify(pin.text)}</p>` : '';

    return `
        <div class="relative p-3 rounded-xl border border-amber-500/20 bg-amber-900/10 shadow-inner fade-in-up group pr-6" id="pin-${pin.id}">
            ${deleteBtn}
            <div class="flex items-baseline gap-2 mb-1.5">
                <span class="text-[9px] font-black uppercase tracking-widest text-amber-500">${pin.author}</span>
                <span class="text-[8px] font-mono text-slate-500">${date} - ${time}</span>
            </div>
            ${textHtml}
            ${fileHtml}
        </div>
    `;
}

// Hook into init-data to render initial pins
const existingInitData = window.zorgSocket.listeners('init-data')[0];
window.zorgSocket.off('init-data'); // Prevent duplicate listeners
window.zorgSocket.on('init-data', (data) => {
    existingInitData(data); // Run the rest of the init logic first

    if (data.bulletinPosts) {
        document.getElementById('bulletinList').innerHTML = data.bulletinPosts.map(createBulletinHtml).join('');
    }
});

// Listen for new pins
window.zorgSocket.on('new-bulletin', (pin) => {
    const list = document.getElementById('bulletinList');
    list.insertAdjacentHTML('afterbegin', createBulletinHtml(pin));

    // Notify if we didn't write it
    if (pin.author !== zUsername) {
        addNotification('New Notice Pinned', `By ${pin.author}: ${pin.text.substring(0, 30)}...`, false);
    }
});

// Listen for deleted pins
window.zorgSocket.on('remove-bulletin', (id) => {
    const pinEl = document.getElementById(`pin-${id}`);
    if (pinEl) pinEl.remove();
});