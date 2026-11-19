import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Target, Trophy, Volume2, VolumeX } from 'lucide-react';

type GameState = 'TITLE_MENU' | 'PLAYING' | 'GAME_OVER';
type Difficulty = 'normal' | 'dificil';
type ShotOutcome = 'goal' | 'saved' | 'post' | 'miss';

interface ConfettiDot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
}

const LOGICAL_W = 640;
const LOGICAL_H = 380;
const GOAL_LEFT = 148;
const GOAL_RIGHT = 492;
const GOAL_TOP = 68;
const GOAL_BOTTOM = 194;
const SPOT_X = 320;
const SPOT_Y = 330;
const TOTAL_SHOTS = 5;
const BEST_SCORE_KEY = 'lma_penalty_best_score';

function playSynthSound(kind: 'kick' | 'goal' | 'save' | 'post' | 'miss', muted: boolean) {
  if (muted || typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.12);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);
    } else if (kind === 'goal') {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.06);
        gain.gain.setValueAtTime(0.14, now + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.06);
        osc.stop(now + i * 0.06 + 0.26);
      });
    } else if (kind === 'post') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.22);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (kind === 'save') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(210, now);
      osc.frequency.exponentialRampToValueAtTime(95, now + 0.18);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.16);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    }

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 600);
  } catch {
    // Ignore Web Audio errors when blocked by browser policy
  }
}

