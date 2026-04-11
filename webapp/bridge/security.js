// security.js
// Permission store + decision engine for the Trinity Bridge.
//
// A "permission" is an allow-list entry that specifies:
//   - what path or host resource the agent may touch
//   - what operation it may perform (read, write, exec, network, device)
//   - an optional mode: "ro" (read-only), "rw" (read-write), "exec"
//
// The bridge checks every /access request against this list. Anything not
// explicitly allowed is DENIED. This is the security boundary that keeps the
// Trinity container isolated from the rest of the host.

const fs    = require("fs");
const path  = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const DEFAULT_PERMS = [
  // Workspace folder is the one safe default. Everything else must be explicit.
  { id: "default-workspace",
    kind: "fs",
    name: "Workspace folder",
    path: path.resolve(process.cwd(), "workspace"),
    mode: "rw",
    enabled: true,
    builtin: true },
];

function loadPermissions(file) {
  let list = DEFAULT_PERMS.slice();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) list = parsed;
    }
  } catch {
    // fall through with defaults
  }

  function persist() {
    try { fs.writeFileSync(file, JSON.stringify(list, null, 2), { mode: 0o600 }); } catch {}
  }

  function genId() {
    return "perm_" + crypto.randomBytes(6).toString("hex");
  }

  return {
    list() { return list.slice(); },

    add(input) {
      const perm = {
        id:      input.id || genId(),
        kind:    input.kind || "fs",
        name:    input.name || input.path || "unnamed",
        path:    input.path ? path.resolve(input.path) : null,
        host:    input.host || null,
        port:    input.port || null,
        command: input.command || null,
        mode:    input.mode || "ro",
        enabled: input.enabled !== false,
        builtin: false,
        createdAt: new Date().toISOString(),
      };
      list.push(perm);
      persist();
      return perm;
    },

    remove(id) {
      const idx = list.findIndex((p) => p.id === id);
      if (idx >= 0 && !list[idx].builtin) { list.splice(idx, 1); persist(); }
    },

    update(id, patch) {
      const p = list.find((x) => x.id === id);
      if (!p) return null;
      if ("enabled" in patch) p.enabled = !!patch.enabled;
      persist();
      return p;
    },

    // The decision engine: given a request body (permId + op + params),
    // return { allow: boolean, reason, permission }.
    check(body) {
      if (!body || !body.permId) return { allow: false, reason: "permId missing" };
      const p = list.find((x) => x.id === body.permId);
      if (!p)            return { allow: false, reason: "unknown perm" };
      if (!p.enabled)    return { allow: false, reason: "perm disabled" };

      const op = String(body.op || "").toLowerCase();

      if (p.kind === "fs") {
        const target = body.path ? path.resolve(body.path) : null;
        if (!target)                                  return { allow: false, reason: "path required" };
        if (!withinBase(target, p.path))              return { allow: false, reason: "path outside allowed root" };
        if ((op === "write" || op === "delete") && p.mode !== "rw")
                                                       return { allow: false, reason: "perm is read-only" };
        if (!["read", "list", "write", "delete"].includes(op))
                                                       return { allow: false, reason: "unsupported fs op" };
      } else if (p.kind === "exec") {
        if (op !== "run")                             return { allow: false, reason: "exec perm only supports op=run" };
        if (!p.command)                               return { allow: false, reason: "no command bound" };
      } else if (p.kind === "net") {
        if (op !== "fetch")                           return { allow: false, reason: "net perm only supports op=fetch" };
      } else if (p.kind === "device") {
        if (op !== "open")                            return { allow: false, reason: "device perm only supports op=open" };
      } else {
        return { allow: false, reason: "unknown kind" };
      }

      return { allow: true, permission: p };
    },
  };
}

function withinBase(target, base) {
  if (!base) return false;
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Execute the (already-authorised) action.
// Kept small and auditable.
async function execute(body, perm) {
  const op = String(body.op || "").toLowerCase();

  if (perm.kind === "fs") {
    const target = path.resolve(body.path);
    if (op === "read") {
      const content = fs.readFileSync(target, "utf8");
      return { op, path: target, bytes: content.length, content };
    }
    if (op === "list") {
      const entries = fs.readdirSync(target, { withFileTypes: true }).map((d) => ({
        name: d.name, dir: d.isDirectory(),
      }));
      return { op, path: target, entries };
    }
    if (op === "write") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(body.content || ""));
      return { op, path: target, bytes: String(body.content || "").length };
    }
    if (op === "delete") {
      fs.unlinkSync(target);
      return { op, path: target };
    }
  }

  if (perm.kind === "exec") {
    return new Promise((resolve, reject) => {
      // The command is pre-bound on the permission — the caller can only pass
      // extra arguments, they cannot swap out the binary. This keeps the
      // attack surface small.
      const args = Array.isArray(body.args) ? body.args.map(String) : [];
      execFile(perm.command, args, { timeout: 60_000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(err.message));
        resolve({ op: "run", stdout: String(stdout || ""), stderr: String(stderr || "") });
      });
    });
  }

  if (perm.kind === "net") {
    const url = String(body.url || "");
    if (!url.startsWith(perm.host)) throw new Error("url outside allowed host");
    const res = await fetch(url);
    const text = await res.text();
    return { op: "fetch", status: res.status, body: text.slice(0, 100_000) };
  }

  if (perm.kind === "device") {
    // Stub: real device access would be platform-specific.
    return { op: "open", device: perm.name, ok: true };
  }

  throw new Error("unreachable");
}

module.exports = { loadPermissions, execute };
