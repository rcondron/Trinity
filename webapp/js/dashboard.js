// Dashboard controller — command & control view.
// Pulls data from: Bridge health, Gateway WebSocket RPC, Docker containers,
// wallet status, Morpheus sessions.
(function (global) {
  function set(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function escape(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function refresh() {
    // ---- Bridge ----
    try {
      const h = await Bridge.health();
      set("stat-bridge", h && h.ok ? "online" : "degraded");
      set("sub-bridge", "uptime " + Math.round((h && h.uptime) || 0) + "s");
    } catch {
      set("stat-bridge", "offline");
      set("sub-bridge", "start: node webapp/bridge/bridge-server.js");
    }

    // ---- Gateway WebSocket ----
    try {
      const gc = await Bridge.gatewayConnected();
      set("stat-gw", gc.connected ? "connected" : "disconnected");
      set("sub-gw", gc.connected ? "persistent WebSocket active" : "no connection to gateway");
    } catch {
      set("stat-gw", "?");
    }

    // ---- Containers ----
    try {
      const r = await Bridge.containers();
      const containers = r.containers || [];
      const names = containers.map((c) => c.name);
      set("stat-agent", names.some((n) => n.includes("trinity-agent")) ? "up" : "down");
      set("stat-brain", names.some((n) => n.includes("trinity-brain")) ? "up" : "down");
      set("stat-llm",   names.some((n) => n.includes("trinity-llm"))   ? "up" : "down");
      set("sub-llm",    names.some((n) => n.includes("llamacpp")) ? "llama.cpp" : "Ollama");

      // Render container list
      const box = document.getElementById("container-list");
      if (box) {
        box.innerHTML = "";
        if (containers.length === 0) {
          box.innerHTML = "<div class='sub'>No Docker containers running.</div>";
        } else {
          containers.forEach((c) => {
            const row = document.createElement("div");
            row.className = "perm-row";
            row.style.gridTemplateColumns = "1fr 200px 80px";
            const isUp = /up/i.test(c.status || "");
            row.innerHTML = `
              <div class="name">${escape(c.name)}</div>
              <div class="path">${escape(c.image)}</div>
              <div class="status-pill ${isUp ? 'ok' : 'err'}">${isUp ? 'up' : 'down'}</div>
            `;
            box.appendChild(row);
          });
        }
      }
    } catch {
      set("stat-agent", "?");
      set("stat-brain", "?");
      set("stat-llm", "?");
    }

    // ---- Permissions ----
    try {
      const p = await Bridge.listPermissions();
      const enabled = (p.permissions || []).filter((x) => x.enabled).length;
      set("stat-perms", enabled + " / " + (p.permissions || []).length);
    } catch {
      set("stat-perms", "—");
    }

    // ---- Gateway health (model info) ----
    try {
      const gh = await Bridge.gatewayHealth();
      const payload = gh.payload || gh;
      set("stat-model", payload.model || payload.defaultModel || "(unknown)");
      set("sub-model", payload.provider || "");
    } catch {
      set("stat-model", "—");
    }

    // ---- Gateway sessions ----
    try {
      const gs = await Bridge.gatewaySessions();
      const sessions = gs.sessions || gs.payload || [];
      set("stat-sessions", Array.isArray(sessions) ? sessions.length : "?");
    } catch {
      set("stat-sessions", "—");
    }

    // ---- Wallet ----
    try {
      const w = await Bridge.walletStatus();
      if (w.initialized) {
        set("stat-wallet", w.address ? w.address.slice(0, 10) + "…" + w.address.slice(-6) : "configured");
        set("sub-wallet", w.derivedCount + " addresses derived");
      } else {
        set("stat-wallet", "not created");
        set("sub-wallet", "create in onboarding");
      }
    } catch {
      set("stat-wallet", "—");
    }

    // ---- Morpheus sessions ----
    try {
      const ms = await Bridge.listMorpheusSessions();
      const sessions = ms.sessions || [];
      const active = sessions.filter((s) => s.alive).length;
      set("stat-mor-sessions", active + " / " + sessions.length);
      set("sub-mor-sessions", active > 0 ? "persistent sockets active" : "none active");
    } catch {
      set("stat-mor-sessions", "—");
    }

    // ---- Audit log ----
    try {
      const l = await Bridge.log(80);
      const box = document.getElementById("log-stream");
      if (box) {
        box.innerHTML = "";
        (l.log || []).slice().reverse().forEach((line) => {
          const div = document.createElement("div");
          div.className = "line" + (/fail|error|deny/.test(line.kind) ? " err" : /warn/.test(line.kind) ? " warn" : " ok");
          const { ts, kind, ...rest } = line;
          div.textContent = `[${(ts || "").slice(11, 19)}] ${(kind || "").padEnd(14)} ${JSON.stringify(rest)}`;
          box.appendChild(div);
        });
      }
    } catch {
      const box = document.getElementById("log-stream");
      if (box) box.innerHTML = "<div class='line warn'>bridge offline — cannot fetch audit log</div>";
    }
  }

  async function start()   { await Bridge.startAgent().catch(alert);   refresh(); }
  async function stop()    { await Bridge.stopAgent().catch(alert);    refresh(); }
  async function restart() { await Bridge.restartAgent().catch(alert); refresh(); }

  document.addEventListener("DOMContentLoaded", () => {
    refresh();
    setInterval(refresh, 5000);
  });

  global.Dashboard = { refresh, start, stop, restart };
})(window);
