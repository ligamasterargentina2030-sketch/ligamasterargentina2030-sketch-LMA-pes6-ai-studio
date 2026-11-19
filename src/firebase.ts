import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore, setLogLevel } from 'firebase/firestore/lite';

const firebaseConfig = {
  apiKey: "AIzaSyBkcALIEgL4u2i8w_GIX-NlXROkJgiTc0w",
  authDomain: "liga-master-argentina.firebaseapp.com",
  databaseURL: "https://liga-master-argentina-default-rtdb.firebaseio.com",
  projectId: "liga-master-argentina",
  storageBucket: "liga-master-argentina.firebasestorage.app",
  messagingSenderId: "495632308362",
  appId: "1:495632308362:web:f769bf97c7d9462ca83573",
  measurementId: "G-PPRPNDT1KV"
};

setLogLevel('silent');

const app = getApps().some((a) => a.name === '[DEFAULT]')
  ? getApp()
  : initializeApp(firebaseConfig);

export const db = getFirestore(app);

export const COMMUNITY_VIDEOS_REFRESH_EVENT = 'lma-community-videos-refresh';

export function notifyCommunityVideosChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COMMUNITY_VIDEOS_REFRESH_EVENT));
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function isFirestoreNetworkError(error: unknown): boolean {
  const rawMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('networkerror') ||
    rawMessage.includes('load failed') ||
    rawMessage.includes('network request failed') ||
    rawMessage.includes('unavailable') ||
    rawMessage.includes('offline')
  );
}

export function formatFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (isFirestoreNetworkError(error)) {
    console.warn('Firestore Network Warning:', JSON.stringify({ error: rawMessage, operationType, path }));
    return 'No se pudo conectar con Firestore en este momento. Verificá tu conexión o reintentá en unos segundos.';
  }
  console.error('Firestore Error:', JSON.stringify({ error: rawMessage, operationType, path }));
  if (rawMessage.toLowerCase().includes('permission') || rawMessage.toLowerCase().includes('insufficient')) {
    return 'Firestore rechazó la operación por permisos. Revisá las reglas de seguridad de la colección videos_comunidad en Firebase.';
  }
  return `Error de Firebase Firestore (${operationType}): ${rawMessage}`;
}
