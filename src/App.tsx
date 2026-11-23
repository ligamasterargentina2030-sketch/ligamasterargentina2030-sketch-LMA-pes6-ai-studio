import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { CheckCircle2, Loader2, Menu, ShieldAlert, X } from 'lucide-react';
import { AuthModal } from './components/AuthModal';
import { CalendarView } from './components/CalendarView';
import { CupBracketCard } from './components/CupBracketCard';
import { FireworksIntro } from './components/FireworksIntro';
import { GalleryView } from './components/GalleryView';
import { HomeView, type NavTab } from './components/HomeView';
import { LiveClock } from './components/LiveClock';
import { MatchesView, type MatchesSubTab } from './components/MatchesView';
import { MusicBar } from './components/MusicBar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ParticipantProfileModal } from './components/ParticipantProfileModal';
import { ProfileView, type AdminSection } from './components/ProfileView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ResetPasswordView } from './components/ResetPasswordView';
import { RulesView } from './components/RulesView';
import { StandingsView } from './components/StandingsView';
import { auth } from './firebase';
import {
  ensureDailyBackupIfNeeded,
  ensureInitialFirestoreSeed,
  resolveOrLinkFirebaseMember,
  saveUserMusicModeFirestore,
  subscribeLeagueRealtime,
  subscribeSaveStatus,
  toggleAtomicLikeFirestore,
  updateTeamLastSongFirestore,
  type RealtimeLeagueSlice,
} from './services/firestoreLeague';
import type {
  AuthUser,
  LastListenedTrack,
  LeagueBootstrap,
  SaveConfirmationStatus,
} from './types';
import { useCommunityVideos } from './hooks/useCommunityVideos';
import { apiFetch, setStoredToken } from './utils/api';
import { buildInlineTeamCrestSvg, resolveAssetUrl } from './utils/assetUrl';
import { getTitleText } from './utils/customTitles';
import { computeStandings } from './utils/standings';

const DEFAULT_ICON = resolveAssetUrl(
  '/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png'
);
const PAGE_BACKGROUND_IMAGE = resolveAssetUrl(
  '/assets/aistudio/WhatsApp_Image_2026-11-13_at_13.50.53_51d40a0e.jpeg'
);

