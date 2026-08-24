const states = new Map();
const maximumStateCount = 32;
const noSelection = "__none__";

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

function contribution(request) { return request.context.identity.contributionID; }
function isDocument(request) { return contribution(request) === "properties.pinned-summary"; }
function isHome(request) { return contribution(request) === "properties.workspace-home"; }

function generationValue(request, name) {
  const state = request.context && request.context.state || {};
  if (state[name] != null) return state[name];
  const context = state.capabilityContext || {};
  return context[name] != null ? context[name] : "none";
}

function stateIdentity(request) {
  const identity = request.context.identity;
  return [
    identity.windowID || "window",
    generationValue(request, "windowGeneration"),
    generationValue(request, "workspaceGeneration"),
    isDocument(request) ? generationValue(request, "documentGeneration") : "workspace",
    identity.scopeGeneration,
    identity.contributionID
  ].join(":");
}

function makeState(request) {
  return {
    id: stateIdentity(request),
    snapshot: null, page: null,
    drafts: new Map(), statuses: new Map(), kindsByKey: new Map(),
    pendingRemoval: null, operationSequence: 0,
    newKey: "", newValue: "", newKind: "text", newStatus: null, error: null,
    filters: [], filterKey: "", filterValue: "", filterOperation: "contains",
    sortKey: "", sortDirection: "ascending"
  };
}

function localState(request) {
  const id = stateIdentity(request);
  if (!states.has(id)) {
    states.set(id, makeState(request));
    while (states.size > maximumStateCount) states.delete(states.keys().next().value);
  }
  return states.get(id);
}

function operation(local) {
  local.operationSequence += 1;
  return local.operationSequence;
}

function isCurrent(local, sequence) {
  return states.get(local.id) === local && local.operationSequence === sequence;
}

function strings(request) {
  const state = request.context && request.context.state || {};
  const locale = state.localeIdentifier || state.locale;
  const zh = typeof locale === "string" && locale.toLowerCase().startsWith("zh");
  return zh ? {
    editorTitle: "文档属性", emptyEditor: "尚无 Front Matter 属性。", browse: "浏览工作区",
    add: "添加属性", key: "键", value: "值", remove: "删除属性", readOnly: "只读",
    save: "保存", discard: "放弃", refresh: "刷新", cancel: "取消", confirmRemove: "确认删除",
    comma: "使用逗号分隔", invalidNumber: "请输入有效数字。", invalidDate: "请输入 YYYY-MM-DD 格式的有效日期。",
    documentUnavailable: "暂时无法读取文档属性。", collectionTitle: "属性集合",
    empty: "没有匹配的文档", emptyDetail: "请添加 Front Matter 属性或移除筛选条件。",
    chooseKey: "选择属性", operation: "条件", addFilter: "添加筛选", sort: "排序",
    noSort: "不排序", ascending: "升序", descending: "降序", done: "完成",
    conflict: "文档已在其他位置发生变化。草稿尚未丢失。",
    saveFailed: "未能保存属性。草稿尚未丢失。",
    removePrompt: key => `确认删除属性“${key}”？`,
    removeFailed: "未能删除属性；原值仍然保留。",
    collectionFailed: "未能更新属性集合，请重试。",
    documentCount: count => `${count} 个文档`,
    types: { text: "文本", list: "列表", number: "数字", bool: "布尔", date: "日期", tags: "标签" },
    operations: { exists: "存在", equals: "等于", notEquals: "不等于", contains: "包含", greaterThan: "大于", lessThan: "小于", before: "早于", after: "晚于" }
  } : {
    editorTitle: "Document properties", emptyEditor: "No front matter properties yet.", browse: "Browse workspace",
    add: "Add property", key: "Key", value: "Value", remove: "Remove property", readOnly: "Read-only",
    save: "Save", discard: "Discard", refresh: "Refresh", cancel: "Cancel", confirmRemove: "Remove",
    comma: "Comma-separated values", invalidNumber: "Enter a valid number.", invalidDate: "Enter a valid date in YYYY-MM-DD format.",
    documentUnavailable: "Document properties are temporarily unavailable.", collectionTitle: "Property Collection",
    empty: "No matching documents", emptyDetail: "Add front matter properties or remove filters.",
    chooseKey: "Choose property", operation: "Operation", addFilter: "Add Filter", sort: "Sort",
    noSort: "No sorting", ascending: "Ascending", descending: "Descending", done: "Done",
    conflict: "The document changed elsewhere. Your draft is still available.",
    saveFailed: "The property could not be saved. Your draft is still available.",
    removePrompt: key => `Remove the “${key}” property?`,
    removeFailed: "The property could not be removed and its original value is still available.",
    collectionFailed: "The property collection could not be updated. Try again.",
    documentCount: count => `${count} document${count === 1 ? "" : "s"}`,
    types: { text: "Text", list: "List", number: "Number", bool: "Boolean", date: "Date", tags: "Tags" },
    operations: { exists: "Exists", equals: "Equals", notEquals: "Does not equal", contains: "Contains", greaterThan: "Greater than", lessThan: "Less than", before: "Before", after: "After" }
  };
}

