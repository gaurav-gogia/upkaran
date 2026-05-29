<script>
  import { compareTextContent } from "../js/file-compare.js";
  import { saveBlob } from "../js/download.js";
  import TextDiffView from "./TextDiffView.svelte";

  let leftText = "";
  let rightText = "";
  let diff = null;

  $: if (!leftText.trim() && !rightText.trim()) {
    diff = null;
  } else {
    diff = compareTextContent(leftText, rightText, { maxLines: 2400 });
  }

  function exportDiff() {
    if (!diff) return;

    const summary = [
      "Upkaran Text Diff",
      "",
      `Same: ${diff.counts.equal}`,
      `Changed: ${diff.counts.replace}`,
      `Added: ${diff.counts.add}`,
      `Removed: ${diff.counts.remove}`,
      "",
      ...diff.rows.map((row) => {
        const leftNum = row.leftNumber ?? "-";
        const rightNum = row.rightNumber ?? "-";
        return `[${row.type}] L${leftNum}: ${row.leftText} || R${rightNum}: ${row.rightText}`;
      })
    ].join("\n");

    saveBlob(new Blob([summary], { type: "text/plain" }), `text-diff-${Date.now()}.txt`);
  }

  function clearInputs() {
    leftText = "";
    rightText = "";
  }
</script>

<section class="panel text-diff-workspace" aria-label="Standalone text diff workspace">
  <header class="workspace-head">
    <h3>Text Diff</h3>
    <p>Paste or type text on both sides for real-time diff highlighting.</p>
  </header>

  <div class="diff-inputs">
    <label>
      <span>Left text</span>
      <textarea bind:value={leftText} rows="10" placeholder="Paste left text"></textarea>
    </label>

    <label>
      <span>Right text</span>
      <textarea bind:value={rightText} rows="10" placeholder="Paste right text"></textarea>
    </label>
  </div>

  <div class="actions">
    <button class="secondary" type="button" on:click={clearInputs}>Clear</button>
    <button type="button" on:click={exportDiff} disabled={!diff}>Export Diff</button>
  </div>

  <TextDiffView {diff} />
</section>

<style>
  .text-diff-workspace {
    padding: 0.9rem;
    display: grid;
    gap: 0.72rem;
  }

  .workspace-head h3 {
    margin: 0;
    font-size: 1.02rem;
  }

  .workspace-head p {
    margin: 0.24rem 0 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.84rem;
  }

  .diff-inputs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.72rem;
  }

  label {
    display: grid;
    gap: 0.3rem;
  }

  label span {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-sys-color-on-surface-variant);
  }

  textarea {
    width: 100%;
    resize: vertical;
    border-radius: 12px;
    border: 1px solid var(--md-sys-color-outline);
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
    padding: 0.58rem 0.62rem;
    font-size: 0.83rem;
    line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    box-sizing: border-box;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.48rem;
  }

  @media (max-width: 860px) {
    .diff-inputs {
      grid-template-columns: 1fr;
    }
  }
</style>