function hydrateStaticCrests(payload: LeagueBootstrap): LeagueBootstrap {
  const teamCrestMap = new Map<string, string>();
  const teams = payload.teams.map((t) => {
    const crestUrl =
      t.crestUrl && t.crestUrl.startsWith('/api/crest/')
        ? buildInlineTeamCrestSvg(t.id, t.name)
        : resolveAssetUrl(t.crestUrl);
    teamCrestMap.set(t.id, crestUrl);
    return { ...t, crestUrl };
  });

  const fixCrest = (url?: string, fallbackName?: string, teamId?: string): string => {
    if (!url) return '';
    if (teamId && teamCrestMap.has(teamId)) return teamCrestMap.get(teamId)!;
    if (url.startsWith('/api/crest/')) {
      const extractedId = url.replace(/^\/api\/crest\//, '').replace(/\.svg$/i, '');
      return teamCrestMap.get(extractedId) || buildInlineTeamCrestSvg(extractedId, fallbackName);
    }
    return resolveAssetUrl(url);
  };

  const cup = payload.cup
    ? {
        ...payload.cup,
        championCrestUrl: fixCrest(payload.cup.championCrestUrl, payload.cup.championTeamName),
        participants: (payload.cup.participants || []).map((p) => ({
          ...p,
          crestUrl: fixCrest(p.crestUrl, p.teamName, p.teamId),
        })),
        matches: (payload.cup.matches || []).map((m) => ({
          ...m,
          homeCrestUrl: fixCrest(m.homeCrestUrl, m.homeTeamName),
          awayCrestUrl: fixCrest(m.awayCrestUrl, m.awayTeamName),
        })),
        recopa: payload.cup.recopa
          ? {
              ...payload.cup.recopa,
              leagueChampionCrestUrl: fixCrest(
                payload.cup.recopa.leagueChampionCrestUrl,
                payload.cup.recopa.leagueChampionName
              ),
              cupChampionCrestUrl: fixCrest(
                payload.cup.recopa.cupChampionCrestUrl,
                payload.cup.recopa.cupChampionName
              ),
              grandChampionCrestUrl: fixCrest(
                payload.cup.recopa.grandChampionCrestUrl,
                payload.cup.recopa.grandChampionName
              ),
            }
          : payload.cup.recopa,
      }
    : payload.cup;

  const news = (payload.news || []).map((n) => ({
    ...n,
    championCrestUrl: n.championCrestUrl
      ? fixCrest(n.championCrestUrl, n.championTeamName)
      : undefined,
  }));

  return {
    ...payload,
    teams,
    cup,
    news,
  };
}

export default function App() {
  const [fallbackBootstrap, setFallbackBootstrap] = useState<LeagueBootstrap | null>(null);
  const [realtimeSlice, setRealtimeSlice] = useState<RealtimeLeagueSlice>({
    checked: false,
    seeded: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveConfirmationStatus>({ state: 'idle', message: '' });

  const [firebaseUser, setFirebaseUser] = useState<AuthUser | null>(null);
  const [legacyUser, setLegacyUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [showIntro, setShowIntro] = useState(true);
  const [introContentReady, setIntroContentReady] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('inicio');
  const [gallerySubTab, setGallerySubTab] = useState<'videos' | 'campeones'>('videos');
  const [matchesSubTab, setMatchesSubTab] = useState<MatchesSubTab>('validated');
  const [profileSubTab, setProfileSubTab] = useState<AdminSection | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [prefillAuthId, setPrefillAuthId] = useState<string | undefined>(undefined);
  const [resetPageState, setResetPageState] = useState<{ active: boolean; oobCode: string | null }>(
    () => {
      if (typeof window === 'undefined') return { active: false, oobCode: null };
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode');
      const oobCode = params.get('oobCode');
      const isResetPath = window.location.pathname.replace(/\/+$/, '').endsWith('/reset-password');
      return {
        active: isResetPath || (mode === 'resetPassword' && Boolean(oobCode)),
        oobCode: oobCode || null,
      };
    }
  );
  const [staticHostingMode, setStaticHostingMode] = useState(false);
  const [viewingTeamId, setViewingTeamId] = useState<string | null>(null);
  const [litFooterSocial, setLitFooterSocial] = useState<'facebook' | 'youtube' | 'whatsapp' | null>(null);

  const flashFooterSocial = (network: 'facebook' | 'youtube' | 'whatsapp') => {
    setLitFooterSocial(network);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setLitFooterSocial((cur) => (cur === network ? null : cur));
      }, 950);
    }
  };

  useEffect(() => {
    return subscribeSaveStatus((st) => setSaveStatus(st));
  }, []);

  useEffect(() => {
    if (resetPageState.active) {
      setShowIntro(false);
      setIntroContentReady(true);
    }
  }, [resetPageState.active]);

  useEffect(() => {
    if (!showIntro) {
      setIntroContentReady(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setIntroContentReady(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [showIntro]);

  const handleIntroCurtainStart = useCallback(() => {
    setIntroContentReady(true);
  }, []);

  const handleIntroFinish = useCallback(() => {
    setShowIntro(false);
    setIntroContentReady(true);
  }, []);

  const handleExitResetPage = useCallback((adminId?: string) => {
    setResetPageState({ active: false, oobCode: null });
    if (adminId) {
      setPrefillAuthId(adminId);
    }
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', import.meta.env.BASE_URL || '/');
    }
    setAuthModalOpen(true);
  }, []);

  const { communityVideos, loadingCommunity, firestoreError } = useCommunityVideos();

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u || !u.email) {
        setFirebaseUser(null);
        setAuthReady(true);
        return;
      }
      try {
        const linked = await resolveOrLinkFirebaseMember(
          u.uid,
          u.email,
          u.displayName || u.email
        );
        const resolved: AuthUser = {
          id: linked?.id || u.uid,
          role: linked?.role || 'member',
          displayName: linked?.displayName || u.displayName || u.email,
          teamId: linked?.teamId,
          uid: u.uid,
          email: u.email,
          firebaseAuthenticated: true,
        };
        setFirebaseUser(resolved);
        if (resolved.role === 'admin' && u.emailVerified) {
          void ensureInitialFirestoreSeed()
            .then(() => ensureDailyBackupIfNeeded())
            .catch(() => undefined);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'No se pudo validar tu cuenta.');
        setFirebaseUser(null);
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  const effectiveUser = useMemo<AuthUser | null>(() => {
    if (firebaseUser) return firebaseUser;
    if (legacyUser) return legacyUser;
    return fallbackBootstrap?.user || null;
  }, [firebaseUser, legacyUser, fallbackBootstrap?.user]);

  // Read-only fallback bootstrap ONLY if Firestore is not seeded yet
  const fetchBootstrapFallback = useCallback(async () => {
    try {
      const payload = await apiFetch<LeagueBootstrap>('/api/bootstrap');
      if (
        !payload ||
        !Array.isArray(payload.teams) ||
        !Array.isArray(payload.matches) ||
        !payload.settings ||
        !payload.cup
      ) {
        throw new Error('Datos de la liga incompletos.');
      }
      if (payload.user) {
        setLegacyUser(payload.user);
      }
      setFallbackBootstrap(payload);
      setStaticHostingMode(false);
      setLoadError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '';
      const isStaticFallbackEligible =
        typeof window !== 'undefined' &&
        (window.location.hostname.endsWith('github.io') || errorMsg.includes('versión estática'));

      if (isStaticFallbackEligible) {
        try {
          const staticRes = await fetch(resolveAssetUrl('/static-bootstrap.json'), {
            cache: 'no-store',
          });
          if (staticRes.ok) {
            const staticPayload = (await staticRes.json()) as LeagueBootstrap;
            if (
              staticPayload &&
              Array.isArray(staticPayload.teams) &&
              Array.isArray(staticPayload.matches) &&
              staticPayload.settings &&
              staticPayload.cup
            ) {
              setFallbackBootstrap(hydrateStaticCrests(staticPayload));
              setStaticHostingMode(true);
              setLoadError(null);
              return;
            }
          }
        } catch {
          // fall through
        }
      }
      if (!realtimeSlice.seeded) {
        setLoadError(err instanceof Error ? err.message : 'Error cargando la liga.');
      }
    } finally {
      setLoading(false);
    }
  }, [realtimeSlice.seeded]);

  useEffect(() => {
    void fetchBootstrapFallback();
  }, [fetchBootstrapFallback]);

  // Primary Real-Time Cloud Firestore Subscription (all collections)
  useEffect(() => {
    if (!authReady) return;
    const isVerifiedAdmin =
      effectiveUser?.role === 'admin' && Boolean(auth.currentUser?.emailVerified);
    const uid = auth.currentUser?.uid || null;

    const unsub = subscribeLeagueRealtime(
      { uid, isAdmin: isVerifiedAdmin },
      (patch) => {
        setRealtimeSlice((prev) => ({
          ...prev,
          ...patch,
          checked: Boolean(prev.checked || patch.checked),
          seeded: Boolean(prev.seeded || patch.seeded),
        }));
        if (patch.seeded || (patch.checked && !patch.seeded)) {
          setLoading(false);
          if (patch.seeded) setLoadError(null);
        }
      },
      (msg) => {
        setLoadError(msg);
      }
    );

    return () => unsub();
  }, [authReady, effectiveUser?.role, effectiveUser?.uid]);

  // Unified live LeagueBootstrap built strictly from Cloud Firestore (fallback ONLY if DB unseeded after initial check)
  const data = useMemo<LeagueBootstrap | null>(() => {
    if (realtimeSlice.seeded) {
      const settings = realtimeSlice.settings;
      const teams = realtimeSlice.teams;
      const cup = realtimeSlice.cup;
      const rules = realtimeSlice.rules;
      if (!settings || !teams || !cup || !rules) return null;

      return hydrateStaticCrests({
        settings: {
          ...settings,
          maxTeams: Number(settings.maxTeams) > 50 ? Math.min(500, Number(settings.maxTeams)) : 100,
          backupGmail: realtimeSlice.backupGmail ?? settings.backupGmail,
        },
        user: effectiveUser,
        teams,
        adminTeams: realtimeSlice.adminTeams || (effectiveUser?.role === 'admin' ? teams : undefined),
        matches: realtimeSlice.matches ?? [],
        fixtures: realtimeSlice.fixtures ?? [],
        calendarEvents: realtimeSlice.calendarEvents ?? [],
        claims: realtimeSlice.claims ?? [],
        news: realtimeSlice.news ?? [],
        topGoals: realtimeSlice.topGoals ?? [],
        comments: realtimeSlice.comments ?? [],
        champions: realtimeSlice.champions ?? [],
        rules,
        cup,
        music: realtimeSlice.music ?? [],
        videos: realtimeSlice.videos ?? [],
        pageLikes: realtimeSlice.pageLikes ?? 0,
        credentialAuditLog: realtimeSlice.auditLog ?? [],
      });
    }

    if (realtimeSlice.checked && !realtimeSlice.seeded && fallbackBootstrap) {
      return {
        ...fallbackBootstrap,
        user: effectiveUser,
      };
    }

    return null;
  }, [realtimeSlice, fallbackBootstrap, effectiveUser]);

  const pageLiked = Boolean(realtimeSlice.likedPage);
  const likedTeams = realtimeSlice.likedTeams || {};
  const likedNews = realtimeSlice.likedNews || {};
  const musicMode = realtimeSlice.musicMode || 'league';

  useEffect(() => {
    if (!data?.settings) return;
    document.title = data.settings.subtitle?.trim()
      ? `${data.settings.title} | ${data.settings.subtitle}`
      : data.settings.title;

    const resolvedDescription =
      data.settings.description?.trim() ||
      data.settings.bannerText?.trim() ||
      `${data.settings.title} — ${data.settings.subtitle}`;
    const metaDesc = document.querySelector<HTMLMetaElement>("meta[name='description']");
    if (metaDesc) metaDesc.content = resolvedDescription;
    const ogTitle = document.querySelector<HTMLMetaElement>("meta[property='og:title']");
    if (ogTitle) ogTitle.content = data.settings.title;
    const ogDesc = document.querySelector<HTMLMetaElement>("meta[property='og:description']");
    if (ogDesc) ogDesc.content = resolvedDescription;

    const iconHref = resolveAssetUrl(
      data.settings.faviconUrl || data.settings.crestUrl || DEFAULT_ICON
    );

    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = iconHref;
  }, [data?.settings]);

  const standings = useMemo(() => {
    if (!data || !Array.isArray(data.teams)) return [];
    return computeStandings(data.teams, Array.isArray(data.matches) ? data.matches : []);
  }, [data]);

  const handleNavigate = (tab: NavTab, subTab?: string) => {
    setActiveTab(tab);
    if (tab === 'galeria' && (subTab === 'videos' || subTab === 'campeones')) {
      setGallerySubTab(subTab);
    }
    if (tab === 'partidos') {
      if (
        subTab === 'validated' ||
        subTab === 'fixtures' ||
        subTab === 'pending' ||
        subTab === 'mine' ||
        subTab === 'submit' ||
        subTab === 'claims'
      ) {
        setMatchesSubTab(subTab);
      } else {
        setMatchesSubTab('validated');
      }
    }
    if (tab === 'perfil') {
      if (
        subTab === 'equipos' ||
        subTab === 'copa' ||
        subTab === 'noticias' ||
        subTab === 'comentarios' ||
        subTab === 'cruces' ||
        subTab === 'validacion' ||
        subTab === 'reclamos' ||
        subTab === 'archivos' ||
        subTab === 'reglamento' ||
        subTab === 'musica' ||
        subTab === 'videos' ||
        subTab === 'campeones' ||
        subTab === 'general'
      ) {
        setProfileSubTab(subTab);
      } else {
        setProfileSubTab(undefined);
      }
    }
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const openAuthModal = useCallback(() => {
    setAuthModalOpen(true);
  }, []);

  const handleLikePage = useCallback(async () => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) {
      openAuthModal();
      return;
    }
    try {
      await toggleAtomicLikeFirestore('page', 'global');
    } catch {
      // Save error toast already surfaced by runConfirmedWrite
    }
  }, [openAuthModal]);

  const handleLikeTeam = useCallback(
    async (teamId: string) => {
      if (likedTeams[teamId]) return;
      if (!auth.currentUser || !auth.currentUser.emailVerified) {
        openAuthModal();
        return;
      }
      try {
        await toggleAtomicLikeFirestore('team', teamId);
      } catch {
        // Save error toast already surfaced by runConfirmedWrite
      }
    },
    [likedTeams, openAuthModal]
  );

  const handleLikeNews = useCallback(
    async (newsId: string) => {
      if (!auth.currentUser || !auth.currentUser.emailVerified) {
        openAuthModal();
        return;
      }
      try {
        await toggleAtomicLikeFirestore('news', newsId);
      } catch {
        // Save error toast already surfaced by runConfirmedWrite
      }
    },
    [openAuthModal]
  );

  const handleLastSongPlayed = useCallback(
    async (track: LastListenedTrack) => {
      if (!effectiveUser) return;
      const targetTeamId =
        effectiveUser.teamId ||
        (effectiveUser.role === 'admin' ? data?.settings.adminTeamId : undefined);
      if (!targetTeamId) return;
      await updateTeamLastSongFirestore(targetTeamId, track);
    },
    [effectiveUser, data?.settings.adminTeamId]
  );

  const handleChangeMusicMode = useCallback(async (mode: 'league' | 'personal') => {
    setRealtimeSlice((prev) => ({ ...prev, musicMode: mode }));
    try {
      await saveUserMusicModeFirestore(mode);
    } catch {
      // Ignored if guest or handled by Firestore listener
    }
  }, []);

  const handleAuthSuccess = async (user: AuthUser) => {
    if (user.firebaseAuthenticated) {
      setFirebaseUser(user);
    } else {
      setLegacyUser(user);
    }
    if (!realtimeSlice.seeded) {
      await fetchBootstrapFallback();
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {
      // Ignore Firebase signOut error
    }
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors while clearing legacy token
    }
    setStoredToken(null);
    setFirebaseUser(null);
    setLegacyUser(null);
    setProfileSubTab(undefined);
  };

  const handleNoopRefresh = useCallback(async () => {
    if (!realtimeSlice.seeded) {
      await fetchBootstrapFallback();
    }
  }, [realtimeSlice.seeded, fetchBootstrapFallback]);

  const navItems: { id: NavTab; label: string }[] = [
    { id: 'inicio', label: getTitleText(data?.settings, 'navInicio') },
    { id: 'posiciones', label: getTitleText(data?.settings, 'navPosiciones') },
    { id: 'partidos', label: getTitleText(data?.settings, 'navPartidos') },
    { id: 'copas', label: getTitleText(data?.settings, 'navCopas') },
    { id: 'calendario', label: getTitleText(data?.settings, 'navCalendario') },
    { id: 'galeria', label: getTitleText(data?.settings, 'navGaleria') },
    { id: 'reglamento', label: getTitleText(data?.settings, 'navReglamento') },
    { id: 'perfil', label: getTitleText(data?.settings, 'navPerfil') },
  ];

  const introIcon = resolveAssetUrl(
    data?.settings.crestUrl || data?.settings.faviconUrl || DEFAULT_ICON
  );

  const viewedTeam = useMemo(
    () => (viewingTeamId && data ? data.teams.find((t) => t.id === viewingTeamId) || null : null),
    [viewingTeamId, data]
  );
  const viewedStanding = useMemo(
    () => (viewingTeamId ? standings.find((s) => s.team.id === viewingTeamId) : undefined),
    [viewingTeamId, standings]
  );

  return (
    <div className="relative min-h-screen flex flex-col bg-[#050608] text-white pb-8 overflow-x-hidden">
      {/* Fondo de pantalla completo */}
      {(!showIntro || introContentReady) && (
        <div
          className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none"
          style={{
            backgroundImage: `url('${resolveAssetUrl(
              data?.settings.backgroundUrl || PAGE_BACKGROUND_IMAGE
            )}')`,
          }}
          aria-hidden="true"
        />
      )}
      <div
        className="fixed inset-0 z-0 bg-gradient-to-b from-[#03060C]/62 via-[#061830]/48 to-[#03060C]/68 pointer-events-none"
        aria-hidden="true"
      />

      {showIntro && (
        <FireworksIntro
          iconUrl={introIcon}
          title={data?.settings.title || 'Liga Master Argentina Pes6'}
          subtitle={data?.settings.subtitle || '(TEMPORADA 2026-2027) THE DEN PATCH'}
          onCurtainStart={handleIntroCurtainStart}
          onFinish={handleIntroFinish}
        />
      )}

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-gradient-to-r from-[#04070D]/72 via-[#072142]/64 to-[#04070D]/72 backdrop-blur-lg border-b border-amber-400/55 shadow-[0_10px_30px_rgba(0,0,0,0.65)]">
        <div className="h-1 w-full albiceleste-ribbon" aria-hidden="true" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 min-h-[72px] py-1.5 flex items-center justify-between gap-4">
          <nav className="hidden lg:flex items-center gap-4 xl:gap-5">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`py-1.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'text-amber-300 border-amber-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.45)]'
                      : 'text-white/90 border-transparent hover:text-sky-300 hover:border-sky-300/70'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <LiveClock onClick={() => handleNavigate('calendario')} />
            <PWAInstallButton />

            {data?.user ? (
              <button
                type="button"
                onClick={() => handleNavigate('perfil')}
                className="px-3.5 py-2 text-xs font-bold btn-gold-luxury rounded-lg transition-all whitespace-nowrap shrink-0"
              >
                {data.user.role === 'admin' ? 'Panel Admin' : data.user.id}
              </button>
            ) : (
              <button
                type="button"
                onClick={openAuthModal}
                aria-pressed={authModalOpen}
                className={`px-3.5 py-2 text-xs btn-login-yellow rounded-lg whitespace-nowrap shrink-0 ${
                  authModalOpen ? 'is-lit' : ''
                }`}
              >
                Ingresar a Cuenta
              </button>
            )}

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Abrir menú"
              className="lg:hidden p-2 text-white hover:text-amber-300 rounded-lg border border-amber-400/45 bg-black/55 backdrop-blur-md"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav className="lg:hidden border-t border-amber-400/30 bg-[#050A14]/85 backdrop-blur-xl px-4 py-3 grid grid-cols-2 gap-2">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`px-3 py-2.5 text-left text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-amber-400/20 text-amber-200 border border-amber-400/60'
                      : 'text-white hover:bg-sky-400/15'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {/* Server-confirmed Save Feedback Toast */}
      {saveStatus.state !== 'idle' && (
        <div className="fixed bottom-4 left-4 z-40 max-w-md pointer-events-none">
          <div
            className={`px-4 py-2.5 rounded-xl border shadow-2xl text-xs font-semibold flex items-center gap-2 backdrop-blur-md ${
              saveStatus.state === 'saving'
                ? 'bg-[#071D38]/95 border-amber-400/60 text-amber-100'
                : saveStatus.state === 'saved'
                ? 'bg-emerald-950/95 border-emerald-400/60 text-emerald-100'
                : 'bg-rose-950/95 border-rose-400/60 text-rose-100'
            }`}
          >
            {saveStatus.state === 'saving' ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-300 shrink-0" />
            ) : saveStatus.state === 'saved' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{saveStatus.message}</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {resetPageState.active ? (
          <ResetPasswordView oobCode={resetPageState.oobCode} onComplete={handleExitResetPage} />
        ) : loading && !data ? (
          <div className="space-y-6 animate-pulse">
            <div className="h-80 rounded-2xl bg-[#0B0D12]/90 border border-zinc-400/30" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="h-24 rounded-xl bg-[#0B0D12]/90 border border-zinc-400/25" />
              <div className="h-24 rounded-xl bg-[#0B0D12]/90 border border-zinc-400/25" />
              <div className="h-24 rounded-xl bg-[#0B0D12]/90 border border-zinc-400/25" />
              <div className="h-24 rounded-xl bg-[#0B0D12]/90 border border-zinc-400/25" />
            </div>
          </div>
        ) : loadError && !data ? (
          <div className="p-8 bg-[#0B0D12]/95 border border-amber-400/50 rounded-2xl text-center space-y-3">
            <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
              No se pudo cargar la liga
            </h2>
            <p className="text-sm text-rose-300">{loadError}</p>
            <button
              type="button"
              onClick={fetchBootstrapFallback}
              className="px-4 py-2 text-xs font-bold btn-gold-luxury rounded-lg"
            >
              Reintentar
            </button>
          </div>
        ) : (
          data &&
          (!showIntro || introContentReady) && (
            <>
              {activeTab === 'inicio' && (
                <HomeView
                  settings={data.settings}
                  teams={data.teams}
                  standings={standings}
                  matches={data.matches}
                  fixtures={data.fixtures || []}
                  calendarEvents={data.calendarEvents || []}
                  champions={data.champions}
                  videos={data.videos}
                  topGoals={data.topGoals || []}
                  communityVideos={communityVideos}
                  loadingCommunity={loadingCommunity}
                  cup={data.cup}
                  news={data.news || []}
                  comments={data.comments || []}
                  pageLikes={data.pageLikes || 0}
                  pageLiked={pageLiked}
                  likedNews={likedNews}
                  user={data.user}
                  onNavigate={handleNavigate}
                  onRefresh={handleNoopRefresh}
                  onReplayIntro={() => setShowIntro(true)}
                  onLikePage={handleLikePage}
                  onLikeNews={handleLikeNews}
                  onViewParticipant={(teamId) => setViewingTeamId(teamId)}
                />
              )}

              {activeTab === 'posiciones' && (
                <StandingsView
                  standings={standings}
                  maxTeams={data.settings.maxTeams}
                  settings={data.settings}
                  user={data.user}
                  onOpenAuth={openAuthModal}
                  onRefresh={handleNoopRefresh}
                  onViewParticipant={(teamId) => setViewingTeamId(teamId)}
                />
              )}

              {activeTab === 'partidos' && (
                <MatchesView
                  matches={data.matches}
                  fixtures={data.fixtures || []}
                  claims={data.claims || []}
                  teams={data.teams}
                  cup={data.cup}
                  settings={data.settings}
                  user={data.user}
                  initialSubTab={matchesSubTab}
                  onOpenAuth={openAuthModal}
                  onOpenCups={() => handleNavigate('copas')}
                  onRefresh={handleNoopRefresh}
                />
              )}

              {activeTab === 'copas' && (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-albiceleste-shiny">
                        {getTitleText(data.settings, 'copasPageTitle')}
                      </h1>
                      <p className="text-xs sm:text-sm text-zinc-300">
                        {getTitleText(data.settings, 'copasPageSubtitle')}
                      </p>
                    </div>
                  </div>

                  <CupBracketCard
                    cup={data.cup}
                    teams={data.teams}
                    matches={data.matches}
                    settings={data.settings}
                    isAdmin={data.user?.role === 'admin'}
                    onEditCup={() => handleNavigate('perfil', 'copa')}
                    onGoToChampionsUpload={() => handleNavigate('galeria', 'campeones')}
                    onGoToRules={() => handleNavigate('reglamento')}
                    onRefresh={handleNoopRefresh}
                  />
                </div>
              )}

              {activeTab === 'calendario' && (
                <CalendarView
                  calendarEvents={data.calendarEvents || []}
                  calendarMessage={data.settings.calendarMessage}
                  settings={data.settings}
                  cup={data.cup}
                  fixtures={data.fixtures || []}
                  teams={data.teams}
                  user={data.user}
                  onRefresh={handleNoopRefresh}
                  onOpenCup={() => handleNavigate('perfil', 'copa')}
                />
              )}

              {activeTab === 'galeria' && (
                <GalleryView
                  key={gallerySubTab}
                  videos={data.videos}
                  communityVideos={communityVideos}
                  loadingCommunity={loadingCommunity}
                  firestoreError={firestoreError}
                  featuredVideoId={data.settings.featuredVideo?.id}
                  champions={data.champions}
                  settings={data.settings}
                  user={data.user}
                  initialSubTab={gallerySubTab}
                  onOpenAuth={openAuthModal}
                  onRefresh={handleNoopRefresh}
                />
              )}

              {activeTab === 'reglamento' && (
                <RulesView rules={data.rules} settings={data.settings} />
              )}

              {activeTab === 'perfil' && (
                <ProfileView
                  user={data.user}
                  settings={data.settings}
                  teams={data.teams}
                  adminTeams={data.adminTeams || []}
                  standings={standings}
                  matches={data.matches}
                  fixtures={data.fixtures || []}
                  claims={data.claims || []}
                  rules={data.rules}
                  music={data.music}
                  videos={data.videos}
                  topGoals={data.topGoals || []}
                  communityVideos={communityVideos}
                  champions={data.champions}
                  cup={data.cup}
                  news={data.news || []}
                  comments={data.comments || []}
                  likedTeams={likedTeams}
                  credentialAuditLog={data.credentialAuditLog || []}
                  memberInvites={realtimeSlice.memberInvites || []}
                  userPersonalMusic={realtimeSlice.userPersonalMusic || []}
                  backupGmail={realtimeSlice.backupGmail}
                  initialAdminTab={profileSubTab}
                  onOpenAuth={openAuthModal}
                  onLogout={handleLogout}
                  onRefresh={handleNoopRefresh}
                  onNavigate={handleNavigate}
                  onViewParticipant={(teamId) => setViewingTeamId(teamId)}
                  onLikeTeam={handleLikeTeam}
                />
              )}
            </>
          )
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-amber-400/50 bg-gradient-to-r from-[#04070D]/72 via-[#072142]/64 to-[#04070D]/72 backdrop-blur-lg mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col lg:flex-row items-center justify-between gap-4 text-xs text-white">
          <div className="text-center lg:text-left">
            <span className="font-semibold text-sky-200">
              {data?.settings.title || 'Liga Master Argentina Pes6'}
            </span>{' '}
            ·{' '}
            <span className="font-semibold text-amber-300">
              {data?.settings.subtitle || '(TEMPORADA 2026-2027) THE DEN PATCH'}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <span className="text-zinc-100 font-medium">
              {getTitleText(data?.settings, 'homeSocialTitle')}
            </span>
            <div className="flex items-center gap-3">
              <a
                href="https://www.facebook.com/profile.php?id=61592685431765"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook oficial Liga Master Argentina"
                onPointerDown={() => flashFooterSocial('facebook')}
                onClick={() => flashFooterSocial('facebook')}
                className={`group inline-flex items-center justify-center w-10 h-10 rounded-xl social-glow-facebook ${
                  litFooterSocial === 'facebook' ? 'is-lit' : ''
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5 fill-[#60A5FA] group-hover:fill-white transition-colors"
                  aria-hidden="true"
                >
                  <path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z" />
                </svg>
              </a>
              <a
                href="https://www.youtube.com/channel/UClCVRB-u2ZNJJdIXTyi7DjQ"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="YouTube oficial Liga Master Argentina"
                onPointerDown={() => flashFooterSocial('youtube')}
                onClick={() => flashFooterSocial('youtube')}
                className={`group inline-flex items-center justify-center w-10 h-10 rounded-xl social-glow-youtube ${
                  litFooterSocial === 'youtube' ? 'is-lit' : ''
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5 fill-[#FF4E45] group-hover:fill-white transition-colors"
                  aria-hidden="true"
                >
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </a>
              <a
                href="https://chat.whatsapp.com/IA8EyaupDRIKXpLJiTeF8X?s=cl&p=a&iam=2"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp oficial Liga Master Argentina"
                onPointerDown={() => flashFooterSocial('whatsapp')}
                onClick={() => flashFooterSocial('whatsapp')}
                className={`group inline-flex items-center justify-center w-10 h-10 rounded-xl social-glow-whatsapp ${
                  litFooterSocial === 'whatsapp' ? 'is-lit' : ''
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-5 h-5 fill-[#4ADE80] group-hover:fill-white transition-colors"
                  aria-hidden="true"
                >
                  <path d="M20.52 3.48A11.87 11.87 0 0 0 12.05 0C5.5 0 .16 5.33.16 11.89c0 2.1.55 4.14 1.59 5.95L0 24l6.33-1.66a11.88 11.88 0 0 0 5.71 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.17-1.24-6.16-3.42-8.41zM12.05 21.78h-.01a9.86 9.86 0 0 1-5.02-1.37l-.36-.21-3.75.98 1-3.66-.23-.38a9.87 9.87 0 0 1-1.51-5.25c0-5.46 4.44-9.9 9.9-9.9 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.9 7c0 5.45-4.45 9.89-9.91 9.89zm5.43-7.41c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.48-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.08-.8.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.21 5.09 4.5.71.31 1.27.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35z" />
                </svg>
              </a>
            </div>
            <button
              type="button"
              onClick={() => setShowIntro(true)}
              className="font-semibold text-amber-300 hover:text-amber-200 transition-colors"
            >
              Ver Intro con Fuegos Artificiales
            </button>
          </div>
        </div>
      </footer>

      {data && (() => {
        const effectiveMusicTeamId =
          data.user?.teamId ||
          (data.user?.role === 'admin' ? data.settings.adminTeamId : undefined);
        const effectiveMusicTeam = effectiveMusicTeamId
          ? data.teams.find((t) => t.id === effectiveMusicTeamId)
          : undefined;
        const personalServerTracks = effectiveMusicTeam
          ? effectiveMusicTeam.personalMusic || []
          : realtimeSlice.userPersonalMusic || [];
        return (
          <MusicBar
            tracks={data.music}
            personalServerTracks={personalServerTracks}
            personalTeamId={effectiveMusicTeam?.id}
            user={data.user}
            radioName={data.settings.radioName}
            radioStreamUrl={data.settings.radioStreamUrl}
            isAdmin={data.user?.role === 'admin'}
            introActive={showIntro}
            musicMode={musicMode}
            onChangeMusicMode={handleChangeMusicMode}
            onRefresh={handleNoopRefresh}
            onLastSongPlayed={handleLastSongPlayed}
          />
        );
      })()}

      <AuthModal
        open={authModalOpen}
        prefillId={prefillAuthId}
        staticHostingMode={staticHostingMode}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      <ParticipantProfileModal
        team={viewedTeam}
        teams={data?.teams || []}
        standing={viewedStanding}
        matches={data?.matches || []}
        champions={data?.champions || []}
        settings={data?.settings}
        liked={Boolean(viewedTeam && likedTeams[viewedTeam.id])}
        onLike={handleLikeTeam}
        onClose={() => setViewingTeamId(null)}
      />

      <OfflineIndicator />
    </div>
  );
}
