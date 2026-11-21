import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CalendarCheck2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Edit3,
  ImagePlus,
  Megaphone,
  Plus,
  Shield,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  CalendarCategory,
  CalendarEvent,
  CupMatchNode,
  CupTournament,
  LeagueSettings,
  PublicTeam,
  ScheduledFixture,
} from '../types';
import {
  createCalendarEventFirestore,
  deleteCalendarEventFirestore,
  saveSettingsFirestore,
  updateCalendarEventFirestore,
  updateCupMatchNodeFirestore,
  updateCupRecopaFirestore,
  updateFixtureScheduleFirestore,
} from '../services/firestoreLeague';
import { uploadMediaFile } from '../utils/api';
import { getTitleText } from '../utils/customTitles';
import { ResilientImage } from './ResilientImage';

interface CalendarViewProps {
  calendarEvents: CalendarEvent[];
  calendarMessage?: string;
  settings?: LeagueSettings;
  cup: CupTournament;
  fixtures: ScheduledFixture[];
  teams: PublicTeam[];
  user: AuthUser | null;
  onRefresh: () => Promise<void>;
  onOpenCup?: () => void;
}

interface UnifiedCalendarItem {
  key: string;
  source: 'custom' | 'cup' | 'recopa' | 'fixture';
  sourceId: string;
  title: string;
  category: CalendarCategory;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  roundLabel?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeCrestUrl?: string;
  awayCrestUrl?: string;
  matchupText?: string;
  notes?: string;
  cupMatchId?: string;
  fixtureId?: string;
  played?: boolean;
}

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const CUP_ROUND_NAMES: Record<CupMatchNode['round'], string> = {
  r16: '8° Octavos de Final',
  qf: '4° Cuartos de Final',
  sf: 'Semifinal',
  final: 'Final Copa de la Liga',
};

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toHm(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function parseDateTimeMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '21:00').split(':').map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, Number.isFinite(hh) ? hh : 21, Number.isFinite(mm) ? mm : 0, 0).getTime();
}

function formatReadableDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function formatCountdownBadge(
  targetMs: number,
  nowMs: number,
  todayYmd: string,
  itemDate: string,
  played?: boolean
): {
  label: string;
  tone: 'emerald' | 'gold' | 'silver' | 'muted';
} {
  if (played) {
    return { label: 'Jugado', tone: 'emerald' };
  }
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0 && diffMs > -3 * 60 * 60 * 1000) {
    return { label: 'EN HORARIO / HOY', tone: 'emerald' };
  }
  if (diffMs <= -3 * 60 * 60 * 1000) {
    return { label: 'Finalizado', tone: 'muted' };
  }
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;

  if (itemDate === todayYmd) {
    return { label: hours > 0 ? `HOY · en ${hours}h ${mins}m` : `HOY · en ${mins}m`, tone: 'gold' };
  }
  if (days === 0) {
    return { label: `En ${hours}h ${mins}m`, tone: 'gold' };
  }
  if (days === 1) {
    return { label: `Mañana · ${hours}h`, tone: 'silver' };
  }
  return { label: `En ${days} días`, tone: 'silver' };
}

