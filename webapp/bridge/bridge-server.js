#!/usr/bin/env node
// Trinity Bridge
// ----------------------------------------------------------------------------
// Runs on the HOST (not inside Docker). It is the only thing that the webapp
// and the Trinity container are allowed to talk to when they want to touch the
// user's computer. All requests go through an allow-list of "permissions"
// that the user configures in the webapp.
//
// Responsibilities:
//   1. Serve a small HTTP API on 127.0.0.1:4711 for the webapp.
//   2. Forward chat messages to the trinity-agent container (default: http://127.0.0.1:18789).
//   3. Enforce permission checks for any host-resource access.
//   4. Emit an audit log that the webapp can display.
//
// Designed with zero third-party dependencies so a fresh install only needs Node 20+.
// ----------------------------------------------------------------------------

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const { spawn, execFile } = require("child_process");
const crypto = require("crypto");

const security = require("./security");
const TrinityClient = require("./trinity-client");

// ---- Configuration ---------------------------------------------------------

const CONFIG_DIR  = path.join(os.homedir(), ".trinity-bridge");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const AUDIT_FILE  = path.join(CONFIG_DIR, "audit.log");
const PERM_FILE   = path.join(CONFIG_DIR, "permissions.json");
const TOKEN_FILE  = path.join(CONFIG_DIR, "pairing-token");

const DEFAULTS = {
  host: "127.0.0.1",           // loopback-only by design
  port: 4711,
  trinityContainerUrl: process.env.TRINITY_CONTAINER_URL || "http://127.0.0.1:18789",
  allowedOrigins: [
    "http://127.0.0.1",
    "http://localhost",
    "file://",
    "null",
  ],
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

function loadConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2), { mode: 0o600 });
    return { ...DEFAULTS };
  }
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) }; }
  catch { return { ...DEFAULTS }; }
}

function saveConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function loadOrCreateToken() {
  ensureConfigDir();
  if (fs.existsSync(TOKEN_FILE)) {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  }
  // Human-friendly token: TRN-xxxx-xxxx-xxxx
  const raw = crypto.randomBytes(9).toString("hex").toUpperCase();
  const token = "TRN-" + raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8, 12);
  fs.writeFileSync(TOKEN_FILE, token + "\n", { mode: 0o600 });
  return token;
}

// ---- Audit log -------------------------------------------------------------

const auditRing = [];
const AUDIT_RING_MAX = 500;

function audit(kind, meta) {
  const line = { ts: new Date().toISOString(), kind, ...meta };
  auditRing.push(line);
  if (auditRing.length > AUDIT_RING_MAX) auditRing.shift();
  try { fs.appendFileSync(AUDIT_FILE, JSON.stringify(line) + "\n"); } catch {}
  // Also echo to stdout for operators tailing the daemon.
  const tag = kind.padEnd(14);
  console.log(`[${line.ts}] ${tag} ${JSON.stringify(meta)}`);
}

// ---- Helpers ---------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) { req.destroy(); reject(new Error("payload too large")); }
    });
    req.on("end", () => {
      if (!data) return resolve(null);
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Trinity-Bridge": "0.1.0",
  });
  res.end(JSON.stringify(body));
}

function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Trinity-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PATCH, OPTIONS");
  res.setHeader("Vary", "Origin");
}

function originAllowed(origin, cfg) {
  if (!origin) return true; // curl / same-origin
  return cfg.allowedOrigins.some((prefix) => origin.startsWith(prefix));
}

// ---- Request router --------------------------------------------------------

