export const SUPPORTED_INVARIANT_IDS = [
  "TRANSFER_IDEMPOTENCY",
  "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
] as const;

export type SupportedInvariantId = (typeof SUPPORTED_INVARIANT_IDS)[number];

export interface InvariantEvidencePaths {
  readonly directory: string;
  readonly counterexample: string;
  readonly repairRequest: string;
  readonly repairReport: string;
  readonly repairDiff: string;
  readonly liveRepairRequest: string;
  readonly liveRepairReport: string;
  readonly liveRepairDiff: string;
  readonly recordedChangeSet: string;
  readonly repairEvidence: string;
  readonly replayResult: string;
  readonly verificationResult: string;
  readonly passportJson: string;
  readonly passportHtml: string;
  readonly liveRepairBlocker: string;
  readonly worktree: string;
}

export function isSupportedInvariantId(
  value: string,
): value is SupportedInvariantId {
  return SUPPORTED_INVARIANT_IDS.some((candidate) => candidate === value);
}

export function invariantSlug(invariantId: SupportedInvariantId): string {
  return invariantId === "TRANSFER_IDEMPOTENCY"
    ? "transfer-idempotency"
    : "idempotency-key-payload-binding";
}

export function invariantEvidencePaths(
  invariantId: SupportedInvariantId,
): InvariantEvidencePaths {
  const slug = invariantSlug(invariantId);
  const directory = `evidence/${slug}`;
  return {
    directory,
    counterexample: `${directory}/counterexample.json`,
    repairRequest: `${directory}/repair-request.json`,
    repairReport: `${directory}/repair-report.json`,
    repairDiff: `${directory}/repair.diff`,
    liveRepairRequest: `${directory}/live-repair-request.json`,
    liveRepairReport: `${directory}/live-repair-report.json`,
    liveRepairDiff: `${directory}/live-repair.diff`,
    recordedChangeSet: `${directory}/recorded-change-set.json`,
    repairEvidence: `${directory}/repair-evidence.json`,
    replayResult: `${directory}/replay-result.json`,
    verificationResult: `${directory}/verification-result.json`,
    passportJson: `${directory}/passport.json`,
    passportHtml: `${directory}/passport.html`,
    liveRepairBlocker: `${directory}/live-repair-blocker.json`,
    worktree: `.qedra/worktrees/${slug}`,
  };
}

export const EVIDENCE_SUMMARY_PATH = "evidence/summary.json" as const;
export const EVIDENCE_DASHBOARD_DIRECTORY = "evidence/dashboard" as const;
export const EVIDENCE_DASHBOARD_DATA_PATH =
  `${EVIDENCE_DASHBOARD_DIRECTORY}/data.json` as const;
export const EVIDENCE_DASHBOARD_HTML_PATH =
  `${EVIDENCE_DASHBOARD_DIRECTORY}/index.html` as const;
