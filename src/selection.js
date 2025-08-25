export async function selectCandidateTabs(mode) {
  switch (mode) {
    case "allWindows": {
      return chrome.tabs.query({});
    }
    case "leftOfActive":
    case "rightOfActive":
    case "currentGroup":
    case "currentWindow":
    default: {
      const windowTabs = await chrome.tabs.query({ currentWindow: true });
      if (mode === "currentWindow") return windowTabs;

      const [activeTab] = windowTabs.filter(t => t.active);
      if (!activeTab) return [];

      if (mode === "currentGroup") {
        if (typeof activeTab.groupId === "number" && activeTab.groupId !== -1) {
          return chrome.tabs.query({ currentWindow: true, groupId: activeTab.groupId });
        }
        return [];
      }

      if (mode === "leftOfActive") {
        return windowTabs.filter(t => t.index <= activeTab.index);
      }
      if (mode === "rightOfActive") {
        return windowTabs.filter(t => t.index >= activeTab.index);
      }
      return windowTabs;
    }
  }
}
