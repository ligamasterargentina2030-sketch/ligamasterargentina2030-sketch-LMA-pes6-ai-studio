import type { MusicTrack } from '../types';
import { extractAndResizeId3CoverFromBlob } from './id3Cover';

const DB_NAME = 'lma_personal_mp3_db_v1';
const STORE_NAME = 'tracks';

interface StoredPersonalTrack {
  id: string;
  ownerKey: string;
  title: string;
  artist: string;
  coverUrl?: string;
  blob: Blob;
  createdAt: string;
}

export interface LocalPersonalTrack extends MusicTrack {
  isLocal: true;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible en este navegador.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('ownerKey', 'ownerKey', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Error abriendo base local de MP3.'));
  });
}

export async function loadPersonalLocalTracks(ownerKey: string): Promise<LocalPersonalTrack[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index('ownerKey');
      const req = idx.getAll(ownerKey);
      req.onsuccess = () => {
        const items = (req.result as StoredPersonalTrack[]) || [];
        items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const mapped: LocalPersonalTrack[] = items.map((item) => ({
          id: item.id,
          title: item.title,
          artist: item.artist,
          coverUrl: item.coverUrl,
          audioUrl: URL.createObjectURL(item.blob),
          createdAt: item.createdAt,
          isLocal: true,
        }));
        resolve(mapped);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function savePersonalLocalTracks(
  ownerKey: string,
  files: File[],
  artistLabel = 'Mi Lista MP3'
): Promise<LocalPersonalTrack[]> {
  const db = await openDb();
  const saved: LocalPersonalTrack[] = [];
  const now = Date.now();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const cleanTitle =
      file.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim() || 'Mi Canción MP3';
    const coverUrl = await extractAndResizeId3CoverFromBlob(file).catch(() => undefined);
    const record: StoredPersonalTrack = {
      id: `local_mp3_${now}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      ownerKey,
      title: cleanTitle,
      artist: artistLabel,
      coverUrl,
      blob: file,
      createdAt: new Date(now + i).toISOString(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    saved.push({
      id: record.id,
      title: record.title,
      artist: record.artist,
      coverUrl: record.coverUrl,
      audioUrl: URL.createObjectURL(record.blob),
      createdAt: record.createdAt,
      isLocal: true,
    });
  }
  return saved;
}

export async function deletePersonalLocalTrack(trackId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(trackId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export function notifyPersonalMusicChanged(detail?: { switchToPersonal?: boolean }): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lma:personal-music-changed', { detail }));
  }
}
