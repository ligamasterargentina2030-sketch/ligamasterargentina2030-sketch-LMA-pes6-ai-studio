import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Award,
  CalendarDays,
  Check,
  Eye,
  Film,
  Image as ImageIcon,
  PlusCircle,
  ShieldAlert,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  Claim,
  ClaimReasonType,
  CupMatchNode,
  CupRound,
  CupTournament,
  Match,
  PublicTeam,
  ScheduledFixture,
} from '../types';
import { apiFetch } from '../utils/api';
import { ResilientImage } from './ResilientImage';

export type MatchesSubTab = 'validated' | 'fixtures' | 'mine' | 'pending' | 'submit' | 'claims';

interface MatchesViewProps {
  matches: Match[];
  fixtures?: ScheduledFixture[];
  claims?: Claim[];
  teams: PublicTeam[];
  cup?: CupTournament;
  user: AuthUser | null;
  initialSubTab?: MatchesSubTab;
  onOpenAuth: () => void;
  onOpenCups?: () => void;
  onRefresh: () => Promise<void>;
}

const CLAIM_REASON_LABELS: Record<ClaimReasonType, string> = {
  juego_sucio: 'Tarjetas Amarillas / Rojas · Juego Sucio',
  gol_prohibido: 'Gol Prohibido (Pase al ras dentro del área)',
  otro: 'Otro Reclamo de Partido',
};

