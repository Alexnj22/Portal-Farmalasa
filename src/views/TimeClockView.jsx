import React, { useCallback, useEffect, useMemo } from 'react';
import Button from '../components/common/Button';
import { LogOut } from 'lucide-react';

import { useAuth } from '@nucleo/context/AuthContext';
import { useTimeClockEngine } from '@nucleo/hooks/useTimeClockEngine';

import ConfirmModal from '../components/common/ConfirmModal';
import OfflineBanner from '../components/common/OfflineBanner';
import FeedbackOverlay from '../components/timeclock/FeedbackOverlay';
import AuthPromptPanel from '../components/timeclock/AuthPromptPanel';
import EarlyExitForm from '../components/timeclock/EarlyExitForm';
import KioskConfigModal from '../components/timeclock/KioskConfigModal';
import IdleScanPanel from '../components/timeclock/IdleScanPanel';
import SelfDeclareShiftPanel from '../components/timeclock/SelfDeclareShiftPanel';
import SegmentedControl from '../components/common/SegmentedControl';
import ColaDeCaja from '../components/timeclock/ColaDeCaja';
import CajaDelKiosco from '../components/timeclock/CajaDelKiosco';
import { sesionDeCaja } from '../components/timeclock/sesionDeCaja';
import { hora12ConSegundos } from '@nucleo/utils/hora';
import { usePestanaEnUrl } from '@plataforma/usePestanaEnUrl';

// El tipo del equipo se lee UNA vez al montar: cambia sólo al vincularlo, y
// eso recarga la página. Un equipo de antes del 2026-11-17 no tiene tipo:
// es marcador.
function tipoDelEquipo() {
  try {
    const raw = localStorage.getItem('kiosk_config');
    return raw && JSON.parse(raw)?.tipo === 'caja' ? 'caja' : 'marcacion';
  } catch {
    return 'marcacion';
  }
}

// El kiosco de caja tiene dos pestañas (plan del kiosco de caja, fase 1). La
// pestaña vive en la dirección (`?tab=`), como en todo el portal.
const PESTANAS_CAJA = ['vender', 'preventas', 'caja', 'marcar'];

