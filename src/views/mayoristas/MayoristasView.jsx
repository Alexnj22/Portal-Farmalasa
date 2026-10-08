import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gem, Inbox, ListChecks, History, Users, Check, X, ArrowUpDown, LogOut, Send } from 'lucide-react';
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
import usePestanaEnUrl from '../../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
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
 *     debajo del Preferente) en los últimos 6 meses, con lo que pide la
 *     cláusula 2.3 (promedio de $100/mes o una factura de $500) a la vista.
 *   · Mayoristas: los aprobados, con su precio y su rango del mes.
 *   · Historial: todo lo que pasó, de un solo lugar, para evaluar.
 *
 * El margen, la regularidad y la antigüedad son de uso interno (Procedimiento
 * §4): no se le mencionan al cliente.
 */
const textoDeAccion = (h) => ({
    solicitado: 'Lo pidió desde la app',
    propuesto: `Propuesto${h.precio ? ` con ${PRECIOS[h.precio]}` : ''}`,
    aprobado: `Aprobado${h.precio ? ` con ${PRECIOS[h.precio]}` : ''}`,
    rechazado: 'Rechazado',
    precio_cambiado: `Precio cambiado a ${PRECIOS[h.precio] ?? '—'}`,
    retiro_avisado: 'Retiro avisado',
}[h.accion] ?? h.accion);

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

    const solicitudes = (filas ?? []).filter((f) => f.estado === 'solicitado');
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
    const [soloCumplen, setSoloCumplen] = useState(true);
    const [orden, setOrden] = useState('mayoreo');
    const [ver, setVer] = useState(PASO);
    const base = filas.filter((f) => (tab === 'solicitudes' ? f.estado === 'solicitado'
        : tab === 'mayoristas' ? f.estado === 'aprobado'
            : f.estado !== 'aprobado' && f.estado !== 'solicitado' && (!soloCumplen || f.cumple)));
    const lista = base
        .filter((f) => !busqueda || tokenMatch(`${f.nombre ?? ''} ${f.documento ?? ''}`, busqueda))
        .sort((a, b) => (orden === 'promedio' ? b.prom_3m - a.prom_3m : orden === 'reciente' ? String(b.ultima_compra ?? '').localeCompare(String(a.ultima_compra ?? '')) : b.a_mayoreo - a.a_mayoreo));
    const visibles = lista.slice(0, ver);

    return (
        <>
            {tab === 'candidatos' && (
                <Notice variant="info">
                    Compraron a precio de mayoreo en los últimos 6 meses. Para pedirlo deben cumplir la cláusula 2.3: <b>promedio de $100 al mes</b> en
                    los últimos 3 meses o <b>una factura de $500</b>, con la ficha completa. Nadie entra solo: alguien lo propone y Administración decide.
                </Notice>
            )}
            <div className="flex justify-end">
                <FilterBar activeCount={tab === 'candidatos' && !soloCumplen ? 1 : 0}
                    onClear={tab === 'candidatos' && !soloCumplen ? () => setSoloCumplen(true) : undefined}>
                    {tab === 'candidatos' && (
                        <FilterBar.Section label="requisito" active={!soloCumplen} onClear={() => setSoloCumplen(true)}>
                            <FilterBar.Opciones value={soloCumplen ? 'cumplen' : 'todos'} onChange={(v) => setSoloCumplen(v !== 'todos')} label="Requisito" umbral={0}
                                options={[{ value: 'cumplen', label: 'Cumplen el requisito' }, { value: 'todos', label: 'Todos los que compraron a mayoreo' }]} />
                        </FilterBar.Section>
                    )}
                    <FilterBar.Section label="orden" active={orden !== 'mayoreo'} onClear={() => setOrden('mayoreo')}>
                        <FilterBar.Opciones value={orden} onChange={(v) => setOrden(v || 'mayoreo')} label="Ordenar" umbral={0}
                            options={[{ value: 'mayoreo', label: 'Más compra a mayoreo' }, { value: 'promedio', label: 'Mayor promedio mensual' }, { value: 'reciente', label: 'Compra más reciente' }]} />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            <DataTable
                columns={[
                    { key: 'cliente', label: 'Cliente' },
                    { key: 'prom', label: 'Promedio 3 meses', align: 'right' },
                    { key: 'mayoreo', label: 'A mayoreo (6 m)', align: 'right', hideBelow: 'sm' },
                    { key: 'estado', label: tab === 'mayoristas' ? 'Precio · rango' : 'Estado' },
                    { key: 'ultima', label: 'Última compra', hideBelow: 'md' },
                ]}
                movil={{ usarAccionDeFila: true }}
                empty={{ icon: tab === 'solicitudes' ? Inbox : Users, message: tab === 'solicitudes' ? 'No hay solicitudes por resolver' : 'Nadie con ese filtro' }}
                minWidth="720px">
                {visibles.map((f, i) => (
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
                    <DataCell><span className="text-body-sm text-content-2">{fechaTexto(h.created_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></DataCell>
                    <DataCell><span className="text-body-sm font-semibold text-content">{h.customers?.name ?? '—'}</span></DataCell>
                    <DataCell>
                        <span className="text-body-sm text-content-2">{textoDeAccion(h)}{h.nota ? ` — «${h.nota}»` : ''}</span>
                    </DataCell>
                    <DataCell><span className="text-body-sm text-content-2">{h.employees?.name ? shortEmployeeName(h.employees.name) : h.origen === 'app' ? 'El cliente (app)' : 'Sistema'}</span></DataCell>
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
    const [precio, setPrecio] = useState(cliente.precio ?? cliente.precio_sugerido ?? 'mayoreo');
    const [nota, setNota] = useState('');
    const [ocupado, setOcupado] = useState(false);
    useEffect(() => {
        fetchDetalleMayorista(cliente.customer_id).then(setD).catch((err) => showToast('No se pudo cargar', mensajeAmigable(err, ''), 'error'));
    }, [cliente.customer_id, showToast]);

    const esSolicitante = cliente.solicitado_por_id && user?.id && cliente.solicitado_por_id === user.id;
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
    const puedeAbrirSolicitud = puedeProponer && (!est || est === 'rechazado' || est === 'retirado');
    const resolverSolicitud = puedeAprobar && est === 'solicitado' && !esSolicitante;
    const gestionar = puedeAprobar && est === 'aprobado' && !cliente.retiro_programado;
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
                        <Notice variant="warning">La ficha no está completa (documento o teléfono). Hay que completarla antes de aprobar.</Notice>
                    )}
                    {est === 'solicitado' && (
                        <Notice variant="info">
                            {ORIGENES[cliente.origen]}{cliente.solicitado_por ? ` por ${shortEmployeeName(cliente.solicitado_por)}` : ''} el {fechaTexto(cliente.solicitado_at, { day: 'numeric', month: 'short' })}
                            {cliente.nota_solicitud ? ` — «${cliente.nota_solicitud}»` : ''}. {esSolicitante ? 'Tú la hiciste: la tiene que resolver otra persona.' : ''}
                        </Notice>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <Dato titulo="Promedio 3 meses" valor={formatMoney(cliente.prom_3m ?? 0)} nota={cliente.cumple ? 'Cumple $100/mes o $500' : 'Aún no cumple'} />
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
                                        <span className="text-content-3 flex-1 text-right">a mayoreo {formatMoney(m.a_mayoreo)}</span>
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
                                        {textoDeAccion(h)}{h.por ? ` · ${shortEmployeeName(h.por)}` : ''}{h.nota ? ` — «${h.nota}»` : ''}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {(puedeAbrirSolicitud || resolverSolicitud || gestionar) && (
                        <section className="space-y-3 rounded-lg border border-border-subtle p-3">
                            <SegmentedControl label="Precio" value={precio} onChange={setPrecio}
                                options={[{ value: 'mayoreo', label: 'Mayoreo' }, { value: 'mayoreo_plus', label: 'Mayoreo Plus' }]} />
                            <PortalTextarea label={resolverSolicitud || gestionar ? 'Motivo (obligatorio para rechazar o retirar)' : 'Nota (opcional)'} rows={2} maxLength={300}
                                value={nota} onChange={(e) => setNota(e.target.value)} />
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
                        <Button icon={ArrowUpDown} loading={ocupado} disabled={precio === cliente.precio}
                            onClick={() => correr('precio', () => resolverMayorista(cliente.customer_id, 'cambiar_precio', precio, nota), `Precio cambiado a ${PRECIOS[precio]}`)}>Cambiar precio</Button>
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
