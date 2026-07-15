# QEDRA Genesis Run

## Run identity

- Started: 2026-07-14 (Atlantic/Reykjavik)
- Mission source: `docs/GENESIS_MISSION.md`
- Active branch: `genesis/qedra-v0.1`
- Starting commit: `bb31af4`
- Remote: `https://github.com/SHS2030/qedra.git`
- Operator: Codex, executing under the repository's autonomous mission instructions

## Baseline

The governing files `AGENTS.md`, `docs/environment.md`, and `docs/GENESIS_MISSION.md` were read completely before implementation. The repository initially contained only toolchain pins, the mission documents, a minimal root package manifest and lockfile, plus an untracked bootstrap archive. No application or test implementation was present.

Observed commands and results:

| Command                                                      | Observed result                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `node --version`                                             | `v24.18.0`                                                                                                 |
| `npm --version`                                              | `11.16.0`                                                                                                  |
| `pnpm --version`                                             | `11.13.0`                                                                                                  |
| `git --version`                                              | `git version 2.43.0.windows.1`                                                                             |
| `gh --version`                                               | `gh version 2.93.0 (2026-05-27)`                                                                           |
| `flutter --version`                                          | Flutter `3.44.2` stable; Dart `3.12.2`; DevTools `2.57.0`                                                  |
| `docker version`                                             | Client and Engine `29.0.1`; Docker Desktop daemon reachable                                                |
| `docker compose version`                                     | `v2.40.3-desktop.1`                                                                                        |
| `git -c safe.directory=C:/dev/qedra status --short --branch` | Branch `genesis/qedra-v0.1`, tracking `origin/genesis/qedra-v0.1`; untracked `qedra-genesis-bootstrap.zip` |

Git initially rejected repository access because the working directory owner differs from the process user. This run uses the scoped command option `-c safe.directory=C:/dev/qedra`; global Git configuration was not changed.

The pre-existing untracked `qedra-genesis-bootstrap.zip` is treated as user data and will not be deleted or committed. Its four entries are byte-for-byte copies of the tracked bootstrap instructions and contain no implementation.

Docker, Flutter, GitHub authentication, and remote access were verified outside the restricted command sandbox. Their failures inside the sandbox were caused by denied access to user-level configuration, keyring, SDK cache, or Docker named-pipe paths; they are not host-environment blockers.

## Phased execution plan

1. Establish the Genesis record, audit all pinned tools and bootstrap inputs, and identify genuine external blockers.
2. Build the strict TypeScript workspace and the deterministic wallet, constitution, scenario, verification, and proof primitives.
3. Implement the complete CLI surface and the isolated, bounded Codex repair adapter with honest live/replay modes.
4. Prove the vulnerable failure, preserve its counterexample, apply the corrected implementation, replay the same attack, and generate hash-verifiable passports.
5. Add the evidence dashboard and minimal Flutter client only after the proof loop is green.
6. Complete adversarial, integration, CLI, schema, hash, build, demo, documentation, security, and CI gates.
7. Create coherent milestone commits, perform final clean-room validation, record the final commit in the passport, and push the current feature branch.

## Known external dependencies and blockers

- Live Codex SDK execution requires OpenAI API authentication. A silent presence check found no usable `OPENAI_API_KEY` in the process environment, `.env.local`, or `.env`. The human explicitly declined key creation and payment setup for this run. Live invocation is therefore an external blocker; the complete SDK contract, secure presence detection, bounded live path, repair-request artifact, and honest deterministic record/replay path remain in scope.
- Docker Desktop, Flutter, GitHub CLI authentication, and GitHub remote access are available. Commands that require user-profile or named-pipe access may need the already authorized out-of-sandbox execution boundary.

## Milestone log

### M0 — Mission accepted and baseline started

- Copied the complete Genesis mission into `docs/genesis-prompt.md`.
- Created this run ledger before product implementation.
- Confirmed the repository is on the feature branch `genesis/qedra-v0.1`, not `main`.
- Confirmed the pinned Node.js, npm, pnpm, and Git versions.
- Confirmed the pinned Flutter, Dart, Docker, and Compose versions plus GitHub CLI access.
- Preserved the first diagnostic failure (Git ownership guard) and adopted a non-global workaround.
- Recorded the human decision not to provision an API key. No live Codex call, output, token count, or cost will be fabricated; judge demonstrations use deterministic record/replay.
- Added the repository rule that all user-visible collaboration is in French while public product artifacts remain in English.
- Verified `docs/genesis-prompt.md` is byte-identical to `docs/GENESIS_MISSION.md` with SHA-256 `4D4445161169F97489A4DBBDAFD5A6ECA8457CEB5E962DAD9437ECCC713422DF`.
- The official Codex manual helper failed before download with `EPERM` while creating its cache under `C:\tmp`. No permission workaround was attempted. The official Codex SDK documentation was instead read from `https://developers.openai.com/codex/sdk`, which documents the server-side `@openai/codex-sdk` TypeScript library, `Codex.startThread()`, thread working-directory controls, structured events, and Node.js 18+ support.

