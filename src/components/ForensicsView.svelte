<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { analyzeFile } from "../js/forensics.js";
  import { calculateEntropyProfile } from "../js/forensics-entropy.js";
  import {
    buildIntegrityReport,
    integrityReportToJsonBlob,
    integrityReportToText,
  } from "../js/integrity-report.js";
  import { getOperationLineageForEntry } from "../js/operation-lineage.js";
  import { saveBlob } from "../js/download.js";
  import { formatBytes } from "../js/detect.js";
  import { measureAsync } from "../js/perf-profile.js";
  import EntropyHeatmap from "./EntropyHeatmap.svelte";

  export let entry; // enriched file entry

  const dispatch = createEventDispatcher();

  let loading = true;
  let err = null;
  let data = null;
  let activeTab = "overview";
  let copiedHash = null;
  let entropyProfile = null;
  let entropyLoading = false;
  let entropyError = null;
  let entropyBlockSize = 4096;
  let entropyJobId = 0;
  let analyzeDurationMs = 0;
  let entropyDurationMs = 0;
  let integrityReport = null;
  let integrityTextPreview = "";
  let lineageOperations = [];

  const ENTROPY_BLOCK_SIZE_OPTIONS = [1024, 4096, 16384, 65536];

  onMount(async () => {
    try {
      const analysis = await measureAsync("forensics.analyze_file", () => analyzeFile(entry), {
        kind: entry?.kind || "unknown",
        sizeBytes: entry?.size || 0,
      });
      data = analysis.result;
      analyzeDurationMs = Math.round(analysis.durationMs);
      lineageOperations = getOperationLineageForEntry(entry, 20);
      activeTab = "overview";
      loadEntropy();
    } catch (e) {
      err = e.message || "Analysis failed";
    } finally {
      loading = false;
    }
  });

  // ── Tab definitions ──────────────────────────────────────────────────────

  $: tabs = buildTabs(data);

  function buildTabs(d) {
    if (!d) return [{ id: "overview", label: "Overview" }];
    const t = [{ id: "overview", label: "Overview" }];
    if (d._type === "pdf")    { t.push({ id: "metadata", label: "Metadata" }); t.push({ id: "permissions", label: "Permissions" }); }
    if (d._type === "image")  { t.push({ id: "metadata", label: "Metadata" }); if (d.exif) t.push({ id: "exif", label: "EXIF" }); }
    if (d._type === "office") { t.push({ id: "metadata", label: "Metadata" }); t.push({ id: "structure", label: "Structure" }); }
    if (d._type === "text")   { t.push({ id: "metadata", label: "Analysis" }); }
    if (d._type === "zip")    { t.push({ id: "structure", label: "File Tree" }); }
    t.push({ id: "integrity", label: "Integrity" });
    t.push({ id: "entropy", label: "Entropy" });
    return t;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function kindIcon(kind) {
    if (kind === "pdf")      return "picture_as_pdf";
    if (kind === "image")    return "image";
    if (kind === "document") return "description";
    if (kind === "data")     return "table_chart";
    if (kind === "code")     return "code";
    return "folder_zip";
  }

  function kindColor(kind) {
    if (kind === "pdf")      return "#c0392b";
    if (kind === "image")    return "#7b5ea7";
    if (kind === "document") return "#1a6b8a";
    if (kind === "data")     return "#1a6b2f";
    if (kind === "code")     return "#8a5a1a";
    return "#e67e22";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  function fmtCoord(val, pos, neg) {
    if (val == null) return "—";
    const abs = Math.abs(val);
    const deg = Math.floor(abs);
    const min = Math.floor((abs - deg) * 60);
    const sec = (((abs - deg) * 60 - min) * 60).toFixed(2);
    return `${deg}° ${min}' ${sec}" ${val >= 0 ? pos : neg}`;
  }

  async function copyHash(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      copiedHash = key;
      setTimeout(() => (copiedHash = null), 1800);
    } catch { /* ignore */ }
  }

  function gpsMapUrl(lat, lon) {
    return `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
  }

  // ── Tables helpers ───────────────────────────────────────────────────────

  function entries(obj) {
    if (!obj) return [];
    return Object.entries(obj).filter(([, v]) => v != null && v !== "" && v !== false);
  }

  async function loadEntropy() {
    const jobId = ++entropyJobId;
    entropyLoading = true;
    entropyError = null;

    try {
      const profile = await measureAsync("forensics.entropy_profile", () =>
        calculateEntropyProfile(entry.file, {
          blockSize: entropyBlockSize,
          maxPoints: 640,
        }), {
          blockSize: entropyBlockSize,
          sizeBytes: entry?.size || 0,
        }
      );
      entropyProfile = profile.result;
      entropyDurationMs = Math.round(profile.durationMs);
    } catch (e) {
      if (jobId === entropyJobId) {
        entropyProfile = null;
        entropyError = e?.message || "Entropy analysis failed";
      }
    } finally {
      if (jobId === entropyJobId) {
        entropyLoading = false;
      }
    }
  }

  async function onEntropyBlockSizeChange(event) {
    entropyBlockSize = Number(event.target.value) || 4096;
    await loadEntropy();
  }

  function reportFileBaseName() {
    const source = entry?.name || "upkaran-file";
    const stem = source.replace(/\.[^/.]+$/, "");
    return stem.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "upkaran-file";
  }

  function exportIntegrityJson() {
    if (!integrityReport) return;
    const blob = integrityReportToJsonBlob(integrityReport);
    saveBlob(blob, `${reportFileBaseName()}.integrity-report.json`);
  }

  function exportIntegrityText() {
    if (!integrityReport) return;
    const blob = new Blob([integrityReportToText(integrityReport)], { type: "text/plain;charset=utf-8" });
    saveBlob(blob, `${reportFileBaseName()}.integrity-report.txt`);
  }

  $: if (data) {
    const operations = lineageOperations.length > 0
      ? lineageOperations.map((record) => ({
        action: `${record.action} (${record.toolKey})`,
        status: record.status || "completed",
        note: record.outputCount > 0 ? `${record.outputCount} output(s)` : "No outputs",
        at: record.at,
        outputs: Array.isArray(record.outputs)
          ? record.outputs.map((item) => ({
            name: item?.name || "output",
            size: item?.size || 0,
            mimeType: item?.mimeType || "application/octet-stream",
          }))
          : [],
      }))
      : [
        {
          action: "forensics_inspection",
          status: "completed",
          note: "Generated from local browser analysis",
          at: new Date().toISOString(),
        },
      ];

    integrityReport = buildIntegrityReport(entry, data, {
      entropyProfile,
      operations,
    });
    integrityTextPreview = integrityReportToText(integrityReport);
  } else {
    integrityReport = null;
    integrityTextPreview = "";
  }
</script>

<div class="fv-root panel" in:fly={{ y: 20, duration: 280 }}>

  <!-- ── Header ──────────────────────────────────────────────────────────── -->
  <header class="fv-header">
    <button class="back-btn" on:click={() => dispatch("close")}>
      <span class="material-symbols-outlined">arrow_back</span>
      <span>Back to files</span>
    </button>
    <div class="fv-header-file">
      <span class="material-symbols-outlined fv-header-icon">search</span>
      <div class="fv-header-meta">
        <span class="fv-header-label">Inspecting</span>
        <strong class="fv-header-name" title={entry.name}>{entry.name}</strong>
      </div>
    </div>
  </header>

  <!-- ── Loading ─────────────────────────────────────────────────────────── -->
  {#if loading}
    <div class="fv-loading" transition:fade>
      <div class="fv-spinner">
        <span></span><span></span><span></span>
      </div>
      <p>Analyzing file…</p>
    </div>

  <!-- ── Error ───────────────────────────────────────────────────────────── -->
  {:else if err}
    <div class="fv-error" transition:fade>
      <span class="material-symbols-outlined">error</span>
      <p>{err}</p>
    </div>

  <!-- ── Main content ────────────────────────────────────────────────────── -->
  {:else if data}
    <div class="fv-body" transition:fade>

      <!-- Left: Summary card -->
      <aside class="fv-summary">
        <div class="fv-file-icon" style="--kind-color:{kindColor(data.kind)}">
          <span class="material-symbols-outlined">{kindIcon(data.kind)}</span>
        </div>

        <dl class="fv-dl">
          <dt>Size</dt>       <dd>{formatBytes(data.size)}</dd>
          <dt>Kind</dt>       <dd>{data.kind}</dd>
          <dt>MIME type</dt>  <dd class="fv-mono">{data.mimeType || "—"}</dd>
          <dt>Last modified</dt><dd>{fmtDate(data.lastModified)}</dd>
          {#if data._type === "pdf" && data.pageCount != null}
            <dt>Pages</dt>    <dd>{data.pageCount}</dd>
          {/if}
          {#if data._type === "image" && data.dims}
            <dt>Dimensions</dt><dd>{data.dims.width} × {data.dims.height} px</dd>
          {/if}
        </dl>

        <!-- Hashes -->
        <div class="fv-hashes">
          <h4>Hashes</h4>
          {#each [["MD5", data.hashes.md5, "md5"], ["SHA-1", data.hashes.sha1, "sha1"], ["SHA-256", data.hashes.sha256, "sha256"]] as [label, value, key]}
            <div class="hash-row">
              <span class="hash-label">{label}</span>
              <button
                class="hash-copy secondary"
                title="Copy {label}"
                on:click={() => copyHash(value, key)}
              >
                <span class="material-symbols-outlined hash-copy-icon">
                  {copiedHash === key ? "check" : "content_copy"}
                </span>
              </button>
              <span class="hash-value fv-mono" title={value}>{value}</span>
            </div>
          {/each}
        </div>
      </aside>

      <!-- Right: Tabbed details -->
      <main class="fv-details">
        {#if analyzeDurationMs > 0}
          <p class="perf-note">Initial analysis time: {analyzeDurationMs} ms</p>
        {/if}
        {#if data?.perf?.hashMs > 0 || data?.perf?.specificMs > 0}
          <p class="perf-note">
            Stage timings: hash {data?.perf?.hashMs || 0} ms, type analysis {data?.perf?.specificMs || 0} ms
          </p>
        {/if}

        <!-- Tab bar (chips) -->
        <div class="fv-tabs" role="tablist">
          {#each tabs as tab}
            <button
              role="tab"
              class="tab-chip"
              class:active={activeTab === tab.id}
              aria-selected={activeTab === tab.id}
              on:click={() => (activeTab = tab.id)}
            >{tab.label}</button>
          {/each}
        </div>

        <!-- Tab: Overview -->
        {#if activeTab === "overview"}
          <div class="tab-pane" role="tabpanel">
            <h3 class="section-title">File overview</h3>

            <table class="fv-table">
              <tbody>
                <tr><th>File name</th>       <td>{data.name}</td></tr>
                <tr><th>File size</th>        <td>{formatBytes(data.size)} ({data.size.toLocaleString()} bytes)</td></tr>
                <tr><th>MIME type</th>        <td class="fv-mono">{data.mimeType || "—"}</td></tr>
                <tr><th>Detected kind</th>    <td>{data.kind}</td></tr>
                <tr><th>Last modified</th>    <td>{fmtDate(data.lastModified)}</td></tr>

                {#if data._type === "pdf"}
                  <tr><th>Encrypted</th>      <td class:val-bad={data.encrypted}>{data.encrypted ? "Yes — password required" : "No"}</td></tr>
                  {#if data.pageCount != null}
                  <tr><th>Page count</th>     <td>{data.pageCount}</td></tr>
                  {/if}
                {/if}

                {#if data._type === "image"}
                  {#if data.dims}
                    <tr><th>Dimensions</th>   <td>{data.dims.width} × {data.dims.height} px</td></tr>
                    <tr><th>Megapixels</th>   <td>{((data.dims.width * data.dims.height) / 1_000_000).toFixed(2)} MP</td></tr>
                  {/if}
                  {#if data.pngMeta}
                    <tr><th>Color type</th>   <td>{data.pngMeta.colorType}</td></tr>
                    <tr><th>Bit depth</th>    <td>{data.pngMeta.bitDepth}-bit</td></tr>
                    <tr><th>Interlaced</th>   <td>{data.pngMeta.interlaced ? "Yes" : "No"}</td></tr>
                  {/if}
                  <tr><th>Has EXIF</th>       <td>{data.exif ? "Yes" : "No"}</td></tr>
                {/if}

                {#if data._type === "text"}
                  <tr><th>Lines</th>          <td>{data.lineCount.toLocaleString()}</td></tr>
                  <tr><th>Characters</th>     <td>{data.charCount.toLocaleString()}</td></tr>
                  <tr><th>Encoding</th>       <td>{data.encoding}</td></tr>
                {/if}

                {#if data._type === "zip" && data.zipData}
                  <tr><th>Total entries</th>  <td>{data.zipData.totalEntries}</td></tr>
                  <tr><th>Uncompressed</th>   <td>{formatBytes(data.zipData.totalUncompressed)}</td></tr>
                  <tr><th>Compression ratio</th><td>{data.zipData.ratio}</td></tr>
                {/if}

                {#if data._type === "gzip"}
                  <tr><th>Format</th>         <td>GZIP archive</td></tr>
                {/if}

                {#if data._type === "tar"}
                  <tr><th>Format</th>         <td>TAR archive</td></tr>
                {/if}
              </tbody>
            </table>
          </div>
        {/if}

        <!-- Tab: Metadata -->
        {#if activeTab === "metadata"}
          <div class="tab-pane" role="tabpanel">

            <!-- PDF metadata -->
            {#if data._type === "pdf" && data.metadata}
              <h3 class="section-title">Document metadata</h3>
              <table class="fv-table">
                <tbody>
                  {#each entries(data.metadata) as [k, v]}
                    <tr>
                      <th>{k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}</th>
                      <td>{k.includes("At") ? fmtDate(v) : v}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              {#if !Object.values(data.metadata).some(Boolean)}
                <p class="fv-empty">No metadata embedded in this PDF.</p>
              {/if}
            {/if}

            <!-- Image metadata -->
            {#if data._type === "image"}
              {#if data.dims}
                <h3 class="section-title">Image info</h3>
                <table class="fv-table">
                  <tbody>
                    <tr><th>Width</th>      <td>{data.dims.width} px</td></tr>
                    <tr><th>Height</th>     <td>{data.dims.height} px</td></tr>
                    <tr><th>Megapixels</th> <td>{((data.dims.width * data.dims.height) / 1_000_000).toFixed(2)} MP</td></tr>
                    {#if data.pngMeta}
                      <tr><th>Color type</th>  <td>{data.pngMeta.colorType}</td></tr>
                      <tr><th>Bit depth</th>   <td>{data.pngMeta.bitDepth}-bit</td></tr>
                      <tr><th>Interlaced</th>  <td>{data.pngMeta.interlaced ? "Yes" : "No"}</td></tr>
                    {/if}
                  </tbody>
                </table>
              {/if}
              {#if data.pngMeta && Object.keys(data.pngMeta.text).length > 0}
                <h3 class="section-title">Embedded text chunks</h3>
                <table class="fv-table">
                  <tbody>
                    {#each Object.entries(data.pngMeta.text) as [k, v]}
                      <tr><th>{k}</th><td>{v}</td></tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
              {#if !data.dims && !data.pngMeta}
                <p class="fv-empty">No metadata could be extracted.</p>
              {/if}
            {/if}

            <!-- Office metadata -->
            {#if data._type === "office"}
              {#if data.core}
                <h3 class="section-title">Core properties</h3>
                <table class="fv-table">
                  <tbody>
                    {#each entries(data.core) as [k, v]}
                      <tr>
                        <th>{k.replace(/([A-Z])/g, " $1").trim()}</th>
                        <td>{k === "created" || k === "modified" ? fmtDate(v) : v}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
              {#if data.app}
                <h3 class="section-title">Application properties</h3>
                <table class="fv-table">
                  <tbody>
                    {#each entries(data.app) as [k, v]}
                      <tr>
                        <th>{k.replace(/([A-Z])/g, " $1").trim()}</th>
                        <td>{v}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            {/if}

            <!-- Text / code analysis -->
            {#if data._type === "text"}
              <h3 class="section-title">Content analysis</h3>
              <table class="fv-table">
                <tbody>
                  <tr><th>Total lines</th>    <td>{data.lineCount.toLocaleString()}</td></tr>
                  <tr><th>Non-empty lines</th><td>{data.nonEmptyLines.toLocaleString()}</td></tr>
                  <tr><th>Characters</th>     <td>{data.charCount.toLocaleString()}</td></tr>
                  <tr><th>Words</th>          <td>{data.wordCount?.toLocaleString() ?? "—"}</td></tr>
                  <tr><th>Encoding</th>       <td>{data.encoding}</td></tr>
                  {#if data.csvMeta}
                    <tr><th>Delimiter</th>    <td>{data.csvMeta.delimiter}</td></tr>
                    <tr><th>Rows</th>         <td>{data.csvMeta.rowCount.toLocaleString()}</td></tr>
                    <tr><th>Columns</th>      <td>{data.csvMeta.colCount}</td></tr>
                    {#if data.csvMeta.headers?.length > 0}
                      <tr><th>Headers</th>   <td>{data.csvMeta.headers.join(", ")}</td></tr>
                    {/if}
                  {/if}
                </tbody>
              </table>
            {/if}

          </div>
        {/if}

        <!-- Tab: EXIF -->
        {#if activeTab === "exif" && data.exif}
          <div class="tab-pane" role="tabpanel">

            {#if data.exif.make || data.exif.model}
              <h3 class="section-title">Camera</h3>
              <table class="fv-table">
                <tbody>
                  {#if data.exif.make}    <tr><th>Make</th>      <td>{data.exif.make}</td></tr>{/if}
                  {#if data.exif.model}   <tr><th>Model</th>     <td>{data.exif.model}</td></tr>{/if}
                  {#if data.exif.artist}  <tr><th>Artist</th>    <td>{data.exif.artist}</td></tr>{/if}
                  {#if data.exif.copyright}<tr><th>Copyright</th><td>{data.exif.copyright}</td></tr>{/if}
                  {#if data.exif.software}<tr><th>Software</th>  <td>{data.exif.software}</td></tr>{/if}
                </tbody>
              </table>
            {/if}

            {#if data.exif.dateTimeOriginal || data.exif.dateTime}
              <h3 class="section-title">Timestamps</h3>
              <table class="fv-table">
                <tbody>
                  {#if data.exif.dateTimeOriginal}<tr><th>Date taken</th>    <td>{data.exif.dateTimeOriginal}</td></tr>{/if}
                  {#if data.exif.dateTimeDigitized}<tr><th>Digitized</th>   <td>{data.exif.dateTimeDigitized}</td></tr>{/if}
                  {#if data.exif.dateTime}         <tr><th>Modified</th>    <td>{data.exif.dateTime}</td></tr>{/if}
                </tbody>
              </table>
            {/if}

            {#if data.exif.exposureTime || data.exif.fNumber || data.exif.iso}
              <h3 class="section-title">Capture settings</h3>
              <table class="fv-table">
                <tbody>
                  {#if data.exif.exposureTime}    <tr><th>Exposure time</th>    <td>{data.exif.exposureTime}</td></tr>{/if}
                  {#if data.exif.fNumber}         <tr><th>Aperture</th>         <td>f/{data.exif.fNumber}</td></tr>{/if}
                  {#if data.exif.iso}             <tr><th>ISO speed</th>        <td>{data.exif.iso}</td></tr>{/if}
                  {#if data.exif.focalLength}     <tr><th>Focal length</th>     <td>{data.exif.focalLength} mm</td></tr>{/if}
                  {#if data.exif.focalLength35mm} <tr><th>35mm equiv.</th>      <td>{data.exif.focalLength35mm} mm</td></tr>{/if}
                  {#if data.exif.flash}           <tr><th>Flash</th>            <td>{data.exif.flash}</td></tr>{/if}
                  {#if data.exif.whiteBalance}    <tr><th>White balance</th>    <td>{data.exif.whiteBalance}</td></tr>{/if}
                  {#if data.exif.exposureProgram} <tr><th>Exposure program</th> <td>{data.exif.exposureProgram}</td></tr>{/if}
                  {#if data.exif.meteringMode}    <tr><th>Metering mode</th>    <td>{data.exif.meteringMode}</td></tr>{/if}
                  {#if data.exif.exposureBias}    <tr><th>Exposure bias</th>    <td>{data.exif.exposureBias}</td></tr>{/if}
                  {#if data.exif.colorSpace}      <tr><th>Color space</th>      <td>{data.exif.colorSpace}</td></tr>{/if}
                  {#if data.exif.pixelWidth}      <tr><th>EXIF pixel width</th> <td>{data.exif.pixelWidth} px</td></tr>{/if}
                  {#if data.exif.pixelHeight}     <tr><th>EXIF pixel height</th><td>{data.exif.pixelHeight} px</td></tr>{/if}
                </tbody>
              </table>
            {/if}

            {#if data.exif.gps}
              {@const gps = data.exif.gps}
              <h3 class="section-title">GPS location</h3>
              <table class="fv-table">
                <tbody>
                  {#if gps.latitude != null}  <tr><th>Latitude</th>  <td>{fmtCoord(gps.latitude, "N", "S")}</td></tr>{/if}
                  {#if gps.longitude != null} <tr><th>Longitude</th> <td>{fmtCoord(gps.longitude, "E", "W")}</td></tr>{/if}
                  {#if gps.altitude != null}  <tr><th>Altitude</th>  <td>{gps.altitude} m ({gps.altitudeRef})</td></tr>{/if}
                  {#if gps.date}              <tr><th>GPS date</th>  <td>{gps.date}</td></tr>{/if}
                  {#if gps.time}              <tr><th>GPS time</th>  <td>{gps.time}</td></tr>{/if}
                  {#if gps.mapDatum}          <tr><th>Map datum</th> <td>{gps.mapDatum}</td></tr>{/if}
                  {#if gps.latitude != null && gps.longitude != null}
                    <tr>
                      <th>Map</th>
                      <td>
                        <a
                          href={gpsMapUrl(gps.latitude, gps.longitude)}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="fv-link"
                        >
                          {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)}
                          <span class="material-symbols-outlined" style="font-size:0.9rem;vertical-align:middle">open_in_new</span>
                        </a>
                      </td>
                    </tr>
                  {/if}
                </tbody>
              </table>
            {/if}

          </div>
        {/if}

        <!-- Tab: Structure -->
        {#if activeTab === "structure"}
          <div class="tab-pane" role="tabpanel">

            <!-- PDF structure -->
            {#if data._type === "pdf"}
              <h3 class="section-title">PDF structure</h3>
              <table class="fv-table">
                <tbody>
                  {#if data.pageCount != null}<tr><th>Page count</th><td>{data.pageCount}</td></tr>{/if}
                  {#if data.embeddedFileCount != null}<tr><th>Embedded files</th><td>{data.embeddedFileCount}</td></tr>{/if}
                </tbody>
              </table>
            {/if}

            <!-- Office structure -->
            {#if data._type === "office"}
              <table class="fv-table">
                <tbody>
                  <tr><th>Embedded media</th><td>{data.embeddedMediaCount ?? 0}</td></tr>
                  {#if data.core?.revision}<tr><th>Revision</th>  <td>{data.core.revision}</td></tr>{/if}
                  {#if data.app?.pages}     <tr><th>Pages</th>    <td>{data.app.pages}</td></tr>{/if}
                  {#if data.app?.words}     <tr><th>Words</th>    <td>{data.app.words}</td></tr>{/if}
                  {#if data.app?.characters}<tr><th>Characters</th><td>{data.app.characters}</td></tr>{/if}
                  {#if data.app?.slides}    <tr><th>Slides</th>   <td>{data.app.slides}</td></tr>{/if}
                  {#if data.app?.worksheets}<tr><th>Worksheets</th><td>{data.app.worksheets}</td></tr>{/if}
                  {#if data.app?.sheetNames}<tr><th>Sheet names</th><td>{data.app.sheetNames}</td></tr>{/if}
                </tbody>
              </table>
            {/if}

            <!-- ZIP file tree -->
            {#if data._type === "zip" && data.zipData}
              {@const zip = data.zipData}
              <div class="fv-zip-summary">
                <span>{zip.totalEntries} entries</span>
                <span>Uncompressed: {formatBytes(zip.totalUncompressed)}</span>
                <span>Saved: {zip.ratio}</span>
              </div>

              <div class="fv-file-tree">
                {#each zip.entries as e}
                  <div class="tree-row" class:tree-dir={e.path.endsWith("/")}>
                    <span class="material-symbols-outlined tree-icon">
                      {e.path.endsWith("/") ? "folder" : "draft"}
                    </span>
                    <span class="tree-path">{e.path}</span>
                    {#if !e.path.endsWith("/")}
                      <span class="tree-size">{formatBytes(e.uncompressedSize)}</span>
                      <span class="tree-method">{e.method}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

          </div>
        {/if}

        <!-- Tab: Entropy -->
        {#if activeTab === "entropy"}
          <div class="tab-pane" role="tabpanel">
            <h3 class="section-title">Entropy heatmap</h3>

            {#if entropyDurationMs > 0}
              <p class="perf-note">Last entropy compute time: {entropyDurationMs} ms</p>
            {/if}

            <div class="entropy-controls">
              <label for="entropy-block-size">Block size</label>
              <select id="entropy-block-size" value={entropyBlockSize} on:change={onEntropyBlockSizeChange}>
                {#each ENTROPY_BLOCK_SIZE_OPTIONS as size}
                  <option value={size}>{size.toLocaleString()} bytes</option>
                {/each}
              </select>
              <button class="secondary" type="button" on:click={loadEntropy} disabled={entropyLoading}>
                {entropyLoading ? "Analyzing..." : "Recalculate"}
              </button>
            </div>

            {#if entropyError}
              <p class="fv-empty">{entropyError}</p>
            {:else if entropyLoading && !entropyProfile}
              <p class="fv-empty">Computing entropy profile...</p>
            {:else if entropyProfile}
              <div class="entropy-stats">
                <span>Blocks: {entropyProfile.totalBlocks.toLocaleString()}</span>
                <span>Sampled: {entropyProfile.sampledBlocks.toLocaleString()}</span>
                <span>Stride: {entropyProfile.sampleStride.toLocaleString()}</span>
                <span>Min: {entropyProfile.summary.min.toFixed(3)}</span>
                <span>Mean: {entropyProfile.summary.mean.toFixed(3)}</span>
                <span>Max: {entropyProfile.summary.max.toFixed(3)}</span>
                <span>
                  High entropy: {entropyProfile.summary.highEntropyCount.toLocaleString()} /
                  {entropyProfile.sampledBlocks.toLocaleString()} (>= {entropyProfile.summary.highEntropyThreshold})
                </span>
              </div>

              <EntropyHeatmap profile={entropyProfile} />
            {/if}
          </div>
        {/if}

        <!-- Tab: Integrity -->
        {#if activeTab === "integrity"}
          <div class="tab-pane" role="tabpanel">
            <h3 class="section-title">Integrity report</h3>

            {#if integrityReport}
              <div class="integrity-actions">
                <button type="button" on:click={exportIntegrityJson}>Export JSON</button>
                <button class="secondary" type="button" on:click={exportIntegrityText}>Export text</button>
              </div>

              <table class="fv-table">
                <tbody>
                  <tr><th>Report version</th><td>{integrityReport.reportVersion}</td></tr>
                  <tr><th>Generated at</th><td>{fmtDate(integrityReport.generatedAt)}</td></tr>
                  <tr><th>Source</th><td>{integrityReport.source.name}</td></tr>
                  <tr><th>SHA-256</th><td class="fv-mono">{integrityReport.analysis.hashes.sha256 || "n/a"}</td></tr>
                  <tr><th>Operations</th><td>{integrityReport.operations.length}</td></tr>
                  {#if integrityReport.analysis.metadata.zip}
                    <tr>
                      <th>Compression ratio</th>
                      <td>{integrityReport.analysis.metadata.zip.compressionRatio || "n/a"}</td>
                    </tr>
                  {/if}
                </tbody>
              </table>

              <h3 class="section-title">Text preview</h3>
              <pre class="integrity-preview fv-mono">{integrityTextPreview}</pre>

              <h3 class="section-title">Operation lineage</h3>
              {#if lineageOperations.length > 0}
                <ul class="integrity-ops-list">
                  {#each lineageOperations as item (item.id)}
                    <li>
                      <strong>{item.toolKey}</strong>
                      <span>{item.action}</span>
                      <span>{fmtDate(item.at)}</span>
                      <span>{item.outputCount} output(s)</span>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="fv-empty">No prior processing lineage found for this file.</p>
              {/if}
            {:else}
              <p class="fv-empty">Integrity report not available.</p>
            {/if}
          </div>
        {/if}

        <!-- Tab: Permissions -->
        {#if activeTab === "permissions" && data._type === "pdf"}
          <div class="tab-pane" role="tabpanel">
            <h3 class="section-title">Security status</h3>

            <div class="fv-status-banner" class:fv-status-warn={data.encrypted}>
              <span class="material-symbols-outlined">
                {data.encrypted ? "lock" : "lock_open"}
              </span>
              <div>
                <strong>{data.encrypted ? "Password protected" : "No password required"}</strong>
                {#if data.encryptError}
                  <p class="fv-status-sub">{data.encryptError}</p>
                {:else}
                  <p class="fv-status-sub">
                    {data.encrypted
                      ? "This document requires a password to open. Metadata could not be read."
                      : "This document can be opened without a password."}
                  </p>
                {/if}
              </div>
            </div>

            {#if Object.keys(data.permissions ?? {}).length > 0}
              <h3 class="section-title">Owner restrictions</h3>
              <table class="fv-table">
                <tbody>
                  {#each Object.entries(data.permissions) as [key, val]}
                    <tr>
                      <th>{key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}</th>
                      <td class:val-ok={val} class:val-bad={!val}>{val ? "Allowed" : "Restricted"}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else if !data.encrypted}
              <p class="fv-empty">No owner restrictions found (all operations permitted).</p>
            {/if}
          </div>
        {/if}

      </main>
    </div>
  {/if}
</div>

<style>
  /* ── Root ────────────────────────────────────────────────────────────── */
  .fv-root {
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ── Header ──────────────────────────────────────────────────────────── */
  .fv-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    background: var(--md-sys-color-primary-container);
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 1rem 0.45rem 0.7rem;
    border-radius: 999px;
    border: none;
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }

  .back-btn .material-symbols-outlined {
    font-size: 1.1rem;
    font-family: "Material Symbols Outlined", sans-serif;
  }

  .back-btn:hover { opacity: 0.85; }

  .fv-header-file {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }

  .fv-header-icon {
    font-size: 1.4rem;
    color: var(--md-sys-color-on-primary-container);
    flex-shrink: 0;
    font-family: "Material Symbols Outlined", sans-serif;
  }

  .fv-header-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .fv-header-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-primary-container);
    opacity: 0.7;
    line-height: 1.2;
  }

  .fv-header-name {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--md-sys-color-on-primary-container);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }

  /* ── Loading ─────────────────────────────────────────────────────────── */
  .fv-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    padding: 3rem 1rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .fv-spinner {
    display: flex;
    gap: 5px;
    align-items: center;
  }

  .fv-spinner span {
    display: block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--md-sys-color-primary);
    animation: spin-bounce 1s ease-in-out infinite;
  }

  .fv-spinner span:nth-child(2) { animation-delay: 0.15s; }
  .fv-spinner span:nth-child(3) { animation-delay: 0.30s; }

  @keyframes spin-bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40%           { transform: scale(1);   opacity: 1;   }
  }

  /* ── Error ───────────────────────────────────────────────────────────── */
  .fv-error {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1.5rem 1rem;
    color: var(--md-sys-color-error);
    font-size: 0.9rem;
  }

  /* ── Body layout ─────────────────────────────────────────────────────── */
  .fv-body {
    display: grid;
    grid-template-columns: 260px 1fr;
    min-height: 0;
  }

  /* ── Summary sidebar ─────────────────────────────────────────────────── */
  .fv-summary {
    border-right: 1px solid var(--md-sys-color-outline-variant);
    padding: 1.2rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-y: auto;
    background: var(--md-sys-color-surface-container-low);
  }

  .fv-file-icon {
    width: 60px;
    height: 60px;
    border-radius: 16px;
    background: color-mix(in srgb, var(--kind-color, var(--md-sys-color-primary)) 12%, white);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .fv-file-icon .material-symbols-outlined {
    font-size: 2rem;
    color: var(--kind-color, var(--md-sys-color-primary));
    font-variation-settings: 'FILL' 1, 'wght' 300, 'GRAD' 0, 'opsz' 24;
  }

  .fv-dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.6rem;
    font-size: 0.82rem;
    margin: 0;
  }

  .fv-dl dt {
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 500;
    white-space: nowrap;
  }

  .fv-dl dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Hashes */
  .fv-hashes {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .fv-hashes h4 {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-surface-variant);
  }

  .hash-row {
    display: grid;
    grid-template-columns: 42px auto 1fr;
    align-items: center;
    gap: 0.35rem;
    background: var(--md-sys-color-surface-container-highest);
    border-radius: 8px;
    padding: 0.35rem 0.55rem;
  }

  .hash-label {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--md-sys-color-primary);
  }

  .hash-copy {
    width: 22px;
    height: 22px;
    min-width: 22px;
    padding: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hash-copy:hover { background: var(--md-sys-color-surface-variant); }

  .hash-copy-icon {
    font-size: 0.9rem;
    line-height: 1;
  }

  .hash-value {
    font-size: 0.65rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--md-sys-color-on-surface-variant);
    min-width: 0;
  }

  /* ── Details main ────────────────────────────────────────────────────── */
  .fv-details {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Tab chips */
  .fv-tabs {
    display: flex;
    gap: 0.45rem;
    padding: 0.8rem 1rem 0;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    padding-bottom: 0;
  }

  .tab-chip {
    padding: 0.35rem 1rem;
    border-radius: 999px;
    font-size: 0.82rem;
    font-weight: 500;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    border: 1px solid var(--md-sys-color-outline-variant);
    margin-bottom: -1px;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom: none;
    transition: background 0.15s, color 0.15s;
  }

  .tab-chip.active {
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-primary);
    border-color: var(--md-sys-color-outline-variant);
    border-bottom: 2px solid var(--md-sys-color-primary);
    font-weight: 600;
  }

  /* Tab pane */
  .tab-pane {
    padding: 1rem;
    overflow-y: auto;
    flex: 1;
  }

  .section-title {
    margin: 0 0 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-surface-variant);
  }

  .fv-table + .section-title {
    margin-top: 1.2rem;
  }

  /* MD3-style table */
  .fv-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
    margin-bottom: 0.5rem;
  }

  .fv-table th,
  .fv-table td {
    text-align: left;
    padding: 0.45rem 0.65rem;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    vertical-align: top;
  }

  .fv-table th {
    width: 40%;
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 500;
    white-space: nowrap;
  }

  .fv-table tr:last-child th,
  .fv-table tr:last-child td { border-bottom: none; }

  .fv-table tr:hover td,
  .fv-table tr:hover th {
    background: var(--md-sys-color-surface-container-low);
  }

  .val-ok  { color: #1a6b2f; font-weight: 500; }
  .val-bad { color: var(--md-sys-color-error); font-weight: 500; }

  /* Status banner */
  .fv-status-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border-radius: 12px;
    border: 1px solid var(--md-sys-color-outline-variant);
    background: var(--md-sys-color-surface-container-low);
    margin-bottom: 1rem;
  }

  .fv-status-banner .material-symbols-outlined {
    font-size: 1.4rem;
    color: var(--md-sys-color-primary);
    margin-top: 0.05rem;
    flex-shrink: 0;
  }

  .fv-status-warn {
    background: color-mix(in srgb, var(--md-sys-color-error) 6%, white);
    border-color: color-mix(in srgb, var(--md-sys-color-error) 25%, white);
  }

  .fv-status-warn .material-symbols-outlined { color: var(--md-sys-color-error); }

  .fv-status-banner strong { display: block; font-size: 0.9rem; }

  .fv-status-sub {
    margin: 0.2rem 0 0;
    font-size: 0.82rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  /* ZIP file tree */
  .fv-zip-summary {
    display: flex;
    gap: 1rem;
    font-size: 0.8rem;
    color: var(--md-sys-color-on-surface-variant);
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }

  .fv-file-tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.8rem;
    max-height: 420px;
    overflow-y: auto;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    padding: 0.5rem;
    background: var(--md-sys-color-surface-container-low);
  }

  .tree-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0.4rem;
    border-radius: 6px;
  }

  .tree-row:hover { background: var(--md-sys-color-surface-variant); }

  .tree-icon {
    font-size: 0.95rem;
    color: var(--md-sys-color-on-surface-variant);
    line-height: 1;
  }

  .tree-dir .tree-icon { color: var(--md-sys-color-primary); }

  .tree-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--md-sys-color-on-surface);
  }

  .tree-size, .tree-method {
    white-space: nowrap;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.75rem;
  }

  /* Utility */
  .fv-mono {
    font-family: "Cascadia Code", "Consolas", monospace;
    font-size: 0.78rem;
  }

  .fv-empty {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.85rem;
    font-style: italic;
    margin: 0.5rem 0;
  }

  .fv-link {
    color: var(--md-sys-color-primary);
    text-decoration: none;
  }

  .fv-link:hover { text-decoration: underline; }

  .entropy-controls {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
    margin-bottom: 0.7rem;
  }

  .entropy-controls label {
    font-size: 0.82rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .entropy-controls select {
    min-width: 160px;
  }

  .entropy-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    margin-bottom: 0.7rem;
  }

  .entropy-stats span {
    border: 1px solid var(--md-sys-color-outline-variant);
    background: var(--md-sys-color-surface-container-low);
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .integrity-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    margin-bottom: 0.7rem;
  }

  .integrity-preview {
    margin: 0;
    padding: 0.7rem;
    border-radius: 10px;
    border: 1px solid var(--md-sys-color-outline-variant);
    background: var(--md-sys-color-surface-container-low);
    max-height: 280px;
    overflow: auto;
    white-space: pre-wrap;
    line-height: 1.42;
    font-size: 0.76rem;
  }

  .integrity-ops-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }

  .integrity-ops-list li {
    border: 1px solid var(--md-sys-color-outline-variant);
    background: var(--md-sys-color-surface-container-low);
    border-radius: 10px;
    padding: 0.45rem 0.6rem;
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  /* ── Responsive ──────────────────────────────────────────────────────── */
  @media (max-width: 740px) {
    .fv-body {
      grid-template-columns: 1fr;
    }

    .fv-summary {
      border-right: none;
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      max-height: 280px;
    }

    .fv-header {
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .fv-header-name { font-size: 0.82rem; }
  }
</style>
