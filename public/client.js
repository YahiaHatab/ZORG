let searchActive = false;
let dynamicInstructions = {};
let dynamicLogic = {};
let lastLogCount = 0;

// --- AVATAR COLOR SYSTEM ---
const AVATAR_PALETTE = [
    ['#6382ff', '#a78bfa'], // blue-purple
    ['#3ecf8e', '#06b6d4'], // emerald-cyan
    ['#f5a623', '#f97316'], // amber-orange
    ['#f87171', '#ec4899'], // red-pink
    ['#a78bfa', '#ec4899'], // purple-pink
    ['#06b6d4', '#6382ff'], // cyan-blue
    ['#3ecf8e', '#a78bfa'], // emerald-purple
    ['#f5a623', '#f87171'], // amber-red
];

function hashColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
    return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function getAvatarGradient(user) {
    // Use user's chosen color if set, otherwise derive from name
    if (user.avatarColor) {
        // Single color picked — make a gradient by lightening
        return `linear-gradient(135deg, ${user.avatarColor}cc, ${user.avatarColor}66)`;
    }
    const [c1, c2] = hashColor(user.name || '?');
    return `linear-gradient(135deg, ${c1}40, ${c2}30)`;
}

function getAvatarAccent(user) {
    if (user.avatarColor) return user.avatarColor;
    return hashColor(user.name || '?')[0];
}

let myAvatarColor = localStorage.getItem('zorg_avatar_color') || null;

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
        const bulletinAddBtn = document.getElementById('bulletinAddBtn');
        if (bulletinAddBtn) bulletinAddBtn.style.display = 'flex';
        updatePaletteFooterHints();
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

    // Broadcast saved avatar color and today's scrape count to server
    if (myAvatarColor) window.zorgSocket.emit('update-avatar-color', myAvatarColor);
    window.zorgSocket.emit('update-scrape-count', zScrapeCount);

    // Render bulletin board
    if (data.bulletinPosts) {
        document.getElementById('bulletinList').innerHTML = data.bulletinPosts.map(createBulletinHtml).join('');
    }
});

// =============================================
// ENGINE MENU — Command Palette + Pinned Bar
// =============================================

const PINS_KEY = 'zorg_pinned_engines';
let paletteEngines = [];      // flat array: { id, name, category, isCustom }
let paletteIndex  = -1;        // keyboard nav cursor
let paletteNavigating = false; // true = nav mode (shortcuts active), false = typing mode (shortcuts blocked)

// --- Extract flat engine list from server-rendered HTML ---
function extractEnginesFromHTML() {
    const items = document.querySelectorAll('#engineListContainer .dropdown-engine-item');
    const engines = [];
    items.forEach(el => {
        const id = el.getAttribute('onclick')?.match(/selectEngine\('([^']+)'/)?.[1];
        const catDiv = el.closest('[id^="cat-"]');
        const category = catDiv ? catDiv.id.replace('cat-', '') : 'General';
        // Display name: the text node inside the inner div, stripping the dot span
        const innerDiv = el.querySelector('div');
        const displayName = innerDiv ? innerDiv.innerText?.trim() : el.getAttribute('data-engine-name') || '';
        // isCustom: purple dot
        const dotSpan = el.querySelector('span[style*="b97cf3"]');
        const isCustom = !!dotSpan;
        // Admin action buttons
        const actionBtns = el.querySelector('.action-btns');
        const hasEdit   = !!actionBtns?.querySelector('[title="Edit"]');
        const hasDelete = !!actionBtns?.querySelector('[title="Delete"]');
        if (id && displayName) engines.push({ id, name: displayName, category, isCustom, hasEdit, hasDelete });
    });

    // Built-in fallback has been removed to respect deleted engines

    return engines;
}

// --- Pins persistence ---
function getPins() {
    try { return JSON.parse(localStorage.getItem(PINS_KEY)) || []; } catch { return []; }
}
function savePins(pins) {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
}
function isPinned(id) {
    return getPins().some(p => p.id === id);
}
function togglePin(id, name, isCustom) {
    if (!id) return;
    const pins = getPins();
    let nextPins;
    if (isPinned(id)) {
        nextPins = pins.filter(p => p.id !== id);
        showToast(`Unpinned: ${name}`, 'success');
    } else {
        if (pins.length >= 6) {
            showToast('Max 6 pins. Unpin one first.', 'error');
            return;
        }
        nextPins = [...pins, { id, name, isCustom: !!isCustom }];
        showToast(`Pinned: ${name}`, 'success');
    }
    savePins(nextPins);
    renderPinnedBar();

    // If palette is currently open, re-render to sync pin buttons and active selection.
    const palette = document.getElementById('commandPalette');
    if (palette?.classList.contains('open')) {
        const term = document.getElementById('paletteInput')?.value.toLowerCase().trim() || '';
        renderPaletteList(paletteEngines, term);
    } else {
        // refresh pin icons in open palette if button elements still exist
        document.querySelectorAll('.palette-pin-btn').forEach(btn => {
            const btnId = btn.dataset.id;
            btn.classList.toggle('pinned', isPinned(btnId));
            btn.title = isPinned(btnId) ? 'Unpin' : 'Pin';
        });
    }
}

