// Options UI logic with tabbed navigation and future-ready Filters.
// Saves everything to chrome.storage.sync using a DEFAULTS object.

const DEFAULTS = {
    // General
    includeImages: true,
    includeVideo: true,
    includeAudio: true,
    includePdf: true,
    scope: "currentWindow",
    filenamePattern: "Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}",

    // Detection
    strictSingleDetection: true,
    coverageThreshold: 0.5,

    // Performance
    probeConcurrency: 8,
    downloadConcurrency: 6,

    // After download
    closeTabAfterDownload: false,
    keepWindowOpenOnLastTabClose: false,

    // Filters (not enforced yet)
    filtersEnabled: false,
    filters: {
        // Sizes in BYTES (0 means “no limit”)
        minBytes: 0,
        maxBytes: 0,
        // Domain lists (strings, normalized without leading dots)
        allowedDomains: [],
        blockedDomains: [],
        // Extensions (lowercase, no dots)
        allowedExtensions: [],
        blockedExtensions: [],
        // MIME patterns (e.g., "image/*", "video/mp4")
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

const tabIds = ["general","detection","performance","filters","after","about"];
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
            if (selected) t.tab.focus();
            if (selected) t.panel.removeAttribute("hidden"); else t.panel.setAttribute("hidden", "");
        });
        localStorage.setItem("dmt-active-tab", String(idx));
    }
    tabs.forEach((t, i) => {
        t.tab.addEventListener("click", () => activate(i));
        t.tab.addEventListener("keydown", (ev) => {
            if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
                ev.preventDefault();
                const dir = ev.key === "ArrowRight" ? 1 : -1;
                let next = (i + dir + tabs.length) % tabs.length;
                activate(next);
            }
        });
    });
    const saved = clampInt(localStorage.getItem("dmt-active-tab"), 0, tabs.length - 1, 0);
    activate(saved);
}

// ---------- Load / Save ----------

function load() {
    chrome.storage.sync.get(DEFAULTS, (cfg) => {
        // General
        $("includeImages").checked = !!cfg.includeImages;
        $("includeVideo").checked  = !!cfg.includeVideo;
        $("includeAudio").checked  = !!cfg.includeAudio;
        $("includePdf").checked    = !!cfg.includePdf;
        $("scope").value           = cfg.scope || DEFAULTS.scope;
        $("filenamePattern").value = cfg.filenamePattern || DEFAULTS.filenamePattern;

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

        const min = valueUnitFromBytes(filters.minBytes);
        $("minSizeValue").value = String(min.value);
        $("minSizeUnit").value = min.unit;

        const max = valueUnitFromBytes(filters.maxBytes);
        $("maxSizeValue").value = String(max.value);
        $("maxSizeUnit").value = max.unit;

        $("allowedDomains").value      = (filters.allowedDomains || []).join("\n");
        $("blockedDomains").value      = (filters.blockedDomains || []).join("\n");
        $("allowedExtensions").value   = (filters.allowedExtensions || []).join("\n");
        $("blockedExtensions").value   = (filters.blockedExtensions || []).join("\n");
        $("allowedMime").value         = (filters.allowedMime || []).join("\n");
        $("blockedMime").value         = (filters.blockedMime || []).join("\n");
        $("includeUrlSubstrings").value= (filters.includeUrlSubstrings || []).join("\n");
        $("excludeUrlSubstrings").value= (filters.excludeUrlSubstrings || []).join("\n");

        reflectFiltersEnabledState();
    });
}

function save() {
    const filtersEnabled = $("filtersEnabled").checked;

    const minBytes = bytesFrom($("minSizeValue").value, $("minSizeUnit").value);
    const maxBytes = bytesFrom($("maxSizeValue").value, $("maxSizeUnit").value);

    const cfg = {
        // General
        includeImages: $("includeImages").checked,
        includeVideo:  $("includeVideo").checked,
        includeAudio:  $("includeAudio").checked,
        includePdf:    $("includePdf").checked,
        scope: $("scope").value,
        filenamePattern: $("filenamePattern").value.trim() || DEFAULTS.filenamePattern,

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
            minBytes,
            maxBytes,
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

    chrome.storage.sync.set(cfg, () => {
        $("status").textContent = "Saved.";
        setTimeout(() => ($("status").textContent = ""), 1500);
    });
}

function reset() {
    chrome.storage.sync.set(DEFAULTS, load);
}

// Enable/disable fieldsets based on master switch
function reflectFiltersEnabledState() {
    const on = $("filtersEnabled").checked;
    setDisabled($("fs-size"), !on);
    setDisabled($("fs-domain"), !on);
    setDisabled($("fs-ext-mime"), !on);
    setDisabled($("fs-url"), !on);
}

// ---------- Wire up ----------

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    load();

    document.addEventListener("click", (e) => {
        if (e.target.id === "save") save();
        if (e.target.id === "reset") reset();
    });

    $("filtersEnabled").addEventListener("change", reflectFiltersEnabledState);
});
