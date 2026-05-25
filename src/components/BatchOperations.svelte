<script>
  import { createEventDispatcher } from "svelte";
  import { BATCH_OPERATION_IDS, runBatchOperation } from "../js/batch-ops.js";
  import { measureAsync } from "../js/perf-profile.js";

  export let files = [];
  export let busy = false;

  const dispatch = createEventDispatcher();

  const IMAGE_MODE_OPTIONS = [
    { value: "best-quality", label: "Best quality" },
    { value: "balanced", label: "Balanced" },
    { value: "best-compression", label: "Best compression" },
    { value: "extreme-compression", label: "Extreme compression" },
  ];

  const PDF_QUALITY_OPTIONS = [
    { value: 0.9, label: "High quality" },
    { value: 0.75, label: "Balanced" },
    { value: 0.55, label: "Compact" },
  ];

  const PDF_IMAGE_FORMAT_OPTIONS = [
    { value: "png", label: "PNG" },
    { value: "jpeg", label: "JPEG" },
    { value: "webp", label: "WEBP" },
  ];

  let selectedOperation = "";
  let imageMode = "balanced";
  let pdfQuality = 0.75;
  let pdfImageFormat = "png";
  let rows = [];
  let running = false;
  let progress = 0;
  let lastRunSummary = "";
  let lastRunTone = "info";
  let lastRunDurationMs = 0;

  function buildAvailableOperations(kind) {
    if (kind === "image") {
      return [
        { id: BATCH_OPERATION_IDS.IMAGE_COMPRESS, label: "Compress images" },
        { id: BATCH_OPERATION_IDS.IMAGE_TO_DJVU, label: "Images to DjVu" },
      ];
    }

    if (kind === "pdf") {
      return [
        { id: BATCH_OPERATION_IDS.PDF_COMPRESS, label: "Compress PDFs" },
        { id: BATCH_OPERATION_IDS.PDF_TO_IMAGES, label: "PDF to images" },
        { id: BATCH_OPERATION_IDS.PDF_TO_DJVU, label: "PDF to DjVu" },
      ];
    }

    if (kind === "djvu") {
      return [
        { id: BATCH_OPERATION_IDS.DJVU_TO_PDF, label: "DjVu to PDF" },
        { id: BATCH_OPERATION_IDS.DJVU_TO_IMAGES, label: "DjVu to images" },
      ];
    }

    return [];
  }

  function normalizeKind(list) {
    if (!list.length) return "";
    const first = list[0]?.kind || "";
    if (!first) return "";
    return list.every((item) => item.kind === first) ? first : "";
  }

  $: batchKind = normalizeKind(files);
  $: fileCount = files.length;
  $: availableOperations = buildAvailableOperations(batchKind);
  $: if (!availableOperations.some((op) => op.id === selectedOperation)) {
    selectedOperation = availableOperations[0]?.id || "";
  }

  $: totalItems = rows.length;
  $: successItems = rows.filter((row) => row.status === "success").length;
  $: failedItems = rows.filter((row) => row.status === "error").length;

  $: eligibilityMessage =
    fileCount < 1
      ? "Add files to start a batch run."
      : fileCount < 2
        ? "Select at least two files to run a meaningful batch queue."
        : !batchKind
          ? "Batch currently supports one type at a time: all DjVu, all PDF, or all image files."
          : "";

  function resetRows() {
    rows = files.map((file, index) => ({
      id: file.id,
      index,
      name: file.name,
      status: "queued",
      outputName: "",
      error: "",
    }));
  }

  function patchRow(update) {
    rows = rows.map((row) => {
      if (row.id !== update.id) return row;
      return {
        ...row,
        status: update.status || row.status,
        outputName: update.outputName || row.outputName,
        error: update.error || "",
      };
    });
  }

  async function runBatch() {
    if (busy || running || files.length < 1 || !selectedOperation) return;

    resetRows();
    running = true;
    progress = 8;
    lastRunSummary = "";
    lastRunTone = "info";
    dispatch("processing", true);

    try {
      const { result, durationMs } = await measureAsync("batch.run", () =>
        runBatchOperation(files, selectedOperation, {
          imageMode,
          pdfQuality,
          pdfImageFormat,
          onProgress(nextProgress) {
            progress = nextProgress;
            dispatch("progress", nextProgress);
          },
          onItemUpdate(update) {
            patchRow(update);
          },
        }), {
          fileCount: files.length,
          kind: batchKind || "unknown",
          operation: selectedOperation,
        }
      );
      lastRunDurationMs = Math.round(durationMs);

      const resultData = result;

      if (resultData.outputs.length > 0) {
        dispatch("output", resultData.outputs);
      }

      const failed = resultData.items.filter((item) => item.status === "error").length;
      const succeeded = resultData.outputs.length;

      if (succeeded < 1) {
        dispatch("error", "Batch completed with no successful outputs.");
        lastRunSummary = "Batch finished with no successful outputs.";
        lastRunTone = "error";
      } else if (failed > 0) {
        lastRunSummary = `Batch completed with ${succeeded} success and ${failed} failure${failed === 1 ? "" : "s"}.`;
        lastRunTone = "warn";
      } else {
        lastRunSummary = `Batch completed successfully. ${succeeded} output${succeeded === 1 ? "" : "s"} generated.`;
        lastRunTone = "success";
      }

      progress = 100;
      dispatch("progress", 100);
    } catch (error) {
      dispatch("error", error?.message || "Batch operation failed.");
      lastRunSummary = error?.message || "Batch operation failed.";
      lastRunTone = "error";
    } finally {
      running = false;
      dispatch("processing", false);
    }
  }

  function rowStatusLabel(status) {
    if (status === "success") return "Done";
    if (status === "error") return "Failed";
    if (status === "running") return "Running";
    return "Queued";
  }
