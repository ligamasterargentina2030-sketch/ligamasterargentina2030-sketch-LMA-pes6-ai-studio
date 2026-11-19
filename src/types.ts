export interface FeaturedVideoSelection {
  id: string;
  source: 'community' | 'local';
  title: string;
  author: string;
  videoUrl: string;
  downloadUrl?: string;
  originalFormat?: 'MP4' | 'AVI';
  fechaLabel?: string;
}

export interface CommunityVideo {
  id: string;
  titulo: string;
  autor: string;
  videoUrl: string;
  fechaMs: number;
  fechaLabel: string;
}

export interface LeagueSettings {
  title: string;
  subtitle: string;
  description?: string;
  calendarMessage?: string;
  bannerText: string;
  crestUrl: string;
  coverUrl: string;
  backgroundUrl?: string;
  faviconUrl?: string;
  adminId: string;
  adminTeamId?: string;
  backupGmail?: string;
  featuredVideo?: FeaturedVideoSelection | null;
  radioName?: string;
  radioStreamUrl?: string;
  maxTeams: number;
}

export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export interface TeamTrophy {
  id: string;
  type: 'liga' | 'copa' | 'recopa';
  title: string;
  season: string;
  imageUrl: string;
  message?: string;
  awardedAt: string;
  sourceKey?: string;
}

export interface LastListenedTrack {
  title: string;
  artist: string;
  coverUrl?: string;
  audioUrl?: string;
  listenedAt: string;
}

export type AccountStatus = 'active' | 'blocked';

export interface Team {
  id: string;
  name: string;
  memberName: string;
  crestUrl: string;
  bio?: string;
  likes?: number;
  trophies?: TeamTrophy[];
  personalMusic?: MusicTrack[];
  lastListenedTrack?: LastListenedTrack;
  celebrationImageUrl?: string;
  celebrationStatus?: ModerationStatus;
  celebrationUploadedAt?: string;
  accountStatus?: AccountStatus;
  hasPassword?: boolean;
  credentialsUpdatedAt?: string;
  createdAt: string;
}

export interface PublicTeam {
  id: string;
  name: string;
  memberName: string;
  crestUrl: string;
  bio?: string;
  likes?: number;
  trophies?: TeamTrophy[];
  personalMusic?: MusicTrack[];
  lastListenedTrack?: LastListenedTrack;
  celebrationImageUrl?: string;
  celebrationStatus?: ModerationStatus;
  celebrationUploadedAt?: string;
  accountStatus?: AccountStatus;
  createdAt: string;
}

export type MatchStatus = 'pending' | 'validated' | 'rejected';

export interface Match {
  id: string;
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  leg: 'Ida' | 'Vuelta';
  competitionType?: 'liga' | 'copa' | 'recopa';
  cupMatchId?: string;
  homePenalties?: number | null;
  awayPenalties?: number | null;
  extraTime?: boolean;
  playedAt: string;
  notes?: string;
  proofImageUrl?: string;
  proofImageStatus?: ModerationStatus;
  scorerImageUrl?: string;
  scorerName?: string;
  scorerImageStatus?: ModerationStatus;
  fixtureId?: string;
  submittedByTeamId: string;
  submittedByName: string;
  status: MatchStatus;
  validatedAt?: string;
  createdAt: string;
}

export interface ScheduledFixture {
  id: string;
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  leg: 'Ida' | 'Vuelta';
  scheduledDate?: string;
  scheduledTime?: string;
  notes?: string;
  completedMatchId?: string;
  createdAt: string;
}

export type CalendarCategory = 'copa' | 'liga' | 'recopa' | 'evento';

export interface CalendarEvent {
  id: string;
  title: string;
  category: CalendarCategory;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  roundLabel?: string;
  cupMatchId?: string;
  fixtureId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeCrestUrl?: string;
  awayCrestUrl?: string;
  notes?: string;
  createdAt: string;
}

export type ClaimReasonType = 'juego_sucio' | 'gol_prohibido' | 'otro';
export type ClaimStatus = 'pending' | 'valid_match' | 'invalid_match' | 'dismissed';

