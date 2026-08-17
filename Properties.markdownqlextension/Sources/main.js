const states = new Map();

function capabilityContext(request) {
  const value = request.context && request.context.state && request.context.state.capabilityContext;
  if (!value || !value.windowHandle) throw new Error("Properties requires an active window scope.");
  return value;
}

async function capability(request, operation, parameters, directAction) {
  const context = capabilityContext(request);
  return markdownql.capabilities.request({
    windowHandle: context.windowHandle,
    windowGeneration: context.windowGeneration,
    workspaceGeneration: context.workspaceGeneration,
    documentGeneration: context.documentGeneration,
    capabilityID: "properties",
    operation,
    parameters: parameters || {},
    userActionToken: directAction ? context.userActionToken : undefined
  });
}

function localState(request) {
  const id = request.context.identity.contributionID;
  if (!states.has(id)) states.set(id, {
    snapshot: null, page: null, drafts: new Map(), newKey: "", newValue: "",
    newKind: "text", filterKey: "", filterValue: "", filterOperation: "contains",
    sortKey: "", sortDirection: "ascending"
  });
  return states.get(id);
}

function isDocument(request) {
  return request.context.identity.contributionID === "properties.pinned-summary";
}

function displayValue(value) {
  if (!value) return "";
  if (value.text != null) return value.text;
  if (value.strings != null) return value.strings.join(", ");
  if (value.number != null) return String(value.number);
  if (value.bool != null) return value.bool ? "true" : "false";
  return "";
}

function descriptor(kind, text) {
  if (kind === "list" || kind === "tags") return { kind, strings: text.split(",").map(value => value.trim()).filter(Boolean) };
  if (kind === "number") return { kind, number: Number(text) };
  if (kind === "bool") return { kind, bool: ["true", "yes", "1"].includes(text.toLowerCase()) };
  return { kind, text };
}

function propertyRow(property, local) {
  const key = property.key;
  const value = local.drafts.has(key) ? local.drafts.get(key) : displayValue(property.value);
  const children = [{ id: `property-label-${key}`, type: "label", text: key, systemImage: null }];
  if (property.isEditable) {
    children.push({ id: `property-value-${key}`, type: "text-field", value, placeholder: "Value" });
    children.push({ id: `property-save-${key}`, type: "action-button", title: "Save", actionID: "save-property", arguments: { key, kind: property.value.kind } });
    children.push({ id: `property-remove-${key}`, type: "action-button", title: "Remove", actionID: "remove-property", arguments: { key } });
  } else {
    children.push({ id: `property-readonly-${key}`, type: "text", text: value });
  }
  return { id: `property-${key}`, type: "row", children };
}

function documentTree(local) {
  const properties = local.snapshot ? local.snapshot.properties : [];
  const children = properties.map(property => propertyRow(property, local));
  children.push({ id: "property-new-key", type: "text-field", value: local.newKey, placeholder: "Property name" });
  children.push({ id: "property-new-kind", type: "picker", title: "Type", selection: local.newKind, options: ["text", "list", "number", "bool", "date", "tags"].map(id => ({ id, title: id })) });
  children.push({ id: "property-new-value", type: "text-field", value: local.newValue, placeholder: "Value" });
  children.push({ id: "property-add", type: "action-button", title: "Add Property", actionID: "add-property", arguments: {} });
  return { id: "properties-document-root", type: "column", children };
}

