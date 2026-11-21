import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Crown, Edit3, Plus, Search, Shield, Trash2, Trophy, Upload, X } from 'lucide-react';
import {
  awardLeagueChampionFirestore,
  createTeamFirestore,
  deleteTeamFirestore,
  saveSettingsFirestore,
  updateTeamFirestore,
} from '../services/firestoreLeague';
import type { AuthUser, LeagueSettings, PublicTeam, StandingRow } from '../types';
import { uploadMediaFile } from '../utils/api';
import { resolveAssetUrl } from '../utils/assetUrl';
import { getTitleText, sanitizeCustomTitles } from '../utils/customTitles';
import { ResilientImage } from './ResilientImage';

const LIGA_TROPHY_IMG = resolveAssetUrl('/assets/aistudio/Trofeo_Liga_Argentina_LMA.jpg');

interface StandingsViewProps {
  standings: StandingRow[];
  maxTeams: number;
  settings?: LeagueSettings;
  user: AuthUser | null;
  onOpenAuth: () => void;
  onRefresh: () => Promise<void>;
  onViewParticipant?: (teamId: string) => void;
}

function getNextSuggestedId(standings: StandingRow[]): string {
  const existing = new Set(standings.map((s) => s.team.id.toUpperCase()));
  for (let i = 1; i <= 99; i++) {
    const candidate = `LMA${String(i).padStart(2, '0')}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `EQ${standings.length + 1}`;
}

export function StandingsView({
  standings,
  maxTeams,
  settings,
  user,
  onOpenAuth,
  onRefresh,
  onViewParticipant,
}: StandingsViewProps) {
  const [query, setQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const suggestedId = useMemo(() => getNextSuggestedId(standings), [standings]);
  const [newId, setNewId] = useState(suggestedId);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newCrestFile, setNewCrestFile] = useState<File | null>(null);
  const [newCrestPreview, setNewCrestPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Quick edit row modal/panel for Admin
  const [editingTeam, setEditingTeam] = useState<PublicTeam | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editMemberName, setEditMemberName] = useState('');
  const [editCrestFile, setEditCrestFile] = useState<File | null>(null);
  const [editCrestPreview, setEditCrestPreview] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [crowningLeader, setCrowningLeader] = useState(false);

  // Quick inline editor for Season League Name & Standings Title (Admin)
  const [editingLeagueName, setEditingLeagueName] = useState(false);
  const [leagueNameDraft, setLeagueNameDraft] = useState(getTitleText(settings, 'compLigaName'));
  const [standingsTitleDraft, setStandingsTitleDraft] = useState(
    getTitleText(settings, 'standingsTitle')
  );
  const [savingLeagueName, setSavingLeagueName] = useState(false);
  const [uploadingTrophy, setUploadingTrophy] = useState(false);
  const ligaTrophyInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingLeagueName) {
      setLeagueNameDraft(getTitleText(settings, 'compLigaName'));
      setStandingsTitleDraft(getTitleText(settings, 'standingsTitle'));
    }
  }, [settings, editingLeagueName]);

  useEffect(() => {
    if (!showAddForm) {
      setNewId(suggestedId);
    }
  }, [suggestedId, showAddForm]);

  useEffect(() => {
    if (!newCrestFile) {
      setNewCrestPreview(null);
      return;
    }
    const url = URL.createObjectURL(newCrestFile);
    setNewCrestPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [newCrestFile]);

  useEffect(() => {
    if (!editCrestFile) {
      setEditCrestPreview(null);
      return;
    }
    const url = URL.createObjectURL(editCrestFile);
    setEditCrestPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [editCrestFile]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return standings;
    return standings.filter(
      (row) =>
        row.team.name.toLowerCase().includes(q) ||
        row.team.memberName.toLowerCase().includes(q) ||
        row.team.id.toLowerCase().includes(q)
    );
  }, [standings, query]);

  const isAdmin = user?.role === 'admin';

  const handleAddTeam = async (e: FormEvent) => {
    e.preventDefault();
    setFormMsg(null);
    setSaving(true);
    try {
      const crestUrl = newCrestFile ? await uploadMediaFile('crests', newCrestFile) : undefined;
      const created = await createTeamFirestore({
        id: newId.trim() || suggestedId,
        name: newTeamName.trim() || newMemberName.trim(),
        memberName: newMemberName.trim(),
        crestUrl,
        linkedEmail: newMemberEmail.trim() || undefined,
      });
      setNewTeamName('');
      setNewMemberName('');
      setNewMemberEmail('');
      setNewCrestFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await onRefresh();
      setFormMsg({
        type: 'ok',
        text: `Participante "${created.memberName}" (${created.name} · ID: ${created.id}) creado y publicado en la Tabla de Posiciones.`,
      });
    } catch (err) {
      setFormMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo publicar el equipo.',
      });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (team: PublicTeam) => {
    setEditingTeam(team);
    setEditTeamName(team.name);
    setEditMemberName(team.memberName);
    setEditCrestFile(null);
    setFormMsg(null);
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTeam) return;
    setSavingEdit(true);
    setFormMsg(null);
    try {
      const crestUrl = editCrestFile ? await uploadMediaFile('crests', editCrestFile) : undefined;
      await updateTeamFirestore(editingTeam.id, {
        name: editTeamName.trim(),
        memberName: editMemberName.trim(),
        ...(crestUrl ? { crestUrl } : {}),
      });
      setEditingTeam(null);
      setEditCrestFile(null);
      await onRefresh();
      setFormMsg({
        type: 'ok',
        text: 'Datos y escudo del equipo actualizados en la tabla.',
      });
    } catch (err) {
      setFormMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error al actualizar el equipo.',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteTeam = async (team: PublicTeam) => {
    try {
      await deleteTeamFirestore(team.id);
      await onRefresh();
    } catch (err) {
      setFormMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo eliminar el equipo.',
      });
    }
  };

  const effectiveMaxTeams = maxTeams > 50 ? maxTeams : 100;
  const activeLigaName = getTitleText(settings, 'compLigaName');
  const activeLigaTrophyImg = resolveAssetUrl(settings?.ligaTrophyUrl || LIGA_TROPHY_IMG);
  const leaderRow = standings[0];

  const handleCrownLeagueChampion = async () => {
    if (!leaderRow || crowningLeader) return;
    setCrowningLeader(true);
    setFormMsg(null);
    try {
      await awardLeagueChampionFirestore({
        team: leaderRow.team,
        season: activeLigaName,
        trophyImageUrl: settings?.ligaTrophyUrl || undefined,
      });
      await onRefresh();
      setFormMsg({
        type: 'ok',
        text: `¡${leaderRow.team.name} (${leaderRow.team.memberName}) fue coronado Campeón de ${activeLigaName}! El trofeo oficial se cargó automáticamente en su perfil.`,
      });
    } catch (err) {
      setFormMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo coronar al Campeón de Liga.',
      });
    } finally {
      setCrowningLeader(false);
    }
  };

  const handleSaveLeagueName = async (e: FormEvent) => {
    e.preventDefault();
    const cleanLiga = leagueNameDraft.trim();
    const cleanTitle = standingsTitleDraft.trim();
    if (!cleanLiga || !cleanTitle) return;
    setSavingLeagueName(true);
    setFormMsg(null);
    try {
      await saveSettingsFirestore({
        customTitles: sanitizeCustomTitles({
          ...(settings?.customTitles || {}),
          compLigaName: cleanLiga,
          standingsTitle: cleanTitle,
        }),
      });
      setEditingLeagueName(false);
      await onRefresh();
      setFormMsg({
        type: 'ok',
        text: `Nombre de la liga actualizado a "${cleanLiga}" en tiempo real para todos los miembros.`,
      });
    } catch (err) {
      setFormMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo guardar el nombre de la liga.',
      });
    } finally {
      setSavingLeagueName(false);
    }
  };

  const handleUploadLigaTrophy = async (file: File | null) => {
    if (!file) return;
    setUploadingTrophy(true);
    setFormMsg(null);
    try {
      const url = await uploadMediaFile('site', file);
      await saveSettingsFirestore({ ligaTrophyUrl: url });
      await onRefresh();
      setFormMsg({
        type: 'ok',
        text: 'Foto oficial del Trofeo de Liga actualizada en Cloud Firestore para todos.',
      });
    } catch (err) {
      setFormMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo cambiar la foto del trofeo.',
      });
    } finally {
      setUploadingTrophy(false);
      if (ligaTrophyInputRef.current) ligaTrophyInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Trofeo Oficial de la Liga arriba de la Tabla de Posiciones */}
      <section className="relative overflow-hidden rounded-2xl border-2 border-amber-400/65 bg-gradient-to-r from-[#070B12]/96 via-[#0C1D36]/96 to-[#070B12]/96 shadow-[0_18px_45px_rgba(0,0,0,0.85)]">
        <div className="h-1.5 w-full albiceleste-ribbon" aria-hidden="true" />
        <div className="p-5 sm:p-6 flex flex-col md:flex-row items-center gap-6">
          <div className="relative shrink-0 flex flex-col items-center gap-2">
            <div className="relative">
              <div className="w-32 h-40 sm:w-36 sm:h-44 rounded-2xl overflow-hidden border-2 border-amber-400/80 shadow-[0_0_28px_rgba(250,204,21,0.38)] bg-[#04080F] p-1">
                <ResilientImage
                  src={activeLigaTrophyImg}
                  alt={`Trofeo Oficial ${activeLigaName}`}
                  className="w-full h-full object-contain object-center"
                  fallbackLabel="LMA"
                />
              </div>
              <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-md bg-amber-400 text-[#07090D] font-mono text-[10px] font-extrabold uppercase tracking-wider shadow-lg whitespace-nowrap">
                Trofeo Oficial
              </div>
            </div>
            {isAdmin && (
              <label className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/45 rounded-lg cursor-pointer transition-colors">
                <Upload className="w-3 h-3" />
                <span>{uploadingTrophy ? 'Subiendo...' : 'Cambiar foto'}</span>
                <input
                  ref={ligaTrophyInputRef}
                  type="file"
                  accept="image/*"
                  disabled={uploadingTrophy}
                  onChange={(e) => void handleUploadLigaTrophy(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            )}
          </div>

          <div className="flex-1 text-center md:text-left space-y-2 min-w-0">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 uppercase tracking-wider">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>{getTitleText(settings, 'standingsBadge')}</span>
            </div>

            {editingLeagueName && isAdmin ? (
              <form
                onSubmit={handleSaveLeagueName}
                className="p-3.5 rounded-xl bg-[#041224]/95 border border-amber-400/60 space-y-2.5 text-left max-w-xl"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-amber-200 mb-1">
                      Nombre de la Liga (Temporada Actual)
                    </label>
                    <input
                      type="text"
                      required
                      value={leagueNameDraft}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLeagueNameDraft(val);
                        setStandingsTitleDraft(`Tabla de Posiciones · ${val}`);
                      }}
                      placeholder="Ej: Liga Inglesa / Liga Argentina"
                      className="w-full px-3 py-1.5 text-xs bg-[#071D38] text-white border border-amber-400/50 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-sky-200 mb-1">
                      Título de Encabezado en Posiciones
                    </label>
                    <input
                      type="text"
                      required
                      value={standingsTitleDraft}
                      onChange={(e) => setStandingsTitleDraft(e.target.value)}
                      placeholder="Tabla de Posiciones · ..."
                      className="w-full px-3 py-1.5 text-xs bg-[#071D38] text-white border border-amber-400/50 rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingLeagueName(false)}
                    className="px-3 py-1 text-xs font-semibold text-sky-200 bg-[#0A294E] hover:bg-[#0D3464] rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingLeagueName}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold btn-gold-luxury rounded-lg disabled:opacity-60"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{savingLeagueName ? 'Guardando...' : 'Guardar Nombre'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5">
                <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-lma-brand">
                  {getTitleText(settings, 'standingsTitle')}
                </h1>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setEditingLeagueName(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-amber-200 bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/50 rounded-lg transition-colors"
                    title="Editar nombre de la liga esta temporada"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Editar liga</span>
                  </button>
                )}
              </div>
            )}

            <p className="text-xs sm:text-sm text-sky-100/85 max-w-2xl">
              {standings.length} de {effectiveMaxTeams} clubes en competencia · Del 1° al 16° clasifican a la {getTitleText(settings, 'compCopaName')} · Quien salga Campeón recibe automáticamente el Trofeo de {activeLigaName} en su perfil.
            </p>

            {leaderRow && (
              <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
                <button
                  type="button"
                  onClick={() => onViewParticipant?.(leaderRow.team.id)}
                  className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/60 transition-colors"
                >
                  <Crown className="w-4 h-4 text-amber-300 shrink-0" />
                  <ResilientImage
                    src={leaderRow.team.crestUrl}
                    alt={leaderRow.team.name}
                    className="w-7 h-7 rounded-md object-contain bg-[#041224] p-0.5 shrink-0"
                    fallbackLabel={leaderRow.team.id}
                  />
                  <div className="text-left">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-amber-300">
                      Puntero Actual (#1)
                    </div>
                    <div className="text-xs font-bold text-white">
                      {leaderRow.team.name} ·{' '}
                      <span className="font-mono text-amber-200">{leaderRow.pts} PTS</span>
                    </div>
                  </div>
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    disabled={crowningLeader}
                    onClick={handleCrownLeagueChampion}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold btn-gold-luxury rounded-xl disabled:opacity-60"
                    title={`Otorgar automáticamente el Trofeo Oficial de ${activeLigaName} al #1 de la tabla`}
                  >
                    <Trophy className="w-3.5 h-3.5" />
                    <span>
                      {crowningLeader
                        ? 'Coronando...'
                        : `Coronar Campeón de Liga (${leaderRow.team.name})`}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="text-xs text-sky-200/85">
          Tocá cualquier equipo para abrir el perfil público del participante, ver sus trofeos ganados y dejarle un Me Gusta.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin ? (
            <button
              type="button"
              onClick={() => {
                setShowAddForm((v) => !v);
                setFormMsg(null);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs btn-gold-luxury rounded-xl whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{showAddForm ? 'Ocultar formulario' : 'Agregar Miembro y Equipo'}</span>
            </button>
          ) : (
            !user && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs btn-celeste-gold rounded-xl transition-all whitespace-nowrap"
              >
                <Shield className="w-3.5 h-3.5 text-amber-300" />
                <span>Admin: Agregar Equipos</span>
              </button>
            )
          )}

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-sky-300 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar equipo o miembro..."
              className="w-full pl-10 pr-4 py-2 text-sm bg-[#071D38] text-white border border-amber-400/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-sky-200/50"
            />
          </div>
        </div>
      </div>

      {formMsg && (
        <div
          className={`p-3.5 text-sm rounded-xl border ${
            formMsg.type === 'ok'
              ? 'bg-emerald-950/70 border-emerald-400/40 text-emerald-200'
              : 'bg-rose-950/70 border-rose-400/40 text-rose-200'
          }`}
        >
          {formMsg.text}
        </div>
      )}

      {/* Formulario directo para Admin: Agregar miembro + equipo + escudo PNG 128x128 y publicar en la tabla */}
      {isAdmin && showAddForm && (
        <form
          onSubmit={handleAddTeam}
          className="p-6 bg-[#071D38]/95 border-2 border-amber-400/60 rounded-2xl space-y-4 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
                Agregar Miembro y Publicar Equipo en la Tabla ({standings.length}/{effectiveMaxTeams})
              </h2>
              <p className="text-xs text-sky-200/80">
                Subí el escudo PNG (se ajusta automáticamente a 128x128), completá equipo y miembro, y publicalo al instante.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-sky-200 hover:text-amber-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
            <div className="lg:col-span-3">
              <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                Nombre del Equipo (opcional)
              </label>
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Ej: Rosario Central"
                className="w-full px-3 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>

            <div className="lg:col-span-3">
              <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                Nombre del Miembro
              </label>
              <input
                type="text"
                required
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Ej: Canalla_10"
                className="w-full px-3 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>

            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                ID de acceso (auto)
              </label>
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="Auto (Ej: LMA11)"
                className="w-full px-3 py-2 text-sm font-mono bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>

            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                Correo Google (invitación)
              </label>
              <input
                type="email"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                placeholder="opcional@gmail.com"
                className="w-full px-3 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>

            <div className="lg:col-span-2 flex items-center gap-3">
              {newCrestPreview && (
                <img
                  src={newCrestPreview}
                  alt="Vista previa escudo 128x128"
                  className="w-10 h-10 rounded-lg object-contain bg-[#041224] border border-amber-400/55 p-0.5 shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                  Escudo (128x128)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewCrestFile(e.target.files?.[0] || null)}
                  className="w-full text-[11px] text-zinc-300 file:mr-2 file:py-1.5 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-400/20 file:text-amber-300 hover:file:bg-amber-400/30"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={saving || standings.length >= effectiveMaxTeams}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm btn-gold-luxury disabled:opacity-50 rounded-xl"
            >
              <Upload className="w-4 h-4" />
              <span>{saving ? 'Publicando...' : 'Agregar y Publicar en la Tabla'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Edición rápida para Admin desde la tabla */}
      {isAdmin && editingTeam && (
        <form
          onSubmit={handleSaveEdit}
          className="p-5 bg-[#071D38]/95 border-2 border-amber-400/60 rounded-2xl space-y-4 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xl font-bold text-albiceleste-shiny">
              Editando en Tabla: {editingTeam.name} ({editingTeam.id})
            </h3>
            <button
              type="button"
              onClick={() => setEditingTeam(null)}
              className="text-sky-200 hover:text-amber-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                Nombre del Equipo
              </label>
              <input
                type="text"
                required
                value={editTeamName}
                onChange={(e) => setEditTeamName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                Nombre del Miembro
              </label>
              <input
                type="text"
                required
                value={editMemberName}
                onChange={(e) => setEditMemberName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#041224] text-white border border-amber-400/40 rounded-lg"
              />
            </div>
            <div className="flex items-center gap-3">
              <ResilientImage
                src={editCrestPreview || editingTeam.crestUrl}
                alt={editingTeam.name}
                className="w-10 h-10 rounded-lg object-contain bg-[#041224] border border-amber-400/45 p-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <label className="block text-xs font-semibold text-amber-200/90 mb-1">
                  Escudo (128x128)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setEditCrestFile(e.target.files?.[0] || null)}
                  className="w-full text-[11px] text-sky-100 file:mr-2 file:py-1.5 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-400/20 file:text-amber-300"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingTeam(null)}
              className="px-4 py-2 text-xs font-semibold text-sky-100 bg-[#0A294E] border border-amber-400/35 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingEdit}
              className="px-5 py-2 text-xs btn-gold-luxury rounded-lg"
            >
              {savingEdit ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-[#071D38]/95 border-2 border-amber-400/55 rounded-2xl overflow-hidden shadow-xl shadow-black/50">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-amber-400/35 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A] text-sky-100 text-xs font-semibold">
                <th className="py-3.5 pl-5 pr-2 text-left w-12">Pos</th>
                <th className="py-3.5 px-3 text-left">Equipo</th>
                <th className="py-3.5 px-3 text-left hidden sm:table-cell">Miembro / DT</th>
                <th className="py-3.5 px-2.5 text-right">PJ</th>
                <th className="py-3.5 px-2.5 text-right">PG</th>
                <th className="py-3.5 px-2.5 text-right">PE</th>
                <th className="py-3.5 px-2.5 text-right">PP</th>
                <th className="py-3.5 px-2.5 text-right hidden md:table-cell">GF</th>
                <th className="py-3.5 px-2.5 text-right hidden md:table-cell">GC</th>
                <th className="py-3.5 px-2.5 text-right">DG</th>
                <th className="py-3.5 pl-2.5 pr-5 text-right text-amber-300">PTS</th>
                {isAdmin && <th className="py-3.5 pl-2 pr-5 text-right">Admin</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-400/15">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 12 : 11} className="py-12 text-center text-sm text-sky-200/80">
                    No se encontraron equipos que coincidan con &ldquo;{query}&rdquo;.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const isChampionSpot = row.position === 1;
                  const isCupSpot = row.position >= 1 && row.position <= 16;
                  const isLowerSpot =
                    standings.length > 16 &&
                    row.position > 16 &&
                    row.position >= standings.length - 1;
                  const isCupCutoff = row.position === 16 && standings.length > 16;

                  let rowBg = 'hover:bg-amber-400/[0.04]';
                  let zoneText = '';
                  let zoneTextColor = 'text-zinc-400';
                  let posColor = 'text-zinc-300';
                  if (isChampionSpot) {
                    rowBg = 'bg-amber-400/[0.09] hover:bg-amber-400/[0.13]';
                    zoneText = 'Líder · Copa';
                    zoneTextColor = 'text-amber-300';
                    posColor = 'text-amber-300';
                  } else if (isCupSpot) {
                    rowBg = 'bg-emerald-500/[0.05] hover:bg-emerald-500/[0.09]';
                    zoneText = 'Copa';
                    zoneTextColor = 'text-emerald-400/90';
                    posColor = 'text-emerald-400';
                  } else if (isLowerSpot) {
                    rowBg = 'bg-rose-500/[0.06] hover:bg-rose-500/[0.10]';
                    zoneText = 'Descenso';
                    zoneTextColor = 'text-rose-400/90';
                    posColor = 'text-rose-400';
                  }

                  return (
                    <tr
                      key={row.team.id}
                      className={`transition-colors ${rowBg} ${
                        isCupCutoff ? 'border-b-2 border-emerald-400/60' : ''
                      }`}
                    >
                      <td className={`py-3 pl-5 pr-2 font-mono text-xs font-bold tabular-nums ${posColor}`}>
                        <div className="flex flex-col">
                          <span>{row.position}</span>
                          {zoneText && (
                            <span
                              className={`text-[10px] font-sans font-semibold whitespace-nowrap ${zoneTextColor}`}
                            >
                              {zoneText}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => onViewParticipant?.(row.team.id)}
                          title={`Ver perfil público de ${row.team.name}`}
                          className="flex items-center gap-3 min-w-0 text-left group w-full"
                        >
                          <ResilientImage
                            src={row.team.crestUrl}
                            alt={`Escudo ${row.team.name}`}
                            className="w-9 h-9 rounded-lg object-contain bg-[#041224] border border-amber-400/40 p-0.5 shrink-0"
                            fallbackLabel={row.team.id}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-white group-hover:text-amber-300 transition-colors truncate flex items-center gap-1.5">
                              <span className="truncate">{row.team.name}</span>
                              {(row.team.trophies?.length || 0) > 0 && (
                                <span
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-400/20 border border-amber-400/50 text-[10px] font-mono font-bold text-amber-300 shrink-0"
                                  title={`${row.team.trophies?.length} trofeo(s) ganado(s)`}
                                >
                                  <Trophy className="w-2.5 h-2.5" />
                                  {row.team.trophies?.length}
                                </span>
                              )}
                              {user?.teamId === row.team.id && (
                                <span className="text-[11px] font-semibold text-amber-300 shrink-0">
                                  · Tu equipo
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-sky-200/75 sm:hidden truncate">
                              {row.team.memberName}
                            </div>
                          </div>
                        </button>
                      </td>
                      <td className="py-3 px-3 text-sky-100/90 hidden sm:table-cell">
                        <div className="truncate max-w-[180px]">{row.team.memberName}</div>
                        <div className="text-[11px] font-mono text-sky-300/70">{row.team.id}</div>
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono tabular-nums text-sky-100/85">
                        {row.pj}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono tabular-nums text-emerald-400 font-medium">
                        {row.pg}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono tabular-nums text-sky-200/80">
                        {row.pe}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono tabular-nums text-rose-400">
                        {row.pp}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono tabular-nums text-sky-200/80 hidden md:table-cell">
                        {row.gf}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono tabular-nums text-sky-200/80 hidden md:table-cell">
                        {row.gc}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono tabular-nums text-white font-medium">
                        {row.dg > 0 ? `+${row.dg}` : row.dg}
                      </td>
                      <td className="py-3 pl-2.5 pr-5 text-right font-mono text-base font-extrabold tabular-nums text-amber-300">
                        {row.pts}
                      </td>
                      {isAdmin && (
                        <td className="py-3 pl-2 pr-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(row.team)}
                              aria-label={`Editar ${row.team.name}`}
                              className="p-1.5 text-amber-200 hover:text-white bg-[#0A294E] hover:bg-[#0D3666] border border-amber-400/40 rounded-lg transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTeam(row.team)}
                              aria-label={`Eliminar ${row.team.name}`}
                              className="p-1.5 text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 text-xs text-sky-100/85 px-1">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-amber-400/30 border border-amber-300 inline-block" />
          <span>1° Puesto: Campeón de Liga (Entra a Copa)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-400 inline-block" />
          <span>1° a 16° Puesto: Clasificación a Copa</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-rose-500/30 border border-rose-400 inline-block" />
          <span>Últimos 2 puestos (fuera del Top 16): Zona de Descenso / Promoción</span>
        </div>
      </div>
    </div>
  );
}