function displayValue(value) {
  if (!value) return "";
  if (value.text != null) return value.text;
  if (value.strings != null) return value.strings.join(", ");
  if (value.number != null) return Number.isInteger(value.number) ? String(Math.trunc(value.number)) : String(value.number);
  if (value.bool != null) return value.bool ? "true" : "false";
  return "";
}

function commaValues(text) { return text.split(",").map(value => value.trim()).filter(Boolean); }

function isValidDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return false;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function descriptor(kind, text) {
  if (kind === "list" || kind === "tags") return { kind, strings: commaValues(text) };
  if (kind === "number") {
    const number = Number(text);
    return Number.isFinite(number) && text.trim() !== "" ? { kind, number } : null;
  }
  if (kind === "date") return isValidDate(text) ? { kind, text: text.trim() } : null;
  if (kind === "bool") return { kind, bool: ["true", "yes", "1"].includes(text.toLowerCase()) };
  return { kind, text };
}

function propertyEditor(property, value, copy) {
  const id = `property-value-${property.key}`;
  if (property.value.kind === "bool") return { id, type: "toggle", title: property.key, isOn: value === "true" };
  return {
    id, type: "text-field", value,
    placeholder: property.value.kind === "date" ? "YYYY-MM-DD" : ((property.value.kind === "list" || property.value.kind === "tags") ? copy.comma : null)
  };
}

function validationMessage(kind, copy) {
  return kind === "date" ? copy.invalidDate : copy.invalidNumber;
}

function recoveryNodes(key, status, kind, copy) {
  if (status === "conflict") return [{
    id: `property-conflict-${key}`, type: "error", title: copy.conflict, detail: null
  }, {
    id: `property-refresh-${key}`, type: "action-button", title: copy.refresh,
    actionID: "refresh-property", arguments: { key }
  }];
  if (status === "failure") return [{
    id: `property-error-${key}`, type: "error", title: copy.saveFailed, detail: null
  }];
  if (status === "invalid") return [{
    id: `property-error-${key}`, type: "error", title: validationMessage(kind, copy), detail: null
  }];
  return [];
}

function removalConfirmation(key, local, copy) {
  if (!local.pendingRemoval || local.pendingRemoval.key !== key) return null;
  return {
    id: `property-remove-confirmation-${key}`, type: "card", children: [
      { id: `property-remove-prompt-${key}`, type: "text", text: copy.removePrompt(key) },
      { id: `property-remove-actions-${key}`, type: "row", children: [
        { id: `property-remove-confirm-${key}`, type: "action-button", title: copy.confirmRemove, actionID: "confirm-remove-property", arguments: { key } },
        { id: `property-remove-cancel-${key}`, type: "action-button", title: copy.cancel, actionID: "cancel-remove-property", arguments: { key } }
      ] }
    ]
  };
}

