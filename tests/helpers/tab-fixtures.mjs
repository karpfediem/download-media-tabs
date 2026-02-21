let nextId = 1;

export function resetTabIds() {
  nextId = 1;
}

export function tab(overrides = {}) {
  const id = overrides.id != null ? overrides.id : nextId++;
  return {
    id,
    url: overrides.url || `https://example.com/${id}.jpg`,
    windowId: overrides.windowId != null ? overrides.windowId : 1,
    index: overrides.index != null ? overrides.index : 0,
    active: !!overrides.active,
    highlighted: !!overrides.highlighted,
    groupId: overrides.groupId != null ? overrides.groupId : -1,
    status: overrides.status || "complete",
    ...overrides
  };
}