Further milestones append observable commands, failures, repairs, test results, and commits below.

### M1 — Workspace foundation in progress

- Selected exact, conservative dependency versions and added the official `@openai/codex-sdk` package at `0.144.3` after consulting the official SDK documentation and npm registry metadata.
- Added pnpm workspace configuration, strict TypeScript compilation, ESLint, Prettier, Vitest, production build scripts, and Apache-2.0 metadata.
- First `pnpm install` resolved and downloaded all packages but exited with `ERR_PNPM_IGNORED_BUILDS` because pnpm requires explicit approval for `esbuild` install scripts. The workspace now allowlists only `esbuild`; no broad lifecycle-script approval was added.

### M2 — Deterministic proof loop and evidence surfaces

- Implemented the strict TypeScript workspace, constitution loader, canonical JSON and SHA-256 primitives, atomic evidence writers, deterministic scenario engine, invariant verifier, proof schemas, and standalone passport renderer.
- Implemented the deliberately vulnerable SQLite wallet fixture and the corrected wallet store. The canonical timeout-after-commit retry yields A=8,000, B=7,000, two debits, and two credits in the vulnerable fixture; the corrected store yields A=9,000, B=6,000, one debit, and one credit.
- Implemented persistent idempotency through a unique `request_id`, stored first response, `BEGIN IMMEDIATE`, and one atomic wallet/ledger transaction. Integration coverage includes concurrent duplicates, independent database connections, and reopen persistence.
- Implemented the official `@openai/codex-sdk` live adapter contract, safe credential-presence detection, isolated worktree runner, attempt/timeout/no-progress/cancellation bounds, allowlisted paths, deterministic change-set replay, preserved diffs, and mandatory human approval. No live call was attempted.
- Implemented `qedra doctor`, `init`, `verify`, `attack`, `repair`, `passport`, and `demo`, plus the offline evidence dashboard and minimal Flutter client.
- The first combined unit run exposed five failures caused by restricted temporary-directory and Git ownership assumptions. Tests were moved to repository-local runtime directories and Git commands use scoped `safe.directory`; the corrected unit run passed.
- Dashboard integration initially failed strict type-checking after the counterexample schema gained `targetId` and `attackRequestHash`. Its fixtures and JSON serialization were corrected without weakening the schema.
- Global lint then exposed unsafe-value and async-without-await violations that targeted checks had not covered. The implementation was corrected while retaining the full ESLint ruleset.

Observed validation before the repair fixture milestone:

| Command                                                                    | Result                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                           | Passed with the pinned lockfile and the explicit `esbuild` build allowlist |
| `pnpm run format:check`                                                    | Passed                                                                     |
| `pnpm run typecheck`                                                       | Passed                                                                     |
| `pnpm run lint`                                                            | Passed                                                                     |
| `pnpm run test:unit`                                                       | 9 files, 37 tests passed                                                   |
| `pnpm run build`                                                           | Passed                                                                     |
| Flutter `dart format`, `flutter analyze --no-pub`, `flutter test --no-pub` | Passed; 4 Flutter tests passed                                             |

The deterministic recorded repair patch and full CLI demo are intentionally validated only after the current source base is committed, because the repair request and change set bind to an exact Git commit.

### M3 — Interruption recovery and isolated repair completion

The network interruption ended the previous agent stream without proving that its last operations completed. Recovery preserved all existing work and re-established the following baseline before further implementation:

- reread `AGENTS.md`, `docs/environment.md`, `docs/GENESIS_MISSION.md`, and this ledger completely;
- confirmed branch `genesis/qedra-v0.1`, HEAD `371fb6c688232b62de81475e383de7df9c69752f`, and two local commits ahead of the remote;
- reviewed `git status`, `git diff --stat`, recent history, the current worktree list, generated artifacts, and every sub-agent deliverable;
- confirmed that only the repository root worktree remained registered and no Git, pnpm, Flutter, or Dart process from the interrupted run remained;
- observed unrelated Node processes owned by the desktop execution environment; Windows denied `Win32_Process` command-line inspection, so no process was terminated on inference alone;
- repeated the silent authentication check and confirmed that neither the environment nor ignored local env files contained a usable `OPENAI_API_KEY`;
- reran strict type-check, lint, unit, integration, adversarial, build, direct attack, fixed verification, doctor, Flutter analyze, and Flutter tests rather than trusting prior output.

The recovered commit history was:

| Commit    | Milestone                                    |
| --------- | -------------------------------------------- |
| `59598ce` | `docs: record Genesis baseline`              |
| `371fb6c` | `feat: build deterministic QEDRA proof loop` |

