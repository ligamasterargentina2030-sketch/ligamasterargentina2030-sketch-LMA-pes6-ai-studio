import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  orderBy,
  query,
  type Timestamp,
} from 'firebase/firestore/lite';
import {
  COMMUNITY_VIDEOS_REFRESH_EVENT,
  db,
  formatFirestoreError,
  isFirestoreNetworkError,
  OperationType,
} from '../firebase';
import type { CommunityVideo } from '../types';
import { apiFetch } from '../utils/api';

const COMMUNITY_CACHE_KEY = 'lma_community_videos_cache_v1';

function readCachedVideos(): CommunityVideo[] {
  try {
    const raw = localStorage.getItem(COMMUNITY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CommunityVideo[]) : [];
  } catch {
    return [];
  }
}

function writeCachedVideos(items: CommunityVideo[]): void {
  try {
    localStorage.setItem(COMMUNITY_CACHE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage quota errors
  }
}

function parseFecha(rawFecha: unknown): { fechaMs: number; fechaLabel: string } {
  let dateObj: Date | null = null;
  if (rawFecha && typeof (rawFecha as Timestamp).toDate === 'function') {
    dateObj = (rawFecha as Timestamp).toDate();
  } else if (typeof rawFecha === 'number') {
    dateObj = new Date(rawFecha);
  } else if (typeof rawFecha === 'string' && rawFecha.trim()) {
    const parsed = new Date(rawFecha);
    if (!Number.isNaN(parsed.getTime())) dateObj = parsed;
  }

  if (!dateObj) {
    const now = new Date();
    return {
      fechaMs: now.getTime(),
      fechaLabel: 'Recién publicado',
    };
  }

  return {
    fechaMs: dateObj.getTime(),
    fechaLabel: dateObj.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

export function useCommunityVideos() {
  const [communityVideos, setCommunityVideos] = useState<CommunityVideo[]>(() => readCachedVideos());
  const [loadingCommunity, setLoadingCommunity] = useState(true);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setLoadingCommunity(false);
      return;
    }

    // 1) Prefer same-origin Express proxy so restricted browser networks/iframes never fail on firestore.googleapis.com
    try {
      const apiRes = await apiFetch<{ videos: CommunityVideo[] }>('/api/community-videos');
      if (Array.isArray(apiRes?.videos)) {
        setCommunityVideos(apiRes.videos);
        writeCachedVideos(apiRes.videos);
        setLoadingCommunity(false);
        setFirestoreError(null);
        return;
      }
    } catch {
      // Static hosting or offline backend: fall back to direct Firestore client query
    }

    // 2) Fallback: direct Firestore Lite query (used on GitHub Pages static hosting)
    try {
      const videosRef = collection(db, 'videos_comunidad');
      const q = query(videosRef, orderBy('fecha', 'desc'));
      const snapshot = await getDocs(q);
      const items: CommunityVideo[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as {
          titulo?: string;
          autor?: string;
          videoUrl?: string;
          fecha?: unknown;
        };
        const { fechaMs, fechaLabel } = parseFecha(data.fecha);
        return {
          id: docSnap.id,
          titulo: String(data.titulo || 'Video de la comunidad'),
          autor: String(data.autor || 'Miembro'),
          videoUrl: String(data.videoUrl || ''),
          fechaMs,
          fechaLabel,
        };
      });
      items.sort((a, b) => b.fechaMs - a.fechaMs);
      setCommunityVideos(items);
      writeCachedVideos(items);
      setLoadingCommunity(false);
      setFirestoreError(null);
    } catch (error) {
      setLoadingCommunity(false);
      const cached = readCachedVideos();
      if (cached.length > 0 && isFirestoreNetworkError(error)) {
        setCommunityVideos(cached);
        setFirestoreError(null);
        return;
      }
      if (isFirestoreNetworkError(error)) {
        setFirestoreError(null);
        return;
      }
      setFirestoreError(formatFirestoreError(error, OperationType.LIST, 'videos_comunidad'));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = () => {
      if (active) void loadVideos();
    };

    run();
    window.addEventListener(COMMUNITY_VIDEOS_REFRESH_EVENT, run);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        run();
      }
    }, 45000);

    return () => {
      active = false;
      window.removeEventListener(COMMUNITY_VIDEOS_REFRESH_EVENT, run);
      window.clearInterval(intervalId);
    };
  }, [loadVideos]);

  return { communityVideos, loadingCommunity, firestoreError, refreshCommunityVideos: loadVideos };
}
