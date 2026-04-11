// Dashboard controller — command & control view.
(function (global) {
  function set(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls !== undefined) el.className = cls;
  }

  async function refresh() {
    // Bridge health
    try {
      const h = await Bridge.health();
      set("stat-bridge", h && h.ok ? "online" : "degraded");
      set("sub-bridge", "uptime " + Math.round((h && h.uptime) || 0) + "s");
    } catch {
      set("stat-bridge", "offline");
      set("sub-bridge", "start: node webapp/bridge/bridge-server.js");
    }

    // Containers
    try {
      const r = await Bridge.containers();
      const names = (r.containers || []).map((c) => c.name);
      set("stat-agent", names.some((n) => n.includes("trinity-agent")) ? "up" : "down");
      set("stat-brain", names.some((n) => n.includes("trinity-brain")) ? "up" : "down");
    } catch {
      set("stat-agent", "?");
      set("stat-brain", "?");
    }

    // Permissions
    try {
      const p = await Bridge.listPermissions();
      const enabled = (p.permissions || []).filter((x) => x.enabled).length;
      set("stat-perms", enabled + " / " + (p.permissions || []).length);
    } catch {
      set("stat-perms", "—");
    }

    // Audit log
    try {
      const l = await Bridge.log(80);
      const box = document.getElementById("log-stream");
      box.innerHTML = "";
      (l.log || []).slice().reverse().forEach((line) => {
        const div = document.createElement("div");
        div.className = "line" + (/fail|error|deny/.test(line.kind) ? " err" : /warn/.test(line.kind) ? " warn" : " ok");
        const { ts, kind, ...rest } = line;
        div.textContent = `[${ts.slice(11, 19)}] ${kind.padEnd(14)} ${JSON.stringify(rest)}`;
        box.appendChild(div);
      });
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
