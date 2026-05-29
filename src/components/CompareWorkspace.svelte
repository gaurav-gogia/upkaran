<script>
  import { compareTextEntries, resolveCompareMode } from "../js/file-compare.js";
  import { measureAsync } from "../js/perf-profile.js";
  import TextDiffView from "./TextDiffView.svelte";
  import PdfCompareView from "./PdfCompareView.svelte";
  import ImageOverlayDiff from "./ImageOverlayDiff.svelte";

  export let files = [];

  let loading = false;
  let compareError = "";
  let compareResult = null;
  let processedSignature = "";
  let lastCompareDurationMs = 0;

  $: pairReady = Array.isArray(files) && files.length === 2;
  $: mode = pairReady ? resolveCompareMode(files[0], files[1]) : "unsupported";
  $: signature = pairReady
    ? `${files[0]?.id || files[0]?.name}|${files[1]?.id || files[1]?.name}|${mode}`
    : "";
  $: modeLabel =
    mode === "text"
      ? "Text diff"
      : mode === "text-fallback"
        ? "Normalized diff"
      : mode === "pdf"
        ? "PDF side-by-side"
        : mode === "image"
          ? "Image overlay"
          : "Unsupported pair";
  $: compareHint =
    !pairReady
      ? "Select exactly two files to open compare mode."
      : mode === "unsupported"
        ? "Choose two files to compare."
        : "";

  $: if (!pairReady) {
    processedSignature = "";
    compareResult = null;
    compareError = "";
    loading = false;
  } else if (signature !== processedSignature) {
    processedSignature = signature;
    void runCompare();
  }

  async function runCompare() {
    if (!pairReady) return;

    if (mode !== "text" && mode !== "text-fallback" && mode !== "pdf" && mode !== "image") {
      compareResult = null;
      compareError = "Compare is unavailable for this pair.";
      loading = false;
      return;
    }

    if (mode === "pdf" || mode === "image") {
      compareResult = { mode };
      compareError = "";
      loading = false;
      lastCompareDurationMs = 0;
      return;
    }

    loading = true;
    compareError = "";
    compareResult = null;

    try {
      const { result, durationMs } = await measureAsync("compare.text", () =>
        compareTextEntries(files[0], files[1], {
          maxBytes: 4 * 1024 * 1024,
          maxLines: 1800,
        }), {
          leftKind: files[0]?.kind || "unknown",
          rightKind: files[1]?.kind || "unknown",
        }
      );

      compareResult = result;
      lastCompareDurationMs = Math.round(durationMs);
    } catch (error) {
      compareError = error?.message || "Compare failed.";
    } finally {
      loading = false;
    }
  }
</script>

<section class="panel compare-workspace">
  <header>
    <h3>Compare Workspace</h3>
    <p>Compare for two selected files with visual modes for PDF/images and normalized fallback for all other supported file types.</p>
    {#if pairReady}
      <small class="mode-badge">Mode: {modeLabel}</small>
    {/if}
  </header>

  {#if compareHint}
    <p class="state hint">{compareHint}</p>
  {/if}

  {#if lastCompareDurationMs > 0}
    <p class="state hint">Last text compare time: {lastCompareDurationMs} ms</p>
  {/if}

  {#if loading}
    <p class="state">Comparing files...</p>
  {:else if compareError}
    <p class="state error">{compareError}</p>
  {:else if compareResult?.mode === "text"}
    <TextDiffView diff={compareResult} />
  {:else if compareResult?.mode === "pdf"}
    <PdfCompareView {files} />
  {:else if compareResult?.mode === "image"}
    <ImageOverlayDiff {files} />
  {/if}
</section>

<style>
  .compare-workspace {
    padding: 1rem;
    display: grid;
    gap: 0.6rem;
  }

  h3 {
    margin: 0 0 0.3rem;
  }

  p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
  }

  .mode-badge {
    display: inline-flex;
    margin-top: 0.3rem;
    border-radius: 999px;
    border: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.15rem 0.6rem;
    font-size: 0.72rem;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container-low);
  }

  .state {
    font-size: 0.88rem;
  }

  .state.hint {
    border: 1px dashed var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.42rem 0.6rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .state.error {
    color: var(--md-sys-color-error);
  }
</style>
