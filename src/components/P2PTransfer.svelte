<script>
  import { createEventDispatcher } from "svelte";
  import P2PSend from "./P2PSend.svelte";
  import P2PReceive from "./P2PReceive.svelte";
  import { clearTurnConfig, getTurnConfig, saveTurnConfig } from "../js/p2p.js";

  /** All file entries from the parent, passed down to P2PSend for file selection. */
  export let entries = [];

  const dispatch = createEventDispatcher();

  let mode = "send"; // "send" | "receive"
  let turnSettingsOpen = false;
  let turnSaveMessage = "";
  let turnSaveError = "";
  let turnConfig = getTurnConfig();
  let turnEnabled = turnConfig.enabled;
  let turnUrls = turnConfig.urls.join("\n");
  let turnUsername = turnConfig.username;
  let turnCredential = turnConfig.credential;

  function handleFilesReceived(event) {
    dispatch("filesreceived", event.detail);
  }

  function saveTurnSettings() {
    turnSaveError = "";

    const normalizedUrls = turnUrls
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (turnEnabled && normalizedUrls.length === 0) {
      turnSaveMessage = "";
      turnSaveError = "Add at least one TURN URL before enabling TURN.";
      return;
    }

    if (turnEnabled && (!turnUsername.trim() || !turnCredential.trim())) {
      turnSaveMessage = "";
      turnSaveError = "TURN username and credential are required when TURN is enabled.";
      return;
    }

    turnConfig = saveTurnConfig({
      enabled: turnEnabled,
      urls: normalizedUrls,
      username: turnUsername,
      credential: turnCredential
    });
    turnEnabled = turnConfig.enabled;
    turnUrls = turnConfig.urls.join("\n");
    turnUsername = turnConfig.username;
    turnCredential = turnConfig.credential;
    turnSaveMessage = turnEnabled
      ? "TURN relay saved. New connections can use internet relay when direct P2P fails."
      : "TURN relay disabled. Connections will use STUN-only mode.";
  }

  function resetTurnSettings() {
    turnConfig = clearTurnConfig();
    turnEnabled = false;
    turnUrls = "";
    turnUsername = "";
    turnCredential = "";
    turnSaveError = "";
    turnSaveMessage = "TURN relay settings cleared.";
  }
</script>

