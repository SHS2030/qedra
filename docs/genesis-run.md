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

### M5 — Reproducible command provenance and complete local gates

The isolated repair and attestation hardening was committed as `55eb9395f072dfe332826b3bbd37fd18ba6c462f` (`feat: complete isolated repair attestation`). A final command-provenance audit then found two test fixtures that described the nonexistent command `attack --replay`; they were corrected to use `repair --replay`.

The first shell-level observation of the intentional attack reported a generic process status `1`. The native PowerShell status was then measured explicitly rather than inferred: both the direct Node.js entry point and `pnpm --silent qedra` returned QEDRA exit code `10`. The generic status came from the surrounding command host. Evidence and documentation now standardize on `node --import tsx packages/cli/src/bin.ts ...` as the explicit source-checkout reproduction entry point, while documenting the equivalent built and installed entry points. The E2E suite asserts the exact command stored in the counterexample.

`qedra doctor` also exposed a cold-start diagnostic issue: the installed Flutter tool exceeded the generic five-second probe and was reported unavailable even though its standalone gates passed. Only the optional Flutter probe was raised to 15 seconds, timeout detection now checks the actual `ETIMEDOUT` error code, and the repeated diagnostic reported Flutter `3.44.2` correctly. Flutter remains optional for core replay and is not installed by default CI.

Fresh local validation after these corrections produced the following observable results:

| Command or check                                                        | Result                                                                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                        | Passed; all 12 workspace projects already matched the pinned lockfile                                                |
| `pnpm format:check`                                                     | Passed                                                                                                               |
| `pnpm lint`                                                             | Passed                                                                                                               |
| `pnpm typecheck`                                                        | Passed                                                                                                               |
| `pnpm test:unit`                                                        | 10 files, 50 tests passed                                                                                            |
| `pnpm test:integration`                                                 | 1 file, 4 tests passed                                                                                               |
| `pnpm test:adversarial`                                                 | 1 file, 3 tests passed                                                                                               |
| `pnpm test:e2e`                                                         | 1 file, 4 end-to-end scenarios passed                                                                                |
| `pnpm build`                                                            | Passed                                                                                                               |
| Built CLI `--version`, vulnerable attack, and fixed verification        | Version `0.1.0`; native exits `0`, `10`, and `0`; exact vulnerable and corrected balances observed                   |
| Flutter format, `flutter analyze --no-pub`, and `flutter test --no-pub` | 6 files formatted with 0 changes; no analysis issues; 4 tests passed                                                 |
| `pnpm demo`                                                             | Passed the complete record/replay flow; attack failed as expected, repair succeeded, replay and verification passed  |
| `pnpm evidence:verify`                                                  | `VERIFIED`; evidence hash, embedded repair hash, semantic repair artifacts, HTML, and all 10 referenced files passed |
| `node --import tsx packages/cli/src/bin.ts doctor --json`               | `READY_FOR_REPLAY`; pinned Node, pnpm, Git, Docker, Flutter, and Codex SDK detected; live authentication absent      |
| GitHub Actions YAML parse                                               | Passed; deterministic and manual live jobs present                                                                   |
| Mission/prompt byte comparison                                          | Identical; SHA-256 `4d4445161169f97489a4dbbdafd5a6eca8457ceb5e962dad9437eccc713422df`                                |
| Recorded patch byte check                                               | 12,197 LF-only bytes; SHA-256 `db2e067804d6f2becd34ed7f66e43c5784cc6ffdaca7dd409132049f00d3cefe`                     |
| Tracked credential and likely-secret scan                               | 0 sensitive credential files and 0 likely secret-bearing files                                                       |

The evidence hash observed during this dirty pre-commit gate is intentionally provisional. The complete demo and hash verification must run again after the final source/documentation commit so the generated counterexample and passport bind to a clean final HEAD. No API key was added, no live SDK call was attempted, and no Codex identity, call, token, or cost metric was invented.

### M6 — Secure live credential handoff and resumed validation

On 2026-07-18, the interrupted mission resumed from commit `0f9f3e93d79be092e33b2d762239d40ba6ef6de4` without resetting or discarding existing work. The OpenAI Platform secure picker created a project-scoped key and the encrypted local-save workflow wrote it to ignored `.env.local` as `OPENAI_API_KEY`. The value was never printed, returned in evidence, passed as a CLI argument, or added to Git. `qedra doctor --json` then reported `READY_FOR_LIVE_REPAIR`, source `env-file`, Codex SDK `0.144.3`, and all pinned tools including Flutter `3.44.2`.

