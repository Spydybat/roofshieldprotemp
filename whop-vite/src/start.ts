import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * Whop Elements render in frames served from https://cdn.whop.com and talk to the
 * Whop API, so the Content-Security-Policy must allow them while leaving
 * frame-ancestors open so Whop community iframes can embed this app cleanly.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.whop.com https://pay.google.com https://applepay.cdn-apple.com https://js.braintreegateway.com https://www.paypal.com https://c.paypal.com https://assets.whop.com",
  "frame-src 'self' https://cdn.whop.com https://checkout.paypal.com https://assets.braintreegateway.com https://www.paypal.com https://www.sandbox.paypal.com https://cdn.plaid.com",
  "connect-src 'self' https://api.whop.com https://sandbox-api.whop.com https://pay.google.com https://google.com https://account.google.com https://www.google.com https://api.basistheory.com https://payments.braintree-api.com https://api.braintreegateway.com https://api-m.paypal.com https://api-m.sandbox.paypal.com https://www.paypal.com https://www.sandbox.paypal.com https://production.plaid.com https://sandbox.plaid.com",
  "img-src 'self' data: blob: https://www.paypalobjects.com https://cdn.whop.com https://assets.whop.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "worker-src 'self' blob:",
].join("; ");

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  if (result.response) {
    const headers = new Headers(result.response.headers);
    if (!headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", csp);
    }
    return {
      ...result,
      response: new Response(result.response.body, {
        status: result.response.status,
        statusText: result.response.statusText,
        headers,
      }),
    };
  }
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
}));
