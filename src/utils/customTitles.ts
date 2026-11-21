import type { CustomTitles, LeagueSettings } from '../types';

export const DEFAULT_CUSTOM_TITLES = {
  // Menú principal
  navInicio: 'Inicio',
  navPosiciones: 'Posiciones',
  navPartidos: 'Partidos',
  navCopas: 'Copas',
  navCalendario: 'Calendario',
  navGaleria: 'Galería',
  navReglamento: 'Reglamento',
  navPerfil: 'Mi Perfil',

  // Nombres de Competencias (Liga, Copas, Recopa)
  compLigaName: 'Liga Argentina',
  compCopaName: 'Copa de la Liga',
  compRecopaName: 'Recopa Argentina',
  compRecopaSubtitle: 'Campeón de Liga vs Copa',

  // Secciones del Inicio
  homeNewsTitle: 'Noticias! Últimas Novedades',
  homeChampionsTitle: 'Historial de Campeones',
  homeFeaturedVideoTitle: 'Video Más Destacado',
  homeTopGoalsTitle: 'Top 5 Mejores Goles',
  homeLeadersTitle: 'Punteros del Torneo',
  homeLeadersSubtitle: 'Clasificación oficial actualizada tras cada validación',
  homeRecentMatchesTitle: 'Últimos Resultados',
  homeCommentsTitle: 'Comentarios de la Liga',
  homeCommentsSubtitle:
    'Dejá tu mensaje para la comunidad. Solo el Administrador puede aprobar o eliminar comentarios.',
  homeSocialTitle: 'Siguenos en nuestras redes sociales. Gracias Te queremos.',

  // Secciones principales de cada pestaña
  standingsBadge: 'Campeonato Oficial · Primera División',
  standingsTitle: 'Tabla de Posiciones · Liga Argentina',
  matchesTitle: 'Partidos, Cruces, Resultados y Reclamos',
  matchesSubtitle:
    'Consultá las fechas, subí tu resultado con foto del goleador o enviá un reclamo con pruebas y video .MP4.',
  copasPageTitle: 'Copas Oficiales · Llaves de Copa de la Liga y Recopa',
  copasPageSubtitle:
    'Seguí el cuadro completo de eliminación directa desde Octavos hasta la Gran Final y la Recopa Argentina.',
  calendarTitle: 'Calendario Oficial · Liga & Copa de la Liga',
  calendarSubtitle:
    'Sincronizado en tiempo real con el día, mes, año, hora actual y los partidos con escudos programados por el Administrador.',
  galleryTitle: 'Galería y Historial de Campeones',
  gallerySubtitle:
    'Subí tus jugadas exclusivamente en formato .MP4 con Uploadcare y mirá todos los videos en tiempo real. Solo el Administrador puede eliminar videos.',
  rulesTitle: 'Reglamento y Modo de Juego',
  rulesSubtitle:
    'Normativa oficial de competencia y configuración obligatoria de sala en Pro Evolution Soccer 6.',
  rulesLeagueSectionTitle: 'Reglas de la Liga (Conductas Prohibidas)',
  rulesGameModeTitle: 'Modo de Juego PES6',
  rulesCupSectionTitle: 'Reglas de la Copa de la Liga y Recopa',
} as const;

export type CustomTitleKey = keyof typeof DEFAULT_CUSTOM_TITLES;

export interface CustomTitleFieldMeta {
  key: CustomTitleKey;
  label: string;
}

export interface CustomTitleGroup {
  id: string;
  title: string;
  description: string;
  fields: CustomTitleFieldMeta[];
}

