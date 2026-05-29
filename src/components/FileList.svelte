<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { tick } from "svelte";
  import { formatBytes, mapKindToTypeTab, summarizeTypeTabs, typeTabLabel } from "../js/detect.js";
  import FileItem from "./FileItem.svelte";

  export let files = [];
  export let busy = false;

  const dispatch = createEventDispatcher();

  let selectedIds = [];
  let lastToggleIndex = -1;
  let draggingId = "";
  let lastSelectionSignature = "";
  let groupedFiles = [];
  let collapsedGroups = {};
  let collapseStateReady = false;

  const COLLAPSE_STATE_KEY = "upkaran-filelist-collapsed-groups";

  onMount(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          collapsedGroups = parsed;
        }
      }
    } catch {
      // Ignore persisted state failures.
    } finally {
      collapseStateReady = true;
    }
  });

  $: {
    const valid = new Set(files.map((item) => item.id));
    const next = selectedIds.filter((id) => valid.has(id));
    if (next.length !== selectedIds.length) {
      selectedIds = next;
      emitSelectionChangeIfNeeded();
    }
  }

  $: {
    const rows = files.map((item, index) => ({ item, index }));
    const byTab = new Map();

    for (const row of rows) {
      const tab = mapKindToTypeTab(row.item.kind);
      if (!byTab.has(tab)) byTab.set(tab, []);
      byTab.get(tab).push(row);
    }

    groupedFiles = summarizeTypeTabs(files).map((tabInfo) => ({
      tab: tabInfo.tab,
      label: typeTabLabel(tabInfo.tab),
      count: tabInfo.count,
      rows: byTab.get(tabInfo.tab) || []
    }));
  }

  $: {
    const next = {};
    for (const group of groupedFiles) {
      next[group.tab] = collapsedGroups[group.tab] || false;
    }
    collapsedGroups = next;
  }

  $: if (collapseStateReady) {
    try {
      localStorage.setItem(COLLAPSE_STATE_KEY, JSON.stringify(collapsedGroups));
    } catch {
      // Ignore persisted state failures.
    }
  }

  function emitSelectionChangeIfNeeded() {
    const normalizedIds = [...selectedIds].sort();
    const signature = normalizedIds.join("|");
    if (signature === lastSelectionSignature) return;

    lastSelectionSignature = signature;
    const selectedFiles = files.filter((item) => selectedIds.includes(item.id));
    dispatch("selectionchange", { selectedFiles, selectedIds: normalizedIds });
  }

  function updateSelection(ids) {
    selectedIds = Array.from(new Set(ids));
    emitSelectionChangeIfNeeded();
  }

  function toggleItem({ id, index, shiftKey, nextChecked }) {
    const selected = new Set(selectedIds);

    if (shiftKey && lastToggleIndex >= 0) {
      const start = Math.min(lastToggleIndex, index);
      const end = Math.max(lastToggleIndex, index);
      for (let i = start; i <= end; i += 1) {
        const fileId = files[i]?.id;
        if (!fileId) continue;
        if (nextChecked) selected.add(fileId);
        else selected.delete(fileId);
      }
    } else if (nextChecked) {
      selected.add(id);
    } else {
      selected.delete(id);
    }

    lastToggleIndex = index;
    updateSelection(Array.from(selected));
  }

  function clampIndex(index) {
    if (files.length === 0) return -1;
    return Math.max(0, Math.min(index, files.length - 1));
  }

  async function focusRow(index) {
    const safeIndex = clampIndex(index);
    if (safeIndex < 0) return;
    await tick();
    const target = document.querySelector(`[data-file-index="${safeIndex}"]`);
    target?.focus();
  }

  function applyRangeSelection(anchorIndex, targetIndex, additive = false) {
    const selected = additive ? new Set(selectedIds) : new Set();
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);

    for (let i = start; i <= end; i += 1) {
      const fileId = files[i]?.id;
      if (fileId) selected.add(fileId);
    }

    selectedIds = Array.from(selected);
  }

  async function onKeyNav({ index, key, shiftKey, ctrlKey, metaKey }) {
    const additive = ctrlKey || metaKey;
    let targetIndex = index;

    if (key === "ArrowDown") targetIndex = clampIndex(index + 1);
    if (key === "ArrowUp") targetIndex = clampIndex(index - 1);
    if (key === "Home") targetIndex = 0;
    if (key === "End") targetIndex = files.length - 1;
    if (targetIndex < 0 || targetIndex === index) return;

    if (shiftKey) {
      const anchor = lastToggleIndex >= 0 ? lastToggleIndex : index;
      applyRangeSelection(anchor, targetIndex, additive);
    } else if (!additive) {
      selectedIds = [files[targetIndex].id];
      lastToggleIndex = targetIndex;
    }

    await focusRow(targetIndex);
  }

  function toggleAll() {
    if (selectedIds.length === files.length) {
      selectedIds = [];
      emitSelectionChangeIfNeeded();
      return;
    }

    selectedIds = files.map((item) => item.id);
    emitSelectionChangeIfNeeded();
  }

  function focusGroupFile(fileId) {
    const target = files.find((item) => item.id === fileId);
    if (!target) return;
    updateSelection([target.id]);
  }

  function selectGroup(groupRows) {
    const ids = groupRows.map((row) => row.item.id);
    if (ids.length < 1) return;
    updateSelection(ids);
  }

  function activeGroupFileId(groupRows) {
    const ids = new Set(groupRows.map((row) => row.item.id));
    const selected = selectedIds.find((id) => ids.has(id));
    return selected || groupRows[0]?.item?.id || "";
  }

  function focusTypeGroup(tab, groupRows) {
    const ids = groupRows.map((row) => row.item.id);
    if (ids.length < 1) return;
    updateSelection(ids);
    dispatch("focusgroup", { tab, selectedIds: ids });
  }

  function toggleGroupCollapse(tab) {
    collapsedGroups = {
      ...collapsedGroups,
      [tab]: !collapsedGroups[tab]
    };
  }

  function removeFile(id) {
    dispatch("fileschange", { files: files.filter((item) => item.id !== id) });
  }

  function reorderWithDrop(targetId) {
    if (!draggingId || draggingId === targetId) return;

    const selectedSet = new Set(selectedIds);
    const sourceSelected = selectedSet.has(draggingId);
    const movingIds = sourceSelected && selectedSet.size > 0 ? selectedIds : [draggingId];
    const movingSet = new Set(movingIds);

    if (movingSet.has(targetId)) return;

    const moving = files.filter((item) => movingSet.has(item.id));
    const remaining = files.filter((item) => !movingSet.has(item.id));
    const insertIndex = remaining.findIndex((item) => item.id === targetId);

    if (insertIndex < 0) return;

    const next = [
      ...remaining.slice(0, insertIndex),
      ...moving,
      ...remaining.slice(insertIndex)
    ];

    dispatch("fileschange", { files: next });
  }
