import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import multer from 'multer';
import dotenv from 'dotenv';
import ImageKit from 'imagekit';
import { GoogleGenAI, Type } from '@google/genai';
import {
  getSupabasePublicObjectUrl,
  getSupabaseServerUrl,
  getSupabaseServiceRoleKey,
  inferMimeTypeFromPath,
  isSupabaseDbConfigured,
  readLeagueDbFromSupabase,
  uploadBufferToSupabaseStorage,
  uploadFileToSupabaseStorage,
  writeLeagueDbToSupabase,
} from './src/server/supabaseBackend';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const execFileAsync = promisify(execFile);

const IS_VERCEL =
  process.env.VERCEL === '1' ||
  Boolean(process.env.VERCEL_ENV || process.env.NOW_REGION);
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'league.json');
const SECRET_PATH = path.join(DATA_DIR, 'secret.key');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const TEMP_UPLOADS_DIR = IS_VERCEL ? path.join(os.tmpdir(), 'lma-pes6-uploads') : UPLOADS_DIR;

const IMAGEKIT_PUBLIC_KEY =
  (process.env.IMAGEKIT_PUBLIC_KEY || 'public_XfHA7f8b6xGibDVHxIoMovZHMik=').trim();
const IMAGEKIT_URL_ENDPOINT =
  (process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/kmhwquny0')
    .trim()
    .replace(/\/+$/, '');
const IMAGEKIT_PRIVATE_KEY = (process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
const IMAGEKIT_VIDEO_FOLDER = '/liga-master-videos';

const imagekitClient = IMAGEKIT_PRIVATE_KEY
  ? new ImageKit({
      publicKey: IMAGEKIT_PUBLIC_KEY,
      privateKey: IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: IMAGEKIT_URL_ENDPOINT,
    })
  : null;

function buildImageKitMp4Url(filePath?: string, rawUrl?: string): string {
  if (filePath && filePath.trim()) {
    const cleanPath = filePath
      .trim()
      .replace(/^\/+/, '')
      .replace(/^tr:[^/]+\/+/, '');
    return `${IMAGEKIT_URL_ENDPOINT}/tr:f-mp4/${cleanPath}`;
  }
  if (rawUrl && rawUrl.startsWith(IMAGEKIT_URL_ENDPOINT)) {
    const rest = rawUrl
      .slice(IMAGEKIT_URL_ENDPOINT.length)
      .replace(/^\/+/, '')
      .replace(/^tr:[^/]+\/+/, '');
    return `${IMAGEKIT_URL_ENDPOINT}/tr:f-mp4/${rest}`;
  }
  return rawUrl || '';
}

const UPLOAD_SUBDIRS = ['crests', 'matches', 'videos', 'champions', 'music', 'site', 'claims', 'news'] as const;
const dirsToEnsure = [
  ...(!IS_VERCEL ? [DATA_DIR, UPLOADS_DIR] : []),
  TEMP_UPLOADS_DIR,
  ...UPLOAD_SUBDIRS.map((d) => path.join(TEMP_UPLOADS_DIR, d)),
  path.join(TEMP_UPLOADS_DIR, 'music', 'covers'),
];
for (const dir of dirsToEnsure) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore on read-only serverless filesystems; TEMP_UPLOADS_DIR in /tmp remains writable
  }
}

function safeUnlink(filePath?: string | null): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup failure
  }
}

async function persistUploadedFile(
  localFilePath: string,
  subdir: (typeof UPLOAD_SUBDIRS)[number],
  finalFilename: string,
  mimeType?: string
): Promise<string> {
  if (isSupabaseDbConfigured()) {
    try {
      return await uploadFileToSupabaseStorage(localFilePath, subdir, finalFilename, mimeType);
    } finally {
      safeUnlink(localFilePath);
    }
  }
  return `/uploads/${subdir}/${finalFilename}`;
}

interface FeaturedVideoSelection {
  id: string;
  source: 'community' | 'local';
  title: string;
  author: string;
  videoUrl: string;
  downloadUrl?: string;
  originalFormat?: 'MP4' | 'AVI';
  fechaLabel?: string;
}

interface LeagueSettings {
  title: string;
  subtitle: string;
  description?: string;
  calendarMessage?: string;
  bannerText: string;
  crestUrl: string;
  coverUrl: string;
  backgroundUrl?: string;
  faviconUrl?: string;
  adminId: string;
  adminClave?: string;
  adminClaveHash?: string;
  adminTokenVersion?: number;
  adminTeamId?: string;
  backupGmail?: string;
  featuredVideo?: FeaturedVideoSelection | null;
  radioName?: string;
  radioStreamUrl?: string;
  maxTeams: number;
}

type ModerationStatus = 'pending' | 'approved' | 'rejected';

interface TeamTrophy {
  id: string;
  type: 'liga' | 'copa' | 'recopa';
  title: string;
  season: string;
  imageUrl: string;
  message?: string;
  awardedAt: string;
  sourceKey?: string;
}

interface LastListenedTrack {
  title: string;
  artist: string;
  coverUrl?: string;
  audioUrl?: string;
  listenedAt: string;
}

interface Team {
  id: string;
  clave?: string;
  claveHash?: string;
  accountStatus?: 'active' | 'blocked';
  tokenVersion?: number;
  credentialsUpdatedAt?: string;
  name: string;
  memberName: string;
  crestUrl: string;
  bio?: string;
  likes?: number;
  trophies?: TeamTrophy[];
  personalMusic?: MusicTrack[];
  lastListenedTrack?: LastListenedTrack;
  celebrationImageUrl?: string;
  celebrationStatus?: ModerationStatus;
  celebrationUploadedAt?: string;
  primaryColor?: string;
  secondaryColor?: string;
  createdAt: string;
}

interface Match {
  id: string;
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  leg: 'Ida' | 'Vuelta';
  competitionType?: 'liga' | 'copa' | 'recopa';
  cupMatchId?: string;
  homePenalties?: number | null;
  awayPenalties?: number | null;
  extraTime?: boolean;
  playedAt: string;
  notes?: string;
  proofImageUrl?: string;
  proofImageStatus?: ModerationStatus;
  scorerImageUrl?: string;
  scorerName?: string;
  scorerImageStatus?: ModerationStatus;
  fixtureId?: string;
  submittedByTeamId: string;
  submittedByName: string;
  status: 'pending' | 'validated' | 'rejected';
  validatedAt?: string;
  createdAt: string;
}

interface ScheduledFixture {
  id: string;
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  leg: 'Ida' | 'Vuelta';
  scheduledDate?: string;
  scheduledTime?: string;
  notes?: string;
  completedMatchId?: string;
  createdAt: string;
}

type CalendarCategory = 'copa' | 'liga' | 'recopa' | 'evento';

interface CalendarEvent {
  id: string;
  title: string;
  category: CalendarCategory;
  date: string;
  time: string;
  roundLabel?: string;
  cupMatchId?: string;
  fixtureId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeCrestUrl?: string;
  awayCrestUrl?: string;
  notes?: string;
  createdAt: string;
}

interface Claim {
  id: string;
  matchId?: string;
  reporterTeamId: string;
  reporterName: string;
  accusedTeamId?: string;
  accusedTeamName?: string;
  reasonType: 'juego_sucio' | 'gol_prohibido' | 'otro';
  description: string;
  cardPhotoUrl?: string;
  cardPhotoStatus?: ModerationStatus;
  videoUrl?: string;
  status: 'pending' | 'valid_match' | 'invalid_match' | 'dismissed';
  adminResolutionNote?: string;
  resolvedAt?: string;
  createdAt: string;
}

interface GalleryVideo {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  downloadUrl: string;
  imagekitFileId?: string;
  originalFormat: 'MP4' | 'AVI';
  uploadedBy: string;
  featured?: boolean;
  createdAt: string;
}

interface ChampionEntry {
  id: string;
  season: string;
  teamName: string;
  memberName: string;
  teamId?: string;
  tournamentType?: 'liga' | 'copa' | 'recopa';
  notes?: string;
  celebrationImageUrl: string;
  createdAt: string;
}

interface CupRulesSettings {
  format: string;
  extraTime: string;
  penalties: string;
  notes: string;
}

interface RulesConfig {
  prohibitedRules: string[];
  generalNotes: string;
  gameMode: {
    partidos: string;
    tiempo: string;
    condicion: string;
    lesiones: string;
    cambios: string;
    pausas: string;
    clima: string;
  };
  cupRules?: CupRulesSettings;
}

interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl?: string;
  createdAt: string;
}

interface CupParticipant {
  slot: number;
  teamId?: string;
  teamName: string;
  memberName: string;
  crestUrl: string;
}

type CupRound = 'r16' | 'qf' | 'sf' | 'final';

interface CupMatchNode {
  id: string;
  round: CupRound;
  matchIndex: number;
  homeSlot: number | null;
  awaySlot: number | null;
  homeTeamName?: string;
  awayTeamName?: string;
  homeMemberName?: string;
  awayMemberName?: string;
  homeCrestUrl?: string;
  awayCrestUrl?: string;
  homeGoals: number | null;
  awayGoals: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  extraTime: boolean;
  winnerSlot: number | null;
  winnerName?: string;
  winnerMemberName?: string;
  winnerCrestUrl?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  played: boolean;
}

interface RecopaState {
  enabled: boolean;
  leagueChampionName: string;
  leagueChampionMember: string;
  leagueChampionCrestUrl: string;
  cupChampionName: string;
  cupChampionMember: string;
  cupChampionCrestUrl: string;
  leagueGoals: number | null;
  cupGoals: number | null;
  leaguePenalties: number | null;
  cupPenalties: number | null;
  extraTime: boolean;
  grandChampionName: string;
  grandChampionMember: string;
  grandChampionCrestUrl: string;
  grandChampionSide: 'league' | 'cup' | null;
  greeting?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  played: boolean;
}

interface CupTournament {
  editionNumber: number;
  editionName: string;
  status: 'in_progress' | 'finished';
  participants: CupParticipant[];
  matches: CupMatchNode[];
  championSlot: number | null;
  championTeamName: string;
  championMemberName: string;
  championCrestUrl: string;
  championGreeting: string;
  recopa: RecopaState;
  updatedAt: string;
}

interface AdminResetToken {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  used?: boolean;
}

interface NewsPost {
  id: string;
  title: string;
  content: string;
  textColor: string;
  imageUrl?: string;
  videoUrl?: string;
  likes?: number;
  isChampionNewspaper?: boolean;
  championTeamName?: string;
  championMemberName?: string;
  championCrestUrl?: string;
  championTournament?: string;
  championSeason?: string;
  celebrationImageUrl?: string;
  sourceKey?: string;
  createdAt: string;
}

interface TopGoalItem {
  id: string;
  rank: number;
  title: string;
  scorerName?: string;
  author?: string;
  videoUrl: string;
  sourceVideoId?: string;
  createdAt: string;
}

interface LeagueComment {
  id: string;
  authorName: string;
  authorTeamName?: string;
  authorTeamId?: string;
  message: string;
  status: 'pending' | 'approved';
  createdAt: string;
}

type CredentialAuditAction =
  | 'create_participant'
  | 'update_participant_id'
  | 'reset_participant_password'
  | 'block_participant'
  | 'activate_participant'
  | 'delete_participant'
  | 'update_admin_credentials'
  | 'admin_firebase_password_reset';

interface CredentialAuditEntry {
  id: string;
  action: CredentialAuditAction;
  targetType: 'participant' | 'admin';
  targetId: string;
  targetLabel: string;
  details: string;
  performedBy: string;
  createdAt: string;
}

interface LeagueDatabase {
  settings: LeagueSettings;
  teams: Team[];
  matches: Match[];
  fixtures: ScheduledFixture[];
  calendarEvents?: CalendarEvent[];
  claims: Claim[];
  videos: GalleryVideo[];
  topGoals?: TopGoalItem[];
  champions: ChampionEntry[];
  rules: RulesConfig;
  music: MusicTrack[];
  cup: CupTournament;
  news?: NewsPost[];
  comments?: LeagueComment[];
  pageLikes?: number;
  adminResetTokens?: AdminResetToken[];
  credentialAuditLog?: CredentialAuditEntry[];
}

interface TokenPayload {
  role: 'admin' | 'member';
  id: string;
  displayName: string;
  teamId?: string;
  tokenVersion?: number;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  authUser?: TokenPayload | null;
}

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plain: string, storedHash?: string): boolean {
  if (!plain || !storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const expectedBuf = Buffer.from(hashHex, 'hex');
    const derivedBuf = crypto.scryptSync(plain, salt, expectedBuf.length, {
      N: 16384,
      r: 8,
      p: 1,
    });
    if (expectedBuf.length !== derivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, derivedBuf);
  } catch {
    return false;
  }
}

function appendCredentialAudit(
  db: LeagueDatabase,
  entry: Omit<CredentialAuditEntry, 'id' | 'createdAt'>
): void {
  if (!Array.isArray(db.credentialAuditLog)) {
    db.credentialAuditLog = [];
  }
  db.credentialAuditLog.unshift({
    id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    ...entry,
    createdAt: new Date().toISOString(),
  });
  if (db.credentialAuditLog.length > 200) {
    db.credentialAuditLog = db.credentialAuditLog.slice(0, 200);
  }
}

function getSecret(): string {
  const envSecret = (process.env.AUTH_SECRET || process.env.SESSION_SECRET || '').trim();
  if (envSecret) {
    return envSecret;
  }
  if (!IS_VERCEL) {
    try {
      if (fs.existsSync(SECRET_PATH)) {
        const existing = fs.readFileSync(SECRET_PATH, 'utf8').trim();
        if (existing) return existing;
      }
      const secret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(SECRET_PATH, secret, 'utf8');
      return secret;
    } catch {
      // fall through to deterministic fallback
    }
  }
  const deterministicSeed =
    getSupabaseServiceRoleKey() ||
    getSupabaseServerUrl() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    'liga-master-argentina-pes6-default-auth-seed';
  if (IS_VERCEL) {
    console.warn(
      '⚠️ AUTH_SECRET no está configurada en las variables de entorno. Configurá AUTH_SECRET en Vercel para mayor seguridad.'
    );
  }
  return crypto
    .createHmac('sha256', 'lma-pes6-stable-auth-secret-v1')
    .update(deterministicSeed)
    .digest('hex');
}

const SERVER_SECRET = getSecret();

function signToken(payload: TokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SERVER_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', SERVER_SECRET).update(encoded).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function ensureDefaultAnthemWav(): string {
  const filename = 'himno_estadio_pes6.wav';
  const filepath = path.join(UPLOADS_DIR, 'music', filename);
  if (!IS_VERCEL && !fs.existsSync(filepath)) {
    try {
      // Generate a warm, loopable 16-second stadium synth progression (22.05kHz 16-bit mono PCM WAV)
      const sampleRate = 22050;
      const durationSec = 16;
      const numSamples = sampleRate * durationSec;
      const dataSize = numSamples * 2;
      const buffer = Buffer.alloc(44 + dataSize);

      buffer.write('RIFF', 0);
      buffer.writeUInt32LE(36 + dataSize, 4);
      buffer.write('WAVE', 8);
      buffer.write('fmt ', 12);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(1, 22);
      buffer.writeUInt32LE(sampleRate, 24);
      buffer.writeUInt32LE(sampleRate * 2, 28);
      buffer.writeUInt16LE(2, 32);
      buffer.writeUInt16LE(16, 34);
      buffer.write('data', 36);
      buffer.writeUInt32LE(dataSize, 40);

      const chords = [
        [261.63, 329.63, 392.0],
        [196.0, 246.94, 293.66],
        [220.0, 261.63, 329.63],
        [174.61, 220.0, 261.63],
      ];
      const leadMelody = [523.25, 587.33, 659.25, 523.25, 392.0, 440.0, 523.25, 392.0];

      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const chordIdx = Math.floor(t / 4) % chords.length;
        const chord = chords[chordIdx];
        const beatTime = t % 0.5;
        const pulse = Math.exp(-beatTime * 4.5);
        const padEnv = 0.55 + 0.45 * Math.sin((Math.PI * (t % 4)) / 4);

        let sample = 0;
        for (const freq of chord) {
          sample += Math.sin(2 * Math.PI * freq * t) * 0.14 * padEnv;
          sample += Math.sin(2 * Math.PI * (freq * 0.5) * t) * 0.08 * pulse;
        }

        const noteIdx = Math.floor(t / 2) % leadMelody.length;
        const leadFreq = leadMelody[noteIdx];
        const noteEnv = Math.exp(-(t % 2) * 1.4);
        sample += Math.sin(2 * Math.PI * leadFreq * t) * 0.12 * noteEnv;

        if (beatTime < 0.08) {
          const kickFreq = 90 * Math.exp(-beatTime * 28) + 42;
          sample += Math.sin(2 * Math.PI * kickFreq * beatTime) * 0.25 * (1 - beatTime / 0.08);
        }

        if (t < 0.25) sample *= t / 0.25;
        if (t > durationSec - 0.25) sample *= (durationSec - t) / 0.25;

        const clamped = Math.max(-0.95, Math.min(0.95, sample));
        buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
      }
      fs.writeFileSync(filepath, buffer);
    } catch {
      // ignore if read-only filesystem
    }
  }
  return `/uploads/music/${filename}`;
}

function defaultCupRules(): CupRulesSettings {
  return {
    format: 'Eliminación directa (16 equipos)',
    extraTime: 'Sí (Tiempo Extra)',
    penalties: 'Sí (Definición por Penales)',
    notes:
      'Se aplican las mismas reglas básicas de la Liga (prohibido gol de pase al ras en el área, hacer tiempo con el arquero o faltar el respeto al rival), pero todos los cruces de la Copa se juegan a eliminación directa con Tiempo Extra y Penales en caso de empate. El campeón de Copa enfrenta al campeón de Liga en la Final de la Recopa para coronar al Gran Campeón de la Liga Master Argentina.',
  };
}

function getRankedStandingsTeams(teams: Team[], matches: Match[]): Team[] {
  const stats = new Map<string, { team: Team; pts: number; gf: number; gc: number }>();
  for (const t of teams) {
    stats.set(t.id, { team: t, pts: 0, gf: 0, gc: 0 });
  }
  for (const m of matches) {
    if (m.status !== 'validated') continue;
    if (m.competitionType === 'copa' || m.competitionType === 'recopa') continue;
    const home = stats.get(m.homeTeamId);
    const away = stats.get(m.awayTeamId);
    if (!home || !away) continue;
    home.gf += m.homeGoals;
    home.gc += m.awayGoals;
    away.gf += m.awayGoals;
    away.gc += m.homeGoals;
    if (m.homeGoals > m.awayGoals) home.pts += 3;
    else if (m.homeGoals < m.awayGoals) away.pts += 3;
    else {
      home.pts += 1;
      away.pts += 1;
    }
  }
  return Array.from(stats.values())
    .sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      const dgA = a.gf - a.gc;
      const dgB = b.gf - b.gc;
      if (dgB !== dgA) return dgB - dgA;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.team.name.localeCompare(b.team.name, 'es');
    })
    .map((s) => s.team);
}

function buildEmptyCupMatch(
  id: string,
  round: CupRound,
  matchIndex: number,
  homeSlot: number | null,
  awaySlot: number | null
): CupMatchNode {
  return {
    id,
    round,
    matchIndex,
    homeSlot,
    awaySlot,
    homeGoals: null,
    awayGoals: null,
    homePenalties: null,
    awayPenalties: null,
    extraTime: false,
    winnerSlot: null,
    played: false,
  };
}

function syncCupNodeNames(cup: CupTournament): void {
  const bySlot = new Map(cup.participants.map((p) => [p.slot, p]));
  for (const m of cup.matches) {
    if (m.homeSlot) {
      const p = bySlot.get(m.homeSlot);
      if (p) {
        m.homeTeamName = p.teamName;
        m.homeMemberName = p.memberName;
        m.homeCrestUrl = p.crestUrl;
      }
    } else {
      m.homeTeamName = undefined;
      m.homeMemberName = undefined;
      m.homeCrestUrl = undefined;
    }
    if (m.awaySlot) {
      const p = bySlot.get(m.awaySlot);
      if (p) {
        m.awayTeamName = p.teamName;
        m.awayMemberName = p.memberName;
        m.awayCrestUrl = p.crestUrl;
      }
    } else {
      m.awayTeamName = undefined;
      m.awayMemberName = undefined;
      m.awayCrestUrl = undefined;
    }
    if (m.winnerSlot) {
      const p = bySlot.get(m.winnerSlot);
      if (p) {
        m.winnerName = p.teamName;
        m.winnerMemberName = p.memberName;
        m.winnerCrestUrl = p.crestUrl;
      }
    } else {
      m.winnerName = undefined;
      m.winnerMemberName = undefined;
      m.winnerCrestUrl = undefined;
    }
  }
  if (cup.championSlot) {
    const champ = bySlot.get(cup.championSlot);
    if (champ) {
      cup.championTeamName = champ.teamName;
      cup.championMemberName = champ.memberName;
      cup.championCrestUrl = champ.crestUrl;
      cup.recopa.cupChampionName = champ.teamName;
      cup.recopa.cupChampionMember = champ.memberName;
      cup.recopa.cupChampionCrestUrl = champ.crestUrl;
    }
  }
}

function createInitialCup(
  editionNumber = 1,
  seedTeams: Team[] = [],
  leagueLeader?: Team
): CupTournament {
  const participants: CupParticipant[] = Array.from({ length: 16 }, (_, idx) => {
    const slot = idx + 1;
    const t = seedTeams[idx];
    if (t) {
      return {
        slot,
        teamId: t.id,
        teamName: t.name,
        memberName: t.memberName,
        crestUrl: t.crestUrl,
      };
    }
    return {
      slot,
      teamName: `Cupo Libre #${slot}`,
      memberName: 'Por definir',
      crestUrl: '',
    };
  });

  const matches: CupMatchNode[] = [
    buildEmptyCupMatch('r16_1', 'r16', 1, 1, 2),
    buildEmptyCupMatch('r16_2', 'r16', 2, 3, 4),
    buildEmptyCupMatch('r16_3', 'r16', 3, 5, 6),
    buildEmptyCupMatch('r16_4', 'r16', 4, 7, 8),
    buildEmptyCupMatch('r16_5', 'r16', 5, 9, 10),
    buildEmptyCupMatch('r16_6', 'r16', 6, 11, 12),
    buildEmptyCupMatch('r16_7', 'r16', 7, 13, 14),
    buildEmptyCupMatch('r16_8', 'r16', 8, 15, 16),
    buildEmptyCupMatch('qf_1', 'qf', 1, null, null),
    buildEmptyCupMatch('qf_2', 'qf', 2, null, null),
    buildEmptyCupMatch('qf_3', 'qf', 3, null, null),
    buildEmptyCupMatch('qf_4', 'qf', 4, null, null),
    buildEmptyCupMatch('sf_1', 'sf', 1, null, null),
    buildEmptyCupMatch('sf_2', 'sf', 2, null, null),
    buildEmptyCupMatch('final', 'final', 1, null, null),
  ];

  const cup: CupTournament = {
    editionNumber,
    editionName: `${editionNumber}° Edición — Copa de la Liga`,
    status: 'in_progress',
    participants,
    matches,
    championSlot: null,
    championTeamName: '',
    championMemberName: '',
    championCrestUrl: '',
    championGreeting: '¡Felicitaciones Campeón de la Copa de la Liga!',
    recopa: {
      enabled: true,
      leagueChampionName: leagueLeader?.name || 'Campeón de Liga',
      leagueChampionMember: leagueLeader?.memberName || 'Por definir',
      leagueChampionCrestUrl: leagueLeader?.crestUrl || '',
      cupChampionName: 'Campeón de Copa',
      cupChampionMember: 'Por definir',
      cupChampionCrestUrl: '',
      leagueGoals: null,
      cupGoals: null,
      leaguePenalties: null,
      cupPenalties: null,
      extraTime: false,
      grandChampionName: '',
      grandChampionMember: '',
      grandChampionCrestUrl: '',
      grandChampionSide: null,
      greeting: '¡Felicitaciones Campeón de la Recopa!',
      played: false,
    },
    updatedAt: new Date().toISOString(),
  };

  syncCupNodeNames(cup);
  return cup;
}

const NEXT_ROUND_MAP: Record<string, { targetMatchId: string; side: 'home' | 'away' }> = {
  r16_1: { targetMatchId: 'qf_1', side: 'home' },
  r16_2: { targetMatchId: 'qf_1', side: 'away' },
  r16_3: { targetMatchId: 'qf_2', side: 'home' },
  r16_4: { targetMatchId: 'qf_2', side: 'away' },
  r16_5: { targetMatchId: 'qf_3', side: 'home' },
  r16_6: { targetMatchId: 'qf_3', side: 'away' },
  r16_7: { targetMatchId: 'qf_4', side: 'home' },
  r16_8: { targetMatchId: 'qf_4', side: 'away' },
  qf_1: { targetMatchId: 'sf_1', side: 'home' },
  qf_2: { targetMatchId: 'sf_1', side: 'away' },
  qf_3: { targetMatchId: 'sf_2', side: 'home' },
  qf_4: { targetMatchId: 'sf_2', side: 'away' },
  sf_1: { targetMatchId: 'final', side: 'home' },
  sf_2: { targetMatchId: 'final', side: 'away' },
};

function propagateCupMatchWinner(cup: CupTournament, match: CupMatchNode): void {
  const next = NEXT_ROUND_MAP[match.id];
  if (next) {
    const target = cup.matches.find((m) => m.id === next.targetMatchId);
    if (target) {
      if (next.side === 'home') {
        target.homeSlot = match.winnerSlot;
      } else {
        target.awaySlot = match.winnerSlot;
      }
      if (
        target.winnerSlot !== null &&
        target.winnerSlot !== target.homeSlot &&
        target.winnerSlot !== target.awaySlot
      ) {
        target.winnerSlot = null;
        target.played = Boolean(target.homeGoals !== null && target.awayGoals !== null);
        propagateCupMatchWinner(cup, target);
      }
    }
  } else if (match.id === 'final') {
    if (match.winnerSlot) {
      const winner = cup.participants.find((p) => p.slot === match.winnerSlot);
      cup.championSlot = match.winnerSlot;
      cup.championTeamName = winner?.teamName || match.winnerName || '';
      cup.championMemberName = winner?.memberName || match.winnerMemberName || '';
      cup.championCrestUrl = winner?.crestUrl || match.winnerCrestUrl || '';
      cup.status = 'finished';
      cup.recopa.cupChampionName = cup.championTeamName;
      cup.recopa.cupChampionMember = cup.championMemberName;
      cup.recopa.cupChampionCrestUrl = cup.championCrestUrl;
    } else {
      if (cup.championSlot !== null) {
        cup.championSlot = null;
        cup.championTeamName = '';
        cup.championMemberName = '';
        cup.championCrestUrl = '';
        cup.recopa.cupChampionName = 'Campeón de Copa';
        cup.recopa.cupChampionMember = 'Por definir';
        cup.recopa.cupChampionCrestUrl = '';
      }
      cup.status = 'in_progress';
    }
  }
  syncCupNodeNames(cup);
}

