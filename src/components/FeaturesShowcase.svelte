<script>
  import { createEventDispatcher } from "svelte";
  import { SHOWCASE_PLANNED_FEATURES, SHOWCASE_SUGGESTED_FEATURES } from "../js/features-catalog.js";

  export let groups = [];

  const dispatch = createEventDispatcher();

  const suggestedFeatures = SHOWCASE_SUGGESTED_FEATURES;
  const plannedFeatures = SHOWCASE_PLANNED_FEATURES;

  const heroFlow = [
    { icon: "upload_file", title: "Load files", detail: "PDF, images, Office, DjVu, and content sources" },
    { icon: "construction", title: "Transform", detail: "Compress, crop, repair, reorder, convert, watermark" },
    { icon: "visibility", title: "Review", detail: "Preview, compare, diff, inspect, and verify" },
    { icon: "send", title: "Share", detail: "Download results or transfer peer-to-peer" }
  ];

  const trustPoints = [
    { icon: "offline_bolt", title: "Offline first", detail: "Core workflows run locally in your browser." },
    { icon: "lock", title: "Private by default", detail: "Files stay on your device unless you choose to share them." },
    { icon: "shield", title: "Secure by default", detail: "Local processing, cautious fetch paths, and no account lock-in." }
  ];

  $: showcaseStats = {
    categories: groups.length,
    actions: groups.reduce((sum, group) => sum + (group.items?.length || 0), 0),
    starterCards: suggestedFeatures.length,
    plannedItems: plannedFeatures.length
  };

  function groupIcon(group) {
    const title = `${group?.title || ""}`.toLowerCase();
    if (title.includes("pdf")) return "picture_as_pdf";
    if (title.includes("image")) return "image";
    if (title.includes("djvu")) return "auto_stories";
    if (title.includes("content")) return "article";
    if (title.includes("file")) return "folder_zip";
    if (title.includes("p2p")) return "share_network";
    return "widgets";
  }

  function suggestedIcon(item) {
    const title = `${item?.title || ""}`.toLowerCase();
    if (title.includes("pdf")) return "picture_as_pdf";
    if (title.includes("image")) return "image";
    if (title.includes("diff")) return "difference";
    if (title.includes("latex")) return "functions";
    if (title.includes("diagram")) return "account_tree";
    if (title.includes("p2p")) return "share_network";
    return "sparkle";
  }

  function statTone(index) {
    return ["tone-a", "tone-b", "tone-c", "tone-d"][index % 4];
  }

  function cardTone(index) {
    return ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e", "tone-f"][index % 6];
  }

  function actionFromGroup(group) {
    if (group?.action) return group.action;
    if (group?.p2pCta) return { type: "p2p" };
    if (group?.pickerAccept) return { type: "picker", accept: group.pickerAccept };
    return { type: "history" };
  }
</script>

