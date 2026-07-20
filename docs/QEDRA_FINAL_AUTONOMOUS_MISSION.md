# QEDRA — FINAL AUTONOMOUS HACKATHON MISSION

## Bootstrap instruction

Read this file completely, then execute it end to end from the current repository state.

Do **not** restart the project from zero. Preserve every valid change already present on `hardening/hackathon-final`. Continue autonomously through all phases without waiting for confirmation after each phase.

Stop only when:

1. a destructive or irreversible action requires explicit human approval;
2. an external service or account blocks progress;
3. the mission reaches the final `READY` or `NOT READY` report.

All visible communication with the user must be in French. Code, identifiers, commands, tests, commit messages, README, showcase, Devpost content, and judge-facing deliverables must remain in English.

---

# 1. Authorized defensive scope

This mission is strictly authorized defensive software testing.

Allowed scope:

- the local QEDRA repository;
- QEDRA's intentionally vulnerable financial fixtures;
- local Git worktrees created by QEDRA;
- local deterministic scenarios;
- synthetic wallets, transactions, and sentinel secrets;
- the GitHub repository and CI configuration owned by the user.

Forbidden scope:

- attacking any third-party service or repository;
- scanning public targets;
- accessing credentials that were not deliberately supplied;
- credential extraction, exfiltration, persistence, stealth, malware, destructive payloads, or privilege escalation;
- modifying `.git` except through normal explicitly allowed Git commands;
- using real customer, payment, or personal data.

Every adversarial test must remain local, reproducible, bounded, non-destructive, and tied to an explicit QEDRA invariant.

---

# 2. Mission objective

Transform QEDRA Genesis into a final OpenAI Build Week Developer Tools submission that is:

- technically rigorous;
- immediately understandable;
- reproducible in one command;
- accessible to a judge in under 60 seconds;
- honest about record/replay versus live Codex execution;
- strongly positioned as a financial-software immune system;
- ready for human review, merge, release, video recording, and Devpost submission.

Final public positioning:

> **QEDRA — The immune system for financial software.**

Core explanation:

> QEDRA turns the non-negotiable laws of financial software into executable invariants, attacks the application under real failure conditions, lets Codex propose repairs in isolation, replays the exact attacks, and generates machine-verifiable evidence before human approval.

Primary demonstration promise:

> Two financial laws. Two real attacks. Two isolated repairs. Two exact replays. Verifiable evidence. Human approval remains mandatory.

---

# 3. Current state and non-negotiable constraints

Expected active branch:

`hardening/hackathon-final`

Expected base:

`genesis/qedra-v0.1`

The current worktree may already contain an incomplete implementation of:

`IDEMPOTENCY_KEY_PAYLOAD_BINDING`

Do not discard valid existing work.

Absolute constraints:

1. Never work directly on `main`.
2. Never merge automatically.
3. Never force-push.
4. Never rewrite Git history.
5. Never create an OpenAI API key.
6. Never add a payment method.
7. Never run live Codex repair in this mission.
8. Never fabricate model identity, API calls, tokens, costs, hashes, test results, or CI success.
9. Never upgrade the pinned global toolchain without a demonstrated blocker and explicit human approval.
10. Never broaden Flutter scope.
11. Never add a third financial invariant.
12. Keep `TRANSFER_ATOMICITY` in the roadmap only.
13. Preserve the intentionally vulnerable fixtures.
14. Preserve human approval as mandatory.
15. No repair may automatically commit, merge, push, or modify the source branch.
16. The default judge path must work without secrets and without an OpenAI API key.
17. Keep the repository recoverable through coherent checkpoint commits.
18. If a new feature cannot be made fully green, revert only that incomplete feature and restore the last green checkpoint.
19. Do not stop to ask minor preference questions.
20. Do not treat external account failures as product failures.

---

# 4. Autonomous execution and recovery protocol

Create or update:

`reports/final-execution-ledger.md`

At the start of every phase, record:

- phase name;
- starting commit;
- Git status;
- expected deliverables;
- commands about to be executed.

At the end of every phase, append:

- files changed;
- commands executed;
- exact pass/fail results;
- defects found;
- fixes applied;
- remaining blockers;
- ending commit;
- next phase.

After every green milestone:

1. run targeted tests;
2. run applicable full gates;
3. confirm no temporary worktree remains;
4. commit with a coherent English message;
5. push only `hardening/hackathon-final`.

If execution is interrupted by network loss, quota exhaustion, context compression, or application restart:

1. read this mission file;
2. read `reports/final-execution-ledger.md`;
3. inspect `git status`, `git diff --stat`, `git log --oneline -10`, and `git worktree list`;
4. preserve valid local changes;
5. rerun the most relevant targeted tests;
6. resume at the first incomplete phase;
7. do not repeat completed work without evidence of corruption.