A bounded live repair was genuinely invoked in an isolated Git worktree. The latest observed attempt started one SDK invocation, ran for 6,967 ms, produced no changed files, no validation results, no patch, no commit, no merge, and no token or cost metrics. It stopped with `LIVE_EXECUTION_FAILED` and the safe detail code `CODEX_UNKNOWN_FAILURE`. The raw SDK/provider error was deliberately not serialized, so API billing or project access remains plausible but unproven. The run is not represented as a successful Codex repair.

The resume exposed and corrected four observability issues:

- restricted execution could not write `.git/worktrees`; record/replay now preserves this as `ISOLATION_REQUIRED` instead of masking it as a captured-file mismatch;
- live SDK failures now map to fixed non-secret detail codes for authentication, quota, rate limiting, access, transport, local process, and unknown errors, with raw messages and credential sentinels excluded by tests;
- live request, report, and diff snapshots now use `evidence/live-repair-*` and survive later deterministic demo regeneration;
- the Flutter probe now disables version checks and analytics and allows a 30-second cold start; hermetic E2E runs can disable env-file authentication without disabling explicitly injected sentinel credentials.

The first resumed `pnpm demo` correctly failed inside the restricted filesystem boundary because Git could not create worktree metadata. `git apply --check --whitespace=error-all` proved the recorded patch itself was valid. The identical demo was rerun with the authorized Git boundary and passed. A subsequent E2E run initially found that passport generation bypassed the new hermetic authentication switch; both passport credential checks were corrected and the unchanged E2E suite then passed.

Observed validation after these changes:

| Command or check                                    | Result                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                    | Passed; all 12 workspace projects already matched the lockfile                                                      |
| `pnpm format:check`                                 | Passed                                                                                                              |
| `pnpm lint`                                         | Passed                                                                                                              |
| `pnpm typecheck`                                    | Passed                                                                                                              |
| `pnpm build`                                        | Passed                                                                                                              |
| `pnpm test:unit`                                    | 10 files, 61 tests passed                                                                                           |
| `pnpm test:integration`                             | 1 file, 4 tests passed                                                                                              |
| `pnpm test:adversarial`                             | 1 file, 3 tests passed                                                                                              |
| `pnpm test:e2e`                                     | 1 file, 4 scenarios passed, including live-snapshot preservation                                                    |
| `dart format --output=none --set-exit-if-changed .` | 6 files, 0 changes                                                                                                  |
| `flutter analyze --no-pub`                          | Passed; no issues                                                                                                   |
| `flutter test --no-pub`                             | 4 tests passed                                                                                                      |
| Authorized `pnpm demo`                              | Passed: expected attack failure, repair success, replay PASS, verification PASS                                     |
| `pnpm evidence:verify` after the authorized demo    | `VERIFIED`; all 9 artifact checks in that generated bundle passed                                                   |
| GitHub Actions YAML parse                           | Passed; deterministic job and protected `codex-live-repair` job present                                             |
| Tracked credential scan                             | No real key, selected organization ID, or selected project ID found; only an intentional unit-test sentinel matched |

The last observed remote Actions run, `29382601919`, never acquired a runner because GitHub reported that the account was locked for a billing issue. A fresh `gh auth status` on 2026-07-18 also reported the stored `SHS2030` token invalid, so remote environment inspection and Actions reruns require human GitHub re-authentication. These external account conditions do not alter the fully executable local record/replay proof. The deterministic demo and passport verification must be regenerated once more after the final documentation commit so their Git metadata binds to the final clean HEAD.

### M7 — Pushed hardening milestone and remote runner confirmation

The verified live-path hardening was committed as `43b725a843cd4ffae7d0068a7ecbbd19251a6dc4` (`feat: harden secure live repair diagnostics`). A clean-HEAD deterministic regeneration then passed with evidence hash `670726e3a79f17832d34ac72b7bead2d3cd222dfb9fe422b3b52de94d3101935`; all 9 applicable passport references, the embedded repair hash, semantic repair links, and standalone HTML matched. The passport recorded branch `genesis/qedra-v0.1`, the exact commit, `dirty: false`, `apiKeyDetected: true`, `liveInvocationAttempted: false`, `codexCalls: 0`, and absent token/cost metrics. The preserved live snapshot SHA-256 remained `639c75dc6678f58a9826cf17dcfe00cb98d5f741487b54f03e3006357cafe2f6` before and after deterministic regeneration.

The branch push succeeded without merging `main`. GitHub created public Actions run `29624206261` for the exact milestone SHA. The run completed as failure in approximately four seconds: the deterministic job had zero steps, empty runner name, and `runner_id: 0`; the manual live job was skipped as designed. This independently confirms that no runner executed the workflow. Together with the prior explicit billing-lock annotation, the current remote blocker is the GitHub account state rather than a failing repository command.

This documentation update is the final tracked change. The deterministic demo, passport verification, clean status review, and branch push are repeated after its commit; their final SHA and evidence hash are reported in the mission handoff rather than predicted here.
