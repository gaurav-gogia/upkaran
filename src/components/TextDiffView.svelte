<script>
  export let diff = null;

  function rowTypeLabel(type) {
    if (type === "replace") return "Changed";
    if (type === "add") return "Added";
    if (type === "remove") return "Removed";
    return "Same";
  }
</script>

<section class="panel text-diff">
  {#if !diff}
    <p class="empty">No diff data available.</p>
  {:else}
    <header class="diff-head">
      <h4>Text Diff Baseline</h4>
      <small>
        Same: {diff.counts.equal} | Changed: {diff.counts.replace} | Added: {diff.counts.add} | Removed: {diff.counts.remove}
      </small>
    </header>

    {#if diff.compareSource}
      <p class="source-note">
        Source: left {diff.compareSource.left}, right {diff.compareSource.right}
        {#if diff.compareSource.truncated}
          · clipped to {diff.compareSource.maxLines} lines per side
        {/if}
      </p>
    {/if}

    <div class="diff-wrap">
      <table class="diff-table" aria-label="Text compare result">
        <thead>
          <tr>
            <th class="line-col">L#</th>
            <th>{diff.leftName}</th>
            <th class="line-col">R#</th>
            <th>{diff.rightName}</th>
            <th class="type-col">Type</th>
          </tr>
        </thead>
        <tbody>
          {#each diff.rows as row, idx (`${row.type}-${idx}`)}
            <tr class="row-{row.type}">
              <td class="line-col">{row.leftNumber ?? "-"}</td>
              <td><pre>{row.leftText}</pre></td>
              <td class="line-col">{row.rightNumber ?? "-"}</td>
              <td><pre>{row.rightText}</pre></td>
              <td class="type-col">{rowTypeLabel(row.type)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .text-diff {
    padding: 0.9rem;
  }

  .diff-head {
    display: flex;
    justify-content: space-between;
    gap: 0.7rem;
    align-items: baseline;
    margin-bottom: 0.55rem;
  }

  h4 {
    margin: 0;
    font-size: 0.95rem;
  }

  small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.76rem;
  }

  .empty {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.86rem;
  }

  .source-note {
    margin: 0 0 0.5rem;
    font-size: 0.76rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .diff-wrap {
    overflow: auto;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    background: var(--md-sys-color-surface-container-low);
    max-height: 460px;
  }

  .diff-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 920px;
  }

  .diff-table th,
  .diff-table td {
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.4rem 0.45rem;
    font-size: 0.8rem;
  }

  .diff-table thead th {
    position: sticky;
    top: 0;
    background: var(--md-sys-color-surface-container-highest);
    z-index: 1;
  }

  .line-col {
    width: 3.2rem;
    color: var(--md-sys-color-on-surface-variant);
    font-variant-numeric: tabular-nums;
  }

  .type-col {
    width: 5.5rem;
    font-weight: 600;
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  }

  .row-equal {
    background: transparent;
  }

  .row-replace {
    background: color-mix(in srgb, #f4a261 16%, transparent);
  }

  .row-add {
    background: color-mix(in srgb, #2a9d8f 14%, transparent);
  }

  .row-remove {
    background: color-mix(in srgb, #e76f51 14%, transparent);
  }
</style>
