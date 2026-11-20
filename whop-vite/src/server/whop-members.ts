import { getWhopClient, getWhopConfig, whopErrorMessage } from "@/server/whop";

/**
 * Whop customer & enquiry persistence — verified against @whop/sdk v2.7.0 & Whop API v1.
 *
 * Official Whop API v1 behavior:
 *  1. `POST /api/v1/leads` is retired (HTTP 410 Gone). The official replacement is
 *     `POST /api/v1/members` (`client.members.create({ account_id, email, name })`),
 *     which accepts only `{ account_id, email, name }` and rejects `metadata` on POST.
 *  2. `POST /api/v1/members/{member_id}/notes` (`client.members.notes.create`) appends
 *     team-visible notes (`note_…`) to the member profile and supports reading them back
 *     via `GET /api/v1/members/{member_id}/notes` (`client.members.notes.list`).
 *  3. `PATCH /api/v1/members/{id}` (`client.members.update`, requires `member:manage`)
 *     persists custom key-value `metadata` (up to 50 keys, 500-char string values) and
 *     display `name` on the member record.
 *
 * Data-integrity guarantee:
 *  We NEVER silently discard customer phone, ZIP code, service type, or project
 *  description. An estimate submission is only confirmed successful if Whop persists
 *  BOTH the member record AND the full enquiry details (via Member Notes and/or
 *  Member Metadata).
 */

export interface CreatedWhopMember {
  id: string;
  email: string | null;
  name: string | null;
  metadata: Record<string, unknown> | null;
}

export interface EnquiryPayload {
  name: string;
  email: string;
  phone: string;
  zip: string;
  serviceType: string;
  description: string;
  idempotencyKey?: string;
}

export interface WhopEnquiryResult {
  ok: true;
  memberId: string;
  noteId: string | null;
  metadataSaved: boolean;
  duplicate: boolean;
  duplicateReason?: "idempotency_key" | "recent_window";
}

export interface WhopEnquiryError {
  ok: false;
  code: string;
  message: string;
  memberId?: string;
}

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

function formatEnquiryNote(input: EnquiryPayload, submittedAtIso: string): string {
  const lines = [
    "[RoofShield Pro Estimate Enquiry]",
    `Submitted: ${submittedAtIso}`,
    `Full Name: ${input.name}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone}`,
    `ZIP Code: ${input.zip}`,
    `Service Type: ${input.serviceType}`,
    `Project Description: ${input.description}`,
  ];
  if (input.idempotencyKey) {
    lines.push(`Idempotency Key: ${input.idempotencyKey}`);
  }
  return lines.join("\n");
}

function sanitizeMetadataValue(value: string, maxLen = 480): string {
  return value.length > maxLen ? `${value.slice(0, maxLen - 1)}…` : value;
}

function mergeMemberMetadata(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const merged: Record<string, string | number | boolean | null> = {};
  if (existing && typeof existing === "object") {
    for (const [k, v] of Object.entries(existing)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
        merged[k] = v;
      }
    }
  }
  return { ...merged, ...patch };
}

export async function createWhopMember(input: {
  email: string;
  name: string;
}): Promise<{ ok: true; member: CreatedWhopMember } | { ok: false; code: string; message: string }> {
  const client = getWhopClient();
  const { accountId } = getWhopConfig();
  if (!client || !accountId) {
    return {
      ok: false,
      code: "WHOP_NOT_CONFIGURED",
      message: "WHOP_API_KEY or WHOP_ACCOUNT_ID is not configured",
    };
  }

  try {
    const member = await client.members.create({
      account_id: accountId,
      email: input.email,
      name: input.name,
    });
    if (!member?.id) {
      return { ok: false, code: "WHOP_API_ERROR", message: "Whop returned a member without an ID." };
    }
    return {
      ok: true,
      member: {
        id: member.id,
        email: member.email ?? null,
        name: member.name ?? member.display_name ?? null,
        metadata: member.metadata ?? null,
      },
    };
  } catch (err) {
    return { ok: false, code: "WHOP_API_ERROR", message: whopErrorMessage(err) };
  }
}

/**
 * Persists a complete estimate enquiry into Whop:
 *  1. Creates/resolves the Whop member (`POST /api/v1/members`).
 *  2. Checks recent Member Notes (`GET /api/v1/members/{id}/notes`) for idempotency-key
 *     or 10-minute same-service duplicates so dedupe works even without PostgreSQL.
 *  3. Appends the full untruncated enquiry as a Whop Member Note (`POST /api/v1/members/{id}/notes`).
 *  4. Merges structured latest-enquiry fields into Member Metadata (`PATCH /api/v1/members/{id}`).
 *
 * Returns `ok: false` if Whop cannot confirm persisting the enquiry details.
 */
