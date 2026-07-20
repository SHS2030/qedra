# Built with Codex and GPT-5.6

QEDRA was built during OpenAI Build Week through a long-running Codex engineering workflow using GPT-5.6.

## How Codex and GPT-5.6 were used

Codex and GPT-5.6 were used to:

- inspect the repository and the verified development toolchain;
- translate the financial requirement into the executable `TRANSFER_IDEMPOTENCY` invariant;
- design the constitution, scenario engine, verification engine, Git worktree boundary, CLI, evidence passport, dashboard, and Flutter presentation client;
- implement the wallet fixture and the deterministic timeout-after-commit retry scenario;
- create and execute unit, integration, adversarial, end-to-end, and Flutter tests;
- diagnose validation failures and repair infrastructure defects;
- document the architecture, limitations, threat model, and judge workflow;
- produce milestone commits and recover the engineering mission after interrupted sessions.

## Human decisions

The human owner retained authority over:

- the non-negotiable financial law;
- product scope and supported use case;
- safety and repository boundaries;
- the deterministic judge path;
- the mandatory human-approval policy;
- the decision not to claim a successful live model repair without authenticated runtime evidence.

## Submitted judge path

The submitted demonstration uses deterministic record/replay so judges can reproduce it without credentials.

GPT-5.6 was used through Codex to build, test, diagnose, refine, and document QEDRA. The submission does not falsely claim that GPT-5.6 executed the submitted runtime repair when corresponding authenticated telemetry is unavailable.

## Quick judge test

```powershell
pnpm install --frozen-lockfile
pnpm demo
pnpm evidence:verify
```

No OpenAI API key, external database, cloud account, test credentials, or proprietary service is required for the judge path.

The demonstration:

1. reproduces the duplicate-transfer failure;
2. validates the bounded repair inside an isolated Git worktree;
3. replays the exact scenario;
4. verifies the corrected financial state;
5. generates machine-verifiable JSON and HTML evidence;
6. keeps human approval mandatory.

## Runtime honesty

QEDRA includes an optional live repair adapter based on the official `@openai/codex-sdk`.

The credential-free Genesis evidence run does not claim a successful authenticated live repair, model identity, token count, cost, or provider response when those values were not directly observable.
