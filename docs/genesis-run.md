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

| Command | Observed result |
| --- | --- |
| `node --version` | `v24.18.0` |
| `npm --version` | `11.16.0` |
| `pnpm --version` | `11.13.0` |
| `git --version` | `git version 2.43.0.windows.1` |
| `gh --version` | `gh version 2.93.0 (2026-05-27)` |
| `flutter --version` | Flutter `3.44.2` stable; Dart `3.12.2`; DevTools `2.57.0` |
| `docker version` | Client and Engine `29.0.1`; Docker Desktop daemon reachable |
| `docker compose version` | `v2.40.3-desktop.1` |
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
