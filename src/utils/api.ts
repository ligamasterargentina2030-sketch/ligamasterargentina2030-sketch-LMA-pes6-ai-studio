const TOKEN_KEY = 'lma_pes6_auth_token';

const CONFIGURED_API_BASE = (
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL)
    : ''
)
  .trim()
  .replace(/\/+$/, '');

export function resolveApiUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (CONFIGURED_API_BASE && url.startsWith('/api')) {
    return `${CONFIGURED_API_BASE}${url}`;
  }
  return url;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function summarizeNonJsonBody(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';
  if (/^<!doctype|^<html/i.test(trimmed)) {
    const preMatch = trimmed.match(/<pre>([\s\S]*?)<\/pre>/i);
    if (preMatch?.[1]) {
      return preMatch[1].replace(/\s+/g, ' ').trim().slice(0, 140);
    }
    const titleMatch = trimmed.match(/<title>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) {
      return titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 100);
    }
    return '';
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, 160);
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const targetUrl = resolveApiUrl(url);
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      cache: 'no-store',
      ...options,
      headers,
    });
  } catch (networkErr) {
    const detail = networkErr instanceof Error ? networkErr.message : String(networkErr || '');
    throw new Error(
      `No se pudo conectar con el servidor (${targetUrl})${detail ? `: ${detail}` : '.'}`
    );
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (data && typeof data === 'object') {
      const record = data as { error?: unknown; message?: unknown };
      if (typeof record.error === 'string' && record.error.trim()) {
        throw new Error(record.error.trim());
      }
      if (typeof record.message === 'string' && record.message.trim()) {
        throw new Error(record.message.trim());
      }
    }

    const bodySnippet = summarizeNonJsonBody(text);
    const isHtmlResponse = /^\s*<(?:!doctype|html)/i.test(text);

    if (
      targetUrl.includes('/api/') &&
      (response.status === 405 || (response.status === 404 && isHtmlResponse))
    ) {
      throw new Error(
        `El servidor actual no responde a las rutas API (HTTP ${response.status}). Estás viendo una versión estática (sin servidor Express activo), por lo que el inicio de sesión no puede validarse desde esta URL; usá la URL publicada de la aplicación con servidor activo.`
      );
    }

    if (response.status === 413) {
      throw new Error('Los datos o archivos enviados superan el tamaño máximo permitido (HTTP 413).');
    }

    const statusInfo = response.statusText
      ? `HTTP ${response.status} (${response.statusText})`
      : `HTTP ${response.status}`;
    throw new Error(
      bodySnippet ? `Error del servidor ${statusInfo}: ${bodySnippet}` : `Error del servidor (${statusInfo}).`
    );
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Respuesta inválida del servidor (se esperaba JSON válido).');
  }

  return data as T;
}