const TimeClockView = ({ setView }) => {
  const { logout } = useAuth();
  const esCaja = useMemo(() => tipoDelEquipo() === 'caja', []);
  const [pestana, setPestana] = usePestanaEnUrl(esCaja ? PESTANAS_CAJA : ['marcar'], esCaja ? 'preventas' : 'marcar', 'pantalla');
  const enCola = esCaja && pestana === 'preventas';
  const enCaja = esCaja && pestana === 'caja';
  const enVender = esCaja && pestana === 'vender';
  // La sesión que abrió un carné en Caja se cierra al salir de esa pestaña.
  useEffect(() => {
    // Vender y Caja comparten la sesión del carné: pasar de una a otra no la
    // cierra; ir a Preventas o Marcar, sí.
    if (pestana !== 'caja' && pestana !== 'vender' && sesionDeCaja.abiertaPorCarne) {
      sesionDeCaja.abiertaPorCarne = false;
      logout?.();
    }
  }, [pestana, logout]);
  const branchDelEquipo = useMemo(() => { try { return JSON.parse(localStorage.getItem('kiosk_config') || 'null')?.branchId ?? null; } catch { return null; } }, []);

  const {
    scanCode,
    setScanCode,
    feedback,
    authPrompt,
    specialMode,
    isProcessing,
    isConfiguring,
    selectedBranchId,
    deviceNameInput,
    isRevokeModalOpen,
    earlyExitData,
    exitReason,
    exitNotes,
    inputRef,
    time,
    branches,
    lunchAlerts,
    setSelectedBranchId,
    setDeviceNameInput,
    setIsRevokeModalOpen,
    setExitReason,
    setExitNotes,
    handleKeyDown,
    handleInputChange,
    handleScan,
    handleSaveConfig,
    handleRevokeConfig,
    executeRevokeConfig,
    cancelAuth,
    requestSpecialOut,
    submitEarlyExit,
    handleForceNormalOut,
    closeFeedback,
    handleAnnouncementRead,
    handleEarlyExtraRequest,
    handleSkipPin,
    selfDeclareData,
    submitSelfDeclare,
    cancelSelfDeclare,
    tipoDeEquipo,
    setTipoDeEquipo,
  } = useTimeClockEngine({ pausado: enCola || enCaja || enVender });

  // Read device & branch from localStorage kiosk_config
  const kioskLabel = useMemo(() => {
    try {
      const raw = localStorage.getItem('kiosk_config');
      if (!raw) return null;
      const cfg = JSON.parse(raw);
      const parts = [];
      if (cfg.deviceName) parts.push(cfg.deviceName);
      if (cfg.branchName) parts.push(cfg.branchName);
      return parts.join('  ·  ') || null;
    } catch {
      return null;
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      if (logout) await logout();
      setView('login');
    } catch {
      setView('login');
    }
  }, [logout, setView]);

  // Dark theme-color for iOS Safari chrome (Dynamic Island + nav bar)
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.content;
    if (meta) meta.content = '#060B18';
    return () => { if (meta && prev) meta.content = prev; };
  }, []);

  // Este kiosco es una pantalla siempre-oscura, independiente del tema real
  // del portal (igual que LoginView) — pero a diferencia de LoginView, SÍ
  // vive dentro del árbol de ThemeProvider (usa LiquidSelect/ConfirmModal,
  // que leen tokens vía [data-theme] en <html>). Forzamos data-theme="dark"
  // en <html> mientras esta vista está montada para que esos componentes —
  // incluido lo que renderizan vía portal a document.body, como el dropdown
  // de LiquidSelect — hereden los tokens oscuros correctos sin importar el
  // tema elegido por el usuario, restaurando el valor real al desmontar.
  useEffect(() => {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    return () => {
      if (prevTheme) root.setAttribute('data-theme', prevTheme);
      else root.removeAttribute('data-theme');
    };
  }, []);

  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        if (feedback)           { closeFeedback();              return; }
        if (isRevokeModalOpen)  { setIsRevokeModalOpen(false); return; }
        if (selfDeclareData)    { cancelSelfDeclare();          return; }
        if (isConfiguring || earlyExitData || authPrompt || specialMode) { cancelAuth(); return; }
        if (scanCode?.length)   { setScanCode('');              return; }
        handleLogout();
      }
    };
    window.addEventListener('keydown', handleEscKey);
    return () => window.removeEventListener('keydown', handleEscKey);
  }, [
    feedback, isRevokeModalOpen, isConfiguring, earlyExitData, selfDeclareData,
    authPrompt, specialMode, scanCode, closeFeedback,
    setIsRevokeModalOpen, cancelAuth, setScanCode, handleLogout, cancelSelfDeclare,
  ]);

  const now = time || new Date();
  const timeStr  = hora12ConSegundos(now);
  const dateStr  = now.toLocaleDateString('es-SV',  { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="h-[100dvh] w-full bg-surface-page relative overflow-y-auto overflow-x-hidden font-sans flex flex-col selection:bg-chart-1/30">

      {/* ── Ambient orbs — mismo estándar que AppLayout.jsx (colores reales
          del logo, AUDITORIA-TEMA-2026-07.md §7.7): el kiosco ya no tiene su
          propio fondo/blobs hardcodeados, consume --bg-page (dark, forzado
          arriba) + esta misma decoración compartida en vez de una versión
          bespoke azul/violeta aparte (2026-07-25, a pedido del usuario). ── */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="animate-ambient-drift absolute rounded-full" style={{ width:'70vw', height:'70vw', top:'-15%', left:'-15%', background:'radial-gradient(circle, rgba(142,195,15,0.45) 0%, rgba(185,224,90,0.20) 40%, transparent 70%)', filter:'blur(35px)' }} />
        <div className="animate-ambient-drift-reverse absolute rounded-full" style={{ width:'55vw', height:'55vw', top:'-5%', right:'-20%', background:'radial-gradient(circle, rgba(152,29,151,0.38) 0%, rgba(226,163,224,0.15) 40%, transparent 70%)', filter:'blur(30px)' }} />
        <div className="animate-ambient-drift absolute rounded-full" style={{ width:'80vw', height:'80vw', bottom:'-35%', left:'-10%', background:'radial-gradient(circle, rgba(152,29,151,0.35) 0%, rgba(226,163,224,0.12) 40%, transparent 70%)', filter:'blur(40px)', animationDelay:'4s', animationDuration:'18s' }} />
        <div className="animate-ambient-drift-reverse absolute rounded-full" style={{ width:'45vw', height:'45vw', top:'25%', right:'5%', background:'radial-gradient(circle, rgba(142,195,15,0.32) 0%, rgba(185,224,90,0.12) 40%, transparent 70%)', filter:'blur(28px)', animationDelay:'2s', animationDuration:'14s' }} />
        <div className="animate-ambient-drift absolute rounded-full" style={{ width:'30vw', height:'30vw', top:'50%', left:'38%', background:'radial-gradient(circle, rgba(152,29,151,0.28) 0%, rgba(226,163,224,0.10) 40%, transparent 70%)', filter:'blur(22px)', animationDelay:'6s', animationDuration:'11s' }} />
      </div>

      {/* 7B.8: el kiosco no daba ningún aviso de conectividad — solo estaba
          montado en AppLayout.jsx (dashboard normal), nunca acá. */}
      <OfflineBanner />

      {/* ── Modals ────────────────────────────────────────────────── */}
      {isRevokeModalOpen && (
        <ConfirmModal
          isOpen={isRevokeModalOpen}
          onClose={() => setIsRevokeModalOpen(false)}
          onConfirm={executeRevokeConfig}
          title="¿Desvincular dispositivo?"
          message="Este dispositivo dejará de funcionar para marcar asistencia inmediatamente."
          confirmText="Sí, desvincular"
        />
      )}

      {isConfiguring && (
        <KioskConfigModal
          isOpen={isConfiguring}
          kioskConfig={typeof window !== 'undefined' ? localStorage.getItem('kiosk_config') : null}
          branches={branches}
          selectedBranchId={selectedBranchId}
          deviceNameInput={deviceNameInput}
          tipoDeEquipo={tipoDeEquipo}
          onChangeTipo={setTipoDeEquipo}
          isProcessing={isProcessing}
          onChangeBranch={setSelectedBranchId}
          onChangeDeviceName={setDeviceNameInput}
          onSave={handleSaveConfig}
          onRevoke={handleRevokeConfig}
          onClose={cancelAuth}
        />
      )}

      {feedback && (
        <FeedbackOverlay
          feedback={feedback}
          onClose={closeFeedback}
          onAnnouncementRead={handleAnnouncementRead}
          onEarlyExtra={handleEarlyExtraRequest}
        />
      )}

      {/* ── Salir ─────────────────────────────────────────────────────
          El botón era un hijo suelto de este contenedor `flex flex-col`, o
          sea que `align-items: stretch` lo estiraba de lado a lado: una
          barra de 1366px pegada al borde de arriba, con la palabra «SALIR»
          centrada en el medio de la pantalla. Va anclado arriba a la
          derecha, con su propio ancho, `fixed` para que no se mueva con el
          scroll de emergencia y por debajo de los modales (z-header = 40,
          contra el 60 del configurador y el 90 del aviso). ── */}
      <div className="fixed top-4 right-4 [@media(max-height:640px)]:top-2 [@media(max-height:640px)]:right-2 z-header">
        <Button variant="secondary" size="sm" icon={LogOut} title="Salir del marcador (Esc)" onClick={handleLogout}>
          <span className="hidden sm:inline">Salir</span>
        </Button>
      </div>

      {/* ── Main content ──────────────────────────────────────────── */}
      {/* [@media(max-height:800px)] = modo compacto: mismo breakpoint que ya
          usa el dock de íconos de IdleScanPanel.jsx. Sin esto, en 1024x768/
          1280x720/1366x768 (probado con Playwright real) la tarjeta central
          se pasaba de la altura del viewport y el botón "Autorizar Permiso"
          quedaba inaccesible — no había scroll que lo alcanzara porque este
          contenedor usaba min-h en vez de h fija (ver el cambio de
          min-h-[100dvh]→h-[100dvh] arriba, que además deja un scroll real
          como red de seguridad para cualquier caso más extremo).

          El relleno bajó de `py-20 sm:py-24` a `py-10 sm:py-12` (2026-08-16):
          la columna se centra con `my-auto`, así que ese relleno NO es aire
          de diseño — es un PISO que le quita 96px de alto útil al panel y no
          se ve. Medido con el marco real: el formulario de permiso obligaba a
          scrollear 49px hasta en 1920×1080 y 266px en 1024×600, en una
          pantalla que se opera de pie y sin mouse. Además hay un escalón
          intermedio en 900px, que es donde vive media flota de portátiles
          (1440×900, 1600×900): antes saltaba de tamaño completo a compacto y
          esos 100px no los cubría nadie. */}
      <main className="relative z-base flex-1 w-full flex flex-col items-center px-4 py-8 sm:py-10 [@media(min-height:801px)_and_(max-height:900px)]:py-6 [@media(max-height:800px)]:py-5 [@media(max-height:640px)]:!py-2">
        {esCaja && (
          <div className="w-full max-w-[560px] mb-4 [@media(max-height:640px)]:mb-2">
            <SegmentedControl
              label="Pantalla del kiosco"
              layout="block"
              columns={4}
              options={[
                { value: 'vender', label: 'Vender' },
                { value: 'preventas', label: 'Preventas' },
                { value: 'caja', label: 'Caja' },
                { value: 'marcar', label: 'Marcar' },
              ]}
              value={pestana}
              onChange={setPestana}
            />
          </div>
        )}

        {enCola ? <ColaDeCaja /> : (enCaja || enVender) ? <CajaDelKiosco branchId={branchDelEquipo} vista={enVender ? 'vender' : 'caja'} /> : (
        <div className="w-full max-w-[420px] my-auto flex flex-col items-center gap-5 sm:gap-6 [@media(min-height:801px)_and_(max-height:900px)]:gap-4 [@media(max-height:800px)]:gap-2.5">

          {/* Cabecera y reloj, rediseño del 2026-11-17 (pedido del usuario:
              «visualmente puede mejorar»). Se lee de pie y a dos metros: el
              reloj es el protagonista y va sin tarjeta; arriba, de qué
              sucursal es el equipo, que antes casi no se veía. El logo se
              retira abajo de 640px de alto, como antes. */}
          <header className="animate-view-enter flex items-center gap-2.5 [@media(max-height:640px)]:hidden">
            <img
              src="/Logo192.png"
              alt="Farmalasa"
              className="w-9 h-9 [@media(max-height:800px)]:w-7 [@media(max-height:800px)]:h-7 object-contain"
              draggable="false"
            />
            <span className="text-label font-bold text-white/70 truncate max-w-[320px]">
              {kioskLabel || 'Farmacias La Salud & Popular'}
            </span>
          </header>

          <div className="animate-view-enter w-full flex flex-col items-center" style={{ animationDelay: '60ms' }}>
            <h2 className="text-white font-light tabular-nums leading-none w-full text-center whitespace-nowrap tracking-tight
              text-[4rem] sm:text-[5.5rem] [@media(min-height:801px)_and_(max-height:900px)]:text-[4rem] [@media(max-height:800px)]:text-[2.75rem] [@media(max-height:640px)]:!text-[2rem]">
              {timeStr}
            </h2>
            <p className="text-white/55 text-body font-semibold mt-3 [@media(max-height:800px)]:mt-1 w-full text-center truncate px-2 first-letter:uppercase">
              {dateStr}
            </p>
          </div>

          {/* Scan / auth panels */}
          <div className="w-full" style={{ animation: 'viewEnter 280ms var(--ease-spring) 120ms both' }}>
            {selfDeclareData ? (
              <SelfDeclareShiftPanel
                employee={selfDeclareData.employee}
                onSubmit={submitSelfDeclare}
              />
            ) : earlyExitData ? (
              <EarlyExitForm
                earlyExitData={earlyExitData}
                exitReason={exitReason}
                exitNotes={exitNotes}
                onChangeReason={setExitReason}
                onChangeNotes={setExitNotes}
                onSubmit={submitEarlyExit}
                onCancel={cancelAuth}
                isProcessing={isProcessing}
              />
            ) : authPrompt ? (
              <AuthPromptPanel
                authPrompt={authPrompt}
                scanCode={scanCode}
                inputRef={inputRef}
                submitHandler={handleScan}
                keyDownHandler={handleKeyDown}
                inputChangeHandler={handleInputChange}
                cancelHandler={cancelAuth}
                forceNormalOutHandler={handleForceNormalOut}
                clearHandler={() => setScanCode('')}
                skipPinHandler={handleSkipPin}
              />
            ) : (
              <IdleScanPanel
                specialMode={specialMode}
                cancelSpecialModeHandler={cancelAuth}
                specialOutHandler={requestSpecialOut}
                lunchAlerts={lunchAlerts}
              />
            )}
          </div>

        </div>
        )}
      </main>
    </div>
  );
};

export default TimeClockView;
