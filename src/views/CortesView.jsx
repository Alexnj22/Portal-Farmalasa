import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Wallet, CheckCircle2, Ban, Clock, ShieldCheck, AlertTriangle } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import TablePagination from '../components/common/TablePagination';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import LiquidModal from '../components/common/LiquidModal';
import PortalTextarea from '../components/common/PortalTextarea';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import { fetchCortes, fetchMovimientos, resolverCorte } from '../data/cortes';
import {
    conTramo, contraste, diferenciaDelCorte, notaDeCifra, severidad, sugerenciasDeCorte,
} from '../utils/cortesDiagnostico';
import { formatMoney } from '../utils/formatNumber';
import { tokenMatch } from '../utils/searchUtils';

const VACIO = [];

// Hora de El Salvador (UTC−6, sin horario de verano). Se calcula así y no con
// la fecha local del equipo porque la fecha del corte es la de la sala: un
// navegador en otro huso mostraría el día equivocado sin avisar.
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

const correrDia = (fecha, dias) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

const rotularFecha = (fecha) =>
    new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });

const hhmm = (hora) => String(hora || '').slice(0, 5);

const TONO_BADGE = { ok: 'success', sobra: 'warning', falta: 'danger' };
const TONO_TEXTO = { ok: 'text-success-text', sobra: 'text-warning-text', falta: 'text-danger-text' };
const ROTULO_SEV = { ok: 'Cuadra', sobra: 'Sobra', falta: 'Falta' };
const TONO_CARD = { ok: undefined, sobra: 'warning', falta: 'danger' };

const MOTIVOS = ['Conteo de prueba', 'Se contó mal', 'Corte repetido'];

const TABS = [
    { key: 'pendientes', label: 'Sin confirmar' },
    { key: 'diferencia', label: 'Con diferencia' },
    { key: 'resueltos',  label: 'Resueltos' },
    { key: 'todos',      label: 'Todos' },
];

const RANGOS = [
    { key: 7,  label: '7 días' },
    { key: 30, label: '30 días' },
    { key: 90, label: '90 días' },
];

/** El monto con su signo explícito: en un control de caja «+3.39» y «3.39» no dicen lo mismo. */
const conSigno = (n) => (n > 0 ? `+${formatMoney(n)}` : formatMoney(n));

