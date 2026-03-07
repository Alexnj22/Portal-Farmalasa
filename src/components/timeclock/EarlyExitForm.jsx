import React from 'react';
import { FileText } from 'lucide-react';

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
  // Extraemos el empleado de earlyExitData de forma segura
  const employee = earlyExitData?.employee || earlyExitData;

  if (!employee) return null;

  return (
    <div className="w-full animate-in fade-in duration-300">
      <div className="inline-flex p-5 bg-orange-600 rounded-full mb-6 shadow-[0_0_40px_rgba(234,88,12,0.4)] animate-bounce">
        <FileText size={64} className="text-white" />
      </div>

      <h1 className="text-4xl md:text-5xl font-black text-white mb-3 tracking-tighter">
        Solicitud de Permiso
      </h1>
      <p className="text-orange-400 text-sm md:text-lg mb-10 font-black uppercase tracking-[0.2em]">
        Registrar salida anticipada
      </p>

      <div className="animate-in fade-in zoom-in duration-300 w-full max-w-lg mx-auto bg-[#111827] border border-[#1F2937] p-8 rounded-[2rem] shadow-2xl">
        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="h-16 w-16 rounded-full bg-slate-800 border-2 border-orange-500 overflow-hidden flex items-center justify-center text-xl font-bold text-white">
            {employee.photo ? (
              <img src={employee.photo} alt={employee.name} className="w-full h-full object-cover" />
            ) : (
              employee.name?.charAt(0) || '?'
            )}
          </div>

          <div className="text-left">
            <h3 className="text-white font-black text-xl leading-none">{employee.name}</h3>
            <p className="text-orange-400 text-xs font-bold uppercase tracking-widest">
              Registro de permiso
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 text-left">
          <div>
            <label className="block text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">
              Motivo autorizado
            </label>
            <select
              className="w-full bg-[#1F2937] border border-slate-700 text-white rounded-xl p-4 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all font-medium"
              value={exitReason}
              onChange={(e) => onChangeReason?.(e.target.value)}
              required
              disabled={isProcessing}
            >
              <option value="" disabled>
                Seleccione una opción...
              </option>
              {EARLY_EXIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">
              Justificación (Opcional)
            </label>
            <textarea
              className="w-full bg-[#1F2937] border border-slate-700 text-white rounded-xl p-4 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all font-medium resize-none h-24"
              placeholder="Detalle brevemente el motivo..."
              value={exitNotes}
              onChange={(e) => onChangeNotes?.(e.target.value)}
              disabled={isProcessing}
            />
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              className="flex-1 py-4 rounded-xl font-bold text-slate-400 hover:bg-white/5 transition-colors uppercase text-sm tracking-widest disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isProcessing}
              className="flex-1 py-4 rounded-xl font-black text-white bg-orange-600 hover:bg-orange-500 shadow-lg shadow-orange-500/20 transition-all uppercase text-sm tracking-widest flex items-center justify-center gap-2 disabled:opacity-70 disabled:hover:bg-orange-600"
            >
              <FileText size={18} />
              {isProcessing ? 'Guardando...' : 'Guardar salida'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { EarlyExitForm };
export default EarlyExitForm;