import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  formatFirestoreError,
  handleFirestoreError,
  isBootstrappedAdminEmail,
  notifyCommunityVideosChanged,
  OperationType,
} from '../firebase';
import type {
  AccountStatus,
  BackupSummary,
  CalendarCategory,
  CalendarEvent,
  ChampionEntry,
  Claim,
  ClaimReasonType,
  ClaimStatus,
  CredentialAuditEntry,
  CupTournament,
  FeaturedVideoSelection,
  GalleryVideo,
  LastListenedTrack,
  LeagueBackupRecord,
  LeagueBootstrap,
  LeagueComment,
  LeagueSettings,
  Match,
  MemberInvite,
  ModerationStatus,
  MusicTrack,
  NewsPost,
  PublicTeam,
  RulesConfig,
  SaveConfirmationStatus,
  ScheduledFixture,
  Team,
  TeamTrophy,
  TopGoalItem,
} from '../types';
import { apiFetch } from '../utils/api';
import { buildInlineTeamCrestSvg } from '../utils/assetUrl';
import { sanitizeCustomTitles } from '../utils/customTitles';
import { computeStandings } from '../utils/standings';
import {
  buildChampionHallEntry,
  buildChampionNewspaperPost,
  buildEmptyCup,
  buildTrophyEntry,
  NEXT_STAGE_MAP,
  recomputeCupBracket,
} from './cupHelpers';

// --- Save Status Bus (Server-Confirmed Feedback) ---
type SaveListener = (status: SaveConfirmationStatus) => void;
const saveListeners = new Set<SaveListener>();
let currentSaveStatus: SaveConfirmationStatus = { state: 'idle', message: '' };
let clearSaveTimer: number | null = null;

function emitSaveStatus(next: SaveConfirmationStatus) {
  currentSaveStatus = next;
  for (const cb of saveListeners) {
    cb(next);
  }
  if (typeof window !== 'undefined') {
    if (clearSaveTimer) {
      window.clearTimeout(clearSaveTimer);
      clearSaveTimer = null;
    }
    if (next.state === 'saved') {
      clearSaveTimer = window.setTimeout(() => {
        emitSaveStatus({ state: 'idle', message: '' });
      }, 3600);
    }
  }
}

export function subscribeSaveStatus(cb: SaveListener): () => void {
  saveListeners.add(cb);
  cb(currentSaveStatus);
  return () => {
    saveListeners.delete(cb);
  };
}

function clamp(val: unknown, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

function stripUndefined<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return obj;
}

export function safeDocId(raw: string, fallbackPrefix = 'doc'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 100);
  if (cleaned) return cleaned;
  return `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function runConfirmedWrite<T>(
  opLabel: string,
  operationType: OperationType,
  path: string,
  fn: () => Promise<T>
): Promise<T> {
  emitSaveStatus({ state: 'saving', message: `${opLabel}...`, timestamp: Date.now() });
  try {
    const result = await fn();
    emitSaveStatus({
      state: 'saved',
      message: `${opLabel} · Guardado confirmado en Cloud Firestore`,
      timestamp: Date.now(),
    });
    return result;
  } catch (err) {
    const readable = formatFirestoreError(err, operationType, path);
    emitSaveStatus({ state: 'error', message: readable, timestamp: Date.now() });
    try {
      handleFirestoreError(err, operationType, path);
    } catch {
      // Logged structured error; throw readable UI error below
    }
    throw new Error(readable);
  }
}

export function requireVerifiedFirebaseUser() {
  const u = auth.currentUser;
  if (!u || !u.emailVerified) {
    throw new Error(
      'Necesitás iniciar sesión con Google (Firebase Auth) para guardar cambios en la base de datos permanente.'
    );
  }
  return u;
}

async function logAuditEntry(entry: Omit<CredentialAuditEntry, 'id' | 'createdAt'>): Promise<void> {
  const id = safeDocId(`aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const docData: CredentialAuditEntry = stripUndefined({
    id,
    action: entry.action,
    targetType: entry.targetType,
    targetId: clamp(entry.targetId, 64) || 'system',
    targetLabel: clamp(entry.targetLabel, 140),
    details: clamp(entry.details, 600) || 'Operación registrada',
    performedBy: clamp(entry.performedBy, 120) || 'Admin',
    createdAt: new Date().toISOString(),
  });
  await setDoc(doc(db, 'audit_log', id), docData);
}

// --- Idempotent Initial Migration from Legacy JSON / Legacy Community Videos ---
let seedInFlight: Promise<boolean> | null = null;

export async function ensureInitialFirestoreSeed(): Promise<boolean> {
  if (seedInFlight) return seedInFlight;
  seedInFlight = (async () => {
    const user = auth.currentUser;
    if (!user || !user.emailVerified || !isBootstrappedAdminEmail(user.email)) {
      return false;
    }

    // Multi-collection guard: NEVER overwrite or re-seed if any real data already exists
    const metaRef = doc(db, 'league_meta', 'bootstrap_state');
    const settingsRef = doc(db, 'league_settings', 'global');
    const [metaSnap, existingSettingsSnap, existingTeamsSnap, existingMatchesSnap, existingNewsSnap] =
      await Promise.all([
        getDocFromServer(metaRef),
        getDocFromServer(settingsRef),
        getDocsFromServer(query(collection(db, 'teams'), limit(1))),
        getDocsFromServer(query(collection(db, 'matches'), limit(1))),
        getDocsFromServer(query(collection(db, 'news'), limit(1))),
      ]);

    const hasExistingData =
      metaSnap.exists() ||
      existingSettingsSnap.exists() ||
      !existingTeamsSnap.empty ||
      !existingMatchesSnap.empty ||
      !existingNewsSnap.empty;

    if (hasExistingData) {
      // DB already has real data -> NEVER overwrite!
      if (!metaSnap.exists()) {
        await setDoc(metaRef, {
          version: 1,
          source: 'existing_firestore_data',
          migratedAt: new Date().toISOString(),
          migratedByEmail: clamp(user.email, 180),
        });
      }
      return false;
    }

    // Fetch existing seed data from backend (/api/bootstrap + legacy community videos)
    const bootstrap = await apiFetch<LeagueBootstrap>('/api/bootstrap');
    if (!bootstrap || !Array.isArray(bootstrap.teams) || bootstrap.teams.length === 0) {
      throw new Error('No se encontraron datos iniciales válidos para migrar a Firestore.');
    }

    let legacyCommunityVideos: Array<{
      id: string;
      titulo: string;
      autor: string;
      videoUrl: string;
      fechaMs?: number;
    }> = [];
    try {
      const legacyRes = await apiFetch<{
        videos: Array<{ id: string; titulo: string; autor: string; videoUrl: string; fechaMs?: number }>;
      }>('/api/community-videos');
      if (Array.isArray(legacyRes?.videos)) {
        legacyCommunityVideos = legacyRes.videos;
      }
    } catch {
      // optional legacy source
    }

    const now = new Date().toISOString();
    const ops: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];

    // Admin directory entry
    ops.push({
      ref: doc(db, 'admins', safeDocId(user.uid)),
      data: stripUndefined({
        uid: user.uid,
        email: clamp(user.email, 180),
        displayName: clamp(user.displayName || 'Administrador General', 120),
        createdAt: now,
      }),
    });

    // Public settings
    const s = bootstrap.settings;
    ops.push({
      ref: doc(db, 'league_settings', 'global'),
      data: stripUndefined({
        title: clamp(s.title || 'Liga Master Argentina Pes6', 140),
        subtitle: clamp(s.subtitle || '', 160),
        description: clamp(s.description || '', 1200),
        calendarMessage: clamp(s.calendarMessage || '', 600),
        bannerText: clamp(s.bannerText || '', 200),
        crestUrl: clamp(s.crestUrl || '', 500),
        coverUrl: clamp(s.coverUrl || '', 500),
        backgroundUrl: clamp(s.backgroundUrl || '', 500),
        faviconUrl: clamp(s.faviconUrl || '', 500),
        adminId: clamp(s.adminId || 'ADMI', 32) || 'ADMI',
        adminTeamId: clamp(s.adminTeamId || 'ADM01', 32),
        featuredVideo: s.featuredVideo || null,
        radioName: clamp(s.radioName || '', 140),
        radioStreamUrl: clamp(s.radioStreamUrl || '', 500),
        maxTeams: Math.max(100, Math.min(500, Number(s.maxTeams) || 100)),
        ligaTrophyUrl: clamp(s.ligaTrophyUrl || '', 500),
        copaTrophyUrl: clamp(s.copaTrophyUrl || '', 500),
        recopaTrophyUrl: clamp(s.recopaTrophyUrl || '', 500),
        customTitles: sanitizeCustomTitles(s.customTitles),
        pageLikes: Number(bootstrap.pageLikes) || 0,
        updatedAt: now,
      }),
    });

    // Private admin config
    ops.push({
      ref: doc(db, 'league_private', 'admin_config'),
      data: stripUndefined({
        adminId: clamp(s.adminId || 'ADMI', 32) || 'ADMI',
        adminTokenVersion: 1,
        backupGmail: clamp(s.backupGmail || user.email || 'ligamasterargentina2030@gmail.com', 180),
        updatedAt: now,
      }),
    });

    // Rules
    ops.push({
      ref: doc(db, 'rules', 'global'),
      data: stripUndefined({
        prohibitedRules: Array.isArray(bootstrap.rules?.prohibitedRules)
          ? bootstrap.rules.prohibitedRules.slice(0, 50)
          : [],
        generalNotes: clamp(bootstrap.rules?.generalNotes || '', 2000),
        gameMode: bootstrap.rules?.gameMode || {},
        cupRules: bootstrap.rules?.cupRules || {},
        updatedAt: now,
      }),
    });

    // Cup
    if (bootstrap.cup) {
      ops.push({
        ref: doc(db, 'cup', 'current'),
        data: stripUndefined({
          editionNumber: Number(bootstrap.cup.editionNumber) || 1,
          editionName: clamp(bootstrap.cup.editionName || '1° Edición — Copa de la Liga', 160),
          status: bootstrap.cup.status === 'finished' ? 'finished' : 'in_progress',
          participants: Array.isArray(bootstrap.cup.participants)
            ? bootstrap.cup.participants.slice(0, 32)
            : [],
          matches: Array.isArray(bootstrap.cup.matches) ? bootstrap.cup.matches.slice(0, 64) : [],
          championSlot: bootstrap.cup.championSlot ?? null,
          championTeamName: clamp(bootstrap.cup.championTeamName || '', 120),
          championMemberName: clamp(bootstrap.cup.championMemberName || '', 120),
          championCrestUrl: clamp(bootstrap.cup.championCrestUrl || '', 500),
          championGreeting: clamp(bootstrap.cup.championGreeting || '', 400),
          recopa: bootstrap.cup.recopa || {},
          updatedAt: bootstrap.cup.updatedAt || now,
        }),
      });
    }

    // Teams (with crest normalized so static/API works seamlessly)
    for (const t of bootstrap.teams) {
      const id = safeDocId(t.id, 'team');
      const crestUrl =
        t.crestUrl && t.crestUrl.startsWith('/api/crest/')
          ? t.crestUrl
          : clamp(t.crestUrl || buildInlineTeamCrestSvg(id, t.name), 500);
      ops.push({
        ref: doc(db, 'teams', id),
        data: stripUndefined({
          id,
          name: clamp(t.name, 100),
          memberName: clamp(t.memberName, 100),
          crestUrl,
          bio: clamp(t.bio || '', 600),
          likes: Number(t.likes) || 0,
          trophies: Array.isArray(t.trophies) ? t.trophies.slice(0, 60) : [],
          personalMusic: Array.isArray(t.personalMusic) ? t.personalMusic.slice(0, 100) : [],
          lastListenedTrack: t.lastListenedTrack || null,
          celebrationImageUrl: t.celebrationImageUrl ? clamp(t.celebrationImageUrl, 500) : undefined,
          celebrationStatus: t.celebrationStatus,
          celebrationUploadedAt: t.celebrationUploadedAt,
          accountStatus: t.accountStatus === 'blocked' ? 'blocked' : 'active',
          primaryColor: t.primaryColor ? clamp(t.primaryColor, 20) : undefined,
          secondaryColor: t.secondaryColor ? clamp(t.secondaryColor, 20) : undefined,
          createdAt: t.createdAt || now,
          updatedAt: now,
        }),
      });
    }

    for (const m of bootstrap.matches || []) {
      const id = safeDocId(m.id, 'match');
      ops.push({
        ref: doc(db, 'matches', id),
        data: stripUndefined({
          ...m,
          id,
          createdAt: m.createdAt || now,
          updatedAt: now,
        }),
      });
    }

    for (const fx of bootstrap.fixtures || []) {
      const id = safeDocId(fx.id, 'fx');
      ops.push({
        ref: doc(db, 'fixtures', id),
        data: stripUndefined({ ...fx, id, createdAt: fx.createdAt || now, updatedAt: now }),
      });
    }

    for (const ev of bootstrap.calendarEvents || []) {
      const id = safeDocId(ev.id, 'cal');
      ops.push({
        ref: doc(db, 'calendar_events', id),
        data: stripUndefined({ ...ev, id, createdAt: ev.createdAt || now, updatedAt: now }),
      });
    }

    for (const cl of bootstrap.claims || []) {
      const id = safeDocId(cl.id, 'claim');
      ops.push({
        ref: doc(db, 'claims', id),
        data: stripUndefined({ ...cl, id, createdAt: cl.createdAt || now, updatedAt: now }),
      });
    }

    for (const n of bootstrap.news || []) {
      const id = safeDocId(n.id, 'news');
      ops.push({
        ref: doc(db, 'news', id),
        data: stripUndefined({ ...n, id, likes: Number(n.likes) || 0, createdAt: n.createdAt || now, updatedAt: now }),
      });
    }

    for (const g of bootstrap.topGoals || []) {
      const id = safeDocId(g.id, 'goal');
      ops.push({
        ref: doc(db, 'top_goals', id),
        data: stripUndefined({ ...g, id, createdAt: g.createdAt || now, updatedAt: now }),
      });
    }

    for (const c of bootstrap.comments || []) {
      const id = safeDocId(c.id, 'comment');
      ops.push({
        ref: doc(db, 'comments', id),
        data: stripUndefined({ ...c, id, createdAt: c.createdAt || now, updatedAt: now }),
      });
    }

    for (const ch of bootstrap.champions || []) {
      const id = safeDocId(ch.id, 'champ');
      ops.push({
        ref: doc(db, 'champions', id),
        data: stripUndefined({ ...ch, id, createdAt: ch.createdAt || now, updatedAt: now }),
      });
    }

    for (const tr of bootstrap.music || []) {
      const id = safeDocId(tr.id, 'track');
      ops.push({
        ref: doc(db, 'music', id),
        data: stripUndefined({ ...tr, id, createdAt: tr.createdAt || now, updatedAt: now }),
      });
    }

    for (const v of bootstrap.videos || []) {
      const id = safeDocId(v.id, 'vid');
      ops.push({
        ref: doc(db, 'videos', id),
        data: stripUndefined({ ...v, id, createdAt: v.createdAt || now, updatedAt: now }),
      });
    }

    for (const cv of legacyCommunityVideos) {
      const id = safeDocId(cv.id, 'cv');
      const fechaIso = cv.fechaMs ? new Date(cv.fechaMs).toISOString() : now;
      ops.push({
        ref: doc(db, 'videos_comunidad', id),
        data: stripUndefined({
          titulo: clamp(cv.titulo || 'Video de la comunidad', 160),
          autor: clamp(cv.autor || 'Miembro', 120),
          videoUrl: clamp(cv.videoUrl, 500),
          authorUid: user.uid,
          fecha: fechaIso,
          createdAt: fechaIso,
        }),
      });
    }

    // Save initial backup snapshot alongside migration
    const backupId = safeDocId(`backup_init_${Date.now()}`);
    ops.push({
      ref: doc(db, 'backups', backupId),
      data: stripUndefined({
        id: backupId,
        label: 'Respaldo inicial automático (Migración a Cloud Firestore)',
        trigger: 'initial_migration',
        createdByEmail: clamp(user.email || '', 180),
        summary: {
          teamsCount: bootstrap.teams.length,
          matchesCount: (bootstrap.matches || []).length,
          fixturesCount: (bootstrap.fixtures || []).length,
          calendarEventsCount: (bootstrap.calendarEvents || []).length,
          newsCount: (bootstrap.news || []).length,
          claimsCount: (bootstrap.claims || []).length,
          commentsCount: (bootstrap.comments || []).length,
          championsCount: (bootstrap.champions || []).length,
          musicCount: (bootstrap.music || []).length,
          videosCount: (bootstrap.videos || []).length,
          communityVideosCount: legacyCommunityVideos.length,
          topGoalsCount: (bootstrap.topGoals || []).length,
        },
        snapshot: stripUndefined({
          settings: bootstrap.settings,
          teams: bootstrap.teams,
          matches: bootstrap.matches || [],
          fixtures: bootstrap.fixtures || [],
          calendarEvents: bootstrap.calendarEvents || [],
          claims: bootstrap.claims || [],
          news: bootstrap.news || [],
          topGoals: bootstrap.topGoals || [],
          comments: bootstrap.comments || [],
          champions: bootstrap.champions || [],
          rules: bootstrap.rules,
          cup: bootstrap.cup,
          music: bootstrap.music || [],
          videos: bootstrap.videos || [],
          communityVideos: legacyCommunityVideos,
          pageLikes: bootstrap.pageLikes || 0,
        }),
        createdAt: now,
      }),
    });

    ops.push({
      ref: metaRef,
      data: {
        version: 1,
        source: 'league.json_and_legacy_firestore',
        migratedAt: now,
        migratedByEmail: clamp(user.email || '', 180),
      },
    });

    // Commit in chunks of 380 ops (Firestore batch limit is 500)
    for (let i = 0; i < ops.length; i += 380) {
      const batch = writeBatch(db);
      for (const item of ops.slice(i, i + 380)) {
        batch.set(item.ref, item.data);
      }
      await batch.commit();
    }

    notifyCommunityVideosChanged();
    return true;
  })().finally(() => {
    seedInFlight = null;
  });
  return seedInFlight;
}

