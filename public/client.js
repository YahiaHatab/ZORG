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

    // Update profile initial
    const initialEl = document.getElementById('profileInitial');
    if (initialEl && data.userName) initialEl.innerText = data.userName.charAt(0).toUpperCase();

    // 2. Admin Privileges
    isUserAdmin = data.isAdmin;
    if (data.isAdmin) {
        const adminPanel = document.getElementById('adminUpdatePanel');
        if (adminPanel) adminPanel.style.display = 'flex';
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
        renderEngineActivity();
    }
    if (data.engineCount !== undefined) {
        document.getElementById('engineCountBadge').innerText = data.engineCount;
    }
    toggle(); // re-run toggle to apply new logic

    // Render bulletin board
    if (data.bulletinPosts) {
        document.getElementById('bulletinList').innerHTML = data.bulletinPosts.map(createBulletinHtml).join('');
    }
});

// -- DROPDOWN & SEARCH --
function toggleSearch() {
    searchActive = !searchActive;
    const searchContainer = document.getElementById('searchContainer');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const searchInput = document.getElementById('engineSearchInput');

    if (searchActive) {
        searchContainer.style.display = 'block';
        dropdownMenu.style.display = 'flex';
        searchInput.focus();
    } else {
        searchContainer.style.display = 'none';
        searchInput.value = '';
        filterEngines();
    }
}

function filterEngines() {
    const term = document.getElementById('engineSearchInput').value.toLowerCase();
    const items = document.querySelectorAll('.dropdown-engine-item');

    if (term === '') {
        items.forEach(item => item.style.display = 'flex');
        // Show all category containers
        document.querySelectorAll('[id^="cat-"]').forEach(cat => cat.classList.remove('hidden'));
        document.getElementById('noResults').classList.add('hidden');
        return;
    }

    let anyVisible = false;
    items.forEach(item => {
        const name = item.getAttribute('data-engine-name') || '';
        if (name.includes(term)) {
            item.style.display = 'flex';
            anyVisible = true;
            // Expand parent category
            const parentCat = item.closest('[id^="cat-"]');
            if (parentCat) {
                parentCat.classList.remove('hidden');
                const catName = parentCat.id.replace('cat-', '');
                const icon = document.getElementById('icon-' + catName);
                if (icon) icon.classList.add('rotate-180');
            }
        } else {
            item.style.display = 'none';
        }
    });

    document.getElementById('noResults').classList.toggle('hidden', anyVisible);

    // Hide category sections that have no visible items
    document.querySelectorAll('[id^="cat-"]').forEach(catDiv => {
        const visibleItems = catDiv.querySelectorAll('.dropdown-engine-item:not([style*="none"])');
        const parent = catDiv.parentElement;
        if (parent) parent.style.display = visibleItems.length > 0 ? 'block' : 'none';
    });
}

function toggleDropdownMenu() {
    const menu = document.getElementById('dropdownMenu');
    const isHidden = menu.style.display === 'none' || menu.style.display === '';
    menu.style.display = isHidden ? 'flex' : 'none';
    if (isHidden && searchActive) setTimeout(() => document.getElementById('engineSearchInput').focus(), 50);
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
    document.getElementById('dropdownMenu').style.display = 'none';
    toggle();
}