function propertyRow(property, local, copy) {
  const key = property.key;
  const value = local.drafts.has(key) ? local.drafts.get(key) : displayValue(property.value);
  const status = local.statuses.get(key);
  const header = [{ id: `property-label-${key}`, type: "label", text: key, systemImage: null }];
  if (property.isEditable) header.push({ id: `property-remove-${key}`, type: "action-button", title: "−", actionID: "remove-property", arguments: { key }, accessibilityLabel: copy.remove });
  else header.push({ id: `property-readonly-label-${key}`, type: "badge", text: copy.readOnly });
  const children = [{ id: `property-header-${key}`, type: "row", children: header }];
  children.push(property.isEditable ? propertyEditor(property, value, copy) : { id: `property-readonly-${key}`, type: "text", text: value });
  if (property.isEditable && local.drafts.has(key)) {
    children.push({ id: `property-draft-actions-${key}`, type: "row", children: [
      { id: `property-save-${key}`, type: "action-button", title: copy.save, actionID: "save-property", arguments: { key } },
      { id: `property-discard-${key}`, type: "action-button", title: copy.discard, actionID: "discard-property", arguments: { key } }
    ] });
  }
  children.push(...recoveryNodes(key, status, property.value.kind, copy));
  const confirmation = removalConfirmation(key, local, copy);
  if (confirmation) children.push(confirmation);
  return { id: `property-${key}`, type: "card", children };
}

function documentTree(request, local) {
  const copy = strings(request);
  const properties = local.snapshot ? local.snapshot.properties : [];
  const children = [{
    id: "properties-editor-header", type: "row", children: [
      { id: "properties-editor-title", type: "text", text: copy.editorTitle },
      { id: "properties-browse-collection", type: "action-button", title: copy.browse, actionID: "present-collection", arguments: {} }
    ]
  }];
  if (!local.snapshot) {
    children.push({
      id: "properties-document-unavailable", type: "error",
      title: local.error || copy.documentUnavailable, detail: null
    });
    return { id: "properties-document-root", type: "column", children };
  }
  if (properties.length === 0) children.push({ id: "properties-editor-empty", type: "text", text: copy.emptyEditor });
  else children.push(...properties.map(property => propertyRow(property, local, copy)));
  children.push({ id: "properties-add-title", type: "text", text: copy.add });
  children.push({ id: "properties-add-key-row", type: "row", children: [
    { id: "property-new-key", type: "text-field", value: local.newKey, placeholder: copy.key },
    { id: "property-new-kind", type: "picker", title: null, selection: local.newKind, options: Object.keys(copy.types).map(id => ({ id, title: copy.types[id] })) }
  ] });
  children.push({ id: "properties-add-value-row", type: "row", children: [
    { id: "property-new-value", type: "text-field", value: local.newValue, placeholder: copy.value },
    { id: "property-add", type: "action-button", title: "+", actionID: "add-property", arguments: {}, accessibilityLabel: copy.add }
  ] });
  if (local.newStatus === "conflict") {
    children.push({ id: "property-new-conflict", type: "error", title: copy.conflict, detail: null });
    children.push({ id: "property-new-recovery", type: "row", children: [
      { id: "property-new-refresh", type: "action-button", title: copy.refresh, actionID: "refresh-new-property", arguments: {} },
      { id: "property-new-discard", type: "action-button", title: copy.discard, actionID: "discard-new-property", arguments: {} }
    ] });
  } else if (local.newStatus === "failure") {
    children.push({ id: "property-new-error", type: "error", title: copy.saveFailed, detail: null });
  }
  if (local.error) children.push({ id: "properties-editor-error", type: "error", title: local.error, detail: null });
  return { id: "properties-document-root", type: "column", children };
}

function homeTree(request, local) {
  const copy = strings(request);
  const count = local.page ? local.page.totalCount : 0;
  return {
    id: "properties-home-root", type: "section", title: copy.collectionTitle, children: [{
      id: "properties-open-collection", type: "action-button", title: `${copy.browse} · ${copy.documentCount(count)}`,
      actionID: "present-collection", arguments: {}, nodeSystemImage: "tablecells"
    }]
  };
}

function typedFilter(local) {
  if (local.filterOperation === "exists") return null;
  const kind = local.kindsByKey.get(local.filterKey) || "text";
  return descriptor(kind === "unsupported" ? "text" : kind, local.filterValue);
}