Continue automatically after every successful phase.

---

# 5. Priority system

## P0 — Must finish

- preserve Genesis;
- complete and verify `IDEMPOTENCY_KEY_PAYLOAD_BINDING`;
- add multi-invariant evidence isolation;
- implement `pnpm demo:judge`;
- complete full tests;
- rewrite README opening and Codex/GPT-5.6 section;
- create Devpost writeup and three-minute video script;
- create judge testing guide;
- perform fresh-clone validation;
- prepare PR to `main`;
- create final human checklist.

## P1 — Strongly preferred

- autonomous static showcase;
- judge bundle ZIP;
- CI workflow updates;
- skeptical judge review;
- red-team report;
- GitHub Pages instructions.

## P2 — Only after P0 and P1 are green

- visual polish that does not risk stability;
- nonessential documentation refinements.

Never implement a third invariant, new Flutter features, hosted backend, live Codex API execution, or unrelated refactoring.

---

# 6. Phase A — Recover and validate current work

Start from the existing worktree.

Execute:

```powershell
git status
git branch --show-current
git rev-parse HEAD
git log --oneline -10
git diff --stat
git worktree list
```

Read every modified file related to the second invariant.

Determine:

- what is complete;
- what is partially complete;
- what is untested;
- whether the first invariant remains intact;
- whether evidence paths could overwrite one another.

Run targeted checks before adding more code.

Do not delete or recreate the implementation merely because it is incomplete.

Required outcome:

- precise recovery note in `reports/final-execution-ledger.md`;
- valid changes preserved;
- no unexplained modification;
- next implementation step identified.

---

# 7. Phase B — Complete the second financial law

Add and fully support:

`IDEMPOTENCY_KEY_PAYLOAD_BINDING`

Invariant statement:

> The same idempotency key must never be accepted for two semantically different transfer requests.

## Canonical financial payload

The authoritative canonical representation must include at minimum:

- `sourceWalletId`;
- `destinationWalletId`;
- `amount`.

Requirements:

- property order must not change semantic identity;
- equivalent payloads must produce the same identity;
- different amount, destination, or source must produce different identities;
- use deterministic canonical JSON and/or SHA-256;
- do not use raw non-canonical JSON string equality.

## Vulnerable fixture

Preserve a dedicated intentionally vulnerable target that mishandles:

1. `TX-001`, A → B, 1,000 FCFA;
2. `TX-001`, A → B, 5,000 FCFA;
3. `TX-001`, A → C or another controlled destination.

The vulnerability must be real and observable.

## Corrected behavior

The corrected implementation must:

- return the stored first result for the same key and exact same canonical payload;
- reject the same key with a different amount, destination, or source;
- use a deterministic business error;
- use a documented HTTP status, preferably `409`;
- use the stable code `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`;
- preserve all balances after conflict;
- create no extra ledger entry;
- preserve the original transfer result;
- work after database reopen;
- behave correctly under relevant concurrency.

## Required tests and artifacts

Add or complete:

- unit, integration, adversarial, CLI E2E, reopen, concurrency, tamper, and regression tests;
- strict constitution entry;
- scenario definition;
- vulnerable attack;
- independent verifier;
- counterexample;
- repair request;
- affected-file allowlist;
- recorded change set;
- patch hash;
- isolated worktree;
- non-regression test;
- deterministic validation;
- exact replay;
- cleanup;
- passport;
- dashboard presentation;
- human approval `PENDING`.

Do not label record/replay as live Codex output.

---

# 8. Phase C — Multi-invariant evidence architecture

The two invariants must never overwrite one another's evidence.

Use an explicit structure such as:

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
    passport.json
    passport.html
  idempotency-key-payload-binding/
    counterexample.json
    repair-request.json
    recorded-change-set.json
    repair-report.json
    repair.diff
    repair-evidence.json
    replay-result.json
    verification-result.json
    passport.json
    passport.html
  dashboard/
    index.html
    data.json
  summary.json