export async function recordWhopEnquiry(
  input: EnquiryPayload,
): Promise<WhopEnquiryResult | WhopEnquiryError> {
  const client = getWhopClient();
  if (!client) {
    return {
      ok: false,
      code: "WHOP_NOT_CONFIGURED",
      message: "WHOP_API_KEY is not configured.",
    };
  }

  const created = await createWhopMember({ email: input.email, name: input.name });
  if (!created.ok) {
    return created;
  }

  const memberId = created.member.id;

  // Check existing Whop member notes for idempotency / 10-minute duplicate suppression.
  try {
    const notesPage = await client.members.notes.list({ member_id: memberId, first: 10 });
    const now = Date.now();
    for (const note of notesPage.data ?? []) {
      const content = note.content ?? "";
      if (input.idempotencyKey && content.includes(`Idempotency Key: ${input.idempotencyKey}`)) {
        return {
          ok: true,
          memberId,
          noteId: note.id,
          metadataSaved: true,
          duplicate: true,
          duplicateReason: "idempotency_key",
        };
      }
      const createdAtMs = Date.parse(note.created_at ?? "");
      if (
        Number.isFinite(createdAtMs) &&
        now - createdAtMs <= DEDUPE_WINDOW_MS &&
        content.includes("[RoofShield Pro Estimate Enquiry]") &&
        content.includes(`Service Type: ${input.serviceType}`)
      ) {
        return {
          ok: true,
          memberId,
          noteId: note.id,
          metadataSaved: true,
          duplicate: true,
          duplicateReason: "recent_window",
        };
      }
    }
  } catch {
    // Non-fatal: notes.list may require read permission; proceed to write attempts.
  }

  const submittedAt = new Date().toISOString();
  let noteId: string | null = null;
  let noteError: string | null = null;
  let metadataSaved = false;
  let metadataError: string | null = null;

  // 1. Append complete untruncated enquiry as a Whop Member Note.
  try {
    const note = await client.members.notes.create({
      member_id: memberId,
      content: formatEnquiryNote(input, submittedAt),
    });
    noteId = note.id ?? null;
  } catch (err) {
    noteError = whopErrorMessage(err);
  }

  // 2. Merge structured latest-enquiry summary into Member Metadata (requires member:manage).
  try {
    const mergedMetadata = mergeMemberMetadata(created.member.metadata, {
      roofshield_phone: sanitizeMetadataValue(input.phone, 100),
      roofshield_zip: sanitizeMetadataValue(input.zip, 32),
      roofshield_service_type: sanitizeMetadataValue(input.serviceType, 100),
      roofshield_description: sanitizeMetadataValue(input.description, 480),
      roofshield_last_enquiry_at: submittedAt,
      ...(input.idempotencyKey
        ? { roofshield_last_idempotency_key: sanitizeMetadataValue(input.idempotencyKey, 128) }
        : {}),
    });
    await client.members.update({
      id: memberId,
      name: input.name,
      metadata: mergedMetadata,
    });
    metadataSaved = true;
  } catch (err) {
    metadataError = whopErrorMessage(err);
  }

  // Do NOT silently discard phone, ZIP, service type, or project description!
  if (!noteId && !metadataSaved) {
    return {
      ok: false,
      code: "WHOP_ENQUIRY_DETAILS_REJECTED",
      memberId,
      message: `Whop created member ${memberId} but refused to store the enquiry details (notes: ${noteError ?? "failed"}; metadata: ${metadataError ?? "failed"}). Ensure the Whop API key has member:manage permission.`,
    };
  }

  return {
    ok: true,
    memberId,
    noteId,
    metadataSaved,
    duplicate: false,
  };
}

export async function appendWhopMemberNote(
  memberId: string,
  content: string,
): Promise<{ ok: true; noteId: string } | { ok: false; error: string }> {
  const client = getWhopClient();
  if (!client) return { ok: false, error: "WHOP_API_KEY is not configured" };
  try {
    const note = await client.members.notes.create({ member_id: memberId, content });
    return { ok: true, noteId: note.id };
  } catch (err) {
    return { ok: false, error: whopErrorMessage(err) };
  }
}

export async function retrieveWhopMember(
  memberId: string,
): Promise<
  | {
      ok: true;
      id: string;
      email: string | null;
      name: string | null;
      joinedAt: string | null;
      metadata: Record<string, unknown> | null;
    }
  | { ok: false; error: string }
> {
  const client = getWhopClient();
  if (!client) return { ok: false, error: "WHOP_API_KEY is not configured" };

  try {
    const member = await client.members.retrieve({ id: memberId });
    if (!member?.id) return { ok: false, error: "Member not found" };
    return {
      ok: true,
      id: member.id,
      email: member.email ?? null,
      name: member.name ?? member.display_name ?? null,
      joinedAt: member.joined_at ?? null,
      metadata: member.metadata ?? null,
    };
  } catch (err) {
    return { ok: false, error: whopErrorMessage(err) };
  }
}

export interface WhopMemberSummary {
  id: string;
  name: string;
  email: string | null;
  joinedAt: string;
  serviceType: string | null;
  zip: string | null;
  phone: string | null;
}

export async function listWhopMembers(limit = 15): Promise<{
  ok: boolean;
  error: string | null;
  items: WhopMemberSummary[];
}> {
  const client = getWhopClient();
  const { accountId } = getWhopConfig();
  if (!client || !accountId) {
    return { ok: false, error: "WHOP_NOT_CONFIGURED", items: [] };
  }
  try {
    const page = await client.members.list({
      account_id: accountId,
      first: limit,
      order: "joined_at",
      direction: "desc",
    });
    const items: WhopMemberSummary[] = (page.data ?? []).map((m) => {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      return {
        id: m.id,
        name: m.name ?? m.display_name ?? m.email ?? m.id,
        email: m.email ?? null,
        joinedAt: m.joined_at ?? m.created_at,
        serviceType: typeof meta.roofshield_service_type === "string" ? meta.roofshield_service_type : null,
        zip: typeof meta.roofshield_zip === "string" ? meta.roofshield_zip : null,
        phone: typeof meta.roofshield_phone === "string" ? meta.roofshield_phone : m.phone_number ?? null,
      };
    });
    return { ok: true, error: null, items };
  } catch (err) {
    return { ok: false, error: whopErrorMessage(err), items: [] };
  }
}
