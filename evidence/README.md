# QEDRA Evidence Directory

This directory is the runtime output boundary for QEDRA proof artifacts. The directory documentation is versioned; generated evidence is ignored by Git and should be regenerated from the committed source.

Run:

```powershell
pnpm demo
pnpm evidence:verify
```

## Generated artifacts

| Artifact                   | Purpose                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `counterexample.json`      | Confirmed vulnerable scenario, ordered events, observed state, Git metadata, and internal SHA-256 |
| `repair-request.json`      | Complete invariant, counterexample, repository, prompt, scope, validation, and limit contract     |
| `recorded-change-set.json` | Base-bound, path-bound, hashed deterministic repair input                                         |
| `repair-report.json`       | Repair status, attempts, changed files, validators, blocker, and approval state                   |
| `repair.diff`              | Exact candidate diff captured from the isolated worktree                                          |
| `repair-evidence.json`     | Schema-validated repair evidence referenced by the passport                                       |
| `replay-result.json`       | Exact-request replay result and deterministic verification                                        |
| `verification-result.json` | Fresh corrected-target verification result                                                        |
| `live-repair-blocker.json` | Explicit credential blocker when live repair is unavailable                                       |
| `live-repair-request.json` | Latest live-mode request snapshot, preserved across deterministic demo regeneration               |
| `live-repair-report.json`  | Latest live-mode result and safely classified blocker, without raw provider errors                |
| `live-repair.diff`         | Latest live-mode isolated diff; empty when no candidate change was produced                       |
| `passport.json`            | Canonical machine-verifiable evidence passport                                                    |
| `passport.html`            | Standalone, dependency-free human review view                                                     |

Additional generated dashboard artifacts live under `evidence/dashboard/`.

## Integrity

Evidence objects use strict schemas and canonical internal hashes. Passport artifact references use SHA-256 over the referenced file bytes. Verify both before review:

```powershell
pnpm evidence:verify
```

Do not edit a generated artifact to repair a failed verification. Fix the producer or source, regenerate the complete flow, and rerun verification.

SHA-256 detects mutation but is not a digital signature. Repository commit metadata and trusted CI provenance remain part of the review context.

## Handling rules

- Never place credentials, tokens, private user data, or API responses containing secrets here.
- Never fabricate a command result, Codex response, model identity, token count, cost, hash, or commit.
- Keep unavailable metrics `null` or absent according to the schema.
- Treat record/replay and live repair as distinct modes.
- Preserve `humanApprovalRequired: true`; an evidence bundle cannot authorize merge.
- Upload CI-generated evidence only as scoped workflow artifacts.
- Regenerate from a clean committed base when the source changes.

The generated bundle can be shared for review, but every referenced artifact must travel with the passport for complete byte-hash verification.
