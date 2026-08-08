import React, { useState, memo } from 'react';
import { useLocation } from 'react-router-dom';
import { Wrench, Unlock } from 'lucide-react';
import Badge from './Badge';
import Button from './Button';
import ConfirmModal from './ConfirmModal';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore } from '../../store/staffStore';
import { unlockModule } from '../../data/moduleLocks';
import { MODULE_MAP, moduleKeyForPath } from '../../constants/moduleMap';
import { mensajeAmigable } from '../../utils/errorMessages';

/**
 * El aviso de "este módulo está en mantenimiento", en el ENCABEZADO.
 *
 * Vive en dos piezas porque van en dos lugares del mismo encabezado:
 *   · `ModuleLockChip`   — la ficha "Solo lectura", al lado del título.
 *   · `ModuleLockNotice` — la línea con quién, por qué y hasta cuándo, debajo.
 *
 * Las monta `GlassViewLayout`, así que cubren las 37 vistas sin que ninguna
 * tenga que acordarse, y las dos devuelven null si no hay candado.
 *
 * Por qué en el encabezado y no en el cuerpo (opción B, elegida por Alex el
 * 2026-07-29): el encabezado es sticky. Un aviso en el cuerpo se va de pantalla
 * al bajar por una tabla larga y el módulo vuelve a parecer roto sin motivo —
 * los botones de guardar apagados y ninguna explicación a la vista.
 *
 * TOMAR un candado no se hace desde acá: eso es Sistema › Mantenimiento. Un
 * botón de bloquear repetido en 37 vistas es superficie de bloqueo accidental.
 * Terminar sí sigue acá, porque el titular tiene que poder soltarlo donde está
 * trabajando.
 *
 * El candado REAL está en la BD (auth_can_edit_any → auth_module_locked); esto es
 * la mitad de UX. El apagado de los botones lo hace hasPermission() solo.
 */

// Estado del candado para la ruta actual. Se resuelve acá y no con una prop para
// que ninguna vista tenga que declarar a qué módulo pertenece.
function useLockDeLaRuta(moduleKeyProp) {
    const { pathname } = useLocation();
    const { moduleLock, isModuleLocked } = useAuth();
    const moduleKey = moduleKeyProp ?? moduleKeyForPath(pathname);
    const lock = moduleKey ? moduleLock(moduleKey) : null;
    return {
        moduleKey,
        lock,
        bloqueado:  !!moduleKey && isModuleLocked(moduleKey),   // hay candado y NO soy el titular
        soyTitular: !!lock && !isModuleLocked(moduleKey),
        nombre: MODULE_MAP[moduleKey]?.label || moduleKey,
    };
}

const hora = (iso) => {
    try { return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch { return ''; }
};

// ── La ficha, junto al título ────────────────────────────────────────────────
export const ModuleLockChip = memo(({ moduleKey }) => {
    const { lock } = useLockDeLaRuta(moduleKey);
    if (!lock) return null;
    return <Badge variant="warning" size="sm" icon={Wrench} className="shrink-0">Solo lectura</Badge>;
});

// ── La línea de detalle, debajo del título ───────────────────────────────────
const ModuleLockNotice = memo(({ moduleKey: moduleKeyProp }) => {
    const { moduleKey, lock, bloqueado, soyTitular, nombre } = useLockDeLaRuta(moduleKeyProp);
    const { refreshModuleLocks } = useAuth();
    const [askUnlock, setAskUnlock] = useState(false);
    const [busy,      setBusy]      = useState(false);

    const doUnlock = async () => {
        setBusy(true);
        const { error } = await unlockModule(moduleKey);
        setBusy(false);
        setAskUnlock(false);
        if (error) { useToastStore.getState().showToast(nombre, mensajeAmigable(error), 'error'); return; }
        useStaffStore.getState().appendAuditLog('MODULE_LOCK_OFF', moduleKey, { module: moduleKey });
        useToastStore.getState().showToast(nombre, 'Mantenimiento terminado. Ya se puede editar.', 'success');
        refreshModuleLocks();
    };

    if (!lock) return null;

    return (
        <>
            <div className="flex items-center gap-2 flex-wrap pt-1.5 text-label font-semibold text-warning-text">
                <span className="min-w-0">
                    {bloqueado ? (
                        <>
                            <strong className="font-black">{lock.locked_by_name}</strong> lo tiene en mantenimiento
                            {lock.reason ? ` — ${lock.reason}` : ''}
                            {lock.locked_at ? <span className="tabular-nums"> · desde {hora(lock.locked_at)}</span> : null}
                            {lock.expires_at ? <span className="tabular-nums"> · vence {hora(lock.expires_at)}</span> : null}
                            . Puedes consultar; guardar está desactivado.
                        </>
                    ) : (
                        <>
                            <strong className="font-black">Lo tienes tú en mantenimiento</strong>
                            {lock.reason ? ` — ${lock.reason}` : ''}
                            {lock.expires_at ? <span className="tabular-nums"> · vence {hora(lock.expires_at)}</span> : null}
                            . El resto del equipo está en solo lectura; los syncs automáticos siguen corriendo.
                        </>
                    )}
                </span>
                {soyTitular && (
                    <Button variant="ghost" size="sm" icon={Unlock} onClick={() => setAskUnlock(true)}>
                        Terminar
                    </Button>
                )}
            </div>
            <ConfirmModal
                isOpen={askUnlock}
                title={`Terminar el mantenimiento de ${nombre}`}
                message="El equipo vuelve a poder guardar de inmediato."
                confirmText="Terminar"
                isDestructive={false}
                isProcessing={busy}
                onConfirm={doUnlock}
                onClose={() => setAskUnlock(false)}
            />
        </>
    );
});

export default ModuleLockNotice;
