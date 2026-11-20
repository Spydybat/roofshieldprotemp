import { WhopClient } from "@whop/sdk";
import { isDatabaseConfigured } from "@/db";

/**
 * Server-only Whop integration layer (Cloudflare Workers + Node compatible).
 *
 * Every function degrades honestly: when credentials are missing the caller
 * receives a structured `WHOP_NOT_CONFIGURED` result instead of a simulated
 * success. Secrets never leave the server.
 *
 * Non-secret RoofShield Pro resource IDs default to the verified existing
 * Whop account, app, product, and plans so no duplicate resources are created.
 * Every value remains overridable via environment variables (e.g. for sandbox).
 */

export const DEFAULT_WHOP_IDS = {
  appId: "app_S6fj7hfqepepH7",
  accountId: "biz_lxqAjXbJU7oXsW",
  productId: "prod_JcPSxmwZ2hCW2",
  planInspection: "plan_1NofJFeDJT8Gk",
  planDeposit: "plan_8TyOecSfZ12wC",
  planGutter: "plan_ca358aTAVQPVM",
  siteUrl: "https://nsx7uzgd3bm3glyw0bc8.apps.whop.com",
} as const;

export interface WhopConfig {
  apiKey?: string;
  accountId: string;
  appId: string;
  productId: string;
  baseUrl: string;
  webhookSecret?: string;
  adminToken?: string;
  environment: "production" | "sandbox";
  pixelSrc?: string;
  siteUrl: string;
  plans: { inspection: string; deposit: string; gutter: string };
}

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

export function getWhopConfig(): WhopConfig {
  const whopEnv = readEnv("VITE_WHOP_ENV") ?? readEnv("NEXT_PUBLIC_WHOP_ENV");
  return {
    apiKey: readEnv("WHOP_API_KEY"),
    accountId: readEnv("WHOP_ACCOUNT_ID") ?? DEFAULT_WHOP_IDS.accountId,
    appId: readEnv("VITE_WHOP_APP_ID") ?? readEnv("NEXT_PUBLIC_WHOP_APP_ID") ?? DEFAULT_WHOP_IDS.appId,
    productId: readEnv("WHOP_PRODUCT_ID") ?? DEFAULT_WHOP_IDS.productId,
    baseUrl: readEnv("WHOP_API_BASE_URL") ?? "https://api.whop.com",
    webhookSecret: readEnv("WHOP_WEBHOOK_SECRET"),
    adminToken: readEnv("ADMIN_TOKEN"),
    environment: whopEnv === "sandbox" ? "sandbox" : "production",
    pixelSrc: readEnv("VITE_WHOP_PIXEL_SRC") ?? readEnv("NEXT_PUBLIC_WHOP_PIXEL_SRC"),
    siteUrl:
      readEnv("VITE_SITE_URL") ??
      readEnv("NEXT_PUBLIC_SITE_URL") ??
      DEFAULT_WHOP_IDS.siteUrl,
    plans: {
      inspection: readEnv("WHOP_PLAN_ID_INSPECTION") ?? DEFAULT_WHOP_IDS.planInspection,
      deposit: readEnv("WHOP_PLAN_ID_DEPOSIT") ?? DEFAULT_WHOP_IDS.planDeposit,
      gutter: readEnv("WHOP_PLAN_ID_GUTTER") ?? DEFAULT_WHOP_IDS.planGutter,
    },
  };
}

let _cachedKey: string | undefined;
let _cachedBase: string | undefined;
let _client: WhopClient | null = null;

export function getWhopClient(): WhopClient | null {
  const { apiKey, baseUrl } = getWhopConfig();
  if (!apiKey) return null;
  if (_client && _cachedKey === apiKey && _cachedBase === baseUrl) {
    return _client;
  }
  const sdkBaseUrl = `${baseUrl.replace(/\/+$/, "")}/api/v1`;
  _client = new WhopClient({ token: apiKey, baseUrl: sdkBaseUrl, maxRetries: 1 });
  _cachedKey = apiKey;
  _cachedBase = baseUrl;
  return _client;
}

/** Human-readable error message out of SDK/API errors. */
export function whopErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      message?: string;
      body?: { error?: { message?: string }; message?: string };
      error?: { message?: string };
      status?: number;
      statusCode?: number;
    };
    const msg = e.body?.error?.message ?? e.body?.message ?? e.error?.message ?? e.message;
    const status = e.status ?? e.statusCode;
    if (msg) return status ? `${msg} (HTTP ${status})` : msg;
  }
  return "Unexpected error contacting the Whop API.";
}

/** Which pieces of the integration are configured (safe to expose — non-secret IDs & booleans only). */
export function whopConfigReport() {
  const c = getWhopConfig();
  const databaseConfigured = isDatabaseConfigured();
  return {
    apiKey: !!c.apiKey,
    accountId: !!c.accountId,
    productId: !!c.productId,
    planInspection: !!c.plans.inspection,
    planDeposit: !!c.plans.deposit,
    planGutter: !!c.plans.gutter,
    webhookSecret: !!c.webhookSecret,
    adminToken: !!c.adminToken,
    pixel: !!c.pixelSrc,
    databaseConfigured,
    storageMode: databaseConfigured ? ("whop-api+postgres" as const) : ("whop-api" as const),
    appId: c.appId,
    accountIdValue: c.accountId,
    productIdValue: c.productId,
    baseUrl: c.baseUrl,
    environment: c.environment,
  };
}

/** Lightweight authenticated read-only ping used by the status page. */
export async function pingWhopApi(): Promise<{ ok: boolean; detail: string }> {
  const { apiKey, accountId, baseUrl } = getWhopConfig();
  if (!apiKey) return { ok: false, detail: "WHOP_API_KEY is not set" };
  try {
    const url = new URL(`${baseUrl}/api/v1/invoices`);
    url.searchParams.set("first", "1");
    if (accountId) url.searchParams.set("account_id", accountId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    return res.ok
      ? { ok: true, detail: `Authenticated · HTTP ${res.status}` }
      : { ok: false, detail: `Whop API answered HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: whopErrorMessage(err) };
  }
}