</script>

<section class="panel tool batch-tool">
  <h3>Batch Operations</h3>
  <p>Run a queue over selected files with per-item status and result tracking.</p>

  {#if eligibilityMessage}
    <small class="state-hint">{eligibilityMessage}</small>
  {/if}

  {#if busy && !running}
    <small class="state-hint">Another tool is processing. Batch controls are temporarily disabled.</small>
  {/if}

  {#if lastRunSummary}
    <small class="state-{lastRunTone}">{lastRunSummary}</small>
    {#if lastRunDurationMs > 0}
      <small class="state-hint">Last run time: {lastRunDurationMs} ms</small>
    {/if}
  {/if}

  {#if availableOperations.length < 1}
    <small>Select files of one supported type (DjVu, PDF, or image) to run a batch operation.</small>
  {:else}
    <label for="batch-operation">Operation</label>
    <select id="batch-operation" bind:value={selectedOperation} disabled={busy || running}>
      {#each availableOperations as operation}
        <option value={operation.id}>{operation.label}</option>
      {/each}
    </select>

    {#if selectedOperation === BATCH_OPERATION_IDS.IMAGE_COMPRESS}
      <label for="batch-image-mode">Image profile</label>
      <select id="batch-image-mode" bind:value={imageMode} disabled={busy || running}>
        {#each IMAGE_MODE_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    {/if}

    {#if selectedOperation === BATCH_OPERATION_IDS.PDF_COMPRESS}
      <label for="batch-pdf-quality">PDF quality</label>
      <select id="batch-pdf-quality" bind:value={pdfQuality} disabled={busy || running}>
        {#each PDF_QUALITY_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    {/if}

    {#if selectedOperation === BATCH_OPERATION_IDS.PDF_TO_IMAGES || selectedOperation === BATCH_OPERATION_IDS.DJVU_TO_IMAGES}
      <label for="batch-pdf-image-format">Image format</label>
      <select id="batch-pdf-image-format" bind:value={pdfImageFormat} disabled={busy || running}>
        {#each PDF_IMAGE_FORMAT_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    {/if}

    <div class="actions">
      <button type="button" on:click={runBatch} disabled={busy || running || files.length < 1}>
        {running ? "Running batch..." : `Run on ${files.length} file${files.length === 1 ? "" : "s"}`}
      </button>
    </div>

    {#if totalItems > 0}
      <small>
        Progress: {progress}% | Success: {successItems} | Failed: {failedItems}
      </small>

      <div class="batch-table-wrap">
        <table class="batch-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row}
              <tr>
                <td title={row.name}>{row.name}</td>
                <td class="status-{row.status}">{rowStatusLabel(row.status)}</td>
                <td title={row.error || row.outputName}>
                  {#if row.status === "error"}
                    {row.error}
                  {:else}
                    {row.outputName || "-"}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <small class="state-hint">No batch run yet for this selection.</small>
    {/if}
  {/if}
</section>

<style>
  .batch-tool {
    padding: 1rem;
  }

  h3 {
    margin: 0 0 0.35rem;
  }

  p {
    margin: 0 0 0.55rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  small {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .state-hint {
    border: 1px dashed var(--md-sys-color-outline-variant);
    border-radius: 8px;
    padding: 0.35rem 0.5rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .state-success {
    color: #1f7f44;
    font-weight: 600;
  }

  .state-warn {
    color: #a16011;
    font-weight: 600;
  }

  .state-error {
    color: var(--md-sys-color-error);
    font-weight: 600;
  }

  label {
    display: block;
    margin-top: 0.55rem;
    margin-bottom: 0.3rem;
    font-size: 0.85rem;
  }

  select {
    width: 100%;
    margin-bottom: 0.75rem;
    border-radius: 10px;
    border: 1px solid var(--md-sys-color-outline);
    padding: 0.45rem 0.55rem;
    background: #fff;
  }

  .actions {
    display: flex;
    gap: 0.6rem;
    margin-bottom: 0.55rem;
  }

  .batch-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
  }

  .batch-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 520px;
  }

  .batch-table th,
  .batch-table td {
    text-align: left;
    padding: 0.5rem 0.55rem;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    font-size: 0.84rem;
    vertical-align: top;
  }

  .batch-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .status-success {
    color: #1f7f44;
    font-weight: 600;
  }

  .status-error {
    color: #b23b3b;
    font-weight: 600;
  }

  .status-running {
    color: #1a6b8a;
    font-weight: 600;
  }
</style>
