import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { resolveAssetUrl } from '../utils/assetUrl';
import { ResilientImage } from './ResilientImage';

interface FireworksIntroProps {
  iconUrl: string;
  title: string;
  subtitle: string;
  onCurtainStart?: () => void;
  onFinish: () => void;
}

type BurstStyle = 'chrysanthemum' | 'willow' | 'corona';

interface Rocket {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  targetY: number;
  colorIndex: number;
  style: BurstStyle;
}

interface Spark {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  alpha: number;
  decay: number;
  colorIndex: number;
  gravity: number;
  drag: number;
  twinkle: boolean;
}

interface FlashBloom {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  colorIndex: number;
}

const FIREWORKS_AUDIO_URL = resolveAssetUrl(
  '/assets/aistudio/ESPECTACULO_DE_FUEGOS_ARTIFICIALES_O_SHOWS_DE_BOMBARDAS_MULTICOLORES_PARA_EVENTOS_EN_LIMA_PERU_FEP__mp3cut.net__eadc6914.mp3'
);
const DEFAULT_SHIELD_FALLBACK = resolveAssetUrl(
  '/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png'
);

// Paleta elegante: Oro, Plata, Celeste, Blanco y Verde Liga
const LUXURY_FIREWORKS_PALETTE = [
  '#FACC15', // 0: Dorado intenso
  '#FEF08A', // 1: Oro champagne
  '#E2E8F0', // 2: Plateado brillante
  '#CBD5E1', // 3: Plata metálico
  '#38BDF8', // 4: Celeste Liga
  '#FFFFFF', // 5: Blanco puro
  '#34D399', // 6: Verde esmeralda Liga
] as const;

const MAX_SPARKS = 400;

function createGlowSprite(color: string): HTMLCanvasElement {
  const size = 88;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  if (octx) {
    const half = size / 2;
    const grad = octx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255, 253, 245, 0.94)');
    grad.addColorStop(0.28, color);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = grad;
    octx.fillRect(0, 0, size, size);
  }
  return off;
}

