// Access control UI.
// Manages the bridge's allow-list of host resources the Trinity container may touch.
(function (global) {
  async function refresh() {
    const container = document.getElementById("perm-list");
    container.innerHTML = "";
    try {
      const res = await Bridge.listPermissions();
      const perms = res.permissions || [];
      if (perms.length === 0) {
        container.innerHTML = "<div class='sub'>No permissions yet. Grant one above.</div>";
        return;
      }
      for (const p of perms) {
        const row = document.createElement("div");
        row.className = "perm-row";
        row.innerHTML = `
          <div>
            <div class="name">${escape(p.name)}${p.builtin ? " <small style='color:var(--text-dim)'>(built-in)</small>" : ""}</div>
            <div class="path">${escape(p.path || p.host || p.command || "")}</div>
          </div>
          <div class="mode">${escape(p.kind)} · ${escape(p.mode)}</div>
          <div class="toggle ${p.enabled ? "on" : ""}" data-id="${p.id}"></div>
          <button class="btn ghost" data-remove="${p.id}" ${p.builtin ? "disabled" : ""}>✕</button>
        `;
        container.appendChild(row);
      }

      container.querySelectorAll(".toggle").forEach((t) => {
        t.addEventListener("click", async () => {
          const id = t.dataset.id;
          const enabled = !t.classList.contains("on");
          await Bridge.togglePermission(id, enabled).catch(alert);
          refresh();
        });
      });
      container.querySelectorAll("[data-remove]").forEach((b) => {
        b.addEventListener("click", async () => {
          if (b.disabled) return;
          if (!confirm("Remove this permission?")) return;
          await Bridge.removePermission(b.dataset.remove).catch(alert);
          refresh();
        });
      });
    } catch (e) {
      container.innerHTML = "<div class='sub'>Bridge offline. Start it with <code>node webapp/bridge/bridge-server.js</code>.</div>";
    }
  }

  function escape(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function add(ev) {
    ev.preventDefault();
    const body = {
      kind: "fs",
      name: document.getElementById("p-name").value.trim(),
      path: document.getElementById("p-path").value.trim(),
      mode: document.getElementById("p-mode").value,
      enabled: true,
    };
    if (!body.name || !body.path) return false;
    try {
      await Bridge.addPermission(body);
      document.getElementById("p-name").value = "";
      document.getElementById("p-path").value = "";
      refresh();
    } catch (e) {
      alert("Could not add permission: " + e.message);
    }
    return false;
  }

  async function addPreset(kind) {
    let body;
    if (kind === "workspace")  body = { kind: "fs", name: "Workspace",  path: "./workspace", mode: "rw", enabled: true };
    if (kind === "docs")       body = { kind: "fs", name: "Docs",       path: "./docs",      mode: "ro", enabled: true };
    if (kind === "downloads")  body = { kind: "fs", name: "Downloads",  path: "~/Downloads", mode: "ro", enabled: true };
    if (!body) return;
    try { await Bridge.addPermission(body); refresh(); }
    catch (e) { alert(e.message); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    refresh();
  });

  global.Access = { refresh, add, addPreset };
})(window);
