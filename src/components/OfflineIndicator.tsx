import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-[#0B0D12]/95 border border-amber-400/70 px-3.5 py-2 text-xs font-semibold text-amber-200 shadow-2xl"
    >
      <WifiOff className="w-4 h-4 text-amber-300 shrink-0" />
      <span>Modo sin conexión · Mostrando datos guardados</span>
    </div>
  );
}
