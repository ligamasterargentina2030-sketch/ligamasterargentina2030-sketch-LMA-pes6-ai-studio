import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Mail, ShieldCheck, UserPlus, X } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { resolveOrLinkFirebaseMember } from '../services/firestoreLeague';
import type { AuthUser, PublicTeam } from '../types';
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
  onSuccess: (user: AuthUser, createdTeam?: PublicTeam) => void;
}

export function AuthModal({
  open,
  prefillId,
  staticHostingMode = false,
  onClose,
  onSuccess,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [id, setId] = useState(prefillId || '');
  const [clave, setClave] = useState('');
  const [regMemberName, setRegMemberName] = useState('');
  const [regTeamName, setRegTeamName] = useState('');
  const [regCustomId, setRegCustomId] = useState('');
  const [regClave, setRegClave] = useState('');
  const [regClaveConfirm, setRegClaveConfirm] = useState('');
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
      } else if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'este dominio';
        setError(
          `Este dominio público ("${host}") todavía no está autorizado en Firebase Authentication. Agregalo en Firebase Console -> Authentication -> Settings -> Authorized domains, o ingresá arriba con tu ID y Clave.`
        );
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

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (regClave !== regClaveConfirm) {
      setError('Las contraseñas no coinciden. Verificalas antes de continuar.');
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser; team?: PublicTeam }>(
        '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({
            memberName: regMemberName.trim(),
            teamName: regTeamName.trim(),
            id: regCustomId.trim() || undefined,
            clave: regClave,
          }),
        }
      );
      setStoredToken(res.token);
      onSuccess(res.user, res.team);
      setRegMemberName('');
      setRegTeamName('');
      setRegCustomId('');
      setRegClave('');
      setRegClaveConfirm('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear tu cuenta.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md glass-lma-card border-2 border-yellow-400/80 rounded-2xl shadow-[0_0_50px_rgba(250,204,21,0.22),0_24px_60px_rgba(0,0,0,0.9)] overflow-hidden text-white max-h-[92vh] overflow-y-auto">
        <div className="h-1 w-full albiceleste-ribbon" aria-hidden="true" />
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-black/75 via-[#08264A]/65 to-black/75 text-white border-b border-yellow-400/45">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-yellow-400 text-zinc-950 shadow-[0_0_16px_rgba(250,204,21,0.8)]">
              {mode === 'register' ? <UserPlus className="w-5 h-5" /> : <KeyRound className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-lma-title">
                {mode === 'register' ? 'Crear Cuenta Nueva' : 'Ingresar a Cuenta'}
              </h2>
              <p className="text-[11px] text-sky-200/90">
                {mode === 'register'
                  ? 'Registro abierto para cualquier visitante o nuevo jugador'
                  : 'Acceso con tu ID y Clave (Miembros y Administrador)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="p-1.5 text-sky-200 hover:text-yellow-300 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Selector Iniciar Sesión / Registrarse */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/60 border border-yellow-400/35">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 text-xs font-extrabold rounded-lg transition-all ${
                mode === 'login'
                  ? 'bg-yellow-400 text-zinc-950 shadow-[0_0_14px_rgba(250,204,21,0.5)]'
                  : 'text-sky-200 hover:text-white'
              }`}
            >
              Ingresar
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-2 text-xs font-extrabold rounded-lg transition-all ${
                mode === 'register'
                  ? 'bg-yellow-400 text-zinc-950 shadow-[0_0_14px_rgba(250,204,21,0.5)]'
                  : 'text-sky-200 hover:text-white'
              }`}
            >
              Registrarse
            </button>
          </div>

          {error && (
            <div className="p-3 text-sm font-medium text-rose-100 bg-rose-950/75 border border-rose-400/55 rounded-lg leading-relaxed">
              {error}
            </div>
          )}

          {staticHostingMode && (
            <div className="p-3 text-xs text-amber-100 bg-amber-950/65 border border-amber-400/55 rounded-lg leading-relaxed">
              <strong>Modo estático detectado:</strong> Si no hay servidor API conectado (`VITE_API_BASE_URL`), podés usar <strong>Ingresar con Google</strong> abajo para registrarte o acceder directamente vía Cloud Firestore.
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleSubmit} className="p-4 rounded-xl bg-black/50 border border-yellow-400/55 space-y-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-yellow-300">
                  Iniciar Sesión con ID y Clave
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-400/15 border border-sky-300/35 text-sky-200">
                  Admin · Miembros
                </span>
              </div>

              <div>
                <label
                  className="block text-xs font-semibold text-white mb-1.5"
                  htmlFor="login-id"
                >
                  ID de usuario
                </label>
                <input
                  id="login-id"
                  type="text"
                  required
                  autoFocus
                  autoComplete="username"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="Ej: LMA01 o ID de Administrador"
                  className="w-full px-3.5 py-2.5 text-sm bg-black/70 text-white placeholder:text-zinc-400 border border-yellow-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono"
                />
              </div>

              <div>
                <label
                  className="block text-xs font-semibold text-white mb-1.5"
                  htmlFor="login-clave"
                >
                  Clave / Contraseña
                </label>
                <input
                  id="login-clave"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  placeholder="Ingresá tu clave secreta"
                  className="w-full px-3.5 py-2.5 text-sm bg-black/70 text-white placeholder:text-zinc-400 border border-yellow-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
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
                  className="px-6 py-2.5 text-sm font-extrabold bg-yellow-400 hover:bg-yellow-300 text-zinc-950 border border-yellow-200 shadow-[0_0_20px_rgba(250,204,21,0.65)] disabled:opacity-60 rounded-lg transition-all"
                >
                  {loading ? 'VERIFICANDO...' : 'INGRESAR CON ID Y CLAVE'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="p-4 rounded-xl bg-black/50 border border-yellow-400/55 space-y-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-yellow-300">
                  Registro Rápido de Miembro
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-400/15 border border-emerald-300/35 text-emerald-200">
                  Acceso Inmediato
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-white mb-1" htmlFor="reg-member">
                    Tu Nombre / Apodo *
                  </label>
                  <input
                    id="reg-member"
                    type="text"
                    required
                    minLength={2}
                    maxLength={60}
                    value={regMemberName}
                    onChange={(e) => setRegMemberName(e.target.value)}
                    placeholder="Ej: Marcos 10"
                    className="w-full px-3 py-2 text-sm bg-black/70 text-white placeholder:text-zinc-400 border border-yellow-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-white mb-1" htmlFor="reg-team">
                    Nombre de tu Club *
                  </label>
                  <input
                    id="reg-team"
                    type="text"
                    required
                    minLength={2}
                    maxLength={60}
                    value={regTeamName}
                    onChange={(e) => setRegTeamName(e.target.value)}
                    placeholder="Ej: Boca PES6"
                    className="w-full px-3 py-2 text-sm bg-black/70 text-white placeholder:text-zinc-400 border border-yellow-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-white mb-1" htmlFor="reg-id">
                  ID de Usuario (opcional — automático si lo dejás vacío)
                </label>
                <input
                  id="reg-id"
                  type="text"
                  maxLength={24}
                  value={regCustomId}
                  onChange={(e) => setRegCustomId(e.target.value.toUpperCase())}
                  placeholder="Ej: MARCOS10 (o dejalo libre para LMAxx)"
                  className="w-full px-3 py-2 text-sm bg-black/70 text-white placeholder:text-zinc-400 border border-yellow-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-white mb-1" htmlFor="reg-clave">
                    Clave (mín. 4) *
                  </label>
                  <input
                    id="reg-clave"
                    type="password"
                    required
                    minLength={4}
                    maxLength={64}
                    autoComplete="new-password"
                    value={regClave}
                    onChange={(e) => setRegClave(e.target.value)}
                    placeholder="Elegí tu contraseña"
                    className="w-full px-3 py-2 text-sm bg-black/70 text-white placeholder:text-zinc-400 border border-yellow-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-white mb-1" htmlFor="reg-clave2">
                    Repetir Clave *
                  </label>
                  <input
                    id="reg-clave2"
                    type="password"
                    required
                    minLength={4}
                    maxLength={64}
                    autoComplete="new-password"
                    value={regClaveConfirm}
                    onChange={(e) => setRegClaveConfirm(e.target.value)}
                    placeholder="Repetí tu clave"
                    className="w-full px-3 py-2 text-sm bg-black/70 text-white placeholder:text-zinc-400 border border-yellow-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>
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
                  className="px-5 py-2.5 text-sm font-extrabold bg-yellow-400 hover:bg-yellow-300 text-zinc-950 border border-yellow-200 shadow-[0_0_20px_rgba(250,204,21,0.65)] disabled:opacity-60 rounded-lg transition-all"
                >
                  {loading ? 'CREANDO CUENTA...' : 'CREAR MI CUENTA Y ENTRAR'}
                </button>
              </div>
            </form>
          )}

          <div className="relative flex items-center py-0.5">
            <div className="flex-grow border-t border-sky-400/25" />
            <span className="px-3 text-[11px] font-semibold text-sky-200/80 uppercase tracking-wider">
              o acceso en la nube con Google
            </span>
            <div className="flex-grow border-t border-sky-400/25" />
          </div>

          {/* Acceso Complementario Cloud Firestore via Google Firebase Auth */}
          <div className="p-3.5 rounded-xl bg-black/40 border border-sky-400/40 space-y-2">
            <div className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Google Auth (Sincronización total Cloud Firestore)</span>
            </div>
            <p className="text-[11px] text-zinc-200/85 leading-relaxed">
              Si tu correo está autorizado, vinculá Google para guardar partidos, Me Gusta y administración en tiempo real.
            </p>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              className="w-full py-2.5 px-4 rounded-lg bg-white hover:bg-zinc-100 text-zinc-950 font-bold text-sm flex items-center justify-center gap-2.5 shadow-md transition-all disabled:opacity-60"
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

          {/* Recuperación exclusiva para cuenta del Administrador */}
          <div className="pt-2 border-t border-amber-400/20 space-y-2.5">
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
                className="p-4 rounded-xl bg-black/55 border border-amber-400/40 space-y-3"
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
                    className="flex-1 px-3 py-2 text-xs bg-black/70 text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
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