function filterControls(local, copy) {
  const keys = local.page ? local.page.propertyKeys : [];
  const controls = [{
    id: "properties-filter-key", type: "picker", title: copy.key, selection: local.filterKey || noSelection,
    options: [{ id: noSelection, title: copy.chooseKey }, ...keys.map(id => ({ id, title: id }))]
  }, {
    id: "properties-filter-operation", type: "picker", title: copy.operation, selection: local.filterOperation,
    options: Object.keys(copy.operations).map(id => ({ id, title: copy.operations[id] }))
  }];
  if (local.filterOperation !== "exists") controls.push({ id: "properties-filter-value", type: "text-field", value: local.filterValue, placeholder: copy.value });
  controls.push({ id: "properties-add-filter", type: "action-button", title: copy.addFilter, actionID: "add-filter", arguments: {} });
  return { id: "properties-filter-controls", type: "row", children: controls };
}

function filterChips(local, copy) {
  if (local.filters.length === 0) return null;
  return {
    id: "properties-filter-chips", type: "row", children: local.filters.map((filter, index) => ({
      id: `properties-filter-chip-${index}`, type: "action-button", title: `× ${filter.key} · ${copy.operations[filter.operation]}`,
      actionID: "remove-filter", arguments: { index }
    }))
  };
}

function sortControls(local, copy) {
  const keys = local.page ? local.page.propertyKeys : [];
  return { id: "properties-sort-controls", type: "row", children: [{
    id: "properties-sort-key", type: "picker", title: copy.sort, selection: local.sortKey || noSelection,
    options: [{ id: noSelection, title: copy.noSort }, ...keys.map(id => ({ id, title: id }))]
  }, {
    id: "properties-sort-direction", type: "picker", title: null, selection: local.sortDirection,
    options: [{ id: "ascending", title: copy.ascending }, { id: "descending", title: copy.descending }]
  }] };
}

function collectionRow(row) {
  const detail = Object.keys(row.properties).sort().map(key => `${key}: ${displayValue(row.properties[key])}`).join(" · ");
  return {
    id: `properties-row-${row.documentHandle.rawValue}`, type: "action-button", title: row.title,
    nodeSubtitle: row.relativePath, nodeDetail: detail,
    actionID: "open-document", arguments: { documentHandle: row.documentHandle }, nodeSystemImage: "doc.text"
  };
}

function collectionTree(request, local) {
  const copy = strings(request);
  const rows = local.page ? local.page.rows : [];
  const count = local.page ? local.page.totalCount : 0;
  const children = [{
    id: "properties-collection-header", type: "row", children: [
      { id: "properties-collection-count", type: "text", text: copy.documentCount(count) },
      { id: "properties-collection-done", type: "action-button", title: copy.done, actionID: "close-collection", arguments: {} }
    ]
  }, filterControls(local, copy)];
  const chips = filterChips(local, copy);
  if (chips) children.push(chips);
  children.push(sortControls(local, copy));
  if (local.error) children.push({ id: "properties-collection-error", type: "error", title: local.error, detail: null });
  if (rows.length === 0) children.push({ id: "properties-empty", type: "empty-state", title: copy.empty, detail: copy.emptyDetail, systemImage: "tablecells" });
  else children.push({ id: "properties-list", type: "virtualized-list", items: rows.map(collectionRow), page: { cursor: local.page.nextCursor || null, hasMore: Boolean(local.page.nextCursor) } });
  return { id: "properties-collection-root", type: "page", title: copy.collectionTitle, children };
}

function tree(request, local) {
  if (isDocument(request)) return documentTree(request, local);
  if (isHome(request)) return homeTree(request, local);
  return collectionTree(request, local);
}

async function refreshDocument(request, local) {
  const sequence = operation(local);
  const snapshot = await capability(request, "document-snapshot", {}, false);
  if (isCurrent(local, sequence)) local.snapshot = snapshot;
}

async function safeRefreshDocument(request, local) {
  try {
    await refreshDocument(request, local);
    local.error = null;
    return true;
  } catch (error) {
    local.error = error && error.message || strings(request).saveFailed;
    return false;
  }
}

