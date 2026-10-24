import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gem, Inbox, ListChecks, History, Users, Check, X, ArrowUpDown, LogOut, Send, Undo2 } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidModal from '../../components/common/LiquidModal';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { LoadingState, EmptyState } from '../../components/common/StateViews';
import PersonaConFoto from '../../components/caja/PersonaConFoto';
import usePestanaEnUrl from '../../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { ORDENES_MAYORISTAS, accionesDeMayorista, filasDeMayoristas, solicitudesPendientes, textoDeAccion } from '@nucleo/utils/mayoristas';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { formatMoney } from '@nucleo/utils/formatNumber';
import {
    ESTADOS, ORIGENES, PRECIOS, RANGOS,
    fetchDetalleMayorista, fetchHistorialMayoristas, fetchMayoristas, proponerMayorista, resolverMayorista,
} from '@nucleo/data/mayoristas';

/**
 * Clientes Mayoristas (2026-10-08) — Condiciones del Cliente Mayorista y
 * Procedimiento de Clientes, vigentes desde el 15-oct-2026 (docs/legal).
 *
 *   · Solicitudes: las que hizo el cliente desde la app o un dependiente desde
 *     aquí. Administración aprueba con un precio o rechaza con motivo; quien
 *     aprueba no puede ser quien pidió (lo frena la base).
 *   · Candidatos: quien compró a precio de mayoreo (Mayoreo o Mayoreo Plus por
 *     debajo del Preferente) en los últimos 6 meses, más las fichas con
 *     «(4)»/«(5)» en el nombre, con lo que pide la cláusula 2.3 (promedio de
 *     $100/mes o una factura de $500) a la vista. Desde el 2026-10-19 quien
 *     aprueba los decide uno por uno desde aquí —aprobar o no aprobar, sin
 *     solicitud previa y sin nada automático—; «no aprobar» no le avisa al
 *     cliente (no pidió nada) y lo saca de la lista.
 *   · Bajar de Mayoreo Plus a Mayoreo y retirar rigen 15 días después del aviso
 *     (Condiciones §6); hasta entonces se pueden cancelar.
 *   · Quién decidió se ve con foto y nombre corto (canon del portal).
 *   · Mayoristas: los aprobados, con su precio y su rango del mes.
 *   · Historial: todo lo que pasó, de un solo lugar, para evaluar.
 *
 * El margen, la regularidad y la antigüedad son de uso interno (Procedimiento
 * §4): no se le mencionan al cliente.
 */
const PASO = 100;

export default function MayoristasView() {
    const { hasPermission } = useAuth();
    const puedeProponer = hasPermission('mayoristas', 'can_edit');
    const puedeAprobar = hasPermission('mayoristas', 'can_approve');
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [abierto, setAbierto] = useState(null);

    const cargar = useCallback(async () => {
        try { setFilas(await fetchMayoristas()); setError(null); }
        catch (err) { setError(mensajeAmigable(err, 'No se pudo cargar la lista.')); }
    }, []);
    useEffect(() => {
        fetchMayoristas().then(setFilas).catch((err) => setError(mensajeAmigable(err, 'No se pudo cargar la lista.')));
    }, []);

    const solicitudes = solicitudesPendientes(filas);
    const tabs = useMemo(() => [
        { key: 'solicitudes', label: 'Solicitudes', icon: Inbox, badge: solicitudes.length || undefined },
        { key: 'candidatos', label: 'Candidatos', icon: ListChecks },
        { key: 'mayoristas', label: 'Mayoristas', icon: Gem },
        { key: 'historial', label: 'Historial', icon: History },
    ], [solicitudes.length]);
    const [tab, setTab] = usePestanaEnUrl(tabs, 'solicitudes');

    return (
        <GlassViewLayout icon={Gem} title="Clientes Mayoristas" filtersContent={(
            <ViewTabBar tabs={tabs} activeTab={tab} onTabChange={setTab}
                searchValue={busqueda} onSearchChange={setBusqueda} placeholder="Buscar por nombre o documento…" />
        )} transparentBody>
            <div className="p-4 md:p-6 space-y-4">
                {error && <Notice variant="danger">{error}</Notice>}
                {!filas && !error ? <LoadingState label="Cargando clientes" /> : null}
                {filas && tab === 'historial' && <Historial busqueda={busqueda} onAbrir={(id) => setAbierto(filas.find((f) => f.customer_id === id) ?? { customer_id: id })} />}
                {filas && tab !== 'historial' && (
                    <Lista tab={tab} filas={filas} busqueda={busqueda} onAbrir={setAbierto} />
                )}
            </div>
            {abierto && (
                <Detalle cliente={abierto} puedeProponer={puedeProponer} puedeAprobar={puedeAprobar}
                    onClose={() => setAbierto(null)}
                    onCambio={async (msg) => { showToast(msg, '', 'success'); setAbierto(null); await cargar(); }} />
            )}
        </GlassViewLayout>
    );
}

