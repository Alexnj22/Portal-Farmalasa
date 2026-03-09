import React from 'react';
import { FileText, XCircle, CheckCircle2 } from 'lucide-react';

const EARLY_EXIT_OPTIONS = [
  'Permiso Médico / Consulta',
  'Permiso Personal',
  'Gestión Laboral Externa',
  'Omisión de Almuerzo',
  'Otro Motivo',
];

function EarlyExitForm({
  earlyExitData,
  exitReason,
  onChangeReason,
  exitNotes,
  onChangeNotes,
  onSubmit,
  onCancel,
  isProcessing = false,
}) {
  const employee = earlyExitData?.employee || earlyExitData;

  if (!employee) return null;

  // 🚨 HOMOLOGADO: Extrae la foto sea como photo_url (Supabase) o photo local
  const photoUrl = employee?.photo_url || employee?.photo;

  return (
    <div className="relative z-20 w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-500 pointer-events-auto overflow-hidden">
      
      <div className="w-full max-w-[420px] max-h-full flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] p-5 sm:p-7 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] overflow-hidden transition-all duration-500 hover:scale-[1.01] hover:-translate-y-1 hover:bg-white/[0.04] hover:shadow-[0_30px_60px_rgba(0,0,0,0.4),inset_0_2px_15px_rgba(255,255,255,0.05)] hover:border-white/20">
        
        <div className="flex flex-col items-center text-center w-full mb-4 sm:mb-5 shrink-0 group/icon">
          <div className="inline-flex p-3 sm:p-4 rounded-[1.5rem] mb-2.5 sm:mb-3 transition-all duration-300 border backdrop-blur-md bg-orange-500/10 border-orange-500/40 shadow-[0_0_40px_rgba(249,115,22,0.15)] group-hover/icon:scale-105 group-hover/icon:-translate-y-1 group-hover/icon:shadow-[0_0_50px_rgba(249,115,22,0.3)]">
            <FileText size={36} className="text-orange-400 drop-shadow-[0_2px_10px_rgba(249,115,22,0.8)] sm:w-10 sm:h-10" strokeWidth={1.5} />
          </div>

          <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight mb-1 transition-colors">
            Solicitud de Permiso
          </h1>
          <p className="text-[9px] sm:text-xs font-bold uppercase tracking-[0.25em] text-orange-400/80 transition-colors px-2">
            Registrar salida anticipada
          </p>
        </div>

        <form onSubmit={onSubmit} className="relative z-20 w-full flex-1 flex flex-col justify-start min-h-0 shrink-0 gap-3 sm:gap-4 overflow-y-auto scrollbar-hide py-1">
          
          <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-2.5 shadow-[inset_0_2px_10px_rgba(255,255,255,0.02)] shrink-0">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-black/40 border border-orange-500/40 overflow-hidden flex items-center justify-center text-base sm:text-lg font-bold text-white shadow-[0_0_15px_rgba(249,115,22,0.15)] shrink-0">
              {/* 🚨 Implementado el photoUrl correcto aquí */}
              {photoUrl ? (
                <img src={photoUrl} alt={employee.name} className="w-full h-full object-cover" />
              ) : (
                employee.name?.charAt(0) || '?'
              )}
            </div>
            <div className="text-left flex-1 overflow-hidden">
              <h3 className="text-white font-semibold text-sm sm:text-base leading-tight truncate">{employee.name}</h3>
              <p className="text-white/40 text-[8px] sm:text-[9px] uppercase tracking-widest mt-0.5 truncate">
                Perfil a autorizar
              </p>
            </div>
          </div>

<div className="flex flex-col gap-1 sm:gap-1.5 shrink-0">
  <label className="text-white/50 text-[8px] sm:text-[9px] font-semibold uppercase tracking-widest ml-2">
    Motivo autorizado
  </label>
  <select
    className="w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white rounded-2xl p-3 sm:p-3.5 outline-none focus:bg-black/40 focus:border-orange-500/50 transition-all font-medium text-sm sm:text-base appearance-none shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)] cursor-pointer"
    value={exitReason}
    onChange={(e) => onChangeReason?.(e.target.value)}
    required
    disabled={isProcessing}
    style={{ colorScheme: 'dark' }}
  >
    <option value="" disabled className="bg-slate-900 text-slate-400">
      Seleccione un motivo...
    </option>
    {EARLY_EXIT_OPTIONS.map((option) => (
      <option key={option} value={option} className="bg-slate-900 text-white">
        {option}
      </option>
    ))}
  </select>

  {/* 🚨 NUEVO: Feedback visual preventivo */}
  {exitReason === 'Omisión de Almuerzo' && (
    <div className="mt-1 px-2 animate-in slide-in-from-top-1 duration-300">
      <p className="text-[10px] text-orange-400/80 leading-tight italic">
        * Requiere autorización previa. Solo válido 60 min antes de la salida.
      </p>
    </div>
  )}
</div>

          <div className="flex flex-col gap-1 sm:gap-1.5 shrink-0">
            <label className="text-white/50 text-[8px] sm:text-[9px] font-semibold uppercase tracking-widest ml-2">
              Justificación (Opcional)
            </label>
            <textarea
              className="w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white rounded-2xl p-3 sm:p-3.5 outline-none focus:bg-black/40 focus:border-orange-500/50 transition-all font-medium text-sm sm:text-base resize-none h-16 sm:h-20 shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)] placeholder:text-white/20"
              placeholder="Detalle brevemente el motivo..."
              value={exitNotes}
              onChange={(e) => onChangeNotes?.(e.target.value)}
              disabled={isProcessing}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 mt-1 sm:mt-2 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              className="flex-1 relative z-20 text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-red-400 flex items-center justify-center gap-2 transition-all duration-300 bg-red-500/10 py-3 sm:py-3.5 rounded-full border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              <XCircle size={14} /> Cancelar
            </button>

            <button
              type="submit"
              disabled={isProcessing}
              className="flex-1 relative z-20 text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-orange-400 flex items-center justify-center gap-2 transition-all duration-300 bg-orange-500/15 py-3 sm:py-3.5 rounded-full border border-orange-500/30 hover:bg-orange-500/25 hover:border-orange-500/50 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              {isProcessing ? (
                <span className="w-3.5 h-3.5 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              {isProcessing ? 'Guardando...' : 'Guardar Salida'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

export { EarlyExitForm };
export default EarlyExitForm;