async function refreshCollection(request, local, cursor) {
  const sequence = operation(local);
  try {
    const page = await capability(request, "collection-query", {
      filters: local.filters, sortKey: local.sortKey || null,
      sortDirection: local.sortKey ? local.sortDirection : null,
      cursor: cursor || null, limit: isHome(request) ? 1 : 50
    }, false);
    if (!isCurrent(local, sequence)) return;
    if (!cursor) {
      local.kindsByKey.clear();
      for (const row of page.rows) for (const [key, value] of Object.entries(row.properties)) local.kindsByKey.set(key, value.kind);
    }
    local.page = cursor && local.page ? { ...page, rows: [...local.page.rows, ...page.rows] } : page;
    local.error = null;
  } catch (error) {
    if (isCurrent(local, sequence)) local.error = strings(request).collectionFailed;
  }
}

async function render(request) {
  const local = localState(request);
  if (isDocument(request)) await safeRefreshDocument(request, local);
  else await refreshCollection(request, local, null);
  return tree(request, local);
}

function clearPropertyState(local, key) {
  local.drafts.delete(key);
  local.statuses.delete(key);
  if (local.pendingRemoval && local.pendingRemoval.key === key) local.pendingRemoval = null;
}

async function saveProperty(request, local, key) {
  const property = local.snapshot && local.snapshot.properties.find(item => item.key === key);
  if (!property || !local.drafts.has(key)) return;
  const value = descriptor(property.value.kind, local.drafts.get(key));
  if (!value) {
    local.statuses.set(key, "invalid");
    return;
  }
  const sequence = operation(local);
  local.statuses.set(key, "saving");
  try {
    const snapshot = await capability(request, "upsert", { revision: local.snapshot.revision, key, value }, true);
    if (!isCurrent(local, sequence)) return;
    local.snapshot = snapshot;
    clearPropertyState(local, key);
    local.error = null;
  } catch (error) {
    if (!isCurrent(local, sequence)) return;
    local.statuses.set(key, error && error.code === "stale-revision" ? "conflict" : "failure");
  }
}

async function saveBoolean(request, local, key, isOn) {
  local.drafts.set(key, isOn ? "true" : "false");
  await saveProperty(request, local, key);
  if (local.statuses.get(key) === "failure") {
    if (await safeRefreshDocument(request, local)) clearPropertyState(local, key);
  }
}

async function addProperty(request, local) {
  const key = local.newKey.trim();
  if (!key) return;
  const value = descriptor(local.newKind, local.newValue);
  if (!value) {
    local.error = validationMessage(local.newKind, strings(request));
    local.newStatus = "invalid";
    return;
  }
  if (!local.snapshot) {
    local.error = strings(request).documentUnavailable;
    return;
  }
  const sequence = operation(local);
  local.newStatus = "saving";
  try {
    const snapshot = await capability(request, "upsert", { revision: local.snapshot.revision, key, value }, true);
    if (!isCurrent(local, sequence)) return;
    local.snapshot = snapshot;
    local.newKey = "";
    local.newValue = "";
    local.newKind = "text";
    local.newStatus = null;
    local.error = null;
  } catch (error) {
    if (!isCurrent(local, sequence)) return;
    local.newStatus = error && error.code === "stale-revision" ? "conflict" : "failure";
    local.error = null;
  }
}

async function refreshNewProperty(request, local, preserveDraft) {
  if (await safeRefreshDocument(request, local)) {
    if (preserveDraft) {
      local.newStatus = "dirty";
    } else {
      local.newKey = "";
      local.newValue = "";
      local.newKind = "text";
      local.newStatus = null;
    }
  }
}

async function refreshProperty(request, local, key, preserveDraft) {
  const draft = local.drafts.get(key);
  if (await safeRefreshDocument(request, local)) {
    if (preserveDraft && draft != null) {
      local.drafts.set(key, draft);
      local.statuses.set(key, "dirty");
    } else {
      clearPropertyState(local, key);
    }
  }
}

async function confirmRemoval(request, local, key) {
  const pending = local.pendingRemoval;
  if (!pending || pending.key !== key) return;
  if (!local.snapshot || local.snapshot.revision !== pending.revision) {
    local.statuses.set(key, "conflict");
    local.pendingRemoval = null;
    return;
  }
  const sequence = operation(local);
  try {
    const snapshot = await capability(request, "remove", { revision: pending.revision, key, value: null }, true);
    if (!isCurrent(local, sequence)) return;
    local.snapshot = snapshot;
    clearPropertyState(local, key);
    local.error = null;
  } catch (error) {
    if (!isCurrent(local, sequence)) return;
    local.pendingRemoval = null;
    local.statuses.set(key, error && error.code === "stale-revision" ? "conflict" : "failure");
    local.error = strings(request).removeFailed;
  }
}

