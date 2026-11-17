
(function () {
  "use strict";

  // ==================== 基础 ====================
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const video = document.getElementById("cam");
  const $ = (id) => document.getElementById(id);

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", () => { resize(); initAmbient(); }); resize();

  // ==================== 难度 ====================
  const DIFFS = {
    easy:   { key: "easy",   label: "简单", balls: 4, speed: 20, hit: 0.80, flee: 0.0  },
    normal: { key: "normal", label: "普通", balls: 5, speed: 34, hit: 0.63, flee: 0.0  },
    hard:   { key: "hard",   label: "困难", balls: 7, speed: 52, hit: 0.50, flee: 0.75 }
  };
  let diff = DIFFS.normal;

  // ==================== 运动检测画布 ====================
  const DW = 80, DH = 60;
  const detCanvas = document.createElement("canvas");
  detCanvas.width = DW; detCanvas.height = DH;
  const detCtx = detCanvas.getContext("2d", { willReadFrequently: true });
  let prevGray = null;

  // ==================== 状态 ====================
  const S = { MENU: 0, PLAY: 1, PAUSED: 2, OVER: 3 };
  let state = S.MENU;
  let useCamera = false, cameraReady = false, paused = false;

  let score = 0, combo = 0, maxCombo = 0, timeLeft = 60, eaten = 0;
  let elapsed = 0, lastTs = 0;

  const player = { x: 0, y: 0, r: 90, active: false, tx: 0, ty: 0 };
  let balls = [];

  // ==================== 粒子系统 ====================
  const parts = [];          // 通用粒子池（爆炸 / 拖尾）
  const MAX_PARTS = 420;
  let ambient = [];          // 背景星点

  function initAmbient() {
    ambient = [];
    const n = Math.round((W * H) / 26000);
    for (let i = 0; i < n; i++) {
      ambient.push({
        x: Math.random() * W, y: Math.random() * H,
        r: rand(0.6, 1.9),
        a: rand(0.12, 0.5),
        ph: rand(0, Math.PI * 2),
        sp: rand(0.15, 0.6),
        vx: rand(-4, 4), vy: rand(-6, -1.5)
      });
    }
  }

  function addPart(p) {
    if (parts.length >= MAX_PARTS) parts.shift();
    parts.push(p);
  }

  function spawnBurst(x, y, hue, n, power) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = rand(60, 260) * (power || 1);
      const life = rand(0.45, 1.05);
      addPart({
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life, max: life,
        size: rand(1.4, 4.2),
        hue: hue + rand(-16, 16),
        sat: rand(80, 100), lig: rand(62, 82),
        drag: 0.90, grav: 90, glow: true
      });
    }
  }

  function spawnTrail(x, y, hue, n) {
    for (let i = 0; i < n; i++) {
      const life = rand(0.22, 0.5);
      addPart({
        x: x + rand(-14, 14), y: y + rand(-14, 14),
        vx: rand(-26, 26), vy: rand(-26, 26),
        life, max: life, size: rand(1, 2.6),
        hue, sat: 90, lig: 76, drag: 0.88, grav: 0, glow: false
      });
    }
  }

  initAmbient();

  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.grav || 0) * dt;
      const d = Math.pow(p.drag || 0.9, dt * 60);
      p.vx *= d; p.vy *= d;
    }
  }

  function drawParts() {
    for (const p of parts) {
      const t = Math.max(0, p.life / p.max);
      const alpha = t * 0.95;
      const col = "hsla(" + p.hue + "," + p.sat + "%," + p.lig + "%," + alpha + ")";
      if (p.glow) {
        ctx.beginPath();
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 5);
        g.addColorStop(0, col);
        g.addColorStop(1, "hsla(" + p.hue + ",90%,60%,0)");
        ctx.fillStyle = g;
        ctx.arc(p.x, p.y, p.size * 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawAmbient(dt) {
    for (const s of ambient) {
      s.ph += dt * s.sp;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.y < -6) { s.y = H + 6; s.x = Math.random() * W; }
      if (s.x < -6) s.x = W + 6;
      if (s.x > W + 6) s.x = -6;
      const a = s.a * (0.55 + 0.45 * Math.sin(s.ph));
      ctx.fillStyle = "rgba(150,205,255," + a.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ==================== 工具 ====================
  function rand(a, b) { return a + Math.random() * (b - a); }

  function spawnBall() {
    const r = rand(26, 42);
    const hue = rand(180, 320);
    let x, y, tries = 0;
    do {
      x = rand(r + 40, W - r - 40);
      y = rand(r + 92, H - r - 46);
      tries++;
    } while (tries < 24 && Math.hypot(x - player.x, y - player.y) < 210);

    balls.push({
      x, y, r, hue,
      vx: rand(-diff.speed, diff.speed),
      vy: rand(-diff.speed * 0.8, diff.speed * 0.8),
      phase: rand(0, Math.PI * 2),
      orbit: rand(0, Math.PI * 2),
      orbitN: Math.round(rand(3, 5)),
      pulse: rand(0, Math.PI * 2)
    });
  }

  function resetGame() {
    score = 0; combo = 0; maxCombo = 0; timeLeft = 60; eaten = 0; elapsed = 0;
    balls = []; parts.length = 0;
    player.x = W / 2; player.y = H / 2; player.r = 90; player.active = false;
    for (let i = 0; i < diff.balls; i++) spawnBall();
    initAmbient();
    $("diffLabel").textContent = diff.label;
    updateHUD();
  }

  function updateHUD() {
    $("score").textContent = score;
    $("time").textContent = Math.ceil(timeLeft);
    $("combo").textContent = combo;
  }

  function showErr(msg) {
    const el = $("err");
    el.textContent = msg; el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 4200);
  }

  // ==================== 摄像头 ====================
  async function initCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("不支持摄像头 API");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false
      });
      video.srcObject = stream;
      await video.play();
      cameraReady = true; useCamera = true;
      return true;
    } catch (e) {
      cameraReady = false; useCamera = false;
      showErr("摄像头不可用（" + (e.message || "权限被拒绝") + "），已切换鼠标模式");
      return false;
    }
  }

  // ==================== 运动检测 ====================
  function detectMotion() {
    if (!cameraReady || video.readyState < 2) return;

    detCtx.save();
    detCtx.translate(DW, 0); detCtx.scale(-1, 1);
    detCtx.drawImage(video, 0, 0, DW, DH);
    detCtx.restore();

    const img = detCtx.getImageData(0, 0, DW, DH).data;
    const gray = new Uint8Array(DW * DH);
    for (let i = 0, p = 0; i < img.length; i += 4, p++) {
      gray[p] = (img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114) | 0;
    }
    if (!prevGray) { prevGray = gray; return; }

    let sumX = 0, sumY = 0, count = 0;
    let minX = DW, maxX = 0, minY = DH, maxY = 0;
    const TH = 26;
    for (let y = 0; y < DH; y++) {
      for (let x = 0; x < DW; x++) {
        const idx = y * DW + x;
        if (Math.abs(gray[idx] - prevGray[idx]) > TH) {
          sumX += x; sumY += y; count++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    prevGray = gray;

    if (count > 55) {
      player.tx = (sumX / count / DW) * W;
      player.ty = (sumY / count / DH) * H;
      const spread = Math.max(maxX - minX, maxY - minY);
      player.r = Math.min(165, Math.max(62, (spread / DW) * W * 0.55));
      player.active = true;
    } else {
      player.active = false;
      player.r *= 0.92;
    }
  }

  // ==================== 更新 ====================
  function update(dt) {
    elapsed += dt;
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; endGame(); return; }

    // 输入
    if (useCamera) {
      detectMotion();
      if (player.active) {
        player.x += (player.tx - player.x) * Math.min(1, dt * 12);
        player.y += (player.ty - player.y) * Math.min(1, dt * 12);
      }
    } else if (mouse.active) {
      player.x += (mouse.x - player.x) * Math.min(1, dt * 16);
      player.y += (mouse.y - player.y) * Math.min(1, dt * 16);
      player.active = true;
      player.r = 78;
    }

    // 玩家拖尾粒子
    if (player.active && Math.random() < 0.85) {
      spawnTrail(player.x, player.y, 195, 2);
    }

    // 光球
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.phase += dt * 1.6;
      b.orbit += dt * 2.2;
      b.pulse += dt * 2.8;

      // 困难模式：被靠近时逃逸
      if (diff.flee > 0 && player.active) {
        const dx = b.x - player.x, dy = b.y - player.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < b.r + player.r + 70) {
          b.vx += (dx / d) * diff.flee * 120 * dt;
          b.vy += (dy / d) * diff.flee * 120 * dt;
          const sp = Math.hypot(b.vx, b.vy);
          const cap = diff.speed * 2.2;
          if (sp > cap) { b.vx = b.vx / sp * cap; b.vy = b.vy / sp * cap; }
        }
      }

      b.x += b.vx * dt + Math.sin(b.phase) * 0.6;
      b.y += b.vy * dt + Math.cos(b.phase * 0.8) * 0.6;

      if (b.x < b.r + 20 || b.x > W - b.r - 20) b.vx *= -1;
      if (b.y < b.r + 86 || b.y > H - b.r - 18) b.vy *= -1;
      b.x = Math.max(b.r + 20, Math.min(W - b.r - 20, b.x));
      b.y = Math.max(b.r + 86, Math.min(H - b.r - 18, b.y));

      // 命中
      const d = Math.hypot(b.x - player.x, b.y - player.y);
      if (player.active && d < b.r + player.r * diff.hit) {
        spawnBurst(b.x, b.y, b.hue, 22, 1);
        spawnBurst(b.x, b.y, b.hue, 8, 0.45);
        balls.splice(i, 1);
        combo++;
        if (combo > maxCombo) maxCombo = combo;
        const gain = 10 * Math.min(5, 1 + Math.floor((combo - 1) / 3));
        score += gain; eaten++;
        spawnBall();
        updateHUD();
      }
    }

    updateParts(dt);
    updateHUD();
  }

  // ==================== 绘制 ====================
  function draw(dt) {
    ctx.clearRect(0, 0, W, H);

    // 背景
    if (cameraReady && video.readyState >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.40;
      ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(5,9,16,.66)");
      g.addColorStop(0.55, "rgba(5,9,16,.48)");
      g.addColorStop(1, "rgba(5,9,16,.76)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createRadialGradient(W / 2, H * 0.44, 60, W / 2, H * 0.44, Math.max(W, H) * 0.82);
      g.addColorStop(0, "#101c30");
      g.addColorStop(1, "#05080e");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    if (state === S.MENU || state === S.OVER) { drawAmbient(dt); drawParts(); return; }
    if (state === S.PAUSED) { drawAmbient(0); drawParts(); drawScene(); return; }

    drawAmbient(dt);
    drawScene();
    drawParts();
    drawTimerRing();
  }

  function drawScene() {
    // 光球（核心 + 光晕 + 环绕粒子）
    for (const b of balls) {
      const pulseR = b.r * (1 + Math.sin(b.pulse) * 0.05);
      const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, pulseR * 2.0);
      grd.addColorStop(0, "hsla(" + b.hue + ",100%,74%,.95)");
      grd.addColorStop(0.42, "hsla(" + b.hue + ",95%,58%,.42)");
      grd.addColorStop(1, "hsla(" + b.hue + ",90%,50%,0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(b.x, b.y, pulseR * 2.0, 0, Math.PI * 2); ctx.fill();

      // 核心
      ctx.fillStyle = "hsla(" + b.hue + ",100%,90%,.96)";
      ctx.beginPath(); ctx.arc(b.x, b.y, pulseR * 0.34, 0, Math.PI * 2); ctx.fill();

      // 环绕粒子
      for (let k = 0; k < b.orbitN; k++) {
        const ang = b.orbit + (Math.PI * 2 / b.orbitN) * k;
        const rad = pulseR * (1.28 + Math.sin(b.pulse + k) * 0.12);
        const px = b.x + Math.cos(ang) * rad;
        const py = b.y + Math.sin(ang) * rad;
        ctx.fillStyle = "hsla(" + b.hue + ",100%,82%,.85)";
        ctx.beginPath(); ctx.arc(px, py, 1.7, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 玩家
    if (player.active) {
      const pr = player.r;
      const pg = ctx.createRadialGradient(player.x, player.y, pr * 0.18, player.x, player.y, pr);
      pg.addColorStop(0, "rgba(90,209,255,.28)");
      pg.addColorStop(0.68, "rgba(90,209,255,.11)");
      pg.addColorStop(1, "rgba(90,209,255,0)");
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(player.x, player.y, pr, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = "rgba(150,232,255,.75)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(player.x, player.y, pr * 0.72, 0, Math.PI * 2); ctx.stroke();

      // 内圈虚线
      ctx.save();
      ctx.setLineDash([5, 9]);
      ctx.strokeStyle = "rgba(150,232,255,.34)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(player.x, player.y, pr * 0.72 - 7, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawTimerRing() {
    const cx = W - 58, cy = 58, R = 25;
    ctx.save();
    ctx.strokeStyle = "rgba(120,180,220,.15)";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = timeLeft < 10 ? "#ff7a7a" : "#5ad1ff";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (timeLeft / 60));
    ctx.stroke();
    ctx.restore();
  }

  // ==================== 主循环 ====================
  function loop(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000; lastTs = ts;
    if (dt > 0.05) dt = 0.05;

    if (state === S.PLAY && !paused) update(dt);
    draw(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ==================== 流程控制 ====================
  function startGame(withCamera) {
    resetGame();
    state = S.PLAY; paused = false;
    prevGray = null;
    $("startVeil").classList.add("hidden");
    $("overVeil").classList.add("hidden");
    $("pausedVeil").classList.add("hidden");
    if (withCamera) initCamera();
    else { useCamera = false; cameraReady = false; }
  }

  function togglePause() {
    if (state !== S.PLAY) return;
    paused = !paused;
    $("pausedVeil").classList.toggle("hidden", !paused);
    $("pauseBtn").textContent = paused ? "继续" : "暂停";
  }

  function endGame() {
    state = S.OVER; paused = false;
    $("pausedVeil").classList.add("hidden");
    $("pauseBtn").textContent = "暂停";
    $("result").innerHTML =
      '<span class="big">' + score + '</span>' +
      '<span class="meta">接住 ' + eaten + ' 个光球 · 最高连击 ' + maxCombo + '<br>' +
      "难度：" + diff.label + " · " + (useCamera ? "摄像头体感模式" : "鼠标模式") + "</span>";
    // 结束撒花
    for (let i = 0; i < 3; i++) {
      setTimeout(() => spawnBurst(rand(W * 0.2, W * 0.8), rand(H * 0.25, H * 0.6), rand(180, 320), 26, 1.2), i * 160);
    }
    $("overVeil").classList.remove("hidden");
  }

  // ==================== 事件 ====================
  const mouse = { x: 0, y: 0, active: false };
  canvas.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; });
  canvas.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (t) { mouse.x = t.clientX; mouse.y = t.clientY; mouse.active = true; }
  }, { passive: true });

  // 难度选择（开始界面 + 结束界面）
  function bindDiffPick(containerId) {
    const box = $(containerId);
    box.querySelectorAll(".dcard").forEach(card => {
      card.addEventListener("click", () => {
        diff = DIFFS[card.dataset.diff];
        box.querySelectorAll(".dcard").forEach(c => c.classList.remove("on"));
        card.classList.add("on");
        $("diffLabel").textContent = diff.label;
      });
    });
  }
  bindDiffPick("diffPick");
  bindDiffPick("diffPick2");

  $("startBtn").addEventListener("click", () => startGame(true));
  $("mouseBtn").addEventListener("click", () => startGame(false));
  $("againBtn").addEventListener("click", () => startGame(true));
  $("pauseBtn").addEventListener("click", togglePause);
  $("endBtn").addEventListener("click", () => { if (state === S.PLAY) endGame(); });
  $("resumeBtn").addEventListener("click", togglePause);
  $("quitBtn").addEventListener("click", () => endGame());

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "p" || e.code === "Space") {
      if (state === S.PLAY) { e.preventDefault(); togglePause(); }
    } else if (e.key === "Escape") {
      if (state === S.PLAY) endGame();
    } else if (k === "r") {
      if (state === S.PLAY || state === S.OVER || state === S.PAUSED) startGame(true);
    }
  });

  // 预检
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showErr("当前环境不支持摄像头，请使用鼠标模式");
    $("mouseBtn").textContent = "直接用鼠标玩";
  }
})();