```

An equivalent design is acceptable only if every artifact is unambiguous, tied to its invariant and scenario, and aggregate verification covers both bundles.

Add checks for:

- cross-invariant passport substitution;
- cross-invariant counterexample substitution;
- artifact from another commit;
- changed request order;
- changed scenario ID;
- changed seed;
- changed target;
- changed bytes.

Every substitution must fail deterministically.

---

# 9. Phase D — Green checkpoint for two laws

Run:

```powershell
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
```

Also validate Flutter without extending it:

```powershell
dart format --output=none --set-exit-if-changed .
flutter analyze --no-pub
flutter test --no-pub
```

Verify:

- both vulnerable attacks reproduce;
- both corrected targets pass;
- both record/replay repairs succeed;
- both exact replays succeed;
- both bundles and aggregate evidence verify;
- no temporary worktree remains;
- no secret appears.

Create and push a green checkpoint commit.

Do not continue until green.

---

# 10. Phase E — One-command judge demonstration

Implement:

`pnpm demo:judge`

It must:

1. inspect environment readiness;
2. validate the financial constitution;
3. display both laws;
4. execute each vulnerable attack;
5. show violations;
6. generate counterexamples;
7. execute record/replay repairs in isolated worktrees;
8. run non-regression tests;
9. replay exact attacks;
10. verify corrected states;
11. generate individual passports;
12. generate aggregate summary and dashboard;
13. verify every hash;
14. verify no temporary worktree remains;
15. display this final matrix:

| Financial law | Vulnerable attack | Violation detected | Repair validated | Exact replay | Evidence verified |
| ------------- | ----------------- | ------------------ | ---------------- | ------------ | ----------------- |

The command must fail on unexpected failure.

Create thin wrappers:

- `scripts/judge-demo.ps1`;
- `scripts/judge-demo.sh`.

Add E2E coverage.

---

# 11. Phase F — README and positioning

Rewrite the README opening in this order:

1. `# QEDRA`
2. `> The immune system for financial software.`
3. beginner paragraph;
4. proof loop;
5. protected-laws table;
6. before/after results in FCFA;
7. `pnpm demo:judge`;
8. showcase link;
9. architecture;
10. evidence passport;
11. human approval;
12. installation;
13. testing;
14. Codex/GPT-5.6 use;
15. limitations;
16. open-core model;
17. roadmap.

It must be understandable in under 60 seconds.

## Built with Codex and GPT-5.6

Distinguish:

### Build-time use

Document observed use of Codex Desktop and GPT-5.6 for repository inspection, planning, sub-agents, architecture, implementation, testing, diagnosis, iterative repair, interruption recovery, commits, documentation, and hardening.

Do not invent metrics.

### Runtime use

Explain:

- official `@openai/codex-sdk` integration;
- live repair is optional;
- submitted demo uses deterministic record/replay without API authorization;
- only deterministic validation decides PASS or FAIL;
- Codex cannot approve or merge;
- no live invocation is claimed without evidence.

---

# 12. Phase G — Static showcase

Create:

`docs/showcase/index.html`

Requirements:

- fully static;
- no external dependencies;
- no secret;
- beginner explanation;
- two-law matrix;
- attack timelines;
- before/after states;
- repair and replay statuses;
- hashes and commit SHA;
- reproduction commands;
- human approval `PENDING`;
- visible `DETERMINISTIC RECORD/REPLAY`;
- honest Codex role and limitations.

Add GitHub Pages instructions after human merge.

Test escaping, absence of remote resources, invariant references, hashes, commit, and absence of live-call claims.

---

# 13. Phase H — Judge bundle

Implement:

`pnpm package:judge`

Create:

`dist/qedra-judge-bundle.zip`

Include:

- quick start;
- Windows and Unix scripts;
- constitution;
- showcase;
- reference passports;
- aggregate manifest;
- reproduction commands;
- supported environment;
- limitations;
- commit SHA;
- license.

Exclude secrets, caches, `node_modules`, local databases, user-specific paths, and temporary worktrees.

Test archive contents.

---

# 14. Phase I — Devpost deliverables

Create:

- `docs/submission/PROJECT_SUMMARY.md`
- `docs/submission/DEVPOST_WRITEUP.md`
- `docs/submission/VIDEO_SCRIPT_3_MIN.md`
- `docs/submission/JUDGE_TESTING_GUIDE.md`
- `docs/submission/BUILT_WITH_CODEX_AND_GPT_5_6.md`
- `docs/submission/SCREENSHOT_PLAN.md`
- `docs/submission/FINAL_CHECKLIST.md`

The writeup must include:

- Inspiration
- What it does
- How we built it
- Challenges we ran into
- Accomplishments that we are proud of
- What we learned
- What is next for QEDRA
- Built with

Video structure:

- 0:00–0:20 — network failure and double debit;
- 0:20–0:40 — financial constitution;
- 0:40–1:15 — `TRANSFER_IDEMPOTENCY`;
- 1:15–1:40 — `IDEMPOTENCY_KEY_PAYLOAD_BINDING`;
- 1:40–2:05 — isolated repair;
- 2:05–2:30 — exact replay and passports;
- 2:30–2:50 — Codex and GPT-5.6 use;
- 2:50–2:58 — `Autonomous financial code must prove itself.`

The video must show the product running.

The final checklist must include repository access, default branch, README, CI, demo, bundle, showcase, video visibility tested in incognito, audio, Codex/GPT-5.6 explanation, manual `/feedback` Session ID, Devpost fields, and submission before deadline.

Never invent the Session ID.

---

# 15. Phase J — Defensive red team

