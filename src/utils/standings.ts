import type { Match, PublicTeam, StandingRow } from '../types';

export function computeStandings(
  teams: PublicTeam[] = [],
  matches: Match[] = []
): StandingRow[] {
  const safeTeams = Array.isArray(teams) ? teams : [];
  const safeMatches = Array.isArray(matches) ? matches : [];
  const map = new Map<string, StandingRow>();

  for (const team of safeTeams) {
    if (!team?.id) continue;
    map.set(team.id, {
      position: 0,
      team,
      pj: 0,
      pg: 0,
      pe: 0,
      pp: 0,
      gf: 0,
      gc: 0,
      dg: 0,
      pts: 0,
    });
  }

  for (const match of safeMatches) {
    if (!match || match.status !== 'validated') continue;
    if (match.competitionType === 'copa' || match.competitionType === 'recopa') continue;
    const home = map.get(match.homeTeamId);
    const away = map.get(match.awayTeamId);
    if (!home || !away) continue;

    home.pj += 1;
    away.pj += 1;
    home.gf += match.homeGoals;
    home.gc += match.awayGoals;
    away.gf += match.awayGoals;
    away.gc += match.homeGoals;

    if (match.homeGoals > match.awayGoals) {
      home.pg += 1;
      home.pts += 3;
      away.pp += 1;
    } else if (match.homeGoals < match.awayGoals) {
      away.pg += 1;
      away.pts += 3;
      home.pp += 1;
    } else {
      home.pe += 1;
      away.pe += 1;
      home.pts += 1;
      away.pts += 1;
    }
  }

  const rows = Array.from(map.values()).map((row) => ({
    ...row,
    dg: row.gf - row.gc,
  }));

  rows.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.dg !== a.dg) return b.dg - a.dg;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.team.name.localeCompare(b.team.name, 'es');
  });

  return rows.map((row, idx) => ({
    ...row,
    position: idx + 1,
  }));
}
