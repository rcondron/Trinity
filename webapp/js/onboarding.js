// Onboarding flow controller for StartHere.html
(function (global) {
  const TOTAL_STEPS = 7;
  const STATE_KEY = "trinity.onboarding.state";

  const state = {
    current: 1,
    docker: "pending",
    containers: "pending",
    paired: false,
    config: null,
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
      Object.assign(state, saved);
    } catch {}
  }
  function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function show(step) {
    state.current = Math.max(1, Math.min(TOTAL_STEPS, step));
    document.querySelectorAll(".step-panel").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.panel) === state.current);
    });
    document.querySelectorAll(".stepper .step").forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle("active", n === state.current);
      el.classList.toggle("done",   n <  state.current);
    });
    if (state.current === TOTAL_STEPS) renderSummary();
    saveState();
  }

  function next() { show(state.current + 1); }
  function prev() { show(state.current - 1); }

  function setPill(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = "status-pill" + (cls ? " " + cls : "");
  }

  async function checkDocker() {
    setPill("docker-status", "checking…");
    try {
      const r = await Bridge.dockerStatus();
      if (r && r.installed) {
        state.docker = "ok";
        setPill("docker-status", "Docker " + (r.version || "ok"), "ok");
      } else {
        state.docker = "missing";
        setPill("docker-status", "not found", "err");
      }
    } catch (e) {
      state.docker = "unknown";
      setPill("docker-status", e.code === "BRIDGE_DOWN" ? "bridge offline" : "check failed", "warn");
    }
    saveState();
  }

  async function checkContainers() {
    setPill("containers-status", "checking…");
    try {
      const r = await Bridge.containers();
      const names = (r && r.containers ? r.containers.map((c) => c.name) : []);
      const hasAgent = names.some((n) => n.includes("trinity-agent"));
      const hasBrain = names.some((n) => n.includes("trinity-brain"));
      if (hasAgent && hasBrain) {
        state.containers = "ok";
        setPill("containers-status", "agent + brain up", "ok");
      } else if (hasAgent || hasBrain) {
        state.containers = "partial";
        setPill("containers-status", "partial (" + names.length + " up)", "warn");
      } else {
        state.containers = "missing";
        setPill("containers-status", "no trinity containers", "err");
      }
    } catch (e) {
      setPill("containers-status", e.code === "BRIDGE_DOWN" ? "bridge offline" : "check failed", "warn");
    }
    saveState();
  }

  async function pairBridge() {
    const token = (document.getElementById("pair-token").value || "").trim();
    if (!token) {
      setPill("pair-status", "token required", "err");
      return;
    }
    setPill("pair-status", "pairing…");
    try {
      await Bridge.pair(token);
      state.paired = true;
      setPill("pair-status", "paired", "ok");
    } catch (e) {
      state.paired = false;
      setPill("pair-status", e.code === "BRIDGE_DOWN" ? "bridge offline" : "invalid token", "err");
    }
    saveState();
  }

  function saveConfig(ev) {
    ev.preventDefault();
    const cfg = {
      name:      document.getElementById("cfg-name").value,
      provider:  document.getElementById("cfg-provider").value,
      apiKey:    document.getElementById("cfg-apikey").value,
      scope:     document.getElementById("cfg-scope").value,
      brain:     document.getElementById("cfg-brain").checked,
      morpheus:  document.getElementById("cfg-morpheus").checked,
    };
    state.config = { ...cfg, apiKey: cfg.apiKey ? "••••••" : "" };
    saveState();
    // Try to persist on the bridge; fall back to local-only if bridge isn't reachable.
    Bridge.saveConfig(cfg).catch(() => { /* webapp-only mode */ }).finally(() => next());
    return false;
  }

  function renderSummary() {
    const s = document.getElementById("summary");
    if (!s) return;
    const c = state.config || {};
    s.innerHTML = [
      ["Docker",       state.docker],
      ["Containers",   state.containers],
      ["Bridge",       state.paired ? "paired" : "not paired"],
      ["Agent name",   c.name || "(unset)"],
      ["Model",        c.provider || "(unset)"],
      ["Scope",        c.scope || "(unset)"],
      ["Trinity Brain", c.brain ? "enabled" : "disabled"],
      ["Morpheus",     c.morpheus ? "registered" : "off"],
    ].map(([k, v]) => `<div><b>${k}</b>: ${v}</div>`).join("");
  }

  async function launch() {
    const btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = "⚡ Launching…"; }
    try {
      await Bridge.startAgent();
      if (btn) btn.textContent = "✓ Trinity is online";
      setTimeout(() => { window.location.href = "pages/dashboard.html"; }, 900);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "⚡ Start Trinity"; }
      alert("Could not start Trinity: " + (e && e.message ? e.message : "unknown error"));
    }
  }

  // Tabs (platform selector in step 3)
  function initTabs() {
    document.querySelectorAll(".tabs").forEach((tabs) => {
      tabs.addEventListener("click", (e) => {
        const t = e.target.closest(".tab");
        if (!t) return;
        const targetId = t.dataset.tab;
        tabs.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
        document.querySelectorAll(".tab-panel").forEach((p) => {
          p.classList.toggle("active", p.id === targetId);
        });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadState();
    show(state.current || 1);
    initTabs();
  });

  global.Onboarding = {
    next, prev, show,
    checkDocker, checkContainers,
    pairBridge, saveConfig, launch,
  };
})(window);
