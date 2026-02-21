// Options UI logic with tabbed navigation and unified Filters.
// Saves everything to chrome.storage.sync using DEFAULTS that come from shared src/constants.js.

import { DEFAULT_SETTINGS as DEFAULTS } from "../src/constants.js";

// ---------- Utilities ----------

const $ = (id) => document.getElementById(id);

function clampInt(v, lo, hi, dflt) {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
}
function clampFloat(v, lo, hi, dflt) {
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
}
function linesToArray(textareaValue, { lower = false, trim = true, dropEmpty = true } = {}) {
    const arr = String(textareaValue || "")
        .split(/\r?\n/)
        .map(s => (trim ? s.trim() : s))
        .map(s => (lower ? s.toLowerCase() : s));
    return dropEmpty ? arr.filter(Boolean) : arr;
}
function normalizeDomainList(lines) {
    return lines.map(s => s.replace(/^\.+/, "").toLowerCase()).filter(Boolean);
}
function normalizeExtList(lines) {
    return lines.map(s => s.replace(/^\./, "").toLowerCase()).filter(Boolean);
}
function bytesFrom(value, unit) {
    const n = Math.max(0, Number.parseFloat(value || "0") || 0);
    switch (unit) {
        case "GB": return Math.round(n * 1024 * 1024 * 1024);
        case "MB": return Math.round(n * 1024 * 1024);
        case "KB": return Math.round(n * 1024);
        default:   return Math.round(n);
    }
}
function valueUnitFromBytes(bytes) {
    const b = Math.max(0, Number(bytes) || 0);
    if (b === 0) return { value: 0, unit: "MB" };
    if (b % (1024 * 1024 * 1024) === 0) return { value: b / (1024 * 1024 * 1024), unit: "GB" };
    if (b % (1024 * 1024) === 0)       return { value: b / (1024 * 1024), unit: "MB" };
    if (b % 1024 === 0)                return { value: b / 1024, unit: "KB" };
    return { value: b, unit: "B" };
}
function setDisabled(el, disabled) {
    if (!el) return;
    if (disabled) el.classList.add("disabled");
    else el.classList.remove("disabled");
    Array.from(el.querySelectorAll("input, textarea, select, button")).forEach(ctrl => {
        ctrl.disabled = !!disabled;
    });
}

// Avoid prototype pollution by filtering unsafe keys
function isSafeKey(key) {
    return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
}

function safeMergeFilters(base, incoming) {
    const out = {};
    const src = (typeof base === 'object' && base) ? base : {};
    const inc = (typeof incoming === 'object' && incoming) ? incoming : {};
    const keys = [
        'minWidth','minHeight','maxWidth','maxHeight',
        'minMegapixels','maxMegapixels',
        'minBytes','maxBytes',
        'allowedDomains','blockedDomains',
        'allowedExtensions','blockedExtensions',
        'allowedMime','blockedMime',
        'includeUrlSubstrings','excludeUrlSubstrings'
    ];
    for (const k of keys) {
        if (!isSafeKey(k)) continue;
        const v = Object.prototype.hasOwnProperty.call(inc, k) ? inc[k] : src[k];
        out[k] = v;
    }
    return out;
}

function isValidMatchPattern(p) {
    const s = String(p || '').trim();
    if (!s) return false;
    // Rough validation for Chrome match patterns; Chrome will do final validation when requesting permissions.
    const re = /^(\*|http|https|ftp):\/\/(\*|\*\.[^\/\*]+|[^\/\*]+)\/.*$/i;
    return re.test(s);
}
function normalizeMatchPatterns(lines) {
    return lines.map(String).map(s => s.trim()).filter(Boolean).filter(isValidMatchPattern);
}

