import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Wrench, Clock, Lock } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Notice from '../components/common/Notice';
import Badge from '../components/common/Badge';
import Switch from '../components/common/Switch';
import LiquidSelect from '../components/common/LiquidSelect';
import PortalInput from '../components/common/PortalInput';
import ConfirmModal from '../components/common/ConfirmModal';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { MODULE_INFO } from '../constants/permissionModules';
import { smartFilter } from '../utils/searchUtils';
import { fetchLockableModules, lockModule, unlockModule, translateLockError } from '../data/moduleLocks';

/**
 * Sistema › Mantenimiento — poner un módulo en solo lectura para el resto.
 *
 * Lista TODOS los módulos bloqueables con un switch cada uno; al encenderlo el
 * candado queda puesto y la fila revela sus dos cuadros (motivo y duración), que
 * son el estado del candado y se editan en vivo. Sin botón de "poner en
 * mantenimiento" ni modal: el switch ES la acción.
 *
 * Los nombres y las descripciones salen del registro de Permisos
 * (constants/permissionModules.js), no de las etiquetas del menú: ahí
 * `staff_list` es "Listado" y acá tiene que decir "Listado de Personal".
 */

// El servidor acota a [1, 24] igual (LEAST/GREATEST en lock_module); esto es para
// no escribir el número a mano.
const HORAS = [1, 2, 4, 8, 12, 24].map(h => ({ value: String(h), label: h === 1 ? '1 hora' : `${h} horas` }));

const info = (key) => MODULE_INFO[key] || { label: key, desc: '', group: 'Otros' };