document.addEventListener('click', function (event) {
    const dropdownBtn = document.getElementById('dropdownBtn');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const searchBtn = document.querySelector('button[title="Search Engines"]');

    if (dropdownBtn && dropdownMenu && !dropdownBtn.contains(event.target) && !dropdownMenu.contains(event.target) && (!searchBtn || !searchBtn.contains(event.target))) {
        dropdownMenu.style.display = 'none';
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

    // Helper: show/hide with display flex
    const show = (id, type = 'flex') => { const el = document.getElementById(id); if (el) el.style.display = type; };
    const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };

    // Built-in boxes
    m === 'marketplace' ? show('marketBox') : hide('marketBox');
    ['dusseldorf'].includes(m) ? show('standardBox') : hide('standardBox');
    ['algolia', 'informa'].includes(m) ? show('curlBox') : hide('curlBox');
    m === 'eshow' ? show('eshowBox') : hide('eshowBox');
    m === 'cadmium' ? show('cadBox') : hide('cadBox');

    if (m === 'algolia') document.getElementById('curl').placeholder = "Paste Algolia API cURL here...";
    if (m === 'informa') document.getElementById('curl').placeholder = "Paste Informa API cURL here...";

    // Dynamic boxes
    const customBox = document.getElementById('customInputBox');
    if (dynamicLogic[m]) {
        if (dynamicLogic[m].type === 'none') {
            customBox.innerHTML = '';
            hide('customInputBox');
        } else if (dynamicLogic[m].type === 'custom') {
            const inputs = dynamicLogic[m].inputs;
            const inputHtml = inputs.map((placeholder, idx) =>
                `<input id="customInput_${idx}" type="text" placeholder="${placeholder.replace(/"/g, '&quot;').replace(/'/g, "\\'")}" class="custom-dynamic-input inp">`
            ).join('');
            customBox.innerHTML = inputHtml;
            show('customInputBox');
        }
    } else {
        hide('customInputBox');
    }

    if (typeof syncEngineUI === 'function') syncEngineUI();
}

// -- CUSTOM DIALOGS --
function showToast(message, type = 'success', onClickAction = '') {
    return new Promise(resolve => {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');

        const configs = {
            success: { bg: 'rgba(14,24,20,0.97)', border: 'rgba(62,207,142,0.35)', icon: '#3ecf8e', label: 'SUCCESS', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>' },
            error: { bg: 'rgba(24,10,10,0.97)', border: 'rgba(248,113,113,0.35)', icon: '#f87171', label: 'ERROR', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>' },
            whisper: { bg: 'rgba(18,12,28,0.97)', border: 'rgba(185,124,243,0.35)', icon: '#b97cf3', label: 'TRANSMISSION', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>' }
        };

        const c = configs[type] || configs.success;

        toast.style.cssText = `
            pointer-events: ${onClickAction ? 'auto' : 'none'};
            display: flex; align-items: flex-start; gap: 12px;
            padding: 12px 14px; border-radius: 12px;
            border: 1px solid ${c.border}; background: ${c.bg};
            backdrop-filter: blur(20px); width: 296px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            transform: translateX(20px); opacity: 0;
            transition: all 0.25s cubic-bezier(0.34, 1.4, 0.64, 1);
            ${onClickAction ? 'cursor:pointer;' : ''}
        `;
        if (onClickAction) toast.setAttribute('onclick', onClickAction);

        toast.innerHTML = `
            <div style="flex-shrink:0;margin-top:2px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="${c.icon}" stroke-width="2">${c.svg}</svg>
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${c.icon};margin-bottom:3px;">${c.label}</div>
                <div style="font-size:12px;font-weight:500;line-height:1.5;color:#e8eaf0;">${message}</div>
            </div>
        `;

        container.appendChild(toast);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.transform = 'translateX(0)';
                toast.style.opacity = '1';
            });
        });
        setTimeout(() => {
            toast.style.transform = 'translateX(20px)';
            toast.style.opacity = '0';
            setTimeout(() => { toast.remove(); resolve(); }, 300);
        }, 4000);
    });
}

