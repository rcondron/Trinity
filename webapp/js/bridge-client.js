// BridgeClient
// Talks to the Trinity Bridge running on the host (http://127.0.0.1:4711 by default).
// The Bridge is the ONLY way the webapp communicates with the Trinity container.
// Every request is stamped with the pairing token stored in localStorage.
(function (global) {
  const DEFAULT_URL = "http://127.0.0.1:4711";
  const TOKEN_KEY = "trinity.bridge.token";
  const URL_KEY = "trinity.bridge.url";

  class BridgeClient {
    constructor() {
      this.baseUrl = localStorage.getItem(URL_KEY) || DEFAULT_URL;
      this.token = localStorage.getItem(TOKEN_KEY) || null;
    }

    setBaseUrl(url) {
      this.baseUrl = url;
      localStorage.setItem(URL_KEY, url);
    }

    setToken(token) {
      this.token = token;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    }

    headers() {
      const h = { "Content-Type": "application/json" };
      if (this.token) h["X-Trinity-Token"] = this.token;
      return h;
    }

    async _request(method, path, body) {
      const opts = { method, headers: this.headers() };
      if (body !== undefined) opts.body = JSON.stringify(body);
      try {
        const res = await fetch(this.baseUrl + path, opts);
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!res.ok) {
          const err = new Error((data && data.error) || res.statusText);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      } catch (e) {
        // Normalise network errors so callers can show a friendly message.
        if (e.name === "TypeError") {
          const err = new Error("Bridge unreachable at " + this.baseUrl);
          err.code = "BRIDGE_DOWN";
          throw err;
        }
        throw e;
      }
    }

    // ---- Health / status ----
    health()           { return this._request("GET",  "/health"); }
    status()           { return this._request("GET",  "/status"); }
    dockerStatus()     { return this._request("GET",  "/docker/status"); }
    containers()      { return this._request("GET",  "/containers"); }

    // ---- Pairing ----
    pair(token) {
      // The token is sent as the request body and (on success) stored for future calls.
      return this._request("POST", "/pair", { token }).then((r) => {
        this.setToken(token);
        return r;
      });
    }
    unpair() {
      this.setToken(null);
      return { ok: true };
    }

    // ---- Chat relay ----
    // The bridge forwards the prompt to the trinity-agent container and streams the reply.
    chat(message, conversationId) {
      return this._request("POST", "/chat", { message, conversationId });
    }
    chatHistory(conversationId) {
      return this._request("GET", "/chat/history?id=" + encodeURIComponent(conversationId || "default"));
    }

    // ---- Permissions / access control ----
    listPermissions()            { return this._request("GET",    "/permissions"); }
    addPermission(perm)          { return this._request("POST",   "/permissions", perm); }
    removePermission(id)         { return this._request("DELETE", "/permissions/" + id); }
    togglePermission(id, enabled){ return this._request("PATCH",  "/permissions/" + id, { enabled }); }

    // ---- Audit log ----
    log(limit = 100)     { return this._request("GET", "/log?limit=" + limit); }

    // ---- Agent config / settings ----
    saveConfig(cfg)      { return this._request("POST", "/config", cfg); }
    getConfig()          { return this._request("GET",  "/config"); }

    // ---- Backup ----
    getBackupConfig()          { return this._request("GET",  "/backup/config"); }
    saveBackupConfig(cfg)      { return this._request("POST", "/backup/config", cfg); }
    runBackup()                { return this._request("POST", "/backup/run"); }
    backupHistory()            { return this._request("GET",  "/backup/history"); }

    // ---- Brain model management ----
    getBrainModel()            { return this._request("GET",  "/brain/model"); }
    saveBrainModel(cfg)        { return this._request("POST", "/brain/model", cfg); }

    // ---- Morpheus Compute ----
    getMorpheusConfig()        { return this._request("GET",  "/morpheus/config"); }
    saveMorpheusConfig(cfg)    { return this._request("POST", "/morpheus/config", cfg); }
    listMorpheusSessions()     { return this._request("GET",  "/morpheus/sessions"); }
    getMorpheusSession(id)     { return this._request("GET",  "/morpheus/sessions/" + id); }
    morpheusChat(id, message)  { return this._request("POST", "/morpheus/sessions/" + id + "/chat", { message }); }

    // ---- Lifecycle control ----
    startAgent()         { return this._request("POST", "/agent/start"); }
    stopAgent()          { return this._request("POST", "/agent/stop"); }
    restartAgent()       { return this._request("POST", "/agent/restart"); }

    // ---- Skills (relayed to trinity-brain) ----
    // All skills live in the trinity-brain container. There is no bundled
    // on-disk skill folder; the agent learns and updates them over time.
    skillsStatus()            { return this._request("GET",  "/skills/status"); }
    recallSkills(body)        { return this._request("POST", "/skills/recall", body); }
    addSkill(skill)           { return this._request("POST", "/skills",         skill); }
    learnSkill(skill)         { return this._request("POST", "/skills/learn",   skill); }
    markSkillSuccess(id)      { return this._request("POST", "/skills/" + id + "/success"); }
    markSkillFailure(id)      { return this._request("POST", "/skills/" + id + "/fail"); }
    evolveSkill(id, skill)    { return this._request("POST", "/skills/" + id + "/evolve", skill); }
  }

  global.Bridge = new BridgeClient();

  // Heartbeat indicator in the footer (if present).
  function updateIndicator() {
    const el = document.getElementById("bridge-indicator");
    if (!el) return;
    global.Bridge.health().then((r) => {
      el.textContent = "Bridge: " + (r && r.ok ? "online" : "degraded");
      el.className = "status-pill " + (r && r.ok ? "ok" : "warn");
    }).catch(() => {
      el.textContent = "Bridge: offline";
      el.className = "status-pill err";
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateIndicator();
    setInterval(updateIndicator, 10000);
  });
})(window);
