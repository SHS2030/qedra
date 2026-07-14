export const ExitCode = {
  SUCCESS: 0,
  VIOLATION_CONFIRMED: 10,
  USAGE_OR_CONFIGURATION: 20,
  EXECUTION_FAILED: 30,
  LIVE_REPAIR_BLOCKED: 40,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
