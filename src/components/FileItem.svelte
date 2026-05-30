<script>
  import { createEventDispatcher } from "svelte";

  export let item;
  export let index = 0;
  export let checked = false;
  export let busy = false;
  export let selected = false;
  export let showDragHandle = true;
  export let compact = false;

  const dispatch = createEventDispatcher();

  function iconForKind(entry) {
    if (entry.kind === "pdf") return "picture_as_pdf";
    if (entry.kind === "image") return "image";
    return "draft";
  }

  function extLabel(name = "") {
    const match = name.toUpperCase().match(/\.([A-Z0-9]+)$/);
    return match ? match[1] : "FILE";
  }
</script>

<li
  class="file-item"
  class:selected
  class:no-drag={!showDragHandle}
  class:compact
  role="option"
  data-file-index={index}
  tabindex={busy ? -1 : 0}
  aria-selected={selected}
  draggable={!busy}
  on:keydown={(event) => {
    if (busy) return;

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      dispatch("toggle", {
        id: item.id,
        index,
        nextChecked: !checked,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey
      });
      return;
    }

    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      dispatch("keynav", {
        id: item.id,
        index,
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey
      });
    }
  }}
  on:dragstart={() => dispatch("dragstart", { id: item.id })}
  on:dragend={() => dispatch("dragend")}
  on:dragover|preventDefault
  on:drop|preventDefault={() => dispatch("drop", { id: item.id })}