function createServer(cfg, token, trinity) {
  const perms = security.loadPermissions(PERM_FILE);

  const routes = [];
  function route(method, pattern, handler) {
    routes.push({ method, pattern, handler });
  }

  // ---- Public (no auth) ----
  route("GET", "/health", async () => ({ ok: true, uptime: process.uptime() }));

  route("GET", "/status", async () => ({
    ok: true,
    bridge: { version: "0.1.0", host: cfg.host, port: cfg.port, pid: process.pid },
    trinityContainerUrl: cfg.trinityContainerUrl,
    permCount: perms.list().length,
  }));

  route("POST", "/pair", async (req) => {
    const body = await readBody(req);
    if (!body || body.token !== token) {
      audit("pair.fail", { from: req.socket.remoteAddress });
      const err = new Error("invalid token"); err.status = 401; throw err;
    }
    audit("pair.ok", { from: req.socket.remoteAddress });
    return { ok: true, paired: true };
  });

  // ---- Authenticated ----
  function requireAuth(req) {
    const t = req.headers["x-trinity-token"];
    if (!t || t !== token) {
      const err = new Error("unauthorized"); err.status = 401; throw err;
    }
  }

  route("GET", "/docker/status", async (req) => {
    requireAuth(req);
    return new Promise((resolve) => {
      execFile("docker", ["--version"], (err, stdout) => {
        if (err) return resolve({ installed: false });
        const version = (stdout || "").toString().trim();
        resolve({ installed: true, version });
      });
    });
  });

  route("GET", "/containers", async (req) => {
    requireAuth(req);
    return new Promise((resolve) => {
      execFile("docker", ["ps", "--format", "{{.Names}}|{{.Status}}|{{.Image}}"], (err, stdout) => {
        if (err) return resolve({ containers: [], error: err.message });
        const containers = (stdout || "").toString().trim().split("\n").filter(Boolean).map((line) => {
          const [name, status, image] = line.split("|");
          return { name, status, image };
        });
        resolve({ containers });
      });
    });
  });

  // ---- Chat relay to trinity-agent container ----
  route("POST", "/chat", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    if (!body.message) { const e = new Error("message required"); e.status = 400; throw e; }
    audit("chat.in", { bytes: String(body.message).length, conv: body.conversationId || "default" });
    const reply = await trinity.chat(body.message, body.conversationId || "default");
    audit("chat.out", { bytes: String(reply && reply.reply || "").length });
    return reply;
  });

  route("GET", "/chat/history", async (req, url) => {
    requireAuth(req);
    const id = url.searchParams.get("id") || "default";
    return trinity.history(id);
  });

  // ---- Permissions ----
  route("GET", "/permissions", async (req) => {
    requireAuth(req);
    return { permissions: perms.list() };
  });

  route("POST", "/permissions", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    const perm = perms.add(body);
    audit("perm.add", { id: perm.id, path: perm.path, mode: perm.mode });
    return { permission: perm };
  });

  route("DELETE", "/permissions/:id", async (req, url, params) => {
    requireAuth(req);
    perms.remove(params.id);
    audit("perm.remove", { id: params.id });
    return { ok: true };
  });

  route("PATCH", "/permissions/:id", async (req, url, params) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    const updated = perms.update(params.id, body);
    audit("perm.update", { id: params.id, enabled: body.enabled });
    return { permission: updated };
  });

  // ---- Access proxy: Trinity container asks the bridge to touch the host ----
  // The container should call http://host.docker.internal:4711/access with its
  // chosen permission id + op; the bridge verifies it's allow-listed and runs it.
  route("POST", "/access", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    const decision = perms.check(body);
    audit("access.check", { permId: body.permId, op: body.op, decision: decision.allow });
    if (!decision.allow) {
      const e = new Error("denied: " + decision.reason); e.status = 403; throw e;
    }
    const result = await security.execute(body, decision.permission);
    audit("access.exec", { permId: body.permId, op: body.op });
    return result;
  });

  route("GET", "/log", async (req, url) => {
    requireAuth(req);
    const limit = Math.min(500, Number(url.searchParams.get("limit") || 100));
    return { log: auditRing.slice(-limit) };
  });

  // ---- Agent config ----
  route("GET", "/config", async (req) => {
    requireAuth(req);
    return { config: cfg };
  });

  route("POST", "/config", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    // Only whitelisted keys are persisted.
    const allowed = ["name", "provider", "scope", "brain", "morpheus"];
    const patch = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    Object.assign(cfg, patch);
    saveConfig(cfg);
    audit("config.save", patch);
    return { ok: true, config: cfg };
  });

  // ---- Agent lifecycle ----
  route("POST", "/agent/start",   async (req) => { requireAuth(req); return dockerCompose("up", "-d"); });
  route("POST", "/agent/stop",    async (req) => { requireAuth(req); return dockerCompose("stop"); });
  route("POST", "/agent/restart", async (req) => { requireAuth(req); return dockerCompose("restart"); });

  function dockerCompose(...args) {
    return new Promise((resolve) => {
      const composeFile = path.resolve(__dirname, "..", "docker", "docker-compose.trinity.yml");
      const fullArgs = ["compose", "-f", composeFile, ...args];
      execFile("docker", fullArgs, { timeout: 120_000 }, (err, stdout, stderr) => {
        if (err) {
          audit("agent.cmd.fail", { args, err: err.message });
          return resolve({ ok: false, error: err.message, stderr: String(stderr || "") });
        }
        audit("agent.cmd.ok", { args });
        resolve({ ok: true, stdout: String(stdout || "") });
      });
    });
  }

  // ---- Dispatcher ----
  function matchRoute(method, pathname) {
    for (const r of routes) {
      if (r.method !== method) continue;
      if (r.pattern === pathname) return { handler: r.handler, params: {} };
      // :id parameter support
      const parts = r.pattern.split("/");
      const got   = pathname.split("/");
      if (parts.length !== got.length) continue;
      const params = {};
      let match = true;
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(got[i]);
        else if (parts[i] !== got[i]) { match = false; break; }
      }
      if (match) return { handler: r.handler, params };
    }
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!originAllowed(origin, cfg)) {
      audit("origin.deny", { origin });
      res.writeHead(403); return res.end("forbidden origin");
    }
    setCors(res, origin || "*");

    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://${cfg.host}:${cfg.port}`);
    const matched = matchRoute(req.method, url.pathname);
    if (!matched) return json(res, 404, { error: "not found" });

    try {
      const result = await matched.handler(req, url, matched.params);
      json(res, 200, result ?? { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) audit("error", { pathname: url.pathname, err: e.message });
      json(res, status, { error: e.message });
    }
  });

  return server;
}