function customConfirm(message, title = "Confirm Action") {
    return new Promise(resolve => {
        const modal = document.getElementById('customDialogModal');
        const titleEl = document.getElementById('dialogTitle');
        titleEl.innerText = title;
        titleEl.style.color = '#f5a623';
        document.getElementById('dialogMessage').innerText = message;
        document.getElementById('dialogInput').style.display = 'none';

        const cancelBtn = document.getElementById('dialogCancelBtn');
        cancelBtn.style.display = 'inline-flex';

        const confirmBtn = document.getElementById('dialogConfirmBtn');
        confirmBtn.style.background = '#ef4444';
        confirmBtn.innerText = "Proceed";

        const handleConfirm = () => { cleanup(); resolve(true); };
        const handleCancel = () => { cleanup(); resolve(false); };
        const cleanup = () => {
            modal.classList.remove('open');
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        modal.classList.add('open');
    });
}

function customPrompt(message, title = "Authentication Required") {
    return new Promise(resolve => {
        const modal = document.getElementById('customDialogModal');
        const titleEl = document.getElementById('dialogTitle');
        titleEl.innerText = title;
        titleEl.style.color = '#b97cf3';
        document.getElementById('dialogMessage').innerText = message;

        const input = document.getElementById('dialogInput');
        input.value = '';
        input.style.display = 'block';

        const cancelBtn = document.getElementById('dialogCancelBtn');
        cancelBtn.style.display = 'inline-flex';

        const confirmBtn = document.getElementById('dialogConfirmBtn');
        confirmBtn.style.background = '#b97cf3';
        confirmBtn.innerText = "Submit";

        const handleConfirm = () => { cleanup(); resolve(input.value); };
        const handleCancel = () => { cleanup(); resolve(null); };
        const handleEnter = (e) => { if (e.key === 'Enter') handleConfirm(); };
        const cleanup = () => {
            modal.classList.remove('open');
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            input.removeEventListener('keypress', handleEnter);
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        input.addEventListener('keypress', handleEnter);
        modal.classList.add('open');
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
    document.getElementById('uploadModal').classList.add('open');
}

function closeUploadModal() {
    document.getElementById('uploadModal').classList.remove('open');
}

function showSuccessModal(count) {
    const formattedCount = parseInt(count || 0).toLocaleString();
    document.getElementById('successModalDesc').innerText = formattedCount + ' Distinct Records Assembled. Exporting...';
    document.getElementById('successModal').classList.add('open');
}

function closeSuccessModal() {
    document.getElementById('successModal').classList.remove('open');
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

        document.getElementById('uploadModal').classList.add('open');
        document.getElementById('dropdownMenu').style.display = 'none';
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

    const overlay = document.getElementById('loginOverlay');
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.classList.remove('open');
        updateProfileUI();
        showToast(`Welcome to the network, ${zUsername}.`, "success");
    }, 400);
}

function updateProfileUI() {
    const profileEl = document.getElementById('userProfile');
    if (profileEl) profileEl.style.display = 'flex';
    const profileName = document.getElementById('welcome-user');
    if (profileName) profileName.innerText = zUsername;
    const profileInitial = document.getElementById('profileInitial');
    if (profileInitial && zUsername) profileInitial.innerText = zUsername.charAt(0).toUpperCase();
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
    document.getElementById('telemetry').innerHTML += '<br><span style="color:#f87171;">> [ERROR] OPERATION ABORTED BY USER (Client Side Halt)</span>';
    document.getElementById('loader').style.display = 'none';
    document.getElementById('errorText').style.display = 'block';
    document.getElementById('btn').disabled = false;

    const stopBtn = document.getElementById('stopBtn');
    stopBtn.style.pointerEvents = 'none';
    stopBtn.style.opacity = '0.4';
    stopBtn.style.borderColor = 'var(--border)';
    stopBtn.style.background = 'var(--bg-raised)';
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
    // Enable stop button
    stopBtn.style.pointerEvents = 'auto';
    stopBtn.style.opacity = '1';
    stopBtn.style.borderColor = 'rgba(248,113,113,0.4)';
    stopBtn.style.background = 'rgba(248,113,113,0.08)';

    counterArea.style.display = 'flex';
    loader.style.display = 'flex';
    completeText.style.display = 'none';
    errorText.style.display = 'none';

    telemetryBox.style.display = 'block';
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

        const count = response.headers.get('X-Record-Count');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (document.getElementById('file').value || 'Scrape') + '.xlsx';
        a.click();

        loader.style.display = 'none';
        completeText.style.display = 'block';
        if (count) showToast(`${parseInt(count).toLocaleString()} records extracted.`, 'success');
        incrementScrapeCount();
    } catch (err) {
        if (err.name === 'AbortError') return;
        loader.style.display = 'none';
        errorText.style.display = 'block';
        telemetry.innerHTML += '<br><span style="color:#f87171;">> [ERROR] ' + err.message + '</span>';
        telemetry.scrollTop = telemetry.scrollHeight;
    } finally {
        btn.disabled = false;
        stopBtn.style.pointerEvents = 'none';
        stopBtn.style.opacity = '0.4';
        stopBtn.style.borderColor = 'var(--border)';
        stopBtn.style.background = 'var(--bg-raised)';
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
    const overlay = document.getElementById('loginOverlay');
    overlay.style.opacity = '0';
    overlay.classList.add('open');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            setTimeout(() => document.getElementById('loginName').focus(), 100);
        });
    });
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

        let statusText = 'Online';
        let statusClass = 'status-online';

        if (u.status === 'away') {
            statusText = 'Away';
            statusClass = 'status-away';
        }

        const engEntry = Object.values(activeEnginesMap).find(e => e.socketId === u.id);
        if (engEntry) {
            statusText = (engEntry.engineName || engEntry.mode);
            statusClass = 'status-busy';
        }

        let dotHtml = `<div class="status-dot ${statusClass}"></div>`;
        if (isMe) {
            dotHtml = `<button onclick="toggleStatusManual()" style="background:none;border:none;cursor:pointer;display:flex;padding:0;" title="Toggle Away/Online"><div class="status-dot ${statusClass}" style="pointer-events:none;"></div></button>`;
        }

        const safeName = (u.name || "?").replace(/'/g, "\\'");
        const clickAttr = !isMe ? `onclick="setChatTarget('${safeName}')"` : '';
        const cardClass = isMe ? 'user-card is-me' : 'user-card';

        return `
            <div class="${cardClass}" ${clickAttr} id="user-card-${u.id}">
                <div class="user-avatar">${initial}</div>
                <div style="flex:1;overflow:hidden;pointer-events:none;">
                    <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isMe ? '#6382ff' : '#e8eaf0'};">
                        ${u.name} ${isMe ? '<span style="font-family:\'Space Mono\',monospace;font-size:8px;color:#3d4260;"> (You)</span>' : ''}
                    </div>
                    <div style="font-family:\'Space Mono\',monospace;font-size:9px;color:#7c82a0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">${statusText}</div>
                </div>
                ${dotHtml}
            </div>
        `;
    }).join('');
    renderEngineActivity();
}

