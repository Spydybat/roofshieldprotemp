#!/usr/bin/env node
/**
 * Secure secret entry for RoofShield Pro — NO secret ever echoes to the
 * terminal, chat transcript, or shell history.
 *
 *   node scripts/set-whop-secrets.mjs              # writes .env.local
 *   node scripts/set-whop-secrets.mjs --check      # report only, no changes
 *   node scripts/set-whop-secrets.mjs --target /tmp/x.env
 *
 * How it stays safe:
 *  • Prompts with hidden input (keystrokes are not echoed; no raw mode echo).
 *  • Never accepts the secret as a command-line argument (args land in shell
 *    history and `ps` output — that is how keys leak).
 *  • Never prints the value; reports only length + whether the format is valid.
 *  • Preserves every other line in the file; refuses to overwrite a real,
 *    already-configured value unless you pass --force.
 *  • Writes the file with 0600 permissions.
 */

import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes("--check");
const FORCE = argv.includes("--force");
const targetIdx = argv.indexOf("--target");
const TARGET = targetIdx !== -1 && argv[targetIdx + 1] ? argv[targetIdx + 1] : ".env.local";

/* ── Field definitions: format validators double as typo catchers ────────── */
const FIELDS = [
  {
    key: "WHOP_API_KEY",
    label: "Whop Company API key",
    hint: "Whop dashboard → Developers → API keys (shows once, starts with apik_)",
    validate: (v) =>
      v.length >= 20 && !/\s/.test(v)
        ? null
        : "must be a single token with no spaces (expected 20+ chars)",
    optional: false,
  },
  {
    key: "WHOP_ACCOUNT_ID",
    label: "Whop account ID",
    hint: "Company settings — starts with biz_",
    validate: (v) => (/^biz_[A-Za-z0-9]+$/.test(v) ? null : "must start with biz_"),
    optional: false,
  },
  {
    key: "WHOP_PLAN_ID_INSPECTION",
    label: "Plan — Roof Inspection ($149)",
    hint: "Products → one-time plan, starts with plan_",
    validate: (v) => (/^plan_[A-Za-z0-9]+$/.test(v) ? null : "must start with plan_"),
    optional: false,
  },
  {
    key: "WHOP_PLAN_ID_DEPOSIT",
    label: "Plan — Roofing Project Deposit ($500)",
    hint: "Products → one-time plan, starts with plan_",
    validate: (v) => (/^plan_[A-Za-z0-9]+$/.test(v) ? null : "must start with plan_"),
    optional: false,
  },
  {
    key: "WHOP_PLAN_ID_GUTTER",
    label: "Plan — Gutter Cleaning ($299)",
    hint: "Products → one-time plan, starts with plan_",
    validate: (v) => (/^plan_[A-Za-z0-9]+$/.test(v) ? null : "must start with plan_"),
    optional: false,
  },
  {
    key: "WHOP_PRODUCT_ID",
    label: "Product ID (optional, attributes leads)",
    hint: "Products → starts with prod_ — press Enter to skip",
    validate: (v) => (/^prod_[A-Za-z0-9]+$/.test(v) ? null : "must start with prod_"),
    optional: true,
  },
  {
    key: "WHOP_WEBHOOK_SECRET",
    label: "Webhook signing secret (optional)",
    hint: "Developers → Webhooks → starts with ws_ — Enter to skip",
    validate: (v) => (/^ws_[A-Za-z0-9]+$/.test(v) ? null : "must start with ws_"),
    optional: true,
  },
];

const PLACEHOLDER = /^__.*__$|^<.*>$|^(biz|plan|prod|ws)_x+$/i;

/** Buffered stdin lines for non-interactive (piped) runs. */
let pipedLines = null;

/* ── Hidden prompt (raw TTY mode, nothing echoed) ────────────────────────── */
async function promptHidden(label, hint) {
  process.stdout.write(`\n${label}\n  ${hint}\n  > `);

  if (!process.stdin.isTTY) {
    // Piped input: buffer ALL lines up-front (they usually arrive in one chunk),
    // then hand them out one prompt at a time. Still never echoed.
    if (!pipedLines) {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      pipedLines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    }
    const line = pipedLines.shift() ?? "";
    return line.trim();
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let buf = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.codePointAt(0);
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(buf.trim());
          return;
        }
        if (code === 3) {
          // Ctrl+C
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (code === 127 || code === 8) {
          buf = buf.slice(0, -1); // backspace — no echo
          continue;
        }
        if (code >= 32) buf += ch; // printable only; nothing echoed
      }
    };

    stdin.on("data", onData);
  });
}

