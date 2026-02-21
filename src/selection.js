import { tabsQuery } from "./chromeApi.js";

export async function selectCandidateTabs(mode) {
  switch (mode) {
    case "allWindows": {
      return tabsQuery({});
    }
    case "selectedTabs": {
      // Tabs multi-selection uses the `highlighted` property
      const selected = await tabsQuery({ currentWindow: true, highlighted: true });
      // Fallback: if none highlighted, default to current window
      return (selected && selected.length) ? selected : tabsQuery({ currentWindow: true });
    }
    case "leftOfActive":
    case "rightOfActive":
    case "currentGroup":
    case "currentWindow":
    default: {
      const windowTabs = await tabsQuery({ currentWindow: true });
      if (mode === "currentWindow") return windowTabs;

      const [activeTab] = windowTabs.filter(t => t.active);
      if (!activeTab) return [];

      if (mode === "currentGroup") {
        if (typeof activeTab.groupId === "number" && activeTab.groupId !== -1) {
          return tabsQuery({ currentWindow: true, groupId: activeTab.groupId });
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
