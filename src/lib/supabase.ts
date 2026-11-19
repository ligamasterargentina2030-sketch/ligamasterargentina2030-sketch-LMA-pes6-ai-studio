import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const rawPublishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

function isForbiddenSecretKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;

  const parts = key.split('.');
  if (parts.length === 3 && parts[0].startsWith('eyJ')) {
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const payload = JSON.parse(atob(padded)) as { role?: string };
      if (payload.role === 'service_role') {
        return true;
      }
    } catch {
      // Ignore malformed JWT payloads; only explicit service_role tokens are blocked.
    }
  }

  return false;
}

const hasSecretKeyViolation = isForbiddenSecretKey(rawPublishableKey);

if (hasSecretKeyViolation) {
  console.error(
    '[Supabase] Se detectó una clave secreta o service_role en VITE_SUPABASE_PUBLISHABLE_KEY. Por seguridad, el cliente frontend fue bloqueado. Usá únicamente tu Publishable Key (sb_publishable_...).'
  );
}

const supabaseUrl = rawUrl;
const supabasePublishableKey = hasSecretKeyViolation ? '' : rawPublishableKey;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      hasSecretKeyViolation
        ? 'Clave inválida para frontend: no uses claves secretas ni service_role.'
        : 'Supabase no está configurado. Definí VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en tu archivo .env.local.'
    );
  }
  return supabase;
}

export interface SupabaseConnectionResult {
  ok: boolean;
  configured: boolean;
  message: string;
  url?: string;
  status?: number;
}

export async function checkSupabaseConnection(): Promise<SupabaseConnectionResult> {
  if (hasSecretKeyViolation) {
    return {
      ok: false,
      configured: false,
      message:
        'Bloqueado por seguridad: se ingresó una clave secreta o service_role. Usá únicamente la Publishable Key (sb_publishable_...).',
    };
  }

  if (!supabase || !supabaseUrl || !supabasePublishableKey) {
    return {
      ok: false,
      configured: false,
      message:
        'Faltan variables de entorno: configurá VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en .env.local.',
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        apikey: supabasePublishableKey,
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        configured: true,
        url: supabaseUrl,
        status: response.status,
        message: `Supabase respondió con estado HTTP ${response.status}. Verificá que VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY sean correctos.`,
      };
    }

    const { error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      return {
        ok: false,
        configured: true,
        url: supabaseUrl,
        status: response.status,
        message: `Conexión HTTP OK, pero auth.getSession() devolvió error: ${sessionError.message}`,
      };
    }

    return {
      ok: true,
      configured: true,
      url: supabaseUrl,
      status: response.status,
      message: 'Conexión exitosa con Supabase usando la Publishable Key.',
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      configured: true,
      url: supabaseUrl,
      message: `No se pudo conectar con Supabase (${detail}). Revisá la URL del proyecto y tu conexión.`,
    };
  }
}

declare global {
  interface Window {
    checkSupabaseConnection?: () => Promise<SupabaseConnectionResult>;
  }
}

if (typeof window !== 'undefined') {
  window.checkSupabaseConnection = checkSupabaseConnection;
}
