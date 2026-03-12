# ZORG-Ω Architect: Project Context & AI Instructions

## System Overview
ZORG-Ω is a dynamic web scraping dashboard, real-time telemetry monitor, and multi-agent communication hub. It uses a monolithic Node.js backend with a vanilla JavaScript and Tailwind CSS frontend. Data persistence relies on local JSON flat-files.

## Tech Stack
* **Backend:** Node.js, Express.js
* **Real-time:** Socket.io
* **Frontend:** Vanilla HTML5, Vanilla JS (`client.js`), Tailwind CSS (via CDN)
* **Data Processing:** `xlsx` (SheetJS) for Excel generation, `axios` for HTTP requests.

## Directory Structure
* `app.js`: The central server. Handles routing, Socket.io events, file execution, and flat-file database management.
* `public/`: Contains static frontend assets served via Express.
    * `index.html`: The main UI.
    * `client.js`: Frontend logic, DOM manipulation, Socket listeners.
    * `style.css`: Custom CSS, animations, scrollbars.
* `Engines/`: Directory containing modular Node.js scraping scripts (e.g., `MapDynamics.js`, custom uploads).
* `Icons/`: Directory for UI graphics and favicons.
* `*.json`: Flat-file databases in the root directory (`users.json`, `engines.json`, `logs.json`, `chat.json`, `deleted_engines.json`).

## Core Architecture Patterns (CRITICAL RULES FOR AI)
1.  **Strict Separation of Concerns:** Frontend code must ONLY reside in the `public/` directory. `app.js` must NEVER serve HTML directly via `res.send()` string literals.
2.  **Socket.io UI Injection:** To keep the DOM lightweight, dynamic UI elements (like the Custom Engines Dropdown) are generated as HTML strings in `app.js` and pushed to `client.js` via the `init-data` socket payload.
3.  **Persistent Chat & Identification:** Users are identified by their `name` (Agent Designation), NOT their temporary `socket.id`. Chat history is stored in `chat.json` using sorted name pairs (e.g., `Agent1:Agent2`).
4.  **UI/UX Aesthetic:** The UI utilizes a heavy "Glass-morphism" aesthetic. Always retain existing Tailwind classes like `bg-slate-900/80`, `backdrop-blur-xl`, `border-slate-700/50`, and neon accent colors (`blue-500`, `purple-500`, `emerald-500`).
5.  **Global Interceptors:** `app.js` uses `AsyncLocalStorage` to tie HTTP requests (Axios/Fetch) to specific Engine runs so they can be manually aborted by the client.
6.  **Cache Busting:** If modifying `client.js` or `style.css`, remind the developer to update the `?v=X` query string in `index.html` or disable browser caching.

## Adding Features
* Do NOT overwrite existing `window.zorgSocket.on()` listeners in `client.js`. Append to them.
* When generating UI, rely on Tailwind CSS; avoid adding custom CSS to `style.css` unless necessary for animations or complex pseudo-elements.