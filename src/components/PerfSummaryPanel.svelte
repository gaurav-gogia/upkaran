<script>
  import { onMount, onDestroy } from "svelte";
  import {
    clearPerfSamples,
    getPerfOverview,
    getPerfSamples,
    getPerfSummary,
    getPerfTimeSeries,
  } from "../js/perf-profile.js";

  export let enabled = false;

  let expanded = true;
  let overview = null;
  let summary = [];
  let recent = [];
  let series = [];
  let autoRefresh = true;
  let lastRefreshAt = "";
  let intervalId;

  function fmtMs(value) {
    const n = Number(value) || 0;
    return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)} ms`;
  }

  function refresh() {
    overview = getPerfOverview();
    summary = getPerfSummary();
    recent = getPerfSamples(24).slice().reverse();
    series = getPerfTimeSeries(60);
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

  $: maxDuration = series.length > 0 ? Math.max(...series.map((point) => point.durationMs), 1) : 1;
  $: maxAvg = summary.length > 0 ? Math.max(...summary.map((row) => row.avgMs), 1) : 1;

  $: sparkline = series
    .map((point, index) => {
      const x = (index / Math.max(1, series.length - 1)) * 100;
      const y = 100 - (point.durationMs / maxDuration) * 100;
      return `${x.toFixed(2)},${Math.max(0, Math.min(100, y)).toFixed(2)}`;
    })
    .join(" ");
</script>

{#if enabled}
  <section class="panel perf-panel" aria-label="Performance profiling summary">
    <header class="perf-head">
      <div>
        <h2>Profiling & Benchmark Lab</h2>
        <p>Deep run-time telemetry for operation latency, error rate, and performance trend.</p>
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

      {#if overview}
        <div class="perf-kpis">
          <article>
            <small>Total samples</small>
            <strong>{overview.totalSamples}</strong>
          </article>
          <article>
            <small>Tracked operations</small>
            <strong>{overview.operationCount}</strong>
          </article>
          <article>
            <small>Error samples</small>
            <strong>{overview.totalErrors}</strong>
          </article>
          <article>
            <small>Slowest event</small>
            <strong>{overview.slowest ? fmtMs(overview.slowest.durationMs) : "-"}</strong>
          </article>
        </div>
      {/if}

      <section class="spark-card">
        <div class="spark-head">
          <h3>Latency Trend (Recent)</h3>
          {#if overview?.latest}
            <small>Latest: {overview.latest.operation} · {fmtMs(overview.latest.durationMs)}</small>
          {/if}
        </div>
        {#if sparkline}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Recent latency trend">
            <polyline points={sparkline} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
          </svg>
        {:else}
          <p class="empty-state">No time-series yet. Run some tools to generate benchmark samples.</p>
        {/if}
      </section>

      {#if summary.length === 0}
        <p class="empty-state">No profiling samples yet. Run tools like compare, forensics, or batch to populate this view.</p>
      {:else}
        <section class="ops-bars">
          <h3>Operation Benchmarks</h3>
          {#each summary.slice(0, 8) as row}
            <div class="op-row">
              <div class="op-title">
                <strong>{row.operation}</strong>
                <small>{row.count} runs · p95 {fmtMs(row.p95Ms)} · err {row.errorRatePct.toFixed(0)}%</small>
              </div>
              <div class="op-bar"><span style={`width:${Math.max(5, Math.round((row.avgMs / maxAvg) * 100))}%`}></span></div>
              <div class="op-num">{fmtMs(row.avgMs)}</div>
            </div>
          {/each}
        </section>

        <div class="table-wrap">
          <table class="perf-table" aria-label="Performance summary table">
            <thead>
              <tr>
                <th>Operation</th>
                <th>Count</th>
                <th>Errors</th>
                <th>Avg (ms)</th>
                <th>P50 (ms)</th>
                <th>P95 (ms)</th>
                <th>Max (ms)</th>
                <th>StdDev</th>
                <th>Heap (MB)</th>
              </tr>
            </thead>
            <tbody>
              {#each summary as row}
                <tr>
                  <td>{row.operation}</td>
                  <td>{row.count}</td>
                  <td>{row.errorCount}</td>
                  <td>{Math.round(row.avgMs)}</td>
                  <td>{Math.round(row.p50Ms)}</td>
                  <td>{Math.round(row.p95Ms)}</td>
                  <td>{Math.round(row.maxMs)}</td>
                  <td>{Math.round(row.stdDevMs)}</td>
                  <td>{Number.isFinite(row.memoryUsedMb) ? row.memoryUsedMb.toFixed(1) : "-"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <h3>Recent Samples (Deep Trace)</h3>
        <div class="table-wrap">
          <table class="perf-table recent" aria-label="Recent profiling samples">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Operation</th>
                <th>Duration (ms)</th>
                <th>Status</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {#each recent as sample}
                <tr>
                  <td>{sample.seq}</td>
                  <td>{sample.at}</td>
                  <td>{sample.operation}</td>
                  <td>{Math.round(sample.durationMs)}</td>
                  <td>
                    <span class={`status ${sample.status === "error" ? "bad" : "ok"}`}>
                      {sample.status}
                    </span>
                  </td>
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
    gap: 0.7rem;
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

  .perf-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.5rem;
  }

  .perf-kpis article {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    background: color-mix(in srgb, var(--md-sys-color-surface-container-low) 80%, var(--md-sys-color-primary-container) 20%);
    padding: 0.5rem 0.6rem;
    display: grid;
    gap: 0.2rem;
  }

  .perf-kpis small {
    margin: 0;
    font-size: 0.72rem;
  }

  .spark-card {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .spark-head {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .spark-card svg {
    width: 100%;
    height: 95px;
    margin-top: 0.35rem;
    color: #3a78d1;
    background: linear-gradient(180deg, rgba(58, 120, 209, 0.12), transparent);
    border-radius: 8px;
  }

  .ops-bars {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    background: var(--md-sys-color-surface-container-low);
    padding: 0.5rem 0.65rem;
    display: grid;
    gap: 0.45rem;
  }

  .ops-bars h3 {
    margin: 0;
  }

  .op-row {
    display: grid;
    grid-template-columns: minmax(120px, 1.4fr) 2fr auto;
    gap: 0.5rem;
    align-items: center;
  }

  .op-title {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
  }

  .op-title strong {
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .op-title small {
    font-size: 0.7rem;
  }

  .op-bar {
    height: 8px;
    border-radius: 999px;
    background: var(--md-sys-color-surface-container-highest);
    overflow: hidden;
  }

  .op-bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #2f7a51, #355ca8);
  }

  .op-num {
    font-size: 0.74rem;
    color: var(--md-sys-color-on-surface-variant);
    white-space: nowrap;
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

  .status {
    display: inline-flex;
    border-radius: 999px;
    padding: 0.08rem 0.42rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid transparent;
  }

  .status.ok {
    color: #205f3d;
    border-color: rgba(32, 95, 61, 0.25);
    background: rgba(32, 95, 61, 0.1);
  }

  .status.bad {
    color: #8f2d2d;
    border-color: rgba(143, 45, 45, 0.25);
    background: rgba(143, 45, 45, 0.1);
  }

  @media (max-width: 740px) {
    .op-row {
      grid-template-columns: 1fr;
      gap: 0.3rem;
    }
  }
</style>
