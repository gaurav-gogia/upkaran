<script>
  export let profile = null;

  function toHeatColor(entropy) {
    const normalized = Math.max(0, Math.min(1, entropy / 8));
    const hue = (1 - normalized) * 200;
    return `hsl(${hue.toFixed(0)} 78% 45%)`;
  }

  function entropyLabel(value) {
    return Number.isFinite(value) ? value.toFixed(3) : "0.000";
  }
</script>

{#if profile && profile.points.length > 0}
  <div class="entropy-wrap">
    <div class="entropy-bars" role="img" aria-label="Entropy heatmap by file block">
      {#each profile.points as point}
        <div
          class="entropy-bar"
          style={`height:${Math.max(8, Math.round((point.entropy / 8) * 100))}%; background:${toHeatColor(point.entropy)}`}
          title={`Block ${point.index} | Entropy ${entropyLabel(point.entropy)} | Offset ${point.offset}`}
        ></div>
      {/each}
    </div>

    <div class="entropy-legend">
      <span>Low</span>
      <div class="legend-gradient" aria-hidden="true"></div>
      <span>High</span>
    </div>
  </div>
{:else}
  <p class="entropy-empty">No entropy points available for this file.</p>
{/if}

<style>
  .entropy-wrap {
    display: grid;
    gap: 0.5rem;
  }

  .entropy-bars {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    background: var(--md-sys-color-surface-container-low);
    padding: 0.35rem;
    height: 170px;
    display: flex;
    align-items: flex-end;
    gap: 1px;
    overflow: hidden;
  }

  .entropy-bar {
    flex: 1 1 auto;
    min-width: 2px;
    border-radius: 2px 2px 0 0;
    opacity: 0.95;
  }

  .entropy-legend {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .legend-gradient {
    flex: 1;
    height: 8px;
    border-radius: 999px;
    background: linear-gradient(90deg, hsl(200 78% 45%) 0%, hsl(0 78% 45%) 100%);
  }

  .entropy-empty {
    margin: 0.2rem 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.85rem;
    font-style: italic;
  }
</style>