export function CalendarView({
  calendarEvents,
  calendarMessage = '',
  settings,
  cup,
  fixtures,
  teams,
  user,
  onRefresh,
  onOpenCup,
}: CalendarViewProps) {
  const isAdmin = user?.role === 'admin';
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const todayYmd = toYmd(now);
  const [viewYear, setViewYear] = useState<number>(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(() => now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | CalendarCategory>('all');

  // Admin Calendar Message state
  const [editingBannerMsg, setEditingBannerMsg] = useState(false);
  const [bannerMsgDraft, setBannerMsgDraft] = useState(calendarMessage);
  const [savingBannerMsg, setSavingBannerMsg] = useState(false);
  const [bannerMsgFeedback, setBannerMsgFeedback] = useState<string | null>(null);

  useEffect(() => {
    setBannerMsgDraft(calendarMessage);
  }, [calendarMessage]);

  // Admin Event Form state
  const formSectionRef = useRef<HTMLElement | null>(null);
  const homeCrestInputRef = useRef<HTMLInputElement | null>(null);
  const awayCrestInputRef = useRef<HTMLInputElement | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState<CalendarCategory>('copa');
  const [formDate, setFormDate] = useState<string>(todayYmd);
  const [formTime, setFormTime] = useState<string>(toHm(now));
  const [formCupMatchId, setFormCupMatchId] = useState<string>('');
  const [formFixtureId, setFormFixtureId] = useState<string>('');
  const [formHomeTeamId, setFormHomeTeamId] = useState<string>('');
  const [formAwayTeamId, setFormAwayTeamId] = useState<string>('');
  const [formHomeTeam, setFormHomeTeam] = useState('');
  const [formAwayTeam, setFormAwayTeam] = useState('');
  const [formHomeCrestUrl, setFormHomeCrestUrl] = useState('');
  const [formAwayCrestUrl, setFormAwayCrestUrl] = useState('');
  const [formHomeCrestFile, setFormHomeCrestFile] = useState<File | null>(null);
  const [formAwayCrestFile, setFormAwayCrestFile] = useState<File | null>(null);
  const [clearHomeCrest, setClearHomeCrest] = useState(false);
  const [clearAwayCrest, setClearAwayCrest] = useState(false);
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const homeCrestPreview = useMemo(() => {
    if (formHomeCrestFile) return URL.createObjectURL(formHomeCrestFile);
    return clearHomeCrest ? '' : formHomeCrestUrl;
  }, [formHomeCrestFile, formHomeCrestUrl, clearHomeCrest]);

  const awayCrestPreview = useMemo(() => {
    if (formAwayCrestFile) return URL.createObjectURL(formAwayCrestFile);
    return clearAwayCrest ? '' : formAwayCrestUrl;
  }, [formAwayCrestFile, formAwayCrestUrl, clearAwayCrest]);

  useEffect(() => {
    return () => {
      if (homeCrestPreview && homeCrestPreview.startsWith('blob:')) {
        URL.revokeObjectURL(homeCrestPreview);
      }
    };
  }, [homeCrestPreview]);

  useEffect(() => {
    return () => {
      if (awayCrestPreview && awayCrestPreview.startsWith('blob:')) {
        URL.revokeObjectURL(awayCrestPreview);
      }
    };
  }, [awayCrestPreview]);

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamByNameMap = useMemo(() => {
    const map = new Map<string, PublicTeam>();
    for (const t of teams) {
      map.set(t.name.trim().toLowerCase(), t);
    }
    return map;
  }, [teams]);

  const cupSlotCrestByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of cup.participants || []) {
      if (p.teamName && p.crestUrl) {
        map.set(p.teamName.trim().toLowerCase(), p.crestUrl);
      }
    }
    return map;
  }, [cup.participants]);

  const resolveTeamCrest = (teamId?: string, teamName?: string, explicitCrest?: string): string | undefined => {
    if (explicitCrest?.trim()) return explicitCrest.trim();
    if (teamId && teamMap.get(teamId)?.crestUrl) return teamMap.get(teamId)?.crestUrl;
    if (teamName?.trim()) {
      const normalized = teamName.trim().toLowerCase();
      const byName = teamByNameMap.get(normalized);
      if (byName?.crestUrl) return byName.crestUrl;
      const fromCupSlot = cupSlotCrestByName.get(normalized);
      if (fromCupSlot) return fromCupSlot;
    }
    return undefined;
  };

  // Build unified schedule: custom calendar events + scheduled Cup matches + Recopa + League Fixtures
  const unifiedItems = useMemo<UnifiedCalendarItem[]>(() => {
    const list: UnifiedCalendarItem[] = [];
    const coveredCupIds = new Set<string>();
    const coveredFixtureIds = new Set<string>();

    for (const ev of calendarEvents) {
      if (ev.cupMatchId) coveredCupIds.add(ev.cupMatchId);
      if (ev.fixtureId) coveredFixtureIds.add(ev.fixtureId);

      let fallbackHomeCrest: string | undefined;
      let fallbackAwayCrest: string | undefined;
      if (ev.cupMatchId === 'recopa') {
        fallbackHomeCrest = cup.recopa.leagueChampionCrestUrl;
        fallbackAwayCrest = cup.recopa.cupChampionCrestUrl;
      } else if (ev.cupMatchId) {
        const cm = cup.matches.find((m) => m.id === ev.cupMatchId);
        fallbackHomeCrest = cm?.homeCrestUrl;
        fallbackAwayCrest = cm?.awayCrestUrl;
      }

      const homeName =
        ev.homeTeamName || (ev.homeTeamId ? teamMap.get(ev.homeTeamId)?.name : undefined);
      const awayName =
        ev.awayTeamName || (ev.awayTeamId ? teamMap.get(ev.awayTeamId)?.name : undefined);

      const homeCrestUrl = resolveTeamCrest(ev.homeTeamId, homeName, ev.homeCrestUrl || fallbackHomeCrest);
      const awayCrestUrl = resolveTeamCrest(ev.awayTeamId, awayName, ev.awayCrestUrl || fallbackAwayCrest);

      const matchup =
        homeName && awayName ? `${homeName} vs ${awayName}` : homeName || awayName || undefined;

      list.push({
        key: `cal_${ev.id}`,
        source: 'custom',
        sourceId: ev.id,
        title: ev.title,
        category: ev.category,
        date: ev.date,
        time: ev.time || '21:00',
        roundLabel: ev.roundLabel,
        homeTeamId: ev.homeTeamId,
        awayTeamId: ev.awayTeamId,
        homeTeamName: homeName,
        awayTeamName: awayName,
        homeCrestUrl,
        awayCrestUrl,
        matchupText: matchup,
        notes: ev.notes,
        cupMatchId: ev.cupMatchId,
        fixtureId: ev.fixtureId,
      });
    }

    for (const m of cup.matches) {
      if (!m.scheduledDate || coveredCupIds.has(m.id)) continue;
      const home = m.homeTeamName || 'Por definir';
      const away = m.awayTeamName || 'Por definir';
      list.push({
        key: `cup_${m.id}`,
        source: 'cup',
        sourceId: m.id,
        title: `${CUP_ROUND_NAMES[m.round]}${m.round !== 'final' ? ` · Llave ${m.matchIndex}` : ''}`,
        category: 'copa',
        date: m.scheduledDate,
        time: m.scheduledTime || '21:00',
        roundLabel: cup.editionName,
        homeTeamId: m.homeSlot != null ? cup.participants.find((p) => p.slot === m.homeSlot)?.teamId : undefined,
        awayTeamId: m.awaySlot != null ? cup.participants.find((p) => p.slot === m.awaySlot)?.teamId : undefined,
        homeTeamName: home,
        awayTeamName: away,
        homeCrestUrl: resolveTeamCrest(undefined, m.homeTeamName, m.homeCrestUrl),
        awayCrestUrl: resolveTeamCrest(undefined, m.awayTeamName, m.awayCrestUrl),
        matchupText: `${home} vs ${away}`,
        cupMatchId: m.id,
        played: m.played,
      });
    }

    if (cup.recopa?.scheduledDate && !coveredCupIds.has('recopa')) {
      const lName = cup.recopa.leagueChampionName || 'Campeón Liga';
      const cName = cup.recopa.cupChampionName || 'Campeón Copa';
      list.push({
        key: 'recopa_main',
        source: 'recopa',
        sourceId: 'recopa',
        title: 'Gran Final Recopa Argentina',
        category: 'recopa',
        date: cup.recopa.scheduledDate,
        time: cup.recopa.scheduledTime || '22:00',
        roundLabel: 'Recopa',
        homeTeamName: lName,
        awayTeamName: cName,
        homeCrestUrl: resolveTeamCrest(undefined, lName, cup.recopa.leagueChampionCrestUrl),
        awayCrestUrl: resolveTeamCrest(undefined, cName, cup.recopa.cupChampionCrestUrl),
        matchupText: `${lName} vs ${cName}`,
        cupMatchId: 'recopa',
        played: cup.recopa.played,
      });
    }

    for (const fx of fixtures) {
      if (!fx.scheduledDate || coveredFixtureIds.has(fx.id)) continue;
      const homeTeam = teamMap.get(fx.homeTeamId);
      const awayTeam = teamMap.get(fx.awayTeamId);
      const home = homeTeam?.name || fx.homeTeamId;
      const away = awayTeam?.name || fx.awayTeamId;
      list.push({
        key: `fx_${fx.id}`,
        source: 'fixture',
        sourceId: fx.id,
        title: `Fecha ${fx.matchday} (${fx.leg}) · Liga Master`,
        category: 'liga',
        date: fx.scheduledDate,
        time: fx.scheduledTime || '21:00',
        roundLabel: `Fecha ${fx.matchday}`,
        homeTeamId: fx.homeTeamId,
        awayTeamId: fx.awayTeamId,
        homeTeamName: home,
        awayTeamName: away,
        homeCrestUrl: homeTeam?.crestUrl,
        awayCrestUrl: awayTeam?.crestUrl,
        matchupText: `${home} vs ${away}`,
        notes: fx.notes,
        fixtureId: fx.id,
        played: Boolean(fx.completedMatchId),
      });
    }

    return list.sort((a, b) => parseDateTimeMs(a.date, a.time) - parseDateTimeMs(b.date, b.time));
  }, [calendarEvents, cup, fixtures, teamMap, teamByNameMap, cupSlotCrestByName]);

  const filteredItems = useMemo(() => {
    return unifiedItems.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (selectedDate && item.date !== selectedDate) return false;
      return true;
    });
  }, [unifiedItems, categoryFilter, selectedDate]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, UnifiedCalendarItem[]>();
    for (const item of unifiedItems) {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) continue;
      const arr = map.get(item.date) || [];
      arr.push(item);
      map.set(item.date, arr);
    }
    return map;
  }, [unifiedItems, categoryFilter]);

  // Calendar Grid cells for viewYear / viewMonth
  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const startOffset = (firstDayOfMonth.getDay() + 6) % 7;

    const cells: { dateStr: string | null; dayNum: number | null }[] = [];
    for (let i = 0; i < startOffset; i++) {
      cells.push({ dateStr: null, dayNum: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const mStr = String(viewMonth + 1).padStart(2, '0');
      const dStr = String(day).padStart(2, '0');
      cells.push({ dateStr: `${viewYear}-${mStr}-${dStr}`, dayNum: day });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateStr: null, dayNum: null });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const nowMs = now.getTime();
  const nextUpcomingCup = unifiedItems.find(
    (item) =>
      (item.category === 'copa' || item.category === 'recopa') &&
      !item.played &&
      parseDateTimeMs(item.date, item.time) >= nowMs - 3600000
  );
  const todayEventsCount = (itemsByDate.get(todayYmd) || []).length;

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleJumpToToday = () => {
    const d = new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDate(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormTitle('');
    setFormCategory('copa');
    setFormDate(selectedDate || todayYmd);
    setFormTime('21:00');
    setFormCupMatchId('');
    setFormFixtureId('');
    setFormHomeTeamId('');
    setFormAwayTeamId('');
    setFormHomeTeam('');
    setFormAwayTeam('');
    setFormHomeCrestUrl('');
    setFormAwayCrestUrl('');
    setFormHomeCrestFile(null);
    setFormAwayCrestFile(null);
    setClearHomeCrest(false);
    setClearAwayCrest(false);
    setFormNotes('');
    if (homeCrestInputRef.current) homeCrestInputRef.current.value = '';
    if (awayCrestInputRef.current) awayCrestInputRef.current.value = '';
  };

  const handleSelectCupLink = (cupId: string) => {
    setFormCupMatchId(cupId);
    if (!cupId) return;
    setFormFixtureId('');

    if (cupId === 'recopa') {
      setFormCategory('recopa');
      setFormTitle('Gran Final Recopa Argentina');
      setFormHomeTeam(cup.recopa.leagueChampionName || 'Campeón Liga');
      setFormAwayTeam(cup.recopa.cupChampionName || 'Campeón Copa');
      setFormHomeTeamId('');
      setFormAwayTeamId('');
      setFormHomeCrestUrl(
        resolveTeamCrest(undefined, cup.recopa.leagueChampionName, cup.recopa.leagueChampionCrestUrl) || ''
      );
      setFormAwayCrestUrl(
        resolveTeamCrest(undefined, cup.recopa.cupChampionName, cup.recopa.cupChampionCrestUrl) || ''
      );
      setClearHomeCrest(false);
      setClearAwayCrest(false);
      if (cup.recopa.scheduledDate) setFormDate(cup.recopa.scheduledDate);
      if (cup.recopa.scheduledTime) setFormTime(cup.recopa.scheduledTime);
      return;
    }

    const found = cup.matches.find((m) => m.id === cupId);
    if (found) {
      setFormCategory('copa');
      setFormTitle(
        `${CUP_ROUND_NAMES[found.round]}${found.round !== 'final' ? ` · Llave ${found.matchIndex}` : ''}`
      );
      setFormHomeTeam(found.homeTeamName || 'Por definir');
      setFormAwayTeam(found.awayTeamName || 'Por definir');
      const hSlot = found.homeSlot != null ? cup.participants.find((p) => p.slot === found.homeSlot) : undefined;
      const aSlot = found.awaySlot != null ? cup.participants.find((p) => p.slot === found.awaySlot) : undefined;
      setFormHomeTeamId(hSlot?.teamId || '');
      setFormAwayTeamId(aSlot?.teamId || '');
      setFormHomeCrestUrl(resolveTeamCrest(hSlot?.teamId, found.homeTeamName, found.homeCrestUrl) || '');
      setFormAwayCrestUrl(resolveTeamCrest(aSlot?.teamId, found.awayTeamName, found.awayCrestUrl) || '');
      setClearHomeCrest(false);
      setClearAwayCrest(false);
      if (found.scheduledDate) setFormDate(found.scheduledDate);
      if (found.scheduledTime) setFormTime(found.scheduledTime);
    }
  };

  const handleSelectFixtureLink = (fxId: string) => {
    setFormFixtureId(fxId);
    if (!fxId) return;
    setFormCupMatchId('');

    const fx = fixtures.find((f) => f.id === fxId);
    if (fx) {
      const homeTeam = teamMap.get(fx.homeTeamId);
      const awayTeam = teamMap.get(fx.awayTeamId);
      setFormCategory('liga');
      setFormTitle(`Fecha ${fx.matchday} (${fx.leg}) · Liga Master`);
      setFormHomeTeamId(fx.homeTeamId);
      setFormAwayTeamId(fx.awayTeamId);
      setFormHomeTeam(homeTeam?.name || fx.homeTeamId);
      setFormAwayTeam(awayTeam?.name || fx.awayTeamId);
      setFormHomeCrestUrl(homeTeam?.crestUrl || '');
      setFormAwayCrestUrl(awayTeam?.crestUrl || '');
      setClearHomeCrest(false);
      setClearAwayCrest(false);
      if (fx.scheduledDate) setFormDate(fx.scheduledDate);
      if (fx.scheduledTime) setFormTime(fx.scheduledTime);
      if (fx.notes) setFormNotes(fx.notes);
    }
  };

  const handleSelectTeamDropdown = (side: 'home' | 'away', teamId: string) => {
    const selected = teamId ? teamMap.get(teamId) : undefined;
    if (side === 'home') {
      setFormHomeTeamId(teamId);
      if (selected) {
        setFormHomeTeam(selected.name);
        setFormHomeCrestUrl(selected.crestUrl);
        setFormHomeCrestFile(null);
        setClearHomeCrest(false);
      }
    } else {
      setFormAwayTeamId(teamId);
      if (selected) {
        setFormAwayTeam(selected.name);
        setFormAwayCrestUrl(selected.crestUrl);
        setFormAwayCrestFile(null);
        setClearAwayCrest(false);
      }
    }
  };

  const handleSaveBannerMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingBannerMsg(true);
    setBannerMsgFeedback(null);
    try {
      await saveSettingsFirestore({ calendarMessage: bannerMsgDraft.trim() });
      setEditingBannerMsg(false);
      setBannerMsgFeedback(
        bannerMsgDraft.trim()
          ? 'Mensaje del calendario actualizado.'
          : 'Mensaje del calendario eliminado.'
      );
      await onRefresh();
    } catch (err) {
      setBannerMsgFeedback(
        err instanceof Error ? err.message : 'No se pudo guardar el mensaje.'
      );
    } finally {
      setSavingBannerMsg(false);
    }
  };

  const handleClearBannerMessage = async () => {
    if (!isAdmin) return;
    setSavingBannerMsg(true);
    setBannerMsgFeedback(null);
    try {
      await saveSettingsFirestore({ calendarMessage: '' });
      setBannerMsgDraft('');
      setEditingBannerMsg(false);
      await onRefresh();
    } catch (err) {
      setBannerMsgFeedback(
        err instanceof Error ? err.message : 'No se pudo eliminar el mensaje.'
      );
    } finally {
      setSavingBannerMsg(false);
    }
  };

  const handleSubmitEvent = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setMsg(null);
    setSaving(true);
    try {
      let resolvedHomeCrest = clearHomeCrest ? '' : formHomeCrestUrl || '';
      let resolvedAwayCrest = clearAwayCrest ? '' : formAwayCrestUrl || '';
      if (formHomeCrestFile) {
        resolvedHomeCrest = await uploadMediaFile('crests', formHomeCrestFile);
      }
      if (formAwayCrestFile) {
        resolvedAwayCrest = await uploadMediaFile('crests', formAwayCrestFile);
      }

      const roundLabel =
        formCategory === 'copa'
          ? cup.editionName
          : formCategory === 'recopa'
          ? 'Recopa'
          : '';

      if (editingId) {
        await updateCalendarEventFirestore(editingId, {
          title: formTitle.trim(),
          category: formCategory,
          date: formDate,
          time: formTime || '21:00',
          roundLabel: roundLabel || undefined,
          cupMatchId: formCupMatchId || undefined,
          fixtureId: formFixtureId || undefined,
          homeTeamId: formHomeTeamId || undefined,
          awayTeamId: formAwayTeamId || undefined,
          homeTeamName: formHomeTeam.trim() || undefined,
          awayTeamName: formAwayTeam.trim() || undefined,
          homeCrestUrl: resolvedHomeCrest || undefined,
          awayCrestUrl: resolvedAwayCrest || undefined,
          notes: formNotes.trim(),
        });
        setMsg({ type: 'ok', text: 'Partido y escudos actualizados en el calendario.' });
      } else {
        await createCalendarEventFirestore({
          title: formTitle.trim(),
          category: formCategory,
          date: formDate,
          time: formTime || '21:00',
          roundLabel: roundLabel || undefined,
          cupMatchId: formCupMatchId || undefined,
          fixtureId: formFixtureId || undefined,
          homeTeamId: formHomeTeamId || undefined,
          awayTeamId: formAwayTeamId || undefined,
          homeTeamName: formHomeTeam.trim() || undefined,
          awayTeamName: formAwayTeam.trim() || undefined,
          homeCrestUrl: resolvedHomeCrest || undefined,
          awayCrestUrl: resolvedAwayCrest || undefined,
          notes: formNotes.trim(),
        });
        setMsg({ type: 'ok', text: 'Partido y escudos agendados en el calendario.' });
      }

      if (formFixtureId) {
        await updateFixtureScheduleFirestore(formFixtureId, formDate, formTime || '21:00');
      }
      if (formCupMatchId) {
        if (formCupMatchId === 'recopa') {
          await updateCupRecopaFirestore(
            cup,
            { scheduledDate: formDate, scheduledTime: formTime || '21:00' },
            teams
          );
        } else {
          await updateCupMatchNodeFirestore(
            cup,
            formCupMatchId,
            { scheduledDate: formDate, scheduledTime: formTime || '21:00' },
            teams
          );
        }
      }

      resetForm();
      await onRefresh();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error guardando fecha en el calendario.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditAnyItem = (item: UnifiedCalendarItem) => {
    if (!isAdmin) return;
    const rawCustom =
      item.source === 'custom' ? calendarEvents.find((ev) => ev.id === item.sourceId) : undefined;

    setEditingId(rawCustom ? rawCustom.id : null);
    setFormTitle(item.title);
    setFormCategory(item.category);
    setFormDate(item.date);
    setFormTime(item.time || '21:00');
    setFormCupMatchId(item.cupMatchId || '');
    setFormFixtureId(item.fixtureId || '');
    setFormHomeTeamId(rawCustom?.homeTeamId || item.homeTeamId || '');
    setFormAwayTeamId(rawCustom?.awayTeamId || item.awayTeamId || '');
    setFormHomeTeam(rawCustom?.homeTeamName || item.homeTeamName || '');
    setFormAwayTeam(rawCustom?.awayTeamName || item.awayTeamName || '');
    setFormHomeCrestUrl(rawCustom?.homeCrestUrl || item.homeCrestUrl || '');
    setFormAwayCrestUrl(rawCustom?.awayCrestUrl || item.awayCrestUrl || '');
    setFormHomeCrestFile(null);
    setFormAwayCrestFile(null);
    setClearHomeCrest(false);
    setClearAwayCrest(false);
    setFormNotes(item.notes || '');
    setMsg(null);
    if (homeCrestInputRef.current) homeCrestInputRef.current.value = '';
    if (awayCrestInputRef.current) awayCrestInputRef.current.value = '';
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDeleteAnyItem = async (item: UnifiedCalendarItem) => {
    if (!isAdmin) return;
    setMsg(null);
    try {
      if (item.source === 'custom') {
        await deleteCalendarEventFirestore(item.sourceId);
      } else if (item.source === 'fixture') {
        await updateFixtureScheduleFirestore(item.sourceId, '', '');
      } else if (item.source === 'cup') {
        await updateCupMatchNodeFirestore(
          cup,
          item.sourceId,
          { scheduledDate: '', scheduledTime: '' },
          teams
        );
      } else if (item.source === 'recopa') {
        await updateCupRecopaFirestore(cup, { scheduledDate: '', scheduledTime: '' }, teams);
      }
      if (editingId === item.sourceId) {
        resetForm();
      }
      await onRefresh();
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo quitar la fecha del calendario.',
      });
    }
  };

  const liveDateLabel = now.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const liveTimeLabel = now.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const categoryBadgeClass = (cat: CalendarCategory) => {
    if (cat === 'copa') return 'bg-amber-400/15 text-amber-300 border-amber-400/50';
    if (cat === 'recopa') return 'bg-emerald-500/15 text-emerald-300 border-emerald-400/50';
    if (cat === 'liga') return 'bg-sky-400/15 text-sky-300 border-sky-400/50';
    return 'bg-zinc-200/15 text-zinc-200 border-zinc-400/45';
  };

  const categoryLabel = (cat: CalendarCategory) => {
    if (cat === 'copa') return getTitleText(settings, 'compCopaName');
    if (cat === 'recopa') return getTitleText(settings, 'compRecopaName');
    if (cat === 'liga') return getTitleText(settings, 'compLigaName');
    return 'Evento';
  };

  return (
    <div className="space-y-8">
      {/* Cabecera sincronizada con Día / Mes / Año / Hora en tiempo real */}
      <section className="p-6 sm:p-7 rounded-2xl bg-transparent border border-amber-400/40 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-amber-300 shrink-0" />
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-albiceleste-shiny">
                {getTitleText(settings, 'calendarTitle')}
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-zinc-200">
              {getTitleText(settings, 'calendarSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-4 py-2.5 rounded-xl bg-transparent border border-amber-400/60 flex items-center gap-3">
              <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="text-[11px] font-semibold text-zinc-200 capitalize">{liveDateLabel}</div>
                <div className="font-mono text-lg font-bold text-gold-shiny tabular-nums leading-tight">
                  {liveTimeLabel} hs
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* KPIs rápidos del Calendario */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="p-3.5 rounded-xl bg-transparent border border-zinc-400/35 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-300 font-semibold">
                Agenda de Hoy ({formatReadableDate(todayYmd)})
              </div>
              <div className="font-mono text-xl font-bold text-white tabular-nums mt-0.5">
                {todayEventsCount} {todayEventsCount === 1 ? 'partido' : 'partidos'}
              </div>
            </div>
            <CalendarCheck2 className="w-6 h-6 text-emerald-400 shrink-0" />
          </div>

          <div className="p-3.5 rounded-xl bg-transparent border border-amber-400/45 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold">
                Próxima Fecha de Copa
              </div>
              <div className="text-sm font-bold text-white truncate mt-0.5">
                {nextUpcomingCup
                  ? `${formatReadableDate(nextUpcomingCup.date)} · ${nextUpcomingCup.time}hs`
                  : 'Sin fecha de Copa asignada'}
              </div>
              {nextUpcomingCup && (
                <div className="text-[11px] text-zinc-300 truncate">
                  {nextUpcomingCup.matchupText || nextUpcomingCup.title}
                </div>
              )}
            </div>
            <Trophy className="w-6 h-6 text-amber-300 shrink-0" />
          </div>

          <div className="p-3.5 rounded-xl bg-transparent border border-sky-400/40 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-sky-300 font-semibold">
                Total Fechas Sincronizadas
              </div>
              <div className="font-mono text-xl font-bold text-silver-shiny tabular-nums mt-0.5">
                {unifiedItems.length}
              </div>
            </div>
            {onOpenCup && (
              <button
                type="button"
                onClick={onOpenCup}
                className="px-3 py-1.5 text-xs font-semibold btn-celeste-gold rounded-lg whitespace-nowrap"
              >
                Ver Cuadro Copa
              </button>
            )}
          </div>
        </div>

        {/* Mensaje Oficial del Administrador en el Calendario */}
        {(calendarMessage.trim() || isAdmin) && (
          <div className="p-4 rounded-xl bg-[#0B0D12]/90 border border-amber-400/45 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-amber-300 shrink-0" />
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  Mensaje del Administrador
                </span>
              </div>
              {isAdmin && !editingBannerMsg && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBannerMsgDraft(calendarMessage);
                      setEditingBannerMsg(true);
                      setBannerMsgFeedback(null);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold btn-celeste-gold rounded-lg"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{calendarMessage.trim() ? 'Editar Mensaje' : 'Dejar Mensaje'}</span>
                  </button>
                  {calendarMessage.trim() && (
                    <button
                      type="button"
                      disabled={savingBannerMsg}
                      onClick={handleClearBannerMessage}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 rounded-lg disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Borrar</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {editingBannerMsg && isAdmin ? (
              <form onSubmit={handleSaveBannerMessage} className="space-y-2.5">
                <textarea
                  rows={2}
                  maxLength={600}
                  value={bannerMsgDraft}
                  onChange={(e) => setBannerMsgDraft(e.target.value)}
                  placeholder="Escribí un aviso oficial sobre fechas, horarios, suspensiones o partidos del calendario..."
                  className="w-full px-3 py-2 text-xs bg-[#06070A] text-white border border-amber-400/45 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBannerMsg(false);
                      setBannerMsgDraft(calendarMessage);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-zinc-300 bg-[#06070A] border border-zinc-700 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingBannerMsg}
                    className="px-4 py-1.5 text-xs font-bold btn-gold-luxury rounded-lg disabled:opacity-50"
                  >
                    {savingBannerMsg ? 'Guardando...' : 'Publicar Mensaje'}
                  </button>
                </div>
              </form>
            ) : calendarMessage.trim() ? (
              <p className="text-sm text-zinc-100 leading-relaxed whitespace-pre-line">
                {calendarMessage}
              </p>
            ) : (
              <p className="text-xs text-zinc-400">
                Todavía no dejaste ningún mensaje en el calendario. Tocá &ldquo;Dejar Mensaje&rdquo; para publicar un comunicado visible para toda la liga.
              </p>
            )}

            {bannerMsgFeedback && (
              <div className="text-[11px] font-semibold text-emerald-300">{bannerMsgFeedback}</div>
            )}
          </div>
        )}
      </section>

      {/* Grid Mensual + Lista Sincronizada */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Calendario Mensual Interactivo */}
        <section className="lg:col-span-7 p-5 rounded-2xl bg-[#0B0D12]/95 border border-zinc-400/30 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="Mes anterior"
                className="p-2 rounded-lg bg-[#06070A] hover:bg-[#141821] border border-zinc-400/35 text-zinc-200 hover:text-amber-300 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2">
                <select
                  value={viewMonth}
                  onChange={(e) => setViewMonth(Number(e.target.value))}
                  aria-label="Seleccionar mes"
                  className="px-2.5 py-1.5 text-sm font-bold bg-[#06070A] text-white border border-zinc-400/35 rounded-lg"
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={name} value={idx}>
                      {name}
                    </option>
                  ))}
                </select>

                <select
                  value={viewYear}
                  onChange={(e) => setViewYear(Number(e.target.value))}
                  aria-label="Seleccionar año"
                  className="px-2.5 py-1.5 text-sm font-mono font-bold bg-[#06070A] text-amber-300 border border-zinc-400/35 rounded-lg"
                >
                  {Array.from({ length: 5 }, (_, idx) => now.getFullYear() - 1 + idx).map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="Mes siguiente"
                className="p-2 rounded-lg bg-[#06070A] hover:bg-[#141821] border border-zinc-400/35 text-zinc-200 hover:text-amber-300 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-zinc-200 bg-[#06070A] hover:bg-[#141821] border border-zinc-400/35 rounded-lg"
                >
                  Ver Todo el Mes
                </button>
              )}
              <button
                type="button"
                onClick={handleJumpToToday}
                className="px-3 py-1.5 text-xs font-bold btn-gold-luxury rounded-lg"
              >
                Hoy
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAY_SHORT.map((dayName) => (
              <div
                key={dayName}
                className="py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400"
              >
                {dayName}
              </div>
            ))}

            {calendarCells.map((cell, idx) => {
              if (!cell.dateStr || !cell.dayNum) {
                return (
                  <div
                    key={`empty_${idx}`}
                    className="min-h-[78px] rounded-xl bg-[#06070A]/45 border border-zinc-800/40"
                  />
                );
              }

              const cellDate = cell.dateStr;
              const dayItems = itemsByDate.get(cellDate) || [];
              const isToday = cellDate === todayYmd;
              const isSelected = cellDate === selectedDate;
              const hasCopa = dayItems.some((d) => d.category === 'copa' || d.category === 'recopa');
              const hasLiga = dayItems.some((d) => d.category === 'liga');
              const firstItem = dayItems[0];
              const hasCrests = Boolean(firstItem?.homeCrestUrl || firstItem?.awayCrestUrl);

              return (
                <button
                  key={cellDate}
                  type="button"
                  onClick={() => {
                    setSelectedDate((prev) => (prev === cellDate ? null : cellDate));
                    if (isAdmin && !editingId) {
                      setFormDate(cellDate);
                    }
                  }}
                  className={`min-h-[78px] p-1.5 rounded-xl border text-left flex flex-col justify-between transition-all ${
                    isSelected
                      ? 'bg-amber-400/15 border-amber-400 shadow-[0_0_16px_rgba(250,204,21,0.28)]'
                      : isToday
                      ? 'bg-emerald-500/10 border-emerald-400/75'
                      : dayItems.length > 0
                      ? 'bg-[#10131A] border-zinc-400/35 hover:border-amber-400/60'
                      : 'bg-[#06070A] border-zinc-800/80 hover:border-zinc-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`font-mono text-xs font-bold ${
                        isToday ? 'text-emerald-300' : isSelected ? 'text-amber-300' : 'text-zinc-200'
                      }`}
                    >
                      {cell.dayNum}
                    </span>
                    {isToday && (
                      <span className="text-[9px] font-bold px-1 rounded bg-emerald-500/25 text-emerald-300">
                        HOY
                      </span>
                    )}
                  </div>

                  {firstItem && (
                    <div className="space-y-1 w-full mt-1">
                      {hasCrests && (
                        <div className="flex items-center justify-center gap-1">
                          {firstItem.homeCrestUrl && (
                            <ResilientImage
                              src={firstItem.homeCrestUrl}
                              alt={firstItem.homeTeamName || 'Local'}
                              className="w-4 h-4 rounded-full object-contain bg-black/50 border border-amber-400/40"
                            />
                          )}
                          {firstItem.homeCrestUrl && firstItem.awayCrestUrl && (
                            <span className="text-[8px] font-bold text-amber-300">vs</span>
                          )}
                          {firstItem.awayCrestUrl && (
                            <ResilientImage
                              src={firstItem.awayCrestUrl}
                              alt={firstItem.awayTeamName || 'Visitante'}
                              className="w-4 h-4 rounded-full object-contain bg-black/50 border border-sky-400/40"
                            />
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        {hasCopa && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                        {hasLiga && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />}
                        {!hasCopa && !hasLiga && (
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 shrink-0" />
                        )}
                        <span className="text-[10px] font-mono text-zinc-200 truncate">
                          {firstItem.time}
                        </span>
                      </div>
                      <div className="text-[9px] text-zinc-300 truncate font-medium">
                        {dayItems.length > 1
                          ? `${dayItems.length} eventos`
                          : firstItem.matchupText || firstItem.title}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-zinc-800 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              Día Actual
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              Copa de la Liga / Recopa
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
              Fecha de Liga
            </span>
          </div>
        </section>

        {/* Agenda Cronológica & Filtros */}
        <section className="lg:col-span-5 p-5 rounded-2xl bg-[#0B0D12]/95 border border-zinc-400/30 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-2xl font-bold text-gold-shiny">
              {selectedDate ? `Agenda del ${formatReadableDate(selectedDate)}` : 'Próximos Días y Horarios'}
            </h2>

            <div className="flex flex-wrap gap-1">
              {(
                [
                  { id: 'all', label: 'Todos' },
                  { id: 'copa', label: 'Copa' },
                  { id: 'liga', label: 'Liga' },
                  { id: 'recopa', label: 'Recopa' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategoryFilter(tab.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition-colors ${
                    categoryFilter === tab.id
                      ? 'btn-gold-luxury'
                      : 'bg-[#06070A] text-zinc-300 border-zinc-700 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-[#06070A] border border-zinc-800 text-xs text-zinc-400 space-y-1.5">
              <CalendarDays className="w-6 h-6 text-zinc-500 mx-auto" />
              <p>
                {selectedDate
                  ? `No hay partidos ni eventos programados para el ${formatReadableDate(selectedDate)}.`
                  : 'Todavía no hay fechas asignadas. El Administrador puede programar partidos y escudos abajo.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
              {filteredItems.map((item) => {
                const targetMs = parseDateTimeMs(item.date, item.time);
                const status = formatCountdownBadge(targetMs, nowMs, todayYmd, item.date, item.played);
                const statusBadgeStyle =
                  status.tone === 'emerald'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/45'
                    : status.tone === 'gold'
                    ? 'bg-amber-400/15 text-amber-300 border-amber-400/50'
                    : status.tone === 'silver'
                    ? 'bg-zinc-300/10 text-zinc-200 border-zinc-400/40'
                    : 'bg-zinc-900 text-zinc-500 border-zinc-800';

                const showMatchCrests = Boolean(item.homeTeamName || item.awayTeamName || item.homeCrestUrl || item.awayCrestUrl);

                return (
                  <article
                    key={item.key}
                    className="p-3.5 rounded-xl bg-[#06070A] border border-zinc-400/25 hover:border-amber-400/50 transition-colors space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded border ${categoryBadgeClass(
                            item.category
                          )}`}
                        >
                          {categoryLabel(item.category)}
                        </span>
                        <span className="font-mono text-xs font-bold text-white">
                          {formatReadableDate(item.date)} · {item.time}hs
                        </span>
                      </div>

                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${statusBadgeStyle}`}>
                        {status.label}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-sm font-bold text-silver-shiny">{item.title}</h3>

                      {showMatchCrests ? (
                        <div className="p-2.5 rounded-lg bg-[#0B0E16] border border-amber-400/20 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {item.homeCrestUrl ? (
                              <ResilientImage
                                src={item.homeCrestUrl}
                                alt={item.homeTeamName || 'Local'}
                                className="w-7 h-7 rounded-full object-contain bg-black/55 border border-amber-400/45 shrink-0"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shrink-0">
                                {item.category === 'recopa' ? (
                                  <Crown className="w-3.5 h-3.5 text-emerald-400" />
                                ) : item.category === 'copa' ? (
                                  <Trophy className="w-3.5 h-3.5 text-amber-300" />
                                ) : (
                                  <Shield className="w-3.5 h-3.5 text-sky-400" />
                                )}
                              </div>
                            )}
                            <span className="text-xs font-bold text-amber-100 truncate">
                              {item.homeTeamName || 'Local'}
                            </span>
                          </div>

                          <span className="text-[10px] font-mono font-extrabold text-amber-300 px-1.5 shrink-0">
                            VS
                          </span>

                          <div className="flex items-center justify-end gap-2 min-w-0 flex-1">
                            <span className="text-xs font-bold text-amber-100 truncate text-right">
                              {item.awayTeamName || 'Visitante'}
                            </span>
                            {item.awayCrestUrl ? (
                              <ResilientImage
                                src={item.awayCrestUrl}
                                alt={item.awayTeamName || 'Visitante'}
                                className="w-7 h-7 rounded-full object-contain bg-black/55 border border-sky-400/45 shrink-0"
                              />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shrink-0">
                                <Shield className="w-3.5 h-3.5 text-sky-400" />
                              </div>
                            )}
                          </div>
                        </div>
                      ) : item.matchupText ? (
                        <div className="text-xs font-semibold text-amber-200 flex items-center gap-1.5">
                          <Trophy className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                          <span>{item.matchupText}</span>
                        </div>
                      ) : null}

                      {item.notes && (
                        <p className="text-[11px] text-zinc-300 bg-[#0B0D12] border border-zinc-800/80 rounded-lg px-2.5 py-1.5">
                          {item.notes}
                        </p>
                      )}
                    </div>

                    {isAdmin && (
                      <div className="flex items-center justify-end gap-2 pt-1.5 border-t border-zinc-800/80">
                        <button
                          type="button"
                          onClick={() => handleEditAnyItem(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 bg-[#121620] hover:text-amber-300 rounded"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Editar / Escudos</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAnyItem(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Quitar</span>
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Panel Administrador exclusivo para editar/agregar fechas, partidos y escudos */}
      {isAdmin && (
        <section
          ref={formSectionRef}
          className="p-6 rounded-2xl bg-[#0B0D12]/95 border border-amber-400/45 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl font-bold text-gold-shiny flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-300" />
                <span>
                  {editingId
                    ? 'Editar Fecha, Escudos y Mensaje del Partido'
                    : 'Programar Partido, Poner Escudos y Mensaje en el Calendario'}
                </span>
              </h2>
              <p className="text-xs text-zinc-300">
                Solo el Administrador puede editar cualquier fecha del calendario, elegir equipos del torneo o cargar escudos PNG propios y dejar notas del partido.
              </p>
            </div>
            {(editingId || formCupMatchId || formFixtureId || formTitle) && (
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-1.5 text-xs font-semibold text-zinc-200 bg-[#06070A] border border-zinc-600 rounded-lg"
              >
                Limpiar / Cancelar edición
              </button>
            )}
          </div>

          {msg && (
            <div
              className={`p-3 text-xs font-semibold rounded-xl border ${
                msg.type === 'ok'
                  ? 'bg-emerald-950/60 border-emerald-400/45 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-400/45 text-rose-200'
              }`}
            >
              {msg.text}
            </div>
          )}

          <form onSubmit={handleSubmitEvent} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Vincular Llave Copa / Recopa (opc.)
                </label>
                <select
                  value={formCupMatchId}
                  onChange={(e) => handleSelectCupLink(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#06070A] text-white border border-zinc-400/35 rounded-lg"
                >
                  <option value="">Sin vínculo Copa...</option>
                  {cup.matches.map((m) => (
                    <option key={m.id} value={m.id}>
                      {CUP_ROUND_NAMES[m.round]} #{m.matchIndex}: {m.homeTeamName || 'Por def.'} vs{' '}
                      {m.awayTeamName || 'Por def.'}
                    </option>
                  ))}
                  <option value="recopa">
                    Recopa: {cup.recopa.leagueChampionName || 'Campeón Liga'} vs{' '}
                    {cup.recopa.cupChampionName || 'Campeón Copa'}
                  </option>
                </select>
              </div>

              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Vincular Cruce de Liga (opc.)
                </label>
                <select
                  value={formFixtureId}
                  onChange={(e) => handleSelectFixtureLink(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#06070A] text-white border border-zinc-400/35 rounded-lg"
                >
                  <option value="">Sin vínculo Liga...</option>
                  {fixtures.map((fx) => {
                    const home = teamMap.get(fx.homeTeamId)?.name || fx.homeTeamId;
                    const away = teamMap.get(fx.awayTeamId)?.name || fx.awayTeamId;
                    return (
                      <option key={fx.id} value={fx.id}>
                        Fecha {fx.matchday} ({fx.leg}): {home} vs {away}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="lg:col-span-4">
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Título del Evento / Fecha
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Ej: Fecha 5 · Clásico o 8° Octavos"
                  className="w-full px-3 py-2 text-xs bg-[#06070A] text-white border border-zinc-400/35 rounded-lg"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Torneo / Tipo
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as CalendarCategory)}
                  className="w-full px-3 py-2 text-xs bg-[#06070A] text-white border border-zinc-400/35 rounded-lg"
                >
                  <option value="copa">Copa de la Liga</option>
                  <option value="liga">Liga Master</option>
                  <option value="recopa">Recopa</option>
                  <option value="evento">Evento Oficial</option>
                </select>
              </div>
            </div>

            {/* Escudos y Equipos Local vs Visitante */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Local */}
              <div className="lg:col-span-5 p-3.5 rounded-xl bg-[#06070A] border border-amber-400/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300">Equipo Local y Escudo</span>
                  {homeCrestPreview && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormHomeCrestFile(null);
                        setFormHomeCrestUrl('');
                        setClearHomeCrest(true);
                        if (homeCrestInputRef.current) homeCrestInputRef.current.value = '';
                      }}
                      className="inline-flex items-center gap-1 text-[10px] text-rose-300 hover:text-rose-200"
                    >
                      <X className="w-3 h-3" />
                      Quitar escudo
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={formHomeTeamId}
                    onChange={(e) => handleSelectTeamDropdown('home', e.target.value)}
                    aria-label="Seleccionar club local"
                    className="w-full px-2.5 py-2 text-xs bg-[#0B0D12] text-white border border-zinc-400/35 rounded-lg"
                  >
                    <option value="">Elegir equipo registrado...</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.memberName})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={formHomeTeam}
                    onChange={(e) => setFormHomeTeam(e.target.value)}
                    placeholder="O escribir nombre Local"
                    className="w-full px-2.5 py-2 text-xs bg-[#0B0D12] text-white border border-zinc-400/35 rounded-lg"
                  />
                </div>

                <div className="flex items-center gap-3">
                  {homeCrestPreview ? (
                    <ResilientImage
                      src={homeCrestPreview}
                      alt="Escudo local"
                      className="w-10 h-10 rounded-full object-contain bg-black/60 border border-amber-400/50 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4 text-zinc-500" />
                    </div>
                  )}
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold btn-celeste-gold rounded-lg cursor-pointer">
                    <ImagePlus className="w-3.5 h-3.5 text-amber-300" />
                    <span>{formHomeCrestFile ? formHomeCrestFile.name : 'Subir Escudo Local (PNG)'}</span>
                    <input
                      ref={homeCrestInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setFormHomeCrestFile(file);
                        if (file) setClearHomeCrest(false);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Visitante */}
              <div className="lg:col-span-5 p-3.5 rounded-xl bg-[#06070A] border border-sky-400/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-sky-300">Equipo Visitante y Escudo</span>
                  {awayCrestPreview && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormAwayCrestFile(null);
                        setFormAwayCrestUrl('');
                        setClearAwayCrest(true);
                        if (awayCrestInputRef.current) awayCrestInputRef.current.value = '';
                      }}
                      className="inline-flex items-center gap-1 text-[10px] text-rose-300 hover:text-rose-200"
                    >
                      <X className="w-3 h-3" />
                      Quitar escudo
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={formAwayTeamId}
                    onChange={(e) => handleSelectTeamDropdown('away', e.target.value)}
                    aria-label="Seleccionar club visitante"
                    className="w-full px-2.5 py-2 text-xs bg-[#0B0D12] text-white border border-zinc-400/35 rounded-lg"
                  >
                    <option value="">Elegir equipo registrado...</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.memberName})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={formAwayTeam}
                    onChange={(e) => setFormAwayTeam(e.target.value)}
                    placeholder="O escribir nombre Visitante"
                    className="w-full px-2.5 py-2 text-xs bg-[#0B0D12] text-white border border-zinc-400/35 rounded-lg"
                  />
                </div>

                <div className="flex items-center gap-3">
                  {awayCrestPreview ? (
                    <ResilientImage
                      src={awayCrestPreview}
                      alt="Escudo visitante"
                      className="w-10 h-10 rounded-full object-contain bg-black/60 border border-sky-400/50 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shrink-0">
                      <Shield className="w-4 h-4 text-zinc-500" />
                    </div>
                  )}
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold btn-celeste-gold rounded-lg cursor-pointer">
                    <ImagePlus className="w-3.5 h-3.5 text-sky-300" />
                    <span>{formAwayCrestFile ? formAwayCrestFile.name : 'Subir Escudo Visitante (PNG)'}</span>
                    <input
                      ref={awayCrestInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setFormAwayCrestFile(file);
                        if (file) setClearAwayCrest(false);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Fecha y Hora */}
              <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-1 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Día / Mes / Año
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-[#06070A] text-white border border-amber-400/45 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Hora</label>
                  <input
                    type="time"
                    required
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-[#06070A] text-amber-300 border border-amber-400/45 rounded-lg"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
              <div className="lg:col-span-9">
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Mensaje / Notas del Partido (opcional)
                </label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Ej: Transmisión en vivo / Estadio PES6 / Condición local"
                  className="w-full px-3 py-2 text-xs bg-[#06070A] text-white border border-zinc-400/35 rounded-lg"
                />
              </div>

              <div className="lg:col-span-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 px-4 text-xs font-bold btn-gold-luxury disabled:opacity-50 rounded-lg"
                >
                  {saving ? 'Guardando...' : editingId ? 'Actualizar Partido' : 'Agendar Partido'}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
