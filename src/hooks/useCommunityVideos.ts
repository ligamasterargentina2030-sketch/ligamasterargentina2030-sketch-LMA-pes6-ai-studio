import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from 'firebase/firestore';
import {
  COMMUNITY_VIDEOS_REFRESH_EVENT,
  db,
  formatFirestoreError,
  handleFirestoreError,
  isFirestoreNetworkError,
  OperationType,
} from '../firebase';
import type { CommunityVideo } from '../types';

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

function mapSnapshotDocs(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>
): CommunityVideo[] {
  return docs
    .map((docSnap) => {
      const data = docSnap.data();
      const { fechaMs, fechaLabel } = parseFecha(data.fecha ?? data.createdAt);
      return {
        id: docSnap.id,
        titulo: String(data.titulo || 'Video de la comunidad'),
        autor: String(data.autor || 'Miembro'),
        videoUrl: String(data.videoUrl || ''),
        fechaMs,
        fechaLabel,
      };
    })
    .sort((a, b) => b.fechaMs - a.fechaMs);
}

export function useCommunityVideos() {
  const [communityVideos, setCommunityVideos] = useState<CommunityVideo[]>([]);
  const [loadingCommunity, setLoadingCommunity] = useState(true);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    try {
      const videosRef = collection(db, 'videos_comunidad');
      const q = query(videosRef, orderBy('fecha', 'desc'));
      const snapshot = await getDocs(q);
      setCommunityVideos(mapSnapshotDocs(snapshot.docs));
      setLoadingCommunity(false);
      setFirestoreError(null);
    } catch (error) {
      setLoadingCommunity(false);
      if (isFirestoreNetworkError(error)) {
        setFirestoreError(
          'Sin conexión con Firestore. Reintentando sincronización en tiempo real...'
        );
        return;
      }
      setFirestoreError(formatFirestoreError(error, OperationType.LIST, 'videos_comunidad'));
    }
  }, []);

  useEffect(() => {
    const videosRef = collection(db, 'videos_comunidad');
    const q = query(videosRef, orderBy('fecha', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setCommunityVideos(mapSnapshotDocs(snapshot.docs));
        setLoadingCommunity(false);
        setFirestoreError(null);
      },
      (error) => {
        setLoadingCommunity(false);
        setFirestoreError(formatFirestoreError(error, OperationType.LIST, 'videos_comunidad'));
        try {
          handleFirestoreError(error, OperationType.LIST, 'videos_comunidad');
        } catch {
          // Structured error logged via handleFirestoreError while preserving UI message
        }
      }
    );

    const onRefresh = () => {
      void loadVideos();
    };
    window.addEventListener(COMMUNITY_VIDEOS_REFRESH_EVENT, onRefresh);

    return () => {
      unsubscribe();
      window.removeEventListener(COMMUNITY_VIDEOS_REFRESH_EVENT, onRefresh);
    };
  }, [loadVideos]);

  return { communityVideos, loadingCommunity, firestoreError, refreshCommunityVideos: loadVideos };
}