>
  <label class="check-wrap" aria-label={`Select ${item.name}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={busy}
      on:click={(event) => {
        event.stopPropagation();
        dispatch("toggle", {
          id: item.id,
          index,
          nextChecked: event.currentTarget.checked,
          shiftKey: event.shiftKey
        });
      }}
    />
    <span class="checkbox-mark" aria-hidden="true"></span>
  </label>

  {#if showDragHandle}
    <button
      class="drag-handle"
      type="button"
      aria-label={`Reorder ${item.name}`}
      disabled={busy}
    >
      drag_indicator
    </button>
  {/if}

  <button
    class="file-icon"
    type="button"
    aria-label={`Inspect ${item.name}`}
    title="Inspect file"
    disabled={busy}
    on:click|stopPropagation={() => dispatch("forensics", item)}
  >
    <span class="material-symbols-outlined">{iconForKind(item)}</span>
    {#if !compact}
      <small>{extLabel(item.name)}</small>
    {/if}
  </button>

  <div class="meta">
    <strong>{item.name}</strong>
    {#if !compact}
      <small>{item.type || "unknown"}</small>
    {/if}
  </div>

  <div class="trailing">
    <slot name="trailing"></slot>
  </div>

  <button
    class="icon-button remove-btn"
    type="button"
    aria-label={`Remove ${item.name}`}
    disabled={busy}
    on:click={() => dispatch("remove", { id: item.id })}
  >
    close
  </button>
</li>

<style>
  .file-item {
    display: grid;
    grid-template-columns: auto auto auto minmax(0, 1fr) auto auto;
    grid-template-areas: "check drag icon meta trailing remove";
    align-items: center;
    gap: 0.52rem;
    padding: 0.52rem 0.56rem;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 72%, transparent);
    border-radius: var(--app-radius-sm, 12px);
    background: color-mix(in srgb, var(--md-sys-color-surface) 95%, var(--md-sys-color-primary) 5%);
    outline: none;
    min-width: 0;
    transition: border-color 120ms ease, background 120ms ease;
  }

  .file-item:hover {
    border-color: color-mix(in srgb, var(--md-sys-color-primary) 58%, var(--md-sys-color-outline-variant));
  }

  .file-item:focus-visible {
    border-color: var(--md-sys-color-primary);
    box-shadow: inset 0 0 0 1px var(--md-sys-color-primary);
  }

  .file-item.selected {
    border-color: var(--md-sys-color-primary);
    background: color-mix(in srgb, var(--md-sys-color-primary-container) 58%, var(--md-sys-color-surface) 42%);
    box-shadow: inset 2px 0 0 var(--md-sys-color-primary);
  }

  .file-item.compact {
    gap: 0.4rem;
    padding: 0.38rem 0.45rem;
    border-radius: 10px;
  }

  .check-wrap {
    grid-area: check;
  }

  .drag-handle {
    grid-area: drag;
  }

  .file-icon {
    grid-area: icon;
  }

  .meta {
    grid-area: meta;
  }

  .trailing {
    grid-area: trailing;
    min-width: 0;
    overflow: hidden;
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }

  .remove-btn {
    grid-area: remove;
  }

  .check-wrap {
    position: relative;
    width: 18px;
    height: 18px;
    display: inline-flex;
    cursor: pointer;
  }

  input[type="checkbox"] {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }

  .checkbox-mark {
    width: 18px;
    height: 18px;
    border-radius: 0;
    border: 2px solid var(--md-sys-color-outline);
    background: var(--md-sys-color-surface);
    transition: all 0.16s ease;
  }

  input[type="checkbox"]:checked + .checkbox-mark {
    background: var(--md-sys-color-primary);
    border-color: var(--md-sys-color-primary);
    box-shadow: inset 0 0 0 3px var(--md-sys-color-primary);
  }

  input[type="checkbox"]:checked + .checkbox-mark::after {
    content: "";
    position: absolute;
    width: 5px;
    height: 10px;
    border: solid var(--md-sys-color-on-primary);
    border-width: 0 2px 2px 0;
    transform: translate(6px, 2px) rotate(45deg);
  }

  .drag-handle,
  .icon-button {
    width: 30px;
    height: 30px;
    min-width: 30px;
    border-radius: var(--app-radius-sm, 12px);
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: "Material Symbols Outlined", "Segoe UI Symbol", sans-serif;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    border: 1px solid var(--md-sys-color-outline-variant);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
    font-size: 18px;
    line-height: 1;
  }

  .drag-handle {
    opacity: 0.25;
    border-color: transparent;
    background: transparent;
  }

  .file-item:hover .drag-handle,
  .file-item:focus-within .drag-handle {
    opacity: 0.85;
    border-color: var(--md-sys-color-outline-variant);
    background: color-mix(in srgb, var(--md-sys-color-surface) 88%, var(--md-sys-color-primary) 12%);
  }

  .file-icon {
    display: grid;
    justify-items: center;
    align-content: center;
    width: 48px;
    min-width: 48px;
    gap: 0.05rem;
    color: var(--md-sys-color-primary);
    border-radius: var(--app-radius-sm, 12px);
    padding: 0.24rem 0.2rem;
    background: color-mix(in srgb, var(--md-sys-color-primary) 4%, transparent);
    border: 1px solid var(--md-sys-color-outline-variant);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .file-item.compact .file-icon {
    width: 32px;
    min-width: 32px;
    padding: 0;
    border-radius: 8px;
  }

  .file-icon:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--md-sys-color-primary) 58%, var(--md-sys-color-outline-variant));
    background: color-mix(in srgb, var(--md-sys-color-primary) 10%, transparent);
  }

  .file-icon:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .file-icon span {
    font-family: "Material Symbols Outlined", "Segoe UI Symbol", sans-serif;
    font-size: 20px;
    line-height: 1;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
    display: block;
  }

  .file-item.compact .file-icon span {
    font-size: 18px;
  }

  .file-icon small {
    margin: 0;
    font-size: 0.61rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .meta {
    min-width: 0;
    display: grid;
    gap: 0.06rem;
  }

  strong {
    font-weight: 500;
    font-size: 0.86rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-item.compact strong {
    font-size: 0.82rem;
  }

  .meta small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.74rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-item.compact .icon-button,
  .file-item.compact .drag-handle {
    width: 26px;
    height: 26px;
    min-width: 26px;
    font-size: 16px;
    border-radius: 8px;
  }

  @media (max-width: 740px) {
    .file-item {
      grid-template-columns: auto auto auto minmax(0, 1fr) auto;
      grid-template-areas:
        "check drag icon meta remove"
        ". . trailing trailing remove";
      row-gap: 0.45rem;
      align-items: start;
    }

    .file-item.no-drag {
      grid-template-columns: auto auto minmax(0, 1fr) auto;
      grid-template-areas:
        "check icon meta remove"
        ". trailing trailing remove";
    }

    .trailing {
      justify-content: flex-start;
    }
  }
</style>
