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
    content: "Content tools",
    mixed: "Mixed files"
  };

  let clearingSecurely = false;

  async function handleSecureClear() {
    if (clearingSecurely) return;
    clearingSecurely = true;
    try {
      await dispatch("secureclear");
    } finally {
      clearingSecurely = false;
    }
  }
</script>

<nav class="panel toolbar">
  <div class="status-row">
    {#if processing}
      <span class="spinner" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
    {:else}
      <span class="status-dot" aria-hidden="true"></span>
    {/if}
    <p>{labels[route] ?? "Ready"}</p>
  </div>
  <div class="toolbar-actions">
    <button class="secondary" disabled={processing} on:click={() => dispatch("clear")}>Clear</button>
    <button
      class="secondary danger"
      disabled={processing || clearingSecurely}
      on:click={handleSecureClear}
      title="Securely clear Upkaran local browser data (memory, storage, cache, and service workers)"
    >
      {clearingSecurely ? "Clearing..." : "Wipe/Shred Local Data"}
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

  .status-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #1e8a4a;
    flex-shrink: 0;
  }

  .spinner {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .spinner span {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--md-sys-color-primary);
    animation: spin-bounce 1s ease-in-out infinite;
  }

  .spinner span:nth-child(2) { animation-delay: 0.15s; }
  .spinner span:nth-child(3) { animation-delay: 0.3s; }

  @keyframes spin-bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40%           { transform: scale(1);   opacity: 1;   }
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