// --- Real-Time Multi-Collection Subscription ---
export interface RealtimeLeagueSlice {
  checked?: boolean;
  seeded: boolean;
  settings?: LeagueSettings;
  pageLikes?: number;
  teams?: PublicTeam[];
  adminTeams?: Team[];
  matches?: Match[];
  fixtures?: ScheduledFixture[];
  calendarEvents?: CalendarEvent[];
  claims?: Claim[];
  news?: NewsPost[];
  topGoals?: TopGoalItem[];
  comments?: LeagueComment[];
  champions?: ChampionEntry[];
  rules?: RulesConfig;
  cup?: CupTournament;
  music?: MusicTrack[];
  videos?: GalleryVideo[];
  auditLog?: CredentialAuditEntry[];
  memberInvites?: MemberInvite[];
  backupGmail?: string;
  likedPage?: boolean;
  likedTeams?: Record<string, boolean>;
  likedNews?: Record<string, boolean>;
  musicMode?: 'league' | 'personal';
  penaltyBestScore?: number;
  userPersonalMusic?: MusicTrack[];
}

export function subscribeLeagueRealtime(
  opts: { uid?: string | null; isAdmin: boolean },
  onUpdate: (patch: Partial<RealtimeLeagueSlice>) => void,
  onError: (msg: string) => void
): () => void {
  const unsubs: Unsubscribe[] = [];

  const attach = <T,>(
    name: string,
    subscribeFn: (push: (val: T) => void) => Unsubscribe,
    apply: (val: T) => void
  ) => {
    try {
      const u = subscribeFn(apply);
      unsubs.push(u);
    } catch (err) {
      onError(formatFirestoreError(err, OperationType.LIST, name));
    }
  };

  attach(
    'league_settings/global',
    (push) =>
      onSnapshot(
        doc(db, 'league_settings', 'global'),
        (snap) => {
          if (!snap.exists()) {
            push({ checked: true, seeded: false });
            return;
          }
          const d = snap.data() as LeagueSettings & { pageLikes?: number };
          const rawMax = Number(d.maxTeams);
          const normalizedMax = Number.isFinite(rawMax) && rawMax > 50 ? Math.min(500, rawMax) : 100;
          push({
            checked: true,
            seeded: true,
            settings: {
              ...d,
              maxTeams: normalizedMax,
            },
            pageLikes: typeof d.pageLikes === 'number' ? d.pageLikes : 0,
          });
        },
        (err) => onError(formatFirestoreError(err, OperationType.GET, 'league_settings/global'))
      ),
    (res: { checked: boolean; seeded: boolean; settings?: LeagueSettings; pageLikes?: number }) => {
      onUpdate(res);
    }
  );

  attach(
    'teams',
    (push) =>
      onSnapshot(
        collection(db, 'teams'),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ ...(d.data() as Team), id: d.id }))
            .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
          push(list);
        },
        (err) => onError(formatFirestoreError(err, OperationType.LIST, 'teams'))
      ),
    (list: Team[]) => {
      const patch: Partial<RealtimeLeagueSlice> = { teams: list };
      if (list.length > 0) patch.seeded = true;
      if (opts.isAdmin) patch.adminTeams = list;
      onUpdate(patch);
    }
  );

  // Matches: query strictly matches firestore.rules list constraints
  let validatedMatches: Match[] = [];
  let ownMatches: Match[] = [];
  const emitMergedMatches = () => {
    const map = new Map<string, Match>();
    for (const m of validatedMatches) map.set(m.id, m);
    for (const m of ownMatches) map.set(m.id, m);
    const merged = Array.from(map.values()).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    onUpdate({ matches: merged });
  };

  if (opts.isAdmin) {
    unsubs.push(
      onSnapshot(
        collection(db, 'matches'),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ ...(d.data() as Match), id: d.id }))
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          onUpdate({ matches: list });
        },
        (err) => onError(formatFirestoreError(err, OperationType.LIST, 'matches'))
      )
    );
  } else {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'matches'), where('status', '==', 'validated')),
        (snap) => {
          validatedMatches = snap.docs.map((d) => ({ ...(d.data() as Match), id: d.id }));
          emitMergedMatches();
        },
        (err) => onError(formatFirestoreError(err, OperationType.LIST, 'matches'))
      )
    );
    if (opts.uid) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'matches'), where('submittedByUid', '==', opts.uid)),
          (snap) => {
            ownMatches = snap.docs.map((d) => ({ ...(d.data() as Match), id: d.id }));
            emitMergedMatches();
          },
          (err) => onError(formatFirestoreError(err, OperationType.LIST, 'matches'))
        )
      );
    }
  }

  unsubs.push(
    onSnapshot(
      collection(db, 'fixtures'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as ScheduledFixture), id: d.id }))
          .sort((a, b) => a.matchday - b.matchday);
        onUpdate({ fixtures: list });
      },
      (err) => onError(formatFirestoreError(err, OperationType.LIST, 'fixtures'))
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'calendar_events'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as CalendarEvent), id: d.id }))
          .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        onUpdate({ calendarEvents: list });
      },
      (err) => onError(formatFirestoreError(err, OperationType.LIST, 'calendar_events'))
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'claims'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as Claim), id: d.id }))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        onUpdate({ claims: list });
      },
      (err) => onError(formatFirestoreError(err, OperationType.LIST, 'claims'))
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'news'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as NewsPost), id: d.id }))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        onUpdate({ news: list });
      },
      (err) => onError(formatFirestoreError(err, OperationType.LIST, 'news'))
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'top_goals'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as TopGoalItem), id: d.id }))
          .sort((a, b) => a.rank - b.rank);
        onUpdate({ topGoals: list });
      },
      (err) => onError(formatFirestoreError(err, OperationType.LIST, 'top_goals'))
    )
  );

  // Comments: query strictly matches firestore.rules list constraints
  let approvedComments: LeagueComment[] = [];
  let ownComments: LeagueComment[] = [];
  const emitMergedComments = () => {
    const map = new Map<string, LeagueComment>();
    for (const c of approvedComments) map.set(c.id, c);
    for (const c of ownComments) map.set(c.id, c);
    const merged = Array.from(map.values()).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    onUpdate({ comments: merged });
  };

  if (opts.isAdmin) {
    unsubs.push(
      onSnapshot(
        collection(db, 'comments'),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ ...(d.data() as LeagueComment), id: d.id }))
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          onUpdate({ comments: list });
        },
        (err) => onError(formatFirestoreError(err, OperationType.LIST, 'comments'))
      )
    );
  } else {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'comments'), where('status', '==', 'approved')),
        (snap) => {
          approvedComments = snap.docs.map((d) => ({ ...(d.data() as LeagueComment), id: d.id }));
          emitMergedComments();
        },
        (err) => onError(formatFirestoreError(err, OperationType.LIST, 'comments'))
      )
    );
    if (opts.uid) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'comments'), where('authorUid', '==', opts.uid)),
          (snap) => {
            ownComments = snap.docs.map((d) => ({ ...(d.data() as LeagueComment), id: d.id }));
            emitMergedComments();
          },
          (err) => onError(formatFirestoreError(err, OperationType.LIST, 'comments'))
        )
      );
    }
  }

  unsubs.push(
    onSnapshot(
      collection(db, 'champions'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as ChampionEntry), id: d.id }))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        onUpdate({ champions: list });
      },
      (err) => onError(formatFirestoreError(err, OperationType.LIST, 'champions'))
    )
  );

  unsubs.push(
    onSnapshot(
      doc(db, 'rules', 'global'),
      (snap) => {
        if (snap.exists()) {
          onUpdate({ rules: snap.data() as RulesConfig });
        }
      },
      (err) => onError(formatFirestoreError(err, OperationType.GET, 'rules/global'))
    )
  );

  unsubs.push(
    onSnapshot(
      doc(db, 'cup', 'current'),
      (snap) => {
        if (snap.exists()) {
          onUpdate({ cup: snap.data() as CupTournament });
        }
      },
      (err) => onError(formatFirestoreError(err, OperationType.GET, 'cup/current'))
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'music'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as MusicTrack), id: d.id }))
          .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        onUpdate({ music: list });
      },
      (err) => onError(formatFirestoreError(err, OperationType.LIST, 'music'))
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db, 'videos'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ ...(d.data() as GalleryVideo), id: d.id }))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        onUpdate({ videos: list });
      },
      (err) => onError(formatFirestoreError(err, OperationType.LIST, 'videos'))
    )
  );

  if (opts.uid) {
    unsubs.push(
      onSnapshot(
        query(collection(db, 'likes'), where('uid', '==', opts.uid)),
        (snap) => {
          let likedPage = false;
          const likedTeams: Record<string, boolean> = {};
          const likedNews: Record<string, boolean> = {};
          for (const d of snap.docs) {
            const data = d.data() as { targetType?: string; targetId?: string };
            if (data.targetType === 'page') likedPage = true;
            else if (data.targetType === 'team' && data.targetId) likedTeams[data.targetId] = true;
            else if (data.targetType === 'news' && data.targetId) likedNews[data.targetId] = true;
          }
          onUpdate({ likedPage, likedTeams, likedNews });
        },
        (err) => onError(formatFirestoreError(err, OperationType.LIST, 'likes'))
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'user_preferences', safeDocId(opts.uid)),
        (snap) => {
          if (snap.exists()) {
            const pref = snap.data() as {
              musicMode?: string;
              penaltyBestScore?: number;
              personalMusic?: MusicTrack[];
            };
            onUpdate({
              musicMode: pref.musicMode === 'personal' ? 'personal' : 'league',
              penaltyBestScore:
                typeof pref.penaltyBestScore === 'number' ? pref.penaltyBestScore : 0,
              userPersonalMusic: Array.isArray(pref.personalMusic) ? pref.personalMusic : [],
            });
          } else {
            onUpdate({
              musicMode: 'league',
              penaltyBestScore: 0,
              userPersonalMusic: [],
            });
          }
        },
        (err) =>
          onError(formatFirestoreError(err, OperationType.GET, `user_preferences/${opts.uid}`))
      )
    );
  }

  if (opts.isAdmin) {
    unsubs.push(
      onSnapshot(
        collection(db, 'audit_log'),
        (snap) => {
          const list = snap.docs
            .map((d) => ({ ...(d.data() as CredentialAuditEntry), id: d.id }))
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
            .slice(0, 100);
          onUpdate({ auditLog: list });
        },
        (err) => onError(formatFirestoreError(err, OperationType.LIST, 'audit_log'))
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'member_invites'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as MemberInvite);
          onUpdate({ memberInvites: list });
        },
        (err) => onError(formatFirestoreError(err, OperationType.LIST, 'member_invites'))
      )
    );
    unsubs.push(
      onSnapshot(
        doc(db, 'league_private', 'admin_config'),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data() as { backupGmail?: string };
            if (d.backupGmail) onUpdate({ backupGmail: d.backupGmail });
          }
        },
        (err) =>
          onError(formatFirestoreError(err, OperationType.GET, 'league_private/admin_config'))
      )
    );
  }

  return () => {
    for (const u of unsubs) u();
  };
}