function renderEngineActivity() {
    const listEl = document.getElementById('engineActivityList');
    if (!listEl) return;
    const engines = Object.values(activeEnginesMap);
    if (engines.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:12px;color:#3d4260;font-family:\'Space Mono\',monospace;font-size:10px;">All engines idle.</div>';
        return;
    }
    listEl.innerHTML = engines.map(e => {
        const elapsed = Math.floor((Date.now() - e.startTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        return `
            <div class="engine-active-item">
                <div style="width:6px;height:6px;border-radius:50%;background:#f97316;box-shadow:0 0 6px rgba(249,115,22,0.7);flex-shrink:0;margin-top:3px;animation:pulse-glow 1.5s infinite;"></div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:11px;font-weight:600;color:#f97316;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.engineName || e.mode}</div>
                    <div style="font-family:'Space Mono',monospace;font-size:9px;color:#7c82a0;margin-top:2px;">${e.startedBy} · ${mins}m ${secs}s</div>
                </div>
            </div>
        `;
    }).join('');
}

let activeChatTargetName = null;

window.setChatTarget = function (targetName) {
    activeChatTargetName = targetName;
    document.getElementById('chatTargetName').innerText = targetName;

    const chatBox = document.getElementById('chatBox');
    chatBox.style.display = 'flex';
    document.getElementById('chatMessages').innerHTML = '<div style="text-align:center;padding:20px;font-family:\'Space Mono\',monospace;font-size:10px;color:#3d4260;">Decrypting history...</div>';

    window.zorgSocket.emit('request-chat-history', targetName);
    setTimeout(() => document.getElementById('chatInput').focus(), 50);
};

function closeChat() {
    activeChatTargetName = null;
    document.getElementById('chatBox').style.display = 'none';
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

    return `
        <div style="display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};" class="fade-up">
            <div class="bubble-meta ${isMe ? 'bubble-me-meta' : ''}" style="margin-bottom:3px;">
                <span style="color:${isMe ? '#6382ff' : '#b97cf3'};margin-right:4px;">${msgObj.from}</span>
                <span>${time}</span>
            </div>
            <div class="${isMe ? 'bubble-me' : 'bubble-them'}">${msgObj.text}</div>
        </div>
    `;
}

window.zorgSocket.on('chat-history', (data) => {
    if (data.targetName !== activeChatTargetName) return;
    const container = document.getElementById('chatMessages');
    if (data.history.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;font-family:\'Space Mono\',monospace;font-size:10px;color:#3d4260;font-style:italic;">No recorded transmissions.</div>';
    } else {
        container.innerHTML = data.history.map(renderMessageBubble).join('');
        container.scrollTop = container.scrollHeight;
    }
});

window.zorgSocket.on('receive-private-msg', (msgObj) => {
    if (activeChatTargetName && (msgObj.from === activeChatTargetName || (msgObj.from === zUsername && msgObj.to === activeChatTargetName))) {
        const container = document.getElementById('chatMessages');
        if (container.innerHTML.includes('No recorded transmissions')) container.innerHTML = '';
        container.insertAdjacentHTML('beforeend', renderMessageBubble(msgObj));
        container.scrollTop = container.scrollHeight;
    }

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

        if (activeChatTargetName !== msgObj.from) {
            showToast(`<span style="color:#7c82a0;font-size:10px;font-family:'Space Mono',monospace;display:block;margin-bottom:3px;">From ${msgObj.from} · click to open</span>${msgObj.text}`, 'whisper', `setChatTarget('${safeName}')`);
            addNotification(`Message: ${msgObj.from}`, msgObj.text, false);
        }

        if (document.visibilityState === 'hidden' && "Notification" in window && Notification.permission === "granted") {
            const notification = new Notification("ZORG-Ω", {
                body: `${msgObj.from}: ${msgObj.text}`, icon: '/Icons/favicon.ico'
            });
            notification.onclick = function () { window.focus(); setChatTarget(safeName); this.close(); };
        }
    }
});

function syncEngineUI() {
    const loader = document.getElementById('loader');
    if (loader && loader.style.display === 'flex') return;

    const m = document.getElementById('mode').value;
    const btn = document.getElementById('btn');
    if (activeEnginesMap[m] && activeEnginesMap[m].socketId !== window.zorgSocket.id) {
        btn.disabled = true;
        btn.innerText = `IN USE BY ${activeEnginesMap[m].startedBy.toUpperCase()}`;
        btn.style.background = 'rgba(99,130,255,0.2)';
        btn.style.cursor = 'not-allowed';
    } else {
        btn.disabled = false;
        btn.innerText = 'Execute Architect';
        btn.style.background = '';
        btn.style.cursor = '';
    }
}

window.zorgSocket.on('engine-registry-update', (engines) => {
    activeEnginesMap = engines;
    renderOnlineUsers();
    renderEngineActivity();
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

    const configs = {
        'Alert': { color: '#f87171', bg: 'rgba(248,113,113,0.05)', border: 'rgba(248,113,113,0.2)' },
        'Fix': { color: '#3ecf8e', bg: 'rgba(62,207,142,0.05)', border: 'rgba(62,207,142,0.2)' },
        'Update': { color: '#b97cf3', bg: 'rgba(185,124,243,0.05)', border: 'rgba(185,124,243,0.2)' }
    };
    const c = configs[u.category] || configs['Update'];

    const deleteBtn = isUserAdmin ? `
        <button onclick="deleteSystemLog(${u.id})" class="log-delete" title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>` : '';

    return `
        <div class="sys-log-item fade-up" id="log-${u.id}" style="background:${c.bg};border-color:${c.border};padding-right:28px;">
            ${deleteBtn}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${c.color};">${u.category}</span>
                <span style="font-family:'Space Mono',monospace;font-size:8px;color:#3d4260;">${date}</span>
            </div>
            <p style="font-size:11px;color:#b0b8d0;line-height:1.5;">${u.text}</p>
            <div style="font-family:'Space Mono',monospace;font-size:8px;color:#3d4260;text-align:right;margin-top:4px;text-transform:uppercase;letter-spacing:0.1em;">— ${u.author}</div>
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
    if (inputs.classList.contains('collapsed-width')) {
        inputs.classList.remove('collapsed-width');
        inputs.classList.add('expanded-width');
        setTimeout(() => document.getElementById('adminUpdateText').focus(), 300);
    } else {
        inputs.classList.remove('expanded-width');
        inputs.classList.add('collapsed-width');
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

// --- ADMIN: FORCE GLOBAL SYNC ---
async function triggerGlobalRefresh() {
    const isConfirmed = await customConfirm("WARNING: This will force a page reload for ALL connected Agents, clearing any of their unsaved inputs. Proceed with global sync?", "Global Synchronization");
    if (isConfirmed) {
        window.zorgSocket.emit('admin-force-refresh');
        toggleAdminPanel(); // Close the panel
    }
}

window.zorgSocket.on('execute-global-refresh', (timestamp) => {
    showToast("Admin initiated global sync. Reloading...", "whisper");
    setTimeout(() => {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('v', timestamp);
        window.location.href = currentUrl.toString();
    }, 1500);
});

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
    const isOpen = panel.style.opacity === '1';

    if (isOpen) {
        panel.style.opacity = '0';
        panel.style.transform = 'scale(0.95)';
        panel.style.pointerEvents = 'none';
    } else {
        panel.style.opacity = '1';
        panel.style.transform = 'scale(1)';
        panel.style.pointerEvents = 'auto';
        unreadNotifs = 0;
        document.getElementById('notifBadge').classList.add('hidden');
    }
}

function clearNotifications() {
    document.getElementById('notificationList').innerHTML = '<div style="text-align:center;padding:20px;color:#3d4260;font-family:\'Space Mono\',monospace;font-size:10px;">No active alerts.</div>';
    unreadNotifs = 0;
    document.getElementById('notifBadge').classList.add('hidden');
}

function addNotification(title, message, isError = false) {
    const list = document.getElementById('notificationList');
    const badge = document.getElementById('notifBadge');

    if (list.innerHTML.includes('No active alerts')) list.innerHTML = '';

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const color = isError ? '#f87171' : '#6382ff';
    const border = isError ? 'rgba(248,113,113,0.2)' : 'rgba(99,130,255,0.2)';
    const bg = isError ? 'rgba(248,113,113,0.04)' : 'rgba(99,130,255,0.04)';

    const notifHtml = `
        <div class="notif-item fade-up" style="background:${bg};border-color:${border};">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px;">
                <span style="font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${color};">${title}</span>
                <span style="font-family:'Space Mono',monospace;font-size:8px;color:#3d4260;">${time}</span>
            </div>
            <p style="font-size:11px;color:#b0b8d0;line-height:1.5;">${message}</p>
        </div>
    `;

    list.insertAdjacentHTML('afterbegin', notifHtml);

    unreadNotifs++;
    badge.classList.remove('hidden');
}


// Close notification panel if clicked outside
document.addEventListener('click', function (event) {
    const widget = document.getElementById('notificationWidget');
    const panel = document.getElementById('notificationPanel');
    if (widget && !widget.contains(event.target) && panel && panel.style.opacity === '1') {
        panel.style.opacity = '0';
        panel.style.transform = 'scale(0.95)';
        panel.style.pointerEvents = 'none';
    }
});

// -- BULLETIN BOARD SYSTEM --
let selectedBulletinFile = null;

function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function (url) {
        return `<a href="${url}" target="_blank" style="color:#6382ff;text-decoration:underline;word-break:break-all;" onmouseover="this.style.color='#7b97ff'" onmouseout="this.style.color='#6382ff'">${url}</a>`;
    });
}

function toggleBulletinInput() {
    const container = document.getElementById('bulletinInputContainer');
    const isHidden = container.style.display === 'none' || container.style.display === '';
    container.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) document.getElementById('bulletinTextInput').focus();
}

function handleBulletinFileSelect(input) {
    if (input.files && input.files[0]) {
        selectedBulletinFile = input.files[0];
        document.getElementById('bulletinFileName').innerText = selectedBulletinFile.name;
        document.getElementById('bulletinFilePreview').style.display = 'flex';
    }
}

function removeBulletinFile() {
    selectedBulletinFile = null;
    document.getElementById('bulletinFileInput').value = '';
    document.getElementById('bulletinFilePreview').style.display = 'none';
    document.getElementById('bulletinFileName').innerText = '';
}

async function submitBulletin() {
    const textInput = document.getElementById('bulletinTextInput');
    const text = textInput.value.trim();
    const btn = document.getElementById('bulletinSubmitBtn');

    if (!text && !selectedBulletinFile) return;

    btn.disabled = true;
    btn.innerText = "UPLOADING...";
    btn.style.opacity = '0.5';

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

        window.zorgSocket.emit('add-bulletin', { text: text, fileUrl: fileUrl, fileName: fileName });

        textInput.value = '';
        removeBulletinFile();
        toggleBulletinInput();

    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = "Push to Board";
        btn.style.opacity = '1';
    }
}


function deleteBulletin(id) {
    // Client-side guard: only emit if it's your pin or you're admin
    const pinEl = document.getElementById('pin-' + id);
    const btn = pinEl ? pinEl.querySelector('.delete-btn') : null;
    const author = btn ? btn.getAttribute('data-author') : null;

    if (!isUserAdmin && author && author !== zUsername) {
        showToast("You can only delete your own pins.", "error");
        return;
    }
    window.zorgSocket.emit('delete-bulletin', id);
}

function createBulletinHtml(pin) {
    const date = new Date(pin.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = new Date(pin.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Always render the delete button — server enforces permission.
    // We store the author on the element so we can show/hide it purely via CSS
    // once zUsername is known (re-render is not needed).
    const deleteBtn = `
        <button onclick="deleteBulletin(${pin.id})" class="delete-btn" data-author="${pin.author}" title="Delete Pin">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>`;

    let fileHtml = '';
    if (pin.fileUrl) {
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(pin.fileName);
        if (isImage) {
            fileHtml = `
                <div style="margin-top:8px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
                    <a href="${pin.fileUrl}" target="_blank">
                        <img src="${pin.fileUrl}" alt="${pin.fileName}" style="width:100%;max-height:160px;object-fit:cover;display:block;transition:opacity 0.15s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1">
                    </a>
                </div>`;
        } else {
            fileHtml = `
                <a href="${pin.fileUrl}" target="_blank" download="${pin.fileName}" style="margin-top:8px;display:flex;align-items:center;gap:8px;background:rgba(8,9,13,0.5);border:1px solid rgba(245,166,35,0.15);border-radius:8px;padding:8px 10px;text-decoration:none;transition:border-color 0.15s;" onmouseover="this.style.borderColor='rgba(245,166,35,0.4)'" onmouseout="this.style.borderColor='rgba(245,166,35,0.15)'">
                    <div style="background:rgba(245,166,35,0.15);border-radius:6px;padding:6px;color:#f5a623;flex-shrink:0;transition:background 0.15s;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    </div>
                    <div style="min-width:0;">
                        <div style="font-size:10px;font-weight:600;color:#e8eaf0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pin.fileName}</div>
                        <div style="font-family:'Space Mono',monospace;font-size:8px;color:#7c82a0;text-transform:uppercase;letter-spacing:0.1em;margin-top:1px;">Click to Download</div>
                    </div>
                </a>`;
        }
    }

    const textHtml = pin.text ? `<p style="font-size:12px;color:#b0b8d0;line-height:1.6;margin-top:4px;white-space:pre-wrap;word-break:break-word;">${linkify(pin.text)}</p>` : '';

    return `
        <div class="pin-card fade-up" id="pin-${pin.id}" style="padding-right:24px;">
            ${deleteBtn}
            <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px;">
                <span style="font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#f5a623;">${pin.author}</span>
                <span style="font-family:'Space Mono',monospace;font-size:8px;color:#3d4260;">${date} · ${time}</span>
            </div>
            ${textHtml}
            ${fileHtml}
        </div>
    `;
}

// Listen for new pins
window.zorgSocket.on('new-bulletin', (pin) => {
    const list = document.getElementById('bulletinList');
    list.insertAdjacentHTML('afterbegin', createBulletinHtml(pin));

    if (pin.author !== zUsername) {
        addNotification('New Notice Pinned', `By ${pin.author}: ${(pin.text || '').substring(0, 40)}`, false);
    }
});

// Listen for deleted pins
window.zorgSocket.on('remove-bulletin', (id) => {
    const pinEl = document.getElementById(`pin-${id}`);
    if (pinEl) pinEl.remove();
});