The repair fixture was recorded from an isolated worktree against `371fb6c`. It changes only the declared vulnerable store and generated non-regression test. The canonical LF-only patch is 12,197 bytes with SHA-256 `db2e067804d6f2becd34ed7f66e43c5784cc6ffdaca7dd409132049f00d3cefe`. `.gitattributes` preserves byte-sensitive patch and mission line endings.

The deterministic repair replay then:

- applied the exact patch in `.qedra/worktrees/transfer-idempotency`;
- passed the generated timeout/retry non-regression test;
- passed the exact attack verifier against the repaired vulnerable target;
- captured the same patch hash and exact two-file change list;
- reported `committed: false`, `merged: false`, and `appliedToSourceRepository: false`;
- removed and pruned the temporary worktree;
- left the source fixture and source HEAD unchanged.

The CLI E2E suite added direct child-process coverage for help, version, stable exits `0/10/20/30/40`, clean JSON output, credential non-disclosure, vulnerable and fixed state, explicit live authentication blocking, repair replay, demo, JSON/HTML passports, dashboard output, and referenced-file tamper rejection.

Recovery failures and corrections:

- `pnpm exec prettier` was not resolved by pnpm on the first targeted invocation even though the pinned local binary existed. The repository `pnpm format` script was used and `pnpm format:check` passed.
- Parallel Flutter commands in the restricted sandbox contended on the shared SDK cache. Sequential authorized commands completed: `dart format` changed zero files, `flutter analyze --no-pub` found no issues, and `flutter test --no-pub` passed four tests.
- An E2E replay in the restricted sandbox could not write Git worktree metadata and correctly returned `CHANGE_SET_REJECTED`. The same unchanged suite was rerun through the authorized Git boundary and passed; no product assertion was weakened.

### M4 — Final audit hardening

A read-only mission audit identified several gaps before final attestation. The implementation was corrected as follows:

- aligned the constitution scenario ID, deterministic seed, attack command, verification command, and exact HTTP status expectations with the canonical attack;
- made `qedra demo` verify the newly generated passport bundle before reporting `PASSED`;
- made `--live` and `--replay` mutually exclusive and propagated `SIGINT`/`SIGTERM` cancellation through repair and demo operations;
- enforced live worktree base, commit, allowlist, cleanup, and complete validation policy without overwriting genuine SDK authentication, timeout, cancellation, or no-progress statuses;
- counted a Codex call only after `thread.run()` actually started and derived per-attempt outcomes from observed attempt data;
- computed the repair request counterexample SHA-256 over the actual artifact bytes rather than substituting its internal evidence hash;
- removed `OPENAI_API_KEY` and `CODEX_API_KEY` from every deterministic validation child environment and added a sentinel non-transmission test;
- added `recorded-change-set.json` to the passport artifact hash chain and added an E2E mutation/restoration check;
- made standalone `qedra passport` reload and semantically link the counterexample, repair request, repair result, captured diff, validations, allowlist, base commit, and recorded change set before regeneration;
- made the dashboard consume the full passport verifier result and display referenced-artifact checks instead of inferring bundle integrity from embedded objects alone;
- made a successful live demo omit the credential-blocker path when no blocker artifact exists;
- made CI fail on tracked or untracked post-demo changes and kept the live job manual, secret-protected, and disabled by default;
- corrected dashboard paths, pending-approval language, Git-policy guarantees, test coverage claims, Flutter scope, and the generated-artifact inventory in public documentation.

Observed focused and category results after these fixes:

| Command                                                                                | Result                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------- |
| `pnpm format:check`                                                                    | Passed                                    |
| `pnpm lint`                                                                            | Passed                                    |
| `pnpm typecheck`                                                                       | Passed                                    |
| Focused constitution, scenario, live-policy, SDK, worktree, credential-isolation tests | 25 tests passed in the latest focused run |
| `pnpm test:unit` before the credential-isolation addition                              | 10 files, 47 tests passed                 |
| `pnpm test:integration`                                                                | 1 file, 4 tests passed                    |
| `pnpm test:adversarial`                                                                | 1 file, 3 tests passed                    |
| `pnpm test:e2e` after hash-chain and tamper coverage                                   | 1 file, 4 end-to-end scenarios passed     |

The strengthened E2E scenario also regenerated the passport from stored artifacts, retained all 10 referenced artifacts, rejected a byte-modified `recorded-change-set.json` with exit `30`, restored the original bytes, and returned to `VERIFIED`.

No live SDK request was made. Model identity, call IDs, token usage, and monetary cost remain unobserved and are not populated. The external live-authentication blocker remains current while all deterministic phases continue.

The final clean-commit gates, regenerated evidence SHA, GitHub push, and remote CI result are recorded only after they are freshly executed below.
