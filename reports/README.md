# QEDRA Reports Directory

This directory contains disposable local test, runtime, and diagnostic output. The directory documentation is versioned; generated report content is ignored by Git.

Typical producers include:

- Vitest temporary SQLite databases and fixtures;
- CLI end-to-end work areas;
- deterministic demo runtime data;
- captured validation diagnostics that are not part of the portable evidence passport.

Run the complete validation gate from the repository root:

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

Important proof outputs belong in `evidence/`, not only in this directory. Never treat an unstructured report or console summary as a substitute for schema-validated evidence.

Do not commit local databases, logs, build output, secrets, or user data. Review `git status --short` after tests and demo execution.