Run only local authorized tests against QEDRA and its fixtures:

- retry after timeout;
- duplicate callback;
- concurrent duplicate request;
- same key with identical payload;
- same key with different amount, destination, or source;
- database reopen;
- changed event order, scenario, seed, target;
- cross-invariant artifact substitution;
- artifact from another commit;
- tampered counterexample, patch, change set, passport HTML;
- stale dashboard data;
- unexpected file modification;
- path traversal;
- attempted `.git` modification;
- candidate-created commit;
- no-progress loop;
- timeout;
- cancellation;
- sentinel key leakage;
- missing authentication.

For every defect: reproduce, fix root cause, add regression test, replay, verify evidence, document.

Create `reports/final-red-team.md`.

---

# 16. Phase K — Fresh-clone validation

From a clean temporary clone or checkout, run:

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
pnpm demo:judge
pnpm evidence:verify
pnpm package:judge
git status --short
```

Also validate Flutter without extension.

Success must not depend on untracked files, hidden artifacts, API keys, manual data preparation, mandatory caches, or undocumented state.

Write `reports/fresh-clone-validation.md`.

---

# 17. Phase L — GitHub Actions

Default CI must:

- run without OpenAI secrets;
- use pinned versions;
- run all quality gates and tests;
- build;
- run `pnpm demo:judge`;
- verify evidence;
- build judge bundle;
- upload evidence and bundle;
- fail on unexpected Git changes.

Live Codex CI must remain manual, disabled by default, secret-protected, separate, and non-required.

If runners do not start due to account or billing status, document the external blocker without claiming success.

---

# 18. Phase M — Three automatic review passes

## Pass 1 — Technical correctness

Review financial semantics, canonical payload, transactions, concurrency, persistence, exact replay, evidence isolation, worktrees, paths, secrets, hashes, schemas, tests, and failure codes.

Fix all HIGH or CRITICAL issues. Run full gates. Commit and push.

## Pass 2 — Product comprehension

Evaluate as beginner developer, fintech engineer, security engineer, and product manager.

Each must understand the problem, financial law, “attack”, Codex role, PASS/FAIL authority, and human approval within 60 seconds.

Fix README, CLI, showcase, and video script. Run relevant gates. Commit and push.

## Pass 3 — Hostile hackathon judge

Evaluate:

- Technological Implementation;
- Design;
- Potential Impact;
- Quality of the Idea.

Look for rejection reasons: simple script, fake attack, dishonest recorded repair, self-approval, hard-coded case, difficult setup, weak evidence, overclaiming, unclear GPT-5.6/Codex use, incomplete product.

Create `reports/skeptical-judge-review.md` with initial score, evidence, objections, fixes, and final score. No score above 9 without observable justification.

Fix all HIGH or CRITICAL objections and rerun complete validation.

---

# 19. Phase N — Final Git and PR preparation

Create coherent English milestone commits.

Push only `hardening/hackathon-final`.

Prepare a Pull Request to `main`. Do not merge automatically.

The PR must include:

- executive summary;
- financial problem;
- two protected laws;
- attack scenarios;
- repair protocol;
- exact replay;
- evidence model;
- judge experience;
- tests;
- security controls;
- limitations;
- CI status;
- external blockers;
- validation commands;
- human approval checklist.

Include human steps to review, rerun, open showcase, merge, enable Pages, and create a release with the judge bundle.

---

# 20. Definition of done

Do not declare success until:

- branch is correct and clean;
- no temporary worktree remains;
- Genesis remains green;
- two financial laws are fully executable;
- both vulnerable attacks reproduce;
- both repaired behaviors verify;
- both isolated repairs and exact replays pass;
- individual and aggregate evidence verify;
- all tests and build pass;
- Flutter baseline remains green;
- `pnpm demo:judge` passes;
- judge bundle is tested;
- showcase is autonomous;
- README is understandable in 60 seconds;
- Devpost writeup and video script are ready;
- screenshot plan and checklist are ready;
- fresh-clone validation passes;
- no secret or fabricated claim exists;
- branch is pushed;
- PR is prepared;
- no automatic merge occurred.

Document every external blocker precisely.

---

# 21. Final report

Provide in French:

1. executive summary;
2. `READY` or `NOT READY`;
3. branch and final SHA;
4. protected laws;
5. vulnerable attacks;
6. repaired states;
7. evidence architecture;
8. commands executed;
9. exact tests;
10. red-team findings;
11. fixes;
12. fresh-clone result;
13. GitHub Actions status;
14. showcase path;
15. judge bundle path;
16. Devpost deliverables;
17. PR URL or number;
18. remaining limitations;
19. human steps before merge;
20. human steps before Devpost submission;
21. honest scores for all four hackathon criteria.

Continue autonomously until this report is complete or a genuine external blocker requires human intervention.
