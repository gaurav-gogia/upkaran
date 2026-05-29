<script>
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();
  export let accept = "";
  let dragging = false;

  export function openPicker() {
    document.getElementById("file-picker")?.click();
  }

  function onDrop(event) {
    event.preventDefault();
    dragging = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) {
      dispatch("filesadded", files);
    }
  }

  function onInputChange(event) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) {
      dispatch("filesadded", files);
      event.target.value = "";
    }
  }
</script>

<div
  class="dropzone panel"
  class:dragging
  role="button"
  tabindex="0"
  aria-label="Drop files or press enter to choose files"
  on:dragenter|preventDefault={() => (dragging = true)}
  on:dragover|preventDefault
  on:dragleave|preventDefault={() => (dragging = false)}
  on:drop={onDrop}
  on:keydown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  }}
>
  <p class="eyebrow">Intake</p>
  <h2>Drop files here</h2>
  <p>PDF, DjVu, images, or any file batch. All processing stays in this browser.</p>
  <button on:click={openPicker}>Choose files</button>
  <input id="file-picker" type="file" {accept} multiple on:change={onInputChange} />
</div>

<style>
  .dropzone {
    padding: 2.7rem 1.5rem;
    min-height: 260px;
    display: grid;
    place-content: center;
    gap: 0.55rem;
    border: 2px dashed var(--md-sys-color-outline);
    border-radius: 2px;
    text-align: center;
    transition: all 0.2s ease;
  }

  .dropzone.dragging {
    border-color: var(--md-sys-color-primary);
    background: var(--md-sys-color-primary-container);
  }

  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--md-sys-color-on-surface-variant);
  }

  h2 {
    margin: 0;
    font-size: clamp(1.55rem, 2.8vw, 2.25rem);
    letter-spacing: 0.02em;
  }

  p {
    margin: 0 0 0.9rem;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.95rem;
  }

  @media (max-width: 760px) {
    .dropzone {
      min-height: 220px;
      padding: 2.2rem 1rem;
    }
  }

  input {
    display: none;
  }
</style>