<section class="panel showcase-shell" aria-label="Feature showcase">
  <header class="showcase-hero">
    <div class="hero-copy">
      <p class="showcase-kicker">Feature Showcase</p>
      <h2>Fast, offline-first document powers that stay private</h2>
      <p>
        Browse the real tool surface at a glance, then jump straight into the workflow you need.
        The page leans visual on purpose, but the promise is simple: private by default, secure by default, and built to keep local work moving fast.
      </p>

      <div class="trust-strip" aria-label="Privacy and performance promises">
        {#each trustPoints as point}
          <div class="trust-pill">
            <span class="material-symbols-outlined">{point.icon}</span>
            <div>
              <strong>{point.title}</strong>
              <small>{point.detail}</small>
            </div>
          </div>
        {/each}
      </div>

      <div class="hero-stats" aria-label="Showcase summary">
        <div class={`hero-stat ${statTone(0)}`}>
          <strong>{showcaseStats.categories}</strong>
          <span>tool families</span>
        </div>
        <div class={`hero-stat ${statTone(1)}`}>
          <strong>{showcaseStats.actions}</strong>
          <span>real actions</span>
        </div>
        <div class={`hero-stat ${statTone(2)}`}>
          <strong>{showcaseStats.starterCards}</strong>
          <span>starter cards</span>
        </div>
        <div class={`hero-stat ${statTone(3)}`}>
          <strong>{showcaseStats.plannedItems}</strong>
          <span>near-term ideas</span>
        </div>
      </div>
    </div>

    <div class="hero-diagram" aria-label="Workflow diagram">
      <div class="diagram-title">
        <span class="diagram-badge">Live feature map</span>
        <span>Real workflows, arranged as a path. Nothing leaves your device unless you intentionally share it.</span>
      </div>
      <div class="diagram-track">
        {#each heroFlow as step, index}
          <div class="diagram-step">
            <div class="diagram-icon-wrap">
              <span class="material-symbols-outlined">{step.icon}</span>
            </div>
            <strong>{step.title}</strong>
            <small>{step.detail}</small>
            {#if index < heroFlow.length - 1}
              <span class="diagram-connector" aria-hidden="true"></span>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <div class="showcase-actions">
      <button class="secondary" type="button" on:click={() => dispatch("back")}>Back to workspace</button>
    </div>
  </header>

  <section class="showcase-strip" aria-label="Suggested starters">
    {#each suggestedFeatures as item, index (item.title)}
      <article class={`showcase-suggestion-card ${cardTone(index)}`} style={`--stagger:${index * 70}ms;`}>
        <div class="card-icon-shell">
          <span class="material-symbols-outlined">{suggestedIcon(item)}</span>
        </div>
        <div class="suggestion-meta">
          <span class="suggestion-tag">{item.tag}</span>
          {#if item.confidence}
            <span class="confidence-tag">{item.confidence}</span>
          {/if}
        </div>
        <h3>{item.title}</h3>
        <p>{item.description}</p>
        <button class="secondary" type="button" on:click={() => dispatch("action", item.action)}>{item.cta}</button>
      </article>
    {/each}
  </section>

  <section class="showcase-groups" aria-label="All feature categories">
    {#each groups as group, index (group.title)}
      <article class={`feature-card ${cardTone(index)}`} style={`--stagger:${index * 80}ms;`}>
        <div class="feature-header">
          <div class="feature-icon-shell">
            <span class="material-symbols-outlined">{groupIcon(group)}</span>
          </div>
          <div class="feature-header-copy">
            <h3>{group.title}</h3>
            <p>{group.bestFor ? `Best for ${group.bestFor.toLowerCase()}` : group.status || "Available now"}</p>
          </div>
        </div>
        <div class="feature-meta">
          {#if group.status}
            <span class="status-tag">{group.status}</span>
          {/if}
          {#if group.bestFor}
            <span class="bestfor-tag">Best for: {group.bestFor}</span>
          {/if}
        </div>
        <ul class="feature-list">
          {#each group.items as item}
            <li>
              <span class="material-symbols-outlined item-icon">check_circle</span>
              <span>{item}</span>
            </li>
          {/each}
        </ul>
        <button class="secondary card-cta" type="button" on:click={() => dispatch("action", actionFromGroup(group))}>
          {group.cta || "Open"}
        </button>
      </article>
    {/each}
  </section>

  <section class="showcase-planned" aria-label="Planned next">
    <header class="planned-head">
      <h3>Planned next</h3>
      <p>Roadmap highlights for upcoming quality-of-life improvements.</p>
    </header>
    <div class="planned-grid">
      {#each plannedFeatures as item, index (item.title)}
        <article class={`planned-card ${cardTone(index)}`} style={`--stagger:${index * 70}ms;`}>
          <div class="planned-meta">
            <span class="planned-eta">{item.eta}</span>
            <span class="planned-impact">{item.impact}</span>
          </div>
          <h4>{item.title}</h4>
          <p>{item.description}</p>
        </article>
      {/each}
    </div>
  </section>
</section>

<style>
  .showcase-shell {
    position: relative;
    overflow: hidden;
    padding: 1rem;
    display: grid;
    gap: 1rem;
  }

  .showcase-shell::before,
  .showcase-shell::after {
    content: "";
    position: absolute;
    inset: auto;
    pointer-events: none;
    filter: blur(8px);
    opacity: 0.7;
  }

  .showcase-shell::before {
    width: 46rem;
    height: 22rem;
    top: -8rem;
    right: -14rem;
    background: radial-gradient(circle, color-mix(in srgb, var(--md-sys-color-primary) 16%, transparent), transparent 65%);
  }

  .showcase-shell::after {
    width: 34rem;
    height: 16rem;
    left: -10rem;
    bottom: -7rem;
    background: radial-gradient(circle, color-mix(in srgb, #0f766e 12%, transparent), transparent 68%);
  }

  .showcase-hero {
    position: relative;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.95fr) auto;
    gap: 0.9rem;
    align-items: stretch;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 16%, var(--md-sys-color-outline-variant));
    border-radius: calc(var(--app-radius-md, 12px) + 6px);
    padding: 1rem;
    background:
      linear-gradient(120deg, color-mix(in srgb, var(--md-sys-color-surface-container-low) 72%, #08111f 28%), color-mix(in srgb, var(--md-sys-color-surface) 88%, #ffffff 12%)),
      radial-gradient(circle at top left, color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent), transparent 42%),
      radial-gradient(circle at bottom right, color-mix(in srgb, var(--md-sys-color-secondary) 12%, transparent), transparent 34%);
    box-shadow: var(--elevation-1);
  }

  .showcase-hero::before,
  .showcase-hero::after {
    content: "";
    position: absolute;
    border-radius: 999px;
    pointer-events: none;
    filter: blur(4px);
    opacity: 0.9;
  }

  .showcase-hero::before {
    width: 190px;
    height: 190px;
    top: -60px;
    right: -40px;
    background: radial-gradient(circle, color-mix(in srgb, var(--md-sys-color-primary) 34%, transparent), transparent 70%);
  }

  .showcase-hero::after {
    width: 130px;
    height: 130px;
    bottom: -35px;
    left: 28%;
    background: radial-gradient(circle, color-mix(in srgb, #f59e0b 28%, transparent), transparent 68%);
  }

  .hero-copy {
    display: grid;
    gap: 0.7rem;
    position: relative;
    z-index: 1;
  }

  .showcase-kicker {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--md-sys-color-on-surface-variant);
  }

  .showcase-hero h2 {
    margin: 0.15rem 0 0;
    font-size: clamp(1.35rem, 2vw, 2rem);
    line-height: 1.05;
  }

  .showcase-hero p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    line-height: 1.5;
  }

  .hero-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .trust-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .trust-pill {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.55rem;
    align-items: center;
    padding: 0.65rem 0.7rem;
    border-radius: 16px;
    border: 1px solid var(--md-sys-color-outline-variant);
    background: color-mix(in srgb, var(--md-sys-color-surface-container-highest) 82%, var(--md-sys-color-primary) 18%);
  }

  .trust-pill .material-symbols-outlined {
    color: var(--md-sys-color-primary);
    font-size: 1.05rem;
  }

  .trust-pill strong {
    display: block;
    font-size: 0.83rem;
    line-height: 1.1;
  }

  .trust-pill small {
    display: block;
    margin-top: 0.12rem;
    font-size: 0.72rem;
    line-height: 1.25;
    color: var(--md-sys-color-on-surface-variant);
  }

  .hero-stat {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 16px;
    padding: 0.65rem 0.7rem;
    display: grid;
    gap: 0.12rem;
    background: var(--md-sys-color-surface-container-highest);
  }

  .hero-stat strong {
    font-size: 1.15rem;
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .hero-stat span {
    font-size: 0.72rem;
    color: var(--md-sys-color-on-surface-variant);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .tone-a { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--md-sys-color-primary) 28%, transparent); }
  .tone-b { box-shadow: inset 0 0 0 1px color-mix(in srgb, #f59e0b 28%, transparent); }
  .tone-c { box-shadow: inset 0 0 0 1px color-mix(in srgb, #0f766e 28%, transparent); }
  .tone-d { box-shadow: inset 0 0 0 1px color-mix(in srgb, #7c3aed 24%, transparent); }

  .hero-diagram {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 20px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--md-sys-color-surface-container-highest) 88%, #0b1220 12%), var(--md-sys-color-surface));
    padding: 0.85rem;
    display: grid;
    gap: 0.7rem;
    align-content: start;
    position: relative;
    z-index: 1;
  }

  .diagram-title {
    display: grid;
    gap: 0.15rem;
  }

  .diagram-title span:last-child {
    font-size: 0.8rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .diagram-badge {
    display: inline-flex;
    width: max-content;
    border-radius: 999px;
    padding: 0.18rem 0.55rem;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 20%, var(--md-sys-color-outline-variant));
    background: color-mix(in srgb, var(--md-sys-color-primary) 10%, var(--md-sys-color-surface));
  }

  .diagram-track {
    display: grid;
    gap: 0.6rem;
  }

  .diagram-step {
    position: relative;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 0.25rem 0.65rem;
    align-items: center;
    padding: 0.55rem;
    border-radius: 16px;
    border: 1px solid var(--md-sys-color-outline-variant);
    background: var(--md-sys-color-surface);
  }

  .diagram-step strong {
    font-size: 0.88rem;
    line-height: 1.1;
  }

  .diagram-step small {
    grid-column: 2;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.74rem;
    line-height: 1.25;
  }

  .diagram-icon-wrap,
  .card-icon-shell,
  .feature-icon-shell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 14px;
    background: color-mix(in srgb, var(--md-sys-color-primary) 12%, var(--md-sys-color-surface));
    border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 20%, var(--md-sys-color-outline-variant));
  }

  .diagram-icon-wrap {
    width: 42px;
    height: 42px;
    grid-row: span 2;
  }

  .diagram-icon-wrap .material-symbols-outlined,
  .card-icon-shell .material-symbols-outlined,
  .feature-icon-shell .material-symbols-outlined,
  .item-icon {
    font-size: 1.02rem;
    color: var(--md-sys-color-primary);
  }

  .diagram-connector {
    position: absolute;
    left: 20px;
    bottom: -14px;
    width: 2px;
    height: 14px;
    background: linear-gradient(180deg, var(--md-sys-color-primary), transparent);
  }

  .card-icon-shell {
    width: 44px;
    height: 44px;
    margin-bottom: 0.1rem;
  }

  .showcase-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.8rem;
  }

  .showcase-suggestion-card {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 18px;
    padding: 0.8rem;
    background:
      radial-gradient(circle at top right, color-mix(in srgb, var(--md-sys-color-primary) 9%, transparent), transparent 28%),
      var(--md-sys-color-surface-container-low);
    display: grid;
    gap: 0.5rem;
    box-shadow: var(--elevation-1);
    animation: floatIn 760ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: var(--stagger);
    position: relative;
    overflow: hidden;
  }

  .showcase-suggestion-card::before,
  .feature-card::before,
  .planned-card::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 0.28rem;
    background: linear-gradient(180deg, color-mix(in srgb, var(--md-sys-color-primary) 70%, #fff), color-mix(in srgb, #0f766e 55%, transparent));
    opacity: 0.85;
  }

  .suggestion-meta {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .showcase-suggestion-card h3 {
    margin: 0;
    font-size: 0.98rem;
  }

  .showcase-suggestion-card p {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.82rem;
  }

  .suggestion-tag {
    display: inline-flex;
    width: max-content;
    border-radius: 999px;
    border: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.15rem 0.5rem;
    font-size: 0.7rem;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface);
  }

  .confidence-tag {
    display: inline-flex;
    width: max-content;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 24%, var(--md-sys-color-outline-variant));
    padding: 0.15rem 0.5rem;
    font-size: 0.7rem;
    color: var(--md-sys-color-on-surface-variant);
    background: color-mix(in srgb, var(--md-sys-color-primary) 8%, var(--md-sys-color-surface));
  }

  .showcase-groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
    gap: 0.8rem;
  }

  .showcase-planned {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 18px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--md-sys-color-surface-container-low) 80%, #0b1220 20%), var(--md-sys-color-surface));
    padding: 0.85rem;
    display: grid;
    gap: 0.55rem;
  }

  .planned-head h3 {
    margin: 0;
    font-size: 0.95rem;
  }

  .planned-head p {
    margin: 0.2rem 0 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.8rem;
  }

  .planned-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.7rem;
  }

  .planned-card {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 16px;
    background: linear-gradient(180deg, var(--md-sys-color-surface), color-mix(in srgb, var(--md-sys-color-surface-container-low) 82%, #fff 18%));
    padding: 0.75rem;
    display: grid;
    gap: 0.35rem;
    animation: floatIn 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: var(--stagger);
    position: relative;
    overflow: hidden;
  }

  .planned-meta {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .planned-eta,
  .planned-impact {
    display: inline-flex;
    border-radius: 999px;
    border: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.15rem 0.5rem;
    font-size: 0.68rem;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container-low);
  }

  .planned-card h4 {
    margin: 0;
    font-size: 0.9rem;
  }

  .planned-card p {
    margin: 0;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
    line-height: 1.3;
  }

  .feature-card {
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: 18px;
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--md-sys-color-primary) 5%, transparent), transparent 38%),
      var(--md-sys-color-surface-container-low);
    padding: 0.8rem;
    min-width: 0;
    display: grid;
    gap: 0.55rem;
    box-shadow: var(--elevation-1);
    animation: floatIn 820ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: var(--stagger);
    position: relative;
    overflow: hidden;
  }

  .feature-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.65rem;
    align-items: center;
  }

  .feature-header-copy {
    display: grid;
    gap: 0.1rem;
  }

  .feature-header-copy h3 {
    margin: 0;
    font-size: 1rem;
  }

  .feature-header-copy p {
    margin: 0;
    font-size: 0.76rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .feature-meta {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .status-tag,
  .bestfor-tag {
    display: inline-flex;
    border-radius: 999px;
    border: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.15rem 0.5rem;
    font-size: 0.68rem;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface);
  }

  .feature-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.28rem;
  }

  .feature-list li {
    display: grid;
    grid-template-columns: 1rem minmax(0, 1fr);
    gap: 0.45rem;
    align-items: start;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.8rem;
    line-height: 1.25;
  }

  .item-icon {
    font-size: 0.95rem;
    margin-top: 0.03rem;
  }

  .card-cta {
    margin-top: 0.25rem;
    width: 100%;
  }

  .tone-e { box-shadow: inset 0 0 0 1px color-mix(in srgb, #ec4899 24%, transparent); }
  .tone-f { box-shadow: inset 0 0 0 1px color-mix(in srgb, #06b6d4 24%, transparent); }

  .showcase-suggestion-card:hover,
  .feature-card:hover,
  .planned-card:hover {
    transform: translateY(-2px);
    transition: transform 180ms ease, box-shadow 180ms ease;
    box-shadow: 0 16px 32px color-mix(in srgb, #000 14%, transparent);
  }

  @keyframes floatIn {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.985);
      filter: blur(2px);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .showcase-suggestion-card,
    .feature-card,
    .planned-card {
      animation: none;
    }

    .showcase-hero::before,
    .showcase-hero::after {
      filter: none;
    }
  }

  @media (max-width: 740px) {
    .showcase-hero {
      grid-template-columns: 1fr;
    }

    .trust-strip {
      grid-template-columns: 1fr;
    }

    .hero-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .hero-diagram {
      order: 2;
    }

    .showcase-actions {
      width: 100%;
    }

    .showcase-actions button {
      width: 100%;
    }
  }
</style>
