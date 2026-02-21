import { isFileSchemeAllowed as chromeIsFileSchemeAllowed } from "./chromeApi.js";

export async function isFileSchemeAllowed() {
  try {
    return await chromeIsFileSchemeAllowed();
  } catch {
    return false;
  }
}
