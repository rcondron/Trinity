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
  }

  // ======== Save agent settings ========
  async function saveAgent(ev) {
    ev.preventDefault();
    setPill("agent-status", "saving…");
    try {
      await Bridge.saveConfig({
        name:         el("s-name").value.trim()      || undefined,
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

  // ======== Init ========
  document.addEventListener("DOMContentLoaded", () => {
    load();
  });

  global.Settings = {
    saveAgent, saveKeys, saveUrls,
    saveBackup, runBackupNow,
    showProviderFields,
    load,
  };
})(window);
