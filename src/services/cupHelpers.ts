import type {
  ChampionEntry,
  CupMatchNode,
  CupParticipant,
  CupRound,
  CupTournament,
  Match,
  NewsPost,
  PublicTeam,
  TeamTrophy,
} from '../types';
import { computeStandings } from '../utils/standings';

export const LIGA_TROPHY_IMG = '/assets/aistudio/Trofeo_Liga_Argentina_LMA.jpg';
export const COPA_TROPHY_IMG = '/assets/aistudio/Copa_de_la_liga_Argentina_4a33ee89.jfif';
export const RECOPA_TROPHY_IMG = '/assets/aistudio/Recopa_Argentina____fc7a7c8a.jfif';

export function buildEmptyCup(editionNumber = 1, seededTeams: PublicTeam[] = []): CupTournament {
  const participants: CupParticipant[] = Array.from({ length: 16 }, (_, idx) => {
    const slot = idx + 1;
    const t = seededTeams[idx];
    if (t) {
      return {
        slot,
        teamId: t.id,
        teamName: t.name,
        memberName: t.memberName,
        crestUrl: t.crestUrl || '',
      };
    }
    return {
      slot,
      teamName: `Cupo Libre #${slot}`,
      memberName: 'Por definir',
      crestUrl: '',
    };
  });

  const makeMatch = (
    id: string,
    round: CupRound,
    matchIndex: number,
    homeSlot: number | null,
    awaySlot: number | null
  ): CupMatchNode => {
    const home = homeSlot !== null ? participants.find((p) => p.slot === homeSlot) : undefined;
    const away = awaySlot !== null ? participants.find((p) => p.slot === awaySlot) : undefined;
    return {
      id,
      round,
      matchIndex,
      homeSlot,
      awaySlot,
      homeTeamName: home?.teamName || '',
      awayTeamName: away?.teamName || '',
      homeMemberName: home?.memberName || '',
      awayMemberName: away?.memberName || '',
      homeCrestUrl: home?.crestUrl || '',
      awayCrestUrl: away?.crestUrl || '',
      homeGoals: null,
      awayGoals: null,
      homePenalties: null,
      awayPenalties: null,
      extraTime: false,
      winnerSlot: null,
      played: false,
    };
  };

  const matches: CupMatchNode[] = [
    makeMatch('r16_1', 'r16', 1, 1, 2),
    makeMatch('r16_2', 'r16', 2, 3, 4),
    makeMatch('r16_3', 'r16', 3, 5, 6),
    makeMatch('r16_4', 'r16', 4, 7, 8),
    makeMatch('r16_5', 'r16', 5, 9, 10),
    makeMatch('r16_6', 'r16', 6, 11, 12),
    makeMatch('r16_7', 'r16', 7, 13, 14),
    makeMatch('r16_8', 'r16', 8, 15, 16),
    makeMatch('qf_1', 'qf', 1, null, null),
    makeMatch('qf_2', 'qf', 2, null, null),
    makeMatch('qf_3', 'qf', 3, null, null),
    makeMatch('qf_4', 'qf', 4, null, null),
    makeMatch('sf_1', 'sf', 1, null, null),
    makeMatch('sf_2', 'sf', 2, null, null),
    makeMatch('final', 'final', 1, null, null),
  ];

  const topTeam = seededTeams[0];
  return {
    editionNumber,
    editionName: `${editionNumber}° Edición — Copa de la Liga`,
    status: 'in_progress',
    participants,
    matches,
    championSlot: null,
    championTeamName: '',
    championMemberName: '',
    championCrestUrl: '',
    championGreeting: '¡Felicitaciones Campeón de la Copa de la Liga!',
    recopa: {
      enabled: true,
      leagueChampionName: topTeam?.name || 'Campeón de Liga',
      leagueChampionMember: topTeam?.memberName || 'Por definir',
      leagueChampionCrestUrl: topTeam?.crestUrl || '',
      cupChampionName: 'Campeón de Copa',
      cupChampionMember: 'Por definir',
      cupChampionCrestUrl: '',
      leagueGoals: null,
      cupGoals: null,
      leaguePenalties: null,
      cupPenalties: null,
      extraTime: false,
      grandChampionName: '',
      grandChampionMember: '',
      grandChampionCrestUrl: '',
      grandChampionSide: null,
      greeting: '¡Felicitaciones Campeón de la Recopa!',
      played: false,
    },
    updatedAt: new Date().toISOString(),
  };
}

export const NEXT_STAGE_MAP: Record<string, { nextMatchId: string; side: 'home' | 'away' }> = {
  r16_1: { nextMatchId: 'qf_1', side: 'home' },
  r16_2: { nextMatchId: 'qf_1', side: 'away' },
  r16_3: { nextMatchId: 'qf_2', side: 'home' },
  r16_4: { nextMatchId: 'qf_2', side: 'away' },
  r16_5: { nextMatchId: 'qf_3', side: 'home' },
  r16_6: { nextMatchId: 'qf_3', side: 'away' },
  r16_7: { nextMatchId: 'qf_4', side: 'home' },
  r16_8: { nextMatchId: 'qf_4', side: 'away' },
  qf_1: { nextMatchId: 'sf_1', side: 'home' },
  qf_2: { nextMatchId: 'sf_1', side: 'away' },
  qf_3: { nextMatchId: 'sf_2', side: 'home' },
  qf_4: { nextMatchId: 'sf_2', side: 'away' },
  sf_1: { nextMatchId: 'final', side: 'home' },
  sf_2: { nextMatchId: 'final', side: 'away' },
};