</script>

{#if files.length > 0}
  <section class="panel list-wrap" aria-label="Loaded file board">
    <header class="list-header">
      <div class="list-title-wrap">
        <h3>Intake Board</h3>
        <div class="list-metrics">
          <span class="metric-chip">Files <strong>{files.length}</strong></span>
          <span class="metric-chip">Selected <strong>{selectedIds.length}</strong></span>
        </div>
      </div>
      <button class="secondary" type="button" disabled={busy} on:click={toggleAll}>
        {selectedIds.length === files.length ? "Clear selection" : "Select all"}
      </button>
    </header>

    <div class="group-stack" role="listbox" aria-multiselectable="true">
      {#each groupedFiles as group (group.tab)}
        <section class="kind-group" aria-label={`${group.label} files`}>
          <header class="kind-group-header">
            <div class="kind-group-title">
              <h4>{group.label}</h4>
              <span>{group.count}</span>
            </div>
            <div class="kind-group-actions">
              <button
                class="secondary group-collapse-btn"
                type="button"
                disabled={busy}
                aria-expanded={!collapsedGroups[group.tab]}
                on:click={() => toggleGroupCollapse(group.tab)}
              >
                {collapsedGroups[group.tab] ? "Show" : "Hide"}
              </button>

              {#if group.rows.length > 1}
                <details class="group-tools">
                  <summary>Group tools</summary>
                  <div class="group-tools-body">
                    <label class="group-switcher" aria-label={`Choose active ${group.label} file`}>
                      <span>Active file</span>
                      <select
                        value={activeGroupFileId(group.rows)}
                        disabled={busy}
                        on:change={(event) => focusGroupFile(event.currentTarget.value)}
                      >
                        {#each group.rows as row (row.item.id)}
                          <option value={row.item.id}>{row.item.name}</option>
                        {/each}
                      </select>
                    </label>
                    <button class="secondary group-select-btn" type="button" disabled={busy} on:click={() => selectGroup(group.rows)}>
                      Select group
                    </button>
                    {#if groupedFiles.length > 1}
                      <button class="secondary group-focus-btn" type="button" disabled={busy} on:click={() => focusTypeGroup(group.tab, group.rows)}>
                        Only this type
                      </button>
                    {/if}
                  </div>
                </details>
              {/if}
            </div>
          </header>

          {#if !collapsedGroups[group.tab]}
            <ul class="file-list">
              {#each group.rows as row (row.item.id)}
                <FileItem
                  item={row.item}
                  index={row.index}
                  checked={selectedIds.includes(row.item.id)}
                  selected={selectedIds.includes(row.item.id)}
                  {busy}
                  on:toggle={(event) => toggleItem(event.detail)}
                  on:keynav={(event) => onKeyNav(event.detail)}
                  on:remove={(event) => removeFile(event.detail.id)}
                  on:forensics={(event) => dispatch("forensics", event.detail)}
                  on:dragstart={(event) => (draggingId = event.detail.id)}
                  on:drop={(event) => reorderWithDrop(event.detail.id)}
                  on:dragend={() => (draggingId = "")}
                >
                  <span slot="trailing" class="size-chip">{row.item.kind.toUpperCase()} · {formatBytes(row.item.size)}</span>
                </FileItem>
              {/each}
            </ul>
          {:else}
            <p class="group-collapsed-note">Group collapsed. Use Expand to view files.</p>
          {/if}
        </section>
      {/each}
    </div>
  </section>
{/if}

<style>
  .list-wrap {
    padding: 1.1rem;
    overflow: hidden;
    border: 1px solid var(--md-sys-color-outline-variant);
  }

  .list-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.9rem;
    gap: 0.7rem;
  }

  .list-title-wrap {
    display: grid;
    gap: 0.42rem;
  }

  .list-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .metric-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 4px;
    padding: 0.2rem 0.5rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--md-sys-color-on-surface-variant);
    background: color-mix(in srgb, var(--md-sys-color-surface) 88%, var(--md-sys-color-primary) 12%);
  }

  .metric-chip strong {
    color: var(--md-sys-color-on-surface);
    font-size: 0.74rem;
  }

  h3 {
    margin: 0;
    font-size: 1.04rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  span {
    color: var(--md-sys-color-on-surface-variant);
  }

  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.52rem;
  }

  .group-stack {
    display: grid;
    gap: 0.72rem;
  }

  .kind-group {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 12px;
    padding: 0.56rem;
    background: color-mix(in srgb, var(--md-sys-color-surface) 94%, var(--md-sys-color-primary) 6%);
  }

  .kind-group-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 0.55rem;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .kind-group-title {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .kind-group-header h4 {
    margin: 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--md-sys-color-on-surface-variant);
  }

  .kind-group-header span {
    min-width: 1.5rem;
    height: 1.2rem;
    border-radius: 999px;
    border: 1px solid var(--md-sys-color-outline-variant);
    display: inline-grid;
    place-items: center;
    font-size: 0.72rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .kind-group-actions {
    display: inline-flex;
    align-items: flex-start;
    gap: 0.4rem;
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-left: auto;
  }

  .group-tools {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
    background: var(--md-sys-color-surface);
  }

  .group-tools > summary {
    list-style: none;
    cursor: pointer;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-sys-color-on-surface-variant);
    user-select: none;
  }

  .group-tools > summary::-webkit-details-marker {
    display: none;
  }

  .group-tools[open] {
    border-radius: var(--app-radius-sm, 12px);
    padding: 0.42rem;
    min-width: min(100%, 260px);
  }

  .group-tools[open] > summary {
    margin-bottom: 0.35rem;
  }

  .group-tools-body {
    display: grid;
    gap: 0.35rem;
  }

  .group-switcher {
    display: grid;
    align-items: start;
    gap: 0.3rem;
  }

  .group-switcher span {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .group-switcher select {
    max-width: 180px;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    padding: 0.2rem 0.5rem;
    font-size: 0.72rem;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
  }

  .group-select-btn {
    font-size: 0.68rem;
    padding: 0.32rem 0.56rem;
    border-radius: 999px;
  }

  .group-focus-btn {
    font-size: 0.68rem;
    padding: 0.32rem 0.56rem;
    border-radius: 999px;
    border-color: color-mix(in srgb, var(--md-sys-color-primary) 45%, var(--md-sys-color-outline-variant));
    background: color-mix(in srgb, var(--md-sys-color-primary) 12%, var(--md-sys-color-surface));
  }

  .group-collapse-btn {
    font-size: 0.66rem;
    padding: 0.28rem 0.52rem;
    border-radius: 999px;
  }

  .group-collapsed-note {
    margin: 0;
    font-size: 0.76rem;
    color: var(--md-sys-color-on-surface-variant);
    padding: 0.2rem 0.1rem;
  }

  .size-chip {
    display: inline-flex;
    align-items: center;
    border-radius: 3px;
    background: var(--md-sys-color-surface-container-highest);
    border: 1px solid var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface-variant);
    padding: 0.2rem 0.55rem;
    font-size: 0.7rem;
    text-transform: none;
    letter-spacing: 0.01em;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 740px) {
    .list-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .kind-group-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .group-tools[open] {
      min-width: 100%;
    }
  }
</style>
