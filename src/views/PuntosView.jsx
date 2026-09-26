/**
 * Puntos — el programa, visto entero.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Desde el 1-oct-2026 los puntos viven en el portal (el sistema anterior se
 * apagó esa madrugada) y lo único que se veía era el panel de cada ficha. Esta
 * vista contesta las tres preguntas de quien opera el programa:
 *
 *   · Consulta           — ¿funciona? ¿cuánto se acumuló y se canjeó? En
 *                          gráficas, y debajo los clientes con sus puntos:
 *                          al tocar uno se ve todo lo suyo y se edita su ficha
 *                          (el panel de puntos de la ficha se mudó aquí,
 *                          pedido del usuario, 2026-09-25).
 *   · Avisos             — ¿qué hay que revisar? (canjes sin saldo, anulaciones
 *                          con puntos ya gastados)
 *   · Cuentas por asignar — las cuentas del sistema anterior que no pasaron
 *                          solas, para asignarlas cuando el cliente reclame.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 * No une nada solo. Decisión del usuario (2026-09-25): una cuenta vieja pasa a
 * una ficha sólo cuando alguien la elige y escribe por qué. Las fichas que se
 * sugieren son eso, sugerencias.
 *
 * Cada pestaña tiene su permiso (`puntos_tab_consulta`, `puntos_tab_avisos`,
 * `puntos_tab_por_asignar`) y la base lo vuelve a comprobar en cada función:
 * Avisos es sólo de administración; Consulta la ve también la caja, que ahí
 * revisa el saldo antes de un canje.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Star, Search, AlertTriangle, UserSearch, Coins, TrendingUp, Gift, Inbox, CalendarClock, Store, Users } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import StatCard from '../components/common/StatCard';
import SegmentedControl from '../components/common/SegmentedControl';
import CarrilCards from '../components/common/CarrilCards';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { usePaginaEnUrl } from '../plataforma/usePaginaEnUrl';
import TablePagination from '../components/common/TablePagination';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import { mensajeAmigable } from '../utils/errorMessages';
import { tokenMatch } from '../utils/searchUtils';
import { formatMoney, formatQty } from '../utils/formatNumber';
import { fechaHora12 } from '../utils/hora';
import {
    fetchResumenDePuntos, fetchAvisosDePuntos, fetchCuentasPorAsignar, QUE_HACER_POR_MOTIVO,
    fetchSerieDePuntos, fetchClientesConPuntos,
} from '../data/puntos';
import { useTextoRebotado } from '../hooks/useBusqueda';
import { useStaffStore as useStaff } from '../store/staffStore';
import AsignarCuentaModal from './puntos/AsignarCuentaModal';
import ClientePuntosModal from './puntos/ClientePuntosModal';

// `recharts` pesa: viaja en su propio chunk y se pide cuando la pestaña lo pinta.
const GraficaDiaria = lazy(() => import('./puntos/GraficasPuntos').then((m) => ({ default: m.GraficaDiaria })));
const GraficaSalas = lazy(() => import('./puntos/GraficasPuntos').then((m) => ({ default: m.GraficaSalas })));
const GraficaVencimientos = lazy(() => import('./puntos/GraficasPuntos').then((m) => ({ default: m.GraficaVencimientos })));
import { fechaTexto } from '../utils/fecha';

// Cada pestaña con su permiso. La lista que se le pasa a la URL es la de las
// VISIBLES: una dirección con `?tab=avisos` en manos de quien no la tiene cae a
// la primera que sí.
const PESTANAS = [
    { key: 'consulta',    label: 'Consulta',            icon: Search },
    { key: 'avisos',      label: 'Avisos',              icon: AlertTriangle },
    { key: 'por_asignar', label: 'Cuentas por asignar', icon: UserSearch },
];

// 100 puntos = US$1.00 (cláusula 4 del reglamento).
const dolares = (puntos) => formatMoney((Number(puntos) || 0) / 100);
const pts = (n) => formatQty(Number(n) || 0);
const fechaCorta = (iso) => fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' }, '—');

// ¿La acumulación está parada? Sólo se pregunta de 8:00 a 22:00 SV: las salas
// abren a las 7 y la primera hora puede no traer ninguna venta con puntos; de
// noche el silencio es lo normal.
function motorQuieto(ultima, encendido) {
    if (!encendido || !ultima) return null;
    // No se muestra: decide si hay salas abiertas. El Salvador es UTC−6 todo
    // el año (sin horario de verano), así que no hace falta formatear nada.
    const horaSV = (new Date().getUTCHours() + 18) % 24;
    if (horaSV < 8 || horaSV >= 22) return null;
    const minutos = Math.round((Date.now() - new Date(ultima).getTime()) / 60_000);
    return minutos > 60 ? minutos : null;
}

const MOTIVO_OPCIONES = [
    { value: 'TODOS', label: 'Todos' },
    ...Object.keys(QUE_HACER_POR_MOTIVO).map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) })),
];

export default function PuntosView({ openModal }) {
    const { hasPermission } = useAuth();
    const puedeAsignar = hasPermission('puntos', 'can_edit');
    const puedeEditarFicha = hasPermission('clientes', 'can_edit');
    const showToast = useToastStore((s) => s.showToast);
    // Con el nombre literal de cada permiso: así los encuentra `gate:permisos`
    // y quien busque dónde se consulta cada uno.
    const permitidas = {
        consulta:    hasPermission('puntos_tab_consulta', 'can_view'),
        avisos:      hasPermission('puntos_tab_avisos', 'can_view'),
        por_asignar: hasPermission('puntos_tab_por_asignar', 'can_view'),
    };
    const visibles = PESTANAS.filter((t) => permitidas[t.key]);
    const [pestana, setPestana] = usePestanaEnUrl(visibles, visibles[0]?.key ?? 'consulta');
    const veAvisos = visibles.some((t) => t.key === 'avisos');
    const vePorAsignar = visibles.some((t) => t.key === 'por_asignar');

    const [resumen, setResumen] = useState(null);
    const [avisos, setAvisos] = useState([]);
    const [cuentas, setCuentas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [busqueda, setBusqueda] = useState('');
    const [motivo, setMotivo] = useState('TODOS');
    const [abierta, setAbierta] = useState(null);
    const [serie, setSerie] = useState([]);
    const [clienteAbierto, setClienteAbierto] = useState(null);

    // `version` sube para recargar (después de asignar una cuenta). El estado
    // ya nace «cargando» y la recarga lo prende desde el evento: prenderlo
    // dentro del efecto sería un setState síncrono en cascada.
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                // Sólo lo que la persona puede ver: pedir Avisos sin su permiso
                // sería un error de la base en cada visita.
                const [r, a, c, se] = await Promise.all([
                    fetchResumenDePuntos(),
                    veAvisos ? fetchAvisosDePuntos() : Promise.resolve([]),
                    vePorAsignar ? fetchCuentasPorAsignar() : Promise.resolve([]),
                    fetchSerieDePuntos(30),
                ]);
                if (!vivo) return;
                setResumen(r); setAvisos(a ?? []); setCuentas(c ?? []); setSerie(se ?? []);
            } catch (e) {
                if (vivo) showToast('No se pudo cargar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [showToast, version, veAvisos, vePorAsignar]);

    const cuentasVisibles = useMemo(() => {
        const q = busqueda.trim();
        return cuentas.filter((c) => {
            if (motivo !== 'TODOS' && c.motivo !== motivo) return false;
            return !q || tokenMatch(q, c.nombre, c.dui, c.telefono, String(c.id_cliente));
        });
    }, [cuentas, motivo, busqueda]);

    const avisosVisibles = useMemo(() => {
        const q = busqueda.trim();
        return !q ? avisos : avisos.filter((a) => tokenMatch(q, a.cliente, a.documento, a.sala));
    }, [avisos, busqueda]);

    /* La página vive en la DIRECCIÓN (DESIGN.md §14 · usePaginaEnUrl): la sesión
     * de sala se cierra sola y el portal se recarga al publicar una versión, y
     * quien va por la página 12 de las 709 cuentas no puede volver a la 1.
     * Cada pestaña con su propio parámetro: cambiar de pestaña no mueve la
     * posición de la otra, y no hace falta escribir dos veces la dirección. */
    const pagCuentas = usePaginaEnUrl({ total: cuentasVisibles.length, tamPorDefecto: 50 });
    const pagAvisos = usePaginaEnUrl({ total: avisosVisibles.length, tamPorDefecto: 50,
        param: 'pag_avisos', paramTam: 'ver_avisos' });
    const tramo = (lista, p) => lista.slice((p.page - 1) * p.pageSize, p.page * p.pageSize);

    // Buscar o filtrar cambia QUÉ lista es: la posición vieja ya no señala nada.
    const [busquedaClientes, setBusquedaClientes] = useState('');
    const buscar = (v) => {
        if (pestana === 'consulta') { setBusquedaClientes(v); return; }
        setBusqueda(v);
        (pestana === 'avisos' ? pagAvisos : pagCuentas).resetPage();
    };
    const filtrarMotivo = (v) => { setMotivo(v); pagCuentas.resetPage(); };

    const filtersContent = (
        <ViewTabBar
            tabs={visibles}
            activeTab={pestana}
            onTabChange={setPestana}
            searchValue={pestana === 'consulta' ? busquedaClientes : busqueda}
            onSearchChange={buscar}
            placeholder={pestana === 'avisos' ? 'Buscar por cliente o documento…'
                : pestana === 'consulta' ? 'Buscar cliente por nombre, DUI o teléfono…'
                : 'Buscar por nombre, DUI o teléfono…'}
        />
    );

    return (
        <GlassViewLayout icon={Star} title="Puntos" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">
                {pestana === 'consulta' && (
                    <>
                        <Resumen resumen={resumen} serie={serie} cargando={cargando}
                            avisos={veAvisos ? avisos.length : null}
                            porAsignar={vePorAsignar ? cuentas.length : null} irA={setPestana}
                            buscando={busquedaClientes.trim().length > 0} />
                        <ClientesConPuntos busqueda={busquedaClientes} onAbrir={setClienteAbierto} />
                    </>
                )}

                {pestana === 'avisos' && (
                    <DataTable
                        columns={[
                            { key: 'cuando',    label: 'Cuándo' },
                            { key: 'que',       label: 'Qué pasó' },
                            { key: 'cliente',   label: 'Cliente' },
                            { key: 'sala',      label: 'Sala' },
                            { key: 'documento', label: 'Documento' },
                            { key: 'puntos',    label: 'Puntos' },
                        ]}
                        loading={cargando}
                        minWidth="860px"
                        movil={{ identidad: 'cliente', ancla: 'puntos' }}
                        empty={{ icon: Inbox, message: busqueda.trim() ? 'Sin coincidencias' : 'Nada que revisar en los últimos 60 días' }}
                    >
                        {tramo(avisosVisibles, pagAvisos).map((a, i) => (
                            <DataRow key={`${a.tipo}-${a.invoice_id}-${i}`} index={i}>
                                <DataCell>{fechaHora12(a.cuando)}</DataCell>
                                <DataCell>
                                    {a.tipo === 'canje_sin_saldo'
                                        ? <Badge variant="danger" tone="soft" uppercase={false}>Canje sin saldo suficiente</Badge>
                                        : <Badge variant="warning" tone="soft" uppercase={false}>Anulada con puntos ya canjeados</Badge>}
                                </DataCell>
                                <DataCell>{a.cliente || <span className="text-content-3">—</span>}</DataCell>
                                <DataCell>{a.sala || '—'}</DataCell>
                                <DataCell><span className="tabular-nums">{a.documento || '—'}</span></DataCell>
                                <DataCell>
                                    <span className="tabular-nums">
                                        {a.tipo === 'canje_sin_saldo'
                                            ? `Faltaron ${pts(a.faltaron)}`
                                            : `${pts(a.puntos)} no recuperados`}
                                    </span>
                                </DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}
                {pestana === 'avisos' && avisosVisibles.length > pagAvisos.pageSize && (
                    <TablePagination page={pagAvisos.page} totalPages={pagAvisos.totalPages}
                        onPageChange={pagAvisos.setPage} pageSize={pagAvisos.pageSize}
                        onPageSizeChange={pagAvisos.setPageSize} total={avisosVisibles.length} unit="avisos" />
                )}

                {pestana === 'por_asignar' && (
                    <>
                        <Notice variant="info" bloque>
                            Son cuentas del sistema anterior que no se pudieron pasar solas a una ficha. Sus
                            puntos no se perdieron: están guardados con todo su historial. Cuando un cliente
                            reclame, se busca su cuenta aquí y se asigna a su ficha.
                        </Notice>
                        <div className="flex justify-end min-w-0">
                            <FilterBar onClear={() => filtrarMotivo('TODOS')} activeCount={motivo !== 'TODOS' ? 1 : 0}>
                                <FilterBar.Section active={motivo !== 'TODOS'} onClear={() => filtrarMotivo('TODOS')} label="motivo">
                                    <FilterBar.Opciones value={motivo} onChange={filtrarMotivo}
                                        options={MOTIVO_OPCIONES} label="Motivo" />
                                </FilterBar.Section>
                            </FilterBar>
                        </div>
                        <DataTable
                            columns={[
                                { key: 'cuenta',   label: 'Cuenta' },
                                { key: 'nombre',   label: 'Nombre' },
                                { key: 'dui',      label: 'DUI' },
                                { key: 'telefono', label: 'Teléfono' },
                                { key: 'saldo',    label: 'Puntos' },
                                { key: 'motivo',   label: 'Por qué no pasó' },
                                { key: 'ultima',   label: 'Última compra' },
                            ]}
                            loading={cargando}
                            minWidth="1000px"
                            // En el teléfono la ficha lleva el NOMBRE de título y los
                            // PUNTOS como cifra: es lo que se busca al atender un reclamo.
                            movil={{ usarAccionDeFila: true, identidad: 'nombre', ancla: 'saldo' }}
                            empty={{ icon: Inbox, message: busqueda.trim() || motivo !== 'TODOS' ? 'Sin coincidencias' : 'Sin cuentas por asignar' }}
                        >
                            {tramo(cuentasVisibles, pagCuentas).map((c, i) => (
                                <DataRow key={c.id_cliente} index={i} onClick={() => setAbierta(c)}>
                                    <DataCell><span className="tabular-nums text-content-3">{c.id_cliente}</span></DataCell>
                                    <DataCell>{c.nombre || <span className="text-content-3">Sin nombre</span>}</DataCell>
                                    <DataCell><span className="tabular-nums">{c.dui || '—'}</span></DataCell>
                                    <DataCell><span className="tabular-nums">{c.telefono || '—'}</span></DataCell>
                                    <DataCell>
                                        <span className="font-black tabular-nums text-content">{pts(c.saldo)}</span>
                                        <span className="text-caption text-content-3 ml-1.5">{dolares(c.saldo)}</span>
                                    </DataCell>
                                    <DataCell><span className="text-caption">{c.motivo}</span></DataCell>
                                    <DataCell>{fechaCorta(c.ultima_compra)}</DataCell>
                                </DataRow>
                            ))}
                        </DataTable>
                        {cuentasVisibles.length > pagCuentas.pageSize && (
                            <TablePagination page={pagCuentas.page} totalPages={pagCuentas.totalPages}
                                onPageChange={pagCuentas.setPage} pageSize={pagCuentas.pageSize}
                                onPageSizeChange={pagCuentas.setPageSize} total={cuentasVisibles.length} unit="cuentas" />
                        )}
                    </>
                )}
            </div>

            <AsignarCuentaModal
                open={!!abierta}
                cuenta={abierta}
                puedeAsignar={puedeAsignar}
                onClose={() => setAbierta(null)}
                onAsignada={(idCliente) => {
                    setCuentas((p) => p.filter((c) => c.id_cliente !== idCliente));
                    setAbierta(null);
                    setCargando(true);
                    setVersion((v) => v + 1);
                }}
            />

            <ClientePuntosModal
                open={!!clienteAbierto}
                customerId={clienteAbierto}
                puedeEditarFicha={puedeEditarFicha}
                onClose={() => setClienteAbierto(null)}
                // La ficha se edita en el MISMO modal que usa Clientes. Se cierra
                // éste primero para no apilar dos diálogos.
                onEditar={(c) => {
                    setClienteAbierto(null);
                    openModal?.('editCliente', {
                        id: c.id, nombre: c.nombre, canEdit: puedeEditarFicha,
                        onSaved: () => setVersion((v) => v + 1),
                    });
                    useStaff.getState().appendAuditLog?.('CLIENTES_VER_FICHA', String(c.id), { nombre: c.nombre, desde: 'puntos' });
                }}
            />
        </GlassViewLayout>
    );
}

function Resumen({ resumen, serie, cargando, avisos, porAsignar, irA, buscando }) {
    // En qué se leen las gráficas. El tooltip muestra siempre las dos; esto
    // decide el eje (pedido del usuario: «ver en monto $ también»).
    const [unidad, setUnidad] = useState('puntos');
    const cfg = resumen?.config;
    const enPortal = cfg?.fuente === 'portal' && cfg?.encendido;
    const anterior = resumen?.origen === 'sistema_anterior';
    const hoy = resumen?.periodos?.hoy ?? {};
    const mes = resumen?.periodos?.mes ?? {};
    const quieto = motorQuieto(resumen?.ultima_acumulacion, enPortal);
    const arranque = resumen?.arranque;

    return (
        <>
            {!cargando && anterior && (
                <Notice variant="info" icon={CalendarClock} bloque>
                    El programa pasa al portal el 1 de octubre de 2026 a las 2:00 a. m. Hasta entonces las
                    cifras salen del sistema anterior: los puntos de los clientes son los de su última copia
                    ({resumen?.copia_al ? fechaHora12(resumen.copia_al) : 'sin copia todavía'}), y lo ganado y
                    canjeado, de las ventas del portal.
                </Notice>
            )}
            {!cargando && arranque && !arranque.simulado && !arranque.ok && (
                <Notice variant="danger" icon={AlertTriangle} bloque>
                    El paso al portal no se completó ({fechaHora12(arranque.cuando)}): {arranque.error}
                </Notice>
            )}
            {quieto && (
                <Notice variant="warning" icon={AlertTriangle} bloque>
                    Hace {quieto} minutos que no se acumulan puntos. Si hubo ventas en ese tiempo, hay que revisarlo.
                </Notice>
            )}

            {/* §17.0: el carril va en su contenedor de fila aunque esta
                pestaña no tenga píldora de filtros. */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <CarrilCards className="flex-1" ariaLabel="Resumen del programa de puntos">
                {/* Un dato por `sub` (DESIGN §25.7): la tarjeta topa en 200px y
                    «$17,423.76 · 11,295 clientes» se cortaba. Los clientes van
                    en su propia tarjeta y el mes, en el panel por sala. */}
                <StatCard icon={Coins} iconBg="bg-brand/10" iconCls="text-brand-text"
                    label="Puntos" value={pts(resumen?.libro?.puntos)}
                    sub={`Valen ${dolares(resumen?.libro?.puntos)}`}
                    loading={cargando} />
                <StatCard icon={Users} iconBg="bg-brand/10" iconCls="text-brand-text"
                    label="Clientes" value={pts(resumen?.libro?.cuentas_con_saldo)}
                    sub="Con saldo"
                    loading={cargando} />
                <StatCard icon={TrendingUp} iconBg="bg-success/10" iconCls="text-success-text"
                    label="Acumulados hoy" value={pts(hoy.acumulado)}
                    sub={`${dolares(hoy.acumulado)} · ${pts(hoy.ventas)} ventas`}
                    loading={cargando} />
                <StatCard icon={Gift} iconBg="bg-warning/10" iconCls="text-warning-text"
                    label="Canjeados hoy" value={pts(hoy.canjeado)}
                    sub={`${dolares(hoy.canjeado)} · ${pts(hoy.canjes)} canjes`}
                    loading={cargando} />
                {avisos != null && (
                    <StatCard icon={AlertTriangle} iconBg="bg-danger/10" iconCls="text-danger-text"
                        label="Avisos" value={pts(avisos)} sub="Últimos 60 días"
                        onClick={() => irA('avisos')} loading={cargando} />
                )}
                {porAsignar != null && (
                    <StatCard icon={UserSearch} iconBg="bg-surface-card-hover" iconCls="text-content-3"
                        label="Por asignar" value={pts(porAsignar)}
                        sub={`${pts(resumen?.pendientes?.puntos)} puntos`}
                        onClick={() => irA('por_asignar')} loading={cargando} />
                )}
            </CarrilCards>
            </div>

            {/* Buscando, lo que se mira es la lista: las gráficas se pliegan en
                una línea para que la tabla quede arriba y se vea que está
                (pedido del usuario, 2026-09-25). */}
            {buscando ? (
                <p className="text-caption text-content-3 flex items-center gap-2">
                    <TrendingUp size={14} /> Las gráficas vuelven al borrar la búsqueda.
                </p>
            ) : (
                <>
                    {/* Gráficas y no tablas (pedido del usuario): el número exacto
                        —en puntos y en dólares— está en el tooltip de cada punto. */}
                    <Panel icono={TrendingUp} titulo="Últimos 30 días"
                        accion={(
                            <SegmentedControl size="sm" value={unidad} onChange={setUnidad} label="Ver en"
                                options={[
                                    { value: 'puntos', label: 'Puntos' },
                                    { value: 'dolares', label: 'Dólares' },
                                ]} />
                        )}>
                        <Suspense fallback={<Hueco alto={190} />}>
                            <GraficaDiaria serie={serie} unidad={unidad} />
                        </Suspense>
                    </Panel>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Panel icono={Store} titulo="Este mes, por sala"
                            nota={`Acumulados ${pts(mes.acumulado)} (${dolares(mes.acumulado)}) · canjeados ${pts(mes.canjeado)} (${dolares(mes.canjeado)})`}>
                            {(resumen?.por_sala ?? []).length === 0 && !cargando
                                ? <p className="text-body-sm text-content-3 py-6 text-center">Sin movimientos este mes</p>
                                : <Suspense fallback={<Hueco alto={180} />}><GraficaSalas salas={resumen?.por_sala} unidad={unidad} /></Suspense>}
                        </Panel>
                        <Panel icono={CalendarClock} titulo="Cuándo vencen"
                            nota="A los doce meses de la compra. Lo acumulado hasta el 30 de septiembre de 2026 vence el 1 de octubre de 2027.">
                            {(resumen?.vencimientos ?? []).length === 0 && !cargando
                                ? <p className="text-body-sm text-content-3 py-6 text-center">Sin puntos por vencer</p>
                                : <Suspense fallback={<Hueco alto={150} />}><GraficaVencimientos vencimientos={resumen?.vencimientos} unidad={unidad} /></Suspense>}
                        </Panel>
                    </div>
                </>
            )}
        </>
    );
}

function Panel({ icono: Icono, titulo, nota, accion, children }) {
    return (
        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-3 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                        <Icono size={14} /> {titulo}
                    </h3>
                    {nota && <p className="text-caption text-content-3 mt-1">{nota}</p>}
                </div>
                {accion}
            </div>
            {children}
        </section>
    );
}

// El lugar de la gráfica mientras llega su chunk: mismo alto, sin salto.
function Hueco({ alto }) {
    return <div className="animate-pulse rounded-card bg-surface-card-hover" style={{ height: alto }} />;
}

/**
 * Los clientes con puntos, debajo de las gráficas. Pagina en la BASE (son
 * ~10,600 cuentas, no se bajan enteras) y la página vive en la dirección con su
 * propio parámetro. Tocar un cliente abre todo lo suyo.
 */
// Las columnas por las que la base sabe ordenar (`puntos_panel_clientes`).
const ORDEN_CLIENTES = ['nombre', 'dui', 'telefono', 'saldo', 'acumulados', 'canjeados', 'ultima'];

function ClientesConPuntos({ busqueda, onAbrir }) {
    const showToast = useToastStore((s) => s.showToast);
    const aplicado = useTextoRebotado(busqueda);
    const [datos, setDatos] = useState({ total: 0, filas: [] });
    const [cargando, setCargando] = useState(true);
    const pag = usePaginaEnUrl({ total: datos.total, tamPorDefecto: 25, param: 'pag_clientes', paramTam: 'ver_clientes' });
    const { page, pageSize, resetPage } = pag;

    // El orden vive en la dirección igual que la página (`orden_clientes=
    // nombre.asc`): la página sin su orden señala otras filas después de
    // recargar. Se REEMPLAZA en el historial: ordenar no es navegar.
    const [params, setParams] = useSearchParams();
    const [orden, dir] = (() => {
        const [o, d] = String(params.get('orden_clientes') ?? '').split('.');
        return ORDEN_CLIENTES.includes(o) ? [o, d === 'asc' ? 'asc' : 'desc'] : ['saldo', 'desc'];
    })();
    const ordenar = useCallback((col) => {
        if (!ORDEN_CLIENTES.includes(col)) return;
        // Misma columna: invierte. Otra: los textos empiezan A→Z y los números
        // de mayor a menor, que es lo que se busca primero en cada caso.
        const nuevoDir = col === orden ? (dir === 'asc' ? 'desc' : 'asc')
            : (['nombre', 'dui', 'telefono'].includes(col) ? 'asc' : 'desc');
        setParams((p) => {
            const n = new URLSearchParams(p);
            n.set('orden_clientes', `${col}.${nuevoDir}`);
            n.delete('pag_clientes');
            return n;
        }, { replace: true });
    }, [orden, dir, setParams]);

    // Una búsqueda nueva es otra lista: vuelve a la primera página. Con `ref`
    // para no correr en el montaje — ahí la página de la dirección es la que
    // hay que respetar (quien recargó en la 4 sigue en la 4).
    const busquedaPrevia = useRef(aplicado);
    useEffect(() => {
        if (busquedaPrevia.current === aplicado) return;
        busquedaPrevia.current = aplicado;
        resetPage();
    }, [aplicado, resetPage]);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const r = await fetchClientesConPuntos({
                    busqueda: aplicado, limite: pageSize, desde: (page - 1) * pageSize, orden, dir,
                });
                if (vivo) setDatos({ total: r?.total ?? 0, filas: r?.filas ?? [] });
            } catch (e) {
                if (vivo) showToast('No se pudo cargar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [aplicado, page, pageSize, orden, dir, showToast]);

    return (
        <section className="flex flex-col gap-3">
            <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                <Users size={14} /> Clientes con puntos
                {datos.total > 0 && <span className="font-bold text-content-3 normal-case tracking-normal">· {pts(datos.total)}</span>}
            </h3>
            <DataTable
                columns={[
                    { key: 'nombre',     label: 'Cliente',            sortable: true },
                    { key: 'dui',        label: 'DUI',                sortable: true },
                    { key: 'telefono',   label: 'Teléfono',           sortable: true },
                    { key: 'saldo',      label: 'Puntos',             sortable: true },
                    { key: 'acumulados', label: 'Acumulados',         sortable: true },
                    { key: 'canjeados',  label: 'Canjeados',          sortable: true },
                    { key: 'ultima',     label: 'Última acumulación', sortable: true },
                ]}
                sortKey={orden}
                sortDir={dir}
                onSort={ordenar}
                loading={cargando}
                minWidth="920px"
                movil={{ usarAccionDeFila: true, identidad: 'nombre', ancla: 'saldo' }}
                empty={{ icon: Inbox, message: aplicado ? 'Sin coincidencias' : 'Sin clientes con puntos' }}
            >
                {datos.filas.map((c, i) => (
                    <DataRow key={c.customer_id} index={i} onClick={() => onAbrir(c.customer_id)}>
                        <DataCell><span className="font-bold text-content">{c.nombre}</span></DataCell>
                        {/* Sin partir: «00478819-» arriba y «7» abajo no se lee como un DUI. */}
                        <DataCell><span className="tabular-nums whitespace-nowrap">{c.dui || '—'}</span></DataCell>
                        <DataCell><span className="tabular-nums whitespace-nowrap">{c.telefono || '—'}</span></DataCell>
                        <DataCell>
                            <span className="font-black tabular-nums text-content">{pts(c.saldo)}</span>
                            <span className="text-caption text-content-3 ml-1.5">{dolares(c.saldo)}</span>
                        </DataCell>
                        <DataCell><span className="tabular-nums">{pts(c.acumulados)}</span></DataCell>
                        <DataCell><span className="tabular-nums">{pts(c.canjeados)}</span></DataCell>
                        <DataCell>{fechaCorta(c.ultima_acumulacion)}</DataCell>
                    </DataRow>
                ))}
            </DataTable>
            {datos.total > pageSize && (
                <TablePagination page={pag.page} totalPages={pag.totalPages} onPageChange={pag.setPage}
                    pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} total={datos.total} unit="clientes" />
            )}
        </section>
    );
}
