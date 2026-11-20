import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";
import { getOptionalDb } from "@/db";
import { leads, trackEvents } from "@/db/schema";
import { getWhopConfig } from "@/server/whop";
import { TRACKED_EVENTS, listWhopEvents, retrieveWhopLead } from "@/server/whop-events";
import { listWhopMembers } from "@/server/whop-members";

type Verdict = "PASS" | "FAIL" | "BLOCKED";

export const Route = createFileRoute("/api/verify")({
  server: {
    handlers: {
      GET: async () => {
        const config = getWhopConfig();
        const credsReady = !!(config.apiKey && config.accountId);
        const db = getOptionalDb();

        let latestLeadId: string | null = null;
        let latestLeadAt: string | null = null;
        let totalCreated = 0;
        let localEvents: Array<{
          event: string;
          eventId: string | null;
          pixelPresent: boolean;
          whopForwarded: boolean;
          whopEventError: string | null;
          createdAt: Date;
        }> = [];

        if (db) {
          try {
            const [latestLead] = await db
              .select()
              .from(leads)
              .where(eq(leads.whopStatus, "created"))
              .orderBy(desc(leads.createdAt))
              .limit(1);
            latestLeadId = latestLead?.whopLeadId ?? null;
            latestLeadAt = latestLead?.createdAt
              ? new Date(latestLead.createdAt).toISOString()
              : null;
            totalCreated = (
              await db.select().from(leads).where(eq(leads.whopStatus, "created"))
            ).length;
            localEvents = await db
              .select()
              .from(trackEvents)
              .orderBy(desc(trackEvents.createdAt))
              .limit(100);
          } catch {
            // Optional Postgres tables may not be migrated yet — fall back to live Whop API reads
          }
        }

        const whopMembers = credsReady
          ? await listWhopMembers(25)
          : { ok: false, error: "WHOP_NOT_CONFIGURED", items: [] };

        if (!latestLeadId && whopMembers.ok && whopMembers.items.length > 0) {
          const latestMember = whopMembers.items[0];
          latestLeadId = latestMember.id;
          latestLeadAt = latestMember.joinedAt;
          totalCreated = whopMembers.items.length;
        }

        const whopEvents = credsReady
          ? await listWhopEvents(50)
          : { ok: false, error: "WHOP_NOT_CONFIGURED", items: [] };

        let leadVerdict: Verdict = "BLOCKED";
        let leadDetail = "No member/enquiry recorded yet, and WHOP_API_KEY is not configured.";

        if (!credsReady) {
          leadVerdict = "BLOCKED";
          leadDetail = "Requires WHOP_API_KEY to create and verify members/enquiries in Whop.";
        } else if (!latestLeadId) {
          leadVerdict = "FAIL";
          leadDetail =
            "Credentials are configured but no customer member/enquiry exists yet. Submit the estimate form to create one.";
        } else {
          const check = await retrieveWhopLead(latestLeadId);
          if (check.ok) {
            leadVerdict = "PASS";
            leadDetail = `Member ${check.id} confirmed in Whop account ${config.accountId} (joined ${check.createdAt ?? "unknown"}). Verified via GET /api/v1/members/{id}.`;
          } else {
            leadVerdict = "FAIL";
            leadDetail = `Member ID ${latestLeadId} could not be re-read from Whop: ${check.error}`;
          }
        }

        const events = TRACKED_EVENTS.map((name) => {
          const local = localEvents.filter((e) => e.event === name);
          const latest = local[0];
          const anyName = whopEvents.items.find((e) => e.eventName === name);

          let verdict: Verdict;
          let detail: string;

          if (!credsReady) {
            verdict = "BLOCKED";
            detail = latest
              ? `Recorded in PostgreSQL at ${new Date(latest.createdAt).toISOString()} (${local.length} total), but WHOP_API_KEY is missing.`
              : `WHOP_API_KEY is not configured; cannot verify "${name}" in Whop Events API.`;
          } else if (anyName) {
            verdict = "PASS";
            detail = `Confirmed in Whop Events API: "${name}" (${anyName.id})${local.length ? ` · ${local.length} local SQL log(s)` : ""}.`;
          } else if (latest) {
            const match = whopEvents.items.find(
              (e) => e.eventName === name && latest.eventId && e.eventId === latest.eventId,
            );
            if (match) {
              verdict = "PASS";
              detail = `Confirmed in Whop: event "${name}" (event_id ${latest.eventId}) — ${local.length} local call(s).`;
            } else if (latest.whopForwarded) {
              verdict = "BLOCKED";
              detail = `Sent to Whop Events API (accepted, event_id ${latest.eventId}), but not returned by GET /api/v1/events. Confirm in the Whop dashboard pixel/events view.`;
            } else {
              verdict = "FAIL";
              detail = `Local call exists but Whop did not accept it: ${latest.whopEventError ?? "no matching event found"}`;
            }
          } else {
            verdict = db ? "FAIL" : "BLOCKED";
            detail = db
              ? `No "${name}" interaction recorded yet — perform the interaction to fire it.`
              : `No "${name}" event returned by GET /api/v1/events (and DATABASE_URL is not configured for local SQL mirroring). Server-side forwarding to POST /api/v1/events is active.`;
          }

          return {
            event: name,
            verdict,
            localCount: local.length,
            lastFiredAt: latest
              ? new Date(latest.createdAt).toISOString()
              : anyName?.occurredAt ?? null,
            pixelPresent: latest ? latest.pixelPresent : false,
            forwardedToWhopApi: latest ? latest.whopForwarded : !!anyName,
            detail,
          };
        });

        return Response.json({
          ok: true,
          checkedAt: new Date().toISOString(),
          storageMode: db ? "whop-api+postgres" : "whop-api",
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
            latestLeadId,
            latestLeadAt,
            totalCreated,
          },
          events,
        });
      },
    },
  },
});
