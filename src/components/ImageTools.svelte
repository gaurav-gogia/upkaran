<script>
  import { createEventDispatcher } from "svelte";
  import CropTool from "./CropTool.svelte";
  import { compressImage, cropImageByNormalizedRect, convertImage, getCompressionRecommendation } from "../js/image-tools.js";
  import { imagesToDjvu } from "../js/djvu-tools.js";

  export let files = [];
  export let busy = false;
  let convertTo = "webp";
  let compressionMode = "balanced";
  let compressDuringConvert = true;

  const CONVERT_QUALITY_BY_MODE = {
    "best-quality": 0.9,
    balanced: 0.75,
    "best-compression": 0.5,
    "extreme-compression": 0.25
  };

  const COMPRESSION_MODES = {
    "best-quality": "Best Quality",
    balanced: "Balanced",
    "best-compression": "Best Compression",
    "extreme-compression": "Extreme Compression (not recommended)"
  };

  const dispatch = createEventDispatcher();

  $: recommendations = files.map((file) => getCompressionRecommendation(file));
  $: recommendationCounts = recommendations.reduce((acc, recommendation) => {
    const next = { ...acc };
    const key = recommendation.format;
    next[key] = (next[key] || 0) + 1;
    return next;
  }, {});
  $: recommendedFormat = Object.entries(recommendationCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "webp";
  $: recommendationReason = recommendations[0]?.reason || "";

  function extFromMime(mimeType, fallback = "png") {
    const map = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif",
      "image/gif": "gif",
      "image/svg+xml": "svg",
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
      if (task === "to-djvu") {
        const blob = await imagesToDjvu(files, (value) => dispatch("progress", value));
        const base = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : `images-${files.length}`;
        dispatch("output", [{ name: `${base}.djvu`, blob }]);
        dispatch("progress", 100);
        return;
      }

      const outputs = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (task === "compress") {
          const blob = await compressImage(file, { mode: compressionMode });
          const ext = extFromMime(blob.type, "jpg");
          outputs.push({ name: `${file.name.replace(/\.[^.]+$/, "")}-compressed.${ext}`, blob });
        }

        if (task === "convert") {
          const quality = compressDuringConvert
            ? (CONVERT_QUALITY_BY_MODE[compressionMode] || 0.75)
            : 1;
          const blob = await convertImage(file, convertTo, quality);
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
  <small>
    Auto Compress quickly reduces size and may keep or change format for best result. Convert always uses your chosen target format.
  </small>
  <small>
    Recommendation note: JPEG is best for universal compatibility; WebP/AVIF can be smaller when compatibility requirements are flexible.
  </small>

  <label for="img-compression-mode">Compression profile</label>
  <select id="img-compression-mode" bind:value={compressionMode}>
    <option value="best-quality">Best Quality</option>
    <option value="balanced">Balanced</option>
    <option value="best-compression">Best Compression (min quality 50%)</option>
    <option value="extreme-compression">Extreme Compression (not recommended)</option>
  </select>
  <small>
    Active profile: {COMPRESSION_MODES[compressionMode]}. Compression keeps image resolution unchanged and adjusts encoding quality/format.
  </small>

  <label for="img-convert-to">Convert target</label>
  <select id="img-convert-to" bind:value={convertTo}>
    <option value="png">PNG</option>
    <option value="jpeg">JPEG</option>
    <option value="webp">WebP</option>
    <option value="avif">AVIF</option>
    <option value="svg">SVG</option>
  </select>

  <label class="convert-toggle">
    <input type="checkbox" bind:checked={compressDuringConvert} disabled={busy} />
    Apply compression during convert
  </label>
  <small>
    {#if compressDuringConvert}
      Convert uses the selected compression profile.
    {:else}
      Convert keeps maximum quality for the chosen output format (conversion only).
    {/if}
  </small>
  <small>
    SVG target preserves existing vector SVG files. Raster images converted to SVG are embedded as image data inside an SVG wrapper.
  </small>

  {#if files.length > 0}
    <small class="recommendation">
      Recommendation: convert to {recommendedFormat.toUpperCase()} for smaller files. {recommendationReason}
      Use {compressDuringConvert ? "Convert + Compress" : "Convert"} to apply this recommendation.
    </small>
    <button
      class="secondary recommend-btn"
      type="button"
      on:click={() => (convertTo = recommendedFormat)}
      disabled={busy}
    >
      Set Convert Target to Recommended ({recommendedFormat.toUpperCase()})
    </button>
  {/if}

  <div class="actions">
    <button on:click={() => run("compress")} disabled={busy || files.length < 1}>Auto Compress</button>
    <button on:click={() => run("convert")} disabled={busy || files.length < 1}>
      {compressDuringConvert ? "Convert + Compress" : "Convert"}
    </button>
    <button on:click={() => run("to-djvu")} disabled={busy || files.length < 1}>Images to DjVu</button>
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

  .recommendation {
    margin-bottom: 0.55rem;
  }

  .recommend-btn {
    margin-bottom: 0.8rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .convert-toggle {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 0.3rem;
  }

  .actions button {
    min-width: 0;
  }
</style>