function Lista({ tab, filas, busqueda, onAbrir }) {
    // Candidatos (2026-10-19): por defecto TODOS los que compraron a mayoreo en
    // 6 meses, para decidirlos uno por uno; «cumplen» es un filtro, no la lista.
    const [soloCumplen, setSoloCumplen] = useState(false);
    const [soloConNombre, setSoloConNombre] = useState(false);
    const [verDescartados, setVerDescartados] = useState(false);
    const [orden, setOrden] = useState('mayoreo');
    const [ver, setVer] = useState(PASO);
    const lista = filasDeMayoristas(filas, { tab, busqueda, soloCumplen, orden, soloConNombre, verDescartados });
    const visibles = lista.slice(0, ver);
    const esCandidatos = tab === 'candidatos';
    const filtrosActivos = esCandidatos ? [soloCumplen, soloConNombre, verDescartados].filter(Boolean).length : 0;
    const limpiar = () => { setSoloCumplen(false); setSoloConNombre(false); setVerDescartados(false); };

    return (
        <>
            {esCandidatos && (
                <Notice variant="info">
                    Les vendieron a precio de mayoreo en los últimos 6 meses, o tienen «(4)»/«(5)» en el nombre de la ficha. Cada uno se aprueba o no
                    a mano: nadie entra solo. La cláusula 2.3 pide <b>promedio de $100 al mes</b> en los últimos 3 meses o <b>una factura de $500</b>,
                    con la ficha completa.
                </Notice>
            )}
            <div className="flex justify-end">
                <FilterBar activeCount={filtrosActivos} onClear={filtrosActivos ? limpiar : undefined}>
                    {esCandidatos && (
                        <FilterBar.Section label="requisito" active={soloCumplen} onClear={() => setSoloCumplen(false)}>
                            <FilterBar.Opciones value={soloCumplen ? 'cumplen' : 'todos'} onChange={(v) => setSoloCumplen(v === 'cumplen')} label="Requisito" umbral={0}
                                options={[{ value: 'todos', label: 'Todos los que compraron a mayoreo' }, { value: 'cumplen', label: 'Cumplen el requisito' }]} />
                        </FilterBar.Section>
                    )}
                    {esCandidatos && (
                        <FilterBar.Section label="ficha" active={soloConNombre} onClear={() => setSoloConNombre(false)}>
                            <FilterBar.Opciones value={soloConNombre ? 'nombre' : 'todas'} onChange={(v) => setSoloConNombre(v === 'nombre')} label="Ficha" umbral={0}
                                options={[{ value: 'todas', label: 'Todas las fichas' }, { value: 'nombre', label: 'Con «(4)» o «(5)» en el nombre' }]} />
                        </FilterBar.Section>
                    )}
                    {esCandidatos && (
                        <FilterBar.Section label="no aprobados" active={verDescartados} onClear={() => setVerDescartados(false)}>
                            <FilterBar.Opciones value={verDescartados ? 'ver' : 'ocultar'} onChange={(v) => setVerDescartados(v === 'ver')} label="No aprobados" umbral={0}
                                options={[{ value: 'ocultar', label: 'Ocultar los no aprobados' }, { value: 'ver', label: 'Mostrar también los no aprobados' }]} />
                        </FilterBar.Section>
                    )}
                    <FilterBar.Section label="orden" active={orden !== 'mayoreo'} onClear={() => setOrden('mayoreo')}>
                        <FilterBar.Opciones value={orden} onChange={(v) => setOrden(v || 'mayoreo')} label="Ordenar" umbral={0}
                            options={ORDENES_MAYORISTAS} />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            <DataTable
                columns={esCandidatos ? [
                    { key: 'cliente', label: 'Cliente' },
                    { key: 'total', label: 'Comprado (6 m)', align: 'right' },
                    { key: 'facturas', label: 'Facturas', align: 'right', hideBelow: 'sm' },
                    { key: 'ultima', label: 'Última compra', hideBelow: 'md' },
                    { key: 'rango', label: 'Rango que tendría', hideBelow: 'sm' },
                    { key: 'estado', label: 'Estado' },
                ] : [
                    { key: 'cliente', label: 'Cliente' },
                    { key: 'prom', label: 'Promedio 3 meses', align: 'right' },
                    { key: 'mayoreo', label: 'A mayoreo (6 m)', align: 'right', hideBelow: 'sm' },
                    { key: 'estado', label: tab === 'mayoristas' ? 'Precio · rango' : 'Estado' },
                    { key: 'ultima', label: 'Última compra', hideBelow: 'md' },
                ]}
                movil={{ usarAccionDeFila: true }}
                empty={{ icon: tab === 'solicitudes' ? Inbox : Users, message: tab === 'solicitudes' ? 'No hay solicitudes por resolver' : 'Nadie con ese filtro' }}
                minWidth="720px">
                {visibles.map((f, i) => esCandidatos ? (
                    <DataRow key={f.customer_id} index={i} onClick={() => onAbrir(f)}>
                        <DataCell>
                            <div className="min-w-0">
                                <p className="text-body-sm font-semibold text-content truncate">{f.nombre}</p>
                                <p className="text-micro text-content-3 truncate">
                                    {[f.documento, f.precio_en_nombre ? `${PRECIOS[f.precio_en_nombre]} en el nombre` : null,
                                        f.a_mayoreo > 0 ? `${formatMoney(f.a_mayoreo)} a mayoreo` : null, f.ficha_completa ? null : 'Ficha incompleta'].filter(Boolean).join(' · ') || '—'}
                                </p>
                            </div>
                        </DataCell>
                        <DataCell align="right"><span className="text-body-sm font-semibold text-content">{formatMoney(f.total)}</span></DataCell>
                        <DataCell align="right"><span className="text-body-sm text-content-2">{f.facturas}</span></DataCell>
                        <DataCell>
                            <span className="text-body-sm text-content-2">{f.ultima_compra ? fechaTexto(f.ultima_compra, { day: 'numeric', month: 'short' }) : '—'}</span>
                        </DataCell>
                        <DataCell><span className="text-body-sm text-content-2">{RANGOS[f.rango_sugerido]?.nombre ?? '—'}</span></DataCell>
                        <DataCell>
                            {f.estado ? <Badge variant={ESTADOS[f.estado]?.variant}>{ESTADOS[f.estado]?.label}</Badge>
                                : <Badge variant={f.cumple ? 'info' : 'neutral'}>{f.cumple ? 'Cumple' : 'No cumple aún'}</Badge>}
                        </DataCell>
                    </DataRow>
                ) : (
                    <DataRow key={f.customer_id} index={i} onClick={() => onAbrir(f)}>
                        <DataCell>
                            <div className="min-w-0">
                                <p className="text-body-sm font-semibold text-content truncate">{f.nombre}</p>
                                <p className="text-micro text-content-3 truncate">
                                    {[f.documento, f.estado === 'solicitado' ? ORIGENES[f.origen] : null, f.ficha_completa ? null : 'Ficha incompleta'].filter(Boolean).join(' · ') || '—'}
                                </p>
                            </div>
                        </DataCell>
                        <DataCell align="right">
                            <span className={`text-body-sm font-semibold ${f.cumple ? 'text-content' : 'text-content-3'}`}>{formatMoney(f.prom_3m)}</span>
                        </DataCell>
                        <DataCell align="right"><span className="text-body-sm text-content-2">{formatMoney(f.a_mayoreo)}</span></DataCell>
                        <DataCell>
                            {tab === 'mayoristas' ? (
                                <span className="text-body-sm text-content-2">
                                    {PRECIOS[f.precio]} · {RANGOS[f.rango]?.nombre ?? '—'}{f.retiro_programado ? ` · se retira el ${fechaTexto(f.retiro_programado, { day: 'numeric', month: 'short' })}` : ''}
                                    {!f.retiro_programado && f.precio_programado_el ? ` · pasa a Mayoreo el ${fechaTexto(f.precio_programado_el, { day: 'numeric', month: 'short' })}` : ''}
                                </span>
                            ) : f.estado ? <Badge variant={ESTADOS[f.estado]?.variant}>{ESTADOS[f.estado]?.label}</Badge>
                                : <Badge variant={f.cumple ? 'info' : 'neutral'}>{f.cumple ? 'Cumple' : 'No cumple aún'}</Badge>}
                        </DataCell>
                        <DataCell>
                            <span className="text-body-sm text-content-2">{f.ultima_compra ? fechaTexto(f.ultima_compra, { day: 'numeric', month: 'short' }) : '—'}</span>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            {lista.length > ver && (
                <div className="flex justify-center">
                    <Button variant="secondary" onClick={() => setVer((v) => v + PASO)}>Mostrar {Math.min(PASO, lista.length - ver)} más de {lista.length}</Button>
                </div>
            )}
        </>
    );
}

function Historial({ busqueda, onAbrir }) {
    const [filas, setFilas] = useState(null);
    useEffect(() => { fetchHistorialMayoristas().then(setFilas).catch(() => setFilas([])); }, []);
    if (!filas) return <LoadingState label="Cargando historial" />;
    const lista = filas.filter((h) => !busqueda || tokenMatch(h.customers?.name ?? '', busqueda));
    if (!lista.length) return <EmptyState icon={History} title="Sin movimientos" subtitle="Aquí queda cada solicitud, aprobación, cambio de precio y retiro." />;
    return (
        <DataTable
            columns={[{ key: 'cuando', label: 'Cuándo' }, { key: 'cliente', label: 'Cliente' }, { key: 'que', label: 'Qué pasó' }, { key: 'quien', label: 'Quién', hideBelow: 'sm' }]}
            movil={{ usarAccionDeFila: true }} minWidth="680px">
            {lista.map((h, i) => (
                <DataRow key={h.id} index={i} onClick={() => onAbrir(h.customer_id)}>
                    <DataCell><span className="text-body-sm text-content-2">{fechaHora12(h.created_at, { day: 'numeric', month: 'short' })}</span></DataCell>
                    <DataCell><span className="text-body-sm font-semibold text-content">{h.customers?.name ?? '—'}</span></DataCell>
                    <DataCell>
                        <span className="text-body-sm text-content-2">{textoDeAccion(h)}{h.nota ? ` — «${h.nota}»` : ''}</span>
                    </DataCell>
                    <DataCell>
                        {h.employees?.name ? <PersonaConFoto id={h.employees.id} nombre={h.employees.name} px={20} />
                            : <span className="text-body-sm text-content-2">{h.origen === 'app' ? 'El cliente (app)' : 'Sistema'}</span>}
                    </DataCell>
                </DataRow>
            ))}
        </DataTable>
    );
}


function Detalle({ cliente, puedeProponer, puedeAprobar, onClose, onCambio }) {
    const { user } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const appendAuditLog = useStaff((st) => st.appendAuditLog);
    const [d, setD] = useState(null);
    // Aprobado o en revisión: su precio. Candidato (o no aprobado antes): el sugerido —«(5)» en el nombre = Mayoreo Plus—.
    const [precio, setPrecio] = useState((['aprobado', 'solicitado'].includes(cliente.estado) ? cliente.precio : cliente.precio_sugerido) ?? 'mayoreo');
    const [nota, setNota] = useState('');
    const [ocupado, setOcupado] = useState(false);
    useEffect(() => {
        fetchDetalleMayorista(cliente.customer_id).then(setD).catch((err) => showToast('No se pudo cargar', mensajeAmigable(err, ''), 'error'));
    }, [cliente.customer_id, showToast]);

    const { esSolicitante, proponer, decidir, resolver: resolverSolicitud, gestionar, cancelar } = accionesDeMayorista(cliente, { puedeProponer, puedeAprobar, userId: user?.id });
    // Quien aprueba decide al candidato directamente; proponer queda para quien no aprueba.
    const puedeAbrirSolicitud = proponer && !decidir;
    // Bajar de Mayoreo Plus a Mayoreo rige a los 15 días y se le avisa: pide motivo (§6).
    const esBajada = gestionar && cliente.precio === 'mayoreo_plus' && precio === 'mayoreo';
    const correr = async (accion, fn, mensaje) => {
        setOcupado(true);
        try {
            await fn();
            appendAuditLog?.(`MAYORISTA_${accion.toUpperCase()}`, String(cliente.customer_id), { precio, nota })?.catch?.(() => {});
            onCambio(mensaje);
        } catch (err) {
            showToast('No se pudo', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally { setOcupado(false); }
    };

    const est = cliente.estado;
    const meses = d?.meses ?? [];

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-3xl" ariaLabel="Detalle del cliente mayorista">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h2 className="text-body-xl font-semibold text-content truncate">{cliente.nombre ?? 'Cliente'}</h2>
                    <p className="text-caption text-content-3">
                        {[cliente.documento, cliente.telefono, est ? ESTADOS[est]?.label : null,
                            est === 'aprobado' ? `${PRECIOS[cliente.precio]} · ${RANGOS[d?.rango ?? cliente.rango]?.nombre ?? 'Jade'}` : null].filter(Boolean).join(' · ')}
                    </p>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    {!cliente.ficha_completa && cliente.ficha_completa !== undefined && (
                        <Notice variant="warning">
                            {cliente.falta_correo
                                ? 'A una empresa o institución le falta el correo electrónico en su ficha (Condiciones §2.4). Hay que completarlo antes de aprobar.'
                                : 'La ficha no está completa (documento o teléfono). Hay que completarla antes de aprobar.'}
                        </Notice>
                    )}
                    {cliente.resuelto_por && est && est !== 'solicitado' && (
                        <div className="flex flex-wrap items-center gap-2 text-body-sm text-content-2">
                            <span>{est === 'aprobado' ? 'Última decisión' : ESTADOS[est]?.label}:</span>
                            <PersonaConFoto id={cliente.resuelto_por_id} nombre={cliente.resuelto_por} px={22}
                                detalle={cliente.resuelto_at ? fechaTexto(cliente.resuelto_at, { day: 'numeric', month: 'short', year: 'numeric' }) : null} />
                            {cliente.motivo && est !== 'aprobado' ? <span className="text-content-3">— «{cliente.motivo}»</span> : null}
                        </div>
                    )}
                    {est === 'aprobado' && (cliente.retiro_programado || cliente.precio_programado_el) && (
                        <Notice variant="warning">
                            {cliente.retiro_programado
                                ? `Retiro avisado: deja de ser Cliente Mayorista el ${fechaTexto(cliente.retiro_programado, { day: 'numeric', month: 'long' })}.`
                                : `Bajada avisada: pasa a precio Mayoreo el ${fechaTexto(cliente.precio_programado_el, { day: 'numeric', month: 'long' })}.`}
                            {' '}{cliente.retiro_por_inactividad
                                ? 'Es por seis meses sin compras (Condiciones §2.5): si vuelve a comprar antes, se cancela solo.'
                                : 'Rige 15 días después del aviso (Condiciones §6); hasta entonces se puede cancelar.'}
                        </Notice>
                    )}
                    {est === 'solicitado' && (
                        <Notice variant="info">
                            {ORIGENES[cliente.origen]} el {fechaTexto(cliente.solicitado_at, { day: 'numeric', month: 'short' })}
                            {cliente.nota_solicitud ? ` — «${cliente.nota_solicitud}»` : ''}.
                            {cliente.vence_respuesta ? ` Hay que responderle a más tardar el ${fechaTexto(cliente.vence_respuesta, { day: 'numeric', month: 'long' })} (cinco días hábiles, Condiciones §2.4).` : ''}
                            {' '}{esSolicitante ? 'Tú la hiciste: la tiene que resolver otra persona.' : ''}
                            {cliente.solicitado_por ? (
                                <span className="mt-1.5 flex"><PersonaConFoto id={cliente.solicitado_por_id} nombre={cliente.solicitado_por} px={20} detalle="Lo propuso" /></span>
                            ) : null}
                        </Notice>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <Dato titulo="Promedio 3 meses" valor={formatMoney(cliente.prom_3m ?? 0)}
                            nota={cliente.cumple ? 'Cumple el requisito: $100/mes o una factura de $500' : 'No cumple: $100/mes o una factura de $500'} />
                        {d?.umbrales?.elegibles && (
                            <Dato titulo="Elegible para el rango" valor={formatMoney(cliente.prom_3m_elegible ?? 0)}
                                nota={`Sin telefonía, bebidas ni lo vendido bajo su precio · ${RANGOS[cliente.rango_sugerido]?.nombre ?? 'Jade'}`} />
                        )}
                        <Dato titulo="A mayoreo (6 meses)" valor={formatMoney(cliente.a_mayoreo ?? 0)} nota={`${cliente.facturas_mayoreo ?? 0} facturas`} />
                        <Dato titulo="Mayor factura" valor={formatMoney(cliente.mayor_factura ?? 0)} />
                        <Dato titulo="Margen (interno)" valor={cliente.margen != null ? `${cliente.margen} %` : '—'} nota="No se le menciona al cliente" />
                        <Dato titulo="Regularidad" valor={`${cliente.meses_con_compra ?? 0} de 6 meses`} />
                        <Dato titulo="Antigüedad" valor={cliente.primera_compra ? `desde ${fechaTexto(cliente.primera_compra, { month: 'short', year: 'numeric' })}` : '—'} />
                    </div>

                    <section className="space-y-1.5">
                        <h3 className="text-label font-semibold text-content-2">Compras por mes</h3>
                        {!d ? <LoadingState label="Cargando" /> : (
                            <div className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
                                {meses.slice(-7).map((m) => (
                                    <div key={m.mes} className="flex items-center justify-between gap-3 px-3 py-2 text-body-sm">
                                        <span className="text-content-2 w-24">{fechaTexto(m.mes, { month: 'long', year: 'numeric' })}</span>
                                        <span className="text-content flex-1 text-right">{formatMoney(m.total)}</span>
                                        <span className="text-content-3 flex-1 text-right">
                                            {d?.umbrales?.elegibles ? `elegible ${formatMoney(m.elegible ?? 0)}` : `a mayoreo ${formatMoney(m.a_mayoreo)}`}
                                        </span>
                                        <span className="text-content-3 w-24 text-right">{m.facturas} fact.</span>
                                    </div>
                                ))}
                                {!meses.length && <p className="px-3 py-2 text-body-sm text-content-3">Sin compras en los últimos meses.</p>}
                            </div>
                        )}
                    </section>

                    {d?.historial?.length > 0 && (
                        <section className="space-y-1.5">
                            <h3 className="text-label font-semibold text-content-2">Historial</h3>
                            <ul className="space-y-1">
                                {d.historial.map((h, i) => (
                                    <li key={i} className="text-body-sm text-content-2">
                                        <span className="text-content-3">{fechaTexto(h.cuando, { day: 'numeric', month: 'short', year: 'numeric' })} · </span>
                                        {textoDeAccion(h)}{h.nota ? ` — «${h.nota}»` : ''}
                                        {h.por ? <span className="ml-2 inline-flex align-middle"><PersonaConFoto id={h.por_id} nombre={h.por} px={18} /></span> : null}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {(puedeAbrirSolicitud || decidir || resolverSolicitud || gestionar || cancelar) && (
                        <section className="space-y-3 rounded-lg border border-border-subtle p-3">
                            {(puedeAbrirSolicitud || decidir || resolverSolicitud || gestionar) && (
                                <SegmentedControl label="Precio" value={precio} onChange={setPrecio}
                                    options={[{ value: 'mayoreo', label: 'Mayoreo' }, { value: 'mayoreo_plus', label: 'Mayoreo Plus' }]} />
                            )}
                            <PortalTextarea rows={2} maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)}
                                label={resolverSolicitud ? 'Motivo (obligatorio para rechazar: se le avisa al cliente)'
                                    : gestionar ? 'Motivo (obligatorio para retirar o bajar a Mayoreo: se le avisa al cliente)'
                                        : 'Nota (opcional, interna)'} />
                        </section>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                {puedeAbrirSolicitud && (
                    <Button icon={Send} loading={ocupado} onClick={() => correr('propuesto', () => proponerMayorista(cliente.customer_id, precio, nota), 'Solicitud enviada a Administración')}>
                        Proponer como mayorista
                    </Button>
                )}
                {decidir && (
                    <>
                        <Button variant="secondary" icon={X} loading={ocupado}
                            onClick={() => correr('descartado', () => resolverMayorista(cliente.customer_id, 'descartar', null, nota), 'No aprobado: sale de los candidatos')}>No aprobar</Button>
                        <Button icon={Check} loading={ocupado} disabled={cliente.ficha_completa === false}
                            onClick={() => correr('aprobado', () => resolverMayorista(cliente.customer_id, 'aprobar', precio, nota), `Aprobado con ${PRECIOS[precio]}`)}>Aprobar</Button>
                    </>
                )}
                {cancelar && (
                    <Button variant="secondary" icon={Undo2} loading={ocupado}
                        onClick={() => correr('cambio_cancelado', () => resolverMayorista(cliente.customer_id, 'cancelar_cambio', null, nota), 'Cambio cancelado')}>Cancelar el cambio avisado</Button>
                )}
                {resolverSolicitud && (
                    <>
                        <Button variant="secondary" icon={X} loading={ocupado} disabled={!nota.trim()}
                            onClick={() => correr('rechazado', () => resolverMayorista(cliente.customer_id, 'rechazar', null, nota), 'Solicitud rechazada')}>Rechazar</Button>
                        <Button icon={Check} loading={ocupado} disabled={cliente.ficha_completa === false}
                            onClick={() => correr('aprobado', () => resolverMayorista(cliente.customer_id, 'aprobar', precio, nota), `Aprobado con ${PRECIOS[precio]}`)}>Aprobar</Button>
                    </>
                )}
                {gestionar && (
                    <>
                        <Button variant="secondary" icon={LogOut} loading={ocupado} disabled={!nota.trim()}
                            onClick={() => correr('retiro', () => resolverMayorista(cliente.customer_id, 'retirar', null, nota), 'Retiro avisado: rige en 15 días')}>Retirar</Button>
                        <Button icon={ArrowUpDown} loading={ocupado} disabled={precio === cliente.precio || (esBajada && !nota.trim()) || (esBajada && !!cliente.precio_programado)}
                            onClick={() => correr('precio', () => resolverMayorista(cliente.customer_id, 'cambiar_precio', precio, nota),
                                esBajada ? 'Bajada avisada: rige en 15 días' : `Precio cambiado a ${PRECIOS[precio]}`)}>
                            {esBajada ? 'Bajar a Mayoreo (en 15 días)' : 'Cambiar precio'}
                        </Button>
                    </>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function Dato({ titulo, valor, nota }) {
    return (
        <div className="rounded-lg border border-border-subtle px-3 py-2">
            <p className="text-micro text-content-3">{titulo}</p>
            <p className="text-body font-semibold text-content">{valor}</p>
            {nota && <p className="text-micro text-content-3">{nota}</p>}
        </div>
    );
}