function sanitizeSettingsInput(input) {
    const cfg = (typeof input === 'object' && input) ? input : {};
    const sanitized = {};
    // General
    sanitized.scope = typeof cfg.scope === 'string' ? cfg.scope : DEFAULTS.scope;
    sanitized.filenamePattern = typeof cfg.filenamePattern === 'string' && cfg.filenamePattern.trim() ? cfg.filenamePattern.trim() : DEFAULTS.filenamePattern;
    sanitized.theme = (cfg.theme === 'light' || cfg.theme === 'dark' || cfg.theme === 'system') ? cfg.theme : DEFAULTS.theme;

    // Media types
    sanitized.includeImages = !!cfg.includeImages;
    sanitized.includeVideo = !!cfg.includeVideo;
    sanitized.includeAudio = !!cfg.includeAudio;
    sanitized.includePdf = !!cfg.includePdf;

    // Detection
    sanitized.strictSingleDetection = cfg.strictSingleDetection !== false;
    sanitized.coverageThreshold = clampFloat(cfg.coverageThreshold, 0, 1, DEFAULTS.coverageThreshold);
    sanitized.inferExtensionFromUrl = cfg.inferExtensionFromUrl !== false;
    sanitized.inferUrlAllowedExtensions = Array.isArray(cfg.inferUrlAllowedExtensions)
        ? normalizeExtList(cfg.inferUrlAllowedExtensions)
        : normalizeExtList(DEFAULTS.inferUrlAllowedExtensions || []);
    sanitized.triggerUrlSubstrings = Array.isArray(cfg.triggerUrlSubstrings)
        ? cfg.triggerUrlSubstrings.map(v => String(v || "").trim()).filter(Boolean)
        : [];
    sanitized.triggerBypassFilters = !!cfg.triggerBypassFilters;

    // Automation
    sanitized.autoRunOnNewTabs = !!cfg.autoRunOnNewTabs;

    // Permissions
    sanitized.allowedOrigins = Array.isArray(cfg.allowedOrigins) ? normalizeMatchPatterns(cfg.allowedOrigins) : [];

    // Performance
    sanitized.probeConcurrency = clampInt(cfg.probeConcurrency, 1, 32, DEFAULTS.probeConcurrency);
    sanitized.downloadConcurrency = clampInt(cfg.downloadConcurrency, 1, 32, DEFAULTS.downloadConcurrency);

    // After
    sanitized.closeTabAfterDownload = !!cfg.closeTabAfterDownload;
    sanitized.keepWindowOpenOnLastTabClose = !!cfg.keepWindowOpenOnLastTabClose;

    // Filters
    sanitized.filtersEnabled = !!cfg.filtersEnabled;
    const incomingFilters = (typeof cfg.filters === 'object' && cfg.filters) ? cfg.filters : {};
    const mergedFilters = safeMergeFilters(DEFAULTS.filters, incomingFilters);
    sanitized.filters = {
        minWidth: clampInt(mergedFilters.minWidth, 0, 100000, 0),
        minHeight: clampInt(mergedFilters.minHeight, 0, 100000, 0),
        maxWidth: clampInt(mergedFilters.maxWidth, 0, 100000, 0),
        maxHeight: clampInt(mergedFilters.maxHeight, 0, 100000, 0),
        minMegapixels: clampFloat(mergedFilters.minMegapixels, 0, 10000, 0),
        maxMegapixels: clampFloat(mergedFilters.maxMegapixels, 0, 10000, 0),
        minBytes: Math.max(0, Number(mergedFilters.minBytes) || 0),
        maxBytes: Math.max(0, Number(mergedFilters.maxBytes) || 0),
        allowedDomains: Array.isArray(mergedFilters.allowedDomains) ? normalizeDomainList(mergedFilters.allowedDomains.map(String)) : [],
        blockedDomains: Array.isArray(mergedFilters.blockedDomains) ? normalizeDomainList(mergedFilters.blockedDomains.map(String)) : [],
        allowedExtensions: Array.isArray(mergedFilters.allowedExtensions) ? normalizeExtList(mergedFilters.allowedExtensions.map(String)) : [],
        blockedExtensions: Array.isArray(mergedFilters.blockedExtensions) ? normalizeExtList(mergedFilters.blockedExtensions.map(String)) : [],
        allowedMime: Array.isArray(mergedFilters.allowedMime) ? mergedFilters.allowedMime.map(v => String(v).trim().toLowerCase()).filter(Boolean) : [],
        blockedMime: Array.isArray(mergedFilters.blockedMime) ? mergedFilters.blockedMime.map(v => String(v).trim().toLowerCase()).filter(Boolean) : [],
        includeUrlSubstrings: Array.isArray(mergedFilters.includeUrlSubstrings) ? mergedFilters.includeUrlSubstrings.map(v => String(v).trim()).filter(Boolean) : [],
        excludeUrlSubstrings: Array.isArray(mergedFilters.excludeUrlSubstrings) ? mergedFilters.excludeUrlSubstrings.map(v => String(v).trim()).filter(Boolean) : []
    };

    return sanitized;
}