const CortesView = () => {
    const branches = useStaff((s) => s.branches) || VACIO;
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);
    const { user, hasPermission } = useAuth();
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');

    const [dias, setDias] = useState(7);
    const [tab, setTab] = useState('pendientes');
    const [busqueda, setBusqueda] = useState('');
    const [sala, setSala] = useState('');
    const [soloZ, setSoloZ] = useState(false);

    const [cortes, setCortes] = useState(VACIO);
    const [cargando, setCargando] = useState(true);

    // ── El detalle y su copia para el cierre ────────────────────────────────
    // `detalle` manda si el modal está abierto; `detalleVisible` es lo que se
    // PINTA. Se separan porque el modal se cierra con animación: si el cuerpo
    // leyera `detalle`, al cerrar el contenido desaparecería ANTES que el modal
    // y se vería un panel vacío por un instante. Al abrir se escriben los dos;
    // al cerrar sólo `detalle`, así lo pintado sobrevive la salida.
    const [detalle, setDetalle] = useState(null);
    const [detalleVisible, setDetalleVisible] = useState(null);
    const [movsDetalle, setMovsDetalle] = useState(VACIO);
    const [modo, setModo] = useState(null);          // 'confirmar' | 'descartar'
    const [motivo, setMotivo] = useState(MOTIVOS[0]);
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);

    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(24);

    const cargar = useCallback(async () => {
        setCargando(true);
        const hasta = hoySV();
        const filas = await fetchCortes({ desde: correrDia(hasta, -(dias - 1)), hasta });
        setCortes(filas || VACIO);
        setCargando(false);
    }, [dias]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + al cambiar el rango

    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches) m[b.id] = b.name;
        return m;
    }, [branches]);

    // El tramo se calcula POR SALA Y POR DÍA, porque los cortes son
    // acumulativos dentro del día y arrancan de cero cada mañana. Mezclar dos
    // días en la misma serie restaría el cierre de ayer contra el primero de
    // hoy y daría un tramo enorme e inventado.
    const conTramoTodos = useMemo(() => {
        const grupos = new Map();
        for (const c of cortes) {
            const k = `${c.branch_id}|${c.fecha}`;
            if (!grupos.has(k)) grupos.set(k, []);
            grupos.get(k).push(c);
        }
        const out = [];
        for (const lista of grupos.values()) {
            const enOrden = [...lista].sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
            out.push(...conTramo(enOrden));
        }
        out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))
            || String(b.hora).localeCompare(String(a.hora)));
        return out;
    }, [cortes]);

    const filtrados = useMemo(() => conTramoTodos.filter((c) => {
        if (sala && String(c.branch_id) !== String(sala)) return false;
        if (soloZ ? c.tipo !== 'Z' : c.tipo !== 'C') return false;

        if (tab === 'pendientes' && c.estado !== 'PENDIENTE') return false;
        if (tab === 'resueltos'  && c.estado === 'PENDIENTE') return false;
        if (tab === 'diferencia' && severidad(c.tramo) === 'ok') return false;

        if (!busqueda.trim()) return true;
        return tokenMatch(busqueda,
            nombreSala[c.branch_id], c.empleado_texto, c.fecha, c.hora,
            String(c.total_declarado ?? ''), String(c.tramo ?? ''),
            String(c.erp_corte_id ?? ''), c.motivo_descarte);
    }), [conTramoTodos, tab, busqueda, sala, soloZ, nombreSala]);

    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
    const pagActual = Math.min(pagina, totalPaginas);
    const enPagina = useMemo(
        () => filtrados.slice((pagActual - 1) * porPagina, pagActual * porPagina),
        [filtrados, pagActual, porPagina],
    );

    const abrirDetalle = useCallback(async (corte) => {
        setDetalleVisible(corte);
        setDetalle(corte);
        setModo(null);
        setMovsDetalle(VACIO);
        const movs = await fetchMovimientos({ branchId: corte.branch_id, fecha: corte.fecha });
        setMovsDetalle(movs || VACIO);
    }, []);

    const cerrarDetalle = useCallback(() => {
        setDetalle(null);
        setModo(null); setNota(''); setMotivo(MOTIVOS[0]);
    }, []);

    const sugerencias = useMemo(
        () => (detalleVisible ? sugerenciasDeCorte(detalleVisible, movsDetalle) : VACIO),
        [detalleVisible, movsDetalle],
    );
    const explicacion = useMemo(
        () => (detalleVisible ? notaDeCifra(detalleVisible) : null),
        [detalleVisible],
    );

    const resolver = useCallback(async () => {
        if (!detalleVisible || !modo) return;
        setGuardando(true);
        const estado = modo === 'confirmar' ? 'CONFIRMADO' : 'DESCARTADO';
        const { error } = await resolverCorte(detalleVisible.id, estado, {
            motivo: modo === 'descartar' ? motivo : null,
            observaciones: nota,
        });
        setGuardando(false);
        if (error) {
            showToast?.('No se pudo guardar', error.message || 'Vuelve a intentar en un momento.', 'error');
            return;
        }
        appendAuditLog?.(estado === 'CONFIRMADO' ? 'CORTE_CAJA_CONFIRMADO' : 'CORTE_CAJA_DESCARTADO', user?.id, {
            corte_id: detalleVisible.id,
            sucursal: nombreSala[detalleVisible.branch_id],
            fecha: detalleVisible.fecha, hora: detalleVisible.hora,
            diferencia: detalleVisible.tramo,
            motivo: modo === 'descartar' ? motivo : undefined,
        });
        showToast?.(
            estado === 'CONFIRMADO' ? 'Corte confirmado' : 'Corte descartado',
            `${nombreSala[detalleVisible.branch_id]} · ${hhmm(detalleVisible.hora)}`,
            'success',
        );
        cerrarDetalle();
        cargar();
    }, [detalleVisible, modo, motivo, nota, showToast, appendAuditLog, user, nombreSala, cerrarDetalle, cargar]);

    const salaOptions = useMemo(
        () => branches
            .filter((b) => cortes.some((c) => String(c.branch_id) === String(b.id)))
            .map((b) => ({ value: String(b.id), label: b.name })),
        [branches, cortes],
    );

    const limpiar = () => { setSala(''); setSoloZ(false); setDias(7); setBusqueda(''); setPagina(1); };

    const filtersContent = (
        <>
            <ViewTabBar
                tabs={TABS}
                activeTab={tab}
                onTabChange={(t) => { setTab(t); setPagina(1); }}
                searchValue={busqueda}
                onSearchChange={(v) => { setBusqueda(v); setPagina(1); }}
                placeholder="Buscar por sala, persona, hora o monto…"
            />
            <FilterBar onClear={limpiar} activeCount={[sala, soloZ, dias !== 7].filter(Boolean).length}>
                <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                    <FilterBar.Sucursal value={sala} onChange={(v) => { setSala(v); setPagina(1); }} options={salaOptions} />
                </FilterBar.Section>

                <FilterBar.Section label="período">
                    {RANGOS.map((r) => (
                        <FilterBar.Chip key={r.key} tone="brand" active={dias === r.key}
                            onToggle={() => { setDias(r.key); setPagina(1); }}>
                            {r.label}
                        </FilterBar.Chip>
                    ))}
                </FilterBar.Section>

                <FilterBar.Section>
                    <FilterBar.Chip tone="brand" active={soloZ} onToggle={() => { setSoloZ((v) => !v); setPagina(1); }}>
                        Cierres del día
                    </FilterBar.Chip>
                </FilterBar.Section>
            </FilterBar>
        </>
    );

    return (
        <GlassViewLayout icon={Wallet} title="Cortes de caja" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-4">

                {cargando && <LoadingState label="Buscando los cortes" />}

                {!cargando && filtrados.length === 0 && (
                    <EmptyState
                        icon={Wallet}
                        message={busqueda ? 'Nada con esa búsqueda' : 'Sin cortes acá'}
                        subtext={busqueda
                            ? 'Prueba con el nombre de la sala, la persona o el monto.'
                            : 'Cambia de pestaña o amplía el período para ver más.'}
                    />
                )}

                {!cargando && filtrados.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {enPagina.map((c) => {
                            const esZ = c.tipo === 'Z';
                            const desc = c.estado === 'DESCARTADO';
                            const sev = severidad(c.tramo);
                            const ct = contraste(c);
                            const revisarCifras = !!ct?.enDisputa && !ct.porCobrosCredito;
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    data-surface="card"
                                    data-tono={desc || esZ ? undefined : TONO_CARD[sev]}
                                    className="p-4 text-left w-full"
                                    onClick={() => abrirDetalle(c)}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-label font-bold text-content">
                                            {nombreSala[c.branch_id] || `Sucursal ${c.branch_id}`}
                                        </span>
                                        {esZ
                                            ? <Badge variant="info" size="sm">Cierre del día</Badge>
                                            : <Badge variant={TONO_BADGE[sev]} size="sm">{ROTULO_SEV[sev]}</Badge>}
                                    </div>

                                    <div className="text-caption text-content-3 mt-0.5 truncate">
                                        {rotularFecha(c.fecha)} · {hhmm(c.hora)}
                                        {c.empleado_texto ? ` · ${c.empleado_texto}` : ''}
                                    </div>

                                    {esZ ? (
                                        <div className="mt-2 text-body font-bold text-content-2 tabular-nums">
                                            {formatMoney(c.total_declarado)}
                                            <span className="text-caption font-normal text-content-3"> en ventas</span>
                                        </div>
                                    ) : (
                                        <div className={`mt-2 text-2xl font-bold tabular-nums ${desc ? 'text-content-3 line-through' : TONO_TEXTO[sev]}`}>
                                            {conSigno(desc ? diferenciaDelCorte(c).valor : (c.tramo ?? 0))}
                                        </div>
                                    )}

                                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                        {c.estado === 'CONFIRMADO' && <Badge variant="success" size="sm" icon={CheckCircle2}>Confirmado</Badge>}
                                        {desc && <Badge variant="neutral" size="sm" icon={Ban}>Descartado</Badge>}
                                        {c.estado === 'PENDIENTE' && !esZ && <Badge variant="neutral" size="sm" icon={Clock}>Sin confirmar</Badge>}
                                        {revisarCifras && <Badge variant="danger" size="sm" icon={AlertTriangle}>Revisar cifras</Badge>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {!cargando && filtrados.length > porPagina && (
                    <TablePagination
                        page={pagActual}
                        totalPages={totalPaginas}
                        onPageChange={setPagina}
                        pageSize={porPagina}
                        onPageSizeChange={(v) => { setPorPagina(Number(v)); setPagina(1); }}
                        total={filtrados.length}
                        unit="cortes"
                    />
                )}
            </div>

            {/* ── El detalle de un corte ─────────────────────────────────── */}
            <LiquidModal
                open={!!detalle}
                onClose={cerrarDetalle}
                maxWidth="max-w-2xl"
                className="max-h-[88vh] h-fit"
                ariaLabel={`Corte de las ${hhmm(detalleVisible?.hora)}`}
            >
                <LiquidModal.Header>
                    <div className="min-w-0">
                        <h3 className="text-body font-bold text-content">
                            Corte de las {hhmm(detalleVisible?.hora)}
                        </h3>
                        <p className="text-caption text-content-3 truncate">
                            {nombreSala[detalleVisible?.branch_id]}
                            {detalleVisible?.fecha ? ` · ${rotularFecha(detalleVisible.fecha)}` : ''}
                            {detalleVisible?.empleado_texto ? ` · ${detalleVisible.empleado_texto}` : ''}
                        </p>
                    </div>
                </LiquidModal.Header>

                <LiquidModal.Body className="space-y-4">
                    {detalleVisible && (
                        <>
                            <div data-surface="card"
                                data-tono={severidad(detalleVisible.tramo) === 'ok' ? undefined
                                    : severidad(detalleVisible.tramo) === 'falta' ? 'danger' : 'warning'}
                                className="p-4">
                                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                    <span className="text-caption text-content-2">
                                        {detalleVisible.tramo === detalleVisible.acumulado
                                            ? 'Diferencia de este corte'
                                            : 'Diferencia desde el corte anterior'}
                                    </span>
                                    <span className={`text-2xl font-bold tabular-nums ${TONO_TEXTO[severidad(detalleVisible.tramo)]}`}>
                                        {conSigno(detalleVisible.tramo ?? 0)}
                                    </span>
                                </div>
                                <div className="mt-2 space-y-1 text-caption text-content-3">
                                    <div className="flex justify-between gap-3">
                                        <span>Debía haber en caja</span>
                                        <span className="tabular-nums">{formatMoney(detalleVisible.esperadoUsado ?? detalleVisible.esperado)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <span>Se contó</span>
                                        <span className="tabular-nums">{formatMoney(detalleVisible.total_declarado)}</span>
                                    </div>
                                    {detalleVisible.tramo !== detalleVisible.acumulado && (
                                        <div className="flex justify-between gap-3">
                                            <span>Acumulado del día hasta esta hora</span>
                                            <span className="tabular-nums">{conSigno(detalleVisible.acumulado ?? 0)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {explicacion && (
                                <Notice variant={explicacion.tono === 'danger' ? 'danger' : 'info'}
                                    icon={explicacion.tono === 'danger' ? AlertTriangle : undefined}>
                                    <span className="font-bold">{explicacion.titulo}</span>
                                    <span className="block mt-0.5 font-normal text-content-2">{explicacion.detalle}</span>
                                </Notice>
                            )}

                            {severidad(detalleVisible.tramo) === 'ok' && detalleVisible.estado === 'PENDIENTE' && detalleVisible.tipo === 'C' && (
                                <Notice variant="success" icon={ShieldCheck}>
                                    Este corte cuadra al centavo. No hay nada que investigar.
                                </Notice>
                            )}

                            {detalleVisible.estado !== 'PENDIENTE' && (
                                <Notice variant="info">
                                    {detalleVisible.estado === 'CONFIRMADO'
                                        ? 'Corte confirmado'
                                        : `Descartado: ${detalleVisible.motivo_descarte}`}
                                    {detalleVisible.observaciones ? ` · ${detalleVisible.observaciones}` : ''}
                                </Notice>
                            )}

                            {sugerencias.length > 0 && (
                                <div>
                                    <div className="text-caption font-bold uppercase tracking-wide text-content-3 mb-1.5">Qué revisar</div>
                                    <div className="space-y-2">
                                        {sugerencias.map((s, i) => (
                                            <Notice key={i} variant={s.tono === 'danger' ? 'danger' : s.tono === 'warning' ? 'warning' : 'info'}>
                                                <span className="font-bold">{s.titulo}</span>
                                                <span className="block mt-0.5 font-normal text-content-2">{s.detalle}</span>
                                            </Notice>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {detalleVisible.estado === 'PENDIENTE' && puedeResolver && modo && (
                                <div className="space-y-3">
                                    {modo === 'descartar' && (
                                        <div>
                                            <div className="text-caption font-bold uppercase tracking-wide text-content-3 mb-1.5">
                                                Motivo del descarte
                                            </div>
                                            <div className="flex gap-2 flex-wrap">
                                                {MOTIVOS.map((m) => (
                                                    <Button key={m} variant={motivo === m ? 'danger' : 'secondary'} size="sm"
                                                        onClick={() => setMotivo(m)}>
                                                        {m}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <PortalTextarea
                                        label={modo === 'confirmar' ? 'Observación (opcional)' : 'Detalle (opcional)'}
                                        name="nota"
                                        value={nota}
                                        onChange={(e) => setNota(e.target.value)}
                                        rows={2}
                                        placeholder={modo === 'confirmar'
                                            ? 'Qué se encontró, o por qué se acepta la diferencia'
                                            : 'Algo que ayude a entender el descarte'}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </LiquidModal.Body>

                <LiquidModal.Footer>
                    {detalleVisible?.estado === 'PENDIENTE' && detalleVisible?.tipo === 'C' && puedeResolver ? (
                        modo ? (
                            <>
                                <Button variant="ghost" onClick={() => setModo(null)} disabled={guardando}>Volver</Button>
                                <Button variant={modo === 'confirmar' ? 'primary' : 'destructive'}
                                    onClick={resolver} loading={guardando}>
                                    {modo === 'confirmar' ? 'Confirmar corte' : 'Descartar corte'}
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button variant="secondary" icon={Ban} onClick={() => setModo('descartar')}>Descartar</Button>
                                <Button variant="primary" icon={CheckCircle2} onClick={() => setModo('confirmar')}>Confirmar</Button>
                            </>
                        )
                    ) : (
                        <Button variant="secondary" onClick={cerrarDetalle}>Cerrar</Button>
                    )}
                </LiquidModal.Footer>
            </LiquidModal>
        </GlassViewLayout>
    );
};

export default CortesView;
