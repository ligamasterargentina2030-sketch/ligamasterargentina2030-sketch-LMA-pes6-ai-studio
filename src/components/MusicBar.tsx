import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Disc3,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Radio,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  addLeagueMusicFirestore,
  addPersonalMusicFirestore,
  addUserPersonalMusicFirestore,
  deleteLeagueMusicFirestore,
  deletePersonalMusicFirestore,
  deleteUserPersonalMusicFirestore,
} from '../services/firestoreLeague';
import type { AuthUser, LastListenedTrack, MusicTrack } from '../types';
import { uploadMediaFile } from '../utils/api';
import { resolveAssetUrl } from '../utils/assetUrl';
import { resolveTrackCoverUrl } from '../utils/id3Cover';
import {
  deletePersonalLocalTrack,
  loadPersonalLocalTracks,
  notifyPersonalMusicChanged,
  savePersonalLocalTracks,
  type LocalPersonalTrack,
} from '../utils/personalMusicDb';

interface RadioStation {
  id: string;
  dial: string;
  name: string;
  city: string;
  streamUrl: string;
}

const DEFAULT_POP_RADIO_URL = 'https://popradio.stweb.tv/popradio/live/playlist.m3u8';

const ARGENTINE_FM_STATIONS: RadioStation[] = [
  {
    id: 'pop-1015',
    dial: '101.5',
    name: 'Pop Radio 101.5',
    city: 'Buenos Aires',
    streamUrl: DEFAULT_POP_RADIO_URL,
  },
  {
    id: 'la100-999',
    dial: '99.9',
    name: 'La 100 FM',
    city: 'Buenos Aires',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/FM999_56.mp3',
  },
  {
    id: 'aspen-1023',
    dial: '102.3',
    name: 'Aspen 102.3',
    city: 'Buenos Aires',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/ASPEN.mp3',
  },
  {
    id: 'rockandpop-959',
    dial: '95.9',
    name: 'Rock & Pop',
    city: 'Buenos Aires',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/ROCKANDPOP.mp3',
  },
  {
    id: 'metro-951',
    dial: '95.1',
    name: 'Metro 95.1',
    city: 'Buenos Aires',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/METRO.mp3',
  },
  {
    id: 'disney-943',
    dial: '94.3',
    name: 'Radio Disney',
    city: 'Buenos Aires',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/DISNEY_ARG_BA.mp3',
  },
  {
    id: 'blue-1007',
    dial: '100.7',
    name: 'Blue FM',
    city: 'Buenos Aires',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/BLUE_FM_100_7AAC.aac',
  },
  {
    id: 'urbana-1043',
    dial: '104.3',
    name: 'Urbana Play',
    city: 'Buenos Aires',
    streamUrl: 'https://vmf.edge-apps.net/playlist/urbana.m3u8/play.m3u8',
  },
  {
    id: 'rcvos-899',
    dial: '89.9',
    name: 'Radio Con Vos',
    city: 'Buenos Aires',
    streamUrl: 'https://server1.stweb.tv/rcvos/live/playlist.m3u8',
  },
  {
    id: 'pasion-1027',
    dial: '102.7',
    name: 'Pasión de Sábado FM 102.7',
    city: 'Buenos Aires',
    streamUrl: 'https://streamlky.alsolnet.com/fmpasion',
  },
  {
    id: 'fm-1055',
    dial: '105.5',
    name: 'FM 105.5 (Los 40 Argentina)',
    city: 'Buenos Aires',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40_ARGENTINAAAC.aac',
  },
  {
    id: 'dsports-1031',
    dial: '103.1',
    name: 'DSports Radio · Fútbol En Vivo',
    city: 'Relatos de Partidos',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/DSPORTSRADIOAAC.aac',
  },
  {
    id: 'continental-590',
    dial: 'AM 590',
    name: 'Radio Continental · Relatos Fútbol',
    city: 'Partidos En Vivo',
    streamUrl: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CONTINENTALAAC.aac',
  },
  {
    id: 'lapopu-923',
    dial: '92.3',
    name: 'La Popu FM',
    city: 'Córdoba',
    streamUrl: 'https://liveradio.mediainbox.net/popular.mp3',
  },
];

