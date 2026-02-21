import { REASONS } from "./reasons.js";

export function shouldSkipTask(reason) {
  return reason === REASONS.FILTERED ||
    reason === REASONS.SIZE_FILTER ||
    reason === REASONS.NO_SITE_ACCESS ||
    reason === REASONS.PROBE_FAILED;
}

export function failureUpdate(reason, { retryOnComplete = false } = {}) {
  const safeReason = reason || REASONS.NO_DOWNLOAD;
  if (shouldSkipTask(safeReason)) {
    return { action: "remove" };
  }
  return {
    action: "update",
    status: retryOnComplete ? "pending" : "failed",
    lastError: retryOnComplete ? REASONS.NO_DOWNLOAD : safeReason
  };
}

export function interruptedUpdate() {
  return {
    action: "update",
    status: "failed",
    lastError: REASONS.INTERRUPTED
  };
}
