import { useState } from 'react';
import { Award, Crown, Disc3, Heart, Shield, Trophy, X } from 'lucide-react';
import type {
  ChampionEntry,
  LastListenedTrack,
  Match,
  PublicTeam,
  StandingRow,
  TeamTrophy,
} from '../types';
import { resolveAssetUrl } from '../utils/assetUrl';
import { ResilientImage } from './ResilientImage';

interface ParticipantProfileModalProps {
  team: PublicTeam | null;
  teams: PublicTeam[];
  standing?: StandingRow;
  matches: Match[];
  champions: ChampionEntry[];
  liked: boolean;
  onLike: (teamId: string) => Promise<void>;
  onClose: () => void;
}

const TROPHY_IMG_BY_TYPE: Record<'liga' | 'copa' | 'recopa', string> = {
  liga: resolveAssetUrl('/assets/aistudio/Trofeo_Liga_Argentina_LMA.jpg'),
  copa: resolveAssetUrl('/assets/aistudio/Copa_de_la_liga_Argentina_4a33ee89.jfif'),
  recopa: resolveAssetUrl('/assets/aistudio/Recopa_Argentina____fc7a7c8a.jfif'),
};

const TROPHY_LABEL_BY_TYPE: Record<'liga' | 'copa' | 'recopa', string> = {
  liga: 'Liga Argentina',
  copa: 'Copa de la Liga',
  recopa: 'Recopa Argentina',
};

