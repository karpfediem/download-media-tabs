const DEFAULTS = {
    includeImages: true,
    includeVideo: true,
    includeAudio: true,
    includePdf: true,
    scope: "currentWindow",
    filenamePattern: "Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}",
    closeTabAfterDownload: false,
    probeConcurrency: 8,
    downloadConcurrency: 6
};

const $ = (id) => document.getElementById(id);

function clampInt(v, lo, hi, dflt) {
    const n = (v | 0);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
}

function load() {
    chrome.storage.sync.get(DEFAULTS, (cfg) => {
        $("includeImages").checked = !!cfg.includeImages;
        $("includeVideo").checked = !!cfg.includeVideo;
        $("includeAudio").checked = !!cfg.includeAudio;
        $("includePdf").checked = !!cfg.includePdf;
        $("scope").value = cfg.scope || "currentWindow";
        $("filenamePattern").value = cfg.filenamePattern || DEFAULTS.filenamePattern;
        $("closeTabAfterDownload").checked = !!cfg.closeTabAfterDownload;
        $("probeConcurrency").value = clampInt(cfg.probeConcurrency, 1, 32, DEFAULTS.probeConcurrency);
        $("downloadConcurrency").value = clampInt(cfg.downloadConcurrency, 1, 32, DEFAULTS.downloadConcurrency);
    });
}

function save() {
    const cfg = {
        includeImages: $("includeImages").checked,
        includeVideo: $("includeVideo").checked,
        includeAudio: $("includeAudio").checked,
        includePdf: $("includePdf").checked,
        scope: $("scope").value,
        filenamePattern: $("filenamePattern").value.trim() || DEFAULTS.filenamePattern,
        closeTabAfterDownload: $("closeTabAfterDownload").checked,
        probeConcurrency: clampInt(parseInt($("probeConcurrency").value, 10), 1, 32, DEFAULTS.probeConcurrency),
        downloadConcurrency: clampInt(parseInt($("downloadConcurrency").value, 10), 1, 32, DEFAULTS.downloadConcurrency)
    };
    chrome.storage.sync.set(cfg, () => {
        $("status").textContent = "Saved.";
        setTimeout(() => $("status").textContent = "", 1500);
    });
}

function reset() {
    chrome.storage.sync.set(DEFAULTS, load);
}

document.addEventListener("DOMContentLoaded", load);
document.addEventListener("click", (e) => {
    if (e.target.id === "save") save();
    if (e.target.id === "reset") reset();
});
