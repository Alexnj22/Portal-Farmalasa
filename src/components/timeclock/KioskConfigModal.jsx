import React from 'react';
import Button from '../common/Button';
import {
  MonitorCheck,
  Settings,
  Laptop,
  Save,
  XCircle,
} from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect'; // 🚨 Asegúrate de que esta ruta sea correcta
import PortalInput from '../common/PortalInput';
import useMontadoParaSalida from '../../hooks/useMontadoParaSalida';
import { rotuloCampo } from '../../utils/rotuloDeCampo';

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
  const montadoParaSalida = useMontadoParaSalida(isOpen);
  // El gate mira el montaje-para-SALIDA y no `isOpen` a secas: cortar en el
    // mismo tick del cierre desmontaba el componente antes de que
    // `ModalShell` pudiera animar nada. Ver `useMontadoParaSalida`.
    if (!montadoParaSalida) return null;

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
    // `fixed` y no `absolute`: el velo se medía contra la caja VISIBLE del
    // kiosco, que es un contenedor scrolleable — al bajar dejaba de tapar. Y
    // `items-start` + `my-auto` en la tarjeta en vez de `items-center`, para
    // que en un monitor bajo el contenido sobrante quede alcanzable en vez de
    // salirse por arriba (misma receta que ModalShell.jsx).
    <div className="fixed inset-0 z-sidebar-desktop bg-[#0A0F1C]/80 backdrop-blur-[20px] flex items-start justify-center overflow-y-auto overscroll-contain p-4 sm:p-6 [@media(max-height:800px)]:p-3 animate-in fade-in duration-[var(--dur-slow)]">

      {/* Tarjeta Liquid Glass */}
      <div className="w-full max-w-[420px] my-auto flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-header p-6 sm:p-8 [@media(max-height:800px)]:p-4 shadow-[var(--shadow-glass-dark)] text-center relative">
        
        {parsedConfig ? (
          /* =========================================
             ESTADO: KIOSCO VINCULADO (ACTIVO)
             ========================================= */
          <div className="flex flex-col items-center w-full group/icon">
            <div className="inline-flex p-4 rounded-3xl mb-4 sm:mb-5 transition-all duration-[var(--dur-slow)] border backdrop-blur-md bg-success/10 border-success/40 shadow-[var(--shadow-glow-success-lg)] group-hover/icon:scale-105 group-hover/icon:-translate-y-1 group-hover/icon:shadow-[var(--shadow-glow-success-lg)]">
              <MonitorCheck size={40} className="text-success drop-shadow-[var(--shadow-glow-success)] sm:w-12 sm:h-12" strokeWidth={1.5} />
            </div>

            <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight mb-1.5 transition-colors">
              Kiosco Activo
            </h2>
            <p className="text-micro sm:text-xs font-bold uppercase tracking-[0.25em] text-success/80 transition-colors px-2 mb-6">
              Dispositivo Autorizado
            </p>

            {/* Info de Sucursal (Mini Glass Card) */}
            <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 shadow-[var(--shadow-shine-lg)] mb-6 flex flex-col items-center justify-center">
              <p className="text-white/40 text-micro font-semibold uppercase tracking-widest mb-1">
                Sucursal Asignada
              </p>
              <p className="text-white text-lg sm:text-xl font-bold truncate w-full px-2">
                {assignedBranchName}
              </p>
            </div>

            <Button variant="destructive" icon={XCircle} disabled={isProcessing} onClick={onRevoke}>Revocar Permisos Locales</Button>
          </div>
        ) : (
          /* =========================================
             ESTADO: VINCULAR KIOSCO (SETUP)
             ========================================= */
          <div className="flex flex-col items-center w-full group/icon">
            <div className="inline-flex p-4 rounded-3xl mb-4 sm:mb-5 transition-all duration-[var(--dur-slow)] border backdrop-blur-md bg-chart-1/10 border-chart-1/40 shadow-[var(--shadow-glow-chart-1-lg)] group-hover/icon:scale-105 group-hover/icon:-translate-y-1 group-hover/icon:shadow-[var(--shadow-glow-chart-1-lg)]">
              <Settings size={40} className="text-chart-1-text drop-shadow-[var(--shadow-glow-chart-1)] sm:w-12 sm:h-12" strokeWidth={1.5} />
            </div>

            <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight mb-1.5 transition-colors">
              Vincular Kiosco
            </h2>
            <p className="text-micro sm:text-xs font-bold uppercase tracking-[0.25em] text-chart-1-text/80 transition-colors px-2 mb-6 sm:mb-8">
              Configuración Inicial
            </p>

            <div className="w-full text-left flex flex-col gap-4 sm:gap-5 relative z-tabs">
              
              {/* 🚨 REEMPLAZO DEL SELECT NATIVO POR LIQUIDSELECT */}
              <div className="flex flex-col gap-1.5 relative z-header">
                <label className={`${rotuloCampo('text-white/50', { denso: true })} sm:text-caption`}>
                  Sucursal Física
                </label>
                {/* Este modal solo se monta dentro de TimeClockView, que fuerza
                    data-theme="dark" en <html> mientras esa vista vive (ver su
                    useEffect) — LiquidSelect ya hereda los tokens correctos sin
                    necesitar su viejo prop theme="dark" (lógica isDark manual,
                    eliminada de LiquidSelect en la migración a tokens de T3). */}
                <div className={isProcessing ? 'opacity-50 pointer-events-none' : ''}>
                  <LiquidSelect
                    options={branchOptions}
                    value={selectedBranchId}
                    onChange={(val) => onChangeBranch?.(val)}
                    placeholder="-- Seleccionar sucursal --"
                    className="w-full"
                  />
                </div>
              </div>

              {/* Input de Nombre del Equipo — la etiqueta la dibuja el canónico */}
              <div className="relative z-base">
                <PortalInput
                  label="Identificador del Equipo" name="kiosk-device" onDark icon={Laptop}
                  value={deviceNameInput}
                  onChange={(e) => onChangeDeviceName?.(e.target.value)}
                  placeholder="Ej: Tablet Entrada"
                  readOnly={isProcessing}
                  autoComplete="off"
                />
              </div>

              {/* Botón Guardar */}
              <Button tone="chart-1" disabled={isProcessing || !selectedBranchId || !deviceNameInput} onClick={onSave}>{isProcessing ? (
                  <span className="w-4 h-4 border-2 border-chart-1/30 border-t-blue-400 rounded-full animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                {isProcessing ? 'Autorizando...' : 'Autorizar Dispositivo'}</Button>
            </div>
          </div>
        )}

        {/* Botón Cerrar Global */}
        <Button variant="ghost" disabled={isProcessing} onClick={onClose}>Cerrar Configuración</Button>
      </div>
    </div>
  );
};

export { KioskConfigModal };
export default KioskConfigModal;