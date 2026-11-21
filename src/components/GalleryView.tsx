import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  CloudUpload,
  Download,
  Film,
  Loader2,
  Star,
  Trash2,
  Trophy,
  Upload,
} from 'lucide-react';
import defaultChampImg from '../assets/images/champion_celebration_default_1794642902876.jpg';
import { resolveAssetUrl } from '../utils/assetUrl';
import {
  createChampionFirestore,
  deleteChampionFirestore,
  deleteCommunityVideoFirestore,
  deleteOfficialVideoFirestore,
  publishCommunityVideoFirestore,
  saveFeaturedVideoFirestore,
  toggleFeaturedOfficialVideoFirestore,
} from '../services/firestoreLeague';
import type {
  AuthUser,
  ChampionEntry,
  CommunityVideo,
  GalleryVideo,
  LeagueSettings,
} from '../types';
import { uploadMediaFile } from '../utils/api';
import { getTitleText } from '../utils/customTitles';
import { ResilientImage } from './ResilientImage';

const UPLOADCARE_PUBLIC_KEY = '2263e409db23d5990fee';
const UPLOADCARE_SCRIPT_URL = 'https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js';

interface UploadcareFileInfo {
  cdnUrl?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

interface UploadcareFilePromise {
  done: (cb: (info: UploadcareFileInfo) => void) => UploadcareFilePromise;
  fail: (cb: (err: unknown) => void) => UploadcareFilePromise;
}

interface UploadcareDialog {
  done: (cb: (file: UploadcareFilePromise) => void) => UploadcareDialog;
  fail: (cb: (err: unknown) => void) => UploadcareDialog;
}

interface UploadcareApi {
  openDialog: (
    file: unknown,
    settings: {
      publicKey: string;
      multiple?: boolean;
      tabs?: string;
      inputAcceptTypes?: string;
      validators?: Array<(info: UploadcareFileInfo) => void>;
    }
  ) => UploadcareDialog;
}

declare global {
  interface Window {
    UPLOADCARE_PUBLIC_KEY?: string;
    UPLOADCARE_LOCALE?: string;
    uploadcare?: UploadcareApi;
  }
}

interface GalleryViewProps {
  videos: GalleryVideo[];
  communityVideos: CommunityVideo[];
  loadingCommunity: boolean;
  firestoreError: string | null;
  featuredVideoId?: string;
  champions: ChampionEntry[];
  settings?: LeagueSettings;
  user: AuthUser | null;
  initialSubTab?: 'videos' | 'campeones';
  onOpenAuth: () => void;
  onRefresh: () => Promise<void>;
}

function ensureUploadcareLoaded(): Promise<UploadcareApi> {
  if (typeof window !== 'undefined' && window.uploadcare) {
    return Promise.resolve(window.uploadcare);
  }
  return new Promise((resolve, reject) => {
    window.UPLOADCARE_PUBLIC_KEY = UPLOADCARE_PUBLIC_KEY;
    window.UPLOADCARE_LOCALE = 'es';

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${UPLOADCARE_SCRIPT_URL}"]`
    );
    if (existing) {
      const checkInterval = window.setInterval(() => {
        if (window.uploadcare) {
          window.clearInterval(checkInterval);
          resolve(window.uploadcare);
        }
      }, 100);
      window.setTimeout(() => {
        window.clearInterval(checkInterval);
        if (window.uploadcare) {
          resolve(window.uploadcare);
        } else {
          reject(new Error('No se pudo cargar el widget de Uploadcare.'));
        }
      }, 10000);
      return;
    }

    const script = document.createElement('script');
    script.src = UPLOADCARE_SCRIPT_URL;
    script.async = true;
    script.charset = 'utf-8';
    script.onload = () => {
      if (window.uploadcare) {
        resolve(window.uploadcare);
      } else {
        reject(new Error('Uploadcare se cargó pero no quedó inicializado.'));
      }
    };
    script.onerror = () => reject(new Error('Error de red al cargar Uploadcare.'));
    document.head.appendChild(script);
  });
}

