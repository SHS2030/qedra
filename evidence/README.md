# QEDRA Evidence Directory

This directory is QEDRA's runtime output boundary. Its documentation is
versioned; generated evidence is ignored by Git and must be regenerated from
the committed source.

Run the complete two-law flow and verify every bundle:

```powershell
pnpm demo
pnpm evidence:verify
```

The submitted flow is deterministic record/replay. It must not be represented
as a live Codex invocation.

## Isolated evidence layout

Each financial law owns a separate bundle. A command for one law must not
write into the other law's directory.

```text
evidence/
  transfer-idempotency/
    counterexample.json
    repair-request.json
    recorded-change-set.json
    repair-report.json
    repair.diff
    repair-evidence.json
    replay-result.json
    verification-result.json
    live-repair-blocker.json
    live-repair-request.json
    live-repair-report.json
    live-repair.diff
    passport.json
    passport.html
    dashboard/index.html
  idempotency-key-payload-binding/
    counterexample.json
    repair-request.json
    recorded-change-set.json
    repair-report.json
    repair.diff
    repair-evidence.json
    replay-result.json
    verification-result.json
    live-repair-blocker.json
    live-repair-request.json
    live-repair-report.json
    live-repair.diff
    passport.json
    passport.html
  summary.json
  dashboard/
    data.json
    index.html
```

The `live-repair-*` files are created only when that optional mode is
explicitly selected; they remain scoped to the selected law.

`summary.json` binds both passport byte hashes, evidence hashes, invariant IDs,
evidence directories, and the common repository commit. The aggregate
`dashboard/` is autonomous and derived from that summary. Both the individual
bundles and the aggregate view keep human approval at `PENDING`; verified
evidence never authorizes a commit, merge, or push.

## Bundle artifacts

In the table below, `<bundle>` means either
`evidence/transfer-idempotency` or
`evidence/idempotency-key-payload-binding`.

| Artifact                            | Purpose                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `<bundle>/counterexample.json`      | Confirmed vulnerable scenario, ordered events, observed state, Git metadata, and internal SHA-256  |
| `<bundle>/repair-request.json`      | Invariant, counterexample, repository, prompt, affected-file scope, validation, and limit contract |
| `<bundle>/recorded-change-set.json` | Base-bound, invariant-bound, path-bound, hashed deterministic repair input                         |
| `<bundle>/repair-report.json`       | Repair status, attempts, changed files, validators, blocker, and approval state                    |
| `<bundle>/repair.diff`              | Exact candidate diff captured from the isolated worktree                                           |
| `<bundle>/repair-evidence.json`     | Schema-validated repair evidence embedded in the passport                                          |
| `<bundle>/replay-result.json`       | Exact-request replay result and deterministic verification                                         |
| `<bundle>/verification-result.json` | Fresh corrected-target verification result                                                         |
| `<bundle>/live-repair-blocker.json` | Explicit credential blocker when optional live repair is unavailable                               |
| `<bundle>/live-repair-request.json` | Latest law-scoped live-mode request snapshot, when live mode is explicitly selected                |
| `<bundle>/live-repair-report.json`  | Latest law-scoped live-mode result with safely classified diagnostics                              |
| `<bundle>/live-repair.diff`         | Latest law-scoped live diff; empty or absent when no candidate was produced                        |
| `<bundle>/passport.json`            | Canonical machine-verifiable evidence passport                                                     |
| `<bundle>/passport.html`            | Standalone, dependency-free human review view                                                      |
| `summary.json`                      | Canonical aggregate binding for both invariant passports                                           |
| `dashboard/data.json`               | Hashed aggregate dashboard data derived from the summary                                           |
| `dashboard/index.html`              | Standalone two-law review dashboard                                                                |

## Integrity verification

Verify one isolated bundle:

```powershell
node --import tsx packages/cli/src/bin.ts passport TRANSFER_IDEMPOTENCY --verify --json
node --import tsx packages/cli/src/bin.ts passport IDEMPOTENCY_KEY_PAYLOAD_BINDING --verify --json
```

Verify both bundles, their cross-links, the aggregate summary, and the
dashboard in one command:

```powershell
node --import tsx packages/cli/src/bin.ts passport --all --verify --json
```

Evidence objects use strict schemas and canonical internal hashes. Passport
artifact references use SHA-256 over the referenced file bytes. Aggregate
verification rejects cross-invariant substitution, changed passport bytes,
commit mismatches, and stale dashboard output.

Do not edit a generated artifact to repair failed verification. Fix the
producer or source, regenerate the complete flow, and rerun verification.
SHA-256 detects mutation but is not a digital signature; trusted repository
and CI provenance remain part of human review.

## Handling rules

- Never place credentials, tokens, private user data, or API responses containing secrets here.
- Never fabricate a command result, Codex response, model identity, token count, cost, hash, or commit.
- Keep unavailable metrics `null` or absent according to the schema.
- Keep record/replay and optional live repair as distinct modes.
- Preserve `humanApprovalRequired: true` and approval status `PENDING`.
- Never allow one invariant's artifacts to satisfy another invariant's passport.
- Upload CI-generated evidence only as scoped workflow artifacts.
- Regenerate from a clean committed base when source or scenario bytes change.

The generated bundles can be shared for review, but every referenced artifact
must travel with its matching passport for complete byte-hash verification.
