<script>
  import { createEventDispatcher } from "svelte";
  import { compressGzip, createZipBatch, createTarBatch, toDownloadFileName } from "../js/file-tools.js";

  export let files = [];
  export let busy = false;

  const dispatch = createEventDispatcher();

  async function run(task) {
    if (!files.length || busy) return;

    dispatch("processing", true);
    dispatch("progress", 20);
    try {
      if (task === "gzip") {
        const blob = await compressGzip(files[0]);
        dispatch("output", [{ name: toDownloadFileName(files[0].name, "gz"), blob }]);
      }
      if (task === "zip") {
        const blob = await createZipBatch(files);
        dispatch("output", [{ name: "batch.zip", blob }]);
      }
      if (task === "tar") {
        const blob = await createTarBatch(files);
        dispatch("output", [{ name: "batch.tar", blob }]);
      }
      dispatch("progress", 100);
    } catch (error) {
      dispatch("error", error.message);
    } finally {
      dispatch("processing", false);
    }
  }
</script>

<section class="panel tool">
  <h3>File Tooling</h3>
  <p>Batch compression through Go WASM modules (ZIP/TAR/GZIP) with JS fallback where possible.</p>
  <div class="actions">
    <button on:click={() => run("gzip")} disabled={busy || files.length < 1}>GZIP</button>
    <button on:click={() => run("zip")} disabled={busy || files.length < 1}>ZIP Batch</button>
    <button on:click={() => run("tar")} disabled={busy || files.length < 1}>TAR Batch</button>
  </div>
</section>

<style>
  .tool {
    padding: 1rem;
  }

  h3 {
    margin: 0 0 0.4rem;
  }

  p {
    margin: 0 0 1rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
</style>