// ---------- Tabs (accessible) ----------

const tabIds = ["general", "automation", "detection", "performance", "theme", "presets", "about"];
function initTabs() {
    const tabs = tabIds.map(id => ({
        tab: $(`tab-${id}`),
        panel: $(`panel-${id}`)
    }));
    function activate(idx) {
        tabs.forEach((t, i) => {
            const selected = i === idx;
            t.tab.setAttribute("aria-selected", String(selected));
            t.tab.tabIndex = selected ? 0 : -1;
            if (selected) t.panel.removeAttribute("hidden"); else t.panel.setAttribute("hidden", "");
        });
        // Keep focus on the active tab for a11y
        tabs[idx]?.tab?.focus?.();
        localStorage.setItem("dmt-active-tab", String(idx));
    }
    tabs.forEach((t, i) => {
        t.tab.addEventListener("click", () => activate(i));
        t.tab.addEventListener("keydown", (ev) => {
            if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
                ev.preventDefault();
                const dir = ev.key === "ArrowRight" ? 1 : -1;
                const next = (i + dir + tabs.length) % tabs.length;
                activate(next);
            }
        });
    });
    const saved = clampInt(localStorage.getItem("dmt-active-tab"), 0, tabs.length - 1, 0);
    activate(saved);
}

// ---------- Theme & Preview ----------

function computePatternPreview(pattern) {
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const yyyy = now.getFullYear();
    const MM = pad2(now.getMonth() + 1);
    const dd = pad2(now.getDate());
    const HH = pad2(now.getHours());
    const mm = pad2(now.getMinutes());
    const ss = pad2(now.getSeconds());
    const stamp = `${yyyy}${MM}${dd}-${HH}${mm}${ss}`;
    const host = "example.com";
    const basename = "image";
    let s = String(pattern || "");
    s = s.replaceAll("{YYYYMMDD-HHmmss}", stamp)
         .replaceAll("{host}", host)
         .replaceAll("{basename}", basename);
    return s;
}

function updatePatternPreview() {
    const el = $("patternPreview");
    if (!el) return;
    const pattern = $("filenamePattern").value || DEFAULTS.filenamePattern;
    el.textContent = "Preview: " + computePatternPreview(pattern);
}

function applyTheme(theme) {
    const root = document.documentElement;
    const preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'latte' : 'mocha';
    const finalTheme = (theme === 'system') ? preferred : theme;
    root.setAttribute('data-theme', finalTheme);
}

// ---------- Load / Save ----------

