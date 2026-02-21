const TASKS_KEY = "dmtTasks";

export async function resetTasksStorage() {
  try {
    if (globalThis.chrome?.storage?.local?.set) {
      await globalThis.chrome.storage.local.set({ [TASKS_KEY]: [] });
    }
  } catch {}
}
