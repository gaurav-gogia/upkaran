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
  <h3>DjVu Tooling</h3>
  <p>Convert DjVu documents to PDF or extract pages as images directly in your browser.</p>

  <label for="djvu-image-format">Image output format</label>
  <select id="djvu-image-format" bind:value={imageFormat}>
    <option value="png">PNG</option>
    <option value="jpeg">JPEG</option>
    <option value="webp">WebP</option>
  </select>

  <div class="actions">
    <button on:click={() => run("to-pdf")} disabled={busy || files.length < 1}>DjVu to PDF</button>
    <button on:click={() => run("to-images")} disabled={busy || files.length < 1}>DjVu to Images</button>
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
    margin: 0 0 0.55rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  label {
    display: block;
    margin-bottom: 0.3rem;
    font-size: 0.85rem;
    margin-top: 0.6rem;
  }

  select {
    width: 100%;
    margin-bottom: 0.9rem;
    border-radius: 10px;
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.45rem 0.55rem;
    background: #fff;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
</style>