function load() {
    IS_LOADING = true;
    chrome.storage.sync.get(DEFAULTS, (cfg) => {
        const safeCfg = sanitizeSettingsInput(cfg);
        // General
        $("scope").value           = safeCfg.scope || DEFAULTS.scope;
        $("filenamePattern").value = safeCfg.filenamePattern || DEFAULTS.filenamePattern;
        // Permissions UI
        $("allowedOrigins").value  = (Array.isArray(safeCfg.allowedOrigins) ? safeCfg.allowedOrigins : []).join("\n");
        // Theme
        const theme = safeCfg.theme || DEFAULTS.theme;
        $("theme").value = theme;
        applyTheme(theme);

        // Media types (always applied)
        $("includeImages").checked = !!safeCfg.includeImages;
        $("includeVideo").checked  = !!safeCfg.includeVideo;
        $("includeAudio").checked  = !!safeCfg.includeAudio;
        $("includePdf").checked    = !!safeCfg.includePdf;

        // Detection
        $("strictSingleDetection").checked = safeCfg.strictSingleDetection !== false;
        $("coverageThreshold").value = clampFloat(safeCfg.coverageThreshold, 0, 1, DEFAULTS.coverageThreshold);
        $("inferExtensionFromUrl").checked = safeCfg.inferExtensionFromUrl !== false;
        $("inferUrlAllowedExtensions").value = (safeCfg.inferUrlAllowedExtensions || []).join("\n");
        $("triggerUrlSubstrings").value = (safeCfg.triggerUrlSubstrings || []).join("\n");
        $("triggerBypassFilters").checked = !!safeCfg.triggerBypassFilters;

        // Automation
        $("autoRunOnNewTabs").checked = !!safeCfg.autoRunOnNewTabs;

        // Performance
        $("probeConcurrency").value    = clampInt(safeCfg.probeConcurrency, 1, 32, DEFAULTS.probeConcurrency);
        $("downloadConcurrency").value = clampInt(safeCfg.downloadConcurrency, 1, 32, DEFAULTS.downloadConcurrency);

        // After
        $("closeTabAfterDownload").checked = !!safeCfg.closeTabAfterDownload;
        $("keepWindowOpenOnLastTabClose").checked = !!safeCfg.keepWindowOpenOnLastTabClose;

        // Filters
        const filters = safeMergeFilters(DEFAULTS.filters, safeCfg.filters);
        $("filtersEnabled").checked = !!safeCfg.filtersEnabled;

        // Dimensions
        $("minWidth").value      = String(filters.minWidth || 0);
        $("minHeight").value     = String(filters.minHeight || 0);
        $("maxWidth").value      = String(filters.maxWidth || 0);
        $("maxHeight").value     = String(filters.maxHeight || 0);
        $("minMegapixels").value = String(filters.minMegapixels || 0);
        $("maxMegapixels").value = String(filters.maxMegapixels || 0);

        // File size
        const min = valueUnitFromBytes(filters.minBytes);
        $("minSizeValue").value = String(min.value);
        $("minSizeUnit").value  = min.unit;
        const max = valueUnitFromBytes(filters.maxBytes);
        $("maxSizeValue").value = String(max.value);
        $("maxSizeUnit").value  = max.unit;

        // Lists
        $("allowedDomains").value       = (filters.allowedDomains || []).join("\n");
        $("blockedDomains").value       = (filters.blockedDomains || []).join("\n");
        $("allowedExtensions").value    = (filters.allowedExtensions || []).join("\n");
        $("blockedExtensions").value    = (filters.blockedExtensions || []).join("\n");
        $("allowedMime").value          = (filters.allowedMime || []).join("\n");
        $("blockedMime").value          = (filters.blockedMime || []).join("\n");
        $("includeUrlSubstrings").value = (filters.includeUrlSubstrings || []).join("\n");
        $("excludeUrlSubstrings").value = (filters.excludeUrlSubstrings || []).join("\n");

        reflectFiltersEnabledState();
        updatePatternPreview();

        // Update baseline and save button
        LAST_SAVED = safeCfg;
        IS_LOADING = false;
        updateSaveEnabled();
    });
}