// --- Settings & Branding ---
export async function saveSettingsFirestore(
  updates: Partial<LeagueSettings> & { backupGmail?: string }
): Promise<void> {
  const user = requireVerifiedFirebaseUser();
  return runConfirmedWrite('Guardar configuración', OperationType.UPDATE, 'league_settings/global', async () => {
    const ref = doc(db, 'league_settings', 'global');
    const existing = await getDoc(ref);
    const cur = (existing.exists() ? existing.data() : {}) as Partial<LeagueSettings>;
    const now = new Date().toISOString();
    const { backupGmail, ...publicUpdates } = updates;
    const resolvedExtraHero =
      publicUpdates.extraHeroImages !== undefined
        ? publicUpdates.extraHeroImages
        : cur.extraHeroImages;
    const cleanExtraHero = Array.isArray(resolvedExtraHero)
      ? resolvedExtraHero
          .map((u) => clamp(u, 500))
          .filter(Boolean)
          .slice(0, 12)
      : undefined;

    const nextPublic: LeagueSettings = stripUndefined({
      title: clamp(publicUpdates.title ?? cur.title ?? 'Liga Master Argentina Pes6', 140),
      subtitle: clamp(publicUpdates.subtitle ?? cur.subtitle ?? '', 160),
      description: clamp(publicUpdates.description ?? cur.description ?? '', 1200),
      calendarMessage: clamp(publicUpdates.calendarMessage ?? cur.calendarMessage ?? '', 600),
      bannerText: clamp(publicUpdates.bannerText ?? cur.bannerText ?? '', 200),
      crestUrl: clamp(publicUpdates.crestUrl ?? cur.crestUrl ?? '', 500),
      coverUrl: clamp(publicUpdates.coverUrl !== undefined ? publicUpdates.coverUrl : cur.coverUrl ?? '', 500),
      backgroundUrl: clamp(publicUpdates.backgroundUrl ?? cur.backgroundUrl ?? '', 500),
      faviconUrl: clamp(publicUpdates.faviconUrl ?? cur.faviconUrl ?? '', 500),
      adminId: clamp(publicUpdates.adminId ?? cur.adminId ?? 'ADMI', 32) || 'ADMI',
      adminTeamId: clamp(publicUpdates.adminTeamId ?? cur.adminTeamId ?? 'ADM01', 32),
      featuredVideo:
        publicUpdates.featuredVideo !== undefined
          ? publicUpdates.featuredVideo
          : cur.featuredVideo ?? null,
      radioName: clamp(publicUpdates.radioName ?? cur.radioName ?? '', 140),
      radioStreamUrl: clamp(publicUpdates.radioStreamUrl ?? cur.radioStreamUrl ?? '', 500),
      maxTeams: Math.max(
        51,
        Math.min(500, Number(publicUpdates.maxTeams ?? cur.maxTeams ?? 100) || 100)
      ),
      ligaTrophyUrl: clamp(publicUpdates.ligaTrophyUrl ?? cur.ligaTrophyUrl ?? '', 500),
      copaTrophyUrl: clamp(publicUpdates.copaTrophyUrl ?? cur.copaTrophyUrl ?? '', 500),
      recopaTrophyUrl: clamp(publicUpdates.recopaTrophyUrl ?? cur.recopaTrophyUrl ?? '', 500),
      messiPlaqueUrl:
        publicUpdates.messiPlaqueUrl !== undefined
          ? clamp(publicUpdates.messiPlaqueUrl, 500)
          : cur.messiPlaqueUrl !== undefined
          ? clamp(cur.messiPlaqueUrl, 500)
          : undefined,
      messiMaradonaUrl:
        publicUpdates.messiMaradonaUrl !== undefined
          ? clamp(publicUpdates.messiMaradonaUrl, 500)
          : cur.messiMaradonaUrl !== undefined
          ? clamp(cur.messiMaradonaUrl, 500)
          : undefined,
      maradonaPlaqueUrl:
        publicUpdates.maradonaPlaqueUrl !== undefined
          ? clamp(publicUpdates.maradonaPlaqueUrl, 500)
          : cur.maradonaPlaqueUrl !== undefined
          ? clamp(cur.maradonaPlaqueUrl, 500)
          : undefined,
      extraHeroImages: cleanExtraHero,
      customTitles: sanitizeCustomTitles(
        publicUpdates.customTitles !== undefined ? publicUpdates.customTitles : cur.customTitles
      ),
      pageLikes: Number((cur as { pageLikes?: number }).pageLikes ?? 0),
    });

    await setDoc(ref, { ...nextPublic, updatedAt: now });

    if (backupGmail !== undefined) {
      const privRef = doc(db, 'league_private', 'admin_config');
      const privSnap = await getDoc(privRef);
      const privCur = privSnap.exists() ? privSnap.data() : {};
      await setDoc(privRef, {
        adminId: nextPublic.adminId,
        adminTokenVersion: Number((privCur as { adminTokenVersion?: number }).adminTokenVersion ?? 1),
        backupGmail: clamp(backupGmail, 180),
        updatedAt: now,
      });
    }
    void user;
  });
}

export async function saveFeaturedVideoFirestore(selection: FeaturedVideoSelection | null): Promise<void> {
  requireVerifiedFirebaseUser();
  return runConfirmedWrite(
    selection ? 'Destacar video en Inicio' : 'Quitar video destacado',
    OperationType.UPDATE,
    'league_settings/global',
    async () => {
      await updateDoc(doc(db, 'league_settings', 'global'), {
        featuredVideo: selection ? stripUndefined(selection) : null,
        updatedAt: new Date().toISOString(),
      });
    }
  );
}

// --- Teams & Member Accounts ---
export async function createTeamFirestore(input: {
  id: string;
  name: string;
  memberName: string;
  crestUrl?: string;
  bio?: string;
  linkedEmail?: string;
}): Promise<PublicTeam> {
  const user = requireVerifiedFirebaseUser();
  const id = safeDocId(input.id.toUpperCase(), 'LMA');
  const now = new Date().toISOString();
  const team: Team = stripUndefined({
    id,
    name: clamp(input.name, 100),
    memberName: clamp(input.memberName, 100),
    crestUrl: clamp(input.crestUrl || buildInlineTeamCrestSvg(id, input.name), 500),
    bio: clamp(input.bio || '', 600),
    likes: 0,
    trophies: [],
    personalMusic: [],
    accountStatus: 'active',
    createdAt: now,
    updatedAt: now,
  });

  await runConfirmedWrite('Crear participante', OperationType.CREATE, `teams/${id}`, async () => {
    const existing = await getDoc(doc(db, 'teams', id));
    if (existing.exists()) {
      throw new Error(`Ya existe un equipo con el ID "${id}". Elegí otro ID.`);
    }
    await setDoc(doc(db, 'teams', id), team);
    if (input.linkedEmail && input.linkedEmail.trim()) {
      const cleanEmail = clamp(input.linkedEmail.trim().toLowerCase(), 180);
      await setDoc(doc(db, 'member_invites', cleanEmail), {
        email: cleanEmail,
        teamId: id,
        status: 'active',
        createdAt: now,
      });
    }
    await logAuditEntry({
      action: 'create_participant',
      targetType: 'participant',
      targetId: id,
      targetLabel: `${team.memberName} (${team.name})`,
      details: `Equipo ${team.name} creado en Cloud Firestore.`,
      performedBy: user.email || 'Admin',
    });
  });

  return team;
}