// ---- main ------------------------------------------------------------------

function main() {
  const cfg = loadConfig();
  const token = loadOrCreateToken();
  const trinity = new TrinityClient(cfg.trinityContainerUrl);

  const server = createServer(cfg, token, trinity);
  server.listen(cfg.port, cfg.host, () => {
    const banner = [
      "",
      "  ╭─────────────────────────────────────────────────────────╮",
      "  │                 TRINITY BRIDGE · v0.1.0                 │",
      "  │     host-side gatekeeper for the Trinity container      │",
      "  ╰─────────────────────────────────────────────────────────╯",
      "",
      `  Listening   : http://${cfg.host}:${cfg.port}`,
      `  Agent URL   : ${cfg.trinityContainerUrl}`,
      `  Config dir  : ${CONFIG_DIR}`,
      "",
      `  Pairing token: ${token}`,
      "  (paste this into the webapp onboarding wizard)",
      "",
    ].join("\n");
    console.log(banner);
    audit("bridge.start", { port: cfg.port });
  });

  // Daemon-ish: detach from parent if --daemon given.
  if (process.argv.includes("--daemon")) {
    console.log("Running in daemon mode. Kill with: kill", process.pid);
  }

  process.on("SIGINT",  () => { audit("bridge.stop", { signal: "SIGINT" });  process.exit(0); });
  process.on("SIGTERM", () => { audit("bridge.stop", { signal: "SIGTERM" }); process.exit(0); });
}

if (require.main === module) main();

module.exports = { createServer, loadConfig, loadOrCreateToken };
