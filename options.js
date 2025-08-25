const DEFAULTS = {
    includeImages: true,
    includeVideo: true,
    includeAudio: true,
    includePdf: true,
    scope: "currentWindow",
    filenamePattern: "Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}",
    closeTabAfterDownload: false
};

const $ = (id) => document.getElementById(id);

function load() {
    chrome.storage.sync.get(DEFAULTS, (cfg) => {
        $("includeImages").checked = !!cfg.includeImages;
        $("includeVideo").checked = !!cfg.includeVideo;
        $("includeAudio").checked = !!cfg.includeAudio;
        $("includePdf").checked = !!cfg.includePdf;
        $("scope").value = cfg.scope || "currentWindow";
        $("filenamePattern").value = cfg.filenamePattern || DEFAULTS.filenamePattern;
        $("closeTabAfterDownload").checked = !!cfg.closeTabAfterDownload;
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
        closeTabAfterDownload: $("closeTabAfterDownload").checked
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
