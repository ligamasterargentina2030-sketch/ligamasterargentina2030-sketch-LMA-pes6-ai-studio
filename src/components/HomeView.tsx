import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Flame,
  Heart,
  ImagePlus,
  Maximize2,
  Megaphone,
  MessageSquare,
  Minimize2,
  Newspaper,
  Plus,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import defaultChampImg from '../assets/images/champion_celebration_default_1794642902876.jpg';
import type {
  AuthUser,
  CalendarEvent,
  ChampionEntry,
  CommunityVideo,
  CupTournament,
  FeaturedVideoSelection,
  GalleryVideo,
  LeagueComment,
  LeagueSettings,
  Match,
  NewsPost,
  PublicTeam,
  ScheduledFixture,
  StandingRow,
  TopGoalItem,
} from '../types';
import {
  approveCommentFirestore,
  deleteCommentFirestore,
  saveFeaturedVideoFirestore,
  saveSettingsFirestore,
  submitCommentFirestore,
} from '../services/firestoreLeague';
import { uploadMediaFile } from '../utils/api';
import { resolveAssetUrl } from '../utils/assetUrl';
import { getTitleText } from '../utils/customTitles';
import { CupBracketCard } from './CupBracketCard';
import { ResilientImage } from './ResilientImage';

const defaultCoverImg = resolveAssetUrl('/assets/aistudio/_Liga_master_argentina_PES6._36522b75.png');
const MESSI_MARADONA_IMG = resolveAssetUrl(
  '/assets/aistudio/72b3144e-994e-4bd7-8467-44208d372402_df3c9156.png'
);
const MESSI_PLAQUE_IMG = resolveAssetUrl(
  '/assets/aistudio/Placa_dorada_de_datos_personales_de_Messi_586edfb3.png'
);
const MARADONA_PLAQUE_IMG = resolveAssetUrl(
  '/assets/aistudio/Placa_dorada_de_datos_personales_c4bdca47.png'
);
const MESSI_HOVER_AUDIO = resolveAssetUrl(
  '/assets/aistudio/Dios_en_el_cielo_y_en_la_tierra_como_en_Malvinas_preparado_pa_la_querra_b9ea2211.mp3'
);
const MARADONA_HOVER_AUDIO = resolveAssetUrl('/assets/aistudio/maradoooo_maradooo_c2001237.mp3');

export type NavTab =
  | 'inicio'
  | 'posiciones'
  | 'partidos'
  | 'copas'
  | 'calendario'
  | 'galeria'
  | 'reglamento'
  | 'perfil';

interface HomeViewProps {
  settings: LeagueSettings;
  teams: PublicTeam[];
  standings: StandingRow[];
  matches: Match[];
  fixtures?: ScheduledFixture[];
  calendarEvents?: CalendarEvent[];
  champions: ChampionEntry[];
  videos: GalleryVideo[];
  topGoals?: TopGoalItem[];
  communityVideos: CommunityVideo[];
  loadingCommunity: boolean;
  cup: CupTournament;
  news?: NewsPost[];
  comments?: LeagueComment[];
  pageLikes?: number;
  pageLiked?: boolean;
  likedNews?: Record<string, boolean>;
  user: AuthUser | null;
  onNavigate: (tab: NavTab, subTab?: string) => void;
  onRefresh: () => Promise<void>;
  onReplayIntro: () => void;
  onLikePage: () => Promise<void>;
  onLikeNews?: (newsId: string) => Promise<void>;
  onViewParticipant: (teamId: string) => void;
}

