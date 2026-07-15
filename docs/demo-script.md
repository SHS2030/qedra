# QEDRA Genesis Judge Demo

## Goal

Show, in under three minutes, that QEDRA turns a payment law into executable evidence. The default script is deterministic, credential-free, and honest about the unavailable live Codex authentication path.

## Before the session

Use the pinned toolchain from `docs/environment.md`. From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Do not configure an API key for the deterministic judge path. Do not edit generated evidence between demo and verification.

## One-command demo

```powershell
pnpm demo
```

Equivalent explicit command:

```powershell
node --import tsx packages/cli/src/bin.ts demo --replay
```

The command must finish successfully only after it has:

1. validated the `TRANSFER_IDEMPOTENCY` constitution;
2. executed the vulnerable timeout-after-commit retry;
3. confirmed A=8,000 FCFA, B=7,000 FCFA, two debits, and two credits;
4. written a hashed counterexample;
5. created a complete bounded repair request;
6. replayed the recorded repair in a detached Git worktree;
7. run the non-regression test and deterministic repair validators;
8. replayed the exact canonical HTTP attack against the corrected behavior;
9. verified A=9,000 FCFA, B=6,000 FCFA, one debit, and one credit;
10. generated JSON/HTML passports and the static evidence dashboard;
11. verified evidence hashes.

Any unexpected failure should stop the demo with a non-zero exit. The expected vulnerable violation is handled as evidence inside the demo and does not make the complete demo fail.

## Suggested three-minute narration

### 0:00–0:30 — The law

Open `constitutions/qedra.yaml`.

> QEDRA starts with a non-negotiable law, not a prompt: retrying the same transfer must never debit a wallet twice. The law names a deterministic scenario and exact expected state.

### 0:30–1:00 — The counterexample

Show the attack section of the demo output or run the focused command:

```powershell
node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY --json
$LASTEXITCODE
```

Expected exit code: `10`, meaning a confirmed invariant violation. Point to:

- wallet A: 8,000 instead of 9,000;
- wallet B: 7,000 instead of 6,000;
- two debit and two credit entries for `TX-001`;
- the canonical attack request hash;
- `evidence/counterexample.json` and its evidence hash.

> This is not an AI opinion. A real API executed an ordered failure scenario, and deterministic assertions produced a reproducible counterexample.

### 1:00–1:45 — The bounded repair

```powershell
node --import tsx packages/cli/src/bin.ts repair TRANSFER_IDEMPOTENCY --replay --json
```

Open `evidence/repair-request.json` and `evidence/repair.diff`.

> The judge path uses an honestly labeled recorded change set. It still exercises the production safety boundary: immutable base commit, explicit affected files, detached worktree, patch hash, attempt and timeout limits, a non-regression test, exact-attack validation, cleanup, and no commit or merge.

Point out that the repaired design uses:

- durable request/result storage;
- a unique `request_id` constraint;
- one atomic transaction;
- return of the stored first response for repeated requests.

### 1:45–2:15 — Exact replay

Show the replay section of the demo output and the before/after comparison:

| Stage                     |     A |     B | Debits | Credits | Result |
| ------------------------- | ----: | ----: | -----: | ------: | ------ |
| Vulnerable attack         | 8,000 | 7,000 |      2 |       2 | FAIL   |
| Exact replay after repair | 9,000 | 6,000 |      1 |       1 | PASS   |

> Replay accepts only the original invariant, scenario, deterministic seed, event order, expected status codes, and canonical request hash. A weaker test cannot be substituted after the repair.

### 2:15–2:40 — Codex integration honesty

```powershell
node --import tsx packages/cli/src/bin.ts doctor --json
```

Show `READY_FOR_REPLAY`, the installed official SDK, and `openaiAuthentication.present: false` when no key exists.

> The live adapter is complete and bounded, but this run has no API authorization. QEDRA records `AUTHENTICATION_REQUIRED`, makes no live call, and invents no response, model, tokens, or cost. Missing live authentication does not block the deterministic product.

Do not run `--live` during the credential-free judge demo.

### 2:40–3:00 — Evidence and human approval

```powershell
pnpm evidence:verify
```

Open the standalone passport:

```powershell
Start-Process evidence/passport.html
```

Optionally open the richer dashboard:

```powershell
Start-Process evidence/dashboard/index.html
```

> The passport binds stage results, artifacts, hashes, Git metadata, observable metrics, limitations, and reproduction commands. It requires human approval and cannot merge anything.

## Manual reproduction

Use this sequence when demonstrating each command independently:

```powershell
node --import tsx packages/cli/src/bin.ts doctor --json
node --import tsx packages/cli/src/bin.ts init --json

node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY --json
if ($LASTEXITCODE -ne 10) { throw "Expected confirmed violation exit code 10" }

node --import tsx packages/cli/src/bin.ts repair TRANSFER_IDEMPOTENCY --replay --json
if ($LASTEXITCODE -ne 0) { throw "Recorded repair validation failed" }

node --import tsx packages/cli/src/bin.ts verify TRANSFER_IDEMPOTENCY --target fixed --json
if ($LASTEXITCODE -ne 0) { throw "Correct implementation did not verify" }

node --import tsx packages/cli/src/bin.ts passport --json
node --import tsx packages/cli/src/bin.ts passport --verify --json
```

The complete `demo --replay` command is preferable because it also performs the exact recorded-request replay and assembles the final evidence bundle in one orchestration.

## Evidence checklist

After the demo, confirm these files exist:

```powershell
Get-Item evidence/counterexample.json
Get-Item evidence/repair-request.json
Get-Item evidence/recorded-change-set.json
Get-Item evidence/repair-report.json
Get-Item evidence/repair.diff
Get-Item evidence/repair-evidence.json
Get-Item evidence/replay-result.json
Get-Item evidence/verification-result.json
Get-Item evidence/live-repair-blocker.json
Get-Item evidence/passport.json
Get-Item evidence/passport.html
Get-Item evidence/dashboard/data.json
Get-Item evidence/dashboard/index.html
```

Then inspect Git status:

```powershell
git status --short
```

Generated runtime evidence and dashboard data are ignored. The source working tree should not contain an applied repair from the temporary worktree.

## Optional live activation after the Genesis run

Live mode requires deliberate human authorization, an API key, and an account with suitable access. It is not required for the deterministic demo.

```powershell
$env:OPENAI_API_KEY = "<your key>"
node --import tsx packages/cli/src/bin.ts doctor --json
node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY --json
# Confirm exit code 10, then explicitly opt in:
node --import tsx packages/cli/src/bin.ts repair TRANSFER_IDEMPOTENCY --live --json
```

Expected safety properties remain the same: isolated worktree, explicit affected files, at most three attempts, 120-second attempt timeout, two-attempt no-progress stop, cancellation support, deterministic validation, pending human approval, no commit, and no merge.

Never show a key on screen, add it to a command argument, place it in evidence, or commit it. A live run must report only metrics the SDK actually returns.

## Recovery if a command fails

1. Preserve the command, exit code, and error output.
2. Run `node --import tsx packages/cli/src/bin.ts doctor --json`.
3. Confirm the pinned versions in `docs/environment.md`.
4. Run the focused test category from `docs/testing-instructions.md`.
5. Fix the root cause; do not relax an invariant or expected state.
6. Rerun the complete deterministic demo and evidence verification.

Do not substitute screenshots, fabricated output, or a prewritten success claim for a failed command.
