<script>
  import { createEventDispatcher } from "svelte";
  import { compressGzip, createZipBatch, createTarBatch, toDownloadFileName } from "../js/file-tools.js";
  import { formatBytes } from "../js/detect.js";

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
  <h3>Archive Command Center</h3>
  <p>Package and compress file sets using local WASM-backed archive operations.</p>

  <div class="tool-meta" aria-label="Archive workspace summary">
    <span class="meta-chip">Files loaded <strong>{files.length}</strong></span>
    <span class="meta-chip">Total input size <strong>{formatBytes(files.reduce((sum, file) => sum + (file.size || 0), 0))}</strong></span>
    <span class="meta-chip">Primary file <strong>{files[0]?.name ?? "No file selected"}</strong></span>
  </div>

  <div class="actions ops-primary">
    <button on:click={() => run("gzip")} disabled={busy || files.length < 1}>GZIP</button>
    <button on:click={() => run("zip")} disabled={busy || files.length < 1}>ZIP Batch</button>
    <button on:click={() => run("tar")} disabled={busy || files.length < 1}>TAR Batch</button>
  </div>
</section>

<style>
  .tool {
    padding: 1.2rem;
    display: grid;
    gap: 0.8rem;
  }

  h3 {
    margin: 0;
    letter-spacing: 0.01em;
    font-size: clamp(1.08rem, 1.5vw, 1.35rem);
  }

  p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    line-height: 1.45;
  }

  .tool-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 999px;
    padding: 0.28rem 0.62rem;
    font-size: 0.76rem;
    color: var(--md-sys-color-on-surface-variant);
    background: color-mix(in srgb, var(--md-sys-color-surface) 82%, var(--md-sys-color-primary) 18%);
  }

  .meta-chip strong {
    color: var(--md-sys-color-on-surface);
    font-weight: 700;
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .ops-primary {
    padding: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 20%, var(--md-sys-color-outline-variant));
    border-radius: var(--app-radius-sm, 12px);
    background: color-mix(in srgb, var(--md-sys-color-primary) 8%, var(--md-sys-color-surface));
  }
</style>
