import React from 'react';
import {
  MonitorCheck,
  Settings,
  Laptop,
  Save,
  XCircle,
} from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect'; // 🚨 Asegúrate de que esta ruta sea correcta

const KioskConfigModal = ({
  isOpen,
  isProcessing = false,
  kioskConfig = null,
  branches = [],
  selectedBranchId = '',
  deviceNameInput = '',
  onChangeBranch,
  onChangeDeviceName,
  onSave,
  onRevoke,
  onClose,
}) => {
  if (!isOpen) return null;

  // Conversión segura del String de localStorage a Objeto
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

  // 🚨 Adaptar las ramas para el formato requerido por LiquidSelect
  const branchOptions = (branches || []).map(b => ({
    value: String(b.id || b.branchId),
    label: b.name || b.branchName
  }));

  return (
    <div className="absolute inset-0 z-[60] bg-[#0A0F1C]/80 backdrop-blur-[20px] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
      
      {/* Tarjeta Liquid Glass */}
      <div className="w-full max-w-[420px] max-h-full overflow-y-auto scrollbar-hide flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] p-6 sm:p-8 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] text-center relative">
        
        {parsedConfig ? (
          /* =========================================
             ESTADO: KIOSCO VINCULADO (ACTIVO)
             ========================================= */
          <div className="flex flex-col items-center w-full group/icon">
            <div className="inline-flex p-4 rounded-[1.5rem] mb-4 sm:mb-5 transition-all duration-300 border backdrop-blur-md bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_40px_rgba(16,185,129,0.15)] group-hover/icon:scale-105 group-hover/icon:-translate-y-1 group-hover/icon:shadow-[0_0_50px_rgba(16,185,129,0.3)]">
              <MonitorCheck size={42} className="text-emerald-400 drop-shadow-[0_2px_10px_rgba(16,185,129,0.8)] sm:w-12 sm:h-12" strokeWidth={1.5} />
            </div>

            <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight mb-1.5 transition-colors">
              Kiosco Activo
            </h2>
            <p className="text-[9px] sm:text-xs font-bold uppercase tracking-[0.25em] text-emerald-400/80 transition-colors px-2 mb-6">
              Dispositivo Autorizado
            </p>

            {/* Info de Sucursal (Mini Glass Card) */}
            <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 shadow-[inset_0_2px_10px_rgba(255,255,255,0.02)] mb-6 flex flex-col items-center justify-center">
              <p className="text-white/40 text-[9px] font-semibold uppercase tracking-widest mb-1">
                Sucursal Asignada
              </p>
              <p className="text-white text-lg sm:text-xl font-bold truncate w-full px-2">
                {assignedBranchName}
              </p>
            </div>

            <button
              type="button"
              onClick={onRevoke}
              disabled={isProcessing}
              className="relative z-20 w-full text-[10px] sm:text-[11px] uppercase tracking-widest font-bold text-red-400 flex items-center justify-center gap-2 transition-all duration-300 bg-red-500/10 py-4 rounded-full border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              <XCircle size={16} /> Revocar Permisos Locales
            </button>
          </div>
        ) : (
          /* =========================================
             ESTADO: VINCULAR KIOSCO (SETUP)
             ========================================= */
          <div className="flex flex-col items-center w-full group/icon">
            <div className="inline-flex p-4 rounded-[1.5rem] mb-4 sm:mb-5 transition-all duration-300 border backdrop-blur-md bg-blue-500/10 border-blue-500/40 shadow-[0_0_40px_rgba(59,130,246,0.15)] group-hover/icon:scale-105 group-hover/icon:-translate-y-1 group-hover/icon:shadow-[0_0_50px_rgba(59,130,246,0.3)]">
              <Settings size={42} className="text-blue-400 drop-shadow-[0_2px_10px_rgba(59,130,246,0.8)] sm:w-12 sm:h-12" strokeWidth={1.5} />
            </div>

            <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight mb-1.5 transition-colors">
              Vincular Kiosco
            </h2>
            <p className="text-[9px] sm:text-xs font-bold uppercase tracking-[0.25em] text-blue-400/80 transition-colors px-2 mb-6 sm:mb-8">
              Configuración Inicial
            </p>

            <div className="w-full text-left flex flex-col gap-4 sm:gap-5 relative z-30">
              
              {/* 🚨 REEMPLAZO DEL SELECT NATIVO POR LIQUIDSELECT */}
              <div className="flex flex-col gap-1.5 relative z-40">
                <label className="text-white/50 text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest ml-2">
                  Sucursal Física
                </label>
                <div className={isProcessing ? 'opacity-50 pointer-events-none' : ''}>
                  <LiquidSelect
                    options={branchOptions}
                    value={selectedBranchId}
                    onChange={(val) => onChangeBranch?.(val)}
                    placeholder="-- Seleccionar Sucursal --"
                    className="w-full"
                    theme='dark'
                  />
                </div>
              </div>

              {/* Input de Nombre del Equipo */}
              <div className="flex flex-col gap-1.5 relative z-10">
                <label className="text-white/50 text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest ml-2">
                  Identificador del Equipo
                </label>
                <div className="relative">
                  <Laptop size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" strokeWidth={2} />
                  <input
                    className="w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white rounded-[1.5rem] p-3.5 sm:p-4 pl-12 outline-none focus:bg-black/40 focus:border-blue-500/50 transition-all font-medium text-sm sm:text-base shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)] placeholder:text-white/20"
                    placeholder="Ej: Tablet Entrada"
                    value={deviceNameInput}
                    onChange={(e) => onChangeDeviceName?.(e.target.value)}
                    disabled={isProcessing}
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* Botón Guardar */}
              <button
                type="button"
                onClick={onSave}
                disabled={isProcessing || !selectedBranchId || !deviceNameInput}
                className="relative z-10 w-full mt-2 text-[10px] sm:text-[11px] uppercase tracking-widest font-bold text-blue-400 flex items-center justify-center gap-2 transition-all duration-300 bg-blue-500/15 py-4 rounded-full border border-blue-500/30 hover:bg-blue-500/25 hover:border-blue-500/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.3)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
              >
                {isProcessing ? (
                  <span className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                {isProcessing ? 'Autorizando...' : 'Autorizar Dispositivo'}
              </button>
            </div>
          </div>
        )}

        {/* Botón Cerrar Global */}
        <button
          type="button"
          onClick={onClose}
          disabled={isProcessing}
          className="relative z-10 w-full mt-6 py-2 text-white/40 hover:text-white disabled:opacity-50 font-bold uppercase tracking-widest text-[9px] sm:text-[10px] transition-colors"
        >
          Cerrar Configuración
        </button>
      </div>
    </div>
  );
};

export { KioskConfigModal };
export default KioskConfigModal;