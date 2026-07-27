import type { Me } from "../_shared/index.js";
import type { Progress } from "./types.js";

/**
 * Participant onboarding progress — trivial by design (a single-step PATCH, no derived
 * multi-step state). Completion is simply "holds the PARTICIPANT role" — the
 * authoritative signal, read from Core `/users/me` `roles` (never from currentRole, which is
 * bff session state and irrelevant here). `type` is read from the participant profile
 * (Profile Contract v2 — neither `/users/me` nor the bff `/userinfo` carries
 * `participantType`; null when there's no participant profile yet). Same shape as the
 * guide branch so the single front-end entry can render both uniformly.
 */
export function participantProgress(me: Me, participantType: string | null): Progress {
  const complete = me.roles?.includes("PARTICIPANT") ?? false;
  return {
    role: "participant",
    started: complete || participantType !== null,
    complete,
    canSubmit: !complete,
    guideStatus: null,
    verificationStatus: null,
    steps: [{ key: "profile", label: "Your details", done: complete }],
  };
}