export function recomputeCupBracket(
  rawCup: CupTournament,
  teams: PublicTeam[],
  leagueMatches: Match[]
): CupTournament {
  const cup: CupTournament = JSON.parse(JSON.stringify(rawCup)) as CupTournament;
  const partMap = new Map(cup.participants.map((p) => [p.slot, p]));
  const matchMap = new Map(cup.matches.map((m) => [m.id, m]));

  const syncMatchLabels = (m: CupMatchNode) => {
    const h = m.homeSlot !== null ? partMap.get(m.homeSlot) : undefined;
    const a = m.awaySlot !== null ? partMap.get(m.awaySlot) : undefined;
    m.homeTeamName = h?.teamName || '';
    m.homeMemberName = h?.memberName || '';
    m.homeCrestUrl = h?.crestUrl || '';
    m.awayTeamName = a?.teamName || '';
    m.awayMemberName = a?.memberName || '';
    m.awayCrestUrl = a?.crestUrl || '';
  };

  for (const m of cup.matches) {
    syncMatchLabels(m);
  }

  const orderedIds = [
    'r16_1', 'r16_2', 'r16_3', 'r16_4', 'r16_5', 'r16_6', 'r16_7', 'r16_8',
    'qf_1', 'qf_2', 'qf_3', 'qf_4',
    'sf_1', 'sf_2',
    'final',
  ];

  for (const id of orderedIds) {
    const m = matchMap.get(id);
    if (!m) continue;
    syncMatchLabels(m);

    // Resolve winnerSlot from score if played with goals; preserve manual winnerSlot if no goals yet
    if (
      m.played &&
      m.homeGoals !== null &&
      m.awayGoals !== null &&
      m.homeSlot !== null &&
      m.awaySlot !== null
    ) {
      let winSide: 'home' | 'away' | null = null;
      if (m.homeGoals > m.awayGoals) winSide = 'home';
      else if (m.awayGoals > m.homeGoals) winSide = 'away';
      else if (
        m.homePenalties !== null &&
        m.awayPenalties !== null &&
        m.homePenalties !== m.awayPenalties
      ) {
        winSide = m.homePenalties > m.awayPenalties ? 'home' : 'away';
      }
      if (winSide === 'home') {
        m.winnerSlot = m.homeSlot;
      } else if (winSide === 'away') {
        m.winnerSlot = m.awaySlot;
      }
    } else if (
      m.winnerSlot !== null &&
      m.winnerSlot !== m.homeSlot &&
      m.winnerSlot !== m.awaySlot
    ) {
      m.winnerSlot = null;
    }

    if (m.winnerSlot !== null) {
      const winPart = partMap.get(m.winnerSlot);
      m.winnerName = winPart?.teamName || '';
      m.winnerMemberName = winPart?.memberName || '';
      m.winnerCrestUrl = winPart?.crestUrl || '';
    } else {
      m.winnerName = '';
      m.winnerMemberName = '';
      m.winnerCrestUrl = '';
    }

    const next = NEXT_STAGE_MAP[id];
    if (next && m.winnerSlot !== null) {
      const nextNode = matchMap.get(next.nextMatchId);
      const winPart = partMap.get(m.winnerSlot);
      if (nextNode && winPart) {
        if (next.side === 'home') {
          nextNode.homeSlot = winPart.slot;
          nextNode.homeTeamName = winPart.teamName;
          nextNode.homeMemberName = winPart.memberName;
          nextNode.homeCrestUrl = winPart.crestUrl;
        } else {
          nextNode.awaySlot = winPart.slot;
          nextNode.awayTeamName = winPart.teamName;
          nextNode.awayMemberName = winPart.memberName;
          nextNode.awayCrestUrl = winPart.crestUrl;
        }
      }
    }
  }

  const finalMatch = matchMap.get('final');
  if (finalMatch?.played && finalMatch.winnerSlot !== null) {
    const champPart = partMap.get(finalMatch.winnerSlot);
    cup.status = 'finished';
    cup.championSlot = finalMatch.winnerSlot;
    cup.championTeamName = champPart?.teamName || finalMatch.winnerName || '';
    cup.championMemberName = champPart?.memberName || finalMatch.winnerMemberName || '';
    cup.championCrestUrl = champPart?.crestUrl || finalMatch.winnerCrestUrl || '';
    if (cup.recopa) {
      cup.recopa.cupChampionName = cup.championTeamName;
      cup.recopa.cupChampionMember = cup.championMemberName;
      cup.recopa.cupChampionCrestUrl = cup.championCrestUrl;
    }
  } else if (cup.status !== 'finished') {
    cup.status = 'in_progress';
    cup.championSlot = null;
    cup.championTeamName = '';
    cup.championMemberName = '';
    cup.championCrestUrl = '';
  }

  // Keep league champion fallback synced in Recopa if still placeholder
  if (cup.recopa && (!cup.recopa.leagueChampionName || cup.recopa.leagueChampionName === 'Campeón de Liga')) {
    const standings = computeStandings(teams, leagueMatches);
    if (standings[0]) {
      cup.recopa.leagueChampionName = standings[0].team.name;
      cup.recopa.leagueChampionMember = standings[0].team.memberName;
      cup.recopa.leagueChampionCrestUrl = standings[0].team.crestUrl;
    }
  }

  cup.updatedAt = new Date().toISOString();
  return cup;
}

