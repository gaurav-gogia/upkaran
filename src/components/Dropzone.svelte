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
  <h2>Drop files here</h2>
  <p>PDF, images, or any file batch. All processing stays in this browser.</p>
  <button on:click={openPicker}>Choose files</button>
  <input id="file-picker" type="file" {accept} multiple on:change={onInputChange} />
</div>

<style>
  .dropzone {
    padding: 2rem;
    border: 2px dashed var(--md-sys-color-outline);
    border-radius: var(--radius-lg);
    text-align: center;
    transition: all 0.2s ease;
  }

  .dropzone.dragging {
    border-color: var(--md-sys-color-primary);
    background: var(--md-sys-color-primary-container);
  }

  h2 {
    margin: 0 0 0.4rem;
  }

  p {
    margin: 0 0 1rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  input {
    display: none;
  }
</style>
