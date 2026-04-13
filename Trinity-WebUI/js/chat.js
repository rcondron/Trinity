// Chat controller.
// Relays user messages through the bridge to the Trinity gateway via WebSocket RPC.
(function (global) {
  let currentConv = "default";
  const conversations = new Map([["default", []]]);

  function el(id) { return document.getElementById(id); }

  function escape(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function addMessage(who, content) {
    const log = el("chat-log");
    const div = document.createElement("div");
    div.className = "msg " + who;
    const whoLabel = document.createElement("span");
    whoLabel.className = "who";
    whoLabel.textContent = who === "user" ? "You" : who === "agent" ? "Trinity" : "system";
    div.appendChild(whoLabel);

    // Render markdown-ish content: code blocks, bold, etc.
    const textNode = document.createElement("span");
    textNode.innerHTML = formatMessage(content);
    div.appendChild(textNode);

    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function formatMessage(text) {
    let s = escape(text);
    // Fenced code blocks
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return s;
  }

  async function send() {
    const box = el("chat-box");
    const text = (box.value || "").trim();
    if (!text) return;
    box.value = "";
    box.focus();
    addMessage("user", text);
    conversations.get(currentConv).push({ role: "user", content: text });

    // Show typing indicator
    const typing = document.createElement("div");
    typing.className = "msg agent";
    typing.id = "typing-indicator";
    typing.innerHTML = '<span class="who">Trinity</span><span style="opacity:0.5">thinking…</span>';
    el("chat-log").appendChild(typing);
    el("chat-log").scrollTop = el("chat-log").scrollHeight;

    try {
      const res = await Bridge.chat(text, currentConv);
      const reply = (res && res.reply) || "(no reply)";
      // Remove typing indicator
      const ti = document.getElementById("typing-indicator");
      if (ti) ti.remove();
      addMessage("agent", reply);
      conversations.get(currentConv).push({ role: "agent", content: reply });
    } catch (e) {
      const ti = document.getElementById("typing-indicator");
      if (ti) ti.remove();
      addMessage("system",
        e.code === "BRIDGE_DOWN"
          ? "Bridge is offline. Start it with: node webapp/bridge/bridge-server.js"
          : "Error: " + e.message);
    }
  }

  async function abort() {
    try {
      await Bridge.gatewayAbortChat(currentConv);
      addMessage("system", "Chat aborted.");
    } catch (e) {
      addMessage("system", "Abort failed: " + e.message);
    }
  }

  function newConversation() {
    const id = "session-" + Date.now().toString(36);
    conversations.set(id, []);
    currentConv = id;

    const list = el("conv-list");
    const li = document.createElement("li");
    li.textContent = id;
    li.dataset.id = id;
    li.onclick = () => selectConversation(id);
    list.querySelectorAll("li").forEach((x) => x.classList.remove("active"));
    li.classList.add("active");
    list.appendChild(li);

    el("chat-log").innerHTML = "";
    addMessage("system", "New session: " + id);
  }

  function selectConversation(id) {
    currentConv = id;
    el("chat-log").innerHTML = "";
    document.querySelectorAll("#conv-list li").forEach((x) => {
      x.classList.toggle("active", x.dataset.id === id);
    });
    const hist = conversations.get(id) || [];
    if (hist.length === 0) addMessage("system", "Empty session.");
    else hist.forEach((m) => addMessage(m.role, m.content));
  }

  async function loadGatewaySessions() {
    try {
      const res = await Bridge.gatewaySessions();
      const sessions = res.sessions || res.payload || [];
      if (Array.isArray(sessions) && sessions.length > 0) {
        const list = el("conv-list");
        // Keep existing, add new
        const existing = new Set();
        list.querySelectorAll("li").forEach((li) => existing.add(li.dataset.id));
        for (const s of sessions) {
          const key = s.sessionKey || s.key || s.id;
          if (key && !existing.has(key)) {
            if (!conversations.has(key)) conversations.set(key, []);
            const li = document.createElement("li");
            li.textContent = key.length > 20 ? key.slice(0, 20) + "…" : key;
            li.dataset.id = key;
            li.onclick = () => selectConversation(key);
            list.appendChild(li);
          }
        }
        addMessage("system", sessions.length + " session(s) loaded from gateway.");
      } else {
        addMessage("system", "No sessions found in the gateway.");
      }
    } catch (e) {
      addMessage("system", "Could not load sessions: " + e.message);
    }
  }

  function updateStatus() {
    // Bridge health
    Bridge.health()
      .then(() => {
        el("chat-bridge-status").textContent = "bridge: online";
        el("chat-bridge-status").className = "status-pill ok";
      })
      .catch(() => {
        el("chat-bridge-status").textContent = "bridge: offline";
        el("chat-bridge-status").className = "status-pill err";
      });

    // Gateway connection (WebSocket)
    Bridge.gatewayConnected()
      .then((r) => {
        el("chat-gw-status").textContent = r.connected ? "gateway: connected" : "gateway: disconnected";
        el("chat-gw-status").className = "status-pill " + (r.connected ? "ok" : "err");
      })
      .catch(() => {
        el("chat-gw-status").textContent = "gateway: ?";
        el("chat-gw-status").className = "status-pill warn";
      });

    // Container health
    Bridge.containers()
      .then((r) => {
        const agent = (r.containers || []).find((c) => (c.name || "").includes("trinity-agent"));
        el("chat-agent-status").textContent = agent ? "container: up" : "container: down";
        el("chat-agent-status").className = "status-pill " + (agent ? "ok" : "err");
      })
      .catch(() => {
        el("chat-agent-status").textContent = "container: ?";
        el("chat-agent-status").className = "status-pill warn";
      });

    // Active model
    Bridge.gatewayHealth()
      .then((r) => {
        const model = r.model || r.defaultModel || (r.payload && r.payload.model);
        el("chat-model-info").textContent = model || "(unknown)";
      })
      .catch(() => {
        el("chat-model-info").textContent = "—";
      });
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateStatus();
    setInterval(updateStatus, 8000);

    el("chat-box").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.querySelectorAll("#conv-list li").forEach((li) => {
      li.onclick = () => selectConversation(li.dataset.id);
    });
  });

  global.Chat = { send, abort, newConversation, selectConversation, loadGatewaySessions };
})(window);