export function HomeView({
  settings,
  teams,
  standings,
  matches,
  fixtures = [],
  calendarEvents = [],
  champions,
  videos,
  topGoals = [],
  communityVideos,
  loadingCommunity,
  cup,
  news = [],
  comments = [],
  pageLikes = 0,
  pageLiked = false,
  likedNews = {},
  user,
  onNavigate,
  onRefresh,
  onReplayIntro,
  onLikePage,
  onLikeNews,
  onViewParticipant,
}: HomeViewProps) {
  const [updatingFeatured, setUpdatingFeatured] = useState(false);
  const [likingPage, setLikingPage] = useState(false);
  const [heroTilt, setHeroTilt] = useState({
    rotateX: 0,
    rotateY: 0,
    glareX: 50,
    glareY: 42,
    active: false,
  });

  const handleHeroPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;
    const rotateY = (xRatio - 0.5) * 9;
    const rotateX = (0.5 - yRatio) * 6.5;
    setHeroTilt({
      rotateX,
      rotateY,
      glareX: Math.round(xRatio * 100),
      glareY: Math.round(yRatio * 100),
      active: true,
    });
  };

  const handleHeroPointerLeave = () => {
    setHeroTilt({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 42, active: false });
  };

  // Carousels automáticos cada 10s (Noticias + Historial de Campeones)
  const [newsIdx, setNewsIdx] = useState(0);
  const [newsPaused, setNewsPaused] = useState(false);
  const [maximizedNewsId, setMaximizedNewsId] = useState<string | null>(null);
  const [newsModalMinimized, setNewsModalMinimized] = useState(false);
  const [likingNewsId, setLikingNewsId] = useState<string | null>(null);
  const [champIdx, setChampIdx] = useState(0);
  const [champPaused, setChampPaused] = useState(false);

  // Top 5 Mejores Goles (cambia cada 6s, reproducción manual con Play)
  const [activeGoalIdx, setActiveGoalIdx] = useState(0);
  const [topGoalsMuted, setTopGoalsMuted] = useState(false);
  const [topGoalPlaying, setTopGoalPlaying] = useState(false);
  const topGoalVideoRef = useRef<HTMLVideoElement | null>(null);

  // Audio al apoyar el cursor sobre la foto de Messi o Maradona
  const [activeLegendAudio, setActiveLegendAudio] = useState<'messi' | 'maradona' | null>(null);
  const messiHoverAudioRef = useRef<HTMLAudioElement | null>(null);
  const maradonaHoverAudioRef = useRef<HTMLAudioElement | null>(null);
  const legendAudioCtxRef = useRef<AudioContext | null>(null);
  const boostedLegendAudioRef = useRef<{ messi: boolean; maradona: boolean }>({
    messi: false,
    maradona: false,
  });

  // Comentarios de la liga
  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentMessage, setCommentMessage] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentFeedback, setCommentFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [moderatingCommentId, setModeratingCommentId] = useState<string | null>(null);

  // Redes sociales: efecto de luz al tocar
  const [litSocial, setLitSocial] = useState<'facebook' | 'youtube' | 'whatsapp' | null>(null);
  const triggerSocialLit = (network: 'facebook' | 'youtube' | 'whatsapp') => {
    setLitSocial(network);
    window.setTimeout(() => {
      setLitSocial((prev) => (prev === network ? null : prev));
    }, 950);
  };

  // Gestor Admin de las 4 imágenes principales + nuevas imágenes
  const [showHeroMediaManager, setShowHeroMediaManager] = useState(false);
  const [busyHeroMedia, setBusyHeroMedia] = useState<string | null>(null);
  const [heroMediaMsg, setHeroMediaMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [newExtraHeroUrl, setNewExtraHeroUrl] = useState('');

  const rawCoverSrc =
    settings.coverUrl === undefined ? defaultCoverImg : settings.coverUrl.trim();
  const resolvedCoverSrc =
    rawCoverSrc === '/assets/aistudio/cabra_copa_3d_hd.jpg' ? defaultCoverImg : rawCoverSrc;
  const resolvedMessiPlaqueSrc =
    settings.messiPlaqueUrl === undefined ? MESSI_PLAQUE_IMG : settings.messiPlaqueUrl.trim();
  const resolvedMessiMaradonaSrc =
    settings.messiMaradonaUrl === undefined ? MESSI_MARADONA_IMG : settings.messiMaradonaUrl.trim();
  const resolvedMaradonaPlaqueSrc =
    settings.maradonaPlaqueUrl === undefined
      ? MARADONA_PLAQUE_IMG
      : settings.maradonaPlaqueUrl.trim();
  const extraHeroImages = (settings.extraHeroImages || []).filter(Boolean);

  type HeroSlotKey =
    | 'coverUrl'
    | 'messiPlaqueUrl'
    | 'messiMaradonaUrl'
    | 'maradonaPlaqueUrl';

  const handleSaveHeroSlotValue = async (
    slot: HeroSlotKey,
    value: string,
    label: string
  ) => {
    setBusyHeroMedia(slot);
    setHeroMediaMsg(null);
    try {
      await saveSettingsFirestore({ [slot]: value });
      await onRefresh();
      setHeroMediaMsg({
        type: 'ok',
        text: value
          ? `${label} actualizada correctamente.`
          : `${label} eliminada. Podés agregar una nueva imagen cuando quieras.`,
      });
    } catch (err) {
      setHeroMediaMsg({
        type: 'err',
        text: err instanceof Error ? err.message : `No se pudo actualizar ${label}.`,
      });
    } finally {
      setBusyHeroMedia(null);
    }
  };

  const handleUploadHeroSlotFile = async (
    slot: HeroSlotKey,
    file: File | null | undefined,
    label: string
  ) => {
    if (!file) return;
    setBusyHeroMedia(slot);
    setHeroMediaMsg(null);
    try {
      const url = await uploadMediaFile('site', file);
      await saveSettingsFirestore({ [slot]: url });
      await onRefresh();
      setHeroMediaMsg({ type: 'ok', text: `${label} subida y publicada para todos.` });
    } catch (err) {
      setHeroMediaMsg({
        type: 'err',
        text: err instanceof Error ? err.message : `No se pudo subir ${label}.`,
      });
    } finally {
      setBusyHeroMedia(null);
    }
  };

  const handleAddExtraHeroFile = async (file: File | null | undefined) => {
    if (!file) return;
    setBusyHeroMedia('extra_add');
    setHeroMediaMsg(null);
    try {
      const url = await uploadMediaFile('site', file);
      const next = [...extraHeroImages, url].slice(0, 12);
      await saveSettingsFirestore({ extraHeroImages: next });
      await onRefresh();
      setHeroMediaMsg({ type: 'ok', text: 'Nueva imagen agregada al Inicio.' });
    } catch (err) {
      setHeroMediaMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo subir la nueva imagen.',
      });
    } finally {
      setBusyHeroMedia(null);
    }
  };

  const handleAddExtraHeroByUrl = async () => {
    const clean = newExtraHeroUrl.trim();
    if (!clean) return;
    setBusyHeroMedia('extra_url');
    setHeroMediaMsg(null);
    try {
      const next = [...extraHeroImages, clean].slice(0, 12);
      await saveSettingsFirestore({ extraHeroImages: next });
      setNewExtraHeroUrl('');
      await onRefresh();
      setHeroMediaMsg({ type: 'ok', text: 'Nueva imagen agregada por URL al Inicio.' });
    } catch (err) {
      setHeroMediaMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo agregar la imagen.',
      });
    } finally {
      setBusyHeroMedia(null);
    }
  };

  const handleDeleteExtraHero = async (idx: number) => {
    setBusyHeroMedia(`extra_${idx}`);
    setHeroMediaMsg(null);
    try {
      const next = extraHeroImages.filter((_, i) => i !== idx);
      await saveSettingsFirestore({ extraHeroImages: next });
      await onRefresh();
      setHeroMediaMsg({ type: 'ok', text: 'Imagen eliminada del Inicio.' });
    } catch (err) {
      setHeroMediaMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo eliminar la imagen.',
      });
    } finally {
      setBusyHeroMedia(null);
    }
  };

  const cupScheduledCount =
    cup.matches.filter((m) => Boolean(m.scheduledDate)).length +
    (cup.recopa?.scheduledDate ? 1 : 0);
  const totalCalendarCount =
    calendarEvents.length +
    cupScheduledCount +
    fixtures.filter((f) => Boolean(f.scheduledDate)).length;

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const validatedMatches = matches.filter((m) => m.status === 'validated').slice(0, 4);
  const pendingCount = matches.filter((m) => m.status === 'pending').length;
  const topFive = standings.slice(0, 5);

  const sortedAdminTopGoals = [...topGoals].sort((a, b) => a.rank - b.rank).slice(0, 5);

  useEffect(() => {
    if (news.length <= 1 || newsPaused || maximizedNewsId) return;
    const timer = window.setInterval(() => {
      setNewsIdx((prev) => (prev + 1) % news.length);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [news.length, newsPaused, maximizedNewsId]);

  useEffect(() => {
    if (newsIdx >= news.length && news.length > 0) {
      setNewsIdx(0);
    }
    if (maximizedNewsId && !news.some((n) => n.id === maximizedNewsId)) {
      setMaximizedNewsId(null);
    }
  }, [news, news.length, newsIdx, maximizedNewsId]);

  useEffect(() => {
    if (champions.length <= 1 || champPaused) return;
    const timer = window.setInterval(() => {
      setChampIdx((prev) => (prev + 1) % champions.length);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [champions.length, champPaused]);

  useEffect(() => {
    if (champIdx >= champions.length && champions.length > 0) {
      setChampIdx(0);
    }
  }, [champions.length, champIdx]);

  const activeChampion = champions.length > 0 ? champions[champIdx % champions.length] : null;
  const activeNews = news.length > 0 ? news[newsIdx % news.length] : null;
  const maximizedNews = maximizedNewsId ? news.find((n) => n.id === maximizedNewsId) || null : null;

  const allVideos: FeaturedVideoSelection[] = [
    ...communityVideos.map((cv) => ({
      id: cv.id,
      source: 'community' as const,
      title: cv.titulo,
      author: cv.autor,
      videoUrl: cv.videoUrl,
      downloadUrl: cv.videoUrl,
      fechaLabel: cv.fechaLabel,
    })),
    ...videos.map((v) => ({
      id: v.id,
      source: 'local' as const,
      title: v.title,
      author: v.uploadedBy,
      videoUrl: v.videoUrl,
      downloadUrl: v.downloadUrl,
      originalFormat: v.originalFormat,
    })),
  ];

  const effectiveTopGoals: TopGoalItem[] =
    sortedAdminTopGoals.length > 0
      ? sortedAdminTopGoals
      : allVideos.slice(0, 5).map((v, idx) => ({
          id: `auto_${v.id}`,
          rank: idx + 1,
          title: v.title,
          author: v.author,
          videoUrl: v.videoUrl,
          sourceVideoId: v.id,
          createdAt: new Date().toISOString(),
        }));

  const currentTopGoal =
    effectiveTopGoals.length > 0
      ? effectiveTopGoals[activeGoalIdx % effectiveTopGoals.length]
      : null;

  useEffect(() => {
    if (activeGoalIdx >= effectiveTopGoals.length && effectiveTopGoals.length > 0) {
      setActiveGoalIdx(0);
    }
  }, [effectiveTopGoals.length, activeGoalIdx]);

  useEffect(() => {
    setTopGoalPlaying(false);
  }, [activeGoalIdx]);

  useEffect(() => {
    if (effectiveTopGoals.length <= 1 || topGoalPlaying) return;
    const timer = window.setInterval(() => {
      setActiveGoalIdx((prev) => (prev + 1) % effectiveTopGoals.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [effectiveTopGoals.length, topGoalPlaying]);

  useEffect(() => {
    const vid = topGoalVideoRef.current;
    if (!vid) return;
    vid.muted = topGoalsMuted;
  }, [topGoalsMuted]);

  const stopLegendAudio = (target?: 'messi' | 'maradona') => {
    if (!target || target === 'messi') {
      const mAudio = messiHoverAudioRef.current;
      if (mAudio) {
        mAudio.pause();
        try {
          mAudio.currentTime = 0;
        } catch {
          // ignore
        }
      }
    }
    if (!target || target === 'maradona') {
      const dAudio = maradonaHoverAudioRef.current;
      if (dAudio) {
        dAudio.pause();
        try {
          dAudio.currentTime = 0;
        } catch {
          // ignore
        }
      }
    }
    setActiveLegendAudio((prev) => {
      if (!target) return null;
      return prev === target ? null : prev;
    });
  };

  const ensureLegendAudioBoost = (who: 'messi' | 'maradona', audio: HTMLAudioElement) => {
    if (typeof window === 'undefined') return;
    try {
      if (!legendAudioCtxRef.current || legendAudioCtxRef.current.state === 'closed') {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        legendAudioCtxRef.current = new Ctx();
      }
      const ctx = legendAudioCtxRef.current;

      if (!boostedLegendAudioRef.current[who]) {
        const source = ctx.createMediaElementSource(audio);
        const preGain = ctx.createGain();
        preGain.gain.value = who === 'maradona' ? 4.2 : 3.2;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -10;
        compressor.knee.value = 6;
        compressor.ratio.value = 12;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.12;

        const makeupGain = ctx.createGain();
        makeupGain.gain.value = who === 'maradona' ? 1.6 : 1.5;

        source.connect(preGain);
        preGain.connect(compressor);
        compressor.connect(makeupGain);
        makeupGain.connect(ctx.destination);

        boostedLegendAudioRef.current[who] = true;
      }

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    } catch {
      // Fallback: play natively at maximum element volume (1.0)
    }
  };

  const playLegendAudio = (who: 'messi' | 'maradona') => {
    const other: 'messi' | 'maradona' = who === 'messi' ? 'maradona' : 'messi';
    stopLegendAudio(other);
    const audio = who === 'messi' ? messiHoverAudioRef.current : maradonaHoverAudioRef.current;
    if (!audio) return;
    audio.volume = 1.0;
    ensureLegendAudioBoost(who, audio);
    try {
      audio.currentTime = 0;
    } catch {
      // ignore
    }
    setActiveLegendAudio(who);
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        setActiveLegendAudio(null);
      });
    }
  };

  useEffect(() => {
    return () => {
      messiHoverAudioRef.current?.pause();
      maradonaHoverAudioRef.current?.pause();
      if (legendAudioCtxRef.current && legendAudioCtxRef.current.state !== 'closed') {
        void legendAudioCtxRef.current.close().catch(() => {});
      }
      legendAudioCtxRef.current = null;
      boostedLegendAudioRef.current = { messi: false, maradona: false };
    };
  }, []);

  const resolveFeaturedVideo = (): {
    video: FeaturedVideoSelection | null;
    isAdminFavorite: boolean;
  } => {
    const saved = settings.featuredVideo;
    if (saved) {
      if (saved.source === 'community') {
        const liveMatch = communityVideos.find((cv) => cv.id === saved.id);
        if (liveMatch) {
          return {
            video: {
              id: liveMatch.id,
              source: 'community',
              title: liveMatch.titulo,
              author: liveMatch.autor,
              videoUrl: liveMatch.videoUrl,
              downloadUrl: liveMatch.videoUrl,
              fechaLabel: liveMatch.fechaLabel,
            },
            isAdminFavorite: true,
          };
        }
        if (loadingCommunity) {
          return { video: saved, isAdminFavorite: true };
        }
      } else {
        const localMatch = videos.find((v) => v.id === saved.id);
        if (localMatch) {
          return {
            video: {
              id: localMatch.id,
              source: 'local',
              title: localMatch.title,
              author: localMatch.uploadedBy,
              videoUrl: localMatch.videoUrl,
              downloadUrl: localMatch.downloadUrl,
              originalFormat: localMatch.originalFormat,
            },
            isAdminFavorite: true,
          };
        }
      }
    }

    const legacyFeatured = videos.find((v) => v.featured);
    if (legacyFeatured) {
      return {
        video: {
          id: legacyFeatured.id,
          source: 'local',
          title: legacyFeatured.title,
          author: legacyFeatured.uploadedBy,
          videoUrl: legacyFeatured.videoUrl,
          downloadUrl: legacyFeatured.downloadUrl,
          originalFormat: legacyFeatured.originalFormat,
        },
        isAdminFavorite: true,
      };
    }

    if (allVideos.length > 0) {
      return { video: allVideos[0], isAdminFavorite: false };
    }

    return { video: null, isAdminFavorite: false };
  };

  const { video: featuredVideo, isAdminFavorite } = resolveFeaturedVideo();
  const totalVideosCount = communityVideos.length + videos.length;
  const featuredLocalMeta =
    featuredVideo?.source === 'local'
      ? videos.find((v) => v.id === featuredVideo.id)
      : undefined;

  const handleSelectFeaturedVideo = async (videoId: string) => {
    const selected = allVideos.find((v) => v.id === videoId);
    if (!selected) return;
    setUpdatingFeatured(true);
    try {
      await saveFeaturedVideoFirestore(selected);
      await onRefresh();
    } catch {
      // Save error toast already surfaced by runConfirmedWrite
    } finally {
      setUpdatingFeatured(false);
    }
  };

  const handlePageLikeClick = async () => {
    if (likingPage) return;
    setLikingPage(true);
    try {
      await onLikePage();
    } finally {
      setLikingPage(false);
    }
  };

  const handleLikeNewsClick = async (newsId: string) => {
    if (!onLikeNews || likingNewsId === newsId) return;
    setLikingNewsId(newsId);
    try {
      await onLikeNews(newsId);
    } finally {
      setLikingNewsId(null);
    }
  };

  const openMaximizedNews = (newsId: string) => {
    setMaximizedNewsId(newsId);
    setNewsModalMinimized(false);
  };

  const handleSubmitComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!commentMessage.trim()) return;
    setSubmittingComment(true);
    setCommentFeedback(null);
    try {
      const created = await submitCommentFirestore({
        authorName: commentAuthor.trim() || user?.displayName || 'Hincha de la Liga',
        authorTeamName: teams.find((t) => t.id === user?.teamId)?.name,
        authorTeamId: user?.teamId,
        message: commentMessage.trim(),
        isAdmin: user?.role === 'admin',
      });
      setCommentMessage('');
      setCommentFeedback({
        type: 'ok',
        text:
          created.status === 'pending'
            ? '¡Comentario enviado! Quedará publicado cuando el Administrador lo apruebe.'
            : '¡Comentario publicado!',
      });
      await onRefresh();
    } catch (err) {
      setCommentFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo enviar el comentario.',
      });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleApproveComment = async (commentId: string) => {
    setModeratingCommentId(commentId);
    try {
      await approveCommentFirestore(commentId);
      await onRefresh();
    } catch (err) {
      setCommentFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo aprobar el comentario.',
      });
    } finally {
      setModeratingCommentId(null);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    setModeratingCommentId(commentId);
    try {
      await deleteCommentFirestore(commentId);
      await onRefresh();
    } catch (err) {
      setCommentFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo eliminar el comentario.',
      });
    } finally {
      setModeratingCommentId(null);
    }
  };

  const approvedComments = comments.filter((c) => c.status === 'approved');
  const pendingComments = comments.filter((c) => c.status === 'pending');

  return (
    <div className="space-y-8">
      {/* Hero: Cabecera transparente centrada (el ícono oficial ahora está arriba primero en la barra) encima de la Portada */}
      <section className="space-y-4">
        <div className="px-2 py-2 sm:px-4 sm:py-3 bg-transparent flex flex-col items-center text-center">
          <div className="min-w-0 w-full space-y-2">
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-wide leading-[1.06] uppercase text-lma-brand">
              {settings.title}
            </h1>
            {settings.subtitle?.trim() && (
              <p className="font-display text-base sm:text-xl font-extrabold tracking-[0.22em] uppercase text-lma-brand">
                {settings.subtitle}
              </p>
            )}
            {settings.description?.trim() &&
              !/Torneo oficial de PES 6.*comunidad\.?/i.test(settings.description) && (
                <p className="max-w-3xl mx-auto text-xs sm:text-sm text-zinc-200/90 leading-relaxed drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                  {settings.description}
                </p>
              )}
          </div>
        </div>

        {/* Tarjeta con Foto de Portada Ancho Completo + Mismo Alto + Efecto 3D y Barra Transparente */}
        <div className="hero-cover-3d-stage w-screen relative left-1/2 -translate-x-1/2">
          <div
            onPointerMove={handleHeroPointerMove}
            onPointerLeave={handleHeroPointerLeave}
            style={{
              transform: heroTilt.active
                ? `rotateX(${heroTilt.rotateX.toFixed(2)}deg) rotateY(${heroTilt.rotateY.toFixed(2)}deg) translateZ(10px)`
                : undefined,
              transformStyle: 'preserve-3d',
            }}
            className="w-full overflow-hidden glass-lma-card !rounded-none !border-x-0 border-y border-amber-400/70 shadow-[0_28px_64px_rgba(0,0,0,0.82)] transition-transform duration-300 ease-out"
          >
            <div className="h-1.5 w-full albiceleste-ribbon" aria-hidden="true" />

            {/* Foto de Portada Completa a Ancho Total + Mismo Alto + Efecto 3D HD */}
            {resolvedCoverSrc ? (
              <div className="relative w-full h-[230px] sm:h-[380px] md:h-[500px] lg:h-[620px] bg-black overflow-hidden border-b border-amber-400/50">
                {/* Fondo Panorámico 3D que completa el ancho de pantalla con el mismo estadio */}
                <div
                  aria-hidden="true"
                  style={{
                    transform: heroTilt.active
                      ? `translate3d(${(heroTilt.rotateY * 1.1).toFixed(1)}px, ${(-heroTilt.rotateX * 1.1).toFixed(1)}px, -20px) scale(1.12)`
                      : 'scale(1.1)',
                  }}
                  className="absolute inset-0 transition-transform duration-300 ease-out pointer-events-none"
                >
                  <ResilientImage
                    src={resolvedCoverSrc}
                    alt=""
                    className="w-full h-full object-cover object-center blur-md brightness-[0.64] saturate-[1.2]"
                    fallbackLabel=""
                  />
                </div>

                {/* Plano Frontal Nítido HD: Foto Completa (bandera de atrás + cabra entera en 3D) */}
                <div
                  style={{
                    transform: heroTilt.active
                      ? `translate3d(${(-heroTilt.rotateY * 1.7).toFixed(1)}px, ${(heroTilt.rotateX * 1.7).toFixed(1)}px, 28px)`
                      : undefined,
                    maskImage:
                      'linear-gradient(90deg, transparent 0%, black 4%, black 96%, transparent 100%)',
                    WebkitMaskImage:
                      'linear-gradient(90deg, transparent 0%, black 4%, black 96%, transparent 100%)',
                  }}
                  className={`relative z-10 w-full h-full flex items-center justify-center transition-transform duration-300 ease-out ${
                    heroTilt.active ? '' : 'hero-cover-3d-idle'
                  }`}
                >
                  <ResilientImage
                    src={resolvedCoverSrc}
                    alt="La Cabra con la camiseta de Argentina Messi abrazando la Copa del Mundo en 3D frente a la bandera ESTO ES LIGA MASTER ARGENTINA"
                    className="w-full h-full object-contain object-center contrast-[1.09] brightness-[1.03] saturate-[1.12] drop-shadow-[0_18px_36px_rgba(0,0,0,0.86)]"
                    fallbackLabel="Esto es Liga Master Argentina"
                  />
                </div>

                {/* Reflejo Dorado y Celeste 3D */}
                <div
                  aria-hidden="true"
                  style={{
                    background: `radial-gradient(circle at ${heroTilt.glareX}% ${heroTilt.glareY}%, rgba(254, 240, 138, 0.16) 0%, rgba(56, 189, 248, 0.08) 28%, transparent 55%)`,
                  }}
                  className="absolute inset-0 z-20 pointer-events-none transition-opacity duration-300 mix-blend-screen"
                />
                <div
                  aria-hidden="true"
                  className="absolute inset-0 z-20 pointer-events-none bg-[radial-gradient(circle_at_50%_50%,transparent_54%,rgba(0,0,0,0.42)_100%)] ring-1 ring-inset ring-amber-300/30"
                />
                <div className="absolute inset-x-0 top-0 h-12 z-20 bg-gradient-to-b from-black/35 via-transparent to-transparent pointer-events-none" />

                {user?.role === 'admin' && (
                  <button
                    type="button"
                    disabled={busyHeroMedia === 'coverUrl'}
                    onClick={() => void handleSaveHeroSlotValue('coverUrl', '', 'Portada Principal')}
                    title="Eliminar foto de portada"
                    className="absolute top-3 right-4 z-30 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/75 hover:bg-rose-600/90 border border-rose-400/70 text-rose-100 text-xs font-bold backdrop-blur-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar Portada</span>
                  </button>
                )}
              </div>
            ) : user?.role === 'admin' ? (
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/35">
                <span className="text-xs font-semibold text-amber-200">
                  Foto de Portada eliminada. Podés agregar una nueva imagen o restaurar la original.
                </span>
                <button
                  type="button"
                  onClick={() => setShowHeroMediaManager(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs btn-gold-luxury rounded-lg"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>Agregar Nueva Portada</span>
                </button>
              </div>
            ) : null}

            {/* Barra de Acciones Abajo de la Foto de Portada */}
            <div className="bg-gradient-to-r from-black/65 via-[#092448]/58 to-black/65 backdrop-blur-md">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="font-display text-xl sm:text-3xl font-extrabold tracking-wider uppercase text-lma-title">
                  {settings.bannerText || settings.title}
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    disabled={likingPage}
                    onClick={handlePageLikeClick}
                    title="Dejar Me Gusta a la página"
                    className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-bold rounded-xl backdrop-blur-md transition-all whitespace-nowrap ${
                      pageLiked
                        ? 'bg-rose-500/30 text-rose-100 border border-rose-400/80 shadow-[0_0_16px_rgba(244,63,94,0.3)]'
                        : 'bg-black/50 hover:bg-rose-500/20 text-white border border-rose-400/55'
                    }`}
                  >
                    <Heart
                      className={`w-4 h-4 transition-transform ${
                        pageLiked ? 'fill-rose-500 text-rose-400 scale-110' : 'text-rose-400'
                      }`}
                    />
                    <span>Me Gusta</span>
                    <span className="px-2 py-0.5 rounded-md bg-black/55 font-mono text-xs text-rose-200 tabular-nums">
                      {pageLikes}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate('partidos')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm btn-gold-luxury rounded-xl whitespace-nowrap"
                  >
                    <span>Ver Partidos</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('copas')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm btn-celeste-gold rounded-xl transition-all whitespace-nowrap"
                  >
                    <Trophy className="w-4 h-4 text-amber-300" />
                    <span>{getTitleText(settings, 'navCopas')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('calendario')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm btn-celeste-gold rounded-xl transition-all whitespace-nowrap"
                  >
                    <CalendarDays className="w-4 h-4 text-sky-300" />
                    <span>{getTitleText(settings, 'navCalendario')} ({totalCalendarCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('posiciones')}
                    className="px-4 py-2.5 text-sm btn-celeste-gold rounded-xl transition-all whitespace-nowrap"
                  >
                    {getTitleText(settings, 'navPosiciones')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('partidos', 'claims')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-white bg-black/50 hover:bg-white/10 border border-white/30 backdrop-blur-md rounded-xl transition-colors whitespace-nowrap"
                  >
                    <ShieldAlert className="w-4 h-4 text-amber-300" />
                    <span>Reclamos</span>
                  </button>
                  <button
                    type="button"
                    onClick={onReplayIntro}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-amber-100 bg-black/50 hover:bg-amber-400/20 border border-amber-400/55 backdrop-blur-md rounded-xl transition-colors whitespace-nowrap"
                  >
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Fuegos</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fila de 3 columnas AMPLIADA: Placa Messi | Foto Interactiva Messi & Maradona | Placa Maradona */}
        {(resolvedMessiPlaqueSrc || resolvedMessiMaradonaSrc || resolvedMaradonaPlaqueSrc) && (
          <div className="w-full md:w-[calc(100%+2rem)] lg:w-[calc(100%+4rem)] md:-mx-4 lg:-mx-8 grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-7 items-stretch">
            {/* Placa Dorada de Messi (más grande) */}
            {resolvedMessiPlaqueSrc && (
              <div className="md:col-span-4 relative group w-full rounded-2xl overflow-hidden glass-lma-card border border-amber-400/60 flex items-center justify-center">
                <img
                  src={resolveAssetUrl(resolvedMessiPlaqueSrc)}
                  referrerPolicy="no-referrer"
                  alt="Placa dorada de datos personales de Lionel Messi"
                  className="w-full h-full object-contain block"
                />
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    disabled={busyHeroMedia === 'messiPlaqueUrl'}
                    onClick={() => void handleSaveHeroSlotValue('messiPlaqueUrl', '', 'Placa de Datos Messi')}
                    title="Eliminar placa de datos de Messi"
                    className="absolute top-2.5 right-2.5 z-30 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/80 hover:bg-rose-600/90 border border-rose-400/70 text-rose-100 text-[11px] font-bold backdrop-blur-md transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Eliminar</span>
                  </button>
                )}
              </div>
            )}

            {/* Centro: Imagen Interactiva de Messi & Maradona (más grande) */}
            {resolvedMessiMaradonaSrc && (
              <div
                onMouseLeave={() => stopLegendAudio()}
                className="md:col-span-4 relative group w-full rounded-2xl overflow-hidden glass-lma-card border border-sky-400/65 flex flex-col justify-center"
              >
                <audio
                  ref={messiHoverAudioRef}
                  src={resolveAssetUrl(MESSI_HOVER_AUDIO)}
                  preload="auto"
                  onEnded={() => setActiveLegendAudio((prev) => (prev === 'messi' ? null : prev))}
                />
                <audio
                  ref={maradonaHoverAudioRef}
                  src={resolveAssetUrl(MARADONA_HOVER_AUDIO)}
                  preload="auto"
                  onEnded={() => setActiveLegendAudio((prev) => (prev === 'maradona' ? null : prev))}
                />

                {user?.role === 'admin' && (
                  <button
                    type="button"
                    disabled={busyHeroMedia === 'messiMaradonaUrl'}
                    onClick={() => void handleSaveHeroSlotValue('messiMaradonaUrl', '', 'Foto Messi & Maradona')}
                    title="Eliminar foto de Messi y Maradona"
                    className="absolute top-2.5 right-2.5 z-30 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/80 hover:bg-rose-600/90 border border-rose-400/70 text-rose-100 text-[11px] font-bold backdrop-blur-md transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Eliminar</span>
                  </button>
                )}

                <div className="relative aspect-[3/4] w-full overflow-hidden bg-black/50">
                  <img
                    src={resolveAssetUrl(resolvedMessiMaradonaSrc)}
                    referrerPolicy="no-referrer"
                    alt="Lionel Messi a la izquierda y Diego Maradona a la derecha con la pelota"
                    className="w-full h-full object-cover object-[50%_76%]"
                  />

                  <div
                    aria-hidden="true"
                    className="absolute inset-y-0 left-1/2 w-px bg-white/30 pointer-events-none z-10"
                  />

                  <a
                    href="https://es.wikipedia.org/wiki/Lionel_Messi"
                    target="_blank"
                    rel="noopener noreferrer"
                    onMouseEnter={() => playLegendAudio('messi')}
                    onMouseLeave={() => stopLegendAudio('messi')}
                    onFocus={() => playLegendAudio('messi')}
                    onBlur={() => stopLegendAudio('messi')}
                    aria-label="Lionel Messi: pasar el cursor para escuchar su canción y hacer clic para ir a Wikipedia"
                    title="Lionel Messi (pasá el cursor para escuchar su canción · clic para Wikipedia)"
                    className="group/messi absolute inset-y-0 left-0 w-1/2 z-20 flex flex-col justify-end p-4 sm:p-5 bg-gradient-to-t from-black/80 via-black/10 to-transparent hover:from-sky-950/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300"
                  >
                    <span className="inline-flex items-center gap-1.5 font-display text-lg sm:text-xl font-extrabold uppercase tracking-wide text-white group-hover/messi:text-sky-300 transition-colors drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]">
                      <span>Lionel Messi</span>
                      {activeLegendAudio === 'messi' && (
                        <Volume2 className="w-4 h-4 text-sky-300 shrink-0" aria-hidden="true" />
                      )}
                    </span>
                    <span className="text-[11px] sm:text-xs font-medium text-sky-200/95">
                      Wikipedia ↗
                    </span>
                  </a>

                  <a
                    href="https://es.wikipedia.org/wiki/Diego_Maradona"
                    target="_blank"
                    rel="noopener noreferrer"
                    onMouseEnter={() => playLegendAudio('maradona')}
                    onMouseLeave={() => stopLegendAudio('maradona')}
                    onFocus={() => playLegendAudio('maradona')}
                    onBlur={() => stopLegendAudio('maradona')}
                    aria-label="Diego Maradona: pasar el cursor para escuchar su canción y hacer clic para ir a Wikipedia"
                    title="Diego Maradona (pasá el cursor para escuchar su canción · clic para Wikipedia)"
                    className="group/maradona absolute inset-y-0 right-0 w-1/2 z-20 flex flex-col justify-end items-end text-right p-4 sm:p-5 bg-gradient-to-t from-black/80 via-black/10 to-transparent hover:from-amber-950/75 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
                  >
                    <span className="inline-flex items-center gap-1.5 font-display text-lg sm:text-xl font-extrabold uppercase tracking-wide text-white group-hover/maradona:text-amber-300 transition-colors drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]">
                      {activeLegendAudio === 'maradona' && (
                        <Volume2 className="w-4 h-4 text-amber-300 shrink-0" aria-hidden="true" />
                      )}
                      <span>Diego Maradona</span>
                    </span>
                    <span className="text-[11px] sm:text-xs font-medium text-amber-200/95">
                      Wikipedia ↗
                    </span>
                  </a>
                </div>
              </div>
            )}

            {/* Placa Dorada de Maradona (más grande) */}
            {resolvedMaradonaPlaqueSrc && (
              <div className="md:col-span-4 relative group w-full rounded-2xl overflow-hidden glass-lma-card border border-amber-400/60 flex items-center justify-center">
                <img
                  src={resolveAssetUrl(resolvedMaradonaPlaqueSrc)}
                  referrerPolicy="no-referrer"
                  alt="Placa dorada de datos personales de Diego Armando Maradona"
                  className="w-full h-full object-contain block"
                />
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    disabled={busyHeroMedia === 'maradonaPlaqueUrl'}
                    onClick={() => void handleSaveHeroSlotValue('maradonaPlaqueUrl', '', 'Placa de Datos Maradona')}
                    title="Eliminar placa de datos de Maradona"
                    className="absolute top-2.5 right-2.5 z-30 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/80 hover:bg-rose-600/90 border border-rose-400/70 text-rose-100 text-[11px] font-bold backdrop-blur-md transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Eliminar</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Imágenes Nuevas Adicionales agregadas por el Admin */}
        {extraHeroImages.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {extraHeroImages.map((imgUrl, idx) => (
              <div
                key={`${imgUrl}_${idx}`}
                className="relative rounded-2xl overflow-hidden glass-lma-card border border-amber-400/50"
              >
                <ResilientImage
                  src={resolveAssetUrl(imgUrl)}
                  alt={`Imagen destacada #${idx + 1}`}
                  className="w-full h-64 sm:h-72 object-cover"
                  fallbackLabel={`Imagen #${idx + 1}`}
                />
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    disabled={busyHeroMedia === `extra_${idx}`}
                    onClick={() => void handleDeleteExtraHero(idx)}
                    title="Eliminar esta imagen"
                    className="absolute top-2.5 right-2.5 z-20 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/80 hover:bg-rose-600/90 border border-rose-400/70 text-rose-100 text-[11px] font-bold backdrop-blur-md"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Eliminar</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Panel Exclusivo Admin: Gestionar, Eliminar y Agregar Nuevas Imágenes del Inicio */}
        {user?.role === 'admin' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowHeroMediaManager((v) => !v)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold btn-celeste-gold rounded-xl"
              >
                <ImagePlus className="w-4 h-4 text-amber-300" />
                <span>
                  {showHeroMediaManager
                    ? 'Ocultar Gestor de las 4 Imágenes'
                    : 'Admin: Eliminar o Agregar Imágenes de Portada y Leyendas'}
                </span>
              </button>
            </div>

            {showHeroMediaManager && (
              <div className="p-5 rounded-2xl glass-lma-card border border-amber-400/60 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/30 pb-3">
                  <div>
                    <h3 className="font-display text-xl font-bold text-lma-title">
                      Gestor Admin: Las 4 Imágenes Principales e Imágenes Nuevas
                    </h3>
                    <p className="text-xs text-sky-100/85">
                      Eliminá cualquiera de las 4 imágenes, subí reemplazos desde tu dispositivo o agregá nuevas imágenes debajo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowHeroMediaManager(false)}
                    className="p-1.5 rounded-lg bg-black/50 border border-white/25 text-zinc-200 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {heroMediaMsg && (
                  <div
                    className={`p-3 rounded-xl text-xs font-semibold border ${
                      heroMediaMsg.type === 'ok'
                        ? 'bg-sky-950/60 border-sky-400/60 text-sky-100'
                        : 'bg-rose-950/60 border-rose-400/60 text-rose-100'
                    }`}
                  >
                    {heroMediaMsg.text}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  {(
                    [
                      {
                        slot: 'coverUrl' as HeroSlotKey,
                        label: '1. Portada Principal',
                        current: resolvedCoverSrc,
                        original: defaultCoverImg,
                      },
                      {
                        slot: 'messiPlaqueUrl' as HeroSlotKey,
                        label: '2. Placa Datos Messi',
                        current: resolvedMessiPlaqueSrc,
                        original: MESSI_PLAQUE_IMG,
                      },
                      {
                        slot: 'messiMaradonaUrl' as HeroSlotKey,
                        label: '3. Foto Messi & Maradona',
                        current: resolvedMessiMaradonaSrc,
                        original: MESSI_MARADONA_IMG,
                      },
                      {
                        slot: 'maradonaPlaqueUrl' as HeroSlotKey,
                        label: '4. Placa Datos Maradona',
                        current: resolvedMaradonaPlaqueSrc,
                        original: MARADONA_PLAQUE_IMG,
                      },
                    ] as const
                  ).map((item) => (
                    <div
                      key={item.slot}
                      className="p-3 rounded-xl bg-black/45 border border-amber-400/40 flex flex-col justify-between gap-2.5"
                    >
                      <div className="text-xs font-bold text-amber-200">{item.label}</div>
                      {item.current ? (
                        <div className="h-24 rounded-lg overflow-hidden bg-black/60 border border-white/15">
                          <img
                            src={resolveAssetUrl(item.current)}
                            alt={item.label}
                            className="w-full h-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="h-24 rounded-lg bg-black/50 border border-dashed border-rose-400/45 flex items-center justify-center text-[11px] text-rose-200">
                          Eliminada
                        </div>
                      )}
                      <label className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-400/50 text-sky-100 text-[11px] font-semibold cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{busyHeroMedia === item.slot ? 'Subiendo...' : 'Subir Nueva'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={busyHeroMedia === item.slot}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            void handleUploadHeroSlotFile(item.slot, f, item.label);
                          }}
                        />
                      </label>
                      <div className="flex items-center gap-1.5">
                        {item.current && (
                          <button
                            type="button"
                            disabled={busyHeroMedia === item.slot}
                            onClick={() => void handleSaveHeroSlotValue(item.slot, '', item.label)}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/50 text-rose-200 text-[11px] font-semibold"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Eliminar</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyHeroMedia === item.slot}
                          onClick={() =>
                            void handleSaveHeroSlotValue(item.slot, item.original, item.label)
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-amber-400/15 hover:bg-amber-400/30 border border-amber-400/45 text-amber-200 text-[11px] font-semibold"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Original</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Agregar nuevas imágenes extras al Inicio */}
                <div className="pt-3 border-t border-amber-400/25 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <label className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl btn-gold-luxury text-xs cursor-pointer shrink-0">
                    <Plus className="w-4 h-4" />
                    <span>
                      {busyHeroMedia === 'extra_add' ? 'Subiendo...' : 'Agregar Nueva Imagen (Archivo)'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={busyHeroMedia === 'extra_add'}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        void handleAddExtraHeroFile(f);
                      }}
                    />
                  </label>
                  <div className="flex-1 flex gap-2">
                    <input
                      type="url"
                      value={newExtraHeroUrl}
                      onChange={(e) => setNewExtraHeroUrl(e.target.value)}
                      placeholder="O pegá URL directa de una nueva imagen (https://...)"
                      className="flex-1 px-3 py-2 text-xs bg-black/60 text-white border border-amber-400/45 rounded-xl focus:outline-none focus:border-sky-400"
                    />
                    <button
                      type="button"
                      disabled={!newExtraHeroUrl.trim() || busyHeroMedia === 'extra_url'}
                      onClick={() => void handleAddExtraHeroByUrl()}
                      className="px-3.5 py-2 text-xs font-bold btn-celeste-gold rounded-xl disabled:opacity-50 shrink-0"
                    >
                      + Agregar URL
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Noticias! Últimas Novedades + Historial de Campeones (Abajo de Portada, Arriba de Videos) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Noticias más grandes con Me Gusta y botón Maximizar */}
        <div
          onMouseEnter={() => setNewsPaused(true)}
          onMouseLeave={() => setNewsPaused(false)}
          className="lg:col-span-7 glass-lma-card border border-amber-400/45 rounded-2xl overflow-hidden flex flex-col"
        >
          <div className="px-5 py-4 border-b border-amber-400/35 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-black/60 via-[#092448]/55 to-black/60">
            <div className="flex items-center gap-2 min-w-0">
              <Megaphone className="w-5 h-5 text-sky-300 shrink-0" />
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-lma-title truncate">
                {getTitleText(settings, 'homeNewsTitle')}
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {news.length > 1 && (
                <span className="text-[11px] font-mono text-zinc-400">
                  {(newsIdx % news.length) + 1}/{news.length} · 10s
                </span>
              )}
              {activeNews && (
                <button
                  type="button"
                  onClick={() => openMaximizedNews(activeNews.id)}
                  title="Maximizar noticia en grande"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-sky-100 bg-[#101824] hover:bg-sky-500/20 border border-sky-400/40 rounded-lg transition-colors whitespace-nowrap"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-sky-300" />
                  <span>Maximizar</span>
                </button>
              )}
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => onNavigate('perfil', 'noticias')}
                  className="px-2.5 py-1.5 text-xs font-bold btn-gold-luxury rounded-lg whitespace-nowrap"
                >
                  + Publicar
                </button>
              )}
            </div>
          </div>

          <div className="p-5 flex-1 flex flex-col justify-between gap-4">
            {!activeNews ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 rounded-xl bg-[#07090E] border border-zinc-700/50 space-y-2.5">
                <Megaphone className="w-7 h-7 text-amber-300/80" />
                <p className="text-sm text-zinc-300 max-w-md">
                  Todavía no hay comunicados publicados. Aquí aparecerán las portadas de diario de campeones, fotos PNG y videos MP4 del Administrador.
                </p>
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('perfil', 'noticias')}
                    className="px-3.5 py-2 text-xs btn-gold-luxury rounded-lg"
                  >
                    Crear primer comunicado
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {activeNews.isChampionNewspaper ? (
                    /* PORTADA DE DIARIO DEPORTIVO: ¡CAMPEÓN! */
                    <article
                      key={activeNews.id}
                      onClick={() => openMaximizedNews(activeNews.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openMaximizedNews(activeNews.id);
                        }
                      }}
                      className="rounded-xl overflow-hidden border-2 border-amber-400/80 bg-[#F5EFE0] text-zinc-950 shadow-[0_14px_32px_rgba(0,0,0,0.78)] flex flex-col cursor-pointer hover:ring-2 hover:ring-amber-300/80 transition-all"
                    >
                      <div className="px-4 py-2.5 bg-zinc-950 text-amber-300 border-b-2 border-amber-400 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Newspaper className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="font-display text-xs sm:text-sm font-extrabold tracking-[0.18em] uppercase truncate">
                            DIARIO LIGA MASTER · EDICIÓN CAMPEÓN
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-zinc-300 shrink-0">
                          {new Date(activeNews.createdAt).toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </span>
                      </div>

                      <div className="px-4 pt-3.5 pb-2.5 border-b border-zinc-900/20 text-center space-y-1.5">
                        <div className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-emerald-800">
                          ★ {activeNews.championTournament || 'Campeón Oficial'} ·{' '}
                          {activeNews.championSeason || settings.subtitle} ★
                        </div>
                        <h3 className="font-display text-2xl sm:text-3xl font-black uppercase leading-[1.02] tracking-tight text-zinc-950">
                          ¡{activeNews.championTeamName || activeNews.title} CAMPEÓN!
                        </h3>
                        <div className="inline-block px-3 py-0.5 rounded bg-zinc-950 text-amber-300 text-xs font-extrabold tracking-wide">
                          DT CAMPEÓN: {activeNews.championMemberName || 'Miembro Oficial'}
                        </div>
                      </div>

                      <div className="p-3.5 bg-[#EFE6D2] grid grid-cols-12 gap-3 items-center border-b border-zinc-900/15">
                        <div className="col-span-4 flex flex-col items-center justify-center p-2.5 rounded-lg bg-zinc-950 border border-amber-400/70">
                          <ResilientImage
                            src={activeNews.championCrestUrl}
                            alt={`Escudo ${activeNews.championTeamName || 'Campeón'}`}
                            className="w-20 h-20 object-contain drop-shadow-[0_4px_10px_rgba(250,204,21,0.45)]"
                            fallbackLabel={activeNews.championTeamName || 'LMA'}
                          />
                          <span className="mt-1.5 text-[11px] font-bold text-amber-300 text-center leading-tight line-clamp-2">
                            {activeNews.championTeamName}
                          </span>
                        </div>
                        <div className="col-span-8 relative aspect-[16/10] rounded-lg overflow-hidden border-2 border-zinc-950 bg-zinc-950">
                          <ResilientImage
                            src={activeNews.celebrationImageUrl || activeNews.imageUrl}
                            fallbackSrc={defaultChampImg}
                            alt={`Celebración ${activeNews.championTeamName || 'Campeón'}`}
                            className="w-full h-full object-contain"
                            fallbackLabel="¡CAMPEÓN!"
                          />
                          <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded bg-amber-400 text-zinc-950 font-display text-[11px] font-black uppercase tracking-wider shadow">
                            ¡FESTEJO OFICIAL!
                          </div>
                        </div>
                      </div>

                      <div className="px-4 py-3 text-xs sm:text-sm leading-relaxed text-zinc-800 font-medium flex items-center justify-between gap-2">
                        <span className="line-clamp-3">{activeNews.content}</span>
                        <span className="text-[11px] font-bold text-emerald-800 shrink-0 underline">
                          Ver en grande →
                        </span>
                      </div>
                    </article>
                  ) : (
                    /* Noticia / Comunicado Regular del Administrador */
                    <article
                      key={activeNews.id}
                      onClick={() => openMaximizedNews(activeNews.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openMaximizedNews(activeNews.id);
                        }
                      }}
                      className="p-5 rounded-xl bg-[#07090E] border border-amber-400/40 hover:border-amber-300/80 space-y-3.5 cursor-pointer transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3
                          className="font-display text-xl sm:text-2xl font-extrabold leading-tight"
                          style={{ color: activeNews.textColor || '#FACC15' }}
                        >
                          {activeNews.title}
                        </h3>
                        <span className="text-xs font-mono text-zinc-400 shrink-0">
                          {new Date(activeNews.createdAt).toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </span>
                      </div>

                      {activeNews.content && (
                        <p
                          className="text-sm sm:text-base leading-relaxed whitespace-pre-line line-clamp-5"
                          style={{ color: activeNews.textColor || '#F8FAFC' }}
                        >
                          {activeNews.content}
                        </p>
                      )}

                      {activeNews.imageUrl && (
                        <div className="rounded-xl overflow-hidden border border-zinc-700/70 bg-black flex items-center justify-center">
                          <ResilientImage
                            src={activeNews.imageUrl}
                            alt={activeNews.title}
                            className="w-full max-h-80 sm:max-h-96 object-contain mx-auto"
                            fallbackLabel={activeNews.title}
                          />
                        </div>
                      )}

                      {activeNews.videoUrl && (
                        <div
                          className="rounded-xl overflow-hidden border border-zinc-700/70 bg-black"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <video
                            controls
                            playsInline
                            preload="metadata"
                            onPlay={() => setNewsPaused(true)}
                            onPause={() => setNewsPaused(false)}
                            onEnded={() => setNewsPaused(false)}
                            src={resolveAssetUrl(activeNews.videoUrl)}
                            className="w-full max-h-72 sm:max-h-80 object-contain"
                          >
                            <source src={resolveAssetUrl(activeNews.videoUrl)} type="video/mp4" />
                          </video>
                        </div>
                      )}

                      <div className="pt-1 text-right">
                        <span className="text-xs font-semibold text-amber-300 hover:underline">
                          Apretá para agrandar noticia →
                        </span>
                      </div>
                    </article>
                  )}
                </div>

                {/* Botón Me Gusta con Corazón al lado de la noticia */}
                <div className="flex flex-col items-center gap-2 shrink-0 pt-1">
                  <button
                    type="button"
                    disabled={likingNewsId === activeNews.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleLikeNewsClick(activeNews.id);
                    }}
                    title="Me Gusta esta noticia"
                    aria-label="Me Gusta esta noticia"
                    className={`flex flex-col items-center justify-center gap-1 px-3 py-3 rounded-xl border transition-all ${
                      likedNews[activeNews.id]
                        ? 'bg-rose-500/25 border-rose-400/80 text-rose-100 shadow-[0_0_14px_rgba(244,63,94,0.3)]'
                        : 'bg-[#07090E] hover:bg-rose-500/15 border-rose-400/45 text-zinc-100'
                    }`}
                  >
                    <Heart
                      className={`w-5 h-5 transition-transform ${
                        likedNews[activeNews.id]
                          ? 'fill-rose-500 text-rose-400 scale-110'
                          : 'text-rose-400'
                      }`}
                    />
                    <span className="text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
                      Me Gusta
                    </span>
                    <span className="px-2 py-0.5 rounded bg-black/60 font-mono text-xs text-rose-200 tabular-nums">
                      {activeNews.likes || 0}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Controles de navegación del carrusel de Noticias */}
            {news.length > 1 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setNewsIdx((i) => (i - 1 + news.length) % news.length)}
                  aria-label="Noticia anterior"
                  className="p-1.5 rounded-lg bg-[#07090E] border border-zinc-700/70 text-zinc-200 hover:border-amber-400"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1.5 flex-wrap justify-center">
                  {news.map((n, idx) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setNewsIdx(idx)}
                      aria-label={`Ver noticia ${idx + 1}`}
                      className={`h-1.5 rounded-full transition-all ${
                        idx === newsIdx % news.length
                          ? 'w-6 bg-sky-400'
                          : 'w-2 bg-zinc-600 hover:bg-zinc-400'
                      }`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setNewsIdx((i) => (i + 1) % news.length)}
                  aria-label="Siguiente noticia"
                  className="p-1.5 rounded-lg bg-black/55 border border-amber-400/40 text-zinc-200 hover:border-amber-400"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Historial de Campeones al lado de Noticias, arriba de Videos */}
        <div className="lg:col-span-5 flex flex-col">
          {activeChampion ? (
            <div
              onMouseEnter={() => setChampPaused(true)}
              onMouseLeave={() => setChampPaused(false)}
              className="glass-lma-card border border-amber-400/45 rounded-2xl overflow-hidden flex-1 flex flex-col"
            >
              <div className="px-5 py-4 border-b border-amber-400/30 flex items-center justify-between gap-2 bg-gradient-to-r from-black/60 via-[#092448]/55 to-black/60">
                <div className="flex items-center gap-2 min-w-0">
                  <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
                  <h2 className="font-display text-2xl font-bold text-lma-title truncate">
                    {getTitleText(settings, 'homeChampionsTitle')}
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {champions.length > 1 && (
                    <span className="text-[10px] font-mono text-zinc-400">
                      {(champIdx % champions.length) + 1}/{champions.length} · 10s
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onNavigate('galeria', 'campeones')}
                    className="text-xs font-semibold text-amber-300 hover:text-amber-200 transition-colors whitespace-nowrap"
                  >
                    Subir PNG →
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-[#06070A] border border-zinc-400/35">
                  <ResilientImage
                    key={activeChampion.id}
                    src={activeChampion.celebrationImageUrl}
                    fallbackSrc={defaultChampImg}
                    alt={`Festejo campeón ${activeChampion.teamName}`}
                    className="w-full h-full object-contain transition-opacity duration-500"
                    fallbackLabel={activeChampion.teamName}
                  />
                  {champions.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setChampIdx((i) => (i - 1 + champions.length) % champions.length)
                        }
                        aria-label="Campeón anterior"
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/70 hover:bg-black text-amber-200 border border-amber-400/40"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setChampIdx((i) => (i + 1) % champions.length)}
                        aria-label="Siguiente campeón"
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/70 hover:bg-black text-amber-200 border border-amber-400/40"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-amber-300">
                      {activeChampion.tournamentType === 'copa'
                        ? `${getTitleText(settings, 'compCopaName')} · `
                        : activeChampion.tournamentType === 'recopa'
                        ? `${getTitleText(settings, 'compRecopaName')} · `
                        : `${getTitleText(settings, 'compLigaName')} · `}
                      {activeChampion.season}
                    </div>
                    <div className="font-display text-xl font-bold text-silver-shiny truncate">
                      {activeChampion.teamName}
                    </div>
                    <div className="text-xs text-zinc-400 truncate">
                      DT: {activeChampion.memberName}
                    </div>
                  </div>
                  {(() => {
                    const matched =
                      (activeChampion.teamId && teamMap.get(activeChampion.teamId)) ||
                      teams.find(
                        (t) =>
                          t.name.toLowerCase() === activeChampion.teamName.toLowerCase() ||
                          t.memberName.toLowerCase() === activeChampion.memberName.toLowerCase()
                      );
                    if (!matched?.crestUrl) return null;
                    return (
                      <ResilientImage
                        src={matched.crestUrl}
                        alt={matched.name}
                        className="w-11 h-11 rounded-lg object-contain bg-[#06070A] border border-amber-400/45 p-1 shrink-0"
                        fallbackLabel={matched.name}
                      />
                    );
                  })()}
                </div>

                {champions.length > 1 && (
                  <div className="flex items-center justify-center gap-1.5 pt-1">
                    {champions.map((c, idx) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setChampIdx(idx)}
                        aria-label={`Ver campeón ${c.teamName}`}
                        className={`h-1.5 rounded-full transition-all ${
                          idx === champIdx % champions.length
                            ? 'w-6 bg-amber-400'
                            : 'w-2 bg-zinc-600 hover:bg-zinc-400'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="glass-lma-card border border-amber-400/45 rounded-2xl p-6 flex-1 flex flex-col justify-center items-center text-center gap-3">
              <Trophy className="w-8 h-8 text-amber-300" />
              <h2 className="font-display text-2xl font-bold text-lma-title">
                {getTitleText(settings, 'homeChampionsTitle')}
              </h2>
              <p className="text-xs text-zinc-200">
                Subí la celebración oficial de los campeones de Liga y Copa de la Liga.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('galeria', 'campeones')}
                className="px-4 py-2 text-xs btn-gold-luxury rounded-lg"
              >
                Subir festejo PNG
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Videos Destacados + Los 5 Mejores Goles (sin reproducción automática; Top 5 rota cada 6s) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Columna Izquierda: Video Más Destacado */}
        <div className="xl:col-span-6 glass-lma-card border border-amber-400/40 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-amber-400/30 flex flex-wrap items-center justify-between gap-2.5 bg-gradient-to-r from-black/60 via-[#092448]/55 to-black/60">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-300" />
              <h2 className="font-display text-2xl font-bold text-lma-title">
                {getTitleText(settings, 'homeFeaturedVideoTitle')}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user?.role === 'admin' && allVideos.length > 0 && (
                <select
                  id="featured-video-select"
                  disabled={updatingFeatured}
                  value={featuredVideo?.id || ''}
                  onChange={(e) => handleSelectFeaturedVideo(e.target.value)}
                  title="Elegir video destacado del inicio"
                  className="px-2.5 py-1 text-xs bg-[#041224] text-white border border-amber-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 max-w-[200px]"
                >
                  {allVideos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title} — {v.author}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => onNavigate('galeria', 'videos')}
                className="text-xs font-semibold text-sky-200 hover:text-amber-300 transition-colors whitespace-nowrap"
              >
                Galería ({totalVideosCount}) →
              </button>
            </div>
          </div>

          {featuredVideo ? (
            <div className="p-5 flex-1 flex flex-col justify-between gap-4">
              <div className="aspect-video w-full rounded-xl overflow-hidden bg-[#041224] border border-amber-400/45">
                <video
                  key={featuredVideo.videoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-contain"
                  src={resolveAssetUrl(featuredVideo.videoUrl)}
                >
                  <source src={resolveAssetUrl(featuredVideo.videoUrl)} type="video/mp4" />
                  Tu navegador no soporta reproducción directa.
                </video>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-sky-200">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-sky-400/15 border border-amber-400/55 text-white font-semibold">
                    <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
                    <span>{isAdminFavorite ? 'Favorito del Admin' : 'Último Gol Subido'}</span>
                  </span>
                  <span>· {featuredVideo.author}</span>
                  {featuredVideo.fechaLabel && <span>· {featuredVideo.fechaLabel}</span>}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-2xl font-extrabold text-albiceleste-shiny truncate">
                    {featuredVideo.title}
                  </h3>
                  <button
                    type="button"
                    onClick={() => onNavigate('galeria', 'videos')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs btn-gold-luxury rounded-lg shrink-0"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Ver Galería</span>
                  </button>
                </div>
                {featuredLocalMeta?.description && (
                  <p className="text-xs text-sky-100/80 line-clamp-2">
                    {featuredLocalMeta.description}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 flex-1 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-sky-400/15 border border-amber-400/50 text-sky-200 flex items-center justify-center">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">Todavía no hay video destacado</div>
                <div className="text-xs text-sky-100/75 mt-1">
                  Subí un gol en formato .MP4 en la Galería para destacarlo aquí.
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('galeria', 'videos')}
                className="px-4 py-2 text-xs btn-gold-luxury rounded-lg"
              >
                Subir Primer Video .MP4
              </button>
            </div>
          )}
        </div>

        {/* Columna Derecha: Los Mejores 5 Goles (Cambia cada 6s · Reproducción manual al darle Play) */}
        <div className="xl:col-span-6 glass-lma-card border border-amber-400/50 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-amber-400/35 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-black/60 via-[#092448]/55 to-black/60">
            <div className="flex items-center gap-2 min-w-0">
              <Flame className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-bold text-lma-title leading-none">
                  {getTitleText(settings, 'homeTopGoalsTitle')}
                </h2>
                <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                  {sortedAdminTopGoals.length > 0
                    ? 'Elegidos por el Admin · Cambia cada 6s · Dale Play para ver'
                    : 'Cambia cada 6s · Dale Play para reproducir el gol'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {currentTopGoal && (
                <button
                  type="button"
                  onClick={() => setTopGoalsMuted((m) => !m)}
                  title={topGoalsMuted ? 'Activar sonido del Top 5' : 'Silenciar Top 5'}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-[#05070B] border border-amber-400/45 text-amber-200 hover:bg-amber-400/15 transition-colors"
                >
                  {topGoalsMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>{topGoalsMuted ? 'Silencio' : 'Sonido'}</span>
                </button>
              )}
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => onNavigate('perfil', 'videos')}
                  className="px-2.5 py-1.5 text-[11px] font-bold btn-gold-luxury rounded-lg whitespace-nowrap"
                >
                  Elegir 5 Goles
                </button>
              )}
            </div>
          </div>

          {currentTopGoal ? (
            <div className="p-5 flex-1 flex flex-col justify-between gap-3.5">
              <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-amber-400/55">
                <video
                  ref={topGoalVideoRef}
                  key={`${currentTopGoal.id}_${currentTopGoal.videoUrl}`}
                  controls
                  muted={topGoalsMuted}
                  playsInline
                  preload="metadata"
                  onPlay={() => setTopGoalPlaying(true)}
                  onPause={() => setTopGoalPlaying(false)}
                  onEnded={() => {
                    setTopGoalPlaying(false);
                    if (effectiveTopGoals.length > 1) {
                      setActiveGoalIdx((prev) => (prev + 1) % effectiveTopGoals.length);
                    }
                  }}
                  onError={() => {
                    setTopGoalPlaying(false);
                    if (effectiveTopGoals.length > 1) {
                      setActiveGoalIdx((prev) => (prev + 1) % effectiveTopGoals.length);
                    }
                  }}
                  className="w-full h-full object-contain"
                  src={resolveAssetUrl(currentTopGoal.videoUrl)}
                >
                  <source src={resolveAssetUrl(currentTopGoal.videoUrl)} type="video/mp4" />
                </video>
                <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-lg bg-black/80 border border-amber-400/70 text-xs font-extrabold text-amber-300 pointer-events-none flex items-center gap-1.5">
                  <span>GOL #{currentTopGoal.rank}</span>
                  <span className="text-zinc-300 font-normal">
                    ({(activeGoalIdx % effectiveTopGoals.length) + 1}/{effectiveTopGoals.length})
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display text-xl font-extrabold text-white truncate">
                      #{currentTopGoal.rank} · {currentTopGoal.title}
                    </div>
                    {(currentTopGoal.scorerName || currentTopGoal.author) && (
                      <div className="text-xs text-amber-200/85 truncate">
                        {currentTopGoal.scorerName ? `Goleador: ${currentTopGoal.scorerName}` : ''}
                        {currentTopGoal.scorerName && currentTopGoal.author ? ' · ' : ''}
                        {currentTopGoal.author ? `Subido por ${currentTopGoal.author}` : ''}
                      </div>
                    )}
                  </div>
                  {effectiveTopGoals.length > 1 && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveGoalIdx(
                            (prev) => (prev - 1 + effectiveTopGoals.length) % effectiveTopGoals.length
                          )
                        }
                        aria-label="Gol anterior"
                        className="p-1.5 rounded-lg bg-[#05070B] border border-zinc-600/60 text-zinc-200 hover:border-amber-400"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveGoalIdx((prev) => (prev + 1) % effectiveTopGoals.length)
                        }
                        aria-label="Siguiente gol"
                        className="p-1.5 rounded-lg bg-[#05070B] border border-zinc-600/60 text-zinc-200 hover:border-amber-400"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Lista rápida clickable de los 5 mejores goles */}
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
                  {effectiveTopGoals.map((goal, idx) => {
                    const isSelected = idx === activeGoalIdx % effectiveTopGoals.length;
                    return (
                      <button
                        key={goal.id}
                        type="button"
                        onClick={() => setActiveGoalIdx(idx)}
                        title={`Ver #${goal.rank}: ${goal.title}`}
                        className={`px-2 py-1.5 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'bg-amber-400/20 border-amber-300 text-amber-100 shadow-sm'
                            : 'bg-[#06080D] border-zinc-700/60 text-zinc-300 hover:border-amber-400/50'
                        }`}
                      >
                        <div className="text-[10px] font-mono font-extrabold text-amber-300 flex items-center justify-between">
                          <span>#{goal.rank}</span>
                          {isSelected && <span className="text-emerald-300">●</span>}
                        </div>
                        <div className="text-[11px] font-semibold truncate">{goal.title}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 flex-1 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-400/15 border border-amber-400/50 text-amber-300 flex items-center justify-center">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">Top 5 Mejores Goles sin configurar</div>
                <div className="text-xs text-zinc-300 mt-1 max-w-sm">
                  El Administrador puede elegir los 5 mejores goles desde su perfil para mostrarlos aquí con rotación cada 6 segundos.
                </div>
              </div>
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => onNavigate('perfil', 'videos')}
                  className="px-4 py-2 text-xs btn-gold-luxury rounded-lg"
                >
                  Elegir los 5 Mejores Goles
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 4-Column Transparent Gold, Black, Celeste & White KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 glass-lma-card border border-amber-400/35 rounded-xl">
          <div className="text-xs font-medium text-sky-200/85">Equipos Inscriptos</div>
          <div className="mt-1 font-display text-3xl font-bold text-lma-title tabular-nums">
            {teams.length} / {settings.maxTeams}
          </div>
          <div className="mt-1 text-xs text-amber-300 font-medium">Cupos de Primera División</div>
        </div>

        <div className="p-5 glass-lma-card border border-amber-400/35 rounded-xl">
          <div className="text-xs font-medium text-sky-200/85">Partidos Oficiales</div>
          <div className="mt-1 font-display text-3xl font-bold text-lma-title tabular-nums">
            {matches.filter((m) => m.status === 'validated').length}
          </div>
          <div className="mt-1 text-xs text-sky-300 font-medium">Validados por Admin</div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('calendario')}
          className="p-5 glass-lma-card border border-sky-400/45 hover:border-amber-400/80 rounded-xl text-left transition-colors"
        >
          <div className="text-xs font-medium text-sky-200/85">Calendario & Copa</div>
          <div className="mt-1 font-display text-3xl font-bold text-lma-title tabular-nums">
            {totalCalendarCount}
          </div>
          <div className="mt-1 text-xs text-sky-300 font-medium">
            {cupScheduledCount > 0
              ? `${cupScheduledCount} fechas de Copa agendadas →`
              : 'Ver calendario en vivo →'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('partidos', pendingCount > 0 ? 'pending' : 'validated')}
          className="p-5 glass-lma-card border border-amber-400/40 hover:border-amber-300 rounded-xl text-left transition-colors"
        >
          <div className="text-xs font-medium text-sky-200/85">En Cola de Revisión</div>
          <div className="mt-1 font-display text-3xl font-bold text-lma-title tabular-nums">
            {pendingCount}
          </div>
          <div className="mt-1 text-xs text-amber-300 font-medium">
            {user?.role === 'admin' && pendingCount > 0
              ? 'Ir a validar resultados →'
              : 'Esperando validación'}
          </div>
        </button>
      </section>

      {/* Row 1: Top 5 Standings + Recent Matches */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 glass-lma-card border border-amber-400/40 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-400/30 flex items-center justify-between bg-gradient-to-r from-black/60 via-[#092448]/55 to-black/60">
            <div>
              <h2 className="font-display text-2xl font-bold text-lma-title">
                {getTitleText(settings, 'homeLeadersTitle')}
              </h2>
              <p className="text-xs text-sky-100/80">
                {getTitleText(settings, 'homeLeadersSubtitle')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('posiciones')}
              className="text-xs font-semibold text-amber-300 hover:text-amber-200 transition-colors whitespace-nowrap"
            >
              Ver los {teams.length} equipos →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700/70 text-xs font-semibold text-zinc-300 bg-[#06070A]">
                  <th className="py-3 pl-6 pr-2 text-left w-10">#</th>
                  <th className="py-3 px-3 text-left">Club</th>
                  <th className="py-3 px-2 text-right">PJ</th>
                  <th className="py-3 px-2 text-right">DG</th>
                  <th className="py-3 pl-2 pr-6 text-right text-amber-300">PTS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {topFive.map((row) => (
                  <tr key={row.team.id} className="hover:bg-white/[0.04] transition-colors">
                    <td className="py-3 pl-6 pr-2 font-mono text-xs font-bold text-amber-300 tabular-nums">
                      {row.position}
                    </td>
                    <td className="py-3 px-3">
                      <button
                        type="button"
                        onClick={() => onViewParticipant(row.team.id)}
                        title={`Ver perfil público de ${row.team.name}`}
                        className="flex items-center gap-3 min-w-0 text-left group w-full"
                      >
                        <ResilientImage
                          src={row.team.crestUrl}
                          alt={`Escudo ${row.team.name}`}
                          className="w-8 h-8 rounded-md object-contain bg-[#06070A] border border-zinc-400/40 p-0.5 shrink-0"
                          fallbackLabel={row.team.id}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-white group-hover:text-amber-300 transition-colors truncate">
                            {row.team.name}
                          </div>
                          <div className="text-xs text-zinc-400 truncate">
                            DT: {row.team.memberName}
                          </div>
                        </div>
                      </button>
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-zinc-200 tabular-nums">
                      {row.pj}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-zinc-200 tabular-nums">
                      {row.dg > 0 ? `+${row.dg}` : row.dg}
                    </td>
                    <td className="py-3 pl-2 pr-6 text-right font-mono font-bold text-amber-300 tabular-nums">
                      {row.pts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 glass-lma-card border border-amber-400/40 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-400/30 flex items-center justify-between bg-gradient-to-r from-black/60 via-[#092448]/55 to-black/60">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-amber-300" />
              <h2 className="font-display text-2xl font-bold text-lma-title">
                {getTitleText(settings, 'homeRecentMatchesTitle')}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('partidos')}
              className="text-xs font-semibold text-amber-300 hover:text-amber-200 transition-colors whitespace-nowrap"
            >
              Todos →
            </button>
          </div>

          <div className="divide-y divide-zinc-800/80">
            {validatedMatches.length === 0 ? (
              <div className="p-6 text-sm text-zinc-400">
                Todavía no hay resultados oficiales publicados.
              </div>
            ) : (
              validatedMatches.map((m) => {
                const home = teamMap.get(m.homeTeamId);
                const away = teamMap.get(m.awayTeamId);
                return (
                  <div key={m.id} className="px-6 py-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <ResilientImage
                        src={home?.crestUrl}
                        alt={home?.name || m.homeTeamId}
                        className="w-6 h-6 object-contain shrink-0"
                      />
                      <span className="text-sm font-semibold text-white truncate">
                        {home?.name || m.homeTeamId}
                      </span>
                    </div>

                    <div className="px-3 py-1 rounded-lg bg-[#06070A] border border-amber-400/50 text-amber-300 font-mono text-sm font-bold tabular-nums shrink-0">
                      {m.homeGoals} - {m.awayGoals}
                    </div>

                    <div className="flex items-center justify-end gap-2 min-w-0 flex-1">
                      <span className="text-sm font-semibold text-white truncate text-right">
                        {away?.name || m.awayTeamId}
                      </span>
                      <ResilientImage
                        src={away?.crestUrl}
                        alt={away?.name || m.awayTeamId}
                        className="w-6 h-6 object-contain shrink-0"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* Row 2: Cuadro Completo de Copa de la Liga + Recopa abajo (ancho completo, sin barra de desplazamiento) */}
      <section className="w-full">
        <CupBracketCard
          cup={cup}
          teams={teams}
          matches={matches}
          settings={settings}
          isAdmin={user?.role === 'admin'}
          onEditCup={() => onNavigate('perfil', 'copa')}
          onGoToChampionsUpload={() => onNavigate('galeria', 'campeones')}
          onGoToRules={() => onNavigate('reglamento')}
          onRefresh={onRefresh}
        />
      </section>

      {/* Comentarios de la Liga (Moderados exclusivamente por el Administrador) */}
      <section className="glass-lma-card border border-amber-400/45 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-amber-400/30 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-black/60 via-[#092448]/55 to-black/60">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-5 h-5 text-sky-400 shrink-0" />
            <div>
              <h2 className="font-display text-2xl font-bold text-lma-title">
                {getTitleText(settings, 'homeCommentsTitle')}
              </h2>
              <p className="text-xs text-sky-100/80">
                {getTitleText(settings, 'homeCommentsSubtitle')}
              </p>
            </div>
          </div>
          {user?.role === 'admin' && pendingComments.length > 0 && (
            <span className="px-3 py-1 rounded-lg bg-amber-400/20 border border-amber-400/60 text-xs font-bold text-amber-200">
              {pendingComments.length} pendiente{pendingComments.length === 1 ? '' : 's'} de aprobar
            </span>
          )}
        </div>

        <div className="p-6 space-y-6">
          <form onSubmit={handleSubmitComment} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <input
                type="text"
                value={commentAuthor}
                onChange={(e) => setCommentAuthor(e.target.value)}
                placeholder={
                  user ? `Tu nombre (${user.displayName})` : 'Tu nombre o apodo (opcional)'
                }
                maxLength={60}
                className="sm:col-span-4 px-3.5 py-2.5 text-sm bg-[#06070A] text-white border border-zinc-500/45 rounded-xl focus:outline-none focus:border-amber-400"
              />
              <div className="sm:col-span-8 flex gap-2">
                <input
                  type="text"
                  required
                  value={commentMessage}
                  onChange={(e) => setCommentMessage(e.target.value)}
                  placeholder="Escribí un comentario sobre la liga, fechas o copa..."
                  maxLength={600}
                  className="flex-1 px-3.5 py-2.5 text-sm bg-[#06070A] text-white border border-zinc-500/45 rounded-xl focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={submittingComment}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold btn-gold-luxury disabled:opacity-50 rounded-xl whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submittingComment ? 'Enviando...' : 'Enviar'}</span>
                </button>
              </div>
            </div>

            {commentFeedback && (
              <div
                className={`text-xs font-semibold px-3.5 py-2 rounded-lg border ${
                  commentFeedback.type === 'ok'
                    ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                    : 'bg-rose-500/15 border-rose-400/50 text-rose-200'
                }`}
              >
                {commentFeedback.text}
              </div>
            )}
          </form>

          {/* Cola pendiente visible SOLO para el Administrador */}
          {user?.role === 'admin' && pendingComments.length > 0 && (
            <div className="space-y-2.5 p-4 rounded-xl bg-amber-950/35 border border-amber-400/50">
              <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                Mensajes esperando tu aprobación (Solo visible para el Admin)
              </div>
              <div className="space-y-2">
                {pendingComments.map((c) => (
                  <div
                    key={c.id}
                    className="p-3 rounded-xl bg-[#07090E] border border-amber-400/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-amber-200">{c.authorName}</span>
                        {c.authorTeamName && (
                          <span className="text-sky-300">· {c.authorTeamName}</span>
                        )}
                        <span className="text-zinc-500 font-mono text-[11px]">
                          {new Date(c.createdAt).toLocaleString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-100 break-words">{c.message}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={moderatingCommentId === c.id}
                        onClick={() => handleApproveComment(c.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Aprobar</span>
                      </button>
                      <button
                        type="button"
                        disabled={moderatingCommentId === c.id}
                        onClick={() => handleDeleteComment(c.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-rose-200 bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/40 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comentarios aprobados públicos */}
          {approvedComments.length === 0 ? (
            <div className="p-5 rounded-xl bg-[#07090E] border border-zinc-800 text-center text-xs text-zinc-400">
              Todavía no hay comentarios aprobados. ¡Sé el primero en dejar tu mensaje!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {approvedComments.map((c) => (
                <div
                  key={c.id}
                  className="p-4 rounded-xl bg-[#07090E] border border-zinc-700/60 flex flex-col justify-between gap-2"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-bold text-amber-300 truncate">{c.authorName}</span>
                        {c.authorTeamName && (
                          <span className="text-sky-300 truncate">· {c.authorTeamName}</span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                        {new Date(c.createdAt).toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-100 leading-relaxed break-words">{c.message}</p>
                  </div>
                  {user?.role === 'admin' && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={moderatingCommentId === c.id}
                        onClick={() => handleDeleteComment(c.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="p-6 glass-lma-card border border-amber-400/40 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-sky-300 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-display text-lg font-bold text-lma-title">
              Resultados Validados por el Administrador
            </h3>
            <p className="text-xs text-sky-100/85 mt-0.5">
              Los miembros cargan sus partidos con foto del resultado y del goleador; el Administrador valida y verifica cada archivo antes de publicarlo en la tabla oficial.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('perfil')}
          className="px-4 py-2 text-xs btn-celeste-gold rounded-lg transition-all whitespace-nowrap shrink-0"
        >
          Mi Perfil / Acceso
        </button>
      </section>

      {/* Redes Sociales Oficiales (Facebook Luz Azul · YouTube Luz Roja · WhatsApp Luz Verde) */}
      <section className="p-6 glass-lma-card border border-amber-400/45 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-5">
        <div className="text-center md:text-left">
          <h3 className="font-display text-2xl sm:text-3xl font-extrabold text-lma-title">
            {getTitleText(settings, 'homeSocialTitle')}
          </h3>
          <p className="text-xs text-sky-100/85 mt-1">
            Sumate al grupo oficial, mirá los mejores resúmenes y enterate de todas las fechas.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3.5 shrink-0">
          <a
            href="https://www.facebook.com/profile.php?id=61592685431765"
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={() => triggerSocialLit('facebook')}
            onClick={() => triggerSocialLit('facebook')}
            aria-label="Facebook oficial Liga Master Argentina"
            className={`group inline-flex items-center gap-2.5 px-5 py-3 rounded-xl text-white text-xs sm:text-sm font-extrabold social-glow-facebook ${
              litSocial === 'facebook' ? 'is-lit' : ''
            }`}
          >
            <span className="w-7 h-7 rounded-lg bg-[#1877F2]/30 border border-sky-300/60 flex items-center justify-center shadow-inner">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#60A5FA]" aria-hidden="true">
                <path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.593 1.323-1.325V1.325C24 .593 23.407 0 22.675 0z" />
              </svg>
            </span>
            <span className="tracking-wide">Facebook</span>
          </a>

          <a
            href="https://www.youtube.com/channel/UClCVRB-u2ZNJJdIXTyi7DjQ"
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={() => triggerSocialLit('youtube')}
            onClick={() => triggerSocialLit('youtube')}
            aria-label="YouTube oficial Liga Master Argentina"
            className={`group inline-flex items-center gap-2.5 px-5 py-3 rounded-xl text-white text-xs sm:text-sm font-extrabold social-glow-youtube ${
              litSocial === 'youtube' ? 'is-lit' : ''
            }`}
          >
            <span className="w-7 h-7 rounded-lg bg-[#FF0000]/30 border border-rose-300/60 flex items-center justify-center shadow-inner">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#F87171]" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </span>
            <span className="tracking-wide">YouTube</span>
          </a>

          <a
            href="https://chat.whatsapp.com/IA8EyaupDRIKXpLJiTeF8X?s=cl&p=a&iam=2"
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={() => triggerSocialLit('whatsapp')}
            onClick={() => triggerSocialLit('whatsapp')}
            aria-label="Grupo oficial WhatsApp Liga Master Argentina"
            className={`group inline-flex items-center gap-2.5 px-5 py-3 rounded-xl text-white text-xs sm:text-sm font-extrabold social-glow-whatsapp ${
              litSocial === 'whatsapp' ? 'is-lit' : ''
            }`}
          >
            <span className="w-7 h-7 rounded-lg bg-[#25D366]/30 border border-emerald-300/60 flex items-center justify-center shadow-inner">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#4ADE80]" aria-hidden="true">
                <path d="M20.52 3.48A11.87 11.87 0 0 0 12.05 0C5.5 0 .16 5.33.16 11.89c0 2.1.55 4.14 1.59 5.95L0 24l6.33-1.66a11.88 11.88 0 0 0 5.71 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.17-1.24-6.16-3.42-8.41zM12.05 21.78h-.01a9.86 9.86 0 0 1-5.02-1.37l-.36-.21-3.75.98 1-3.66-.23-.38a9.87 9.87 0 0 1-1.51-5.25c0-5.46 4.44-9.9 9.9-9.9 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.9 7c0 5.45-4.45 9.89-9.91 9.89zm5.43-7.41c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.48-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.08-.8.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.21 5.09 4.5.71.31 1.27.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35z" />
              </svg>
            </span>
            <span className="tracking-wide">WhatsApp</span>
          </a>
        </div>
      </section>
      {/* Modal Grande de Noticia con Minimizar, Cerrar y Me Gusta */}
      {maximizedNews && !newsModalMinimized && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={maximizedNews.title || 'Noticia ampliada'}
          onClick={() => setMaximizedNewsId(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl glass-lma-card border-2 border-amber-400/70"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1.5 w-full albiceleste-ribbon" aria-hidden="true" />
            <div className="sticky top-0 z-10 px-5 py-4 bg-gradient-to-r from-black/75 via-[#092448]/70 to-black/75 backdrop-blur-md border-b border-amber-400/35 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Megaphone className="w-5 h-5 text-sky-300 shrink-0" />
                <span className="font-display text-xl sm:text-2xl font-bold text-lma-title truncate">
                  {maximizedNews.isChampionNewspaper
                    ? `Edición Especial · ${maximizedNews.championTeamName || maximizedNews.title}`
                    : maximizedNews.title}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={likingNewsId === maximizedNews.id}
                  onClick={() => void handleLikeNewsClick(maximizedNews.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all whitespace-nowrap ${
                    likedNews[maximizedNews.id]
                      ? 'bg-rose-500/25 border-rose-400/80 text-rose-100'
                      : 'bg-[#141720] hover:bg-rose-500/20 border-rose-400/50 text-white'
                  }`}
                >
                  <Heart
                    className={`w-4 h-4 ${
                      likedNews[maximizedNews.id]
                        ? 'fill-rose-500 text-rose-400'
                        : 'text-rose-400'
                    }`}
                  />
                  <span>Me Gusta</span>
                  <span className="px-1.5 py-0.5 rounded bg-black/55 font-mono text-rose-200 tabular-nums">
                    {maximizedNews.likes || 0}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setNewsModalMinimized(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-200 bg-[#141822] hover:bg-amber-400/15 border border-amber-400/45 rounded-lg whitespace-nowrap"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Minimizar</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMaximizedNewsId(null);
                    setNewsModalMinimized(false);
                  }}
                  aria-label="Cerrar noticia"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-zinc-100 bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/45 rounded-lg whitespace-nowrap"
                >
                  <X className="w-4 h-4" />
                  <span>Cerrar</span>
                </button>
              </div>
            </div>

            <div className="p-5 sm:p-7 space-y-5">
              {maximizedNews.isChampionNewspaper ? (
                <div className="rounded-xl overflow-hidden border-2 border-amber-400/80 bg-[#F5EFE0] text-zinc-950 shadow-xl">
                  <div className="px-5 py-3 bg-zinc-950 text-amber-300 border-b-2 border-amber-400 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Newspaper className="w-5 h-5 text-amber-400 shrink-0" />
                      <span className="font-display text-sm sm:text-base font-extrabold tracking-[0.18em] uppercase">
                        DIARIO LIGA MASTER · EDICIÓN CAMPEÓN
                      </span>
                    </div>
                    <span className="text-xs font-mono text-zinc-300">
                      {new Date(maximizedNews.createdAt).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </span>
                  </div>

                  <div className="px-6 py-5 border-b border-zinc-900/20 text-center space-y-2">
                    <div className="text-xs sm:text-sm font-extrabold uppercase tracking-[0.22em] text-emerald-800">
                      ★ {maximizedNews.championTournament || 'Campeón Oficial'} ·{' '}
                      {maximizedNews.championSeason || settings.subtitle} ★
                    </div>
                    <h3 className="font-display text-3xl sm:text-5xl font-black uppercase leading-none text-zinc-950">
                      ¡{maximizedNews.championTeamName || maximizedNews.title} CAMPEÓN!
                    </h3>
                    <div className="inline-block px-4 py-1 rounded bg-zinc-950 text-amber-300 text-xs sm:text-sm font-extrabold tracking-wide">
                      DT CAMPEÓN: {maximizedNews.championMemberName || 'Miembro Oficial'}
                    </div>
                  </div>

                  <div className="p-5 bg-[#EFE6D2] grid grid-cols-1 md:grid-cols-12 gap-4 items-center border-b border-zinc-900/15">
                    <div className="md:col-span-4 flex flex-col items-center justify-center p-4 rounded-xl bg-zinc-950 border border-amber-400/70">
                      <ResilientImage
                        src={maximizedNews.championCrestUrl}
                        alt={`Escudo ${maximizedNews.championTeamName || 'Campeón'}`}
                        className="w-28 h-28 object-contain"
                        fallbackLabel={maximizedNews.championTeamName || 'LMA'}
                      />
                      <span className="mt-2 text-xs font-bold text-amber-300 text-center">
                        {maximizedNews.championTeamName}
                      </span>
                    </div>
                    <div className="md:col-span-8 relative rounded-xl overflow-hidden border-2 border-zinc-950 bg-zinc-950 flex items-center justify-center">
                      <ResilientImage
                        src={maximizedNews.celebrationImageUrl || maximizedNews.imageUrl}
                        fallbackSrc={defaultChampImg}
                        alt={`Celebración ${maximizedNews.championTeamName || 'Campeón'}`}
                        className="w-full max-h-[55vh] object-contain mx-auto"
                        fallbackLabel="¡CAMPEÓN!"
                      />
                    </div>
                  </div>

                  <div className="p-5 sm:p-6 text-sm sm:text-base leading-relaxed text-zinc-900 font-medium whitespace-pre-line">
                    {maximizedNews.content}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-zinc-400">
                    <span>
                      Publicado el{' '}
                      {new Date(maximizedNews.createdAt).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <h3
                    className="font-display text-3xl sm:text-4xl font-extrabold leading-tight"
                    style={{ color: maximizedNews.textColor || '#FACC15' }}
                  >
                    {maximizedNews.title}
                  </h3>

                  {maximizedNews.content && (
                    <p
                      className="text-base sm:text-lg leading-relaxed whitespace-pre-line"
                      style={{ color: maximizedNews.textColor || '#F8FAFC' }}
                    >
                      {maximizedNews.content}
                    </p>
                  )}

                  {maximizedNews.imageUrl && (
                    <div className="rounded-xl overflow-hidden border border-zinc-700/70 bg-black">
                      <ResilientImage
                        src={maximizedNews.imageUrl}
                        alt={maximizedNews.title}
                        className="w-full max-h-[60vh] object-contain mx-auto"
                        fallbackLabel={maximizedNews.title}
                      />
                    </div>
                  )}

                  {maximizedNews.videoUrl && (
                    <div className="rounded-xl overflow-hidden border border-zinc-700/70 bg-black">
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        src={resolveAssetUrl(maximizedNews.videoUrl)}
                        className="w-full max-h-[60vh] object-contain"
                      >
                        <source src={resolveAssetUrl(maximizedNews.videoUrl)} type="video/mp4" />
                      </video>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barra compacta cuando la noticia está minimizada */}
      {maximizedNews && newsModalMinimized && (
        <div className="fixed bottom-4 left-4 z-40 max-w-[300px] sm:max-w-sm rounded-xl glass-lma-card border-2 border-amber-400/70 shadow-2xl px-3.5 py-2.5 flex items-center gap-2.5">
          <Megaphone className="w-4 h-4 text-sky-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold text-sky-300 uppercase tracking-wider">
              Noticia minimizada
            </div>
            <div className="text-xs font-bold text-white truncate">
              {maximizedNews.isChampionNewspaper
                ? `¡${maximizedNews.championTeamName || maximizedNews.title} Campeón!`
                : maximizedNews.title}
            </div>
          </div>
          <button
            type="button"
            disabled={likingNewsId === maximizedNews.id}
            onClick={() => void handleLikeNewsClick(maximizedNews.id)}
            title="Me Gusta"
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-md bg-rose-500/20 border border-rose-400/50 text-rose-200 shrink-0"
          >
            <Heart
              className={`w-3.5 h-3.5 ${
                likedNews[maximizedNews.id] ? 'fill-rose-500 text-rose-400' : 'text-rose-400'
              }`}
            />
            <span className="font-mono">{maximizedNews.likes || 0}</span>
          </button>
          <button
            type="button"
            onClick={() => setNewsModalMinimized(false)}
            aria-label="Restaurar noticia"
            title="Maximizar noticia"
            className="p-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-400/50 text-sky-200 shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMaximizedNewsId(null);
              setNewsModalMinimized(false);
            }}
            aria-label="Cerrar noticia minimizada"
            title="Cerrar noticia"
            className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/35 border border-rose-400/45 text-rose-200 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
