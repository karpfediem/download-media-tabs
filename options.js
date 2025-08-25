const DEFAULTS = {
    includeImages: true,
    includeVideo: true,
    includeAudio: true,
    includePdf: true,
    scope: "currentWindow",
    filenamePattern: "Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}",
    closeTabAfterDownload: false,
    probeConcurrency: 8,
    downloadConcurrency: 6,
    strictSingleDetection: true,
    coverageThreshold: 0.5,
    keepWindowOpenOnLastTabClose: false
};

const $ = (id) => document.getElementById(id);

function clampInt(v, lo, hi, dflt) {
    const n = (v | 0);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
}

function clampFloat(v, lo, hi, dflt) {
    const n = Number(v);
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

        $("probeConcurrency").value = clampInt(cfg.probeConcurrency, 1, 32, DEFAULTS.probeConcurrency);
        $("downloadConcurrency").value = clampInt(cfg.downloadConcurrency, 1, 32, DEFAULTS.downloadConcurrency);

        $("strictSingleDetection").checked = cfg.strictSingleDetection !== false;
        $("coverageThreshold").value = clampFloat(cfg.coverageThreshold, 0, 1, DEFAULTS.coverageThreshold);

        $("closeTabAfterDownload").checked = !!cfg.closeTabAfterDownload;
        $("keepWindowOpenOnLastTabClose").checked = !!cfg.keepWindowOpenOnLastTabClose;
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

        probeConcurrency: clampInt(parseInt($("probeConcurrency").value, 10), 1, 32, DEFAULTS.probeConcurrency),
        downloadConcurrency: clampInt(parseInt($("downloadConcurrency").value, 10), 1, 32, DEFAULTS.downloadConcurrency),

        strictSingleDetection: $("strictSingleDetection").checked,
        coverageThreshold: clampFloat(parseFloat($("coverageThreshold").value), 0, 1, DEFAULTS.coverageThreshold),

        closeTabAfterDownload: $("closeTabAfterDownload").checked,
        keepWindowOpenOnLastTabClose: $("keepWindowOpenOnLastTabClose").checked
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
