import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Crown,
  ExternalLink,
  Eye,
  GripVertical,
  RotateCcw,
  Save,
  Search,
  Shield,
  Trash2,
  Trophy,
  Upload,
  Users,
} from 'lucide-react';
import type { CupMatchNode, CupParticipant, CupRound, CupTournament, PublicTeam } from '../types';
import { apiFetch } from '../utils/api';
import { CupBracketCard } from './CupBracketCard';
import { ResilientImage } from './ResilientImage';

interface AdminCupPanelProps {
  cup: CupTournament;
  teams: PublicTeam[];
  onRefresh: () => Promise<void>;
  onGoToChampions: () => void;
  onGoToHome?: () => void;
}

type CupAdminSection = 'participantes' | 'r16' | 'qf' | 'sf' | 'final' | 'recopa';

function ParticipantSlotEditor({
  participant,
  allTeams,
  onSave,
  onRemove,
  onSwap,
}: {
  participant: CupParticipant;
  allTeams: PublicTeam[];
  onSave: (
    slot: number,
    payload: { teamName: string; memberName: string; teamId?: string; crestFile?: File | null }
  ) => Promise<void>;
  onRemove: (slot: number) => Promise<void>;
  onSwap: (slotA: number, slotB: number) => Promise<void>;
}) {
  const [teamName, setTeamName] = useState(participant.teamName);
  const [memberName, setMemberName] = useState(participant.memberName);
  const [teamId, setTeamId] = useState(participant.teamId || '');
  const [crestFile, setCrestFile] = useState<File | null>(null);
  const [crestPreview, setCrestPreview] = useState<string | null>(null);
  const [swapTarget, setSwapTarget] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTeamName(participant.teamName);
    setMemberName(participant.memberName);
    setTeamId(participant.teamId || '');
    setCrestFile(null);
  }, [participant.slot, participant.teamName, participant.memberName, participant.teamId, participant.crestUrl]);

  useEffect(() => {
    if (!crestFile) {
      setCrestPreview(null);
      return;
    }
    const url = URL.createObjectURL(crestFile);
    setCrestPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [crestFile]);

  const handleImportLeagueTeam = (selectedId: string) => {
    setTeamId(selectedId);
    const found = allTeams.find((t) => t.id === selectedId);
    if (found) {
      setTeamName(found.name);
      setMemberName(found.memberName);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(participant.slot, {
        teamName: teamName.trim() || `Cupo Libre #${participant.slot}`,
        memberName: memberName.trim() || 'Por definir',
        teamId: teamId || undefined,
        crestFile,
      });
      setCrestFile(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3.5 bg-[#05162B] border border-amber-400/45 rounded-xl space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-bold text-amber-300 shrink-0">
            #{participant.slot}
          </span>
          {crestPreview || participant.crestUrl ? (
            <ResilientImage
              src={crestPreview || participant.crestUrl}
              alt={teamName}
              className="w-8 h-8 rounded object-contain bg-[#041224] border border-amber-400/50 p-0.5 shrink-0"
              fallbackLabel={String(participant.slot)}
            />
          ) : (
            <div className="w-8 h-8 rounded bg-[#041224] border border-amber-400/45 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-amber-400/40" />
            </div>
          )}
          <span className="text-xs font-semibold text-amber-50 truncate">{participant.teamName}</span>
        </div>

        <button
          type="button"
          onClick={() => onRemove(participant.slot)}
          title="Quitar participante de este cupo"
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 rounded-md shrink-0"
        >
          <Trash2 className="w-3 h-3" />
          <span>Quitar</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-sky-200/80 mb-0.5">
            Importar de la Liga
          </label>
          <select
            value={teamId}
            onChange={(e) => handleImportLeagueTeam(e.target.value)}
            className="w-full px-2 py-1.5 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
          >
            <option value="">Personalizado / Manual</option>
            {allTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.memberName})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-sky-200/80 mb-0.5">
            Escudo PNG 128x128
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setCrestFile(e.target.files?.[0] || null)}
            className="w-full text-[11px] text-sky-100/90 file:mr-1.5 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-amber-400/20 file:text-amber-300"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-sky-200/80 mb-0.5">
            Nombre del Equipo en Copa
          </label>
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-sky-200/80 mb-0.5">
            Nombre del Participante
          </label>
          <input
            type="text"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1.5">
          <select
            value={swapTarget}
            onChange={(e) => setSwapTarget(e.target.value)}
            className="px-2 py-1 text-[11px] bg-[#041224] text-zinc-200 border border-amber-400/50 rounded-md"
          >
            <option value="">Mover a puesto...</option>
            {Array.from({ length: 16 }, (_, i) => i + 1)
              .filter((s) => s !== participant.slot)
              .map((s) => (
                <option key={s} value={s}>
                  Puesto #{s}
                </option>
              ))}
          </select>
          {swapTarget && (
            <button
              type="button"
              onClick={async () => {
                const target = Number(swapTarget);
                setSwapTarget('');
                await onSwap(participant.slot, target);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-amber-200 bg-amber-400/20 hover:bg-amber-400/30 rounded-md"
            >
              <ArrowLeftRight className="w-3 h-3" />
              <span>Cambiar</span>
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-lg"
        >
          <Save className="w-3 h-3" />
          <span>{saving ? 'Guardando...' : 'Guardar Cupo'}</span>
        </button>
      </div>
    </form>
  );
}

function MatchNodeEditor({
  match,
  participants,
  onSave,
}: {
  match: CupMatchNode;
  participants: CupParticipant[];
  onSave: (matchId: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [homeSlot, setHomeSlot] = useState<string>(match.homeSlot ? String(match.homeSlot) : '');
  const [awaySlot, setAwaySlot] = useState<string>(match.awaySlot ? String(match.awaySlot) : '');
  const [homeGoals, setHomeGoals] = useState<string>(
    match.homeGoals !== null ? String(match.homeGoals) : ''
  );
  const [awayGoals, setAwayGoals] = useState<string>(
    match.awayGoals !== null ? String(match.awayGoals) : ''
  );
  const [extraTime, setExtraTime] = useState<boolean>(match.extraTime);
  const [homePenalties, setHomePenalties] = useState<string>(
    match.homePenalties !== null ? String(match.homePenalties) : ''
  );
  const [awayPenalties, setAwayPenalties] = useState<string>(
    match.awayPenalties !== null ? String(match.awayPenalties) : ''
  );
  const [winnerSlot, setWinnerSlot] = useState<string>(
    match.winnerSlot ? String(match.winnerSlot) : ''
  );
  const [scheduledDate, setScheduledDate] = useState<string>(match.scheduledDate || '');
  const [scheduledTime, setScheduledTime] = useState<string>(match.scheduledTime || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHomeSlot(match.homeSlot ? String(match.homeSlot) : '');
    setAwaySlot(match.awaySlot ? String(match.awaySlot) : '');
    setHomeGoals(match.homeGoals !== null ? String(match.homeGoals) : '');
    setAwayGoals(match.awayGoals !== null ? String(match.awayGoals) : '');
    setExtraTime(match.extraTime);
    setHomePenalties(match.homePenalties !== null ? String(match.homePenalties) : '');
    setAwayPenalties(match.awayPenalties !== null ? String(match.awayPenalties) : '');
    setWinnerSlot(match.winnerSlot ? String(match.winnerSlot) : '');
    setScheduledDate(match.scheduledDate || '');
    setScheduledTime(match.scheduledTime || '');
  }, [match]);

  const roundLabels: Record<CupRound, string> = {
    r16: `8° Octavos de Final — Llave ${match.matchIndex}`,
    qf: `4° Cuartos de Final — Llave ${match.matchIndex}`,
    sf: `Semifinal ${match.matchIndex}`,
    final: 'Final de Copa de la Liga',
  };

  const nextRoundActionLabel: Record<CupRound, string> = {
    r16: 'Pasar a 4° Cuartos',
    qf: 'Pasar a Semifinales',
    sf: 'Pasar a la Final',
    final: 'Coronar Campeón',
  };

  const nextRoundDoneLabel: Record<CupRound, string> = {
    r16: 'En 4° Cuartos',
    qf: 'En Semifinales',
    sf: 'En la Final',
    final: 'Campeón de Copa',
  };

  const homeParticipant = participants.find((p) => String(p.slot) === homeSlot);
  const awayParticipant = participants.find((p) => String(p.slot) === awaySlot);

  const buildPayload = (overrideWinnerSlot?: number | null): Record<string, unknown> => {
    const hg = homeGoals === '' ? null : Number(homeGoals);
    const ag = awayGoals === '' ? null : Number(awayGoals);
    const hp = homePenalties === '' ? null : Number(homePenalties);
    const ap = awayPenalties === '' ? null : Number(awayPenalties);
    const payload: Record<string, unknown> = {
      homeSlot: homeSlot ? Number(homeSlot) : null,
      awaySlot: awaySlot ? Number(awaySlot) : null,
      homeGoals: hg,
      awayGoals: ag,
      extraTime,
      homePenalties: hp,
      awayPenalties: ap,
      scheduledDate: scheduledDate.trim(),
      scheduledTime: scheduledTime.trim(),
    };
    if (overrideWinnerSlot !== undefined) {
      payload.winnerSlot = overrideWinnerSlot;
      payload.played = overrideWinnerSlot !== null || (hg !== null && ag !== null);
    } else if (winnerSlot !== '') {
      payload.winnerSlot = Number(winnerSlot);
    } else {
      const hasDecisiveGoals = hg !== null && ag !== null && hg !== ag;
      const hasDecisivePens =
        hg !== null && ag !== null && hg === ag && hp !== null && ap !== null && hp !== ap;
      if (!hasDecisiveGoals && !hasDecisivePens) {
        payload.winnerSlot = null;
      }
    }
    return payload;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(match.id, buildPayload());
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAdvance = async (slot: number | null) => {
    setSaving(true);
    try {
      await onSave(match.id, buildPayload(slot));
    } finally {
      setSaving(false);
    }
  };

  const isHomeWinner = Boolean(homeSlot && String(match.winnerSlot || '') === homeSlot);
  const isAwayWinner = Boolean(awaySlot && String(match.winnerSlot || '') === awaySlot);

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 bg-[#05162B] border border-amber-400/45 rounded-xl space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-amber-300">{roundLabels[match.round]}</div>
        <div className="flex items-center gap-2">
          {match.winnerName && (
            <span className="text-xs font-semibold text-emerald-300">
              {nextRoundDoneLabel[match.round]}: {match.winnerName}
            </span>
          )}
          {match.winnerSlot && (
            <button
              type="button"
              disabled={saving}
              onClick={() => handleQuickAdvance(null)}
              className="px-2 py-0.5 text-[11px] font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 rounded"
            >
              Quitar avance
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
        <div className="md:col-span-4 space-y-1.5">
          <label className="block text-[10px] font-semibold text-sky-200/80">
            Equipo Local
          </label>
          <div className="flex items-center gap-2">
            {homeParticipant?.crestUrl ? (
              <ResilientImage
                src={homeParticipant.crestUrl}
                alt={homeParticipant.teamName}
                className="w-7 h-7 rounded object-contain bg-[#041224] border border-amber-400/50 shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded bg-[#041224] border border-amber-400/45 flex items-center justify-center shrink-0">
                <Shield className="w-3.5 h-3.5 text-amber-400/40" />
              </div>
            )}
            <select
              value={homeSlot}
              onChange={(e) => setHomeSlot(e.target.value)}
              className="w-full px-2.5 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
            >
              <option value="">Por definir</option>
              {participants.map((p) => (
                <option key={p.slot} value={p.slot}>
                  #{p.slot} · {p.teamName} ({p.memberName})
                </option>
              ))}
            </select>
          </div>
          {homeParticipant && !homeParticipant.teamName.startsWith('Cupo Libre') && (
            <button
              type="button"
              disabled={saving}
              onClick={() => handleQuickAdvance(isHomeWinner ? null : homeParticipant.slot)}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors ${
                isHomeWinner
                  ? 'text-emerald-950 bg-emerald-400 border-emerald-300'
                  : 'text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/35'
              }`}
            >
              {isHomeWinner ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>{nextRoundDoneLabel[match.round]}</span>
                </>
              ) : (
                <>
                  <span>{nextRoundActionLabel[match.round]}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>

        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold text-sky-200/80 mb-1.5">
            Goles Local
          </label>
          <input
            type="number"
            min={0}
            value={homeGoals}
            onChange={(e) => setHomeGoals(e.target.value)}
            placeholder="-"
            className="w-full px-2.5 py-2 text-xs font-mono text-center bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold text-sky-200/80 mb-1.5">
            Goles Visitante
          </label>
          <input
            type="number"
            min={0}
            value={awayGoals}
            onChange={(e) => setAwayGoals(e.target.value)}
            placeholder="-"
            className="w-full px-2.5 py-2 text-xs font-mono text-center bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
          />
        </div>

        <div className="md:col-span-4 space-y-1.5">
          <label className="block text-[10px] font-semibold text-sky-200/80">
            Equipo Visitante
          </label>
          <div className="flex items-center gap-2">
            {awayParticipant?.crestUrl ? (
              <ResilientImage
                src={awayParticipant.crestUrl}
                alt={awayParticipant.teamName}
                className="w-7 h-7 rounded object-contain bg-[#041224] border border-amber-400/50 shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded bg-[#041224] border border-amber-400/45 flex items-center justify-center shrink-0">
                <Shield className="w-3.5 h-3.5 text-amber-400/40" />
              </div>
            )}
            <select
              value={awaySlot}
              onChange={(e) => setAwaySlot(e.target.value)}
              className="w-full px-2.5 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
            >
              <option value="">Por definir</option>
              {participants.map((p) => (
                <option key={p.slot} value={p.slot}>
                  #{p.slot} · {p.teamName} ({p.memberName})
                </option>
              ))}
            </select>
          </div>
          {awayParticipant && !awayParticipant.teamName.startsWith('Cupo Libre') && (
            <button
              type="button"
              disabled={saving}
              onClick={() => handleQuickAdvance(isAwayWinner ? null : awayParticipant.slot)}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors ${
                isAwayWinner
                  ? 'text-emerald-950 bg-emerald-400 border-emerald-300'
                  : 'text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/35'
              }`}
            >
              {isAwayWinner ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>{nextRoundDoneLabel[match.round]}</span>
                </>
              ) : (
                <>
                  <span>{nextRoundActionLabel[match.round]}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center pt-1">
        <label className="sm:col-span-3 inline-flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={extraTime}
            onChange={(e) => setExtraTime(e.target.checked)}
            className="rounded border-amber-400/40 bg-[#041224] text-amber-400"
          />
          <span>Hubo Tiempo Extra</span>
        </label>

        <div className="sm:col-span-4 flex items-center gap-2">
          <span className="text-[11px] text-sky-200/80 shrink-0">Penales:</span>
          <input
            type="number"
            min={0}
            value={homePenalties}
            onChange={(e) => setHomePenalties(e.target.value)}
            placeholder="L"
            className="w-16 px-2 py-1 text-xs font-mono text-center bg-[#041224] text-amber-50 border border-amber-400/50 rounded"
          />
          <span className="text-zinc-500">-</span>
          <input
            type="number"
            min={0}
            value={awayPenalties}
            onChange={(e) => setAwayPenalties(e.target.value)}
            placeholder="V"
            className="w-16 px-2 py-1 text-xs font-mono text-center bg-[#041224] text-amber-50 border border-amber-400/50 rounded"
          />
        </div>

        <div className="sm:col-span-3">
          <select
            value={winnerSlot}
            onChange={(e) => setWinnerSlot(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs bg-[#041224] text-emerald-200 border border-emerald-500/40 rounded-lg"
          >
            <option value="">Ganador automático (por marcador)</option>
            {homeParticipant && (
              <option value={homeParticipant.slot}>
                Avanza: {homeParticipant.teamName}
              </option>
            )}
            {awayParticipant && (
              <option value={awayParticipant.slot}>
                Avanza: {awayParticipant.teamName}
              </option>
            )}
          </select>
        </div>

        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold btn-gold-luxury disabled:opacity-50 rounded-lg"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{saving ? '...' : 'Guardar'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center pt-2 border-t border-zinc-800/80">
        <div className="sm:col-span-5 text-[11px] text-emerald-300 font-semibold">
          Programación sincronizada con Calendario:
        </div>
        <div className="sm:col-span-4">
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            aria-label="Fecha del partido de Copa"
            className="w-full px-2.5 py-1 text-xs font-mono bg-[#06070A] text-white border border-zinc-400/35 rounded"
          />
        </div>
        <div className="sm:col-span-3">
          <input
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            aria-label="Hora del partido de Copa"
            className="w-full px-2.5 py-1 text-xs font-mono bg-[#06070A] text-amber-300 border border-zinc-400/35 rounded"
          />
        </div>
      </div>
    </form>
  );
}

export function AdminCupPanel({
  cup,
  teams,
  onRefresh,
  onGoToChampions,
  onGoToHome,
}: AdminCupPanelProps) {
  const [section, setSection] = useState<CupAdminSection>('r16');
  const [showLiveBracket, setShowLiveBracket] = useState(true);
  const [teamSearch, setTeamSearch] = useState('');
  const [trashDragOver, setTrashDragOver] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Cup general settings & Center Champion celebration form
  const [editionName, setEditionName] = useState(cup.editionName);
  const [cupStatus, setCupStatus] = useState<'in_progress' | 'finished'>(cup.status);
  const [championTeamName, setChampionTeamName] = useState(cup.championTeamName || '');
  const [championMemberName, setChampionMemberName] = useState(cup.championMemberName || '');
  const [championGreeting, setChampionGreeting] = useState(
    cup.championGreeting || '¡Felicitaciones Campeón de la Copa de la Liga!'
  );
  const [championCrestFile, setChampionCrestFile] = useState<File | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Reset confirmation
  const [confirmReset, setConfirmReset] = useState(false);
  const [clearParticipantsOnReset, setClearParticipantsOnReset] = useState(true);
  const [nextEditionName, setNextEditionName] = useState(
    `${cup.editionNumber + 1}° Edición — Copa de la Liga`
  );
  const [resetting, setResetting] = useState(false);

  // Recopa form
  const [leagueChampName, setLeagueChampName] = useState(cup.recopa.leagueChampionName);
  const [leagueChampMember, setLeagueChampMember] = useState(cup.recopa.leagueChampionMember);
  const [leagueChampCrest, setLeagueChampCrest] = useState(cup.recopa.leagueChampionCrestUrl);
  const [cupChampName, setCupChampName] = useState(cup.recopa.cupChampionName);
  const [cupChampMember, setCupChampMember] = useState(cup.recopa.cupChampionMember);
  const [cupChampCrest, setCupChampCrest] = useState(cup.recopa.cupChampionCrestUrl);
  const [leagueGoals, setLeagueGoals] = useState(
    cup.recopa.leagueGoals !== null ? String(cup.recopa.leagueGoals) : ''
  );
  const [cupGoals, setCupGoals] = useState(
    cup.recopa.cupGoals !== null ? String(cup.recopa.cupGoals) : ''
  );
  const [leaguePenalties, setLeaguePenalties] = useState(
    cup.recopa.leaguePenalties !== null ? String(cup.recopa.leaguePenalties) : ''
  );
  const [cupPenalties, setCupPenalties] = useState(
    cup.recopa.cupPenalties !== null ? String(cup.recopa.cupPenalties) : ''
  );
  const [recopaET, setRecopaET] = useState(cup.recopa.extraTime);
  const [grandChampSide, setGrandChampSide] = useState<'league' | 'cup' | ''>(
    cup.recopa.grandChampionSide || ''
  );
  const [recopaGreeting, setRecopaGreeting] = useState(
    cup.recopa.greeting || '¡Felicitaciones Campeón de la Recopa!'
  );
  const [recopaDate, setRecopaDate] = useState(cup.recopa.scheduledDate || '');
  const [recopaTime, setRecopaTime] = useState(cup.recopa.scheduledTime || '');
  const [savingRecopa, setSavingRecopa] = useState(false);

  useEffect(() => {
    setEditionName(cup.editionName);
    setCupStatus(cup.status);
    setChampionTeamName(cup.championTeamName || '');
    setChampionMemberName(cup.championMemberName || '');
    setChampionGreeting(cup.championGreeting || '¡Felicitaciones Campeón de la Copa de la Liga!');
    setNextEditionName(`${cup.editionNumber + 1}° Edición — Copa de la Liga`);

    setLeagueChampName(cup.recopa.leagueChampionName);
    setLeagueChampMember(cup.recopa.leagueChampionMember);
    setLeagueChampCrest(cup.recopa.leagueChampionCrestUrl);
    setCupChampName(cup.recopa.cupChampionName);
    setCupChampMember(cup.recopa.cupChampionMember);
    setCupChampCrest(cup.recopa.cupChampionCrestUrl);
    setLeagueGoals(cup.recopa.leagueGoals !== null ? String(cup.recopa.leagueGoals) : '');
    setCupGoals(cup.recopa.cupGoals !== null ? String(cup.recopa.cupGoals) : '');
    setLeaguePenalties(
      cup.recopa.leaguePenalties !== null ? String(cup.recopa.leaguePenalties) : ''
    );
    setCupPenalties(cup.recopa.cupPenalties !== null ? String(cup.recopa.cupPenalties) : '');
    setRecopaET(cup.recopa.extraTime);
    setGrandChampSide(cup.recopa.grandChampionSide || '');
    setRecopaGreeting(cup.recopa.greeting || '¡Felicitaciones Campeón de la Recopa!');
    setRecopaDate(cup.recopa.scheduledDate || '');
    setRecopaTime(cup.recopa.scheduledTime || '');
  }, [cup]);

  const showOk = (text: string) => setMsg({ type: 'ok', text });
  const showErr = (err: unknown) =>
    setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Ocurrió un error.' });

  const refreshAndBroadcast = async () => {
    await onRefresh();
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('lma-sync');
      bc.postMessage({ type: 'cup_updated', at: Date.now() });
      bc.close();
    }
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setSavingSettings(true);
    try {
      const form = new FormData();
      form.append('editionName', editionName.trim());
      form.append('status', cupStatus);
      form.append('championTeamName', championTeamName.trim());
      form.append('championMemberName', championMemberName.trim());
      form.append('championGreeting', championGreeting.trim());
      if (championCrestFile) {
        form.append('championCrest', championCrestFile);
      }
      await apiFetch('/api/admin/cup/settings', { method: 'PUT', body: form });
      setChampionCrestFile(null);
      await refreshAndBroadcast();
      showOk('Configuración y campeón central de la Copa guardados.');
    } catch (err) {
      showErr(err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSeedFromStandings = async () => {
    setMsg(null);
    try {
      await apiFetch('/api/admin/cup/seed-standings', {
        method: 'POST',
        body: JSON.stringify({ mode: 'seeded' }),
      });
      await refreshAndBroadcast();
      showOk('Top 16 de la Tabla de Posiciones cargado en las llaves de la Copa (sin modificar tus equipos de Liga).');
    } catch (err) {
      showErr(err);
    }
  };

  const handleSaveParticipant = async (
    slot: number,
    payload: { teamName: string; memberName: string; teamId?: string; crestFile?: File | null }
  ) => {
    setMsg(null);
    try {
      const form = new FormData();
      form.append('teamName', payload.teamName);
      form.append('memberName', payload.memberName);
      form.append('teamId', payload.teamId || '');
      if (payload.crestFile) {
        form.append('crest', payload.crestFile);
      }
      await apiFetch(`/api/admin/cup/participants/${slot}`, { method: 'PUT', body: form });
      await refreshAndBroadcast();
      showOk(`Cupo #${slot} actualizado (escudo PNG 128x128 y nombres guardados en la Copa).`);
    } catch (err) {
      showErr(err);
    }
  };

  const handleRemoveParticipant = async (slot: number) => {
    setMsg(null);
    try {
      await apiFetch(`/api/admin/cup/participants/${slot}`, { method: 'DELETE' });
      await refreshAndBroadcast();
      showOk(`Participante quitado del cupo #${slot}.`);
    } catch (err) {
      showErr(err);
    }
  };

  const handleSwapParticipants = async (slotA: number, slotB: number) => {
    setMsg(null);
    try {
      await apiFetch('/api/admin/cup/participants/swap', {
        method: 'POST',
        body: JSON.stringify({ slotA, slotB }),
      });
      await refreshAndBroadcast();
      showOk(`Se intercambiaron los puestos #${slotA} y #${slotB}.`);
    } catch (err) {
      showErr(err);
    }
  };

  const handleSaveMatch = async (matchId: string, body: Record<string, unknown>) => {
    setMsg(null);
    try {
      await apiFetch(`/api/admin/cup/matches/${encodeURIComponent(matchId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      await refreshAndBroadcast();
      showOk('Llave guardada y ganador avanzado automáticamente a la siguiente ronda.');
    } catch (err) {
      showErr(err);
    }
  };

  const handlePullLeagueLeader = async () => {
    setMsg(null);
    try {
      await apiFetch('/api/admin/cup/recopa', {
        method: 'PUT',
        body: JSON.stringify({ pullLeagueLeader: true }),
      });
      await refreshAndBroadcast();
      showOk('Campeón actual de la Liga (#1 de Tabla de Posiciones) cargado en la Recopa.');
    } catch (err) {
      showErr(err);
    }
  };

  const saveRecopaPayload = async (overrideSide?: 'league' | 'cup' | null) => {
    setMsg(null);
    setSavingRecopa(true);
    try {
      const selectedSide =
        overrideSide !== undefined ? overrideSide : grandChampSide ? grandChampSide : undefined;
      await apiFetch('/api/admin/cup/recopa', {
        method: 'PUT',
        body: JSON.stringify({
          leagueChampionName: leagueChampName.trim(),
          leagueChampionMember: leagueChampMember.trim(),
          leagueChampionCrestUrl: leagueChampCrest,
          cupChampionName: cupChampName.trim(),
          cupChampionMember: cupChampMember.trim(),
          cupChampionCrestUrl: cupChampCrest,
          leagueGoals: leagueGoals === '' ? null : Number(leagueGoals),
          cupGoals: cupGoals === '' ? null : Number(cupGoals),
          leaguePenalties: leaguePenalties === '' ? null : Number(leaguePenalties),
          cupPenalties: cupPenalties === '' ? null : Number(cupPenalties),
          extraTime: recopaET,
          greeting: recopaGreeting.trim() || '¡Felicitaciones Campeón de la Recopa!',
          scheduledDate: recopaDate.trim(),
          scheduledTime: recopaTime.trim(),
          ...(selectedSide !== undefined ? { grandChampionSide: selectedSide } : {}),
        }),
      });
      await refreshAndBroadcast();
      showOk('Final de Recopa y felicitación al Gran Campeón actualizadas.');
    } catch (err) {
      showErr(err);
    } finally {
      setSavingRecopa(false);
    }
  };

  const handleAssignRecopaTeam = async (side: 'league' | 'cup', teamId: string) => {
    if (!teamId) return;
    setMsg(null);
    setSavingRecopa(true);
    try {
      await apiFetch('/api/admin/cup/recopa', {
        method: 'PUT',
        body: JSON.stringify(
          side === 'league' ? { leagueTeamId: teamId } : { cupTeamId: teamId }
        ),
      });
      await refreshAndBroadcast();
      showOk('Equipo de Liga agregado a la Recopa.');
    } catch (err) {
      showErr(err);
    } finally {
      setSavingRecopa(false);
    }
  };

  const handleClearRecopaSide = async (side: 'league' | 'cup') => {
    setMsg(null);
    setSavingRecopa(true);
    try {
      await apiFetch('/api/admin/cup/recopa', {
        method: 'PUT',
        body: JSON.stringify(side === 'league' ? { clearLeague: true } : { clearCup: true }),
      });
      await refreshAndBroadcast();
      showOk('Equipo quitado de la Recopa.');
    } catch (err) {
      showErr(err);
    } finally {
      setSavingRecopa(false);
    }
  };

  const handleSaveRecopa = async (e: FormEvent) => {
    e.preventDefault();
    await saveRecopaPayload();
  };

  const handleResetCup = async () => {
    setMsg(null);
    setResetting(true);
    try {
      await apiFetch('/api/admin/cup/reset', {
        method: 'POST',
        body: JSON.stringify({
          clearParticipants: clearParticipantsOnReset,
          editionName: nextEditionName.trim(),
        }),
      });
      setConfirmReset(false);
      await refreshAndBroadcast();
      showOk('Copa reiniciada desde cero para comenzar la nueva edición.');
    } catch (err) {
      showErr(err);
    } finally {
      setResetting(false);
    }
  };

  const handleDropLeagueTeamOnMatch = async (
    matchId: string,
    side: 'home' | 'away',
    teamId: string
  ) => {
    setMsg(null);
    try {
      const targetMatch = cup.matches.find((m) => m.id === matchId);
      const foundTeam = teams.find((t) => t.id === teamId);
      if (!targetMatch || !foundTeam) return;

      // Determine target participant slot (1..16)
      let targetSlot = side === 'home' ? targetMatch.homeSlot : targetMatch.awaySlot;
      if (!targetSlot) {
        if (targetMatch.round === 'r16') {
          targetSlot = (targetMatch.matchIndex - 1) * 2 + (side === 'home' ? 1 : 2);
        } else {
          // Reuse existing slot of this team if already in cup, else first empty slot
          const existing = cup.participants.find((p) => p.teamId === teamId);
          const free = cup.participants.find(
            (p) => !p.teamId && (p.teamName.startsWith('Cupo Libre') || p.teamName === 'Por definir')
          );
          targetSlot = existing?.slot || free?.slot || 1;
        }
      }

      const form = new FormData();
      form.append('teamId', foundTeam.id);
      form.append('teamName', foundTeam.name);
      form.append('memberName', foundTeam.memberName);
      form.append('crestUrl', foundTeam.crestUrl);
      await apiFetch(`/api/admin/cup/participants/${targetSlot}`, { method: 'PUT', body: form });

      if (targetMatch.round !== 'r16') {
        await apiFetch(`/api/admin/cup/matches/${encodeURIComponent(matchId)}`, {
          method: 'PUT',
          body: JSON.stringify(
            side === 'home' ? { homeSlot: targetSlot } : { awaySlot: targetSlot }
          ),
        });
      }

      await refreshAndBroadcast();
      showOk(`${foundTeam.name} colocado en la llave correctamente.`);
    } catch (err) {
      showErr(err);
    }
  };

  const handleDropSlotOnMatch = async (
    targetMatchId: string,
    targetSide: 'home' | 'away',
    sourceSlot: number,
    sourceMatchId?: string
  ) => {
    setMsg(null);
    try {
      const targetMatch = cup.matches.find((m) => m.id === targetMatchId);
      if (!targetMatch) return;

      if (targetMatch.round === 'r16' && (!sourceMatchId || sourceMatchId.startsWith('r16'))) {
        const computedTargetSlot =
          (targetMatch.matchIndex - 1) * 2 + (targetSide === 'home' ? 1 : 2);
        if (computedTargetSlot === sourceSlot) return;
        await apiFetch('/api/admin/cup/participants/swap', {
          method: 'POST',
          body: JSON.stringify({ slotA: sourceSlot, slotB: computedTargetSlot }),
        });
        await refreshAndBroadcast();
        showOk(`Equipo movido del puesto #${sourceSlot} al #${computedTargetSlot}.`);
        return;
      }

      await apiFetch(`/api/admin/cup/matches/${encodeURIComponent(targetMatchId)}`, {
        method: 'PUT',
        body: JSON.stringify(
          targetSide === 'home' ? { homeSlot: sourceSlot } : { awaySlot: sourceSlot }
        ),
      });
      await refreshAndBroadcast();
      showOk('Equipo asignado a la llave.');
    } catch (err) {
      showErr(err);
    }
  };

  const handleClearMatchSide = async (
    matchId: string,
    side: 'home' | 'away',
    slot: number | null
  ) => {
    setMsg(null);
    try {
      const targetMatch = cup.matches.find((m) => m.id === matchId);
      if (!targetMatch) return;
      if (targetMatch.round === 'r16' && slot) {
        await apiFetch(`/api/admin/cup/participants/${slot}`, { method: 'DELETE' });
      } else {
        await apiFetch(`/api/admin/cup/matches/${encodeURIComponent(matchId)}`, {
          method: 'PUT',
          body: JSON.stringify(side === 'home' ? { homeSlot: null } : { awaySlot: null }),
        });
      }
      await refreshAndBroadcast();
      showOk('Equipo eliminado de la llave.');
    } catch (err) {
      showErr(err);
    }
  };

  const handleDropToRedTrash = async (e: DragEvent) => {
    e.preventDefault();
    setTrashDragOver(false);
    try {
      const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const payload = JSON.parse(raw) as {
        kind?: string;
        slot?: number;
        matchId?: string;
        side?: 'home' | 'away';
        round?: CupRound;
      };
      if (payload.kind === 'cup-slot' && payload.matchId && payload.side) {
        await handleClearMatchSide(payload.matchId, payload.side, payload.slot || null);
      } else if (payload.kind === 'cup-slot' && payload.slot) {
        await handleRemoveParticipant(payload.slot);
      }
    } catch (err) {
      showErr(err);
    }
  };

  const matchesByRound = (r: CupRound) =>
    cup.matches.filter((m) => m.round === r).sort((a, b) => a.matchIndex - b.matchIndex);

  const filteredLeagueTeams = teams.filter((t) => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.memberName.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header + Settings + Reset */}
      <div className="p-6 bg-[#071D38]/95 border border-amber-400/50 rounded-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl font-bold text-albiceleste-shiny flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-300" />
              <span>Administrar Copa de la Liga (16 Equipos)</span>
            </h3>
            <p className="text-xs text-sky-200/80">
              Modificá llaves, escudos PNG 128x128, nombres, orden de cruces, campeón central, Recopa y reinicio de edición.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onGoToHome && (
              <button
                type="button"
                onClick={onGoToHome}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 rounded-lg"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Ver Copa en Inicio</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowLiveBracket((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 rounded-lg"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>{showLiveBracket ? 'Ocultar Cuadro en Vivo' : 'Ver Cuadro en Vivo'}</span>
            </button>
            <button
              type="button"
              onClick={handleSeedFromStandings}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold btn-gold-luxury rounded-lg"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Cargar Top 16 desde Posiciones</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-200 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 rounded-lg"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reiniciar Copa de Cero</span>
            </button>
          </div>
        </div>

        {msg && (
          <div
            className={`p-3 text-sm rounded-xl border ${
              msg.type === 'ok'
                ? 'bg-emerald-950/60 border-emerald-400/40 text-emerald-200'
                : 'bg-rose-950/60 border-rose-400/40 text-rose-200'
            }`}
          >
            {msg.text}
          </div>
        )}

        {confirmReset && (
          <div className="p-4 bg-rose-950/40 border border-rose-400/40 rounded-xl space-y-3">
            <div className="text-sm font-bold text-rose-200">
              Reiniciar Copa desde Cero y comenzar la siguiente edición
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <input
                type="text"
                value={nextEditionName}
                onChange={(e) => setNextEditionName(e.target.value)}
                placeholder="Ej: 2° Edición — Copa de la Liga"
                className="px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
              <label className="inline-flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearParticipantsOnReset}
                  onChange={(e) => setClearParticipantsOnReset(e.target.checked)}
                />
                <span>Vaciar también los 16 cupos de participantes</span>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-sky-100/90 bg-[#0A294E] border border-amber-400/45 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={handleResetCup}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg"
              >
                {resetting ? 'Reiniciando...' : 'Confirmar Reinicio Completo'}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSaveSettings} className="pt-3 border-t border-amber-400/15 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-sky-100/90 mb-1">
                Nombre de Edición de Copa
              </label>
              <input
                type="text"
                value={editionName}
                onChange={(e) => setEditionName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-sky-100/90 mb-1">
                Estado de la Copa
              </label>
              <select
                value={cupStatus}
                onChange={(e) => setCupStatus(e.target.value as 'in_progress' | 'finished')}
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              >
                <option value="in_progress">En competencia</option>
                <option value="finished">Finalizada (Mostrar Copa y Ganador en el centro)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-sky-100/90 mb-1">
                Nombre Equipo Ganador (Centro)
              </label>
              <input
                type="text"
                value={championTeamName}
                onChange={(e) => setChampionTeamName(e.target.value)}
                placeholder="Ej: Boca Juniors"
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-sky-100/90 mb-1">
                Nombre Participante Ganador
              </label>
              <input
                type="text"
                value={championMemberName}
                onChange={(e) => setChampionMemberName(e.target.value)}
                placeholder="Ej: ElPipa_10"
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-6">
              <label className="block text-xs font-semibold text-sky-100/90 mb-1">
                Mensaje de Felicitación al Ganador
              </label>
              <input
                type="text"
                value={championGreeting}
                onChange={(e) => setChampionGreeting(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-xs font-semibold text-sky-100/90 mb-1">
                Escudo Ganador PNG 128x128 (opcional)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setChampionCrestFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-sky-100/90 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-amber-400/20 file:text-amber-300"
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="w-full px-4 py-2 text-xs font-semibold btn-gold-luxury disabled:opacity-50 rounded-lg"
              >
                {savingSettings ? 'Guardando...' : 'Guardar Copa'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Banco de los 30 Equipos (Arrastrar a cualquier llave) + Cesto de Basura Rojo */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-9 p-4 bg-[#071D38]/95 border border-amber-400/50 rounded-2xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-amber-100 flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-amber-300" />
                <span>Equipos de la Liga ({teams.length}/30) — Arrastrá cualquiera hacia las llaves o Recopa</span>
              </h4>
              <p className="text-[11px] text-sky-200/80">
                También podés arrastrar equipos directamente entre llaves del cuadro para cambiarlos de lugar.
              </p>
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-sky-200/80 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Buscar equipo o DT..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
            {filteredLeagueTeams.map((t) => (
              <div
                key={t.id}
                draggable
                onDragStart={(e) => {
                  const payload = JSON.stringify({ kind: 'league-team', teamId: t.id });
                  e.dataTransfer.setData('application/json', payload);
                  e.dataTransfer.setData('text/plain', payload);
                  e.dataTransfer.effectAllowed = 'copyMove';
                }}
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#05162B] border border-amber-400/45 hover:border-amber-400/60 cursor-grab active:cursor-grabbing transition-colors select-none"
                title={`Arrastrá a ${t.name} hacia cualquier llave de la Copa o Recopa`}
              >
                <ResilientImage
                  src={t.crestUrl}
                  alt={t.name}
                  className="w-5 h-5 rounded object-contain bg-[#041224] shrink-0"
                />
                <span className="text-xs font-semibold text-amber-50">{t.name}</span>
                <span className="text-[10px] text-sky-200/80">({t.memberName})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Cesto de Basura Rojo (Dropzone para eliminar equipo de una llave) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setTrashDragOver(true);
          }}
          onDragLeave={() => setTrashDragOver(false)}
          onDrop={(e) => void handleDropToRedTrash(e)}
          className={`lg:col-span-3 p-4 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center gap-2 transition-all ${
            trashDragOver
              ? 'bg-rose-600/30 border-rose-400 scale-[1.02] shadow-[0_0_25px_rgba(244,63,94,0.4)]'
              : 'bg-rose-950/35 border-rose-500/60 hover:border-rose-400'
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-900/50">
            <Trash2 className="w-6 h-6" />
          </div>
          <div className="text-xs font-bold text-rose-200 uppercase tracking-wide">
            Cesto de Basura
          </div>
          <p className="text-[11px] text-rose-200/80 leading-snug">
            Arrastrá aquí cualquier equipo de una llave si querés eliminarlo o hubo un error.
          </p>
        </div>
      </div>

      {/* Vista en Vivo Interactiva del Cuadro (reflejada en Inicio) */}
      {showLiveBracket && (
        <CupBracketCard
          cup={cup}
          isAdmin
          embeddedPreview
          onEditCup={() => setSection('r16')}
          onGoToChampionsUpload={onGoToChampions}
          onGoToRules={() => undefined}
          onRefresh={refreshAndBroadcast}
          onDropLeagueTeam={handleDropLeagueTeamOnMatch}
          onDropSlotOnMatch={handleDropSlotOnMatch}
          onDropLeagueTeamRecopa={handleAssignRecopaTeam}
          onClearMatchSide={handleClearMatchSide}
        />
      )}

      {/* Sub-navigation for Cup rounds & participants */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#071D38]/95 border border-amber-400/50 rounded-xl">
        {(
          [
            { id: 'r16', label: '8° Octavos de Final (8)' },
            { id: 'qf', label: '4° Cuartos de Final (4)' },
            { id: 'sf', label: 'Semifinales (2)' },
            { id: 'final', label: 'Final de Copa (1)' },
            { id: 'participantes', label: '16 Participantes y Escudos' },
            { id: 'recopa', label: 'Recopa — Gran Campeón' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              section === tab.id
                ? 'btn-gold-luxury'
                : 'text-sky-100/90 hover:text-amber-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 16 Participants & Order */}
      {section === 'participantes' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cup.participants.map((p) => (
            <ParticipantSlotEditor
              key={p.slot}
              participant={p}
              allTeams={teams}
              onSave={handleSaveParticipant}
              onRemove={handleRemoveParticipant}
              onSwap={handleSwapParticipants}
            />
          ))}
        </div>
      )}

      {/* Round Matchups */}
      {(section === 'r16' || section === 'qf' || section === 'sf' || section === 'final') && (
        <div className="space-y-3">
          {matchesByRound(section).map((m) => (
            <MatchNodeEditor
              key={m.id}
              match={m}
              participants={cup.participants}
              onSave={handleSaveMatch}
            />
          ))}
        </div>
      )}

      {/* Recopa: League Champion vs Cup Champion */}
      {section === 'recopa' && (
        <form
          onSubmit={handleSaveRecopa}
          className="p-6 bg-[#071D38]/95 border border-amber-400/50 rounded-2xl space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-display text-2xl font-bold text-albiceleste-shiny flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-300" />
                <span>Recopa — Gran Campeón de la Liga Master Argentina</span>
              </h4>
              <p className="text-xs text-sky-200/80">
                El Campeón de la Liga enfrenta al Campeón de la Copa de la Liga para definir al Gran Campeón.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePullLeagueLeader}
                className="px-3.5 py-2 text-xs font-semibold btn-gold-luxury rounded-lg"
              >
                Traer 1° de Tabla de Posiciones
              </button>
              <button
                type="button"
                onClick={onGoToChampions}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 rounded-lg"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Subir Festejo en Historial</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-[#05162B] border border-amber-400/45 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {leagueChampCrest ? (
                    <ResilientImage
                      src={leagueChampCrest}
                      alt={leagueChampName || 'Equipo Liga'}
                      className="w-6 h-6 rounded object-contain bg-[#041224] border border-amber-400/50 shrink-0"
                    />
                  ) : (
                    <Shield className="w-5 h-5 text-amber-300 shrink-0" />
                  )}
                  <span className="text-xs font-bold text-amber-300 truncate">
                    Equipo de la Liga (Cupo 1)
                  </span>
                </div>
                <button
                  type="button"
                  disabled={savingRecopa || !leagueChampName}
                  onClick={() => handleClearRecopaSide('league')}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-40 rounded-md shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Quitar</span>
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-sky-200/80 mb-1">
                  Agregar equipo de la Liga
                </label>
                <select
                  value=""
                  disabled={savingRecopa}
                  onChange={(e) => {
                    if (e.target.value) void handleAssignRecopaTeam('league', e.target.value);
                  }}
                  className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-200 border border-amber-400/35 rounded-lg"
                >
                  <option value="">Seleccionar equipo de la Liga para agregar...</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.memberName})
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                value={leagueChampName}
                onChange={(e) => setLeagueChampName(e.target.value)}
                placeholder="Equipo Campeón de Liga"
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
              <input
                type="text"
                value={leagueChampMember}
                onChange={(e) => setLeagueChampMember(e.target.value)}
                placeholder="Participante Campeón de Liga"
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] text-sky-200/80 mb-1">Goles</label>
                  <input
                    type="number"
                    min={0}
                    value={leagueGoals}
                    onChange={(e) => setLeagueGoals(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-sky-200/80 mb-1">Penales (opc.)</label>
                  <input
                    type="number"
                    min={0}
                    value={leaguePenalties}
                    onChange={(e) => setLeaguePenalties(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={savingRecopa || !leagueChampName.trim()}
                onClick={() =>
                  saveRecopaPayload(cup.recopa.grandChampionSide === 'league' ? null : 'league')
                }
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-40 ${
                  cup.recopa.grandChampionSide === 'league'
                    ? 'text-amber-950 bg-amber-300 border-amber-200'
                    : 'text-amber-200 bg-amber-400/15 hover:bg-amber-400/25 border-amber-400/35'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {cup.recopa.grandChampionSide === 'league'
                    ? 'Ganador y Felicitado en Inicio (Clic para quitar)'
                    : 'Dar por Ganador y Felicitar'}
                </span>
              </button>
            </div>

            <div className="p-4 bg-[#05162B] border border-amber-400/45 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {cupChampCrest ? (
                    <ResilientImage
                      src={cupChampCrest}
                      alt={cupChampName || 'Equipo Copa'}
                      className="w-6 h-6 rounded object-contain bg-[#041224] border border-amber-400/50 shrink-0"
                    />
                  ) : (
                    <Shield className="w-5 h-5 text-emerald-300 shrink-0" />
                  )}
                  <span className="text-xs font-bold text-emerald-300 truncate">
                    Campeón de Copa / Rival (Cupo 2)
                  </span>
                </div>
                <button
                  type="button"
                  disabled={savingRecopa || !cupChampName}
                  onClick={() => handleClearRecopaSide('cup')}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-40 rounded-md shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Quitar</span>
                </button>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-sky-200/80 mb-1">
                  Agregar equipo de la Liga
                </label>
                <select
                  value=""
                  disabled={savingRecopa}
                  onChange={(e) => {
                    if (e.target.value) void handleAssignRecopaTeam('cup', e.target.value);
                  }}
                  className="w-full px-3 py-2 text-xs bg-[#041224] text-emerald-200 border border-emerald-500/40 rounded-lg"
                >
                  <option value="">Seleccionar equipo de la Liga para agregar...</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.memberName})
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                value={cupChampName}
                onChange={(e) => setCupChampName(e.target.value)}
                placeholder="Equipo Campeón de Copa"
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
              <input
                type="text"
                value={cupChampMember}
                onChange={(e) => setCupChampMember(e.target.value)}
                placeholder="Participante Campeón de Copa"
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
              />
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] text-sky-200/80 mb-1">Goles</label>
                  <input
                    type="number"
                    min={0}
                    value={cupGoals}
                    onChange={(e) => setCupGoals(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-sky-200/80 mb-1">Penales (opc.)</label>
                  <input
                    type="number"
                    min={0}
                    value={cupPenalties}
                    onChange={(e) => setCupPenalties(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={savingRecopa || !cupChampName.trim()}
                onClick={() =>
                  saveRecopaPayload(cup.recopa.grandChampionSide === 'cup' ? null : 'cup')
                }
                className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-40 ${
                  cup.recopa.grandChampionSide === 'cup'
                    ? 'text-emerald-950 bg-emerald-300 border-emerald-200'
                    : 'text-emerald-200 bg-emerald-400/15 hover:bg-emerald-400/25 border-emerald-400/35'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {cup.recopa.grandChampionSide === 'cup'
                    ? 'Ganador y Felicitado en Inicio (Clic para quitar)'
                    : 'Dar por Ganador y Felicitar'}
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-6">
              <label className="block text-xs font-semibold text-zinc-200 mb-1">
                Mensaje de Felicitación para el Campeón de la Recopa (visible en Inicio)
              </label>
              <input
                type="text"
                value={recopaGreeting}
                onChange={(e) => setRecopaGreeting(e.target.value)}
                placeholder="¡Felicitaciones Campeón de la Recopa!"
                className="w-full px-3 py-2 text-xs bg-[#06070A] text-amber-50 border border-amber-400/50 rounded-lg"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold text-zinc-200 mb-1">
                Fecha Recopa (Calendario)
              </label>
              <input
                type="date"
                value={recopaDate}
                onChange={(e) => setRecopaDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#06070A] text-white border border-zinc-400/40 rounded-lg"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold text-zinc-200 mb-1">
                Hora Recopa
              </label>
              <input
                type="time"
                value={recopaTime}
                onChange={(e) => setRecopaTime(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#06070A] text-amber-300 border border-zinc-400/40 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
            <label className="inline-flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={recopaET}
                onChange={(e) => setRecopaET(e.target.checked)}
              />
              <span>Tiempo Extra jugado</span>
            </label>

            <div>
              <select
                value={grandChampSide}
                onChange={(e) => setGrandChampSide(e.target.value as 'league' | 'cup' | '')}
                className="w-full px-3 py-2 text-xs bg-[#041224] text-amber-200 border border-amber-400/40 rounded-lg"
              >
                <option value="">Gran Campeón automático (por marcador)</option>
                <option value="league">Gran Campeón: Campeón de Liga ({leagueChampName})</option>
                <option value="cup">Gran Campeón: Campeón de Copa ({cupChampName})</option>
              </select>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingRecopa}
                className="px-5 py-2 text-xs font-semibold btn-gold-luxury disabled:opacity-50 rounded-lg"
              >
                {savingRecopa ? 'Guardando...' : 'Guardar Final de Recopa'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