function buildConfigFromUI() {
    const filtersEnabled = $("filtersEnabled").checked;
    const minBytes = bytesFrom($("minSizeValue").value, $("minSizeUnit").value);
    const maxBytes = bytesFrom($("maxSizeValue").value, $("maxSizeUnit").value);
    return {
        // General
        scope: $("scope").value,
        filenamePattern: $("filenamePattern").value.trim() || DEFAULTS.filenamePattern,
        theme: $("theme").value || DEFAULTS.theme,

        // Permissions
        allowedOrigins: normalizeMatchPatterns(linesToArray($("allowedOrigins").value, { trim: true, lower: false })), 

        // Media types (always applied)
        includeImages: $("includeImages").checked,
        includeVideo:  $("includeVideo").checked,
        includeAudio:  $("includeAudio").checked,
        includePdf:    $("includePdf").checked,

        // Detection
        strictSingleDetection: $("strictSingleDetection").checked,
        coverageThreshold: clampFloat($("coverageThreshold").value, 0, 1, DEFAULTS.coverageThreshold),
        inferExtensionFromUrl: $("inferExtensionFromUrl").checked,
        inferUrlAllowedExtensions: normalizeExtList(linesToArray($("inferUrlAllowedExtensions").value)),
        triggerUrlSubstrings: linesToArray($("triggerUrlSubstrings").value, { trim: true, lower: false }),
        triggerBypassFilters: $("triggerBypassFilters").checked,

        // Performance
        probeConcurrency: clampInt($("probeConcurrency").value, 1, 32, DEFAULTS.probeConcurrency),
        downloadConcurrency: clampInt($("downloadConcurrency").value, 1, 32, DEFAULTS.downloadConcurrency),

        // Automation
        autoRunOnNewTabs: $("autoRunOnNewTabs").checked,

        // After
        closeTabAfterDownload: $("closeTabAfterDownload").checked,
        keepWindowOpenOnLastTabClose: $("keepWindowOpenOnLastTabClose").checked,

        // Filters
        filtersEnabled,
        filters: {
            // Dimensions
            minWidth:      clampInt($("minWidth").value, 0, 100000, 0),
            minHeight:     clampInt($("minHeight").value, 0, 100000, 0),
            maxWidth:      clampInt($("maxWidth").value, 0, 100000, 0),
            maxHeight:     clampInt($("maxHeight").value, 0, 100000, 0),
            minMegapixels: clampFloat($("minMegapixels").value, 0, 10000, 0),
            maxMegapixels: clampFloat($("maxMegapixels").value, 0, 10000, 0),

            // Size (bytes)
            minBytes,
            maxBytes,

            // Lists
            allowedDomains: normalizeDomainList(linesToArray($("allowedDomains").value)),
            blockedDomains: normalizeDomainList(linesToArray($("blockedDomains").value)),
            allowedExtensions: normalizeExtList(linesToArray($("allowedExtensions").value)),
            blockedExtensions: normalizeExtList(linesToArray($("blockedExtensions").value)),
            allowedMime: linesToArray($("allowedMime").value, { lower: true }),
            blockedMime: linesToArray($("blockedMime").value, { lower: true }),
            includeUrlSubstrings: linesToArray($("includeUrlSubstrings").value, { trim: true, lower: false }),
            excludeUrlSubstrings: linesToArray($("excludeUrlSubstrings").value, { trim: true, lower: false })
        }
    };
}

let LAST_SAVED = null;
let IS_LOADING = false;

function stableStringify(value) {
    const seen = new WeakSet();
    function helper(v) {
        if (v === null || typeof v !== 'object') return v;
        if (seen.has(v)) return undefined; // avoid cycles (shouldn't exist here)
        seen.add(v);
        if (Array.isArray(v)) return v.map(helper);
        const keys = Object.keys(v).filter(isSafeKey).sort();
        const out = {};
        for (const k of keys) out[k] = helper(v[k]);
        return out;
    }
    return JSON.stringify(helper(value));
}

function isEqual(a, b) {
    try { return stableStringify(a) === stableStringify(b); } catch { return false; }
}

function updateSaveEnabled() {
    if (IS_LOADING) return;
    const btn = $("save");
    if (!btn) return;
    const current = pickSettingsOnly(buildConfigFromUI());
    const baseline = pickSettingsOnly(LAST_SAVED || {});
    const changed = !isEqual(current, baseline);
    btn.disabled = !changed;
}

function save() {
    const cfg = buildConfigFromUI();
    chrome.storage.sync.set(cfg, () => {
        if (cfg.theme) applyTheme(cfg.theme);
        updatePatternPreview();
        LAST_SAVED = cfg;
        updateSaveEnabled();
        showToast("Saved.", 'success');
    });
}

function reset() {
    chrome.storage.sync.set(DEFAULTS, () => {
        load();
        showToast("Defaults restored.", 'success');
    });
}

// Enable/disable advanced fieldsets (media types remain active always)
function reflectFiltersEnabledState() {
    const on = $("filtersEnabled").checked;
    setDisabled($("fs-size-dimensions"), !on);
    setDisabled($("fs-size-bytes"), !on);
    setDisabled($("fs-domain"), !on);
    setDisabled($("fs-ext-mime"), !on);
    setDisabled($("fs-url"), !on);
}

// ---------- Export / Import ----------

