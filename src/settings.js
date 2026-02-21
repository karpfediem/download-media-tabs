import { DEFAULT_SETTINGS } from './constants.js';
import { storageSyncGet } from './chromeApi.js';

export async function getSettings() {
  return storageSyncGet(DEFAULT_SETTINGS);
}