export function MatchesView({
  matches,
  fixtures = [],
  claims = [],
  teams,
  cup,
  user,
  initialSubTab = 'validated',
  onOpenAuth,
  onOpenCups,
  onRefresh,
}: MatchesViewProps) {
  const [filterTab, setFilterTab] = useState<MatchesSubTab>(initialSubTab);
  const [modalMedia, setModalMedia] = useState<{ title: string; url: string } | null>(null);

  // Match result submission state
  const [competitionType, setCompetitionType] = useState<'liga' | 'copa' | 'recopa'>('liga');
  const [selectedCupMatchId, setSelectedCupMatchId] = useState<string>('');
  const [homePenalties, setHomePenalties] = useState('');
  const [awayPenalties, setAwayPenalties] = useState('');
  const [extraTime, setExtraTime] = useState(false);
  const [cupSyncBanner, setCupSyncBanner] = useState<string | null>(null);

  const [selectedFixtureId, setSelectedFixtureId] = useState<string>('');
  const [homeTeamId, setHomeTeamId] = useState(user?.teamId || teams[0]?.id || '');
  const [awayTeamId, setAwayTeamId] = useState(
    teams.find((t) => t.id !== (user?.teamId || teams[0]?.id))?.id || ''
  );
  const [homeGoals, setHomeGoals] = useState('0');
  const [awayGoals, setAwayGoals] = useState('0');
  const [matchday, setMatchday] = useState('1');
  const [leg, setLeg] = useState<'Ida' | 'Vuelta'>('Ida');
  const [playedAt, setPlayedAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);

  // Top Scorer ("Goleador") photo + name
  const [scorerName, setScorerName] = useState('');
  const [scorerFile, setScorerFile] = useState<File | null>(null);
  const [scorerPreview, setScorerPreview] = useState<string | null>(null);
  const scorerInputRef = useRef<HTMLInputElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [editHomeGoals, setEditHomeGoals] = useState('0');
  const [editAwayGoals, setEditAwayGoals] = useState('0');

  // RECLAMOS (Claims) state
  const [claimReasonType, setClaimReasonType] = useState<ClaimReasonType>('juego_sucio');
  const [claimAccusedTeamId, setClaimAccusedTeamId] = useState('');
  const [claimMatchId, setClaimMatchId] = useState('');
  const [claimDescription, setClaimDescription] = useState('');
  const [claimCardFile, setClaimCardFile] = useState<File | null>(null);
  const [claimCardPreview, setClaimCardPreview] = useState<string | null>(null);
  const claimCardInputRef = useRef<HTMLInputElement | null>(null);
  const [claimVideoFile, setClaimVideoFile] = useState<File | null>(null);
  const claimVideoInputRef = useRef<HTMLInputElement | null>(null);
  const [claimVideoUrl, setClaimVideoUrl] = useState('');
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [claimMsg, setClaimMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setFilterTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    if (!proofFile) {
      setProofPreview(null);
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  useEffect(() => {
    if (!scorerFile) {
      setScorerPreview(null);
      return;
    }
    const url = URL.createObjectURL(scorerFile);
    setScorerPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [scorerFile]);

  useEffect(() => {
    if (!claimCardFile) {
      setClaimCardPreview(null);
      return;
    }
    const url = URL.createObjectURL(claimCardFile);
    setClaimCardPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [claimCardFile]);

  useEffect(() => {
    if (!user?.teamId) return;
    setHomeTeamId((prev) => (prev && teams.some((t) => t.id === prev) ? prev : user.teamId!));
    setAwayTeamId((prev) =>
      prev && teams.some((t) => t.id === prev)
        ? prev
        : teams.find((t) => t.id !== user.teamId)?.id || ''
    );
  }, [user?.teamId, teams]);

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const userTeam = user?.teamId ? teamMap.get(user.teamId) : undefined;
  const validatedMatches = useMemo(() => matches.filter((m) => m.status === 'validated'), [matches]);
  const pendingMatches = useMemo(() => matches.filter((m) => m.status === 'pending'), [matches]);
  const myMatches = useMemo(
    () =>
      user?.teamId
        ? matches.filter((m) => m.homeTeamId === user.teamId || m.awayTeamId === user.teamId)
        : [],
    [matches, user?.teamId]
  );

  const groupedFixtures = useMemo(() => {
    const map = new Map<number, ScheduledFixture[]>();
    const sorted = [...fixtures].sort((a, b) => a.matchday - b.matchday);
    for (const fx of sorted) {
      const list = map.get(fx.matchday) || [];
      list.push(fx);
      map.set(fx.matchday, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [fixtures]);

  const normalizeCupLabel = (val?: string | null) =>
    (val || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  const CUP_ROUND_LABELS: Record<CupRound, string> = {
    r16: 'Octavos de Final',
    qf: 'Cuartos de Final',
    sf: 'Semifinal',
    final: 'Gran Final',
  };

  const getCupNodeTeamInfo = (cm: CupMatchNode, side: 'home' | 'away') => {
    const slot = side === 'home' ? cm.homeSlot : cm.awaySlot;
    const participant = slot !== null ? cup?.participants?.find((p) => p.slot === slot) : undefined;
    const teamName =
      (side === 'home' ? cm.homeTeamName : cm.awayTeamName) || participant?.teamName || '';
    const memberName =
      (side === 'home' ? cm.homeMemberName : cm.awayMemberName) || participant?.memberName || '';
    const teamId = participant?.teamId || '';
    return { teamId, teamName, memberName };
  };

  const findTeamIdByCupName = (cupName?: string | null, cupMember?: string | null): string => {
    const target = normalizeCupLabel(cupName);
    const targetMember = normalizeCupLabel(cupMember);
    if (
      (!target || target === 'por definir' || target === 'tbd' || target.startsWith('ganador')) &&
      !targetMember
    ) {
      return '';
    }
    const exact = teams.find(
      (t) =>
        (target && normalizeCupLabel(t.name) === target) ||
        (targetMember && normalizeCupLabel(t.memberName) === targetMember) ||
        (target && normalizeCupLabel(t.memberName) === target)
    );
    if (exact) return exact.id;
    const partial = teams.find(
      (t) =>
        target &&
        (normalizeCupLabel(t.name).includes(target) || target.includes(normalizeCupLabel(t.name)))
    );
    return partial?.id || '';
  };

  const selectableCupMatches = useMemo(() => {
    const list = (cup?.matches || []).filter((cm) => {
      const hInfo = getCupNodeTeamInfo(cm, 'home');
      const aInfo = getCupNodeTeamInfo(cm, 'away');
      const h = normalizeCupLabel(hInfo.teamName);
      const a = normalizeCupLabel(aInfo.teamName);
      return (
        h &&
        a &&
        h !== 'por definir' &&
        a !== 'por definir' &&
        !h.startsWith('ganador') &&
        !a.startsWith('ganador')
      );
    });
    const myNormName = normalizeCupLabel(userTeam?.name);
    const involvesMe = (cm: CupMatchNode) => {
      const hInfo = getCupNodeTeamInfo(cm, 'home');
      const aInfo = getCupNodeTeamInfo(cm, 'away');
      return Boolean(
        (userTeam?.id && (hInfo.teamId === userTeam.id || aInfo.teamId === userTeam.id)) ||
          (myNormName &&
            (normalizeCupLabel(hInfo.teamName) === myNormName ||
              normalizeCupLabel(aInfo.teamName) === myNormName))
      );
    };
    return [...list].sort((a, b) => {
      const aMine = involvesMe(a) ? 0 : 1;
      const bMine = involvesMe(b) ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      const aPlayed = a.played ? 1 : 0;
      const bPlayed = b.played ? 1 : 0;
      return aPlayed - bPlayed;
    });
  }, [cup?.matches, cup?.participants, userTeam?.id, userTeam?.name]);

  const handleSelectCupMatch = (cm: CupMatchNode) => {
    setSelectedCupMatchId(cm.id);
    const hInfo = getCupNodeTeamInfo(cm, 'home');
    const aInfo = getCupNodeTeamInfo(cm, 'away');
    const hId = hInfo.teamId || findTeamIdByCupName(hInfo.teamName, hInfo.memberName);
    const aId = aInfo.teamId || findTeamIdByCupName(aInfo.teamName, aInfo.memberName);
    if (hId) setHomeTeamId(hId);
    if (aId) setAwayTeamId(aId);
    setSelectedFixtureId('');
  };

  const handleSwitchCompetition = (nextComp: 'liga' | 'copa' | 'recopa') => {
    setCompetitionType(nextComp);
    setSelectedCupMatchId('');
    setHomePenalties('');
    setAwayPenalties('');
    setExtraTime(false);
    setSubmitMsg(null);
    if (nextComp !== 'liga') {
      setSelectedFixtureId('');
    }
    if (nextComp === 'copa') {
      const firstOpen = selectableCupMatches.find((cm) => !cm.played) || selectableCupMatches[0];
      if (firstOpen) {
        handleSelectCupMatch(firstOpen);
      }
    } else if (nextComp === 'recopa' && cup?.recopa) {
      const hId = findTeamIdByCupName(cup.recopa.leagueChampionName);
      const aId = findTeamIdByCupName(cup.recopa.cupChampionName);
      if (hId) setHomeTeamId(hId);
      if (aId) setAwayTeamId(aId);
    }
  };

  const handleLoadFromFixture = (fx: ScheduledFixture) => {
    setCompetitionType('liga');
    setSelectedCupMatchId('');
    setSelectedFixtureId(fx.id);
    setHomeTeamId(fx.homeTeamId);
    setAwayTeamId(fx.awayTeamId);
    setMatchday(String(fx.matchday));
    setLeg(fx.leg);
    setSubmitMsg(null);
    setFilterTab('submit');
  };

  const handleSubmitMatch = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitMsg(null);
    setCupSyncBanner(null);
    if (
      competitionType !== 'liga' &&
      Number(homeGoals) === Number(awayGoals) &&
      (homePenalties.trim() === '' ||
        awayPenalties.trim() === '' ||
        Number(homePenalties) === Number(awayPenalties))
    ) {
      setSubmitMsg({
        type: 'err',
        text: 'En Copa de la Liga o Recopa no puede haber empate: cargá el resultado de los penales para definir al ganador de la llave.',
      });
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('homeTeamId', homeTeamId);
      form.append('awayTeamId', awayTeamId);
      form.append('homeGoals', homeGoals);
      form.append('awayGoals', awayGoals);
      form.append('matchday', matchday);
      form.append('leg', leg);
      form.append('playedAt', playedAt);
      form.append('notes', notes);
      form.append('competitionType', competitionType);
      if (competitionType === 'copa' && selectedCupMatchId) {
        form.append('cupMatchId', selectedCupMatchId);
      }
      if (competitionType !== 'liga') {
        form.append('extraTime', extraTime ? 'true' : 'false');
        if (homePenalties.trim() !== '' && awayPenalties.trim() !== '') {
          form.append('homePenalties', homePenalties.trim());
          form.append('awayPenalties', awayPenalties.trim());
        }
      }
      if (selectedFixtureId && competitionType === 'liga') form.append('fixtureId', selectedFixtureId);
      if (scorerName.trim()) form.append('scorerName', scorerName.trim());
      if (proofFile) form.append('proofImage', proofFile);
      if (scorerFile) form.append('scorerImage', scorerFile);

      const res = await apiFetch<{ match: Match; cupSynced?: boolean }>('/api/matches', {
        method: 'POST',
        body: form,
      });
      const submittedComp = competitionType;
      setSelectedFixtureId('');
      setSelectedCupMatchId('');
      setNotes('');
      setScorerName('');
      setProofFile(null);
      setScorerFile(null);
      setHomePenalties('');
      setAwayPenalties('');
      setExtraTime(false);
      if (proofInputRef.current) proofInputRef.current.value = '';
      if (scorerInputRef.current) scorerInputRef.current.value = '';
      setHomeGoals('0');
      setAwayGoals('0');
      await onRefresh();
      if (submittedComp === 'copa' || submittedComp === 'recopa') {
        const compLabel = submittedComp === 'copa' ? 'Copa de la Liga' : 'Recopa Argentina';
        const syncText = res?.cupSynced
          ? `¡Resultado de ${compLabel} cargado y actualizado AUTOMÁTICAMENTE en el Cuadro de la Copa!`
          : `Resultado de ${compLabel} registrado oficialmente. Verificá que los equipos coincidan con una llave activa del cuadro.`;
        setCupSyncBanner(syncText);
        setSubmitMsg({ type: 'ok', text: syncText });
        setFilterTab('validated');
      } else {
        setSubmitMsg({
          type: 'ok',
          text:
            user?.role === 'admin'
              ? 'Resultado publicado oficialmente y sumado a la Tabla de Posiciones.'
              : 'Resultado enviado al Administrador para su validación oficial.',
        });
        setFilterTab(user?.role === 'admin' ? 'validated' : 'pending');
      }
    } catch (err) {
      setSubmitMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo cargar el resultado.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitClaim = async (e: FormEvent) => {
    e.preventDefault();
    setClaimMsg(null);
    if (claimVideoFile) {
      const lowerName = claimVideoFile.name.toLowerCase();
      if (!lowerName.endsWith('.mp4') && claimVideoFile.type !== 'video/mp4') {
        setClaimMsg({
          type: 'err',
          text: 'Solo se permiten videos en formato .MP4 para reclamos.',
        });
        return;
      }
    }
    setSubmittingClaim(true);
    try {
      const form = new FormData();
      form.append('reasonType', claimReasonType);
      form.append('description', claimDescription.trim());
      if (claimAccusedTeamId) form.append('accusedTeamId', claimAccusedTeamId);
      if (claimMatchId) form.append('matchId', claimMatchId);
      if (claimCardFile) form.append('cardPhoto', claimCardFile);
      if (claimVideoFile) form.append('videoFile', claimVideoFile);
      if (claimVideoUrl.trim()) form.append('videoUrl', claimVideoUrl.trim());

      await apiFetch('/api/claims', { method: 'POST', body: form });
      setClaimDescription('');
      setClaimAccusedTeamId('');
      setClaimMatchId('');
      setClaimCardFile(null);
      setClaimVideoFile(null);
      setClaimVideoUrl('');
      if (claimCardInputRef.current) claimCardInputRef.current.value = '';
      if (claimVideoInputRef.current) claimVideoInputRef.current.value = '';
      await onRefresh();
      setClaimMsg({
        type: 'ok',
        text: 'Reclamo enviado correctamente. El Administrador revisará las pruebas y dictaminará si el partido es válido o inválido.',
      });
    } catch (err) {
      setClaimMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo enviar el reclamo.',
      });
    } finally {
      setSubmittingClaim(false);
    }
  };

  const handleAdminStatus = async (matchId: string, status: 'validated' | 'rejected') => {
    await apiFetch(`/api/admin/matches/${matchId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await onRefresh();
  };

  const handleAdminSaveScore = async (matchId: string) => {
    await apiFetch(`/api/admin/matches/${matchId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        homeGoals: Number(editHomeGoals),
        awayGoals: Number(editAwayGoals),
      }),
    });
    setEditingMatchId(null);
    await onRefresh();
  };

  const handleAdminDelete = async (matchId: string) => {
    await apiFetch(`/api/admin/matches/${matchId}`, { method: 'DELETE' });
    await onRefresh();
  };

  const renderMatchList = (list: Match[], emptyText: string) => {
    if (list.length === 0) {
      return (
        <div className="p-12 text-center bg-[#071D38]/95 border border-amber-400/45 rounded-2xl text-sm text-sky-200/80">
          {emptyText}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {list.map((m) => {
          const home = teamMap.get(m.homeTeamId);
          const away = teamMap.get(m.awayTeamId);
          const isEditing = editingMatchId === m.id;

          return (
            <article
              key={m.id}
              className="p-5 bg-[#071D38]/95 border border-amber-400/45 rounded-2xl flex flex-col gap-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-sky-200/80">
                <div className="flex items-center gap-2 font-medium flex-wrap">
                  {m.competitionType === 'copa' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/20 border border-sky-300/45 text-sky-200 font-bold">
                      <Trophy className="w-3 h-3 text-sky-300" />
                      Copa de la Liga
                    </span>
                  ) : m.competitionType === 'recopa' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400/20 border border-amber-300/50 text-amber-200 font-bold">
                      <Trophy className="w-3 h-3 text-amber-300" />
                      Recopa Argentina
                    </span>
                  ) : (
                    <>
                      <span className="font-mono font-semibold text-amber-300">Fecha {m.matchday}</span>
                      <span aria-hidden="true">·</span>
                      <span>{m.leg}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{m.playedAt}</span>
                  <span aria-hidden="true">·</span>
                  <span>Cargado por {m.submittedByName}</span>
                </div>

                <div className="text-xs font-semibold">
                  {m.status === 'validated' && (
                    <span className="text-emerald-400">Oficial Validado</span>
                  )}
                  {m.status === 'pending' && (
                    <span className="text-amber-300">Pendiente de Validación</span>
                  )}
                  {m.status === 'rejected' && (
                    <span className="text-rose-400">Rechazado</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-11 items-center gap-4">
                <div className="sm:col-span-4 flex items-center gap-3 min-w-0">
                  <ResilientImage
                    src={home?.crestUrl}
                    alt={home?.name || m.homeTeamId}
                    className="w-11 h-11 rounded-lg object-contain bg-[#041224] border border-amber-400/50 p-0.5 shrink-0"
                    fallbackLabel={m.homeTeamId}
                  />
                  <div className="min-w-0">
                    <div className="font-display text-xl font-bold text-amber-50 truncate">
                      {home?.name || m.homeTeamId}
                    </div>
                    <div className="text-xs text-sky-200/80 truncate">
                      Local · {home?.memberName || m.homeTeamId}
                    </div>
                  </div>
                </div>

                <div className="sm:col-span-3 flex items-center justify-center">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={editHomeGoals}
                        onChange={(e) => setEditHomeGoals(e.target.value)}
                        className="w-14 px-2 py-1 text-center font-mono font-bold bg-[#041224] text-amber-50 border border-amber-400/30 rounded-lg"
                      />
                      <span className="font-bold text-sky-100/90">-</span>
                      <input
                        type="number"
                        min={0}
                        value={editAwayGoals}
                        onChange={(e) => setEditAwayGoals(e.target.value)}
                        className="w-14 px-2 py-1 text-center font-mono font-bold bg-[#041224] text-amber-50 border border-amber-400/30 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => handleAdminSaveScore(m.id)}
                        className="px-2.5 py-1 text-xs font-semibold btn-gold-luxury rounded-lg"
                      >
                        Guardar
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <div className="px-5 py-2 rounded-xl bg-[#041224] border border-amber-400/40 text-amber-300 font-mono text-2xl font-extrabold tabular-nums tracking-wider">
                        {m.homeGoals} - {m.awayGoals}
                      </div>
                      {(m.extraTime ||
                        (m.homePenalties !== undefined &&
                          m.homePenalties !== null &&
                          m.awayPenalties !== undefined &&
                          m.awayPenalties !== null)) && (
                        <div className="text-[11px] font-mono font-semibold text-sky-200">
                          {m.homePenalties !== undefined &&
                          m.homePenalties !== null &&
                          m.awayPenalties !== undefined &&
                          m.awayPenalties !== null
                            ? `Penales: ${m.homePenalties} - ${m.awayPenalties}`
                            : 'Tiempo Extra'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-4 flex items-center sm:justify-end gap-3 min-w-0">
                  <div className="min-w-0 sm:text-right order-2 sm:order-1">
                    <div className="font-display text-xl font-bold text-amber-50 truncate">
                      {away?.name || m.awayTeamId}
                    </div>
                    <div className="text-xs text-sky-200/80 truncate">
                      Visitante · {away?.memberName || m.awayTeamId}
                    </div>
                  </div>
                  <ResilientImage
                    src={away?.crestUrl}
                    alt={away?.name || m.awayTeamId}
                    className="w-11 h-11 rounded-lg object-contain bg-[#041224] border border-amber-400/50 p-0.5 shrink-0 order-1 sm:order-2"
                    fallbackLabel={m.awayTeamId}
                  />
                </div>
              </div>

              {(m.notes || m.proofImageUrl || m.scorerImageUrl || m.scorerName || user?.role === 'admin') && (
                <div className="pt-3 border-t border-amber-400/15 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-sky-100/90">
                    {m.notes && <span>{m.notes}</span>}
                    {m.scorerName && !m.scorerImageUrl && (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                        <Award className="w-3.5 h-3.5" />
                        <span>Goleador: {m.scorerName}</span>
                      </span>
                    )}
                    {m.proofImageUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setModalMedia({
                            title: 'Foto del Resultado',
                            url: m.proofImageUrl!,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-amber-200 bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/35 rounded-lg transition-colors"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>Ver foto del resultado</span>
                      </button>
                    )}
                    {m.scorerImageUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setModalMedia({
                            title: m.scorerName ? `Goleador: ${m.scorerName}` : 'Foto del Goleador',
                            url: m.scorerImageUrl!,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 rounded-lg transition-colors"
                      >
                        <Award className="w-3.5 h-3.5" />
                        <span>{m.scorerName ? `Goleador: ${m.scorerName}` : 'Ver foto del goleador'}</span>
                      </button>
                    )}
                  </div>

                  {user?.role === 'admin' && (
                    <div className="flex flex-wrap items-center gap-2">
                      {m.status !== 'validated' && (
                        <button
                          type="button"
                          onClick={() => handleAdminStatus(m.id, 'validated')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Validar y Publicar</span>
                        </button>
                      )}
                      {m.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleAdminStatus(m.id, 'rejected')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 rounded-lg transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Rechazar</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMatchId(isEditing ? null : m.id);
                          setEditHomeGoals(String(m.homeGoals));
                          setEditAwayGoals(String(m.awayGoals));
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-100 bg-[#0A294E] hover:bg-[#0D3666] border border-amber-400/45 rounded-lg transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{isEditing ? 'Cancelar' : 'Editar Marcador'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminDelete(m.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-albiceleste-shiny">
            Partidos, Cruces, Resultados y Reclamos
          </h1>
          <p className="mt-1 text-sm text-sky-200/80">
            Consultá las fechas, subí tu resultado con foto del goleador o enviá un reclamo con pruebas y video .MP4.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#071D38]/95 border border-amber-400/50 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setFilterTab('validated')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              filterTab === 'validated'
                ? 'btn-gold-luxury shadow-sm'
                : 'text-sky-100/90 hover:text-amber-200'
            }`}
          >
            Oficiales ({validatedMatches.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('fixtures')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              filterTab === 'fixtures'
                ? 'btn-gold-luxury shadow-sm'
                : 'text-amber-200 hover:text-amber-100'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            <span>Cruces ({fixtures.length})</span>
          </button>
          {userTeam && (
            <button
              type="button"
              onClick={() => setFilterTab('mine')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                filterTab === 'mine'
                  ? 'btn-gold-luxury shadow-sm'
                  : 'text-sky-100/90 hover:text-amber-200'
              }`}
            >
              Mis Partidos ({myMatches.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setFilterTab('pending')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              filterTab === 'pending'
                ? 'btn-gold-luxury shadow-sm'
                : user?.role === 'admin' && pendingMatches.length > 0
                ? 'bg-amber-400/20 text-amber-200 border border-amber-400/35 hover:bg-amber-400/30'
                : 'text-sky-100/90 hover:text-amber-200'
            }`}
          >
            {user?.role === 'admin'
              ? `Por Validar (${pendingMatches.length})`
              : `En Validación (${pendingMatches.length})`}
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('submit')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              filterTab === 'submit'
                ? 'bg-emerald-400 text-zinc-950 shadow-sm'
                : 'text-emerald-300 hover:bg-white/5'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Cargar Resultado</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('claims')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
              filterTab === 'claims'
                ? 'bg-rose-400 text-zinc-950 shadow-sm'
                : 'text-rose-300 hover:bg-white/5'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Reclamos ({claims.length})</span>
          </button>
        </div>
      </div>

      {cupSyncBanner && (
        <div className="p-4 rounded-2xl bg-emerald-950/75 border border-emerald-400/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-emerald-100">
            <Trophy className="w-5 h-5 text-amber-300 shrink-0" />
            <span>{cupSyncBanner}</span>
          </div>
          <div className="flex items-center gap-2">
            {onOpenCups && (
              <button
                type="button"
                onClick={onOpenCups}
                className="px-3.5 py-1.5 text-xs font-bold btn-gold-luxury rounded-lg whitespace-nowrap"
              >
                Ver Cuadro de Copas
              </button>
            )}
            <button
              type="button"
              onClick={() => setCupSyncBanner(null)}
              className="p-1.5 text-emerald-200/80 hover:text-white rounded-lg"
              aria-label="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {filterTab === 'validated' &&
        renderMatchList(validatedMatches, 'Aún no hay partidos validados oficialmente.')}

      {filterTab === 'fixtures' && (
        <div className="space-y-6">
          {groupedFixtures.length === 0 ? (
            <div className="p-12 text-center bg-[#071D38]/95 border border-amber-400/45 rounded-2xl text-sm text-sky-200/80">
              El Administrador todavía no cargó cruces programados por fecha.
            </div>
          ) : (
            groupedFixtures.map(([md, list]) => (
              <section
                key={md}
                className="bg-[#071D38]/95 border border-amber-400/50 rounded-2xl overflow-hidden"
              >
                <div className="px-5 py-3.5 bg-[#05162B] border-b border-amber-400/15 flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold text-albiceleste-shiny">
                    Fecha {md} — Cruces Programados
                  </h2>
                  <span className="text-xs text-sky-200/80 tabular-nums">
                    {list.length} {list.length === 1 ? 'partido' : 'partidos'}
                  </span>
                </div>
                <div className="divide-y divide-amber-400/10">
                  {list.map((fx) => {
                    const home = teamMap.get(fx.homeTeamId);
                    const away = teamMap.get(fx.awayTeamId);
                    const playedMatch = fx.completedMatchId
                      ? matches.find((m) => m.id === fx.completedMatchId)
                      : matches.find(
                          (m) =>
                            m.matchday === fx.matchday &&
                            m.leg === fx.leg &&
                            m.homeTeamId === fx.homeTeamId &&
                            m.awayTeamId === fx.awayTeamId &&
                            m.status === 'validated'
                        );
                    return (
                      <div
                        key={fx.id}
                        className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <ResilientImage
                              src={home?.crestUrl}
                              alt={home?.name || fx.homeTeamId}
                              className="w-8 h-8 rounded-md object-contain bg-[#041224] border border-amber-400/50 p-0.5 shrink-0"
                              fallbackLabel={fx.homeTeamId}
                            />
                            <span className="text-sm font-bold text-amber-50 truncate">
                              {home?.name || fx.homeTeamId}
                            </span>
                          </div>

                          {playedMatch ? (
                            <span className="px-3 py-1 rounded-lg bg-[#041224] border border-emerald-400/35 font-mono text-sm font-bold text-emerald-300 tabular-nums">
                              {playedMatch.homeGoals} - {playedMatch.awayGoals}
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded bg-[#0A294E] border border-amber-400/45 text-xs font-mono font-bold text-amber-300">
                              VS
                            </span>
                          )}

                          <div className="flex items-center gap-2 min-w-0">
                            <ResilientImage
                              src={away?.crestUrl}
                              alt={away?.name || fx.awayTeamId}
                              className="w-8 h-8 rounded-md object-contain bg-[#041224] border border-amber-400/50 p-0.5 shrink-0"
                              fallbackLabel={fx.awayTeamId}
                            />
                            <span className="text-sm font-bold text-amber-50 truncate">
                              {away?.name || fx.awayTeamId}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <span className="text-sky-200/80">
                            {fx.leg}
                            {fx.scheduledDate ? ` · ${fx.scheduledDate}` : ''}
                            {fx.notes ? ` · ${fx.notes}` : ''}
                          </span>

                          {playedMatch ? (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/30 font-semibold text-emerald-300">
                              {playedMatch.status === 'validated' ? 'Jugado' : 'Enviado'}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (!user) {
                                  onOpenAuth();
                                  return;
                                }
                                handleLoadFromFixture(fx);
                              }}
                              className="px-3 py-1.5 font-semibold btn-gold-luxury rounded-lg whitespace-nowrap"
                            >
                              Cargar este resultado
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {filterTab === 'mine' &&
        renderMatchList(
          myMatches,
          'Todavía no jugaste ni cargaste partidos con tu equipo. Usá "Cargar Resultado" para subir tu primer partido.'
        )}

      {filterTab === 'pending' &&
        renderMatchList(
          pendingMatches,
          user
            ? 'No hay resultados pendientes de validación en este momento.'
            : 'Iniciá sesión para consultar tus partidos pendientes de validación.'
        )}

      {filterTab === 'submit' && (
        <div className="p-6 sm:p-8 bg-[#071D38]/95 border border-amber-400/50 rounded-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
                Subir Resultado y Foto del Goleador
              </h2>
              <p className="text-xs text-sky-200/80">
                {user?.role === 'admin'
                  ? 'Participá como un miembro más: subí el resultado y la foto opcional del goleador; se publica directo en Partidos y Tabla de Posiciones.'
                  : 'Adjuntá la captura del resultado y/o la foto del goleador de tu equipo (opcional). Solo se permiten imágenes deportivas; el Administrador validará el partido.'}
              </p>
            </div>
            {!user && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-4 py-2 text-xs font-semibold btn-gold-luxury rounded-lg whitespace-nowrap"
              >
                Ingresar con ID y Clave
              </button>
            )}
          </div>

          {selectedFixtureId && (
            <div className="mb-5 p-3.5 bg-amber-950/35 border border-amber-400/40 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-200">
              <span>Cargando resultado para el cruce programado de la Fecha {matchday}.</span>
              <button
                type="button"
                onClick={() => setSelectedFixtureId('')}
                className="font-semibold text-amber-300 hover:text-white"
              >
                Desvincular cruce
              </button>
            </div>
          )}

          {user && userTeam && (
            <div className="mb-6 p-4 bg-[#05162B] border border-amber-400/50 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <ResilientImage
                  src={userTeam.crestUrl}
                  alt={userTeam.name}
                  className="w-10 h-10 rounded-lg object-contain bg-[#041224] border border-amber-400/50 p-0.5 shrink-0"
                  fallbackLabel={userTeam.id}
                />
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-amber-300">
                    {user.role === 'admin' ? 'Tu equipo como participante (Admin)' : 'Tu equipo'}
                  </div>
                  <div className="text-sm font-bold text-amber-50 truncate">
                    {userTeam.name} · {userTeam.memberName}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setHomeTeamId(userTeam.id);
                    if (awayTeamId === userTeam.id) {
                      setAwayTeamId(teams.find((t) => t.id !== userTeam.id)?.id || '');
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    homeTeamId === userTeam.id
                      ? 'btn-gold-luxury'
                      : 'bg-[#0A294E] border border-amber-400/45 text-zinc-200 hover:bg-[#0D3666]'
                  }`}
                >
                  Jugar de Local
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAwayTeamId(userTeam.id);
                    if (homeTeamId === userTeam.id) {
                      setHomeTeamId(teams.find((t) => t.id !== userTeam.id)?.id || '');
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    awayTeamId === userTeam.id
                      ? 'bg-emerald-400 text-zinc-950'
                      : 'bg-[#0A294E] border border-amber-400/45 text-zinc-200 hover:bg-[#0D3666]'
                  }`}
                >
                  Jugar de Visitante
                </button>
              </div>
            </div>
          )}

          {!user ? (
            <div className="p-6 bg-[#05162B] border border-amber-400/45 rounded-xl text-sm text-sky-100/90">
              Para evitar cargas falsas, iniciá sesión con tu ID y Clave personales antes de subir un resultado.
            </div>
          ) : (
            <form onSubmit={handleSubmitMatch} className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {submitMsg && (
                <div
                  className={`md:col-span-12 p-3.5 text-sm font-medium rounded-xl border ${
                    submitMsg.type === 'ok'
                      ? 'bg-emerald-950/60 border-emerald-400/40 text-emerald-200'
                      : 'bg-rose-950/60 border-rose-400/40 text-rose-200'
                  }`}
                >
                  {submitMsg.text}
                </div>
              )}

              {/* Competition Selector */}
              <div className="md:col-span-12 p-4 rounded-xl bg-[#05162B] border border-amber-400/35 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5" />
                    Competencia del Partido
                  </span>
                  <span className="text-[11px] text-sky-200/80">
                    {competitionType === 'liga'
                      ? 'Suma puntos en la Tabla de Posiciones de la Liga.'
                      : 'Se actualiza automáticamente en el Cuadro de Copas al enviar el resultado.'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'liga', label: 'Liga Argentina', desc: 'Tabla de Posiciones' },
                      { id: 'copa', label: 'Copa de la Liga', desc: 'Actualiza Llaves Automático' },
                      { id: 'recopa', label: 'Recopa Argentina', desc: 'Actualiza Final Automático' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSwitchCompetition(opt.id)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        competitionType === opt.id
                          ? opt.id === 'liga'
                            ? 'bg-amber-400/15 border-amber-300 text-amber-100 shadow-sm'
                            : opt.id === 'copa'
                            ? 'bg-sky-500/20 border-sky-300 text-sky-100 shadow-sm'
                            : 'bg-amber-500/20 border-amber-300 text-amber-100 shadow-sm'
                          : 'bg-[#041224] border-white/10 text-zinc-300 hover:border-amber-400/40'
                      }`}
                    >
                      <div className="text-sm font-bold">{opt.label}</div>
                      <div className="text-[11px] opacity-80">{opt.desc}</div>
                    </button>
                  ))}
                </div>

                {competitionType === 'copa' && (
                  <div className="pt-2 space-y-2">
                    <label className="block text-xs font-semibold text-sky-200">
                      Elegí tu llave activa de la Copa de la Liga (auto-completa los equipos y actualiza el cuadro):
                    </label>
                    {selectableCupMatches.length === 0 ? (
                      <div className="p-3 rounded-lg bg-[#041224] border border-sky-400/25 text-xs text-sky-200/80">
                        Todavía no hay llaves con equipos definidos en el cuadro de Copa de la Liga. Igual podés seleccionar los equipos abajo.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                        {selectableCupMatches.map((cm) => {
                          const isSelected = selectedCupMatchId === cm.id;
                          const hInfo = getCupNodeTeamInfo(cm, 'home');
                          const aInfo = getCupNodeTeamInfo(cm, 'away');
                          return (
                            <button
                              key={cm.id}
                              type="button"
                              onClick={() => handleSelectCupMatch(cm)}
                              className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors flex items-center justify-between gap-2 ${
                                isSelected
                                  ? 'bg-sky-500/25 border-sky-300 text-white font-semibold'
                                  : 'bg-[#041224] border-white/10 text-zinc-200 hover:border-sky-300/45'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-[10px] uppercase tracking-wider text-sky-300 font-bold">
                                  {CUP_ROUND_LABELS[cm.round] || cm.round} · Llave {cm.matchIndex + 1}
                                </div>
                                <div className="truncate">
                                  {hInfo.teamName} vs {aInfo.teamName}
                                </div>
                              </div>
                              {cm.played && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                                  {cm.homeGoals}-{cm.awayGoals}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {competitionType === 'recopa' && cup?.recopa && (
                  <div className="p-3 rounded-lg bg-amber-950/35 border border-amber-400/40 text-xs text-amber-100 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Final de Recopa configurada:{' '}
                      <strong>{cup.recopa.leagueChampionName || 'Campeón Liga'}</strong> vs{' '}
                      <strong>{cup.recopa.cupChampionName || 'Campeón Copa'}</strong>
                    </span>
                    <span className="text-amber-300 font-semibold">
                      El ganador recibirá automáticamente el Trofeo de Recopa en su perfil.
                    </span>
                  </div>
                )}
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Equipo Local
                </label>
                <select
                  value={homeTeamId}
                  onChange={(e) => setHomeTeamId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.memberName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Goles Local
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={homeGoals}
                  onChange={(e) => setHomeGoals(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm font-mono font-bold bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Goles Visitante
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={awayGoals}
                  onChange={(e) => setAwayGoals(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm font-mono font-bold bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Equipo Visitante
                </label>
                <select
                  value={awayTeamId}
                  onChange={(e) => setAwayTeamId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.memberName})
                    </option>
                  ))}
                </select>
              </div>

              {competitionType !== 'liga' && (
                <div className="md:col-span-12 p-4 rounded-xl bg-sky-950/35 border border-sky-400/35 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                  <div className="sm:col-span-5 flex items-center gap-2.5">
                    <input
                      id="cup-extra-time"
                      type="checkbox"
                      checked={extraTime}
                      onChange={(e) => setExtraTime(e.target.checked)}
                      className="w-4 h-4 accent-amber-400 rounded"
                    />
                    <label htmlFor="cup-extra-time" className="text-xs font-semibold text-sky-100">
                      Se definió en Tiempo Extra / Alargue
                    </label>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                      Penales Local {Number(homeGoals) === Number(awayGoals) ? '(Requerido)' : '(Opcional)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={homePenalties}
                      onChange={(e) => setHomePenalties(e.target.value)}
                      placeholder="Ej: 4"
                      className="w-full px-3 py-2 text-sm font-mono font-bold bg-[#041224] text-amber-50 border border-amber-400/45 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                      Penales Visitante {Number(homeGoals) === Number(awayGoals) ? '(Requerido)' : '(Opcional)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={awayPenalties}
                      onChange={(e) => setAwayPenalties(e.target.value)}
                      placeholder="Ej: 3"
                      className="w-full px-3 py-2 text-sm font-mono font-bold bg-[#041224] text-amber-50 border border-amber-400/45 rounded-lg"
                    />
                  </div>
                </div>
              )}

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Fecha / Jornada N°
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={matchday}
                  onChange={(e) => setMatchday(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Instancia
                </label>
                <select
                  value={leg}
                  onChange={(e) => setLeg(e.target.value as 'Ida' | 'Vuelta')}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                >
                  <option value="Ida">Ida</option>
                  <option value="Vuelta">Vuelta</option>
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Día jugado
                </label>
                <input
                  type="date"
                  value={playedAt}
                  onChange={(e) => setPlayedAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Foto del Resultado (Opcional)
                </label>
                <div className="flex items-center gap-2.5">
                  {proofPreview && (
                    <img
                      src={proofPreview}
                      alt="Vista previa del resultado"
                      className="w-10 h-10 rounded-lg object-cover border border-amber-400/50 shrink-0"
                    />
                  )}
                  <input
                    ref={proofInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-sky-100/90 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-400/20 file:text-amber-300 hover:file:bg-amber-400/30"
                  />
                </div>
              </div>

              <div className="md:col-span-6">
                <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                  Nombre del Goleador de tu Equipo (Opcional)
                </label>
                <input
                  type="text"
                  value={scorerName}
                  onChange={(e) => setScorerName(e.target.value)}
                  placeholder="Ej: Palermo (2 goles) o Messi"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                />
              </div>

              <div className="md:col-span-6">
                <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                  Foto del Goleador de tu Equipo (Opcional, revisión del Admin)
                </label>
                <div className="flex items-center gap-2.5">
                  {scorerPreview && (
                    <img
                      src={scorerPreview}
                      alt="Vista previa goleador"
                      className="w-10 h-10 rounded-lg object-cover border border-amber-400/50 shrink-0"
                    />
                  )}
                  <input
                    ref={scorerInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setScorerFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-sky-100/90 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-400/20 file:text-amber-300 hover:file:bg-amber-400/30"
                  />
                </div>
              </div>

              <div className="md:col-span-12">
                <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                  Comentarios del partido (opcional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: Goles, incidencias, expulsiones..."
                  className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                />
              </div>

              <div className="md:col-span-12 p-3 rounded-xl bg-[#05162B] border border-amber-400/45 text-[11px] text-sky-200/80">
                Regla de contenido: solo se permiten capturas de resultados, festejos y goleadores. Cualquier imagen fuera de lugar será rechazada automáticamente y verificada por el Administrador.
              </div>

              <div className="md:col-span-12 flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 text-sm font-semibold btn-gold-luxury disabled:opacity-60 rounded-xl"
                >
                  {submitting
                    ? 'Enviando...'
                    : competitionType !== 'liga'
                    ? 'Publicar y Actualizar Cuadro de Copa'
                    : user.role === 'admin'
                    ? 'Publicar Resultado Oficial'
                    : 'Enviar para Validación'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {filterTab === 'claims' && (
        <div className="space-y-8">
          <div className="p-6 sm:p-8 bg-[#071D38]/95 border border-rose-400/25 rounded-2xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold text-albiceleste-shiny flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-rose-400" />
                  <span>RECLAMOS DE PARTIDOS</span>
                </h2>
                <p className="text-xs text-sky-200/80 mt-0.5">
                  Subí una foto de las tarjetas amarillas y rojas por juego sucio o un video exclusivamente en formato .MP4 (ej. gol de pase al ras del suelo dentro del área). El Administrador dictaminará si el partido es válido o inválido.
                </p>
              </div>
              {!user && (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-4 py-2 text-xs font-semibold text-zinc-950 bg-rose-400 hover:bg-rose-300 rounded-lg transition-colors whitespace-nowrap"
                >
                  Ingresar con ID para reclamar
                </button>
              )}
            </div>

            {!user ? (
              <div className="p-5 bg-[#05162B] border border-amber-400/45 rounded-xl text-sm text-sky-100/90">
                Iniciá sesión con tu ID y Clave para presentar un reclamo oficial al Administrador.
              </div>
            ) : (
              <form onSubmit={handleSubmitClaim} className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {claimMsg && (
                  <div
                    className={`md:col-span-12 p-3.5 text-sm font-medium rounded-xl border ${
                      claimMsg.type === 'ok'
                        ? 'bg-emerald-950/60 border-emerald-400/40 text-emerald-200'
                        : 'bg-rose-950/60 border-rose-400/40 text-rose-200'
                    }`}
                  >
                    {claimMsg.text}
                  </div>
                )}

                <div className="md:col-span-4">
                  <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                    Tipo de Reclamo
                  </label>
                  <select
                    value={claimReasonType}
                    onChange={(e) => setClaimReasonType(e.target.value as ClaimReasonType)}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  >
                    <option value="juego_sucio">Tarjetas / Juego Sucio</option>
                    <option value="gol_prohibido">Gol prohibido (pase al ras en el área)</option>
                    <option value="otro">Otro reclamo reglamentario</option>
                  </select>
                </div>

                <div className="md:col-span-4">
                  <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                    Rival Denunciado (Opcional)
                  </label>
                  <select
                    value={claimAccusedTeamId}
                    onChange={(e) => setClaimAccusedTeamId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  >
                    <option value="">Seleccionar equipo rival...</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.memberName})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-4">
                  <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                    Partido Relacionado (Opcional)
                  </label>
                  <select
                    value={claimMatchId}
                    onChange={(e) => setClaimMatchId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  >
                    <option value="">Sin partido específico</option>
                    {matches.map((m) => {
                      const h = teamMap.get(m.homeTeamId)?.name || m.homeTeamId;
                      const a = teamMap.get(m.awayTeamId)?.name || m.awayTeamId;
                      return (
                        <option key={m.id} value={m.id}>
                          F{m.matchday} ({m.leg}): {h} {m.homeGoals}-{m.awayGoals} {a}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="md:col-span-6">
                  <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                    Foto de Tarjetas Amarillas / Rojas o Prueba (JPG/PNG/WEBP)
                  </label>
                  <div className="flex items-center gap-2.5">
                    {claimCardPreview && (
                      <img
                        src={claimCardPreview}
                        alt="Vista previa tarjetas"
                        className="w-10 h-10 rounded-lg object-cover border border-rose-400/50 shrink-0"
                      />
                    )}
                    <input
                      ref={claimCardInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => setClaimCardFile(e.target.files?.[0] || null)}
                      className="w-full text-xs text-sky-100/90 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-rose-500/20 file:text-rose-300"
                    />
                  </div>
                </div>

                <div className="md:col-span-6">
                  <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                    Video del Reclamo (Únicamente .MP4)
                  </label>
                  <input
                    ref={claimVideoInputRef}
                    type="file"
                    accept="video/mp4,.mp4"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      if (f && !f.name.toLowerCase().endsWith('.mp4') && f.type !== 'video/mp4') {
                        setClaimMsg({
                          type: 'err',
                          text: 'Solo se permiten archivos de video en formato .MP4.',
                        });
                        e.target.value = '';
                        setClaimVideoFile(null);
                        return;
                      }
                      setClaimVideoFile(f);
                    }}
                    className="w-full text-xs text-sky-100/90 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-400/20 file:text-amber-300"
                  />
                  <input
                    type="url"
                    value={claimVideoUrl}
                    onChange={(e) => setClaimVideoUrl(e.target.value)}
                    placeholder="O pegá enlace directo terminado en .mp4 (opcional)"
                    className="mt-2 w-full px-3 py-1.5 text-xs bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  />
                </div>

                <div className="md:col-span-12">
                  <label className="block text-xs font-semibold text-sky-100/90 mb-1.5">
                    Explicación del Reclamo (minuto, falta, tarjetas o gol ilegal)
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={claimDescription}
                    onChange={(e) => setClaimDescription(e.target.value)}
                    placeholder="Describí qué pasó (ej: en el minuto 68 hizo gol de pase al ras dentro del área o acumuló juego sucio con rojas)..."
                    className="w-full px-3.5 py-2.5 text-sm bg-[#041224] text-amber-50 border border-amber-400/50 rounded-lg"
                  />
                </div>

                <div className="md:col-span-12 flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingClaim}
                    className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-zinc-950 bg-gradient-to-r from-rose-400 to-amber-300 hover:brightness-110 disabled:opacity-60 rounded-xl transition-all"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <span>{submittingClaim ? 'Enviando Reclamo...' : 'Enviar Reclamo al Administrador'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="font-display text-2xl font-bold text-albiceleste-shiny">
              Reclamos y Dictámenes del Administrador ({claims.length})
            </h3>
            {claims.length === 0 ? (
              <div className="p-10 text-center bg-[#071D38]/95 border border-amber-400/45 rounded-2xl text-sm text-sky-200/80">
                No hay reclamos registrados hasta el momento.
              </div>
            ) : (
              <div className="space-y-4">
                {claims.map((c) => (
                  <article
                    key={c.id}
                    className="p-5 bg-[#071D38]/95 border border-rose-400/20 rounded-2xl space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2.5 py-1 rounded bg-rose-500/15 border border-rose-400/30 font-semibold text-rose-200">
                          {CLAIM_REASON_LABELS[c.reasonType] || c.reasonType}
                        </span>
                        <span className="text-sky-200/80">
                          Presentado por <strong className="text-amber-50">{c.reporterName}</strong>
                        </span>
                        {c.accusedTeamName && (
                          <span className="text-sky-200/80">
                            · vs <strong className="text-amber-300">{c.accusedTeamName}</strong>
                          </span>
                        )}
                      </div>

                      <div className="font-semibold">
                        {c.status === 'pending' && (
                          <span className="px-2.5 py-1 rounded bg-amber-500/15 border border-amber-400/35 text-amber-300">
                            En Revisión del Admin
                          </span>
                        )}
                        {c.status === 'valid_match' && (
                          <span className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-400/35 text-emerald-300">
                            Dictamen Admin: Partido Válido
                          </span>
                        )}
                        {c.status === 'invalid_match' && (
                          <span className="px-2.5 py-1 rounded bg-rose-500/20 border border-rose-400/40 text-rose-300">
                            Dictamen Admin: Partido Inválido
                          </span>
                        )}
                        {c.status === 'dismissed' && (
                          <span className="px-2.5 py-1 rounded bg-[#0A294E] border border-amber-400/45 text-sky-100/90">
                            Reclamo Desestimado
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-zinc-200">{c.description}</p>

                    <div className="flex flex-wrap items-center gap-3">
                      {c.cardPhotoUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            setModalMedia({
                              title: 'Foto de Tarjetas / Prueba del Reclamo',
                              url: c.cardPhotoUrl!,
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-200 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 rounded-lg"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>Ver Foto de Tarjetas</span>
                        </button>
                      )}
                      {c.videoUrl && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                          <Film className="w-3.5 h-3.5" />
                          <span>Video .MP4 adjunto abajo</span>
                        </span>
                      )}
                    </div>

                    {c.videoUrl && (
                      <div className="aspect-video max-w-xl bg-[#041224] rounded-xl overflow-hidden border border-amber-400/45">
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          src={c.videoUrl}
                          className="w-full h-full object-contain"
                        />
                      </div>
                    )}

                    {c.adminResolutionNote && (
                      <div className="p-3 rounded-xl bg-[#05162B] border border-amber-400/30 text-xs text-amber-100">
                        <strong className="text-amber-300">Resolución del Administrador:</strong>{' '}
                        {c.adminResolutionNote}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {modalMedia && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setModalMedia(null)}
        >
          <div
            className="max-w-3xl w-full bg-[#071D38]/95 border border-amber-400/40 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 bg-[#05162B] text-amber-200 flex items-center justify-between border-b border-amber-400/45">
              <span className="text-sm font-semibold">{modalMedia.title}</span>
              <button
                type="button"
                onClick={() => setModalMedia(null)}
                className="text-sky-100/90 hover:text-amber-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-[#041224] flex items-center justify-center max-h-[80vh] overflow-auto">
              <ResilientImage
                src={modalMedia.url}
                alt={modalMedia.title}
                className="max-w-full max-h-[72vh] object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
