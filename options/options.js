// Options UI logic with tabbed navigation and unified Filters.
// Saves everything to chrome.storage.sync using a DEFAULTS object.

const DEFAULTS = {
    // General
    includeImages: true,
    includeVideo: true,
    includeAudio: true,
    includePdf: true,
    scope: "currentWindow",
    filenamePattern: "Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}",
    theme: "system",

    // Detection
    strictSingleDetection: true,
    coverageThreshold: 0.5,

    // Performance
    probeConcurrency: 8,
    downloadConcurrency: 6,

    // After download
    closeTabAfterDownload: false,
    keepWindowOpenOnLastTabClose: false,

    // Filters
    filtersEnabled: false,  // Advanced filters toggle (media type is always applied)
    filters: {
        // Dimensions (images only). 0 means “no limit”.
        minWidth: 0,
        minHeight: 0,
        maxWidth: 0,
        maxHeight: 0,
        minMegapixels: 0,  // e.g., 2.0 for 2MP
        maxMegapixels: 0,

        // File size in bytes. 0 means “no limit”.
        minBytes: 0,
        maxBytes: 0,

        // Domain lists
        allowedDomains: [],
        blockedDomains: [],

        // Extensions (lowercase, no dots)
        allowedExtensions: [],
        blockedExtensions: [],

        // MIME patterns (lowercase; supports wildcards like image/*)
        allowedMime: [],
        blockedMime: [],

        // URL substring includes/excludes
        includeUrlSubstrings: [],
        excludeUrlSubstrings: []
    }
};

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

// ---------- Tabs (accessible) ----------

const tabIds = ["general", "after", "detection", "performance", "theme", "presets", "about"];
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
        // General
        $("scope").value           = cfg.scope || DEFAULTS.scope;
        $("filenamePattern").value = cfg.filenamePattern || DEFAULTS.filenamePattern;
        // Theme
        const theme = cfg.theme || DEFAULTS.theme;
        $("theme").value = theme;
        applyTheme(theme);

        // Media types (always applied)
        $("includeImages").checked = !!cfg.includeImages;
        $("includeVideo").checked  = !!cfg.includeVideo;
        $("includeAudio").checked  = !!cfg.includeAudio;
        $("includePdf").checked    = !!cfg.includePdf;

        // Detection
        $("strictSingleDetection").checked = cfg.strictSingleDetection !== false;
        $("coverageThreshold").value = clampFloat(cfg.coverageThreshold, 0, 1, DEFAULTS.coverageThreshold);

        // Performance
        $("probeConcurrency").value    = clampInt(cfg.probeConcurrency, 1, 32, DEFAULTS.probeConcurrency);
        $("downloadConcurrency").value = clampInt(cfg.downloadConcurrency, 1, 32, DEFAULTS.downloadConcurrency);

        // After
        $("closeTabAfterDownload").checked = !!cfg.closeTabAfterDownload;
        $("keepWindowOpenOnLastTabClose").checked = !!cfg.keepWindowOpenOnLastTabClose;

        // Filters
        const filters = Object.assign({}, DEFAULTS.filters, cfg.filters);
        $("filtersEnabled").checked = !!cfg.filtersEnabled;

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
        LAST_SAVED = cfg;
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

        // Media types (always applied)
        includeImages: $("includeImages").checked,
        includeVideo:  $("includeVideo").checked,
        includeAudio:  $("includeAudio").checked,
        includePdf:    $("includePdf").checked,

        // Detection
        strictSingleDetection: $("strictSingleDetection").checked,
        coverageThreshold: clampFloat($("coverageThreshold").value, 0, 1, DEFAULTS.coverageThreshold),

        // Performance
        probeConcurrency: clampInt($("probeConcurrency").value, 1, 32, DEFAULTS.probeConcurrency),
        downloadConcurrency: clampInt($("downloadConcurrency").value, 1, 32, DEFAULTS.downloadConcurrency),

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
        const keys = Object.keys(v).sort();
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
    const o = { ...obj };
    delete o.presets; // do not include presets in a settings backup
    return o;
}

function exportSettings() {
    chrome.storage.sync.get(DEFAULTS, (cfg) => {
        const data = pickSettingsOnly(cfg);
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
    const reader = new FileReader();
    reader.onerror = () => {
        showToast("Import failed (file read error).", 'error', 2000);
    };
    reader.onload = () => {
        try {
            const obj = JSON.parse(String(reader.result || '{}'));
            if (typeof obj !== 'object' || !obj) throw new Error('Invalid JSON');
            // Shallow validation: must contain at least some known keys
            const knownKeys = ['scope','filenamePattern','theme','includeImages','includeVideo','includeAudio','includePdf','filtersEnabled','filters'];
            const ok = knownKeys.some(k => Object.prototype.hasOwnProperty.call(obj, k));
            if (!ok) throw new Error('Not a settings file');
            // Do not allow presets to be imported via this path
            delete obj.presets;
            chrome.storage.sync.set(obj, () => {
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
        chrome.storage.sync.get(DEFAULTS, (cfg) => {
            const presets = store.presets || {};
            const payload = pickSettingsOnly(cfg);
            presets[name] = payload;
            chrome.storage.sync.set({ presets }, () => {
                loadPresetsUI();
                showToast("Preset '" + name + "' saved.", 'success', 1200);
            });
        });
    });
}

function applyPresetByName(name) {
    if (!name) return;
    chrome.storage.sync.get({ presets: {} }, (store) => {
        const preset = (store.presets || {})[name];
        if (!preset) return;
        chrome.storage.sync.set(preset, () => {
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
        el.className = `toast ${type}`;
        el.textContent = String(message || '');
        container.appendChild(el);
        const hide = () => {
            el.classList.add('hide');
            el.addEventListener('animationend', () => {
                el.remove();
            }, { once:true });
        };
        setTimeout(hide, Math.max(600, Number(duration) || 1600));
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

    document.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLElement)) return;
        const id = t.id;
        if (id === "save") save();
        if (id === "reset") { reset(); }
        if (id === "exportSettings") exportSettings();
        if (id === "importSettings") $("importFile").click();
        if (id === "savePreset") saveCurrentAsPreset();
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
