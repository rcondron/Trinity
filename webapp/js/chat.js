// Chat controller.
// Relays user messages through the bridge to the trinity-agent container.
(function (global) {
  let currentConv = "default";
  const conversations = new Map([["default", []]]);

  function el(id) { return document.getElementById(id); }

  function addMessage(who, content) {
    const log = el("chat-log");
    const div = document.createElement("div");
    div.className = "msg " + who;
    const whoLabel = document.createElement("span");
    whoLabel.className = "who";
    whoLabel.textContent = who === "user" ? "You" : who === "agent" ? "Trinity" : "system";
    div.appendChild(whoLabel);
    div.appendChild(document.createTextNode(content));
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const box = el("chat-box");
    const text = (box.value || "").trim();
    if (!text) return;
    box.value = "";
    addMessage("user", text);
    conversations.get(currentConv).push({ role: "user", content: text });

    try {
      const res = await Bridge.chat(text, currentConv);
      const reply = (res && res.reply) || "(no reply)";
      addMessage("agent", reply);
      conversations.get(currentConv).push({ role: "agent", content: reply });
    } catch (e) {
      addMessage("system",
        e.code === "BRIDGE_DOWN"
          ? "Bridge is offline. Start it with: node webapp/bridge/bridge-server.js"
          : "Error: " + e.message);
    }
  }

  function newConversation() {
    const id = "c-" + Date.now().toString(36);
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

    const log = el("chat-log");
    log.innerHTML = "";
    addMessage("system", "New conversation started: " + id);
  }

  function selectConversation(id) {
    currentConv = id;
    el("chat-log").innerHTML = "";
    document.querySelectorAll("#conv-list li").forEach((x) => {
      x.classList.toggle("active", x.dataset.id === id);
    });
    const hist = conversations.get(id) || [];
    if (hist.length === 0) addMessage("system", "Empty conversation.");
    else hist.forEach((m) => addMessage(m.role, m.content));
  }

  function updateBridgeStatus() {
    Bridge.health()
      .then(() => { el("chat-bridge-status").textContent = "bridge: online"; el("chat-bridge-status").className = "status-pill ok"; })
      .catch(()  => { el("chat-bridge-status").textContent = "bridge: offline"; el("chat-bridge-status").className = "status-pill err"; });
    Bridge.containers()
      .then((r) => {
        const agent = (r.containers || []).find((c) => (c.name || "").includes("trinity-agent"));
        el("chat-agent-status").textContent = agent ? "agent: up" : "agent: down";
        el("chat-agent-status").className   = "status-pill " + (agent ? "ok" : "err");
      })
      .catch(() => { el("chat-agent-status").textContent = "agent: ?"; el("chat-agent-status").className = "status-pill warn"; });
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateBridgeStatus();
    setInterval(updateBridgeStatus, 10000);

    el("chat-box").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    document.querySelectorAll("#conv-list li").forEach((li) => {
      li.onclick = () => selectConversation(li.dataset.id);
    });
  });

  global.Chat = { send, newConversation, selectConversation };
})(window);
