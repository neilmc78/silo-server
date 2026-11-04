import { V2ProblemError } from "@/api/v2/request";

export interface SecondFactorChallenge {
  challengeId: string;
  methods: string[];
}

/** Reads the second-step challenge a login refusal carries, if any. */
export function secondFactorChallengeOf(err: unknown): SecondFactorChallenge | null {
  if (!(err instanceof V2ProblemError) || err.problemType !== "second_factor_required") {
    return null;
  }
  const challengeId = err.headers.get("Silo-Second-Factor-Challenge") ?? "";
  if (!challengeId) return null;
  const methods = (err.headers.get("Silo-Second-Factor-Methods") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return { challengeId, methods };
}
