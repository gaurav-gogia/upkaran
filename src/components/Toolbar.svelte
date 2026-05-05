<script>
  import { createEventDispatcher } from "svelte";
  export let route = "empty";
  export let processing = false;

  const dispatch = createEventDispatcher();

  const labels = {
    empty: "Awaiting files",
    pdf: "PDF tools",
    image: "Image tools",
    file: "File tools",
    mixed: "Mixed files"
  };
</script>

<nav class="panel toolbar">
  <p>{labels[route] ?? "Ready"}</p>
  <button class="secondary" disabled={processing} on:click={() => dispatch("clear")}>Clear</button>
</nav>

<style>
  .toolbar {
    padding: 0.8rem 1rem;
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  p {
    margin: 0;
    font-weight: 600;
  }
</style>