export function ParticipantProfileModal({
  team,
  teams,
  standing,
  matches,
  champions,
  liked,
  onLike,
  onClose,
}: ParticipantProfileModalProps) {
  const [liking, setLiking] = useState(false);

  if (!team) return null;

  let lastSong: LastListenedTrack | undefined = team.lastListenedTrack;
  if (!lastSong?.title) {
    try {
      const raw = localStorage.getItem(`lma_last_song_${team.id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as LastListenedTrack;
        if (parsed?.title) lastSong = parsed;
      }
    } catch {
      // ignore
    }
  }

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const teamMatches = matches
    .filter((m) => m.status === 'validated' && (m.homeTeamId === team.id || m.awayTeamId === team.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pj = standing?.pj || 0;
  const pts = standing?.pts || 0;
  const effectiveness = pj > 0 ? Math.round((pts / (pj * 3)) * 100) : 0;

  // Build trophy cabinet: prefer persisted team.trophies, plus fallback from champions list if not yet synced
  const persistedTrophies: TeamTrophy[] = Array.isArray(team.trophies) ? team.trophies : [];
  const existingSourceKeys = new Set(persistedTrophies.map((t) => t.sourceKey).filter(Boolean));
  const normalizedName = team.name.trim().toLowerCase();
  const normalizedMember = team.memberName.trim().toLowerCase();

  const derivedTrophies: TeamTrophy[] = champions
    .filter(
      (c) =>
        (c.teamId === team.id ||
          c.teamName.trim().toLowerCase() === normalizedName ||
          c.memberName.trim().toLowerCase() === normalizedMember) &&
        !existingSourceKeys.has(`champ_${c.id}`)
    )
    .map((c) => {
      const type: 'liga' | 'copa' | 'recopa' =
        c.tournamentType === 'copa' ? 'copa' : c.tournamentType === 'recopa' ? 'recopa' : 'liga';
      return {
        id: `derived_${c.id}`,
        type,
        title:
          type === 'copa'
            ? 'Campeón Copa de la Liga'
            : type === 'recopa'
            ? 'Gran Campeón Recopa Argentina'
            : 'Campeón Liga Argentina',
        season: c.season,
        imageUrl: TROPHY_IMG_BY_TYPE[type],
        message: c.notes || '',
        awardedAt: c.createdAt,
        sourceKey: `champ_${c.id}`,
      };
    });

  const allTrophies = [...persistedTrophies, ...derivedTrophies];
  const ligaCount = allTrophies.filter((t) => t.type === 'liga').length;
  const copaCount = allTrophies.filter((t) => t.type === 'copa').length;
  const recopaCount = allTrophies.filter((t) => t.type === 'recopa').length;

  const handleLikeClick = async () => {
    if (liking) return;
    setLiking(true);
    try {
      await onLike(team.id);
    } finally {
      setLiking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 p-4 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Perfil público de ${team.name}`}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0B0D12] border-2 border-amber-400/65 shadow-[0_24px_60px_rgba(0,0,0,0.95)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 w-full albiceleste-ribbon" aria-hidden="true" />

        {/* Cabecera solo lectura del participante */}
        <div className="p-6 border-b border-amber-400/30 bg-gradient-to-r from-[#08090D] via-[#121620] to-[#08090D] flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <ResilientImage
              src={team.crestUrl}
              alt={`Escudo ${team.name}`}
              className="w-20 h-20 rounded-2xl object-contain bg-[#06070A] border-2 border-amber-400/60 p-1.5 shrink-0 shadow-lg"
              fallbackLabel={team.id}
            />
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                <Shield className="w-3.5 h-3.5" />
                <span>Participante Oficial · Solo Lectura</span>
                <span className="font-mono text-zinc-400">({team.id})</span>
              </div>
              <h2 className="font-display text-3xl font-extrabold text-albiceleste-shiny truncate">
                {team.name}
              </h2>
              <div className="text-sm font-semibold text-zinc-200 truncate">
                DT / Miembro: <span className="text-amber-200">{team.memberName}</span>
              </div>
              {team.bio && (
                <p className="mt-1.5 text-xs sm:text-sm italic text-emerald-300/95 leading-snug">
                  “{team.bio}”
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar perfil"
            className="p-2 rounded-lg text-zinc-300 hover:text-white bg-[#141822] hover:bg-[#1E2433] border border-zinc-500/40 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Botón Me Gusta del perfil */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[#07090E] border border-rose-400/35">
            <div className="text-xs text-zinc-300">
              ¿Te gusta el perfil o el nivel de <strong className="text-white">{team.name}</strong>? Dejale tu Me Gusta:
            </div>
            <button
              type="button"
              disabled={liking}
              onClick={handleLikeClick}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                liked
                  ? 'bg-rose-500/25 text-rose-200 border border-rose-400/70 shadow-[0_0_16px_rgba(244,63,94,0.28)]'
                  : 'bg-[#141720] hover:bg-rose-500/20 text-white border border-rose-400/50'
              }`}
            >
              <Heart className={`w-4 h-4 ${liked ? 'fill-rose-500 text-rose-400' : 'text-rose-400'}`} />
              <span>Me Gusta</span>
              <span className="px-2 py-0.5 rounded-md bg-black/50 font-mono text-rose-200 tabular-nums">
                {team.likes || 0}
              </span>
            </button>
          </div>

          {/* Última canción escuchada con su foto original */}
          <div className="p-4 rounded-xl bg-[#07090E] border border-sky-400/35 flex items-center gap-3.5">
            {lastSong?.coverUrl ? (
              <ResilientImage
                src={lastSong.coverUrl}
                alt={`Portada de ${lastSong.title}`}
                className="w-16 h-16 rounded-xl object-cover border-2 border-amber-400/65 shrink-0 bg-[#041224] shadow-md"
                fallbackLabel="MP3"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-[#05162B] border border-amber-400/40 flex items-center justify-center shrink-0">
                <Disc3 className="w-7 h-7 text-amber-300" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-amber-300 uppercase tracking-wider">
                Última Canción Escuchada
              </div>
              {lastSong?.title ? (
                <>
                  <div className="font-display text-lg font-extrabold text-white truncate">
                    {lastSong.title}
                  </div>
                  <div className="text-xs text-sky-200/85 truncate">{lastSong.artist}</div>
                  {lastSong.listenedAt && (
                    <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                      {new Date(lastSong.listenedAt).toLocaleString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-zinc-400 mt-0.5">
                  Todavía no reprodujo ninguna canción MP3 en la liga.
                </div>
              )}
            </div>
          </div>

          {/* KPIs + Contador de Trofeos Ganados */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-[#07090E] border border-amber-400/35 text-center">
              <div className="text-[11px] text-zinc-400">Posición</div>
              <div className="font-display text-2xl font-extrabold text-gold-shiny tabular-nums">
                {standing ? `#${standing.position}` : '—'}
              </div>
              <div className="text-[11px] font-mono text-amber-200 tabular-nums">
                {standing ? `${standing.pts} PTS` : '0 PTS'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#07090E] border border-zinc-500/30 text-center">
              <div className="text-[11px] text-zinc-400">Partidos</div>
              <div className="font-display text-2xl font-extrabold text-white tabular-nums">
                {pj}
              </div>
              <div className="text-[11px] font-mono text-zinc-300 tabular-nums">
                {standing ? `${standing.pg}G-${standing.pe}E-${standing.pp}P` : '0G-0E-0P'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#07090E] border border-emerald-400/30 text-center">
              <div className="text-[11px] text-zinc-400">Efectividad</div>
              <div className="font-display text-2xl font-extrabold text-emerald-300 tabular-nums">
                {effectiveness}%
              </div>
              <div className="text-[11px] font-mono text-zinc-300 tabular-nums">
                DG {standing ? (standing.dg > 0 ? `+${standing.dg}` : standing.dg) : 0}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#07090E] border border-amber-400/50 text-center">
              <div className="text-[11px] text-amber-200 font-semibold">Trofeos Ganados</div>
              <div className="font-display text-2xl font-extrabold text-amber-300 tabular-nums inline-flex items-center gap-1">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>{allTrophies.length}</span>
              </div>
              <div className="text-[10px] font-mono text-zinc-300 tabular-nums">
                {ligaCount}L · {copaCount}C · {recopaCount}R
              </div>
            </div>
          </div>

          {/* Vitrina de Trofeos Ganados (Foto del torneo ganado + mensaje del campeón) */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 uppercase tracking-wider">
                <Crown className="w-4 h-4 text-amber-400" />
                <span>Vitrina de Trofeos Ganados ({allTrophies.length})</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-300">
                <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/35 text-sky-200">
                  Ligas: {ligaCount}
                </span>
                <span className="px-2 py-0.5 rounded bg-zinc-400/15 border border-zinc-400/35 text-zinc-200">
                  Copas: {copaCount}
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-400/15 border border-amber-400/40 text-amber-200">
                  Recopas: {recopaCount}
                </span>
              </div>
            </div>

            {allTrophies.length === 0 ? (
              <div className="p-4 rounded-xl bg-[#07090E] border border-zinc-700/50 text-xs text-zinc-400 text-center">
                Todavía no ganó trofeos oficiales. Al salir campeón de Liga, Copa o Recopa se cargará automáticamente su trofeo aquí.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {allTrophies.map((trophy) => (
                  <div
                    key={trophy.id}
                    className="rounded-xl overflow-hidden bg-[#07090E] border border-amber-400/45 shadow-lg flex flex-col"
                  >
                    <div className="relative h-44 bg-[#04060A] overflow-hidden border-b border-amber-400/30">
                      <ResilientImage
                        src={trophy.imageUrl || TROPHY_IMG_BY_TYPE[trophy.type]}
                        alt={trophy.title}
                        className="w-full h-full object-cover object-center"
                        fallbackLabel={TROPHY_LABEL_BY_TYPE[trophy.type]}
                      />
                      <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/75 border border-amber-400/60 text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                        {TROPHY_LABEL_BY_TYPE[trophy.type]}
                      </span>
                    </div>
                    <div className="p-3.5 space-y-1.5 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="font-display text-lg font-bold text-gold-shiny leading-tight">
                          {trophy.title}
                        </h4>
                        <div className="text-[11px] font-mono text-sky-200/80">
                          {trophy.season}
                        </div>
                      </div>
                      {trophy.message && trophy.message.trim() ? (
                        <p className="mt-2 pt-2 border-t border-white/10 text-xs italic text-emerald-300 leading-relaxed whitespace-pre-line">
                          “{trophy.message}”
                        </p>
                      ) : (
                        <p className="mt-2 pt-2 border-t border-white/10 text-[11px] text-zinc-500">
                          Sin dedicatoria escrita todavía.
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Foto de festejo personal (si tiene aprobada) */}
          {team.celebrationImageUrl && (
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 uppercase tracking-wider">
                <Award className="w-3.5 h-3.5" />
                <span>Foto de Festejo del Participante</span>
              </div>
              <div className="aspect-[16/9] rounded-xl overflow-hidden bg-[#06070A] border border-amber-400/35">
                <ResilientImage
                  src={team.celebrationImageUrl}
                  alt={`Festejo de ${team.name}`}
                  className="w-full h-full object-cover"
                  fallbackLabel={team.name}
                />
              </div>
            </div>
          )}

          {/* Últimos partidos validados */}
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              Últimos Partidos Validados ({teamMatches.length})
            </div>
            {teamMatches.length === 0 ? (
              <div className="p-4 rounded-xl bg-[#07090E] border border-zinc-700/50 text-xs text-zinc-400 text-center">
                Todavía no registra partidos validados esta temporada.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {teamMatches.slice(0, 10).map((m) => {
                  const home = teamMap.get(m.homeTeamId);
                  const away = teamMap.get(m.awayTeamId);
                  const isHome = m.homeTeamId === team.id;
                  const myGoals = isHome ? m.homeGoals : m.awayGoals;
                  const oppGoals = isHome ? m.awayGoals : m.homeGoals;
                  const badge =
                    myGoals > oppGoals
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                      : myGoals === oppGoals
                      ? 'bg-amber-500/20 text-amber-200 border-amber-400/40'
                      : 'bg-rose-500/20 text-rose-300 border-rose-400/40';
                  const label = myGoals > oppGoals ? 'G' : myGoals === oppGoals ? 'E' : 'P';

                  return (
                    <div
                      key={m.id}
                      className="px-3.5 py-2.5 rounded-xl bg-[#07090E] border border-zinc-700/50 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`px-1.5 py-0.5 rounded border font-mono font-bold text-[10px] ${badge}`}>
                          {label}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                          F{m.matchday}
                        </span>
                        <span className="font-semibold text-zinc-100 truncate">
                          {home?.name || m.homeTeamId} {m.homeGoals}-{m.awayGoals}{' '}
                          {away?.name || m.awayTeamId}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                        {m.playedAt}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
