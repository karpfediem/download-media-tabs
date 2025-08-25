import { DEFAULT_SETTINGS } from './constants.js';

export async function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
}
