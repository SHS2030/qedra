# QEDRA Hackathon Final Baseline

## Audit identity

- Date: 2026-07-19 (Atlantic/Reykjavik)
- Source branch: `genesis/qedra-v0.1`
- Source and hardening base commit: `cb820683964a9c00b6915f08e8b56299ff83b942`
- Active branch: `hardening/hackathon-final`
- `main` commit: `01e810383d72aa6816bb62012b683d039e161824`
- Working tree before and after validation: clean
- Registered worktrees before and after validation: repository root only
- Baseline correction commit: not required

The local `hardening/hackathon-final` branch already existed when this audit began. Its commit was verified to be byte-identical to the local `genesis/qedra-v0.1` branch through `rev-parse` and `merge-base`. No command switched to or modified `main`.

## Git provenance

The five required unscoped Git commands first exited `1` because Git rejected the repository ownership as dubious. This is an execution-environment restriction already recorded by Genesis. No global Git configuration was changed. The same commands were repeated with the repository-scoped option `-c safe.directory=C:/dev/qedra` and exited `0`.

| Command                                                                                      | Result                                               | Classification       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------- |
| `git status --short --branch`                                                                | Exit `1`: dubious ownership guard                    | `PARTIALLY_VERIFIED` |
| `git branch --show-current`                                                                  | Exit `1`: dubious ownership guard                    | `PARTIALLY_VERIFIED` |
| `git rev-parse HEAD`                                                                         | Exit `1`: dubious ownership guard                    | `PARTIALLY_VERIFIED` |
| `git log --oneline -10`                                                                      | Exit `1`: dubious ownership guard                    | `PARTIALLY_VERIFIED` |
| `git worktree list --porcelain`                                                              | Exit `1`: dubious ownership guard                    | `PARTIALLY_VERIFIED` |
| `git -c safe.directory=C:/dev/qedra status --short --branch`                                 | Exit `0`; clean `hardening/hackathon-final`          | `VERIFIED`           |
| `git -c safe.directory=C:/dev/qedra branch --show-current`                                   | Exit `0`; `hardening/hackathon-final`                | `VERIFIED`           |
| `git -c safe.directory=C:/dev/qedra rev-parse HEAD`                                          | Exit `0`; `cb820683964a9c00b6915f08e8b56299ff83b942` | `VERIFIED`           |
| `git -c safe.directory=C:/dev/qedra log --oneline -10`                                       | Exit `0`; Genesis history observed through `529060f` | `VERIFIED`           |
| `git -c safe.directory=C:/dev/qedra worktree list --porcelain`                               | Exit `0`; root worktree only                         | `VERIFIED`           |
| `git -c safe.directory=C:/dev/qedra merge-base hardening/hackathon-final genesis/qedra-v0.1` | Exit `0`; `cb820683964a9c00b6915f08e8b56299ff83b942` | `VERIFIED`           |
| `git -c safe.directory=C:/dev/qedra rev-parse genesis/qedra-v0.1`                            | Exit `0`; `cb820683964a9c00b6915f08e8b56299ff83b942` | `VERIFIED`           |

## Toolchain

| Command             | Observed result                                           | Classification |
| ------------------- | --------------------------------------------------------- | -------------- |
| `node --version`    | `v24.18.0`                                                | `VERIFIED`     |
| `npm --version`     | `11.16.0`                                                 | `VERIFIED`     |
| `pnpm --version`    | `11.13.0`                                                 | `VERIFIED`     |
| `git --version`     | `git version 2.43.0.windows.1`                            | `VERIFIED`     |
| `flutter --version` | Flutter `3.44.2` stable; Dart `3.12.2`; DevTools `2.57.0` | `VERIFIED`     |

No tool or dependency version was upgraded.

## TypeScript and deterministic proof gates

| Command                                                                                   | Exact observed result                                                                                                                                  | Classification     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `pnpm install --frozen-lockfile`                                                          | Exit `0`; all 12 workspace projects already up to date; pnpm `11.13.0`                                                                                 | `VERIFIED`         |
| `pnpm format:check`                                                                       | Exit `0`; all matched files use Prettier style                                                                                                         | `VERIFIED`         |
| `pnpm lint`                                                                               | Exit `0`; no ESLint findings                                                                                                                           | `VERIFIED`         |
| `pnpm typecheck`                                                                          | Exit `0`; strict TypeScript check passed                                                                                                               | `VERIFIED`         |
| `pnpm test:unit`                                                                          | Exit `0`; 10 files, 61 tests passed                                                                                                                    | `VERIFIED`         |
| `pnpm test:integration`                                                                   | Exit `0`; 1 file, 4 tests passed                                                                                                                       | `VERIFIED`         |
| `pnpm test:adversarial`                                                                   | Exit `0`; 1 file, 3 tests passed                                                                                                                       | `VERIFIED`         |
| `pnpm test:e2e` in the restricted filesystem sandbox                                      | Exit `1`; 3 passed, 1 failed because `demo` returned QEDRA exit `30` when `.git/worktrees` was not writable                                            | `EXTERNAL_BLOCKER` |
| `pnpm test:e2e` through the authorized Git boundary, with unchanged source and assertions | Exit `0`; 1 file, 4 scenarios passed                                                                                                                   | `VERIFIED`         |
| `pnpm build`                                                                              | Exit `0`; production TypeScript emit passed                                                                                                            | `VERIFIED`         |
| `pnpm demo` through the authorized Git boundary                                           | Exit `0`; vulnerable attack failed as expected, record/replay repair succeeded, exact replay passed, fresh verification passed, human approval pending | `VERIFIED`         |
| `pnpm evidence:verify`                                                                    | Exit `0`; status `VERIFIED`; passport, embedded repair, semantic repair links, standalone HTML, and 9/9 referenced artifacts valid                     | `VERIFIED`         |

Observed Genesis evidence passport hash after the baseline demo:

```text
e32a745359b4fb773cf031b173bc1c6d22968e5f57791a3deb9a0bd067bf8f6b
```

The hash is a runtime observation for this baseline commit and is not presented as the final submission hash.

## Flutter presentation client

Commands were executed from `apps/demo-wallet-flutter`. Access to the installed Flutter SDK cache was authorized; no dependency fetch or upgrade was performed.

| Command                                             | Exact observed result                  | Classification |
| --------------------------------------------------- | -------------------------------------- | -------------- |
| `dart format --output=none --set-exit-if-changed .` | Exit `0`; 6 files formatted, 0 changed | `VERIFIED`     |
| `flutter analyze --no-pub`                          | Exit `0`; no issues found              | `VERIFIED`     |
| `flutter test --no-pub`                             | Exit `0`; 4 tests passed               | `VERIFIED`     |

## Independent code findings

The baseline inspection found a real, currently unprotected semantic gap that matches the planned second law: `WalletStore.transfer` looks up a stored transfer by `request_id` and returns its first response without comparing the new source wallet, destination wallet, or amount. The database stores those fields, but the retry path does not bind them to the key. This is not a Genesis regression for `TRANSFER_IDEMPOTENCY`; it is the concrete starting condition for `IDEMPOTENCY_KEY_PAYLOAD_BINDING`.

No Genesis assertion was weakened and no baseline source correction was needed. The next phase may add the second law only after preserving this green checkpoint.
