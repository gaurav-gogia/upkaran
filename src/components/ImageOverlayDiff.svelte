<script>
  import { onMount } from "svelte";
  import { drawImageToCanvas } from "../js/image-tools.js";
  import { measureAsync } from "../js/perf-profile.js";

  export let files = [];

  let overlayOpacity = 50;
  let loading = false;
  let error = "";
  let leftDataUrl = "";
  let rightDataUrl = "";
  let compareWidth = 0;
  let compareHeight = 0;
  let leftSizeLabel = "";
  let rightSizeLabel = "";
  let dimensionsDiffer = false;
  let loadToken = 0;
  let lastPrepareDurationMs = 0;

  function toDataUrl(canvas) {
    return canvas.toDataURL("image/png");
  }

  async function loadOverlay() {
    if (!Array.isArray(files) || files.length !== 2) return;

    const token = ++loadToken;
    loading = true;
    error = "";

    try {
      const { result, durationMs } = await measureAsync("compare.image.prepare_pair", () =>
        Promise.all([
          drawImageToCanvas(files[0]),
          drawImageToCanvas(files[1]),
        ]), {
          leftType: files[0]?.type || "",
          rightType: files[1]?.type || "",
        }
      );

      const [leftCanvas, rightCanvas] = result;
      lastPrepareDurationMs = Math.round(durationMs);

      if (token !== loadToken) return;

      compareWidth = Math.min(leftCanvas.width, rightCanvas.width);
      compareHeight = Math.min(leftCanvas.height, rightCanvas.height);
      dimensionsDiffer = leftCanvas.width !== rightCanvas.width || leftCanvas.height !== rightCanvas.height;

      if (compareWidth < 1 || compareHeight < 1) {
        throw new Error("Unable to align image dimensions for overlay compare.");
      }

      const normalizedLeft = document.createElement("canvas");
      normalizedLeft.width = compareWidth;
      normalizedLeft.height = compareHeight;
      normalizedLeft.getContext("2d").drawImage(leftCanvas, 0, 0, compareWidth, compareHeight, 0, 0, compareWidth, compareHeight);

      const normalizedRight = document.createElement("canvas");
      normalizedRight.width = compareWidth;
      normalizedRight.height = compareHeight;
      normalizedRight.getContext("2d").drawImage(rightCanvas, 0, 0, compareWidth, compareHeight, 0, 0, compareWidth, compareHeight);

      leftDataUrl = toDataUrl(normalizedLeft);
      rightDataUrl = toDataUrl(normalizedRight);
      leftSizeLabel = `${leftCanvas.width}x${leftCanvas.height}`;
      rightSizeLabel = `${rightCanvas.width}x${rightCanvas.height}`;
    } catch (e) {
      if (token !== loadToken) return;
      error = e?.message || "Unable to prepare image overlay compare.";
      leftDataUrl = "";
      rightDataUrl = "";
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  onMount(loadOverlay);
  $: if (files.length === 2) {
    loadOverlay();
  }
</script>

<section class="panel image-overlay">
  <header>
    <h4>Image Overlay Compare</h4>
    <p>Use opacity slider to blend right image over left image.</p>
  </header>

  {#if loading}
    <p class="state">Preparing images...</p>
  {:else if files.length !== 2}
    <p class="state">Select exactly two image files to compare.</p>
  {:else if error}
    <p class="state error">{error}</p>
  {:else if leftDataUrl && rightDataUrl}
    {#if lastPrepareDurationMs > 0}
      <p class="state note">Last prepare time: {lastPrepareDurationMs} ms</p>
    {/if}
    <div class="meta">
      <small title={files[0]?.name}>Base: {files[0]?.name} ({leftSizeLabel})</small>
      <small title={files[1]?.name}>Overlay: {files[1]?.name} ({rightSizeLabel})</small>
      <small>Aligned compare area: {compareWidth}x{compareHeight}</small>
    </div>

    {#if dimensionsDiffer}
      <p class="state note">
        Input dimensions differ. Overlay uses the shared minimum area to keep alignment stable.
      </p>
    {/if}

    <label for="overlay-opacity">Overlay opacity ({overlayOpacity}%)</label>
    <input id="overlay-opacity" type="range" min="0" max="100" bind:value={overlayOpacity} />

    <div class="overlay-stage">
      <img class="base" src={leftDataUrl} alt={`Base image ${files[0]?.name || "left image"}`} loading="lazy" />
      <img
        class="overlay"
        src={rightDataUrl}
        alt={`Overlay image ${files[1]?.name || "right image"}`}
        loading="lazy"
        style={`opacity:${overlayOpacity / 100}`}
      />
    </div>
  {/if}
</section>

<style>
  .image-overlay {
    padding: 0.9rem;
    display: grid;
    gap: 0.55rem;
  }

  h4 {
    margin: 0 0 0.3rem;
    font-size: 0.95rem;
  }

  p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.84rem;
  }

  .meta {
    display: grid;
    gap: 0.2rem;
  }

  small {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  label {
    font-size: 0.82rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  input[type="range"] {
    width: 100%;
  }

  .overlay-stage {
    position: relative;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    overflow: hidden;
    background: #fff;
  }

  .overlay-stage img {
    width: 100%;
    height: auto;
    display: block;
  }

  .overlay-stage .overlay {
    position: absolute;
    inset: 0;
    transition: opacity 0.1s linear;
  }

  .state {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.86rem;
  }

  .state.error {
    color: var(--md-sys-color-error);
  }

  .state.note {
    border: 1px dashed var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.38rem 0.55rem;
    background: var(--md-sys-color-surface-container-low);
  }
</style>