/* ── .env file read / write (line-preserving) ────────────────────────────── */
function readVars(path) {
  const vars = {};
  if (!existsSync(path)) return vars;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (!/^["']/.test(v)) v = v.split(" #")[0].trim();
    vars[k] = v.replace(/^["']|["']$/g, "");
  }
  return vars;
}

function upsert(path, updates) {
  let lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    const next = `${key}=${value}`;
    if (idx !== -1) lines[idx] = next;
    else lines.push(next);
  }

  // Ensure a trailing newline, keep exactly one.
  let out = lines.join("\n").replace(/\n+$/, "") + "\n";

  // First line comment so nobody mistakes the file for a template.
  if (!out.startsWith("#")) {
    out = `# Local secrets — git-ignored. Never commit or paste into chat.\n${out}`;
  }

  writeFileSync(path, out, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort on filesystems without POSIX modes */
  }
}

/* ── Main ────────────────────────────────────────────────────────────────── */
async function main() {
  console.log("─".repeat(74));
  console.log(" ROOFSHIELD PRO — secure secret entry");
  console.log(` target: ${TARGET}   (hidden input; values are never echoed or logged)`);
  console.log("─".repeat(74));

  const existing = readVars(TARGET);

  if (CHECK_ONLY) {
    let missing = 0;
    for (const f of FIELDS) {
      const v = existing[f.key] ?? "";
      const isPlaceholder = !v || PLACEHOLDER.test(v);
      const valid = !isPlaceholder && !f.validate(v);
      const status = isPlaceholder ? "NOT SET" : valid ? "SET" : "INVALID FORMAT";
      if (isPlaceholder && !f.optional) missing++;
      console.log(
        `  ${status.padEnd(15)} ${f.key.padEnd(26)} ${isPlaceholder ? "" : `(${v.length} chars)`}`,
      );
    }
    console.log("─".repeat(74));
    console.log(missing === 0 ? "Result: all required values are configured." : `Result: ${missing} required value(s) still missing.`);
    return 0;
  }

  if (!existsSync(TARGET)) {
    writeFileSync(TARGET, "# Local secrets — git-ignored. Never commit or paste into chat.\n", {
      mode: 0o600,
    });
    console.log(`  created ${TARGET}`);
  }

  const updates = {};

  for (const f of FIELDS) {
    const current = (existing[f.key] ?? "").trim();
    const alreadyReal = current && !PLACEHOLDER.test(current) && !f.validate(current);

    if (alreadyReal && !FORCE) {
      console.log(`\n${f.label} [${f.key}]\n  already configured (${current.length} chars) — press Enter to keep, or type a new value.`);
    }

    const value = await promptHidden(
      `${f.label}  [${f.key}]${alreadyReal && !FORCE ? "  (Enter = keep existing)" : ""}`,
      f.hint,
    );

    if (!value) {
      if (f.optional || alreadyReal) {
        console.log("  · skipped (kept existing / left unset)");
        continue;
      }
      console.log("  ! required — please run again and enter a value.");
      continue;
    }

    const problem = f.validate(value);
    if (problem) {
      console.log(`  ✗ rejected: ${problem}. Nothing was written for this field.`);
      continue;
    }

    updates[f.key] = value;
    console.log(`  ✓ accepted (${value.length} chars, format valid) — value not shown`);
  }

  if (Object.keys(updates).length === 0) {
    console.log("\nNo changes written.");
    return 0;
  }

  upsert(TARGET, updates);
  console.log("\n─".repeat(1));
  console.log(`✓ ${Object.keys(updates).length} value(s) written to ${TARGET} (mode 600)`);
  console.log("  Nothing was printed. Continue with:");
  console.log("    node scripts/whop-preflight.mjs");
  console.log("    npm run build && npm start\n");
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`\nAborted: ${err.message}. No values were written.`);
    process.exit(1);
  });
