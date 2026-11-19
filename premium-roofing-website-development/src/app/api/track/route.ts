import { db } from "@/db";
import { trackEvents } from "@/db/schema";
import { TRACKED_EVENTS, forwardEventToWhop, type TrackedEvent } from "@/server/whop-events";

export const dynamic = "force-dynamic";

const ALLOWED = new Set<string>(TRACKED_EVENTS);

/**
 * Durable server-side record of the three custom events, plus forwarding to
 * Whop's server-side Events API so every event is verifiable in the Whop
 * dashboard even without the browser pixel.
 */
export async function POST(request: Request) {
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
      return Response.json({ ok: false, code: "UNKNOWN_EVENT", allowed: [...ALLOWED] }, { status: 422 });
    }

    const event = body.event as TrackedEvent;
    const eventId =
      body.eventId && body.eventId.length > 0
        ? body.eventId
        : (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    const forwarded = await forwardEventToWhop({
      event,
      eventId,
      params: body.params,
      path: body.path ?? null,
      referrer: request.headers.get("referer"),
      userAgent: request.headers.get("user-agent"),
    });

    await db.insert(trackEvents).values({
      event,
      params: body.params ?? {},
      eventId,
      pixelPresent: !!body.pixelPresent,
      path: body.path ?? null,
      whopForwarded: forwarded.forwarded,
      whopEventError: forwarded.error ?? null,
    });

    return Response.json({
      ok: true,
      eventId,
      pixelPresent: !!body.pixelPresent,
      forwardedToWhopApi: forwarded.forwarded,
      ...(forwarded.error ? { forwardError: forwarded.error } : {}),
    });
  } catch {
    return Response.json({ ok: false, code: "SERVER_ERROR" }, { status: 500 });
  }
}
