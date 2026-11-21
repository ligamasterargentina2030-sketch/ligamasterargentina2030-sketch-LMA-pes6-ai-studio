import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error?.message || 'Error inesperado en la aplicación.';
    if (readable.startsWith('{')) {
      try {
        const parsed = JSON.parse(readable) as { error?: string; path?: string; operationType?: string };
        if (parsed.error) {
          readable = `Error de Firestore (${parsed.operationType || 'operación'} en ${parsed.path || 'base'}): ${parsed.error}`;
        }
      } catch {
        // ignore JSON parse errors
      }
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary captured error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050608] text-white flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#071D38] border-2 border-amber-400/70 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-300">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="font-display text-2xl font-bold">
                Problema de sincronización o permisos
              </h1>
            </div>
            <p className="text-sm text-sky-100 leading-relaxed break-words">
              {this.state.message}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold btn-gold-luxury rounded-lg"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recargar aplicación</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
