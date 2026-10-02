/**
 * Puntos — el programa, visto entero.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Desde el 1-oct-2026 los puntos viven en el portal (el sistema anterior se
 * apagó esa madrugada) y lo único que se veía era el panel de cada ficha. Esta
 * vista contesta las tres preguntas de quien opera el programa:
 *
 *   · Resumen            — ¿funciona? ¿cuánto se acumuló y se canjeó? En
 *                          gráficas, con el mes, los vencimientos y el estado
 *                          del programa (pestaña propia desde el 2026-09-26).
 *   · Consulta           — las tarjetas y los clientes con sus puntos: al
 *                          tocar uno se ve todo lo suyo y se edita su ficha
 *                          (el panel de puntos de la ficha se mudó aquí,
 *                          pedido del usuario, 2026-09-25).
 *   · Avisos             — ¿qué hay que revisar? (canjes sin saldo, anulaciones
 *                          con puntos ya gastados, y desde el 2026-10-01 los
 *                          movimientos fuera de lo normal que detecta
 *                          `puntos_vigilar_irregularidades` — ver su migración
 *                          para los umbrales y de dónde salen)
 *   · Cuentas por asignar — las cuentas del sistema anterior que no pasaron
 *                          solas, para asignarlas cuando el cliente reclame.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 * No une nada solo. Decisión del usuario (2026-09-25): una cuenta vieja pasa a
 * una ficha sólo cuando alguien la elige y escribe por qué. Las fichas que se
 * sugieren son eso, sugerencias.
 *
 * Cada pestaña tiene su permiso (`puntos_tab_resumen`, `puntos_tab_consulta`, `puntos_tab_avisos`,
 * `puntos_tab_por_asignar`) y la base lo vuelve a comprobar en cada función:
 * Avisos es sólo de administración; Consulta la ve también la caja, que ahí
 * revisa el saldo antes de un canje.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Star, Search, LayoutDashboard, Trophy, Wallet, ChevronRight, AlertTriangle, UserSearch, Coins, TrendingUp, Gift, Inbox, CalendarClock, Store, Users } from 'lucide-react';
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
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import {
    fetchResumenDePuntos, fetchAvisosDePuntos, fetchCuentasPorAsignar, QUE_HACER_POR_MOTIVO,
    fetchSerieDePuntos, fetchClientesConPuntos, fetchTableroDePuntos,
} from '@nucleo/data/puntos';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import AsignarCuentaModal from './puntos/AsignarCuentaModal';
import ClientePuntosModal from './puntos/ClientePuntosModal';
import TraspasosPendientes from './puntos/TraspasosPendientes';
import AvatarConEstado from '../components/common/AvatarConEstado';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

// `recharts` pesa: viaja en su propio chunk y se pide cuando la pestaña lo pinta.
const GraficaDiaria = lazy(() => import('./puntos/GraficasPuntos').then((m) => ({ default: m.GraficaDiaria })));
const GraficaVencimientos = lazy(() => import('./puntos/GraficasPuntos').then((m) => ({ default: m.GraficaVencimientos })));
import { fechaTexto } from '@nucleo/utils/fecha';
import { clickable } from '@nucleo/utils/clickable';

// Cada pestaña con su permiso. La lista que se le pasa a la URL es la de las
// VISIBLES: una dirección con `?tab=avisos` en manos de quien no la tiene cae a
// la primera que sí.
const PESTANAS = [
    { key: 'resumen',     label: 'Resumen',             icon: LayoutDashboard },
    { key: 'consulta',    label: 'Consulta',            icon: Search },
    { key: 'avisos',      label: 'Avisos',              icon: AlertTriangle },
    { key: 'por_asignar', label: 'Cuentas por asignar', icon: UserSearch },
];

// 100 puntos = US$1.00 (cláusula 4 del reglamento).
const dolares = (puntos) => formatMoney((Number(puntos) || 0) / 100);
const pts = (n) => formatQty(Number(n) || 0);

// Qué dice cada aviso. Los de movimientos fuera de lo normal traen su `nota`
// escrita en la base (cuántas ventas, cuántos vendedores…) y quién lo hizo.
const ptsDe = (a) => pts(a.puntos);
const AVISOS = {
    canje_sin_saldo:             { rotulo: 'Canje sin saldo suficiente', variante: 'danger', puntos: (a) => `Faltaron ${pts(a.faltaron)}` },
    canje_devuelto:              { rotulo: 'Canje devuelto: la factura se anuló', variante: 'info', puntos: (a) => `${ptsDe(a)} devueltos` },
    canje_venta_en_cero:         { rotulo: 'Canje dejó la venta en $0.00', variante: 'danger', puntos: (a) => `${ptsDe(a)} canjeados` },
    anulada_con_puntos_gastados: { rotulo: 'Anulada con puntos ya canjeados', variante: 'warning', puntos: (a) => `${ptsDe(a)} no recuperados` },
    muchas_ventas:               { rotulo: 'Muchas ventas a una ficha', variante: 'danger', puntos: (a) => `${ptsDe(a)} acumulados` },
    acumulacion_alta:            { rotulo: 'Acumulación alta en un día', variante: 'warning', puntos: (a) => `${ptsDe(a)} acumulados` },
    varias_salas:                { rotulo: 'Compras en 3 salas o más', variante: 'warning', puntos: (a) => `${ptsDe(a)} acumulados` },
    mismo_vendedor:              { rotulo: 'Mismo vendedor, varias veces', variante: 'warning', puntos: (a) => `${ptsDe(a)} acumulados` },
    venta_a_si_mismo:            { rotulo: 'Venta a su propia ficha', variante: 'danger', puntos: (a) => `${ptsDe(a)} acumulados` },
    ajuste_suma:                 { rotulo: 'Puntos dados a mano', variante: 'warning', puntos: (a) => `+${ptsDe(a)}` },
    ajuste_resta:                { rotulo: 'Puntos quitados a mano', variante: 'warning', puntos: (a) => `−${pts(Math.abs(a.puntos))}` },
    canje_grande:                { rotulo: 'Canje grande', variante: 'warning', puntos: (a) => `${ptsDe(a)} canjeados` },
    canje_recien_ganado:         { rotulo: 'Canje con puntos recién ganados', variante: 'warning', puntos: (a) => `${ptsDe(a)} canjeados` },
    cambio_cliente:              { rotulo: 'Compra pasada de otro cliente', variante: 'danger', puntos: (a) => `${ptsDe(a)} recibidos` },
    cambio_cliente_fallido:      { rotulo: 'Puntos de un cambio de cliente sin mover', variante: 'danger', puntos: (a) => `${ptsDe(a)} sin mover` },
};
// Un tipo que la pantalla todavía no conoce se muestra igual, no desaparece.
const avisoDe = (a) => AVISOS[a.tipo] ?? { rotulo: 'Movimiento para revisar', variante: 'warning', puntos: ptsDe };
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
        resumen:     hasPermission('puntos_tab_resumen', 'can_view'),
        consulta:    hasPermission('puntos_tab_consulta', 'can_view'),
        avisos:      hasPermission('puntos_tab_avisos', 'can_view'),
        por_asignar: hasPermission('puntos_tab_por_asignar', 'can_view'),
    };
    const visibles = PESTANAS.filter((t) => permitidas[t.key]);
    const [pestana, setPestana] = usePestanaEnUrl(visibles, visibles[0]?.key ?? 'resumen');
    const veResumen = visibles.some((t) => t.key === 'resumen');
    const veAvisos = visibles.some((t) => t.key === 'avisos');
    const vePorAsignar = visibles.some((t) => t.key === 'por_asignar');
    // Las tarjetas de cifras (Resumen y Consulta) son sólo de administración
    // (pedido del usuario, 2026-10-01). Con el nombre literal, por gate:permisos.
    const veTarjetas = hasPermission('puntos_tarjetas', 'can_view');

    const [resumen, setResumen] = useState(null);
    const [avisos, setAvisos] = useState([]);
    const [cuentas, setCuentas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [busqueda, setBusqueda] = useState('');
    const [motivo, setMotivo] = useState('TODOS');
    const [abierta, setAbierta] = useState(null);
    const [serie, setSerie] = useState([]);
    const [tablero, setTablero] = useState(null);
    const [clienteAbierto, setClienteAbierto] = useState(null);
    // El aviso tocado: abre el perfil del cliente con la venta del aviso arriba.
    const [avisoAbierto, setAvisoAbierto] = useState(null);

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
                const [r, a, c, se, tb] = await Promise.all([
                    fetchResumenDePuntos(),
                    veAvisos ? fetchAvisosDePuntos() : Promise.resolve([]),
                    vePorAsignar ? fetchCuentasPorAsignar() : Promise.resolve([]),
                    // La serie es de Resumen: sin esa pestaña, la base la niega.
                    veResumen ? fetchSerieDePuntos(30) : Promise.resolve([]),
                    veResumen ? fetchTableroDePuntos() : Promise.resolve(null),
                ]);
                if (!vivo) return;
                setResumen(r); setAvisos(a ?? []); setCuentas(c ?? []); setSerie(se ?? []); setTablero(tb);
            } catch (e) {
                if (vivo) showToast('No se pudo cargar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [showToast, version, veAvisos, vePorAsignar, veResumen]);

    const cuentasVisibles = useMemo(() => {
        const q = busqueda.trim();
        return cuentas.filter((c) => {
            if (motivo !== 'TODOS' && c.motivo !== motivo) return false;
            return !q || tokenMatch(q, c.nombre, c.dui, c.telefono, String(c.id_cliente));
        });
    }, [cuentas, motivo, busqueda]);

    const avisosVisibles = useMemo(() => {
        const q = busqueda.trim();
        return !q ? avisos : avisos.filter((a) => tokenMatch(q, a.cliente, a.documento, a.sala, a.vendedor));
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
            // Resumen no tiene lista que buscar: sin la lupa.
            onSearchChange={pestana === 'resumen' ? undefined : buscar}
            placeholder={pestana === 'avisos' ? 'Buscar por cliente, documento o vendedor…'
                : pestana === 'consulta' ? 'Buscar cliente por nombre, DUI o teléfono…'
                : 'Buscar por nombre, DUI o teléfono…'}
        />
    );

    return (
        <GlassViewLayout icon={Star} title="Puntos" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">
                {pestana === 'resumen' && (
                    <>
                        <AvisosDelPrograma resumen={resumen} cargando={cargando} />
                        <Resumen resumen={resumen} serie={serie} tablero={tablero} cargando={cargando}
                            irA={setPestana} veTarjetas={veTarjetas} onAbrirCliente={setClienteAbierto} />
                    </>
                )}

                {pestana === 'consulta' && (
                    <>
                        <AvisosDelPrograma resumen={resumen} cargando={cargando} />
                        {veTarjetas && (
                            <Tarjetas resumen={resumen} cargando={cargando}
                                avisos={veAvisos ? avisos.length : null}
                                porAsignar={vePorAsignar ? cuentas.length : null} irA={setPestana} />
                        )}
                        <ClientesConPuntos busqueda={busquedaClientes} onAbrir={setClienteAbierto} />
                    </>
                )}

                {/* Los traspasos de puntos que no terminaron, arriba de todo: son los
                    únicos avisos que piden hacer algo (2026-10-01). */}
                {pestana === 'avisos' && (
                    <TraspasosPendientes puedeResolver={hasPermission('puntos_ajustar', 'can_view')} />
                )}
                {pestana === 'avisos' && (
                    <DataTable
                        columns={[
                            { key: 'cuando',    label: 'Cuándo' },
                            { key: 'que',       label: 'Qué pasó' },
                            { key: 'cliente',   label: 'Cliente' },
                            { key: 'sala',      label: 'Sala' },
                            { key: 'vendio',    label: 'Vendió' },
                            { key: 'documento', label: 'Documento' },
                            { key: 'puntos',    label: 'Puntos' },
                        ]}
                        loading={cargando}
                        minWidth="980px"
                        // La fila abre el perfil del cliente con la venta: es un destino real.
                        movil={{ identidad: 'cliente', ancla: 'puntos', usarAccionDeFila: true }}
                        empty={{ icon: Inbox, message: busqueda.trim() ? 'Sin coincidencias' : 'Nada que revisar en los últimos 60 días' }}
                    >
                        {tramo(avisosVisibles, pagAvisos).map((a, i) => (
                            <DataRow key={`${a.tipo}-${a.invoice_id}-${i}`} index={i}
                                onClick={a.customer_id ? () => { setAvisoAbierto(a); setClienteAbierto(a.customer_id); } : undefined}>
                                <DataCell>{fechaHora12(a.cuando)}</DataCell>
                                <DataCell>
                                    <Badge variant={avisoDe(a).variante} tone="soft" uppercase={false}>{avisoDe(a).rotulo}</Badge>
                                    {a.nota && <div className="text-xs text-content-2 mt-1">{a.nota}</div>}
                                    {a.quien_id && (
                                        <div className="flex items-center gap-1.5 mt-1 text-xs text-content-2">
                                            <AvatarConEstado emp={{ id: a.quien_id, name: a.quien }} px={18} radio="rounded-full" marco="" />
                                            <span>{shortEmployeeName({ name: a.quien })}</span>
                                        </div>
                                    )}
                                </DataCell>
                                <DataCell>{a.cliente || <span className="text-content-3">—</span>}</DataCell>
                                <DataCell>{a.sala || '—'}</DataCell>
                                <DataCell>
                                    {a.vendedor ? (
                                        <span className="flex items-center gap-1.5 min-w-0">
                                            <AvatarConEstado emp={{ id: a.vendedor_id, name: a.vendedor }} px={20} radio="rounded-full" marco="" />
                                            <span className="truncate">{shortEmployeeName({ name: a.vendedor })}</span>
                                        </span>
                                    ) : <span className="text-content-3">—</span>}
                                </DataCell>
                                <DataCell><span className="tabular-nums">{a.documento || '—'}</span></DataCell>
                                <DataCell>
                                    <span className="tabular-nums">{avisoDe(a).puntos(a)}</span>
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
                // Con el nombre literal del permiso, para que lo vea gate:permisos.
                puedeAjustar={hasPermission('puntos_ajustar', 'can_view')}
                enPortal={resumen?.config?.fuente === 'portal'}
                aviso={avisoAbierto && avisoAbierto.customer_id === clienteAbierto ? {
                    fila: avisoAbierto, rotulo: avisoDe(avisoAbierto).rotulo,
                    variante: avisoDe(avisoAbierto).variante, puntosTexto: avisoDe(avisoAbierto).puntos(avisoAbierto),
                } : null}
                onClose={() => { setClienteAbierto(null); setAvisoAbierto(null); }}
                // La ficha se edita en el MISMO modal que usa Clientes. Se cierra
                // éste primero para no apilar dos diálogos.
                onEditar={(c) => {
                    setClienteAbierto(null);
                    setAvisoAbierto(null);
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

/**
 * Lo que la persona tiene que saber del programa antes que cualquier número:
 * de dónde salen las cifras hasta el arranque, si el arranque falló, y si la
 * acumulación está parada. Va en Resumen y en Consulta: la caja, que sólo mira
 * Consulta, también tiene que enterarse.
 */
function AvisosDelPrograma({ resumen, cargando }) {
    const cfg = resumen?.config;
    const enPortal = cfg?.fuente === 'portal' && cfg?.encendido;
    const anterior = resumen?.origen === 'sistema_anterior';
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
        </>
    );
}

/** Las tarjetas de Consulta: lo que la caja mira de un vistazo antes de buscar. */
function Tarjetas({ resumen, cargando, avisos, porAsignar, irA }) {
    const hoy = resumen?.periodos?.hoy ?? {};
    return (
        /* §17.0: el carril va en su contenedor de fila aunque esta pestaña no
           tenga píldora de filtros. */
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <CarrilCards className="flex-1" ariaLabel="Resumen del programa de puntos">
            {/* Un dato por `sub` (DESIGN §25.7): la tarjeta topa en 200px. */}
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
    );
}

/**
 * La pestaña Resumen (pedido del usuario, 2026-09-26: «dejamos gráficas y cosas
 * relevantes ahí, y Consulta sólo el listado con cards»). Dos filas:
 *   · la curva de 30 días a dos tercios y el mes por sala a su lado;
 *   · el mes en cifras, cuándo vencen y el estado del programa.
 */
function Resumen({ resumen, serie, tablero, cargando, irA, onAbrirCliente, veTarjetas }) {
    // En qué se leen la curva y las salas. El tooltip muestra siempre las dos.
    const [unidad, setUnidad] = useState('puntos');
    const deuda = tablero?.deuda ?? {};
    const act = tablero?.mes_actual ?? {};
    const ant = tablero?.mes_anterior ?? {};
    // «vs. ago» y no «vs. agosto al 28»: el sub de una tarjeta lleva un dato
    // corto (DESIGN §25.7). La comparación es contra el mismo día del mes
    // anterior, que es lo único justo a mitad de mes.
    const mesAnt = tablero?.mes_anterior_hasta
        ? fechaTexto(tablero.mes_anterior_hasta, { month: 'short' }).replace('.', '') : '';
    const cambio = (a, b) => {
        const x = Number(a) || 0; const y = Number(b) || 0;
        if (!y) return null;
        const pct = Math.round(((x - y) / y) * 100);
        return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}% vs. ${mesAnt}`;
    };
    const tasa = Number(act.acumulado) > 0
        ? Math.round((Number(act.canjeado) / Number(act.acumulado)) * 100) : null;

    return (
        <>
            {/* ── Las cuatro preguntas ─────────────────────────────────────
                §17.0: el carril va en su contenedor de fila. Sólo con su
                permiso (`puntos_tarjetas`). */}
            {veTarjetas && (
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            {/* Rótulos cortos: en el teléfono la tarjeta es media pantalla y
                «Acumulado del mes» se cortaba. El «del mes» lo dice el sub. */}
            <CarrilCards className="flex-1" ariaLabel="El programa de puntos en cifras, este mes">
                <StatCard icon={Wallet} iconBg="bg-brand/10" iconCls="text-brand-text"
                    label="Se les debe" value={dolares(deuda.puntos)}
                    sub={`${pts(deuda.puntos)} puntos`} loading={!tablero && cargando} />
                <StatCard icon={TrendingUp} iconBg="bg-success/10" iconCls="text-success-text"
                    label="Acumulado" value={pts(act.acumulado)}
                    sub={cambio(act.acumulado, ant.acumulado) ?? dolares(act.acumulado)}
                    loading={!tablero && cargando} />
                <StatCard icon={Gift} iconBg="bg-warning/10" iconCls="text-warning-text"
                    label="Canjeado" value={pts(act.canjeado)}
                    sub={tasa != null ? `${tasa}% de lo acumulado` : dolares(act.canjeado)}
                    loading={!tablero && cargando} />
                <StatCard icon={Users} iconBg="bg-brand/10" iconCls="text-brand-text"
                    label="Pueden canjear" value={pts(deuda.listos_clientes)}
                    sub={`${dolares(deuda.listos_puntos)} en puntos`}
                    onClick={() => irA('consulta')} loading={!tablero && cargando} />
            </CarrilCards>
            </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Panel icono={TrendingUp} titulo="Últimos 30 días" className="lg:col-span-2"
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
                <Panel icono={Store} titulo="Este mes, por sala" nota="Acumulado · canjeado">
                    {(resumen?.por_sala ?? []).length === 0 && !cargando
                        ? <p className="text-body-sm text-content-3 py-6 text-center">Sin movimientos este mes</p>
                        : <SalasDelMes salas={resumen?.por_sala ?? []} unidad={unidad} />}
                </Panel>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Panel icono={Trophy} titulo="Los que más puntos tienen" className="lg:col-span-2"
                    nota="Toca uno para ver todo lo suyo.">
                    <LosQueMasTienen lista={tablero?.top ?? []} onAbrir={onAbrirCliente} />
                </Panel>
                {/* En gráfica (pedido del usuario, 2026-09-28): se ve CUÁNDO cae
                    cada vencimiento, no sólo cuánto. Del tablero y no del
                    resumen: el mismo libro que «Se les debe», así cuadran. */}
                <Panel icono={CalendarClock} titulo="Cuándo vencen"
                    nota={tablero?.vencimientos?.[0]
                        ? `Lo próximo: ${pts(tablero.vencimientos[0].puntos)} puntos (${dolares(tablero.vencimientos[0].puntos)}) en ${fechaTexto(tablero.vencimientos[0].mes, { month: 'long', year: 'numeric' })}.`
                        : 'A los doce meses de la compra.'}>
                    {(tablero?.vencimientos ?? []).length === 0 && !cargando
                        ? <p className="text-body-sm text-content-3 py-6 text-center">Sin puntos por vencer</p>
                        : <Suspense fallback={<Hueco alto={220} />}>
                            <GraficaVencimientos lista={tablero?.vencimientos ?? []} hoy={tablero?.hoy} unidad={unidad} />
                          </Suspense>}
                </Panel>
            </div>
        </>
    );
}

/** Los clientes con más saldo: a quién ofrecerle canjear primero. */
function LosQueMasTienen({ lista, onAbrir }) {
    if (lista.length === 0) return <p className="text-body-sm text-content-3">Sin clientes con puntos</p>;
    const tope = Math.max(1, ...lista.map((c) => Number(c.saldo) || 0));
    return (
        <ol className="flex flex-col divide-y divide-divider">
            {lista.map((c, i) => (
                <li key={c.customer_id}>
                    <div {...clickable(() => onAbrir(c.customer_id), { label: `Ver los puntos de ${c.nombre}` })}
                        className="flex items-center gap-3 py-2.5 min-h-[var(--tap-min)] rounded-btn cursor-pointer active:scale-[0.99] transition-transform">
                        <span className="w-6 text-caption font-black text-content-3 tabular-nums text-right shrink-0">{i + 1}</span>
                        <div className="min-w-0 flex-1 flex flex-col gap-1">
                            <span className="text-body-sm font-bold text-content truncate">{c.nombre}</span>
                            <span className="h-1.5 rounded-full bg-[var(--chart-1)]" data-medida="dato"
                                style={{ width: `${((Number(c.saldo) || 0) / tope) * 100}%` }} />
                        </div>
                        <span className="text-right shrink-0 tabular-nums">
                            <span className="block text-body-sm font-black text-content">{pts(c.saldo)}</span>
                            <span className="block text-caption text-content-3">{dolares(c.saldo)}</span>
                        </span>
                        <ChevronRight size={16} className="text-content-3 shrink-0" />
                    </div>
                </li>
            ))}
        </ol>
    );
}

function Panel({ icono: Icono, titulo, nota, accion, className = '', children }) {
    return (
        <section data-surface="card" className={`p-4 md:p-5 flex flex-col gap-3 min-w-0 ${className}`}>
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

/**
 * Lo del mes por sala, como lista: nombre, dos barras (acumulado y canjeado,
 * los mismos colores de la curva) y el número escrito. Las barras comparten
 * escala —la del mayor acumulado— para que se comparen entre salas. El ANCHO es
 * el dato (`data-medida="dato"`). Sin `title`: los dos números ya van escritos.
 */
function SalasDelMes({ salas, unidad }) {
    const tope = Math.max(1, ...salas.map((s) => Number(s.acumulado) || 0));
    const cifra = (v) => (unidad === 'dolares' ? dolares(v) : pts(v));
    return (
        <ul className="flex flex-col gap-3">
            {salas.map((s) => (
                <li key={s.sala} className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-caption font-bold text-content-2 truncate">{s.sala}</span>
                        <span className="text-caption text-content-3 tabular-nums whitespace-nowrap">
                            <span className="font-bold text-content">{cifra(s.acumulado)}</span> · {cifra(s.canjeado)}
                        </span>
                    </div>
                    <div className="flex flex-col gap-0.5" data-medida="dato">
                        <span className="h-1.5 rounded-full bg-[var(--chart-1)]"
                            style={{ width: `${((Number(s.acumulado) || 0) / tope) * 100}%` }} />
                        <span className="h-1.5 rounded-full bg-[var(--chart-6)]"
                            style={{ width: `${((Number(s.canjeado) || 0) / tope) * 100}%` }} />
                    </div>
                </li>
            ))}
        </ul>
    );
}

// El lugar de la gráfica mientras llega su chunk: mismo alto, sin salto.
function Hueco({ alto }) {
    return <div className="animate-pulse rounded-card bg-surface-card-hover" style={{ height: alto }} />;
}

/**
 * TODOS los clientes, tengan o no puntos (pedido del usuario, 2026-10-01): la
 * caja tiene que poder buscar a cualquiera y ver «0» en vez de «no existe».
 * Pagina en la BASE (son ~28,500, no se bajan enteros) y la página vive en la
 * dirección con su propio parámetro. Tocar un cliente abre todo lo suyo.
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
                <Users size={14} /> Clientes
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
                empty={{ icon: Inbox, message: aplicado ? 'Sin coincidencias' : 'Sin clientes' }}
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
