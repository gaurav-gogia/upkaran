<script>
  import { createEventDispatcher } from "svelte";

  export let items = [];
  export let lastTool = "";

  const dispatch = createEventDispatcher();
  const TAG_FILTERS = ["all", "ingest", "transfer", "generated", "pipeline"];

  let selectedTag = "all";
  let searchQuery = "";

  function formatTime(isoTime) {
    if (!isoTime) return "";
    try {
      return new Date(isoTime).toLocaleString();
    } catch {
      return isoTime;
    }
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function timeAgo(isoTime) {
    if (!isoTime) return "";
    const diffMs = Date.now() - new Date(isoTime).getTime();
    const sec = Math.max(1, Math.floor(diffMs / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  function topEntries(obj = {}, max = 6) {
    return Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max);
  }

  function tagLabel(tag) {
    if (tag === "all") return "All";
    if (tag === "ingest") return "Ingest";
    if (tag === "transfer") return "Transfer";
    if (tag === "generated") return "Generated";
    if (tag === "pipeline") return "Pipeline";
    return tag;
  }

  function tagIcon(tag) {
    if (tag === "transfer") return "wifi_tethering";
    if (tag === "generated") return "auto_awesome";
    if (tag === "pipeline") return "conversion_path";
    return "upload_file";
  }

  function rowClass(evidenceTag = "") {
    if (evidenceTag === "pipeline") return "pipeline";
    if (evidenceTag === "transfer") return "transfer";
    if (evidenceTag === "generated") return "generated";
    return "ingest";
  }

  function actionClass(action = "") {
    const normalized = `${action}`.toLowerCase();
    if (normalized === "files added") return "files-added";
    if (normalized === "processing completed") return "processing-completed";
    return "generic";
  }

  function isFilesAdded(action = "") {
    return `${action}`.toLowerCase() === "files added";
  }

  function isProcessingCompleted(action = "") {
    return `${action}`.toLowerCase() === "processing completed";
  }

  function compactKinds(kindBreakdown = {}) {
    return Object.entries(kindBreakdown)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }

  function kindColor(kind = "other") {
    if (kind === "pdf") return "#c0392b";
    if (kind === "image") return "#355ca8";
    if (kind === "document") return "#1a6b8a";
    if (kind === "data") return "#2f7a51";
    if (kind === "code") return "#8a5a1a";
    return "#7b7e87";
  }

  function kindMixSegments(kindBreakdown = {}) {
    const rows = Object.entries(kindBreakdown).filter(([, count]) => count > 0);
    const total = rows.reduce((sum, [, count]) => sum + count, 0);
    if (total < 1) return [];
    return rows
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({
        kind,
        count,
        pct: Math.max(4, Math.round((count / total) * 100)),
        color: kindColor(kind),
      }));
  }

  function outputMeter(item) {
    const inputs = Math.max(0, Number(item?.fileCount) || 0);
    const outputs = Math.max(0, Number(item?.outputCount) || 0);
    if (inputs < 1) {
      return { pct: 0, label: "No input files" };
    }
    const pct = Math.max(0, Math.min(100, Math.round((Math.min(outputs, inputs) / inputs) * 100)));
    return {
      pct,
      label: `${outputs} output(s) from ${inputs} file(s)`,
    };
  }

  function matchesSearch(item, query) {
    const q = `${query || ""}`.trim().toLowerCase();
    if (!q) return true;

    const hay = [
      item.action,
      item.toolKey,
      item.routeSnapshot,
      item.note,
      item.source,
      ...(item.fileNames || []),
      ...(item.outputNames || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return hay.includes(q);
  }

  function inTag(item, tag) {
    if (tag === "all") return true;
    return (item.evidenceTag || "ingest") === tag;
  }

  $: filteredItems = items.filter((item) => inTag(item, selectedTag) && matchesSearch(item, searchQuery));

  $: totalEvents = filteredItems.length;
  $: totalFilesSeen = filteredItems.reduce((sum, item) => sum + (item.fileCount || 0), 0);
  $: totalOutputs = filteredItems.reduce((sum, item) => sum + (item.outputCount || 0), 0);
  $: totalBytesObserved = filteredItems.reduce((sum, item) => sum + (item.totalBytes || 0), 0);

  $: byTool = filteredItems.reduce((acc, item) => {
    const key = item.toolKey || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  $: toolBars = topEntries(byTool, 7);
  $: maxToolCount = toolBars.length > 0 ? Math.max(...toolBars.map(([, count]) => count)) : 1;

  $: byKind = filteredItems.reduce((acc, item) => {
    const breakdown = item.kindBreakdown || {};
    for (const [kind, count] of Object.entries(breakdown)) {
      acc[kind] = (acc[kind] || 0) + count;
    }
    return acc;
  }, {});
  $: kindBars = topEntries(byKind, 6);

  $: cadenceBars = (() => {
    const bars = [0, 0, 0, 0, 0, 0];
    for (const item of filteredItems.slice(0, 60)) {
      const hour = new Date(item.isoTime).getHours();
      if (!Number.isFinite(hour)) continue;
      const slot = Math.min(5, Math.floor(hour / 4));
      bars[slot] += 1;
    }
    const max = Math.max(...bars, 1);
    return bars.map((count, i) => ({
      label: `${String(i * 4).padStart(2, "0")}-${String(i * 4 + 3).padStart(2, "0")}`,
      count,
      height: Math.max(10, Math.round((count / max) * 100)),
    }));
  })();

  $: expandedByDefault = new Set(
    filteredItems
      .filter((item, index) => index < 2 || isFilesAdded(item.action) || isProcessingCompleted(item.action))
      .slice(0, 6)
      .map((item) => item.id)
  );
</script>

<section class="panel recent-activity" aria-labelledby="recent-activity-title">
  <header>
    <div>
      <h2 id="recent-activity-title">Forensic Activity Board</h2>
      {#if lastTool}
        <p class="meta">Last route touched: <strong>{lastTool}</strong></p>
      {/if}
    </div>
    <button class="secondary" type="button" on:click={() => dispatch("clear")}>Clear Case Timeline</button>
  </header>

  {#if items.length === 0}
    <p class="empty">No events yet. Process files to start an investigation timeline with evidence traces.</p>
  {:else}
    <div class="control-bar">
      <div class="tag-filters" role="tablist" aria-label="Activity type filters">
        {#each TAG_FILTERS as tag}
          <button
            type="button"
            class="secondary tag-filter"
            class:is-active={selectedTag === tag}
            role="tab"
            aria-selected={selectedTag === tag}
            on:click={() => (selectedTag = tag)}
          >
            {tagLabel(tag)}
          </button>
        {/each}
      </div>

      <label class="search-box" aria-label="Search recent activity">
        <span class="material-symbols-outlined">search</span>
        <input type="search" bind:value={searchQuery} placeholder="Search action, route, file, note..." />
      </label>
    </div>

    <div class="evidence-metrics">
      <article>
        <small>Total events</small>
        <strong>{totalEvents}</strong>
      </article>
      <article>
        <small>Files observed</small>
        <strong>{totalFilesSeen}</strong>
      </article>
      <article>
        <small>Derived outputs</small>
        <strong>{totalOutputs}</strong>
      </article>
      <article>
        <small>Data footprint</small>
        <strong>{formatBytes(totalBytesObserved)}</strong>
      </article>
    </div>

    <div class="forensic-grid">
      <section class="graph-card">
        <h3>Route Heat</h3>
        {#each toolBars as [tool, count]}
          <div class="bar-row">
            <span class="bar-label">{tool}</span>
            <div class="bar-track"><span style={`width:${Math.max(6, Math.round((count / maxToolCount) * 100))}%`}></span></div>
            <small>{count}</small>
          </div>
        {/each}
      </section>

      <section class="graph-card">
        <h3>Evidence Types</h3>
        {#if kindBars.length === 0}
          <p class="kind-empty">No kind breakdown captured yet.</p>
        {:else}
          {#each kindBars as [kind, count]}
            <div class="chip-row">
              <span class="kind-chip">{kind}</span>
              <small>{count}</small>
            </div>
          {/each}
        {/if}
      </section>

      <section class="graph-card cadence-card">
        <h3>Event Cadence (4h buckets)</h3>
        <div class="cadence-bars" role="img" aria-label="Activity cadence by time bucket">
          {#each cadenceBars as bar}
            <div class="cadence-col" title={`${bar.label}: ${bar.count} event(s)`}>
              <span style={`height:${bar.height}%`}></span>
              <small>{bar.label}</small>
            </div>
          {/each}
        </div>
      </section>
    </div>

    {#if filteredItems.length === 0}
      <p class="empty">No events match the current filters.</p>
    {:else}
    <ul class="timeline">
      {#each filteredItems as item (item.id)}
        <li class={`event ${rowClass(item.evidenceTag)} ${actionClass(item.action)}`}>
          <span class="event-marker material-symbols-outlined" aria-hidden="true">{tagIcon(item.evidenceTag)}</span>
          <div class="event-top">
            <div>
              <strong>{item.action}</strong>
              <span class="route-badge">{item.routeSnapshot || item.toolKey}</span>
            </div>
            <span class="time-stamp" title={formatTime(item.isoTime)}>{timeAgo(item.isoTime)}</span>
          </div>

          <div class="event-bottom">
            <span>{item.fileCount} file(s){item.outputCount ? ` -> ${item.outputCount} output(s)` : ""}</span>
            <span>{formatBytes(item.totalBytes || 0)}</span>
            <span class="tag">{item.evidenceTag || "capture"}</span>
          </div>

          {#if isFilesAdded(item.action)}
            <div class="focus-strip ingest-strip">
              <div class="focus-head">
                <span class="material-symbols-outlined" aria-hidden="true">playlist_add_check_circle</span>
                <strong>Intake Snapshot</strong>
                <small>{item.fileCount} file(s) ingested</small>
              </div>

              {#if kindMixSegments(item.kindBreakdown || {}).length > 0}
                <div class="mix-bar" aria-label="File kind composition">
                  {#each kindMixSegments(item.kindBreakdown || {}) as segment}
                    <span style={`width:${segment.pct}%; background:${segment.color}`} title={`${segment.kind}: ${segment.count}`}></span>
                  {/each}
                </div>
              {/if}

              <div class="focus-chips">
                {#each compactKinds(item.kindBreakdown || {}) as [kind, count]}
                  <span class="focus-chip">{kind}: {count}</span>
                {/each}
                {#if item.fileNames?.length > 0}
                  <span class="focus-chip name">{item.fileNames[0]}</span>
                {/if}
              </div>
            </div>
          {/if}

          {#if isProcessingCompleted(item.action)}
            <div class="focus-strip pipeline-strip">
              <div class="focus-head">
                <span class="material-symbols-outlined" aria-hidden="true">network_intelligence</span>
                <strong>Pipeline Result</strong>
                <small>{item.outputCount || 0} output(s) generated</small>
              </div>

              <div class="result-meter" aria-label="Output success ratio">
                <span style={`width:${outputMeter(item).pct}%`}></span>
              </div>
              <small class="result-caption">{outputMeter(item).label}</small>

              <div class="focus-chips">
                <span class="focus-chip">Route: {item.routeSnapshot || item.toolKey}</span>
                {#if item.outputCount > 0}
                  <span class="focus-chip success">Success</span>
                {:else}
                  <span class="focus-chip warn">No outputs</span>
                {/if}
                {#if item.outputNames?.length > 0}
                  <span class="focus-chip name">{item.outputNames[0]}</span>
                {/if}
              </div>
            </div>
          {/if}

          <details open={expandedByDefault.has(item.id)}>
            <summary>Evidence details</summary>
            <div class="detail-grid">
              <div>
                <small>Case chain</small>
                <p>{item?.investigation?.chainId || "n/a"}</p>
              </div>
              <div>
                <small>Source</small>
                <p>{item.source || "local"}</p>
              </div>
              <div>
                <small>Actor</small>
                <p>{item?.investigation?.actor || "browser-session"}</p>
              </div>
              <div>
                <small>Captured at</small>
                <p>{formatTime(item.isoTime)}</p>
              </div>
            </div>

            {#if item.fileNames?.length > 0}
              <div class="name-block">
                <small>Files</small>
                <p>{item.fileNames.join(", ")}</p>
              </div>
            {/if}

            {#if item.outputNames?.length > 0}
              <div class="name-block">
                <small>Outputs</small>
                <p>{item.outputNames.join(", ")}</p>
              </div>
            {/if}

            {#if item.note}
              <div class="name-block">
                <small>Notes</small>
                <p>{item.note}</p>
              </div>
            {/if}
          </details>
        </li>
      {/each}
    </ul>
    {/if}
  {/if}
</section>

<style>
  .recent-activity {
    padding: 1rem;
    display: grid;
    gap: 0.75rem;
  }

  header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 0.8rem;
  }

  h2 {
    margin: 0;
    font-size: 1.02rem;
  }

  .meta {
    margin: 0.15rem 0 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.86rem;
  }

  .empty {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
  }

  .control-bar {
    display: grid;
    gap: 0.55rem;
  }

  .tag-filters {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .tag-filter {
    font-size: 0.75rem;
    padding: 0.32rem 0.62rem;
  }

  .tag-filter.is-active {
    background: color-mix(in srgb, var(--md-sys-color-primary-container) 70%, var(--md-sys-color-surface) 30%);
    border-color: color-mix(in srgb, var(--md-sys-color-primary) 30%, transparent);
    color: var(--md-sys-color-on-surface);
  }

  .search-box {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    background: var(--md-sys-color-surface-container-low);
    padding: 0.2rem 0.55rem;
  }

  .search-box .material-symbols-outlined {
    font-size: 1rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .search-box input {
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    min-width: 0;
    padding: 0.25rem 0;
  }

  .search-box input:focus {
    outline: none;
  }

  .timeline {
    margin: 0;
    padding: 0 0 0 0.95rem;
    list-style: none;
    display: grid;
    gap: 0.65rem;
    position: relative;
  }

  .timeline::before {
    content: "";
    position: absolute;
    left: 0.3rem;
    top: 0.2rem;
    bottom: 0.2rem;
    width: 2px;
    background: color-mix(in srgb, var(--md-sys-color-outline-variant) 70%, transparent);
  }

  .event {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--radius-md);
    padding: 0.65rem 0.75rem;
    background: var(--md-sys-color-surface-container-low);
    border-left-width: 4px;
    position: relative;
  }

  .event-marker {
    position: absolute;
    left: -1.52rem;
    top: 0.65rem;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 999px;
    background: var(--md-sys-color-surface-container-highest);
    border: 1px solid var(--md-sys-color-outline-variant);
    font-size: 0.76rem;
    display: grid;
    place-items: center;
    color: var(--md-sys-color-on-surface-variant);
  }

  .event.ingest {
    border-left-color: #2f7a51;
  }

  .event.transfer {
    border-left-color: #355ca8;
  }

  .event.generated {
    border-left-color: #b5472c;
  }

  .event.pipeline {
    border-left-color: #7a4aa3;
  }

  .event.files-added {
    background: color-mix(in srgb, var(--md-sys-color-surface-container-low) 84%, #2f7a51 16%);
  }

  .event.processing-completed {
    background: color-mix(in srgb, var(--md-sys-color-surface-container-low) 84%, #355ca8 16%);
  }

  .event-top {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .event-top > div {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .route-badge {
    font-size: 0.72rem;
    background: var(--md-sys-color-surface-container-highest);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    padding: 0.12rem 0.48rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .time-stamp {
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .event-bottom {
    display: flex;
    gap: 0.55rem;
    flex-wrap: wrap;
    margin-top: 0.4rem;
  }

  .event-bottom span {
    font-size: 0.8rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .tag {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.66rem;
    font-weight: 700;
  }

  .focus-strip {
    margin-top: 0.5rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.45rem 0.55rem;
    display: grid;
    gap: 0.35rem;
  }

  .mix-bar,
  .result-meter {
    height: 8px;
    border-radius: 999px;
    background: var(--md-sys-color-surface-container-highest);
    overflow: hidden;
  }

  .mix-bar {
    display: flex;
    gap: 1px;
  }

  .mix-bar span,
  .result-meter span {
    display: block;
    height: 100%;
    border-radius: 999px;
  }

  .result-meter span {
    background: linear-gradient(90deg, #2f7a51, #355ca8);
  }

  .result-caption {
    margin: -0.05rem 0 0;
    font-size: 0.72rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .ingest-strip {
    background: color-mix(in srgb, #2f7a51 12%, var(--md-sys-color-surface));
  }

  .pipeline-strip {
    background: color-mix(in srgb, #355ca8 12%, var(--md-sys-color-surface));
  }

  .focus-head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .focus-head .material-symbols-outlined {
    font-size: 0.95rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .focus-head strong {
    font-size: 0.78rem;
    letter-spacing: 0.01em;
  }

  .focus-head small {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .focus-chips {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .focus-chip {
    font-size: 0.72rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    padding: 0.12rem 0.45rem;
    background: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface-variant);
  }

  .focus-chip.success {
    border-color: rgba(31, 127, 68, 0.3);
    color: #1f7f44;
    background: rgba(31, 127, 68, 0.1);
  }

  .focus-chip.warn {
    border-color: rgba(161, 96, 17, 0.3);
    color: #a16011;
    background: rgba(161, 96, 17, 0.1);
  }

  .focus-chip.name {
    max-width: 260px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  details {
    margin-top: 0.45rem;
    border-top: 1px dashed var(--md-sys-color-outline-variant);
    padding-top: 0.35rem;
  }

  summary {
    cursor: pointer;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
    user-select: none;
  }

  .detail-grid {
    margin-top: 0.45rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.4rem 0.7rem;
  }

  .detail-grid small,
  .name-block small {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-sys-color-on-surface-variant);
  }

  .detail-grid p,
  .name-block p {
    margin: 0.1rem 0 0;
    font-size: 0.8rem;
    word-break: break-word;
  }

  .name-block {
    margin-top: 0.45rem;
  }

  .evidence-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.5rem;
  }

  .evidence-metrics article {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    background: color-mix(in srgb, var(--md-sys-color-surface-container-low) 86%, var(--md-sys-color-primary-container) 14%);
    padding: 0.5rem 0.6rem;
    display: grid;
    gap: 0.2rem;
  }

  .evidence-metrics small {
    margin: 0;
    font-size: 0.72rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .evidence-metrics strong {
    font-size: 0.95rem;
  }

  .forensic-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.55rem;
  }

  .graph-card {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    background: var(--md-sys-color-surface-container-low);
    padding: 0.55rem 0.65rem;
    display: grid;
    gap: 0.4rem;
  }

  .graph-card h3 {
    margin: 0;
    font-size: 0.83rem;
  }

  .bar-row {
    display: grid;
    grid-template-columns: 70px 1fr auto;
    align-items: center;
    gap: 0.4rem;
  }

  .bar-label {
    font-size: 0.73rem;
    color: var(--md-sys-color-on-surface-variant);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-track {
    height: 8px;
    border-radius: 999px;
    background: var(--md-sys-color-surface-container-highest);
    overflow: hidden;
  }

  .bar-track span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #2f7a51, #355ca8);
    border-radius: 999px;
  }

  .chip-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
  }

  .kind-chip {
    font-size: 0.74rem;
    background: var(--md-sys-color-surface-container-highest);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    padding: 0.14rem 0.45rem;
  }

  .kind-empty {
    margin: 0;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .cadence-bars {
    height: 110px;
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.35rem;
    align-items: end;
  }

  .cadence-col {
    display: grid;
    align-items: end;
    justify-items: center;
    gap: 0.2rem;
    height: 100%;
  }

  .cadence-col span {
    width: 100%;
    border-radius: 6px 6px 2px 2px;
    background: linear-gradient(180deg, #355ca8, #2f7a51);
    min-height: 8px;
  }

  .cadence-col small {
    font-size: 0.63rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  @media (max-width: 740px) {
    header {
      flex-direction: column;
      align-items: stretch;
    }

    .timeline {
      padding-left: 0.75rem;
    }

    .event-marker {
      left: -1.35rem;
    }

    .bar-row {
      grid-template-columns: 1fr;
      gap: 0.22rem;
    }
  }
</style>