export interface Claim {
  id: string;
  matchId?: string;
  reporterTeamId: string;
  reporterName: string;
  accusedTeamId?: string;
  accusedTeamName?: string;
  reasonType: ClaimReasonType;
  description: string;
  cardPhotoUrl?: string;
  cardPhotoStatus?: ModerationStatus;
  videoUrl?: string;
  status: ClaimStatus;
  adminResolutionNote?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface GalleryVideo {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  downloadUrl: string;
  imagekitFileId?: string;
  originalFormat: 'MP4' | 'AVI';
  uploadedBy: string;
  featured?: boolean;
  createdAt: string;
}

export interface ChampionEntry {
  id: string;
  season: string;
  teamName: string;
  memberName: string;
  teamId?: string;
  tournamentType?: 'liga' | 'copa' | 'recopa';
  notes?: string;
  celebrationImageUrl: string;
  createdAt: string;
}

export interface GameModeSettings {
  partidos: string;
  tiempo: string;
  condicion: string;
  lesiones: string;
  cambios: string;
  pausas: string;
  clima: string;
}

export interface CupRulesSettings {
  format: string;
  extraTime: string;
  penalties: string;
  notes: string;
}

export interface RulesConfig {
  prohibitedRules: string[];
  generalNotes: string;
  gameMode: GameModeSettings;
  cupRules?: CupRulesSettings;
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl?: string;
  createdAt: string;
}

export interface CupParticipant {
  slot: number;
  teamId?: string;
  teamName: string;
  memberName: string;
  crestUrl: string;
}

export type CupRound = 'r16' | 'qf' | 'sf' | 'final';

export interface CupMatchNode {
  id: string;
  round: CupRound;
  matchIndex: number;
  homeSlot: number | null;
  awaySlot: number | null;
  homeTeamName?: string;
  awayTeamName?: string;
  homeMemberName?: string;
  awayMemberName?: string;
  homeCrestUrl?: string;
  awayCrestUrl?: string;
  homeGoals: number | null;
  awayGoals: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  extraTime: boolean;
  winnerSlot: number | null;
  winnerName?: string;
  winnerMemberName?: string;
  winnerCrestUrl?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  played: boolean;
}

export interface RecopaState {
  enabled: boolean;
  leagueChampionName: string;
  leagueChampionMember: string;
  leagueChampionCrestUrl: string;
  cupChampionName: string;
  cupChampionMember: string;
  cupChampionCrestUrl: string;
  leagueGoals: number | null;
  cupGoals: number | null;
  leaguePenalties: number | null;
  cupPenalties: number | null;
  extraTime: boolean;
  grandChampionName: string;
  grandChampionMember: string;
  grandChampionCrestUrl: string;
  grandChampionSide: 'league' | 'cup' | null;
  greeting?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  played: boolean;
}

export interface CupTournament {
  editionNumber: number;
  editionName: string;
  status: 'in_progress' | 'finished';
  participants: CupParticipant[];
  matches: CupMatchNode[];
  championSlot: number | null;
  championTeamName: string;
  championMemberName: string;
  championCrestUrl: string;
  championGreeting: string;
  recopa: RecopaState;
  updatedAt: string;
}

export interface StandingRow {
  position: number;
  team: PublicTeam;
  pj: number;
  pg: number;
  pe: number;
  pp: number;
  gf: number;
  gc: number;
  dg: number;
  pts: number;
}

export interface AuthUser {
  role: 'admin' | 'member';
  id: string;
  displayName: string;
  teamId?: string;
}

export interface NewsPost {
  id: string;
  title: string;
  content: string;
  textColor: string;
  imageUrl?: string;
  videoUrl?: string;
  likes?: number;
  isChampionNewspaper?: boolean;
  championTeamName?: string;
  championMemberName?: string;
  championCrestUrl?: string;
  championTournament?: string;
  championSeason?: string;
  celebrationImageUrl?: string;
  sourceKey?: string;
  createdAt: string;
}

export interface TopGoalItem {
  id: string;
  rank: number;
  title: string;
  scorerName?: string;
  author?: string;
  videoUrl: string;
  sourceVideoId?: string;
  createdAt: string;
}

export interface LeagueComment {
  id: string;
  authorName: string;
  authorTeamName?: string;
  authorTeamId?: string;
  message: string;
  status: 'pending' | 'approved';
  createdAt: string;
}

export type CredentialAuditAction =
  | 'create_participant'
  | 'update_participant_id'
  | 'reset_participant_password'
  | 'block_participant'
  | 'activate_participant'
  | 'delete_participant'
  | 'update_admin_credentials'
  | 'admin_firebase_password_reset';

export interface CredentialAuditEntry {
  id: string;
  action: CredentialAuditAction;
  targetType: 'participant' | 'admin';
  targetId: string;
  targetLabel: string;
  details: string;
  performedBy: string;
  createdAt: string;
}

export interface LeagueBootstrap {
  settings: LeagueSettings;
  teams: PublicTeam[];
  adminTeams?: Team[];
  credentialAuditLog?: CredentialAuditEntry[];
  matches: Match[];
  fixtures: ScheduledFixture[];
  calendarEvents: CalendarEvent[];
  claims: Claim[];
  videos: GalleryVideo[];
  topGoals?: TopGoalItem[];
  champions: ChampionEntry[];
  rules: RulesConfig;
  music: MusicTrack[];
  cup: CupTournament;
  news?: NewsPost[];
  comments?: LeagueComment[];
  pageLikes?: number;
  user: AuthUser | null;
}
