<script>
  import { createEventDispatcher } from "svelte";
  import CropTool from "./CropTool.svelte";
  import { compressImage, cropImageByNormalizedRect, convertImage } from "../js/image-tools.js";

  export let files = [];
  export let busy = false;
  let convertTo = "webp";

  const dispatch = createEventDispatcher();

  function extFromMime(mimeType, fallback = "png") {
    const map = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif",
      "image/gif": "gif",
      "image/bmp": "bmp",
      "image/tiff": "tiff"
    };

    return map[mimeType] || fallback;
  }

  async function run(task) {
    if (!files.length || busy) return;

    dispatch("processing", true);
    dispatch("progress", 10);
    try {
      const outputs = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (task === "compress") {
          const blob = await compressImage(file, 0.8);
          const ext = extFromMime(blob.type, "jpg");
          outputs.push({ name: `${file.name.replace(/\.[^.]+$/, "")}-compressed.${ext}`, blob });
        }

        if (task === "convert") {
          const blob = await convertImage(file, convertTo, 0.85);
          const ext = extFromMime(blob.type, convertTo === "jpeg" ? "jpg" : convertTo);
          outputs.push({ name: `${file.name.replace(/\.[^.]+$/, "")}-converted.${ext}`, blob });
        }

        dispatch("progress", Math.round(((i + 1) / files.length) * 100));
      }

      dispatch("output", outputs);
      dispatch("progress", 100);
    } catch (error) {
      dispatch("error", error.message);
    } finally {
      dispatch("processing", false);
    }
  }

  async function applyCrop(event) {
    if (!files.length || busy) return;

    dispatch("processing", true);
    dispatch("progress", 8);
    try {
      const { normalizedRect } = event.detail;
      const outputs = [];

      for (let i = 0; i < files.length; i += 1) {
        const blob = await cropImageByNormalizedRect(files[i], normalizedRect);
        const ext = extFromMime(blob.type, "png");
        outputs.push({
          name: `${files[i].name.replace(/\.[^.]+$/, "")}-crop.${ext}`,
          blob
        });
        dispatch("progress", Math.round(((i + 1) / files.length) * 100));
      }

      dispatch("output", outputs);
      dispatch("progress", 100);
    } catch (error) {
      dispatch("error", error.message);
    } finally {
      dispatch("processing", false);
    }
  }
</script>

<section class="panel tool">
  <h3>Image Tooling</h3>
  <p>Compress, crop, and convert many formats client-side, including PNG, JPEG, WebP, AVIF, GIF, HEIC/HEIF, TIFF, BMP, and more.</p>
  <small>HEIC/HEIF decoding loads on demand the first time you process those files.</small>
  <small>Operations run on all selected images from the file list.</small>

  <label for="img-convert-to">Convert target</label>
  <select id="img-convert-to" bind:value={convertTo}>
    <option value="png">PNG</option>
    <option value="jpeg">JPEG</option>
    <option value="webp">WebP</option>
    <option value="avif">AVIF</option>
  </select>

  <div class="actions">
    <button on:click={() => run("compress")} disabled={busy || files.length < 1}>Compress Selection</button>
    <button on:click={() => run("convert")} disabled={busy || files.length < 1}>Convert Selection</button>
  </div>

  <CropTool {files} {busy} on:apply={applyCrop} />
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

  small {
    display: block;
    margin-bottom: 0.45rem;
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

  .actions button {
    min-width: 0;
  }
</style>
