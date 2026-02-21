export async function isFileSchemeAllowed() {
  try {
    if (!chrome?.extension?.isAllowedFileSchemeAccess) return false;
    return await new Promise(resolve => {
      chrome.extension.isAllowedFileSchemeAccess((allowed) => resolve(!!allowed));
    });
  } catch {
    return false;
  }
}
