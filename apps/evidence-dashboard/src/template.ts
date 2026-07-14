const SHELL_DATA_MARKER = "__QEDRA_EVIDENCE_DATA__";

const SHELL = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="QEDRA deterministic evidence dashboard">
  <title>QEDRA Evidence Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --canvas: #07110f;
      --canvas-soft: #0a1815;
      --panel: #10241f;
      --panel-strong: #152d27;
      --line: #29453d;
      --line-strong: #3d6257;
      --ink: #f2f7f3;
      --muted: #a7bbb2;
      --quiet: #758c82;
      --mint: #78e5b6;
      --mint-deep: #183f31;
      --amber: #f4c95d;
      --amber-deep: #3a3018;
      --coral: #ff7b70;
      --coral-deep: #431f1d;
      --blue: #8ac5ff;
      --shadow: 0 28px 90px rgba(0, 0, 0, 0.26);
      --radius: 18px;
      --mono: "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      min-width: 320px;
      margin: 0;
      background:
        radial-gradient(circle at 88% -8%, rgba(120, 229, 182, 0.18), transparent 32rem),
        linear-gradient(rgba(120, 229, 182, 0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(120, 229, 182, 0.025) 1px, transparent 1px),
        var(--canvas);
      background-size: auto, 38px 38px, 38px 38px, auto;
      color: var(--ink);
      font: 15px/1.55 var(--sans);
    }

    a { color: inherit; }
    button, input, select, textarea { font: inherit; }
    code, pre { font-family: var(--mono); }
    code { overflow-wrap: anywhere; }
    :focus-visible { outline: 3px solid var(--amber); outline-offset: 4px; }

    .skip-link {
      position: fixed;
      z-index: 20;
      top: 12px;
      left: 12px;
      transform: translateY(-150%);
      border-radius: 8px;
      background: var(--ink);
      color: var(--canvas);
      padding: 10px 14px;
      font-weight: 800;
    }
    .skip-link:focus { transform: none; }

    .wrap { width: min(1180px, calc(100% - 40px)); margin-inline: auto; }
    .site-header { padding: 30px 0 0; }
    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 20px;
    }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 900; letter-spacing: 0.12em; }
    .brand-mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid var(--mint);
      border-radius: 9px;
      color: var(--mint);
      font: 800 18px/1 var(--mono);
      box-shadow: inset 0 0 20px rgba(120, 229, 182, 0.08);
    }
    .nav-copy { color: var(--muted); font-size: 0.82rem; text-align: right; }

    .hero { padding: 76px 0 42px; }
    .eyebrow {
      margin: 0 0 18px;
      color: var(--mint);
      font-size: 0.76rem;
      font-weight: 900;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .hero-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.55fr); gap: 54px; align-items: end; }
    h1, h2, h3, p { margin-top: 0; }
    h1 {
      max-width: 850px;
      margin-bottom: 20px;
      font-size: clamp(2.8rem, 7vw, 6.4rem);
      font-weight: 780;
      letter-spacing: -0.065em;
      line-height: 0.91;
    }
    .law-statement { max-width: 800px; margin: 0; color: var(--muted); font-size: clamp(1rem, 1.8vw, 1.22rem); }
    .hero-aside { border-left: 1px solid var(--line-strong); padding-left: 24px; }
    .hero-aside p { margin-bottom: 6px; color: var(--muted); }
    .hero-aside strong { display: block; margin-bottom: 18px; font: 700 0.9rem/1.45 var(--mono); overflow-wrap: anywhere; }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 29px;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.025);
      color: var(--muted);
      font: 800 0.7rem/1 var(--mono);
      letter-spacing: 0.07em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .badge::before { width: 7px; height: 7px; border-radius: 50%; background: currentColor; content: ""; }
    .tone-good { border-color: rgba(120, 229, 182, 0.42); background: var(--mint-deep); color: var(--mint); }
    .tone-bad { border-color: rgba(255, 123, 112, 0.42); background: var(--coral-deep); color: var(--coral); }
    .tone-warn { border-color: rgba(244, 201, 93, 0.42); background: var(--amber-deep); color: var(--amber); }
    .tone-info { border-color: rgba(138, 197, 255, 0.38); background: #172c3d; color: var(--blue); }

    .verdicts {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      overflow: hidden;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      background: rgba(16, 36, 31, 0.88);
      box-shadow: var(--shadow);
    }
    .verdict { min-height: 122px; padding: 22px; }
    .verdict + .verdict { border-left: 1px solid var(--line); }
    .verdict p { margin: 13px 0 0; color: var(--muted); font-size: 0.86rem; }

    main { padding: 20px 0 90px; }
    .section { padding-top: 76px; scroll-margin-top: 24px; }
    .section-heading { display: grid; grid-template-columns: minmax(180px, 0.42fr) minmax(0, 1fr); gap: 44px; margin-bottom: 26px; align-items: end; }
    .section-index { color: var(--quiet); font: 700 0.74rem/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
    h2 { margin-bottom: 8px; font-size: clamp(1.7rem, 3vw, 2.55rem); letter-spacing: -0.035em; line-height: 1.05; }
    .section-intro { max-width: 720px; margin-bottom: 0; color: var(--muted); }
    h3 { font-size: 1rem; letter-spacing: -0.015em; }

    .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: linear-gradient(145deg, rgba(21, 45, 39, 0.96), rgba(12, 29, 25, 0.96));
      box-shadow: 0 18px 54px rgba(0, 0, 0, 0.16);
    }
    .panel-body { padding: 24px; }
    .panel-header { display: flex; align-items: start; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--line); padding: 18px 22px; }
    .panel-header h3 { margin: 0; }
    .panel-header p { margin: 4px 0 0; color: var(--muted); font-size: 0.82rem; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }

    .state-view {
      min-height: 170px;
      max-height: 430px;
      overflow: auto;
      margin: 0;
      border-radius: 12px;
      background: #07130f;
      color: #c8ebdb;
      padding: 18px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 0.79rem;
      line-height: 1.6;
    }
    .hash { color: var(--muted); font: 0.74rem/1.6 var(--mono); overflow-wrap: anywhere; }

    .timeline { position: relative; display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
    .timeline::before { position: absolute; top: 30px; bottom: 30px; left: 43px; width: 1px; background: var(--line-strong); content: ""; }
    .timeline-item { position: relative; display: grid; grid-template-columns: 62px minmax(0, 1fr) auto; gap: 18px; align-items: center; min-height: 92px; padding: 14px 22px; }
    .timeline-item + .timeline-item { border-top: 1px solid var(--line); }
    .timeline-number {
      z-index: 1;
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border: 1px solid var(--line-strong);
      border-radius: 50%;
      background: var(--panel);
      color: var(--muted);
      font: 800 0.76rem/1 var(--mono);
    }
    .timeline-item[data-emphasis="timeout"] .timeline-number { border-color: var(--coral); color: var(--coral); }
    .timeline-item[data-emphasis="retry"] .timeline-number { border-color: var(--amber); color: var(--amber); }
    .timeline-title { margin: 0 0 5px; font-weight: 800; }
    .timeline-meta { margin: 0; color: var(--muted); font: 0.76rem/1.5 var(--mono); overflow-wrap: anywhere; }

    .file-list, .check-list, .command-list, .plain-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .file-list li, .check-list li, .command-list li, .plain-list li { border: 1px solid var(--line); border-radius: 11px; background: rgba(7, 19, 15, 0.62); padding: 12px 14px; }
    .file-list code, .command-list code { color: #c8ebdb; font-size: 0.78rem; }
    .check-list li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: start; }
    .check-copy strong { display: block; margin: 2px 0 4px; }
    .check-copy code { display: block; color: var(--quiet); font-size: 0.67rem; overflow-wrap: anywhere; }

    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; border: 1px solid var(--line); border-radius: 13px; background: var(--line); }
    .fact { min-height: 92px; background: var(--canvas-soft); padding: 15px 17px; }
    .fact dt { margin-bottom: 7px; color: var(--muted); font-size: 0.74rem; }
    .fact dd { margin: 0; font-weight: 750; overflow-wrap: anywhere; }
    .fact dd.mono { font: 0.73rem/1.5 var(--mono); }

    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    caption { padding: 16px 20px; color: var(--muted); text-align: left; font-size: 0.8rem; }
    th, td { border-top: 1px solid var(--line); padding: 14px 18px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 0.74rem; font-weight: 650; letter-spacing: 0.03em; }
    td { font: 0.78rem/1.5 var(--mono); }
    .changed { color: var(--amber); }
    .after-good { color: var(--mint); }

    .approval {
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(244, 201, 93, 0.55);
      border-radius: var(--radius);
      background: linear-gradient(110deg, #352d17, #161f19 70%);
      padding: 28px;
    }
    .approval::after {
      position: absolute;
      top: -80px;
      right: -40px;
      width: 230px;
      height: 230px;
      border: 44px solid rgba(244, 201, 93, 0.055);
      border-radius: 50%;
      content: "";
    }
    .approval-copy { position: relative; z-index: 1; max-width: 720px; }
    .approval h2 { margin: 14px 0 10px; }
    .approval p { margin: 0; color: #d4cba9; }

    .empty-note { color: var(--muted); }
    .footer { border-top: 1px solid var(--line); padding: 28px 0 46px; color: var(--quiet); font-size: 0.78rem; }
    .footer-row { display: flex; justify-content: space-between; gap: 20px; }

    @media (max-width: 820px) {
      .hero-grid, .section-heading { grid-template-columns: 1fr; gap: 22px; }
      .hero-aside { border-top: 1px solid var(--line-strong); border-left: 0; padding: 20px 0 0; }
      .verdicts { grid-template-columns: 1fr; }
      .verdict + .verdict { border-top: 1px solid var(--line); border-left: 0; }
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
    }

    @media (max-width: 600px) {
      .wrap { width: min(100% - 28px, 1180px); }
      .nav-copy { display: none; }
      .hero { padding-top: 52px; }
      .section { padding-top: 56px; }
      .timeline-item { grid-template-columns: 46px minmax(0, 1fr); gap: 12px; padding: 14px; }
      .timeline-item > .badge { grid-column: 2; justify-self: start; }
      .timeline::before { left: 34px; }
      .timeline-number { width: 38px; height: 38px; }
      .facts { grid-template-columns: 1fr; }
      .footer-row { flex-direction: column; }
    }

    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to evidence</a>
  <header class="site-header">
    <div class="wrap nav" aria-label="QEDRA evidence header">
      <div class="brand"><span class="brand-mark" aria-hidden="true">Q</span><span>QEDRA</span></div>
      <div class="nav-copy">Qualify → Execute → Detect → Repair → Attest</div>
    </div>
    <div class="wrap hero">
      <p class="eyebrow">Protected law · deterministic evidence</p>
      <div class="hero-grid">
        <div>
          <h1 id="law-id">Evidence awaiting generation</h1>
          <p class="law-statement" id="law-statement">Run the deterministic QEDRA demo to bind this local dashboard to a counterexample, repair record, exact replay, and evidence passport.</p>
        </div>
        <aside class="hero-aside" aria-label="Evidence identity">
          <p>Evidence generated</p><strong id="generated-at">Not generated</strong>
          <p>Passport hash</p><strong id="hero-passport-hash">Not observable</strong>
          <span class="badge tone-warn" id="hero-integrity">Awaiting evidence</span>
        </aside>
      </div>
    </div>
    <div class="wrap verdicts" aria-label="Proof summary">
      <article class="verdict"><span class="badge tone-bad" id="attack-badge">Not run</span><p>Counterexample status. A deterministic assertion, never an AI claim.</p></article>
      <article class="verdict"><span class="badge tone-info" id="replay-badge">Not run</span><p>Exact attack sequence replayed against the repaired target.</p></article>
      <article class="verdict"><span class="badge tone-warn" id="approval-badge">Human approval pending</span><p>No automatic merge. Evidence supports the final human decision.</p></article>
    </div>
  </header>

  <main id="main-content" class="wrap">
    <p class="empty-note" id="load-status" role="status" aria-live="polite">This polished shell is ready. Run <code>pnpm demo</code> to generate local evidence.</p>

    <section class="section" aria-labelledby="initial-title">
      <div class="section-heading"><span class="section-index">01 · Baseline</span><div><h2 id="initial-title">Initial state</h2><p class="section-intro">Wallet balances seeded before the timeout-after-commit attack begins.</p></div></div>
      <article class="panel"><div class="panel-header"><div><h3>Seeded wallets</h3><p>Extracted from the ordered counterexample event stream.</p></div></div><div class="panel-body"><pre class="state-view" id="initial-state" tabindex="0">Evidence not generated.</pre></div></article>
    </section>

    <section class="section" aria-labelledby="timeline-title">
      <div class="section-heading"><span class="section-index">02 · Attack</span><div><h2 id="timeline-title">Ordered timeout / retry timeline</h2><p class="section-intro">The timeout occurs after the first commit. The client retries the same request identifier, exposing a duplicate debit in the vulnerable implementation.</p></div></div>
      <article class="panel"><ol class="timeline" id="timeline" aria-label="Ordered counterexample events"><li class="timeline-item"><span class="timeline-number">—</span><div><p class="timeline-title">No events generated</p><p class="timeline-meta">The deterministic demo will populate this exact sequence.</p></div></li></ol></article>
    </section>

    <section class="section" aria-labelledby="counterexample-title">
      <div class="section-heading"><span class="section-index">03 · Detect</span><div><h2 id="counterexample-title">Expected vs actual before repair</h2><p class="section-intro">The failed state is preserved as a reproducible counterexample, including every ledger observation and affected source file.</p></div></div>
      <div class="grid-2">
        <article class="panel"><div class="panel-header"><div><h3>Expected state</h3><p>Exactly one debit and one credit.</p></div><span class="badge tone-good">Law</span></div><div class="panel-body"><pre class="state-view" id="expected-state" tabindex="0">Evidence not generated.</pre></div></article>
        <article class="panel"><div class="panel-header"><div><h3>Actual state</h3><p>Observed before deterministic repair replay.</p></div><span class="badge tone-bad">Counterexample</span></div><div class="panel-body"><pre class="state-view" id="actual-state" tabindex="0">Evidence not generated.</pre></div></article>
      </div>
      <div class="grid-2" style="margin-top:16px">
        <article class="panel"><div class="panel-header"><div><h3>Affected files</h3><p>Bounded scope recorded with the counterexample.</p></div></div><div class="panel-body"><ul class="file-list" id="affected-files"><li>Evidence not generated.</li></ul></div></article>
        <article class="panel"><div class="panel-header"><div><h3>Counterexample identity</h3><p>Scenario, seed, and content hash.</p></div></div><div class="panel-body"><dl class="facts" id="counterexample-facts"><div class="fact"><dt>Status</dt><dd>Not generated</dd></div></dl></div></article>
      </div>
    </section>

    <section class="section" aria-labelledby="comparison-title">
      <div class="section-heading"><span class="section-index">04 · Compare</span><div><h2 id="comparison-title">Before / after comparison</h2><p class="section-intro" id="after-state-label">After values are shown only as a verified target when deterministic replay and verification both pass.</p></div></div>
      <article class="panel table-wrap">
        <table>
          <caption>Observed counterexample values compared with the post-repair verification target.</caption>
          <thead><tr><th scope="col">Metric</th><th scope="col">Before · observed</th><th scope="col">After · verified target</th></tr></thead>
          <tbody id="comparison-rows"><tr><td colspan="3">Evidence not generated.</td></tr></tbody>
        </table>
      </article>
    </section>

    <section class="section" aria-labelledby="repair-title">
      <div class="section-heading"><span class="section-index">05 · Repair</span><div><h2 id="repair-title">Repair evidence</h2><p class="section-intro">Repair mode, bounded autonomy, authentication facts, preserved request, and deterministic validation remain explicit.</p></div></div>
      <div class="grid-2">
        <article class="panel"><div class="panel-header"><div><h3>Repair workflow</h3><p>Mode and status are sourced from RepairEvidence.</p></div><span class="badge tone-info" id="repair-status-badge">Not requested</span></div><div class="panel-body"><dl class="facts" id="repair-facts"><div class="fact"><dt>Mode</dt><dd>Not generated</dd></div></dl></div></article>
        <article class="panel"><div class="panel-header"><div><h3>Attempts and limits</h3><p>Live autonomy is opt-in, bounded, and never fabricated.</p></div></div><div class="panel-body"><ul class="plain-list" id="repair-attempts"><li>Evidence not generated.</li></ul></div></article>
      </div>
    </section>

    <section class="section" aria-labelledby="replay-title">
      <div class="section-heading"><span class="section-index">06 · Replay</span><div><h2 id="replay-title">Exact replay hash / result</h2><p class="section-intro">The request-sequence fingerprint is recomputed from the canonical HTTP events; the replay artifact hash and deterministic result are reported separately.</p></div></div>
      <article class="panel"><div class="panel-header"><div><h3>Reproducible replay</h3><p>No request is regenerated or silently changed.</p></div><span class="badge tone-info" id="replay-result-badge">Not run</span></div><div class="panel-body"><dl class="facts" id="replay-facts"><div class="fact"><dt>Exact request hash</dt><dd class="mono">Not observable</dd></div></dl></div></article>
    </section>

    <section class="section" aria-labelledby="integrity-title">
      <div class="section-heading"><span class="section-index">07 · Attest</span><div><h2 id="integrity-title">Passport integrity</h2><p class="section-intro">Canonical SHA-256 checks bind the passport and embedded repair evidence. Cross-artifact checks make substitutions visible.</p></div></div>
      <div class="grid-2">
        <article class="panel"><div class="panel-header"><div><h3>Integrity checks</h3><p>Recomputed locally from the generated objects.</p></div><span class="badge tone-warn" id="passport-integrity-badge">Not verified</span></div><div class="panel-body"><ul class="check-list" id="integrity-checks"><li><span class="badge tone-warn">Pending</span><span class="check-copy"><strong>Evidence not generated</strong></span></li></ul></div></article>
        <article class="panel"><div class="panel-header"><div><h3>Repository evidence</h3><p>Commit metadata and documented limitations.</p></div></div><div class="panel-body"><dl class="facts" id="repository-facts"><div class="fact"><dt>Commit</dt><dd>Not generated</dd></div></dl><h3 style="margin-top:22px">Limitations</h3><ul class="plain-list" id="limitations"><li>Evidence not generated.</li></ul></div></article>
      </div>
      <article class="panel" style="margin-top:16px"><div class="panel-header"><div><h3>Reproduction commands</h3><p>Run these commands to regenerate or verify the evidence.</p></div></div><div class="panel-body"><ul class="command-list" id="reproduction-commands"><li><code>pnpm demo</code></li></ul></div></article>
    </section>

    <section class="section" aria-labelledby="approval-title">
      <div class="approval">
        <div class="approval-copy">
          <span class="badge tone-warn" id="approval-status">Pending</span>
          <h2 id="approval-title">Human approval pending</h2>
          <p id="approval-explanation">A repair can be validated and attested without being merged. An explicit human decision remains mandatory.</p>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer"><div class="wrap footer-row"><span>QEDRA · Autonomous code must prove itself.</span><span id="footer-schema">Dashboard shell · no evidence loaded</span></div></footer>
  <noscript><div class="wrap approval" role="alert"><strong>JavaScript is disabled.</strong> The evidence remains available in the adjacent <code>data.json</code> file.</div></noscript>

  <script id="qedra-dashboard-data" type="application/json">__QEDRA_EVIDENCE_DATA__</script>
  <script>
    (() => {
      "use strict";
      const byId = (id) => document.getElementById(id);
      const setText = (id, value) => {
        const node = byId(id);
        if (node) node.textContent = value === null || value === undefined ? "Not observable" : String(value);
      };
      const display = (value) => {
        if (value === null || value === undefined) return "Not observable";
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      };
      const tone = (value) => {
        const status = String(value).toUpperCase();
        if (["PASS", "PASSED", "VERIFIED", "VALIDATED", "REPLAYED", "SUCCEEDED", "CONFIRMED", "TRUE"].includes(status)) return "tone-good";
        if (["FAIL", "FAILED", "INVALID", "FALSE"].includes(status)) return "tone-bad";
        if (["PENDING", "BLOCKED", "NOT_RUN", "NOT-RUN", "TIMED-OUT", "NO-PROGRESS"].includes(status)) return "tone-warn";
        return "tone-info";
      };
      const setBadge = (id, value) => {
        const node = byId(id);
        if (!node) return;
        node.textContent = String(value);
        node.className = "badge " + tone(value);
      };
      const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      };
      const clear = (node) => {
        while (node.firstChild) node.removeChild(node.firstChild);
      };
      const renderJson = (id, value) => {
        const node = byId(id);
        if (node) node.textContent = JSON.stringify(value, null, 2);
      };
      const addFact = (list, label, value, mono) => {
        const item = make("div", "fact");
        item.append(make("dt", "", label), make("dd", mono ? "mono" : "", display(value)));
        list.append(item);
      };
      const renderFacts = (id, facts) => {
        const list = byId(id);
        if (!list) return;
        clear(list);
        facts.forEach((fact) => addFact(list, fact[0], fact[1], fact[2] === true));
      };
      const formatAttempt = (attempt) => {
        const duration = attempt.durationMs === null ? "duration not observable" : String(attempt.durationMs) + " ms";
        return "Attempt " + String(attempt.attempt) + " · " + attempt.outcome + " · " + duration;
      };

      const dataNode = byId("qedra-dashboard-data");
      let data = null;
      try {
        data = JSON.parse(dataNode ? dataNode.textContent || "null" : "null");
      } catch (error) {
        setText("load-status", "Embedded dashboard evidence is malformed. Regenerate it with pnpm demo.");
        return;
      }
      if (!data) return;

      document.title = "QEDRA Evidence — " + data.law.id;
      setText("load-status", "Evidence loaded locally. Every result below is derived from deterministic artifacts; no network request was made.");
      setText("law-id", data.law.id);
      setText("law-statement", data.law.statement);
      setText("generated-at", data.generatedAt);
      setText("hero-passport-hash", data.passport.evidenceHash);
      setBadge("hero-integrity", "Integrity " + data.passport.integrity);
      setBadge("attack-badge", "Counterexample " + data.counterexample.status);
      setBadge("replay-badge", "Replay " + data.replay.result);
      setBadge("approval-badge", "Human approval " + data.humanApproval.status);

      renderJson("initial-state", data.initialState === null ? { status: "Not observable" } : data.initialState);

      const timeline = byId("timeline");
      if (timeline) {
        clear(timeline);
        data.timeline.forEach((event) => {
          const item = make("li", "timeline-item");
          item.dataset.emphasis = event.emphasis;
          const number = make("span", "timeline-number", String(event.sequence + 1).padStart(2, "0"));
          number.setAttribute("aria-hidden", "true");
          const copy = make("div", "");
          copy.append(make("p", "timeline-title", event.label));
          const metadata = [event.type, event.requestPath, event.requestId].filter(Boolean).join(" · ");
          copy.append(make("p", "timeline-meta", metadata));
          const response = event.actualStatusCode === null ? "Not observable" : "HTTP " + String(event.actualStatusCode);
          const responseBadge = make("span", "badge " + tone(event.responseMatched === true), response);
          item.append(number, copy, responseBadge);
          timeline.append(item);
        });
      }

      renderJson("expected-state", data.counterexample.expectedState);
      renderJson("actual-state", data.counterexample.actualState);
      const files = byId("affected-files");
      if (files) {
        clear(files);
        data.counterexample.affectedFiles.forEach((file) => {
          const item = make("li", "");
          item.append(make("code", "", file));
          files.append(item);
        });
      }
      renderFacts("counterexample-facts", [
        ["Status", data.counterexample.status],
        ["Scenario", data.counterexample.scenarioId, true],
        ["Deterministic seed", data.counterexample.deterministicSeed, true],
        ["Evidence hash", data.counterexample.evidenceHash, true],
        ["Reproduce", data.counterexample.reproductionCommand, true]
      ]);

      setText("after-state-label", data.comparison.afterStateLabel);
      const rows = byId("comparison-rows");
      if (rows) {
        clear(rows);
        data.comparison.rows.forEach((row) => {
          const tr = make("tr", row.changed ? "changed" : "");
          const metric = make("th", "", row.metric);
          metric.scope = "row";
          tr.append(metric, make("td", "", display(row.before)), make("td", data.comparison.afterResult === "PASS" ? "after-good" : "", display(row.afterTarget)));
          rows.append(tr);
        });
      }

      setBadge("repair-status-badge", data.repair.mode + " · " + data.repair.status);
      renderFacts("repair-facts", [
        ["Mode", data.repair.mode],
        ["Status", data.repair.status],
        ["Request artifact", data.repair.requestArtifact.path, true],
        ["Request SHA-256", data.repair.requestArtifact.sha256, true],
        ["Diff artifact", data.repair.diffArtifact ? data.repair.diffArtifact.path : "None", true],
        ["API key detected", data.repair.authentication.apiKeyDetected],
        ["Live invocation attempted", data.repair.authentication.liveInvocationAttempted],
        ["Authentication blocker", data.repair.authentication.blocker]
      ]);
      const attempts = byId("repair-attempts");
      if (attempts) {
        clear(attempts);
        const limit = make("li", "");
        limit.textContent = "Bounds · " + String(data.repair.limits.maxAttempts) + " attempts · " + String(data.repair.limits.timeoutMs) + " ms timeout · no-progress limit " + String(data.repair.limits.noProgressLimit);
        attempts.append(limit);
        if (data.repair.attempts.length === 0) {
          attempts.append(make("li", "", "No repair attempt was executed."));
        } else {
          data.repair.attempts.forEach((attempt) => attempts.append(make("li", "", formatAttempt(attempt))));
        }
        attempts.append(make("li", "", "Validation · " + (data.repair.validation.passed === null ? "not observable" : data.repair.validation.passed ? "passed" : "failed")));
      }

      setBadge("replay-result-badge", "Replay " + data.replay.result);
      renderFacts("replay-facts", [
        ["Result", data.replay.result],
        ["Exact request hash", data.replay.exactRequestHash, true],
        ["Recomputed request hash", data.replay.recomputedRequestHash, true],
        ["Request hash matches", data.replay.requestHashMatches],
        ["Replay artifact", data.replay.artifactPath, true],
        ["Replay artifact SHA-256", data.replay.artifactSha256, true],
        ["Completed", data.replay.completedAt],
        ["Command", data.replay.command, true]
      ]);

      setBadge("passport-integrity-badge", "Passport " + data.passport.integrity);
      const checks = byId("integrity-checks");
      if (checks) {
        clear(checks);
        data.passport.checks.forEach((check) => {
          const item = make("li", "");
          item.append(make("span", "badge " + tone(check.valid), check.valid ? "Valid" : "Invalid"));
          const copy = make("span", "check-copy");
          copy.append(make("strong", "", check.label));
          if (check.hash) copy.append(make("code", "", check.hash));
          item.append(copy);
          checks.append(item);
        });
      }
      renderFacts("repository-facts", [
        ["Commit", data.passport.repository.commit, true],
        ["Branch", data.passport.repository.branch],
        ["Working tree dirty", data.passport.repository.dirty],
        ["Artifact count", data.passport.artifactCount],
        ["Bundle integrity", data.passport.evidenceBundleIntegrity],
        ["Remote", data.passport.repository.remoteUrl, true]
      ]);
      const limitations = byId("limitations");
      if (limitations) {
        clear(limitations);
        const values = data.passport.limitations.length ? data.passport.limitations : ["No limitations recorded."];
        values.forEach((value) => limitations.append(make("li", "", value)));
      }
      const commands = byId("reproduction-commands");
      if (commands) {
        clear(commands);
        data.passport.reproductionCommands.forEach((command) => {
          const item = make("li", "");
          item.append(make("code", "", command));
          commands.append(item);
        });
      }

      setBadge("approval-status", data.humanApproval.status);
      setText("approval-explanation", data.humanApproval.explanation);
      setText("footer-schema", data.schemaVersion + " · local, self-contained output");
    })();
  </script>
</body>
</html>
`;

/** Returns a dependency-free HTML document with inert, embedded evidence JSON. */
export function dashboardShell(serializedData: string): string {
  if (!SHELL.includes(SHELL_DATA_MARKER)) {
    throw new Error("Dashboard shell data marker is missing.");
  }
  return SHELL.replace(SHELL_DATA_MARKER, serializedData);
}
