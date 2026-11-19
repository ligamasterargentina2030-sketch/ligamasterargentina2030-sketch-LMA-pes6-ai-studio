import { useState, type DragEvent, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Crown,
  Edit3,
  GripVertical,
  Maximize2,
  Shield,
  Trophy,
  X,
} from 'lucide-react';
import type { CupMatchNode, CupRound, CupTournament } from '../types';
import { apiFetch } from '../utils/api';
import { resolveAssetUrl } from '../utils/assetUrl';
import { ResilientImage } from './ResilientImage';

interface CupBracketCardProps {
  cup: CupTournament;
  isAdmin: boolean;
  embeddedPreview?: boolean;
  onEditCup: () => void;
  onGoToChampionsUpload: () => void;
  onGoToRules: () => void;
  onRefresh: () => Promise<void>;
  onDropLeagueTeam?: (matchId: string, side: 'home' | 'away', teamId: string) => Promise<void>;
  onDropSlotOnMatch?: (
    targetMatchId: string,
    targetSide: 'home' | 'away',
    sourceSlot: number,
    sourceMatchId?: string,
    sourceSide?: 'home' | 'away'
  ) => Promise<void>;
  onDropLeagueTeamRecopa?: (recopaSide: 'league' | 'cup', teamId: string) => Promise<void>;
  onClearMatchSide?: (matchId: string, side: 'home' | 'away', slot: number | null) => Promise<void>;
}

const CUP_TROPHY_IMG = resolveAssetUrl('/assets/aistudio/Copa_de_la_liga_Argentina_4a33ee89.jfif');
const RECOPA_TROPHY_IMG = resolveAssetUrl('/assets/aistudio/Recopa_Argentina____fc7a7c8a.jfif');

const NEXT_STAGE_LABEL: Record<CupRound, string> = {
  r16: '4° Cuartos',
  qf: 'Semifinales',
  sf: 'Final',
  final: 'Campeón',
};

function isEmptyCupSlotName(name?: string | null): boolean {
  const trimmed = (name || '').trim();
  return (
    !trimmed ||
    trimmed === 'Por definir' ||
    trimmed.startsWith('Cupo Libre') ||
    trimmed === 'Campeón de Liga' ||
    trimmed === 'Campeón de Copa'
  );
}

interface DragPayload {
  kind: 'league-team' | 'cup-slot' | 'recopa-side';
  teamId?: string;
  slot?: number;
  matchId?: string;
  round?: CupRound;
  side?: 'home' | 'away';
  recopaSide?: 'league' | 'cup';
}

