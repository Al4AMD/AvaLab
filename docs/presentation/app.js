(() => {
  "use strict";

  const deck = document.getElementById("deck");
  const slides = Array.from(document.querySelectorAll(".slide"));
  const total = slides.length;
  const currentEl = document.getElementById("currentSlide");
  const totalEl = document.getElementById("totalSlides");
  const progressBar = document.getElementById("progressBar");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const overviewBtn = document.getElementById("overviewBtn");
  const helpBtn = document.getElementById("helpBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const overviewOverlay = document.getElementById("overviewOverlay");
  const helpOverlay = document.getElementById("helpOverlay");
  const overviewGrid = document.getElementById("overviewGrid");
  const orientationHint = document.getElementById("orientationHint");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isPortrait = window.matchMedia("(orientation: portrait)");

  let index = 0;
  let overviewOpen = false;
  let helpOpen = false;

  totalEl.textContent = String(total);

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function setScale() {
    const pad = window.innerWidth < 760 ? 8 : 16;
    const scale = Math.min(
      (window.innerWidth - pad * 2) / 1440,
      (window.innerHeight - pad * 2) / 810
    );
    document.documentElement.style.setProperty("--stage-scale", String(Math.max(0.1, scale)));
  }

  function updateOrientationHint() {
    orientationHint.hidden = !(isPortrait.matches && window.innerWidth <= 900);
  }

  function updateHash() {
    const hash = `#s${index + 1}`;
    if (window.location.hash !== hash) {
      history.replaceState(null, "", hash);
    }
  }

  function applySlide(nextIndex, options = {}) {
    const next = clamp(nextIndex, 0, total - 1);
    if (next === index && options.force !== true) {
      updateHash();
      return;
    }
    index = next;
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-active", i === index);
      slide.classList.toggle("is-before", i < index);
      slide.setAttribute("aria-hidden", i === index ? "false" : "true");
      slide.inert = i !== index;
    });
    currentEl.textContent = String(index + 1);
    progressBar.style.width = `${((index + 1) / total) * 100}%`;
    progressBar.parentElement.setAttribute("aria-valuenow", String(index + 1));
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;
    updateHash();
    markOverviewCurrent();
    if (index === 0) drawHero();
    if (slides[index].dataset.demo === "aliasing") drawAliasing();
    if (slides[index].dataset.demo === "convolution") drawConvolution();
    updateDemoAnimation();
  }

  function go(delta) {
    applySlide(index + delta);
  }

  function openOverview() {
    overviewOpen = true;
    overviewOverlay.hidden = false;
    markOverviewCurrent();
    const current = overviewGrid.querySelector(".is-current");
    if (current) current.focus();
  }
  function closeOverview() {
    overviewOpen = false;
    overviewOverlay.hidden = true;
    overviewBtn.focus();
  }
  function openHelp() {
    helpOpen = true;
    helpOverlay.hidden = false;
    const close = helpOverlay.querySelector("[data-close]");
    if (close) close.focus();
  }
  function closeHelp() {
    helpOpen = false;
    helpOverlay.hidden = true;
    helpBtn.focus();
  }
  function closeLayers() {
    if (overviewOpen) closeOverview();
    if (helpOpen) closeHelp();
  }

  function buildOverview() {
    const fragment = document.createDocumentFragment();
    slides.forEach((slide, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "overview-item";
      button.dataset.index = String(i);
      button.innerHTML = `
        <span class="overview-item__n">${String(i + 1).padStart(2, "0")}</span>
        <span class="overview-item__t"></span>
        <span class="overview-item__k"></span>`;
      button.querySelector(".overview-item__t").textContent = slide.dataset.title || `اسلاید ${i + 1}`;
      button.querySelector(".overview-item__k").textContent = slide.dataset.kicker || "";
      button.addEventListener("click", () => {
        applySlide(i);
        closeOverview();
      });
      fragment.appendChild(button);
    });
    overviewGrid.appendChild(fragment);
  }

  function markOverviewCurrent() {
    overviewGrid.querySelectorAll(".overview-item").forEach((button) => {
      button.classList.toggle("is-current", Number(button.dataset.index) === index);
    });
  }

  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (overviewOpen || helpOpen) {
        event.preventDefault();
        closeLayers();
      }
      return;
    }
    if (isTyping(event.target)) return;

    switch (event.key) {
      case "ArrowLeft":
      case "PageDown":
        event.preventDefault();
        go(1);
        break;
      case "ArrowRight":
      case "PageUp":
        event.preventDefault();
        go(-1);
        break;
      case " ":
        event.preventDefault();
        go(event.shiftKey ? -1 : 1);
        break;
      case "Home":
        event.preventDefault();
        applySlide(0);
        break;
      case "End":
        event.preventDefault();
        applySlide(total - 1);
        break;
      case "o":
      case "O":
        event.preventDefault();
        overviewOpen ? closeOverview() : openOverview();
        break;
      case "f":
      case "F":
        event.preventDefault();
        toggleFullscreen();
        break;
      case "?":
        event.preventDefault();
        helpOpen ? closeHelp() : openHelp();
        break;
      default:
        break;
    }
  });

  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));
  overviewBtn.addEventListener("click", openOverview);
  helpBtn.addEventListener("click", openHelp);
  fullscreenBtn.addEventListener("click", toggleFullscreen);

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const overlay = button.closest(".overlay");
      if (overlay === overviewOverlay) closeOverview();
      if (overlay === helpOverlay) closeHelp();
    });
  });

  [overviewOverlay, helpOverlay].forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        if (overlay === overviewOverlay) closeOverview();
        if (overlay === helpOverlay) closeHelp();
      }
    });
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      const request = document.documentElement.requestFullscreen;
      if (request) request.call(document.documentElement).catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  let touchStartX = 0;
  let touchStartY = 0;
  deck.addEventListener("pointerdown", (event) => {
    touchStartX = event.clientX;
    touchStartY = event.clientY;
  });
  deck.addEventListener("pointerup", (event) => {
    if (isTyping(event.target)) return;
    const dx = event.clientX - touchStartX;
    const dy = event.clientY - touchStartY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      dx < 0 ? go(1) : go(-1);
    }
  });

  window.addEventListener("resize", () => {
    setScale();
    updateOrientationHint();
  });
  isPortrait.addEventListener("change", updateOrientationHint);

  /* ---------- Canvas demos ---------- */

  const heroCanvas = document.getElementById("heroCanvas");
  const heroCtx = heroCanvas.getContext("2d");
  let heroFrame = 0;
  let heroAnimation = 0;

  function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { ctx: canvas.getContext("2d"), width, height, dpr };
  }

  function drawHero() {
    if (!heroCtx) return;
    const { ctx, width: w, height: h } = fitCanvas(heroCanvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(4, 8, 11, 0.6)";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(242, 240, 232, 0.055)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += w / 12) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += h / 7) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const mid = h * 0.52;
    const t = reducedMotion ? 0 : heroFrame * 0.012;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const p = x / w;
      const env = Math.exp(-Math.pow((p - 0.5) * 2.8, 2));
      const y = mid + (Math.sin(p * 28 + t) * 0.28 + Math.sin(p * 61 - t * 1.7) * 0.12 + Math.sin(p * 9 + t * 0.6) * 0.2) * h * 0.32 * env;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(105, 224, 208, 0.88)";
    ctx.lineWidth = Math.max(1.2, w / 480);
    ctx.shadowColor = "rgba(105, 224, 208, 0.45)";
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(105, 224, 208, 0.14)";
    for (let i = 0; i < 44; i += 1) {
      const x = (i / 44) * w;
      const amp = (0.18 + Math.abs(Math.sin(i * 0.45 + t * 0.5)) * 0.82) * h * 0.22;
      const blockW = Math.max(2, w / 90);
      ctx.fillRect(x, mid - amp, blockW, amp * 2);
    }

    const scanX = reducedMotion ? w * 0.6 : ((heroFrame * 2.2) % (w + 120)) - 60;
    const gradient = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
    gradient.addColorStop(0, "rgba(105, 224, 208, 0)");
    gradient.addColorStop(0.5, "rgba(105, 224, 208, 0.16)");
    gradient.addColorStop(1, "rgba(105, 224, 208, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(scanX - 40, 0, 80, h);

    ctx.fillStyle = "rgba(105, 224, 208, 0.9)";
    for (let i = 0; i < 5; i += 1) {
      const x = w * (0.2 + i * 0.15);
      const y = h * (0.22 + Math.sin(i * 1.7 + t) * 0.08);
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  function animateHero(now) {
    if (index !== 0 || reducedMotion) return;
    heroFrame = now / 42;
    drawHero();
    heroAnimation = requestAnimationFrame(animateHero);
  }

  function startHero() {
    cancelAnimationFrame(heroAnimation);
    if (index === 0 && !reducedMotion) heroAnimation = requestAnimationFrame(animateHero);
    else drawHero();
  }

  /* Aliasing */
  const aliasCanvas = document.getElementById("aliasCanvas");
  const aliasCtx = aliasCanvas ? aliasCanvas.getContext("2d") : null;
  const aliasRate = document.getElementById("aliasRate");
  const aliasFreq = document.getElementById("aliasFreq");
  const aliasRateOut = document.getElementById("aliasRateOut");
  const aliasFreqOut = document.getElementById("aliasFreqOut");
  const aliasFilter = document.getElementById("aliasFilter");
  const aliasReadout = document.getElementById("aliasReadout");
  let aliasFilterOn = false;

  function aliasFrequency(f, fs) {
    const folded = Math.abs(f - fs * Math.round(f / fs));
    return Math.min(folded, fs - folded);
  }

  function drawAliasing() {
    if (!aliasCtx) return;
    const { ctx, width: w, height: h } = fitCanvas(aliasCanvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(4, 8, 11, 0.55)";
    ctx.fillRect(0, 0, w, h);

    const fs = Number(aliasRate.value);
    const f = Number(aliasFreq.value);
    const alias = aliasFrequency(f, fs);
    const nyquist = fs / 2;
    const windowSeconds = 0.002;
    const mid = h * 0.54;
    const amp = h * 0.3;

    ctx.strokeStyle = "rgba(242, 240, 232, 0.07)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const y = h * 0.12 + (h * 0.76 * i) / 10;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const source = (x) => Math.sin(2 * Math.PI * f * (x / w) * windowSeconds);
    const folded = (x) => Math.sin(2 * Math.PI * alias * (x / w) * windowSeconds);

    ctx.beginPath();
    for (let x = 0; x <= w; x += 1.5) {
      const y = mid - source(x) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(242, 240, 232, 0.3)";
    ctx.lineWidth = Math.max(1, w / 900);
    ctx.stroke();

    const aliased = f > nyquist && !aliasFilterOn;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 1.5) {
      const y = mid - folded(x) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = aliased ? "rgba(240, 179, 91, 0.9)" : "rgba(105, 224, 208, 0.4)";
    ctx.lineWidth = Math.max(1.2, w / 720);
    ctx.setLineDash([5, 6]);
    if (aliased) {
      ctx.shadowColor = "rgba(240, 179, 91, 0.35)";
      ctx.shadowBlur = 8;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    const sampleStep = w / (windowSeconds * fs);
    ctx.fillStyle = aliased ? "rgba(240, 179, 91, 0.95)" : "rgba(105, 224, 208, 0.95)";
    for (let x = 0; x <= w; x += sampleStep) {
      const y = mid - source(x) * amp;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.8, w / 360), 0, Math.PI * 2);
      ctx.fill();
      if (aliased) {
        ctx.strokeStyle = "rgba(240, 179, 91, 0.22)";
        ctx.beginPath(); ctx.moveTo(x, mid); ctx.lineTo(x, y); ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(141, 154, 163, 0.8)";
    ctx.font = `${Math.max(9, w / 72)}px "SFMono-Regular", monospace`;
    ctx.direction = "ltr";
    ctx.textAlign = "left";
    ctx.fillText(`fs = ${(fs / 1000).toFixed(1)} kHz`, 8, 16);
    ctx.fillText(`f = ${(f / 1000).toFixed(1)} kHz`, 8, h - 9);
    ctx.textAlign = "right";
    ctx.fillStyle = aliased ? "rgba(240, 179, 91, 0.9)" : "rgba(105, 224, 208, 0.9)";
    ctx.fillText(aliased ? `alias = ${(alias / 1000).toFixed(2)} kHz` : `f_alias = ${(alias / 1000).toFixed(2)} kHz`, w - 8, 16);

    aliasRateOut.textContent = `${(fs / 1000).toFixed(1)} kHz`;
    aliasFreqOut.textContent = `${(f / 1000).toFixed(1)} kHz`;
    aliasFilter.textContent = `فیلتر ضد دگرسانی: ${aliasFilterOn ? "روشن" : "خاموش"}`;
    aliasFilter.setAttribute("aria-pressed", String(aliasFilterOn));
    aliasReadout.textContent = aliased
      ? `${(alias / 1000).toFixed(2)} kHz`
      : aliasFilterOn && f > nyquist
        ? "فیلترشده"
        : `${(alias / 1000).toFixed(2)} kHz`;
  }

  if (aliasRate) aliasRate.addEventListener("input", drawAliasing);
  if (aliasFreq) aliasFreq.addEventListener("input", drawAliasing);
  if (aliasFilter) {
    aliasFilter.addEventListener("click", () => {
      aliasFilterOn = !aliasFilterOn;
      drawAliasing();
    });
  }

  /* Convolution */
  const convCanvas = document.getElementById("convCanvas");
  const convCtx = convCanvas ? convCanvas.getContext("2d") : null;
  const convPos = document.getElementById("convPos");
  const convPlay = document.getElementById("convPlay");
  const convReadout = document.getElementById("convReadout");
  const convX = [0.1, 0.45, 0.8, 0.55, 0.2, -0.15, -0.42, -0.6, -0.35, -0.05, 0.25, 0.5, 0.62, 0.4, 0.12, -0.18];
  const convH = [0.7, 0.45, 0.22, 0.1, -0.05, -0.12];
  const convY = [];
  for (let n = 0; n < convX.length + convH.length - 1; n += 1) {
    let sum = 0;
    for (let k = 0; k < convX.length; k += 1) {
      const j = n - k;
      if (j >= 0 && j < convH.length) sum += convX[k] * convH[j];
    }
    convY.push(sum);
  }
  let convPlaying = true;
  let convRaf = 0;
  let convLast = 0;
  let convValue = Number(convPos ? convPos.value : 28);

  function drawConvolution() {
    if (!convCtx) return;
    const { ctx, width: w, height: h } = fitCanvas(convCanvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(4, 8, 11, 0.55)";
    ctx.fillRect(0, 0, w, h);

    const maxN = Math.max(convX.length, convH.length, convY.length);
    const n = Math.round((convValue / 100) * (maxN - 1));
    const padX = w * 0.06;
    const usable = w * 0.88;
    const rowY = [h * 0.2, h * 0.48, h * 0.78];
    const amp = h * 0.12;

    const drawRow = (values, baseY, color, offset = 0, windowStart = -1, windowLen = 0) => {
      const step = usable / Math.max(1, maxN - 1);
      ctx.strokeStyle = "rgba(242, 240, 232, 0.08)";
      ctx.beginPath(); ctx.moveTo(padX, baseY); ctx.lineTo(padX + usable, baseY); ctx.stroke();
      for (let i = 0; i < values.length; i += 1) {
        const x = padX + (i + offset) * step;
        const y = baseY - values[i] * amp;
        if (windowStart >= 0 && i + offset >= windowStart && i + offset < windowStart + windowLen) {
          ctx.fillStyle = "rgba(240, 179, 91, 0.16)";
          ctx.fillRect(x - step * 0.4, rowY[0] - amp * 1.6, step * 0.8, amp * 3.2);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.2, w / 700);
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.7, w / 380), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    drawRow(convX, rowY[0], "rgba(105, 224, 208, 0.9)");
    const reversed = convH.slice().reverse();
    drawRow(reversed, rowY[1], "rgba(240, 179, 91, 0.9)", 0, -1, 0);

    const yWindow = rowY[2];
    drawRow(convY, yWindow, "rgba(242, 240, 232, 0.55)");
    ctx.strokeStyle = "rgba(240, 179, 91, 0.5)";
    ctx.setLineDash([4, 4]);
    const step = usable / Math.max(1, maxN - 1);
    const winX = padX + n * step;
    ctx.beginPath(); ctx.moveTo(winX, rowY[1] - amp * 1.8); ctx.lineTo(winX, rowY[2] + amp * 1.8); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(141, 154, 163, 0.8)";
    ctx.font = `${Math.max(9, w / 70)}px "SFMono-Regular", monospace`;
    ctx.direction = "ltr";
    ctx.textAlign = "left";
    ctx.fillText("x[k]", 8, rowY[0] - amp * 1.6);
    ctx.fillText("h[n-k]", 8, rowY[1] - amp * 1.6);
    ctx.fillText("y[n]", 8, rowY[2] - amp * 1.6);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(240, 179, 91, 0.9)";
    ctx.fillText(`n = ${n}`, w - 8, 15);
    convReadout.textContent = `n = ${n}`;
  }

  function convTick(now) {
    if (!convPlaying || index !== slides.findIndex((slide) => slide.dataset.demo === "convolution")) return;
    if (now - convLast > 55) {
      convLast = now;
      convValue = (Number(convPos.value) + 1.1) % 100;
      convPos.value = String(convValue);
      drawConvolution();
    }
    convRaf = requestAnimationFrame(convTick);
  }

  function startConv() {
    cancelAnimationFrame(convRaf);
    if (convPlaying && !reducedMotion) {
      convRaf = requestAnimationFrame(convTick);
    }
  }

  if (convPos) {
    convPos.addEventListener("input", () => {
      convValue = Number(convPos.value);
      drawConvolution();
    });
  }
  if (convPlay) {
    convPlay.addEventListener("click", () => {
      convPlaying = !convPlaying;
      convPlay.textContent = convPlaying ? "توقف" : "پخش";
      convPlay.setAttribute("aria-pressed", String(convPlaying));
      startConv();
    });
  }

  function updateDemoAnimation() {
    const active = slides[index];
    const isCover = index === 0;
    const isConv = active && active.dataset.demo === "convolution";
    if (isCover) startHero(); else cancelAnimationFrame(heroAnimation);
    if (isConv) {
      drawConvolution();
      startConv();
    } else {
      cancelAnimationFrame(convRaf);
    }
    if (active && active.dataset.demo === "aliasing") drawAliasing();
  }

  /* ---------- Init ---------- */

  slides.forEach((slide, i) => {
    const kicker = slide.dataset.kicker || "";
    const code = kicker.match(/F\d{2}|D-\d{3}/);
    slide.dataset.code = code ? code[0] : String(i + 1).padStart(2, "0");
  });
  buildOverview();
  setScale();
  updateOrientationHint();
  slides.forEach((slide, i) => {
    slide.setAttribute("aria-hidden", i === 0 ? "false" : "true");
    slide.inert = i !== 0;
  });

  const match = window.location.hash.match(/^#s?(\d+)$/);
  const initial = match ? Number(match[1]) - 1 : 0;
  applySlide(initial, { force: true });

  window.addEventListener("hashchange", () => {
    const nextMatch = window.location.hash.match(/^#s?(\d+)$/);
    if (nextMatch) applySlide(Number(nextMatch[1]) - 1, { force: true });
  });
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
    drawHero();
  });

  window.addEventListener("load", () => {
    setScale();
    drawHero();
    drawAliasing();
    drawConvolution();
  });
})();
