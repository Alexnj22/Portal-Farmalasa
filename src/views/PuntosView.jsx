/**
 * Puntos — el programa, visto entero.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Desde el 1-oct-2026 los puntos viven en el portal (el sistema anterior se
 * apagó esa madrugada) y lo único que se veía era el panel de cada ficha. Esta
 * vista contesta las tres preguntas de quien opera el programa:
 *
 *   · Resumen            — ¿funciona? ¿cuánto se acumuló y se canjeó?
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
 * Los datos salen de funciones de la base que comprueban el permiso del módulo
 * `puntos` adentro (ver `src/data/puntos.js`).
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Star, Gauge, AlertTriangle, UserSearch, Coins, TrendingUp, Gift, Inbox, CalendarClock, Store } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import StatCard from '../components/common/StatCard';
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
} from '../data/puntos';
import AsignarCuentaModal from './puntos/AsignarCuentaModal';
import { fechaTexto } from '../utils/fecha';

const PESTANAS = [
    { key: 'resumen',     label: 'Resumen',             icon: Gauge },
    { key: 'avisos',      label: 'Avisos',              icon: AlertTriangle },
    { key: 'por_asignar', label: 'Cuentas por asignar', icon: UserSearch },
];

// 100 puntos = US$1.00 (cláusula 4 del reglamento).
const dolares = (puntos) => formatMoney((Number(puntos) || 0) / 100);
const pts = (n) => formatQty(Number(n) || 0);
const fechaCorta = (iso) => fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' }, '—');
// «octubre de 2027» → «Octubre de 2027»: sólo la primera letra. Con la clase
// `capitalize` salía «Octubre De 2027».
const mesLargo = (iso) => {
    const t = fechaTexto(iso, { month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
};

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

export default function PuntosView() {
    const { hasPermission } = useAuth();
    const puedeAsignar = hasPermission('puntos', 'can_edit');
    const showToast = useToastStore((s) => s.showToast);
    const [pestana, setPestana] = usePestanaEnUrl(PESTANAS, 'resumen');

    const [resumen, setResumen] = useState(null);
    const [avisos, setAvisos] = useState([]);
    const [cuentas, setCuentas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [busqueda, setBusqueda] = useState('');
    const [motivo, setMotivo] = useState('TODOS');
    const [abierta, setAbierta] = useState(null);

    // `version` sube para recargar (después de asignar una cuenta). El estado
    // ya nace «cargando» y la recarga lo prende desde el evento: prenderlo
    // dentro del efecto sería un setState síncrono en cascada.
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const [r, a, c] = await Promise.all([
                    fetchResumenDePuntos(), fetchAvisosDePuntos(), fetchCuentasPorAsignar(),
                ]);
                if (!vivo) return;
                setResumen(r); setAvisos(a ?? []); setCuentas(c ?? []);
            } catch (e) {
                if (vivo) showToast('No se pudo cargar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [showToast, version]);

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
    const buscar = (v) => {
        setBusqueda(v);
        (pestana === 'avisos' ? pagAvisos : pagCuentas).resetPage();
    };
    const filtrarMotivo = (v) => { setMotivo(v); pagCuentas.resetPage(); };

    const filtersContent = (
        <ViewTabBar
            tabs={PESTANAS}
            activeTab={pestana}
            onTabChange={setPestana}
            searchValue={pestana === 'resumen' ? undefined : busqueda}
            onSearchChange={pestana === 'resumen' ? undefined : buscar}
            placeholder={pestana === 'avisos' ? 'Buscar por cliente o documento…' : 'Buscar por nombre, DUI o teléfono…'}
        />
    );

    return (
        <GlassViewLayout icon={Star} title="Puntos" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">
                {pestana === 'resumen' && (
                    <Resumen resumen={resumen} cargando={cargando} avisos={avisos.length}
                        porAsignar={cuentas.length} irA={setPestana} />
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
                // Antes del arranque la base no deja asignar: la copia del 1-oct
                // reemplaza el archivo y la asignación se duplicaría.
                enPortal={resumen?.config?.fuente === 'portal'}
                onClose={() => setAbierta(null)}
                onAsignada={(idCliente) => {
                    setCuentas((p) => p.filter((c) => c.id_cliente !== idCliente));
                    setAbierta(null);
                    setCargando(true);
                    setVersion((v) => v + 1);
                }}
            />
        </GlassViewLayout>
    );
}

function Resumen({ resumen, cargando, avisos, porAsignar, irA }) {
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
                <StatCard icon={Coins} iconBg="bg-brand/10" iconCls="text-brand-text"
                    label="Puntos de los clientes" value={pts(resumen?.libro?.puntos)}
                    sub={`${dolares(resumen?.libro?.puntos)} · ${pts(resumen?.libro?.cuentas_con_saldo)} clientes`}
                    loading={cargando} />
                <StatCard icon={TrendingUp} iconBg="bg-success/10" iconCls="text-success-text"
                    label="Ganados hoy" value={pts(hoy.acumulado)}
                    sub={`${pts(hoy.ventas)} ventas · mes ${pts(mes.acumulado)}`}
                    loading={cargando} />
                <StatCard icon={Gift} iconBg="bg-warning/10" iconCls="text-warning-text"
                    label="Canjeados hoy" value={pts(hoy.canjeado)}
                    sub={`${pts(hoy.canjes)} canjes · mes ${pts(mes.canjeado)}`}
                    loading={cargando} />
                <StatCard icon={AlertTriangle} iconBg="bg-danger/10" iconCls="text-danger-text"
                    label="Avisos" value={pts(avisos)} sub="Últimos 60 días"
                    onClick={() => irA('avisos')} loading={cargando} />
                <StatCard icon={UserSearch} iconBg="bg-surface-card-hover" iconCls="text-content-3"
                    label="Cuentas por asignar" value={pts(porAsignar)}
                    sub={`${pts(resumen?.pendientes?.puntos)} puntos guardados`}
                    onClick={() => irA('por_asignar')} loading={cargando} />
            </CarrilCards>
            </div>

            <section className="space-y-3">
                <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                    <Store size={14} /> Este mes, por sala
                </h3>
                <DataTable
                    columns={[
                        { key: 'sala',      label: 'Sala' },
                        { key: 'acumulado', label: 'Ganados' },
                        { key: 'canjeado',  label: 'Canjeados' },
                    ]}
                    loading={cargando}
                    minWidth="480px"
                    empty={{ icon: Inbox, message: 'Sin movimientos este mes' }}
                >
                    {(resumen?.por_sala ?? []).map((s, i) => (
                        <DataRow key={s.sucursal ?? i} index={i}>
                            <DataCell>{s.sala}</DataCell>
                            <DataCell><span className="tabular-nums">{pts(s.acumulado)}</span></DataCell>
                            <DataCell><span className="tabular-nums">{pts(s.canjeado)}</span></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            </section>

            <section className="space-y-3">
                <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                    <CalendarClock size={14} /> Cuándo vencen
                </h3>
                <p className="text-caption text-content-3">
                    Los puntos vencen a los doce meses de la compra. Lo acumulado hasta el 30 de septiembre
                    de 2026 vence el 1 de octubre de 2027 (régimen de transición del reglamento).
                </p>
                <DataTable
                    columns={[
                        { key: 'mes',      label: 'Vencen en' },
                        { key: 'puntos',   label: 'Puntos' },
                        { key: 'valor',    label: 'Equivalen a' },
                        { key: 'clientes', label: 'Clientes' },
                    ]}
                    loading={cargando}
                    minWidth="560px"
                    movil={{ identidad: 'mes', ancla: 'puntos' }}
                    empty={{ icon: Inbox, message: 'Sin puntos por vencer' }}
                >
                    {(resumen?.vencimientos ?? []).map((v, i) => (
                        <DataRow key={v.mes} index={i}>
                            <DataCell>{mesLargo(v.mes)}</DataCell>
                            <DataCell><span className="tabular-nums">{pts(v.puntos)}</span></DataCell>
                            <DataCell><span className="tabular-nums">{dolares(v.puntos)}</span></DataCell>
                            <DataCell><span className="tabular-nums">{pts(v.clientes)}</span></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            </section>
        </>
    );
}
