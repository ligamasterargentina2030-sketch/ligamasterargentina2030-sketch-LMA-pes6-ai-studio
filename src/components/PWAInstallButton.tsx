import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        title="Instalar Liga Master Argentina como aplicación en tu dispositivo"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold btn-celeste-gold rounded-lg transition-all whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-amber-300" />
        <span>Instalar App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          title="Instalar acceso directo en iPhone o iPad"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold btn-celeste-gold rounded-lg transition-all whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5 text-sky-300" />
          <span>Instalar App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-[#0B0D12] border border-amber-400/55 p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-xl font-bold text-gold-shiny">
                  Instalar en iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Cerrar instrucciones"
                  className="p-1.5 rounded-lg bg-[#141720] text-zinc-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2.5 text-xs text-zinc-200 leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="font-mono font-bold text-amber-300">1.</span>
                  <span>
                    Tocá el botón <strong className="text-white inline-flex items-center gap-1">Compartir <Share className="w-3.5 h-3.5 text-sky-300 inline" /></strong> en la barra de Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono font-bold text-amber-300">2.</span>
                  <span>
                    Deslizá hacia abajo y elegí <strong className="text-white">Agregar a pantalla de inicio</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono font-bold text-amber-300">3.</span>
                  <span>
                    Confirmá tocando <strong className="text-amber-300">Agregar</strong> para abrir la liga como App directa.
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 text-xs font-bold btn-gold-luxury rounded-lg"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
