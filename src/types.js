/**
 * @typedef {Object} Filters
 * @property {number} minWidth
 * @property {number} minHeight
 * @property {number} maxWidth
 * @property {number} maxHeight
 * @property {number} minMegapixels
 * @property {number} maxMegapixels
 * @property {number} minBytes
 * @property {number} maxBytes
 * @property {string[]} allowedDomains
 * @property {string[]} blockedDomains
 * @property {string[]} allowedExtensions
 * @property {string[]} blockedExtensions
 * @property {string[]} allowedMime
 * @property {string[]} blockedMime
 * @property {string[]} includeUrlSubstrings
 * @property {string[]} excludeUrlSubstrings
 */

/**
 * @typedef {Object} Settings
 * @property {boolean} includeImages
 * @property {boolean} includeVideo
 * @property {boolean} includeAudio
 * @property {boolean} includePdf
 * @property {string} scope
 * @property {string} filenamePattern
 * @property {string} theme
 * @property {boolean} closeTabAfterDownload
 * @property {boolean} keepWindowOpenOnLastTabClose
 * @property {boolean} strictSingleDetection
 * @property {number} coverageThreshold
 * @property {boolean} inferExtensionFromUrl
 * @property {string[]} inferUrlAllowedExtensions
 * @property {string[]} triggerUrlSubstrings
 * @property {boolean} triggerBypassFilters
 * @property {number} probeConcurrency
 * @property {number} downloadConcurrency
 * @property {boolean} autoRunOnNewTabs
 * @property {string} autoRunTiming
 * @property {boolean} autoCloseOnStart
 * @property {number} autoRunPendingIntervalMin
 * @property {string[]} allowedOrigins
 * @property {boolean} filtersEnabled
 * @property {Filters} filters
 */

/**
 * @typedef {Object} ProbeResult
 * @property {string} contentType
 * @property {string} href
 * @property {string} protocol
 * @property {boolean} single
 * @property {string} src
 * @property {boolean} looksLikePdf
 * @property {number|undefined} imageWidth
 * @property {number|undefined} imageHeight
 */

/**
 * @typedef {Object} Decision
 * @property {boolean} shouldDownload
 * @property {string=} reason
 * @property {string=} downloadUrl
 * @property {string=} suggestedExt
 * @property {string=} baseName
 * @property {string=} mimeFromProbe
 * @property {boolean=} bypassFilters
 * @property {boolean=} triggered
 * @property {number|undefined=} imageWidth
 * @property {number|undefined=} imageHeight
 */

/**
 * @typedef {Object} Plan
 * @property {number=} tabId
 * @property {string} url
 * @property {string} host
 * @property {string} ext
 * @property {string} mime
 * @property {boolean} bypassFilters
 * @property {boolean} triggered
 * @property {string=} baseName
 * @property {number|undefined=} width
 * @property {number|undefined=} height
 * @property {string=} tabUrl
 */

/**
 * @typedef {Object} EvaluatedTab
 * @property {Object} tab
 * @property {boolean} ok
 * @property {string=} reason
 * @property {Plan=} plan
 */

/**
 * @typedef {Object} TaskEntry
 * @property {Object} tab
 * @property {Plan} plan
 * @property {Object} task
 * @property {boolean=} isDuplicate
 * @property {string=} groupKey
 */

export {};
