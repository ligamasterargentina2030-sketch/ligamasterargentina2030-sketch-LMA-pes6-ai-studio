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

interface Rocket {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  targetY: number;
  colorIndex: number;
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

// Paleta elegante: Oro, Plata, Celeste, Blanco y Verde Liga
const LUXURY_FIREWORKS_PALETTE = [
  '#FACC15', // 0: Dorado
  '#FEF08A', // 1: Oro claro
  '#E2E8F0', // 2: Plateado brillante
  '#CBD5E1', // 3: Plata metálico
  '#38BDF8', // 4: Celeste Liga
  '#FFFFFF', // 5: Blanco
  '#34D399', // 6: Verde Liga
] as const;

const MAX_SPARKS = 170;

function createGlowSprite(color: string): HTMLCanvasElement {
  const size = 80;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const octx = off.getContext('2d');
  if (octx) {
    const half = size / 2;
    const grad = octx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255, 253, 240, 0.92)');
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    octx.fillStyle = grad;
    octx.fillRect(0, 0, size, size);
  }
  return off;
}

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
        }, 5000);
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

  // Intro fluido de 5s: apertura suave en 4350ms y fin en 5000ms
  useEffect(() => {
    const curtainTimer = window.setTimeout(() => {
      curtainOpenRef.current = true;
      stopFireworksAudio();
      onCurtainStartRef.current?.();
      setCurtainOpen(true);
    }, 4350);

    const endTimer = window.setTimeout(() => {
      stopFireworksAudio();
      onFinishRef.current();
    }, 5000);

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

    const resize = () => {
      // DPR=1 mantiene las partículas nítidas reduciendo >36% el costo de relleno por frame
      viewW = window.innerWidth;
      viewH = window.innerHeight;
      canvas.width = Math.max(1, viewW);
      canvas.height = Math.max(1, viewH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
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

    // Pre-cache offscreen glow sprites (zero per-frame gradient allocation)
    const glowSprites: HTMLCanvasElement[] = LUXURY_FIREWORKS_PALETTE.map(createGlowSprite);

    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];
    const blooms: FlashBloom[] = [];

    // Pre-allocated flat buckets per color (bright vs fading) -> zero GC and <=14 draw calls/frame
    const brightBuckets: Spark[][] = LUXURY_FIREWORKS_PALETTE.map(() => []);
    const dimBuckets: Spark[][] = LUXURY_FIREWORKS_PALETTE.map(() => []);

    const detonate = (cx: number, cy: number, forcedColorIdx?: number) => {
      const c1 =
        forcedColorIdx !== undefined
          ? forcedColorIdx
          : Math.floor(Math.random() * LUXURY_FIREWORKS_PALETTE.length);
      const c2 = Math.floor(Math.random() * LUXURY_FIREWORKS_PALETTE.length);
      const ringColors = [c1, c2, 0, 2, 5];

      blooms.push({
        x: cx,
        y: cy,
        radius: 50 + Math.random() * 22,
        alpha: 0.76,
        colorIndex: c1,
      });

      const available = MAX_SPARKS - sparks.length;
      if (available <= 0) return;

      const count = Math.min(30, available);
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.14;
        const speed = 2.5 + Math.random() * 5.6;
        sparks.push({
          x: cx,
          y: cy,
          prevX: cx,
          prevY: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          decay: 0.02 + Math.random() * 0.014,
          colorIndex: ringColors[i % ringColors.length],
          gravity: 0.056,
          drag: 0.963,
        });
      }

      const innerCount = Math.min(8, MAX_SPARKS - sparks.length);
      for (let j = 0; j < innerCount; j++) {
        const angle = (Math.PI * 2 * j) / 8;
        const speed = 1.4 + Math.random() * 2.0;
        sparks.push({
          x: cx,
          y: cy,
          prevX: cx,
          prevY: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          decay: 0.025 + Math.random() * 0.01,
          colorIndex: (j & 1) === 0 ? 1 : 2,
          gravity: 0.04,
          drag: 0.954,
        });
      }
    };

    const launchRocket = () => {
      const startX = viewW * (0.14 + Math.random() * 0.72);
      const targetX = startX + (Math.random() - 0.5) * 120;
      const targetY = viewH * (0.14 + Math.random() * 0.38);
      const travelFrames = 17 + Math.random() * 7;
      rockets.push({
        x: startX,
        y: viewH + 8,
        prevX: startX,
        prevY: viewH + 8,
        vx: (targetX - startX) / travelFrames,
        vy: (targetY - (viewH + 8)) / travelFrames,
        targetY,
        colorIndex: Math.floor(Math.random() * LUXURY_FIREWORKS_PALETTE.length),
      });
    };

    // Salva inicial escalonada y fluida
    detonate(viewW * 0.24, viewH * 0.26, 0);
    detonate(viewW * 0.76, viewH * 0.25, 2);
    launchRocket();

    const startMs = performance.now();
    let lastMs = startMs;
    let spawnAcc = 0;
    let burstAcc = 0;
    let rafId = 0;

    const tick = (now: number) => {
      // Al abrir la cortina detenemos el canvas para liberar 100% de GPU/CPU a la transición CSS
      if (curtainOpenRef.current) {
        return;
      }

      const elapsed = now - startMs;
      const dt = Math.min(2.0, Math.max(0.5, (now - lastMs) / 16.6667));
      lastMs = now;

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(5, 6, 8, 0.34)';
      ctx.fillRect(0, 0, viewW, viewH);

      if (!prefersReduced && elapsed < 3750) {
        spawnAcc += dt;
        burstAcc += dt;
        if (spawnAcc >= 18) {
          spawnAcc = 0;
          launchRocket();
        }
        if (burstAcc >= 26) {
          burstAcc = 0;
          detonate(viewW * (0.15 + Math.random() * 0.7), viewH * (0.16 + Math.random() * 0.48));
        }
      }

      ctx.globalCompositeOperation = 'lighter';

      // Blooms cacheados
      for (let i = blooms.length - 1; i >= 0; i--) {
        const b = blooms[i];
        const sprite = glowSprites[b.colorIndex] || glowSprites[0];
        ctx.globalAlpha = b.alpha > 0 ? b.alpha : 0;
        const d = b.radius * 2;
        ctx.drawImage(sprite, b.x - b.radius, b.y - b.radius, d, d);
        b.alpha -= 0.082 * dt;
        b.radius *= 1 + 0.038 * dt;
        if (b.alpha <= 0) {
          blooms[i] = blooms[blooms.length - 1];
          blooms.pop();
        }
      }

      // Cohetes ligeros
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
      ctx.lineWidth = 2.4;
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.prevX = r.x;
        r.prevY = r.y;
        r.x += r.vx * dt;
        r.y += r.vy * dt;

        ctx.strokeStyle = LUXURY_FIREWORKS_PALETTE[r.colorIndex];
        ctx.beginPath();
        ctx.moveTo(r.prevX - r.vx * 2, r.prevY - r.vy * 2);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();

        if (r.y <= r.targetY) {
          detonate(r.x, r.y, r.colorIndex);
          rockets[i] = rockets[rockets.length - 1];
          rockets.pop();
        }
      }

      // Actualizar chispas y agrupar por color + banda de opacidad (máx 14 draw calls por frame)
      for (let c = 0; c < LUXURY_FIREWORKS_PALETTE.length; c++) {
        brightBuckets[c].length = 0;
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

        if (s.alpha >= 0.5) {
          brightBuckets[s.colorIndex].push(s);
        } else {
          dimBuckets[s.colorIndex].push(s);
        }
      }

      ctx.lineWidth = 2.1;
      ctx.globalAlpha = 0.92;
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
      }

      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.42;
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

      if (elapsed < 4350 && !curtainOpenRef.current) {
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
    finishTimerRef.current = window.setTimeout(onFinish, 450);
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

      {/* Cortina negro ónix con bordes dorados y plateados (solo transform GPU) */}
      <div
        className={`absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[#040507] via-[#0B0D12] to-[#121620] border-r-2 border-amber-400/85 transition-transform duration-[550ms] ease-[cubic-bezier(0.77,0,0.175,1)] will-change-transform transform-gpu ${
          curtainOpen ? '-translate-x-full' : 'translate-x-0'
        }`}
      />
      <div
        className={`absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-[#040507] via-[#0B0D12] to-[#121620] border-l-2 border-zinc-300/75 transition-transform duration-[550ms] ease-[cubic-bezier(0.77,0,0.175,1)] will-change-transform transform-gpu ${
          curtainOpen ? 'translate-x-full' : 'translate-x-0'
        }`}
      />

      {/* Escenario de fuegos artificiales y emblema central */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center transition-[opacity,transform] duration-500 ease-out will-change-transform transform-gpu ${
          curtainOpen ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
        }`}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none transform-gpu"
        />

        <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-3xl">
          <div className="relative flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(0,0,0,0.78)_0%,rgba(250,204,21,0.16)_46%,transparent_72%)] pointer-events-none"
              aria-hidden="true"
            />
            <ResilientImage
              src={iconUrl}
              fallbackSrc="/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png"
              alt="Icono oficial Liga Master Argentina PES6"
              fallbackLabel="LMA PES6"
              fetchPriority="high"
              className="relative w-52 h-52 sm:w-64 sm:h-64 object-contain"
            />
          </div>

          <h1 className="mt-4 font-display text-4xl sm:text-6xl font-extrabold tracking-tight [text-wrap:balance] uppercase text-lma-brand-static">
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

        <div className="absolute bottom-6 right-6 z-20 flex items-center gap-3">
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
    </div>
  );
}
