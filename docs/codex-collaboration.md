# Codex Collaboration and Repair Contract

## Principle

QEDRA uses Codex to reason about and produce candidate repairs. It never uses an AI statement as proof. Deterministic scenario execution, assertions, process exits, stored state, captured diffs, and artifact hashes decide whether a candidate passes.

This distinction applies both to the Genesis engineering work and to QEDRA's product runtime:

- Codex can inspect code, identify likely causes, propose edits, and add a regression test.
- QEDRA constrains where those edits occur and which files may change.
- The verification engine and test commands decide PASS or FAIL.
- A human reviews the evidence and is the only authority that may approve or merge.

## Genesis collaboration status

The repository was built through an autonomous Codex engineering assignment: repository inspection, architecture decisions, implementation, test execution, failure diagnosis, repairs, documentation, and Git milestones. Observable commands and results belong in `docs/genesis-run.md`; private chain-of-thought does not.

No `OPENAI_API_KEY` was supplied for the product's live repair path. Therefore the Genesis evidence run uses deterministic record/replay and records live authentication as an external blocker. It does not claim a live API call, Codex response, model identity, thread ID, token usage, cost, or live-repair success.

QEDRA records an exact model name only when the SDK exposes it as observable run data. The current adapter does not hardcode or infer `GPT-5.6`, so documentation and evidence must not claim a verified GPT-5.6 runtime invocation without corresponding telemetry.

## Official SDK integration

The live adapter imports `Codex` from the official `@openai/codex-sdk` package. A repair request supplies:

- the invariant ID and statement;
- scenario ID, deterministic seed, counterexample artifact, and hash;
- a working reproduction command;
- immutable Git base commit;
- isolated worktree path;
- explicit affected files;
- repair objective and prohibited operations;
- deterministic validation commands;
- maximum attempts, timeout, and no-progress bounds;
- mandatory human approval.

For each attempt, the adapter starts a fresh SDK thread with:

```ts
{
  workingDirectory: isolatedWorktreePath,
  skipGitRepoCheck: false,
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  networkAccessEnabled: false
}
```

The prompt tells Codex to work only in the provided worktree, avoid Git history operations, and accept deterministic validation as authoritative. QEDRA does not rely on the final natural-language response. After every attempt it reruns the declared validators and fingerprints the workspace diff.

## Authentication handling

QEDRA accepts `OPENAI_API_KEY` from the process environment, `.env.local`, or `.env`. The detector returns only:

- whether a usable value exists;
- whether the source is the environment or an env file.

It never returns, prints, hashes, logs, or writes the secret to evidence. The private credential loader passes the value only to the SDK client and its controlled child environment. The evidence model stores `apiKeyDetected: true|false`, never the value.

Without a key, `qedra doctor` reports replay readiness and the live blocker. An explicit live repair exits with code `40` and `AUTHENTICATION_REQUIRED` before a Codex thread starts. This blocker is scoped: the constitution, attack, counterexample, recorded repair, replay, verifier, dashboard, and passport continue normally.

## Bounded autonomy

The `TRANSFER_IDEMPOTENCY` request uses:

| Control                           |                       Value |
| --------------------------------- | --------------------------: |
| Maximum attempts                  |                           3 |
| Attempt timeout                   |                  120,000 ms |
| Consecutive no-progress limit     |                           2 |
| SDK adapter hard maximum attempts |                          10 |
| SDK adapter hard maximum timeout  |                  900,000 ms |
| Allowed files                     | Explicit two-file allowlist |
| Work location                     |       Detached Git worktree |
| Network in repair sandbox         |                    Disabled |
| Interactive approval              |                    Disabled |
| Commit                            |             Never automatic |
| Merge                             |             Never automatic |

An external abort signal cancels the current attempt. Timeout and cancellation race the SDK run rather than waiting indefinitely. Repeated unchanged fingerprints stop the loop. Validation failures, authentication failures, timeouts, cancellation, attempt exhaustion, and isolation violations have distinct structured statuses.

## Isolation and validation

The Git adapter resolves the recorded base commit and creates a temporary detached worktree. It enforces repository-relative paths and rejects:

- traversal or absolute paths;
- `.git` changes;
- files outside the affected-file allowlist;
- an unexpected base commit;
- a modified recorded patch or patch hash;
- a captured diff that differs from the bound change set.

For this invariant, deterministic repair validation includes:

1. the generated timeout/retry non-regression test;
2. execution of the exact attack against the repaired vulnerable target;
3. expected balances of 9,000 and 6,000 FCFA;
4. exactly one debit and one credit for `TX-001`.

The adapter captures command, arguments, exit code, duration, stdout/stderr, timeout, cancellation, and truncation state. It cleans up the worktree in a finalization path. A successful validation still leaves approval pending and never commits or merges.

## Deterministic record/replay

Record/replay is the credential-free judge mode, not a simulation of an API response. A reviewed change set is bound to:

- request ID;
- invariant ID;
- source mode `deterministic-record`;
- full base commit;
- sorted affected files;
- Git patch content and SHA-256;
- recording timestamp;
- required human approval.

QEDRA applies it through the same Git worktree and validation boundary. Result artifacts label the mode `record-replay`; attempts and Codex metrics are not fabricated. This mode proves that the surrounding repair protocol is runnable and reproducible when live authorization is unavailable.

## Complete repair-request artifact

Run the vulnerable attack first, then record/replay repair:

```powershell
pnpm --silent qedra attack TRANSFER_IDEMPOTENCY --json
# Expected exit: 10
pnpm --silent qedra repair TRANSFER_IDEMPOTENCY --replay --json
```

Review:

- `evidence/counterexample.json`
- `evidence/repair-request.json`
- `evidence/recorded-change-set.json`
- `evidence/repair-report.json`
- `evidence/repair.diff`

The request artifact is identical in structure for live and recorded paths except for its declared mode. It is sufficient to understand the law, reproduce the failure, identify the immutable repository state, constrain candidate edits, and execute validators.

## Enabling live mode later

Key creation, account access, billing, and authorization are human responsibilities. They are deliberately outside QEDRA.

For a temporary PowerShell session:

```powershell
$env:OPENAI_API_KEY = "<your key>"
pnpm --silent qedra doctor --json
```

Alternatively, use an ignored `.env.local` file:

```dotenv
OPENAI_API_KEY=<your key>
```

Confirm that `doctor` reports `READY_FOR_LIVE_REPAIR`, then create a fresh counterexample and opt in explicitly:

```powershell
pnpm --silent qedra attack TRANSFER_IDEMPOTENCY --json
# Confirm expected exit 10.
pnpm --silent qedra repair TRANSFER_IDEMPOTENCY --live --json
```

Never pass a key as a CLI argument, echo it, include it in captured output, commit an env file, or upload it with evidence. Remove the session variable when finished:

```powershell
Remove-Item Env:OPENAI_API_KEY
```

## Human versus agent authority

| Action                                | Agent/QEDRA                | Human                        |
| ------------------------------------- | -------------------------- | ---------------------------- |
| Define business law                   | Encode a supplied law      | Own and approve it           |
| Generate adversarial scenario         | Implement and execute      | Review relevance             |
| Determine violation                   | Run deterministic verifier | Consume result               |
| Propose candidate repair              | Allowed in isolation       | Review candidate             |
| Expand affected-file scope            | Not allowed autonomously   | Explicit decision            |
| Supply API authorization              | Detect presence only       | Own credential and billing   |
| Decide whether evidence is sufficient | Present facts              | Own decision                 |
| Commit or merge repair                | Never automatic            | Own approval and integration |

## Evidence rules

When observable, QEDRA may record attempt duration, SDK thread ID, token usage returned by the SDK, validator duration, scenario count, and command count. When unavailable, fields remain absent or `null`. Monetary cost is never derived from an assumed price table during the run.

The following must never be fabricated:

- live invocation status;
- model or version;
- response text;
- call or thread identifiers;
- token counts;
- monetary cost;
- validation output;
- hashes, commits, or changed files.

This makes an authentication blocker a useful evidence fact rather than a reason to misrepresent completion.
