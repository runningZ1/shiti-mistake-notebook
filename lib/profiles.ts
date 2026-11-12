import { cookies } from "next/headers";
import { query } from "@/db/client";

export const PROFILE_COOKIE = "shiti_profile";
export type LearningProfile = { id: string; userId: string; name: string; gradeLevel: string; isDefault: boolean; createdAt: string };
const columns = 'id, user_id AS "userId", name, grade_level AS "gradeLevel", is_default AS "isDefault", created_at AS "createdAt"';

export class ProfileAccessError extends Error {
  constructor() { super("当前学习档案不可用，请重新选择档案"); }
}

export async function ensureDefaultProfile(userId: string): Promise<LearningProfile> {
  const existing = await query<LearningProfile>(`SELECT ${columns} FROM learning_profiles WHERE user_id = $1 AND is_default`, [userId]);
  if (existing.rows[0]) return existing.rows[0];
  const { rows } = await query<LearningProfile>(`INSERT INTO learning_profiles (id, user_id, name, is_default)
    VALUES ($1, $2, '默认档案', true) ON CONFLICT (user_id) WHERE is_default
    DO UPDATE SET is_default = true RETURNING ${columns}`, [`default:${userId}`, userId]);
  return rows[0];
}

export async function validateProfile(userId: string, profileId: string): Promise<LearningProfile> {
  if (!profileId || profileId.length > 256) throw new ProfileAccessError();
  const { rows } = await query<LearningProfile>(`SELECT ${columns} FROM learning_profiles WHERE id = $1 AND user_id = $2`, [profileId, userId]);
  if (!rows[0]) throw new ProfileAccessError();
  return rows[0];
}

/** Explicit IDs are for trusted server tasks; always verify account ownership. Never accept an unchecked client ID. */
export async function requireProfile(userId: string, fixedProfileId?: string): Promise<LearningProfile> {
  const selected = fixedProfileId ?? (await cookies()).get(PROFILE_COOKIE)?.value;
  if (selected !== undefined) return validateProfile(userId, selected);
  return ensureDefaultProfile(userId);
}

export async function listProfiles(userId: string): Promise<LearningProfile[]> {
  await ensureDefaultProfile(userId);
  const { rows } = await query<LearningProfile>(`SELECT ${columns} FROM learning_profiles WHERE user_id = $1 ORDER BY is_default DESC, created_at, id`, [userId]);
  return rows;
}

export function parseProfileInput(body: unknown): { name: string; gradeLevel: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const data = body as Record<string, unknown>;
  if (Object.keys(data).some(key => key !== "name" && key !== "gradeLevel")) return null;
  if (typeof data.name !== "string" || (data.gradeLevel !== undefined && typeof data.gradeLevel !== "string")) return null;
  const name = data.name.trim();
  const gradeLevel = typeof data.gradeLevel === "string" ? data.gradeLevel.trim() : "";
  return name && [...name].length <= 40 && [...gradeLevel].length <= 30 ? { name, gradeLevel } : null;
}

export async function createProfile(userId: string, input: { name: string; gradeLevel: string }): Promise<LearningProfile> {
  const { rows } = await query<LearningProfile>(`INSERT INTO learning_profiles (id, user_id, name, grade_level) VALUES ($1,$2,$3,$4) RETURNING ${columns}`,
    [crypto.randomUUID(), userId, input.name, input.gradeLevel]);
  return rows[0];
}

export async function updateProfile(userId: string, id: string, input: { name: string; gradeLevel: string }): Promise<LearningProfile | null> {
  const { rows } = await query<LearningProfile>(`UPDATE learning_profiles SET name = $3, grade_level = $4 WHERE id = $1 AND user_id = $2 RETURNING ${columns}`,
    [id, userId, input.name, input.gradeLevel]);
  return rows[0] ?? null;
}
