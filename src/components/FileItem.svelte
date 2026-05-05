<script>
  import { createEventDispatcher } from "svelte";

  export let item;
  export let index = 0;
  export let checked = false;
  export let busy = false;
  export let selected = false;

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

  <button
    class="drag-handle"
    type="button"
    aria-label={`Reorder ${item.name}`}
    disabled={busy}
  >
    drag_indicator
  </button>

  <div class="file-icon" aria-hidden="true">
    <span class="material-symbols-outlined">{iconForKind(item)}</span>
    <small>{extLabel(item.name)}</small>
  </div>

  <div class="meta">
    <strong>{item.name}</strong>
    <small>{item.type || "unknown"}</small>
  </div>

  <div class="trailing">
    <slot name="trailing"></slot>
  </div>

  <button
    class="inspect-btn"
    type="button"
    aria-label={`Inspect ${item.name}`}
    title="File forensics"
    disabled={busy}
    on:click|stopPropagation={() => dispatch("forensics", item)}
  >
    <span class="material-symbols-outlined">search</span>
    <span class="inspect-label">Inspect</span>
  </button>

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
    grid-template-columns: auto auto auto minmax(0, 1fr) auto auto auto;
    grid-template-areas: "check drag icon meta trailing inspect remove";
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 12px;
    background: var(--md-sys-color-surface-container-low);
    outline: none;
    min-width: 0;
  }

  .file-item:focus-visible {
    border-color: var(--md-sys-color-primary);
    box-shadow: inset 0 0 0 1px var(--md-sys-color-primary);
  }

  .file-item.selected {
    border-color: var(--md-sys-color-primary);
    background: var(--md-sys-color-primary-container);
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

  .inspect-btn {
    grid-area: inspect;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    border: 1.5px solid var(--md-sys-color-primary);
    background: transparent;
    color: var(--md-sys-color-primary);
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
    line-height: 1;
  }

  .inspect-btn .material-symbols-outlined {
    font-size: 1rem;
    font-family: "Material Symbols Outlined", sans-serif;
    line-height: 1;
  }

  .inspect-btn:hover:not(:disabled) {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
  }

  .inspect-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .remove-btn {
    grid-area: remove;
  }

  @media (max-width: 520px) {
    .inspect-label { display: none; }
    .inspect-btn { padding: 0.3rem; }
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
    border-radius: 2px;
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
    width: 34px;
    height: 34px;
    min-width: 34px;
    border-radius: 999px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: "Material Symbols Outlined", "Segoe UI Symbol", sans-serif;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    border: none;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
    font-size: 20px;
    line-height: 1;
  }

  .file-icon {
    display: grid;
    justify-items: center;
    align-content: center;
    width: 52px;
    min-width: 52px;
    gap: 0.05rem;
    color: var(--md-sys-color-primary);
  }

  .file-icon span {
    font-family: "Material Symbols Outlined", "Segoe UI Symbol", sans-serif;
    font-size: 22px;
    line-height: 1;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
    display: block;
  }

  .file-icon small {
    margin: 0;
    font-size: 0.65rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .meta {
    min-width: 0;
    display: grid;
    gap: 0.1rem;
  }

  strong {
    font-weight: 500;
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta small {
    color: var(--md-sys-color-on-surface-variant);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

    .trailing {
      justify-content: flex-start;
    }
  }
</style>