function normalizeMp4VideoUrl(cdnUrl: string): string {
  return cdnUrl.trim();
}

export function GalleryView({
  videos,
  communityVideos,
  loadingCommunity,
  firestoreError,
  featuredVideoId,
  champions,
  settings,
  user,
  initialSubTab = 'videos',
  onOpenAuth,
  onRefresh,
}: GalleryViewProps) {
  const [subTab, setSubTab] = useState<'videos' | 'campeones'>(initialSubTab);

  const [autor, setAutor] = useState(user?.displayName || '');
  const [titulo, setTitulo] = useState('');
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [openingWidget, setOpeningWidget] = useState(false);
  const [publishingVideo, setPublishingVideo] = useState(false);
  const [featuringId, setFeaturingId] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoSuccess, setVideoSuccess] = useState<string | null>(null);

  // Champions state
  const [season, setSeason] = useState('');
  const [teamName, setTeamName] = useState('');
  const [memberName, setMemberName] = useState('');
  const [tournamentType, setTournamentType] = useState<'liga' | 'copa' | 'recopa'>('liga');
  const [champNotes, setChampNotes] = useState('');
  const [champFile, setChampFile] = useState<File | null>(null);
  const champInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingChamp, setUploadingChamp] = useState(false);
  const [champError, setChampError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.displayName && !autor.trim()) {
      setAutor(user.displayName);
    }
  }, [user?.displayName]);

  const handleOpenUploadcare = async () => {
    setVideoError(null);
    setVideoSuccess(null);
    setOpeningWidget(true);
    try {
      const uc = await ensureUploadcareLoaded();
      const dialog = uc.openDialog(null, {
        publicKey: UPLOADCARE_PUBLIC_KEY,
        multiple: false,
        tabs: 'file url',
        inputAcceptTypes: 'video/mp4,.mp4',
        validators: [
          (fileInfo) => {
            const name = (fileInfo.name || '').toLowerCase();
            const mime = (fileInfo.mimeType || '').toLowerCase();
            const isValid = name.endsWith('.mp4') || mime === 'video/mp4';
            if (!isValid) {
              throw new Error('Solo se permiten videos en formato .MP4 en toda la página.');
            }
          },
        ],
      });

      dialog.done((filePromise) => {
        filePromise.done((fileInfo) => {
          if (!fileInfo.cdnUrl) {
            setVideoError('Uploadcare no devolvió una URL válida.');
            return;
          }
          const name = (fileInfo.name || '').toLowerCase();
          const mime = (fileInfo.mimeType || '').toLowerCase();
          if (name && !name.endsWith('.mp4') && mime !== 'video/mp4') {
            setVideoError('Formato no admitido: únicamente se aceptan videos en formato .MP4.');
            return;
          }
          const videoUrl = normalizeMp4VideoUrl(fileInfo.cdnUrl);
          setUploadedVideoUrl(videoUrl);
          setUploadedFileName(fileInfo.name || 'video.mp4');
          if (!titulo.trim() && fileInfo.name) {
            setTitulo(fileInfo.name.replace(/\.[^/.]+$/, ''));
          }
        });
        filePromise.fail(() => {
          setVideoError('No se pudo completar la subida del video en Uploadcare.');
        });
      });
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'Error abriendo Uploadcare.');
    } finally {
      setOpeningWidget(false);
    }
  };

  const handlePublishVideo = async (e: FormEvent) => {
    e.preventDefault();
    const cleanAutor = autor.trim();
    const cleanTitulo = titulo.trim();

    if (!cleanAutor) {
      setVideoError('Escribí el nombre del miembro.');
      return;
    }
    if (!cleanTitulo) {
      setVideoError('Escribí un título para el video.');
      return;
    }
    if (!uploadedVideoUrl) {
      setVideoError('Primero subí tu archivo .MP4 usando el botón de Uploadcare.');
      return;
    }

    setVideoError(null);
    setVideoSuccess(null);
    setPublishingVideo(true);

    try {
      await publishCommunityVideoFirestore({
        titulo: cleanTitulo,
        autor: cleanAutor,
        videoUrl: uploadedVideoUrl,
      });
      setTitulo('');
      setUploadedVideoUrl('');
      setUploadedFileName('');
      setVideoSuccess('¡Video publicado! Ya está disponible para toda la comunidad.');
      window.setTimeout(() => setVideoSuccess(null), 5000);
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'No se pudo publicar el video.');
    } finally {
      setPublishingVideo(false);
    }
  };

  const handleFeatureCommunityVideo = async (video: CommunityVideo) => {
    setVideoError(null);
    setFeaturingId(video.id);
    try {
      await saveFeaturedVideoFirestore({
        id: video.id,
        source: 'community',
        title: video.titulo,
        author: video.autor,
        videoUrl: video.videoUrl,
        downloadUrl: video.videoUrl,
        fechaLabel: video.fechaLabel,
      });
      await onRefresh();
      setVideoSuccess(`"${video.titulo}" ahora es el Video Destacado en la página de Inicio.`);
      window.setTimeout(() => setVideoSuccess(null), 4000);
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'No se pudo destacar el video.');
    } finally {
      setFeaturingId(null);
    }
  };

  const handleDeleteCommunityVideo = async (id: string) => {
    try {
      await deleteCommunityVideoFirestore(id, featuredVideoId);
      await onRefresh();
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'No se pudo eliminar el video.');
    }
  };

  const handleUploadChampion = async (e: FormEvent) => {
    e.preventDefault();
    if (!champFile) {
      setChampError('Subí una imagen en formato PNG de los festejos.');
      return;
    }
    setChampError(null);
    setUploadingChamp(true);
    try {
      const celebrationImageUrl = await uploadMediaFile('champions', champFile);
      await createChampionFirestore({
        season,
        teamName,
        memberName,
        tournamentType,
        notes: champNotes,
        celebrationImageUrl,
      });
      setSeason('');
      setTeamName('');
      setMemberName('');
      setTournamentType('liga');
      setChampNotes('');
      setChampFile(null);
      if (champInputRef.current) champInputRef.current.value = '';
      await onRefresh();
    } catch (err) {
      setChampError(err instanceof Error ? err.message : 'Error guardando el campeón.');
    } finally {
      setUploadingChamp(false);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    try {
      await deleteOfficialVideoFirestore(id);
      await onRefresh();
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'No se pudo eliminar el video.');
    }
  };

  const handleFeatureVideo = async (id: string) => {
    const vid = videos.find((v) => v.id === id);
    if (!vid) return;
    try {
      await toggleFeaturedOfficialVideoFirestore(vid, videos);
      await onRefresh();
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'No se pudo destacar el video.');
    }
  };

  const handleDeleteChampion = async (id: string) => {
    try {
      await deleteChampionFirestore(id);
      await onRefresh();
    } catch (err) {
      setChampError(err instanceof Error ? err.message : 'No se pudo eliminar el campeón.');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-albiceleste-shiny">
            {getTitleText(settings, 'galleryTitle')}
          </h1>
          <p className="mt-1 text-sm text-sky-200/85">
            {getTitleText(settings, 'gallerySubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#071D38] border border-amber-400/50 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setSubTab('videos')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              subTab === 'videos'
                ? 'btn-gold-luxury'
                : 'text-sky-100 hover:text-amber-300'
            }`}
          >
            <Film className="w-4 h-4" />
            <span>Videos Comunidad ({communityVideos.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('campeones')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              subTab === 'campeones'
                ? 'btn-gold-luxury'
                : 'text-sky-100 hover:text-amber-300'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>{getTitleText(settings, 'homeChampionsTitle')}</span>
          </button>
        </div>
      </div>

      {subTab === 'videos' ? (
        <div className="space-y-8">
          {/* Formulario público de publicación con Uploadcare + Firestore */}
          <div className="p-6 bg-[#071D38]/95 border-2 border-amber-400/55 rounded-2xl shadow-xl shadow-black/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
                  Publicar Video de la Comunidad (Solo .MP4)
                </h2>
                <p className="text-xs text-sky-200/80">
                  Cualquier miembro puede subir un video exclusivamente en formato .MP4. El Administrador puede destacar o eliminar publicaciones.
                </p>
              </div>
              {!user && (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-3.5 py-2 text-xs btn-celeste-gold rounded-lg transition-all whitespace-nowrap self-start sm:self-auto"
                >
                  Ingresar con ID (opcional)
                </button>
              )}
            </div>

            <form onSubmit={handlePublishVideo} className="grid grid-cols-1 md:grid-cols-12 gap-4">
              {videoError && (
                <div className="md:col-span-12 p-3 text-sm text-rose-200 bg-rose-950/60 border border-rose-400/40 rounded-lg">
                  {videoError}
                </div>
              )}
              {videoSuccess && (
                <div className="md:col-span-12 p-3 text-sm text-emerald-200 bg-emerald-950/60 border border-emerald-400/40 rounded-lg">
                  {videoSuccess}
                </div>
              )}

              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-sky-200 mb-1">
                  Nombre del miembro
                </label>
                <input
                  type="text"
                  required
                  value={autor}
                  onChange={(e) => setAutor(e.target.value)}
                  placeholder="Ej: Canalla_10 (Rosario Central)"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-sky-200 mb-1">
                  Título del video
                </label>
                <input
                  type="text"
                  required
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ej: Golazo de tiro libre Fecha 5"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div className="md:col-span-4 flex flex-col justify-end">
                <label className="block text-xs font-semibold text-sky-200 mb-1">
                  Archivo de video (Solo .MP4)
                </label>
                <button
                  type="button"
                  onClick={handleOpenUploadcare}
                  disabled={openingWidget}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm btn-celeste-gold rounded-lg transition-all"
                >
                  {openingWidget ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4" />
                  )}
                  <span>
                    {uploadedVideoUrl ? 'Cambiar video .MP4 en Uploadcare' : 'Subir video .MP4 con Uploadcare'}
                  </span>
                </button>
              </div>

              {uploadedVideoUrl && (
                <div className="md:col-span-12 p-3.5 bg-[#05162B] border border-emerald-400/45 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-emerald-300">
                        Video .MP4 listo para publicar: {uploadedFileName}
                      </div>
                      <div className="text-[11px] font-mono text-sky-200/80 truncate">
                        {uploadedVideoUrl}
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-200 shrink-0">
                    Listo para publicar
                  </span>
                </div>
              )}

              <div className="md:col-span-12 flex justify-end">
                <button
                  type="submit"
                  disabled={publishingVideo || !uploadedVideoUrl}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm btn-gold-luxury disabled:opacity-50 rounded-xl"
                >
                  <Upload className="w-4 h-4" />
                  <span>{publishingVideo ? 'Publicando...' : 'Publicar video'}</span>
                </button>
              </div>
            </form>
          </div>

          {firestoreError && (
            <div className="p-4 text-sm text-rose-200 bg-rose-950/60 border border-rose-400/40 rounded-xl">
              {firestoreError}
            </div>
          )}

          {/* Reproductor en tiempo real para toda la comunidad */}
          {loadingCommunity ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="h-72 rounded-2xl bg-[#071D38]/80 border border-amber-400/30 animate-pulse" />
              <div className="h-72 rounded-2xl bg-[#071D38]/80 border border-amber-400/30 animate-pulse" />
            </div>
          ) : communityVideos.length === 0 ? (
            <div className="p-12 text-center bg-[#071D38]/95 border-2 border-amber-400/45 rounded-2xl">
              <Film className="w-8 h-8 text-sky-300/75 mx-auto mb-2" />
              <h3 className="font-display text-2xl font-bold text-albiceleste-shiny">
                Todavía no hay videos en la comunidad
              </h3>
              <p className="mt-1 text-sm text-sky-200/80">
                Subí el primer gol o jugada usando Uploadcare arriba y todos los visitantes podrán verlo en tiempo real.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {communityVideos.map((video) => {
                const isFeatured = featuredVideoId === video.id;
                return (
                  <article
                    key={video.id}
                    className={`bg-[#071D38]/95 rounded-2xl overflow-hidden flex flex-col border-2 ${
                      isFeatured ? 'border-amber-300 shadow-lg shadow-sky-500/20' : 'border-amber-400/45'
                    }`}
                  >
                    <div className="aspect-video bg-[#041224]">
                      <video
                        src={video.videoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="p-5 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        <div className="text-xs text-sky-200/80 flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-amber-300">{video.autor}</span>
                          <span aria-hidden="true">·</span>
                          <span>{video.fechaLabel}</span>
                          {isFeatured && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                                <Star className="w-3 h-3 fill-amber-300" />
                                <span>Destacado en Inicio</span>
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="mt-1 font-display text-xl font-bold text-albiceleste-shiny">
                          {video.titulo}
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber-400/25">
                        <a
                          href={video.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Abrir / Descargar video</span>
                        </a>

                        {user?.role === 'admin' && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={featuringId === video.id}
                              onClick={() => handleFeatureCommunityVideo(video)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                isFeatured
                                  ? 'bg-amber-300 text-zinc-950'
                                  : 'bg-[#05162B] text-amber-300 hover:bg-amber-300/20 border border-amber-400/45'
                              }`}
                            >
                              <Star className={`w-3.5 h-3.5 ${isFeatured ? 'fill-zinc-950' : ''}`} />
                              <span>
                                {featuringId === video.id
                                  ? 'Guardando...'
                                  : isFeatured
                                  ? 'Destacado en Inicio'
                                  : 'Elegir Favorito (Inicio)'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCommunityVideo(video.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Eliminar</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* Archivo de videos locales de la liga (preservado para Inicio / Admin) */}
          {videos.length > 0 && (
            <div className="pt-4 border-t border-amber-400/30 space-y-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
                  Videos Oficiales Destacados de la Liga
                </h2>
                <p className="text-xs text-sky-200/80">
                  Archivo oficial administrado de la liga (disponible para destacar en la portada de Inicio).
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {videos.map((video) => (
                  <article
                    key={video.id}
                    className="bg-[#071D38]/95 border-2 border-amber-400/45 rounded-2xl overflow-hidden flex flex-col"
                  >
                    <div className="aspect-video bg-[#041224]">
                      <video
                        key={video.videoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-contain"
                        src={resolveAssetUrl(video.videoUrl)}
                      >
                        <source src={resolveAssetUrl(video.videoUrl)} type="video/mp4" />
                        Tu navegador no soporta la reproducción directa.
                      </video>
                    </div>
                    <div className="p-5 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        <div className="text-xs text-sky-200/80 flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold text-amber-300">
                            {video.originalFormat}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Subido por {video.uploadedBy}</span>
                          {video.featured && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-amber-300">
                                Destacado en Inicio
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="mt-1 font-display text-xl font-bold text-albiceleste-shiny">
                          {video.title}
                        </h3>
                        {video.description && (
                          <p className="mt-1 text-sm text-sky-100/85">{video.description}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber-400/25">
                        <a
                          href={video.downloadUrl}
                          download
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Descargar original ({video.originalFormat})</span>
                        </a>

                        {user?.role === 'admin' && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleFeatureVideo(video.id)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                                video.featured
                                  ? 'bg-amber-300 text-zinc-950'
                                  : 'bg-[#05162B] text-amber-300 hover:bg-amber-300/20 border border-amber-400/45'
                              }`}
                            >
                              <Star className="w-3.5 h-3.5" />
                              <span>{video.featured ? 'Destacado en Inicio' : 'Poner en Inicio'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteVideo(video.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Eliminar</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="p-6 bg-[#071D38]/95 border-2 border-amber-400/55 rounded-2xl shadow-xl shadow-black/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
                  Agregar Festejo de Campeón (PNG)
                </h2>
                <p className="text-xs text-sky-200/80">
                  {user?.role === 'admin'
                    ? 'Registrá al campeón de Liga, Copa de la Liga o Recopa con su imagen PNG de festejos.'
                    : 'Solo el Administrador puede registrar y editar campeones oficiales en el historial.'}
                </p>
              </div>
              {!user && (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-4 py-2 text-xs btn-gold-luxury rounded-lg whitespace-nowrap"
                >
                  Ingresar como Admin
                </button>
              )}
            </div>

            {user?.role === 'admin' && (
              <form onSubmit={handleUploadChampion} className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {champError && (
                  <div className="md:col-span-12 p-3 text-sm text-rose-200 bg-rose-950/60 border border-rose-400/40 rounded-lg">
                    {champError}
                  </div>
                )}

                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                    Tipo de Título
                  </label>
                  <select
                    value={tournamentType}
                    onChange={(e) =>
                      setTournamentType(e.target.value as 'liga' | 'copa' | 'recopa')
                    }
                    className="w-full px-3.5 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                  >
                    <option value="liga">Campeón de Liga</option>
                    <option value="copa">Campeón de Copa de la Liga</option>
                    <option value="recopa">Gran Campeón (Recopa)</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                    Temporada / Edición de Copa
                  </label>
                  <input
                    type="text"
                    required
                    value={season}
                    onChange={(e) => setSeason(e.target.value)}
                    placeholder="Ej: 1° Edición — Copa de la Liga"
                    className="w-full px-3.5 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                    Equipo Campeón
                  </label>
                  <input
                    type="text"
                    required
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="Ej: Boca Juniors"
                    className="w-full px-3.5 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                    Nombre del Miembro
                  </label>
                  <input
                    type="text"
                    required
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    placeholder="Ej: ElPipa_10"
                    className="w-full px-3.5 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>

                <div className="md:col-span-4">
                  <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                    Imagen Festejos (.PNG)
                  </label>
                  <input
                    ref={champInputRef}
                    type="file"
                    required
                    accept=".png,image/png"
                    onChange={(e) => setChampFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-zinc-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-400/20 file:text-amber-300 hover:file:bg-amber-400/30"
                  />
                </div>

                <div className="md:col-span-5 flex items-end">
                  <input
                    type="text"
                    value={champNotes}
                    onChange={(e) => setChampNotes(e.target.value)}
                    placeholder="Mensaje o crónica del título (opcional)"
                    className="w-full px-3.5 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                  />
                </div>

                <div className="md:col-span-3 flex items-end justify-end">
                  <button
                    type="submit"
                    disabled={uploadingChamp}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-2 text-sm btn-gold-luxury disabled:opacity-60 rounded-lg"
                  >
                    <Trophy className="w-4 h-4" />
                    <span>{uploadingChamp ? 'Guardando...' : 'Publicar Campeón'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {champions.map((champ) => (
              <article
                key={champ.id}
                className="bg-[#071D38]/95 border-2 border-amber-400/55 rounded-2xl overflow-hidden flex flex-col shadow-xl shadow-black/50"
              >
                <div className="aspect-[4/3] bg-[#041224]">
                  <ResilientImage
                    src={champ.celebrationImageUrl}
                    fallbackSrc={defaultChampImg}
                    alt={`Festejo campeón ${champ.teamName}`}
                    className="w-full h-full object-contain"
                    fallbackLabel={champ.teamName}
                  />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-amber-300">
                      {champ.tournamentType === 'copa'
                        ? 'Copa de la Liga · '
                        : champ.tournamentType === 'recopa'
                        ? 'Recopa (Gran Campeón) · '
                        : 'Liga · '}
                      {champ.season}
                    </div>
                    <h3 className="mt-0.5 font-display text-2xl font-extrabold text-albiceleste-shiny">
                      {champ.teamName}
                    </h3>
                    <div className="text-sm font-medium text-sky-200">
                      Campeón: {champ.memberName}
                    </div>
                    {champ.notes && (
                      <p className="mt-2 text-sm text-sky-100/85">{champ.notes}</p>
                    )}
                  </div>

                  {user?.role === 'admin' && (
                    <div className="pt-2 border-t border-amber-400/25 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleDeleteChampion(champ.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar registro</span>
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
