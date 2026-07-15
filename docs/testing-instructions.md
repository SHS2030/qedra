# QEDRA Testing Instructions

## Testing contract

QEDRA treats executable results as evidence. A model response, generated diff, log summary, or documentation statement cannot replace a test, assertion, process exit code, stored state observation, or hash verification.

Do not weaken assertions to obtain a green run. When a command fails, preserve its command and output, diagnose the root cause, add or improve a regression test, and rerun the narrow test before the full gate.

## Prerequisites

Use the pinned versions in `docs/environment.md`:

```powershell
node --version
pnpm --version
git --version
pnpm install --frozen-lockfile
```

Expected baseline: Node.js 24.18.0, pnpm 11.13.0, and Git 2.43.0. The TypeScript wallet uses `node:sqlite`, so Node 24 is required. Default tests and the deterministic demo do not need Docker, Flutter, an OpenAI credential, or network access after dependency installation.

## Complete gate

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:adversarial
pnpm test:e2e
pnpm build
pnpm demo
pnpm evidence:verify
git status --short
```

`pnpm demo` must generate fresh evidence before `pnpm evidence:verify`. The final Git status review is required because repair experiments must not modify the source branch and runtime artifacts must remain ignored.

## Gate matrix

| Command                          | Scope                                          | Required outcome             |
| -------------------------------- | ---------------------------------------------- | ---------------------------- |
| `pnpm install --frozen-lockfile` | Lockfile and approved dependency builds        | Exit `0`; lockfile unchanged |
| `pnpm format:check`              | Prettier policy                                | Exit `0`                     |
| `pnpm lint`                      | ESLint correctness and safety rules            | Exit `0`                     |
| `pnpm typecheck`                 | Strict TypeScript contracts                    | Exit `0`                     |
| `pnpm test:unit`                 | Schemas, hashes, verifier, adapters, dashboard | All tests pass               |
| `pnpm test:integration`          | Correct wallet API and persistent database     | All tests pass               |
| `pnpm test:adversarial`          | Vulnerable and fixed attack behavior           | All tests pass               |
| `pnpm test:e2e`                  | CLI exits, JSON output, demo orchestration     | All tests pass               |
| `pnpm build`                     | Production TypeScript emit                     | Exit `0`                     |
| `pnpm demo`                      | Complete credential-free vertical slice        | Exit `0`; evidence generated |
| `pnpm evidence:verify`           | Passport schema and hash chain                 | Exit `0`; integrity valid    |

`pnpm test` runs the complete Vitest suite and is useful as a final aggregate, but the category commands remain explicit CI gates so failures are easy to locate.

## Focused suites

### Unit tests

```powershell
pnpm test:unit
```

Coverage includes:

- constitution schema and initialization;
- canonical JSON and SHA-256 behavior;
- safe repository-relative path checks;
- invariant evaluator PASS/FAIL output;
- counterexample and passport schema validation;
- evidence hash generation and tamper rejection;
- standalone passport rendering;
- secure `OPENAI_API_KEY` presence detection without value disclosure;
- live adapter authentication, isolation, attempt, timeout, cancellation, and no-progress behavior through test doubles;
- recorded change-set hash, base-commit, and affected-path validation;
- process runner, API-credential removal, and Git worktree policy;
- evidence dashboard data and escaping.

Run one file while diagnosing:

```powershell
pnpm test -- tests/unit/passport-foundation.test.ts
pnpm test -- tests/unit/codex-adapter-live.test.ts
pnpm test -- tests/unit/git-adapter.test.ts
pnpm test -- tests/unit/dashboard-generator.test.ts
```

Live adapter unit tests use injected ports; they do not make an API call and must not be described as live model evidence.

### Wallet integration tests

```powershell
pnpm test:integration
```

Required behaviors:

- reset and deterministic seed;
- first transfer updates both balances and writes one debit/credit pair;
- timeout after commit followed by retry returns the stored first result;
- duplicate requests do not mutate state twice;
- concurrent duplicates across connections preserve one transfer result;
- idempotency survives closing and reopening the SQLite database.

Temporary databases must live under the repository's ignored runtime area and be closed by each test.

### Adversarial tests

```powershell
pnpm test:adversarial
```

The suite must prove both sides of the law:

1. the preserved vulnerable fixture deterministically reaches A=8,000, B=7,000, two debits, and two credits for `TX-001`, and the verifier returns FAIL;
2. the corrected implementation receives the same canonical attack and reaches A=9,000, B=6,000, one debit, and one credit, and the verifier returns PASS;
3. an altered ordered event definition is rejected before replay.

Cross-connection concurrent duplicates are covered separately by the wallet integration suite.

Do not change the expected vulnerable values or treat the intentional failure as a test harness failure.

### CLI end-to-end tests

```powershell
pnpm test:e2e
```

The CLI contract includes:

- help and version exit `0`;
- clean, parseable `--json` stdout;
- `attack` exit `10` for a confirmed violation;
- `verify --target fixed` exit `0`;
- unsupported usage exit `20`;
- execution/validation failure exit `30`;
- unauthenticated explicit live repair exit `40`;
- deterministic demo exit `0` and required artifacts;
- passport verification rejects schema, internal-hash, or referenced-file tampering.

After `pnpm build`, confirm the production entry point rather than only the TSX development path:

```powershell
node dist/packages/cli/src/bin.js --help
node dist/packages/cli/src/bin.js verify TRANSFER_IDEMPOTENCY --target fixed --json
```

## Expected violation reproduction

Run the vulnerable attack separately:

```powershell
pnpm --silent qedra attack TRANSFER_IDEMPOTENCY --json
$LASTEXITCODE
```

Expected process exit: `10`.

Expected deterministic observations:

```text
Wallet A: 8000 FCFA
Wallet B: 7000 FCFA
TX-001: 2 debit entries, 2 credit entries
Invariant: FAILED
```

The command must write `evidence/counterexample.json`. Its `reproductionCommand` must execute successfully as a reproduction of the confirmed violation, which means it returns exit `10` after observing the same state.

## Correct implementation verification

```powershell
pnpm --silent qedra verify TRANSFER_IDEMPOTENCY --target fixed --json
$LASTEXITCODE
```

Expected process exit: `0`.

Expected deterministic observations:

```text
Wallet A: 9000 FCFA
Wallet B: 6000 FCFA
TX-001: 1 debit entry, 1 credit entry
Invariant: PASSED
```

## Deterministic repair and demo

The record/replay repair requires a committed Git base because its patch and temporary worktree bind to that commit.

```powershell
pnpm --silent qedra attack TRANSFER_IDEMPOTENCY --json
if ($LASTEXITCODE -ne 10) { throw "Expected violation was not confirmed" }