function createInitialDb(): LeagueDatabase {
  const anthemUrl = ensureDefaultAnthemWav();
  const now = new Date().toISOString();

  const seededTeams: Team[] = [
    {
      id: 'ADM01',
      claveHash: hashPassword('admin2026'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'The Den FC (Admin)',
      memberName: 'Administrador',
      crestUrl: '/api/crest/ADM01.svg',
      bio: 'Equipo oficial del Administrador participando en la 1° Temporada 2026-2027.',
      primaryColor: '#0EA5E9',
      secondaryColor: '#16A34A',
      createdAt: now,
    },
    {
      id: 'LMA01',
      claveHash: hashPassword('pes601'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'Boca Juniors',
      memberName: 'ElPipa_10',
      crestUrl: '/api/crest/LMA01.svg',
      bio: 'Campeón histórico de copa, jugando al toque corto y contraataque.',
      primaryColor: '#003B7A',
      secondaryColor: '#F7C600',
      createdAt: now,
    },
    {
      id: 'LMA02',
      claveHash: hashPassword('pes602'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'River Plate',
      memberName: 'Millo_PES6',
      crestUrl: '/api/crest/LMA02.svg',
      bio: 'Presión alta y pelota al piso desde el medio.',
      primaryColor: '#DC2626',
      secondaryColor: '#FFFFFF',
      createdAt: now,
    },
    {
      id: 'LMA03',
      claveHash: hashPassword('pes603'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'Racing Club',
      memberName: 'LaAcade99',
      crestUrl: '/api/crest/LMA03.svg',
      bio: 'La Academia presente en la 1° Temporada 2026-2027.',
      primaryColor: '#38BDF8',
      secondaryColor: '#FFFFFF',
      createdAt: now,
    },
    {
      id: 'LMA04',
      claveHash: hashPassword('pes604'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'Independiente',
      memberName: 'RojoRey7',
      crestUrl: '/api/crest/LMA04.svg',
      bio: 'Mística copera en cada fecha de la Liga Master.',
      primaryColor: '#B91C1C',
      secondaryColor: '#FFFFFF',
      createdAt: now,
    },
    {
      id: 'LMA05',
      claveHash: hashPassword('pes605'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'San Lorenzo',
      memberName: 'CuervoBoedo',
      crestUrl: '/api/crest/LMA05.svg',
      bio: 'Firme en defensa y letal de pelota parada.',
      primaryColor: '#1E3A8A',
      secondaryColor: '#DC2626',
      createdAt: now,
    },
    {
      id: 'LMA06',
      claveHash: hashPassword('pes606'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'Juventus',
      memberName: 'Tano_DelPiero',
      crestUrl: '/api/crest/LMA06.svg',
      bio: 'Representando a la Serie A con clásico 4-4-2.',
      primaryColor: '#111827',
      secondaryColor: '#F8FAFC',
      createdAt: now,
    },
    {
      id: 'LMA07',
      claveHash: hashPassword('pes607'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'AC Milan',
      memberName: 'Kaka_22Arg',
      crestUrl: '/api/crest/LMA07.svg',
      bio: 'Velocidad por las bandas y remate de media distancia.',
      primaryColor: '#991B1B',
      secondaryColor: '#111827',
      createdAt: now,
    },
    {
      id: 'LMA08',
      claveHash: hashPassword('pes608'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'Real Madrid',
      memberName: 'Merengue_Sur',
      crestUrl: '/api/crest/LMA08.svg',
      bio: 'Fútbol ofensivo y juego limpio en THE DEN PATCH.',
      primaryColor: '#F8FAFC',
      secondaryColor: '#EAB308',
      createdAt: now,
    },
    {
      id: 'LMA09',
      claveHash: hashPassword('pes609'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'FC Barcelona',
      memberName: 'Pulga_D10S',
      crestUrl: '/api/crest/LMA09.svg',
      bio: 'Posesión total y gambeta corta al estilo PES6.',
      primaryColor: '#1D4ED8',
      secondaryColor: '#B91C1C',
      createdAt: now,
    },
    {
      id: 'LMA10',
      claveHash: hashPassword('pes610'),
      accountStatus: 'active',
      tokenVersion: 1,
      credentialsUpdatedAt: now,
      name: 'Estudiantes LP',
      memberName: 'Pincha_Bilardo',
      crestUrl: '/api/crest/LMA10.svg',
      bio: 'Orden táctico y eficacia absoluta.',
      primaryColor: '#DC2626',
      secondaryColor: '#FFFFFF',
      createdAt: now,
    },
  ];

  const seededMatches: Match[] = [
    {
      id: 'm_001',
      matchday: 1,
      homeTeamId: 'LMA01',
      awayTeamId: 'LMA02',
      homeGoals: 2,
      awayGoals: 1,
      leg: 'Ida',
      playedAt: '2026-11-10',
      notes: 'Superclásico intenso bajo clima despejado.',
      submittedByTeamId: 'LMA01',
      submittedByName: 'ElPipa_10',
      status: 'validated',
      validatedAt: now,
      createdAt: now,
    },
    {
      id: 'm_002',
      matchday: 1,
      homeTeamId: 'LMA03',
      awayTeamId: 'LMA04',
      homeGoals: 3,
      awayGoals: 1,
      leg: 'Ida',
      playedAt: '2026-11-10',
      notes: 'Clásico de Avellaneda en la Fecha 1.',
      submittedByTeamId: 'LMA03',
      submittedByName: 'LaAcade99',
      status: 'validated',
      validatedAt: now,
      createdAt: now,
    },
    {
      id: 'm_003',
      matchday: 1,
      homeTeamId: 'LMA06',
      awayTeamId: 'LMA07',
      homeGoals: 1,
      awayGoals: 1,
      leg: 'Ida',
      playedAt: '2026-11-11',
      notes: 'Duelo italiano muy parejo.',
      submittedByTeamId: 'LMA06',
      submittedByName: 'Tano_DelPiero',
      status: 'validated',
      validatedAt: now,
      createdAt: now,
    },
    {
      id: 'm_004',
      matchday: 1,
      homeTeamId: 'LMA08',
      awayTeamId: 'LMA09',
      homeGoals: 2,
      awayGoals: 3,
      leg: 'Ida',
      playedAt: '2026-11-11',
      notes: 'Partidazo con 5 goles.',
      submittedByTeamId: 'LMA09',
      submittedByName: 'Pulga_D10S',
      status: 'validated',
      validatedAt: now,
      createdAt: now,
    },
    {
      id: 'm_005',
      matchday: 1,
      homeTeamId: 'LMA05',
      awayTeamId: 'LMA10',
      homeGoals: 0,
      awayGoals: 1,
      leg: 'Ida',
      playedAt: '2026-11-12',
      notes: 'Gol de pelota parada sobre el final.',
      submittedByTeamId: 'LMA10',
      submittedByName: 'Pincha_Bilardo',
      status: 'validated',
      validatedAt: now,
      createdAt: now,
    },
  ];

  return {
    settings: {
      title: 'Liga Master Argentina Pes6',
      subtitle: '(TEMPORADA 2026-2027) THE DEN PATCH',
      description: '',
      calendarMessage: '',
      bannerText: 'Esto es Liga Master Argentina',
      crestUrl: '/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png',
      coverUrl: '/assets/aistudio/cabra_copa_3d_hd.jpg',
      faviconUrl: '/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png',
      adminId: 'ADMI',
      adminClaveHash: hashPassword('LMA2026'),
      adminTokenVersion: 1,
      adminTeamId: 'ADM01',
      backupGmail: 'cristiandiazdevelez@gmail.com',
      radioName: 'FM 101.5 Pop Radio (Bs. As.)',
      radioStreamUrl: 'https://popradio.stweb.tv/popradio/live/playlist.m3u8',
      maxTeams: 100,
    },
    teams: seededTeams,
    matches: seededMatches,
    fixtures: [],
    claims: [],
    videos: [],
    champions: [
      {
        id: 'champ_inaugural',
        season: 'Copa Inaugural — THE DEN PATCH',
        teamName: 'Selección Liga Master Argentina',
        memberName: 'Edición Apertura 2026',
        notes: 'Festejo inaugural rumbo a la 1° Temporada 2026-2027. Subí el PNG oficial del campeón cuando termine la temporada.',
        celebrationImageUrl: '/default-assets/champion_celebration_default_1794642902876.jpg',
        createdAt: now,
      },
    ],
    rules: {
      prohibitedRules: [
        'Hacer goles de "pase al ras del suelo" dentro del área.',
        'Hacer tiempo y jugar constantemente con el arquero.',
        'Faltar el respeto al rival.',
      ],
      generalNotes:
        'Todo resultado debe subirse en la sección Partidos (con captura PNG opcional) y queda sujeto a validación oficial del Administrador antes de impactar en la Tabla de Posiciones.',
      gameMode: {
        partidos: 'Ida y vuelta',
        tiempo: '10 minutos',
        condicion: 'Al azar',
        lesiones: 'Sí',
        cambios: '5',
        pausas: '3',
        clima: 'Despejado',
      },
      cupRules: defaultCupRules(),
    },
    music: [
      {
        id: 'track_pes_dreamers',
        title: 'Dreamers (PES Soundtrack)',
        artist: 'Savoir Adore',
        audioUrl: '/assets/aistudio/HD_PES_2013_Soundtrack_Savoir_Adore_-_Dreamers_102009c4.mp3',
        createdAt: now,
      },
      {
        id: 'track_dogfighter',
        title: 'n0teregales22 vs idfsuspect - Dogfigthersinai 1vs1',
        artist: 'Liga Master Argentina',
        audioUrl: '/assets/aistudio/ytmp3free.cc_n0teregales22-vs-idfsuspect-dogfigthersinai-1vs1-youtubemp3free.org_9763b7d5.mp3',
        createdAt: now,
      },
      {
        id: 'track_reggae_cypher_4',
        title: 'Reggae Cypher Vol. 4',
        artist: 'Liga Master Argentina',
        audioUrl: '/assets/aistudio/tomp3.cc_-_REGGAE_CYPHER_VOL4PNEGGACHUSTERFIELD_KINGMAGNETORASTACHAIFYAHBWOYSOLOHMATEONECROJOCKER_1d80086c.mp3',
        createdAt: now,
      },
      {
        id: 'track_dance_monkey',
        title: 'Dance Monkey (Nath Jennings Bootleg)',
        artist: 'Tones and I',
        audioUrl: '/assets/aistudio/Tones___I_-_Dance_Monkey__Nath_Jennings_Bootleg__MP3_320K__e7bade45.mp3',
        createdAt: now,
      },
      {
        id: 'track_callejeros_imposible',
        title: 'Imposible',
        artist: 'Callejeros',
        audioUrl: '/assets/aistudio/Callejeros_-_Imposible__Letra__add73bbc.mp3',
        createdAt: now,
      },
      {
        id: 'track_bejo_kush',
        title: 'Give Me The Kush',
        artist: 'Bejo & Cráneo',
        audioUrl: '/assets/aistudio/tomp3.cc_-_BEJO_CR_NEO__GIVE_ME_THE_KUSH__1__104f8b0c.mp3',
        createdAt: now,
      },
      {
        id: 'track_aleman_lgante_requisito_420',
        title: 'Requisito 420',
        artist: 'Alemán & L-Gante',
        audioUrl: '/assets/aistudio/Alem_n___L-Gante_-_Requisito_420__Video_Oficial___1__2fe2be94.mp3',
        createdAt: now,
      },
      {
        id: 'track_ysya_a_por_todo',
        title: 'A Por Todo (Prod. Oniria)',
        artist: 'YSY A',
        audioUrl: '/assets/aistudio/05_-_YSY_A_-_A_POR_TODO__PROD._ONIRIA__06261293.mp3',
        createdAt: now,
      },
    ],
    calendarEvents: [],
    cup: createInitialCup(1, seededTeams, seededTeams[1] || seededTeams[0]),
    credentialAuditLog: [],
  };
}

const DB_CACHE_TTL_MS = 1500;
let dbMemoryCache: { db: LeagueDatabase; fetchedAt: number } | null = null;
let inFlightDbLoad: Promise<LeagueDatabase> | null = null;

async function migrateAndNormalizeDb(parsed: LeagueDatabase): Promise<{ db: LeagueDatabase; migrated: boolean }> {
  let migrated = false;

  if (parsed.settings.adminId === 'ADMIN' && parsed.settings.adminClave === 'admin2026') {
    parsed.settings.adminId = 'ADMI';
    parsed.settings.adminClave = 'LMA2026';
    migrated = true;
  }

  // Migrate legacy plaintext admin password to scrypt hash and erase plaintext
  if (!parsed.settings.adminClaveHash) {
    const legacyAdminPlain = String(parsed.settings.adminClave || 'LMA2026').trim() || 'LMA2026';
    parsed.settings.adminClaveHash = hashPassword(legacyAdminPlain);
    migrated = true;
  }
  if ('adminClave' in parsed.settings) {
    delete parsed.settings.adminClave;
    migrated = true;
  }
  if (typeof parsed.settings.adminTokenVersion !== 'number') {
    parsed.settings.adminTokenVersion = 1;
    migrated = true;
  }

  // Migrate legacy plaintext participant passwords to scrypt hashes and erase plaintext
  if (Array.isArray(parsed.teams)) {
    for (const t of parsed.teams) {
      if (!t.claveHash) {
        const legacyMemberPlain = String(t.clave || t.id.toLowerCase()).trim() || t.id.toLowerCase();
        t.claveHash = hashPassword(legacyMemberPlain);
        migrated = true;
      }
      if ('clave' in t) {
        delete t.clave;
        migrated = true;
      }
      if (t.accountStatus !== 'active' && t.accountStatus !== 'blocked') {
        t.accountStatus = 'active';
        migrated = true;
      }
      if (typeof t.tokenVersion !== 'number') {
        t.tokenVersion = 1;
        migrated = true;
      }
    }
  }

  if (!Array.isArray(parsed.credentialAuditLog)) {
    parsed.credentialAuditLog = [];
    migrated = true;
  }
  if (
    parsed.settings.crestUrl === '/default-assets/league_crest_argentina_1794642900932.jpg' ||
    parsed.settings.crestUrl === '/assets/aistudio/icono_7859ce5e.png' ||
    parsed.settings.crestUrl === '/default-assets/icono_liga_hd_1794645294665.jpg' ||
    parsed.settings.crestUrl === '/default-assets/icono_liga_3d_hd_1794813291158.jpg'
  ) {
    parsed.settings.crestUrl = '/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png';
    migrated = true;
  }
  if (
    parsed.settings.coverUrl === '/default-assets/hero_cabra_messi_copa_1794642901898.jpg' ||
    parsed.settings.coverUrl === '/default-assets/hero_cabra_messi_argentina_1794730196481.jpg' ||
    parsed.settings.coverUrl === '/default-assets/hero_cabra_sol_bandera_1794730623048.jpg' ||
    parsed.settings.coverUrl === '/default-assets/hero_cabra_messi_hd_1794813291066.jpg' ||
    parsed.settings.coverUrl === '/assets/aistudio/_Liga_master_argentina_PES6._36522b75.png'
  ) {
    parsed.settings.coverUrl = '/assets/aistudio/cabra_copa_3d_hd.jpg';
    migrated = true;
  }
  if (
    !parsed.settings.faviconUrl ||
    parsed.settings.faviconUrl === '/default-assets/league_crest_argentina_1794642900932.jpg' ||
    parsed.settings.faviconUrl === '/assets/aistudio/icono_7859ce5e.png' ||
    parsed.settings.faviconUrl === '/default-assets/icono_liga_hd_1794645294665.jpg' ||
    parsed.settings.faviconUrl === '/default-assets/icono_liga_3d_hd_1794813291158.jpg'
  ) {
    parsed.settings.faviconUrl = '/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png';
    migrated = true;
  }
  if (parsed.settings.title === 'Liga Master Argentina Pes6 (1°Temporada 2026-2027)') {
    parsed.settings.title = 'Liga Master Argentina Pes6';
    parsed.settings.subtitle = '(TEMPORADA 2026-2027) THE DEN PATCH';
    migrated = true;
  }
  if (
    parsed.settings.subtitle &&
    /1°\s*temporada\s*2026/i.test(parsed.settings.subtitle)
  ) {
    parsed.settings.subtitle = '(TEMPORADA 2026-2027) THE DEN PATCH';
    migrated = true;
  }
  if (!Array.isArray(parsed.fixtures)) {
    parsed.fixtures = [];
    migrated = true;
  }
  if (!Array.isArray(parsed.calendarEvents)) {
    parsed.calendarEvents = [];
    migrated = true;
  }
  if (!Array.isArray(parsed.claims)) {
    parsed.claims = [];
    migrated = true;
  }
  if (!Array.isArray(parsed.news)) {
    parsed.news = [];
    migrated = true;
  }
  if (!Array.isArray(parsed.comments)) {
    parsed.comments = [];
    migrated = true;
  }
  if (typeof parsed.pageLikes !== 'number') {
    parsed.pageLikes = 0;
    migrated = true;
  }
  if (!parsed.rules.cupRules) {
    parsed.rules.cupRules = defaultCupRules();
    migrated = true;
  }
  if (
    typeof parsed.settings.description !== 'string' ||
    /Torneo oficial de PES 6.*comunidad\.?/i.test(parsed.settings.description)
  ) {
    parsed.settings.description = '';
    migrated = true;
  }
  if (typeof parsed.settings.calendarMessage !== 'string') {
    parsed.settings.calendarMessage = '';
    migrated = true;
  }
  if (!parsed.settings.backupGmail || !parsed.settings.backupGmail.trim()) {
    parsed.settings.backupGmail = 'cristiandiazdevelez@gmail.com';
    migrated = true;
  }
  if (!parsed.settings.radioStreamUrl || !parsed.settings.radioStreamUrl.trim()) {
    parsed.settings.radioName = 'FM 101.5 Pop Radio (Bs. As.)';
    parsed.settings.radioStreamUrl = 'https://popradio.stweb.tv/popradio/live/playlist.m3u8';
    migrated = true;
  }
  if (!parsed.cup) {
    const ranked = getRankedStandingsTeams(parsed.teams || [], parsed.matches || []);
    parsed.cup = createInitialCup(1, ranked.slice(0, 16), ranked[0]);
    migrated = true;
  }

  if (await syncAllChampionTrophies(parsed)) {
    migrated = true;
  }

  ensureDefaultAnthemWav();
  return { db: parsed, migrated };
}

function readBundledSeedJson(): LeagueDatabase | null {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(raw) as LeagueDatabase;
    }
  } catch (err) {
    console.warn('No se pudo leer data/league.json semilla:', err instanceof Error ? err.message : err);
  }
  return null;
}

async function loadDbUncached(): Promise<LeagueDatabase> {
  if (isSupabaseDbConfigured()) {
    const existing = await readLeagueDbFromSupabase<LeagueDatabase>();
    if (existing?.data) {
      const { db, migrated } = await migrateAndNormalizeDb(existing.data);
      if (migrated) {
        await saveDb(db);
      } else {
        dbMemoryCache = { db, fetchedAt: Date.now() };
      }
      return db;
    }

    // Primer arranque contra Supabase: migrar automáticamente data/league.json si existe
    const seedParsed = readBundledSeedJson();
    if (seedParsed) {
      const { db } = await migrateAndNormalizeDb(seedParsed);
      await saveDb(db);
      return db;
    }

    const initial = createInitialDb();
    await saveDb(initial);
    return initial;
  }

  // Modo local sin Supabase configurado (desarrollo local)
  if (!fs.existsSync(DB_PATH)) {
    const initial = createInitialDb();
    await saveDb(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as LeagueDatabase;
    const { db, migrated } = await migrateAndNormalizeDb(parsed);
    if (migrated && !IS_VERCEL) {
      await saveDb(db);
    } else {
      dbMemoryCache = { db, fetchedAt: Date.now() };
    }
    return db;
  } catch {
    const initial = createInitialDb();
    if (!IS_VERCEL) {
      await saveDb(initial);
    }
    dbMemoryCache = { db: initial, fetchedAt: Date.now() };
    return initial;
  }
}

async function loadDb(options?: { fresh?: boolean }): Promise<LeagueDatabase> {
  if (!options?.fresh && dbMemoryCache && Date.now() - dbMemoryCache.fetchedAt < DB_CACHE_TTL_MS) {
    return dbMemoryCache.db;
  }
  if (!options?.fresh && inFlightDbLoad) {
    return inFlightDbLoad;
  }
  const loader = loadDbUncached().finally(() => {
    if (inFlightDbLoad === loader) {
      inFlightDbLoad = null;
    }
  });
  if (!options?.fresh) {
    inFlightDbLoad = loader;
  }
  return loader;
}

const LIGA_TROPHY_IMG = '/assets/aistudio/Trofeo_Liga_Argentina_LMA.jpg';
const COPA_TROPHY_IMG = '/assets/aistudio/Copa_de_la_liga_Argentina_4a33ee89.jfif';
const RECOPA_TROPHY_IMG = '/assets/aistudio/Recopa_Argentina____fc7a7c8a.jfif';

function getTrophyImageForType(type: 'liga' | 'copa' | 'recopa'): string {
  if (type === 'copa') return COPA_TROPHY_IMG;
  if (type === 'recopa') return RECOPA_TROPHY_IMG;
  return LIGA_TROPHY_IMG;
}

function getDefaultTrophyTitle(type: 'liga' | 'copa' | 'recopa'): string {
  if (type === 'copa') return 'Campeón Copa de la Liga';
  if (type === 'recopa') return 'Gran Campeón Recopa Argentina';
  return 'Campeón Liga Argentina';
}

function findTeamForChampion(
  teams: Team[],
  opts: { teamId?: string; teamName?: string; memberName?: string }
): Team | undefined {
  if (opts.teamId) {
    const byId = teams.find((t) => t.id === opts.teamId);
    if (byId) return byId;
  }
  const norm = (s?: string) => (s || '').trim().toLowerCase();
  const tn = norm(opts.teamName);
  const mn = norm(opts.memberName);
  if (tn) {
    const byName = teams.find((t) => norm(t.name) === tn);
    if (byName) return byName;
  }
  if (mn) {
    const byMember = teams.find((t) => norm(t.memberName) === mn);
    if (byMember) return byMember;
  }
  return undefined;
}

function publishChampionNewspaper(
  db: LeagueDatabase,
  opts: {
    teamName: string;
    memberName: string;
    crestUrl?: string;
    type: 'liga' | 'copa' | 'recopa';
    title?: string;
    season: string;
    celebrationImageUrl?: string;
    sourceKey?: string;
  }
): boolean {
  if (!Array.isArray(db.news)) db.news = [];
  const tournamentLabel =
    opts.type === 'recopa'
      ? 'Recopa Argentina'
      : opts.type === 'copa'
      ? 'Copa de la Liga Argentina'
      : 'Liga Master Argentina';
  const celebrationImg = opts.celebrationImageUrl || getTrophyImageForType(opts.type);
  const crestUrl =
    opts.crestUrl || '/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png';
  const headline = `¡${opts.teamName.toUpperCase()} CAMPEÓN DE ${tournamentLabel.toUpperCase()}!`;
  const body = `¡EDICIÓN EXTRAORDINARIA! ${opts.teamName}, dirigido por ${opts.memberName}, levantó la copa y se consagró campeón oficial de ${tournamentLabel} (${opts.season}). ¡Salud campeón de la Liga Master Argentina PES6!`;

  if (opts.sourceKey) {
    const existing = db.news.find((n) => n.sourceKey === opts.sourceKey && n.isChampionNewspaper);
    if (existing) {
      let updated = false;
      if (
        existing.title !== headline ||
        existing.championTeamName !== opts.teamName ||
        existing.championMemberName !== opts.memberName ||
        existing.championCrestUrl !== crestUrl ||
        existing.celebrationImageUrl !== celebrationImg ||
        existing.championSeason !== opts.season
      ) {
        existing.title = headline;
        existing.content = body;
        existing.championTeamName = opts.teamName;
        existing.championMemberName = opts.memberName;
        existing.championCrestUrl = crestUrl;
        existing.championTournament = tournamentLabel;
        existing.championSeason = opts.season;
        existing.celebrationImageUrl = celebrationImg;
        existing.imageUrl = celebrationImg;
        updated = true;
      }
      return updated;
    }
  }

  db.news.unshift({
    id: `news_champ_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    title: headline,
    content: body,
    textColor: '#FACC15',
    imageUrl: celebrationImg,
    isChampionNewspaper: true,
    championTeamName: opts.teamName,
    championMemberName: opts.memberName,
    championCrestUrl: crestUrl,
    championTournament: tournamentLabel,
    championSeason: opts.season,
    celebrationImageUrl: celebrationImg,
    sourceKey: opts.sourceKey,
    createdAt: new Date().toISOString(),
  });
  return true;
}

function awardTeamTrophy(
  db: LeagueDatabase,
  opts: {
    teamId?: string;
    teamName?: string;
    memberName?: string;
    type: 'liga' | 'copa' | 'recopa';
    title?: string;
    season: string;
    celebrationImageUrl?: string;
    sourceKey?: string;
    skipNewspaper?: boolean;
  }
): boolean {
  const target = findTeamForChampion(db.teams, opts);
  // If sourceKey is provided, remove stale auto-award from any OTHER team (e.g., if admin corrected winner)
  let changed = false;
  if (opts.sourceKey) {
    for (const t of db.teams) {
      if (!Array.isArray(t.trophies)) continue;
      if (target && t.id === target.id) continue;
      const before = t.trophies.length;
      t.trophies = t.trophies.filter((tr) => tr.sourceKey !== opts.sourceKey);
      if (t.trophies.length !== before) changed = true;
    }
  }

  const displayTeamName = target?.name || opts.teamName || '';
  const displayMemberName = target?.memberName || opts.memberName || 'Campeón Oficial';
  if (!opts.skipNewspaper && displayTeamName) {
    const newsChanged = publishChampionNewspaper(db, {
      teamName: displayTeamName,
      memberName: displayMemberName,
      crestUrl: target?.crestUrl,
      type: opts.type,
      title: opts.title,
      season: opts.season,
      celebrationImageUrl: opts.celebrationImageUrl,
      sourceKey: opts.sourceKey,
    });
    if (newsChanged) changed = true;
  }

  if (!target) return changed;
  if (!Array.isArray(target.trophies)) target.trophies = [];

  const title = opts.title || getDefaultTrophyTitle(opts.type);
  const imageUrl = getTrophyImageForType(opts.type);

  if (opts.sourceKey) {
    const existing = target.trophies.find((tr) => tr.sourceKey === opts.sourceKey);
    if (existing) {
      if (
        existing.type !== opts.type ||
        existing.title !== title ||
        existing.season !== opts.season ||
        existing.imageUrl !== imageUrl
      ) {
        existing.type = opts.type;
        existing.title = title;
        existing.season = opts.season;
        existing.imageUrl = imageUrl;
        return true;
      }
      return changed;
    }
  }

  target.trophies.unshift({
    id: `trophy_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    type: opts.type,
    title,
    season: opts.season,
    imageUrl,
    message: '',
    awardedAt: new Date().toISOString(),
    sourceKey: opts.sourceKey,
  });
  return true;
}

function removeTrophyBySourceKey(db: LeagueDatabase, sourceKey: string): boolean {
  let changed = false;
  for (const t of db.teams) {
    if (!Array.isArray(t.trophies)) continue;
    const before = t.trophies.length;
    t.trophies = t.trophies.filter((tr) => tr.sourceKey !== sourceKey);
    if (t.trophies.length !== before) changed = true;
  }
  if (Array.isArray(db.news)) {
    const beforeNews = db.news.length;
    db.news = db.news.filter((n) => n.sourceKey !== sourceKey);
    if (db.news.length !== beforeNews) changed = true;
  }
  return changed;
}

function readSynchsafe32(buf: Buffer, offset: number): number {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

function findNullTerm(buf: Buffer, start: number, encoding: number, limit: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < limit; i += 2) {
      if (buf[i] === 0 && buf[i + 1] === 0) return i + 2;
    }
    return limit;
  }
  for (let i = start; i < limit; i++) {
    if (buf[i] === 0) return i + 1;
  }
  return limit;
}

async function persistMp3CoverBuffer(imgBuf: Buffer, ext: 'png' | 'jpg' | 'webp'): Promise<string | undefined> {
  const hash = crypto.createHash('sha1').update(imgBuf).digest('hex').slice(0, 16);
  const coverName = `cover_${hash}.${ext}`;
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  if (isSupabaseDbConfigured()) {
    return uploadBufferToSupabaseStorage(imgBuf, `music/covers/${coverName}`, mime);
  }
  try {
    const coverPath = path.join(TEMP_UPLOADS_DIR, 'music', 'covers', coverName);
    if (!fs.existsSync(coverPath)) {
      fs.writeFileSync(coverPath, imgBuf);
    }
    return `/uploads/music/covers/${coverName}`;
  } catch {
    return undefined;
  }
}

async function extractAndSaveMp3Cover(mp3FilePath: string): Promise<string | undefined> {
  try {
    if (!fs.existsSync(mp3FilePath)) return undefined;
    const fd = fs.openSync(mp3FilePath, 'r');
    const head = Buffer.alloc(10);
    const readHead = fs.readSync(fd, head, 0, 10, 0);
    if (readHead < 10 || head.slice(0, 3).toString('ascii') !== 'ID3') {
      fs.closeSync(fd);
      return undefined;
    }
    const majorVersion = head[3];
    const flags = head[5];
    const tagSize = readSynchsafe32(head, 6);
    const maxRead = Math.min(tagSize + 10, 4 * 1024 * 1024);
    const buf = Buffer.alloc(maxRead);
    fs.readSync(fd, buf, 0, maxRead, 0);
    fs.closeSync(fd);

    const tagEnd = buf.length;
    let pos = 10;
    if ((flags & 0x40) !== 0 && pos + 4 <= tagEnd) {
      const extSize = majorVersion === 4 ? readSynchsafe32(buf, pos) : buf.readUInt32BE(pos);
      pos += majorVersion === 4 ? extSize : extSize + 4;
    }

    while (pos < tagEnd) {
      if (majorVersion === 2) {
        if (pos + 6 > tagEnd) break;
        const frameId = buf.slice(pos, pos + 3).toString('ascii');
        if (frameId === '\0\0\0') break;
        const frameSize = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
        pos += 6;
        if (frameSize <= 0 || pos + frameSize > tagEnd) break;
        if (frameId === 'PIC') {
          const encoding = buf[pos];
          const imgStart = findNullTerm(buf, pos + 5, encoding, pos + frameSize);
          const imgBuf = buf.slice(imgStart, pos + frameSize);
          if (imgBuf.length > 64) {
            const isPng = imgBuf[0] === 0x89 && imgBuf[1] === 0x50;
            const ext = isPng ? 'png' : 'jpg';
            return await persistMp3CoverBuffer(imgBuf, ext);
          }
        }
        pos += frameSize;
      } else {
        if (pos + 10 > tagEnd) break;
        if (buf[pos] === 0) break;
        const frameId = buf.slice(pos, pos + 4).toString('ascii');
        let frameSize = majorVersion === 4 ? readSynchsafe32(buf, pos + 4) : buf.readUInt32BE(pos + 4);
        if (majorVersion === 4 && pos + 10 + frameSize > tagEnd) {
          const rawSize = buf.readUInt32BE(pos + 4);
          if (pos + 10 + rawSize <= tagEnd) frameSize = rawSize;
        }
        pos += 10;
        if (frameSize <= 0 || pos + frameSize > tagEnd) break;
        if (frameId === 'APIC') {
          const frameEnd = pos + frameSize;
          const encoding = buf[pos];
          let cursor = pos + 1;
          while (cursor < frameEnd && buf[cursor] !== 0) cursor += 1;
          cursor += 2; // skip null + picture type
          cursor = findNullTerm(buf, cursor, encoding, frameEnd);
          if (cursor < frameEnd) {
            const imgBuf = buf.slice(cursor, frameEnd);
            if (imgBuf.length > 64) {
              const isPng = imgBuf[0] === 0x89 && imgBuf[1] === 0x50;
              const isWebp = imgBuf[0] === 0x52 && imgBuf[1] === 0x49;
              const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
              return await persistMp3CoverBuffer(imgBuf, ext);
            }
          }
        }
        pos += frameSize;
      }
    }
  } catch {
    // ignore invalid ID3
  }
  return undefined;
}

function resolveLocalAudioPath(audioUrl: string): string | null {
  if (!audioUrl) return null;
  if (audioUrl.startsWith('/uploads/music/')) {
    return path.join(UPLOADS_DIR, 'music', path.basename(audioUrl));
  }
  if (audioUrl.startsWith('/assets/aistudio/')) {
    return path.join(ROOT_DIR, 'public', 'assets', 'aistudio', path.basename(audioUrl));
  }
  return null;
}

async function syncAllChampionTrophies(db: LeagueDatabase): Promise<boolean> {
  let changed = false;
  for (const m of db.music || []) {
    if (!m.coverUrl && m.audioUrl && m.audioUrl.toLowerCase().endsWith('.mp3')) {
      const localPath = resolveLocalAudioPath(m.audioUrl);
      if (localPath && fs.existsSync(localPath)) {
        const cover = await extractAndSaveMp3Cover(localPath);
        if (cover) {
          m.coverUrl = cover;
          changed = true;
        }
      }
    }
  }
  for (const t of db.teams || []) {
    if (!Array.isArray(t.trophies)) {
      t.trophies = [];
      changed = true;
    }
    if (!Array.isArray(t.personalMusic)) {
      t.personalMusic = [];
      changed = true;
    }
    for (const pm of t.personalMusic) {
      if (!pm.coverUrl && pm.audioUrl && pm.audioUrl.toLowerCase().endsWith('.mp3')) {
        const localPath = resolveLocalAudioPath(pm.audioUrl);
        if (localPath && fs.existsSync(localPath)) {
          const cover = await extractAndSaveMp3Cover(localPath);
          if (cover) {
            pm.coverUrl = cover;
            changed = true;
          }
        }
      }
    }
  }

  // Backfill from champions history
  for (const c of db.champions || []) {
    const type: 'liga' | 'copa' | 'recopa' =
      c.tournamentType === 'copa' ? 'copa' : c.tournamentType === 'recopa' ? 'recopa' : 'liga';
    if (
      awardTeamTrophy(db, {
        teamId: c.teamId,
        teamName: c.teamName,
        memberName: c.memberName,
        type,
        season: c.season,
        sourceKey: `champ_${c.id}`,
      })
    ) {
      changed = true;
    }
  }

  // Backfill from Cup champion
  if (db.cup?.championTeamName) {
    const winnerParticipant = db.cup.participants.find((p) => p.slot === db.cup.championSlot);
    if (
      awardTeamTrophy(db, {
        teamId: winnerParticipant?.teamId,
        teamName: db.cup.championTeamName,
        memberName: db.cup.championMemberName,
        type: 'copa',
        season: db.cup.editionName || `Edición #${db.cup.editionNumber}`,
        sourceKey: `cup_${db.cup.editionNumber}`,
      })
    ) {
      changed = true;
    }
  }

  // Backfill from Recopa champion
  if (db.cup?.recopa?.played && db.cup.recopa.grandChampionName) {
    if (
      awardTeamTrophy(db, {
        teamName: db.cup.recopa.grandChampionName,
        memberName: db.cup.recopa.grandChampionMember,
        type: 'recopa',
        season: `Recopa · ${db.cup.editionName || `Edición #${db.cup.editionNumber}`}`,
        sourceKey: `recopa_${db.cup.editionNumber}`,
      })
    ) {
      changed = true;
    }
  }

  return changed;
}

/**
 * Automatically updates the Copa de la Liga bracket or Recopa Final when a member
 * submits (or Admin updates) a Copa or Recopa match result.
 */
function syncMatchToCupBracket(db: LeagueDatabase, match: Match): boolean {
  if (!db.cup) return false;
  const comp = match.competitionType;
  if (comp !== 'copa' && comp !== 'recopa') return false;

  const homeTeam = db.teams.find((t) => t.id === match.homeTeamId);
  const awayTeam = db.teams.find((t) => t.id === match.awayTeamId);
  if (!homeTeam || !awayTeam) return false;

  const norm = (s?: string) => (s || '').trim().toLowerCase();

  if (comp === 'copa') {
    const slotByTeam = (team: Team): number | null => {
      const p = db.cup.participants.find(
        (part) =>
          (part.teamId && part.teamId === team.id) ||
          norm(part.teamName) === norm(team.name) ||
          norm(part.memberName) === norm(team.memberName)
      );
      return p ? p.slot : null;
    };

    const homeTeamSlot = slotByTeam(homeTeam);
    const awayTeamSlot = slotByTeam(awayTeam);

    let node: CupMatchNode | undefined;
    if (match.cupMatchId) {
      node = db.cup.matches.find((m) => m.id === match.cupMatchId);
    }
    if (!node && homeTeamSlot !== null && awayTeamSlot !== null) {
      // Match an active bracket node containing both teams (prefer unplayed first, otherwise latest round)
      const candidates = db.cup.matches.filter(
        (m) =>
          (m.homeSlot === homeTeamSlot && m.awaySlot === awayTeamSlot) ||
          (m.homeSlot === awayTeamSlot && m.awaySlot === homeTeamSlot)
      );
      node = candidates.find((m) => !m.played) || candidates[candidates.length - 1];
    }

    if (!node) return false;

    const swapped =
      homeTeamSlot !== null &&
      awayTeamSlot !== null &&
      node.homeSlot === awayTeamSlot &&
      node.awaySlot === homeTeamSlot;

    const nodeHomeGoals = swapped ? match.awayGoals : match.homeGoals;
    const nodeAwayGoals = swapped ? match.homeGoals : match.awayGoals;
    const nodeHomePen = swapped ? (match.awayPenalties ?? null) : (match.homePenalties ?? null);
    const nodeAwayPen = swapped ? (match.homePenalties ?? null) : (match.awayPenalties ?? null);

    node.homeGoals = nodeHomeGoals;
    node.awayGoals = nodeAwayGoals;
    node.homePenalties = nodeHomePen;
    node.awayPenalties = nodeAwayPen;
    node.extraTime = Boolean(match.extraTime || (nodeHomePen !== null && nodeAwayPen !== null));

    if (nodeHomeGoals > nodeAwayGoals && node.homeSlot) {
      node.winnerSlot = node.homeSlot;
    } else if (nodeAwayGoals > nodeHomeGoals && node.awaySlot) {
      node.winnerSlot = node.awaySlot;
    } else if (nodeHomeGoals === nodeAwayGoals && nodeHomePen !== null && nodeAwayPen !== null) {
      if (nodeHomePen > nodeAwayPen && node.homeSlot) node.winnerSlot = node.homeSlot;
      else if (nodeAwayPen > nodeHomePen && node.awaySlot) node.winnerSlot = node.awaySlot;
    }
    node.played = true;

    propagateCupMatchWinner(db.cup, node);
    if (node.id === 'final' && db.cup.championTeamName) {
      const winnerParticipant = db.cup.participants.find((p) => p.slot === db.cup.championSlot);
      awardTeamTrophy(db, {
        teamId: winnerParticipant?.teamId,
        teamName: db.cup.championTeamName,
        memberName: db.cup.championMemberName,
        type: 'copa',
        season: db.cup.editionName || `Edición #${db.cup.editionNumber}`,
        sourceKey: `cup_${db.cup.editionNumber}`,
      });
    }
    db.cup.updatedAt = new Date().toISOString();
    match.cupMatchId = node.id;
    return true;
  }

  // Recopa Final auto-update
  const recopa = db.cup.recopa;
  if (!recopa) return false;

  const isHomeLeague =
    norm(homeTeam.name) === norm(recopa.leagueChampionName) ||
    norm(homeTeam.memberName) === norm(recopa.leagueChampionMember);
  const isAwayLeague =
    norm(awayTeam.name) === norm(recopa.leagueChampionName) ||
    norm(awayTeam.memberName) === norm(recopa.leagueChampionMember);

  const swapped = isAwayLeague && !isHomeLeague;

  const leagueTeam = swapped ? awayTeam : homeTeam;
  const cupTeam = swapped ? homeTeam : awayTeam;

  if (!recopa.leagueChampionName || recopa.leagueChampionName === 'Campeón de Liga') {
    recopa.leagueChampionName = leagueTeam.name;
    recopa.leagueChampionMember = leagueTeam.memberName;
    recopa.leagueChampionCrestUrl = leagueTeam.crestUrl;
  }
  if (!recopa.cupChampionName || recopa.cupChampionName === 'Campeón de Copa') {
    recopa.cupChampionName = cupTeam.name;
    recopa.cupChampionMember = cupTeam.memberName;
    recopa.cupChampionCrestUrl = cupTeam.crestUrl;
  }

  recopa.leagueGoals = swapped ? match.awayGoals : match.homeGoals;
  recopa.cupGoals = swapped ? match.homeGoals : match.awayGoals;
  recopa.leaguePenalties = swapped ? (match.awayPenalties ?? null) : (match.homePenalties ?? null);
  recopa.cupPenalties = swapped ? (match.homePenalties ?? null) : (match.awayPenalties ?? null);
  recopa.extraTime = Boolean(match.extraTime || (recopa.leaguePenalties !== null && recopa.cupPenalties !== null));

  let side: 'league' | 'cup' | null = null;
  if (recopa.leagueGoals > recopa.cupGoals) side = 'league';
  else if (recopa.cupGoals > recopa.leagueGoals) side = 'cup';
  else if (recopa.leaguePenalties !== null && recopa.cupPenalties !== null) {
    if (recopa.leaguePenalties > recopa.cupPenalties) side = 'league';
    else if (recopa.cupPenalties > recopa.leaguePenalties) side = 'cup';
  }

  recopa.grandChampionSide = side;
  if (side === 'league') {
    recopa.grandChampionName = recopa.leagueChampionName || leagueTeam.name;
    recopa.grandChampionMember = recopa.leagueChampionMember || leagueTeam.memberName;
    recopa.grandChampionCrestUrl = recopa.leagueChampionCrestUrl || leagueTeam.crestUrl;
    recopa.played = true;
  } else if (side === 'cup') {
    recopa.grandChampionName = recopa.cupChampionName || cupTeam.name;
    recopa.grandChampionMember = recopa.cupChampionMember || cupTeam.memberName;
    recopa.grandChampionCrestUrl = recopa.cupChampionCrestUrl || cupTeam.crestUrl;
    recopa.played = true;
  }

  if (recopa.played && recopa.grandChampionName) {
    awardTeamTrophy(db, {
      teamName: recopa.grandChampionName,
      memberName: recopa.grandChampionMember,
      type: 'recopa',
      season: `Recopa · ${db.cup.editionName || `Edición #${db.cup.editionNumber}`}`,
      sourceKey: `recopa_${db.cup.editionNumber}`,
    });
  }
  db.cup.updatedAt = new Date().toISOString();
  return true;
}

const sseClients = new Set<Response>();

function broadcastDbUpdate(): void {
  const payload = `event: db_updated\ndata: ${JSON.stringify({ updatedAt: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function saveDb(db: LeagueDatabase): Promise<void> {
  // Defense-in-depth: never persist plaintext passwords
  if (db.settings && 'adminClave' in db.settings) {
    delete db.settings.adminClave;
  }
  if (Array.isArray(db.teams)) {
    for (const t of db.teams) {
      if ('clave' in t) {
        delete t.clave;
      }
    }
  }
  dbMemoryCache = { db, fetchedAt: Date.now() };
  if (isSupabaseDbConfigured()) {
    await writeLeagueDbToSupabase(db);
  } else if (!IS_VERCEL) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } else {
    throw new Error(
      'Falta configurar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Vercel para guardar cambios de forma persistente.'
    );
  }
  broadcastDbUpdate();
}

function asyncRoute(
  fn: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function sanitizeTeam(team: Team) {
  return {
    id: team.id,
    name: team.name,
    memberName: team.memberName,
    crestUrl: team.crestUrl,
    bio: team.bio || '',
    likes: typeof team.likes === 'number' ? team.likes : 0,
    trophies: Array.isArray(team.trophies) ? team.trophies : [],
    personalMusic: Array.isArray(team.personalMusic) ? team.personalMusic : [],
    lastListenedTrack: team.lastListenedTrack,
    celebrationImageUrl: team.celebrationStatus === 'rejected' ? undefined : team.celebrationImageUrl,
    celebrationStatus: team.celebrationStatus,
    celebrationUploadedAt: team.celebrationUploadedAt,
    accountStatus: team.accountStatus === 'blocked' ? ('blocked' as const) : ('active' as const),
    createdAt: team.createdAt,
  };
}

function sanitizeAdminTeam(team: Team) {
  return {
    ...sanitizeTeam(team),
    hasPassword: Boolean(team.claveHash),
    credentialsUpdatedAt: team.credentialsUpdatedAt || team.createdAt,
  };
}

function sanitizeSettings(settings: LeagueSettings, includeAdminSecrets = false) {
  return {
    title: settings.title,
    subtitle: settings.subtitle,
    description: settings.description || '',
    calendarMessage: settings.calendarMessage || '',
    bannerText: settings.bannerText,
    crestUrl: settings.crestUrl,
    coverUrl: settings.coverUrl,
    backgroundUrl:
      settings.backgroundUrl ||
      '/assets/aistudio/WhatsApp_Image_2026-11-13_at_13.50.53_51d40a0e.jpeg',
    faviconUrl: settings.faviconUrl || settings.crestUrl,
    adminId: settings.adminId,
    adminTeamId: settings.adminTeamId || '',
    ...(includeAdminSecrets ? { backupGmail: settings.backupGmail || '' } : {}),
    featuredVideo: settings.featuredVideo || null,
    radioName: settings.radioName || 'FM 101.5 Pop Radio (Bs. As.)',
    radioStreamUrl:
      settings.radioStreamUrl || 'https://popradio.stweb.tv/popradio/live/playlist.m3u8',
    maxTeams: settings.maxTeams,
  };
}

function readFirebaseWebApiKey(): string {
  const envKey = (process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();
  if (envKey) return envKey;
  try {
    const cfgPath = path.join(ROOT_DIR, 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
      return String(parsed.apiKey || '').trim();
    }
  } catch {
    // ignore
  }
  return '';
}

const ADMIN_EMAILS_SET = new Set([
  'ligamasterargentina2030@gmail.com',
  'cristiandiazdevelez@gmail.com',
]);

async function verifyFirebaseIdTokenViaLookup(idToken: string): Promise<TokenPayload | null> {
  if (!idToken || idToken.split('.').length !== 3) return null;
  const apiKey = readFirebaseWebApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean; displayName?: string }>;
    };
    const u = data.users?.[0];
    if (!u || !u.localId || !u.email || !u.emailVerified) return null;
    const isAdmin = ADMIN_EMAILS_SET.has(u.email.trim().toLowerCase());
    return {
      role: isAdmin ? 'admin' : 'member',
      id: isAdmin ? 'ADMI' : u.localId,
      displayName: u.displayName || (isAdmin ? 'Administrador General' : u.email),
      exp: Date.now() + 60 * 60 * 1000,
    };
  } catch {
    return null;
  }
}

async function extractAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const parsed = verifyToken(token);
      if (parsed) {
        const db = await loadDb({ fresh: true });
        if (parsed.role === 'admin') {
          const currentAdminId = String(db.settings.adminId || 'ADMI').trim();
          const expectedVersion = db.settings.adminTokenVersion ?? 1;
          if (
            String(parsed.id || '').trim().toUpperCase() !== currentAdminId.toUpperCase() ||
            (parsed.tokenVersion ?? 1) !== expectedVersion
          ) {
            req.authUser = null;
            next();
            return;
          }
          const adminTeam = db.teams.find((t) => t.id === db.settings.adminTeamId);
          parsed.id = currentAdminId;
          parsed.teamId = adminTeam?.id;
          parsed.displayName = adminTeam
            ? `${adminTeam.memberName} (${adminTeam.name})`
            : 'Administrador General';
        } else if (parsed.role === 'member') {
          const memberTeam = db.teams.find((t) => t.id === (parsed.teamId || parsed.id));
          const currentAdminId = String(db.settings.adminId || 'ADMI').trim().toUpperCase();
          if (
            !memberTeam ||
            memberTeam.accountStatus === 'blocked' ||
            memberTeam.id.toUpperCase() === currentAdminId ||
            (parsed.tokenVersion ?? 1) !== (memberTeam.tokenVersion ?? 1)
          ) {
            req.authUser = null;
            next();
            return;
          }
          parsed.id = memberTeam.id;
          parsed.teamId = memberTeam.id;
          parsed.displayName = `${memberTeam.memberName} (${memberTeam.name})`;
        } else {
          req.authUser = null;
          next();
          return;
        }
        req.authUser = parsed;
      } else {
        req.authUser = await verifyFirebaseIdTokenViaLookup(token);
      }
    } else {
      req.authUser = null;
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Debés iniciar sesión con tu ID y contraseña válidos.' });
    return;
  }
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser || req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'Acceso exclusivo para el Administrador.' });
    return;
  }
  next();
}

function createMulter(subdir: (typeof UPLOAD_SUBDIRS)[number], maxSizeMb = 200) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      const targetDir = path.join(TEMP_UPLOADS_DIR, subdir);
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch {
        // ignore if already exists
      }
      cb(null, targetDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '';
      const safeExt = ext.replace(/[^a-z0-9.]/g, '');
      const unique = `${Date.now()}_${crypto.randomBytes(5).toString('hex')}${safeExt}`;
      cb(null, unique);
    },
  });
  return multer({
    storage,
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
  });
}

const uploadCrest = createMulter('crests', 10);
const uploadMatchProof = createMulter('matches', 15);
const uploadVideo = createMulter('videos', 250);
const uploadChampion = createMulter('champions', 15);
const uploadMusic = createMulter('music', 50);
const uploadSiteAsset = createMulter('site', 15);
const uploadClaims = createMulter('claims', 200);
const uploadNews = createMulter('news', 200);

function isValidImageFile(file: Express.Multer.File): boolean {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.ico']);
  return Boolean((file.mimetype && file.mimetype.startsWith('image/')) || allowedExts.has(ext));
}

function isValidMp4File(file: Express.Multer.File): boolean {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  return ext === '.mp4' || mime === 'video/mp4';
}

function inferImageMimeType(filePath: string, providedMime?: string): string {
  if (providedMime && providedMime.startsWith('image/')) return providedMime;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function moderateUploadedImage(
  filePath: string,
  mimeType: string,
  contextLabel: string
): Promise<{ allowed: boolean; reason?: string }> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return { allowed: true };
  }
  try {
    const fileBuffer = fs.readFileSync(filePath);
    if (fileBuffer.length > 8 * 1024 * 1024) {
      return { allowed: true };
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const resolvedMime = inferImageMimeType(filePath, mimeType);
    const prompt = `Sos el moderador estricto de contenido de "Liga Master Argentina PES6". Estás revisando una imagen subida para: ${contextLabel}.
Reglas estrictas de la comunidad:
1. RECHAZAR (allowed=false) terminantemente si la imagen contiene: desnudez parcial o total, pornografía, contenido sexual, muerte, cadáveres, gore, sangre real, violencia extrema, armas, drogas explícitas, odio o imágenes totalmente ofensivas/fuera de lugar.
2. PERMITIR (allowed=true) únicamente fotos de resultados/marcadores de partidos de fútbol (PES6 o fútbol real), capturas de pantalla de juego, goleadores/futbolistas, tarjetas amarillas/rojas, festejos de equipos o copas, o escudos deportivos.
Responde en JSON.`;

    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: resolvedMime,
                  data: fileBuffer.toString('base64'),
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              allowed: { type: Type.BOOLEAN },
              reason: { type: Type.STRING },
            },
            required: ['allowed', 'reason'],
          },
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('moderation_timeout')), 12000)),
    ]);

    const rawText = response.text || '';
    const parsed = JSON.parse(rawText) as { allowed?: boolean; reason?: string };
    if (parsed.allowed === false) {
      return {
        allowed: false,
        reason:
          parsed.reason ||
          'Imagen rechazada: solo se permiten fotos de resultados de partidos, tarjetas, goleadores o festejos deportivos.',
      };
    }
    return { allowed: true };
  } catch (err) {
    console.warn('Image moderation skipped due to transient error:', err instanceof Error ? err.message : err);
    return { allowed: true };
  }
}

async function normalizePng128(inputPath: string): Promise<string> {
  const parsed = path.parse(inputPath);
  const outName = `${parsed.name}_128x128.png`;
  const outPath = path.join(parsed.dir, outName);
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=128:128:force_original_aspect_ratio=decrease,pad=128:128:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
      outPath,
    ]);
    if (fs.existsSync(outPath)) {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore cleanup failure
      }
      return outName;
    }
  } catch {
    // fallback to original uploaded file
  }
  return path.basename(inputPath);
}

async function ensurePlayableMp4(inputPath: string, ext: string): Promise<string | null> {
  const parsed = path.parse(inputPath);
  const outName = `${parsed.name}_web.mp4`;
  const outPath = path.join(parsed.dir, outName);

  // If already MP4, inspect codec/pixel format with ffprobe
  if (ext === '.mp4') {
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=codec_name,pix_fmt',
          '-of',
          'json',
          inputPath,
        ],
        { maxBuffer: 5 * 1024 * 1024 }
      );
      const info = JSON.parse(stdout || '{}') as {
        streams?: Array<{ codec_name?: string; pix_fmt?: string }>;
      };
      const vStream = info.streams?.[0];
      if (vStream?.codec_name === 'h264' && vStream?.pix_fmt === 'yuv420p') {
        try {
          await execFileAsync(
            'ffmpeg',
            ['-y', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outPath],
            { maxBuffer: 25 * 1024 * 1024 }
          );
          if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
            return outName;
          }
        } catch {
          return null;
        }
      }
    } catch {
      // fall through to full transcode
    }
  }

  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outPath,
      ],
      { maxBuffer: 25 * 1024 * 1024 }
    );
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      return outName;
    }
  } catch (err) {
    console.error('ffmpeg video transcode error:', err);
  }
  return null;
}

function buildApiApp(): express.Express {
  const app = express();

  // Normalize /LMA-pes6-ai-studio/* prefixes and enable CORS for API calls
  app.use((req: Request, res: Response, next: NextFunction) => {
    for (const prefix of ['/LMA-pes6-ai-studio/api', '/LMA-pes6-ai-studio/uploads', '/LMA-pes6-ai-studio/default-assets']) {
      if (req.url === prefix || req.url.startsWith(`${prefix}/`) || req.url.startsWith(`${prefix}?`)) {
        req.url = req.url.slice('/LMA-pes6-ai-studio'.length);
        break;
      }
    }

    if (req.url === '/api' || req.url.startsWith('/api/') || req.url.startsWith('/api?')) {
      const origin = req.headers.origin;
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }

    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(extractAuth);

  // Serve uploaded files (with range requests), falling back to /tmp or Supabase Storage CDN
  const uploadsStatic = express.static(UPLOADS_DIR, { acceptRanges: true });
  const tempUploadsStatic = express.static(TEMP_UPLOADS_DIR, { acceptRanges: true });
  const uploadsSupabaseFallback = (req: Request, res: Response, next: NextFunction) => {
    if (isSupabaseDbConfigured()) {
      const cleanRel = req.path.replace(/^\/+/, '');
      if (cleanRel) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.redirect(302, getSupabasePublicObjectUrl(cleanRel));
        return;
      }
    }
    next();
  };
  const defaultAssetsStatic = express.static(path.join(ROOT_DIR, 'src', 'assets', 'images'));
  app.use('/uploads', uploadsStatic, tempUploadsStatic, uploadsSupabaseFallback);
  app.use('/default-assets', defaultAssetsStatic);

  // Unified authenticated media upload helper for Firestore-backed records
  const genericMediaUploaders: Record<(typeof UPLOAD_SUBDIRS)[number], multer.Multer> = {
    crests: uploadCrest,
    matches: uploadMatchProof,
    videos: uploadVideo,
    champions: uploadChampion,
    music: uploadMusic,
    site: uploadSiteAsset,
    claims: uploadClaims,
    news: uploadNews,
  };

  app.post('/api/upload/:subdir', requireAuth, (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const subdir = String(req.params.subdir || '') as (typeof UPLOAD_SUBDIRS)[number];
    const uploader = genericMediaUploaders[subdir];
    if (!uploader) {
      res.status(400).json({ error: 'Subcarpeta de subida no válida.' });
      return;
    }
    uploader.single('file')(req, res, (err) => {
      if (err) {
        next(err);
        return;
      }
      void (async () => {
        try {
          if (!req.file) {
            res.status(400).json({ error: 'No se recibió ningún archivo.' });
            return;
          }
          if (isValidImageFile(req.file) && (subdir === 'matches' || subdir === 'claims')) {
            const mod = await moderateUploadedImage(req.file.path, req.file.mimetype, `subida en ${subdir}`);
            if (!mod.allowed) {
              safeUnlink(req.file.path);
              res.status(400).json({ error: mod.reason || 'Imagen rechazada por moderación.' });
              return;
            }
          }
          let finalFilename = req.file.filename;
          if (subdir === 'crests' && isValidImageFile(req.file)) {
            finalFilename = await normalizePng128(req.file.path);
          } else if (subdir === 'videos' || (req.file.mimetype || '').startsWith('video/')) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (ext === '.mp4' || ext === '.avi' || (req.file.mimetype || '').startsWith('video/')) {
              const converted = await ensurePlayableMp4(req.file.path, ext || '.mp4');
              if (converted) {
                safeUnlink(req.file.path);
                finalFilename = converted;
              }
            }
          }
          const finalPath = path.join(TEMP_UPLOADS_DIR, subdir, finalFilename);
          const url = await persistUploadedFile(finalPath, subdir, finalFilename, req.file.mimetype);
          res.status(201).json({ url, filename: finalFilename });
        } catch (uploadErr) {
          next(uploadErr);
        }
      })();
    });
  });

  // Dynamic SVG club crests for seeded teams (128x128 viewBox)
  app.get(
    '/api/crest/:teamId.svg',
    asyncRoute(async (req: Request, res: Response) => {
      const teamId = String(req.params.teamId || '').replace(/\.svg$/i, '');
      const db = await loadDb();
      const team = db.teams.find((t) => t.id === teamId);
      const primary = team?.primaryColor || '#0284C7';
      const secondary = team?.secondaryColor || '#FFFFFF';
      const initials =
        (team?.name || teamId)
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() || '')
          .join('') || 'LMA';

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <clipPath id="shield">
      <path d="M18 14 H110 V64 C110 92 64 116 64 116 C64 116 18 92 18 64 Z"/>
    </clipPath>
  </defs>
  <path d="M14 10 H114 V64 C114 96 64 122 64 122 C64 122 14 96 14 64 Z" fill="#0F172A" stroke="#CBD5E1" stroke-width="3"/>
  <g clip-path="url(#shield)">
    <rect x="18" y="14" width="92" height="104" fill="${primary}"/>
    <rect x="49" y="14" width="30" height="104" fill="${secondary}"/>
  </g>
  <rect x="26" y="43" width="76" height="36" rx="6" fill="#0F172A" fill-opacity="0.88" stroke="#38BDF8" stroke-width="2"/>
  <text x="64" y="68" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-weight="800" font-size="22">${initials}</text>
</svg>`;
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
    })
  );

  // Real-time Server-Sent Events stream (short serverless response on Vercel to prevent timeouts)
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (IS_VERCEL) {
      res.write(`retry: 20000\nevent: connected\ndata: ${JSON.stringify({ ok: true, serverless: true })}\n\n`);
      res.end();
      return;
    }
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Bootstrap endpoint
  app.get(
    '/api/bootstrap',
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const db = await loadDb();
    const isAdmin = req.authUser?.role === 'admin';
    const userTeamId = req.authUser?.teamId;

    const visibleMatches = isAdmin
      ? db.matches
      : db.matches.filter(
          (m) =>
            m.status === 'validated' ||
            (userTeamId &&
              (m.submittedByTeamId === userTeamId ||
                m.homeTeamId === userTeamId ||
                m.awayTeamId === userTeamId))
        );

    const safeMatches = visibleMatches.map((m) => ({
      ...m,
      proofImageUrl: m.proofImageStatus === 'rejected' && !isAdmin ? undefined : m.proofImageUrl,
      scorerImageUrl: m.scorerImageStatus === 'rejected' && !isAdmin ? undefined : m.scorerImageUrl,
    }));

    const safeClaims = (db.claims || []).map((c) => ({
      ...c,
      cardPhotoUrl: c.cardPhotoStatus === 'rejected' && !isAdmin ? undefined : c.cardPhotoUrl,
    }));

    const allComments = Array.isArray(db.comments) ? db.comments : [];
    const visibleComments = isAdmin
      ? allComments
      : allComments.filter((c) => c.status === 'approved');

    res.json({
      settings: sanitizeSettings(db.settings, isAdmin),
      teams: db.teams.map(sanitizeTeam),
      adminTeams: isAdmin ? db.teams.map(sanitizeAdminTeam) : undefined,
      credentialAuditLog: isAdmin ? (db.credentialAuditLog || []) : undefined,
      matches: safeMatches,
      fixtures: db.fixtures || [],
      calendarEvents: db.calendarEvents || [],
      claims: safeClaims,
      videos: db.videos,
      topGoals: Array.isArray(db.topGoals) ? db.topGoals : [],
      champions: db.champions,
      rules: db.rules,
      music: db.music,
      cup: db.cup,
      news: Array.isArray(db.news) ? db.news : [],
      comments: visibleComments,
      pageLikes: typeof db.pageLikes === 'number' ? db.pageLikes : 0,
      user: req.authUser || null,
    });
  })
  );

  function getFirebaseAppletApiKey(): string {
    const envKey = (process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();
    if (envKey) return envKey;
    try {
      const cfgPath = path.join(ROOT_DIR, 'firebase-applet-config.json');
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { apiKey?: string };
        return String(parsed.apiKey || '').trim();
      }
    } catch {
      // ignore
    }
    return '';
  }

  async function verifyFirebaseEmailPassword(email: string, password: string): Promise<boolean> {
    const apiKey = getFirebaseAppletApiKey();
    if (!apiKey || !email || !password) return false;
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: false }),
        }
      );
      if (!res.ok) return false;
      const data = (await res.json()) as { email?: string };
      return String(data.email || '').trim().toLowerCase() === email.trim().toLowerCase();
    } catch {
      return false;
    }
  }

  const loginRateLimiter = new Map<string, { count: number; resetAt: number }>();

  function checkLoginRateLimit(req: Request, maxAttempts = 25): boolean {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();
    const record = loginRateLimiter.get(ip);
    if (!record || record.resetAt < now) {
      loginRateLimiter.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
      return true;
    }
    if (record.count >= maxAttempts) {
      return false;
    }
    record.count += 1;
    return true;
  }

  // Auth login (Admin or Member by ID + Password verified against scrypt hashes)
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      if (!checkLoginRateLimit(req, 25)) {
        res.status(429).json({
          error: 'Demasiados intentos de ingreso. Esperá unos minutos antes de reintentar.',
        });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const id = String((body as { id?: unknown }).id || '').trim();
      const clave = String((body as { clave?: unknown }).clave || '').trim();

      if (!id || !clave) {
        res.status(400).json({ error: 'Ingresá tu ID de usuario y contraseña.' });
        return;
      }

      const db = await loadDb({ fresh: true });
      const teams = Array.isArray(db.teams) ? db.teams : [];
      const configuredAdminId = String(db.settings?.adminId || 'ADMI').trim();

      if (id.toUpperCase() === configuredAdminId.toUpperCase()) {
        let authorized = verifyPassword(clave, db.settings?.adminClaveHash);
        if (!authorized && db.settings?.backupGmail) {
          const firebaseVerified = await verifyFirebaseEmailPassword(
            db.settings.backupGmail,
            clave
          );
          if (firebaseVerified) {
            db.settings.adminClaveHash = hashPassword(clave);
            db.settings.adminTokenVersion = (db.settings.adminTokenVersion ?? 1) + 1;
            appendCredentialAudit(db, {
              action: 'admin_firebase_password_reset',
              targetType: 'admin',
              targetId: configuredAdminId,
              targetLabel: 'Administrador General',
              details: 'Contraseña de Administrador sincronizada desde Firebase Authentication.',
              performedBy: configuredAdminId,
            });
            try {
              await saveDb(db);
            } catch (saveErr) {
              console.error('Warning saving synced adminClaveHash:', saveErr);
            }
            authorized = true;
          }
        }

        if (!authorized) {
          res.status(401).json({
            error: 'ID de usuario o contraseña incorrectos.',
          });
          return;
        }

        const adminTeam = teams.find((t) => t.id === db.settings?.adminTeamId);
        const payload: TokenPayload = {
          role: 'admin',
          id: configuredAdminId,
          displayName: adminTeam
            ? `${adminTeam.memberName} (${adminTeam.name})`
            : 'Administrador General',
          teamId: adminTeam?.id,
          tokenVersion: db.settings?.adminTokenVersion ?? 1,
          exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
        };
        res.json({
          token: signToken(payload),
          user: {
            role: payload.role,
            id: payload.id,
            displayName: payload.displayName,
            teamId: payload.teamId,
          },
        });
        return;
      }

      const team = teams.find(
        (t) => String(t?.id || '').trim().toUpperCase() === id.toUpperCase()
      );
      if (!team || !verifyPassword(clave, team.claveHash)) {
        res.status(401).json({
          error: 'ID de usuario o contraseña incorrectos. Solicitá tus credenciales al Administrador.',
        });
        return;
      }

      if (team.accountStatus === 'blocked') {
        res.status(403).json({
          error: 'Tu cuenta fue bloqueada por el Administrador. Contactate con la administración para reactivarla.',
        });
        return;
      }

      const payload: TokenPayload = {
        role: 'member',
        id: team.id,
        displayName: `${team.memberName} (${team.name})`,
        teamId: team.id,
        tokenVersion: team.tokenVersion ?? 1,
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
      };
      res.json({
        token: signToken(payload),
        user: {
          role: payload.role,
          id: payload.id,
          displayName: payload.displayName,
          teamId: payload.teamId,
        },
      });
    } catch (err) {
      console.error('Error in /api/auth/login:', err);
      const detail = err instanceof Error ? err.message : 'Error interno del servidor.';
      res.status(500).json({
        error: `No se pudo procesar el inicio de sesión en el servidor (${detail}).`,
      });
    }
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  const resetRateLimiter = new Map<string, { count: number; resetAt: number }>();

  function checkResetRateLimit(req: Request, maxAttempts = 12): boolean {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();
    const record = resetRateLimiter.get(ip);
    if (!record || record.resetAt < now) {
      resetRateLimiter.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
      return true;
    }
    if (record.count >= maxAttempts) {
      return false;
    }
    record.count += 1;
    return true;
  }

  // Validates privately (without exposing the stored email) whether an email is the Admin's configured recovery email
  app.post(
    '/api/auth/verify-admin-recovery-email',
    asyncRoute(async (req: Request, res: Response) => {
      if (!checkResetRateLimit(req, 10)) {
        res.status(429).json({
          error: 'Demasiados intentos de recuperación. Esperá unos minutos antes de reintentar.',
        });
        return;
      }

      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        res.status(400).json({ error: 'Ingresá un correo electrónico válido.' });
        return;
      }

      const db = await loadDb({ fresh: true });
      const configuredEmail = (db.settings.backupGmail || 'cristiandiazdevelez@gmail.com')
        .trim()
        .toLowerCase();

      if (email !== configuredEmail) {
        res.status(403).json({
          error: 'El correo ingresado no coincide con el email de recuperación autorizado del Administrador.',
        });
        return;
      }

      res.json({ authorized: true });
    })
  );

  // Syncs the Admin's new Firebase Authentication password with the league Admin account
  // after verifying the Firebase ID Token via Identity Toolkit accounts:lookup.
  app.post(
    '/api/auth/sync-firebase-admin-password',
    asyncRoute(async (req: Request, res: Response) => {
      if (!checkResetRateLimit(req, 15)) {
        res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });
        return;
      }

      const authHeader = req.headers.authorization;
      const idToken =
        authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

      const newClave = String(req.body?.newClave || '').trim();
      if (!idToken) {
        res.status(401).json({ error: 'Falta el token de verificación de Firebase Authentication.' });
        return;
      }
      if (newClave.length < 4) {
        res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
        return;
      }

      const apiKey = getFirebaseAppletApiKey();
      if (!apiKey) {
        res.status(500).json({ error: 'Configuración de Firebase Authentication no encontrada.' });
        return;
      }

      try {
        const lookupRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
          }
        );

        if (!lookupRes.ok) {
          res.status(401).json({ error: 'El token de Firebase es inválido o venció.' });
          return;
        }

        const lookupData = (await lookupRes.json()) as {
          users?: { email?: string; emailVerified?: boolean }[];
        };
        const fbUser = lookupData.users?.[0];
        const verifiedEmail = String(fbUser?.email || '').trim().toLowerCase();

        const db = await loadDb({ fresh: true });
        const configuredEmail = (db.settings.backupGmail || 'cristiandiazdevelez@gmail.com')
          .trim()
          .toLowerCase();

        if (!verifiedEmail || verifiedEmail !== configuredEmail) {
          res.status(403).json({
            error: 'La cuenta verificada de Firebase no coincide con el Administrador autorizado.',
          });
          return;
        }

        db.settings.adminClaveHash = hashPassword(newClave);
        db.settings.adminTokenVersion = (db.settings.adminTokenVersion ?? 1) + 1;
        appendCredentialAudit(db, {
          action: 'admin_firebase_password_reset',
          targetType: 'admin',
          targetId: db.settings.adminId,
          targetLabel: 'Administrador General',
          details: 'Contraseña de Administrador restablecida mediante correo de recuperación oficial.',
          performedBy: db.settings.adminId,
        });
        await saveDb(db);

        res.json({
          ok: true,
          adminId: db.settings.adminId,
          message:
            '¡OK! Todo listo. Tu nueva contraseña de Administrador fue guardada de forma segura y ya podés ingresar con tu ID y nueva contraseña.',
        });
      } catch (err) {
        console.error('Error syncing Firebase admin password:', err);
        res.status(500).json({ error: 'Error inesperado al sincronizar la nueva contraseña.' });
      }
    })
  );

  // Member updates own bio (cannot modify ID or password)
  app.patch(
    '/api/profile',
    requireAuth,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const teamId = req.authUser?.teamId;
      if (!teamId) {
        res.status(400).json({ error: 'El perfil de equipo solo aplica a miembros.' });
        return;
      }
      const team = db.teams.find((t) => t.id === teamId);
      if (!team) {
        res.status(404).json({ error: 'Equipo no encontrado.' });
        return;
      }
      if (typeof req.body?.bio === 'string') {
        team.bio = req.body.bio.slice(0, 240);
      }
      await saveDb(db);
      res.json({ team: sanitizeTeam(team) });
    })
  );

  // Member or Admin uploads a celebration photo to their own profile (subject to moderation + Admin check)
  app.post(
    '/api/profile/celebration',
    requireAuth,
    uploadChampion.single('celebrationImage'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const teamId = req.authUser?.teamId;
      if (!teamId) {
        safeUnlink(req.file?.path);
        res.status(400).json({ error: 'Necesitás tener un equipo asignado para subir tu foto de festejo.' });
        return;
      }
      const team = db.teams.find((t) => t.id === teamId);
      if (!team) {
        safeUnlink(req.file?.path);
        res.status(404).json({ error: 'Equipo no encontrado.' });
        return;
      }
      if (!req.file || !isValidImageFile(req.file)) {
        safeUnlink(req.file?.path);
        res.status(400).json({ error: 'Subí una imagen válida (PNG, JPG, WEBP) de festejo deportivo.' });
        return;
      }

      const mod = await moderateUploadedImage(
        req.file.path,
        req.file.mimetype,
        'foto de festejo de un equipo de fútbol en su perfil'
      );
      if (!mod.allowed) {
        safeUnlink(req.file.path);
        res.status(400).json({ error: mod.reason || 'Imagen rechazada por el filtro de contenido.' });
        return;
      }

      const isAdmin = req.authUser?.role === 'admin';
      team.celebrationImageUrl = await persistUploadedFile(
        req.file.path,
        'champions',
        req.file.filename,
        req.file.mimetype
      );
      team.celebrationStatus = isAdmin ? 'approved' : 'pending';
      team.celebrationUploadedAt = new Date().toISOString();
      await saveDb(db);
      res.json({ team: sanitizeTeam(team) });
    })
  );

  app.delete(
    '/api/profile/celebration',
    requireAuth,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const targetTeamId =
        req.authUser?.role === 'admin' && typeof req.query.teamId === 'string'
          ? req.query.teamId.trim()
          : req.authUser?.teamId;
      if (!targetTeamId) {
        res.status(400).json({ error: 'Equipo no especificado.' });
        return;
      }
      const team = db.teams.find((t) => t.id === targetTeamId);
      if (!team) {
        res.status(404).json({ error: 'Equipo no encontrado.' });
        return;
      }
      team.celebrationImageUrl = undefined;
      team.celebrationStatus = undefined;
      team.celebrationUploadedAt = undefined;
      await saveDb(db);
      res.json({ team: sanitizeTeam(team) });
    })
  );

  // Member edits or deletes the message beneath one of their own won trophies
  app.patch(
    '/api/profile/trophies/:trophyId',
    requireAuth,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const teamId = req.authUser?.teamId || (req.authUser?.role === 'admin' ? db.settings.adminTeamId : undefined);
      if (!teamId) {
        res.status(400).json({ error: 'Necesitás tener un equipo asignado para editar mensajes de trofeos.' });
        return;
      }
      const team = db.teams.find((t) => t.id === teamId);
      if (!team) {
        res.status(404).json({ error: 'Equipo no encontrado.' });
        return;
      }
      const trophy = (team.trophies || []).find((tr) => tr.id === req.params.trophyId);
      if (!trophy) {
        res.status(404).json({ error: 'Trofeo no encontrado en tu perfil.' });
        return;
      }
      trophy.message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 280) : '';
      await saveDb(db);
      res.json({ trophy, team: sanitizeTeam(team) });
    })
  );

  app.delete(
    '/api/profile/trophies/:trophyId/message',
    requireAuth,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const teamId = req.authUser?.teamId || (req.authUser?.role === 'admin' ? db.settings.adminTeamId : undefined);
      if (!teamId) {
        res.status(400).json({ error: 'Equipo no encontrado.' });
        return;
      }
      const team = db.teams.find((t) => t.id === teamId);
      if (!team) {
        res.status(404).json({ error: 'Equipo no encontrado.' });
        return;
      }
      const trophy = (team.trophies || []).find((tr) => tr.id === req.params.trophyId);
      if (!trophy) {
        res.status(404).json({ error: 'Trofeo no encontrado en tu perfil.' });
        return;
      }
      trophy.message = '';
      await saveDb(db);
      res.json({ trophy, team: sanitizeTeam(team) });
    })
  );

  // Member uploads personal MP3 tracks for their OWN independent player
  app.post(
    '/api/profile/music',
    requireAuth,
    uploadMusic.array('audio', 20),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      const cleanupMusic = () => files.forEach((f) => safeUnlink(f.path));

      const teamId = req.authUser?.teamId || (req.authUser?.role === 'admin' ? db.settings.adminTeamId : undefined);
      if (!teamId) {
        cleanupMusic();
        res.status(400).json({ error: 'Necesitás tener un equipo asignado para guardar música personal.' });
        return;
      }
      const team = db.teams.find((t) => t.id === teamId);
      if (!team) {
        cleanupMusic();
        res.status(404).json({ error: 'Equipo no encontrado.' });
        return;
      }
      if (files.length === 0) {
        res.status(400).json({ error: 'Seleccioná uno o más archivos MP3.' });
        return;
      }
      if (!Array.isArray(team.personalMusic)) team.personalMusic = [];

      const customTitle = String(req.body?.title || '').trim();
      const customArtist = String(req.body?.artist || '').trim();
      const added: MusicTrack[] = [];

      for (const file of files) {
        const rawName = path.parse(file.originalname).name.replace(/[_-]+/g, ' ').trim();
        const coverUrl = await extractAndSaveMp3Cover(file.path);
        const audioUrl = await persistUploadedFile(file.path, 'music', file.filename, file.mimetype);
        const track: MusicTrack = {
          id: `pm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          title: customTitle && files.length === 1 ? customTitle : rawName || 'Mi Canción MP3',
          artist: customArtist || team.memberName || 'Mi Reproductor',
          audioUrl,
          ...(coverUrl ? { coverUrl } : {}),
          createdAt: new Date().toISOString(),
        };
        team.personalMusic.push(track);
        added.push(track);
      }

      await saveDb(db);
      res.status(201).json({ tracks: added, personalMusic: team.personalMusic });
    })
  );

  // Member updates their last listened song (persisted on profile for all visitors)
  app.post(
    '/api/profile/last-song',
    requireAuth,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const teamId = req.authUser?.teamId || (req.authUser?.role === 'admin' ? db.settings.adminTeamId : undefined);
      if (!teamId) {
        res.status(400).json({ error: 'Equipo no encontrado.' });
        return;
      }
      const team = db.teams.find((t) => t.id === teamId);
      if (!team) {
        res.status(404).json({ error: 'Equipo no encontrado.' });
        return;
      }
      const title = String(req.body?.title || '').trim().slice(0, 140);
      const artist = String(req.body?.artist || '').trim().slice(0, 120);
      const rawCover = typeof req.body?.coverUrl === 'string' ? req.body.coverUrl.trim() : '';
      const audioUrl = typeof req.body?.audioUrl === 'string' ? req.body.audioUrl.trim().slice(0, 400) : '';
      if (!title) {
        res.status(400).json({ error: 'Falta el título de la canción.' });
        return;
      }
      // Allow local /uploads URLs, http(s) URLs, or bounded data:image base64 URLs
      const coverUrl =
        rawCover && (rawCover.startsWith('/uploads/') || rawCover.startsWith('http') || (rawCover.startsWith('data:image/') && rawCover.length < 180000))
          ? rawCover
          : undefined;

      team.lastListenedTrack = {
        title,
        artist: artist || 'Liga Master Argentina',
        ...(coverUrl ? { coverUrl } : {}),
        ...(audioUrl && !audioUrl.startsWith('blob:') ? { audioUrl } : {}),
        listenedAt: new Date().toISOString(),
      };
      await saveDb(db);
      res.json({ lastListenedTrack: team.lastListenedTrack });
    })
  );

  app.delete(
    '/api/profile/music/:trackId',
    requireAuth,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const teamId = req.authUser?.teamId || (req.authUser?.role === 'admin' ? db.settings.adminTeamId : undefined);
      if (!teamId) {
        res.status(400).json({ error: 'Equipo no encontrado.' });
        return;
      }
      const team = db.teams.find((t) => t.id === teamId);
      if (!team) {
        res.status(404).json({ error: 'Equipo no encontrado.' });
        return;
      }
      if (!Array.isArray(team.personalMusic)) team.personalMusic = [];
      const before = team.personalMusic.length;
      team.personalMusic = team.personalMusic.filter((t) => t.id !== req.params.trackId);
      if (team.personalMusic.length === before) {
        res.status(404).json({ error: 'Canción personal no encontrada.' });
        return;
      }
      await saveDb(db);
      res.json({ deleted: true, personalMusic: team.personalMusic });
    })
  );

  // Admin: crown League Champion (#1 or chosen team) and automatically award the Liga Argentina trophy
  app.post(
    '/api/admin/award-league-champion',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const requestedTeamId = typeof req.body?.teamId === 'string' ? req.body.teamId.trim() : '';
      const ranked = getRankedStandingsTeams(db.teams, db.matches);
      const targetTeam = requestedTeamId
        ? db.teams.find((t) => t.id === requestedTeamId)
        : ranked[0];

      if (!targetTeam) {
        res.status(400).json({ error: 'No hay equipos registrados para coronar como Campeón de Liga.' });
        return;
      }

      const season =
        (typeof req.body?.season === 'string' && req.body.season.trim()) ||
        db.settings.subtitle ||
        'TEMPORADA 2026-2027';

      const champEntry: ChampionEntry = {
        id: `champ_liga_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        season,
        teamId: targetTeam.id,
        teamName: targetTeam.name,
        memberName: targetTeam.memberName,
        tournamentType: 'liga',
        notes: 'Campeón Oficial de la Liga Master Argentina.',
        celebrationImageUrl: LIGA_TROPHY_IMG,
        createdAt: new Date().toISOString(),
      };
      db.champions.unshift(champEntry);

      awardTeamTrophy(db, {
        teamId: targetTeam.id,
        teamName: targetTeam.name,
        memberName: targetTeam.memberName,
        type: 'liga',
        title: 'Campeón Liga Argentina',
        season,
        sourceKey: `champ_${champEntry.id}`,
      });

      // Also update Recopa League Champion slot automatically
      if (db.cup?.recopa) {
        db.cup.recopa.leagueChampionName = targetTeam.name;
        db.cup.recopa.leagueChampionMember = targetTeam.memberName;
        db.cup.recopa.leagueChampionCrestUrl = targetTeam.crestUrl;
      }

      await saveDb(db);
      res.status(201).json({ champion: champEntry, team: sanitizeTeam(targetTeam) });
    })
  );

  // Admin: create or update their own participating team (escudo, equipo, nombre, bio)
  app.put(
    '/api/admin/my-team',
    requireAdmin,
    uploadCrest.single('crest'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const name = String(req.body?.name || '').trim();
      const memberName = String(req.body?.memberName || '').trim();
      const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim().slice(0, 240) : undefined;

      if (!name || !memberName) {
        safeUnlink(req.file?.path);
        res.status(400).json({ error: 'Completá el nombre de tu equipo y tu nombre.' });
        return;
      }

      if (req.file && !isValidImageFile(req.file)) {
        safeUnlink(req.file.path);
        res.status(400).json({ error: 'El escudo debe ser una imagen válida (PNG, JPG, WEBP, etc.).' });
        return;
      }

      let team = db.teams.find((t) => t.id === db.settings.adminTeamId);

      if (!team) {
        const effectiveMax = Math.max(Number(db.settings.maxTeams) || 100, 100);
        if (db.teams.length >= effectiveMax) {
          safeUnlink(req.file?.path);
          res.status(400).json({
            error: `Se alcanzó el límite máximo de ${effectiveMax} equipos en la liga.`,
          });
          return;
        }

        const existingIds = new Set(db.teams.map((t) => t.id.toUpperCase()));
        let candidate = 'ADM01';
        let idx = 2;
        while (existingIds.has(candidate)) {
          candidate = `ADM${String(idx).padStart(2, '0')}`;
          idx += 1;
        }

        let crestUrl = `/api/crest/${encodeURIComponent(candidate)}.svg`;
        if (req.file) {
          const finalName = await normalizePng128(req.file.path);
          const finalPath = path.join(path.dirname(req.file.path), finalName);
          crestUrl = await persistUploadedFile(
            finalPath,
            'crests',
            finalName,
            finalName.endsWith('.png') ? 'image/png' : req.file.mimetype
          );
        }

        team = {
          id: candidate,
          claveHash: db.settings.adminClaveHash || hashPassword('admin2026'),
          accountStatus: 'active',
          tokenVersion: 1,
          credentialsUpdatedAt: new Date().toISOString(),
          name,
          memberName,
          crestUrl,
          bio: bio || 'Equipo oficial del Administrador participando en la liga.',
          primaryColor: '#0EA5E9',
          secondaryColor: '#16A34A',
          createdAt: new Date().toISOString(),
        };
        db.teams.unshift(team);
        db.settings.adminTeamId = team.id;
      } else {
        team.name = name;
        team.memberName = memberName;
        if (bio !== undefined) {
          team.bio = bio;
        }
        if (req.file) {
          const finalName = await normalizePng128(req.file.path);
          const finalPath = path.join(path.dirname(req.file.path), finalName);
          team.crestUrl = await persistUploadedFile(
            finalPath,
            'crests',
            finalName,
            finalName.endsWith('.png') ? 'image/png' : req.file.mimetype
          );
        }
      }

      await saveDb(db);
      res.json({ team: sanitizeTeam(team), adminTeamId: db.settings.adminTeamId });
    })
  );

  // Admin: update site branding/settings (Admin credentials are updated strictly via PUT /api/admin/credentials)
  app.put(
    '/api/admin/settings',
    requireAdmin,
    uploadSiteAsset.fields([
      { name: 'crestFile', maxCount: 1 },
      { name: 'coverFile', maxCount: 1 },
      { name: 'faviconFile', maxCount: 1 },
      { name: 'backgroundFile', maxCount: 1 },
    ]),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const { title, subtitle, description, calendarMessage, bannerText, adminTeamId, radioName, radioStreamUrl } = req.body as Record<string, string>;

      if (title?.trim()) db.settings.title = title.trim();
      if (typeof subtitle === 'string') db.settings.subtitle = subtitle.trim();
      if (typeof description === 'string') db.settings.description = description.trim();
      if (typeof calendarMessage === 'string') db.settings.calendarMessage = calendarMessage.trim().slice(0, 600);
      if (typeof bannerText === 'string') db.settings.bannerText = bannerText.trim();
      if (typeof radioName === 'string' && radioName.trim()) {
        db.settings.radioName = radioName.trim();
      }
      if (typeof radioStreamUrl === 'string' && radioStreamUrl.trim()) {
        db.settings.radioStreamUrl = radioStreamUrl.trim();
      }
      if (typeof adminTeamId === 'string') {
        const cleaned = adminTeamId.trim();
        db.settings.adminTeamId = cleaned && db.teams.some((t) => t.id === cleaned) ? cleaned : undefined;
      }

      if (files?.crestFile?.[0]) {
        const f = files.crestFile[0];
        db.settings.crestUrl = await persistUploadedFile(f.path, 'site', f.filename, f.mimetype);
      }
      if (files?.coverFile?.[0]) {
        const f = files.coverFile[0];
        db.settings.coverUrl = await persistUploadedFile(f.path, 'site', f.filename, f.mimetype);
      }
      if (files?.faviconFile?.[0]) {
        const f = files.faviconFile[0];
        db.settings.faviconUrl = await persistUploadedFile(f.path, 'site', f.filename, f.mimetype);
      }
      if (files?.backgroundFile?.[0]) {
        const f = files.backgroundFile[0];
        db.settings.backgroundUrl = await persistUploadedFile(f.path, 'site', f.filename, f.mimetype);
      }

      await saveDb(db);
      res.json({ settings: sanitizeSettings(db.settings, true) });
    })
  );

  // Admin: dedicated verified credentials management (requires currentPassword, prevents losing Admin access)
  app.put(
    '/api/admin/credentials',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const currentPassword = String(req.body?.currentPassword || '').trim();
      const rawNextAdminId = String(req.body?.nextAdminId ?? db.settings.adminId).trim().toUpperCase();
      const nextPassword = String(req.body?.nextPassword || '').trim();
      const confirmPassword = String(req.body?.confirmPassword || '').trim();
      const nextBackupGmail = String(req.body?.nextBackupGmail ?? db.settings.backupGmail ?? '')
        .trim()
        .toLowerCase();

      if (!currentPassword) {
        res.status(400).json({
          error: 'Por seguridad, ingresá tu contraseña actual de Administrador para confirmar los cambios.',
        });
        return;
      }

      if (!verifyPassword(currentPassword, db.settings.adminClaveHash)) {
        res.status(401).json({
          error: 'Verificación fallida: la contraseña actual del Administrador no es correcta.',
        });
        return;
      }

      if (!/^[A-Z0-9_-]{3,20}$/.test(rawNextAdminId)) {
        res.status(400).json({
          error: 'El ID del Administrador debe tener entre 3 y 20 caracteres alfanuméricos (letras, números, - o _).',
        });
        return;
      }

      if (db.teams.some((t) => t.id.toUpperCase() === rawNextAdminId)) {
        res.status(409).json({
          error: `El ID "${rawNextAdminId}" pertenece a un participante. Elegí un ID exclusivo para el Administrador para evitar conflictos de acceso.`,
        });
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextBackupGmail)) {
        res.status(400).json({
          error: 'Ingresá un correo electrónico de recuperación válido. Es obligatorio mantener un correo de respaldo activo.',
        });
        return;
      }

      if (nextPassword) {
        if (nextPassword.length < 6 || nextPassword.length > 64) {
          res.status(400).json({
            error: 'La nueva contraseña del Administrador debe tener entre 6 y 64 caracteres.',
          });
          return;
        }
        if (nextPassword !== confirmPassword) {
          res.status(400).json({
            error: 'La nueva contraseña y su confirmación no coinciden.',
          });
          return;
        }
        if (nextPassword.toUpperCase() === rawNextAdminId) {
          res.status(400).json({
            error: 'Por seguridad, la contraseña no puede ser igual a tu ID de Administrador.',
          });
          return;
        }
      }

      const changedParts: string[] = [];
      const oldAdminId = db.settings.adminId;
      if (rawNextAdminId !== oldAdminId.toUpperCase()) {
        db.settings.adminId = rawNextAdminId;
        changedParts.push(`ID (${oldAdminId} → ${rawNextAdminId})`);
      } else {
        db.settings.adminId = rawNextAdminId;
      }

      if (nextBackupGmail !== String(db.settings.backupGmail || '').trim().toLowerCase()) {
        db.settings.backupGmail = nextBackupGmail;
        changedParts.push('correo de recuperación');
      }

      if (nextPassword) {
        db.settings.adminClaveHash = hashPassword(nextPassword);
        changedParts.push('contraseña administrativa');
      }

      if (changedParts.length === 0) {
        res.status(400).json({
          error: 'No se detectaron cambios en las credenciales del Administrador.',
        });
        return;
      }

      db.settings.adminTokenVersion = (db.settings.adminTokenVersion ?? 1) + 1;
      appendCredentialAudit(db, {
        action: 'update_admin_credentials',
        targetType: 'admin',
        targetId: db.settings.adminId,
        targetLabel: 'Administrador General',
        details: `Actualización verificada de: ${changedParts.join(', ')}.`,
        performedBy: oldAdminId,
      });

      await saveDb(db);

      const adminTeam = db.teams.find((t) => t.id === db.settings.adminTeamId);
      const nextPayload: TokenPayload = {
        role: 'admin',
        id: db.settings.adminId,
        displayName: adminTeam
          ? `${adminTeam.memberName} (${adminTeam.name})`
          : 'Administrador General',
        teamId: adminTeam?.id,
        tokenVersion: db.settings.adminTokenVersion,
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
      };

      res.json({
        token: signToken(nextPayload),
        user: {
          role: nextPayload.role,
          id: nextPayload.id,
          displayName: nextPayload.displayName,
          teamId: nextPayload.teamId,
        },
        settings: sanitizeSettings(db.settings, true),
        credentialAuditLog: db.credentialAuditLog || [],
      });
    })
  );

  // Admin: create participant (hashed password, unique ID, default active status, audit logged)
  app.post(
    '/api/admin/teams',
    requireAdmin,
    uploadCrest.single('crest'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const effectiveMax = Math.max(Number(db.settings.maxTeams) || 100, 100);
      if (db.teams.length >= effectiveMax) {
        safeUnlink(req.file?.path);
        res.status(400).json({
          error: `Se alcanzó el límite máximo de ${effectiveMax} participantes en la liga.`,
        });
        return;
      }

      const memberName = String(req.body?.memberName || '').trim().slice(0, 60);
      const rawId = String(req.body?.id || '').trim().toUpperCase();
      const rawClave = String(req.body?.clave || '').trim();
      const rawName = String(req.body?.name || '').trim().slice(0, 60);
      const bio = String(req.body?.bio || '').trim().slice(0, 240);

      if (!memberName) {
        safeUnlink(req.file?.path);
        res.status(400).json({ error: 'Completá al menos el Nombre del Participante.' });
        return;
      }

      const existingIds = new Set(db.teams.map((t) => t.id.toUpperCase()));
      let id = rawId;
      if (!id) {
        let nextNum = db.teams.length + 1;
        id = `LMA${String(nextNum).padStart(2, '0')}`;
        while (existingIds.has(id) || id === db.settings.adminId.toUpperCase()) {
          nextNum += 1;
          id = `LMA${String(nextNum).padStart(2, '0')}`;
        }
      } else if (!/^[A-Z0-9_-]{2,20}$/.test(id)) {
        safeUnlink(req.file?.path);
        res.status(400).json({
          error: 'El ID del participante debe tener entre 2 y 20 caracteres alfanuméricos (letras, números, - o _).',
        });
        return;
      }

      const initialPassword =
        rawClave || `PES6_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      if (initialPassword.length < 4 || initialPassword.length > 64) {
        safeUnlink(req.file?.path);
        res.status(400).json({
          error: 'La contraseña inicial debe tener entre 4 y 64 caracteres.',
        });
        return;
      }

      const name = rawName || `Club ${memberName}`;

      if (id === db.settings.adminId.toUpperCase()) {
        safeUnlink(req.file?.path);
        res.status(409).json({ error: `El ID "${id}" está reservado para el Administrador.` });
        return;
      }

      if (db.teams.some((t) => t.id.toUpperCase() === id)) {
        safeUnlink(req.file?.path);
        res.status(409).json({ error: `Ya existe un participante con el ID "${id}".` });
        return;
      }

      let crestUrl = `/api/crest/${encodeURIComponent(id)}.svg`;
      if (req.file) {
        if (!isValidImageFile(req.file)) {
          safeUnlink(req.file.path);
          res.status(400).json({ error: 'El escudo del equipo debe ser una imagen válida (PNG, JPG, WEBP, etc.).' });
          return;
        }
        const finalName = await normalizePng128(req.file.path);
        const finalPath = path.join(path.dirname(req.file.path), finalName);
        crestUrl = await persistUploadedFile(
          finalPath,
          'crests',
          finalName,
          finalName.endsWith('.png') ? 'image/png' : req.file.mimetype
        );
      }

      const now = new Date().toISOString();
      const newTeam: Team = {
        id,
        claveHash: hashPassword(initialPassword),
        accountStatus: 'active',
        tokenVersion: 1,
        credentialsUpdatedAt: now,
        name,
        memberName,
        crestUrl,
        bio,
        primaryColor: '#0284C7',
        secondaryColor: '#FFFFFF',
        createdAt: now,
      };

      db.teams.push(newTeam);
      appendCredentialAudit(db, {
        action: 'create_participant',
        targetType: 'participant',
        targetId: newTeam.id,
        targetLabel: `${newTeam.memberName} (${newTeam.name})`,
        details: `Participante creado con ID ${newTeam.id} y contraseña inicial cifrada (hash).`,
        performedBy: req.authUser?.id || db.settings.adminId,
      });

      await saveDb(db);
      res.status(201).json({
        team: sanitizeAdminTeam(newTeam),
        generatedClave: rawClave ? undefined : initialPassword,
      });
    })
  );

  // Admin: update existing participant (ID, optional new password reset, team name, memberName, bio, status, crest)
  app.put(
    '/api/admin/teams/:teamId',
    requireAdmin,
    uploadCrest.single('crest'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const targetId = String(req.params.teamId || '');
      const team = db.teams.find((t) => t.id === targetId);
      if (!team) {
        safeUnlink(req.file?.path);
        res.status(404).json({ error: 'Participante no encontrado.' });
        return;
      }

      const oldId = team.id;
      const nextId = String(req.body?.id ?? team.id).trim().toUpperCase();
      if (!nextId || !/^[A-Z0-9_-]{2,20}$/.test(nextId)) {
        safeUnlink(req.file?.path);
        res.status(400).json({
          error: 'El ID del participante debe tener entre 2 y 20 caracteres alfanuméricos (letras, números, - o _).',
        });
        return;
      }
      if (nextId === db.settings.adminId.toUpperCase()) {
        safeUnlink(req.file?.path);
        res.status(409).json({ error: `El ID "${nextId}" está reservado para el Administrador.` });
        return;
      }
      if (nextId !== oldId && db.teams.some((t) => t.id.toUpperCase() === nextId)) {
        safeUnlink(req.file?.path);
        res.status(409).json({ error: `El ID "${nextId}" ya está en uso.` });
        return;
      }

      const nextPassword = typeof req.body?.clave === 'string' ? req.body.clave.trim() : '';
      if (nextPassword && (nextPassword.length < 4 || nextPassword.length > 64)) {
        safeUnlink(req.file?.path);
        res.status(400).json({
          error: 'La nueva contraseña debe tener entre 4 y 64 caracteres (o dejá el campo vacío para mantener la actual).',
        });
        return;
      }

      if (req.file) {
        if (!isValidImageFile(req.file)) {
          safeUnlink(req.file.path);
          res.status(400).json({ error: 'El escudo debe ser una imagen válida (PNG, JPG, WEBP, etc.).' });
          return;
        }
        const finalName = await normalizePng128(req.file.path);
        const finalPath = path.join(path.dirname(req.file.path), finalName);
        team.crestUrl = await persistUploadedFile(
          finalPath,
          'crests',
          finalName,
          finalName.endsWith('.png') ? 'image/png' : req.file.mimetype
        );
      }

      const now = new Date().toISOString();
      const adminActor = req.authUser?.id || db.settings.adminId;

      // If ID changed, update all league references atomically and bump tokenVersion
      if (nextId !== oldId) {
        for (const m of db.matches) {
          if (m.homeTeamId === oldId) m.homeTeamId = nextId;
          if (m.awayTeamId === oldId) m.awayTeamId = nextId;
          if (m.submittedByTeamId === oldId) m.submittedByTeamId = nextId;
        }
        for (const fx of db.fixtures || []) {
          if (fx.homeTeamId === oldId) fx.homeTeamId = nextId;
          if (fx.awayTeamId === oldId) fx.awayTeamId = nextId;
        }
        for (const ev of db.calendarEvents || []) {
          if (ev.homeTeamId === oldId) ev.homeTeamId = nextId;
          if (ev.awayTeamId === oldId) ev.awayTeamId = nextId;
        }
        for (const cl of db.claims || []) {
          if (cl.reporterTeamId === oldId) cl.reporterTeamId = nextId;
          if (cl.accusedTeamId === oldId) cl.accusedTeamId = nextId;
        }
        for (const cm of db.comments || []) {
          if (cm.authorTeamId === oldId) cm.authorTeamId = nextId;
        }
        for (const c of db.champions) {
          if (c.teamId === oldId) c.teamId = nextId;
        }
        for (const p of db.cup?.participants || []) {
          if (p.teamId === oldId) p.teamId = nextId;
        }
        if (db.settings.adminTeamId === oldId) {
          db.settings.adminTeamId = nextId;
        }
        if (team.crestUrl.startsWith('/api/crest/')) {
          team.crestUrl = `/api/crest/${encodeURIComponent(nextId)}.svg`;
        }
        team.id = nextId;
        team.tokenVersion = (team.tokenVersion ?? 1) + 1;
        team.credentialsUpdatedAt = now;
        appendCredentialAudit(db, {
          action: 'update_participant_id',
          targetType: 'participant',
          targetId: nextId,
          targetLabel: `${team.memberName} (${team.name})`,
          details: `ID modificado de ${oldId} a ${nextId} (sesión anterior revocada).`,
          performedBy: adminActor,
        });
      }

      if (nextPassword) {
        team.claveHash = hashPassword(nextPassword);
        team.tokenVersion = (team.tokenVersion ?? 1) + 1;
        team.credentialsUpdatedAt = now;
        appendCredentialAudit(db, {
          action: 'reset_participant_password',
          targetType: 'participant',
          targetId: team.id,
          targetLabel: `${team.memberName} (${team.name})`,
          details: `Contraseña restablecida y cifrada por el Administrador (sesión anterior revocada).`,
          performedBy: adminActor,
        });
      }

      if (typeof req.body?.name === 'string' && req.body.name.trim()) {
        team.name = req.body.name.trim().slice(0, 60);
      }
      if (typeof req.body?.memberName === 'string' && req.body.memberName.trim()) {
        team.memberName = req.body.memberName.trim().slice(0, 60);
      }
      if (typeof req.body?.bio === 'string') {
        team.bio = req.body.bio.trim().slice(0, 240);
      }
      if (req.body?.accountStatus === 'active' || req.body?.accountStatus === 'blocked') {
        if (team.accountStatus !== req.body.accountStatus) {
          team.accountStatus = req.body.accountStatus;
          team.tokenVersion = (team.tokenVersion ?? 1) + 1;
          team.credentialsUpdatedAt = now;
          appendCredentialAudit(db, {
            action: req.body.accountStatus === 'blocked' ? 'block_participant' : 'activate_participant',
            targetType: 'participant',
            targetId: team.id,
            targetLabel: `${team.memberName} (${team.name})`,
            details:
              req.body.accountStatus === 'blocked'
                ? 'Cuenta bloqueada por el Administrador.'
                : 'Cuenta activada por el Administrador.',
            performedBy: adminActor,
          });
        }
      }

      await saveDb(db);
      res.json({ team: sanitizeAdminTeam(team) });
    })
  );

  // Admin: activate or block participant account (revokes active sessions when blocked)
  app.patch(
    '/api/admin/teams/:teamId/status',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const targetId = String(req.params.teamId || '');
      const team = db.teams.find((t) => t.id === targetId);
      if (!team) {
        res.status(404).json({ error: 'Participante no encontrado.' });
        return;
      }

      const nextStatus =
        req.body?.status === 'blocked' || req.body?.status === 'active'
          ? (req.body.status as 'active' | 'blocked')
          : team.accountStatus === 'blocked'
          ? 'active'
          : 'blocked';

      team.accountStatus = nextStatus;
      team.tokenVersion = (team.tokenVersion ?? 1) + 1;
      team.credentialsUpdatedAt = new Date().toISOString();

      appendCredentialAudit(db, {
        action: nextStatus === 'blocked' ? 'block_participant' : 'activate_participant',
        targetType: 'participant',
        targetId: team.id,
        targetLabel: `${team.memberName} (${team.name})`,
        details:
          nextStatus === 'blocked'
            ? 'Cuenta bloqueada por el Administrador; acceso restringido.'
            : 'Cuenta reactivada por el Administrador.',
        performedBy: req.authUser?.id || db.settings.adminId,
      });

      await saveDb(db);
      res.json({ team: sanitizeAdminTeam(team) });
    })
  );

  // Admin: reset participant password (custom or generated one-time temporary password)
  app.post(
    '/api/admin/teams/:teamId/reset-password',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const targetId = String(req.params.teamId || '');
      const team = db.teams.find((t) => t.id === targetId);
      if (!team) {
        res.status(404).json({ error: 'Participante no encontrado.' });
        return;
      }

      const requested = String(req.body?.newPassword || '').trim();
      const generate = req.body?.generate === true || !requested;
      const nextPlain = generate
        ? `PES6_${crypto.randomBytes(3).toString('hex').toUpperCase()}`
        : requested;

      if (nextPlain.length < 4 || nextPlain.length > 64) {
        res.status(400).json({
          error: 'La nueva contraseña debe tener entre 4 y 64 caracteres.',
        });
        return;
      }

      team.claveHash = hashPassword(nextPlain);
      team.tokenVersion = (team.tokenVersion ?? 1) + 1;
      team.credentialsUpdatedAt = new Date().toISOString();

      appendCredentialAudit(db, {
        action: 'reset_participant_password',
        targetType: 'participant',
        targetId: team.id,
        targetLabel: `${team.memberName} (${team.name})`,
        details: generate
          ? 'Credenciales restablecidas con nueva contraseña aleatoria cifrada.'
          : 'Contraseña restablecida manualmente por el Administrador.',
        performedBy: req.authUser?.id || db.settings.adminId,
      });

      await saveDb(db);
      res.json({
        team: sanitizeAdminTeam(team),
        resetPassword: nextPlain,
      });
    })
  );

  // Admin: delete participant account
  app.delete(
    '/api/admin/teams/:teamId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const targetId = String(req.params.teamId || '');
      const target = db.teams.find((t) => t.id === targetId);
      if (!target) {
        res.status(404).json({ error: 'Participante no encontrado.' });
        return;
      }
      db.teams = db.teams.filter((t) => t.id !== targetId);
      if (db.settings.adminTeamId === targetId) {
        db.settings.adminTeamId = undefined;
      }
      db.matches = db.matches.filter((m) => m.homeTeamId !== targetId && m.awayTeamId !== targetId);

      appendCredentialAudit(db, {
        action: 'delete_participant',
        targetType: 'participant',
        targetId: target.id,
        targetLabel: `${target.memberName} (${target.name})`,
        details: `Cuenta de participante ${target.id} eliminada permanentemente por el Administrador.`,
        performedBy: req.authUser?.id || db.settings.adminId,
      });

      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // Member or Admin: submit match result (with optional proof & scorer image)
  app.post(
    '/api/matches',
    requireAuth,
    uploadMatchProof.fields([
      { name: 'proofImage', maxCount: 1 },
      { name: 'scorerImage', maxCount: 1 },
    ]),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const proofFile = files?.proofImage?.[0];
      const scorerFile = files?.scorerImage?.[0];
      const cleanupFiles = () => {
        safeUnlink(proofFile?.path);
        safeUnlink(scorerFile?.path);
      };

      const homeTeamId = String(req.body?.homeTeamId || '').trim();
      const awayTeamId = String(req.body?.awayTeamId || '').trim();
      const homeGoals = Number(req.body?.homeGoals);
      const awayGoals = Number(req.body?.awayGoals);
      const matchday = Math.max(1, Number(req.body?.matchday) || 1);
      const leg = req.body?.leg === 'Vuelta' ? 'Vuelta' : 'Ida';
      const rawComp = String(req.body?.competitionType || 'liga').trim();
      const competitionType: 'liga' | 'copa' | 'recopa' =
        rawComp === 'copa' ? 'copa' : rawComp === 'recopa' ? 'recopa' : 'liga';
      const cupMatchId = String(req.body?.cupMatchId || '').trim() || undefined;
      const parseOptionalPen = (v: unknown): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 ? n : null;
      };
      const homePenalties = parseOptionalPen(req.body?.homePenalties);
      const awayPenalties = parseOptionalPen(req.body?.awayPenalties);
      const extraTime =
        req.body?.extraTime === true ||
        req.body?.extraTime === 'true' ||
        (homePenalties !== null && awayPenalties !== null);
      const playedAt = String(req.body?.playedAt || new Date().toISOString().slice(0, 10));
      const notes = String(req.body?.notes || '').trim();
      const scorerName = String(req.body?.scorerName || '').trim();
      const fixtureId = String(req.body?.fixtureId || '').trim() || undefined;

      if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
        cleanupFiles();
        res.status(400).json({ error: 'Seleccioná dos equipos distintos (Local y Visitante).' });
        return;
      }

      if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0) {
        cleanupFiles();
        res.status(400).json({ error: 'Los goles deben ser números enteros válidos (0 o más).' });
        return;
      }

      const homeExists = db.teams.some((t) => t.id === homeTeamId);
      const awayExists = db.teams.some((t) => t.id === awayTeamId);
      if (!homeExists || !awayExists) {
        cleanupFiles();
        res.status(400).json({ error: 'Uno de los equipos seleccionados no existe.' });
        return;
      }

      const isAdmin = req.authUser?.role === 'admin';
      let proofImageUrl: string | undefined;
      let proofImageStatus: ModerationStatus | undefined;
      if (proofFile) {
        if (!isValidImageFile(proofFile)) {
          cleanupFiles();
          res.status(400).json({
            error: 'La foto del resultado debe ser un archivo de imagen válido (JPG, PNG, WEBP, GIF).',
          });
          return;
        }
        const mod = await moderateUploadedImage(proofFile.path, proofFile.mimetype, 'resultado de partido PES6 / fútbol');
        if (!mod.allowed) {
          cleanupFiles();
          res.status(400).json({ error: mod.reason || 'Foto de resultado rechazada por contenido inapropiado.' });
          return;
        }
        proofImageUrl = await persistUploadedFile(
          proofFile.path,
          'matches',
          proofFile.filename,
          proofFile.mimetype
        );
        proofImageStatus = isAdmin ? 'approved' : 'pending';
      }

      let scorerImageUrl: string | undefined;
      let scorerImageStatus: ModerationStatus | undefined;
      if (scorerFile) {
        if (!isValidImageFile(scorerFile)) {
          cleanupFiles();
          res.status(400).json({
            error: 'La foto del goleador debe ser un archivo de imagen válido (JPG, PNG, WEBP).',
          });
          return;
        }
        const mod = await moderateUploadedImage(scorerFile.path, scorerFile.mimetype, 'foto del goleador del equipo de fútbol');
        if (!mod.allowed) {
          cleanupFiles();
          res.status(400).json({ error: mod.reason || 'Foto del goleador rechazada por contenido inapropiado.' });
          return;
        }
        scorerImageUrl = await persistUploadedFile(
          scorerFile.path,
          'matches',
          scorerFile.filename,
          scorerFile.mimetype
        );
        scorerImageStatus = isAdmin ? 'approved' : 'pending';
      }

      const now = new Date().toISOString();

      const match: Match = {
        id: `m_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        matchday,
        homeTeamId,
        awayTeamId,
        homeGoals,
        awayGoals,
        leg,
        competitionType,
        cupMatchId,
        homePenalties,
        awayPenalties,
        extraTime,
        playedAt,
        notes,
        proofImageUrl,
        proofImageStatus,
        scorerImageUrl,
        scorerName: scorerName || undefined,
        scorerImageStatus,
        fixtureId,
        submittedByTeamId: req.authUser?.teamId || 'ADMIN',
        submittedByName: req.authUser?.displayName || 'Miembro',
        status: isAdmin || competitionType === 'copa' || competitionType === 'recopa' ? 'validated' : 'pending',
        validatedAt: isAdmin || competitionType === 'copa' || competitionType === 'recopa' ? now : undefined,
        createdAt: now,
      };

      db.matches.unshift(match);
      if (fixtureId) {
        const fx = db.fixtures.find((f) => f.id === fixtureId);
        if (fx) fx.completedMatchId = match.id;
      }

      const cupSynced =
        competitionType === 'copa' || competitionType === 'recopa'
          ? syncMatchToCupBracket(db, match)
          : false;

      await saveDb(db);
      res.status(201).json({ match, cupSynced, cup: cupSynced ? db.cup : undefined });
    })
  );

  // Admin: validate, reject, or edit match result
  app.patch(
    '/api/admin/matches/:matchId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const match = db.matches.find((m) => m.id === req.params.matchId);
      if (!match) {
        res.status(404).json({ error: 'Partido no encontrado.' });
        return;
      }

      if (req.body?.homeGoals !== undefined) {
        const hg = Number(req.body.homeGoals);
        if (Number.isInteger(hg) && hg >= 0) match.homeGoals = hg;
      }
      if (req.body?.awayGoals !== undefined) {
        const ag = Number(req.body.awayGoals);
        if (Number.isInteger(ag) && ag >= 0) match.awayGoals = ag;
      }
      if (req.body?.matchday !== undefined) {
        const md = Number(req.body.matchday);
        if (Number.isInteger(md) && md >= 1) match.matchday = md;
      }
      if (req.body?.leg === 'Ida' || req.body?.leg === 'Vuelta') {
        match.leg = req.body.leg;
      }
      if (typeof req.body?.playedAt === 'string' && req.body.playedAt.trim()) {
        match.playedAt = req.body.playedAt.trim();
      }
      if (typeof req.body?.notes === 'string') {
        match.notes = req.body.notes.trim();
      }
      if (req.body?.status === 'validated' || req.body?.status === 'rejected' || req.body?.status === 'pending') {
        match.status = req.body.status;
        if (req.body.status === 'validated') {
          match.validatedAt = new Date().toISOString();
          if (match.proofImageUrl && !match.proofImageStatus) match.proofImageStatus = 'approved';
          if (match.scorerImageUrl && !match.scorerImageStatus) match.scorerImageStatus = 'approved';
        }
      }

      if (
        match.status === 'validated' &&
        (match.competitionType === 'copa' || match.competitionType === 'recopa')
      ) {
        syncMatchToCupBracket(db, match);
      }

      await saveDb(db);
      res.json({ match });
    })
  );

  // Admin: delete match
  app.delete(
    '/api/admin/matches/:matchId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const before = db.matches.length;
      db.matches = db.matches.filter((m) => m.id !== req.params.matchId);
      if (db.matches.length === before) {
        res.status(404).json({ error: 'Partido no encontrado.' });
        return;
      }
      for (const fx of db.fixtures) {
        if (fx.completedMatchId === req.params.matchId) fx.completedMatchId = undefined;
      }
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // Admin: Scheduled Fixtures ("Cruces por Fecha")
  app.post(
    '/api/admin/fixtures',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const matchday = Math.max(1, Number(req.body?.matchday) || 1);
      const homeTeamId = String(req.body?.homeTeamId || '').trim();
      const awayTeamId = String(req.body?.awayTeamId || '').trim();
      const leg: 'Ida' | 'Vuelta' = req.body?.leg === 'Vuelta' ? 'Vuelta' : 'Ida';
      const scheduledDate = String(req.body?.scheduledDate || '').trim() || undefined;
      const scheduledTime = String(req.body?.scheduledTime || '').trim() || undefined;
      const notes = String(req.body?.notes || '').trim() || undefined;

      if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
        res.status(400).json({ error: 'Seleccioná dos equipos distintos para el cruce.' });
        return;
      }
      if (!db.teams.some((t) => t.id === homeTeamId) || !db.teams.some((t) => t.id === awayTeamId)) {
        res.status(400).json({ error: 'Uno de los equipos no existe en la liga.' });
        return;
      }

      const fixture: ScheduledFixture = {
        id: `fx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        matchday,
        homeTeamId,
        awayTeamId,
        leg,
        scheduledDate,
        scheduledTime,
        notes,
        createdAt: new Date().toISOString(),
      };
      db.fixtures.push(fixture);
      await saveDb(db);
      res.status(201).json({ fixture });
    })
  );

  app.put(
    '/api/admin/fixtures/:fixtureId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const fixture = db.fixtures.find((f) => f.id === req.params.fixtureId);
      if (!fixture) {
        res.status(404).json({ error: 'Cruce no encontrado.' });
        return;
      }
      if (req.body?.matchday !== undefined) {
        const md = Number(req.body.matchday);
        if (Number.isInteger(md) && md >= 1) fixture.matchday = md;
      }
      if (typeof req.body?.homeTeamId === 'string' && req.body.homeTeamId.trim()) {
        fixture.homeTeamId = req.body.homeTeamId.trim();
      }
      if (typeof req.body?.awayTeamId === 'string' && req.body.awayTeamId.trim()) {
        fixture.awayTeamId = req.body.awayTeamId.trim();
      }
      if (req.body?.leg === 'Ida' || req.body?.leg === 'Vuelta') {
        fixture.leg = req.body.leg;
      }
      if (typeof req.body?.scheduledDate === 'string') {
        fixture.scheduledDate = req.body.scheduledDate.trim() || undefined;
      }
      if (typeof req.body?.scheduledTime === 'string') {
        fixture.scheduledTime = req.body.scheduledTime.trim() || undefined;
      }
      if (typeof req.body?.notes === 'string') {
        fixture.notes = req.body.notes.trim() || undefined;
      }
      await saveDb(db);
      res.json({ fixture });
    })
  );

  app.delete(
    '/api/admin/fixtures/:fixtureId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const before = db.fixtures.length;
      db.fixtures = db.fixtures.filter((f) => f.id !== req.params.fixtureId);
      if (db.fixtures.length === before) {
        res.status(404).json({ error: 'Cruce no encontrado.' });
        return;
      }
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // Admin: Calendar banner message (visible to everyone on CalendarView, editable/deletable only by Admin)
  app.put(
    '/api/admin/calendar/message',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 600) : '';
      db.settings.calendarMessage = message;
      await saveDb(db);
      res.json({ calendarMessage: db.settings.calendarMessage });
    })
  );

  // Admin: Calendar Events synchronized with Date/Time, Match Crests, and Copa de la Liga
  app.post(
    '/api/admin/calendar',
    requireAdmin,
    uploadCrest.fields([
      { name: 'homeCrest', maxCount: 1 },
      { name: 'awayCrest', maxCount: 1 },
    ]),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.calendarEvents)) db.calendarEvents = [];
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const homeCrestFile = files?.homeCrest?.[0];
      const awayCrestFile = files?.awayCrest?.[0];
      const cleanup = () => {
        safeUnlink(homeCrestFile?.path);
        safeUnlink(awayCrestFile?.path);
      };

      const title = String(req.body?.title || '').trim();
      const rawCategory = String(req.body?.category || 'copa').trim();
      const category: CalendarCategory =
        rawCategory === 'liga' || rawCategory === 'recopa' || rawCategory === 'evento'
          ? rawCategory
          : 'copa';
      const date = String(req.body?.date || '').trim();
      const time = String(req.body?.time || '21:00').trim() || '21:00';
      const roundLabel = String(req.body?.roundLabel || '').trim() || undefined;
      const cupMatchId = String(req.body?.cupMatchId || '').trim() || undefined;
      const fixtureId = String(req.body?.fixtureId || '').trim() || undefined;
      const homeTeamId = String(req.body?.homeTeamId || '').trim() || undefined;
      const awayTeamId = String(req.body?.awayTeamId || '').trim() || undefined;
      let homeTeamName = String(req.body?.homeTeamName || '').trim() || undefined;
      let awayTeamName = String(req.body?.awayTeamName || '').trim() || undefined;
      let homeCrestUrl = String(req.body?.homeCrestUrl || '').trim() || undefined;
      let awayCrestUrl = String(req.body?.awayCrestUrl || '').trim() || undefined;
      const notes = String(req.body?.notes || '').trim() || undefined;

      if (!title) {
        cleanup();
        res.status(400).json({ error: 'Ingresá un título para el evento del calendario.' });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        cleanup();
        res.status(400).json({ error: 'Seleccioná una fecha válida (Año-Mes-Día).' });
        return;
      }

      if (homeTeamId) {
        const foundHome = db.teams.find((t) => t.id === homeTeamId);
        if (foundHome) {
          if (!homeTeamName) homeTeamName = foundHome.name;
          if (!homeCrestUrl && !homeCrestFile) homeCrestUrl = foundHome.crestUrl;
        }
      }
      if (awayTeamId) {
        const foundAway = db.teams.find((t) => t.id === awayTeamId);
        if (foundAway) {
          if (!awayTeamName) awayTeamName = foundAway.name;
          if (!awayCrestUrl && !awayCrestFile) awayCrestUrl = foundAway.crestUrl;
        }
      }

      if (homeCrestFile) {
        if (!isValidImageFile(homeCrestFile)) {
          cleanup();
          res.status(400).json({ error: 'El escudo local debe ser una imagen válida (PNG, JPG, WEBP).' });
          return;
        }
        const finalName = await normalizePng128(homeCrestFile.path);
        const finalPath = path.join(path.dirname(homeCrestFile.path), finalName);
        homeCrestUrl = await persistUploadedFile(
          finalPath,
          'crests',
          finalName,
          finalName.endsWith('.png') ? 'image/png' : homeCrestFile.mimetype
        );
      }
      if (awayCrestFile) {
        if (!isValidImageFile(awayCrestFile)) {
          cleanup();
          res.status(400).json({ error: 'El escudo visitante debe ser una imagen válida (PNG, JPG, WEBP).' });
          return;
        }
        const finalName = await normalizePng128(awayCrestFile.path);
        const finalPath = path.join(path.dirname(awayCrestFile.path), finalName);
        awayCrestUrl = await persistUploadedFile(
          finalPath,
          'crests',
          finalName,
          finalName.endsWith('.png') ? 'image/png' : awayCrestFile.mimetype
        );
      }

      // Two-way sync if linked to a Cup match or Recopa
      if (cupMatchId) {
        if (cupMatchId === 'recopa') {
          db.cup.recopa.scheduledDate = date;
          db.cup.recopa.scheduledTime = time;
          if (!homeCrestUrl) homeCrestUrl = db.cup.recopa.leagueChampionCrestUrl || undefined;
          if (!awayCrestUrl) awayCrestUrl = db.cup.recopa.cupChampionCrestUrl || undefined;
          db.cup.updatedAt = new Date().toISOString();
        } else {
          const cupMatch = db.cup.matches.find((m) => m.id === cupMatchId);
          if (cupMatch) {
            cupMatch.scheduledDate = date;
            cupMatch.scheduledTime = time;
            if (!homeCrestUrl) homeCrestUrl = cupMatch.homeCrestUrl || undefined;
            if (!awayCrestUrl) awayCrestUrl = cupMatch.awayCrestUrl || undefined;
            db.cup.updatedAt = new Date().toISOString();
          }
        }
      }

      if (fixtureId) {
        const fx = db.fixtures.find((f) => f.id === fixtureId);
        if (fx) {
          fx.scheduledDate = date;
          fx.scheduledTime = time;
          if (notes !== undefined) fx.notes = notes;
        }
      }

      const event: CalendarEvent = {
        id: `cal_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        title,
        category,
        date,
        time,
        roundLabel,
        cupMatchId,
        fixtureId,
        homeTeamId,
        awayTeamId,
        homeTeamName,
        awayTeamName,
        homeCrestUrl,
        awayCrestUrl,
        notes,
        createdAt: new Date().toISOString(),
      };
      db.calendarEvents.push(event);
      await saveDb(db);
      res.status(201).json({ event, cup: db.cup });
    })
  );

  app.put(
    '/api/admin/calendar/:eventId',
    requireAdmin,
    uploadCrest.fields([
      { name: 'homeCrest', maxCount: 1 },
      { name: 'awayCrest', maxCount: 1 },
    ]),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.calendarEvents)) db.calendarEvents = [];
      const event = db.calendarEvents.find((ev) => ev.id === req.params.eventId);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const homeCrestFile = files?.homeCrest?.[0];
      const awayCrestFile = files?.awayCrest?.[0];
      const cleanup = () => {
        safeUnlink(homeCrestFile?.path);
        safeUnlink(awayCrestFile?.path);
      };

      if (!event) {
        cleanup();
        res.status(404).json({ error: 'Evento de calendario no encontrado.' });
        return;
      }

      if (typeof req.body?.title === 'string' && req.body.title.trim()) {
        event.title = req.body.title.trim();
      }
      if (
        req.body?.category === 'copa' ||
        req.body?.category === 'liga' ||
        req.body?.category === 'recopa' ||
        req.body?.category === 'evento'
      ) {
        event.category = req.body.category;
      }
      if (typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date.trim())) {
        event.date = req.body.date.trim();
      }
      if (typeof req.body?.time === 'string' && req.body.time.trim()) {
        event.time = req.body.time.trim();
      }
      if (typeof req.body?.roundLabel === 'string') {
        event.roundLabel = req.body.roundLabel.trim() || undefined;
      }
      if (typeof req.body?.cupMatchId === 'string') {
        event.cupMatchId = req.body.cupMatchId.trim() || undefined;
      }
      if (typeof req.body?.fixtureId === 'string') {
        event.fixtureId = req.body.fixtureId.trim() || undefined;
      }
      if (typeof req.body?.homeTeamId === 'string') {
        const hId = req.body.homeTeamId.trim();
        event.homeTeamId = hId || undefined;
        if (hId) {
          const foundHome = db.teams.find((t) => t.id === hId);
          if (foundHome) {
            if (typeof req.body?.homeTeamName !== 'string' || !req.body.homeTeamName.trim()) {
              event.homeTeamName = foundHome.name;
            }
            if (!homeCrestFile && typeof req.body?.homeCrestUrl !== 'string') {
              event.homeCrestUrl = foundHome.crestUrl;
            }
          }
        }
      }
      if (typeof req.body?.awayTeamId === 'string') {
        const aId = req.body.awayTeamId.trim();
        event.awayTeamId = aId || undefined;
        if (aId) {
          const foundAway = db.teams.find((t) => t.id === aId);
          if (foundAway) {
            if (typeof req.body?.awayTeamName !== 'string' || !req.body.awayTeamName.trim()) {
              event.awayTeamName = foundAway.name;
            }
            if (!awayCrestFile && typeof req.body?.awayCrestUrl !== 'string') {
              event.awayCrestUrl = foundAway.crestUrl;
            }
          }
        }
      }
      if (typeof req.body?.homeTeamName === 'string') {
        event.homeTeamName = req.body.homeTeamName.trim() || undefined;
      }
      if (typeof req.body?.awayTeamName === 'string') {
        event.awayTeamName = req.body.awayTeamName.trim() || undefined;
      }
      if (typeof req.body?.homeCrestUrl === 'string') {
        event.homeCrestUrl = req.body.homeCrestUrl.trim() || undefined;
      }
      if (typeof req.body?.awayCrestUrl === 'string') {
        event.awayCrestUrl = req.body.awayCrestUrl.trim() || undefined;
      }
      if (req.body?.clearHomeCrest === 'true' || req.body?.clearHomeCrest === true) {
        event.homeCrestUrl = undefined;
      }
      if (req.body?.clearAwayCrest === 'true' || req.body?.clearAwayCrest === true) {
        event.awayCrestUrl = undefined;
      }

      if (homeCrestFile) {
        if (!isValidImageFile(homeCrestFile)) {
          cleanup();
          res.status(400).json({ error: 'El escudo local debe ser una imagen válida (PNG, JPG, WEBP).' });
          return;
        }
        const finalName = await normalizePng128(homeCrestFile.path);
        const finalPath = path.join(path.dirname(homeCrestFile.path), finalName);
        event.homeCrestUrl = await persistUploadedFile(
          finalPath,
          'crests',
          finalName,
          finalName.endsWith('.png') ? 'image/png' : homeCrestFile.mimetype
        );
      }
      if (awayCrestFile) {
        if (!isValidImageFile(awayCrestFile)) {
          cleanup();
          res.status(400).json({ error: 'El escudo visitante debe ser una imagen válida (PNG, JPG, WEBP).' });
          return;
        }
        const finalName = await normalizePng128(awayCrestFile.path);
        const finalPath = path.join(path.dirname(awayCrestFile.path), finalName);
        event.awayCrestUrl = await persistUploadedFile(
          finalPath,
          'crests',
          finalName,
          finalName.endsWith('.png') ? 'image/png' : awayCrestFile.mimetype
        );
      }

      if (typeof req.body?.notes === 'string') {
        event.notes = req.body.notes.trim() || undefined;
      }

      if (event.cupMatchId) {
        if (event.cupMatchId === 'recopa') {
          db.cup.recopa.scheduledDate = event.date;
          db.cup.recopa.scheduledTime = event.time;
          db.cup.updatedAt = new Date().toISOString();
        } else {
          const cupMatch = db.cup.matches.find((m) => m.id === event.cupMatchId);
          if (cupMatch) {
            cupMatch.scheduledDate = event.date;
            cupMatch.scheduledTime = event.time;
            db.cup.updatedAt = new Date().toISOString();
          }
        }
      }

      if (event.fixtureId) {
        const fx = db.fixtures.find((f) => f.id === event.fixtureId);
        if (fx) {
          fx.scheduledDate = event.date;
          fx.scheduledTime = event.time;
          fx.notes = event.notes;
        }
      }

      await saveDb(db);
      res.json({ event, cup: db.cup });
    })
  );

  app.delete(
    '/api/admin/calendar/:eventId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.calendarEvents)) db.calendarEvents = [];
      const before = db.calendarEvents.length;
      db.calendarEvents = db.calendarEvents.filter((ev) => ev.id !== req.params.eventId);
      if (db.calendarEvents.length === before) {
        res.status(404).json({ error: 'Evento no encontrado.' });
        return;
      }
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // NOTICIAS! ÚLTIMAS NOVEDADES (Solo el Admin puede publicar, editar colores, subir PNG/MP4 o eliminar)
  app.post(
    '/api/admin/news',
    requireAdmin,
    uploadNews.fields([
      { name: 'image', maxCount: 1 },
      { name: 'video', maxCount: 1 },
    ]),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.news)) db.news = [];
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const imageFile = files?.image?.[0];
      const videoFile = files?.video?.[0];

      const title = String(req.body?.title || '').trim();
      const content = String(req.body?.content || '').trim();
      const textColor = String(req.body?.textColor || '#FACC15').trim() || '#FACC15';

      if (!title && !content && !imageFile && !videoFile) {
        res.status(400).json({ error: 'Escribí un título/comunicado o adjuntá una imagen PNG o video MP4.' });
        return;
      }

      let imageUrl: string | undefined;
      if (imageFile) {
        if (!isValidImageFile(imageFile)) {
          safeUnlink(imageFile.path);
          safeUnlink(videoFile?.path);
          res.status(400).json({ error: 'La imagen debe ser PNG, JPG o WEBP.' });
          return;
        }
        imageUrl = await persistUploadedFile(
          imageFile.path,
          'news',
          imageFile.filename,
          imageFile.mimetype
        );
      }

      let videoUrl: string | undefined;
      if (videoFile) {
        const ext = path.extname(videoFile.originalname).toLowerCase();
        if (!isValidMp4File(videoFile)) {
          safeUnlink(videoFile.path);
          res.status(400).json({ error: 'El video adjunto debe estar en formato MP4.' });
          return;
        }
        const playable = await ensurePlayableMp4(videoFile.path, ext);
        const finalVideoName = playable || videoFile.filename;
        const finalVideoPath = path.join(path.dirname(videoFile.path), finalVideoName);
        videoUrl = await persistUploadedFile(finalVideoPath, 'news', finalVideoName, 'video/mp4');
        if (playable) safeUnlink(videoFile.path);
      }

      const post: NewsPost = {
        id: `news_${crypto.randomUUID().slice(0, 8)}`,
        title: title || 'Comunicado Oficial',
        content,
        textColor,
        imageUrl,
        videoUrl,
        createdAt: new Date().toISOString(),
      };
      db.news.unshift(post);
      await saveDb(db);
      res.status(201).json({ post });
    })
  );

  app.put(
    '/api/admin/news/:newsId',
    requireAdmin,
    uploadNews.fields([
      { name: 'image', maxCount: 1 },
      { name: 'video', maxCount: 1 },
    ]),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.news)) db.news = [];
      const post = db.news.find((n) => n.id === req.params.newsId);
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const imageFile = files?.image?.[0];
      const videoFile = files?.video?.[0];
      if (!post) {
        safeUnlink(imageFile?.path);
        safeUnlink(videoFile?.path);
        res.status(404).json({ error: 'Noticia no encontrada.' });
        return;
      }

      if (typeof req.body?.title === 'string' && req.body.title.trim()) {
        post.title = req.body.title.trim();
      }
      if (typeof req.body?.content === 'string') {
        post.content = req.body.content.trim();
      }
      if (typeof req.body?.textColor === 'string' && req.body.textColor.trim()) {
        post.textColor = req.body.textColor.trim();
      }
      if (req.body?.clearImage === 'true') {
        post.imageUrl = undefined;
      }
      if (req.body?.clearVideo === 'true') {
        post.videoUrl = undefined;
      }
      if (imageFile) {
        if (isValidImageFile(imageFile)) {
          post.imageUrl = await persistUploadedFile(
            imageFile.path,
            'news',
            imageFile.filename,
            imageFile.mimetype
          );
        } else {
          safeUnlink(imageFile.path);
        }
      }
      if (videoFile) {
        if (isValidMp4File(videoFile)) {
          const ext = path.extname(videoFile.originalname).toLowerCase();
          const playable = await ensurePlayableMp4(videoFile.path, ext);
          const finalVideoName = playable || videoFile.filename;
          const finalVideoPath = path.join(path.dirname(videoFile.path), finalVideoName);
          post.videoUrl = await persistUploadedFile(finalVideoPath, 'news', finalVideoName, 'video/mp4');
          if (playable) safeUnlink(videoFile.path);
        } else {
          safeUnlink(videoFile.path);
        }
      }

      await saveDb(db);
      res.json({ post });
    })
  );

  app.delete(
    '/api/admin/news/:newsId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.news)) db.news = [];
      const before = db.news.length;
      db.news = db.news.filter((n) => n.id !== req.params.newsId);
      if (db.news.length === before) {
        res.status(404).json({ error: 'Noticia no encontrada.' });
        return;
      }
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // TOP 5 MEJORES GOLES (Elegidos por el Administrador para reproducción continua en el Inicio)
  app.post(
    '/api/admin/top-goals',
    requireAdmin,
    uploadVideo.single('video'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.topGoals)) db.topGoals = [];

      const title = String(req.body?.title || '').trim();
      const scorerName = String(req.body?.scorerName || '').trim();
      const author = String(req.body?.author || '').trim();
      const sourceVideoId = String(req.body?.sourceVideoId || '').trim() || undefined;
      const requestedRank = Number(req.body?.rank);
      let videoUrl = String(req.body?.videoUrl || '').trim();

      if (req.file) {
        if (!isValidMp4File(req.file)) {
          safeUnlink(req.file.path);
          res.status(400).json({ error: 'Solo se permiten videos de goles en formato .MP4.' });
          return;
        }
        const ext = path.extname(req.file.originalname).toLowerCase();
        const playable = await ensurePlayableMp4(req.file.path, ext);
        const finalVideoName = playable || req.file.filename;
        const finalVideoPath = path.join(path.dirname(req.file.path), finalVideoName);
        videoUrl = await persistUploadedFile(finalVideoPath, 'videos', finalVideoName, 'video/mp4');
        if (playable) safeUnlink(req.file.path);
      }

      if (!videoUrl) {
        res.status(400).json({ error: 'Seleccioná un video existente o subí un archivo .MP4.' });
        return;
      }

      let rank = Number.isFinite(requestedRank) && requestedRank >= 1 && requestedRank <= 5
        ? Math.floor(requestedRank)
        : 0;

      if (!rank) {
        const usedRanks = new Set(db.topGoals.map((g) => g.rank));
        for (let r = 1; r <= 5; r++) {
          if (!usedRanks.has(r)) {
            rank = r;
            break;
          }
        }
        if (!rank) rank = 5;
      }

      const item: TopGoalItem = {
        id: `topgoal_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        rank,
        title: title || `Gol Destacado #${rank}`,
        scorerName: scorerName || undefined,
        author: author || undefined,
        videoUrl,
        sourceVideoId,
        createdAt: new Date().toISOString(),
      };

      // Replace existing goal at that rank (or same sourceVideoId) and keep max 5 sorted by rank
      db.topGoals = db.topGoals.filter(
        (g) => g.rank !== rank && (!sourceVideoId || g.sourceVideoId !== sourceVideoId)
      );
      db.topGoals.push(item);
      db.topGoals.sort((a, b) => a.rank - b.rank);
      db.topGoals = db.topGoals.slice(0, 5);

      await saveDb(db);
      res.status(201).json({ topGoal: item, topGoals: db.topGoals });
    })
  );

  app.delete(
    '/api/admin/top-goals/:goalId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.topGoals)) db.topGoals = [];
      const before = db.topGoals.length;
      db.topGoals = db.topGoals.filter((g) => g.id !== req.params.goalId);
      if (db.topGoals.length === before) {
        res.status(404).json({ error: 'Gol del Top 5 no encontrado.' });
        return;
      }
      db.topGoals.sort((a, b) => a.rank - b.rank);
      await saveDb(db);
      res.json({ deleted: true, topGoals: db.topGoals });
    })
  );

  // ME GUSTA (Página, Noticias y Perfiles de Participantes)
  app.post(
    '/api/likes/page',
    asyncRoute(async (_req: Request, res: Response) => {
      const db = await loadDb({ fresh: true });
      db.pageLikes = (typeof db.pageLikes === 'number' ? db.pageLikes : 0) + 1;
      await saveDb(db);
      res.json({ pageLikes: db.pageLikes });
    })
  );

  app.post(
    '/api/news/:newsId/like',
    asyncRoute(async (req: Request, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.news)) db.news = [];
      const post = db.news.find((n) => n.id === req.params.newsId);
      if (!post) {
        res.status(404).json({ error: 'Noticia no encontrada.' });
        return;
      }
      post.likes = (typeof post.likes === 'number' ? post.likes : 0) + 1;
      await saveDb(db);
      res.json({ newsId: post.id, likes: post.likes });
    })
  );

  app.post(
    '/api/teams/:teamId/like',
    asyncRoute(async (req: Request, res: Response) => {
      const db = await loadDb({ fresh: true });
      const team = db.teams.find((t) => t.id === req.params.teamId);
      if (!team) {
        res.status(404).json({ error: 'Participante no encontrado.' });
        return;
      }
      team.likes = (typeof team.likes === 'number' ? team.likes : 0) + 1;
      await saveDb(db);
      res.json({ teamId: team.id, likes: team.likes });
    })
  );

  // COMENTARIOS DE LA LIGA (Miembros envían → Solo el Administrador aprueba o elimina)
  app.post(
    '/api/comments',
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.comments)) db.comments = [];

      const message = String(req.body?.message || '').trim();
      if (!message || message.length < 2) {
        res.status(400).json({ error: 'Escribí un mensaje antes de enviarlo.' });
        return;
      }
      if (message.length > 600) {
        res.status(400).json({ error: 'El comentario puede tener hasta 600 caracteres.' });
        return;
      }

      const userTeam = req.authUser?.teamId
        ? db.teams.find((t) => t.id === req.authUser?.teamId)
        : undefined;

      const authorName =
        String(req.body?.authorName || '').trim() ||
        userTeam?.memberName ||
        req.authUser?.displayName ||
        'Miembro de la Liga';

      const isAdmin = req.authUser?.role === 'admin';
      const comment: LeagueComment = {
        id: `cmt_${crypto.randomUUID().slice(0, 8)}`,
        authorName: authorName.slice(0, 60),
        authorTeamName: userTeam?.name,
        authorTeamId: userTeam?.id,
        message,
        status: isAdmin ? 'approved' : 'pending',
        createdAt: new Date().toISOString(),
      };
      db.comments.unshift(comment);
      await saveDb(db);
      res.status(201).json({ comment, pendingApproval: comment.status === 'pending' });
    })
  );

  app.patch(
    '/api/admin/comments/:commentId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.comments)) db.comments = [];
      const comment = db.comments.find((c) => c.id === req.params.commentId);
      if (!comment) {
        res.status(404).json({ error: 'Comentario no encontrado.' });
        return;
      }
      comment.status = 'approved';
      await saveDb(db);
      res.json({ comment });
    })
  );

  app.delete(
    '/api/admin/comments/:commentId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!Array.isArray(db.comments)) db.comments = [];
      const before = db.comments.length;
      db.comments = db.comments.filter((c) => c.id !== req.params.commentId);
      if (db.comments.length === before) {
        res.status(404).json({ error: 'Comentario no encontrado.' });
        return;
      }
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // RECLAMOS (Claims: yellow/red cards photo + .mp4 video evidence -> Admin verdict)
  app.post(
    '/api/claims',
    requireAuth,
    uploadClaims.fields([
      { name: 'cardPhoto', maxCount: 1 },
      { name: 'videoFile', maxCount: 1 },
    ]),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const cardPhotoFile = files?.cardPhoto?.[0];
      const videoFile = files?.videoFile?.[0];
      const cleanup = () => {
        safeUnlink(cardPhotoFile?.path);
        safeUnlink(videoFile?.path);
      };

      const reasonRaw = String(req.body?.reasonType || 'juego_sucio').trim();
      const reasonType: Claim['reasonType'] =
        reasonRaw === 'gol_prohibido' || reasonRaw === 'otro' ? reasonRaw : 'juego_sucio';
      const description = String(req.body?.description || '').trim();
      const matchId = String(req.body?.matchId || '').trim() || undefined;
      const accusedTeamId = String(req.body?.accusedTeamId || '').trim() || undefined;
      const externalVideoUrl = String(req.body?.videoUrl || '').trim();

      if (!description) {
        cleanup();
        res.status(400).json({ error: 'Describí el motivo del reclamo (tarjetas, juego sucio o gol prohibido).' });
        return;
      }

      const isAdmin = req.authUser?.role === 'admin';
      let cardPhotoUrl: string | undefined;
      let cardPhotoStatus: ModerationStatus | undefined;

      if (cardPhotoFile) {
        if (!isValidImageFile(cardPhotoFile)) {
          cleanup();
          res.status(400).json({ error: 'La foto de tarjetas o prueba debe ser JPG, PNG o WEBP.' });
          return;
        }
        const mod = await moderateUploadedImage(
          cardPhotoFile.path,
          cardPhotoFile.mimetype,
          'foto de tarjetas amarillas/rojas o jugada de partido PES6 para reclamo deportivo'
        );
        if (!mod.allowed) {
          cleanup();
          res.status(400).json({ error: mod.reason || 'Imagen rechazada por el filtro de contenido.' });
          return;
        }
        cardPhotoUrl = await persistUploadedFile(
          cardPhotoFile.path,
          'claims',
          cardPhotoFile.filename,
          cardPhotoFile.mimetype
        );
        cardPhotoStatus = isAdmin ? 'approved' : 'pending';
      }

      let videoUrl: string | undefined;
      if (videoFile) {
        if (!isValidMp4File(videoFile)) {
          cleanup();
          res.status(400).json({ error: 'Solo se permiten videos en formato .MP4 en toda la página.' });
          return;
        }
        const playable = await ensurePlayableMp4(videoFile.path, '.mp4');
        const finalVideoName = playable || videoFile.filename;
        const finalVideoPath = path.join(path.dirname(videoFile.path), finalVideoName);
        videoUrl = await persistUploadedFile(finalVideoPath, 'claims', finalVideoName, 'video/mp4');
        if (playable) safeUnlink(videoFile.path);
      } else if (externalVideoUrl) {
        const cleanUrl = externalVideoUrl.split('?')[0].toLowerCase();
        if (!cleanUrl.endsWith('.mp4')) {
          cleanup();
          res.status(400).json({ error: 'El video del reclamo debe estar en formato .MP4.' });
          return;
        }
        videoUrl = externalVideoUrl;
      }

      if (!cardPhotoUrl && !videoUrl && description.length < 10) {
        cleanup();
        res.status(400).json({
          error: 'Adjuntá una foto de tarjetas, un video .MP4 o detallá mejor el reclamo.',
        });
        return;
      }

      const accusedTeam = accusedTeamId ? db.teams.find((t) => t.id === accusedTeamId) : undefined;
      const claim: Claim = {
        id: `clm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        matchId,
        reporterTeamId: req.authUser?.teamId || 'ADMIN',
        reporterName: req.authUser?.displayName || 'Miembro',
        accusedTeamId,
        accusedTeamName: accusedTeam ? `${accusedTeam.name} (${accusedTeam.memberName})` : undefined,
        reasonType,
        description,
        cardPhotoUrl,
        cardPhotoStatus,
        videoUrl,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      db.claims.unshift(claim);
      await saveDb(db);
      res.status(201).json({ claim });
    })
  );

  // Admin rules on a Claim (Valid Match / Invalid Match / Dismissed)
  app.patch(
    '/api/admin/claims/:claimId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const claim = db.claims.find((c) => c.id === req.params.claimId);
      if (!claim) {
        res.status(404).json({ error: 'Reclamo no encontrado.' });
        return;
      }

      const nextStatus = req.body?.status;
      if (
        nextStatus === 'valid_match' ||
        nextStatus === 'invalid_match' ||
        nextStatus === 'dismissed' ||
        nextStatus === 'pending'
      ) {
        claim.status = nextStatus;
        claim.resolvedAt = nextStatus === 'pending' ? undefined : new Date().toISOString();
        if (claim.matchId) {
          const linked = db.matches.find((m) => m.id === claim.matchId);
          if (linked) {
            if (nextStatus === 'invalid_match') linked.status = 'rejected';
            if (nextStatus === 'valid_match') {
              linked.status = 'validated';
              linked.validatedAt = new Date().toISOString();
            }
          }
        }
      }
      if (typeof req.body?.adminResolutionNote === 'string') {
        claim.adminResolutionNote = req.body.adminResolutionNote.trim();
      }

      await saveDb(db);
      res.json({ claim });
    })
  );

  app.delete(
    '/api/admin/claims/:claimId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const before = db.claims.length;
      db.claims = db.claims.filter((c) => c.id !== req.params.claimId);
      if (db.claims.length === before) {
        res.status(404).json({ error: 'Reclamo no encontrado.' });
        return;
      }
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // Admin unified media verification (approve or remove ANY uploaded photo across profiles, matches, claims)
  app.patch(
    '/api/admin/moderation/media',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const kind = String(req.body?.kind || '');
      const targetId = String(req.body?.targetId || '');
      const action = req.body?.action === 'remove' ? 'remove' : 'approve';

      if (kind === 'team_celebration') {
        const team = db.teams.find((t) => t.id === targetId);
        if (!team) {
          res.status(404).json({ error: 'Equipo no encontrado.' });
          return;
        }
        if (action === 'remove') {
          team.celebrationImageUrl = undefined;
          team.celebrationStatus = 'rejected';
        } else {
          team.celebrationStatus = 'approved';
        }
      } else if (kind === 'match_proof') {
        const match = db.matches.find((m) => m.id === targetId);
        if (!match) {
          res.status(404).json({ error: 'Partido no encontrado.' });
          return;
        }
        if (action === 'remove') {
          match.proofImageUrl = undefined;
          match.proofImageStatus = 'rejected';
        } else {
          match.proofImageStatus = 'approved';
        }
      } else if (kind === 'match_scorer') {
        const match = db.matches.find((m) => m.id === targetId);
        if (!match) {
          res.status(404).json({ error: 'Partido no encontrado.' });
          return;
        }
        if (action === 'remove') {
          match.scorerImageUrl = undefined;
          match.scorerName = undefined;
          match.scorerImageStatus = 'rejected';
        } else {
          match.scorerImageStatus = 'approved';
        }
      } else if (kind === 'claim_card') {
        const claim = db.claims.find((c) => c.id === targetId);
        if (!claim) {
          res.status(404).json({ error: 'Reclamo no encontrado.' });
          return;
        }
        if (action === 'remove') {
          claim.cardPhotoUrl = undefined;
          claim.cardPhotoStatus = 'rejected';
        } else {
          claim.cardPhotoStatus = 'approved';
        }
      } else if (kind === 'claim_video') {
        const claim = db.claims.find((c) => c.id === targetId);
        if (!claim) {
          res.status(404).json({ error: 'Reclamo no encontrado.' });
          return;
        }
        if (action === 'remove') {
          claim.videoUrl = undefined;
        }
      } else {
        res.status(400).json({ error: 'Tipo de archivo no reconocido.' });
        return;
      }

      await saveDb(db);
      res.json({ ok: true });
    })
  );

  // ImageKit.io authentication parameters for direct member video upload (.mp4 ONLY)
  app.get('/api/imagekit/auth', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    if (!imagekitClient) {
      res.json({
        configured: false,
        publicKey: IMAGEKIT_PUBLIC_KEY,
        urlEndpoint: IMAGEKIT_URL_ENDPOINT,
        folder: IMAGEKIT_VIDEO_FOLDER,
      });
      return;
    }

    const authParams = imagekitClient.getAuthenticationParameters();
    res.json({
      configured: true,
      publicKey: IMAGEKIT_PUBLIC_KEY,
      urlEndpoint: IMAGEKIT_URL_ENDPOINT,
      folder: IMAGEKIT_VIDEO_FOLDER,
      ...authParams,
    });
  });

  // Register a video uploaded directly to ImageKit.io (STRICTLY .MP4)
  app.post(
    '/api/videos/register',
    requireAuth,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const rawUrl = String(req.body?.url || '').trim();
      const filePath = String(req.body?.filePath || '').trim();
      const fileId = String(req.body?.fileId || '').trim();
      const fileName = String(req.body?.fileName || '').trim();
      const title = String(req.body?.title || path.parse(fileName || filePath || 'video').name).trim();
      const description = String(req.body?.description || '').trim();
      const requestedFormat = String(req.body?.originalFormat || '').toUpperCase();

      if (!rawUrl.startsWith(IMAGEKIT_URL_ENDPOINT) && !filePath) {
        res.status(400).json({ error: 'URL de ImageKit inválida para el video.' });
        return;
      }

      const checkSource = (fileName || filePath || rawUrl).split('?')[0].toLowerCase();
      if (requestedFormat === 'AVI' || (!checkSource.endsWith('.mp4') && requestedFormat !== 'MP4')) {
        res.status(400).json({ error: 'Solo se permiten videos en formato .MP4 en toda la página.' });
        return;
      }

      const videoUrl = buildImageKitMp4Url(filePath, rawUrl);
      const downloadUrl = rawUrl || `${IMAGEKIT_URL_ENDPOINT}/${filePath.replace(/^\/+/, '')}`;

      const entry: GalleryVideo = {
        id: `vid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        title: title || 'Jugada Liga Master Argentina',
        description,
        videoUrl,
        downloadUrl,
        imagekitFileId: fileId || undefined,
        originalFormat: 'MP4',
        uploadedBy: req.authUser?.displayName || 'Miembro',
        featured: db.videos.length === 0,
        createdAt: new Date().toISOString(),
      };

      db.videos.unshift(entry);
      await saveDb(db);
      res.status(201).json({ video: entry });
    })
  );

  // Upload gallery video (STRICTLY .MP4)
  app.post(
    '/api/videos',
    requireAuth,
    uploadVideo.single('video'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      if (!req.file) {
        res.status(400).json({ error: 'Seleccioná un archivo de video en formato .MP4.' });
        return;
      }

      if (!isValidMp4File(req.file)) {
        safeUnlink(req.file.path);
        res.status(400).json({ error: 'Solo se permiten videos en formato .MP4 en toda la página.' });
        return;
      }

      const title = String(req.body?.title || path.parse(req.file.originalname).name).trim();
      const description = String(req.body?.description || '').trim();

      let downloadUrl = '';
      let videoUrl = '';
      let imagekitFileId: string | undefined;

      if (imagekitClient) {
        try {
          const uploaded = await imagekitClient.upload({
            file: fs.readFileSync(req.file.path),
            fileName: req.file.originalname,
            folder: IMAGEKIT_VIDEO_FOLDER,
            useUniqueFileName: true,
          });
          safeUnlink(req.file.path);
          downloadUrl = uploaded.url;
          videoUrl = buildImageKitMp4Url(uploaded.filePath, uploaded.url);
          imagekitFileId = uploaded.fileId;
        } catch (err) {
          safeUnlink(req.file.path);
          res.status(502).json({
            error:
              err instanceof Error
                ? `Error subiendo video a ImageKit: ${err.message}`
                : 'Error subiendo video a ImageKit.',
          });
          return;
        }
      } else {
        const playable = await ensurePlayableMp4(req.file.path, '.mp4');
        const finalVideoName = playable || req.file.filename;
        const finalVideoPath = path.join(path.dirname(req.file.path), finalVideoName);
        downloadUrl = await persistUploadedFile(finalVideoPath, 'videos', finalVideoName, 'video/mp4');
        videoUrl = downloadUrl;
        if (playable) safeUnlink(req.file.path);
      }

      const entry: GalleryVideo = {
        id: `vid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        title: title || 'Jugada Liga Master Argentina',
        description,
        videoUrl,
        downloadUrl,
        imagekitFileId,
        originalFormat: 'MP4',
        uploadedBy: req.authUser?.displayName || 'Miembro',
        featured: db.videos.length === 0,
        createdAt: new Date().toISOString(),
      };

      db.videos.unshift(entry);
      await saveDb(db);
      res.status(201).json({ video: entry });
    })
  );

  // Public community videos proxy (reads Firestore videos_comunidad server-side to avoid browser RPC network blocks)
  app.get('/api/community-videos', async (_req: Request, res: Response) => {
    try {
      const firestoreUrl =
        'https://firestore.googleapis.com/v1/projects/liga-master-argentina/databases/(default)/documents:runQuery';
      const response = await fetch(firestoreUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'videos_comunidad' }],
            orderBy: [{ field: { fieldPath: 'fecha' }, direction: 'DESCENDING' }],
          },
        }),
      });

      if (!response.ok) {
        res.status(502).json({ error: `Firestore respondió HTTP ${response.status}.` });
        return;
      }

      const rows = (await response.json()) as Array<{
        document?: {
          name?: string;
          createTime?: string;
          fields?: Record<
            string,
            { stringValue?: string; timestampValue?: string; integerValue?: string }
          >;
        };
      }>;

      const videos = rows
        .filter((row) => Boolean(row.document?.name))
        .map((row) => {
          const docObj = row.document!;
          const fullName = String(docObj.name || '');
          const id = fullName.split('/').pop() || fullName;
          const fields = docObj.fields || {};
          const rawDate = fields.fecha?.timestampValue || docObj.createTime || '';
          const parsedDate = rawDate ? new Date(rawDate) : new Date();
          const validDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
          return {
            id,
            titulo: String(fields.titulo?.stringValue || 'Video de la comunidad'),
            autor: String(fields.autor?.stringValue || 'Miembro'),
            videoUrl: String(fields.videoUrl?.stringValue || ''),
            fechaMs: validDate.getTime(),
            fechaLabel: validDate.toLocaleString('es-AR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
          };
        })
        .sort((a, b) => b.fechaMs - a.fechaMs);

      res.json({ videos });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `No se pudieron cargar los videos de la comunidad (${detail}).` });
    }
  });

  // Admin: select favorite/featured video for Home page (supports community Firestore videos & local videos)
  app.put(
    '/api/admin/featured-video',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const id = String(req.body?.id || '').trim();
      const source = req.body?.source === 'local' ? 'local' : 'community';
      const title = String(req.body?.title || '').trim();
      const author = String(req.body?.author || 'Miembro').trim();
      const videoUrl = String(req.body?.videoUrl || '').trim();
      const downloadUrl = typeof req.body?.downloadUrl === 'string' ? req.body.downloadUrl.trim() : undefined;
      const originalFormat =
        req.body?.originalFormat === 'AVI' || req.body?.originalFormat === 'MP4'
          ? req.body.originalFormat
          : undefined;
      const fechaLabel = typeof req.body?.fechaLabel === 'string' ? req.body.fechaLabel.trim() : undefined;

      if (!id || !title || !videoUrl) {
        res.status(400).json({ error: 'Datos incompletos para destacar el video.' });
        return;
      }

      db.settings.featuredVideo = {
        id,
        source,
        title,
        author,
        videoUrl,
        downloadUrl: downloadUrl || videoUrl,
        originalFormat,
        fechaLabel,
      };

      db.videos = db.videos.map((v) => ({
        ...v,
        featured: source === 'local' && v.id === id,
      }));

      await saveDb(db);
      res.json({ featuredVideo: db.settings.featuredVideo });
    })
  );

  app.delete(
    '/api/admin/featured-video',
    requireAdmin,
    asyncRoute(async (_req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      db.settings.featuredVideo = null;
      db.videos = db.videos.map((v) => ({ ...v, featured: false }));
      await saveDb(db);
      res.json({ featuredVideo: null });
    })
  );

  app.patch(
    '/api/admin/videos/:videoId/featured',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const targetId = String(req.params.videoId || '');
      const target = db.videos.find((v) => v.id === targetId);
      if (!target) {
        res.status(404).json({ error: 'Video no encontrado.' });
        return;
      }
      db.videos = db.videos.map((v) => ({
        ...v,
        featured: v.id === targetId,
      }));
      db.settings.featuredVideo = {
        id: target.id,
        source: 'local',
        title: target.title,
        author: target.uploadedBy,
        videoUrl: target.videoUrl,
        downloadUrl: target.downloadUrl,
        originalFormat: target.originalFormat,
      };
      await saveDb(db);
      res.json({ featuredId: targetId, featuredVideo: db.settings.featuredVideo });
    })
  );

  app.patch(
    '/api/admin/videos/:videoId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const video = db.videos.find((v) => v.id === req.params.videoId);
      if (!video) {
        res.status(404).json({ error: 'Video no encontrado.' });
        return;
      }
      if (typeof req.body?.title === 'string' && req.body.title.trim()) {
        video.title = req.body.title.trim();
      }
      if (typeof req.body?.description === 'string') {
        video.description = req.body.description.trim();
      }
      if (db.settings.featuredVideo?.id === video.id) {
        db.settings.featuredVideo.title = video.title;
      }
      await saveDb(db);
      res.json({ video });
    })
  );

  app.delete(
    '/api/admin/videos/:videoId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const target = db.videos.find((v) => v.id === req.params.videoId);
      if (!target) {
        res.status(404).json({ error: 'Video no encontrado.' });
        return;
      }
      if (target.imagekitFileId && imagekitClient) {
        await imagekitClient.deleteFile(target.imagekitFileId).catch(() => undefined);
      }
      db.videos = db.videos.filter((v) => v.id !== req.params.videoId);
      if (db.settings.featuredVideo?.id === target.id) {
        db.settings.featuredVideo = null;
      }
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // Champions History (PNG celebration image — STRICTLY Admin only)
  app.post(
    '/api/champions',
    requireAdmin,
    uploadChampion.single('celebrationImage'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const season = String(req.body?.season || '').trim();
      const teamName = String(req.body?.teamName || '').trim();
      const memberName = String(req.body?.memberName || '').trim();
      const notes = String(req.body?.notes || '').trim();
      const rawType = String(req.body?.tournamentType || 'liga').trim();
      const tournamentType: 'liga' | 'copa' | 'recopa' =
        rawType === 'copa' ? 'copa' : rawType === 'recopa' ? 'recopa' : 'liga';

      if (!season || !teamName || !memberName) {
        safeUnlink(req.file?.path);
        res.status(400).json({ error: 'Completá Temporada, Equipo Campeón y Nombre del Miembro.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'Subí una imagen PNG de los festejos.' });
        return;
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.png' && req.file.mimetype !== 'image/png') {
        safeUnlink(req.file.path);
        res.status(400).json({ error: 'La imagen de los festejos debe estar en formato PNG.' });
        return;
      }

      const celebrationImageUrl = await persistUploadedFile(
        req.file.path,
        'champions',
        req.file.filename,
        'image/png'
      );

      const matchedTeam = findTeamForChampion(db.teams, { teamName, memberName });
      const entry: ChampionEntry = {
        id: `champ_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        season,
        teamId: matchedTeam?.id,
        teamName,
        memberName,
        tournamentType,
        notes,
        celebrationImageUrl,
        createdAt: new Date().toISOString(),
      };

      db.champions.unshift(entry);
      awardTeamTrophy(db, {
        teamId: matchedTeam?.id,
        teamName,
        memberName,
        type: tournamentType,
        season,
        celebrationImageUrl: entry.celebrationImageUrl,
        sourceKey: `champ_${entry.id}`,
      });
      await saveDb(db);
      res.status(201).json({ champion: entry });
    })
  );

  app.put(
    '/api/admin/champions/:champId',
    requireAdmin,
    uploadChampion.single('celebrationImage'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const champ = db.champions.find((c) => c.id === req.params.champId);
      if (!champ) {
        safeUnlink(req.file?.path);
        res.status(404).json({ error: 'Registro de campeón no encontrado.' });
        return;
      }

      if (req.file) {
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (ext !== '.png' && req.file.mimetype !== 'image/png') {
          safeUnlink(req.file.path);
          res.status(400).json({ error: 'La imagen de los festejos debe estar en formato PNG.' });
          return;
        }
        champ.celebrationImageUrl = await persistUploadedFile(
          req.file.path,
          'champions',
          req.file.filename,
          'image/png'
        );
      }

      if (typeof req.body?.season === 'string' && req.body.season.trim()) {
        champ.season = req.body.season.trim();
      }
      if (typeof req.body?.teamName === 'string' && req.body.teamName.trim()) {
        champ.teamName = req.body.teamName.trim();
      }
      if (typeof req.body?.memberName === 'string' && req.body.memberName.trim()) {
        champ.memberName = req.body.memberName.trim();
      }
      if (typeof req.body?.tournamentType === 'string') {
        const t = req.body.tournamentType.trim();
        if (t === 'liga' || t === 'copa' || t === 'recopa') {
          champ.tournamentType = t;
        }
      }
      if (typeof req.body?.notes === 'string') {
        champ.notes = req.body.notes.trim();
      }

      const matchedTeam = findTeamForChampion(db.teams, {
        teamId: champ.teamId,
        teamName: champ.teamName,
        memberName: champ.memberName,
      });
      champ.teamId = matchedTeam?.id;
      awardTeamTrophy(db, {
        teamId: matchedTeam?.id,
        teamName: champ.teamName,
        memberName: champ.memberName,
        type: champ.tournamentType || 'liga',
        season: champ.season,
        sourceKey: `champ_${champ.id}`,
      });

      await saveDb(db);
      res.json({ champion: champ });
    })
  );

  app.delete(
    '/api/admin/champions/:champId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const before = db.champions.length;
      db.champions = db.champions.filter((c) => c.id !== req.params.champId);
      if (db.champions.length === before) {
        res.status(404).json({ error: 'Registro no encontrado.' });
        return;
      }
      removeTrophyBySourceKey(db, `champ_${req.params.champId}`);
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // Admin: update Rules & Game Mode & Cup Rules
  app.put(
    '/api/admin/rules',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const { prohibitedRules, generalNotes, gameMode, cupRules } = req.body as Partial<RulesConfig>;
      if (Array.isArray(prohibitedRules)) {
        db.rules.prohibitedRules = prohibitedRules.map((r) => String(r).trim()).filter(Boolean);
      }
      if (typeof generalNotes === 'string') {
        db.rules.generalNotes = generalNotes.trim();
      }
      if (gameMode && typeof gameMode === 'object') {
        db.rules.gameMode = {
          partidos: String(gameMode.partidos ?? db.rules.gameMode.partidos).trim(),
          tiempo: String(gameMode.tiempo ?? db.rules.gameMode.tiempo).trim(),
          condicion: String(gameMode.condicion ?? db.rules.gameMode.condicion).trim(),
          lesiones: String(gameMode.lesiones ?? db.rules.gameMode.lesiones).trim(),
          cambios: String(gameMode.cambios ?? db.rules.gameMode.cambios).trim(),
          pausas: String(gameMode.pausas ?? db.rules.gameMode.pausas).trim(),
          clima: String(gameMode.clima ?? db.rules.gameMode.clima).trim(),
        };
      }
      if (cupRules && typeof cupRules === 'object') {
        const current = db.rules.cupRules || defaultCupRules();
        db.rules.cupRules = {
          format: String(cupRules.format ?? current.format).trim(),
          extraTime: String(cupRules.extraTime ?? current.extraTime).trim(),
          penalties: String(cupRules.penalties ?? current.penalties).trim(),
          notes: String(cupRules.notes ?? current.notes).trim(),
        };
      }
      await saveDb(db);
      res.json({ rules: db.rules });
    })
  );

  // =========================================================================
  // Admin: Copa de la Liga (16 equipos, llaves 8vos->4tos->Semis->Final + Recopa)
  // =========================================================================

  app.put(
    '/api/admin/cup/settings',
    requireAdmin,
    uploadCrest.single('championCrest'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const cup = db.cup;

      if (typeof req.body?.editionName === 'string' && req.body.editionName.trim()) {
        cup.editionName = req.body.editionName.trim();
      }
      if (req.body?.editionNumber !== undefined) {
        const n = Number(req.body.editionNumber);
        if (Number.isInteger(n) && n >= 1) cup.editionNumber = n;
      }
      if (req.body?.status === 'in_progress' || req.body?.status === 'finished') {
        cup.status = req.body.status;
      }
      if (typeof req.body?.championTeamName === 'string') {
        cup.championTeamName = req.body.championTeamName.trim();
        if (cup.championTeamName) {
          cup.recopa.cupChampionName = cup.championTeamName;
        }
      }
      if (typeof req.body?.championMemberName === 'string') {
        cup.championMemberName = req.body.championMemberName.trim();
        if (cup.championMemberName) {
          cup.recopa.cupChampionMember = cup.championMemberName;
        }
      }
      if (typeof req.body?.championGreeting === 'string' && req.body.championGreeting.trim()) {
        cup.championGreeting = req.body.championGreeting.trim();
      }
      if (req.file) {
        if (!isValidImageFile(req.file)) {
          safeUnlink(req.file.path);
          res.status(400).json({ error: 'El escudo debe ser una imagen válida (PNG, JPG, WEBP).' });
          return;
        }
        const finalName = await normalizePng128(req.file.path);
        const finalPath = path.join(path.dirname(req.file.path), finalName);
        cup.championCrestUrl = await persistUploadedFile(
          finalPath,
          'crests',
          finalName,
          finalName.endsWith('.png') ? 'image/png' : req.file.mimetype
        );
        cup.recopa.cupChampionCrestUrl = cup.championCrestUrl;
      }

      cup.updatedAt = new Date().toISOString();
      await saveDb(db);
      res.json({ cup });
    })
  );

  // Update a single Cup participant slot (1..16) with optional PNG 128x128 crest — NEVER mutates db.teams
  app.put(
    '/api/admin/cup/participants/:slot',
    requireAdmin,
    uploadCrest.single('crest'),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const slot = Number(req.params.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 16) {
        safeUnlink(req.file?.path);
        res.status(400).json({ error: 'El cupo debe estar entre 1 y 16.' });
        return;
      }

      const participant = db.cup.participants.find((p) => p.slot === slot);
      if (!participant) {
        safeUnlink(req.file?.path);
        res.status(404).json({ error: 'Cupo de copa no encontrado.' });
        return;
      }

      if (typeof req.body?.teamId === 'string') {
        const tid = req.body.teamId.trim();
        if (tid) {
          const foundTeam = db.teams.find((t) => t.id === tid);
          if (foundTeam) {
            participant.teamId = foundTeam.id;
            if (!req.body?.teamName) participant.teamName = foundTeam.name;
            if (!req.body?.memberName) participant.memberName = foundTeam.memberName;
            if (!req.file && (!req.body?.crestUrl || typeof req.body.crestUrl !== 'string')) {
              participant.crestUrl = foundTeam.crestUrl;
            }
          }
        } else {
          participant.teamId = undefined;
        }
      }

      if (typeof req.body?.teamName === 'string' && req.body.teamName.trim()) {
        participant.teamName = req.body.teamName.trim();
      }
      if (typeof req.body?.memberName === 'string' && req.body.memberName.trim()) {
        participant.memberName = req.body.memberName.trim();
      }
      if (typeof req.body?.crestUrl === 'string' && req.body.crestUrl.trim()) {
        participant.crestUrl = req.body.crestUrl.trim();
      }

      if (req.file) {
        if (!isValidImageFile(req.file)) {
          safeUnlink(req.file.path);
          res.status(400).json({ error: 'El escudo debe ser una imagen válida (se convierte a PNG 128x128).' });
          return;
        }
        const finalName = await normalizePng128(req.file.path);
        const finalPath = path.join(path.dirname(req.file.path), finalName);
        participant.crestUrl = await persistUploadedFile(
          finalPath,
          'crests',
          finalName,
          finalName.endsWith('.png') ? 'image/png' : req.file.mimetype
        );
      }

      syncCupNodeNames(db.cup);
      db.cup.updatedAt = new Date().toISOString();
      await saveDb(db);
      res.json({ cup: db.cup, participant });
    })
  );

  // Clear/remove participant from a cup slot (1..16)
  app.delete(
    '/api/admin/cup/participants/:slot',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const slot = Number(req.params.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 16) {
        res.status(400).json({ error: 'El cupo debe estar entre 1 y 16.' });
        return;
      }

      const participant = db.cup.participants.find((p) => p.slot === slot);
      if (!participant) {
        res.status(404).json({ error: 'Cupo no encontrado.' });
        return;
      }

      participant.teamId = undefined;
      participant.teamName = `Cupo Libre #${slot}`;
      participant.memberName = 'Por definir';
      participant.crestUrl = '';

      for (const m of db.cup.matches) {
        if (m.round !== 'r16') {
          if (m.homeSlot === slot) m.homeSlot = null;
          if (m.awaySlot === slot) m.awaySlot = null;
        }
        if (m.winnerSlot === slot) m.winnerSlot = null;
      }
      if (db.cup.championSlot === slot) {
        db.cup.championSlot = null;
        db.cup.championTeamName = '';
        db.cup.championMemberName = '';
        db.cup.championCrestUrl = '';
      }

      syncCupNodeNames(db.cup);
      db.cup.updatedAt = new Date().toISOString();
      await saveDb(db);
      res.json({ cup: db.cup });
    })
  );

  // Swap two participant slots (1..16) to move members anywhere in the bracket
  app.post(
    '/api/admin/cup/participants/swap',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const slotA = Number(req.body?.slotA);
      const slotB = Number(req.body?.slotB);
      if (
        !Number.isInteger(slotA) ||
        !Number.isInteger(slotB) ||
        slotA < 1 ||
        slotA > 16 ||
        slotB < 1 ||
        slotB > 16 ||
        slotA === slotB
      ) {
        res.status(400).json({ error: 'Seleccioná dos puestos distintos entre 1 y 16 para intercambiar.' });
        return;
      }

      const pA = db.cup.participants.find((p) => p.slot === slotA);
      const pB = db.cup.participants.find((p) => p.slot === slotB);
      if (!pA || !pB) {
        res.status(404).json({ error: 'Cupo no encontrado.' });
        return;
      }

      const temp = {
        teamId: pA.teamId,
        teamName: pA.teamName,
        memberName: pA.memberName,
        crestUrl: pA.crestUrl,
      };
      pA.teamId = pB.teamId;
      pA.teamName = pB.teamName;
      pA.memberName = pB.memberName;
      pA.crestUrl = pB.crestUrl;

      pB.teamId = temp.teamId;
      pB.teamName = temp.teamName;
      pB.memberName = temp.memberName;
      pB.crestUrl = temp.crestUrl;

      syncCupNodeNames(db.cup);
      db.cup.updatedAt = new Date().toISOString();
      await saveDb(db);
      res.json({ cup: db.cup });
    })
  );

  // Auto-seed Top 16 from League Standings into the Cup slots
  app.post(
    '/api/admin/cup/seed-standings',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const mode = req.body?.mode === 'sequential' ? 'sequential' : 'seeded';
      const ranked = getRankedStandingsTeams(db.teams, db.matches).slice(0, 16);

      // Classic 16-team bracket seeding pairs (1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15)
      const seededOrder = [0, 15, 7, 8, 4, 11, 3, 12, 2, 13, 5, 10, 6, 9, 1, 14];

      db.cup.participants = Array.from({ length: 16 }, (_, idx) => {
        const slot = idx + 1;
        const teamIdx = mode === 'seeded' ? seededOrder[idx] : idx;
        const t = ranked[teamIdx];
        if (t) {
          return {
            slot,
            teamId: t.id,
            teamName: t.name,
            memberName: t.memberName,
            crestUrl: t.crestUrl,
          };
        }
        return {
          slot,
          teamName: `Cupo Libre #${slot}`,
          memberName: 'Por definir',
          crestUrl: '',
        };
      });

      syncCupNodeNames(db.cup);
      db.cup.updatedAt = new Date().toISOString();
      await saveDb(db);
      res.json({ cup: db.cup });
    })
  );

  // Update a Cup match node (scores, ET, penalties, manual slot overrides, auto-advance winner)
  app.put(
    '/api/admin/cup/matches/:matchId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const match = db.cup.matches.find((m) => m.id === req.params.matchId);
      if (!match) {
        res.status(404).json({ error: 'Llave de copa no encontrada.' });
        return;
      }

      if (req.body?.homeSlot !== undefined) {
        match.homeSlot = req.body.homeSlot === null || req.body.homeSlot === '' ? null : Number(req.body.homeSlot);
      }
      if (req.body?.awaySlot !== undefined) {
        match.awaySlot = req.body.awaySlot === null || req.body.awaySlot === '' ? null : Number(req.body.awaySlot);
      }

      const parseNullableNum = (v: unknown): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 ? n : null;
      };

      if (req.body?.homeGoals !== undefined) match.homeGoals = parseNullableNum(req.body.homeGoals);
      if (req.body?.awayGoals !== undefined) match.awayGoals = parseNullableNum(req.body.awayGoals);
      if (req.body?.homePenalties !== undefined) match.homePenalties = parseNullableNum(req.body.homePenalties);
      if (req.body?.awayPenalties !== undefined) match.awayPenalties = parseNullableNum(req.body.awayPenalties);
      if (typeof req.body?.extraTime === 'boolean') match.extraTime = req.body.extraTime;
      if (typeof req.body?.scheduledDate === 'string') {
        match.scheduledDate = req.body.scheduledDate.trim() || undefined;
      }
      if (typeof req.body?.scheduledTime === 'string') {
        match.scheduledTime = req.body.scheduledTime.trim() || undefined;
      }

      if (req.body?.winnerSlot !== undefined) {
        match.winnerSlot =
          req.body.winnerSlot === null || req.body.winnerSlot === '' ? null : Number(req.body.winnerSlot);
      } else if (match.homeGoals !== null && match.awayGoals !== null) {
        if (match.homeGoals > match.awayGoals && match.homeSlot) {
          match.winnerSlot = match.homeSlot;
        } else if (match.awayGoals > match.homeGoals && match.awaySlot) {
          match.winnerSlot = match.awaySlot;
        } else if (
          match.homeGoals === match.awayGoals &&
          match.homePenalties !== null &&
          match.awayPenalties !== null
        ) {
          if (match.homePenalties > match.awayPenalties && match.homeSlot) {
            match.winnerSlot = match.homeSlot;
          } else if (match.awayPenalties > match.homePenalties && match.awaySlot) {
            match.winnerSlot = match.awaySlot;
          }
        }
      } else if (
        match.winnerSlot !== null &&
        match.winnerSlot !== match.homeSlot &&
        match.winnerSlot !== match.awaySlot
      ) {
        match.winnerSlot = null;
      }

      if (typeof req.body?.played === 'boolean') {
        match.played = req.body.played;
      } else {
        match.played = Boolean(match.winnerSlot || (match.homeGoals !== null && match.awayGoals !== null));
      }

      propagateCupMatchWinner(db.cup, match);
      if (match.id === 'final') {
        const sourceKey = `cup_${db.cup.editionNumber}`;
        if (db.cup.championTeamName) {
          const winnerParticipant = db.cup.participants.find((p) => p.slot === db.cup.championSlot);
          awardTeamTrophy(db, {
            teamId: winnerParticipant?.teamId,
            teamName: db.cup.championTeamName,
            memberName: db.cup.championMemberName,
            type: 'copa',
            season: db.cup.editionName || `Edición #${db.cup.editionNumber}`,
            sourceKey,
          });
        } else {
          removeTrophyBySourceKey(db, sourceKey);
        }
      }
      db.cup.updatedAt = new Date().toISOString();
      await saveDb(db);
      res.json({ cup: db.cup, match });
    })
  );

  // Update Recopa Final (League Champion vs Cup Champion -> Gran Campeón de la Liga Master Argentina)
  app.put(
    '/api/admin/cup/recopa',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const recopa = db.cup.recopa;

      if (req.body?.clearLeague) {
        recopa.leagueChampionName = '';
        recopa.leagueChampionMember = '';
        recopa.leagueChampionCrestUrl = '';
        recopa.leagueGoals = null;
        recopa.leaguePenalties = null;
        if (recopa.grandChampionSide === 'league') {
          recopa.grandChampionSide = null;
          recopa.grandChampionName = '';
          recopa.grandChampionMember = '';
          recopa.grandChampionCrestUrl = '';
          recopa.played = false;
        }
      }

      if (req.body?.clearCup) {
        recopa.cupChampionName = '';
        recopa.cupChampionMember = '';
        recopa.cupChampionCrestUrl = '';
        recopa.cupGoals = null;
        recopa.cupPenalties = null;
        if (recopa.grandChampionSide === 'cup') {
          recopa.grandChampionSide = null;
          recopa.grandChampionName = '';
          recopa.grandChampionMember = '';
          recopa.grandChampionCrestUrl = '';
          recopa.played = false;
        }
      }

      if (req.body?.pullLeagueLeader) {
        const ranked = getRankedStandingsTeams(db.teams, db.matches);
        if (ranked[0]) {
          recopa.leagueChampionName = ranked[0].name;
          recopa.leagueChampionMember = ranked[0].memberName;
          recopa.leagueChampionCrestUrl = ranked[0].crestUrl;
        }
      }

      if (typeof req.body?.leagueTeamId === 'string' && req.body.leagueTeamId.trim()) {
        const found = db.teams.find((t) => t.id === req.body.leagueTeamId.trim());
        if (found) {
          recopa.leagueChampionName = found.name;
          recopa.leagueChampionMember = found.memberName;
          recopa.leagueChampionCrestUrl = found.crestUrl;
        }
      }

      if (typeof req.body?.cupTeamId === 'string' && req.body.cupTeamId.trim()) {
        const found = db.teams.find((t) => t.id === req.body.cupTeamId.trim());
        if (found) {
          recopa.cupChampionName = found.name;
          recopa.cupChampionMember = found.memberName;
          recopa.cupChampionCrestUrl = found.crestUrl;
        }
      }

      if (typeof req.body?.leagueChampionName === 'string') {
        recopa.leagueChampionName = req.body.leagueChampionName.trim();
      }
      if (typeof req.body?.leagueChampionMember === 'string') {
        recopa.leagueChampionMember = req.body.leagueChampionMember.trim();
      }
      if (typeof req.body?.leagueChampionCrestUrl === 'string') {
        recopa.leagueChampionCrestUrl = req.body.leagueChampionCrestUrl.trim();
      }
      if (typeof req.body?.cupChampionName === 'string') {
        recopa.cupChampionName = req.body.cupChampionName.trim();
      }
      if (typeof req.body?.cupChampionMember === 'string') {
        recopa.cupChampionMember = req.body.cupChampionMember.trim();
      }
      if (typeof req.body?.cupChampionCrestUrl === 'string') {
        recopa.cupChampionCrestUrl = req.body.cupChampionCrestUrl.trim();
      }

      const parseNullableNum = (v: unknown): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 ? n : null;
      };

      if (req.body?.leagueGoals !== undefined) recopa.leagueGoals = parseNullableNum(req.body.leagueGoals);
      if (req.body?.cupGoals !== undefined) recopa.cupGoals = parseNullableNum(req.body.cupGoals);
      if (req.body?.leaguePenalties !== undefined) {
        recopa.leaguePenalties = parseNullableNum(req.body.leaguePenalties);
      }
      if (req.body?.cupPenalties !== undefined) {
        recopa.cupPenalties = parseNullableNum(req.body.cupPenalties);
      }
      if (typeof req.body?.extraTime === 'boolean') recopa.extraTime = req.body.extraTime;

      let side: 'league' | 'cup' | null = recopa.grandChampionSide;
      if (req.body?.grandChampionSide === 'league' || req.body?.grandChampionSide === 'cup' || req.body?.grandChampionSide === null) {
        side = req.body.grandChampionSide;
      } else if (recopa.leagueGoals !== null && recopa.cupGoals !== null) {
        if (recopa.leagueGoals > recopa.cupGoals) side = 'league';
        else if (recopa.cupGoals > recopa.leagueGoals) side = 'cup';
        else if (recopa.leaguePenalties !== null && recopa.cupPenalties !== null) {
          if (recopa.leaguePenalties > recopa.cupPenalties) side = 'league';
          else if (recopa.cupPenalties > recopa.leaguePenalties) side = 'cup';
        }
      }

      recopa.grandChampionSide = side;
      if (side === 'league' && recopa.leagueChampionName) {
        recopa.grandChampionName = recopa.leagueChampionName;
        recopa.grandChampionMember = recopa.leagueChampionMember;
        recopa.grandChampionCrestUrl = recopa.leagueChampionCrestUrl;
        recopa.played = true;
      } else if (side === 'cup' && recopa.cupChampionName) {
        recopa.grandChampionName = recopa.cupChampionName;
        recopa.grandChampionMember = recopa.cupChampionMember;
        recopa.grandChampionCrestUrl = recopa.cupChampionCrestUrl;
        recopa.played = true;
      } else if (typeof req.body?.grandChampionName === 'string') {
        recopa.grandChampionName = req.body.grandChampionName.trim();
        recopa.grandChampionMember = typeof req.body?.grandChampionMember === 'string'
          ? req.body.grandChampionMember.trim()
          : '';
        recopa.played = Boolean(recopa.grandChampionName);
      } else {
        recopa.grandChampionSide = null;
        recopa.grandChampionName = '';
        recopa.grandChampionMember = '';
        recopa.grandChampionCrestUrl = '';
        recopa.played = false;
      }

      if (typeof req.body?.greeting === 'string') {
        recopa.greeting = req.body.greeting.trim() || '¡Felicitaciones Campeón de la Recopa!';
      } else if (!recopa.greeting) {
        recopa.greeting = '¡Felicitaciones Campeón de la Recopa!';
      }
      if (typeof req.body?.scheduledDate === 'string') {
        recopa.scheduledDate = req.body.scheduledDate.trim() || undefined;
      }
      if (typeof req.body?.scheduledTime === 'string') {
        recopa.scheduledTime = req.body.scheduledTime.trim() || undefined;
      }

      const recopaSourceKey = `recopa_${db.cup.editionNumber}`;
      if (recopa.played && recopa.grandChampionName) {
        awardTeamTrophy(db, {
          teamName: recopa.grandChampionName,
          memberName: recopa.grandChampionMember,
          type: 'recopa',
          season: `Recopa · ${db.cup.editionName || `Edición #${db.cup.editionNumber}`}`,
          sourceKey: recopaSourceKey,
        });
      } else {
        removeTrophyBySourceKey(db, recopaSourceKey);
      }

      db.cup.updatedAt = new Date().toISOString();
      await saveDb(db);
      res.json({ cup: db.cup });
    })
  );

  // Reset cup from scratch to start the next edition
  app.post(
    '/api/admin/cup/reset',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const clearParticipants = req.body?.clearParticipants !== false;
      const nextEdition = (db.cup?.editionNumber || 1) + 1;
      const ranked = getRankedStandingsTeams(db.teams, db.matches);
      const freshCup = createInitialCup(nextEdition, [], ranked[0]);

      if (!clearParticipants && db.cup?.participants?.length === 16) {
        freshCup.participants = db.cup.participants.map((p) => ({ ...p }));
        syncCupNodeNames(freshCup);
      }

      if (typeof req.body?.editionName === 'string' && req.body.editionName.trim()) {
        freshCup.editionName = req.body.editionName.trim();
      }

      db.cup = freshCup;
      await saveDb(db);
      res.json({ cup: db.cup });
    })
  );

  // Admin: add one or multiple music tracks (upload MP3/audio files OR provide external URL)
  app.post(
    '/api/admin/music',
    requireAdmin,
    uploadMusic.array('audio', 30),
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      const customTitle = String(req.body?.title || '').trim();
      const customArtist = String(req.body?.artist || '').trim();
      const externalUrl = String(req.body?.audioUrl || '').trim();

      if (files.length === 0 && !externalUrl) {
        res.status(400).json({ error: 'Seleccioná uno o más archivos MP3 (o pegá una URL de audio).' });
        return;
      }

      const addedTracks: MusicTrack[] = [];

      for (const file of files) {
        const rawName = path.parse(file.originalname).name.replace(/[_-]+/g, ' ').trim();
        const coverUrl = await extractAndSaveMp3Cover(file.path);
        const audioUrl = await persistUploadedFile(
          file.path,
          'music',
          file.filename,
          file.mimetype || inferMimeTypeFromPath(file.filename)
        );
        const track: MusicTrack = {
          id: `trk_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          title: customTitle && files.length === 1 ? customTitle : rawName || 'Canción MP3',
          artist: customArtist || 'Liga Master Argentina',
          audioUrl,
          ...(coverUrl ? { coverUrl } : {}),
          createdAt: new Date().toISOString(),
        };
        db.music.push(track);
        addedTracks.push(track);
      }

      if (files.length === 0 && externalUrl) {
        const track: MusicTrack = {
          id: `trk_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          title: customTitle || 'Pista de Liga',
          artist: customArtist || 'Liga Master Argentina',
          audioUrl: externalUrl,
          createdAt: new Date().toISOString(),
        };
        db.music.push(track);
        addedTracks.push(track);
      }

      await saveDb(db);
      res.status(201).json({ tracks: addedTracks, track: addedTracks[0] });
    })
  );

  app.delete(
    '/api/admin/music/:trackId',
    requireAdmin,
    asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
      const db = await loadDb({ fresh: true });
      const before = db.music.length;
      db.music = db.music.filter((t) => t.id !== req.params.trackId);
      if (db.music.length === before) {
        res.status(404).json({ error: 'Canción no encontrada.' });
        return;
      }
      await saveDb(db);
      res.json({ deleted: true });
    })
  );

  // Unmatched /api routes always return JSON (never fall through to HTML 404)
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      error: `Ruta API no encontrada (${req.method} ${req.originalUrl}).`,
    });
  });

  // Ensure API errors always return JSON instead of falling through to HTML
  app.use('/api', (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API error:', err);
    const status =
      (err as { status?: number; statusCode?: number }).status ||
      (err as { status?: number; statusCode?: number }).statusCode ||
      500;
    res.status(status).json({ error: err.message || 'Error procesando la solicitud en el servidor.' });
  });

  return app;
}

let cachedExpressApp: express.Express | null = null;

export async function getExpressApp(): Promise<express.Express> {
  if (!cachedExpressApp) {
    cachedExpressApp = buildApiApp();
    // Warm up database connection and automatic seed check without blocking errors
    await loadDb().catch((err) => {
      console.error('Error inicializando base de datos:', err);
    });
  }
  return cachedExpressApp;
}

async function startServer() {
  const app = buildApiApp();
  const httpServer = http.createServer(app);

  // Frontend serving (Vite middleware in dev, static dist in production)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        ws: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use('/LMA-pes6-ai-studio', express.static(distDir));
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Liga Master Argentina PES6 corriendo en http://0.0.0.0:${PORT} (${
        isSupabaseDbConfigured() ? 'Supabase PostgreSQL + Storage' : 'Archivo local data/league.json'
      })`
    );
  });
}

if (!IS_VERCEL && !process.env.SKIP_SERVER_LISTEN) {
  startServer().catch((err) => {
    console.error('Error iniciando servidor:', err);
    process.exit(1);
  });
}

