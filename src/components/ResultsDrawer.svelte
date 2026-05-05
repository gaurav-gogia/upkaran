<script>
  import { fade } from "svelte/transition";
  import { results, removeResult, clearResults } from "../js/results-store.js";
  import { saveBlob } from "../js/download.js";
  import { formatBytes } from "../js/detect.js";

  function mimeLabel(mimeType = "") {
    if (mimeType.startsWith("image/")) return mimeType.split("/")[1].toUpperCase();
    if (mimeType === "application/pdf") return "PDF";
    if (mimeType === "application/zip") return "ZIP";
    if (mimeType === "application/x-tar") return "TAR";
    if (mimeType === "application/gzip" || mimeType === "application/x-gzip") return "GZ";
    return "FILE";
  }

  function download(entry) {
    saveBlob(entry.blob, entry.name);
  }

  function downloadAll() {
    for (const entry of $results) {
      saveBlob(entry.blob, entry.name);
    }
  }
</script>

{#if $results.length > 0}
  <section class="drawer panel" transition:fade>
    <header class="drawer-header">
      <div class="title-row">
        <h3>Results</h3>
        <span class="badge">{$results.length}</span>
      </div>
      <div class="header-actions">
        <button on:click={downloadAll}>Download all</button>
        <button class="secondary" on:click={clearResults}>Clear</button>
      </div>
    </header>

    <div class="cards">
      {#each $results as entry (entry.id)}
        <article class="card panel" transition:fade>
          <div class="preview-wrap">
            {#if entry.previewUrl}
              <img src={entry.previewUrl} alt={entry.name} class="thumb" />
            {:else}
              <div class="type-badge" aria-label={mimeLabel(entry.mimeType)}>
                {mimeLabel(entry.mimeType)}
              </div>
            {/if}
          </div>

          <div class="card-meta">
            <strong class="card-name" title={entry.name}>{entry.name}</strong>
            <small>{formatBytes(entry.size)}</small>
          </div>

          <div class="card-actions">
            <button on:click={() => download(entry)}>Download</button>
            <button
              class="secondary remove-btn"
              aria-label="Remove {entry.name}"
              on:click={() => removeResult(entry.id)}
            >Remove</button>
          </div>
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .drawer {
    padding: 1rem;
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 0.9rem;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  h3 {
    margin: 0;
    font-size: 1rem;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.75rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    gap: 0.6rem;
    overflow: hidden;
  }

  .preview-wrap {
    width: 100%;
    aspect-ratio: 16 / 9;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--md-sys-color-surface-variant);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .type-badge {
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: var(--md-sys-color-primary);
    user-select: none;
  }

  .card-meta {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }

  .card-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.85rem;
  }

  small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.78rem;
  }

  .card-actions {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .card-actions button {
    flex: 1;
    padding: 0.5rem 0.6rem;
    font-size: 0.8rem;
  }
</style>