pnpm --silent qedra repair TRANSFER_IDEMPOTENCY --replay --json
if ($LASTEXITCODE -ne 0) { throw "Recorded repair did not validate" }

pnpm --silent qedra demo --replay
if ($LASTEXITCODE -ne 0) { throw "Deterministic demo failed" }
```

The worktree validator must run the generated non-regression test and the exact attack verifier. A passing repair result must include the captured patch, changed-file list, validation command results, pending human approval, `committed: false`, and `merged: false`.

## Evidence validation

```powershell
pnpm evidence:verify
```

Verification must check:

- strict passport schema;
- counterexample, repair, and passport internal hashes;
- referenced artifact byte hashes;
- safe repository-relative artifact paths;
- required human approval;
- exact replay status;
- reproduction commands and Git metadata presence where observable.

Hash tests should mutate a nested value and separately mutate a referenced file. Both forms of tampering must fail verification.

Unknown model, token, cost, or budget values must remain `null`; tests must never inject fabricated production metrics merely to fill the passport.

## Flutter client

The Flutter app is a presentation layer and is not part of the deterministic proof authority. When the verified Flutter toolchain is available:

```powershell
Push-Location apps/demo-wallet-flutter
flutter pub get
flutter analyze
flutter test
Pop-Location
```

If Flutter cannot access its SDK cache or dependencies in a restricted environment, record the exact command and error. Do not claim the client was executed when only source validation was possible.

## CI parity

`.github/workflows/ci.yml` executes the TypeScript gates on a clean GitHub-hosted runner with Node 24.18.0 and pnpm 11.13.0. Default push and pull-request validation have no OpenAI secret. Generated evidence is uploaded after the deterministic demo.

The live Codex job exists only behind a manual `workflow_dispatch` boolean and the `OPENAI_API_KEY` repository secret. Its default is disabled. A skipped live job is expected and must not be represented as a successful live invocation.

## Failure triage

Use this order:

1. capture the exact command, exit code, and stderr;
2. run `pnpm --silent qedra doctor --json` for capability diagnostics;
3. check pinned tool versions without upgrading them;
4. run the narrowest relevant test file;
5. inspect generated evidence without editing it;
6. fix the root cause and add a regression test;
7. rerun the focused category;
8. rerun the complete gate and demo;
9. review `git status --short` for accidental artifacts or source-worktree mutation.

Authentication absence blocks only `repair --live`. It must not block unit, integration, adversarial, e2e, build, record/replay, demo, dashboard, or passport verification.