// --- Pinned bar render ---
function renderPinnedBar() {
    const bar = document.getElementById('pinnedEnginesBar');
    if (!bar) return;
    const pins = getPins();
    const activeId = document.getElementById('mode').value;

    if (pins.length === 0) {
        bar.innerHTML = `<button class="pin-add-chip" onclick="openCommandPalette()">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            Pin engines
        </button>`;
        return;
    }

    bar.innerHTML = pins.map(p => {
        const dotColor = p.isCustom ? 'var(--purple)' : 'var(--accent)';
        const isActive = p.id === activeId;
        const safeId = JSON.stringify(p.id);
        const safeName = JSON.stringify(p.name);
        return `<div class="pin-chip${isActive ? ' active' : ''}" onclick='selectEngine(${safeId},${safeName})'>
            <div class="pin-chip-dot" style="background:${dotColor};"></div>
            <span>${p.name}</span>
            <span class="pin-chip-unpin" onclick='event.stopPropagation();togglePin(${safeId},${safeName},${p.isCustom})' title="Unpin">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </span>
        </div>`;
    }).join('') + `<button class="pin-add-chip" onclick="openCommandPalette()" title="Open engine search">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
    </button>`;
}

// --- Command Palette open/close ---
function openCommandPalette() {
    paletteEngines = extractEnginesFromHTML();
    paletteIndex = -1;
    paletteNavigating = false;
    document.getElementById('paletteInput').value = '';
    renderPaletteList(paletteEngines);
    const palette = document.getElementById('commandPalette');
    palette.classList.add('open');
    setTimeout(() => {
        const input = document.getElementById('paletteInput');
        input.focus();
        // Re-entering the input always switches back to typing mode
        input.addEventListener('focus', () => { paletteNavigating = false; }, { passive: true });
    }, 40);
    document.body.classList.add('modal-open');
    updatePaletteFooterHints();
}

function closeCommandPalette() {
    document.getElementById('commandPalette').classList.remove('open');
    document.body.classList.remove('modal-open');
    paletteIndex = -1;
}

// --- Palette filtering ---
function filterPalette() {
    const term = document.getElementById('paletteInput').value.toLowerCase().trim();
    if (!term) {
        renderPaletteList(paletteEngines);
        return;
    }
    const filtered = paletteEngines.filter(e =>
        e.name.toLowerCase().includes(term) || e.category.toLowerCase().includes(term)
    );
    paletteIndex = filtered.length > 0 ? 0 : -1;
    renderPaletteList(filtered, term);
}

