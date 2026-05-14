<script>
  import { createEventDispatcher } from "svelte";

  export let canInstall = false;
  export let installed = false;
  export let busy = false;

  const dispatch = createEventDispatcher();
</script>

{#if canInstall || installed}
  <section class="panel install-cta" aria-label="Install app">
    <div>
      <h2>Install Upkaran</h2>
      <p>
        {#if installed}
          App is installed on this device.
        {:else}
          Add this app to your device for faster access and an app-like experience.
        {/if}
      </p>
    </div>
    {#if !installed}
      <button type="button" disabled={busy || !canInstall} on:click={() => dispatch("install")}>Install app</button>
    {/if}
  </section>
{/if}

<style>
  .install-cta {
    padding: 0.95rem 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
  }

  p {
    margin: 0.25rem 0 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.9rem;
  }

  @media (max-width: 740px) {
    .install-cta {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
