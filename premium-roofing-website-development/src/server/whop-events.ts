import { getWhopClient, getWhopConfig } from "@/server/whop";

/**
 * Server-side forwarding of our three custom events to Whop's Events API.
 *
 * Docs: https://docs.whop.com/developer/ads/events-api
 * `client.events.create({ account_id, event_name, event_id, ... })`
 *
 * Why both channels?
 *  - `whop.track` (browser) attributes the visit to the pixel/visitor id and is
 *    what the Whop dashboard reports for website traffic.
 *  - This server call records the same conversion through the authenticated API,
 *    so each event is verifiable in the dashboard even if the pixel is blocked,
 *    self-hosted without the snippet, or the buyer has script blockers.
 * Both carry the SAME `event_id`, so Whop de-duplicates them into one event
 * (per Whop's "give each event an ID" guidance) instead of counting twice.
 */
export const TRACKED_EVENTS = ["estimate_requested", "service_viewed", "deposit_started"] as const;
export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

export interface ForwardResult {
  forwarded: boolean;
  error?: string;
}

interface ForwardInput {
  event: TrackedEvent;
  eventId: string;
  params?: Record<string, unknown>;
  path?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
}

/** Map our internal params onto the documented Events API user/context fields. */
function buildPayload(input: ForwardInput, accountId: string) {
  const p = input.params ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const email = str(p.email);

  const user: Record<string, string> = {};
  if (email) user.email = email;
  if (str(p.phone)) user.phone = str(p.phone) as string;
  if (str(p.name)) user.name = str(p.name) as string;
  if (str(p.postal_code)) user.postal_code = str(p.postal_code) as string;
  if (str(p.zip)) user.postal_code = str(p.zip) as string;
  user.city = "Austin";
  user.state = "TX";
  user.country = "US";

  const context: Record<string, string> = {};
  if (input.userAgent) context.user_agent = input.userAgent;
  if (input.referrer) context.referrer = input.referrer;

  return {
    account_id: accountId,
    // A custom event name is passed directly, per the Events API docs.
    event_name: input.event,
    event_id: input.eventId,
    event_time: new Date().toISOString(),
    action_source: "website",
    url: input.path
      ? `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://roofshield.pro"}${input.path}`
      : undefined,
    referrer_url: input.referrer ?? undefined,
    user: Object.keys(user).length > 0 ? user : undefined,
    context: Object.keys(context).length > 0 ? context : undefined,
    ...(typeof p.value === "number" ? { value: p.value } : {}),
    ...(str(p.currency) ? { currency: str(p.currency) as string } : {}),
  };
}

export async function forwardEventToWhop(input: ForwardInput): Promise<ForwardResult> {
  const { apiKey, accountId, baseUrl } = getWhopConfig();

  if (!apiKey || !accountId) {
    return { forwarded: false, error: "WHOP_NOT_CONFIGURED: WHOP_API_KEY / WHOP_ACCOUNT_ID missing" };
  }

  // NOTE: called directly rather than via the SDK, whose events client returns
  // 404 against the current API. The documented endpoint is POST /api/v1/events.
  try {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(input, accountId)),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        forwarded: false,
        error: `Whop Events API answered HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ""}`,
      };
    }
    return { forwarded: true };
  } catch (err) {
    const e = err as { message?: string };
    return { forwarded: false, error: e.message ?? "Network error forwarding event" };
  }
}

/** Read recent events back from Whop for the verification panel.
 *  The Events API requires `from`/`to` ISO timestamps when no identifier is
 *  supplied (verified live). Called directly for the same routing reason. */
export async function listWhopEvents(limit = 25) {
  const { apiKey, accountId, baseUrl } = getWhopConfig();
  if (!apiKey || !accountId) {
    return { ok: false as const, error: "WHOP_NOT_CONFIGURED", items: [] as WhopEventRow[] };
  }
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
    const url = new URL(`${baseUrl}/api/v1/events`);
    url.searchParams.set("account_id", accountId);
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", to.toISOString());
    url.searchParams.set("first", String(limit));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: Record<string, unknown>[]; error?: { message?: string } }
      | null;
    if (!res.ok) {
      return {
        ok: false as const,
        error: json?.error?.message ?? `HTTP ${res.status}`,
        items: [] as WhopEventRow[],
      };
    }
    const items = (json?.data ?? []).map((item) => ({
      id: String(item.id ?? ""),
      eventName: String(item.event_name ?? item.name ?? ""),
      eventId: item.event_id ? String(item.event_id) : null,
      occurredAt: String(item.inserted_at ?? item.event_time ?? item.created_at ?? ""),
    }));
    return { ok: true as const, error: null, items };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false as const, error: e.message ?? "Events list failed", items: [] as WhopEventRow[] };
  }
}

export interface WhopEventRow {
  id: string;
  eventName: string;
  eventId: string | null;
  occurredAt: string;
}

/** Confirm the captured lead really exists in the Whop account.
 *  Leads are now Members records (Leads API retired → 410 Gone). */
export async function retrieveWhopLead(leadId: string) {
  const { retrieveWhopMember } = await import("@/server/whop-members");
  const res = await retrieveWhopMember(leadId);
  if (!res.ok) return { ok: false as const, error: res.error };
  return { ok: true as const, id: res.id, createdAt: res.joinedAt, metadata: { email: res.email } };
}
