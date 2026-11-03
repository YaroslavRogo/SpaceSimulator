"use strict";

(() => {
  const MU = 398600.4418; // Гравитационный параметр Земли, км³/с²
  const ANIMATION_DURATION = 10000;
  const EPSILON = 1e-9;

  const DEFAULTS = {
    r1: 7000,
    r2: 30000,
    rb: 80000
  };

  const elements = {
    canvas: document.getElementById("orbit-canvas"),
    r1Range: document.getElementById("r1-range"),
    r1Number: document.getElementById("r1-number"),
    r2Range: document.getElementById("r2-range"),
    r2Number: document.getElementById("r2-number"),
    rbRange: document.getElementById("rb-range"),
    rbNumber: document.getElementById("rb-number"),
    rbMinLabel: document.getElementById("rb-min-label"),
    start: document.getElementById("start-btn"),
    reset: document.getElementById("reset-btn"),
    message: document.getElementById("control-message"),
    status: document.getElementById("simulation-status"),
    caption: document.getElementById("canvas-caption"),
    progress: document.getElementById("progress-value"),
    progressBar: document.getElementById("progress-bar"),
    animationTime: document.getElementById("animation-time"),
    results: document.getElementById("results-panel")
  };

  const ctx = elements.canvas.getContext("2d");

  if (!ctx) {
    elements.message.textContent =
      "Не удалось создать Canvas. Попробуйте другой браузер.";
    elements.start.disabled = true;
    return;
  }

  let animationFrame = null;
  let animationStart = 0;
  let animationElapsed = 0;
  let simulation = null;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let pixelRatio = 1;
  let stars = [];

  const COLORS = {
    background: "#080f20",
    grid: "rgba(100, 132, 177, 0.08)",
    orbit: "#52647f",
    initial: "#54d8ff",
    target: "#61e6b0",
    hohmann: "#54d8ff",
    bielliptic: "#c08bff",
    earth: "#4286d5",
    earthLight: "#9de8ff",
    text: "#a8bad5"
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatNumber(value, digits = 0) {
    return value.toLocaleString("ru-RU", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function readNumber(input, fallback) {
    const value = Number(input.value);
    return Number.isFinite(value) && input.value.trim() !== ""
      ? value
      : fallback;
  }

  function getParameters() {
    return {
      r1: Number(elements.r1Number.value),
      r2: Number(elements.r2Number.value),
      rb: Number(elements.rbNumber.value)
    };
  }

  function getMinimumRb() {
    const { r1, r2 } = getParameters();
    return Math.ceil((Math.max(r1, r2) + 1) / 1000) * 1000;
  }

  function setParameter(name, value, source) {
    const range = elements[`${name}Range`];
    const number = elements[`${name}Number`];

    const min = Number(range.min);
    const max = Number(range.max);
    const step = Number(range.step) || 1;

    let next = clamp(value, min, max);

    // Приводим значения к допустимому шагу ползунка.
    next = min + Math.round((next - min) / step) * step;
    next = clamp(next, min, max);

    range.value = String(next);
    number.value = String(next);

    if (name === "r1" || name === "r2") {
      updateRbConstraint();
    }

    if (simulation || animationFrame !== null) {
      stopAnimation();
      simulation = null;
      elements.results.hidden = true;
      elements.message.textContent =
        "Параметры изменены. Запустите симуляцию повторно.";
      setStatus("ОЖИДАНИЕ", "");
    }

    elements.progress.textContent = "0%";
    elements.progressBar.style.width = "0%";
    elements.animationTime.textContent = "0,0 с";

    drawScene(0);
  }

  function updateRbConstraint() {
    const minRb = getMinimumRb();

    elements.rbRange.min = String(minRb);
    elements.rbNumber.min = String(minRb);
    elements.rbMinLabel.textContent = `${formatNumber(minRb)} км`;

    const currentRb = readNumber(elements.rbNumber, DEFAULTS.rb);

    if (currentRb < minRb) {
      const nextRb = Math.min(
        200000,
        Math.ceil(minRb / 1000) * 1000
      );

      elements.rbRange.value = String(nextRb);
      elements.rbNumber.value = String(nextRb);
    }
  }

  function bindParameter(name) {
    const range = elements[`${name}Range`];
    const number = elements[`${name}Number`];

    range.addEventListener("input", () => {
      setParameter(name, Number(range.value), "range");
    });

    number.addEventListener("change", () => {
      const min = Number(number.min);
      const max = Number(number.max);
      const value = readNumber(number, Number(range.value));

      setParameter(name, clamp(value, min, max), "number");
    });

    number.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        number.blur();
      }
    });
  }

  // Скорость на круговой орбите.
  function circularVelocity(radius) {
    return Math.sqrt(MU / radius);
  }

  // Скорость на эллиптической орбите по формуле vis-viva.
  function ellipticalVelocity(radius, semiMajorAxis) {
    return Math.sqrt(
      MU * (2 / radius - 1 / semiMajorAxis)
    );
  }

  // Время движения от одного апсида эллипса до другого.
  function halfPeriod(semiMajorAxis) {
    return Math.PI * Math.sqrt(
      Math.pow(semiMajorAxis, 3) / MU
    );
  }

  function calculateHohmann(r1, r2) {
    if (Math.abs(r1 - r2) < EPSILON) {
      return {
        dv: 0,
        time: 0,
        maxRadius: r1,
        semiMajorAxis: r1,
        dv1: 0,
        dv2: 0
      };
    }

    const a = (r1 + r2) / 2;

    const vCircular1 = circularVelocity(r1);
    const vCircular2 = circularVelocity(r2);

    const vTransfer1 = ellipticalVelocity(r1, a);
    const vTransfer2 = ellipticalVelocity(r2, a);

    const dv1 = Math.abs(vTransfer1 - vCircular1);
    const dv2 = Math.abs(vCircular2 - vTransfer2);

    return {
      dv: dv1 + dv2,
      time: halfPeriod(a),
      maxRadius: Math.max(r1, r2),
      semiMajorAxis: a,
      dv1,
      dv2
    };
  }

  function calculateBielliptic(r1, r2, rb) {
    // Первый эллипс: перицентр r1, апоцентр rb.
    const a1 = (r1 + rb) / 2;

    // Второй эллипс: перицентр r2, апоцентр rb.
    const a2 = (r2 + rb) / 2;

    const vCircular1 = circularVelocity(r1);
    const vCircular2 = circularVelocity(r2);

    const vPeri1 = ellipticalVelocity(r1, a1);
    const vApo1 = ellipticalVelocity(rb, a1);

    const vApo2 = ellipticalVelocity(rb, a2);
    const vPeri2 = ellipticalVelocity(r2, a2);

    // Первый импульс: переход с начальной круговой орбиты.
    const dv1 = Math.abs(vPeri1 - vCircular1);

    // Второй импульс: переход между двумя эллипсами при rb.
    const dv2 = Math.abs(vApo2 - vApo1);

    // Третий импульс: выход на конечную круговую орбиту.
    const dv3 = Math.abs(vCircular2 - vPeri2);

    const time1 = halfPeriod(a1);
    const time2 = halfPeriod(a2);

    return {
      dv: dv1 + dv2 + dv3,
      dv1,
      dv2,
      dv3,
      time1,
      time2,
      time: time1 + time2,
      maxRadius: rb,
      a1,
      a2
    };
  }

  function formatDuration(seconds) {
    if (seconds < EPSILON) {
      return "0 секунд";
    }

    const totalHours = Math.round(seconds / 3600);

    if (totalHours < 1) {
      const minutes = Math.max(1, Math.round(seconds / 60));
      return `${formatNumber(minutes)} мин`;
    }

    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;

    if (days > 0) {
      return hours > 0
        ? `${formatNumber(days)} дн ${hours} ч`
        : `${formatNumber(days)} дн`;
    }

    return `${formatNumber(totalHours)} ч`;
  }

  function formatTimeHours(seconds) {
    return `${formatNumber(seconds / 3600, 2)} ч`;
  }

  function formatDV(kmPerSecond) {
    return `${formatNumber(kmPerSecond, 3)} км/с`;
  }

  function formatRadius(km) {
    return `${formatNumber(km)} км`;
  }

  function calculateSimulation(parameters) {
    const { r1, r2, rb } = parameters;

    if (
      !Number.isFinite(r1) ||
      !Number.isFinite(r2) ||
      !Number.isFinite(rb) ||
      r1 <= 0 ||
      r2 <= 0 ||
      rb <= Math.max(r1, r2)
    ) {
      throw new Error(
        "Проверьте радиусы: все значения должны быть положительными, " +
        "а rb — больше r1 и r2."
      );
    }

    return {
      parameters,
      hohmann: calculateHohmann(r1, r2),
      bielliptic: calculateBielliptic(r1, r2, rb)
    };
  }

  // ---------------------------------------------------------
  // Canvas и визуализация
  // ---------------------------------------------------------

  function resizeCanvas() {
    const rect = elements.canvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = rect.width;
    canvasHeight = rect.height;

    elements.canvas.width = Math.round(canvasWidth * pixelRatio);
    elements.canvas.height = Math.round(canvasHeight * pixelRatio);

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    createStars();
    drawScene(currentProgress());
  }

  function createStars() {
    stars = [];

    // Звёзды привязаны к текущему размеру холста.
    let seed = Math.round(canvasWidth * 100 + canvasHeight);

    function random() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    const count = Math.round(canvasWidth * canvasHeight / 2200);

    for (let i = 0; i < count; i++) {
      stars.push({
        x: random() * canvasWidth,
        y: random() * canvasHeight,
        radius: 0.4 + random() * 1.1,
        alpha: 0.2 + random() * 0.6
      });
    }
  }

  function worldSettings() {
    const p = simulation
      ? simulation.parameters
      : getParameters();

    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;

    const maxRadius = Math.max(p.r1, p.r2, p.rb);
    const availableRadius =
      Math.max(10, Math.min(canvasWidth, canvasHeight) / 2 - 28);

    const scale = availableRadius / maxRadius;

    return { cx, cy, scale, p };
  }

  function pointAtRadius(cx, cy, scale, radius, angle) {
    return {
      x: cx + Math.cos(angle) * radius * scale,
      y: cy + Math.sin(angle) * radius * scale
    };
  }

  function ellipseRadius(periapsis, apoapsis, theta) {
    const e = (apoapsis - periapsis) /
      (apoapsis + periapsis);

    const semiLatusRectum =
      2 * periapsis * apoapsis /
      (periapsis + apoapsis);

    return semiLatusRectum / (1 + e * Math.cos(theta));
  }

  function drawEllipseSegment(
    cx,
    cy,
    scale,
    periapsis,
    apoapsis,
    startAngle,
    endAngle,
    color,
    lineWidth,
    alpha = 1
  ) {
    const steps = 220;

    ctx.save();
    ctx.beginPath();

    for (let i = 0; i <= steps; i++) {
      const fraction = i / steps;
      const theta =
        startAngle + (endAngle - startAngle) * fraction;

      const radius = ellipseRadius(
        periapsis, apoapsis, theta
      );

      const point = pointAtRadius(
        cx, cy, scale, radius, theta
      );

      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  function drawCircle(cx, cy, radius, color, lineWidth = 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function drawGrid() {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (const star of stars) {
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(185, 211, 255, ${star.alpha})`;
      ctx.fill();
    }

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;

    const spacing = 40;

    for (let x = 0; x < canvasWidth; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    for (let y = 0; y < canvasHeight; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }
  }

  function drawEarth(cx, cy, scale, p) {
    const earthRadius = Math.max(
      5,
      Math.min(12, scale * Math.min(p.r1, p.r2) * 0.24)
    );

    const gradient = ctx.createRadialGradient(
      cx - earthRadius * 0.35,
      cy - earthRadius * 0.4,
      1,
      cx,
      cy,
      earthRadius * 1.5
    );

    gradient.addColorStop(0, "#b7f1ff");
    gradient.addColorStop(0.35, "#438cdb");
    gradient.addColorStop(0.75, "#16447f");
    gradient.addColorStop(1, "#0b1a38");

    ctx.save();
    ctx.shadowColor = "#54d8ff";
    ctx.shadowBlur = 18;

    ctx.beginPath();
    ctx.arc(cx, cy, earthRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#6ec8ff88";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    ctx.fillStyle = COLORS.text;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ЗЕМЛЯ", cx, cy + earthRadius + 15);
  }

  function drawOrbitLabels(cx, cy, scale, p) {
    const r1Point = pointAtRadius(
      cx, cy, scale, p.r1, -Math.PI / 2
    );

    const r2Point = pointAtRadius(
      cx, cy, scale, p.r2, -Math.PI / 2
    );

    const rbPoint = pointAtRadius(
      cx, cy, scale, p.rb, -Math.PI / 2
    );

    ctx.save();
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "left";

    ctx.fillStyle = COLORS.initial;
    ctx.fillText(
      `r₁ ${formatNumber(p.r1)} км`,
      r1Point.x + 5,
      r1Point.y + 12
    );

    ctx.fillStyle = COLORS.target;
    ctx.fillText(
      `r₂ ${formatNumber(p.r2)} км`,
      r2Point.x + 5,
      r2Point.y + 25
    );

    ctx.fillStyle = COLORS.bielliptic;
    ctx.fillText(
      `rᵦ ${formatNumber(p.rb)} км`,
      rbPoint.x + 5,
      rbPoint.y + 12
    );

    ctx.restore();
  }

  function drawOrbits(cx, cy, scale, p) {
    const orbit1 = p.r1 * scale;
    const orbit2 = p.r2 * scale;
    const orbitB = p.rb * scale;

    drawCircle(cx, cy, orbitB, "#c08bff45", 1);

    ctx.save();
    ctx.setLineDash([5, 6]);
    drawCircle(cx, cy, orbit1, COLORS.initial + "b0", 1.3);
    drawCircle(cx, cy, orbit2, COLORS.target + "b0", 1.3);
    ctx.restore();

    // Если r1 и r2 совпадают, начальная и целевая орбиты совпадают.
    if (Math.abs(p.r1 - p.r2) < EPSILON) {
      drawCircle(cx, cy, orbit1, "#edf3ff88", 1);
    }

    drawOrbitLabels(cx, cy, scale, p);
  }

  function drawHohmannPath(cx, cy, scale, p, progress) {
    if (Math.abs(p.r1 - p.r2) < EPSILON) {
      return pointAtRadius(
        cx, cy, scale, p.r1, 0
      );
    }

    const outward = p.r2 > p.r1;
    const periapsis = Math.min(p.r1, p.r2);
    const apoapsis = Math.max(p.r1, p.r2);

    const start = outward ? 0 : Math.PI;
    const end = outward ? Math.PI : Math.PI * 2;

    drawEllipseSegment(
      cx, cy, scale,
      periapsis, apoapsis,
      start, end,
      COLORS.hohmann, 2.5, 0.85
    );

    const angle = start + (end - start) * progress;
    const radius = ellipseRadius(
      periapsis, apoapsis, angle
    );

    return pointAtRadius(
      cx, cy, scale, radius, angle
    );
  }

  function drawBiellipticPath(
    cx, cy, scale, p, progress, result
  ) {
    drawEllipseSegment(
      cx, cy, scale,
      p.r1, p.rb,
      0, Math.PI,
      COLORS.bielliptic, 2.1, 0.85
    );

    drawEllipseSegment(
      cx, cy, scale,
      p.r2, p.rb,
      Math.PI, Math.PI * 2,
      COLORS.bielliptic, 2.1, 0.85
    );

    // Доли времени на каждом из двух эллиптических участков.
    const firstFraction = result.time1 / result.time;

    let radius;
    let angle;

    if (progress <= firstFraction) {
      const local = firstFraction > 0
        ? progress / firstFraction
        : 1;

      angle = Math.PI * clamp(local, 0, 1);
      radius = ellipseRadius(p.r1, p.rb, angle);
    } else {
      const secondFraction = 1 - firstFraction;
      const local = secondFraction > 0
        ? (progress - firstFraction) / secondFraction
        : 1;

      angle = Math.PI + Math.PI * clamp(local, 0, 1);
      radius = ellipseRadius(p.r2, p.rb, angle);
    }

    return pointAtRadius(
      cx, cy, scale, radius, angle
    );
  }

  function drawShip(point, color, label) {
    ctx.save();

    ctx.shadowColor = color;
    ctx.shadowBlur = 15;

    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = color + "88";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#edf3ff";
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, point.x + 10, point.y - 8);

    ctx.restore();
  }

  function drawScene(progress = 0) {
    if (canvasWidth <= 0 || canvasHeight <= 0) {
      return;
    }

    drawGrid();

    const { cx, cy, scale, p } = worldSettings();

    drawOrbits(cx, cy, scale, p);
    drawEarth(cx, cy, scale, p);

    let hohmannPoint;
    let biellipticPoint;

    const hProgress = clamp(progress, 0, 1);
    const bProgress = clamp(progress, 0, 1);

    if (simulation) {
      hohmannPoint = drawHohmannPath(
        cx, cy, scale, p, hProgress
      );

      biellipticPoint = drawBiellipticPath(
        cx, cy, scale, p, bProgress,
        simulation.bielliptic
      );
    } else {
      // До запуска показываем обе возможные траектории.
      hohmannPoint = drawHohmannPath(
        cx, cy, scale, p, 0
      );

      biellipticPoint = drawBiellipticPath(
        cx, cy, scale, p, 0,
        calculateBielliptic(p.r1, p.r2, p.rb)
      );
    }

    drawShip(hohmannPoint, COLORS.hohmann, "H");
    drawShip(biellipticPoint, COLORS.bielliptic, "B");
  }

  // ---------------------------------------------------------
  // Анимация
  // ---------------------------------------------------------

  function currentProgress() {
    if (!simulation) {
      return 0;
    }

    return clamp(
      animationElapsed / ANIMATION_DURATION,
      0,
      1
    );
  }

  function stopAnimation() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  function setStatus(text, className) {
    elements.status.textContent = text;
    elements.status.className =
      "status-badge" + (className ? ` ${className}` : "");
  }

  function startSimulation() {
    stopAnimation();

    try {
      const parameters = getParameters();
      simulation = calculateSimulation(parameters);
    } catch (error) {
      elements.message.textContent = error.message;
      return;
    }

    animationElapsed = 0;
    animationStart = 0;

    elements.results.hidden = true;
    elements.progress.textContent = "0%";
    elements.progressBar.style.width = "0%";
    elements.animationTime.textContent = "0,0 с";
    elements.start.disabled = true;
    elements.reset.disabled = true;

    elements.message.textContent =
      "Аппараты движутся по рассчитанным траекториям.";

    elements.caption.textContent = "ПЕРЕЛЁТ В ПРОЦЕССЕ";
    setStatus("ПЕРЕЛЁТ", "running");

    drawScene(0);

    animationFrame = requestAnimationFrame(animate);
  }

  function animate(timestamp) {
    if (!simulation) {
      animationFrame = null;
      return;
    }

    if (animationStart === 0) {
      animationStart = timestamp;
    }

    animationElapsed = Math.min(
      timestamp - animationStart,
      ANIMATION_DURATION
    );

    const progress = currentProgress();

    elements.progress.textContent =
      `${Math.round(progress * 100)}%`;

    elements.progressBar.style.width =
      `${progress * 100}%`;

    elements.animationTime.textContent =
      `${formatNumber(animationElapsed / 1000, 1)} с`;

    drawScene(progress);

    if (progress < 1) {
      animationFrame = requestAnimationFrame(animate);
    } else {
      animationFrame = null;
      finishSimulation();
    }
  }

  // ---------------------------------------------------------
  // Результаты и критерии сравнения
  // ---------------------------------------------------------

  function fillStrategy(prefix, result) {
    document.getElementById(`${prefix}-dv`).textContent =
      formatDV(result.dv);

    document.getElementById(`${prefix}-dv-ms`).textContent =
      `${formatNumber(result.dv * 1000, 1)} м/с`;

    document.getElementById(`${prefix}-time`).textContent =
      formatDuration(result.time);

    document.getElementById(`${prefix}-time-hours`).textContent =
      formatTimeHours(result.time);

    document.getElementById(`${prefix}-max`).textContent =
      formatRadius(result.maxRadius);
  }

  function finishSimulation() {
    const { hohmann, bielliptic, parameters } = simulation;

    // При нулевом переходе аппарат уже находится на целевой орбите.
    const reachedHohmann = true;
    const reachedBielliptic = true;

    fillStrategy("h", hohmann);
    fillStrategy("b", bielliptic);

    document.getElementById("h-success").textContent =
      reachedHohmann
        ? `✓ Целевая орбита r₂ = ${formatNumber(parameters.r2)} км достигнута`
        : "Целевая орбита не достигнута";

    document.getElementById("b-success").textContent =
      reachedBielliptic
        ? `✓ Целевая орбита r₂ = ${formatNumber(parameters.r2)} км достигнута`
        : "Целевая орбита не достигнута";

    const dvDifference = Math.abs(hohmann.dv - bielliptic.dv);
    const dvTolerance = Math.max(1e-7, Math.max(hohmann.dv, bielliptic.dv) * 1e-5);

    let dvVerdict;

    if (dvDifference <= dvTolerance) {
      dvVerdict =
        "По суммарному ΔV стратегии практически равноценны.";
    } else if (hohmann.dv < bielliptic.dv) {
      const saved = bielliptic.dv > 0
        ? (1 - hohmann.dv / bielliptic.dv) * 100
        : 0;

      dvVerdict =
        `По ΔV выгоднее переход Хомана: ${formatDV(hohmann.dv)} ` +
        `против ${formatDV(bielliptic.dv)} у биоэллиптики. ` +
        `Экономия относительно биоэллиптики — ${formatNumber(saved, 1)}%.`;
    } else {
      const saved = hohmann.dv > 0
        ? (1 - bielliptic.dv / hohmann.dv) * 100
        : 0;

      dvVerdict =
        `По ΔV выгоднее биоэллиптика: ${formatDV(bielliptic.dv)} ` +
        `против ${formatDV(hohmann.dv)} у перехода Хомана. ` +
        `Экономия относительно перехода Хомана — ${formatNumber(saved, 1)}%.`;
    }

    document.getElementById("dv-verdict").textContent = dvVerdict;

    let timeVerdict;

    if (Math.abs(hohmann.time - bielliptic.time) < EPSILON) {
      timeVerdict =
        "Время перелёта обеих стратегий одинаково.";
    } else if (hohmann.time < bielliptic.time) {
      timeVerdict =
        `По времени выгоднее переход Хомана: ${formatDuration(hohmann.time)} ` +
        `против ${formatDuration(bielliptic.time)} у биоэллиптики.`;
    } else {
      timeVerdict =
        `По времени выгоднее биоэллиптика: ${formatDuration(bielliptic.time)} ` +
        `против ${formatDuration(hohmann.time)} у перехода Хомана.`;
    }

    document.getElementById("time-verdict").textContent = timeVerdict;

    let overall;

    if (dvDifference <= dvTolerance) {
      overall =
        "Итог: по расходу характеристической скорости стратегии близки. " +
        "При выборе учитывай также длительность перелёта.";
    } else if (hohmann.dv < bielliptic.dv && hohmann.time < bielliptic.time) {
      overall =
        "Итог: переход Хомана выигрывает и по ΔV, и по времени для этих параметров.";
    } else if (bielliptic.dv < hohmann.dv && bielliptic.time < hohmann.time) {
      overall =
        "Итог: биоэллиптика выигрывает и по ΔV, и по времени для этих параметров.";
    } else if (hohmann.dv < bielliptic.dv) {
      overall =
        "Итог: Хоман экономит ΔV, но требует меньше времени. " +
        "Выбор зависит от того, что важнее для миссии.";
    } else {
      overall =
        "Итог: биоэллиптика экономит ΔV, но требует больше времени. " +
        "Выбор зависит от того, что важнее для миссии.";
    }

    document.getElementById("overall-verdict").textContent = overall;

    elements.results.hidden = false;
    elements.results.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start"
    });

    elements.start.disabled = false;
    elements.reset.disabled = false;

    elements.caption.textContent = "ПЕРЕЛЁТ ЗАВЕРШЁН";
    elements.message.textContent =
      "Симуляция завершена. Измени параметры, чтобы сравнить другие условия.";

    elements.progress.textContent = "100%";
    elements.progressBar.style.width = "100%";
    elements.animationTime.textContent =
      `${formatNumber(ANIMATION_DURATION / 1000, 1)} с`;

    setStatus("ЗАВЕРШЕНО", "done");
    drawScene(1);
  }

  function resetSimulation() {
    stopAnimation();

    simulation = null;
    animationStart = 0;
    animationElapsed = 0;

    elements.r1Range.value = String(DEFAULTS.r1);
    elements.r1Number.value = String(DEFAULTS.r1);
    elements.r2Range.value = String(DEFAULTS.r2);
    elements.r2Number.value = String(DEFAULTS.r2);
    elements.rbRange.value = String(DEFAULTS.rb);
    elements.rbNumber.value = String(DEFAULTS.rb);

    updateRbConstraint();

    elements.results.hidden = true;
    elements.start.disabled = false;
    elements.reset.disabled = false;

    elements.progress.textContent = "0%";
    elements.progressBar.style.width = "0%";
    elements.animationTime.textContent = "0,0 с";

    elements.message.textContent =
      "Параметры восстановлены. Можно начать новый перелёт.";

    elements.caption.textContent = "СХЕМА ОРБИТ";
    setStatus("ОЖИДАНИЕ", "");

    drawScene(0);
  }

  // ---------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------

  bindParameter("r1");
  bindParameter("r2");
  bindParameter("rb");

  elements.start.addEventListener("click", startSimulation);
  elements.reset.addEventListener("click", resetSimulation);

  window.addEventListener("resize", resizeCanvas);

  // Изменение ориентации и размеров контейнера тоже учитывается.
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => {
      resizeCanvas();
    });

    observer.observe(elements.canvas);
  }

  updateRbConstraint();
  resizeCanvas();
})();
