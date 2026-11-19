import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  confirmPasswordReset,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  verifyPasswordResetCode,
  type ActionCodeSettings,
} from 'firebase/auth';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { apiFetch } from './api';

const FIREBASE_AUTH_APP_NAME = 'firebase-auth-app';

const firebaseAuthApp = getApps().some((a) => a.name === FIREBASE_AUTH_APP_NAME)
  ? getApp(FIREBASE_AUTH_APP_NAME)
  : initializeApp(firebaseAppletConfig, FIREBASE_AUTH_APP_NAME);

export const firebaseAuth = getAuth(firebaseAuthApp);
firebaseAuth.languageCode = 'es';

/**
 * Returns a publicly reachable continueUrl for Firebase Authentication.
 * Never uses private `ais-dev-*` URLs, which trigger Google 403 outside AI Studio preview.
 */
export function getFirebaseResetContinueUrl(): string {
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    if (origin.includes('ais-dev-')) {
      return `${origin.replace('ais-dev-', 'ais-pre-')}${base}/reset-password`;
    }
    return `${origin}${base}/reset-password`;
  }
  return `https://${firebaseAppletConfig.authDomain}/__/auth/action`;
}

export function getFirebaseResetActionSettings(): ActionCodeSettings {
  return {
    url: getFirebaseResetContinueUrl(),
    handleCodeInApp: false,
  };
}

export async function sendFirebaseAdminResetEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(
    firebaseAuth,
    email.trim(),
    getFirebaseResetActionSettings()
  );
}

export async function verifyFirebaseResetOobCode(oobCode: string): Promise<string> {
  return verifyPasswordResetCode(firebaseAuth, oobCode);
}

export async function confirmFirebaseResetAndSync(
  oobCode: string,
  newPassword: string
): Promise<{ adminId: string; message: string }> {
  const email = await verifyPasswordResetCode(firebaseAuth, oobCode);
  await confirmPasswordReset(firebaseAuth, oobCode, newPassword);

  const cred = await signInWithEmailAndPassword(firebaseAuth, email, newPassword);
  const idToken = await cred.user.getIdToken(true);
  try {
    return await apiFetch<{ ok: boolean; adminId: string; message: string }>(
      '/api/auth/sync-firebase-admin-password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ newClave: newPassword }),
      }
    );
  } finally {
    await signOut(firebaseAuth).catch(() => undefined);
  }
}

export async function syncFirebasePasswordWithBackend(
  email: string,
  password: string
): Promise<{ adminId: string; message: string }> {
  const cred = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
  const idToken = await cred.user.getIdToken(true);
  try {
    return await apiFetch<{ ok: boolean; adminId: string; message: string }>(
      '/api/auth/sync-firebase-admin-password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ newClave: password }),
      }
    );
  } finally {
    await signOut(firebaseAuth).catch(() => undefined);
  }
}

export function formatFirebaseAuthResetError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const msg = err instanceof Error ? err.message : String(err || '');

  if (code === 'auth/operation-not-allowed' || msg.includes('OPERATION_NOT_ALLOWED')) {
    return `El proveedor Correo/Contraseña todavía no está habilitado en Firebase Authentication (${firebaseAppletConfig.projectId}). Habilitalo en Firebase Console → Authentication → Sign-in method → Email/Password.`;
  }
  if (code === 'auth/unauthorized-continue-uri' || msg.includes('UNAUTHORIZED_DOMAIN')) {
    return 'El dominio de redirección no está autorizado en Firebase Authentication. Agregalo en Firebase Console → Authentication → Settings → Authorized domains.';
  }
  if (code === 'auth/expired-action-code') {
    return 'El enlace de Firebase venció. Solicitá un nuevo correo de recuperación.';
  }
  if (code === 'auth/invalid-action-code') {
    return 'El enlace de Firebase es inválido o ya fue utilizado.';
  }
  if (code === 'auth/weak-password') {
    return 'La nueva contraseña debe tener al menos 6 caracteres.';
  }
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'El email o la contraseña ingresada no coinciden con Firebase Authentication.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Demasiados intentos en Firebase. Esperá unos minutos antes de reintentar.';
  }
  return msg || 'No se pudo completar la operación con Firebase Authentication.';
}