export async function updateTeamFirestore(
  teamId: string,
  updates: Partial<Team> & { linkedEmail?: string }
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  const { linkedEmail, ...rest } = updates;
  await runConfirmedWrite('Actualizar equipo', OperationType.UPDATE, `teams/${id}`, async () => {
    const ref = doc(db, 'teams', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Equipo no encontrado en Firestore.');
    const cur = snap.data() as Team;
    const now = new Date().toISOString();
    const next: Team = stripUndefined({
      ...cur,
      ...rest,
      id: cur.id,
      name: clamp(rest.name ?? cur.name, 100),
      memberName: clamp(rest.memberName ?? cur.memberName, 100),
      crestUrl: clamp(rest.crestUrl ?? cur.crestUrl, 500),
      bio: clamp(rest.bio ?? cur.bio ?? '', 600),
      createdAt: cur.createdAt || now,
      updatedAt: now,
    });
    await setDoc(ref, next);

    if (linkedEmail && linkedEmail.trim()) {
      const cleanEmail = clamp(linkedEmail.trim().toLowerCase(), 180);
      await setDoc(doc(db, 'member_invites', cleanEmail), {
        email: cleanEmail,
        teamId: id,
        status: 'active',
        createdAt: now,
      });
    }
  });
}

export async function assignMemberEmailInviteFirestore(email: string, teamId: string): Promise<void> {
  const user = requireVerifiedFirebaseUser();
  const cleanEmail = clamp(email.trim().toLowerCase(), 180);
  const id = safeDocId(teamId);
  if (!cleanEmail.includes('@')) {
    throw new Error('Ingresá un correo electrónico de Google válido para el miembro.');
  }
  await runConfirmedWrite(
    'Autorizar correo de miembro',
    OperationType.WRITE,
    `member_invites/${cleanEmail}`,
    async () => {
      const now = new Date().toISOString();
      await setDoc(doc(db, 'member_invites', cleanEmail), {
        email: cleanEmail,
        teamId: id,
        status: 'active',
        createdAt: now,
      });
      await logAuditEntry({
        action: 'assign_member_email',
        targetType: 'participant',
        targetId: id,
        targetLabel: cleanEmail,
        details: `Correo ${cleanEmail} autorizado para administrar el perfil del equipo ${id}.`,
        performedBy: user.email || 'Admin',
      });
    }
  );
}

export async function updateTeamStatusFirestore(
  teamId: string,
  status: AccountStatus
): Promise<void> {
  const user = requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite(
    status === 'blocked' ? 'Bloquear participante' : 'Activar participante',
    OperationType.UPDATE,
    `teams/${id}`,
    async () => {
      await updateDoc(doc(db, 'teams', id), {
        accountStatus: status,
        updatedAt: new Date().toISOString(),
      });
      await logAuditEntry({
        action: status === 'blocked' ? 'block_participant' : 'activate_participant',
        targetType: 'participant',
        targetId: id,
        targetLabel: id,
        details: `Estado de cuenta actualizado a "${status}".`,
        performedBy: user.email || 'Admin',
      });
    }
  );
}

export async function deleteTeamFirestore(teamId: string): Promise<void> {
  const user = requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite('Eliminar participante', OperationType.DELETE, `teams/${id}`, async () => {
    await deleteDoc(doc(db, 'teams', id));
    await logAuditEntry({
      action: 'delete_participant',
      targetType: 'participant',
      targetId: id,
      targetLabel: id,
      details: `Participante ${id} eliminado de Firestore.`,
      performedBy: user.email || 'Admin',
    });
  });
}

export async function saveAdminOwnTeamFirestore(input: {
  existingTeamId?: string;
  name: string;
  memberName: string;
  bio?: string;
  crestUrl?: string;
}): Promise<PublicTeam> {
  const user = requireVerifiedFirebaseUser();
  const now = new Date().toISOString();
  const targetId = safeDocId(input.existingTeamId || 'ADM01', 'ADM01');
  let savedTeam: Team | null = null;
  await runConfirmedWrite('Guardar mi equipo oficial', OperationType.WRITE, `teams/${targetId}`, async () => {
    const ref = doc(db, 'teams', targetId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const cur = snap.data() as Team;
      savedTeam = stripUndefined({
        ...cur,
        name: clamp(input.name, 100),
        memberName: clamp(input.memberName, 100),
        bio: clamp(input.bio ?? cur.bio ?? '', 600),
        crestUrl: clamp(input.crestUrl || cur.crestUrl, 500),
        updatedAt: now,
      });
    } else {
      savedTeam = stripUndefined({
        id: targetId,
        name: clamp(input.name, 100),
        memberName: clamp(input.memberName, 100),
        crestUrl: clamp(input.crestUrl || buildInlineTeamCrestSvg(targetId, input.name), 500),
        bio: clamp(input.bio || '', 600),
        likes: 0,
        trophies: [],
        personalMusic: [],
        accountStatus: 'active',
        createdAt: now,
        updatedAt: now,
      });
    }
    const batch = writeBatch(db);
    batch.set(ref, savedTeam);
    const settingsRef = doc(db, 'league_settings', 'global');
    const settingsSnap = await getDoc(settingsRef);
    if (settingsSnap.exists()) {
      batch.update(settingsRef, {
        adminTeamId: targetId,
        updatedAt: now,
      });
    }
    await batch.commit();
    void user;
  });
  return savedTeam!;
}

// --- Member Profile Self-Updates ---
export async function updateMyBioFirestore(teamId: string, bio: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite('Guardar biografía', OperationType.UPDATE, `teams/${id}`, async () => {
    await updateDoc(doc(db, 'teams', id), {
      bio: clamp(bio, 600),
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function updateMyCelebrationFirestore(
  teamId: string,
  celebrationImageUrl: string,
  isAdmin: boolean
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite(
    'Subir foto de festejo',
    OperationType.UPDATE,
    `teams/${id}`,
    async () => {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'teams', id), {
        celebrationImageUrl: clamp(celebrationImageUrl, 500),
        celebrationStatus: isAdmin ? 'approved' : 'pending',
        celebrationUploadedAt: now,
        updatedAt: now,
      });
    }
  );
}

export async function deleteMyCelebrationFirestore(teamId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite(
    'Eliminar foto de festejo',
    OperationType.UPDATE,
    `teams/${id}`,
    async () => {
      await updateDoc(doc(db, 'teams', id), {
        celebrationImageUrl: '',
        celebrationStatus: 'pending',
        updatedAt: new Date().toISOString(),
      });
    }
  );
}

export async function updateTeamLastSongFirestore(
  teamId: string,
  track: LastListenedTrack
): Promise<void> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const id = safeDocId(teamId);
  try {
    await updateDoc(doc(db, 'teams', id), {
      lastListenedTrack: stripUndefined(track),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Non-blocking background activity sync if user lacks permission on target team
  }
}

export async function addPersonalMusicFirestore(
  teamId: string,
  track: MusicTrack
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite('Agregar tema personal', OperationType.UPDATE, `teams/${id}`, async () => {
    const snap = await getDoc(doc(db, 'teams', id));
    if (!snap.exists()) throw new Error('Equipo no encontrado.');
    const cur = snap.data() as Team;
    const nextList = [...(cur.personalMusic || []), stripUndefined(track)].slice(0, 100);
    await updateDoc(doc(db, 'teams', id), {
      personalMusic: nextList,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function deletePersonalMusicFirestore(teamId: string, trackId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite('Eliminar tema personal', OperationType.UPDATE, `teams/${id}`, async () => {
    const snap = await getDoc(doc(db, 'teams', id));
    if (!snap.exists()) throw new Error('Equipo no encontrado.');
    const cur = snap.data() as Team;
    const nextList = (cur.personalMusic || []).filter((t) => t.id !== trackId);
    await updateDoc(doc(db, 'teams', id), {
      personalMusic: nextList,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function updateTrophyMessageFirestore(
  teamId: string,
  trophyId: string,
  message: string
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite('Guardar mensaje de trofeo', OperationType.UPDATE, `teams/${id}`, async () => {
    const snap = await getDoc(doc(db, 'teams', id));
    if (!snap.exists()) throw new Error('Equipo no encontrado.');
    const cur = snap.data() as Team;
    const nextTrophies = (cur.trophies || []).map((t) =>
      t.id === trophyId ? { ...t, message: clamp(message, 400) } : t
    );
    await updateDoc(doc(db, 'teams', id), {
      trophies: nextTrophies,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function deleteTrophyFirestore(teamId: string, trophyId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(teamId);
  await runConfirmedWrite('Eliminar trofeo', OperationType.UPDATE, `teams/${id}`, async () => {
    const snap = await getDoc(doc(db, 'teams', id));
    if (!snap.exists()) throw new Error('Equipo no encontrado.');
    const cur = snap.data() as Team;
    const nextTrophies = (cur.trophies || []).filter((t) => t.id !== trophyId);
    await updateDoc(doc(db, 'teams', id), {
      trophies: nextTrophies,
      updatedAt: new Date().toISOString(),
    });
  });
}

// --- User Preferences (Cloud Firestore persistence for musicMode, personalMusic fallback, penaltyBestScore) ---
export async function saveUserMusicModeFirestore(mode: 'league' | 'personal'): Promise<void> {
  const u = auth.currentUser;
  if (!u || !u.emailVerified) return;
  try {
    const prefRef = doc(db, 'user_preferences', safeDocId(u.uid));
    await setDoc(
      prefRef,
      {
        uid: u.uid,
        musicMode: mode,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `user_preferences/${u.uid}`);
  }
}

export async function saveUserPenaltyBestScoreFirestore(score: number): Promise<number> {
  const u = auth.currentUser;
  const clampedScore = Math.max(0, Math.min(10000, Math.floor(Number(score) || 0)));
  if (!u || !u.emailVerified) return clampedScore;
  const prefRef = doc(db, 'user_preferences', safeDocId(u.uid));
  return runConfirmedWrite(
    'Guardar récord de penales',
    OperationType.WRITE,
    `user_preferences/${u.uid}`,
    async () => {
      const snap = await getDoc(prefRef);
      const cur = snap.exists() ? (snap.data() as { musicMode?: string; penaltyBestScore?: number }) : {};
      const nextBest = Math.max(
        typeof cur.penaltyBestScore === 'number' ? cur.penaltyBestScore : 0,
        clampedScore
      );
      await setDoc(
        prefRef,
        {
          uid: u.uid,
          musicMode: cur.musicMode === 'personal' ? 'personal' : 'league',
          penaltyBestScore: nextBest,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return nextBest;
    }
  );
}

export async function addUserPersonalMusicFirestore(track: MusicTrack): Promise<void> {
  const u = requireVerifiedFirebaseUser();
  const prefRef = doc(db, 'user_preferences', safeDocId(u.uid));
  await runConfirmedWrite(
    'Agregar tema personal',
    OperationType.WRITE,
    `user_preferences/${u.uid}`,
    async () => {
      const snap = await getDoc(prefRef);
      const cur = snap.exists()
        ? (snap.data() as { musicMode?: string; personalMusic?: MusicTrack[] })
        : {};
      const existing = Array.isArray(cur.personalMusic) ? cur.personalMusic : [];
      const nextList = [...existing, stripUndefined(track)].slice(0, 100);
      await setDoc(
        prefRef,
        {
          uid: u.uid,
          musicMode: cur.musicMode === 'personal' ? 'personal' : 'league',
          personalMusic: nextList,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  );
}

export async function deleteUserPersonalMusicFirestore(trackId: string): Promise<void> {
  const u = requireVerifiedFirebaseUser();
  const prefRef = doc(db, 'user_preferences', safeDocId(u.uid));
  await runConfirmedWrite(
    'Eliminar tema personal',
    OperationType.WRITE,
    `user_preferences/${u.uid}`,
    async () => {
      const snap = await getDoc(prefRef);
      if (!snap.exists()) return;
      const cur = snap.data() as { musicMode?: string; personalMusic?: MusicTrack[] };
      const existing = Array.isArray(cur.personalMusic) ? cur.personalMusic : [];
      const nextList = existing.filter((t) => t.id !== trackId);
      await setDoc(
        prefRef,
        {
          uid: u.uid,
          musicMode: cur.musicMode === 'personal' ? 'personal' : 'league',
          personalMusic: nextList,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  );
}

// --- Atomic Likes (Replaces localStorage likes) ---
export async function toggleAtomicLikeFirestore(
  targetType: 'page' | 'team' | 'news',
  targetId: string
): Promise<void> {
  const u = requireVerifiedFirebaseUser();
  const cleanTargetId = targetType === 'page' ? 'global' : safeDocId(targetId);
  const likeDocId = `${safeDocId(u.uid)}_${targetType}_${cleanTargetId}`;
  const likeRef = doc(db, 'likes', likeDocId);

  await runConfirmedWrite('Registrar Me gusta', OperationType.WRITE, `likes/${likeDocId}`, async () => {
    const existingLike = await getDoc(likeRef);
    if (existingLike.exists()) {
      return; // Already liked; idempotent anti-duplicate guard
    }
    const batch = writeBatch(db);
    batch.set(likeRef, {
      uid: u.uid,
      targetType,
      targetId: cleanTargetId,
      createdAt: new Date().toISOString(),
    });
    if (targetType === 'page') {
      batch.update(doc(db, 'league_settings', 'global'), { pageLikes: increment(1) });
    } else if (targetType === 'team') {
      batch.update(doc(db, 'teams', cleanTargetId), { likes: increment(1) });
    } else if (targetType === 'news') {
      batch.update(doc(db, 'news', cleanTargetId), { likes: increment(1) });
    }
    await batch.commit();
  });
}

// --- Matches ---
function syncValidatedMatchIntoCup(
  rawCup: CupTournament,
  m: Match,
  teams: PublicTeam[],
  allMatches: Match[]
): { nextCup: CupTournament; synced: boolean } {
  const updatedCup: CupTournament = JSON.parse(JSON.stringify(rawCup)) as CupTournament;
  let synced = false;

  if (m.competitionType === 'copa' && m.cupMatchId) {
    const node = updatedCup.matches.find((cm) => cm.id === m.cupMatchId);
    if (node) {
      node.homeGoals = m.homeGoals;
      node.awayGoals = m.awayGoals;
      node.homePenalties = m.homePenalties ?? null;
      node.awayPenalties = m.awayPenalties ?? null;
      node.extraTime = Boolean(m.extraTime);
      node.played = true;
      synced = true;
    }
  } else if (m.competitionType === 'recopa' && updatedCup.recopa) {
    const rec = updatedCup.recopa;
    rec.leagueGoals = m.homeGoals;
    rec.cupGoals = m.awayGoals;
    rec.leaguePenalties = m.homePenalties ?? null;
    rec.cupPenalties = m.awayPenalties ?? null;
    rec.extraTime = Boolean(m.extraTime);
    let winSide: 'league' | 'cup' | null = null;
    if (m.homeGoals > m.awayGoals) winSide = 'league';
    else if (m.awayGoals > m.homeGoals) winSide = 'cup';
    else if (
      m.homePenalties !== null &&
      m.homePenalties !== undefined &&
      m.awayPenalties !== null &&
      m.awayPenalties !== undefined &&
      m.homePenalties !== m.awayPenalties
    ) {
      winSide = m.homePenalties > m.awayPenalties ? 'league' : 'cup';
    }
    rec.grandChampionSide = winSide;
    if (winSide === 'league') {
      rec.grandChampionName = rec.leagueChampionName;
      rec.grandChampionMember = rec.leagueChampionMember;
      rec.grandChampionCrestUrl = rec.leagueChampionCrestUrl;
      rec.played = true;
    } else if (winSide === 'cup') {
      rec.grandChampionName = rec.cupChampionName;
      rec.grandChampionMember = rec.cupChampionMember;
      rec.grandChampionCrestUrl = rec.cupChampionCrestUrl;
      rec.played = true;
    }
    synced = true;
  }

  return {
    nextCup: synced ? recomputeCupBracket(updatedCup, teams, allMatches) : updatedCup,
    synced,
  };
}

export async function submitMatchFirestore(input: {
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
  scorerImageUrl?: string;
  scorerName?: string;
  fixtureId?: string;
  submittedByTeamId: string;
  submittedByName: string;
  isAdmin: boolean;
  cup?: CupTournament;
  teams?: PublicTeam[];
  allMatches?: Match[];
}): Promise<Match & { cupSynced?: boolean }> {
  const u = requireVerifiedFirebaseUser();
  const id = safeDocId(`m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const now = new Date().toISOString();
  const status: Match['status'] = input.isAdmin ? 'validated' : 'pending';
  const matchDoc: Match = stripUndefined({
    id,
    matchday: Number(input.matchday) || 1,
    homeTeamId: safeDocId(input.homeTeamId),
    awayTeamId: safeDocId(input.awayTeamId),
    homeGoals: Number(input.homeGoals) || 0,
    awayGoals: Number(input.awayGoals) || 0,
    leg: input.leg,
    competitionType: input.competitionType || 'liga',
    cupMatchId: input.cupMatchId ? clamp(input.cupMatchId, 64) : undefined,
    homePenalties: input.homePenalties ?? null,
    awayPenalties: input.awayPenalties ?? null,
    extraTime: Boolean(input.extraTime),
    playedAt: clamp(input.playedAt || now.slice(0, 10), 40),
    notes: clamp(input.notes || '', 600),
    proofImageUrl: input.proofImageUrl ? clamp(input.proofImageUrl, 500) : undefined,
    proofImageStatus: input.proofImageUrl ? (input.isAdmin ? 'approved' : 'pending') : undefined,
    scorerImageUrl: input.scorerImageUrl ? clamp(input.scorerImageUrl, 500) : undefined,
    scorerName: input.scorerName ? clamp(input.scorerName, 100) : undefined,
    scorerImageStatus: input.scorerImageUrl ? (input.isAdmin ? 'approved' : 'pending') : undefined,
    fixtureId: input.fixtureId ? clamp(input.fixtureId, 64) : undefined,
    submittedByTeamId: clamp(input.submittedByTeamId, 32),
    submittedByName: clamp(input.submittedByName, 100),
    submittedByUid: u.uid,
    status,
    validatedAt: status === 'validated' ? now : undefined,
    createdAt: now,
    updatedAt: now,
  });

  let cupSynced = false;
  await runConfirmedWrite('Enviar partido', OperationType.CREATE, `matches/${id}`, async () => {
    const batch = writeBatch(db);
    batch.set(doc(db, 'matches', id), matchDoc);
    if (input.isAdmin && input.fixtureId) {
      const fxRef = doc(db, 'fixtures', safeDocId(input.fixtureId));
      const fxSnap = await getDoc(fxRef);
      if (fxSnap.exists()) {
        batch.update(fxRef, {
          completedMatchId: id,
          updatedAt: now,
        });
      }
    }
    if (
      input.isAdmin &&
      input.cup &&
      (matchDoc.competitionType === 'copa' || matchDoc.competitionType === 'recopa')
    ) {
      const { nextCup, synced } = syncValidatedMatchIntoCup(
        input.cup,
        matchDoc,
        input.teams || [],
        input.allMatches || []
      );
      if (synced) {
        batch.set(doc(db, 'cup', 'current'), stripUndefined(nextCup));
        cupSynced = true;
      }
    }
    await batch.commit();
  });
  return { ...matchDoc, cupSynced };
}

export async function reviewMatchFirestore(
  matchId: string,
  updates: {
    status?: Match['status'];
    homeGoals?: number;
    awayGoals?: number;
    matchday?: number;
    leg?: 'Ida' | 'Vuelta';
    playedAt?: string;
    notes?: string;
    cup?: CupTournament;
    teams?: PublicTeam[];
    allMatches?: Match[];
  }
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(matchId);
  await runConfirmedWrite('Actualizar partido', OperationType.UPDATE, `matches/${id}`, async () => {
    const ref = doc(db, 'matches', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Partido no encontrado.');
    const cur = snap.data() as Match;
    const now = new Date().toISOString();
    const next: Match = stripUndefined({
      ...cur,
      ...(updates.homeGoals !== undefined ? { homeGoals: Number(updates.homeGoals) } : {}),
      ...(updates.awayGoals !== undefined ? { awayGoals: Number(updates.awayGoals) } : {}),
      ...(updates.matchday !== undefined ? { matchday: Number(updates.matchday) || 1 } : {}),
      ...(updates.leg ? { leg: updates.leg } : {}),
      ...(updates.playedAt !== undefined ? { playedAt: clamp(updates.playedAt, 40) } : {}),
      ...(updates.notes !== undefined ? { notes: clamp(updates.notes, 600) } : {}),
      ...(updates.status ? { status: updates.status } : {}),
      ...(updates.status === 'validated' ? { validatedAt: now } : {}),
      updatedAt: now,
    });

    const batch = writeBatch(db);
    batch.set(ref, next);

    if (next.status === 'validated' && next.fixtureId) {
      const fxRef = doc(db, 'fixtures', safeDocId(next.fixtureId));
      const fxSnap = await getDoc(fxRef);
      if (fxSnap.exists()) {
        batch.update(fxRef, {
          completedMatchId: id,
          updatedAt: now,
        });
      }
    }

    // If Cup or Recopa match validated, sync Cup bracket automatically
    if (
      next.status === 'validated' &&
      (next.competitionType === 'copa' || next.competitionType === 'recopa') &&
      updates.cup
    ) {
      const { nextCup, synced } = syncValidatedMatchIntoCup(
        updates.cup,
        next,
        updates.teams || [],
        updates.allMatches || []
      );
      if (synced) {
        batch.set(doc(db, 'cup', 'current'), stripUndefined(nextCup));
      }
    }
    await batch.commit();
  });
}

export async function deleteMatchFirestore(matchId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(matchId);
  await runConfirmedWrite('Eliminar partido', OperationType.DELETE, `matches/${id}`, async () => {
    await deleteDoc(doc(db, 'matches', id));
  });
}

// --- Fixtures & Calendar ---
export async function createFixtureFirestore(input: {
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  leg: 'Ida' | 'Vuelta';
  scheduledDate?: string;
  scheduledTime?: string;
  notes?: string;
}): Promise<ScheduledFixture> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(`fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const now = new Date().toISOString();
  const fx: ScheduledFixture = stripUndefined({
    id,
    matchday: Number(input.matchday) || 1,
    homeTeamId: safeDocId(input.homeTeamId),
    awayTeamId: safeDocId(input.awayTeamId),
    leg: input.leg,
    scheduledDate: clamp(input.scheduledDate || '', 20),
    scheduledTime: clamp(input.scheduledTime || '', 20),
    notes: clamp(input.notes || '', 500),
    createdAt: now,
    updatedAt: now,
  });
  await runConfirmedWrite('Programar cruce', OperationType.CREATE, `fixtures/${id}`, async () => {
    await setDoc(doc(db, 'fixtures', id), fx);
  });
  return fx;
}

export async function deleteFixtureFirestore(fixtureId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(fixtureId);
  await runConfirmedWrite('Eliminar cruce', OperationType.DELETE, `fixtures/${id}`, async () => {
    await deleteDoc(doc(db, 'fixtures', id));
  });
}

export async function updateFixtureScheduleFirestore(
  fixtureId: string,
  scheduledDate: string,
  scheduledTime: string
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(fixtureId);
  await runConfirmedWrite(
    'Actualizar horario de cruce',
    OperationType.UPDATE,
    `fixtures/${id}`,
    async () => {
      await updateDoc(doc(db, 'fixtures', id), {
        scheduledDate: clamp(scheduledDate, 20),
        scheduledTime: clamp(scheduledTime, 20),
        updatedAt: new Date().toISOString(),
      });
    }
  );
}

export async function createCalendarEventFirestore(input: {
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
}): Promise<CalendarEvent> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(`cal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const now = new Date().toISOString();
  const ev: CalendarEvent = stripUndefined({
    id,
    title: clamp(input.title, 160),
    category: input.category,
    date: clamp(input.date, 20),
    time: clamp(input.time || '21:00', 10),
    roundLabel: clamp(input.roundLabel || '', 100) || undefined,
    cupMatchId: input.cupMatchId ? clamp(input.cupMatchId, 64) : undefined,
    fixtureId: input.fixtureId ? clamp(input.fixtureId, 64) : undefined,
    homeTeamId: input.homeTeamId ? clamp(input.homeTeamId, 32) : undefined,
    awayTeamId: input.awayTeamId ? clamp(input.awayTeamId, 32) : undefined,
    homeTeamName: input.homeTeamName ? clamp(input.homeTeamName, 100) : undefined,
    awayTeamName: input.awayTeamName ? clamp(input.awayTeamName, 100) : undefined,
    homeCrestUrl: input.homeCrestUrl ? clamp(input.homeCrestUrl, 500) : undefined,
    awayCrestUrl: input.awayCrestUrl ? clamp(input.awayCrestUrl, 500) : undefined,
    notes: clamp(input.notes || '', 600),
    createdAt: now,
    updatedAt: now,
  });
  await runConfirmedWrite(
    'Agendar evento en Calendario',
    OperationType.CREATE,
    `calendar_events/${id}`,
    async () => {
      await setDoc(doc(db, 'calendar_events', id), ev);
    }
  );
  return ev;
}

export async function updateCalendarEventFirestore(
  eventId: string,
  updates: Partial<CalendarEvent>
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(eventId);
  await runConfirmedWrite(
    'Actualizar evento de Calendario',
    OperationType.UPDATE,
    `calendar_events/${id}`,
    async () => {
      const ref = doc(db, 'calendar_events', id);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('Evento no encontrado.');
      const cur = snap.data() as CalendarEvent;
      await setDoc(
        ref,
        stripUndefined({
          ...cur,
          ...updates,
          id: cur.id,
          title: clamp(updates.title ?? cur.title, 160),
          notes: clamp(updates.notes ?? cur.notes ?? '', 600),
          createdAt: cur.createdAt,
          updatedAt: new Date().toISOString(),
        })
      );
    }
  );
}

export async function deleteCalendarEventFirestore(eventId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(eventId);
  await runConfirmedWrite(
    'Eliminar evento de Calendario',
    OperationType.DELETE,
    `calendar_events/${id}`,
    async () => {
      await deleteDoc(doc(db, 'calendar_events', id));
    }
  );
}

// --- Claims & Media Moderation ---
export async function submitClaimFirestore(input: {
  matchId?: string;
  reporterTeamId: string;
  reporterName: string;
  accusedTeamId?: string;
  accusedTeamName?: string;
  reasonType: ClaimReasonType;
  description: string;
  cardPhotoUrl?: string;
  videoUrl?: string;
}): Promise<Claim> {
  const u = requireVerifiedFirebaseUser();
  const id = safeDocId(`claim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const now = new Date().toISOString();
  const claim: Claim = stripUndefined({
    id,
    matchId: input.matchId ? clamp(input.matchId, 64) : undefined,
    reporterTeamId: clamp(input.reporterTeamId, 32),
    reporterName: clamp(input.reporterName, 100),
    reporterUid: u.uid,
    accusedTeamId: input.accusedTeamId ? clamp(input.accusedTeamId, 32) : undefined,
    accusedTeamName: input.accusedTeamName ? clamp(input.accusedTeamName, 100) : undefined,
    reasonType: input.reasonType,
    description: clamp(input.description, 1200),
    cardPhotoUrl: input.cardPhotoUrl ? clamp(input.cardPhotoUrl, 500) : undefined,
    cardPhotoStatus: input.cardPhotoUrl ? 'pending' : undefined,
    videoUrl: input.videoUrl ? clamp(input.videoUrl, 500) : undefined,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  });
  await runConfirmedWrite('Enviar reclamo', OperationType.CREATE, `claims/${id}`, async () => {
    await setDoc(doc(db, 'claims', id), claim);
  });
  return claim;
}

export async function resolveClaimFirestore(
  claimId: string,
  status: ClaimStatus,
  adminResolutionNote?: string
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(claimId);
  await runConfirmedWrite('Resolver reclamo', OperationType.UPDATE, `claims/${id}`, async () => {
    const ref = doc(db, 'claims', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Reclamo no encontrado.');
    const cur = snap.data() as Claim;
    const now = new Date().toISOString();
    await setDoc(
      ref,
      stripUndefined({
        ...cur,
        status,
        adminResolutionNote: clamp(adminResolutionNote ?? cur.adminResolutionNote ?? '', 600),
        resolvedAt: now,
        updatedAt: now,
      })
    );
  });
}

export async function deleteClaimFirestore(claimId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(claimId);
  await runConfirmedWrite('Eliminar reclamo', OperationType.DELETE, `claims/${id}`, async () => {
    await deleteDoc(doc(db, 'claims', id));
  });
}

export async function moderateMediaFirestore(input: {
  targetType: 'match_proof' | 'match_scorer' | 'claim_card' | 'claim_video' | 'team_celebration';
  targetId: string;
  decision?: ModerationStatus;
  action?: 'approve' | 'remove';
}): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(input.targetId);
  const now = new Date().toISOString();
  const isRemove = input.action === 'remove' || input.decision === 'rejected';
  const nextStatus: ModerationStatus = input.decision || (isRemove ? 'rejected' : 'approved');

  if (input.targetType === 'team_celebration') {
    await runConfirmedWrite('Moderar festejo', OperationType.UPDATE, `teams/${id}`, async () => {
      await updateDoc(doc(db, 'teams', id), {
        ...(isRemove ? { celebrationImageUrl: '' } : {}),
        celebrationStatus: nextStatus,
        updatedAt: now,
      });
    });
  } else if (input.targetType === 'claim_card') {
    await runConfirmedWrite('Moderar evidencia', OperationType.UPDATE, `claims/${id}`, async () => {
      await updateDoc(doc(db, 'claims', id), {
        ...(isRemove ? { cardPhotoUrl: '' } : {}),
        cardPhotoStatus: nextStatus,
        updatedAt: now,
      });
    });
  } else if (input.targetType === 'claim_video') {
    await runConfirmedWrite('Quitar video de reclamo', OperationType.UPDATE, `claims/${id}`, async () => {
      await updateDoc(doc(db, 'claims', id), {
        videoUrl: '',
        updatedAt: now,
      });
    });
  } else {
    const isScorer = input.targetType === 'match_scorer';
    const field = isScorer ? 'scorerImageStatus' : 'proofImageStatus';
    const urlField = isScorer ? 'scorerImageUrl' : 'proofImageUrl';
    await runConfirmedWrite('Moderar captura', OperationType.UPDATE, `matches/${id}`, async () => {
      await updateDoc(doc(db, 'matches', id), {
        ...(isRemove ? { [urlField]: '' } : {}),
        [field]: nextStatus,
        updatedAt: now,
      });
    });
  }
}

// --- News & Comments ---
export async function createNewsFirestore(input: {
  title: string;
  content: string;
  textColor?: string;
  imageUrl?: string;
  videoUrl?: string;
}): Promise<NewsPost> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(`news_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const now = new Date().toISOString();
  const post: NewsPost = stripUndefined({
    id,
    title: clamp(input.title, 200),
    content: clamp(input.content, 4000),
    textColor: clamp(input.textColor || '#FACC15', 30),
    imageUrl: input.imageUrl ? clamp(input.imageUrl, 500) : undefined,
    videoUrl: input.videoUrl ? clamp(input.videoUrl, 500) : undefined,
    likes: 0,
    createdAt: now,
    updatedAt: now,
  });
  await runConfirmedWrite('Publicar noticia', OperationType.CREATE, `news/${id}`, async () => {
    await setDoc(doc(db, 'news', id), post);
  });
  return post;
}

export async function updateNewsFirestore(
  newsId: string,
  updates: {
    title: string;
    content: string;
    textColor?: string;
    imageUrl?: string | null;
    videoUrl?: string | null;
  }
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(newsId);
  await runConfirmedWrite('Actualizar noticia', OperationType.UPDATE, `news/${id}`, async () => {
    const ref = doc(db, 'news', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Noticia no encontrada.');
    const cur = snap.data() as NewsPost;
    const next: NewsPost = stripUndefined({
      ...cur,
      title: clamp(updates.title, 200),
      content: clamp(updates.content, 4000),
      textColor: clamp(updates.textColor || cur.textColor || '#FACC15', 30),
      imageUrl: updates.imageUrl === null ? undefined : clamp(updates.imageUrl ?? cur.imageUrl ?? '', 500) || undefined,
      videoUrl: updates.videoUrl === null ? undefined : clamp(updates.videoUrl ?? cur.videoUrl ?? '', 500) || undefined,
      updatedAt: new Date().toISOString(),
    });
    await setDoc(ref, next);
  });
}

export async function deleteNewsFirestore(newsId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const rawId = String(newsId || '').trim();
  const id = safeDocId(rawId);
  await runConfirmedWrite('Eliminar noticia', OperationType.DELETE, `news/${id}`, async () => {
    const batch = writeBatch(db);
    let queued = 0;

    if (rawId && /^[a-zA-Z0-9_\-]+$/.test(rawId) && rawId.length <= 128) {
      batch.delete(doc(db, 'news', rawId));
      queued += 1;
    }
    if (id && id !== rawId) {
      batch.delete(doc(db, 'news', id));
      queued += 1;
    }

    if (rawId) {
      try {
        const dupesSnap = await getDocs(query(collection(db, 'news'), where('id', '==', rawId)));
        for (const d of dupesSnap.docs) {
          if (d.id !== rawId && d.id !== id) {
            batch.delete(doc(db, 'news', d.id));
            queued += 1;
          }
        }
      } catch {
        // Optional duplicate cleanup query
      }
    }

    if (queued > 0) {
      await batch.commit();
    } else {
      await deleteDoc(doc(db, 'news', id));
    }

    apiFetch(`/api/news/${encodeURIComponent(rawId || id)}`, { method: 'DELETE' }).catch(
      () => undefined
    );
  });
}

export async function submitCommentFirestore(input: {
  authorName: string;
  authorTeamName?: string;
  authorTeamId?: string;
  message: string;
  isAdmin: boolean;
}): Promise<LeagueComment> {
  const u = requireVerifiedFirebaseUser();
  const id = safeDocId(`cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const now = new Date().toISOString();
  const comment: LeagueComment = stripUndefined({
    id,
    authorName: clamp(input.authorName, 100),
    authorTeamName: input.authorTeamName ? clamp(input.authorTeamName, 100) : undefined,
    authorTeamId: input.authorTeamId ? clamp(input.authorTeamId, 32) : undefined,
    authorUid: u.uid,
    message: clamp(input.message, 800),
    status: input.isAdmin ? 'approved' : 'pending',
    createdAt: now,
    updatedAt: now,
  });
  await runConfirmedWrite('Enviar comentario', OperationType.CREATE, `comments/${id}`, async () => {
    await setDoc(doc(db, 'comments', id), comment);
  });
  return comment;
}

export async function approveCommentFirestore(commentId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(commentId);
  await runConfirmedWrite('Aprobar comentario', OperationType.UPDATE, `comments/${id}`, async () => {
    await updateDoc(doc(db, 'comments', id), {
      status: 'approved',
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function deleteCommentFirestore(commentId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(commentId);
  await runConfirmedWrite('Eliminar comentario', OperationType.DELETE, `comments/${id}`, async () => {
    await deleteDoc(doc(db, 'comments', id));
  });
}

// --- Top 5 Goals ---
export async function upsertTopGoalFirestore(input: {
  rank: number;
  title: string;
  scorerName?: string;
  author?: string;
  videoUrl: string;
  sourceVideoId?: string;
}): Promise<TopGoalItem> {
  requireVerifiedFirebaseUser();
  const rank = Math.min(5, Math.max(1, Number(input.rank) || 1));
  const id = `top_goal_${rank}`;
  const now = new Date().toISOString();
  const item: TopGoalItem = stripUndefined({
    id,
    rank,
    title: clamp(input.title, 160),
    scorerName: input.scorerName ? clamp(input.scorerName, 100) : undefined,
    author: input.author ? clamp(input.author, 100) : undefined,
    videoUrl: clamp(input.videoUrl, 500),
    sourceVideoId: input.sourceVideoId ? clamp(input.sourceVideoId, 80) : undefined,
    createdAt: now,
    updatedAt: now,
  });
  await runConfirmedWrite('Guardar Top Gol', OperationType.WRITE, `top_goals/${id}`, async () => {
    await setDoc(doc(db, 'top_goals', id), item);
  });
  return item;
}

export async function deleteTopGoalFirestore(goalId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(goalId);
  await runConfirmedWrite('Eliminar Top Gol', OperationType.DELETE, `top_goals/${id}`, async () => {
    await deleteDoc(doc(db, 'top_goals', id));
  });
}

// --- Champions, Rules, Music, Official Videos, Community Videos ---
export async function createChampionFirestore(input: {
  season: string;
  teamName: string;
  memberName: string;
  teamId?: string;
  tournamentType?: 'liga' | 'copa' | 'recopa';
  notes?: string;
  celebrationImageUrl?: string;
}): Promise<ChampionEntry> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(`champ_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const type = input.tournamentType || 'liga';

  let customTrophyUrl = '';
  let customTournamentTitle = '';
  try {
    const settingsSnap = await getDoc(doc(db, 'league_settings', 'global'));
    if (settingsSnap.exists()) {
      const s = settingsSnap.data() as LeagueSettings;
      customTrophyUrl =
        type === 'copa'
          ? s.copaTrophyUrl || ''
          : type === 'recopa'
          ? s.recopaTrophyUrl || ''
          : s.ligaTrophyUrl || '';
      customTournamentTitle =
        type === 'copa'
          ? s.customTitles?.compCopaName || ''
          : type === 'recopa'
          ? s.customTitles?.compRecopaName || ''
          : s.customTitles?.compLigaName || '';
    }
  } catch {
    // Fallback to default trophy image
  }

  const resolvedCelebrationUrl = clamp(input.celebrationImageUrl || customTrophyUrl || '', 500);
  const entry = buildChampionHallEntry({
    id,
    season: clamp(input.season, 140),
    teamName: clamp(input.teamName, 120),
    memberName: clamp(input.memberName, 120),
    teamId: input.teamId ? clamp(input.teamId, 32) : undefined,
    tournamentType: type,
    notes: clamp(input.notes || '', 600),
    celebrationImageUrl: resolvedCelebrationUrl || undefined,
    trophyImageUrl: customTrophyUrl || undefined,
  });
  await runConfirmedWrite('Registrar campeón', OperationType.CREATE, `champions/${id}`, async () => {
    const batch = writeBatch(db);
    batch.set(doc(db, 'champions', id), stripUndefined(entry));
    const sourceKey = `champ_${id}`;
    const newsPost = buildChampionNewspaperPost({
      teamName: entry.teamName,
      memberName: entry.memberName,
      type,
      season: entry.season,
      celebrationImageUrl: entry.celebrationImageUrl,
      trophyImageUrl: customTrophyUrl || undefined,
      tournamentLabel: customTournamentTitle || undefined,
      sourceKey,
    });
    batch.set(doc(db, 'news', safeDocId(newsPost.id)), stripUndefined(newsPost));
    if (entry.teamId) {
      const teamSnap = await getDoc(doc(db, 'teams', safeDocId(entry.teamId)));
      if (teamSnap.exists()) {
        const team = teamSnap.data() as Team;
        const nextTrophies = [
          ...(team.trophies || []),
          buildTrophyEntry({
            type,
            season: entry.season,
            message: entry.notes,
            imageUrl: customTrophyUrl || undefined,
            title: customTournamentTitle ? `Campeón ${customTournamentTitle}` : undefined,
            sourceKey,
          }),
        ].slice(0, 60);
        batch.update(doc(db, 'teams', safeDocId(entry.teamId)), {
          trophies: nextTrophies,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    await batch.commit();
  });
  return entry;
}

export async function updateChampionFirestore(
  champId: string,
  updates: Partial<ChampionEntry>
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(champId);
  await runConfirmedWrite('Editar campeón', OperationType.UPDATE, `champions/${id}`, async () => {
    const ref = doc(db, 'champions', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Campeón no encontrado.');
    const cur = snap.data() as ChampionEntry;
    await setDoc(
      ref,
      stripUndefined({
        ...cur,
        ...updates,
        id: cur.id,
        season: clamp(updates.season ?? cur.season, 140),
        teamName: clamp(updates.teamName ?? cur.teamName, 120),
        memberName: clamp(updates.memberName ?? cur.memberName, 120),
        notes: clamp(updates.notes ?? cur.notes ?? '', 600),
        celebrationImageUrl: clamp(updates.celebrationImageUrl ?? cur.celebrationImageUrl, 500),
        createdAt: cur.createdAt,
        updatedAt: new Date().toISOString(),
      })
    );
  });
}

export async function deleteChampionFirestore(champId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(champId);
  await runConfirmedWrite('Eliminar campeón', OperationType.DELETE, `champions/${id}`, async () => {
    await deleteDoc(doc(db, 'champions', id));
  });
}

export async function awardLeagueChampionFirestore(input: {
  team: PublicTeam;
  season: string;
  notes?: string;
  trophyImageUrl?: string;
}): Promise<void> {
  await createChampionFirestore({
    season: input.season,
    teamName: input.team.name,
    memberName: input.team.memberName,
    teamId: input.team.id,
    tournamentType: 'liga',
    notes: input.notes || `Campeón oficial de la liga (${input.season}).`,
    celebrationImageUrl: input.trophyImageUrl || '',
  });
}

export async function saveRulesFirestore(rules: RulesConfig): Promise<void> {
  requireVerifiedFirebaseUser();
  await runConfirmedWrite('Guardar reglamento', OperationType.WRITE, 'rules/global', async () => {
    await setDoc(
      doc(db, 'rules', 'global'),
      stripUndefined({
        prohibitedRules: (rules.prohibitedRules || []).slice(0, 50),
        generalNotes: clamp(rules.generalNotes || '', 2000),
        gameMode: rules.gameMode || {},
        cupRules: rules.cupRules || {},
        updatedAt: new Date().toISOString(),
      })
    );
  });
}

export async function addLeagueMusicFirestore(track: Omit<MusicTrack, 'id' | 'createdAt'>): Promise<MusicTrack> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(`track_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const entry: MusicTrack = stripUndefined({
    id,
    title: clamp(track.title, 160),
    artist: clamp(track.artist, 120),
    audioUrl: clamp(track.audioUrl, 500),
    coverUrl: track.coverUrl ? clamp(track.coverUrl, 500) : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await runConfirmedWrite('Agregar canción oficial', OperationType.CREATE, `music/${id}`, async () => {
    await setDoc(doc(db, 'music', id), entry);
  });
  return entry;
}

export async function deleteLeagueMusicFirestore(trackId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(trackId);
  await runConfirmedWrite('Eliminar canción oficial', OperationType.DELETE, `music/${id}`, async () => {
    await deleteDoc(doc(db, 'music', id));
  });
}

export async function deleteOfficialVideoFirestore(videoId: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(videoId);
  await runConfirmedWrite('Eliminar video oficial', OperationType.DELETE, `videos/${id}`, async () => {
    await deleteDoc(doc(db, 'videos', id));
  });
}

export async function updateOfficialVideoFirestore(
  videoId: string,
  updates: { title: string; description?: string }
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(videoId);
  await runConfirmedWrite('Editar video oficial', OperationType.UPDATE, `videos/${id}`, async () => {
    await updateDoc(doc(db, 'videos', id), {
      title: clamp(updates.title, 160),
      description: clamp(updates.description || '', 500),
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function toggleFeaturedOfficialVideoFirestore(
  video: GalleryVideo,
  allVideos: GalleryVideo[]
): Promise<void> {
  requireVerifiedFirebaseUser();
  await runConfirmedWrite(
    'Destacar video oficial',
    OperationType.WRITE,
    `videos/${video.id}`,
    async () => {
      const batch = writeBatch(db);
      for (const v of allVideos) {
        batch.update(doc(db, 'videos', safeDocId(v.id)), { featured: v.id === video.id });
      }
      batch.update(doc(db, 'league_settings', 'global'), {
        featuredVideo: {
          id: video.id,
          source: 'local',
          title: video.title,
          author: video.uploadedBy,
          videoUrl: video.videoUrl,
          downloadUrl: video.downloadUrl,
          originalFormat: video.originalFormat,
        },
        updatedAt: new Date().toISOString(),
      });
      await batch.commit();
    }
  );
}

export async function publishCommunityVideoFirestore(input: {
  titulo: string;
  autor: string;
  videoUrl: string;
}): Promise<string> {
  const u = requireVerifiedFirebaseUser();
  const id = safeDocId(`cv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const now = new Date().toISOString();
  await runConfirmedWrite(
    'Publicar video en comunidad',
    OperationType.CREATE,
    `videos_comunidad/${id}`,
    async () => {
      await setDoc(doc(db, 'videos_comunidad', id), {
        titulo: clamp(input.titulo, 160),
        autor: clamp(input.autor, 120),
        videoUrl: clamp(input.videoUrl, 500),
        authorUid: u.uid,
        fecha: serverTimestamp(),
        createdAt: now,
      });
      notifyCommunityVideosChanged();
    }
  );
  return id;
}

export async function deleteCommunityVideoFirestore(
  videoId: string,
  currentFeaturedVideoId?: string
): Promise<void> {
  requireVerifiedFirebaseUser();
  const id = safeDocId(videoId);
  await runConfirmedWrite(
    'Eliminar video de comunidad',
    OperationType.DELETE,
    `videos_comunidad/${id}`,
    async () => {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'videos_comunidad', id));
      if (currentFeaturedVideoId === videoId) {
        const settingsRef = doc(db, 'league_settings', 'global');
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          batch.update(settingsRef, {
            featuredVideo: null,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      await batch.commit();
      notifyCommunityVideosChanged();
    }
  );
}

// --- Cup & Recopa ---
export async function saveCupFirestore(
  nextCup: CupTournament,
  teams: PublicTeam[],
  leagueMatches: Match[],
  label = 'Guardar Copa de la Liga'
): Promise<CupTournament> {
  requireVerifiedFirebaseUser();
  const computed = recomputeCupBracket(nextCup, teams, leagueMatches);
  await runConfirmedWrite(label, OperationType.WRITE, 'cup/current', async () => {
    await setDoc(doc(db, 'cup', 'current'), stripUndefined(computed));
  });
  return computed;
}

export async function updateCupEditionNameFirestore(editionName: string): Promise<void> {
  requireVerifiedFirebaseUser();
  const cleanName = clamp(editionName, 160);
  if (!cleanName) throw new Error('El nombre de la edición de Copa no puede estar vacío.');
  await runConfirmedWrite('Actualizar nombre de Copa', OperationType.UPDATE, 'cup/current', async () => {
    await updateDoc(doc(db, 'cup', 'current'), {
      editionName: cleanName,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function updateCupMatchNodeFirestore(
  currentCup: CupTournament,
  matchId: string,
  patch: {
    homeSlot?: number | null;
    awaySlot?: number | null;
    homeGoals?: number | null;
    awayGoals?: number | null;
    homePenalties?: number | null;
    awayPenalties?: number | null;
    extraTime?: boolean;
    winnerSlot?: number | null;
    played?: boolean;
    scheduledDate?: string;
    scheduledTime?: string;
  },
  teams: PublicTeam[] = [],
  leagueMatches: Match[] = []
): Promise<CupTournament> {
  const draft: CupTournament = JSON.parse(JSON.stringify(currentCup)) as CupTournament;
  const node = draft.matches.find((m) => m.id === matchId);
  if (!node) throw new Error('Llave de copa no encontrada.');

  if (patch.homeSlot !== undefined) node.homeSlot = patch.homeSlot;
  if (patch.awaySlot !== undefined) node.awaySlot = patch.awaySlot;
  if (patch.homeGoals !== undefined) node.homeGoals = patch.homeGoals;
  if (patch.awayGoals !== undefined) node.awayGoals = patch.awayGoals;
  if (patch.homePenalties !== undefined) node.homePenalties = patch.homePenalties;
  if (patch.awayPenalties !== undefined) node.awayPenalties = patch.awayPenalties;
  if (patch.extraTime !== undefined) node.extraTime = patch.extraTime;
  if (patch.scheduledDate !== undefined) node.scheduledDate = patch.scheduledDate || undefined;
  if (patch.scheduledTime !== undefined) node.scheduledTime = patch.scheduledTime || undefined;
  if (patch.played !== undefined) {
    node.played = patch.played;
  } else if (patch.winnerSlot !== undefined) {
    node.played = patch.winnerSlot !== null;
  } else if (node.homeGoals !== null && node.awayGoals !== null) {
    node.played = true;
  }

  if (patch.winnerSlot !== undefined) {
    const prevWinner = node.winnerSlot;
    node.winnerSlot = patch.winnerSlot;
    if (patch.winnerSlot === null && prevWinner !== null) {
      const nextEdge = NEXT_STAGE_MAP[matchId];
      if (nextEdge) {
        const nextNode = draft.matches.find((m) => m.id === nextEdge.nextMatchId);
        if (nextNode) {
          if (nextEdge.side === 'home' && nextNode.homeSlot === prevWinner) {
            nextNode.homeSlot = null;
          } else if (nextEdge.side === 'away' && nextNode.awaySlot === prevWinner) {
            nextNode.awaySlot = null;
          }
        }
      }
    }
  }

  return saveCupFirestore(draft, teams, leagueMatches, 'Actualizar llave de Copa');
}

export async function updateCupRecopaFirestore(
  currentCup: CupTournament,
  patch: {
    clearLeague?: boolean;
    clearCup?: boolean;
    pullLeagueLeader?: boolean;
    leagueTeamId?: string;
    cupTeamId?: string;
    leagueChampionName?: string;
    leagueChampionMember?: string;
    leagueChampionCrestUrl?: string;
    cupChampionName?: string;
    cupChampionMember?: string;
    cupChampionCrestUrl?: string;
    leagueGoals?: number | null;
    cupGoals?: number | null;
    leaguePenalties?: number | null;
    cupPenalties?: number | null;
    extraTime?: boolean;
    grandChampionSide?: 'league' | 'cup' | null;
    greeting?: string;
    scheduledDate?: string;
    scheduledTime?: string;
  },
  teams: PublicTeam[] = [],
  leagueMatches: Match[] = []
): Promise<CupTournament> {
  const draft: CupTournament = JSON.parse(JSON.stringify(currentCup)) as CupTournament;
  const rec = draft.recopa;

  if (patch.clearLeague) {
    rec.leagueChampionName = '';
    rec.leagueChampionMember = '';
    rec.leagueChampionCrestUrl = '';
    rec.leagueGoals = null;
    rec.leaguePenalties = null;
    if (rec.grandChampionSide === 'league') {
      rec.grandChampionSide = null;
      rec.grandChampionName = '';
      rec.grandChampionMember = '';
      rec.grandChampionCrestUrl = '';
      rec.played = false;
    }
  }
  if (patch.clearCup) {
    rec.cupChampionName = '';
    rec.cupChampionMember = '';
    rec.cupChampionCrestUrl = '';
    rec.cupGoals = null;
    rec.cupPenalties = null;
    if (rec.grandChampionSide === 'cup') {
      rec.grandChampionSide = null;
      rec.grandChampionName = '';
      rec.grandChampionMember = '';
      rec.grandChampionCrestUrl = '';
      rec.played = false;
    }
  }
  if (patch.pullLeagueLeader) {
    const ranked = computeStandings(teams, leagueMatches).map((s) => s.team);
    if (ranked[0]) {
      rec.leagueChampionName = ranked[0].name;
      rec.leagueChampionMember = ranked[0].memberName;
      rec.leagueChampionCrestUrl = ranked[0].crestUrl;
    }
  }
  if (patch.leagueTeamId) {
    const found = teams.find((t) => t.id === patch.leagueTeamId);
    if (found) {
      rec.leagueChampionName = found.name;
      rec.leagueChampionMember = found.memberName;
      rec.leagueChampionCrestUrl = found.crestUrl;
    }
  }
  if (patch.cupTeamId) {
    const found = teams.find((t) => t.id === patch.cupTeamId);
    if (found) {
      rec.cupChampionName = found.name;
      rec.cupChampionMember = found.memberName;
      rec.cupChampionCrestUrl = found.crestUrl;
    }
  }
  if (patch.leagueChampionName !== undefined) rec.leagueChampionName = patch.leagueChampionName.trim();
  if (patch.leagueChampionMember !== undefined) rec.leagueChampionMember = patch.leagueChampionMember.trim();
  if (patch.leagueChampionCrestUrl !== undefined) rec.leagueChampionCrestUrl = patch.leagueChampionCrestUrl.trim();
  if (patch.cupChampionName !== undefined) rec.cupChampionName = patch.cupChampionName.trim();
  if (patch.cupChampionMember !== undefined) rec.cupChampionMember = patch.cupChampionMember.trim();
  if (patch.cupChampionCrestUrl !== undefined) rec.cupChampionCrestUrl = patch.cupChampionCrestUrl.trim();
  if (patch.leagueGoals !== undefined) rec.leagueGoals = patch.leagueGoals;
  if (patch.cupGoals !== undefined) rec.cupGoals = patch.cupGoals;
  if (patch.leaguePenalties !== undefined) rec.leaguePenalties = patch.leaguePenalties;
  if (patch.cupPenalties !== undefined) rec.cupPenalties = patch.cupPenalties;
  if (patch.extraTime !== undefined) rec.extraTime = patch.extraTime;
  if (patch.greeting !== undefined) {
    rec.greeting = patch.greeting.trim() || '¡Felicitaciones Campeón de la Recopa!';
  }
  if (patch.scheduledDate !== undefined) rec.scheduledDate = patch.scheduledDate.trim() || undefined;
  if (patch.scheduledTime !== undefined) rec.scheduledTime = patch.scheduledTime.trim() || undefined;

  let side = rec.grandChampionSide;
  if (patch.grandChampionSide !== undefined) {
    side = patch.grandChampionSide;
  } else if (rec.leagueGoals !== null && rec.cupGoals !== null) {
    if (rec.leagueGoals > rec.cupGoals) side = 'league';
    else if (rec.cupGoals > rec.leagueGoals) side = 'cup';
    else if (rec.leaguePenalties !== null && rec.cupPenalties !== null) {
      if (rec.leaguePenalties > rec.cupPenalties) side = 'league';
      else if (rec.cupPenalties > rec.leaguePenalties) side = 'cup';
    }
  }
  rec.grandChampionSide = side;
  if (side === 'league' && rec.leagueChampionName) {
    rec.grandChampionName = rec.leagueChampionName;
    rec.grandChampionMember = rec.leagueChampionMember;
    rec.grandChampionCrestUrl = rec.leagueChampionCrestUrl;
    rec.played = true;
  } else if (side === 'cup' && rec.cupChampionName) {
    rec.grandChampionName = rec.cupChampionName;
    rec.grandChampionMember = rec.cupChampionMember;
    rec.grandChampionCrestUrl = rec.cupChampionCrestUrl;
    rec.played = true;
  } else if (side === null) {
    rec.grandChampionName = '';
    rec.grandChampionMember = '';
    rec.grandChampionCrestUrl = '';
    rec.played = false;
  }

  return saveCupFirestore(draft, teams, leagueMatches, 'Actualizar Final de Recopa');
}

export async function resetCupFirestore(
  currentCup: CupTournament,
  teams: PublicTeam[],
  useStandingsOrder = false,
  leagueMatches: Match[] = [],
  opts?: { clearParticipants?: boolean; editionName?: string }
): Promise<CupTournament> {
  requireVerifiedFirebaseUser();
  const clearParticipants = opts?.clearParticipants !== false;
  const nextEdition = (currentCup.editionNumber || 1) + 1;
  const orderedTeams = useStandingsOrder
    ? computeStandings(teams, leagueMatches).map((s) => s.team)
    : teams;
  const seeded = clearParticipants ? [] : orderedTeams.slice(0, 16);
  const fresh = buildEmptyCup(nextEdition, clearParticipants ? [] : seeded);
  if (!clearParticipants && currentCup.participants?.length === 16) {
    fresh.participants = currentCup.participants.map((p) => ({ ...p }));
  }
  if (opts?.editionName?.trim()) {
    fresh.editionName = opts.editionName.trim();
  }
  const computed = recomputeCupBracket(fresh, teams, leagueMatches);
  await runConfirmedWrite('Reiniciar nueva edición de Copa', OperationType.WRITE, 'cup/current', async () => {
    await setDoc(doc(db, 'cup', 'current'), stripUndefined(computed));
  });
  return computed;
}

// --- Backups & Recovery (Cloud Firestore + JSON Export/Restore) ---
export async function buildLiveLeagueSnapshot(): Promise<{
  summary: BackupSummary;
  snapshot: Record<string, unknown>;
}> {
  const [
    settingsSnap,
    teamsSnap,
    matchesSnap,
    fixturesSnap,
    calendarSnap,
    claimsSnap,
    newsSnap,
    topGoalsSnap,
    commentsSnap,
    championsSnap,
    rulesSnap,
    cupSnap,
    musicSnap,
    videosSnap,
    communitySnap,
  ] = await Promise.all([
    getDoc(doc(db, 'league_settings', 'global')),
    getDocs(collection(db, 'teams')),
    getDocs(collection(db, 'matches')),
    getDocs(collection(db, 'fixtures')),
    getDocs(collection(db, 'calendar_events')),
    getDocs(collection(db, 'claims')),
    getDocs(collection(db, 'news')),
    getDocs(collection(db, 'top_goals')),
    getDocs(collection(db, 'comments')),
    getDocs(collection(db, 'champions')),
    getDoc(doc(db, 'rules', 'global')),
    getDoc(doc(db, 'cup', 'current')),
    getDocs(collection(db, 'music')),
    getDocs(collection(db, 'videos')),
    getDocs(collection(db, 'videos_comunidad')),
  ]);

  const teams = teamsSnap.docs.map((d) => d.data());
  const matches = matchesSnap.docs.map((d) => d.data());
  const fixtures = fixturesSnap.docs.map((d) => d.data());
  const calendarEvents = calendarSnap.docs.map((d) => d.data());
  const claims = claimsSnap.docs.map((d) => d.data());
  const news = newsSnap.docs.map((d) => d.data());
  const topGoals = topGoalsSnap.docs.map((d) => d.data());
  const comments = commentsSnap.docs.map((d) => d.data());
  const champions = championsSnap.docs.map((d) => d.data());
  const music = musicSnap.docs.map((d) => d.data());
  const videos = videosSnap.docs.map((d) => d.data());
  const communityVideos = communitySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const settings = settingsSnap.exists() ? settingsSnap.data() : {};

  return {
    summary: {
      teamsCount: teams.length,
      matchesCount: matches.length,
      fixturesCount: fixtures.length,
      calendarEventsCount: calendarEvents.length,
      newsCount: news.length,
      claimsCount: claims.length,
      commentsCount: comments.length,
      championsCount: champions.length,
      musicCount: music.length,
      videosCount: videos.length,
      communityVideosCount: communityVideos.length,
      topGoalsCount: topGoals.length,
    },
    snapshot: stripUndefined({
      settings,
      teams,
      matches,
      fixtures,
      calendarEvents,
      claims,
      news,
      topGoals,
      comments,
      champions,
      rules: rulesSnap.exists() ? rulesSnap.data() : {},
      cup: cupSnap.exists() ? cupSnap.data() : {},
      music,
      videos,
      communityVideos,
      pageLikes: Number((settings as { pageLikes?: number })?.pageLikes ?? 0),
    }),
  };
}

export async function createFirestoreBackup(
  label: string,
  trigger: LeagueBackupRecord['trigger'] = 'manual'
): Promise<LeagueBackupRecord> {
  const user = requireVerifiedFirebaseUser();
  return runConfirmedWrite('Crear respaldo en Firestore', OperationType.CREATE, 'backups', async () => {
    const { summary, snapshot } = await buildLiveLeagueSnapshot();
    if (summary.teamsCount === 0) {
      throw new Error('No se puede crear un respaldo de una base vacía.');
    }
    const id = safeDocId(`bkp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`);
    const record: LeagueBackupRecord = {
      id,
      label: clamp(label || 'Respaldo manual completo', 160),
      trigger,
      createdByEmail: clamp(user.email || '', 180),
      summary,
      snapshot,
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'backups', id), stripUndefined(record));
    await logAuditEntry({
      action: 'create_backup',
      targetType: 'backup',
      targetId: id,
      targetLabel: record.label,
      details: `Respaldo guardado (${summary.teamsCount} equipos, ${summary.matchesCount} partidos).`,
      performedBy: user.email || 'Admin',
    });
    return record;
  });
}

export async function ensureDailyBackupIfNeeded(): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  try {
    let hasAdminAccess = isBootstrappedAdminEmail(user.email);
    if (!hasAdminAccess) {
      const adminSnap = await getDoc(doc(db, 'admins', safeDocId(user.uid)));
      hasAdminAccess = adminSnap.exists();
    }
    if (!hasAdminAccess) return;
    const latestSnap = await getDocs(
      query(collection(db, 'backups'), orderBy('createdAt', 'desc'), limit(1))
    );
    const latest = latestSnap.docs[0]?.data() as LeagueBackupRecord | undefined;
    if (latest?.createdAt) {
      const ageMs = Date.now() - new Date(latest.createdAt).getTime();
      if (ageMs < 24 * 60 * 60 * 1000) return;
    }
    const { summary, snapshot } = await buildLiveLeagueSnapshot();
    if (summary.teamsCount === 0) return;
    const id = safeDocId(`bkp_daily_${new Date().toISOString().slice(0, 10)}`);
    await setDoc(doc(db, 'backups', id), {
      id,
      label: `Respaldo diario automático (${new Date().toLocaleDateString('es-AR')})`,
      trigger: 'auto_daily',
      createdByEmail: clamp(user.email || '', 180),
      summary,
      snapshot,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Non-blocking background daily backup
  }
}

export async function listFirestoreBackups(): Promise<LeagueBackupRecord[]> {
  requireVerifiedFirebaseUser();
  try {
    const snap = await getDocs(
      query(collection(db, 'backups'), orderBy('createdAt', 'desc'), limit(25))
    );
    return snap.docs.map((d) => d.data() as LeagueBackupRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'backups');
  }
}

export async function restoreFirestoreBackup(backupId: string): Promise<void> {
  const user = requireVerifiedFirebaseUser();
  const id = safeDocId(backupId);
  await runConfirmedWrite('Restaurar respaldo', OperationType.WRITE, `backups/${id}`, async () => {
    const snap = await getDoc(doc(db, 'backups', id));
    if (!snap.exists()) throw new Error('Respaldo no encontrado en Firestore.');
    const record = snap.data() as LeagueBackupRecord;
    const s = record.snapshot as Record<string, unknown>;
    const teams = Array.isArray(s.teams) ? (s.teams as Team[]) : [];
    if (teams.length === 0) {
      throw new Error('El respaldo seleccionado está vacío y no puede sobrescribir la base.');
    }

    // Safety pre-restore backup before touching live docs
    const live = await buildLiveLeagueSnapshot();
    if (live.summary.teamsCount > 0) {
      const preId = safeDocId(`bkp_prerestore_${Date.now()}`);
      await setDoc(doc(db, 'backups', preId), {
        id: preId,
        label: `Respaldo automático previo a restauración (${record.label})`,
        trigger: 'pre_restore',
        createdByEmail: clamp(user.email || '', 180),
        summary: live.summary,
        snapshot: live.snapshot,
        createdAt: new Date().toISOString(),
      });
    }

    const now = new Date().toISOString();
    const ops: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
    if (s.settings && typeof s.settings === 'object') {
      ops.push({
        ref: doc(db, 'league_settings', 'global'),
        data: stripUndefined({ ...(s.settings as Record<string, unknown>), updatedAt: now }),
      });
    }
    if (s.rules && typeof s.rules === 'object') {
      ops.push({
        ref: doc(db, 'rules', 'global'),
        data: stripUndefined({ ...(s.rules as Record<string, unknown>), updatedAt: now }),
      });
    }
    if (s.cup && typeof s.cup === 'object') {
      ops.push({
        ref: doc(db, 'cup', 'current'),
        data: stripUndefined({ ...(s.cup as Record<string, unknown>), updatedAt: now }),
      });
    }

    const writeCollection = (colName: string, arr: unknown) => {
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const docId = safeDocId(String(rec.id || ''), colName);
        ops.push({
          ref: doc(db, colName, docId),
          data: stripUndefined({ ...rec, id: docId }),
        });
      }
    };

    writeCollection('teams', s.teams);
    writeCollection('matches', s.matches);
    writeCollection('fixtures', s.fixtures);
    writeCollection('calendar_events', s.calendarEvents);
    writeCollection('claims', s.claims);
    writeCollection('news', s.news);
    writeCollection('top_goals', s.topGoals);
    writeCollection('comments', s.comments);
    writeCollection('champions', s.champions);
    writeCollection('music', s.music);
    writeCollection('videos', s.videos);

    if (Array.isArray(s.communityVideos)) {
      for (const item of s.communityVideos) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const docId = safeDocId(String(rec.id || ''), 'cv');
        const cleanFecha =
          typeof rec.fecha === 'string'
            ? rec.fecha
            : rec.fecha && typeof (rec.fecha as { seconds?: number }).seconds === 'number'
            ? new Date((rec.fecha as { seconds: number }).seconds * 1000).toISOString()
            : typeof rec.createdAt === 'string'
            ? rec.createdAt
            : now;
        ops.push({
          ref: doc(db, 'videos_comunidad', docId),
          data: stripUndefined({
            titulo: clamp(rec.titulo, 160),
            autor: clamp(rec.autor, 120),
            videoUrl: clamp(rec.videoUrl, 500),
            ...(typeof rec.authorUid === 'string' && rec.authorUid
              ? { authorUid: rec.authorUid }
              : {}),
            fecha: cleanFecha,
            createdAt: typeof rec.createdAt === 'string' && rec.createdAt ? rec.createdAt : now,
          }),
        });
      }
    }

    for (let i = 0; i < ops.length; i += 380) {
      const batch = writeBatch(db);
      for (const item of ops.slice(i, i + 380)) {
        batch.set(item.ref, item.data);
      }
      await batch.commit();
    }

    await logAuditEntry({
      action: 'restore_backup',
      targetType: 'backup',
      targetId: id,
      targetLabel: record.label,
      details: `Base restaurada desde respaldo "${record.label}".`,
      performedBy: user.email || 'Admin',
    });
  });
}

export async function restoreSnapshotPayloadFirestore(
  snapshot: Record<string, unknown>,
  label = 'Importación manual JSON'
): Promise<void> {
  const user = requireVerifiedFirebaseUser();
  const teams = Array.isArray(snapshot.teams) ? (snapshot.teams as Team[]) : [];
  if (teams.length === 0) {
    throw new Error('El archivo JSON de respaldo no contiene equipos válidos.');
  }
  await runConfirmedWrite('Restaurar desde archivo JSON', OperationType.WRITE, 'backups/import', async () => {
    const live = await buildLiveLeagueSnapshot();
    if (live.summary.teamsCount > 0) {
      const preId = safeDocId(`bkp_prerestore_${Date.now()}`);
      await setDoc(doc(db, 'backups', preId), {
        id: preId,
        label: `Respaldo automático previo a importación (${label})`,
        trigger: 'pre_restore',
        createdByEmail: clamp(user.email || '', 180),
        summary: live.summary,
        snapshot: live.snapshot,
        createdAt: new Date().toISOString(),
      });
    }

    const now = new Date().toISOString();
    const ops: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
    if (snapshot.settings && typeof snapshot.settings === 'object') {
      ops.push({
        ref: doc(db, 'league_settings', 'global'),
        data: stripUndefined({ ...(snapshot.settings as Record<string, unknown>), updatedAt: now }),
      });
    }
    if (snapshot.rules && typeof snapshot.rules === 'object') {
      ops.push({
        ref: doc(db, 'rules', 'global'),
        data: stripUndefined({ ...(snapshot.rules as Record<string, unknown>), updatedAt: now }),
      });
    }
    if (snapshot.cup && typeof snapshot.cup === 'object') {
      ops.push({
        ref: doc(db, 'cup', 'current'),
        data: stripUndefined({ ...(snapshot.cup as Record<string, unknown>), updatedAt: now }),
      });
    }

    const writeCollection = (colName: string, arr: unknown) => {
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const docId = safeDocId(String(rec.id || ''), colName);
        ops.push({
          ref: doc(db, colName, docId),
          data: stripUndefined({ ...rec, id: docId }),
        });
      }
    };

    writeCollection('teams', snapshot.teams);
    writeCollection('matches', snapshot.matches);
    writeCollection('fixtures', snapshot.fixtures);
    writeCollection('calendar_events', snapshot.calendarEvents);
    writeCollection('claims', snapshot.claims);
    writeCollection('news', snapshot.news);
    writeCollection('top_goals', snapshot.topGoals);
    writeCollection('comments', snapshot.comments);
    writeCollection('champions', snapshot.champions);
    writeCollection('music', snapshot.music);
    writeCollection('videos', snapshot.videos);

    if (Array.isArray(snapshot.communityVideos)) {
      for (const item of snapshot.communityVideos) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const docId = safeDocId(String(rec.id || ''), 'cv');
        const cleanFecha =
          typeof rec.fecha === 'string'
            ? rec.fecha
            : rec.fecha && typeof (rec.fecha as { seconds?: number }).seconds === 'number'
            ? new Date((rec.fecha as { seconds: number }).seconds * 1000).toISOString()
            : typeof rec.createdAt === 'string'
            ? rec.createdAt
            : now;
        ops.push({
          ref: doc(db, 'videos_comunidad', docId),
          data: stripUndefined({
            titulo: clamp(rec.titulo, 160),
            autor: clamp(rec.autor, 120),
            videoUrl: clamp(rec.videoUrl, 500),
            ...(typeof rec.authorUid === 'string' && rec.authorUid
              ? { authorUid: rec.authorUid }
              : {}),
            fecha: cleanFecha,
            createdAt: typeof rec.createdAt === 'string' && rec.createdAt ? rec.createdAt : now,
          }),
        });
      }
    }

    for (let i = 0; i < ops.length; i += 380) {
      const batch = writeBatch(db);
      for (const item of ops.slice(i, i + 380)) {
        batch.set(item.ref, item.data);
      }
      await batch.commit();
    }

    await logAuditEntry({
      action: 'restore_backup',
      targetType: 'backup',
      targetId: 'json_import',
      targetLabel: label,
      details: `Base restaurada desde JSON (${teams.length} equipos).`,
      performedBy: user.email || 'Admin',
    });
  });
}

// --- Firebase Auth Member Link Helper ---
export async function resolveOrLinkFirebaseMember(
  uid: string,
  email: string,
  displayName: string
): Promise<{ role: 'admin' | 'member'; id: string; displayName: string; teamId?: string } | null> {
  const cleanEmail = email.trim().toLowerCase();
  if (isBootstrappedAdminEmail(cleanEmail)) {
    // Ensure admin directory doc exists for rules consistency
    const adminRef = doc(db, 'admins', safeDocId(uid));
    const adminSnap = await getDoc(adminRef);
    if (!adminSnap.exists()) {
      await setDoc(adminRef, {
        uid,
        email: cleanEmail,
        displayName: clamp(displayName || 'Administrador General', 120),
        createdAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
    return {
      role: 'admin',
      id: 'ADMI',
      displayName: displayName || 'Administrador General',
    };
  }

  const memberRef = doc(db, 'members', safeDocId(uid));
  const memberSnap = await getDoc(memberRef);
  if (memberSnap.exists()) {
    const m = memberSnap.data() as { teamId?: string; status?: string; displayName?: string };
    if (m.status === 'blocked') {
      throw new Error('Tu cuenta de miembro fue bloqueada por el Administrador.');
    }
    if (m.teamId) {
      const tSnap = await getDoc(doc(db, 'teams', safeDocId(m.teamId)));
      const t = tSnap.exists() ? (tSnap.data() as Team) : null;
      return {
        role: 'member',
        id: m.teamId,
        teamId: m.teamId,
        displayName: t ? `${t.memberName} (${t.name})` : m.displayName || cleanEmail,
      };
    }
  }

  // Check if admin pre-invited this Google email for a specific teamId
  const inviteRef = doc(db, 'member_invites', cleanEmail);
  const inviteSnap = await getDoc(inviteRef);
  if (inviteSnap.exists()) {
    const inv = inviteSnap.data() as MemberInvite;
    if (inv.status === 'active' && inv.teamId) {
      const now = new Date().toISOString();
      await setDoc(memberRef, {
        uid,
        teamId: inv.teamId,
        email: cleanEmail,
        displayName: clamp(displayName || cleanEmail, 120),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      const tSnap = await getDoc(doc(db, 'teams', safeDocId(inv.teamId)));
      const t = tSnap.exists() ? (tSnap.data() as Team) : null;
      return {
        role: 'member',
        id: inv.teamId,
        teamId: inv.teamId,
        displayName: t ? `${t.memberName} (${t.name})` : displayName || cleanEmail,
      };
    }
  }

  // Authenticated Google user without team assignment (can still comment, like, upload community videos)
  return {
    role: 'member',
    id: uid,
    displayName: displayName || cleanEmail,
  };
}
