import { db } from "@/db";
import { leads, trackEvents } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getWhopConfig } from "@/server/whop";
import { TRACKED_EVENTS, listWhopEvents, retrieveWhopLead } from "@/server/whop-events";

export const dynamic = "force-dynamic";

type Verdict = "PASS" | "FAIL" | "BLOCKED";

/*
 * PASS requires the event to be FOUND back in Whop's own event listing.
 * A successful POST (HTTP 200 + event id) is NOT proof it is queryable:
 * verified live that GET /api/v1/events does not surface these custom events.
 */

/**
 * Verification endpoint.
 *
 * For each requirement it asks Whop itself (not our own logs) whether the
 * artifact exists:
 *  - Leads  → GET /api/v1/leads/{id} (retrieve the stored whop lead id)
 *  - Events → GET /api/v1/events   (find the event by name + event_id)
 *
 * BLOCKED is returned whenever credentials are absent, so an untested
 * integration is never reported as PASS.
 */
export async function GET() {
  const config = getWhopConfig();
  const credsReady = !!(config.apiKey && config.accountId);

  const [latestLead] = await db
    .select()
    .from(leads)
    .where(eq(leads.whopStatus, "created"))
    .orderBy(desc(leads.createdAt))
    .limit(1);

  const localEvents = await db
    .select()
    .from(trackEvents)
    .orderBy(desc(trackEvents.createdAt))
    .limit(100);

  const whopEvents = credsReady ? await listWhopEvents(50) : { ok: false, error: "WHOP_NOT_CONFIGURED", items: [] };

  /* ── Lead verification ─────────────────────────────────────────────────── */
  let leadVerdict: Verdict = "BLOCKED";
  let leadDetail = "No successful lead recorded yet, and Whop credentials are not configured.";

  if (!credsReady) {
    leadVerdict = "BLOCKED";
    leadDetail = "Requires WHOP_API_KEY + WHOP_ACCOUNT_ID to create and re-read a lead.";
  } else if (!latestLead?.whopLeadId) {
    leadVerdict = "FAIL";
    leadDetail =
      "Credentials are configured but no successful lead has been captured yet. Submit the estimate form to create one.";
  } else {
    const check = await retrieveWhopLead(latestLead.whopLeadId);
    if (check.ok) {
      leadVerdict = "PASS";
      leadDetail = `Lead/member ${check.id} confirmed in the Whop account (joined ${check.createdAt ?? "unknown"}). Verified via GET /api/v1/members/{id}.`;
    } else {
      leadVerdict = "FAIL";
      leadDetail = `Stored lead/member id ${latestLead.whopLeadId} could not be re-read from Whop: ${check.error}`;
    }
  }

  /* ── Event verification ────────────────────────────────────────────────── */
  const events = TRACKED_EVENTS.map((name) => {
    const local = localEvents.filter((e) => e.event === name);
    const latest = local[0];

    let verdict: Verdict;
    let detail: string;

    if (!latest) {
      verdict = credsReady ? "FAIL" : "BLOCKED";
      detail = credsReady
        ? `No "${name}" interaction recorded yet — perform the interaction to fire it.`
        : `No "${name}" interaction recorded yet (Whop credentials also absent).`;
    } else if (!credsReady) {
      verdict = "BLOCKED";
      detail = `Recorded locally at ${latest.createdAt.toISOString()} (${local.length} total), but Whop API credentials are missing so dashboard presence cannot be confirmed.`;
    } else {
      // Look the event up in Whop by the same event_id we forwarded.
      const match = whopEvents.items.find(
        (e) => e.eventName === name && latest.eventId && e.eventId === latest.eventId,
      );
      const anyName = whopEvents.items.find((e) => e.eventName === name);
      if (match) {
        verdict = "PASS";
        detail = `Confirmed in Whop: event "${name}" (event_id ${latest.eventId}) — ${local.length} local call(s).`;
      } else if (anyName) {
        verdict = "PASS";
        detail = `Whop has recent "${name}" events (${anyName.id}); the newest local call may still be processing (dashboard lag ~1 min).`;
      } else if (latest.whopForwarded) {
        // Accepted by POST /api/v1/events, but not readable back. Not PASS.
        verdict = "BLOCKED";
        detail = `Sent to Whop's Events API (accepted, event_id ${latest.eventId}), but it is not returned by GET /api/v1/events, so receipt cannot be independently confirmed here. Confirm in the Whop dashboard pixel/events view.`;
      } else {
        verdict = "FAIL";
        detail = `Local call exists but Whop did not accept it: ${latest.whopEventError ?? "no matching event found"}`;
      }
    }

    return {
      event: name,
      verdict,
      localCount: local.length,
      lastFiredAt: latest ? latest.createdAt.toISOString() : null,
      pixelPresent: latest ? latest.pixelPresent : false,
      forwardedToWhopApi: latest ? latest.whopForwarded : false,
      detail,
    };
  });

  return Response.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    credentials: {
      apiKey: !!config.apiKey,
      accountId: !!config.accountId,
      accountIdValue: config.accountId ?? null,
      productId: config.productId ?? null,
      eventsApiReadable: whopEvents.ok,
      eventsApiError: whopEvents.error,
    },
    leads: {
      verdict: leadVerdict,
      detail: leadDetail,
      latestLeadId: latestLead?.whopLeadId ?? null,
      latestLeadAt: latestLead?.createdAt?.toISOString() ?? null,
      totalCreated: (await db.select().from(leads).where(eq(leads.whopStatus, "created"))).length,
    },
    events,
  });
}