export function PenaltyMiniGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [muted, setMuted] = useState(false);
  const [goals, setGoals] = useState(0);
  const [shotHistory, setShotHistory] = useState<ShotOutcome[]>([]);
  const [bestScore, setBestScore] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(BEST_SCORE_KEY) || 0);
    } catch {
      return 0;
    }
  });
  const [bannerMsg, setBannerMsg] = useState<string>('Mové el mouse para apuntar y hacé clic para patear');

  const simRef = useRef({
    state: 'TITLE_MENU' as GameState,
    difficulty: 'normal' as Difficulty,
    muted: false,
    // Aim state
    aimX: SPOT_X,
    aimY: 132,
    aimVisible: false,
    charging: false,
    chargeStart: 0,
    power: 0.82,
    // Goalkeeper state
    gkX: SPOT_X,
    gkDir: 1,
    gkSpeed: 4.6,
    gkDiveOffset: 0,
    gkDiveTarget: 0,
    // Ball flight state
    ballActive: false,
    ballResolved: false,
    ballT: 0,
    ballDuration: 26,
    startX: SPOT_X,
    startY: SPOT_Y,
    targetX: SPOT_X,
    targetY: 132,
    ballX: SPOT_X,
    ballY: SPOT_Y,
    ballSpin: 0,
    reboundVx: 0,
    reboundVy: 0,
    reboundFrames: 0,
    // Effects
    netShake: 0,
    resetTimer: 0,
    bannerText: '',
    bannerSub: '',
    bannerColor: '#38BDF8',
    bannerTimer: 0,
    confetti: [] as ConfettiDot[],
    shotsTaken: 0,
    goalsScored: 0,
  });

  useEffect(() => {
    simRef.current.state = gameState;
  }, [gameState]);

  useEffect(() => {
    simRef.current.difficulty = difficulty;
    simRef.current.gkSpeed = difficulty === 'dificil' ? 6.8 : 4.6;
  }, [difficulty]);

  useEffect(() => {
    simRef.current.muted = muted;
  }, [muted]);

  const resetRound = useCallback((startImmediately = true) => {
    const s = simRef.current;
    s.ballActive = false;
    s.ballResolved = false;
    s.ballT = 0;
    s.ballX = SPOT_X;
    s.ballY = SPOT_Y;
    s.reboundFrames = 0;
    s.gkX = SPOT_X;
    s.gkDiveOffset = 0;
    s.gkDiveTarget = 0;
    s.netShake = 0;
    s.resetTimer = 0;
    s.bannerTimer = 0;
    s.confetti = [];
    s.shotsTaken = 0;
    s.goalsScored = 0;
    s.charging = false;
    s.power = 0.82;

    setGoals(0);
    setShotHistory([]);
    setBannerMsg('Mové el mouse para apuntar al arco y hacé clic para patear');
    setGameState(startImmediately ? 'PLAYING' : 'TITLE_MENU');
  }, []);

  const launchShot = useCallback((targetX: number, targetY: number, power: number) => {
    const s = simRef.current;
    if (s.state !== 'PLAYING' || s.ballActive || s.resetTimer > 0) return;

    s.ballActive = true;
    s.ballResolved = false;
    s.ballT = 0;
    // Faster shot with higher power (from 30 frames down to 20 frames)
    s.ballDuration = Math.round(30 - power * 10);
    s.startX = SPOT_X;
    s.startY = SPOT_Y;
    s.targetX = Math.max(40, Math.min(LOGICAL_W - 40, targetX));
    s.targetY = Math.max(18, Math.min(GOAL_BOTTOM + 24, targetY));
    s.ballX = SPOT_X;
    s.ballY = SPOT_Y;
    s.reboundFrames = 0;

    // Goalkeeper dives aggressively toward the shot side depending on difficulty
    const reactFactor = s.difficulty === 'dificil' ? 0.68 : 0.45;
    const maxDive = s.difficulty === 'dificil' ? 98 : 74;
    const dxFromGk = s.targetX - s.gkX;
    s.gkDiveTarget = Math.max(-maxDive, Math.min(maxDive, dxFromGk * reactFactor));

    playSynthSound('kick', s.muted);
  }, []);

  // Main 2D Canvas Game Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = LOGICAL_W;
    canvas.height = LOGICAL_H;

    let rafId = 0;
    let frame = 0;

    const resolveShot = () => {
      const s = simRef.current;
      s.ballResolved = true;

      const x = s.targetX;
      const y = s.targetY;
      const keeperCenter = s.gkX + s.gkDiveOffset;

      const inGoalX = x >= GOAL_LEFT + 7 && x <= GOAL_RIGHT - 7;
      const inGoalY = y >= GOAL_TOP + 7 && y <= GOAL_BOTTOM - 4;
      const hitLeftPost = Math.abs(x - GOAL_LEFT) <= 9 && y >= GOAL_TOP - 6 && y <= GOAL_BOTTOM + 4;
      const hitRightPost = Math.abs(x - GOAL_RIGHT) <= 9 && y >= GOAL_TOP - 6 && y <= GOAL_BOTTOM + 4;
      const hitCrossbar = Math.abs(y - GOAL_TOP) <= 8 && x >= GOAL_LEFT - 6 && x <= GOAL_RIGHT + 6;

      // Keeper hitbox (torso + outstretched gloves)
      const keeperReachX = s.difficulty === 'dificil' ? 42 : 36;
      const keeperTopY = s.difficulty === 'dificil' ? GOAL_BOTTOM - 98 : GOAL_BOTTOM - 90;
      const keeperSaved =
        inGoalX &&
        inGoalY &&
        Math.abs(x - keeperCenter) <= keeperReachX &&
        y >= keeperTopY;

      let outcome: ShotOutcome;
      if (hitLeftPost || hitRightPost || hitCrossbar) {
        outcome = 'post';
        s.reboundFrames = 26;
        s.reboundVx = hitLeftPost ? -3.4 : hitRightPost ? 3.4 : (Math.random() - 0.5) * 3;
        s.reboundVy = hitCrossbar ? -2.8 : 2.2;
        s.bannerText = '¡EN EL PALO!';
        s.bannerSub = 'Casi entra, pegó en el poste';
        s.bannerColor = '#FBBF24';
        playSynthSound('post', s.muted);
      } else if (keeperSaved) {
        outcome = 'saved';
        s.reboundFrames = 24;
        s.reboundVx = x < keeperCenter ? -3.2 : 3.2;
        s.reboundVy = 2.6;
        s.bannerText = '¡ATAJÓ EL ARQUERO!';
        s.bannerSub = 'Buscá más esquinado el próximo tiro';
        s.bannerColor = '#FB7185';
        playSynthSound('save', s.muted);
      } else if (inGoalX && inGoalY) {
        outcome = 'goal';
        s.netShake = 18;
        s.goalsScored += 1;
        s.bannerText = '¡GOOOOOL!';
        s.bannerSub = 'Adentro, imposible para el arquero';
        s.bannerColor = '#34D399';
        playSynthSound('goal', s.muted);

        const colors = ['#38BDF8', '#FFFFFF', '#FBBF24', '#34D399'];
        for (let i = 0; i < 32; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 1.6 + Math.random() * 4.2;
          s.confetti.push({
            x,
            y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 1.5,
            color: colors[i % colors.length],
            life: 0,
            maxLife: 45 + Math.random() * 20,
          });
        }
      } else {
        outcome = 'miss';
        s.bannerText = '¡AFUERA!';
        s.bannerSub = 'Se fue desviada del arco';
        s.bannerColor = '#94A3B8';
        playSynthSound('miss', s.muted);
      }

      s.shotsTaken += 1;
      s.bannerTimer = 64;
      s.resetTimer = 58;

      const nextShotsCount = s.shotsTaken;
      const nextGoals = s.goalsScored;

      setGoals(nextGoals);
      setShotHistory((prev) => [...prev, outcome]);
      setBannerMsg(`${s.bannerText} — ${s.bannerSub}`);

      if (nextShotsCount >= TOTAL_SHOTS) {
        setBestScore((prevBest) => {
          const updated = Math.max(prevBest, nextGoals);
          try {
            localStorage.setItem(BEST_SCORE_KEY, String(updated));
          } catch {
            // ignore storage errors
          }
          return updated;
        });
      }
    };

    const drawPitch = () => {
      // Night sky / stadium backdrop
      const skyGrad = ctx.createLinearGradient(0, 0, 0, GOAL_BOTTOM);
      skyGrad.addColorStop(0, '#040B16');
      skyGrad.addColorStop(1, '#0B1B33');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, LOGICAL_W, GOAL_BOTTOM);

      // Subtle stadium floodlight cones
      const leftGlow = ctx.createRadialGradient(90, 20, 4, 90, 20, 170);
      leftGlow.addColorStop(0, 'rgba(125, 211, 252, 0.22)');
      leftGlow.addColorStop(1, 'rgba(125, 211, 252, 0)');
      ctx.fillStyle = leftGlow;
      ctx.fillRect(0, 0, 280, GOAL_BOTTOM);

      const rightGlow = ctx.createRadialGradient(LOGICAL_W - 90, 20, 4, LOGICAL_W - 90, 20, 170);
      rightGlow.addColorStop(0, 'rgba(251, 191, 36, 0.16)');
      rightGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = rightGlow;
      ctx.fillRect(LOGICAL_W - 280, 0, 280, GOAL_BOTTOM);

      // Crowd tier dots
      ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
      for (let cy = 36; cy < GOAL_BOTTOM - 16; cy += 12) {
        for (let cx = 18; cx < LOGICAL_W - 18; cx += 16) {
          ctx.fillRect(cx + ((cy * 7) % 5), cy, 3, 4);
        }
      }

      // Grass field stripes
      const grassGrad = ctx.createLinearGradient(0, GOAL_BOTTOM, 0, LOGICAL_H);
      grassGrad.addColorStop(0, '#0D4A2E');
      grassGrad.addColorStop(0.5, '#115E3A');
      grassGrad.addColorStop(1, '#0C462A');
      ctx.fillStyle = grassGrad;
      ctx.fillRect(0, GOAL_BOTTOM, LOGICAL_W, LOGICAL_H - GOAL_BOTTOM);

      // Alternating mowed turf perspective bands
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.fillRect(0, GOAL_BOTTOM + 24, LOGICAL_W, 28);
      ctx.fillRect(0, GOAL_BOTTOM + 84, LOGICAL_W, 38);
      ctx.fillRect(0, GOAL_BOTTOM + 152, LOGICAL_W, 36);

      // Penalty box white chalk lines
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, GOAL_BOTTOM);
      ctx.lineTo(LOGICAL_W, GOAL_BOTTOM);
      ctx.stroke();

      // 18-yard / 6-yard perspective lines
      ctx.beginPath();
      ctx.moveTo(92, GOAL_BOTTOM);
      ctx.lineTo(36, LOGICAL_H);
      ctx.moveTo(LOGICAL_W - 92, GOAL_BOTTOM);
      ctx.lineTo(LOGICAL_W - 36, LOGICAL_H);
      ctx.stroke();

      // Penalty spot
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.ellipse(SPOT_X, SPOT_Y + 6, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawGoal = (netShake: number) => {
      const shakeOffset = netShake > 0 ? Math.sin(frame * 1.4) * (netShake * 0.35) : 0;

      // Net background shadow
      ctx.fillStyle = 'rgba(2, 6, 23, 0.38)';
      ctx.fillRect(GOAL_LEFT, GOAL_TOP, GOAL_RIGHT - GOAL_LEFT, GOAL_BOTTOM - GOAL_TOP);

      // Net mesh lines
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.24)';
      ctx.lineWidth = 1;
      for (let gx = GOAL_LEFT + 14; gx < GOAL_RIGHT; gx += 16) {
        ctx.beginPath();
        ctx.moveTo(gx, GOAL_TOP);
        ctx.lineTo(gx + shakeOffset * 0.6, GOAL_BOTTOM);
        ctx.stroke();
      }
      for (let gy = GOAL_TOP + 14; gy < GOAL_BOTTOM; gy += 14) {
        ctx.beginPath();
        ctx.moveTo(GOAL_LEFT, gy);
        ctx.quadraticCurveTo(SPOT_X, gy + shakeOffset, GOAL_RIGHT, gy);
        ctx.stroke();
      }

      // Goalposts & Crossbar
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(GOAL_LEFT, GOAL_BOTTOM);
      ctx.lineTo(GOAL_LEFT, GOAL_TOP);
      ctx.lineTo(GOAL_RIGHT, GOAL_TOP);
      ctx.lineTo(GOAL_RIGHT, GOAL_BOTTOM);
      ctx.stroke();
    };

    const drawGoalkeeper = (cx: number, diveOffset: number, tFrame: number) => {
      const x = cx + diveOffset;
      const groundY = GOAL_BOTTOM;
      const bounce = Math.abs(Math.sin(tFrame * 0.14)) * 3;
      const lean = Math.max(-0.35, Math.min(0.35, diveOffset * 0.008));

      // Ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      ctx.beginPath();
      ctx.ellipse(x, groundY + 3, 20, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, groundY - bounce);
      ctx.rotate(lean);

      // Legs
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 6.5;
      ctx.lineCap = 'round';
      const legStride = Math.sin(tFrame * 0.18) * 5;
      ctx.beginPath();
      ctx.moveTo(-6, -24);
      ctx.lineTo(-9 + legStride, -2);
      ctx.moveTo(6, -24);
      ctx.lineTo(9 - legStride, -2);
      ctx.stroke();

      // Torso (bright amber/orange keeper jersey)
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.roundRect(-13, -54, 26, 30, 6);
      ctx.fill();
      ctx.strokeStyle = '#78350F';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Keeper number
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('1', 0, -35);

      // Outstretched arms + neon gloves
      const armReach = 26 + Math.abs(diveOffset) * 0.15;
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(-12, -48);
      ctx.lineTo(-armReach, -56);
      ctx.moveTo(12, -48);
      ctx.lineTo(armReach, -56);
      ctx.stroke();

      // Gloves
      ctx.fillStyle = '#38BDF8';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-armReach, -56, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(armReach, -56, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Head
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.arc(0, -64, 9.5, 0, Math.PI * 2);
      ctx.fill();

      // Hair / Headband
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.arc(0, -67, 9.5, Math.PI, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const drawBall = (x: number, y: number, scale: number, spin: number, liftShadowOffset: number) => {
      const r = 13 * scale;

      // Ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
      ctx.beginPath();
      ctx.ellipse(x, y + liftShadowOffset + r * 0.75, r * 0.95, r * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();

      // Soccer ball body
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spin);

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Classic pentagon patches
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const px = Math.cos(a) * r * 0.42;
        const py = Math.sin(a) * r * 0.42;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const render = () => {
      rafId = window.requestAnimationFrame(render);
      frame++;

      const s = simRef.current;

      // Move goalkeeper fast & agilely back & forth along the goal line
      if (s.state === 'PLAYING') {
        const minGkX = GOAL_LEFT + 34;
        const maxGkX = GOAL_RIGHT - 34;
        if (!s.ballActive) {
          // Agile speed bursts + occasional feint near center in Difícil mode
          const speedMod =
            s.difficulty === 'dificil'
              ? 1.08 + Math.sin(frame * 0.11) * 0.36
              : 1.0 + Math.sin(frame * 0.08) * 0.25;
          if (
            s.difficulty === 'dificil' &&
            Math.abs(s.gkX - SPOT_X) < 35 &&
            frame % 53 === 0 &&
            Math.random() > 0.45
          ) {
            s.gkDir *= -1;
          }
          s.gkX += s.gkDir * s.gkSpeed * speedMod;
          if (s.gkX >= maxGkX) {
            s.gkX = maxGkX;
            s.gkDir = -1;
          } else if (s.gkX <= minGkX) {
            s.gkX = minGkX;
            s.gkDir = 1;
          }
          s.gkDiveOffset *= 0.85;
        } else {
          // Fast athletic dive toward shot target
          const diveLerp = s.difficulty === 'dificil' ? 0.36 : 0.3;
          s.gkDiveOffset += (s.gkDiveTarget - s.gkDiveOffset) * diveLerp;
        }

        // Update ball flight
        if (s.ballActive) {
          if (!s.ballResolved) {
            s.ballT += 1;
            const p = Math.min(1, s.ballT / s.ballDuration);
            // Smooth easing
            const ease = 1 - Math.pow(1 - p, 2);
            s.ballX = s.startX + (s.targetX - s.startX) * ease;
            // Arc slight curve
            const arcLift = Math.sin(p * Math.PI) * 26;
            s.ballY = s.startY + (s.targetY - s.startY) * ease - arcLift;
            s.ballSpin += 0.38;

            if (p >= 1) {
              resolveShot();
            }
          } else if (s.reboundFrames > 0) {
            s.reboundFrames -= 1;
            s.ballX += s.reboundVx;
            s.ballY += s.reboundVy;
            s.reboundVy += 0.25;
            s.ballSpin += 0.24;
          }
        }

        // Reset to next kick after banner display
        if (s.resetTimer > 0) {
          s.resetTimer -= 1;
          if (s.resetTimer === 0) {
            s.ballActive = false;
            s.ballResolved = false;
            s.ballX = SPOT_X;
            s.ballY = SPOT_Y;
            s.gkDiveOffset = 0;
            if (s.shotsTaken >= TOTAL_SHOTS) {
              setGameState('GAME_OVER');
            } else {
              setBannerMsg(`Tiro ${s.shotsTaken + 1} de ${TOTAL_SHOTS}: apuntá con el mouse y pateá`);
            }
          }
        }
      }

      if (s.netShake > 0) s.netShake *= 0.88;
      if (s.bannerTimer > 0) s.bannerTimer -= 1;

      // Update confetti
      for (let i = s.confetti.length - 1; i >= 0; i--) {
        const c = s.confetti[i];
        c.life += 1;
        if (c.life >= c.maxLife) {
          s.confetti.splice(i, 1);
          continue;
        }
        c.x += c.vx;
        c.y += c.vy;
        c.vy += 0.14;
      }

      // Draw Scene
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
      drawPitch();
      drawGoal(s.netShake);

      // Draw aim line & crosshair while aiming
      if (s.state === 'PLAYING' && !s.ballActive && s.aimVisible) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(SPOT_X, SPOT_Y);
        ctx.lineTo(s.aimX, s.aimY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Crosshair ring
        const pulseR = 13 + Math.sin(frame * 0.15) * 1.5;
        ctx.strokeStyle = s.charging ? '#FBBF24' : '#38BDF8';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(s.aimX, s.aimY, pulseR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = s.charging ? '#FBBF24' : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(s.aimX, s.aimY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Perspective order: if ball is already past goal line inside net, draw ball behind keeper; otherwise keeper then ball
      const pFlight = s.ballActive ? Math.min(1, s.ballT / s.ballDuration) : 0;
      const ballScale = 1 - pFlight * 0.42;
      const liftShadow = s.ballActive ? Math.max(0, GOAL_BOTTOM - s.ballY) * 0.25 : 4;

      if (s.ballResolved && s.reboundFrames === 0 && s.targetY < GOAL_BOTTOM) {
        drawBall(s.ballX, s.ballY, ballScale, s.ballSpin, liftShadow);
        drawGoalkeeper(s.gkX, s.gkDiveOffset, frame);
      } else {
        drawGoalkeeper(s.gkX, s.gkDiveOffset, frame);
        drawBall(s.ballX, s.ballY, ballScale, s.ballSpin, liftShadow);
      }

      // Draw goal confetti
      for (const c of s.confetti) {
        const alpha = 1 - c.life / c.maxLife;
        ctx.fillStyle = c.color;
        ctx.globalAlpha = alpha;
        ctx.fillRect(c.x, c.y, 4, 4);
      }
      ctx.globalAlpha = 1;

      // Floating outcome banner inside canvas
      if (s.bannerTimer > 0) {
        const alpha = Math.min(1, s.bannerTimer / 14);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(4, 10, 20, 0.84)';
        ctx.strokeStyle = s.bannerColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(LOGICAL_W / 2 - 145, 22, 290, 44, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = s.bannerColor;
        ctx.font = '800 20px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.bannerText, LOGICAL_W / 2, 46);

        ctx.fillStyle = '#E2E8F0';
        ctx.font = '500 11px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(s.bannerSub, LOGICAL_W / 2, 60);
        ctx.restore();
      }
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const toLogicalCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: SPOT_X, y: 130 };
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * LOGICAL_W;
    const y = ((clientY - rect.top) / rect.height) * LOGICAL_H;
    return { x, y };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toLogicalCoords(e.clientX, e.clientY);
    simRef.current.aimX = x;
    simRef.current.aimY = y;
    simRef.current.aimVisible = true;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toLogicalCoords(e.clientX, e.clientY);
    simRef.current.aimX = x;
    simRef.current.aimY = y;
    simRef.current.aimVisible = true;

    if (simRef.current.state === 'TITLE_MENU') {
      resetRound(true);
      return;
    }

    if (simRef.current.state === 'PLAYING' && !simRef.current.ballActive && simRef.current.resetTimer === 0) {
      simRef.current.charging = true;
      simRef.current.chargeStart = performance.now();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = simRef.current;
    if (!s.charging) return;
    s.charging = false;

    const heldMs = Math.min(700, performance.now() - s.chargeStart);
    const power = Math.min(1, 0.72 + (heldMs / 700) * 0.28);
    const { x, y } = toLogicalCoords(e.clientX, e.clientY);
    launchShot(x, y, power);
  };

  return (
    <section className="bg-[#071D38]/95 border-2 border-amber-400/60 rounded-2xl overflow-hidden shadow-xl shadow-black/50">
      {/* Header & Scoreboard HUD */}
      <div className="px-6 py-4 border-b border-amber-400/35 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A]">
        <div className="flex items-center gap-2.5">
          <Target className="w-4 h-4 text-amber-300 shrink-0" />
          <div>
            <h2 className="font-display text-2xl font-bold text-albiceleste-shiny leading-tight">
              Mini Penales PES6
            </h2>
            <p className="text-xs text-sky-200/80">
              Apuntá con el mouse y meté gol al arquero en movimiento
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented difficulty buttons */}
          <div className="flex items-center gap-1 p-1 bg-[#041224] border border-amber-400/40 rounded-lg">
            <button
              type="button"
              onClick={() => setDifficulty('normal')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                difficulty === 'normal'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/35'
                  : 'text-sky-200/80 hover:text-white'
              }`}
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => setDifficulty('dificil')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                difficulty === 'dificil'
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/35'
                  : 'text-sky-200/80 hover:text-white'
              }`}
            >
              Difícil
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Activar sonido' : 'Silenciar sonido'}
            className="p-2 text-amber-200 hover:text-white bg-[#041224] border border-amber-400/45 rounded-lg transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => resetRound(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-200 bg-[#041224] hover:bg-[#0A294E] border border-amber-400/45 rounded-lg transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reiniciar</span>
          </button>
        </div>
      </div>

      {/* Live Numeric HUD Strip */}
      <div className="px-6 py-3 bg-[#05162B] border-b border-amber-400/25 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-4 text-sky-100">
          <span>
            Goles:{' '}
            <strong className="font-mono text-sm font-bold text-emerald-400 tabular-nums">
              {goals} / {TOTAL_SHOTS}
            </strong>
          </span>
          <span className="text-sky-400/40" aria-hidden="true">·</span>
          <span>
            Récord:{' '}
            <strong className="font-mono text-sm font-bold text-amber-300 tabular-nums">
              {bestScore}
            </strong>
          </span>
        </div>

        {/* 5 Shot Attempt Slots */}
        <div className="flex items-center gap-2" aria-label="Registro de 5 penales">
          <span className="text-sky-200/80 mr-1">Tanda:</span>
          {Array.from({ length: TOTAL_SHOTS }, (_, idx) => {
            const res = shotHistory[idx];
            if (!res) {
              return (
                <span
                  key={idx}
                  className="w-6 h-6 rounded-md border border-amber-400/35 bg-[#041224] text-[11px] font-mono text-sky-200/70 flex items-center justify-center"
                >
                  {idx + 1}
                </span>
              );
            }
            if (res === 'goal') {
              return (
                <span
                  key={idx}
                  title="Gol"
                  className="w-6 h-6 rounded-md border border-emerald-400/50 bg-emerald-500/25 text-[11px] font-bold text-emerald-200 flex items-center justify-center"
                >
                  G
                </span>
              );
            }
            return (
              <span
                key={idx}
                title={res === 'saved' ? 'Atajada' : res === 'post' ? 'Palo' : 'Afuera'}
                className="w-6 h-6 rounded-md border border-rose-400/40 bg-rose-500/20 text-[11px] font-bold text-rose-200 flex items-center justify-center"
              >
                X
              </span>
            );
          })}
        </div>
      </div>

      {/* Interactive 2D Penalty Canvas */}
      <div className="relative w-full aspect-[16/9] bg-[#041224] select-none">
        <canvas
          ref={canvasRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            simRef.current.aimVisible = false;
            simRef.current.charging = false;
          }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          className="w-full h-full block cursor-crosshair touch-none"
        />

        {gameState === 'TITLE_MENU' && (
          <div className="absolute inset-0 bg-[#041224]/82 flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border-2 border-amber-400/60 text-amber-300 flex items-center justify-center">
              <Target className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="font-display text-3xl font-extrabold text-albiceleste-shiny">
                Tanda de 5 Penales
              </h3>
              <p className="text-xs sm:text-sm text-sky-100/90">
                Mové el mouse hacia el ángulo del arco y hacé clic para patear antes de que llegue el arquero.
              </p>
            </div>
            <button
              type="button"
              onClick={() => resetRound(true)}
              className="px-6 py-2.5 text-sm btn-gold-luxury rounded-xl whitespace-nowrap"
            >
              Patear Penales
            </button>
          </div>
        )}

        {gameState === 'GAME_OVER' && (
          <div className="absolute inset-0 bg-[#041224]/85 flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border-2 border-amber-400/60 text-amber-300 flex items-center justify-center">
              <Trophy className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-amber-300">
                Fin de la Tanda · Mejor Récord: {bestScore}/{TOTAL_SHOTS}
              </div>
              <h3 className="font-display text-3xl font-extrabold text-albiceleste-shiny">
                {goals >= 4
                  ? `¡Campeón! Metiste ${goals} de ${TOTAL_SHOTS}`
                  : goals >= 2
                  ? `Buena tanda: ${goals} de ${TOTAL_SHOTS} goles`
                  : `Metiste ${goals} de ${TOTAL_SHOTS} goles`}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => resetRound(true)}
              className="px-6 py-2.5 text-sm btn-gold-luxury rounded-xl whitespace-nowrap"
            >
              Jugar de Nuevo
            </button>
          </div>
        )}
      </div>

      {/* Bottom instruction strip */}
      <div className="px-6 py-2.5 bg-[#05162B] border-t border-amber-400/25 text-xs text-sky-100/90 flex items-center justify-between gap-3">
        <span className="truncate">{bannerMsg}</span>
        <span className="text-sky-200/75 whitespace-nowrap hidden sm:inline">
          Clic para patear
        </span>
      </div>
    </section>
  );
}
