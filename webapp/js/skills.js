// Skills page controller.
// All skills live in the trinity-brain container; this page relays everything
// through the bridge (Bridge.skillsStatus / recallSkills / addSkill / etc).
(function (global) {
  function escape(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function refresh() {
    try {
      const s = await Bridge.skillsStatus();
      document.getElementById("stat-total").textContent  = s.total_skills ?? 0;
      document.getElementById("stat-auto").textContent   = (s.by_source && s.by_source["auto-created"]) || 0;
      document.getElementById("stat-custom").textContent = (s.by_source && s.by_source["custom"])       || 0;
      const top = (s.top_skills && s.top_skills[0]) || null;
      document.getElementById("stat-top").textContent = top ? top.name : "—";
      document.getElementById("stat-top-sub").textContent = top
        ? `${top.success_count} successes · ${top.fail_count} failures`
        : "no skills used yet";
    } catch (e) {
      const msg = e.code === "BRIDGE_DOWN" ? "bridge offline" : "brain unreachable";
      ["stat-total", "stat-auto", "stat-custom", "stat-top"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = msg;
      });
    }
  }

  async function recall(ev) {
    ev.preventDefault();
    const query = document.getElementById("recall-q").value.trim();
    const top_k = Math.max(1, Math.min(50, Number(document.getElementById("recall-k").value) || 10));
    const out = document.getElementById("recall-results");
    out.innerHTML = "<div class='sub'>searching…</div>";
    try {
      const res = await Bridge.recallSkills({ query, top_k, token_budget: 8000 });
      const list = res.skills || [];
      if (list.length === 0) {
        out.innerHTML = "<div class='sub'>No matches. Add a skill below and try again.</div>";
        return false;
      }
      out.innerHTML = "";
      list.forEach((sk) => {
        const row = document.createElement("div");
        row.className = "perm-row";
        row.style.gridTemplateColumns = "1fr 120px 90px 90px";
        row.innerHTML = `
          <div>
            <div class="name">${escape(sk.name)}</div>
            <div class="path">${escape(sk.description)}</div>
          </div>
          <div class="mode">${escape(sk.source)} · v${sk.version}</div>
          <button class="btn ghost"    data-id="${escape(sk.id)}" data-op="ok">✓ used</button>
          <button class="btn ghost"    data-id="${escape(sk.id)}" data-op="bad">✕ bad</button>
        `;
        out.appendChild(row);
      });
      out.querySelectorAll("button[data-op]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          try {
            if (btn.dataset.op === "ok") await Bridge.markSkillSuccess(id);
            else                          await Bridge.markSkillFailure(id);
            refresh();
            btn.textContent = "✓ recorded";
            btn.disabled = true;
          } catch (e) { alert(e.message); }
        });
      });
    } catch (e) {
      out.innerHTML = "<div class='sub'>Error: " + escape(e.message) + "</div>";
    }
    return false;
  }

  function csvToArray(s) {
    return String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  }

  async function add(ev) {
    ev.preventDefault();
    const body = {
      name:        document.getElementById("s-name").value.trim(),
      description: document.getElementById("s-desc").value.trim(),
      content:     document.getElementById("s-content").value,
      domains:     csvToArray(document.getElementById("s-domains").value),
      triggers:    csvToArray(document.getElementById("s-triggers").value),
    };
    if (!body.name || !body.description || !body.content) return false;
    try {
      await Bridge.addSkill(body);
      ["s-name", "s-desc", "s-domains", "s-triggers", "s-content"].forEach((id) => {
        document.getElementById(id).value = "";
      });
      refresh();
      alert("Skill added to trinity-brain.");
    } catch (e) {
      alert("Could not add skill: " + e.message);
    }
    return false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    refresh();
    setInterval(refresh, 15000);
  });

  global.Skills = { refresh, recall, add };
})(window);
