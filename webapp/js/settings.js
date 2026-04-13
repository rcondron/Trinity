// Settings page controller.
// Handles agent config, API keys, container URLs, and backup configuration.
(function (global) {
  function el(id) { return document.getElementById(id); }
  function setPill(id, text, cls) {
    const e = el(id);
    if (!e) return;
    e.textContent = text;
    e.className = "status-pill" + (cls ? " " + cls : "");
  }

  // ======== Load current config into all forms ========
  async function load() {
    try {
      const res = await Bridge.getConfig();
      const c = res.config || {};
      // Agent section
      if (c.accessMode)    el("s-access-mode").value = c.accessMode;
      if (c.name)          el("s-name").value       = c.name;
      if (c.provider)      el("s-provider").value    = c.provider;
      if (c.defaultModel)  el("s-model").value       = c.defaultModel;
      if (c.temperature != null) el("s-temp").value   = c.temperature;
      if (c.maxTokens)     el("s-max-tokens").value  = c.maxTokens;
      if (c.scope)         el("s-scope").value       = c.scope;
      if (c.logLevel)      el("s-loglevel").value    = c.logLevel;
      el("s-brain").checked    = c.brain !== false;
      el("s-morpheus").checked = !!c.morpheus;

      // API keys — the bridge masks stored keys, so only set if present.
      const keys = c.apiKeys || {};
      if (keys.anthropic) el("k-anthropic").value  = keys.anthropic;
      if (keys.openai)    el("k-openai").value     = keys.openai;
      if (keys.google)    el("k-google").value     = keys.google;
      if (keys.morpheus)  el("k-morpheus").value   = keys.morpheus;
      if (keys.custom)    el("k-custom").value     = keys.custom;
      if (keys.customUrl) el("k-custom-url").value = keys.customUrl;

      // Container URLs
      if (c.trinityContainerUrl) el("u-agent").value = c.trinityContainerUrl;
      if (c.brainContainerUrl)   el("u-brain").value = c.brainContainerUrl;
    } catch (e) {
      console.warn("Could not load config:", e.message);
    }

    // Backup config (separate endpoint)
    try {
      const br = await Bridge.getBackupConfig();
      const b = br.backup || {};
      el("b-enabled").checked     = !!b.enabled;
      if (b.schedule)             el("b-schedule").value = b.schedule;
      if (b.retain)               el("b-retain").value   = b.retain;
      if (b.provider)             el("b-provider").value = b.provider;

      // Provider-specific fields
      if (b.localPath)     el("b-localPath").value     = b.localPath;
      if (b.s3Bucket)      el("b-s3Bucket").value      = b.s3Bucket;
      if (b.s3Region)      el("b-s3Region").value      = b.s3Region;
      if (b.s3Endpoint)    el("b-s3Endpoint").value    = b.s3Endpoint;
      if (b.accessKey)     el("b-accessKey").value     = b.accessKey;
      if (b.secretKey)     el("b-secretKey").value     = b.secretKey;
      if (b.b2Bucket)      el("b-b2Bucket").value      = b.b2Bucket;
      if (b.b2KeyId)       el("b-b2KeyId").value       = b.b2KeyId;
      if (b.b2AppKey)      el("b-b2AppKey").value      = b.b2AppKey;
      if (b.ftpHost)       el("b-ftpHost").value       = b.ftpHost;
      if (b.ftpPort)       el("b-ftpPort").value       = b.ftpPort;
      if (b.ftpUser)       el("b-ftpUser").value       = b.ftpUser;
      if (b.ftpPassword)   el("b-ftpPassword").value   = b.ftpPassword;
      if (b.ftpPath)       el("b-ftpPath").value       = b.ftpPath;
      el("b-ftpSecure").checked = !!b.ftpSecure;
      if (b.resticRepo)    el("b-resticRepo").value    = b.resticRepo;
      if (b.resticPassword)el("b-resticPassword").value= b.resticPassword;

      showProviderFields();
    } catch (e) {
      console.warn("Could not load backup config:", e.message);
    }

    loadBackupHistory();

    // Brain model config
    try {
      const bm = await Bridge.getBrainModel();
      if (bm.llm_backend)      el("bm-backend").value        = bm.llm_backend;
      if (bm.llm_url)          el("bm-url").value             = bm.llm_url;
      if (bm.generation_model) el("bm-gen-model").value       = bm.generation_model;
      if (bm.embedding_model)  el("bm-embed-model").value     = bm.embedding_model;
      if (bm.embedding_dim)    el("bm-embed-dim").value       = bm.embedding_dim;
      if (bm.compression_model)el("bm-compress-model").value  = bm.compression_model;
      showLlmBackendHint();
    } catch (e) {
      console.warn("Could not load brain model config:", e.message);
    }

    // Morpheus Compute config
    try {
      const mc = await Bridge.getMorpheusConfig();
      if (mc.rpcUrl)    el("m-rpc").value      = mc.rpcUrl;
      if (mc.walletAddress) setPill("morpheus-status", "wallet: " + mc.walletAddress.slice(0, 10) + "…", "ok");
      el("m-testnet").checked = !!mc.testnet;
      if (mc.autoCloseLeadTimeSec) el("m-autoclose").value = mc.autoCloseLeadTimeSec;
      if (mc.walletConfigured) el("m-key").value = "••••••";
      loadMorpheusSessions();
    } catch (e) {
      console.warn("Could not load Morpheus config:", e.message);
    }
  }

  // ======== Access mode hint ========
  function showAccessModeHint() {
    const mode = el("s-access-mode").value;
    const hint = el("access-mode-hint");
    if (!hint) return;
    if (mode === "mor-token") {
      hint.style.display = "block";
      hint.className = "callout info";
      hint.innerHTML =
        "<strong>MOR Token mode.</strong> " +
        "On gateway startup Trinity will stake MOR tokens to the Morpheus compute contract on Base " +
        "and open a persistent session with an on-chain LLM provider. The session's TCP socket stays " +
        "open for the full session duration — no per-request connections. " +
        "Configure your wallet and session details in the <b>Morpheus Compute</b> section below. " +
        "You do NOT need an API key when using MOR token mode.";
    } else {
      hint.style.display = "block";
      hint.className = "callout info";
      hint.innerHTML =
        "<strong>API Key mode.</strong> " +
        "Traditional provider access using an API key (Anthropic, OpenAI, Google, etc.). " +
        "Configure your API keys in the <b>API Keys</b> section below. " +
        "No MOR tokens or blockchain interaction required.";
    }
  }

  // ======== Save agent settings ========
  async function saveAgent(ev) {
    ev.preventDefault();
    setPill("agent-status", "saving…");
    try {
      await Bridge.saveConfig({
        name:         el("s-name").value.trim()      || undefined,
        accessMode:   el("s-access-mode").value       || "api-key",
        provider:     el("s-provider").value          || undefined,
        defaultModel: el("s-model").value.trim()      || undefined,
        temperature:  el("s-temp").value !== "" ? parseFloat(el("s-temp").value) : undefined,
        maxTokens:    el("s-max-tokens").value !== "" ? parseInt(el("s-max-tokens").value, 10) : undefined,
        scope:        el("s-scope").value              || undefined,
        brain:        el("s-brain").checked,
        morpheus:     el("s-morpheus").checked,
        logLevel:     el("s-loglevel").value            || undefined,
      });
      setPill("agent-status", "saved", "ok");
    } catch (e) {
      setPill("agent-status", e.message, "err");
    }
    return false;
  }

  // ======== Save API keys ========
  async function saveKeys(ev) {
    ev.preventDefault();
    setPill("keys-status", "saving…");
    const apiKeys = {};
    const ids = { anthropic: "k-anthropic", openai: "k-openai", google: "k-google", morpheus: "k-morpheus", custom: "k-custom", customUrl: "k-custom-url" };
    for (const [key, id] of Object.entries(ids)) {
      const v = el(id).value.trim();
      if (v && v !== "••••••") apiKeys[key] = v;
    }
    try {
      await Bridge.saveConfig({ apiKeys });
      setPill("keys-status", "saved", "ok");
    } catch (e) {
      setPill("keys-status", e.message, "err");
    }
    return false;
  }

  // ======== Save container URLs ========
  async function saveUrls(ev) {
    ev.preventDefault();
    setPill("urls-status", "saving…");
    try {
      await Bridge.saveConfig({
        trinityContainerUrl: el("u-agent").value.trim() || undefined,
        brainContainerUrl:   el("u-brain").value.trim()  || undefined,
      });
      setPill("urls-status", "saved", "ok");
    } catch (e) {
      setPill("urls-status", e.message, "err");
    }
    return false;
  }

  // ======== Backup config ========
  function showProviderFields() {
    const provider = el("b-provider").value;
    document.querySelectorAll(".provider-fields").forEach((pf) => {
      pf.style.display = "none";
    });
    const target = document.getElementById("pf-" + provider);
    if (target) target.style.display = "block";
  }

  async function saveBackup(ev) {
    ev.preventDefault();
    setPill("backup-status", "saving…");

    // Collect common fields.
    const body = {
      enabled:  el("b-enabled").checked,
      schedule: el("b-schedule").value,
      retain:   parseInt(el("b-retain").value, 10) || 7,
      provider: el("b-provider").value,
    };

    // Collect all provider-specific fields — the bridge only stores whitelisted keys.
    const providerFields = [
      "localPath",
      "s3Bucket", "s3Region", "s3Endpoint", "accessKey", "secretKey",
      "b2Bucket", "b2KeyId", "b2AppKey",
      "ftpHost", "ftpPort", "ftpUser", "ftpPassword", "ftpPath",
      "resticRepo", "resticPassword",
    ];
    for (const f of providerFields) {
      const input = el("b-" + f);
      if (input && input.value.trim()) body[f] = input.value.trim();
    }
    body.ftpSecure = el("b-ftpSecure").checked;

    try {
      await Bridge.saveBackupConfig(body);
      setPill("backup-status", "saved", "ok");
    } catch (e) {
      setPill("backup-status", e.message, "err");
    }
    return false;
  }

  async function runBackupNow() {
    setPill("backup-status", "running backup…");
    try {
      const res = await Bridge.runBackup();
      setPill("backup-status", "backup complete: " + (res.archive || "ok"), "ok");
      loadBackupHistory();
    } catch (e) {
      setPill("backup-status", e.message, "err");
    }
  }

  async function loadBackupHistory() {
    const box = el("backup-log");
    if (!box) return;
    try {
      const res = await Bridge.backupHistory();
      const history = res.history || [];
      box.innerHTML = "";
      if (history.length === 0) {
        box.innerHTML = "<div class='line'>No backup events yet.</div>";
        return;
      }
      history.slice().reverse().forEach((line) => {
        const div = document.createElement("div");
        const isErr = /fail/.test(line.kind);
        const isOk  = /ok|start/.test(line.kind);
        div.className = "line" + (isErr ? " err" : isOk ? " ok" : "");
        const { ts, kind, ...rest } = line;
        div.textContent = `[${(ts || "").slice(11, 19)}] ${(kind || "").padEnd(20)} ${JSON.stringify(rest)}`;
        box.appendChild(div);
      });
    } catch {
      box.innerHTML = "<div class='line warn'>Could not load backup history.</div>";
    }
  }

  // ======== Brain model ========
  function showLlmBackendHint() {
    const backend = el("bm-backend").value;
    const hint = el("bm-hint");
    if (!hint) return;
    if (backend === "openai") {
      hint.style.display = "block";
      hint.className = "callout info";
      hint.innerHTML =
        '<strong>llama.cpp / OpenAI-compatible mode.</strong> ' +
        'Make sure the server URL points to the llama.cpp <code>--port</code> (default 8080). ' +
        'The brain uses <code>/v1/chat/completions</code> and <code>/v1/embeddings</code>. ' +
        'Start the compose with <code>TRINITY_LLM=llamacpp docker compose up -d</code> or ' +
        'point to any OpenAI-compatible endpoint.';
    } else {
      hint.style.display = "none";
    }
  }

  async function saveBrainModel(ev) {
    ev.preventDefault();
    setPill("brain-model-status", "saving…");
    try {
      await Bridge.saveBrainModel({
        llm_backend:       el("bm-backend").value,
        llm_url:           el("bm-url").value.trim() || undefined,
        generation_model:  el("bm-gen-model").value.trim() || undefined,
        embedding_model:   el("bm-embed-model").value.trim() || undefined,
        embedding_dim:     parseInt(el("bm-embed-dim").value, 10) || 768,
        compression_model: el("bm-compress-model").value.trim() || undefined,
      });
      setPill("brain-model-status", "saved — restart brain container to apply", "ok");
    } catch (e) {
      setPill("brain-model-status", e.message, "err");
    }
    return false;
  }

  const MODEL_PRESETS = {
    "ollama-qwen": {
      backend: "ollama", url: "http://trinity-llm:11434",
      gen: "qwen2.5:7b", embed: "nomic-embed-text", dim: 768, compress: "qwen2.5:7b",
    },
    "ollama-qwen-14b": {
      backend: "ollama", url: "http://trinity-llm:11434",
      gen: "qwen2.5:14b", embed: "nomic-embed-text", dim: 768, compress: "qwen2.5:14b",
    },
    "ollama-llama3": {
      backend: "ollama", url: "http://trinity-llm:11434",
      gen: "llama3.1:8b", embed: "nomic-embed-text", dim: 768, compress: "llama3.1:8b",
    },
    "ollama-phi4": {
      backend: "ollama", url: "http://trinity-llm:11434",
      gen: "phi4:latest", embed: "nomic-embed-text", dim: 768, compress: "phi4:latest",
    },
    "llamacpp-qwen": {
      backend: "openai", url: "http://trinity-llm:8080",
      gen: "qwen2.5-7b-instruct-q4_k_m", embed: "qwen2.5-7b-instruct-q4_k_m", dim: 768,
      compress: "qwen2.5-7b-instruct-q4_k_m",
    },
    "llamacpp-llama3": {
      backend: "openai", url: "http://trinity-llm:8080",
      gen: "llama-3.1-8b-instruct-q4_k_m", embed: "llama-3.1-8b-instruct-q4_k_m", dim: 768,
      compress: "llama-3.1-8b-instruct-q4_k_m",
    },
  };

  function applyModelPreset(name) {
    const p = MODEL_PRESETS[name];
    if (!p) return;
    el("bm-backend").value      = p.backend;
    el("bm-url").value           = p.url;
    el("bm-gen-model").value     = p.gen;
    el("bm-embed-model").value   = p.embed;
    el("bm-embed-dim").value     = p.dim;
    el("bm-compress-model").value= p.compress;
    showLlmBackendHint();
    setPill("brain-model-status", "preset applied — click save", "warn");
  }

  // ======== Morpheus Compute ========
  async function saveMorpheus(ev) {
    ev.preventDefault();
    setPill("morpheus-status", "saving…");
    try {
      await Bridge.saveMorpheusConfig({
        rpcUrl:               el("m-rpc").value.trim() || undefined,
        privateKey:           el("m-key").value.trim() || undefined,
        testnet:              el("m-testnet").checked,
        autoCloseLeadTimeSec: parseInt(el("m-autoclose").value, 10) || 120,
      });
      setPill("morpheus-status", "saved", "ok");
    } catch (e) {
      setPill("morpheus-status", e.message, "err");
    }
    return false;
  }

  function escape(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function loadMorpheusSessions() {
    const container = document.getElementById("morpheus-sessions");
    if (!container) return;
    try {
      const res = await Bridge.listMorpheusSessions();
      const sessions = res.sessions || [];
      if (sessions.length === 0) {
        container.innerHTML = "<div class='sub'>No active sessions. Open sessions from the Trinity agent by selecting a Morpheus model.</div>";
        return;
      }
      container.innerHTML = "";
      for (const s of sessions) {
        const timeLeft = s.endsAt ? Math.max(0, s.endsAt - Math.floor(Date.now() / 1000)) : 0;
        const mins = Math.floor(timeLeft / 60);
        const row = document.createElement("div");
        row.className = "perm-row";
        row.style.gridTemplateColumns = "1fr 140px 100px 80px";
        row.innerHTML = `
          <div>
            <div class="name">${escape(s.modelName || s.modelId?.slice(0, 16) + "…")}</div>
            <div class="path">${escape(s.endpoint)} · ${s.requestCount} reqs · ${Math.round(s.bytesReceived / 1024)} KB</div>
          </div>
          <div class="mode">${escape(s.provider?.slice(0, 10))}…</div>
          <div class="status-pill ${s.alive ? 'ok' : 'err'}">${s.alive ? mins + 'm left' : 'closed'}</div>
          <div class="path">${escape(s.stakeAmount)} MOR</div>
        `;
        container.appendChild(row);
      }
    } catch (e) {
      container.innerHTML = "<div class='sub'>Could not load sessions: " + escape(e.message) + "</div>";
    }
  }

  // ======== Init ========
  document.addEventListener("DOMContentLoaded", () => {
    load();
  });

  global.Settings = {
    saveAgent, saveKeys, saveUrls,
    saveBackup, runBackupNow,
    showProviderFields,
    saveBrainModel, showLlmBackendHint, applyModelPreset,
    saveMorpheus, showAccessModeHint,
    load,
  };
})(window);
