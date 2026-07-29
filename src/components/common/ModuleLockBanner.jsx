import React, { useState, memo } from 'react';
import { useLocation } from 'react-router-dom';
import { Wrench, Unlock } from 'lucide-react';
import Notice from './Notice';
import Button from './Button';
import ConfirmModal from './ConfirmModal';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore } from '../../store/staffStore';
import { unlockModule, translateLockError } from '../../data/moduleLocks';
import { MODULE_MAP, moduleKeyForPath } from '../../constants/moduleMap';

/**
 * ModuleLockBanner — el aviso de que este módulo está en mantenimiento.
 *
 * Se monta UNA vez, dentro de GlassViewLayout, y resuelve solo de qué módulo se
 * trata a partir de la ruta. Antes se montaba a mano y estaba únicamente en
 * MinMaxView, así que un candado sobre cualquier otro módulo era invisible: la
 * gente veía los botones de guardar apagados y ningún cartel que lo explicara.
 *
 * Renderiza null si no hay candado, así que ponerlo en las 37 vistas que usan
 * GlassViewLayout no le cuesta nada a las que no están bloqueadas.
 *
 * TOMAR un candado ya no se hace desde acá: vive en Sistema › Mantenimiento. El
 * botón estaba bien cuando el banner existía en un solo módulo, pero repetido en
 * 37 vistas es una superficie de bloqueo accidental. Terminar SÍ sigue acá — el
 * titular tiene que poder soltarlo donde está trabajando.
 *
 * El candado REAL está en la BD (auth_can_edit_any → auth_module_locked). Esto es
 * la mitad de UX: el apagado de los botones lo hace hasPermission() solo.
 */
const ModuleLockBanner = memo(({ moduleKey: moduleKeyProp }) => {
    const { pathname } = useLocation();
    const { moduleLock, isModuleLocked, refreshModuleLocks } = useAuth();
    const [askUnlock, setAskUnlock] = useState(false);
    const [busy,      setBusy]      = useState(false);

    const moduleKey = moduleKeyProp ?? moduleKeyForPath(pathname);
    const lock      = moduleKey ? moduleLock(moduleKey) : null;

    const bloqueado  = !!moduleKey && isModuleLocked(moduleKey);  // hay candado y NO soy el titular
    const soyTitular = !!lock && !bloqueado;
    const nombre     = MODULE_MAP[moduleKey]?.label || moduleKey;

    const hora = (iso) => {
        try { return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false }); }
        catch { return ''; }
    };

    const doUnlock = async () => {
        setBusy(true);
        const { error } = await unlockModule(moduleKey);
        setBusy(false);
        setAskUnlock(false);
        if (error) { useToastStore.getState().showToast(nombre, translateLockError(error.message), 'error'); return; }
        useStaffStore.getState().appendAuditLog('MODULE_LOCK_OFF', moduleKey, { module: moduleKey });
        useToastStore.getState().showToast(nombre, 'Mantenimiento terminado. Ya se puede editar.', 'success');
        refreshModuleLocks();
    };

    if (!lock) return null;

    return (
        <div className="mb-3">
            <Notice
                variant={bloqueado ? 'warning' : 'info'}
                icon={Wrench}
                action={soyTitular ? (
                    <Button variant="ghost" size="sm" icon={Unlock} onClick={() => setAskUnlock(true)}>
                        Terminar
                    </Button>
                ) : null}
            >
                {bloqueado ? (
                    <>
                        <strong>{nombre} en mantenimiento.</strong>{' '}
                        {lock.locked_by_name} está aplicando cambios
                        {lock.reason ? ` — ${lock.reason}` : ''}. Podés consultar; guardar está desactivado.
                        {lock.locked_at ? ` Desde las ${hora(lock.locked_at)}.` : ''}
                    </>
                ) : (
                    <>
                        <strong>Tenés {nombre} en mantenimiento.</strong>{' '}
                        El resto del equipo está en solo lectura
                        {lock.expires_at ? ` hasta las ${hora(lock.expires_at)}` : ''}.
                        Acordate de terminarlo. Los syncs automáticos siguen corriendo.
                    </>
                )}
            </Notice>
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
        </div>
    );
});

export default ModuleLockBanner;
