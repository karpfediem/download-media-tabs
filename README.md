# Download Media Tabs

A Chromium extension that finds downloadable media (images, video, audio, PDFs) across your open tabs and saves them. It can optionally close tabs once their file is downloaded, helping you tidy up bulk media browsing sessions.

Scope: The extension targets single‑media tabs only — pages that display exactly one piece of content (typically a direct media URL). It does not crawl pages to discover assets and is not an image scraper. There are other tools for that.

## Features
- Run on the current window or all windows
- Custom filename patterns (e.g., `Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}`)
- Filters: media types, file size, image dimensions/megapixels, domain allow/deny, extensions, MIME patterns, URL substrings
- Post‑actions: close tab after download; keep window open if it would close on its last tab
- Tunable probe/download concurrency

## Getting started (developers)
1. Clone or download this repository.
2. In Chrome/Chromium, open `chrome://extensions` and enable Developer mode.
3. Click "Load unpacked" and select this project folder.
4. Pin the extension and open the options page to configure defaults.

No build step is required; it’s plain JavaScript/HTML/CSS.

## How to use
- Click the toolbar button to run with your configured default scope.
- Right‑click the extension toolbar icon for context menu options: current window, all windows, selected tabs, left/right of the active tab, current tab group.

**Warning:** For silent bulk downloads, disable "Ask where to save each file before downloading" at `chrome://settings/downloads`. Otherwise Chrome will show a Save dialog for every file.

## Project structure
- `manifest.json` — Extension manifest (permissions, actions)
- `src/` — Core logic
  - `background.js` — Orchestrates discovery and downloads
  - `downloadOrchestrator.js`, `decide.js`, `probe.js`, `filters.js` — Detection/filtering pipeline
  - `menus.js` — Context menu wiring
  - `settings.js` — Storage helpers
- `options/` — Options UI (HTML/CSS/JS)
- `icons/` — Extension icons

## Permissions
The extension needs access to tabs and to download files. All logic runs locally in your browser; it does not contact external services.

## Contributing
Issues and pull requests are welcome. Please keep changes focused and small. If adding a new option, include a brief note in the options UI to explain it.

## Notes
- Tested on recent Chromium/Chrome versions.
- If you run into rate limits or slowdowns, adjust the probe/download concurrency in Options → Performance.
