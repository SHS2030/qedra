import { canonicalJsonStringify } from "../../shared/src/index.js";

import { verifyEvidenceHash } from "./integrity.js";
import {
  PassportSchema,
  type EvidenceResult,
  type Passport,
} from "./schemas.js";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value: string | number | boolean | null): string {
  return value === null ? "Not observable" : String(value);
}

function stageCard(label: string, result: EvidenceResult): string {
  const statusClass = result.status.toLowerCase().replace("_", "-");
  return `<article class="stage">
    <div class="stage-heading"><h3>${escapeHtml(label)}</h3><span class="status ${statusClass}">${escapeHtml(result.status)}</span></div>
    <code>${escapeHtml(result.command)}</code>
    <p>Completed: ${escapeHtml(display(result.completedAt))}</p>
    <p>Artifact: ${escapeHtml(result.artifact?.path ?? "None")}</p>
  </article>`;
}

function metricLabel(metric: string): string {
  return metric
    .replaceAll(/([A-Z])/gu, " $1")
    .replace(/^./u, (character) => character.toUpperCase());
}

/** Renders a self-contained, dependency-free HTML evidence passport. */
export function renderPassportHtml(input: Passport): string {
  const passport = PassportSchema.parse(input);
  const passportHashValid = verifyEvidenceHash(passport);
  const repairHashValid = verifyEvidenceHash(passport.repair);
  const integrityValid = passportHashValid && repairHashValid;
  const metrics = Object.entries(passport.metrics)
    .map(
      ([key, value]) =>
        `<tr><th>${escapeHtml(metricLabel(key))}</th><td>${escapeHtml(display(value))}</td></tr>`,
    )
    .join("\n");
  const artifacts = passport.artifacts.length
    ? passport.artifacts
        .map(
          (artifact) =>
            `<li><code>${escapeHtml(artifact.path)}</code><span>${escapeHtml(artifact.sha256)}</span></li>`,
        )
        .join("\n")
    : "<li>No artifacts recorded.</li>";
  const limitations = passport.limitations.length
    ? passport.limitations
        .map((limitation) => `<li>${escapeHtml(limitation)}</li>`)
        .join("\n")
    : "<li>No limitations recorded.</li>";
  const reproductionCommands = passport.reproductionCommands
    .map((command) => `<li><code>${escapeHtml(command)}</code></li>`)
    .join("\n");
  const canonicalEvidence = canonicalJsonStringify(passport, 2);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QEDRA Evidence Passport — ${escapeHtml(passport.invariant.id)}</title>
  <style>
    :root { color-scheme: dark; --bg:#07100d; --panel:#101b17; --line:#29443a; --ink:#f4fbf7; --muted:#9eb7ac; --green:#56e39f; --red:#ff6b6b; --amber:#ffd166; --blue:#69b7ff; }
    * { box-sizing:border-box; } body { margin:0; background:radial-gradient(circle at top right,#17362a 0,var(--bg) 36rem); color:var(--ink); font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
    main { max-width:1120px; margin:auto; padding:48px 24px 80px; } h1,h2,h3,p { margin-top:0; } h1 { font-size:clamp(2.2rem,6vw,4.8rem); line-height:.96; letter-spacing:-.06em; margin-bottom:20px; } h2 { margin-top:42px; font-size:1.45rem; }
    .eyebrow { color:var(--green); font-weight:800; letter-spacing:.13em; text-transform:uppercase; } .statement { max-width:780px; color:var(--muted); font-size:1.12rem; }
    .banner { display:flex; justify-content:space-between; gap:20px; align-items:center; padding:18px 20px; margin:30px 0; border:1px solid var(--amber); border-radius:14px; background:#2b2510; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; } .stage,.panel { border:1px solid var(--line); border-radius:14px; background:rgba(16,27,23,.94); padding:18px; }
    .stage-heading { display:flex; justify-content:space-between; gap:10px; align-items:start; } .stage h3 { margin-bottom:14px; } .stage p { color:var(--muted); margin:12px 0 0; font-size:.88rem; }
    .status { border-radius:999px; padding:3px 9px; font-size:.72rem; font-weight:900; letter-spacing:.06em; } .pass { color:var(--green); background:#123426; } .fail { color:var(--red); background:#381919; } .blocked,.not-run { color:var(--amber); background:#30280f; }
    code { color:#ccebdd; overflow-wrap:anywhere; } table { border-collapse:collapse; width:100%; } th,td { border-bottom:1px solid var(--line); padding:10px 4px; text-align:left; } th { color:var(--muted); font-weight:500; }
    ul { padding-left:20px; } .artifacts { list-style:none; padding:0; } .artifacts li { display:grid; grid-template-columns:minmax(160px,1fr) minmax(220px,2fr); gap:20px; padding:10px 0; border-bottom:1px solid var(--line); } .artifacts span { color:var(--muted); font:12px/1.5 ui-monospace,monospace; overflow-wrap:anywhere; }
    pre { max-height:520px; overflow:auto; margin:0; white-space:pre-wrap; overflow-wrap:anywhere; color:#ccebdd; font:12px/1.55 ui-monospace,"Cascadia Code",monospace; }
    .integrity { color:${integrityValid ? "var(--green)" : "var(--red)"}; font-weight:900; } .meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; color:var(--muted); } .meta strong { display:block; color:var(--ink); }
    @media (max-width:640px) { main { padding:30px 16px 60px; } .banner { align-items:flex-start; flex-direction:column; } .artifacts li { grid-template-columns:1fr; gap:4px; } }
  </style>
</head>
<body>
<main>
  <p class="eyebrow">QEDRA evidence passport · schema ${escapeHtml(passport.schemaVersion)}</p>
  <h1>${escapeHtml(passport.invariant.id)}</h1>
  <p class="statement">${escapeHtml(passport.invariant.statement)}</p>
  <section class="banner"><div><strong>Human approval is required</strong><br><span>Evidence supports a decision; it never merges a repair automatically.</span></div><span class="integrity">Integrity ${integrityValid ? "VERIFIED" : "INVALID"}</span></section>
  <section class="panel meta">
    <div>Generated<strong>${escapeHtml(passport.generatedAt)}</strong></div>
    <div>Commit<strong>${escapeHtml(display(passport.repository.commit))}</strong></div>
    <div>Branch<strong>${escapeHtml(display(passport.repository.branch))}</strong></div>
    <div>Working tree dirty<strong>${escapeHtml(display(passport.repository.dirty))}</strong></div>
  </section>
  <h2>Proof loop</h2>
  <section class="grid">
    ${stageCard("Qualify", passport.qualification)}
    ${stageCard("Attack", passport.attack)}
    ${stageCard("Replay", passport.replay)}
    ${stageCard("Verify", passport.verification)}
  </section>
  <h2>Repair workflow</h2>
  <section class="panel meta">
    <div>Mode<strong>${escapeHtml(passport.repair.mode)}</strong></div>
    <div>Status<strong>${escapeHtml(passport.repair.status)}</strong></div>
    <div>Live API key detected<strong>${escapeHtml(passport.repair.authentication.apiKeyDetected)}</strong></div>
    <div>Live invocation attempted<strong>${escapeHtml(passport.repair.authentication.liveInvocationAttempted)}</strong></div>
  </section>
  <h2>Observable metrics</h2><section class="panel"><table>${metrics}</table></section>
  <h2>Artifacts</h2><section class="panel"><ul class="artifacts">${artifacts}</ul></section>
  <h2>Reproduce</h2><section class="panel"><ul>${reproductionCommands}</ul></section>
  <h2>Limitations</h2><section class="panel"><ul>${limitations}</ul></section>
  <h2>Canonical evidence</h2><section class="panel"><pre>${escapeHtml(canonicalEvidence)}</pre></section>
</main>
</body>
</html>
`;
}
