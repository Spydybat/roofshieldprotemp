import { getWhopConfig } from "@/server/whop";

/**
 * Whop "lead" capture — current official implementation.
 *
 * IMPORTANT PLATFORM CHANGE (verified live):
 *   POST /api/v1/leads  →  HTTP 410 Gone
 *   "Creating leads is no longer available. To add someone who hasn't bought
 *    anything yet, call POST /api/v1/members with {email, name}."
 *
 * The Leads API is deprecated/removed by Whop. The documented replacement is the
 * Members API, which creates a `mber_…` record with no access (the equivalent of
 * a lead). Old lead IDs are preserved by Whop on the member's metadata as
 * `lead_id`, per the API's own migration notice.
 *
 * The @whop/sdk exposes only members.list/retrieve (no create), so the
 * documented endpoint is called directly here with the same bearer auth.
 *
 * NOTE: `metadata` is rejected by this endpoint ("Unsupported fields:
 * metadata"), so the full estimate payload is persisted in our own `leads`
 * table and linked by the returned member id.
 */

export interface CreatedWhopMember {
  id: string;
  email: string | null;
  name: string | null;
}

function authHeaders(): Record<string, string> | null {
  const { apiKey } = getWhopConfig();
  if (!apiKey) return null;
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function errorMessage(status: number, body: unknown): string {
  const b = body as { error?: { message?: string }; message?: string; detail?: string } | null;
  return (
    b?.error?.message ??
    b?.message ??
    b?.detail ??
    `Whop API answered HTTP ${status}`
  );
}

export async function createWhopMember(input: {
  email: string;
  name: string;
}): Promise<{ ok: true; member: CreatedWhopMember } | { ok: false; code: string; message: string }> {
  const { accountId, baseUrl } = getWhopConfig();
  const headers = authHeaders();
  if (!headers || !accountId) {
    return {
      ok: false,
      code: "WHOP_NOT_CONFIGURED",
      message: "WHOP_API_KEY or WHOP_ACCOUNT_ID is not configured",
    };
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/members`, {
      method: "POST",
      headers,
      body: JSON.stringify({ account_id: accountId, email: input.email, name: input.name }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => null)) as
      | { id?: string; email?: string; name?: string }
      | null;

    if (!res.ok || !json?.id) {
      return { ok: false, code: "WHOP_API_ERROR", message: errorMessage(res.status, json) };
    }
    return {
      ok: true,
      member: { id: json.id, email: json.email ?? null, name: json.name ?? null },
    };
  } catch (err) {
    return {
      ok: false,
      code: "WHOP_NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Network error contacting Whop",
    };
  }
}

export async function retrieveWhopMember(
  memberId: string,
): Promise<
  | { ok: true; id: string; email: string | null; joinedAt: string | null }
  | { ok: false; error: string }
> {
  const { baseUrl } = getWhopConfig();
  const headers = authHeaders();
  if (!headers) return { ok: false, error: "WHOP_API_KEY is not configured" };

  try {
    const res = await fetch(`${baseUrl}/api/v1/members/${encodeURIComponent(memberId)}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => null)) as
      | { id?: string; email?: string; joined_at?: string }
      | null;
    if (!res.ok || !json?.id) return { ok: false, error: errorMessage(res.status, json) };
    return { ok: true, id: json.id, email: json.email ?? null, joinedAt: json.joined_at ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}
