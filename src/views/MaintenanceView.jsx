import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Wrench, Lock, Unlock, Clock, Boxes, User as UserIcon } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import LiquidSelect from '../components/common/LiquidSelect';
import PortalInput from '../components/common/PortalInput';
import ModalShell from '../components/common/ModalShell';
import ConfirmModal from '../components/common/ConfirmModal';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { MODULE_MAP } from '../constants/moduleMap';
import { fetchLockableModules, lockModule, unlockModule, translateLockError } from '../data/moduleLocks';

// Duraciones ofrecidas. El servidor acota a [1, 24] igual (LEAST/GREATEST en
// lock_module), esto es solo para no escribir un número a mano.
const HORAS = [1, 2, 4, 8, 12, 24].map(h => ({ value: String(h), label: h === 1 ? '1 hora' : `${h} horas` }));

const etiqueta = (key) => MODULE_MAP[key]?.label || key;

function restante(expiresAt) {
    const ms = new Date(expiresAt) - Date.now();
    if (ms <= 0) return 'vencido';
    const min = Math.floor(ms / 60000);
    if (min < 60) return `faltan ${min} min`;
    const h = Math.floor(min / 60);
    return `faltan ${h} h ${min % 60} min`;
}

const hora = (iso) => {
    try { return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch { return ''; }
};

export default function MaintenanceView() {
    const { moduleLocks, refreshModuleLocks, rolePerms, isModuleLocked } = useAuth();

    const [bloqueables, setBloqueables] = useState([]);
    const [cargando,    setCargando]    = useState(true);
    const [abrirTomar,  setAbrirTomar]  = useState(false);
    const [aLiberar,    setALiberar]    = useState(null);   // module_key
    const [busy,        setBusy]        = useState(false);

    // Formulario de "poner en mantenimiento"
    const [modulo, setModulo] = useState('');
    const [motivo, setMotivo] = useState('');
    const [horas,  setHoras]  = useState('4');

    // Un tick por minuto para que el "faltan 28 min" no quede congelado.
    const [, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 60000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        let vivo = true;
        fetchLockableModules().then(({ data, error }) => {
            if (!vivo) return;
            if (error) useToastStore.getState().showToast('Mantenimiento', translateLockError(error.message), 'error');
            setBloqueables(data || []);
            setCargando(false);
        });
        return () => { vivo = false; };
    }, []);

    const activos = useMemo(
        () => Object.values(moduleLocks || {})
            .filter(l => new Date(l.expires_at) > new Date())
            .sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at)),
        [moduleLocks],
    );

    // Solo se ofrecen los módulos que además puedo editar: lock_module exige
    // can_edit sobre el módulo bloqueado, así que ofrecer el resto sería
    // ofrecer un rechazo.
    const opciones = useMemo(() => {
        const tomados = new Set(activos.map(l => l.module_key));
        return bloqueables
            .filter(m => !tomados.has(m.module_key) && rolePerms?.[m.module_key]?.can_edit)
            .map(m => ({ value: m.module_key, label: etiqueta(m.module_key) }))
            .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    }, [bloqueables, activos, rolePerms]);

    const doLock = useCallback(async () => {
        if (!modulo || !motivo.trim()) return;
        setBusy(true);
        const { error } = await lockModule(modulo, motivo.trim(), Number(horas));
        setBusy(false);
        if (error) { useToastStore.getState().showToast(etiqueta(modulo), translateLockError(error.message), 'error'); return; }
        useStaff.getState().appendAuditLog('MODULE_LOCK_ON', modulo, { module: modulo, reason: motivo.trim(), hours: Number(horas) });
        useToastStore.getState().showToast(etiqueta(modulo), 'Módulo en mantenimiento. Los demás quedan en solo lectura.', 'success');
        setAbrirTomar(false); setModulo(''); setMotivo(''); setHoras('4');
        refreshModuleLocks();
    }, [modulo, motivo, horas, refreshModuleLocks]);

    const doUnlock = useCallback(async () => {
        if (!aLiberar) return;
        setBusy(true);
        const { error } = await unlockModule(aLiberar);
        setBusy(false);
        const key = aLiberar;
        setALiberar(null);
        if (error) { useToastStore.getState().showToast(etiqueta(key), translateLockError(error.message), 'error'); return; }
        useStaff.getState().appendAuditLog('MODULE_LOCK_OFF', key, { module: key });
        useToastStore.getState().showToast(etiqueta(key), 'Mantenimiento terminado. Ya se puede editar.', 'success');
        refreshModuleLocks();
    }, [aLiberar, refreshModuleLocks]);

    const acciones = (
        <Button size="sm" icon={Lock} disabled={!opciones.length} onClick={() => setAbrirTomar(true)}>
            Poner en mantenimiento
        </Button>
    );

    return (
        <GlassViewLayout icon={Wrench} title="Mantenimiento" transparentBody
            filtersContent={acciones}>

            {/* El límite del candado, dicho donde se toma la decisión: service_role
                saltea RLS, así que esto detiene personas, no procesos. */}
            <Notice variant="warning" icon={Wrench}>
                <strong>El candado detiene personas, no procesos.</strong> Los syncs automáticos
                siguen escribiendo (DTE, inventario, productos): para frenar uno hay que desactivar
                su job en <code>cron.job</code> aparte. La única excepción es el recálculo mensual de
                MIN·MAX, que sí respeta el candado.
            </Notice>

            {cargando ? (
                <LoadingState variant="content" label="Cargando módulos…" />
            ) : activos.length === 0 ? (
                <EmptyState
                    icon={Unlock}
                    title="Ningún módulo en mantenimiento"
                    subtitle={`Los ${bloqueables.length} módulos bloqueables están libres. Poner uno en mantenimiento deja al resto del equipo en solo lectura, sin sacarlo del módulo.`}
                />
            ) : (
                <div className="flex flex-col gap-3 pt-1">
                    <div className="flex items-center gap-2">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Activos</span>
                        <Badge variant="warning" size="sm">{activos.length}</Badge>
                    </div>

                    {activos.map(l => {
                        // isModuleLocked devuelve false cuando el titular soy yo — es el
                        // mismo criterio que usa el banner, sin exponer el id del empleado.
                        const esMio = !isModuleLocked(l.module_key);
                        return (
                            <div key={l.module_key} data-surface="card" className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                                <div className="flex-1 min-w-0 flex flex-col gap-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Wrench size={14} className="text-warning-text shrink-0" />
                                        <span className="text-body font-black text-content truncate">{etiqueta(l.module_key)}</span>
                                        {esMio && <Badge variant="info" size="sm">Tuyo</Badge>}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-label text-content-2 min-w-0">
                                        <UserIcon size={11} className="shrink-0" />
                                        <span className="font-semibold truncate">{l.locked_by_name}</span>
                                        {l.reason && <span className="text-content-3 truncate">— “{l.reason}”</span>}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-caption text-content-3">
                                        <Clock size={10} className="shrink-0" />
                                        <span className="tabular-nums">
                                            desde {hora(l.locked_at)} · vence {hora(l.expires_at)} · {restante(l.expires_at)}
                                        </span>
                                    </div>
                                </div>
                                <Button variant="ghost" size="sm" icon={Unlock} onClick={() => setALiberar(l.module_key)}>
                                    Terminar
                                </Button>
                            </div>
                        );
                    })}

                    <p className="text-caption text-content-3">
                        Los otros {Math.max(bloqueables.length - activos.length, 0)} módulos bloqueables están libres.
                    </p>
                </div>
            )}

            {/* ── Tomar un candado ── */}
            <ModalShell
                open={abrirTomar}
                onClose={() => setAbrirTomar(false)}
                maxWidthClass="max-w-md"
                panelClassName="overflow-hidden"
                ariaLabel="Poner un módulo en mantenimiento"
            >
                <div className="p-5 flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-body-xl font-black text-content">Poner en mantenimiento</h3>
                        <p className="text-label text-content-3">
                            Los demás podrán consultar pero no guardar, hasta que lo liberes o se venza.
                        </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label id="mant-modulo-lbl" className="text-caption font-bold text-content-2">Módulo</label>
                        <LiquidSelect
                            ariaLabelledBy="mant-modulo-lbl"
                            value={modulo}
                            onChange={setModulo}
                            options={opciones}
                            placeholder="Elegí un módulo…"
                            icon={Boxes}
                            clearText="Ninguno"
                        />
                        <p className="text-caption text-content-3">
                            Solo los {opciones.length} módulos donde el candado tiene efecto y podés editar.
                        </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-caption font-bold text-content-2" htmlFor="mant-motivo">Motivo</label>
                        <PortalInput
                            id="mant-motivo"
                            value={motivo}
                            onChange={e => setMotivo(e.target.value)}
                            placeholder="¿En qué estás trabajando?"
                            aria-label="Motivo del mantenimiento"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label id="mant-horas-lbl" className="text-caption font-bold text-content-2">Duración</label>
                        <LiquidSelect
                            ariaLabelledBy="mant-horas-lbl"
                            value={horas}
                            onChange={setHoras}
                            options={HORAS}
                            icon={Clock}
                            clearable={false}
                        />
                        <p className="text-caption text-content-3">
                            Se libera solo al vencer: un candado olvidado un viernes no deja el módulo trabado el fin de semana.
                        </p>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setAbrirTomar(false)}>
                            Cancelar
                        </Button>
                        <Button type="button" size="sm" icon={Lock} loading={busy}
                            disabled={busy || !modulo || !motivo.trim()} onClick={doLock}>
                            Bloquear
                        </Button>
                    </div>
                </div>
            </ModalShell>

            <ConfirmModal
                isOpen={!!aLiberar}
                title={`Terminar el mantenimiento de ${etiqueta(aLiberar)}`}
                message="El equipo vuelve a poder guardar de inmediato."
                confirmText="Terminar"
                isDestructive={false}
                isProcessing={busy}
                onConfirm={doUnlock}
                onClose={() => setALiberar(null)}
            />
        </GlassViewLayout>
    );
}