function createStarSprite(color: string): HTMLCanvasElement {
  const size = 22;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  if (octx) {
    const c = size / 2;
    const grad = octx.createRadialGradient(c, c, 0, c, c, c * 0.45);
    grad.addColorStop(0, '#FFFFFF');
    grad.addColorStop(0.45, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = grad;
    octx.fillRect(0, 0, size, size);

    // Destello en cruz sutil
    octx.strokeStyle = '#FFFFFF';
    octx.globalAlpha = 0.82;
    octx.lineWidth = 1.25;
    octx.beginPath();
    octx.moveTo(c - 7, c);
    octx.lineTo(c + 7, c);
    octx.moveTo(c, c - 7);
    octx.lineTo(c, c + 7);
    octx.stroke();
  }
  return off;
}

const SCREEN_SECTORS: Array<{ xMin: number; xMax: number; yMin: number; yMax: number }> = [
  { xMin: 0.07, xMax: 0.22, yMin: 0.12, yMax: 0.46 }, // Flanco superior izquierdo
  { xMin: 0.78, xMax: 0.93, yMin: 0.12, yMax: 0.46 }, // Flanco superior derecho
  { xMin: 0.08, xMax: 0.25, yMin: 0.50, yMax: 0.78 }, // Flanco inferior izquierdo
  { xMin: 0.75, xMax: 0.92, yMin: 0.50, yMax: 0.78 }, // Flanco inferior derecho
  { xMin: 0.26, xMax: 0.74, yMin: 0.08, yMax: 0.28 }, // Corona superior central
  { xMin: 0.22, xMax: 0.42, yMin: 0.22, yMax: 0.62 }, // Media izquierda
  { xMin: 0.58, xMax: 0.78, yMin: 0.22, yMax: 0.62 }, // Media derecha
];

export function FireworksIntro({
  iconUrl,
  title,
  subtitle,
  onCurtainStart,
  onFinish,
}: FireworksIntroProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fireworksAudioRef = useRef<HTMLAudioElement | null>(null);
  const soundEnabledRef = useRef(true);
  const introExpiredRef = useRef(false);
  const curtainOpenRef = useRef(false);
  const audioMaxTimerRef = useRef<number | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  const onCurtainStartRef = useRef(onCurtainStart);
  const onFinishRef = useRef(onFinish);
  onCurtainStartRef.current = onCurtainStart;
  onFinishRef.current = onFinish;
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [curtainOpen, setCurtainOpen] = useState(false);

  const stopFireworksAudio = useCallback(() => {
    introExpiredRef.current = true;
    if (audioMaxTimerRef.current !== null) {
      window.clearTimeout(audioMaxTimerRef.current);
      audioMaxTimerRef.current = null;
    }
    const audio = fireworksAudioRef.current;
    if (audio) {
      audio.pause();
      audio.muted = true;
      try {
        audio.currentTime = 0;
      } catch {
        // ignore
      }
    }
  }, []);

  const tryPlayFireworksAudio = useCallback(async () => {
    const audio = fireworksAudioRef.current;
    if (!audio || !soundEnabledRef.current || introExpiredRef.current) return;
    try {
      audio.muted = false;
      audio.volume = 0.85;
      await audio.play();
      setAutoplayBlocked(false);
      if (audioMaxTimerRef.current === null && !introExpiredRef.current) {
        audioMaxTimerRef.current = window.setTimeout(() => {
          stopFireworksAudio();
        }, 8200);
      }
    } catch {
      setAutoplayBlocked(true);
    }
  }, [stopFireworksAudio]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    const audio = fireworksAudioRef.current;
    if (!audio) return;
    if (introExpiredRef.current) {
      stopFireworksAudio();
      return;
    }
    audio.muted = !soundEnabled;
    if (soundEnabled && audio.paused) {
      void tryPlayFireworksAudio();
    } else if (!soundEnabled && !audio.paused) {
      audio.pause();
    }
  }, [soundEnabled, tryPlayFireworksAudio, stopFireworksAudio]);

  useEffect(() => {
    introExpiredRef.current = false;
    curtainOpenRef.current = false;
    void tryPlayFireworksAudio();

    const unlock = () => {
      if (!introExpiredRef.current) {
        void tryPlayFireworksAudio();
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      stopFireworksAudio();
    };
  }, [tryPlayFireworksAudio, stopFireworksAudio]);

  // Intro 8.2s (+3s): escudo crece hasta 7350ms y al expandirse abre la cortina revelando el inicio
  useEffect(() => {
    const curtainTimer = window.setTimeout(() => {
      curtainOpenRef.current = true;
      stopFireworksAudio();
      onCurtainStartRef.current?.();
      setCurtainOpen(true);
    }, 7350);

    const endTimer = window.setTimeout(() => {
      stopFireworksAudio();
      onFinishRef.current();
    }, 8200);

    return () => {
      window.clearTimeout(curtainTimer);
      window.clearTimeout(endTimer);
      if (finishTimerRef.current !== null) {
        window.clearTimeout(finishTimerRef.current);
      }
    };
  }, [stopFireworksAudio]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let viewW = window.innerWidth;
    let viewH = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      viewW = Math.max(1, window.innerWidth);
      viewH = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#050608';
      ctx.fillRect(0, 0, viewW, viewH);
    };
    resize();

    let resizeTimer: number | null = null;
    const handleResize = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 120);
    };
    window.addEventListener('resize', handleResize);

    // Sprites pre-cacheados (cero asignaciones de gradiente por frame)
    const glowSprites: HTMLCanvasElement[] = LUXURY_FIREWORKS_PALETTE.map(createGlowSprite);
    const starSprites: HTMLCanvasElement[] = LUXURY_FIREWORKS_PALETTE.map(createStarSprite);

    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];
    const blooms: FlashBloom[] = [];

    // Cubetas planas por color y banda de alfa -> máx 21 stroke() calls por frame, cero GC
    const brightBuckets: Spark[][] = LUXURY_FIREWORKS_PALETTE.map(() => []);
    const midBuckets: Spark[][] = LUXURY_FIREWORKS_PALETTE.map(() => []);
    const dimBuckets: Spark[][] = LUXURY_FIREWORKS_PALETTE.map(() => []);

    let sectorIdx = 0;
    const nextSectorTarget = (): { x: number; y: number } => {
      const s = SCREEN_SECTORS[sectorIdx % SCREEN_SECTORS.length];
      sectorIdx += 1;
      return {
        x: viewW * (s.xMin + Math.random() * (s.xMax - s.xMin)),
        y: viewH * (s.yMin + Math.random() * (s.yMax - s.yMin)),
      };
    };

    const pickStyle = (): BurstStyle => {
      const r = Math.random();
      if (r < 0.38) return 'chrysanthemum';
      if (r < 0.72) return 'corona';
      return 'willow';
    };

    const detonate = (
      cx: number,
      cy: number,
      forcedColorIdx?: number,
      forcedStyle?: BurstStyle
    ) => {
      const style = forcedStyle ?? pickStyle();
      const c1 =
        forcedColorIdx !== undefined
          ? forcedColorIdx
          : Math.floor(Math.random() * LUXURY_FIREWORKS_PALETTE.length);
      const c2 = (c1 + 2 + Math.floor(Math.random() * 3)) % LUXURY_FIREWORKS_PALETTE.length;
      const ringColors =
        style === 'willow' ? [0, 1, 2, 5] : style === 'corona' ? [c1, 4, 5, 0, c2] : [c1, c2, 5, 0];

      blooms.push({
        x: cx,
        y: cy,
        radius: style === 'willow' ? 68 + Math.random() * 24 : 58 + Math.random() * 22,
        alpha: 0.85,
        colorIndex: c1,
      });

      const available = MAX_SPARKS - sparks.length;
      if (available <= 4) return;

      const scaleBoost = Math.min(1.22, Math.max(0.85, Math.min(viewW, viewH) / 760));
      const outerTarget = style === 'willow' ? 30 : 34;
      const count = Math.min(outerTarget, available);

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.12;
        const baseSpeed =
          style === 'willow'
            ? (2.4 + Math.random() * 4.4) * scaleBoost
            : (3.2 + Math.random() * 5.8) * scaleBoost;
        const colorIndex = ringColors[i % ringColors.length];
        sparks.push({
          x: cx,
          y: cy,
          prevX: cx,
          prevY: cy,
          vx: Math.cos(angle) * baseSpeed,
          vy: Math.sin(angle) * baseSpeed,
          alpha: 1,
          decay:
            style === 'willow'
              ? 0.015 + Math.random() * 0.011
              : 0.02 + Math.random() * 0.013,
          colorIndex,
          gravity: style === 'willow' ? 0.084 : 0.052,
          drag: style === 'willow' ? 0.968 : 0.962,
          twinkle: style !== 'willow' && i % 3 === 0,
        });
      }

      const innerCount = Math.min(style === 'corona' ? 14 : 10, MAX_SPARKS - sparks.length);
      for (let j = 0; j < innerCount; j++) {
        const angle = (Math.PI * 2 * j) / Math.max(1, innerCount) + 0.18;
        const speed = (1.5 + Math.random() * 2.2) * scaleBoost;
        sparks.push({
          x: cx,
          y: cy,
          prevX: cx,
          prevY: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          decay: 0.024 + Math.random() * 0.011,
          colorIndex: style === 'corona' ? ((j & 1) === 0 ? 4 : 5) : ((j & 1) === 0 ? 1 : 2),
          gravity: 0.042,
          drag: 0.955,
          twinkle: j % 2 === 0,
        });
      }
    };

    const launchRocket = (targetOverride?: { x: number; y: number }) => {
      const target = targetOverride ?? nextSectorTarget();
      // Lanzamiento diagonal desde todo el ancho inferior para cubrir bordes izquierdo y derecho
      const startX = Math.min(
        viewW * 0.94,
        Math.max(viewW * 0.06, target.x + (Math.random() - 0.5) * viewW * 0.22)
      );
      const travelFrames = 16 + Math.random() * 7;
      rockets.push({
        x: startX,
        y: viewH + 10,
        prevX: startX,
        prevY: viewH + 10,
        vx: (target.x - startX) / travelFrames,
        vy: (target.y - (viewH + 10)) / travelFrames,
        targetY: target.y,
        colorIndex: Math.floor(Math.random() * LUXURY_FIREWORKS_PALETTE.length),
        style: pickStyle(),
      });
    };

    // Salva inicial en las 4 esquinas/laterales para llenar toda la pantalla desde el segundo 0
    detonate(viewW * 0.14, viewH * 0.22, 0, 'corona');
    detonate(viewW * 0.86, viewH * 0.22, 4, 'chrysanthemum');
    detonate(viewW * 0.18, viewH * 0.68, 2, 'willow');
    detonate(viewW * 0.82, viewH * 0.68, 6, 'corona');
    launchRocket({ x: viewW * 0.5, y: viewH * 0.14 });
    launchRocket({ x: viewW * 0.3, y: viewH * 0.32 });

    const startMs = performance.now();
    let lastMs = startMs;
    let spawnAcc = 0;
    let burstAcc = 0;
    let finaleFired = false;
    let rafId = 0;

    const tick = (now: number) => {
      if (curtainOpenRef.current) {
        return;
      }

      const elapsed = now - startMs;
      const rawDt = (now - lastMs) / 16.6667;
      const dt = Math.min(2.0, Math.max(0.5, rawDt));
      const frameHeavy = rawDt > 2.15;
      lastMs = now;

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(5, 6, 8, 0.31)';
      ctx.fillRect(0, 0, viewW, viewH);

      if (!prefersReduced && elapsed < 6650 && !frameHeavy) {
        spawnAcc += dt;
        burstAcc += dt;
        if (spawnAcc >= 14) {
          spawnAcc = 0;
          launchRocket();
        }
        if (burstAcc >= 19) {
          burstAcc = 0;
          const t = nextSectorTarget();
          detonate(t.x, t.y);
        }
      }

      // Gran salva final alrededor del escudo antes de abrir la cortina
      if (!prefersReduced && !finaleFired && elapsed >= 6420) {
        finaleFired = true;
        detonate(viewW * 0.12, viewH * 0.25, 0, 'chrysanthemum');
        detonate(viewW * 0.88, viewH * 0.25, 4, 'corona');
        detonate(viewW * 0.15, viewH * 0.72, 1, 'willow');
        detonate(viewW * 0.85, viewH * 0.72, 5, 'chrysanthemum');
        detonate(viewW * 0.5, viewH * 0.13, 0, 'corona');
      }

      ctx.globalCompositeOperation = 'lighter';

      // Blooms cacheados
      for (let i = blooms.length - 1; i >= 0; i--) {
        const b = blooms[i];
        const sprite = glowSprites[b.colorIndex] || glowSprites[0];
        ctx.globalAlpha = b.alpha > 0 ? b.alpha : 0;
        const d = b.radius * 2;
        ctx.drawImage(sprite, b.x - b.radius, b.y - b.radius, d, d);
        b.alpha -= 0.075 * dt;
        b.radius *= 1 + 0.036 * dt;
        if (b.alpha <= 0) {
          blooms[i] = blooms[blooms.length - 1];
          blooms.pop();
        }
      }

      // Cohetes ascendentes con estela brillante
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.lineWidth = 2.6;
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.prevX = r.x;
        r.prevY = r.y;
        r.x += r.vx * dt;
        r.y += r.vy * dt;

        ctx.strokeStyle = LUXURY_FIREWORKS_PALETTE[r.colorIndex];
        ctx.beginPath();
        ctx.moveTo(r.prevX - r.vx * 2.2, r.prevY - r.vy * 2.2);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();

        if (r.y <= r.targetY) {
          detonate(r.x, r.y, r.colorIndex, r.style);
          rockets[i] = rockets[rockets.length - 1];
          rockets.pop();
        }
      }

      // Actualizar chispas y agrupar por color + 3 bandas de opacidad (máx 21 stroke calls/frame)
      for (let c = 0; c < LUXURY_FIREWORKS_PALETTE.length; c++) {
        brightBuckets[c].length = 0;
        midBuckets[c].length = 0;
        dimBuckets[c].length = 0;
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.prevX = s.x;
        s.prevY = s.y;
        const dragStep = s.drag ** dt;
        s.vx *= dragStep;
        s.vy *= dragStep;
        s.vy += s.gravity * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.alpha -= s.decay * dt;

        if (s.alpha <= 0) {
          sparks[i] = sparks[sparks.length - 1];
          sparks.pop();
          continue;
        }

        if (s.alpha >= 0.65) {
          brightBuckets[s.colorIndex].push(s);
        } else if (s.alpha >= 0.3) {
          midBuckets[s.colorIndex].push(s);
        } else {
          dimBuckets[s.colorIndex].push(s);
        }
      }

      ctx.lineWidth = 2.4;
      ctx.globalAlpha = 0.95;
      for (let c = 0; c < LUXURY_FIREWORKS_PALETTE.length; c++) {
        const bucket = brightBuckets[c];
        if (bucket.length === 0) continue;
        ctx.strokeStyle = LUXURY_FIREWORKS_PALETTE[c];
        ctx.beginPath();
        for (let k = 0; k < bucket.length; k++) {
          const s = bucket[k];
          ctx.moveTo(s.prevX, s.prevY);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();

        // Destellos estrella en puntas brillantes (omitir solo si el frame tuvo retraso)
        if (!frameHeavy) {
          const star = starSprites[c];
          for (let k = 0; k < bucket.length; k++) {
            const s = bucket[k];
            if (s.twinkle) {
              ctx.drawImage(star, s.x - 8, s.y - 8, 16, 16);
            }
          }
        }
      }

      ctx.lineWidth = 1.9;
      ctx.globalAlpha = 0.62;
      for (let c = 0; c < LUXURY_FIREWORKS_PALETTE.length; c++) {
        const bucket = midBuckets[c];
        if (bucket.length === 0) continue;
        ctx.strokeStyle = LUXURY_FIREWORKS_PALETTE[c];
        ctx.beginPath();
        for (let k = 0; k < bucket.length; k++) {
          const s = bucket[k];
          ctx.moveTo(s.prevX, s.prevY);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }

      ctx.lineWidth = 1.3;
      ctx.globalAlpha = 0.34;
      for (let c = 0; c < LUXURY_FIREWORKS_PALETTE.length; c++) {
        const bucket = dimBuckets[c];
        if (bucket.length === 0) continue;
        ctx.strokeStyle = LUXURY_FIREWORKS_PALETTE[c];
        ctx.beginPath();
        for (let k = 0; k < bucket.length; k++) {
          const s = bucket[k];
          ctx.moveTo(s.prevX, s.prevY);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      if (elapsed < 7350 && !curtainOpenRef.current) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleSkipIntro = () => {
    curtainOpenRef.current = true;
    stopFireworksAudio();
    onCurtainStart?.();
    setCurtainOpen(true);
    finishTimerRef.current = window.setTimeout(onFinish, 650);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden pointer-events-auto [contain:layout_style_paint]"
      aria-label="Presentación Liga Master Argentina PES6"
    >
      <audio
        ref={fireworksAudioRef}
        src={FIREWORKS_AUDIO_URL}
        autoPlay
        loop
        playsInline
        preload="metadata"
      />

      {/* Cortina negro ónix con bordes dorados y plateados que se abre desde el centro cuando el escudo crece */}
      <div
        className={`absolute inset-y-0 left-0 z-[1] w-1/2 bg-gradient-to-r from-[#040507] via-[#0B0D12] to-[#121620] border-r-2 border-amber-400/90 shadow-[12px_0_40px_rgba(250,204,21,0.22)] transition-transform duration-[800ms] ease-[cubic-bezier(0.77,0,0.175,1)] will-change-transform transform-gpu ${
          curtainOpen ? '-translate-x-full' : 'translate-x-0'
        }`}
      />
      <div
        className={`absolute inset-y-0 right-0 z-[1] w-1/2 bg-gradient-to-l from-[#040507] via-[#0B0D12] to-[#121620] border-l-2 border-zinc-300/85 shadow-[-12px_0_40px_rgba(56,189,248,0.22)] transition-transform duration-[800ms] ease-[cubic-bezier(0.77,0,0.175,1)] will-change-transform transform-gpu ${
          curtainOpen ? 'translate-x-full' : 'translate-x-0'
        }`}
      />

      {/* Fondo canvas de fuegos artificiales en pantalla completa (se apaga rápido al abrir cortina) */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 z-[2] w-full h-full pointer-events-none transform-gpu transition-opacity duration-300 ${
          curtainOpen ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* Escenario de emblema creciente + títulos */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
        <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-3xl">
          {/* Outer wrapper: expande y abre paso a la cortina en 7350ms sin saltos */}
          <div
            className={`transition-[transform,opacity] duration-[780ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform transform-gpu ${
              curtainOpen ? 'scale-[1.95] opacity-0' : 'scale-100 opacity-100'
            }`}
          >
            {/* Inner wrapper: crecimiento continuo del escudo desde pequeño hasta protagonizar toda la pantalla */}
            <div className="relative flex items-center justify-center lma-intro-shield-grow">
              <div
                className="absolute -inset-6 rounded-full bg-[radial-gradient(circle,rgba(250,204,21,0.28)_0%,rgba(56,189,248,0.18)_42%,transparent_72%)] pointer-events-none"
                aria-hidden="true"
              />
              <ResilientImage
                src={iconUrl}
                fallbackSrc={DEFAULT_SHIELD_FALLBACK}
                alt="Escudo oficial Liga Master Argentina PES6"
                fallbackLabel="LMA PES6"
                fetchPriority="high"
                className="relative w-52 h-52 sm:w-72 sm:h-72 object-contain drop-shadow-[0_14px_38px_rgba(0,0,0,0.92)]"
              />
            </div>
          </div>

          <div
            className={`transition-[opacity,transform] duration-500 ease-out will-change-transform transform-gpu ${
              curtainOpen ? 'opacity-0 translate-y-4 scale-105' : 'opacity-100 translate-y-0 scale-100'
            }`}
          >
            <h1 className="mt-5 font-display text-4xl sm:text-6xl font-extrabold tracking-tight [text-wrap:balance] uppercase text-lma-brand-static">
              {title}
            </h1>
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="h-[2px] w-8 bg-gradient-to-r from-transparent via-amber-400 to-amber-200 rounded-full" />
              <p className="font-display text-lg sm:text-xl font-extrabold tracking-[0.2em] uppercase text-lma-brand-static">
                {subtitle}
              </p>
              <span className="h-[2px] w-8 bg-gradient-to-l from-transparent via-amber-400 to-amber-200 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Controles interactivos abajo a la derecha */}
      <div
        className={`absolute bottom-6 right-6 z-20 flex items-center gap-3 transition-opacity duration-300 ${
          curtainOpen ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            if (autoplayBlocked) {
              soundEnabledRef.current = true;
              setSoundEnabled(true);
              void tryPlayFireworksAudio();
              return;
            }
            const next = !soundEnabled;
            setSoundEnabled(next);
            soundEnabledRef.current = next;
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-zinc-100 bg-[#0B0D12]/90 hover:bg-[#161A23] border border-zinc-400/50 rounded-lg transition-colors whitespace-nowrap"
        >
          {soundEnabled && !autoplayBlocked ? (
            <Volume2 className="w-4 h-4 text-amber-300" />
          ) : (
            <VolumeX className="w-4 h-4 text-amber-400" />
          )}
          <span>
            {autoplayBlocked
              ? 'Escuchar Fuegos Artificiales'
              : soundEnabled
              ? 'Sonido activo'
              : 'Activar sonido'}
          </span>
        </button>

        <button
          type="button"
          onClick={handleSkipIntro}
          className="px-4 py-2 text-xs font-semibold btn-gold-luxury rounded-lg transition-colors whitespace-nowrap"
        >
          Saltar intro
        </button>
      </div>
    </div>
  );
}
