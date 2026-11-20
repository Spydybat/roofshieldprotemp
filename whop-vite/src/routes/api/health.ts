import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";
import { getOptionalDb } from "@/db";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const db = getOptionalDb();
        if (!db) {
          return Response.json({
            ok: true,
            storage: "whop-api",
            databaseConfigured: false,
          });
        }

        try {
          await db.execute(sql`select 1`);
          return Response.json({
            ok: true,
            storage: "postgres",
            databaseConfigured: true,
          });
        } catch {
          return Response.json(
            { ok: false, storage: "postgres", databaseConfigured: true },
            { status: 500 },
          );
        }
      },
    },
  },
});
