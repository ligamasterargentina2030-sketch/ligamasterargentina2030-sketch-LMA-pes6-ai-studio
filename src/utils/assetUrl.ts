import championCelebrationDefault from '../assets/images/champion_celebration_default_1794642902876.jpg';
import heroCabraMessiArgentina from '../assets/images/hero_cabra_messi_argentina_1794730196481.jpg';
import heroCabraMessiCopa from '../assets/images/hero_cabra_messi_copa_1794642901898.jpg';
import heroCabraMessiHd from '../assets/images/hero_cabra_messi_hd_1794813291066.jpg';
import heroCabraSolBandera from '../assets/images/hero_cabra_sol_bandera_1794730623048.jpg';
import iconoLiga3dHd from '../assets/images/icono_liga_3d_hd_1794813291158.jpg';
import iconoLigaHd from '../assets/images/icono_liga_hd_1794645294665.jpg';
import leagueCrestArgentina from '../assets/images/league_crest_argentina_1794642900932.jpg';
import trophyCopaLiga3d from '../assets/images/trophy_copa_liga_3d_1794813289242.jpg';
import trophyRecopa3d from '../assets/images/trophy_recopa_3d_1794813289206.jpg';

const BUNDLED_DEFAULT_ASSETS: Record<string, string> = {
  '/default-assets/champion_celebration_default_1794642902876.jpg': championCelebrationDefault,
  '/default-assets/hero_cabra_messi_argentina_1794730196481.jpg': heroCabraMessiArgentina,
  '/default-assets/hero_cabra_messi_copa_1794642901898.jpg': heroCabraMessiCopa,
  '/default-assets/hero_cabra_messi_hd_1794813291066.jpg': heroCabraMessiHd,
  '/default-assets/hero_cabra_sol_bandera_1794730623048.jpg': heroCabraSolBandera,
  '/default-assets/icono_liga_3d_hd_1794813291158.jpg': iconoLiga3dHd,
  '/default-assets/icono_liga_hd_1794645294665.jpg': iconoLigaHd,
  '/default-assets/league_crest_argentina_1794642900932.jpg': leagueCrestArgentina,
  '/default-assets/trophy_copa_liga_3d_1794813289242.jpg': trophyCopaLiga3d,
  '/default-assets/trophy_recopa_3d_1794813289206.jpg': trophyRecopa3d,
};

/**
 * Resolves static asset URLs so they work both at root (`/`) and under a
 * GitHub Pages repository subdirectory (e.g., `/LMA-pes6-ai-studio/`).
 */
export function resolveAssetUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // External, protocol-relative, data, or blob URLs remain untouched
  if (/^(https?:\/\/|data:|blob:|\/\/)/i.test(trimmed)) {
    return trimmed;
  }

  // Bundled default assets from src/assets/images (works on static GitHub Pages)
  const cleanLookup = trimmed.split('?')[0];
  if (cleanLookup in BUNDLED_DEFAULT_ASSETS) {
    return BUNDLED_DEFAULT_ASSETS[cleanLookup];
  }

  // Keep backend API paths untouched
  if (trimmed.startsWith('/api/')) {
    return trimmed;
  }

  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;

  // Already prefixed with Vite's BASE_URL
  if (normalizedBase !== '/' && trimmed.startsWith(normalizedBase)) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    return `${normalizedBase}${trimmed.slice(1)}`;
  }

  if (trimmed.startsWith('./')) {
    return `${normalizedBase}${trimmed.slice(2)}`;
  }

  return trimmed;
}

const DEFAULT_CREST_PALETTE: Record<string, [string, string]> = {
  ADM01: ['#0284C7', '#FACC15'],
  LMA01: ['#003DA5', '#FFD100'],
  LMA02: ['#FFFFFF', '#D50032'],
  LMA03: ['#38BDF8', '#FFFFFF'],
  LMA04: ['#DC2626', '#FFFFFF'],
  LMA05: ['#1D4ED8', '#DC2626'],
  LMA06: ['#FACC15', '#1E3A8A'],
  LMA07: ['#DC2626', '#111827'],
  LMA08: ['#FFFFFF', '#1D4ED8'],
  LMA09: ['#DC2626', '#FFFFFF'],
  LMA10: ['#0284C7', '#FFFFFF'],
};

/**
 * Generates an inline SVG data URI matching the server's `/api/crest/:teamId.svg`
 * so club crests render identically when hosted statically on GitHub Pages.
 */
export function buildInlineTeamCrestSvg(
  teamId: string,
  teamName?: string,
  primaryColor?: string,
  secondaryColor?: string
): string {
  const fallbackColors = DEFAULT_CREST_PALETTE[teamId] || ['#0284C7', '#FFFFFF'];
  const primary = primaryColor || fallbackColors[0];
  const secondary = secondaryColor || fallbackColors[1];
  const initials =
    (teamName || teamId)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || 'LMA';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><clipPath id="s"><path d="M18 14 H110 V64 C110 92 64 116 64 116 C64 116 18 92 18 64 Z"/></clipPath></defs><path d="M14 10 H114 V64 C114 96 64 122 64 122 C64 122 14 96 14 64 Z" fill="#0F172A" stroke="#CBD5E1" stroke-width="3"/><g clip-path="url(#s)"><rect x="18" y="14" width="92" height="104" fill="${primary}"/><rect x="49" y="14" width="30" height="104" fill="${secondary}"/></g><rect x="26" y="43" width="76" height="36" rx="6" fill="#0F172A" fill-opacity="0.88" stroke="#38BDF8" stroke-width="2"/><text x="64" y="68" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-weight="800" font-size="22">${initials}</text></svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