function collectionTree(local) {
  const rows = local.page ? local.page.rows : [];
  const controls = [
    { id: "properties-filter-key", type: "text-field", value: local.filterKey, placeholder: "Filter property" },
    { id: "properties-filter-operation", type: "picker", title: "Filter", selection: local.filterOperation, options: ["contains", "equals", "exists"].map(id => ({ id, title: id })) },
    { id: "properties-filter-value", type: "text-field", value: local.filterValue, placeholder: "Filter value" },
    { id: "properties-sort-key", type: "text-field", value: local.sortKey, placeholder: "Sort property" },
    { id: "properties-sort-direction", type: "picker", title: "Order", selection: local.sortDirection, options: ["ascending", "descending"].map(id => ({ id, title: id })) },
    { id: "properties-query", type: "action-button", title: "Apply", actionID: "query", arguments: {} }
  ];
  if (rows.length === 0) controls.push({ id: "properties-empty", type: "empty-state", title: "No matching documents", detail: null, systemImage: "tablecells" });
  else controls.push({
    id: "properties-list", type: "virtualized-list",
    items: rows.map(row => ({
      id: `properties-row-${row.documentHandle.rawValue}`, type: "action-button",
      title: `${row.title}${row.rootName ? ` — ${row.rootName}` : ""} · ${Object.entries(row.properties).map(([key, value]) => `${key}: ${displayValue(value)}`).join(" · ")}`,
      actionID: "open-document", arguments: { documentHandle: row.documentHandle }
    })),
    page: { cursor: local.page.nextCursor || null, hasMore: Boolean(local.page.nextCursor) }
  });
  return { id: "properties-collection-root", type: "column", children: controls };
}

async function refresh(request, cursor) {
  const local = localState(request);
  if (isDocument(request)) local.snapshot = await capability(request, "document-snapshot", {}, false);
  else {
    const page = await capability(request, "collection-query", {
      key: local.filterKey || null, value: local.filterValue || null,
      filterOperation: local.filterKey ? local.filterOperation : null,
      sortKey: local.sortKey || null, sortDirection: local.sortKey ? local.sortDirection : null,
      cursor: cursor || null, limit: 50
    }, false);
    local.page = cursor && local.page ? { ...page, rows: [...local.page.rows, ...page.rows] } : page;
  }
}

async function render(request) {
  await refresh(request, null);
  const local = localState(request);
  return isDocument(request) ? documentTree(local) : collectionTree(local);
}

async function handleEvent(request) {
  const local = localState(request);
  const changed = request.event && request.event.fieldChanged;
  if (changed) {
    if (request.nodeID === "property-new-key") local.newKey = changed.value;
    else if (request.nodeID === "property-new-value") local.newValue = changed.value;
    else if (request.nodeID === "properties-filter-key") local.filterKey = changed.value;
    else if (request.nodeID === "properties-filter-value") local.filterValue = changed.value;
    else if (request.nodeID === "properties-sort-key") local.sortKey = changed.value;
    else if (request.nodeID.startsWith("property-value-")) local.drafts.set(request.nodeID.slice("property-value-".length), changed.value);
  }
  const selected = request.event && request.event.selectionChanged;
  if (selected) {
    if (request.nodeID === "property-new-kind") local.newKind = selected.value;
    if (request.nodeID === "properties-filter-operation") local.filterOperation = selected.value;
    if (request.nodeID === "properties-sort-direction") local.sortDirection = selected.value;
  }
  if (request.event && request.event.loadNextPage) await refresh(request, request.event.loadNextPage.cursor);
  const action = request.event && request.event.action;
  if (action) {
    if (action.actionID === "save-property") await capability(request, "upsert", { revision: local.snapshot.revision, key: action.arguments.key, value: descriptor(action.arguments.kind, local.drafts.get(action.arguments.key) || "") }, true);
    if (action.actionID === "remove-property") await capability(request, "remove", { revision: local.snapshot.revision, key: action.arguments.key, value: null }, true);
    if (action.actionID === "add-property" && local.newKey) {
      await capability(request, "upsert", { revision: local.snapshot.revision, key: local.newKey, value: descriptor(local.newKind, local.newValue) }, true);
      local.newKey = ""; local.newValue = "";
    }
    if (action.actionID === "query") await refresh(request, null);
    if (action.actionID === "open-document") await capability(request, "open-document", action.arguments, true);
    if (isDocument(request)) await refresh(request, null);
  }
  return { root: isDocument(request) ? documentTree(local) : collectionTree(local) };
}

for (const id of ["properties.pinned-summary", "properties.workspace-home", "properties.collection"]) {
  markdownql.registerSurface(id, render, handleEvent);
}
