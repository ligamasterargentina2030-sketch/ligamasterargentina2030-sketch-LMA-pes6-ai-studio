import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import {
  confirmFirebaseResetAndSync,
  formatFirebaseAuthResetError,
  syncFirebasePasswordWithBackend,
  verifyFirebaseResetOobCode,
} from '../utils/firebaseAuthReset';

interface ResetPasswordViewProps {
  oobCode: string | null;
  onComplete: (adminId?: string) => void;
}

export function ResetPasswordView({ oobCode, onComplete }: ResetPasswordViewProps) {
  const [verifying, setVerifying] = useState(Boolean(oobCode));
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ adminId: string; message: string } | null>(null);

  // Sync-only fallback when user comes back from Firebase's hosted __/auth/action page without oobCode
  const [syncEmail, setSyncEmail] = useState('');
  const [syncPassword, setSyncPassword] = useState('');

  useEffect(() => {
    if (!oobCode) {
      setVerifying(false);
      return;
    }

    let cancelled = false;
    setVerifying(true);
    setCodeError(null);

    verifyFirebaseResetOobCode(oobCode)
      .then((email) => {
        if (!cancelled) {
          setVerifiedEmail(email);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCodeError(formatFirebaseAuthResetError(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setVerifying(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [oobCode]);

  const handleConfirmReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!oobCode) return;

    setSubmitError(null);
    if (newPassword.trim().length < 6) {
      setSubmitError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSubmitError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await confirmFirebaseResetAndSync(oobCode, newPassword.trim());
      setSuccessInfo({ adminId: result.adminId, message: result.message });
    } catch (err) {
      setSubmitError(formatFirebaseAuthResetError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncAfterHostedReset = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await syncFirebasePasswordWithBackend(syncEmail, syncPassword);
      setSuccessInfo({ adminId: result.adminId, message: result.message });
    } catch (err) {
      setSubmitError(formatFirebaseAuthResetError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-[#071D38] border-2 border-amber-400/70 rounded-2xl shadow-2xl overflow-hidden text-white">
        <div className="px-6 py-4 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A] border-b border-amber-400/45 flex items-center gap-2.5">
          <KeyRound className="w-5 h-5 text-amber-300" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-albiceleste-shiny">
            Restablecer Contraseña de Administrador
          </h1>
        </div>

        <div className="p-6 space-y-5">
          {verifying ? (
            <div className="p-4 text-sm text-sky-100 bg-[#05162B] border border-amber-400/45 rounded-xl text-center">
              Verificando enlace seguro de Firebase Authentication...
            </div>
          ) : successInfo ? (
            <div className="p-5 bg-emerald-950/60 border border-emerald-400/40 rounded-xl space-y-4 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-300 mx-auto" />
              <div className="space-y-1.5">
                <h2 className="font-display text-xl font-bold text-emerald-200">
                  ¡OK! Todo listo
                </h2>
                <p className="text-sm text-emerald-100 leading-relaxed">
                  {successInfo.message}
                </p>
                <p className="text-xs text-emerald-200/80 font-mono">
                  ID de Administrador: <strong className="text-white">{successInfo.adminId}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => onComplete(successInfo.adminId)}
                className="w-full py-2.5 px-4 text-sm btn-gold-luxury rounded-lg"
              >
                Volver a Ingresar a Cuenta
              </button>
            </div>
          ) : oobCode && codeError ? (
            <div className="space-y-4">
              <div className="p-4 text-sm text-rose-200 bg-rose-950/60 border border-rose-500/40 rounded-xl">
                {codeError}
              </div>
              <button
                type="button"
                onClick={() => onComplete()}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm btn-celeste-gold rounded-lg transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver a la Liga</span>
              </button>
            </div>
          ) : oobCode ? (
            <form onSubmit={handleConfirmReset} className="space-y-4">
              <div className="p-3 bg-[#05162B] border border-amber-400/45 rounded-xl text-xs text-sky-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-300 shrink-0" />
                <span>
                  Cuenta verificada por Firebase: <strong className="text-white">{verifiedEmail}</strong>
                </span>
              </div>

              {submitError && (
                <div className="p-3 text-sm text-rose-200 bg-rose-950/60 border border-rose-500/40 rounded-lg">
                  {submitError}
                </div>
              )}

              <div>
                <label
                  className="block text-xs font-semibold text-sky-200 mb-1.5"
                  htmlFor="reset-new-pass"
                >
                  Nueva Contraseña
                </label>
                <div className="relative">
                  <input
                    id="reset-new-pass"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full px-3.5 py-2.5 pr-10 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sky-200 hover:text-amber-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  className="block text-xs font-semibold text-sky-200 mb-1.5"
                  htmlFor="reset-confirm-pass"
                >
                  Confirmar Nueva Contraseña
                </label>
                <input
                  id="reset-confirm-pass"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repetí la nueva contraseña"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 text-sm btn-gold-luxury disabled:opacity-60 rounded-lg"
              >
                {submitting ? 'Guardando nueva contraseña...' : 'Guardar Nueva Contraseña'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-3.5 bg-[#05162B] border border-amber-400/45 rounded-xl text-xs text-sky-100 leading-relaxed">
                Si ya restableciste tu contraseña desde la página segura de Firebase Authentication, podés volver directamente a <strong className="text-amber-300">Ingresar a Cuenta</strong> con tu ID de Administrador y tu nueva contraseña, o validarla acá abajo.
              </div>

              {submitError && (
                <div className="p-3 text-xs text-rose-200 bg-rose-950/60 border border-rose-500/40 rounded-lg">
                  {submitError}
                </div>
              )}

              <form onSubmit={handleSyncAfterHostedReset} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-sky-200 mb-1" htmlFor="sync-email">
                    Email de Administrador en Firebase
                  </label>
                  <input
                    id="sync-email"
                    type="email"
                    required
                    value={syncEmail}
                    onChange={(e) => setSyncEmail(e.target.value)}
                    placeholder="Email de respaldo del Administrador"
                    className="w-full px-3.5 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-sky-200 mb-1" htmlFor="sync-pass">
                    Nueva Contraseña creada
                  </label>
                  <input
                    id="sync-pass"
                    type="password"
                    required
                    minLength={6}
                    value={syncPassword}
                    onChange={(e) => setSyncPassword(e.target.value)}
                    placeholder="Tu nueva contraseña de Firebase"
                    className="w-full px-3.5 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 text-sm btn-gold-luxury disabled:opacity-60 rounded-lg"
                >
                  {submitting ? 'Verificando...' : 'Confirmar y Sincronizar Clave'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => onComplete()}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm btn-celeste-gold rounded-lg transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver a Ingresar a Cuenta</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