function renderPaletteList(engines, highlight = '') {
    const list = document.getElementById('paletteList');
    if (!list) return;

    if (engines.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:28px;color:var(--text-muted);font-family:var(--font-mono);font-size:11px;">No engines found</div>`;
        return;
    }

    // Group by category
    const groups = {};
    engines.forEach(e => {
        if (!groups[e.category]) groups[e.category] = [];
        groups[e.category].push(e);
    });

    let flatIndex = 0;
    let html = '';
    for (const [cat, items] of Object.entries(groups)) {
        html += `<div style="padding:6px 14px 4px;font-family:var(--font-mono);font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:var(--text-muted);">${cat}</div>`;
        items.forEach(e => {
            const pinned = isPinned(e.id);
            const dotColor = e.isCustom ? 'var(--purple)' : 'var(--accent)';
            const selected = flatIndex === paletteIndex ? ' palette-selected' : '';
            let displayName = e.name;
            const safeId = JSON.stringify(e.id);
            const safeName = JSON.stringify(e.name);
            if (highlight && e.name.toLowerCase().includes(highlight)) {
                const idx = e.name.toLowerCase().indexOf(highlight);
                displayName = e.name.slice(0, idx) +
                    `<span style="color:var(--accent);background:var(--accent-soft);border-radius:2px;">${e.name.slice(idx, idx + highlight.length)}</span>` +
                    e.name.slice(idx + highlight.length);
            }
            const editBtn = e.hasEdit ? `<button onclick='event.stopPropagation();editEngine(event,${safeId})' title="Edit" style="opacity:0;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:3px;border-radius:4px;display:flex;align-items:center;transition:opacity 0.1s,color 0.1s;" class="palette-admin-btn" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text-muted)'"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>` : '';
            const delBtn = e.hasDelete ? `<button onclick='event.stopPropagation();deleteEngine(event,${safeId})' title="Delete" style="opacity:0;background:none;border:none;cursor:pointer;color:var(--text-muted);padding:3px;border-radius:4px;display:flex;align-items:center;transition:opacity 0.1s,color 0.1s;" class="palette-admin-btn" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-muted)'"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : '';
            html += `<div class="palette-item${selected}" data-palette-index="${flatIndex}"
                onclick='paletteSelectEngine(${safeId},${safeName})'
                onmouseenter="this.querySelectorAll('.palette-admin-btn').forEach(b=>b.style.opacity='1')"
                onmouseleave="this.querySelectorAll('.palette-admin-btn').forEach(b=>b.style.opacity='0')">
                <div style="width:6px;height:6px;border-radius:50%;background:${dotColor};flex-shrink:0;"></div>
                <span class="palette-item-name">${displayName}</span>
                <span class="palette-item-cat">${cat}</span>
                ${editBtn}${delBtn}
                <button class="palette-pin-btn${pinned ? ' pinned' : ''}" data-id="${e.id}"
                    title="${pinned ? 'Unpin' : 'Pin'}"
                    onclick='event.stopPropagation();togglePin(${safeId},${safeName},${e.isCustom})'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
                    </svg>
                </button>
            </div>`;
            flatIndex++;
        });
    }
    list.innerHTML = html;
    scrollPaletteSelected();
}

function paletteSelectEngine(id, name) {
    selectEngine(id, name);
    closeCommandPalette();
}

// --- Keyboard navigation ---
function handlePaletteKey(e) {
    const term = document.getElementById('paletteInput').value.toLowerCase().trim();
    const visible = term
        ? paletteEngines.filter(en => en.name.toLowerCase().includes(term) || en.category.toLowerCase().includes(term))
        : paletteEngines;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteIndex = Math.min(paletteIndex + 1, visible.length - 1);
        // Switch to nav mode: blur input so shortcuts become active
        paletteNavigating = true;
        document.getElementById('paletteInput').blur();
        renderPaletteList(visible, term);
        return;
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteIndex = Math.max(paletteIndex - 1, 0);
        // Switch to nav mode: blur input so shortcuts become active
        paletteNavigating = true;
        document.getElementById('paletteInput').blur();
        renderPaletteList(visible, term);
        return;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        const target = paletteIndex >= 0 ? visible[paletteIndex] : visible[0];
        if (target) paletteSelectEngine(target.id, target.name);
        return;
    }
    // Shortcuts only fire in nav mode (input blurred). While typing mode is active
    // (input focused / paletteNavigating = false) all letter keys flow into the search box.
    if (!paletteNavigating) return;

    if (e.key === 'p' || e.key === 'P') {
        const target = paletteIndex >= 0 ? visible[paletteIndex] : null;
        if (target) { togglePin(target.id, target.name, target.isCustom); }
        return;
    }
    if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const target = paletteIndex >= 0 ? visible[paletteIndex] : null;
        if (target?.hasEdit) editEngine(e, target.id);
        return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const target = paletteIndex >= 0 ? visible[paletteIndex] : null;
        if (target?.hasDelete) deleteEngine(e, target.id);
        return;
    }
}

function scrollPaletteSelected() {
    const sel = document.querySelector('.palette-item.palette-selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// --- Global Hotkeys & Event Routing ---
document.addEventListener('keydown', function(e) {
    
    // --- 1. CASCADING ESCAPE (Close top-most UI element) ---
    if (e.key === 'Escape') {
        // Custom Dialog (Confirm / Prompt)
        const customDialog = document.getElementById('customDialogModal');
        if (customDialog?.classList.contains('open')) {
            document.getElementById('dialogCancelBtn')?.click();
            return;
        }

        // Avatar Color Picker
        const colorPicker = document.getElementById('colorPickerPopup');
        if (colorPicker) {
            colorPicker.remove();
            return;
        }

        // Command Palette
        const palette = document.getElementById('commandPalette');
        if (palette?.classList.contains('open')) {
            closeCommandPalette();
            return;
        }

        // Upload Modal
        const uploadModal = document.getElementById('uploadModal');
        if (uploadModal?.classList.contains('open')) {
            closeUploadModal();
            return;
        }

        // Success Modal
        const successModal = document.getElementById('successModal');
        if (successModal?.classList.contains('open')) {
            closeSuccessModal();
            return;
        }

        // Notification Panel
        const notifPanel = document.getElementById('notificationPanel');
        if (notifPanel?.style.opacity === '1') {
            toggleNotifications();
            return;
        }


    }

    // --- 2. COMMAND PALETTE ROUTING ---
    const palette = document.getElementById('commandPalette');
    const isPaletteOpen = palette?.classList.contains('open');

    if (isPaletteOpen) {
        handlePaletteKey(e);
        return; 
    }

    // --- 3. QUICK OPEN PALETTE ('/') ---
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        const scraper = document.getElementById('scraperView');
        if (!scraper || scraper.classList.contains('view-hidden')) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        openCommandPalette();
        return;
    }

    // --- 4. EXECUTE SCRAPE (Ctrl+Enter or Cmd+Enter) ---
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const scraper = document.getElementById('scraperView');
        if (scraper && !scraper.classList.contains('view-hidden')) {
            const btn = document.getElementById('btn');
            if (btn && !btn.disabled) {
                e.preventDefault();
                run();
            }
        }
        return;
    }

    // --- 5. ENTER KEY SUBMISSIONS FOR SPECIFIC INPUTS ---
    if (e.key === 'Enter') {
        const activeId = document.activeElement?.id;

        if (activeId === 'loginName') {
            e.preventDefault();
            handleLogin();

        } else if (activeId === 'adminUpdateText') {
            e.preventDefault();
            broadcastUpdate();
        } else if (activeId === 'bulletinTextInput' && !e.shiftKey) {
            // Allows Shift+Enter for new line, standard Enter to submit
            e.preventDefault();
            submitBulletin();
        }
    }
});

// --- Inject admin keyboard hints into palette footer ---
function updatePaletteFooterHints() {
    const footer = document.getElementById('paletteFooter');
    if (!footer || !isUserAdmin) return;
    // Only inject once
    if (footer.querySelector('.admin-hint')) return;
    const hint = (key, label, color) => `<span class="admin-hint" style="font-family:var(--font-mono);font-size:9px;color:var(--text-muted);display:flex;align-items:center;gap:5px;"><span style="background:var(--bg-raised);border:1px solid ${color};border-radius:3px;padding:1px 5px;color:${color};">${key}</span> ${label}</span>`;
    footer.insertAdjacentHTML('beforeend',
        hint('E', 'Edit', 'rgba(99,130,255,0.6)') +
        hint('Del', 'Delete', 'rgba(248,113,113,0.6)')
    );
}

// --- Stub out old functions so server-injected HTML doesn't break ---
function toggleDropdownMenu() { openCommandPalette(); }
function toggleSearch() { openCommandPalette(); }
function filterEngines() {}
function toggleCategory() {}

// ============================================================
// PORTAL-READY: Notice Board toggle (collapsible / overlay)
// ============================================================
function toggleNoticeBoard() {
    const board   = document.getElementById('noticeBoard');
    const btn     = document.getElementById('noticeBoardToggle');
    const isPortal = window.innerWidth <= 600;

    if (!board) return;

    if (isPortal) {
        // In portal mode: toggle as floating slide-in overlay
        const isVisible = board.style.display === 'flex';
        if (isVisible) {
            // Slide out & hide
            board.style.transform = 'translateX(-110%)';
            board.style.opacity   = '0';
            setTimeout(() => { board.style.display = 'none'; }, 260);
            if (btn) btn.style.background = 'rgba(245,166,35,0.12)';
        } else {
            // Position as overlay, then slide in
            board.style.cssText = `
                display: flex !important;
                position: fixed !important;
                top: 56px !important;
                left: 0 !important;
                z-index: 150 !important;
                width: 280px !important;
                height: calc(100vh - 56px) !important;
                background: var(--bg-surface) !important;
                border-right: 1px solid rgba(245,166,35,0.25) !important;
                box-shadow: 8px 0 32px rgba(0,0,0,0.5) !important;
                flex-direction: column !important;
                gap: 16px !important;
                padding: 20px 16px !important;
                overflow-y: auto !important;
                transform: translateX(-110%);
                opacity: 0;
                transition: transform 0.26s cubic-bezier(0.34,1.1,0.64,1), opacity 0.22s ease;
            `;
            // Trigger animation on next frame
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    board.style.transform = 'translateX(0)';
                    board.style.opacity   = '1';
                });
            });
            if (btn) btn.style.background = 'rgba(245,166,35,0.28)';
        }
        sessionStorage.setItem('zorg_notice_open', isVisible ? '0' : '1');
    } else {
        // Desktop mode: collapse/expand in-place (shrink to header)
        board.classList.toggle('collapsed');
        const isCollapsed = board.classList.contains('collapsed');
        if (btn) btn.title = isCollapsed ? 'Expand Notice Board' : 'Collapse Notice Board';
        if (btn) btn.style.opacity = isCollapsed ? '0.5' : '1';
        sessionStorage.setItem('zorg_notice_open', isCollapsed ? '0' : '1');
    }
}

// Close portal overlay when clicking outside the board
document.addEventListener('click', function(e) {
    const board = document.getElementById('noticeBoard');
    const btn   = document.getElementById('noticeBoardToggle');
    if (
        window.innerWidth <= 600 &&
        board &&
        board.style.display === 'flex' &&
        board.style.position === 'fixed' &&
        !board.contains(e.target) &&
        e.target !== btn
    ) {
        board.style.transform = 'translateX(-110%)';
        board.style.opacity   = '0';
        setTimeout(() => { board.style.display = 'none'; }, 260);
        if (btn) btn.style.background = 'rgba(245,166,35,0.12)';
        sessionStorage.setItem('zorg_notice_open', '0');
    }
});


// --- Init on init-data (after server populates engineListContainer) ---
// Refresh palette engines list and re-render pins bar
const _origInitDataForMenu = (data) => {
    // Slight delay to ensure DOM is updated
    setTimeout(() => {
        paletteEngines = extractEnginesFromHTML();
        renderPinnedBar();
    }, 60);
};
window.zorgSocket.on('init-data', _origInitDataForMenu);

// Initial render
renderPinnedBar();

function selectEngine(id, name) {
    document.getElementById('mode').value = id;
    document.getElementById('dropdownBtnText').innerText = name;
    window.zorgSocket.emit('update-viewing', name);
    toggle();
    renderPinnedBar();
}



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
    closeCommandPalette();

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
        // dropdown replaced by command palette — no action needed
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function deleteEngine(e, id) {
    e.stopPropagation();
    closeCommandPalette();

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
    window.zorgSocket.emit('update-scrape-count', zScrapeCount);
}

initProfile();

// -- EXECUTION & TELEMETRY --
let logInterval;
let abortController;
let autoScrollTelemetry = true;
let runTimerInterval;
let runStartTime = 0;

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
    clearInterval(runTimerInterval);
    document.getElementById('telemetry').innerHTML += '<br><span style="color:#f87171;">> [ERROR] OPERATION ABORTED BY USER (Client Side Halt)</span>';
    document.getElementById('loader').style.display = 'none';
    document.getElementById('errorText').style.display = 'block';
    
    const btn = document.getElementById('btn');
    btn.disabled = false;
    syncEngineUI();

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
    
    // --- Start Execution Timer ---
    runStartTime = Date.now();
    btn.innerText = `RUNNING (00:00)`;
    clearInterval(runTimerInterval);
    runTimerInterval = setInterval(() => {
        const secs = Math.floor((Date.now() - runStartTime) / 1000);
        const m = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        btn.innerText = `RUNNING (${m}:${s})`;
    }, 1000);

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

   lastLogCount = 0; // Reset count at start of run
    logInterval = setInterval(async () => {
        try {
            const res = await fetch('/logs');
            const data = await res.json();
            if (data.logs.length > lastLogCount) {
                // Only take the newest entries
                const newEntries = data.logs.slice(lastLogCount);
                const htmlToAppend = newEntries.join('<br>') + '<br>';
                
                telemetry.insertAdjacentHTML('beforeend', htmlToAppend);
                lastLogCount = data.logs.length;

                if (autoScrollTelemetry) {
                    telemetry.scrollTop = telemetry.scrollHeight;
                }
            }
        } catch (e) { }
    }, 1500);

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
        clearInterval(runTimerInterval);
        btn.disabled = false;
        syncEngineUI();
        
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

// --- AVATAR COLOR PICKER ---
function openColorPicker(e) {
    e.stopPropagation();
    // Remove existing picker if open
    const existing = document.getElementById('colorPickerPopup');
    if (existing) { existing.remove(); return; }

    const popup = document.createElement('div');
    popup.id = 'colorPickerPopup';
    popup.style.cssText = `position:fixed;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px;z-index:300;box-shadow:0 20px 60px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:10px;width:200px;`;

    // Position near click
    const rect = e.currentTarget.getBoundingClientRect();
    popup.style.left = (rect.right + 8) + 'px';
    popup.style.top = rect.top + 'px';

    const label = document.createElement('div');
    label.style.cssText = `font-family:'Space Mono',monospace;font-size:9px;color:#7c82a0;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:2px;`;
    label.innerText = 'Your Color';
    popup.appendChild(label);

    // Preset swatches
    const swatchGrid = document.createElement('div');
    swatchGrid.style.cssText = `display:grid;grid-template-columns:repeat(4,1fr);gap:6px;`;
    const presets = ['#6382ff', '#3ecf8e', '#f5a623', '#f87171', '#b97cf3', '#06b6d4', '#ec4899', '#a3e635', '#fb923c', '#e879f9', '#38bdf8', '#4ade80'];
    presets.forEach(color => {
        const swatch = document.createElement('button');
        swatch.style.cssText = `width:100%;aspect-ratio:1;border-radius:7px;background:${color};border:2px solid ${myAvatarColor === color ? '#fff' : 'transparent'};cursor:pointer;transition:transform 0.15s,border-color 0.15s;`;
        swatch.onmouseover = () => swatch.style.transform = 'scale(1.15)';
        swatch.onmouseout = () => swatch.style.transform = 'scale(1)';
        swatch.onclick = () => { applyAvatarColor(color); popup.remove(); };
        swatchGrid.appendChild(swatch);
    });
    popup.appendChild(swatchGrid);

    // Custom color input
    const row = document.createElement('div');
    row.style.cssText = `display:flex;gap:6px;align-items:center;`;
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = myAvatarColor || '#6382ff';
    colorInput.style.cssText = `width:36px;height:28px;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer;padding:2px;`;
    const applyBtn = document.createElement('button');
    applyBtn.innerText = 'Custom';
    applyBtn.style.cssText = `flex:1;background:var(--bg-raised);border:1px solid var(--border);border-radius:7px;color:var(--text-secondary);font-size:11px;font-weight:600;padding:6px;cursor:pointer;transition:all 0.15s;`;
    applyBtn.onclick = () => { applyAvatarColor(colorInput.value); popup.remove(); };
    row.appendChild(colorInput);
    row.appendChild(applyBtn);
    popup.appendChild(row);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.innerText = 'Reset to default';
    resetBtn.style.cssText = `background:none;border:none;color:#3d4260;font-family:'Space Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;cursor:pointer;text-align:left;padding:0;transition:color 0.15s;`;
    resetBtn.onmouseover = () => resetBtn.style.color = '#f87171';
    resetBtn.onmouseout = () => resetBtn.style.color = '#3d4260';
    resetBtn.onclick = () => { applyAvatarColor(null); popup.remove(); };
    popup.appendChild(resetBtn);

    document.body.appendChild(popup);

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function handler() {
            popup.remove();
            document.removeEventListener('click', handler);
        });
    }, 10);
}

