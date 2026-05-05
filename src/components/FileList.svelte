<script>
  import { createEventDispatcher } from "svelte";
  import { tick } from "svelte";
  import { formatBytes } from "../js/detect.js";
  import FileItem from "./FileItem.svelte";

  export let files = [];
  export let busy = false;

  const dispatch = createEventDispatcher();

  let selectedIds = [];
  let lastToggleIndex = -1;
  let draggingId = "";
  let lastSelectionSignature = "";

  $: {
    const valid = new Set(files.map((item) => item.id));
    const next = selectedIds.filter((id) => valid.has(id));
    if (next.length !== selectedIds.length) {
      selectedIds = next;
      emitSelectionChangeIfNeeded();
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
  <section class="panel list-wrap">
    <header class="list-header">
      <div>
        <h3>Loaded files</h3>
        <span>{files.length} item(s)</span>
      </div>
      <button class="secondary" type="button" disabled={busy} on:click={toggleAll}>
        {selectedIds.length === files.length ? "Deselect All" : "Select All"}
      </button>
    </header>

    <ul class="file-list" role="listbox" aria-multiselectable="true">
      {#each files as item, index (item.id)}
        <FileItem
          {item}
          {index}
          checked={selectedIds.includes(item.id)}
          selected={selectedIds.includes(item.id)}
          {busy}
          on:toggle={(event) => toggleItem(event.detail)}
          on:keynav={(event) => onKeyNav(event.detail)}
          on:remove={(event) => removeFile(event.detail.id)}
          on:dragstart={(event) => (draggingId = event.detail.id)}
          on:drop={(event) => reorderWithDrop(event.detail.id)}
          on:dragend={() => (draggingId = "")}
        >
          <span slot="trailing" class="size-chip">{item.kind.toUpperCase()} · {formatBytes(item.size)}</span>
        </FileItem>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .list-wrap {
    padding: 1rem;
    overflow: hidden;
  }

  .list-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 0.85rem;
    gap: 0.7rem;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 500;
  }

  span {
    color: var(--md-sys-color-on-surface-variant);
  }

  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }

  .size-chip {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: var(--md-sys-color-surface-container-highest);
    border: 1px solid var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface-variant);
    padding: 0.2rem 0.55rem;
    font-size: 0.74rem;
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
  }
</style>
