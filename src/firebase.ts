import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, GoogleAuthProvider, setPersistence } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().some((a) => a.name === '[DEFAULT]')
  ? getApp()
  : initializeApp(firebaseConfig);

export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);
auth.languageCode = 'es';
if (typeof window !== 'undefined') {
  void setPersistence(auth, browserLocalPersistence).catch(() => undefined);
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId || '(default)';

export const BOOTSTRAPPED_ADMIN_EMAILS = [
  'ligamasterargentina2030@gmail.com',
  'cristiandiazdevelez@gmail.com',
] as const;

export function isBootstrappedAdminEmail(email?: string | null): boolean {
  const norm = String(email || '').trim().toLowerCase();
  return BOOTSTRAPPED_ADMIN_EMAILS.includes(norm as (typeof BOOTSTRAPPED_ADMIN_EMAILS)[number]);
}

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

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
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

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string
): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  let extracted = rawMessage;
  if (rawMessage.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawMessage) as { error?: string };
      if (parsed?.error) extracted = parsed.error;
    } catch {
      // keep raw
    }
  }
  if (isFirestoreNetworkError(extracted)) {
    return 'No se pudo conectar con Cloud Firestore en este momento. Verificá tu conexión o reintentá en unos segundos.';
  }
  const lower = extracted.toLowerCase();
  if (lower.includes('permission') || lower.includes('insufficient')) {
    if (!auth.currentUser) {
      return `Necesitás iniciar sesión con Google (Firebase Auth) para guardar cambios protegidos en Firestore (${path}).`;
    }
    return `Permisos insuficientes en Firestore para ${operationType} en "${path}". Solo el Administrador o el dueño autorizado puede realizar esta acción.`;
  }
  return `Error de Cloud Firestore (${operationType}): ${extracted}`;
}

let connectionTested = false;

export async function testConnection(): Promise<boolean> {
  if (connectionTested) return true;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Firestore client is offline.');
    }
    return false;
  }
}

if (typeof window !== 'undefined') {
  void testConnection();
}