function pickSettingsOnly(obj) {
    const cfg = (typeof obj === 'object' && obj) ? obj : {};
    const allowedTop = [
        'scope','filenamePattern','theme','allowedOrigins',
        'includeImages','includeVideo','includeAudio','includePdf',
        'strictSingleDetection','coverageThreshold',
        'inferExtensionFromUrl',
        'inferUrlAllowedExtensions','triggerUrlSubstrings','triggerBypassFilters',
        'probeConcurrency','downloadConcurrency',
        'autoRunOnNewTabs',
        'closeTabAfterDownload','keepWindowOpenOnLastTabClose',
        'filtersEnabled','filters'
    ];
    const out = {};
    for (const k of allowedTop) {
        if (!isSafeKey(k)) continue;
        if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k];
    }
    // Ensure filters shape is plain, if present
    if (typeof out.filters === 'object' && out.filters) {
        out.filters = safeMergeFilters(DEFAULTS.filters, out.filters);
    }
    return out;
}

function exportSettings() {
    chrome.storage.sync.get(DEFAULTS, (cfg) => {
        const data = pickSettingsOnly(sanitizeSettingsInput(cfg));
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `options-${ts}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Exported options.json.", 'success');
    });
}

function importFromFile(file) {
    if (!file) return;
    // Limit file size to prevent accidental huge imports (1 MB)
    if (file.size > 1024 * 1024) {
        showToast("Import failed (file too large).", 'error', 2500);
        return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
        showToast("Import failed (file read error).", 'error', 2000);
    };
    reader.onload = () => {
        try {
            const obj = JSON.parse(String(reader.result || '{}'));
            if (typeof obj !== 'object' || !obj) throw new Error('Invalid JSON');
            // Do not allow presets to be imported via this path
            if (Object.prototype.hasOwnProperty.call(obj, 'presets')) delete obj.presets;
            // Sanitize and only accept whitelisted fields
            const sanitized = sanitizeSettingsInput(obj);
            chrome.storage.sync.set(sanitized, () => {
                load();
                showToast("Imported options.json.", 'success');
            });
        } catch (e) {
            showToast("Import failed (invalid JSON).", 'error', 2000);
        }
    };
    reader.readAsText(file);
}

// ---------- Presets (saved configurations) ----------

function renderPresetsList(presets) {
    const list = $("presetsList");
    const empty = $("presetsEmpty");
    if (!list || !empty) return;
    list.innerHTML = "";
    const names = Object.keys(presets || {}).sort((a,b) => a.localeCompare(b));
    empty.style.display = names.length ? 'none' : '';
    names.forEach(name => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.gap = '8px';
        li.style.justifyContent = 'space-between';
        const title = document.createElement('div');
        title.textContent = name;
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '8px';
        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.dataset.action = 'applyPreset';
        applyBtn.dataset.name = name;
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.dataset.action = 'deletePreset';
        deleteBtn.dataset.name = name;
        actions.appendChild(applyBtn);
        actions.appendChild(deleteBtn);
        li.appendChild(title);
        li.appendChild(actions);
        list.appendChild(li);
    });
}

function loadPresetsUI() {
    chrome.storage.sync.get({ presets: {} }, (obj) => {
        renderPresetsList(obj.presets || {});
    });
}

function saveCurrentAsPreset() {
    const name = (($("presetName")?.value) || "").trim();
    if (!name) {
        showToast("Enter a preset name.", 'info', 1200);
        return;
    }
    chrome.storage.sync.get({ presets: {} }, (store) => {
        const presets = store.presets || {};
        // Save exactly what is currently in the UI (already sanitized by buildConfigFromUI)
        const payload = pickSettingsOnly(buildConfigFromUI());
        presets[name] = payload;
        chrome.storage.sync.set({ presets }, () => {
            loadPresetsUI();
            showToast("Preset '" + name + "' saved.", 'success', 1200);
        });
    });
}

function applyPresetByName(name) {
    if (!name) return;
    chrome.storage.sync.get({ presets: {} }, (store) => {
        const preset = (store.presets || {})[name];
        if (!preset) return;
        const sanitized = sanitizeSettingsInput(preset);
        chrome.storage.sync.set(sanitized, () => {
            load();
            showToast("Preset '" + name + "' applied.", 'success', 1200);
        });
    });
}

function deletePresetByName(name) {
    if (!name) return;
    chrome.storage.sync.get({ presets: {} }, (store) => {
        const presets = { ...(store.presets || {}) };
        delete presets[name];
        chrome.storage.sync.set({ presets }, () => {
            loadPresetsUI();
            showToast("Preset deleted.", 'success', 1200);
        });
    });
}

// ---------- Toasts ----------

function showToast(message, type = 'info', duration = 1600) {
    try{
        const container = document.getElementById('toasts') || (()=>{
            const c = document.createElement('div');
            c.id = 'toasts'; c.className = 'toasts';
            document.body.appendChild(c);
            return c;
        })();
        const el = document.createElement('div');
        const allowed = new Set(['info','success','error','warn']);
        const t = String(type || 'info');
        const safeType = allowed.has(t) ? t : 'info';
        el.classList.add('toast', safeType);
        el.textContent = String(message || '');
        container.appendChild(el);
        const hide = () => {
            el.classList.add('hide');
            el.addEventListener('animationend', () => {
                el.remove();
            }, { once:true });
        };
        // Allow longer toasts (up to 30s) for first-run welcome
        const ms = Math.max(600, Math.min(30000, Number(duration) || 1600));
        setTimeout(hide, ms);
        return el;
    }catch(e){
        // Fallback: no-op
    }
}

// ---------- Wire up ----------

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    load();
    updatePatternPreview();
    loadPresetsUI();

    // Show a welcome note on first install (triggered by background via storage.local)
    try {
        chrome.storage?.local?.get({ shouldShowWelcome: false }, (obj) => {
            if (obj && obj.shouldShowWelcome) {
                // Clear the flag so it only shows once
                chrome.storage?.local?.set({ shouldShowWelcome: false });
                showToast(
                    "Welcome! Take a moment to review Options. You can reopen them anytime by right-clicking the extension icon and choosing Options.",
                    'info',
                    15000
                );
            }
        });
    } catch {}

    document.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const id = t.id;
        if (id === "save") save();
        if (id === "reset") { reset(); }
        if (id === "exportSettings") exportSettings();
        if (id === "importSettings") $("importFile").click();
        if (id === "savePreset") saveCurrentAsPreset();
        if (id === "resetInferUrlAllowedExtensions") {
            $("inferUrlAllowedExtensions").value = (DEFAULTS.inferUrlAllowedExtensions || []).join("\n");
            updateSaveEnabled();
            showToast("URL-hint extensions reset to defaults.", 'success', 1400);
            return;
        }
        if (id === "requestHostPerms") {
            // Request optional host permissions for the current whitelist
            const patterns = normalizeMatchPatterns(linesToArray($("allowedOrigins").value, { trim: true, lower: false }));
            if (!patterns.length) { showToast("No sites listed.", 'info'); return; }
            chrome.permissions.request({ origins: patterns }, (granted) => {
                showToast(granted ? "Permissions granted." : "Some or all permissions were denied.", granted ? 'success' : 'warn', 2200);
            });
            return;
        }
        if (t.dataset?.action === 'applyPreset') applyPresetByName(t.dataset.name);
        if (t.dataset?.action === 'deletePreset') deletePresetByName(t.dataset.name);
    });

    // Global change tracking: enable Save on any user edit
    document.addEventListener('input', updateSaveEnabled, true);
    document.addEventListener('change', (ev) => {
        if ((ev.target instanceof HTMLInputElement) && ev.target.type === 'file') return;
        if (ev.target?.id === 'filtersEnabled') reflectFiltersEnabledState();
        updateSaveEnabled();
    }, true);

    $("importFile")?.addEventListener('change', (ev) => {
        const file = ev.target?.files?.[0];
        importFromFile(file);
        // reset the input so choosing the same file again triggers change
        ev.target.value = '';
    });

    $("filtersEnabled").addEventListener("change", reflectFiltersEnabledState);

    // Live preview for filename pattern
    $("filenamePattern").addEventListener("input", updatePatternPreview);

    // Theme switching
    $("theme").addEventListener("change", () => {
        applyTheme($("theme").value);
    });

    // React to system theme changes if in system mode
    const media = window.matchMedia('(prefers-color-scheme: light)');
    if (media?.addEventListener) {
        media.addEventListener('change', () => {
            const t = $("theme").value || DEFAULTS.theme;
            if (t === 'system') applyTheme('system');
        });
    }
});
