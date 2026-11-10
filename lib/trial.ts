export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** NULL means the account has ongoing access (including existing accounts). */
export function trialEndFrom(startMs: number): string {
  return new Date(startMs + TRIAL_DAYS * DAY_MS).toISOString();
}

export function isTrialExpired(trialEndsAt: string | null, nowMs = Date.now()): boolean {
  if (trialEndsAt === null) return false;
  const endMs = Date.parse(trialEndsAt);
  return !Number.isFinite(endMs) || nowMs >= endMs;
}

/** Extend from the later of the current expiry and now, preserving unused time. */
export function extendTrialByWeek(trialEndsAt: string, nowMs = Date.now()): string {
  const endMs = Date.parse(trialEndsAt);
  return trialEndFrom(Math.max(nowMs, Number.isFinite(endMs) ? endMs : nowMs));
}

/** Paid membership extends access independently of the original trial. */
export function accessEndsAt(trialEndsAt: string | null, paidEndsAt: string | null): string | null {
  if (trialEndsAt === null) return null;
  const trial = Date.parse(trialEndsAt);
  const paid = paidEndsAt ? Date.parse(paidEndsAt) : NaN;
  return Number.isFinite(paid) && (!Number.isFinite(trial) || paid > trial) ? paidEndsAt : trialEndsAt;
}
export function isAccessExpired(trialEndsAt: string | null, paidEndsAt: string | null, nowMs = Date.now()): boolean {
  return isTrialExpired(accessEndsAt(trialEndsAt, paidEndsAt), nowMs);
}
