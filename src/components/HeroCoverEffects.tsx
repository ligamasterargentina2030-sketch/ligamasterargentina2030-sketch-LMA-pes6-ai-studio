import { useEffect, useRef } from 'react';

interface FlameParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
  wobblePhase: number;
}

interface EmberParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
}

export function HeroCoverEffects() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    canvas.width = 640;
    canvas.height = 360;

    const flameParticles: FlameParticle[] = [];
    const emberParticles: EmberParticle[] = [];

    const spawnFlame = () => {
      const w = canvas.width;
      const h = canvas.height;
      flameParticles.push({
        x: (0.896 + (Math.random() - 0.5) * 0.024) * w,
        y: (0.295 + (Math.random() - 0.5) * 0.022) * h,
        vx: (Math.random() - 0.55) * 0.25,
        vy: -(0.7 + Math.random() * 0.85),
        radius: 6 + Math.random() * 7.5,
        life: 0,
        maxLife: 24 + Math.random() * 18,
        wobblePhase: Math.random() * Math.PI * 2,
      });
    };

    const spawnEmber = () => {
      const w = canvas.width;
      const h = canvas.height;
      emberParticles.push({
        x: (0.896 + (Math.random() - 0.5) * 0.022) * w,
        y: (0.282 + (Math.random() - 0.5) * 0.02) * h,
        vx: -0.08 + (Math.random() - 0.5) * 0.22,
        vy: -(0.55 + Math.random() * 0.65),
        size: 0.8 + Math.random() * 0.9,
        life: 0,
        maxLife: 20 + Math.random() * 14,
      });
    };

    for (let i = 0; i < 16; i++) spawnFlame();

    let rafId = 0;
    let tickCount = 0;
    let lastTime = 0;
    const FRAME_INTERVAL = 1000 / 30;

    const render = (now: number) => {
      rafId = window.requestAnimationFrame(render);
      if (document.hidden || now - lastTime < FRAME_INTERVAL) return;
      lastTime = now;

      tickCount++;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      if (flameParticles.length < 24) {
        spawnFlame();
      }
      if (emberParticles.length < 10 && Math.random() > 0.72) {
        spawnEmber();
      }

      // Warm flickering fire glow on the England flag corner
      ctx.globalCompositeOperation = 'lighter';
      const glowPulse =
        0.25 +
        Math.sin(tickCount * 0.22) * 0.045 +
        Math.sin(tickCount * 0.47) * 0.035;
      const gx = 0.897 * w;
      const gy = 0.275 * h;
      const gRadius = 32;
      const glowGrad = ctx.createRadialGradient(gx, gy, 1, gx, gy, gRadius);
      glowGrad.addColorStop(0, `rgba(254, 240, 138, ${glowPulse * 0.85})`);
      glowGrad.addColorStop(0.38, `rgba(249, 115, 22, ${glowPulse * 0.65})`);
      glowGrad.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(gx, gy, gRadius, 0, Math.PI * 2);
      ctx.fill();

      // Realistic licking flames on the England flag
      for (let i = flameParticles.length - 1; i >= 0; i--) {
        const f = flameParticles[i];
        f.life += 1;
        if (f.life >= f.maxLife) {
          flameParticles.splice(i, 1);
          continue;
        }

        const t = f.life / f.maxLife;
        f.wobblePhase += 0.2;
        f.x += f.vx + Math.sin(f.wobblePhase) * 0.35;
        f.y += f.vy;

        const curR = f.radius * (1 - t * 0.72);
        if (curR <= 0.4) continue;

        const alpha = (1 - t) * 0.62;
        const grad = ctx.createRadialGradient(f.x, f.y, 0.3, f.x, f.y, curR);
        if (t < 0.34) {
          grad.addColorStop(0, `rgba(255, 251, 204, ${alpha})`);
          grad.addColorStop(0.45, `rgba(251, 191, 36, ${alpha * 0.85})`);
          grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        } else {
          grad.addColorStop(0, `rgba(251, 146, 60, ${alpha})`);
          grad.addColorStop(0.55, `rgba(234, 88, 12, ${alpha * 0.7})`);
          grad.addColorStop(1, 'rgba(185, 28, 28, 0)');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, curR * 0.78, curR * 1.28, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rising glowing sparks from the fire
      for (let i = emberParticles.length - 1; i >= 0; i--) {
        const e = emberParticles[i];
        e.life += 1;
        if (e.life >= e.maxLife) {
          emberParticles.splice(i, 1);
          continue;
        }
        const t = e.life / e.maxLife;
        e.x += e.vx + Math.sin(tickCount * 0.14 + i) * 0.2;
        e.y += e.vy;
        const alpha = (1 - t) * 0.9;
        ctx.fillStyle = t < 0.4 ? `rgba(254, 240, 138, ${alpha})` : `rgba(251, 146, 60, ${alpha})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * (1 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    rafId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none select-none"
      aria-hidden="true"
    />
  );
}
