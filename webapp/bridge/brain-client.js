// brain-client.js
// Thin HTTP client for the trinity-brain container (FastAPI, :8100).
// The bridge uses this to store and retrieve skills from the brain — the
// bundled skills/ folder has been removed, so ALL skills live in the brain and
// evolve as the agent learns.

const http  = require("http");
const https = require("https");
const { URL } = require("url");

class BrainClient {
  constructor(baseUrl) {
    this.baseUrl = (baseUrl || "http://127.0.0.1:8100").replace(/\/+$/, "");
  }

  _request(method, pathname, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(this.baseUrl + pathname);
      const lib = u.protocol === "https:" ? https : http;
      const payload = body === undefined ? null : JSON.stringify(body);
      const headers = { "Accept": "application/json" };
      if (payload !== null) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(payload);
      }
      const req = lib.request({
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers,
        timeout: 60_000,
      }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(data ? JSON.parse(data) : {}); }
            catch { resolve({ raw: data }); }
          } else {
            reject(new Error("brain " + res.statusCode + ": " + data.slice(0, 300)));
          }
        });
      });
      req.on("error", (e) => {
        // Friendly error when the brain container isn't up yet.
        if (e.code === "ECONNREFUSED") return reject(new Error("trinity-brain unreachable at " + this.baseUrl));
        reject(e);
      });
      req.on("timeout", () => req.destroy(new Error("trinity-brain timeout")));
      if (payload !== null) req.write(payload);
      req.end();
    });
  }

  // ---- Skill operations (backed by trinity-brain /v2/skills) ----

  // Store a new skill in the brain.
  // A minimal skill body: { name, description, content, domains?, tools_used?, triggers? }
  ingestSkill(skill) {
    const body = {
      name:         String(skill.name || "").slice(0, 200),
      description:  String(skill.description || "").slice(0, 2000),
      content:      String(skill.content || ""),
      kind:         skill.kind   || "skill",
      source:       skill.source || "auto-created",
      domains:      Array.isArray(skill.domains)     ? skill.domains     : [],
      tools_used:   Array.isArray(skill.tools_used)  ? skill.tools_used  : [],
      triggers:     Array.isArray(skill.triggers)    ? skill.triggers    : [],
      connections:  Array.isArray(skill.connections) ? skill.connections : [],
      version:      skill.version      || 1,
      significance: typeof skill.significance === "number" ? skill.significance : 0.5,
      evolved_from: skill.evolved_from || null,
    };
    return this._request("POST", "/v2/skills/ingest", body);
  }

  // Recall skills relevant to a query (semantic search).
  recallSkills({ query, top_k = 10, domain, min_significance = 0, token_budget = 4000, include_variants = false }) {
    return this._request("POST", "/v2/skills/recall", {
      query: String(query || ""),
      top_k, domain, min_significance, token_budget, include_variants,
    });
  }

  // Overall stats about the skill collection.
  skillsStatus() {
    return this._request("GET", "/v2/skills/status");
  }

  // Record that the agent used a skill successfully. This nudges significance up.
  markSuccess(skillId) {
    return this._request("POST", "/v2/skills/" + encodeURIComponent(skillId) + "/success");
  }

  // Record a failed use. Nudges significance down.
  markFailure(skillId) {
    return this._request("POST", "/v2/skills/" + encodeURIComponent(skillId) + "/fail");
  }

  // Create a new, evolved version of an existing skill (learning step).
  evolveSkill(skillId, skill) {
    return this._request("POST", "/v2/skills/" + encodeURIComponent(skillId) + "/evolve", skill);
  }

  // Liveness check for the brain container.
  status() { return this._request("GET", "/v2/status"); }
}

module.exports = BrainClient;