const hora = (iso) => {
    try { return new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch { return ''; }
};

function restante(expiresAt) {
    const ms = new Date(expiresAt) - Date.now();
    if (ms <= 0) return 'vencido';
    const min = Math.floor(ms / 60000);
    if (min < 60) return `faltan ${min} min`;
    return `faltan ${Math.floor(min / 60)} h ${min % 60} min`;
}

const horasDe = (lock) =>
    String(Math.max(1, Math.round((new Date(lock.expires_at) - new Date(lock.locked_at)) / 3600_000)));

export default function MaintenanceView() {
    const { moduleLocks, refreshModuleLocks, rolePerms, isModuleLocked } = useAuth();

    const [bloqueables, setBloqueables] = useState([]);
    const [cargando,    setCargando]    = useState(true);
    const [busy,        setBusy]        = useState(null);   // module_key en vuelo
    const [aLiberar,    setALiberar]    = useState(null);
    const [buscar,      setBuscar]      = useState('');

    // Motivo mientras se escribe; se guarda al salir del campo o con Enter.
    const [motivoDraft, setMotivoDraft] = useState({});
    const motivoRef = useRef({});

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
            setBloqueables((data || []).map(m => m.module_key));
            setCargando(false);
        });
        return () => { vivo = false; };
    }, []);

    const activos = useMemo(() => {
        const ahora = new Date();
        const m = {};
        for (const l of Object.values(moduleLocks || {})) {
            if (new Date(l.expires_at) > ahora) m[l.module_key] = l;
        }
        return m;
    }, [moduleLocks]);

    // Se muestran TODOS los bloqueables, también los que no puedo editar: saber
    // que existen y quién los tiene tomados es parte de "¿qué hay bloqueado?".
    // Agrupados como en Permisos.
    const grupos = useMemo(() => {
        const filtrados = buscar.trim()
            ? smartFilter(buscar, bloqueables, k => [info(k).label, info(k).desc, k]).results
            : bloqueables;
        const porGrupo = new Map();
        for (const key of filtrados) {
            const g = info(key).group;
            if (!porGrupo.has(g)) porGrupo.set(g, []);
            porGrupo.get(g).push(key);
        }
        for (const arr of porGrupo.values()) arr.sort((a, b) => info(a).label.localeCompare(info(b).label, 'es'));
        return [...porGrupo.entries()];
    }, [bloqueables, buscar]);

    const totalFiltrado = grupos.reduce((n, [, ks]) => n + ks.length, 0);
    const totalActivos  = Object.keys(activos).length;

    const aplicar = useCallback(async (key, { reason, hours }) => {
        setBusy(key);
        const { error } = await lockModule(key, reason ?? null, hours ?? 4);
        setBusy(null);
        if (error) { useToastStore.getState().showToast(info(key).label, translateLockError(error.message), 'error'); return false; }
        refreshModuleLocks();
        return true;
    }, [refreshModuleLocks]);

    const encender = useCallback(async (key) => {
        const ok = await aplicar(key, { hours: 4 });
        if (!ok) return;
        useStaff.getState().appendAuditLog('MODULE_LOCK_ON', key, { module: key, hours: 4 });
        useToastStore.getState().showToast(info(key).label, 'En mantenimiento. Los demás quedan en solo lectura.', 'success');
        // El motivo se escribe en el cuadro que acaba de aparecer.
        setTimeout(() => motivoRef.current[key]?.focus(), 80);
    }, [aplicar]);

    const apagar = useCallback(async () => {
        const key = aLiberar;
        setALiberar(null);
        if (!key) return;
        setBusy(key);
        const { error } = await unlockModule(key);
        setBusy(null);
        if (error) { useToastStore.getState().showToast(info(key).label, translateLockError(error.message), 'error'); return; }
        useStaff.getState().appendAuditLog('MODULE_LOCK_OFF', key, { module: key });
        useToastStore.getState().showToast(info(key).label, 'Mantenimiento terminado. Ya se puede editar.', 'success');
        setMotivoDraft(d => ({ ...d, [key]: undefined }));
        refreshModuleLocks();
    }, [aLiberar, refreshModuleLocks]);

    const guardarMotivo = useCallback(async (key, lock) => {
        const nuevo = (motivoDraft[key] ?? '').trim();
        if (nuevo === (lock.reason ?? '')) return;
        const ok = await aplicar(key, { reason: nuevo || null, hours: Number(horasDe(lock)) });
        if (ok) useStaff.getState().appendAuditLog('MODULE_LOCK_ON', key, { module: key, reason: nuevo || null, edit: 'motivo' });
    }, [motivoDraft, aplicar]);

    const cambiarHoras = useCallback(async (key, lock, horas) => {
        const ok = await aplicar(key, { reason: lock.reason ?? null, hours: Number(horas) });
        if (ok) useStaff.getState().appendAuditLog('MODULE_LOCK_ON', key, { module: key, hours: Number(horas), edit: 'duracion' });
    }, [aplicar]);

    const filtersContent = (
        <ViewTabBar
            tabs={[]}
            showSearch
            searchValue={buscar}
            onSearchChange={setBuscar}
            placeholder="Buscar módulo…"
        />
    );

    return (
        <GlassViewLayout icon={Wrench} title="Mantenimiento" transparentBody filtersContent={filtersContent}>

            {/* El límite del candado, dicho donde se toma la decisión. */}
            <Notice variant="warning" icon={Wrench}>
                <strong>El candado detiene personas, no procesos.</strong> Los syncs automáticos
                siguen escribiendo (DTE, inventario, productos): para frenar uno hay que desactivar
                su job de cron aparte. La única excepción es el recálculo mensual de MIN·MAX, que sí
                lo respeta.
            </Notice>

            {cargando ? (
                <LoadingState variant="content" label="Cargando módulos…" />
            ) : !totalFiltrado ? (
                <EmptyState
                    icon={Wrench}
                    compact
                    title="Ningún módulo coincide"
                    subtitle={`Probá con otro término. Hay ${bloqueables.length} módulos que se pueden poner en mantenimiento.`}
                />
            ) : (
                <div className="flex flex-col gap-5 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-caption text-content-3">
                            {totalFiltrado} de {bloqueables.length} módulos bloqueables
                        </span>
                        {totalActivos > 0 && <Badge variant="warning" size="sm">{totalActivos} en mantenimiento</Badge>}
                    </div>

                    {grupos.map(([grupo, keys]) => (
                        <div key={grupo} className="flex flex-col gap-2">
                            <span className="text-micro font-black uppercase tracking-widest text-content-2 px-1">{grupo}</span>

                            {keys.map(key => {
                                const meta   = info(key);
                                const lock   = activos[key];
                                const activo = !!lock;
                                // isModuleLocked es false cuando el titular soy yo.
                                const esMio  = activo && !isModuleLocked(key);
                                const puedo  = !!rolePerms?.[key]?.can_edit;
                                const Icono  = meta.icon || Lock;

                                return (
                                    <div key={key} data-surface="card" className="p-3.5 flex flex-col gap-3">
                                        <div className="flex items-start gap-3">
                                            <div className="shrink-0 mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center bg-surface-card-hover border border-border-card">
                                                <Icono size={15} className={activo ? 'text-warning-text' : 'text-content-3'} />
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-body-sm font-black text-content">{meta.label}</span>
                                                    {activo && <Badge variant="warning" size="sm">En mantenimiento</Badge>}
                                                    {esMio  && <Badge variant="info"    size="sm">Tuyo</Badge>}
                                                </div>
                                                {meta.desc && <p className="text-caption text-content-3 leading-snug">{meta.desc}</p>}
                                                {activo && (
                                                    <p className="text-caption text-content-2 tabular-nums">
                                                        {lock.locked_by_name} · desde {hora(lock.locked_at)} · vence {hora(lock.expires_at)} · {restante(lock.expires_at)}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="shrink-0 pt-0.5">
                                                <Switch
                                                    checked={activo}
                                                    disabled={busy === key || (!puedo && !activo)}
                                                    onChange={activo ? () => setALiberar(key) : () => encender(key)}
                                                    label={activo
                                                        ? `Terminar el mantenimiento de ${meta.label}`
                                                        : `Poner ${meta.label} en mantenimiento`}
                                                />
                                            </div>
                                        </div>

                                        {/* Los dos cuadros: aparecen al encender y SON el estado del
                                            candado — se editan sobre el candado ya puesto. */}
                                        {activo && (
                                            <div className="flex flex-col sm:flex-row gap-2 sm:pl-11">
                                                <div className="flex-1 min-w-0">
                                                    <PortalInput
                                                        ref={el => { motivoRef.current[key] = el; }}
                                                        value={motivoDraft[key] ?? lock.reason ?? ''}
                                                        onChange={e => setMotivoDraft(d => ({ ...d, [key]: e.target.value }))}
                                                        onBlur={() => guardarMotivo(key, lock)}
                                                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                                        placeholder="Motivo — ¿en qué estás trabajando?"
                                                        aria-label={`Motivo del mantenimiento de ${meta.label}`}
                                                        readOnly={!esMio}
                                                        compact
                                                    />
                                                </div>
                                                <div className="w-full sm:w-44 shrink-0">
                                                    <LiquidSelect
                                                        value={horasDe(lock)}
                                                        onChange={h => cambiarHoras(key, lock, h)}
                                                        options={HORAS}
                                                        icon={Clock}
                                                        clearable={false}
                                                        compact
                                                        disabled={!esMio}
                                                        ariaLabel={`Duración del mantenimiento de ${meta.label}`}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}

            <ConfirmModal
                isOpen={!!aLiberar}
                title={`Terminar el mantenimiento de ${info(aLiberar).label}`}
                message="El equipo vuelve a poder guardar de inmediato."
                confirmText="Terminar"
                isDestructive={false}
                isProcessing={busy === aLiberar}
                onConfirm={apagar}
                onClose={() => setALiberar(null)}
            />
        </GlassViewLayout>
    );
}
