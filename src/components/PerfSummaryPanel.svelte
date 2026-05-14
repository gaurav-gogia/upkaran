<script>
  import { onMount, onDestroy } from "svelte";
  import { clearPerfSamples, getPerfSamples, getPerfSummary } from "../js/perf-profile.js";

  export let enabled = false;

  let expanded = false;
  let summary = [];
  let recent = [];
  let autoRefresh = true;
  let lastRefreshAt = "";
  let intervalId;

  function refresh() {
    summary = getPerfSummary();
    recent = getPerfSamples(12).slice().reverse();
    lastRefreshAt = new Date().toLocaleTimeString();
  }

  function clearAll() {
    clearPerfSamples();
    refresh();
  }

  function startAutoRefresh() {
    if (intervalId || !expanded || !autoRefresh) return;
    intervalId = setInterval(refresh, 2000);
  }

  function stopAutoRefresh() {
    if (!intervalId) return;
    clearInterval(intervalId);
    intervalId = null;
  }

  $: if (expanded && autoRefresh) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }

  onMount(() => {
    refresh();
  });

  onDestroy(() => {
    stopAutoRefresh();
  });
</script>

{#if enabled}
  <section class="panel perf-panel" aria-label="Performance profiling summary">
    <header class="perf-head">
      <div>
        <h2>Performance Summary</h2>
        <p>Developer-only profiling for recent operations in this session.</p>
      </div>
      <div class="perf-actions">
        <button class="secondary" type="button" on:click={() => (expanded = !expanded)}>
          {expanded ? "Hide" : "Show"}
        </button>
        <button class="secondary" type="button" on:click={refresh}>Refresh</button>
        <button class="secondary" type="button" on:click={clearAll}>Clear</button>
      </div>
    </header>

    {#if expanded}
      <div class="perf-meta-row">
        <label class="auto-refresh-toggle">
          <input type="checkbox" bind:checked={autoRefresh} />
          Auto-refresh (2s)
        </label>
        <small>Last refresh: {lastRefreshAt || "-"}</small>
      </div>

      {#if summary.length === 0}
        <p class="empty-state">No profiling samples yet. Run tools like compare, forensics, or batch to populate this view.</p>
      {:else}
        <div class="table-wrap">
          <table class="perf-table" aria-label="Performance summary table">
            <thead>
              <tr>
                <th>Operation</th>
                <th>Count</th>
                <th>Avg (ms)</th>
                <th>Max (ms)</th>
                <th>Last (ms)</th>
              </tr>
            </thead>
            <tbody>
              {#each summary as row}
                <tr>
                  <td>{row.operation}</td>
                  <td>{row.count}</td>
                  <td>{Math.round(row.avgMs)}</td>
                  <td>{Math.round(row.maxMs)}</td>
                  <td>{Math.round(row.lastMs)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <h3>Recent Samples</h3>
        <div class="table-wrap">
          <table class="perf-table recent" aria-label="Recent profiling samples">
            <thead>
              <tr>
                <th>Time</th>
                <th>Operation</th>
                <th>Duration (ms)</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {#each recent as sample}
                <tr>
                  <td>{sample.at}</td>
                  <td>{sample.operation}</td>
                  <td>{Math.round(sample.durationMs)}</td>
                  <td class="mono">{JSON.stringify(sample.meta || {})}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .perf-panel {
    padding: 0.9rem;
    display: grid;
    gap: 0.55rem;
  }

  .perf-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
  }

  h3 {
    margin: 0.45rem 0 0.2rem;
    font-size: 0.88rem;
  }

  p {
    margin: 0.25rem 0 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.84rem;
  }

  .perf-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .perf-meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .auto-refresh-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    font-size: 0.8rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.76rem;
  }

  .empty-state {
    border: 1px dashed var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.45rem 0.6rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .table-wrap {
    overflow: auto;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
  }

  .perf-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 680px;
  }

  .perf-table th,
  .perf-table td {
    text-align: left;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.42rem 0.5rem;
    font-size: 0.78rem;
    vertical-align: top;
  }

  .perf-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .perf-table thead th {
    position: sticky;
    top: 0;
    background: var(--md-sys-color-surface-container-highest);
    z-index: 1;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    max-width: 420px;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
