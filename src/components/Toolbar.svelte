<script>
  import { createEventDispatcher } from "svelte";

  export let route = "empty";
  export let processing = false;
  export let selectedCount = 0;
  export let operationStatus = "idle";

  const dispatch = createEventDispatcher();

  const labels = {
    empty: "Awaiting files",
    djvu: "DjVu tools",
    pdf: "PDF tools",
    image: "Image tools",
    file: "File tools",
    content: "Content tools",
    mixed: "Mixed files"
  };

  const statusLabels = {
    idle: "Idle",
    queued: "Queued",
    running: "Running",
    success: "Completed",
    partial: "Completed (partial)",
    failed: "Failed"
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

  function handleDownloadSelected() {
    dispatch("downloadselected");
  }
</script>

<nav class="panel toolbar-shell" aria-label="Workflow controls">
  <div class="status-cluster">
    <p class="status-label">Workflow status</p>
    <div class="status-row">
    {#if processing}
      <span class="spinner" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
    {:else}
      <span class="status-dot" class:status-failed={operationStatus === "failed"} class:status-partial={operationStatus === "partial"} aria-hidden="true"></span>
    {/if}
      <p>{labels[route] ?? "Ready"} · {statusLabels[operationStatus] ?? "Idle"}</p>
    </div>
    <small>Selected: {selectedCount}</small>
  </div>

  <div class="toolbar-actions" role="group" aria-label="File actions">
    <button class="secondary" disabled={processing || selectedCount === 0} on:click={handleDownloadSelected}>
      Export selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
    </button>
    <button class="secondary" disabled={processing} on:click={() => dispatch("clear")}>Reset workspace</button>
    <button
      class="danger"
      disabled={processing || clearingSecurely}
      on:click={handleSecureClear}
      title="Securely clear Upkaran local browser data (memory, storage, cache, and service workers)"
    >
      {clearingSecurely ? "Purging..." : "Purge local traces"}
    </button>
  </div>
</nav>

<style>
  .toolbar-shell {
    padding: 0.95rem 1rem;
    margin-bottom: 0.8rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 0.9rem;
  }

  .status-cluster {
    display: grid;
    gap: 0.28rem;
    min-width: 0;
  }

  .status-label {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--md-sys-color-on-surface-variant);
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 0.48rem;
    min-width: 0;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: var(--app-state-success, #1e8a4a);
    flex-shrink: 0;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-state-success, #1e8a4a) 25%, transparent);
  }

  .status-dot.status-partial {
    background: var(--md-sys-color-tertiary, #7a5800);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-sys-color-tertiary, #7a5800) 25%, transparent);
  }

  .status-dot.status-failed {
    background: var(--md-sys-color-error, #b3261e);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--md-sys-color-error, #b3261e) 30%, transparent);
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
    border-radius: 2px;
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
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  p {
    margin: 0;
    font-weight: 600;
    font-size: 0.88rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  small {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.74rem;
  }

  .danger {
    background: color-mix(in srgb, var(--md-sys-color-error, #b3261e) 16%, var(--md-sys-color-surface));
    color: var(--md-sys-color-error, #b3261e);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error, #b3261e) 45%, var(--md-sys-color-outline-variant));
  }

  .danger:hover:not(:disabled) {
    filter: brightness(1.03);
  }

  @media (max-width: 760px) {
    .toolbar-shell {
      align-items: stretch;
      flex-direction: column;
    }

    .toolbar-actions {
      width: 100%;
    }

    .toolbar-actions button {
      flex: 1;
      min-width: 0;
    }
  }
</style>
