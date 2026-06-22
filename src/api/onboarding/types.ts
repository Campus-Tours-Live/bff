/** Uniform onboarding-progress shape returned for either role. */
export interface Progress {
  role: "guide" | "participant";
  started: boolean;
  complete: boolean;
  canSubmit: boolean;
  applicationStatus: string | null;
  verificationStatus: string | null;
  steps: { key: string; label: string; done: boolean }[];
}
