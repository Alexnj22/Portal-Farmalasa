import React from 'react';
import {
  MonitorCheck,
  Settings,
  Laptop,
  Save,
  XCircle,
} from 'lucide-react';

const KioskConfigModal = ({
  isOpen,
  isProcessing = false,
  kioskConfig = null,
  branches = [],
  selectedBranchId = '',
  deviceNameInput = '',
  // 🚨 Props corregidos para hacer match con TimeClockView
  onChangeBranch,
  onChangeDeviceName,
  onSave,
  onRevoke,
  onClose,
}) => {
  if (!isOpen) return null;

  // 🚨 Corrección crítica: Convertir el String de localStorage a Objeto seguro
  let parsedConfig = kioskConfig;
  if (typeof kioskConfig === 'string') {
    try {
      parsedConfig = JSON.parse(kioskConfig);
    } catch (error) {
      console.error("Error al leer la configuración del kiosco:", error);
      parsedConfig = null;
    }
  }

  const assignedBranchName = parsedConfig?.branchName || 'Sucursal no disponible';

  return (
    <div className="absolute inset-0 z-[60] bg-[#0B1121]/95 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-slate-900 border border-slate-700 p-10 rounded-[2.5rem] shadow-2xl max-w-md w-full text-center relative">
        {parsedConfig ? (
          <>
            <div className="inline-flex p-5 bg-green-600 rounded-full mb-6 shadow-[0_0_40px_rgba(34,197,94,0.5)]">
              <MonitorCheck size={48} className="text-white" />
            </div>

            <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-tight">
              Kiosco Activo
            </h2>

            <p className="text-slate-400 text-sm mb-6 font-medium">
              Este dispositivo está autorizado para:
            </p>

            <div className="bg-slate-800 p-4 rounded-2xl border border-slate-600 mb-8">
              <p className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-1">
                Sucursal Asignada
              </p>
              <p className="text-white text-xl font-black">{assignedBranchName}</p>
            </div>

            <button
              type="button"
              onClick={onRevoke}
              disabled={isProcessing}
              className="w-full py-4 bg-red-600 hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-red-600/20 transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95"
            >
              <XCircle size={20} /> Revocar Permisos (Local)
            </button>
          </>
        ) : (
          <>
            <div className="inline-flex p-5 bg-blue-600 rounded-full mb-6 shadow-[0_0_40px_rgba(37,99,235,0.5)] animate-bounce">
              <Settings size={48} className="text-white" />
            </div>

            <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-tight">
              Vincular Kiosco
            </h2>

            <p className="text-slate-400 text-sm mb-8 font-medium">
              Configure este dispositivo para permitir marcaciones.
            </p>

            <div className="text-left space-y-5">
              <div>
                <label className="text-[10px] font-bold text-blue-400 uppercase tracking-widest ml-1 mb-1 block">
                  Sucursal Física
                </label>
                <select
                  className="w-full bg-slate-800 text-white border-2 border-slate-700 rounded-2xl p-4 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all text-sm font-bold appearance-none cursor-pointer"
                  value={selectedBranchId}
                  onChange={(e) => onChangeBranch?.(e.target.value)}
                  disabled={isProcessing}
                >
                  <option value="">-- Seleccionar --</option>
                  {(branches || []).map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-blue-400 uppercase tracking-widest ml-1 mb-1 block">
                  Nombre del Equipo
                </label>
                <div className="relative">
                  <Laptop
                    size={16}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    className="w-full bg-slate-800 text-white border-2 border-slate-700 rounded-2xl p-4 pl-12 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all text-sm font-bold"
                    placeholder="Ej: Tablet Entrada"
                    value={deviceNameInput}
                    onChange={(e) => onChangeDeviceName?.(e.target.value)}
                    disabled={isProcessing}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={onSave}
                disabled={isProcessing}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-blue-600/20 transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 mt-4"
              >
                <Save size={20} />
                {isProcessing ? 'Autorizando...' : 'Autorizar Dispositivo'}
              </button>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          disabled={isProcessing}
          className="w-full py-3 text-slate-500 hover:text-white disabled:opacity-60 font-bold uppercase tracking-widest text-xs transition-colors mt-4"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
};

export { KioskConfigModal };
export default KioskConfigModal;