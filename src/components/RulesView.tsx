import { AlertTriangle, Gamepad2, ShieldCheck, Trophy } from 'lucide-react';
import type { RulesConfig } from '../types';

interface RulesViewProps {
  rules: RulesConfig;
}

export function RulesView({ rules }: RulesViewProps) {
  const gameModeItems = [
    { label: 'Partidos', value: rules.gameMode.partidos },
    { label: 'Tiempo', value: rules.gameMode.tiempo },
    { label: 'Condición', value: rules.gameMode.condicion },
    { label: 'Lesiones', value: rules.gameMode.lesiones },
    { label: 'Cambios', value: rules.gameMode.cambios },
    { label: 'Pausas', value: rules.gameMode.pausas },
    { label: 'Clima', value: rules.gameMode.clima },
  ];

  const cupRules = rules.cupRules || {
    format: 'Eliminación directa (16 equipos)',
    extraTime: 'Sí (Tiempo Extra)',
    penalties: 'Sí (Definición por Penales)',
    notes:
      'Se aplican las mismas reglas básicas de la Liga (prohibido gol de pase al ras en el área, hacer tiempo con el arquero o faltar el respeto al rival), pero todos los partidos de Copa se juegan a eliminación directa con Tiempo Extra y Penales.',
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-albiceleste-shiny">
          Reglamento y Modo de Juego
        </h1>
        <p className="mt-1 text-sm text-sky-200/80">
          Normativa oficial de competencia y configuración obligatoria de sala en Pro Evolution Soccer 6.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <section className="lg:col-span-7 bg-[#071D38]/95 border-2 border-amber-400/50 rounded-2xl overflow-hidden shadow-xl shadow-black/50">
          <div className="px-6 py-4 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A] text-white flex items-center gap-2.5 border-b border-amber-400/40">
            <AlertTriangle className="w-5 h-5 text-amber-300" />
            <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
              Reglas de la Liga (Conductas Prohibidas)
            </h2>
          </div>

          <div className="p-6 space-y-4">
            <p className="text-sm text-sky-100">
              Está estrictamente prohibido dentro de cualquier partido oficial de la Liga Master Argentina PES6:
            </p>

            <ol className="divide-y divide-sky-400/15 border border-amber-400/40 rounded-xl overflow-hidden">
              {rules.prohibitedRules.map((rule, idx) => (
                <li key={`${idx}-${rule}`} className="px-5 py-4 flex items-start gap-4 bg-[#05162B]">
                  <span className="font-mono text-sm font-bold text-amber-300 tabular-nums shrink-0 mt-0.5">
                    0{idx + 1}.
                  </span>
                  <span className="text-base font-medium text-white leading-relaxed">
                    {rule}
                  </span>
                </li>
              ))}
            </ol>

            {rules.generalNotes && (
              <div className="p-4 bg-[#08284D] border border-amber-400/45 rounded-xl flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                <p className="text-sm text-sky-100 leading-relaxed">{rules.generalNotes}</p>
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-5 bg-[#071D38]/95 border-2 border-amber-400/55 rounded-2xl overflow-hidden shadow-xl shadow-black/50">
          <div className="px-6 py-4 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A] text-white flex items-center gap-2.5 border-b border-amber-400/40">
            <Gamepad2 className="w-5 h-5 text-amber-300" />
            <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">Modo de Juego PES6</h2>
          </div>

          <div className="divide-y divide-sky-400/15">
            {gameModeItems.map((item) => (
              <div
                key={item.label}
                className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-sky-400/[0.07] transition-colors"
              >
                <span className="text-sm font-semibold text-sky-100">{item.label}</span>
                <span className="text-sm font-bold text-amber-300 font-mono">{item.value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Reglamento de la Copa de la Liga y Recopa */}
      <section className="bg-[#071D38]/95 border-2 border-amber-400/55 rounded-2xl overflow-hidden shadow-xl shadow-black/50">
        <div className="px-6 py-4 bg-gradient-to-r from-[#08264A] via-[#0D3C70] to-[#08264A] text-white flex items-center gap-2.5 border-b border-amber-400/40">
          <Trophy className="w-5 h-5 text-amber-300" />
          <h2 className="font-display text-2xl font-bold text-albiceleste-shiny">
            Reglas de la Copa de la Liga y Recopa
          </h2>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-3">
            <p className="text-sm text-sky-100 leading-relaxed">{cupRules.notes}</p>
            <div className="text-xs text-sky-200/80">
              Fases de la Copa: 8° Octavos de Final (16 equipos) → 4° Cuartos de Final (8 equipos) → Semifinales (4 equipos) → Final de Copa → Final de Recopa (Campeón de Liga vs Campeón de Copa) por el título de Gran Campeón de la Liga Master Argentina.
            </div>
          </div>

          <div className="lg:col-span-5 divide-y divide-sky-400/15 border border-amber-400/40 rounded-xl overflow-hidden bg-[#05162B]">
            <div className="px-4 py-3 flex items-center justify-between gap-4">
              <span className="text-xs font-semibold text-sky-100">Formato de Copa</span>
              <span className="text-xs font-bold text-amber-300">{cupRules.format}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between gap-4">
              <span className="text-xs font-semibold text-sky-100">Tiempo Extra</span>
              <span className="text-xs font-bold text-emerald-300">{cupRules.extraTime}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between gap-4">
              <span className="text-xs font-semibold text-sky-100">Penales</span>
              <span className="text-xs font-bold text-amber-200">{cupRules.penalties}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between gap-4">
              <span className="text-xs font-semibold text-sky-100">Reglas Básicas</span>
              <span className="text-xs font-bold text-white">Mismas que la Liga</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
