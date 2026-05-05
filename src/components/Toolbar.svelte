<script>
  import { createEventDispatcher } from "svelte";
  export let route = "empty";
  export let processing = false;

  const dispatch = createEventDispatcher();

  const labels = {
    empty: "Awaiting files",
    pdf: "PDF tools",
    image: "Image tools",
    file: "File tools",
    mixed: "Mixed files"
  };

  let resetting = false;

  async function handleReset() {
    if (resetting) return;
    resetting = true;
    try {
      await dispatch("reset");
    } finally {
      resetting = false;
    }
  }
</script>

<nav class="panel toolbar">
  <p>{labels[route] ?? "Ready"}</p>
  <div class="toolbar-actions">
    <button class="secondary" disabled={processing} on:click={() => dispatch("clear")}>Clear</button>
    <button class="secondary danger" disabled={processing || resetting} on:click={handleReset} title="Clear all app data, caches and service workers">
      {resetting ? "Resetting…" : "Reset app"}
    </button>
  </div>
</nav>

<style>
  .toolbar {
    padding: 0.8rem 1rem;
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .toolbar-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  p {
    margin: 0;
    font-weight: 600;
  }

  .danger {
    color: var(--md-sys-color-error, #b3261e);
    border-color: var(--md-sys-color-error, #b3261e);
  }

  .danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--md-sys-color-error, #b3261e) 10%, transparent);
  }
</style>