<section class="panel p2p-panel">
  <header class="p2p-header">
    <div class="p2p-title">
      <span class="material-symbols-outlined p2p-icon">wifi_tethering</span>
      <div>
        <h3>P2P Transfer</h3>
        <p>Browser-to-browser file transfer. Local-first by default, with optional TURN relay for internet reachability.</p>
      </div>
    </div>

    <div class="mode-toggle" role="tablist" aria-label="Transfer mode">
      <button
        role="tab"
        type="button"
        class:active={mode === "send"}
        on:click={() => (mode = "send")}
        aria-selected={mode === "send"}
      >
        <span class="material-symbols-outlined">upload</span>
        Send
      </button>
      <button
        role="tab"
        type="button"
        class:active={mode === "receive"}
        on:click={() => (mode = "receive")}
        aria-selected={mode === "receive"}
      >
        <span class="material-symbols-outlined">download</span>
        Receive
      </button>
    </div>
  </header>

  <div class="p2p-hint">
    <span class="material-symbols-outlined hint-icon">info</span>
    <p>
      Open this page on both devices. Without TURN, transfer works best on the <strong>same network</strong> or on NAT-friendly internet paths.
      If you configure TURN below, WebRTC can relay traffic over the internet when direct P2P fails.
    </p>
  </div>

  <section class="turn-settings">
    <header>
      <div>
        <h4>Connection Relay</h4>
        <p>Optional TURN credentials for reliable internet transfers.</p>
      </div>
      <button class="secondary" type="button" on:click={() => (turnSettingsOpen = !turnSettingsOpen)} aria-expanded={turnSettingsOpen}>
        {turnSettingsOpen ? "Hide" : "Configure TURN"}
      </button>
    </header>

    {#if turnSettingsOpen}
      <div class="turn-form">
        <label class="turn-toggle">
          <input type="checkbox" bind:checked={turnEnabled} />
          <span>Enable TURN relay</span>
        </label>

        <label>
          <span>TURN URLs</span>
          <textarea
            rows="3"
            bind:value={turnUrls}
            placeholder="turn:turn.example.com:3478&#10;turns:turn.example.com:5349"
          ></textarea>
        </label>

        <div class="turn-grid">
          <label>
            <span>Username</span>
            <input type="text" bind:value={turnUsername} placeholder="TURN username" />
          </label>

          <label>
            <span>Credential</span>
            <input type="password" bind:value={turnCredential} placeholder="TURN password or shared secret" />
          </label>
        </div>

        {#if turnSaveError}
          <p class="turn-error">{turnSaveError}</p>
        {/if}

        {#if turnSaveMessage}
          <p class="turn-message">{turnSaveMessage}</p>
        {/if}

        <div class="turn-actions">
          <button type="button" on:click={saveTurnSettings}>Save TURN Settings</button>
          <button class="secondary" type="button" on:click={resetTurnSettings}>Clear</button>
        </div>
      </div>
    {/if}
  </section>

  <div class="p2p-content">
    {#if mode === "send"}
      <P2PSend {entries} />
    {:else}
      <P2PReceive on:filesreceived={handleFilesReceived} />
    {/if}
  </div>
</section>

<style>
  .p2p-panel {
    padding: 1rem;
    display: grid;
    gap: 0.85rem;
  }

  .p2p-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .p2p-title {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }

  .p2p-icon {
    font-family: "Material Symbols Outlined";
    font-size: 1.8rem;
    color: var(--md-sys-color-primary);
    flex-shrink: 0;
  }

  .p2p-title h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
  }

  .p2p-title p {
    margin: 0.15rem 0 0;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .mode-toggle {
    display: flex;
    gap: 0;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 10px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .mode-toggle button {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.85rem;
    border: none;
    border-radius: 0;
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .mode-toggle button .material-symbols-outlined {
    font-family: "Material Symbols Outlined";
    font-size: 1rem;
  }

  .mode-toggle button:first-child {
    border-right: 1px solid var(--md-sys-color-outline-variant);
  }

  .mode-toggle button.active {
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }

  .mode-toggle button:hover:not(.active) {
    background: var(--md-sys-color-surface-container);
  }

  .p2p-hint {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    background: var(--md-sys-color-surface-container);
    border-radius: 10px;
    padding: 0.65rem 0.8rem;
  }

  .hint-icon {
    font-family: "Material Symbols Outlined";
    font-size: 1.1rem;
    color: var(--md-sys-color-primary);
    flex-shrink: 0;
    margin-top: 0.05rem;
  }

  .p2p-hint p {
    margin: 0;
    font-size: 0.8rem;
    color: var(--md-sys-color-on-surface-variant);
    line-height: 1.5;
  }

  .p2p-content {
    min-width: 0;
  }

  .turn-settings {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 12px;
    background: var(--md-sys-color-surface-container-low);
    padding: 0.85rem;
    display: grid;
    gap: 0.75rem;
  }

  .turn-settings header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .turn-settings h4 {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 600;
  }

  .turn-settings header p {
    margin: 0.2rem 0 0;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .turn-form {
    display: grid;
    gap: 0.75rem;
  }

  .turn-toggle {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.84rem;
    color: var(--md-sys-color-on-surface);
  }

  .turn-form label {
    display: grid;
    gap: 0.35rem;
  }

  .turn-form label span {
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .turn-form textarea,
  .turn-form input {
    width: 100%;
  }

  .turn-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.7rem;
  }

  .turn-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .turn-message,
  .turn-error {
    margin: 0;
    font-size: 0.8rem;
  }

  .turn-message {
    color: var(--md-sys-color-tertiary);
  }

  .turn-error {
    color: var(--md-sys-color-error);
  }
</style>