function applyAvatarColor(color) {
    myAvatarColor = color;
    if (color) localStorage.setItem('zorg_avatar_color', color);
    else localStorage.removeItem('zorg_avatar_color');
    window.zorgSocket.emit('update-avatar-color', color || '#000000');
    // Immediate local re-render
    const me = currentOnlineUsers.find(u => u.id === window.zorgSocket.id);
    if (me) { me.avatarColor = color; renderOnlineUsers(); }
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

    const currentIds = new Set();
    
    currentOnlineUsers.forEach(u => {
        const isMe = u.socketIds && u.socketIds.includes(window.zorgSocket.id);
        const initial = (u.name || "?").charAt(0).toUpperCase();
        const gradient = getAvatarGradient(u);
        const accent = getAvatarAccent(u);

        // Calculate status states
        let statusText = 'Online';
        let statusClass = 'status-online';
        if (u.status === 'away') { statusText = 'Away'; statusClass = 'status-away'; }
        const engEntry = Object.values(activeEnginesMap).find(e => e.socketId === u.id);
        if (engEntry) { statusText = engEntry.engineName || engEntry.mode; statusClass = 'status-busy'; }

        let viewingBadge = '';
        if (!engEntry && u.viewing && u.viewing !== 'marketplace') {
            viewingBadge = `<span style="font-family:'Space Mono',monospace;font-size:8px;color:${accent};opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;margin-top:1px;">👁 ${u.viewing}</span>`;
        }

        // The "New Inner Content" string
        const newInnerHtml = `
            ${isMe ? `<div class="user-avatar-wrap" onclick="openColorPicker(event)" title="Change your color" style="position:relative;cursor:pointer;"><div style="width:34px;height:34px;border-radius:9px;background:${gradient};border:1.5px solid ${accent}30;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:${accent};flex-shrink:0;transition:all 0.2s;">${initial}</div><div class="avatar-edit-hint">🎨</div></div>` 
                   : `<div style="width:34px;height:34px;border-radius:9px;background:${gradient};border:1.5px solid ${accent}30;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:${accent};flex-shrink:0;">${initial}</div>`}
            <div style="flex:1;overflow:hidden;pointer-events:none;min-width:0;">
                <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isMe ? accent : '#e8eaf0'};">
                    ${u.name}${isMe ? ' <span style="font-family:\'Space Mono\',monospace;font-size:8px;color:#3d4260;">(You)</span>' : ''}
                </div>
                <div style="font-family:'Space Mono',monospace;font-size:9px;color:#7c82a0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;">${statusText}</div>
                ${viewingBadge}
            </div>
            ${isMe ? `<button onclick="toggleStatusManual()" style="background:none;border:none;cursor:pointer;display:flex;padding:0;" title="Toggle Status"><div class="status-dot ${statusClass}" style="pointer-events:none;"></div></button>` : `<div class="status-dot ${statusClass}"></div>`}
        `;

        const cardId = `user-card-${u.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        currentIds.add(cardId);

        let cardEl = document.getElementById(cardId);
        if (!cardEl) {
            // Create new card only if it doesn't exist
            cardEl = document.createElement('div');
            cardEl.id = cardId;
            cardEl.className = `user-card ${isMe ? 'is-me' : ''}`;
            cardEl.style.cssText = `position:relative;${isMe ? `border-color:${accent}25;` : ''}`;
            cardEl.innerHTML = newInnerHtml;
            listEl.appendChild(cardEl);
        } else {
            // If it exists, only update innerHTML if it has actually changed
            if (cardEl.innerHTML !== newInnerHtml) {
                cardEl.innerHTML = newInnerHtml;
            }
            listEl.appendChild(cardEl); // Maintain order
        }
    });

    // Remove users who left
    Array.from(listEl.children).forEach(child => {
        if (child.id && child.id.startsWith('user-card-') && !currentIds.has(child.id)) child.remove();
    });
}

// Shared interval that only patches the elapsed timer text nodes —
// avoids full innerHTML rebuilds every tick while engines are running.
let _engineTimerInterval = null;

function renderEngineActivity() {
    const listEl = document.getElementById('engineActivityList');
    if (!listEl) return;

    // Always clear the existing timer — we'll restart it only if needed
    if (_engineTimerInterval) {
        clearInterval(_engineTimerInterval);
        _engineTimerInterval = null;
    }

    const engines = Object.values(activeEnginesMap);
    if (engines.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:12px;color:#3d4260;font-family:\'Space Mono\',monospace;font-size:10px;">All engines idle.</div>';
        return;
    }

    // Build the full HTML once per engine-registry-update
    listEl.innerHTML = engines.map(e => {
        const elapsed = Math.floor((Date.now() - e.startTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timerId = `engine-timer-${e.socketId || e.mode}`;
        return `
            <div class="engine-active-item">
                <div style="width:6px;height:6px;border-radius:50%;background:#f97316;box-shadow:0 0 6px rgba(249,115,22,0.7);flex-shrink:0;margin-top:3px;animation:pulse-glow 1.5s infinite;"></div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:11px;font-weight:600;color:#f97316;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.engineName || e.mode}</div>
                    <div style="font-family:'Space Mono',monospace;font-size:9px;color:#7c82a0;margin-top:2px;">${e.startedBy} · <span id="${timerId}">${mins}m ${secs}s</span></div>
                </div>
            </div>
        `;
    }).join('');

    // Single shared interval — only patches the <span> timer text nodes,
    // not the entire list. Cheap text node writes instead of full DOM rebuilds.
    _engineTimerInterval = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        engines.forEach(e => {
            const el = document.getElementById(`engine-timer-${e.socketId || e.mode}`);
            if (!el) return;
            const elapsed = Math.floor((Date.now() - e.startTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            el.textContent = `${mins}m ${secs}s`;
        });
    }, 1000);
}


function syncEngineUI() {
    const loader = document.getElementById('loader');
    if (loader && loader.style.display === 'flex') return;

    const m = document.getElementById('mode')?.value;
    const btn = document.getElementById('btn');
    if (!m || !btn) return;

    if (activeEnginesMap && activeEnginesMap[m] && activeEnginesMap[m].startedBy !== zUsername) {
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
    const me = users.find(u => u.socketIds && u.socketIds.includes(window.zorgSocket.id));
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

window.zorgSocket.on('scraper-complete', ({ engineName, recordCount, fileName }) => {
    // Toast notification
    showToast(
        `<span style="color:#7c82a0;font-size:10px;font-family:'Space Mono',monospace;display:block;margin-bottom:3px;">${engineName} · ${recordCount.toLocaleString()} records</span>Scrape complete — ${fileName}.xlsx ready`,
        'success'
    );

    // Bell panel notification
    addNotification(`Scrape Complete: ${engineName}`, `${recordCount.toLocaleString()} records extracted into ${fileName}.xlsx`, false);

    // Browser push notification (when tab is in background)
    if (document.visibilityState === 'hidden' && "Notification" in window && Notification.permission === "granted") {
        new Notification("ZORG-Ω · Scrape Complete", {
            body: `${engineName}: ${recordCount.toLocaleString()} records ready.`,
            icon: '/Icons/favicon.ico'
        });
    }
});

window.zorgSocket.on('execute-global-refresh', (timestamp) => {
    showToast("Admin initiated global sync. Reloading...", "whisper");
    setTimeout(() => {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('v', timestamp);
        window.location.href = currentUrl.toString();
    }, 1500);
});

window.zorgSocket.on('resource-pulse', (data) => {
    const pulseBar = document.getElementById('pulseBar');
    const pulseLoadText = document.getElementById('pulseLoadText');
    const pulseStatusText = document.getElementById('pulseStatusText');
    const activeScrapesText = document.getElementById('activeScrapesText');

    if (!pulseBar || !pulseLoadText || !pulseStatusText || !activeScrapesText) return;

    const load = data.load * 100;
    pulseBar.style.width = load + '%';
    pulseLoadText.innerText = `Load: ${load.toFixed(1)}%`;
    activeScrapesText.innerText = `Scrapes: ${data.activeScrapes}`;

    if (load > 85) {
        pulseBar.style.background = 'var(--red)';
        pulseStatusText.innerText = 'Critical';
        pulseStatusText.style.color = 'var(--red)';
    } else if (load > 50) {
        pulseBar.style.background = 'var(--amber)';
        pulseStatusText.innerText = 'Busy';
        pulseStatusText.style.color = 'var(--amber)';
    } else {
        pulseBar.style.background = 'var(--emerald)';
        pulseStatusText.innerText = 'Healthy';
        pulseStatusText.style.color = 'var(--emerald)';
    }
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

    const pinUser = currentOnlineUsers.find(u => u.name === pin.author);
    const authorColor = pinUser ? getAvatarAccent(pinUser) : '#f5a623';

    return `
        <div class="pin-card fade-up" id="pin-${pin.id}" style="padding-right:24px;">
            ${deleteBtn}
            <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px;">
                <span style="font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${authorColor};">${pin.author}</span>
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

// =============================================
// HOMEPAGE — Dashboard / Stats
// =============================================

const RECENT_KEY = 'zorg_recent_engines';

function getRecentEngines() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}

function pushRecentEngine(id, name) {
    let list = getRecentEngines().filter(e => e.id !== id);
    list.unshift({ id, name });
    if (list.length > 5) list = list.slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

function renderHomeRecentEngines() {
    const container = document.getElementById('homeRecentEngines');
    if (!container) return;
    const list = getRecentEngines();

    if (list.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-family:var(--font-mono);font-size:10px;">No recent engines — start your first scrape above.</div>`;
        return;
    }

    container.innerHTML = list.map(e => `
        <div class="engine-quick-item" onclick="quickLaunchEngine('${e.id}','${e.name.replace(/'/g,"\\'")}')">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:28px;height:28px;background:var(--accent-soft);border:1px solid rgba(99,130,255,0.2);border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="var(--accent)" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                </div>
                <span style="font-size:13px;font-weight:600;color:var(--text-primary);">${e.name}</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="var(--text-muted)" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
        </div>
    `).join('');
}

function syncHomeStats() {
    const sc = document.getElementById('homeScrapeCount');
    if (sc) sc.innerText = zScrapeCount;

    const ec = document.getElementById('homeEngineCount');
    const badge = document.getElementById('engineCountBadge');
    if (ec && badge) ec.innerText = badge.innerText || '0';

    const oc = document.getElementById('homeOnlineCount');
    if (oc) oc.innerText = currentOnlineUsers.length || '0';
}

function goToScraper(engineId, engineName) {
    const home = document.getElementById('homePage');
    const scraper = document.getElementById('scraperView');

    home.classList.add('view-hidden');
    scraper.classList.remove('view-hidden');

    // Re-trigger animation
    scraper.classList.remove('home-in');
    void scraper.offsetWidth;
    scraper.classList.add('home-in');

    if (engineId) {
        document.getElementById('mode').value = engineId;
        document.getElementById('dropdownBtnText').innerText = engineName;
        window.zorgSocket.emit('update-viewing', engineName);
        toggle();
    }
}

function goToHome() {
    const home = document.getElementById('homePage');
    const scraper = document.getElementById('scraperView');

    scraper.classList.add('view-hidden');
    home.classList.remove('view-hidden');

    home.classList.remove('home-in');
    void home.offsetWidth;
    home.classList.add('home-in');

    syncHomeStats();
    renderHomeRecentEngines();
}

function quickLaunchEngine(id, name) {
    pushRecentEngine(id, name);
    goToScraper(id, name);
}

// Wrap selectEngine to track recents (defined earlier in the file)
const _selectEngineOrig = selectEngine;
selectEngine = function(id, name) {
    pushRecentEngine(id, name);
    _selectEngineOrig(id, name);
};

// Wrap incrementScrapeCount to keep home stat in sync
const _incrementScrapeCountOrig = incrementScrapeCount;
incrementScrapeCount = function() {
    _incrementScrapeCountOrig();
    const sc = document.getElementById('homeScrapeCount');
    if (sc) sc.innerText = zScrapeCount;
};

// Keep online count stat live whenever the user list updates
window.zorgSocket.on('online-users', () => {
    const oc = document.getElementById('homeOnlineCount');
    if (oc) oc.innerText = currentOnlineUsers.length || '0';
});

// Sync stats after init-data fills in engineCount and user data
window.zorgSocket.on('init-data', () => {
    // Small delay so engineCountBadge is already updated
    setTimeout(() => {
        syncHomeStats();
        renderHomeRecentEngines();
    }, 50);
});

// Initial render on page load
syncHomeStats();
renderHomeRecentEngines();
// =============================================
// SERVER RESOURCE PULSE — Fix 8 included
// Polls /api/health every 3s, pauses when tab
// is hidden so background tabs cost nothing.
// =============================================
(function initServerPulse() {
    const POLL_INTERVAL = 3000;

    const orb         = document.getElementById('pulseOrb');
    const statusLabel = document.getElementById('pulseStatusLabel');
    const loadPct     = document.getElementById('pulseLoadPct');
    const bar         = document.getElementById('pulseBar');
    const cpuEl       = document.getElementById('pulseCpu');
    const memEl       = document.getElementById('pulseMem');
    const activeEl    = document.getElementById('pulseActive');
    const safeHint    = document.getElementById('pulseSafeHint');
    const warnHint    = document.getElementById('pulseWarnHint');

    if (!orb) return;

    function applyState(data) {
        const pct     = Math.round(data.load * 100);
        const cpuPct  = Math.round(data.loadCpu * 100);
        const memPct  = Math.round(data.loadMem * 100);
        const scrapes = data.activeScrapes || 0;

        let tier, label, barColor;
        if (data.load < 0.5) {
            tier = 'idle';     label = 'IDLE';     barColor = '#3ecf8e';
        } else if (data.load < 0.8) {
            tier = 'busy';     label = 'BUSY';     barColor = '#f5a623';
        } else {
            tier = 'critical'; label = 'OVERLOAD'; barColor = '#f87171';
        }

        orb.className            = `pulse-orb pulse-orb--${tier}`;
        statusLabel.innerText    = label;
        statusLabel.style.color  = barColor;
        loadPct.innerText        = pct + '%';
        loadPct.style.color      = barColor;
        cpuEl.innerText          = cpuPct + '%';
        memEl.innerText          = memPct + '%';
        activeEl.innerText       = scrapes + (scrapes === 1 ? ' scrape' : ' scrapes');
        activeEl.style.color     = scrapes > 0 ? '#f97316' : 'var(--text-secondary)';
        bar.style.width          = Math.min(pct, 100) + '%';
        bar.style.background     = barColor;

        const isSafe = tier === 'idle' && scrapes === 0;
        safeHint.style.display   = isSafe             ? 'flex' : 'none';
        warnHint.style.display   = tier === 'critical' ? 'flex' : 'none';
    }

    async function poll() {
        try {
            const res  = await fetch('/api/health');
            const data = await res.json();
            applyState(data);
        } catch (e) {
            if (statusLabel) statusLabel.innerText = 'OFFLINE';
            if (orb) orb.className = 'pulse-orb pulse-orb--critical';
        }
    }

    // FIX 8: pause polling when tab is hidden, resume + immediate poll on return
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') poll();
    });

    poll();
    setInterval(() => {
        if (document.visibilityState === 'visible') poll();
    }, POLL_INTERVAL);
})();

function toggleProtocolPanel() {
    const wrapper = document.getElementById("instructionContentWrapper");
    const arrow = document.getElementById("instructionArrow");
    
    if (!wrapper || !arrow) return;
    
    if (wrapper.style.gridTemplateRows === "1fr") {
        wrapper.style.gridTemplateRows = "0fr";
        arrow.style.transform = "rotate(0deg)";
    } else {
        wrapper.style.gridTemplateRows = "1fr";
        arrow.style.transform = "rotate(180deg)";
    }
}

// ==========================================
// --- BAN SYSTEM (FRONT-END) ---
// ==========================================

async function openBanManager() {
    if (!isUserAdmin) {
        showToast("Unauthorized access.", "error");
        return;
    }

    const ipToBan = await customPrompt("Enter the exact IP address to permanently ban from ZORG-Ω:", "Ban Manager");
    if (!ipToBan) return;

    const isConfirmed = await customConfirm(`Are you absolutely sure you want to ban the IP: ${ipToBan}?`, "Confirm Ban");
    if (isConfirmed) {
        try {
            const res = await fetch('/admin/ban', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: ipToBan })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            showToast(`IP ${ipToBan} successfully banned.`, "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }
}

// Listen for forceful termination from the server
window.zorgSocket.on('force-disconnect-banned', () => {
    window.zorgSocket.disconnect();
    document.body.innerHTML = `
        <div style="display:flex; height:100vh; align-items:center; justify-content:center; background:#08090d; color:#f87171; font-family:monospace; text-align:center; flex-direction:column;">
            <h1 style="font-size: 40px; margin-bottom: 10px; letter-spacing: 0.1em;">403 FORBIDDEN</h1>
            <p style="color: #7c82a0;">Your connection has been forcefully terminated by an Administrator.</p>
        </div>
    `;
});