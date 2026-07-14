# QEDRA Genesis Mission

Read `AGENTS.md` and `docs/environment.md` completely before acting.

Execute this as one autonomous engineering mission. Do not merely propose code. Plan, implement, run commands, test, diagnose failures, repair the implementation, and repeat validation until the definition of done is satisfied or a genuine external blocker is reached.

## 1. Product objective

Build QEDRA v0.1, an open-core developer tool and evidence layer for autonomous software engineering.

QEDRA must:

1. represent a non-negotiable software law as a structured executable invariant;
2. generate and execute a reproducible adversarial counterexample;
3. detect a real violation deterministically;
4. prepare and, when authentication permits, invoke a Codex repair workflow in an isolated Git workspace;
5. add a non-regression test;
6. replay the exact same counterexample;
7. verify the repaired result deterministically;
8. produce a machine-verifiable evidence passport requiring human approval.

The defining loop is:

> Law → Attack → Counterexample → Repair → Replay → Evidence

## 2. Hackathon objective

Target the Developer Tools category of OpenAI Build Week. Optimize for deep and genuine Codex/GPT-5.6 usage, a complete runnable product, a coherent product experience, credible real-world impact, and a novel mechanism that judges can understand in under three minutes.

## 3. Complete vertical slice

Protect one critical law:

### TRANSFER_IDEMPOTENCY

> The same transfer request must never debit a wallet more than once, including after a network timeout, client retry, duplicate callback, or concurrent duplicate request.

Create a deliberately vulnerable Node.js/TypeScript wallet application with:

- wallet A seeded with 10,000 FCFA;
- wallet B seeded with 5,000 FCFA;
- a ledger;
- a transfer endpoint;
- request ID or idempotency key `TX-001`;
- deterministic reset and seed commands;
- a failure-injection mode that commits the transfer and loses the response;
- a client retry that submits `TX-001` again;
- observable balances and ledger entries.

The vulnerable scenario must deterministically demonstrate source balance 8,000 instead of 9,000, destination balance 7,000 instead of 6,000, two debit entries and two credit entries for `TX-001`, and invariant status `FAILED`. Preserve the vulnerable implementation as an isolated fixture after the corrected implementation exists.

## 4. Structured counterexample

Generate a machine-readable artifact containing schema version, invariant ID and statement, scenario ID and deterministic seed, ordered request/event sequence, expected state, actual state, relevant ledger entries, affected files, reproduction command, repository commit, timestamp, and SHA-256 evidence hash. The reproduction command must work.

## 5. CLI

Implement a polished CLI with help, stable exit codes, human-readable output, and JSON output.

Required commands:

- `qedra doctor`: inspect relevant environment and capabilities without upgrading the verified toolchain.
- `qedra init`: create or validate the constitution containing `TRANSFER_IDEMPOTENCY`.
- `qedra verify`: run selected invariants; exit 0 on pass and non-zero on confirmed violation.
- `qedra attack TRANSFER_IDEMPOTENCY`: reset, run the timeout-after-commit retry attack, and write the counterexample.
- `qedra repair TRANSFER_IDEMPOTENCY`: use an isolated Git worktree, bounded attempts, deterministic validation, a non-regression test, preserved diff, and mandatory human approval. Use the official Codex SDK when supported. If live programmatic authentication is unavailable, implement the adapter and contracts, create the complete repair-request artifact, provide deterministic record/replay, report the exact blocker, and never fake a live invocation.
- `qedra passport`: generate `evidence/passport.json` and `evidence/passport.html`, hashes, commit metadata, reproduction commands, results, metrics, limitations, and `humanApprovalRequired: true`.
- `qedra demo`: run the complete judge-friendly flow from reset through failure, counterexample, repair workflow, replay, verification, and passport. Support an honest deterministic replay mode for judges without credentials.

A correct repair should use persistent request/result storage, a unique constraint, an atomic transaction, and return the stored first result for repeated requests.

## 6. Architecture

Prefer a reliable pnpm workspace, simplified where appropriate:

