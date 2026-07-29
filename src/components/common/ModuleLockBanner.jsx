import React, { useState, memo } from 'react';
import { Wrench, Lock, Unlock } from 'lucide-react';
import Notice from './Notice';
import Button from './Button';
import ConfirmModal from './ConfirmModal';
import PromptModal from './PromptModal';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore } from '../../store/staffStore';
import { lockModule, unlockModule, translateLockError } from '../../data/moduleLocks';

/**
 * ModuleLockBanner — candado de mantenimiento de un módulo (F0 del
 * PLAN-MINMAX-Y-CANDADO-2026-07-29).
 *
 * Hace las dos cosas en un solo componente a propósito: muestra el estado Y
 * ofrece tomar/liberar el candado a quien pueda editar el módulo. Un panel de
 * administración aparte obligaría a salir del módulo para bloquearlo, que es
 * justo el momento en que uno quiere bloquearlo.
 *
 * El candado REAL está en la BD (auth_can_edit_any → auth_module_locked, 59
 * policies / 30 tablas / 23 RPCs). Esto es la mitad de UX.
 *
 * OJO: el candado NO detiene crons ni edge functions — `service_role` saltea RLS.
 * Para frenar un cron hay que desactivar su job en cron.job aparte. Se dice acá
 * mismo para que nadie lo asuma.
 *
 * Uso:  <ModuleLockBanner moduleKey="minmax" label="MIN·MAX" />
 */
const ModuleLockBanner = memo(({ moduleKey, label }) => {
    const { moduleLock, isModuleLocked, hasPermission, refreshModuleLocks, rolePerms } = useAuth();
    const [askLock,   setAskLock]   = useState(false);
    const [askUnlock, setAskUnlock] = useState(false);
    const [busy,      setBusy]      = useState(false);

    const lock     = moduleLock(moduleKey);
    const bloqueado = isModuleLocked(moduleKey);   // hay candado y NO soy el titular
    const soyTitular = !!lock && !bloqueado;
    const nombre   = label || moduleKey;

    // hasPermission ya devuelve false por el candado, así que no sirve para saber
    // si esta persona podría bloquear: se consulta el permiso crudo.
    const puedeGestionar = !!rolePerms?.[moduleKey]?.can_edit || hasPermission(moduleKey, 'can_edit');

    const hora = (iso) => {
        try { return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
    };

    const doLock = async (motivo) => {
        setBusy(true);
        const { error } = await lockModule(moduleKey, motivo, 4);
        setBusy(false);
        setAskLock(false);
        if (error) { useToastStore.getState().showToast(nombre, translateLockError(error.message), 'error'); return; }
        useStaffStore.getState().appendAuditLog('MODULE_LOCK_ON', moduleKey, { module: moduleKey, reason: motivo });
        useToastStore.getState().showToast(nombre, 'Módulo en mantenimiento. Los demás quedan en solo lectura.', 'success');
        refreshModuleLocks();
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

    // Sin candado: solo el botón para tomarlo, y solo a quien pueda editar.
    if (!lock) {
        if (!puedeGestionar) return null;
        return (
            <>
                <div className="flex justify-end">
                    <Button variant="ghost" size="sm" icon={Lock} onClick={() => setAskLock(true)}>
                        Poner en mantenimiento
                    </Button>
                </div>
                <PromptModal
                    isOpen={askLock}
                    title={`Poner ${nombre} en mantenimiento`}
                    message="Los demás podrán consultar pero no guardar, durante 4 horas o hasta que lo liberes. No detiene los procesos automáticos (syncs): para eso hay que desactivar su cron aparte."
                    placeholder="¿En qué estás trabajando? Ej. arreglos de la auditoría"
                    confirmText="Bloquear"
                    required
                    isProcessing={busy}
                    onConfirm={doLock}
                    onClose={() => setAskLock(false)}
                />
            </>
        );
    }

    return (
        <>
            <Notice
                variant={bloqueado ? 'warning' : 'info'}
                icon={Wrench}
                action={puedeGestionar && soyTitular ? (
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
        </>
    );
});

export default ModuleLockBanner;
