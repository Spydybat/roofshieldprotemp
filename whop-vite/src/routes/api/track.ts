import { createFileRoute } from "@tanstack/react-router";
import { getOptionalDb } from "@/db";
import { trackEvents } from "@/db/schema";
import { TRACKED_EVENTS, forwardEventToWhop, type TrackedEvent } from "@/server/whop-events";

const ALLOWED = new Set<string>(TRACKED_EVENTS);

export const Route = createFileRoute("/api/track")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            event?: string;
            params?: Record<string, unknown>;
            eventId?: string;
            pixelPresent?: boolean;
            path?: string;
          };

          if (!body.event || typeof body.event !== "string" || body.event.length > 250) {
            return Response.json({ ok: false, code: "BAD_EVENT" }, { status: 400 });
          }
          if (!ALLOWED.has(body.event)) {
            return Response.json(
              { ok: false, code: "UNKNOWN_EVENT", allowed: [...ALLOWED] },
              { status: 422 },
            );
          }

          const event = body.event as TrackedEvent;
          const eventId =
            body.eventId && body.eventId.length > 0
              ? body.eventId
              : (globalThis.crypto?.randomUUID?.() ??
                `${Date.now()}-${Math.random().toString(36).slice(2)}`);

          const forwarded = await forwardEventToWhop({
            event,
            eventId,
            params: body.params,
            path: body.path ?? null,
            referrer: request.headers.get("referer"),
            userAgent: request.headers.get("user-agent"),
          });

          const db = getOptionalDb();
          if (db) {
            await db.insert(trackEvents).values({
              event,
              params: body.params ?? {},
              eventId,
              pixelPresent: !!body.pixelPresent,
              path: body.path ?? null,
              whopForwarded: forwarded.forwarded,
              whopEventError: forwarded.error ?? null,
            });
          }

          return Response.json({
            ok: true,
            eventId,
            pixelPresent: !!body.pixelPresent,
            forwardedToWhopApi: forwarded.forwarded,
            persistedLocally: !!db,
            ...(forwarded.error ? { forwardError: forwarded.error } : {}),
          });
        } catch {
          return Response.json({ ok: false, code: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});