export const CUSTOM_TITLE_GROUPS: CustomTitleGroup[] = [
  {
    id: 'competitions',
    title: 'Nombres de Liga, Copas y Recopa',
    description: 'Se aplican en las tablas, tarjetas de copas, partidos, historial y calendario.',
    fields: [
      { key: 'compLigaName', label: 'Nombre de la Liga Principal' },
      { key: 'compCopaName', label: 'Nombre de la Copa Principal' },
      { key: 'compRecopaName', label: 'Nombre de la Recopa / Supercopa' },
      { key: 'compRecopaSubtitle', label: 'Subtítulo de la Recopa' },
    ],
  },
  {
    id: 'nav',
    title: 'Pestañas del Menú Superior',
    description: 'Cambiá el texto de cada botón del menú de navegación.',
    fields: [
      { key: 'navInicio', label: 'Pestaña 1 (Inicio)' },
      { key: 'navPosiciones', label: 'Pestaña 2 (Posiciones)' },
      { key: 'navPartidos', label: 'Pestaña 3 (Partidos)' },
      { key: 'navCopas', label: 'Pestaña 4 (Copas)' },
      { key: 'navCalendario', label: 'Pestaña 5 (Calendario)' },
      { key: 'navGaleria', label: 'Pestaña 6 (Galería)' },
      { key: 'navReglamento', label: 'Pestaña 7 (Reglamento)' },
      { key: 'navPerfil', label: 'Pestaña 8 (Mi Perfil)' },
    ],
  },
  {
    id: 'home',
    title: 'Títulos de la Página de Inicio',
    description: 'Todos los encabezados de bloques visibles en la portada principal.',
    fields: [
      { key: 'homeNewsTitle', label: 'Bloque de Noticias' },
      { key: 'homeChampionsTitle', label: 'Bloque de Historial de Campeones' },
      { key: 'homeFeaturedVideoTitle', label: 'Bloque Video Destacado' },
      { key: 'homeTopGoalsTitle', label: 'Bloque Top 5 Goles' },
      { key: 'homeLeadersTitle', label: 'Bloque Punteros del Torneo' },
      { key: 'homeLeadersSubtitle', label: 'Subtítulo de Punteros' },
      { key: 'homeRecentMatchesTitle', label: 'Bloque Últimos Resultados' },
      { key: 'homeCommentsTitle', label: 'Bloque Comentarios' },
      { key: 'homeCommentsSubtitle', label: 'Subtítulo de Comentarios' },
      { key: 'homeSocialTitle', label: 'Título de Redes Sociales (Inicio y Pie)' },
    ],
  },
  {
    id: 'sections',
    title: 'Encabezados de Secciones (Posiciones, Partidos, Copas, Calendario, Galería y Reglamento)',
    description: 'Modificá los títulos y bajadas principales de cada pantalla.',
    fields: [
      { key: 'standingsBadge', label: 'Etiqueta superior de Posiciones' },
      { key: 'standingsTitle', label: 'Título de Tabla de Posiciones' },
      { key: 'matchesTitle', label: 'Título de Partidos y Reclamos' },
      { key: 'matchesSubtitle', label: 'Bajada de Partidos y Reclamos' },
      { key: 'copasPageTitle', label: 'Título de Pantalla Copas' },
      { key: 'copasPageSubtitle', label: 'Bajada de Pantalla Copas' },
      { key: 'calendarTitle', label: 'Título de Calendario' },
      { key: 'calendarSubtitle', label: 'Bajada de Calendario' },
      { key: 'galleryTitle', label: 'Título de Galería' },
      { key: 'gallerySubtitle', label: 'Bajada de Galería' },
      { key: 'rulesTitle', label: 'Título de Reglamento' },
      { key: 'rulesSubtitle', label: 'Bajada de Reglamento' },
      { key: 'rulesLeagueSectionTitle', label: 'Subtítulo Reglas de la Liga' },
      { key: 'rulesGameModeTitle', label: 'Subtítulo Modo de Juego' },
      { key: 'rulesCupSectionTitle', label: 'Subtítulo Reglas de Copa y Recopa' },
    ],
  },
];

const ALLOWED_KEYS = new Set<string>(Object.keys(DEFAULT_CUSTOM_TITLES));

export function sanitizeCustomTitles(raw?: CustomTitles | null): CustomTitles {
  if (!raw || typeof raw !== 'object') return {};
  const cleaned: CustomTitles = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_KEYS.has(k) || typeof v !== 'string') continue;
    const trimmed = v.trim().slice(0, 220);
    if (trimmed) {
      cleaned[k] = trimmed;
    }
  }
  return cleaned;
}

export function getTitleText(
  settings: Pick<LeagueSettings, 'customTitles'> | undefined | null,
  key: CustomTitleKey
): string {
  const override = settings?.customTitles?.[key];
  if (typeof override === 'string' && override.trim()) {
    return override.trim();
  }
  return DEFAULT_CUSTOM_TITLES[key];
}

export function buildDraftCustomTitles(
  settings?: Pick<LeagueSettings, 'customTitles'> | null
): Record<CustomTitleKey, string> {
  const out = {} as Record<CustomTitleKey, string>;
  (Object.keys(DEFAULT_CUSTOM_TITLES) as CustomTitleKey[]).forEach((k) => {
    out[k] = settings?.customTitles?.[k]?.trim() || DEFAULT_CUSTOM_TITLES[k];
  });
  return out;
}
