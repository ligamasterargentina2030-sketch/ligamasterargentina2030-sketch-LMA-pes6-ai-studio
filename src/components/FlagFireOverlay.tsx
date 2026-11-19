import { useEffect, useRef } from 'react';

interface SmokeWisp {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  grow: number;
  life: number;
  maxLife: number;
  maxAlpha: number;
  phase: number;
  freq: number;
  warm: number;
}

interface SparkStreak {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  phase: number;
  len: number;
}

// Fast smooth 2D value noise for scrolling flame turbulence
function hash2(ix: number, iy: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmNoise(x: number, y: number): number {
  return smoothNoise2D(x, y) * 0.65 + smoothNoise2D(x * 2.1, y * 2.1) * 0.35;
}

// Precompute natural warm-gold & orange fire LUT with balanced color saturation
const FIRE_LUT_R = new Uint8Array(256);
const FIRE_LUT_G = new Uint8Array(256);
const FIRE_LUT_B = new Uint8Array(256);
const FIRE_LUT_A = new Uint8Array(256);

for (let i = 0; i < 256; i++) {
  const t = i / 255;
  if (t < 0.08) {
    FIRE_LUT_R[i] = 0;
    FIRE_LUT_G[i] = 0;
    FIRE_LUT_B[i] = 0;
    FIRE_LUT_A[i] = 0;
  } else if (t < 0.32) {
    const k = (t - 0.08) / 0.24;
    FIRE_LUT_R[i] = Math.round(220 + k * 35);
    FIRE_LUT_G[i] = Math.round(68 + k * 56);
    FIRE_LUT_B[i] = Math.round(12 + k * 14);
    FIRE_LUT_A[i] = Math.round(k * 115);
  } else if (t < 0.62) {
    const k = (t - 0.32) / 0.3;
    FIRE_LUT_R[i] = 255;
    FIRE_LUT_G[i] = Math.round(124 + k * 66);
    FIRE_LUT_B[i] = Math.round(26 + k * 42);
    FIRE_LUT_A[i] = Math.round(115 + k * 68);
  } else if (t < 0.85) {
    const k = (t - 0.62) / 0.23;
    FIRE_LUT_R[i] = 255;
    FIRE_LUT_G[i] = Math.round(190 + k * 38);
    FIRE_LUT_B[i] = Math.round(68 + k * 72);
    FIRE_LUT_A[i] = Math.round(183 + k * 37);
  } else {
    const k = (t - 0.85) / 0.15;
    FIRE_LUT_R[i] = 255;
    FIRE_LUT_G[i] = Math.round(228 + k * 22);
    FIRE_LUT_B[i] = Math.round(140 + k * 65);
    FIRE_LUT_A[i] = Math.round(220 + k * 20);
  }
}

export function FlagFireOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Low-res fluid heat simulation buffer upscaled smoothly onto the display canvas
    const gridW = 128;
    const gridH = 112;
    const heat = new Float32Array(gridW * gridH);
    const nextHeat = new Float32Array(gridW * gridH);

    const simCanvas = document.createElement('canvas');
    simCanvas.width = gridW;
    simCanvas.height = gridH;
    const simCtx = simCanvas.getContext('2d');
    if (!simCtx) return;
    const imgData = simCtx.createImageData(gridW, gridH);
    const pixels = imgData.data;

    let width = 0;
    let height = 0;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(canvas);

    const smokes: SmokeWisp[] = [];
    const sparks: SparkStreak[] = [];

    // Tightly concentrated on the upper-left corner of the England/UK flag
    // (x: ~89.5%..92.6%, y: ~25.5%..30.5% inside the 83%..100% x 0%..44% overlay)
    const flagLeft = 0.382;
    const flagRight = 0.562;

    const getFlagBurnY = (nx: number, t: number): number => {
      const along = Math.max(0, Math.min(1, (nx - flagLeft) / (flagRight - flagLeft)));
      const clothWave = Math.sin(along * 5.0 - t * 0.8) * 0.008;
      // Corner burns slightly lower at the left edge and tapers up along the top corner edge
      return 0.655 - along * 0.032 + clothWave;
    };

    const spawnSmoke = (w: number, h: number, burnReach: number, t: number, prewarm = false) => {
      const along = Math.pow(Math.random(), 1.2) * burnReach;
      const nx = flagLeft + along * (flagRight - flagLeft);
      const ny = getFlagBurnY(nx, t) - 0.1 - Math.random() * 0.05;
      const scale = Math.max(0.5, w / 210);

      const s: SmokeWisp = {
        x: nx * w + (Math.random() - 0.5) * 4 * scale,
        y: ny * h,
        vx: (0.025 + (Math.random() - 0.35) * 0.1) * scale,
        vy: -(0.21 + Math.random() * 0.2) * scale,
        radius: (3.8 + Math.random() * 4.5) * scale,
        grow: (0.075 + Math.random() * 0.085) * scale,
        life: prewarm ? Math.random() * 0.85 : 0,
        maxLife: 2.3 + Math.random() * 1.5,
        maxAlpha: 0.13 + Math.random() * 0.09,
        phase: Math.random() * Math.PI * 2,
        freq: 0.55 + Math.random() * 0.8,
        warm: 0.5 + Math.random() * 0.25,
      };
      if (prewarm) {
        s.x += s.vx * s.life * 35;
        s.y += s.vy * s.life * 35;
        s.radius += s.grow * s.life * 35;
      }
      smokes.push(s);
    };

    const spawnSpark = (w: number, h: number, burnReach: number, t: number) => {
      const along = Math.random() * burnReach;
      const nx = flagLeft + along * (flagRight - flagLeft);
      const ny = getFlagBurnY(nx, t) - Math.random() * 0.03;
      const scale = Math.max(0.5, w / 210);

      sparks.push({
        x: nx * w,
        y: ny * h,
        vx: (Math.random() - 0.42) * 0.22 * scale,
        vy: -(0.42 + Math.random() * 0.56) * scale,
        life: 0,
        maxLife: 0.75 + Math.random() * 0.85,
        phase: Math.random() * Math.PI * 2,
        len: (1.4 + Math.random() * 1.6) * scale,
      });
    };

    const startTime = performance.now();
    let lastTime = startTime;
    let simAcc = 0;
    let smokeAcc = 0;
    let sparkAcc = 0;
    let rafId = 0;

    const stepSimulation = (t: number, burnReach: number, gustStrength: number) => {
      // 1. Seed compact catching-fire heat right on the flag corner
      const startGx = Math.floor(flagLeft * gridW);
      const endGx = Math.min(gridW - 3, Math.floor((flagLeft + (flagRight - flagLeft) * burnReach) * gridW));

      const waveA = 0.2 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.36));
      const waveB = 0.1 + 0.75 * (0.5 + 0.5 * Math.sin(t * 0.54 + 2.1));

      for (let gx = startGx; gx <= endGx; gx++) {
        const nx = gx / gridW;
        const along = (nx - flagLeft) / Math.max(0.01, flagRight - flagLeft);
        const burnY = getFlagBurnY(nx, t);
        const gyBase = Math.min(gridH - 3, Math.max(4, Math.floor(burnY * gridH)));

        const archShape = Math.sin(along * Math.PI) * 0.35 + (1 - along) * 0.65;
        const surgeA = Math.exp(-Math.pow((along - waveA) * 3.8, 2)) * 0.26;
        const surgeB = Math.exp(-Math.pow((along - waveB) * 4.4, 2)) * 0.22;
        const edgeNoise = fbmNoise(nx * 14 - t * 0.7, t * 1.05);

        const sourceHeat = Math.min(
          0.92,
          (archShape * 0.72 + surgeA + surgeB + gustStrength * 0.12) * (0.58 + edgeNoise * 0.55)
        );

        // Compact 3-row heat source right at the corner edge
        const seamDepth = along < 0.45 ? 3 : 2;
        for (let dy = 0; dy < seamDepth; dy++) {
          const gy = Math.min(gridH - 2, gyBase + dy - 1);
          const idx = gy * gridW + gx;
          const fadeRow = 1 - dy * 0.22;
          heat[idx] = Math.max(heat[idx], sourceHeat * fadeRow);
        }
      }

      // 2. Smooth, gentle upward advection with higher cooling to keep flames compact in the corner
      const scrollY = t * 5.0;
      const globalWind = Math.sin(t * 0.55) * 0.15 + 0.06;

      for (let gy = 0; gy < gridH - 2; gy++) {
        for (let gx = 1; gx < gridW - 1; gx++) {
          const idx = gy * gridW + gx;

          const curl =
            Math.sin(gy * 0.22 + scrollY * 0.35 + gx * 0.18) * 0.36 +
            globalWind;
          const srcX = Math.max(1, Math.min(gridW - 2, Math.round(gx - curl)));
          const below1 = heat[(gy + 1) * gridW + srcX];
          const below2 = heat[Math.min(gridH - 1, gy + 2) * gridW + gx];
          const belowL = heat[(gy + 1) * gridW + Math.max(0, srcX - 1)];
          const belowR = heat[(gy + 1) * gridW + Math.min(gridW - 1, srcX + 1)];

          const avgBelow =
            below1 * 0.54 + below2 * 0.22 + belowL * 0.12 + belowR * 0.12;

          const advected = heat[idx] * 0.38 + avgBelow * 0.62;

          const n = fbmNoise(gx * 0.18 - t * 0.32, gy * 0.18 + scrollY * 0.22);
          const heightFactor = 1 - gy / gridH;
          // Higher cooling keeps flames tighter & shorter right on the corner
          const cooling = 0.018 + (0.042 + heightFactor * 0.042) * (0.48 + n * 1.15);

          nextHeat[idx] = Math.max(0, advected - cooling);
        }
      }

      for (let i = 0; i < gridW * gridH; i++) {
        const val = nextHeat[i];
        heat[i] = val;
        const lutIdx = Math.min(255, Math.max(0, Math.round(val * 255)));
        const p = i * 4;
        pixels[p] = FIRE_LUT_R[lutIdx];
        pixels[p + 1] = FIRE_LUT_G[lutIdx];
        pixels[p + 2] = FIRE_LUT_B[lutIdx];
        pixels[p + 3] = FIRE_LUT_A[lutIdx];
      }

      simCtx.putImageData(imgData, 0, 0);
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const elapsed = (now - startTime) * 0.001;
      const t = now * 0.001;

      if (width <= 0 || height <= 0) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (prefersReduced) {
        ctx.clearRect(0, 0, width, height);
        const gx = width * 0.46;
        const gy = height * 0.63;
        const glow = ctx.createRadialGradient(gx, gy, 1, gx, gy, width * 0.16);
        glow.addColorStop(0, 'rgba(255, 225, 130, 0.36)');
        glow.addColorStop(0.5, 'rgba(255, 140, 45, 0.18)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
        return;
      }

      const initialSpread = Math.min(1, 0.4 + (elapsed / 4.0) * 0.6);
      const breathingReach = 0.84 + 0.12 * Math.sin(t * 0.35) + 0.04 * Math.sin(t * 0.9);
      const burnReach = Math.min(1, initialSpread * breathingReach);
      const gustStrength = 0.5 + 0.5 * Math.sin(t * 0.75 + Math.sin(t * 0.3));

      if (smokes.length === 0 && width > 0) {
        for (let i = 0; i < 10; i++) spawnSmoke(width, height, burnReach, t, true);
      }

      simAcc += dt * 28;
      let stepped = false;
      while (simAcc >= 1) {
        stepSimulation(t, burnReach, gustStrength);
        simAcc -= 1;
        stepped = true;
      }
      if (!stepped && elapsed < 0.08) {
        stepSimulation(t, burnReach, gustStrength);
      }

      smokeAcc += dt * (6.5 + gustStrength * 3);
      while (smokeAcc >= 1) {
        spawnSmoke(width, height, burnReach, t);
        smokeAcc -= 1;
      }

      sparkAcc += dt * (4 + gustStrength * 3.5);
      while (sparkAcc >= 1) {
        spawnSpark(width, height, burnReach, t);
        sparkAcc -= 1;
      }

      ctx.clearRect(0, 0, width, height);

      // 1. Subtle darkened cloth seam right on the burning corner
      ctx.globalCompositeOperation = 'source-over';
      const segs = 12;
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const nx = flagLeft + u * (flagRight - flagLeft) * burnReach;
        const ny = getFlagBurnY(nx, t) + 0.01;
        const px = nx * width;
        const py = ny * height;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(20, 12, 8, 0.28)';
      ctx.lineWidth = Math.max(2, width * 0.016);
      ctx.lineCap = 'round';
      ctx.filter = 'blur(1.5px)';
      ctx.stroke();
      ctx.restore();

      // 2. Gentle smoke column rising from the corner
      for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i];
        s.life += dt / s.maxLife;
        if (s.life >= 1) {
          smokes.splice(i, 1);
          continue;
        }

        const turb = Math.sin(t * s.freq + s.phase) * 0.12 * Math.max(0.5, width / 210);
        s.x += (s.vx + turb + Math.sin(t * 0.4) * 0.03) * (dt * 60);
        s.y += s.vy * (dt * 60);
        s.vy *= 0.997;
        s.radius += s.grow * (dt * 60);

        const fade = Math.sin(s.life * Math.PI);
        const alpha = s.maxAlpha * Math.pow(fade, 0.85);
        const fireLit = Math.max(0, 1 - s.life * 2.4) * s.warm;
        const r = Math.round(160 + fireLit * 75);
        const g = Math.round(165 + fireLit * 32);
        const b = Math.round(178 - fireLit * 30);

        const grad = ctx.createRadialGradient(s.x, s.y, s.radius * 0.1, s.x, s.y, s.radius);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
        grad.addColorStop(
          0.55,
          `rgba(${Math.round(r * 0.88)}, ${Math.round(g * 0.9)}, ${Math.round(b * 0.94)}, ${alpha * 0.48})`
        );
        grad.addColorStop(1, 'rgba(115, 122, 134, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Compact warm ambient glow right on the corner
      ctx.globalCompositeOperation = 'lighter';
      const glowPulse = 0.9 + 0.1 * Math.sin(t * 4.2) * Math.cos(t * 2.7);
      const glowX = width * (flagLeft + 0.42 * (flagRight - flagLeft) * burnReach);
      const glowY = height * 0.63;
      const glowRad = width * 0.16 * glowPulse;
      const glow = ctx.createRadialGradient(glowX, glowY, 1, glowX, glowY, glowRad);
      glow.addColorStop(0, 'rgba(255, 220, 130, 0.22)');
      glow.addColorStop(0.5, 'rgba(255, 145, 50, 0.11)');
      glow.addColorStop(1, 'rgba(255, 90, 20, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(glowX, glowY, glowRad, 0, Math.PI * 2);
      ctx.fill();

      // 4. Warm golden-orange ember seam right on the corner edge
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const nx = flagLeft + u * (flagRight - flagLeft) * burnReach;
        const jitter = (smoothNoise2D(u * 10, t * 2.5) - 0.5) * 0.01;
        const ny = getFlagBurnY(nx, t) + jitter;
        const px = nx * width;
        const py = ny * height;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = `rgba(255, 165, 58, ${(0.38 + 0.16 * gustStrength).toFixed(2)})`;
      ctx.lineWidth = Math.max(1.4, width * 0.009);
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(255, 120, 25, 0.65)';
      ctx.shadowBlur = 4;
      ctx.stroke();
      ctx.restore();

      // 5. Upscale compact warm fire simulation onto the corner
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.8;
      ctx.drawImage(simCanvas, 0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.24;
      ctx.drawImage(simCanvas, 0, 0, width, height);
      ctx.restore();

      // 6. Small gentle warm sparks rising from the corner
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.life += dt / sp.maxLife;
        if (sp.life >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        const flutter = Math.sin(t * 4.5 + sp.phase) * 0.14;
        const vx = sp.vx + flutter;
        sp.x += vx * (dt * 60);
        sp.y += sp.vy * (dt * 60);

        const alpha = (1 - sp.life) * (0.45 + 0.35 * Math.sin(t * 9 + sp.phase)) * 0.8;
        const speedNorm = Math.hypot(vx, sp.vy) || 1;
        const dx = (vx / speedNorm) * sp.len;
        const dy = (sp.vy / speedNorm) * sp.len;

        ctx.strokeStyle = `rgba(255, ${Math.round(215 - sp.life * 75)}, ${Math.round(115 - sp.life * 80)}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(0.9, width * 0.0045);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sp.x - dx, sp.y - dy);
        ctx.stroke();
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute z-[5] select-none"
      style={{
        left: '83%',
        top: '0%',
        width: '17%',
        height: '44%',
      }}
    />
  );
}
