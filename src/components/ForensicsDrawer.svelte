<script>
  import { createEventDispatcher } from "svelte";
  import { fly } from "svelte/transition";
  import ForensicsView from "./ForensicsView.svelte";

  export let entry = null;

  const dispatch = createEventDispatcher();

  function closeDrawer() {
    dispatch("close");
  }

  function collapseDrawer() {
    dispatch("collapse");
  }
</script>

{#if entry}
  <section class="forensics-drawer" in:fly={{ x: 24, duration: 220 }} aria-label="Forensics drawer">
    <header class="forensics-drawer-head">
      <h3>Forensics</h3>
      <div class="forensics-drawer-actions">
        <button class="secondary" type="button" on:click={collapseDrawer}>Hide</button>
        <button class="secondary" type="button" on:click={closeDrawer}>Close</button>
      </div>
    </header>

    <ForensicsView {entry} on:close={closeDrawer} />
  </section>
{/if}

<style>
  .forensics-drawer {
    display: grid;
    gap: 0.55rem;
  }

  .forensics-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--app-radius-md, 12px);
    padding: 0.55rem 0.62rem;
    background: color-mix(in srgb, var(--md-sys-color-surface) 90%, var(--md-sys-color-primary) 10%);
  }

  .forensics-drawer-head h3 {
    margin: 0;
    font-size: 0.84rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-sys-color-on-surface-variant);
  }

  .forensics-drawer-actions {
    display: inline-flex;
    gap: 0.35rem;
  }
</style>
