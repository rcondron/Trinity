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
const BrainClient = require("./brain-client");

// ---- Configuration ---------------------------------------------------------

const CONFIG_DIR  = path.join(os.homedir(), ".trinity-bridge");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const AUDIT_FILE  = path.join(CONFIG_DIR, "audit.log");
const BACKUP_FILE = path.join(CONFIG_DIR, "backup-config.json");
const PERM_FILE   = path.join(CONFIG_DIR, "permissions.json");
const TOKEN_FILE  = path.join(CONFIG_DIR, "pairing-token");

const DEFAULTS = {
  host: "127.0.0.1",           // loopback-only by design
  port: 4711,
  trinityContainerUrl: process.env.TRINITY_CONTAINER_URL || "http://127.0.0.1:18789",
  brainContainerUrl:   process.env.TRINITY_BRAIN_URL     || "http://127.0.0.1:8100",
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

function createServer(cfg, token, trinity, brain) {
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

  // ---- Skills (relayed to trinity-brain) ------------------------------------
  // All skills live in the trinity-brain container. There is no bundled skills
  // folder on the host — the brain is the single source of truth, and the
  // agent updates its own skills as it learns. These bridge routes are thin
  // relays that also write to the audit log.

  route("GET", "/skills/status", async (req) => {
    requireAuth(req);
    try { return await brain.skillsStatus(); }
    catch (e) { audit("skill.status.fail", { err: e.message }); throw e; }
  });

  route("POST", "/skills/recall", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    if (!body.query) { const e = new Error("query required"); e.status = 400; throw e; }
    audit("skill.recall", { query: String(body.query).slice(0, 80) });
    return brain.recallSkills(body);
  });

  // Called by the webapp (user-authored) or by the Trinity agent itself
  // (container → bridge → brain) when it figures out a new way to do something.
  // Source defaults to "auto-created" to distinguish learned skills from the
  // ones a human typed in the UI.
  route("POST", "/skills/learn", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    if (!body.name || !body.content) {
      const e = new Error("name and content required"); e.status = 400; throw e;
    }
    const skill = { ...body, source: body.source || "auto-created" };
    audit("skill.learn", { name: skill.name, source: skill.source });
    return brain.ingestSkill(skill);
  });

  // Manually add a skill (from the webapp UI). Same as /learn but source=custom.
  route("POST", "/skills", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    if (!body.name || !body.content) {
      const e = new Error("name and content required"); e.status = 400; throw e;
    }
    const skill = { ...body, source: "custom" };
    audit("skill.add", { name: skill.name });
    return brain.ingestSkill(skill);
  });

  // Agent feedback loop: tell the brain whether a skill helped or hurt so
  // significance drifts up or down over time. This is how the agent's skill
  // library self-improves.
  route("POST", "/skills/:id/success", async (req, url, params) => {
    requireAuth(req);
    audit("skill.success", { id: params.id });
    return brain.markSuccess(params.id);
  });

  route("POST", "/skills/:id/fail", async (req, url, params) => {
    requireAuth(req);
    audit("skill.fail", { id: params.id });
    return brain.markFailure(params.id);
  });

  // Evolve a skill into a newer version. The old version stays in the brain,
  // linked via evolved_from, so we never lose the learning history.
  route("POST", "/skills/:id/evolve", async (req, url, params) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    audit("skill.evolve", { id: params.id, name: body.name });
    return brain.evolveSkill(params.id, body);
  });

  // ---- Trinity Wallet (HD mnemonic, encrypted in the agent container) --------
  // The wallet is created once during onboarding. The mnemonic is encrypted
  // with AES-256-GCM (key derived from passphrase via PBKDF2-SHA512).
  // Address #0 is the gateway; 1+ are for sub-agent Morpheus sessions.
  //
  // The bridge stores the encrypted wallet file at ~/.trinity-bridge/wallet.enc
  // (same security model as the pairing token and backup config).

  const WALLET_FILE = path.join(CONFIG_DIR, "wallet.enc");

  route("GET", "/wallet/status", async (req) => {
    requireAuth(req);
    // Return public info without requiring the passphrase.
    if (!fs.existsSync(WALLET_FILE)) {
      return { initialized: false, address: "", addresses: [], derivedCount: 0 };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
      return {
        initialized: true,
        address: (raw.addresses && raw.addresses[0] && raw.addresses[0].address) || "",
        addresses: raw.addresses || [],
        derivedCount: raw.derivedCount || 0,
      };
    } catch {
      return { initialized: false, address: "", addresses: [], derivedCount: 0 };
    }
  });

  route("POST", "/wallet/create", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    if (!body.passphrase || String(body.passphrase).length < 8) {
      const e = new Error("passphrase required (8+ characters)"); e.status = 400; throw e;
    }
    if (fs.existsSync(WALLET_FILE)) {
      const e = new Error("wallet already exists — use /wallet/status to check"); e.status = 409; throw e;
    }

    // Generate mnemonic + derive addresses using Node's crypto.
    // We use the same logic as wallet.ts but in pure JS for the bridge.
    const bip39 = await import("node:crypto");
    const ethersAvailable = await (async () => {
      try { await import("ethers"); return true; } catch { return false; }
    })();

    // If ethers.js is available in the bridge environment, use it.
    // Otherwise, generate a random 256-bit key and let the container handle full HD derivation.
    let mnemonic, addresses;
    if (ethersAvailable) {
      const ethers = await import("ethers");
      const wallet = ethers.Wallet.createRandom();
      mnemonic = wallet.mnemonic.phrase;
      const count = body.addressCount || 3;
      addresses = [];
      for (let i = 0; i < count; i++) {
        const hd = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/" + i);
        addresses.push({
          index: i,
          address: hd.address,
          label: i === 0 ? "gateway (primary)" : `sub-agent-${i}`,
        });
      }
    } else {
      // Fallback: generate a 128-bit entropy and convert to a placeholder.
      // Full HD derivation will happen inside the Trinity container.
      const entropy = crypto.randomBytes(16).toString("hex");
      mnemonic = "(deferred — ethers.js not available in bridge; will derive in container)";
      addresses = [{ index: 0, address: "0x" + crypto.createHash("sha256").update(entropy).digest("hex").slice(0, 40), label: "gateway (placeholder)" }];
    }

    // Encrypt the mnemonic.
    const salt = crypto.randomBytes(32);
    const key = crypto.pbkdf2Sync(body.passphrase, salt, 600000, 32, "sha512");
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let ciphertext = cipher.update(mnemonic, "utf8", "hex");
    ciphertext += cipher.final("hex");
    const tag = cipher.getAuthTag();

    const walletData = {
      version: 1,
      ciphertext,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      salt: salt.toString("hex"),
      iterations: 600000,
      derivedCount: addresses.length,
      addresses,
      createdAt: new Date().toISOString(),
    };

    ensureConfigDir();
    fs.writeFileSync(WALLET_FILE, JSON.stringify(walletData, null, 2), { mode: 0o600 });
    audit("wallet.create", { addressCount: addresses.length, primary: addresses[0].address });

    return {
      ok: true,
      mnemonic,  // Shown ONCE to the user. They must back this up.
      addresses,
    };
  });

  route("POST", "/wallet/derive", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    if (!body.passphrase) { const e = new Error("passphrase required"); e.status = 400; throw e; }
    if (!fs.existsSync(WALLET_FILE)) { const e = new Error("no wallet — create one first"); e.status = 404; throw e; }

    const raw = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));

    // Decrypt to get mnemonic.
    const salt = Buffer.from(raw.salt, "hex");
    const key = crypto.pbkdf2Sync(body.passphrase, salt, raw.iterations || 600000, 32, "sha512");
    const iv = Buffer.from(raw.iv, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(raw.tag, "hex"));
    let mnemonic;
    try {
      mnemonic = decipher.update(raw.ciphertext, "hex", "utf8");
      mnemonic += decipher.final("utf8");
    } catch {
      const e = new Error("wrong passphrase"); e.status = 401; throw e;
    }

    // Derive next address.
    try {
      const ethers = await import("ethers");
      const nextIndex = raw.addresses.length;
      const hd = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/" + nextIndex);
      const info = { index: nextIndex, address: hd.address, label: body.label || `sub-agent-${nextIndex}` };
      raw.addresses.push(info);
      raw.derivedCount = raw.addresses.length;

      // Re-encrypt with same passphrase.
      const newSalt = crypto.randomBytes(32);
      const newKey = crypto.pbkdf2Sync(body.passphrase, newSalt, 600000, 32, "sha512");
      const newIv = crypto.randomBytes(16);
      const newCipher = crypto.createCipheriv("aes-256-gcm", newKey, newIv);
      let newCiphertext = newCipher.update(mnemonic, "utf8", "hex");
      newCiphertext += newCipher.final("hex");
      const newTag = newCipher.getAuthTag();

      raw.ciphertext = newCiphertext;
      raw.iv = newIv.toString("hex");
      raw.tag = newTag.toString("hex");
      raw.salt = newSalt.toString("hex");

      fs.writeFileSync(WALLET_FILE, JSON.stringify(raw, null, 2), { mode: 0o600 });
      audit("wallet.derive", { index: nextIndex, address: info.address });
      return { ok: true, address: info };
    } catch (e) {
      if (e.status) throw e;
      const err = new Error("derivation failed — is ethers.js installed?"); err.status = 500; throw err;
    }
  });

  // ---- Morpheus Compute (on-chain session management) -----------------------
  // These endpoints let the webapp browse models/providers/bids on the
  // Morpheus Diamond Proxy (Base) and open/close compute sessions.
  // Each session maintains a persistent TCP socket to the LLM provider.
  //
  // The actual on-chain work happens in the Trinity container's
  // src/morpheus/ module; the bridge proxies through to the gateway.
  // For read-only browsing (models, bids, stats) we call the RPC directly.

  // In-memory session state (the bridge acts as the session coordinator).
  const morpheusSessions = new Map();

  route("GET", "/morpheus/config", async (req) => {
    requireAuth(req);
    const mc = cfg.morpheusCompute || {};
    return {
      rpcUrl: mc.rpcUrl || "https://mainnet.base.org",
      testnet: mc.testnet || false,
      walletConfigured: !!(mc.privateKey),
      walletAddress: mc.walletAddress || "",
      autoCloseLeadTimeSec: mc.autoCloseLeadTimeSec || 120,
    };
  });

  route("POST", "/morpheus/config", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    const allowed = ["rpcUrl", "privateKey", "testnet", "autoCloseLeadTimeSec"];
    const mc = cfg.morpheusCompute || {};
    for (const k of allowed) {
      if (k in body) {
        if (typeof body[k] === "string" && body[k] === "••••••") continue;
        mc[k] = body[k];
      }
    }
    // Derive wallet address from private key if provided.
    if (mc.privateKey && mc.privateKey !== "••••••") {
      try {
        const crypto2 = require("crypto");
        // Simple: just store it; the actual address derivation happens in the Trinity container.
        mc.walletAddress = "(configured — derive on connect)";
      } catch {}
    }
    cfg.morpheusCompute = mc;
    saveConfig(cfg);
    audit("morpheus.config.save", { rpcUrl: mc.rpcUrl, testnet: mc.testnet });
    return { ok: true };
  });

  route("GET", "/morpheus/sessions", async (req) => {
    requireAuth(req);
    const sessions = [];
    for (const [id, s] of morpheusSessions) {
      sessions.push({
        sessionId: id,
        modelId: s.modelId,
        modelName: s.modelName,
        provider: s.provider,
        endpoint: s.endpoint,
        stakeAmount: String(s.stakeAmount),
        openedAt: s.openedAt,
        endsAt: s.endsAt,
        alive: s.alive,
        requestCount: s.requestCount,
        bytesSent: s.bytesSent,
        bytesReceived: s.bytesReceived,
      });
    }
    return { sessions };
  });

  route("GET", "/morpheus/sessions/:id", async (req, url, params) => {
    requireAuth(req);
    const s = morpheusSessions.get(params.id);
    if (!s) { const e = new Error("session not found"); e.status = 404; throw e; }
    return {
      sessionId: params.id,
      modelId: s.modelId,
      modelName: s.modelName,
      provider: s.provider,
      endpoint: s.endpoint,
      stakeAmount: String(s.stakeAmount),
      openedAt: s.openedAt,
      endsAt: s.endsAt,
      alive: s.alive,
      requestCount: s.requestCount,
    };
  });

  // Chat through a Morpheus session — routes to the provider's persistent socket.
  route("POST", "/morpheus/sessions/:id/chat", async (req, url, params) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    const s = morpheusSessions.get(params.id);
    if (!s) { const e = new Error("session not found"); e.status = 404; throw e; }
    if (!s.alive) { const e = new Error("session is closed"); e.status = 410; throw e; }
    if (!body.message) { const e = new Error("message required"); e.status = 400; throw e; }

    audit("morpheus.chat", { sessionId: params.id, bytes: String(body.message).length });

    // Route the chat through the session's persistent socket.
    const payload = JSON.stringify({
      model: s.modelName || s.modelId,
      messages: [{ role: "user", content: body.message }],
      stream: false,
    });

    return new Promise((resolve, reject) => {
      const u = new (require("url").URL)(s.endpoint);
      const lib = u.protocol === "https:" ? require("https") : require("http");
      const r = lib.request({
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: "/v1/chat/completions",
        agent: s.agent,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: 120_000,
      }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          s.requestCount++;
          s.bytesSent += Buffer.byteLength(payload);
          s.bytesReceived += data.length;
          try {
            const json = JSON.parse(data);
            const reply = json?.choices?.[0]?.message?.content ?? data;
            resolve({ reply, sessionId: params.id, tokenCount: json?.usage?.total_tokens });
          } catch {
            resolve({ reply: data, sessionId: params.id });
          }
        });
      });
      r.on("error", (err) => reject(new Error("provider error: " + err.message)));
      r.on("timeout", () => r.destroy(new Error("provider timeout")));
      r.write(payload);
      r.end();
    });
  });

  // ---- Brain model management (relayed to trinity-brain /v2/model) ----------

  route("GET", "/brain/model", async (req) => {
    requireAuth(req);
    try { return await brain.getModelConfig(); }
    catch (e) { audit("brain.model.fail", { err: e.message }); throw e; }
  });

  route("POST", "/brain/model", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    audit("brain.model.update", Object.keys(body));
    return brain.updateModelConfig(body);
  });

  // ---- Settings / config ----
  route("GET", "/config", async (req) => {
    requireAuth(req);
    return { config: cfg };
  });

  route("POST", "/config", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    // Whitelisted keys that may be persisted.
    const allowed = [
      "name", "provider", "scope", "brain", "morpheus", "accessMode",
      // Model / provider settings
      "apiKeys", "defaultModel", "temperature", "maxTokens",
      // Brain settings
      "brainContainerUrl", "trinityContainerUrl",
      // Misc
      "logLevel",
    ];
    const patch = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    Object.assign(cfg, patch);
    saveConfig(cfg);
    audit("config.save", Object.keys(patch));
    return { ok: true, config: cfg };
  });

  // ---- Backup configuration for trinity-brain ----
  // Persisted separately so backup secrets never leak into the main config.
  function loadBackupConfig() {
    ensureConfigDir();
    if (fs.existsSync(BACKUP_FILE)) {
      try { return JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8")); }
      catch { /* fall through */ }
    }
    return { enabled: false, provider: "none", schedule: "daily", retain: 7 };
  }

  function saveBackupConfig(bc) {
    ensureConfigDir();
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(bc, null, 2), { mode: 0o600 });
  }

  route("GET", "/backup/config", async (req) => {
    requireAuth(req);
    const bc = loadBackupConfig();
    // Never return raw secrets to the browser — mask them.
    const masked = { ...bc };
    for (const k of ["secretKey", "accessKey", "password", "apiKey", "clientSecret", "refreshToken"]) {
      if (masked[k]) masked[k] = "••••••";
    }
    return { backup: masked };
  });

  route("POST", "/backup/config", async (req) => {
    requireAuth(req);
    const body = await readBody(req) || {};
    const allowed = [
      "enabled", "provider", "schedule", "retain",
      // Backblaze B2
      "b2KeyId", "b2AppKey", "b2Bucket",
      // AWS S3 / S3-compatible
      "s3Endpoint", "s3Region", "s3Bucket", "accessKey", "secretKey",
      // FTP / SFTP
      "ftpHost", "ftpPort", "ftpUser", "ftpPassword", "ftpPath", "ftpSecure",
      // Google Drive
      "gdClientId", "gdClientSecret", "gdRefreshToken", "gdFolderId",
      // Azure Blob
      "azConnectionString", "azContainer",
      // Local path (for mounted NAS / external drive)
      "localPath",
      // Restic / rclone wrapper
      "resticRepo", "resticPassword",
    ];
    const current = loadBackupConfig();
    for (const k of allowed) {
      if (k in body) {
        // Don't overwrite secrets with the masked placeholder.
        if (typeof body[k] === "string" && body[k] === "••••••") continue;
        current[k] = body[k];
      }
    }
    saveBackupConfig(current);
    audit("backup.config.save", { provider: current.provider, schedule: current.schedule });
    return { ok: true };
  });

  // Trigger an immediate backup (on-demand).
  route("POST", "/backup/run", async (req) => {
    requireAuth(req);
    const bc = loadBackupConfig();
    if (!bc.enabled || bc.provider === "none") {
      const e = new Error("backups not configured"); e.status = 400; throw e;
    }
    audit("backup.run.start", { provider: bc.provider });
    try {
      const result = await runBackup(bc);
      audit("backup.run.ok", { provider: bc.provider });
      return result;
    } catch (e) {
      audit("backup.run.fail", { provider: bc.provider, err: e.message });
      throw e;
    }
  });

  // Return the backup run history (from audit log).
  route("GET", "/backup/history", async (req) => {
    requireAuth(req);
    const backupLogs = auditRing.filter((l) => l.kind && l.kind.startsWith("backup."));
    return { history: backupLogs.slice(-50) };
  });

  // ---- Backup executor -------------------------------------------------------
  // Dumps trinity-brain data via docker exec, then ships the archive to the
  // configured destination. Each provider handler is deliberately minimal so
  // operators can audit exactly what runs.
  async function runBackup(bc) {
    // Step 1: create a timestamped tar.gz from the brain container's /app/data.
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archiveName = `trinity-brain-backup-${ts}.tar.gz`;
    const hostArchive = path.join(CONFIG_DIR, archiveName);

    await new Promise((resolve, reject) => {
      execFile("docker", [
        "exec", "trinity-brain",
        "tar", "czf", "/tmp/" + archiveName, "-C", "/app/data", "."
      ], { timeout: 120_000 }, (err) => {
        if (err) return reject(new Error("backup tar failed: " + err.message));
        resolve();
      });
    });

    // Copy the tar from the container to the host config dir.
    await new Promise((resolve, reject) => {
      execFile("docker", [
        "cp", "trinity-brain:/tmp/" + archiveName, hostArchive
      ], { timeout: 60_000 }, (err) => {
        if (err) return reject(new Error("docker cp failed: " + err.message));
        resolve();
      });
    });

    // Step 2: upload to the configured provider.
    const uploadResult = await uploadBackup(bc, hostArchive, archiveName);

    // Cleanup local archive.
    try { fs.unlinkSync(hostArchive); } catch {}

    return { ok: true, archive: archiveName, ...uploadResult };
  }

  async function uploadBackup(bc, filePath, fileName) {
    switch (bc.provider) {
      case "local":
        return uploadLocal(bc, filePath, fileName);
      case "s3":
      case "b2":
        return uploadS3Compatible(bc, filePath, fileName);
      case "ftp":
        return uploadFtp(bc, filePath, fileName);
      case "gdrive":
      case "azure":
      case "restic":
        // These providers would need additional tooling installed on the host.
        // For now we shell out to rclone if available, otherwise fail helpfully.
        return uploadRclone(bc, filePath, fileName);
      default:
        throw new Error("unknown backup provider: " + bc.provider);
    }
  }

  function uploadLocal(bc, filePath, fileName) {
    const dest = path.resolve(bc.localPath || path.join(CONFIG_DIR, "backups"));
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(filePath, path.join(dest, fileName));
    return { destination: dest + "/" + fileName };
  }

  function uploadS3Compatible(bc, filePath, fileName) {
    // Use the AWS CLI (or compatible) which supports both S3 and Backblaze B2.
    const env = { ...process.env };
    if (bc.accessKey)  env.AWS_ACCESS_KEY_ID     = bc.accessKey  || bc.b2KeyId  || "";
    if (bc.secretKey)  env.AWS_SECRET_ACCESS_KEY  = bc.secretKey  || bc.b2AppKey || "";
    const endpoint = bc.s3Endpoint || (bc.provider === "b2" ? "https://s3.us-west-004.backblazeb2.com" : undefined);
    const bucket = bc.s3Bucket || bc.b2Bucket || "trinity-backups";
    const args = ["s3", "cp", filePath, `s3://${bucket}/${fileName}`];
    if (endpoint) args.push("--endpoint-url", endpoint);
    if (bc.s3Region) args.push("--region", bc.s3Region);

    return new Promise((resolve, reject) => {
      execFile("aws", args, { env, timeout: 300_000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error("aws s3 cp failed: " + (stderr || err.message)));
        resolve({ destination: `s3://${bucket}/${fileName}` });
      });
    });
  }

  function uploadFtp(bc, filePath, fileName) {
    const host = bc.ftpHost || "localhost";
    const port = bc.ftpPort || 21;
    const user = bc.ftpUser || "anonymous";
    const pass = bc.ftpPassword || "";
    const remotePath = (bc.ftpPath || "/") + "/" + fileName;
    const scheme = bc.ftpSecure ? "ftps" : "ftp";
    // Use curl for FTP uploads — universally available.
    const url = `${scheme}://${host}:${port}${remotePath}`;
    const args = ["-T", filePath, "--user", `${user}:${pass}`, url];
    return new Promise((resolve, reject) => {
      execFile("curl", args, { timeout: 300_000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error("ftp upload failed: " + (stderr || err.message)));
        resolve({ destination: url });
      });
    });
  }

  function uploadRclone(bc, filePath, fileName) {
    // rclone is the universal backend for gdrive, azure, restic, etc.
    // The user needs to have rclone configured with a remote named "trinity-backup".
    const remote = bc.rcloneRemote || "trinity-backup";
    const dest = `${remote}:${bc.rclonePath || "trinity-backups"}/${fileName}`;
    return new Promise((resolve, reject) => {
      execFile("rclone", ["copyto", filePath, dest], { timeout: 600_000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error("rclone failed: " + (stderr || err.message) + ". Install rclone and run 'rclone config' to set up the remote."));
        resolve({ destination: dest });
      });
    });
  }

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
  const brain   = new BrainClient(cfg.brainContainerUrl);

  const server = createServer(cfg, token, trinity, brain);
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
      `  Brain URL   : ${cfg.brainContainerUrl}`,
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