async function handleEvent(request) {
  const local = localState(request);
  const changed = request.event && request.event.fieldChanged;
  if (changed) {
    if (request.nodeID === "property-new-key") { local.newKey = changed.value; local.error = null; }
    else if (request.nodeID === "property-new-value") { local.newValue = changed.value; local.error = null; }
    else if (request.nodeID === "properties-filter-value") { local.filterValue = changed.value; local.error = null; }
    else if (request.nodeID.startsWith("property-value-")) {
      const key = request.nodeID.slice("property-value-".length);
      const property = local.snapshot && local.snapshot.properties.find(item => item.key === key);
      if (property && property.isEditable) {
        local.drafts.set(key, changed.value);
        local.statuses.set(key, descriptor(property.value.kind, changed.value) ? "dirty" : "invalid");
      }
    }
  }
  const toggled = request.event && request.event.toggled;
  if (toggled && request.nodeID.startsWith("property-value-")) {
    const key = request.nodeID.slice("property-value-".length);
    await saveBoolean(request, local, key, toggled.isOn);
  }
  const selected = request.event && request.event.selectionChanged;
  if (selected) {
    if (request.nodeID === "property-new-kind") { local.newKind = selected.value; local.error = null; }
    if (request.nodeID === "properties-filter-key") { local.filterKey = selected.value === noSelection ? "" : selected.value; local.error = null; }
    if (request.nodeID === "properties-filter-operation") { local.filterOperation = selected.value; local.error = null; }
    if (request.nodeID === "properties-sort-key") { local.sortKey = selected.value === noSelection ? "" : selected.value; await refreshCollection(request, local, null); }
    if (request.nodeID === "properties-sort-direction") { local.sortDirection = selected.value; await refreshCollection(request, local, null); }
  }
  if (request.event && request.event.loadNextPage) await refreshCollection(request, local, request.event.loadNextPage.cursor);
  const action = request.event && request.event.action;
  if (action) {
    const key = action.arguments && action.arguments.key;
    if (action.actionID === "save-property") await saveProperty(request, local, key);
    if (action.actionID === "discard-property") await refreshProperty(request, local, key, false);
    if (action.actionID === "refresh-property") await refreshProperty(request, local, key, true);
    if (action.actionID === "remove-property" && local.snapshot) local.pendingRemoval = { key, revision: local.snapshot.revision };
    if (action.actionID === "cancel-remove-property" && local.pendingRemoval && local.pendingRemoval.key === key) local.pendingRemoval = null;
    if (action.actionID === "confirm-remove-property") await confirmRemoval(request, local, key);
    if (action.actionID === "add-property") await addProperty(request, local);
    if (action.actionID === "refresh-new-property") await refreshNewProperty(request, local, true);
    if (action.actionID === "discard-new-property") await refreshNewProperty(request, local, false);
    if (action.actionID === "present-collection") await capability(request, "present-collection", {}, true);
    if (action.actionID === "close-collection") await capability(request, "close-collection", {}, true);
    if (action.actionID === "add-filter" && local.filterKey) {
      const value = typedFilter(local);
      if (local.filterOperation === "exists" || value) {
        local.filters.push({ key: local.filterKey, operation: local.filterOperation, value });
        local.filterValue = "";
        local.error = null;
        await refreshCollection(request, local, null);
      } else local.error = validationMessage(local.kindsByKey.get(local.filterKey), strings(request));
    }
    if (action.actionID === "remove-filter") { local.filters.splice(Number(action.arguments.index), 1); await refreshCollection(request, local, null); }
    if (action.actionID === "open-document") await capability(request, "open-document", action.arguments, true);
  }
  return { root: tree(request, local) };
}

for (const id of ["properties.pinned-summary", "properties.workspace-home", "properties.collection"]) markdownql.registerSurface(id, render, handleEvent);
