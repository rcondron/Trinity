// Onboarding flow controller for Setup.html
(function (global) {
  const TOTAL_STEPS = 8;
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
    if (state.current === 7) checkWalletExists();
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
    var hint = document.getElementById("docker-hint");
    if (hint) hint.style.display = "none";
    try {
      var r = await Bridge.dockerStatus();
      if (r && r.installed) {
        state.docker = "ok";
        setPill("docker-status", "Docker " + (r.version || "ok"), "ok");
      } else {
        state.docker = "missing";
        setPill("docker-status", "not found", "err");
      }
    } catch (e) {
      if (e.code === "BRIDGE_DOWN") {
        // Bridge isn't running yet — that's normal at this step.
        // Tell the user to verify Docker manually for now.
        state.docker = "manual";
        setPill("docker-status", "verify manually", "warn");
        if (hint) {
          hint.style.display = "block";
          hint.className = "callout warn";
          hint.innerHTML =
            "<strong>Bridge not running yet.</strong> " +
            "The Docker check requires the Bridge (set up in step 5). " +
            "For now, verify Docker is installed by running " +
            "<code>docker --version</code> in your terminal. " +
            "You can re-check after starting the Bridge.";
        }
      } else {
        state.docker = "unknown";
        setPill("docker-status", "check failed", "warn");
      }
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
      if (e.code === "BRIDGE_DOWN") {
        setPill("containers-status", "start Bridge first (step 5)", "warn");
      } else {
        setPill("containers-status", "check failed", "warn");
      }
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

  async function createWallet() {
    const pass  = (document.getElementById("wallet-pass")  || {}).value || "";
    const pass2 = (document.getElementById("wallet-pass2") || {}).value || "";
    if (pass.length < 8) { setPill("wallet-status", "8+ characters required", "err"); return; }
    if (pass !== pass2) { setPill("wallet-status", "passphrases don't match", "err"); return; }

    setPill("wallet-status", "generating…");
    try {
      const res = await Bridge.createWallet(pass, 3);
      state.wallet = res.addresses[0].address;
      saveState();

      // Show the mnemonic ONCE.
      document.getElementById("wallet-create-form").style.display = "none";
      const mnDisplay = document.getElementById("wallet-mnemonic-display");
      mnDisplay.style.display = "block";
      document.getElementById("wallet-mnemonic").textContent = res.mnemonic;

      const addrList = document.getElementById("wallet-addresses");
      addrList.innerHTML = "";
      (res.addresses || []).forEach(function (a) {
        const row = document.createElement("div");
        row.className = "perm-row";
        row.style.gridTemplateColumns = "60px 1fr 140px";
        row.innerHTML =
          "<div class='mode'>#" + a.index + "</div>" +
          "<div class='path' style='font-size:13px;'>" + a.address + "</div>" +
          "<div class='name'>" + a.label + "</div>";
        addrList.appendChild(row);
      });

      setPill("wallet-status", "created", "ok");
    } catch (e) {
      setPill("wallet-status", e.message || "failed", "err");
    }
  }

  async function checkWalletExists() {
    try {
      const res = await Bridge.walletStatus();
      if (res.initialized) {
        state.wallet = res.address;
        var existing = document.getElementById("wallet-existing");
        if (existing) {
          existing.style.display = "block";
          document.getElementById("wallet-existing-addr").textContent = "Address: " + res.address;
          document.getElementById("wallet-create-form").style.display = "none";
        }
      }
    } catch { /* bridge offline */ }
  }

  function renderSummary() {
    const s = document.getElementById("summary");
    if (!s) return;
    const c = state.config || {};
    s.innerHTML = [
      ["Docker",       state.docker],
      ["Containers",   state.containers],
      ["Bridge",       state.paired ? "paired" : "not paired"],
      ["Wallet",       state.wallet || "(not created)"],
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
    pairBridge, saveConfig, createWallet, launch,
  };
})(window);