function parseDragData(e: DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (!raw) return null;
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

function MatchSlotBox({
  match,
  compact = true,
  label,
  interactive = false,
  busyMatchId,
  onSelectWinner,
  onSaveScore,
  onDropLeagueTeam,
  onDropSlotOnMatch,
  onClearMatchSide,
}: {
  match?: CupMatchNode;
  compact?: boolean;
  label?: string;
  interactive?: boolean;
  busyMatchId?: string | null;
  onSelectWinner?: (matchId: string, slot: number | null) => void;
  onSaveScore?: (matchId: string, homeGoals: number | null, awayGoals: number | null) => void;
  onDropLeagueTeam?: (matchId: string, side: 'home' | 'away', teamId: string) => Promise<void>;
  onDropSlotOnMatch?: (
    targetMatchId: string,
    targetSide: 'home' | 'away',
    sourceSlot: number,
    sourceMatchId?: string,
    sourceSide?: 'home' | 'away'
  ) => Promise<void>;
  onClearMatchSide?: (matchId: string, side: 'home' | 'away', slot: number | null) => Promise<void>;
}) {
  const [dragOverSide, setDragOverSide] = useState<'home' | 'away' | null>(null);
  const [editingScore, setEditingScore] = useState(false);
  const [hgInput, setHgInput] = useState(match?.homeGoals !== null && match?.homeGoals !== undefined ? String(match.homeGoals) : '');
  const [agInput, setAgInput] = useState(match?.awayGoals !== null && match?.awayGoals !== undefined ? String(match.awayGoals) : '');

  if (!match) return null;

  const isBusy = busyMatchId === match.id;
  const hasAnyTeam = Boolean(
    (match.homeSlot && !isEmptyCupSlotName(match.homeTeamName)) ||
      (match.awaySlot && !isEmptyCupSlotName(match.awayTeamName))
  );

  const handleSideDrop = async (e: DragEvent, targetSide: 'home' | 'away') => {
    if (!interactive) return;
    e.preventDefault();
    setDragOverSide(null);
    const payload = parseDragData(e);
    if (!payload) return;
    if (payload.kind === 'league-team' && payload.teamId && onDropLeagueTeam) {
      await onDropLeagueTeam(match.id, targetSide, payload.teamId);
    } else if (payload.kind === 'cup-slot' && payload.slot && onDropSlotOnMatch) {
      await onDropSlotOnMatch(match.id, targetSide, payload.slot, payload.matchId, payload.side);
    }
  };

  const renderSide = (side: 'home' | 'away') => {
    const slot = side === 'home' ? match.homeSlot : match.awaySlot;
    const rawName = (side === 'home' ? match.homeTeamName : match.awayTeamName) || '';
    const hasTeam = Boolean(slot && !isEmptyCupSlotName(rawName));
    const teamName = hasTeam ? rawName : '';
    const memberName = side === 'home' ? match.homeMemberName : match.awayMemberName;
    const crestUrl = side === 'home' ? match.homeCrestUrl : match.awayCrestUrl;
    const goals = side === 'home' ? match.homeGoals : match.awayGoals;
    const penalties = side === 'home' ? match.homePenalties : match.awayPenalties;
    const isWinner = Boolean(hasTeam && match.winnerSlot && slot && match.winnerSlot === slot);
    const isLoser = Boolean(hasTeam && match.winnerSlot && slot && match.winnerSlot !== slot);
    const canAdvance = Boolean(interactive && onSelectWinner && slot && hasTeam && !isBusy);
    const isDragOver = dragOverSide === side;

    if (!hasTeam) {
      return (
        <div
          onDragOver={(e) => {
            if (!interactive) return;
            e.preventDefault();
            setDragOverSide(side);
          }}
          onDragLeave={() => setDragOverSide(null)}
          onDrop={(e) => void handleSideDrop(e, side)}
          className={`flex items-center justify-between gap-1.5 transition-colors ${
            compact ? 'px-2 py-1.5 min-h-[28px]' : 'px-2.5 py-2 min-h-[34px]'
          } ${isDragOver ? 'bg-amber-400/20 ring-1 ring-inset ring-amber-400 text-amber-200' : 'text-zinc-500'}`}
        >
          <span className="text-[10px] font-medium tracking-wide select-none truncate">
            {interactive ? 'Soltá equipo aquí' : 'Por definir'}
          </span>
          {goals !== null && (
            <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-mono font-bold tabular-nums`}>
              {goals}
            </span>
          )}
        </div>
      );
    }

    return (
      <div
        draggable={interactive && Boolean(slot)}
        onDragStart={(e) => {
          if (!interactive || !slot) return;
          const payload: DragPayload = {
            kind: 'cup-slot',
            slot,
            matchId: match.id,
            round: match.round,
            side,
          };
          e.dataTransfer.setData('application/json', JSON.stringify(payload));
          e.dataTransfer.setData('text/plain', JSON.stringify(payload));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!interactive) return;
          e.preventDefault();
          setDragOverSide(side);
        }}
        onDragLeave={() => setDragOverSide(null)}
        onDrop={(e) => void handleSideDrop(e, side)}
        className={`flex items-center justify-between gap-1.5 transition-colors ${
          compact ? 'px-2 py-1.5' : 'px-2.5 py-2'
        } ${
          isDragOver
            ? 'bg-amber-400/20 ring-1 ring-inset ring-amber-400'
            : isWinner
            ? 'bg-emerald-500/20 border-l-2 border-emerald-400 text-white'
            : isLoser
            ? 'opacity-60 text-zinc-400'
            : 'text-zinc-100'
        } ${interactive ? 'cursor-grab active:cursor-grabbing hover:bg-amber-400/10' : ''}`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {interactive && (
            <GripVertical className="w-3 h-3 text-zinc-500 shrink-0" aria-hidden="true" />
          )}
          {crestUrl ? (
            <ResilientImage
              src={crestUrl}
              alt={teamName}
              className={`${
                compact ? 'w-5 h-5' : 'w-6 h-6'
              } rounded object-contain bg-[#041224] border border-amber-400/45 shrink-0`}
              fallbackLabel={slot ? String(slot) : '?'}
            />
          ) : (
            <div
              className={`${
                compact ? 'w-5 h-5' : 'w-6 h-6'
              } rounded bg-[#08264A] border border-amber-400/35 flex items-center justify-center shrink-0`}
            >
              <Shield className="w-3 h-3 text-sky-300/70" />
            </div>
          )}
          <div className="min-w-0 flex-1 text-left">
            <div
              className={`${
                compact ? 'text-[11px] leading-tight' : 'text-xs leading-tight'
              } font-semibold truncate ${
                isWinner ? 'text-emerald-200 font-bold' : isLoser ? 'text-sky-200/70' : 'text-white'
              }`}
              title={`${teamName}${memberName && memberName !== 'Por definir' ? ` (${memberName})` : ''}`}
            >
              {teamName}
            </div>
            {!compact && memberName && memberName !== 'Por definir' && (
              <div className="text-[10px] text-sky-200/75 truncate">{memberName}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 font-mono tabular-nums shrink-0">
          {goals !== null && (
            <span
              className={`${compact ? 'text-[11px]' : 'text-xs'} font-bold px-1 rounded bg-[#041224] ${
                isWinner ? 'text-amber-300' : 'text-sky-100'
              }`}
            >
              {goals}
            </span>
          )}
          {penalties !== null && (
            <span className="text-[9px] text-amber-300">({penalties})</span>
          )}
          {canAdvance && slot ? (
            <button
              type="button"
              onClick={() => onSelectWinner?.(match.id, isWinner ? null : slot)}
              title={
                isWinner
                  ? `Quitar avance de ${teamName}`
                  : `Pasar a ${teamName} a ${NEXT_STAGE_LABEL[match.round]}`
              }
              className={`ml-0.5 inline-flex items-center justify-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-sans font-bold transition-colors ${
                isWinner
                  ? 'bg-emerald-500/35 text-emerald-100 hover:bg-emerald-500/50'
                  : 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/35'
              }`}
            >
              {isWinner ? <Check className="w-2.5 h-2.5" /> : <ArrowRight className="w-2.5 h-2.5" />}
            </button>
          ) : (
            isWinner && (
              <span
                className="ml-0.5 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-sans font-bold bg-emerald-500/25 border border-emerald-400/40 text-emerald-200"
                title={match.round === 'final' ? 'Campeón de la Copa' : `Pasó a ${NEXT_STAGE_LABEL[match.round]}`}
              >
                <Check className="w-2.5 h-2.5" />
                <span>{match.round === 'final' ? 'Campeón' : 'Pasó'}</span>
              </span>
            )
          )}
          {interactive && onClearMatchSide && slot && (
            <button
              type="button"
              onClick={() => void onClearMatchSide(match.id, side, slot)}
              title="Quitar equipo de esta llave"
              className="p-0.5 rounded text-rose-400 hover:text-rose-200 hover:bg-rose-500/20"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className={`rounded-xl bg-[#05162B] border overflow-hidden divide-y divide-sky-400/15 transition-all shadow-md ${
        interactive
          ? 'border-amber-400/70'
          : hasAnyTeam
          ? 'border-amber-400/40'
          : 'border-dashed border-sky-400/25 opacity-75'
      } ${isBusy ? 'opacity-60' : ''}`}
    >
      {(label || (interactive && onSaveScore)) && (
        <div className="px-2 py-1 bg-[#041224] text-[9px] font-semibold text-sky-200/80 flex items-center justify-between gap-1 border-b border-amber-400/20">
          <span className="truncate">{label || `Llave ${match.matchIndex}`}</span>
          <div className="flex items-center gap-1.5">
            {match.extraTime && <span className="text-amber-300">TE</span>}
            {interactive && onSaveScore && (
              <button
                type="button"
                onClick={() => {
                  setHgInput(match.homeGoals !== null ? String(match.homeGoals) : '');
                  setAgInput(match.awayGoals !== null ? String(match.awayGoals) : '');
                  setEditingScore((v) => !v);
                }}
                className="text-amber-300 hover:text-amber-200 font-bold"
                title="Cargar resultado de este partido"
              >
                {editingScore ? 'Cerrar' : 'Marcador'}
              </button>
            )}
          </div>
        </div>
      )}

      {interactive && editingScore && onSaveScore && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSaveScore(
              match.id,
              hgInput === '' ? null : Number(hgInput),
              agInput === '' ? null : Number(agInput)
            );
            setEditingScore(false);
          }}
          className="px-2 py-1.5 bg-[#08264A] flex items-center justify-between gap-1"
        >
          <input
            type="number"
            min={0}
            value={hgInput}
            onChange={(e) => setHgInput(e.target.value)}
            placeholder="L"
            className="w-11 px-1 py-0.5 text-[11px] font-mono text-center bg-[#041224] text-white border border-amber-400/40 rounded"
          />
          <span className="text-[10px] text-sky-300">-</span>
          <input
            type="number"
            min={0}
            value={agInput}
            onChange={(e) => setAgInput(e.target.value)}
            placeholder="V"
            className="w-11 px-1 py-0.5 text-[11px] font-mono text-center bg-[#041224] text-white border border-amber-400/40 rounded"
          />
          <button
            type="submit"
            className="px-1.5 py-0.5 text-[10px] font-bold text-zinc-950 bg-amber-300 hover:bg-amber-200 rounded"
          >
            OK
          </button>
        </form>
      )}

      {renderSide('home')}
      {renderSide('away')}
    </div>
  );
}

export function CupBracketCard({
  cup,
  isAdmin,
  embeddedPreview = false,
  onEditCup,
  onGoToChampionsUpload,
  onGoToRules,
  onRefresh,
  onDropLeagueTeam,
  onDropSlotOnMatch,
  onDropLeagueTeamRecopa,
  onClearMatchSide,
}: CupBracketCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const [busyRecopa, setBusyRecopa] = useState(false);
  const [dragOverRecopa, setDragOverRecopa] = useState<'league' | 'cup' | null>(null);
  const [editingWinnerInline, setEditingWinnerInline] = useState(false);
  const [winnerNameInput, setWinnerNameInput] = useState(cup.championTeamName || '');
  const [winnerMemberInput, setWinnerMemberInput] = useState(cup.championMemberName || '');
  const [savingWinner, setSavingWinner] = useState(false);

  const byId = new Map(cup.matches.map((m) => [m.id, m]));
  const finalMatch = byId.get('final');
  const cupFinished = cup.status === 'finished' || Boolean(cup.championTeamName);
  const recopa = cup.recopa;
  const recopaFinished = Boolean(recopa.grandChampionName);
  const interactive = Boolean(isAdmin && embeddedPreview);

  const handleSelectWinner = async (matchId: string, slot: number | null) => {
    setBusyMatchId(matchId);
    try {
      await apiFetch(`/api/admin/cup/matches/${encodeURIComponent(matchId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          winnerSlot: slot,
          played: slot !== null,
        }),
      });
      await onRefresh();
    } finally {
      setBusyMatchId(null);
    }
  };

  const handleSaveInlineScore = async (
    matchId: string,
    homeGoals: number | null,
    awayGoals: number | null
  ) => {
    setBusyMatchId(matchId);
    try {
      await apiFetch(`/api/admin/cup/matches/${encodeURIComponent(matchId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          homeGoals,
          awayGoals,
        }),
      });
      await onRefresh();
    } finally {
      setBusyMatchId(null);
    }
  };

  const handleSelectRecopaWinner = async (side: 'league' | 'cup' | null) => {
    setBusyRecopa(true);
    try {
      await apiFetch('/api/admin/cup/recopa', {
        method: 'PUT',
        body: JSON.stringify({ grandChampionSide: side }),
      });
      await onRefresh();
    } finally {
      setBusyRecopa(false);
    }
  };

  const handleSaveWinnerInline = async (e: FormEvent) => {
    e.preventDefault();
    if (!winnerNameInput.trim()) return;
    setSavingWinner(true);
    try {
      const form = new FormData();
      form.append('status', 'finished');
      form.append('championTeamName', winnerNameInput.trim());
      form.append('championMemberName', winnerMemberInput.trim() || 'Campeón de Copa');
      await apiFetch('/api/admin/cup/settings', { method: 'PUT', body: form });
      setEditingWinnerInline(false);
      await onRefresh();
    } finally {
      setSavingWinner(false);
    }
  };

  const renderBracketGrid = (compact: boolean) => (
    <div className="space-y-4">
      <div className="w-full min-w-0">
        <div
          className={`w-full min-w-0 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)_minmax(0,0.92fr)_minmax(0,1.35fr)_minmax(0,0.92fr)_minmax(0,0.92fr)_minmax(0,1fr)] ${
            compact ? 'gap-2' : 'gap-2.5'
          } items-stretch`}
        >
          {/* Left Octavos (4) */}
          <div className="flex flex-col justify-between gap-2 min-w-0">
            <div className="text-[11px] font-bold text-amber-300 text-center pb-0.5 uppercase tracking-wider">
              8° Octavos
            </div>
            <div className="flex-1 flex flex-col justify-around gap-2">
              {(['r16_1', 'r16_2', 'r16_3', 'r16_4'] as const).map((id, idx) => (
                <MatchSlotBox
                  key={id}
                  match={byId.get(id)}
                  compact={compact}
                  label={`Octavos ${idx + 1}`}
                  interactive={interactive}
                  busyMatchId={busyMatchId}
                  onSelectWinner={handleSelectWinner}
                  onSaveScore={handleSaveInlineScore}
                  onDropLeagueTeam={onDropLeagueTeam}
                  onDropSlotOnMatch={onDropSlotOnMatch}
                  onClearMatchSide={onClearMatchSide}
                />
              ))}
            </div>
          </div>

          {/* Left Cuartos (2) */}
          <div className="flex flex-col justify-between gap-2 min-w-0">
            <div className="text-[11px] font-bold text-amber-200 text-center pb-0.5 uppercase tracking-wider">
              4° Cuartos
            </div>
            <div className="flex-1 flex flex-col justify-around gap-4">
              {(['qf_1', 'qf_2'] as const).map((id, idx) => (
                <MatchSlotBox
                  key={id}
                  match={byId.get(id)}
                  compact={compact}
                  label={`Cuartos ${idx + 1}`}
                  interactive={interactive}
                  busyMatchId={busyMatchId}
                  onSelectWinner={handleSelectWinner}
                  onSaveScore={handleSaveInlineScore}
                  onDropLeagueTeam={onDropLeagueTeam}
                  onDropSlotOnMatch={onDropSlotOnMatch}
                  onClearMatchSide={onClearMatchSide}
                />
              ))}
            </div>
          </div>

          {/* Left Semifinal (1) */}
          <div className="flex flex-col justify-between gap-2 min-w-0">
            <div className="text-[11px] font-bold text-amber-300 text-center pb-0.5 uppercase tracking-wider">
              Semifinal 1
            </div>
            <div className="flex-1 flex flex-col justify-center">
              <MatchSlotBox
                match={byId.get('sf_1')}
                compact={compact}
                label="Semifinal 1"
                interactive={interactive}
                busyMatchId={busyMatchId}
                onSelectWinner={handleSelectWinner}
                onSaveScore={handleSaveInlineScore}
                onDropLeagueTeam={onDropLeagueTeam}
                onDropSlotOnMatch={onDropSlotOnMatch}
                onClearMatchSide={onClearMatchSide}
              />
            </div>
          </div>

          {/* Center: 3D Copa de la Liga + Champion Crest & Congratulations + Final Match */}
          <div className="flex flex-col justify-center gap-3 px-0.5 min-w-0">
            <div
              className={`rounded-2xl border-2 p-3 text-center space-y-2 shadow-xl ${
                cupFinished
                  ? 'bg-gradient-to-b from-[#0C3768] via-[#072140] to-[#05162B] border-amber-300/80 shadow-sky-500/20'
                  : 'bg-[#05162B] border-amber-400/55'
              }`}
            >
              <div className="w-24 h-24 sm:w-28 sm:h-28 mx-auto rounded-xl overflow-hidden border-2 border-amber-300/65 bg-[#041224] shadow-[0_8px_24px_rgba(251,191,36,0.28)]">
                <ResilientImage
                  src={CUP_TROPHY_IMG}
                  alt="Trofeo 3D Copa de la Liga"
                  className="w-full h-full object-cover"
                  fallbackLabel="COPA 3D"
                />
              </div>

              <div className="font-display text-lg font-extrabold tracking-wide uppercase text-albiceleste-shiny">
                Copa de la Liga
              </div>

              {cupFinished ? (
                <div className="space-y-1.5 pt-1 border-t border-amber-400/25">
                  <div className="inline-flex items-center justify-center gap-2">
                    {cup.championCrestUrl ? (
                      <ResilientImage
                        src={cup.championCrestUrl}
                        alt={cup.championTeamName}
                        className="w-10 h-10 rounded-lg object-contain bg-[#041224] border border-amber-300/70 p-0.5 shrink-0 shadow-md"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[#041224] border border-amber-300/50 flex items-center justify-center shrink-0">
                        <Trophy className="w-5 h-5 text-amber-300" />
                      </div>
                    )}
                    <div className="text-left min-w-0">
                      <div className="font-display text-base font-extrabold text-albiceleste-shiny truncate">
                        {cup.championTeamName}
                      </div>
                      {cup.championMemberName && (
                        <div className="text-[11px] font-semibold text-amber-200 truncate">
                          DT: {cup.championMemberName}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] font-bold tracking-wide text-amber-300 uppercase">
                    {cup.championGreeting || '¡Felicitaciones para el Campeón!'}
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-sky-200/75">
                  El escudo del campeón aparece automáticamente aquí al finalizar la Final
                </div>
              )}

              {interactive && (
                <div className="pt-1">
                  {editingWinnerInline ? (
                    <form onSubmit={handleSaveWinnerInline} className="space-y-1.5 text-left">
                      <input
                        type="text"
                        required
                        value={winnerNameInput}
                        onChange={(e) => setWinnerNameInput(e.target.value)}
                        placeholder="Nombre equipo campeón"
                        className="w-full px-2 py-1 text-[11px] bg-[#041224] text-white border border-amber-400/50 rounded"
                      />
                      <input
                        type="text"
                        value={winnerMemberInput}
                        onChange={(e) => setWinnerMemberInput(e.target.value)}
                        placeholder="DT / miembro"
                        className="w-full px-2 py-1 text-[11px] bg-[#041224] text-white border border-amber-400/40 rounded"
                      />
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingWinnerInline(false)}
                          className="px-2 py-0.5 text-[10px] text-sky-100 bg-[#0A294E] rounded"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={savingWinner}
                          className="px-2 py-0.5 text-[10px] font-semibold text-zinc-950 bg-amber-300 rounded"
                        >
                          {savingWinner ? '...' : 'Guardar'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setWinnerNameInput(cup.championTeamName || '');
                        setWinnerMemberInput(cup.championMemberName || '');
                        setEditingWinnerInline(true);
                      }}
                      className="text-[10px] font-semibold text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline"
                    >
                      {cupFinished ? 'Editar campeón' : 'Fijar campeón manual'}
                    </button>
                  )}
                </div>
              )}
            </div>

            <MatchSlotBox
              match={finalMatch}
              compact={compact}
              label="Final de la Copa"
              interactive={interactive}
              busyMatchId={busyMatchId}
              onSelectWinner={handleSelectWinner}
              onSaveScore={handleSaveInlineScore}
              onDropLeagueTeam={onDropLeagueTeam}
              onDropSlotOnMatch={onDropSlotOnMatch}
              onClearMatchSide={onClearMatchSide}
            />
          </div>

          {/* Right Semifinal (1) */}
          <div className="flex flex-col justify-between gap-2 min-w-0">
            <div className="text-[11px] font-bold text-amber-300 text-center pb-0.5 uppercase tracking-wider">
              Semifinal 2
            </div>
            <div className="flex-1 flex flex-col justify-center">
              <MatchSlotBox
                match={byId.get('sf_2')}
                compact={compact}
                label="Semifinal 2"
                interactive={interactive}
                busyMatchId={busyMatchId}
                onSelectWinner={handleSelectWinner}
                onSaveScore={handleSaveInlineScore}
                onDropLeagueTeam={onDropLeagueTeam}
                onDropSlotOnMatch={onDropSlotOnMatch}
                onClearMatchSide={onClearMatchSide}
              />
            </div>
          </div>

          {/* Right Cuartos (2) */}
          <div className="flex flex-col justify-between gap-2 min-w-0">
            <div className="text-[11px] font-bold text-amber-200 text-center pb-0.5 uppercase tracking-wider">
              4° Cuartos
            </div>
            <div className="flex-1 flex flex-col justify-around gap-4">
              {(['qf_3', 'qf_4'] as const).map((id, idx) => (
                <MatchSlotBox
                  key={id}
                  match={byId.get(id)}
                  compact={compact}
                  label={`Cuartos ${idx + 3}`}
                  interactive={interactive}
                  busyMatchId={busyMatchId}
                  onSelectWinner={handleSelectWinner}
                  onSaveScore={handleSaveInlineScore}
                  onDropLeagueTeam={onDropLeagueTeam}
                  onDropSlotOnMatch={onDropSlotOnMatch}
                  onClearMatchSide={onClearMatchSide}
                />
              ))}
            </div>
          </div>

          {/* Right Octavos (4) */}
          <div className="flex flex-col justify-between gap-2 min-w-0">
            <div className="text-[11px] font-bold text-amber-300 text-center pb-0.5 uppercase tracking-wider">
              8° Octavos
            </div>
            <div className="flex-1 flex flex-col justify-around gap-2">
              {(['r16_5', 'r16_6', 'r16_7', 'r16_8'] as const).map((id, idx) => (
                <MatchSlotBox
                  key={id}
                  match={byId.get(id)}
                  compact={compact}
                  label={`Octavos ${idx + 5}`}
                  interactive={interactive}
                  busyMatchId={busyMatchId}
                  onSelectWinner={handleSelectWinner}
                  onSaveScore={handleSaveInlineScore}
                  onDropLeagueTeam={onDropLeagueTeam}
                  onDropSlotOnMatch={onDropSlotOnMatch}
                  onClearMatchSide={onClearMatchSide}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Showcase: RECOPA 3D Trophy + 2 Finalists + Champion Crest & Congratulations */}
      <div
        className={`rounded-2xl border-2 p-4 sm:p-5 ${
          recopaFinished
            ? 'bg-gradient-to-r from-[#062244] via-[#0E437A] to-[#062244] border-amber-300/75 shadow-lg shadow-sky-500/15'
            : 'bg-[#05162B] border-amber-400/50'
        }`}
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          {/* 3D Recopa Trophy */}
          <div className="md:col-span-3 flex items-center gap-3">
            <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-amber-300/65 bg-[#041224] shrink-0 shadow-[0_8px_22px_rgba(251,191,36,0.3)]">
              <ResilientImage
                src={RECOPA_TROPHY_IMG}
                alt="Trofeo 3D Recopa Argentina"
                className="w-full h-full object-cover"
                fallbackLabel="RECOPA 3D"
              />
            </div>
            <div>
              <div className="inline-flex items-center gap-1 text-xs font-bold text-amber-300 uppercase tracking-wider">
                <Crown className="w-3.5 h-3.5" />
                <span>Recopa</span>
              </div>
              <div className="text-sm font-bold text-albiceleste-shiny">Campeón de Liga vs Copa</div>
              <div className="text-[11px] text-sky-200/80">Gran Final Única</div>
            </div>
          </div>

          {/* 2 Finalists */}
          <div className="md:col-span-5 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center">
            {/* Side 1: League Champion / Finalist 1 */}
            <div
              onDragOver={(e) => {
                if (!interactive) return;
                e.preventDefault();
                setDragOverRecopa('league');
              }}
              onDragLeave={() => setDragOverRecopa(null)}
              onDrop={async (e) => {
                if (!interactive || !onDropLeagueTeamRecopa) return;
                e.preventDefault();
                setDragOverRecopa(null);
                const payload = parseDragData(e);
                if (payload?.kind === 'league-team' && payload.teamId) {
                  await onDropLeagueTeamRecopa('league', payload.teamId);
                }
              }}
              className={`p-2.5 rounded-xl border transition-colors ${
                dragOverRecopa === 'league'
                  ? 'border-amber-400 bg-amber-400/20'
                  : recopa.grandChampionSide === 'league'
                  ? 'border-amber-300/70 bg-amber-400/15'
                  : 'border-amber-400/40 bg-[#041224]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {recopa.leagueChampionCrestUrl ? (
                    <ResilientImage
                      src={recopa.leagueChampionCrestUrl}
                      alt={recopa.leagueChampionName}
                      className="w-7 h-7 rounded object-contain bg-[#041224] border border-amber-400/45 shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded bg-[#08264A] border border-amber-400/35 flex items-center justify-center shrink-0">
                      <Shield className="w-3.5 h-3.5 text-sky-300/70" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[10px] text-amber-300 font-semibold">Campeón de Liga</div>
                    <div className="text-xs font-bold text-white truncate">
                      {!isEmptyCupSlotName(recopa.leagueChampionName)
                        ? recopa.leagueChampionName
                        : interactive
                        ? 'Soltá equipo aquí'
                        : 'Por definir'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 font-mono text-sm font-bold text-white tabular-nums">
                  {recopa.leagueGoals !== null && (
                    <span>
                      {recopa.leagueGoals}
                      {recopa.leaguePenalties !== null ? `(${recopa.leaguePenalties})` : ''}
                    </span>
                  )}
                  {interactive && !isEmptyCupSlotName(recopa.leagueChampionName) && (
                    <button
                      type="button"
                      disabled={busyRecopa}
                      onClick={() =>
                        handleSelectRecopaWinner(
                          recopa.grandChampionSide === 'league' ? null : 'league'
                        )
                      }
                      title="Declarar ganador de Recopa"
                      className={`p-1 rounded ${
                        recopa.grandChampionSide === 'league'
                          ? 'bg-emerald-500/35 text-emerald-100'
                          : 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/35'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="text-center text-xs font-display font-extrabold text-amber-300 px-1">
              VS
            </div>

            {/* Side 2: Cup Champion / Finalist 2 */}
            <div
              onDragOver={(e) => {
                if (!interactive) return;
                e.preventDefault();
                setDragOverRecopa('cup');
              }}
              onDragLeave={() => setDragOverRecopa(null)}
              onDrop={async (e) => {
                if (!interactive || !onDropLeagueTeamRecopa) return;
                e.preventDefault();
                setDragOverRecopa(null);
                const payload = parseDragData(e);
                if (payload?.kind === 'league-team' && payload.teamId) {
                  await onDropLeagueTeamRecopa('cup', payload.teamId);
                }
              }}
              className={`p-2.5 rounded-xl border transition-colors ${
                dragOverRecopa === 'cup'
                  ? 'border-amber-400 bg-amber-400/20'
                  : recopa.grandChampionSide === 'cup'
                  ? 'border-emerald-400/70 bg-emerald-500/15'
                  : 'border-amber-400/40 bg-[#041224]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {recopa.cupChampionCrestUrl ? (
                    <ResilientImage
                      src={recopa.cupChampionCrestUrl}
                      alt={recopa.cupChampionName}
                      className="w-7 h-7 rounded object-contain bg-[#041224] border border-amber-400/45 shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded bg-[#08264A] border border-amber-400/35 flex items-center justify-center shrink-0">
                      <Shield className="w-3.5 h-3.5 text-sky-300/70" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[10px] text-amber-200 font-semibold">Campeón de Copa</div>
                    <div className="text-xs font-bold text-white truncate">
                      {!isEmptyCupSlotName(recopa.cupChampionName)
                        ? recopa.cupChampionName
                        : interactive
                        ? 'Soltá equipo aquí'
                        : 'Por definir'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 font-mono text-sm font-bold text-white tabular-nums">
                  {recopa.cupGoals !== null && (
                    <span>
                      {recopa.cupGoals}
                      {recopa.cupPenalties !== null ? `(${recopa.cupPenalties})` : ''}
                    </span>
                  )}
                  {interactive && !isEmptyCupSlotName(recopa.cupChampionName) && (
                    <button
                      type="button"
                      disabled={busyRecopa}
                      onClick={() =>
                        handleSelectRecopaWinner(recopa.grandChampionSide === 'cup' ? null : 'cup')
                      }
                      title="Declarar ganador de Recopa"
                      className={`p-1 rounded ${
                        recopa.grandChampionSide === 'cup'
                          ? 'bg-emerald-500/35 text-emerald-100'
                          : 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/35'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Recopa Champion Showcase */}
          <div className="md:col-span-4">
            {recopaFinished ? (
              <div className="p-3 rounded-xl bg-sky-500/15 border border-amber-300/60 flex items-center gap-3">
                {recopa.grandChampionCrestUrl ? (
                  <ResilientImage
                    src={recopa.grandChampionCrestUrl}
                    alt={recopa.grandChampionName}
                    className="w-11 h-11 rounded-lg object-contain bg-[#041224] border border-amber-300/70 p-0.5 shrink-0"
                  />
                ) : (
                  <Trophy className="w-9 h-9 text-amber-300 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-[10px] font-bold text-amber-300 uppercase tracking-wide">
                    {recopa.greeting || '¡Felicitaciones al Campeón de la Recopa!'}
                  </div>
                  <div className="font-display text-lg font-extrabold text-albiceleste-shiny truncate">
                    {recopa.grandChampionName}
                  </div>
                  {recopa.grandChampionMember && (
                    <div className="text-[11px] font-semibold text-amber-200 truncate">
                      DT: {recopa.grandChampionMember}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-[#041224] border border-amber-400/40 text-center">
                <div className="text-xs font-semibold text-sky-100">Campeón de la Recopa</div>
                <div className="text-[11px] text-sky-200/75 mt-0.5">
                  Se corona automáticamente al definir la Final de Recopa
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="bg-[#071D38]/95 border-2 border-amber-400/55 rounded-2xl overflow-hidden flex flex-col h-full shadow-xl shadow-black/50">
        <div className="px-5 py-4 border-b border-amber-400/35 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A]">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
              <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
                {embeddedPreview ? `Cuadro Interactivo — ${cup.editionName}` : cup.editionName}
              </h2>
            </div>
            <p className="text-xs text-sky-200/80">
              {interactive
                ? 'Arrastrá equipos entre llaves o desde los 30 equipos de la Liga, cargá goles directo en cada cruce o avanzá ganadores con un clic.'
                : 'Top 16 de Liga · 8° Octavos → 4° Cuartos → Semifinal → Final y Recopa'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!embeddedPreview && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs btn-celeste-gold rounded-lg transition-all whitespace-nowrap"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Ampliar Llaves</span>
              </button>
            )}
            {isAdmin && !embeddedPreview && (
              <button
                type="button"
                onClick={onEditCup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs btn-gold-luxury rounded-lg whitespace-nowrap"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar Copa (Admin)</span>
              </button>
            )}
          </div>
        </div>

        <div className="p-4 flex-1 flex flex-col justify-between gap-3">
          {renderBracketGrid(!embeddedPreview)}

          {!embeddedPreview && (
            <div className="pt-2.5 border-t border-amber-400/25 flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={onGoToRules}
                className="text-sky-200/80 hover:text-amber-300 transition-colors text-left"
              >
                Reglas de Copa: Eliminación directa · Tiempo Extra y Penales →
              </button>
              <button
                type="button"
                onClick={onGoToChampionsUpload}
                className="font-semibold text-amber-300 hover:text-amber-200 transition-colors whitespace-nowrap"
              >
                Subir festejo de campeón de Copa →
              </button>
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/90 p-3 sm:p-6 flex items-center justify-center">
          <div className="w-full max-w-[1340px] max-h-[92vh] overflow-y-auto bg-[#071D38] border-2 border-amber-400/70 rounded-2xl shadow-2xl">
            <div className="sticky top-0 z-10 px-6 py-4 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A] border-b border-amber-400/40 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Trophy className="w-5 h-5 text-amber-300" />
                <h3 className="font-display text-2xl font-extrabold text-albiceleste-shiny">
                  {cup.editionName} — Cuadro Completo
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Cerrar vista ampliada"
                className="p-2 text-amber-200 hover:text-white bg-[#0A294E] rounded-lg border border-amber-400/45"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 sm:p-6">{renderBracketGrid(false)}</div>
          </div>
        </div>
      )}
    </>
  );
}