interface MusicBarProps {
  tracks: MusicTrack[];
  personalServerTracks?: MusicTrack[];
  personalTeamId?: string;
  user?: AuthUser | null;
  radioName?: string;
  radioStreamUrl?: string;
  isAdmin?: boolean;
  introActive?: boolean;
  musicMode?: 'league' | 'personal';
  onChangeMusicMode?: (mode: 'league' | 'personal') => void | Promise<void>;
  onRefresh?: () => Promise<void>;
  onLastSongPlayed?: (track: LastListenedTrack) => void | Promise<void>;
}

export function MusicBar({
  tracks,
  personalServerTracks = [],
  personalTeamId,
  user = null,
  radioName,
  radioStreamUrl,
  isAdmin = false,
  introActive = false,
  musicMode = 'league',
  onChangeMusicMode,
  onRefresh,
  onLastSongPlayed,
}: MusicBarProps) {
  // MP3 Player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const userPausedRef = useRef(false);
  const lastReportedKeyRef = useRef<string | null>(null);

  const ownerKey = personalTeamId || user?.teamId || user?.id || 'guest';
  const [localPersonalTracks, setLocalPersonalTracks] = useState<LocalPersonalTrack[]>([]);
  const [playlistMode, setPlaylistMode] = useState<'personal' | 'league'>(musicMode);

  useEffect(() => {
    setPlaylistMode(musicMode);
  }, [musicMode]);

  const reloadLocalPersonal = useCallback(async () => {
    if (user?.firebaseAuthenticated) {
      setLocalPersonalTracks((prev) => {
        for (const old of prev) {
          if (old.audioUrl.startsWith('blob:')) URL.revokeObjectURL(old.audioUrl);
        }
        return [];
      });
      return;
    }
    const loaded = await loadPersonalLocalTracks(ownerKey);
    setLocalPersonalTracks((prev) => {
      for (const old of prev) {
        if (old.audioUrl.startsWith('blob:')) URL.revokeObjectURL(old.audioUrl);
      }
      return loaded;
    });
  }, [ownerKey, user?.firebaseAuthenticated]);

  useEffect(() => {
    void reloadLocalPersonal();
    const onChanged = (ev: Event) => {
      void reloadLocalPersonal();
      const customEv = ev as CustomEvent<{ switchToPersonal?: boolean } | undefined>;
      if (customEv.detail?.switchToPersonal) {
        setPlaylistMode('personal');
        setCurrentIndex(0);
        void onChangeMusicMode?.('personal');
      }
    };
    window.addEventListener('lma:personal-music-changed', onChanged);
    return () => {
      window.removeEventListener('lma:personal-music-changed', onChanged);
    };
  }, [reloadLocalPersonal, onChangeMusicMode]);

  const personalTracks = useMemo<(MusicTrack & { isLocal?: boolean })[]>(() => {
    return [...personalServerTracks, ...localPersonalTracks];
  }, [personalServerTracks, localPersonalTracks]);

  const activeTracks =
    playlistMode === 'personal' && personalTracks.length > 0 ? personalTracks : tracks;
  const usingPersonal = playlistMode === 'personal' && personalTracks.length > 0;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [volume, setVolume] = useState(0.55);
  const [muted, setMuted] = useState(false);
  const [minimized, setMinimized] = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [addingTrack, setAddingTrack] = useState(false);
  const [trackFormError, setTrackFormError] = useState<string | null>(null);

  // FM Argentina Live Radio state
  const radioAudioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const radioActiveRef = useRef(false);

  const stations = useMemo(() => {
    const customUrl = radioStreamUrl?.trim();
    const customLabel = radioName?.trim();
    if (!customUrl) return ARGENTINE_FM_STATIONS;

    const existingIdx = ARGENTINE_FM_STATIONS.findIndex((s) => s.streamUrl === customUrl);
    if (existingIdx === 0) {
      if (customLabel && customLabel !== 'FM 101.5 Pop Radio (Bs. As.)') {
        return [
          { ...ARGENTINE_FM_STATIONS[0], name: customLabel },
          ...ARGENTINE_FM_STATIONS.slice(1),
        ];
      }
      return ARGENTINE_FM_STATIONS;
    }
    if (existingIdx > 0) {
      const selected = ARGENTINE_FM_STATIONS[existingIdx];
      return [
        customLabel ? { ...selected, name: customLabel } : selected,
        ...ARGENTINE_FM_STATIONS.filter((_, idx) => idx !== existingIdx),
      ];
    }
    return [
      {
        id: 'custom-fm',
        dial: 'FM',
        name: customLabel || 'Radio FM Argentina',
        city: 'En Vivo',
        streamUrl: customUrl,
      },
      ...ARGENTINE_FM_STATIONS,
    ];
  }, [radioName, radioStreamUrl]);

  const [stationIndex, setStationIndex] = useState(0);
  const [radioPlaying, setRadioPlaying] = useState(false);
  const [radioConnecting, setRadioConnecting] = useState(false);
  const [radioVolume, setRadioVolume] = useState(0.75);
  const [radioMuted, setRadioMuted] = useState(false);
  const [radioMinimized, setRadioMinimized] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const [radioError, setRadioError] = useState<string | null>(null);

  const safeIndex = activeTracks.length > 0 ? Math.min(currentIndex, activeTracks.length - 1) : 0;
  const currentTrack = activeTracks[safeIndex];
  const [currentCoverUrl, setCurrentCoverUrl] = useState<string | undefined>(currentTrack?.coverUrl);

  useEffect(() => {
    let active = true;
    if (!currentTrack) {
      setCurrentCoverUrl(undefined);
      return;
    }
    setCurrentCoverUrl(currentTrack.coverUrl ? resolveAssetUrl(currentTrack.coverUrl) : undefined);
    void resolveTrackCoverUrl(currentTrack).then((url) => {
      if (active && url) {
        setCurrentCoverUrl(url.startsWith('data:') ? url : resolveAssetUrl(url));
      }
    });
    return () => {
      active = false;
    };
  }, [currentTrack?.id, currentTrack?.audioUrl, currentTrack?.coverUrl]);

  const recordPlayedTrack = useCallback(
    async (track: MusicTrack) => {
      if (!onLastSongPlayed || !user) return;
      const playKey = `${track.id}|${track.audioUrl}`;
      if (lastReportedKeyRef.current === playKey) return;
      lastReportedKeyRef.current = playKey;
      const resolvedCover = await resolveTrackCoverUrl(track).catch(() => track.coverUrl);
      void onLastSongPlayed({
        title: track.title,
        artist: track.artist,
        coverUrl: resolvedCover || track.coverUrl,
        audioUrl: track.audioUrl,
        listenedAt: new Date().toISOString(),
      });
    },
    [onLastSongPlayed, user]
  );

  const safeStationIdx = stations.length > 0 ? Math.min(stationIndex, stations.length - 1) : 0;
  const currentStation = stations[safeStationIdx];

  const stopRadio = useCallback(() => {
    radioActiveRef.current = false;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const radioAudio = radioAudioRef.current;
    if (radioAudio) {
      radioAudio.pause();
      radioAudio.removeAttribute('src');
      radioAudio.load();
    }
    setRadioPlaying(false);
    setRadioConnecting(false);
  }, []);

  const pauseMp3 = useCallback(() => {
    userPausedRef.current = true;
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
    setIsPlaying(false);
    setAutoplayBlocked(false);
  }, []);

  const startRadioStation = useCallback(
    async (station: RadioStation) => {
      const radioAudio = radioAudioRef.current;
      if (!radioAudio || !station?.streamUrl) return;

      pauseMp3();
      setRadioError(null);
      setRadioConnecting(true);
      radioActiveRef.current = true;

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      radioAudio.pause();
      radioAudio.removeAttribute('src');
      radioAudio.load();
      radioAudio.volume = radioMuted ? 0 : radioVolume;

      const url = station.streamUrl.trim();
      const isHls = /\.m3u8(\?|$)/i.test(url);

      try {
        if (isHls) {
          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 10,
            });
            hlsRef.current = hls;

            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (!data.fatal) return;
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                setRadioError('Sin señal. Probá otra emisora.');
                stopRadio();
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
              } else {
                setRadioError('Error de transmisión FM.');
                stopRadio();
              }
            });

            hls.loadSource(url);
            hls.attachMedia(radioAudio);

            await new Promise<void>((resolve, reject) => {
              const onManifest = () => {
                cleanup();
                resolve();
              };
              const onFatal = (_ev: unknown, d: { fatal: boolean }) => {
                if (d.fatal) {
                  cleanup();
                  reject(new Error('hls_fatal'));
                }
              };
              const timeout = window.setTimeout(() => {
                cleanup();
                reject(new Error('timeout'));
              }, 12000);
              const cleanup = () => {
                window.clearTimeout(timeout);
                hls.off(Hls.Events.MANIFEST_PARSED, onManifest);
                hls.off(Hls.Events.ERROR, onFatal);
              };
              hls.on(Hls.Events.MANIFEST_PARSED, onManifest);
              hls.on(Hls.Events.ERROR, onFatal);
            });

            if (!radioActiveRef.current) return;
            await radioAudio.play();
            if (!radioActiveRef.current) return;
            setRadioPlaying(true);
            setRadioConnecting(false);
          } else if (radioAudio.canPlayType('application/vnd.apple.mpegurl')) {
            radioAudio.src = url;
            await radioAudio.play();
            if (!radioActiveRef.current) return;
            setRadioPlaying(true);
            setRadioConnecting(false);
          } else {
            throw new Error('HLS no soportado');
          }
        } else {
          // Direct Icecast / Shoutcast MP3 or AAC live stream
          const cacheBuster = url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
          radioAudio.src = url.includes('streamtheworld.com') ? url : `${url}${cacheBuster}`;
          await radioAudio.play();
          if (!radioActiveRef.current) return;
          setRadioPlaying(true);
          setRadioConnecting(false);
        }
      } catch {
        if (radioActiveRef.current) {
          stopRadio();
          setRadioError('No conectó. Probá otra FM.');
        }
      }
    },
    [pauseMp3, radioMuted, radioVolume, stopRadio]
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    const radioAudio = radioAudioRef.current;
    if (!radioAudio) return;
    radioAudio.volume = radioMuted ? 0 : radioVolume;
  }, [radioVolume, radioMuted]);

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || userPausedRef.current || introActive || radioActiveRef.current) return;

    let cancelled = false;

    const tryAutoplay = async () => {
      if (cancelled || userPausedRef.current || introActive || radioActiveRef.current) return;
      try {
        await audio.play();
        if (!cancelled) {
          setIsPlaying(true);
          setAutoplayBlocked(false);
        }
      } catch {
        if (!cancelled) {
          setIsPlaying(false);
          setAutoplayBlocked(true);
        }
      }
    };

    tryAutoplay();

    const unlockOnGesture = () => {
      if (!userPausedRef.current && !introActive && !radioActiveRef.current && audio.paused) {
        tryAutoplay();
      }
    };

    window.addEventListener('pointerdown', unlockOnGesture, { once: true });
    window.addEventListener('keydown', unlockOnGesture, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', unlockOnGesture);
      window.removeEventListener('keydown', unlockOnGesture);
    };
  }, [currentTrack?.audioUrl, introActive]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    setErrorMsg(null);
    if (isPlaying) {
      userPausedRef.current = true;
      audio.pause();
      setIsPlaying(false);
    } else {
      stopRadio();
      userPausedRef.current = false;
      try {
        await audio.play();
        setIsPlaying(true);
        setAutoplayBlocked(false);
      } catch {
        setErrorMsg('No se pudo reproducir.');
        setIsPlaying(false);
      }
    }
  };

  const handleNext = () => {
    if (activeTracks.length === 0) return;
    stopRadio();
    userPausedRef.current = false;
    setCurrentIndex((prev) => (prev + 1) % activeTracks.length);
    setIsPlaying(true);
  };

  const handlePrev = () => {
    if (activeTracks.length === 0) return;
    stopRadio();
    userPausedRef.current = false;
    setCurrentIndex((prev) => (prev - 1 + activeTracks.length) % activeTracks.length);
    setIsPlaying(true);
  };

  const switchPlaylistMode = (mode: 'personal' | 'league') => {
    setPlaylistMode(mode);
    setCurrentIndex(0);
    setErrorMsg(null);
    void onChangeMusicMode?.(mode);
  };

  const toggleRadio = () => {
    if (radioPlaying || radioConnecting) {
      stopRadio();
    } else if (currentStation) {
      void startRadioStation(currentStation);
    }
  };

  const handleSelectStation = (idx: number) => {
    setStationIndex(idx);
    const chosen = stations[idx];
    if (chosen) {
      void startRadioStation(chosen);
    }
  };

  const handleNextStation = () => {
    if (stations.length === 0) return;
    const nextIdx = (safeStationIdx + 1) % stations.length;
    setStationIndex(nextIdx);
    if (radioPlaying || radioConnecting) {
      void startRadioStation(stations[nextIdx]);
    } else {
      setRadioError(null);
    }
  };

  const handlePrevStation = () => {
    if (stations.length === 0) return;
    const prevIdx = (safeStationIdx - 1 + stations.length) % stations.length;
    setStationIndex(prevIdx);
    if (radioPlaying || radioConnecting) {
      void startRadioStation(stations[prevIdx]);
    } else {
      setRadioError(null);
    }
  };

  const handleUploadMultipleMp3 = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setTrackFormError(null);
    setAddingTrack(true);
    try {
      for (const file of Array.from(fileList)) {
        const audioUrl = await uploadMediaFile('music', file);
        const rawTitle = file.name.replace(/\.[^/.]+$/, '').trim() || 'Canción Oficial';
        await addLeagueMusicFirestore({
          title: rawTitle,
          artist: 'Liga Master Argentina',
          audioUrl,
        });
      }
      if (onRefresh) await onRefresh();
    } catch (err) {
      setTrackFormError(err instanceof Error ? err.message : 'Error subiendo MP3.');
    } finally {
      setAddingTrack(false);
    }
  };

  const handleUploadPersonalMp3 = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setTrackFormError(null);
    setAddingTrack(true);
    const files = Array.from(fileList);
    try {
      if (user?.firebaseAuthenticated) {
        const targetTeamId = personalTeamId || user.teamId;
        for (const file of files) {
          const audioUrl = await uploadMediaFile('music', file);
          const rawTitle = file.name.replace(/\.[^/.]+$/, '').trim() || 'Mi Canción MP3';
          const trackPayload: MusicTrack = {
            id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: rawTitle,
            artist: user.displayName || 'Mi Lista MP3',
            audioUrl,
            createdAt: new Date().toISOString(),
          };
          if (targetTeamId) {
            await addPersonalMusicFirestore(targetTeamId, trackPayload);
          } else {
            await addUserPersonalMusicFirestore(trackPayload);
          }
        }
        if (onRefresh) await onRefresh();
        notifyPersonalMusicChanged({ switchToPersonal: true });
      } else {
        await savePersonalLocalTracks(ownerKey, files, user?.displayName || 'Mi Lista MP3');
        notifyPersonalMusicChanged({ switchToPersonal: true });
      }
      switchPlaylistMode('personal');
    } catch (err) {
      setTrackFormError(err instanceof Error ? err.message : 'No se pudieron cargar tus MP3.');
    } finally {
      setAddingTrack(false);
    }
  };

  const handleDeletePersonalTrack = async (track: MusicTrack & { isLocal?: boolean }) => {
    setTrackFormError(null);
    if (track.isLocal) {
      await deletePersonalLocalTrack(track.id);
      notifyPersonalMusicChanged();
      return;
    }
    if (!user?.firebaseAuthenticated) return;
    const targetTeamId = personalTeamId || user.teamId;
    try {
      if (targetTeamId) {
        await deletePersonalMusicFirestore(targetTeamId, track.id);
      } else {
        await deleteUserPersonalMusicFirestore(track.id);
      }
      if (onRefresh) await onRefresh();
      notifyPersonalMusicChanged();
    } catch (err) {
      setTrackFormError(err instanceof Error ? err.message : 'No se pudo eliminar la canción.');
    }
  };

  const handleAdminDeleteTrack = async (trackId: string) => {
    try {
      await deleteLeagueMusicFirestore(trackId);
      if (onRefresh) await onRefresh();
    } catch (err) {
      setTrackFormError(err instanceof Error ? err.message : 'No se pudo eliminar la canción.');
    }
  };

  const showMp3Section = true;

  return (
    <aside
      aria-label="Reproductor de música y Radio FM Argentina"
      className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2"
    >
      {currentTrack && (
        <audio
          ref={audioRef}
          src={resolveAssetUrl(currentTrack.audioUrl)}
          loop={activeTracks.length === 1}
          onEnded={handleNext}
          onPlay={() => {
            stopRadio();
            setIsPlaying(true);
            setAutoplayBlocked(false);
            void recordPlayedTrack(currentTrack);
          }}
          onPause={() => setIsPlaying(false)}
          onError={() => {
            setIsPlaying(false);
            setErrorMsg('Error de audio.');
          }}
        />
      )}

      {/* Elemento de audio dedicado a la Radio FM Argentina en tiempo real */}
      <audio
        ref={radioAudioRef}
        onPlaying={() => {
          setRadioPlaying(true);
          setRadioConnecting(false);
          setRadioError(null);
        }}
        onWaiting={() => {
          if (radioActiveRef.current) setRadioConnecting(true);
        }}
        onPause={() => {
          if (!radioActiveRef.current) {
            setRadioPlaying(false);
            setRadioConnecting(false);
          }
        }}
        onError={() => {
          if (radioActiveRef.current) {
            stopRadio();
            setRadioError('Señal caída. Probá otra FM.');
          }
        }}
      />

      {/* Popover playlist MP3 hacia arriba (Mi Lista Personal + Música Liga) */}
      {showMp3Section && showPlaylist && (
        <div className="w-[290px] sm:w-[330px] rounded-xl bg-[#071D38] border-2 border-amber-400/65 shadow-2xl p-3 space-y-2.5 text-white">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#041224] border border-amber-400/35">
              <button
                type="button"
                onClick={() => switchPlaylistMode('personal')}
                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors ${
                  playlistMode === 'personal'
                    ? 'btn-gold-luxury'
                    : 'text-sky-200 hover:text-white'
                }`}
              >
                Mi Música ({personalTracks.length})
              </button>
              <button
                type="button"
                onClick={() => switchPlaylistMode('league')}
                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors ${
                  playlistMode === 'league'
                    ? 'btn-gold-luxury'
                    : 'text-sky-200 hover:text-white'
                }`}
              >
                Liga ({tracks.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowPlaylist(false)}
              className="text-[11px] text-sky-200 hover:text-amber-300"
            >
              Cerrar
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-sky-200/80">
              {playlistMode === 'personal'
                ? 'Tu música personal · Sincronizada con Mi Perfil'
                : 'Lista oficial de la Liga'}
            </span>

            {playlistMode === 'personal' ? (
              <label className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] btn-gold-luxury rounded-md cursor-pointer shrink-0">
                <Upload className="w-3 h-3" />
                <span>{addingTrack ? 'Subiendo...' : 'Agregar mis MP3'}</span>
                <input
                  type="file"
                  multiple
                  disabled={addingTrack}
                  accept=".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/*"
                  onChange={(e) => {
                    void handleUploadPersonalMp3(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
            ) : (
              isAdmin && (
                <label className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] btn-gold-luxury rounded-md cursor-pointer shrink-0">
                  <Upload className="w-3 h-3" />
                  <span>{addingTrack ? 'Subiendo...' : 'Cargar MP3'}</span>
                  <input
                    type="file"
                    multiple
                    disabled={addingTrack}
                    accept=".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/*"
                    onChange={(e) => {
                      void handleUploadMultipleMp3(e.target.files);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>
              )
            )}
          </div>

          {trackFormError && (
            <div className="text-[11px] text-rose-300">{trackFormError}</div>
          )}

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
            {playlistMode === 'personal' ? (
              personalTracks.length === 0 ? (
                <div className="text-[11px] text-sky-200/80 py-3 text-center bg-[#041224]/70 rounded-lg px-2 border border-sky-400/20">
                  Todavía no agregaste tus propias canciones MP3. Tocá <strong className="text-amber-300">Agregar mis MP3</strong> para armar tu lista personal.
                </div>
              ) : (
                personalTracks.map((track, idx) => {
                  const active = usingPersonal && idx === safeIndex;
                  return (
                    <div
                      key={track.id}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${
                        active
                          ? 'bg-emerald-500/20 border border-emerald-400/70 text-white'
                          : 'bg-[#05162B] border border-sky-400/20 text-sky-100 hover:bg-[#0A2B52]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          stopRadio();
                          userPausedRef.current = false;
                          setPlaylistMode('personal');
                          setCurrentIndex(idx);
                          setIsPlaying(true);
                        }}
                        className="min-w-0 pr-2 flex-1 text-left"
                      >
                        <div className="font-semibold truncate">{track.title}</div>
                        <div className="text-[10px] text-emerald-300/85 truncate">
                          {active && isPlaying ? 'Sonando en tu lista' : track.artist}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDeletePersonalTrack(track)}
                        aria-label={`Quitar ${track.title}`}
                        className="p-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 rounded transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )
            ) : tracks.length === 0 ? (
              <div className="text-[11px] text-sky-200/75 py-2">
                Sin canciones todavía.
              </div>
            ) : (
              tracks.map((track, idx) => {
                const active = !usingPersonal && idx === safeIndex;
                return (
                  <div
                    key={track.id}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${
                      active
                        ? 'bg-sky-400/20 border border-amber-400/60 text-white'
                        : 'bg-[#05162B] border border-sky-400/20 text-sky-100 hover:bg-[#0A2B52]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        stopRadio();
                        userPausedRef.current = false;
                        setPlaylistMode('league');
                        setCurrentIndex(idx);
                        setIsPlaying(true);
                      }}
                      className="min-w-0 pr-2 flex-1 text-left"
                    >
                      <div className="font-semibold truncate">{track.title}</div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {active && isPlaying ? 'Sonando ahora' : track.artist}
                      </div>
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleAdminDeleteTrack(track.id)}
                        aria-label={`Eliminar ${track.title}`}
                        className="p-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 rounded transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* REPRODUCTOR MP3 (ARRIBA) */}
      {showMp3Section &&
        (minimized ? (
          <div className="min-w-[164px] flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#071D38] border-2 border-amber-400/65 shadow-xl">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pausar música' : 'Reproducir música'}
              className="w-7 h-7 rounded-lg btn-gold-luxury flex items-center justify-center shrink-0"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
            </button>
            <button
              type="button"
              onClick={() => setMinimized(false)}
              aria-label="Expandir reproductor MP3"
              className="inline-flex items-center justify-between gap-1.5 flex-1 min-w-0 px-1.5 py-1 text-[11px] font-semibold text-white hover:text-amber-200"
            >
              <span className="max-w-[104px] truncate">
                {currentTrack ? currentTrack.title : 'Música MP3'}
              </span>
              <ChevronUp className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            </button>
          </div>
        ) : (
          <div className="w-[255px] sm:w-[280px] rounded-xl bg-[#071D38] border-2 border-amber-400/65 shadow-2xl p-2.5 space-y-2 text-white">
            <div className="flex items-center gap-2">
              {currentCoverUrl ? (
                <img
                  src={currentCoverUrl}
                  alt={currentTrack?.title || 'Portada'}
                  className="w-9 h-9 rounded-lg object-cover border border-amber-400/60 shrink-0 bg-[#041224]"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-[#041224] border border-amber-400/35 flex items-center justify-center shrink-0">
                  <Disc3 className={`w-4 h-4 text-amber-300 ${isPlaying ? 'animate-spin' : ''}`} />
                </div>
              )}

              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pausar música' : 'Reproducir música'}
                className="w-8 h-8 rounded-lg btn-gold-luxury flex items-center justify-center shrink-0"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
              </button>

              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-white truncate">
                  {currentTrack ? currentTrack.title : 'Sin canciones'}
                </div>
                <div className="text-[10px] text-sky-200/80 truncate">
                  {errorMsg ||
                    (autoplayBlocked && !radioPlaying
                      ? 'Tocá Play para escuchar'
                      : currentTrack
                      ? currentTrack.artist
                      : 'Agregá MP3 desde Lista')}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMinimized(true)}
                aria-label="Minimizar reproductor MP3"
                className="p-1 text-sky-200 hover:text-amber-300 transition-colors shrink-0"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-400/25">
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={handlePrev}
                  aria-label="Anterior"
                  className="p-1 text-sky-200 hover:text-amber-300 transition-colors"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  aria-label="Siguiente"
                  className="p-1 text-sky-200 hover:text-amber-300 transition-colors"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? 'Activar sonido MP3' : 'Silenciar MP3'}
                  className="text-sky-200 hover:text-amber-300 transition-colors shrink-0"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    setMuted(false);
                    setVolume(Number(e.target.value));
                  }}
                  aria-label="Volumen MP3"
                  className="w-full accent-amber-400 cursor-pointer h-1"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowStations(false);
                  setShowPlaylist((v) => !v);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-white hover:text-amber-200 bg-[#05162B] hover:bg-[#0B2D54] border border-amber-400/45 rounded-md transition-colors whitespace-nowrap shrink-0"
                title="Abrir lista de música y agregar tus propios MP3"
              >
                <ListMusic className="w-3 h-3 text-amber-300" />
                <span>{usingPersonal ? `Mía (${personalTracks.length})` : activeTracks.length}</span>
              </button>
            </div>
          </div>
        ))}

      {/* Popover selector de Emisoras FM Argentina */}
      {showStations && (
        <div className="w-[275px] sm:w-[310px] rounded-xl bg-[#071D38] border-2 border-amber-400/65 shadow-2xl p-3 space-y-2 text-white">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
              <Radio className="w-3.5 h-3.5" />
              <span>Radios FM Argentina En Vivo</span>
            </span>
            <button
              type="button"
              onClick={() => setShowStations(false)}
              className="text-[11px] text-sky-200 hover:text-amber-300"
            >
              Cerrar
            </button>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
            {stations.map((st, idx) => {
              const active = idx === safeStationIdx;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => handleSelectStation(idx)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-left transition-colors ${
                    active
                      ? 'bg-sky-400/20 border border-amber-400/65 text-white'
                      : 'bg-[#05162B] border border-sky-400/20 text-sky-100 hover:bg-[#0A2B52]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{st.name}</div>
                    <div className="text-[10px] text-sky-200/75 truncate">
                      {active && radioPlaying
                        ? 'Transmitiendo en vivo'
                        : active && radioConnecting
                        ? 'Sintonizando...'
                        : st.city}
                    </div>
                  </div>
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded bg-[#071D38] border border-amber-400/45 text-amber-300 shrink-0">
                    {st.dial}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* RADIO FM ARGENTINA EN VIVO (ABAJO DEL REPRODUCTOR MP3) */}
      {radioMinimized ? (
        <div className="min-w-[164px] flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#071D38] border-2 border-amber-400/65 shadow-xl">
          <button
            type="button"
            onClick={toggleRadio}
            aria-label={radioPlaying ? 'Detener Radio FM' : 'Escuchar Radio FM en vivo'}
            className="w-7 h-7 rounded-lg btn-gold-luxury flex items-center justify-center shrink-0"
          >
            {radioConnecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : radioPlaying ? (
              <Square className="w-3 h-3 fill-current" />
            ) : (
              <Radio className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setRadioMinimized(false)}
            aria-label="Expandir Radio FM Argentina"
            className="inline-flex items-center justify-between gap-1.5 flex-1 min-w-0 px-1.5 py-1 text-[11px] font-semibold text-white hover:text-amber-200"
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              {radioPlaying && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
              )}
              <span className="max-w-[100px] truncate">
                FM {currentStation?.dial || '101.5'}
              </span>
            </span>
            <ChevronUp className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          </button>
        </div>
      ) : (
        <div className="w-[245px] sm:w-[265px] rounded-xl bg-[#071D38] border-2 border-amber-400/65 shadow-2xl p-2.5 space-y-2 text-white">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleRadio}
              aria-label={radioPlaying ? 'Detener Radio FM' : 'Escuchar Radio FM Argentina'}
              className="w-8 h-8 rounded-lg btn-gold-luxury flex items-center justify-center shrink-0"
            >
              {radioConnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : radioPlaying ? (
                <Square className="w-3 h-3 fill-current" />
              ) : (
                <Radio className="w-4 h-4" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.2 rounded bg-sky-400/20 border border-sky-300/40 text-[9px] font-mono font-bold text-sky-200 shrink-0">
                  FM {currentStation?.dial || '101.5'}
                </span>
                {radioPlaying ? (
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300 uppercase tracking-wider shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    En vivo
                  </span>
                ) : radioConnecting ? (
                  <span className="text-[9px] font-semibold text-amber-300 shrink-0">
                    Conectando...
                  </span>
                ) : (
                  <span className="text-[9px] font-semibold text-amber-300/90 shrink-0">
                    Radio ARG
                  </span>
                )}
              </div>

              <div className="text-[11px] font-semibold text-white truncate mt-0.5">
                {radioError || currentStation?.name || 'Pop Radio 101.5'}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setRadioMinimized(true)}
              aria-label="Minimizar Radio FM"
              className="p-1 text-sky-200 hover:text-amber-300 transition-colors shrink-0"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-400/25">
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={handlePrevStation}
                aria-label="Emisora anterior"
                className="p-1 text-sky-200 hover:text-amber-300 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNextStation}
                aria-label="Siguiente emisora"
                className="p-1 text-sky-200 hover:text-amber-300 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setRadioMuted((m) => !m)}
                aria-label={radioMuted ? 'Activar sonido Radio FM' : 'Silenciar Radio FM'}
                className="text-sky-200 hover:text-amber-300 transition-colors shrink-0"
              >
                {radioMuted || radioVolume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={radioMuted ? 0 : radioVolume}
                onChange={(e) => {
                  setRadioMuted(false);
                  setRadioVolume(Number(e.target.value));
                }}
                aria-label="Volumen Radio FM"
                className="w-full accent-amber-400 cursor-pointer h-1"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setShowPlaylist(false);
                setShowStations((v) => !v);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-white hover:text-amber-200 bg-[#05162B] hover:bg-[#0B2D54] border border-amber-400/45 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Radio className="w-3 h-3 text-amber-300" />
              <span>FM ({stations.length})</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
