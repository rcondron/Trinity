// Minimal matrix rain background for the Trinity webapp.
// Runs lazily and dims itself when the tab is hidden.
(function () {
  const canvas = document.getElementById("matrix-rain");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let w = 0, h = 0, cols = 0, drops = [];
  const fontSize = 14;
  const chars = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ<>{}[]()/*-+=#@$%&アィエオカキクケコサシスセソタチツ".split("");

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    cols = Math.floor(w / fontSize);
    drops = new Array(cols).fill(1);
  }

  function draw() {
    ctx.fillStyle = "rgba(2, 6, 8, 0.08)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#2bd4c2";
    ctx.font = fontSize + "px monospace";
    for (let i = 0; i < drops.length; i++) {
      const c = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(c, i * fontSize, drops[i] * fontSize);
      if (drops[i] * fontSize > h && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }

  let timer;
  function start() {
    stop();
    timer = setInterval(draw, 60);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  resize();
  start();
})();