- `apps/evidence-dashboard/`
- `apps/demo-wallet-flutter/`
- `packages/cli/`
- `packages/core/`
- `packages/constitution/`
- `packages/scenario-engine/`
- `packages/verification-engine/`
- `packages/codex-adapter/`
- `packages/git-adapter/`
- `packages/proof-passport/`
- `packages/shared/`
- `examples/vulnerable-wallet-api/`
- `constitutions/`
- `evidence/`
- `reports/`
- `docs/`
- `.github/workflows/`

Use TypeScript strict mode, pnpm workspaces, a lightweight Node.js web framework, SQLite or another deterministic embedded database, schema validation, structured logging, a mature CLI library, a modern test runner, controlled dependencies, and Apache-2.0.

## 7. Visual product experience

After the proof loop works, create a small coherent evidence dashboard showing the protected law, initial state, event timeline, expected versus actual state, counterexample, affected files, repair state, before/after comparison, replay result, evidence passport, and human approval status. The standalone HTML passport must work without the dashboard.

Create a minimal Flutter client only after the Node.js proof loop and evidence dashboard work. It should display balances, trigger the timeout/retry scenario, show the duplicate debit before repair, show the single debit after repair, and display or link to the passport. If Flutter cannot run, create valid source and tests where possible and report the exact blocker honestly.

## 8. Cost and bounded autonomy

Instrument duration, scenarios, verification commands, repair attempts, Codex/model calls when observable, token and monetary fields when available, and budget threshold state. Never invent values. Add maximum repair attempts, process timeouts, no-progress detection, bounded scenarios, and cancellation handling.

## 9. Testing

Implement and execute invariant-evaluation unit tests, passport serialization and hash tests, wallet integration tests, a test proving the vulnerable fixture fails, timeout-after-commit tests, concurrent duplicate-request tests, a test proving the corrected implementation passes, CLI end-to-end tests, schema tests, deterministic demo tests, build, lint, and strict type-check. Do not skip failures or weaken assertions.

## 10. Documentation and evidence

Create an exceptional public `README.md` in English with the value proposition, problem, mechanism, Mermaid architecture diagram, quick start, demo, supported platforms, example constitution, counterexample, passport, Codex/GPT-5.6 collaboration, human versus agent decisions, testing, security, cost, open-core model, limitations, roadmap, and Apache-2.0 notice.

Create and maintain `docs/genesis-prompt.md`, `docs/genesis-run.md`, `docs/architecture.md`, `docs/demo-script.md`, `docs/testing-instructions.md`, `docs/codex-collaboration.md`, `docs/threat-model.md`, and `docs/fr/README.fr.md`. Copy this mission to `docs/genesis-prompt.md`. Record observable milestones, commands, errors, fixes, tests, and commits without private chain-of-thought.

## 11. CI

Create GitHub Actions for install, format check, lint, strict type-check, unit tests, integration tests, production build, deterministic QEDRA demo, and evidence artifact upload where appropriate. Default CI must not require an OpenAI secret. Live Codex repair testing must be opt-in, secret-protected, bounded, and disabled by default.

## 12. Autonomous execution protocol

Before editing, inspect the repository and verified environment, copy this mission to `docs/genesis-prompt.md`, write a concise phased plan to `docs/genesis-run.md`, identify external blockers, and establish baseline commands.

For each phase: implement a coherent increment, run narrow tests, diagnose and fix failures, run broader validation, commit the milestone, and update the Genesis report. Do not stop after scaffolding.

When a command fails: capture the command and error, diagnose the root cause, implement the smallest correct fix, add or improve a regression test, rerun the command, and continue only after understanding the result.

## 13. Definition of done

The run is complete only when fresh installation is documented; the vulnerable failure is reproducible; QEDRA detects it deterministically; a structured counterexample exists; the repair workflow is implemented; live Codex invocation works or a precise authentication blocker is recorded; the corrected implementation prevents duplicate debit; the exact attack is replayed; the invariant passes; JSON and HTML passports are generated; hashes verify; tests, lint, type-check, builds, and deterministic demo pass; CI is valid; no secret is committed; documentation and judge instructions are complete; limitations are honest; and commit history is reviewable.

At completion, provide final architecture, files created, exact installation and demo commands, validation commands, executed tests and results, Codex integration status, remaining limitations, final commit SHA, and a 0–10 readiness score for each hackathon criterion.
