export function resetDownloadsState(downloadsState) {
  if (!downloadsState) return;
  downloadsState.downloadIdToMeta.clear();
  downloadsState.pendingSizeConstraints.clear();
}
