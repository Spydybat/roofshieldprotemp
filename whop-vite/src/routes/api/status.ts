import { createFileRoute } from "@tanstack/react-router";
import { pingWhopApi, whopConfigReport } from "@/server/whop";

export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: async () => {
        const config = whopConfigReport();
        const api = config.apiKey
          ? await pingWhopApi()
          : { ok: false, detail: "WHOP_API_KEY is not set" };
        return Response.json({ ok: true, config, api });
      },
    },
  },
});
