import { pingWhopApi, whopConfigReport } from "@/server/whop";

export const dynamic = "force-dynamic";

/** Public, safe integration status used by the /status verification page. */
export async function GET() {
  const config = whopConfigReport();
  const api = config.apiKey ? await pingWhopApi() : { ok: false, detail: "WHOP_API_KEY is not set" };
  return Response.json({ ok: true, config, api });
}
