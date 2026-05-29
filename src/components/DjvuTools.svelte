<script>
  import { createEventDispatcher } from "svelte";
  import { djvuToPdf, djvuToImages } from "../js/djvu-tools.js";

  export let files = [];
  export let busy = false;

  const dispatch = createEventDispatcher();
  let imageFormat = "png";

  async function run(task) {
    if (!files.length || busy) return;

    dispatch("processing", true);
    dispatch("progress", 10);

    try {
      const outputs = [];

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];

        if (task === "to-pdf") {
          const blob = await djvuToPdf(file, (progress) => {
            const fileProgress = (i + progress / 100) / files.length;
            dispatch("progress", Math.round(fileProgress * 100));
          });

          outputs.push({
            name: `${file.name.replace(/\.djvu$/i, "")}.pdf`,
            blob
          });
        }

        if (task === "to-images") {
          const pages = await djvuToImages(file, imageFormat, (progress) => {
            const fileProgress = (i + progress / 100) / files.length;
            dispatch("progress", Math.round(fileProgress * 100));
          });

          outputs.push(...pages);
        }
      }

      dispatch("output", outputs);
      dispatch("progress", 100);
    } catch (error) {
      dispatch("error", error?.message || "DjVu conversion failed.");
    } finally {
      dispatch("processing", false);
    }
  }
</script>

<section class="panel tool">
  <h3>DjVu Command Center</h3>
  <p>Convert DjVu documents into review-ready PDF or image outputs using local processing.</p>

  <div class="tool-meta" aria-label="DjVu workspace summary">
    <span class="meta-chip">Files loaded <strong>{files.length}</strong></span>
    <span class="meta-chip">Image target <strong>{imageFormat.toUpperCase()}</strong></span>
    <span class="meta-chip">Primary file <strong>{files[0]?.name ?? "No file selected"}</strong></span>
  </div>

  <label for="djvu-image-format">Image output format</label>
  <select id="djvu-image-format" bind:value={imageFormat}>
    <option value="png">PNG</option>
    <option value="jpeg">JPEG</option>
    <option value="webp">WebP</option>
  </select>

  <div class="actions ops-primary">
    <button on:click={() => run("to-pdf")} disabled={busy || files.length < 1}>DjVu to PDF</button>
    <button on:click={() => run("to-images")} disabled={busy || files.length < 1}>DjVu to Images</button>
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

  label {
    display: block;
    margin-bottom: 0.3rem;
    font-size: 0.79rem;
    margin-top: 0.6rem;
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  select {
    width: 100%;
    margin-bottom: 0.9rem;
    border-radius: var(--app-radius-sm, 12px);
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.45rem 0.55rem;
    background: var(--md-sys-color-surface);
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
