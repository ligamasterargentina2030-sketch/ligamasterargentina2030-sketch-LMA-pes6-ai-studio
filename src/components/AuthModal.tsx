import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Mail, ShieldCheck, X } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { resolveOrLinkFirebaseMember } from '../services/firestoreLeague';
import type { AuthUser } from '../types';
import { apiFetch, setStoredToken } from '../utils/api';
import {
  formatFirebaseAuthResetError,
  sendFirebaseAdminResetEmail,
} from '../utils/firebaseAuthReset';

interface AuthModalProps {
  open: boolean;
  prefillId?: string;
  staticHostingMode?: boolean;
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

export function AuthModal({
  open,
  prefillId,
  staticHostingMode = false,
  onClose,
  onSuccess,
}: AuthModalProps) {
  const [id, setId] = useState(prefillId || '');
  const [clave, setClave] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin-only recovery state
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [sendingReset, setSendingReset] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [resetSentMessage, setResetSentMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (prefillId) {
      setId(prefillId);
    }
  }, [prefillId]);

  if (!open) return null;

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const u = cred.user;
      if (!u || !u.email) {
        throw new Error('No se pudo obtener el correo de la cuenta de Google.');
      }
      const linked = await resolveOrLinkFirebaseMember(
        u.uid,
        u.email,
        u.displayName || u.email
      );
      const authUser: AuthUser = {
        id: linked?.id || u.uid,
        role: linked?.role || 'member',
        displayName: linked?.displayName || u.displayName || u.email,
        teamId: linked?.teamId,
        uid: u.uid,
        email: u.email,
        firebaseAuthenticated: true,
      };
      onSuccess(authUser);
      setRecoveryOpen(false);
      setResetSentMessage(null);
      setRecoveryError(null);
      onClose();
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setError('Se cerró la ventana de acceso con Google antes de completar el ingreso.');
      } else if (code === 'auth/popup-blocked') {
        setError('El navegador bloqueó la ventana emergente de Google. Permití ventanas emergentes para este sitio.');
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ id: id.trim(), clave }),
      });
      setStoredToken(res.token);
      onSuccess(res.user);
      setId('');
      setClave('');
      setRecoveryOpen(false);
      setResetSentMessage(null);
      setRecoveryError(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendFirebaseReset = async (e: FormEvent) => {
    e.preventDefault();
    setRecoveryError(null);
    setResetSentMessage(null);
    setSendingReset(true);

    try {
      await apiFetch<{ authorized: boolean }>('/api/auth/verify-admin-recovery-email', {
        method: 'POST',
        body: JSON.stringify({ email: recoveryEmail.trim() }),
      });

      await sendFirebaseAdminResetEmail(recoveryEmail.trim());
      setResetSentMessage(
        'Enlace de recuperación enviado al correo del Administrador. Revisá tu casilla (Recibidos o Spam), abrí el enlace para definir tu nueva contraseña y volvé a ingresar.'
      );
      setRecoveryEmail('');
    } catch (err) {
      setRecoveryError(formatFirebaseAuthResetError(err));
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <div className="w-full max-w-md bg-[#071D38] border-2 border-amber-400/70 rounded-2xl shadow-2xl overflow-hidden text-white max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A] text-white border-b border-amber-400/45">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-5 h-5 text-amber-300" />
            <h2 className="font-display text-2xl font-bold tracking-tight text-albiceleste-shiny">
              Ingresar a Cuenta
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="p-1.5 text-sky-200 hover:text-amber-300 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-sm font-medium text-rose-200 bg-rose-950/60 border border-rose-500/40 rounded-lg leading-relaxed">
              {error}
            </div>
          )}

          {/* Acceso Principal Cloud Firestore via Google Firebase Auth */}
          <div className="p-4 rounded-xl bg-[#05162B] border border-emerald-400/45 space-y-2.5">
            <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Acceso Oficial en la Nube (Cloud Firestore)</span>
            </div>
            <p className="text-[11px] text-sky-200/85 leading-relaxed">
              Recomendado para Administrador y Miembros: permite guardar resultados, cambios, comentarios y sincronización en tiempo real en toda la liga.
            </p>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-zinc-100 text-zinc-900 font-bold text-sm flex items-center justify-center gap-2.5 shadow-md transition-all disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.37 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>{googleLoading ? 'Conectando con Google...' : 'Ingresar con Google (Firebase Auth)'}</span>
            </button>
          </div>

          <div className="relative flex items-center py-1">
            <div className="flex-grow border-t border-amber-400/20" />
            <span className="px-3 text-[11px] font-semibold text-sky-200/70 uppercase tracking-wider">
              o acceso con ID y Clave
            </span>
            <div className="flex-grow border-t border-amber-400/20" />
          </div>

          {staticHostingMode && (
            <div className="p-3 text-xs text-amber-100 bg-amber-950/60 border border-amber-400/50 rounded-lg leading-relaxed">
              <strong>Modo estático detectado:</strong> Usá el botón <strong>Ingresar con Google</strong> de arriba para sincronizar tus datos directo en Cloud Firestore sin depender del servidor local.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="block text-xs font-semibold text-sky-200 mb-1.5"
                htmlFor="login-id"
              >
                ID de usuario
              </label>
              <input
                id="login-id"
                type="text"
                required
                autoComplete="username"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="Ingresá tu ID de usuario"
                className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
              />
            </div>

            <div>
              <label
                className="block text-xs font-semibold text-sky-200 mb-1.5"
                htmlFor="login-clave"
              >
                Contraseña
              </label>
              <input
                id="login-clave"
                type="password"
                required
                autoComplete="current-password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="Ingresá tu contraseña"
                className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-sky-200 hover:text-white rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || googleLoading}
                className="px-6 py-2.5 text-sm font-bold btn-gold-luxury disabled:opacity-60 rounded-lg"
              >
                {loading ? 'VERIFICANDO...' : 'INGRESAR'}
              </button>
            </div>
          </form>

          {/* Recuperación exclusiva para cuenta del Administrador */}
          <div className="pt-3 border-t border-amber-400/20 space-y-2.5">
            <button
              type="button"
              onClick={() => {
                setRecoveryOpen((v) => !v);
                setRecoveryError(null);
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1 text-[11px] font-semibold text-amber-300/90 hover:text-amber-200 transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>
                {recoveryOpen
                  ? 'Ocultar recuperación de Administrador'
                  : 'Recuperar contraseña del Administrador'}
              </span>
            </button>

            {recoveryOpen && (
              <form
                onSubmit={handleSendFirebaseReset}
                className="p-4 rounded-xl bg-[#05162B] border border-amber-400/40 space-y-3"
              >
                <p className="text-xs text-sky-100 leading-relaxed">
                  Exclusivo para el Administrador: ingresá el correo electrónico de recuperación configurado en tu cuenta administrativa.
                </p>

                {recoveryError && (
                  <div className="p-2.5 text-xs text-rose-200 bg-rose-950/60 border border-rose-500/40 rounded-lg leading-relaxed">
                    {recoveryError}
                  </div>
                )}

                {resetSentMessage && (
                  <div className="p-3 text-xs text-emerald-100 bg-emerald-950/60 border border-emerald-400/40 rounded-lg space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>¡Correo de recuperación enviado!</span>
                    </div>
                    <p className="leading-relaxed">{resetSentMessage}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="Correo de recuperación del Admin..."
                    className="flex-1 px-3 py-2 text-xs bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                  <button
                    type="submit"
                    disabled={sendingReset}
                    className="px-3.5 py-2 text-xs btn-gold-luxury disabled:opacity-60 rounded-lg whitespace-nowrap"
                  >
                    {sendingReset ? 'Enviando...' : 'Enviar enlace'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
