<script>
  import { createEventDispatcher } from "svelte";

  export let items = [];
  export let lastTool = "";

  const dispatch = createEventDispatcher();

  function formatTime(isoTime) {
    if (!isoTime) return "";
    try {
      return new Date(isoTime).toLocaleString();
    } catch {
      return isoTime;
    }
  }
</script>

<section class="panel recent-activity" aria-labelledby="recent-activity-title">
  <header>
    <div>
      <h2 id="recent-activity-title">Recent activity</h2>
      {#if lastTool}
        <p class="meta">Last used tool: {lastTool}</p>
      {/if}
    </div>
    <button class="secondary" type="button" on:click={() => dispatch("clear")}>Clear history</button>
  </header>

  {#if items.length === 0}
    <p class="empty">No activity yet. Process files to build a local timeline.</p>
  {:else}
    <ul>
      {#each items as item (item.id)}
        <li>
          <div class="top-row">
            <strong>{item.action}</strong>
            <span>{item.toolKey}</span>
          </div>
          <div class="bottom-row">
            <span>{item.fileCount} file(s){item.outputCount ? ` -> ${item.outputCount} output(s)` : ""}</span>
            <span>{formatTime(item.isoTime)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .recent-activity {
    padding: 1rem;
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
    font-size: 1rem;
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

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.55rem;
  }

  li {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--radius-md);
    padding: 0.65rem 0.7rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .top-row,
  .bottom-row {
    display: flex;
    justify-content: space-between;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .top-row span,
  .bottom-row span {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.84rem;
  }

  @media (max-width: 740px) {
    header {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