export function buildChampionNewspaperPost(opts: {
  teamName: string;
  memberName: string;
  crestUrl?: string;
  type: 'liga' | 'copa' | 'recopa';
  season: string;
  celebrationImageUrl?: string;
  trophyImageUrl?: string;
  tournamentLabel?: string;
  sourceKey: string;
}): NewsPost {
  const tournamentLabel =
    opts.tournamentLabel?.trim() ||
    (opts.type === 'recopa'
      ? 'Recopa Argentina'
      : opts.type === 'copa'
      ? 'Copa de la Liga Argentina'
      : 'Liga Master Argentina');
  const defaultImg =
    opts.trophyImageUrl?.trim() ||
    (opts.type === 'copa'
      ? COPA_TROPHY_IMG
      : opts.type === 'recopa'
      ? RECOPA_TROPHY_IMG
      : LIGA_TROPHY_IMG);
  const celebrationImg = opts.celebrationImageUrl || defaultImg;
  const crestUrl =
    opts.crestUrl || '/assets/aistudio/Liga_Master_Argentina__F_tbol_de__lite_eeeab9aa.png';
  const now = new Date().toISOString();

  return {
    id: `news_${opts.sourceKey.replace(/[^a-zA-Z0-9_\-]/g, '_')}`.slice(0, 76),
    title: `¡${opts.teamName.toUpperCase()} CAMPEÓN DE ${tournamentLabel.toUpperCase()}!`,
    content: `¡EDICIÓN EXTRAORDINARIA! ${opts.teamName}, dirigido por ${opts.memberName}, levantó la copa y se consagró campeón oficial de ${tournamentLabel} (${opts.season}). ¡Salud campeón de la Liga Master Argentina PES6!`,
    textColor: '#FACC15',
    imageUrl: celebrationImg,
    isChampionNewspaper: true,
    championTeamName: opts.teamName,
    championMemberName: opts.memberName,
    championCrestUrl: crestUrl,
    championTournament: tournamentLabel,
    championSeason: opts.season,
    celebrationImageUrl: celebrationImg,
    likes: 0,
    sourceKey: opts.sourceKey,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildTrophyEntry(opts: {
  type: 'liga' | 'copa' | 'recopa';
  season: string;
  message?: string;
  imageUrl?: string;
  title?: string;
  sourceKey: string;
}): TeamTrophy {
  const imageUrl =
    opts.imageUrl?.trim() ||
    (opts.type === 'copa'
      ? COPA_TROPHY_IMG
      : opts.type === 'recopa'
      ? RECOPA_TROPHY_IMG
      : LIGA_TROPHY_IMG);
  const title =
    opts.title?.trim() ||
    (opts.type === 'copa'
      ? 'Campeón Copa de la Liga'
      : opts.type === 'recopa'
      ? 'Gran Campeón Recopa Argentina'
      : 'Campeón Liga Argentina');

  return {
    id: `trophy_${opts.sourceKey.replace(/[^a-zA-Z0-9_\-]/g, '_')}`.slice(0, 60),
    type: opts.type,
    title,
    season: opts.season,
    imageUrl,
    message: opts.message || '',
    awardedAt: new Date().toISOString(),
    sourceKey: opts.sourceKey,
  };
}

export function buildChampionHallEntry(opts: {
  id: string;
  season: string;
  teamName: string;
  memberName: string;
  teamId?: string;
  tournamentType: 'liga' | 'copa' | 'recopa';
  notes?: string;
  celebrationImageUrl?: string;
  trophyImageUrl?: string;
}): ChampionEntry {
  const defaultImg =
    opts.trophyImageUrl?.trim() ||
    (opts.tournamentType === 'copa'
      ? COPA_TROPHY_IMG
      : opts.tournamentType === 'recopa'
      ? RECOPA_TROPHY_IMG
      : LIGA_TROPHY_IMG);
  return {
    id: opts.id,
    season: opts.season,
    teamName: opts.teamName,
    memberName: opts.memberName,
    teamId: opts.teamId,
    tournamentType: opts.tournamentType,
    notes: opts.notes || '',
    celebrationImageUrl: opts.celebrationImageUrl || defaultImg,
    createdAt: new Date().toISOString(),
  };
}
