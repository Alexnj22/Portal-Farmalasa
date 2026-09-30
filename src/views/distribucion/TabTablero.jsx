import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Wallet, Receipt, Users, ShoppingBasket, Package, ClipboardList, TrendingUp, TrendingDown, RefreshCw, MapPin,
    UserRound, Trophy, Store, CalendarClock, AlertTriangle, PackageX, Boxes, Clock, X, ChevronRight, CreditCard,
} from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import LiquidSelect from '../../components/common/LiquidSelect';
import SegmentedControl from '../../components/common/SegmentedControl';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { formatMoney, formatMoneyCorto, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fetchTablero, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { FORMA_PAGO, rotuloTipoCliente, rangoDe } from './comun';
import { rutaSeccion, rutaVentaA } from './rutas';

// El Inicio de la distribuidora. Pedido del usuario (2026-09-29): «un
// dashboard con datos de ventas, clientes, etc., con gráficas y elementos
// interactivos».
//
// Todo sale de `dist_tablero` (borrador 0011) en UNA llamada. Los filtros —el
// período, la ruta y el vendedor— viven en la DIRECCIÓN (regla del portal:
// recargar o pasar el enlace no pierde lo que se estaba mirando) y valen para
// todo el tablero. Tocar una ruta en la dona o un vendedor en su ranking
// filtra; tocarlo otra vez suelta el filtro.
//
// Las gráficas vienen de `GraficasTablero.jsx` por `lazy`: recharts pesa y
// sólo viaja si alguien abre el Inicio.

const GraficaVentasDiarias = lazy(() => import('./GraficasTablero').then(m => ({ default: m.GraficaVentasDiarias })));
const GraficaDona = lazy(() => import('./GraficasTablero').then(m => ({ default: m.GraficaDona })));
const GraficaSemana = lazy(() => import('./GraficasTablero').then(m => ({ default: m.GraficaSemana })));
const GraficaHoras = lazy(() => import('./GraficasTablero').then(m => ({ default: m.GraficaHoras })));

// Los mismos colores que la dona, por posición (--chart-1..9): la lista de al
// lado tiene que pintar cada ruta del color de su sector. Paleta vigente de
// DESIGN.md §6: chart-2, -5 y -7 están retirados.
const PUNTOS = ['bg-chart-1', 'bg-success', 'bg-chart-3', 'bg-chart-4', 'bg-chart-9', 'bg-chart-6', 'bg-warning', 'bg-chart-8'];

const num = (v) => Number(v) || 0;
/** Variación contra el período anterior, o null si antes no hubo nada con qué comparar. */
const variacion = (actual, antes) => (num(antes) > 0 ? ((num(actual) - num(antes)) / num(antes)) * 100 : null);

function Variacion({ actual, antes }) {
    const v = variacion(actual, antes);
    if (v == null) return <span className="text-content-3">sin período anterior</span>;
    const sube = v >= 0;
    const Icono = sube ? TrendingUp : TrendingDown;
    return (
        <span className={`inline-flex items-center gap-1 font-bold ${sube ? 'text-success-text' : 'text-danger-text'}`}>
            <Icono size={12} /> {sube ? '+' : ''}{v.toFixed(1)}% <span className="font-normal text-content-3">vs. anterior</span>
        </span>
    );
}

/** Una tarjeta del tablero: título, acción opcional a la derecha y contenido. */
function Tarjeta({ titulo, icon: Icon, accion, children, className = '' }) {
    return (
        <section data-surface="card" className={`p-4 flex flex-col gap-3 min-w-0 ${className}`}>
            <header className="flex items-center justify-between gap-2 min-w-0">
                <h3 className="flex items-center gap-2 text-body font-black text-content truncate">
                    {Icon && <Icon size={16} className="text-brand-text shrink-0" />} {titulo}
                </h3>
                {accion}
            </header>
            {children}
        </section>
    );
}

const Cargando = ({ alto = 190 }) => <div className="animate-pulse rounded-xl bg-surface-card-hover" style={{ height: alto }} />;

/** Una fila de ranking con su barra proporcional. Tocable si `onClick`. */
function FilaRanking({ izquierda, titulo, detalle, valor, proporcion, activo, onClick, tono = 'bg-chart-1' }) {
    const Tag = onClick ? 'button' : 'div';
    return (
        <Tag type={onClick ? 'button' : undefined} onClick={onClick} aria-pressed={onClick ? !!activo : undefined}
            className={`w-full text-left flex items-center gap-2.5 rounded-xl px-2 py-1.5 min-h-[var(--tap-min)] ${onClick ? 'hover:bg-surface-card-hover active:scale-[0.99] transition-transform' : ''} ${activo ? 'bg-brand/10 ring-1 ring-inset ring-brand/30' : ''}`}>
            {izquierda}
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                    <span className="text-body-sm font-bold text-content-2 truncate">{titulo}</span>
                    <span className="text-body-sm font-black text-content tabular-nums shrink-0">{valor}</span>
                </span>
                <span className="block h-1.5 rounded-full bg-surface-card-hover mt-1 overflow-hidden" data-medida="dato">
                    <span className={`block h-full rounded-full ${tono}`} style={{ width: `${Math.max(2, Math.round(proporcion * 100))}%` }} />
                </span>
                {detalle && <span className="block text-caption text-content-3 truncate mt-0.5">{detalle}</span>}
            </span>
        </Tag>
    );
}

export default function TabTablero({ periodo = '30d' }) {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const ruta = params.get('ruta') || '';
    const vendedor = params.get('vendedor') || '';
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [actualizado, setActualizado] = useState(null);
    const [metrica, setMetrica] = useState('ventas');
    const [cuando, setCuando] = useState('dia');
    const [todos, setTodos] = useState({}); // qué rankings muestran los 10 y no sólo 5

    const { desde, hasta } = useMemo(() => rangoDe(periodo), [periodo]);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            setDatos(await fetchTablero({ desde, hasta, ruta, vendedor }));
            setActualizado(new Date());
        } catch (e) {
            console.error('tablero', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [desde, hasta, ruta, vendedor]);
    useEffect(() => { cargar(); }, [cargar]);

    /** Pone o quita un filtro en la dirección (reemplaza: no ensucia el historial). */
    const filtrar = (clave, valor) => setParams(p => {
        if (valor) p.set(clave, valor); else p.delete(clave);
        return p;
    }, { replace: true });

    const r = datos?.resumen ?? {};
    const a = datos?.anterior ?? {};
    const rutas = datos?.por_ruta ?? [];
    const vendedores = datos?.por_vendedor ?? [];
    const tipos = datos?.por_tipo ?? [];
    const productos = datos?.top_productos ?? [];
    const clientes = datos?.top_clientes ?? [];
    const formas = datos?.formas_pago ?? [];
    const maxDe = (lista, k = 'ventas') => Math.max(1, ...lista.map(x => num(x[k])));
    const totalFormas = formas.reduce((s, f) => s + num(f.monto), 0) || 1;
    const nombreVendedor = (id) => shortEmployeeName(datos?.filtros?.vendedores?.find(v => v.id === id)) || 'Vendedor';
    const hayFiltro = !!ruta || !!vendedor;
    const VISIBLES = 5;
    const recorte = (clave, lista) => (todos[clave] ? lista : lista.slice(0, VISIBLES));
    const verTodos = (clave, lista) => (lista.length > VISIBLES ? (
        <Button size="sm" variant="ghost" onClick={() => setTodos(t => ({ ...t, [clave]: !t[clave] }))}>
            {todos[clave] ? 'Ver menos' : `Ver los ${lista.length}`}
        </Button>
    ) : null);
    const sinVentas = !cargando && datos && num(r.documentos) === 0;

    return (
        <div className="p-3 md:p-5 flex flex-col gap-4">
            {/* ── Filtros ── */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="w-full sm:w-56">
                    <LiquidSelect compact icon={MapPin} value={ruta} placeholder="Todas las rutas" ariaLabel="Filtrar por ruta"
                        options={(datos?.filtros?.rutas ?? []).map(x => ({ value: x, label: x }))}
                        onChange={(v) => filtrar('ruta', v)} />
                </div>
                <div className="w-full sm:w-56">
                    <LiquidSelect compact icon={UserRound} value={vendedor} placeholder="Todos los vendedores" ariaLabel="Filtrar por vendedor"
                        options={(datos?.filtros?.vendedores ?? []).map(v => ({ value: v.id, label: shortEmployeeName(v) }))}
                        onChange={(v) => filtrar('vendedor', v)} />
                </div>
                {hayFiltro && (
                    <Button size="sm" variant="ghost" icon={X} onClick={() => setParams(p => { p.delete('ruta'); p.delete('vendedor'); return p; }, { replace: true })}>
                        Quitar filtros
                    </Button>
                )}
                <div className="sm:ml-auto flex items-center gap-2 text-caption text-content-3">
                    <span>{fechaNumerica(desde)}{desde !== hasta ? ` – ${fechaNumerica(hasta)}` : ''}</span>
                    {actualizado && <span className="hidden md:inline">· al {hora12(actualizado)}</span>}
                    <Button size="sm" variant="ghost" iconOnly icon={RefreshCw} title="Actualizar" onClick={cargar} disabled={cargando} />
                </div>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            {sinVentas && (
                <Notice variant="info" compact>No hay ventas en este período{hayFiltro ? ' con esos filtros' : ''}. Prueba con un período más largo.</Notice>
            )}

            {/* ── Indicadores ── */}
            <CarrilCards ariaLabel="Indicadores del período">
                <StatCard icon={Wallet} label="Ventas" value={formatMoney(num(r.ventas))} loading={cargando}
                    iconBg="bg-brand/10" iconCls="text-brand-text" sub={<Variacion actual={r.ventas} antes={a.ventas} />} />
                <StatCard icon={Receipt} label="Documentos" value={formatQty(num(r.documentos))} loading={cargando}
                    sub={<Variacion actual={r.documentos} antes={a.documentos} />} />
                <StatCard icon={ShoppingBasket} label="Ticket promedio" value={formatMoney(num(r.ticket))} loading={cargando}
                    sub={<Variacion actual={r.ticket} antes={a.ticket} />} />
                <StatCard icon={Users} label="Clientes que compraron" value={formatQty(num(r.clientes))} loading={cargando}
                    sub={<Variacion actual={r.clientes} antes={a.clientes} />} />
                <StatCard icon={Package} label="Unidades" value={formatQty(num(r.unidades))} loading={cargando} sub="Vendidas en el período" />
                <StatCard icon={ClipboardList} label="Preventas por facturar" value={formatMoney(num(datos?.preventas?.monto))} loading={cargando}
                    iconBg="bg-warning/10" iconCls="text-warning-text" sub={`${formatQty(num(datos?.preventas?.total))} pendientes · ver`}
                    onClick={() => navigate(rutaSeccion('pedidos', 'vista=pendientes'))} />
            </CarrilCards>

            {/* ── Tendencia y rutas ── */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <Tarjeta titulo={metrica === 'ventas' ? 'Ventas por día' : 'Documentos por día'} icon={TrendingUp} className="xl:col-span-2"
                    accion={<SegmentedControl value={metrica} onChange={setMetrica} size="sm" label="Qué mirar"
                        options={[{ value: 'ventas', label: 'Ventas' }, { value: 'documentos', label: 'Documentos' }]} />}>
                    {metrica === 'ventas' && num(r.devuelto) > 0 && (
                        <p className="text-caption text-content-3 -mt-1 mb-2" data-testid="devuelto">
                            Ya descuenta {formatMoney(num(r.devuelto))} en devoluciones (notas de crédito).
                        </p>
                    )}
                    <Suspense fallback={<Cargando alto={240} />}>
                        {cargando && !datos ? <Cargando alto={240} /> : <GraficaVentasDiarias serie={datos?.serie} metrica={metrica} />}
                    </Suspense>
                    {metrica === 'ventas' && (
                        <p className="text-caption text-content-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-chart-1" /> Este período</span>
                            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-chart-8" /> Período anterior ({formatMoneyCorto(num(a.ventas))})</span>
                        </p>
                    )}
                </Tarjeta>

                <Tarjeta titulo="Ventas por ruta" icon={MapPin}
                    accion={ruta ? <Badge size="sm" variant="info" uppercase={false}>Filtrando</Badge> : null}>
                    <Suspense fallback={<Cargando />}>
                        {cargando && !datos ? <Cargando /> : (
                            <GraficaDona datos={rutas} clave="ruta" activo={ruta || null} onElegir={(v) => filtrar('ruta', v)} />
                        )}
                    </Suspense>
                    <div className="flex flex-col gap-0.5">
                        {rutas.map((x, i) => (
                            <FilaRanking key={x.ruta} tono={PUNTOS[i % PUNTOS.length]} activo={ruta === x.ruta}
                                onClick={() => filtrar('ruta', ruta === x.ruta ? '' : x.ruta)}
                                izquierda={<span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PUNTOS[i % PUNTOS.length]}`} />}
                                titulo={x.ruta} valor={formatMoneyCorto(num(x.ventas))} proporcion={num(x.ventas) / maxDe(rutas)}
                                detalle={`${formatQty(num(x.documentos))} documentos · ${formatQty(num(x.clientes))} clientes`} />
                        ))}
                    </div>
                </Tarjeta>
            </div>

            {/* ── Quién vende, qué se vende, a quién ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                <Tarjeta titulo="Vendedores" icon={Trophy} accion={verTodos('vendedores', vendedores)}>
                    {vendedores.length === 0 && !cargando && <p className="text-caption text-content-3">Sin ventas en el período.</p>}
                    <div className="flex flex-col gap-0.5">
                        {recorte('vendedores', vendedores).map((v, i) => (
                            <FilaRanking key={v.id} activo={vendedor === v.id}
                                onClick={() => filtrar('vendedor', vendedor === v.id ? '' : v.id)}
                                izquierda={<span className="relative shrink-0">
                                    <AvatarConEstado emp={{ id: v.id, name: v.name, photo_url: v.photo_url }} px={32} radio="rounded-full" marco="" />
                                    {i === 0 && <Trophy size={11} className="absolute -top-1 -right-1 text-warning-text" aria-hidden="true" />}
                                </span>}
                                titulo={shortEmployeeName(v) || nombreVendedor(v.id)} valor={formatMoneyCorto(num(v.ventas))}
                                proporcion={num(v.ventas) / maxDe(vendedores)}
                                detalle={`${formatQty(num(v.documentos))} documentos · ${formatQty(num(v.clientes))} clientes`} />
                        ))}
                    </div>
                </Tarjeta>

                <Tarjeta titulo="Productos más vendidos" icon={Package} accion={verTodos('productos', productos)}>
                    {productos.length === 0 && !cargando && <p className="text-caption text-content-3">Sin ventas en el período.</p>}
                    <div className="flex flex-col gap-0.5">
                        {recorte('productos', productos).map((p, i) => (
                            <FilaRanking key={p.product_id} tono="bg-success"
                                izquierda={<span className="w-5 text-caption font-black text-content-3 tabular-nums text-right shrink-0">{i + 1}</span>}
                                titulo={p.nombre} valor={formatMoneyCorto(num(p.ventas))} proporcion={num(p.ventas) / maxDe(productos)}
                                detalle={`${formatQty(num(p.unidades))} unidades · en ${formatQty(num(p.documentos))} documentos`} />
                        ))}
                    </div>
                </Tarjeta>

                <Tarjeta titulo="Mejores clientes" icon={Store} accion={verTodos('clientes', clientes)}>
                    {clientes.length === 0 && !cargando && <p className="text-caption text-content-3">Sin ventas en el período.</p>}
                    <div className="flex flex-col gap-0.5">
                        {recorte('clientes', clientes).map((c, i) => (
                            <FilaRanking key={c.id} tono="bg-chart-3"
                                izquierda={<span className="w-5 text-caption font-black text-content-3 tabular-nums text-right shrink-0">{i + 1}</span>}
                                titulo={c.nombre} valor={formatMoneyCorto(num(c.ventas))} proporcion={num(c.ventas) / maxDe(clientes)}
                                detalle={`${rotuloTipoCliente(c.tipo)} · ${formatQty(num(c.documentos))} compras · última ${fechaNumerica(c.ultima)}`} />
                        ))}
                    </div>
                </Tarjeta>
            </div>

            {/* ── Cuándo y cómo se vende; lo que pide atención ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                <Tarjeta titulo="Cuándo se vende" icon={Clock}
                    accion={<SegmentedControl value={cuando} onChange={setCuando} size="sm" label="Por"
                        options={[{ value: 'dia', label: 'Día' }, { value: 'hora', label: 'Hora' }]} />}>
                    <Suspense fallback={<Cargando alto={170} />}>
                        {cargando && !datos ? <Cargando alto={170} />
                            : cuando === 'dia' ? <GraficaSemana datos={datos?.por_dia_semana} /> : <GraficaHoras datos={datos?.por_hora} />}
                    </Suspense>
                    <p className="text-caption text-content-3">
                        {cuando === 'dia' ? 'En verde, el día que más se vende.' : 'Documentos emitidos a cada hora.'}
                    </p>
                </Tarjeta>

                <Tarjeta titulo="Clientes y cobro" icon={CreditCard}>
                    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 items-center">
                        <Suspense fallback={<Cargando alto={112} />}>
                            {cargando && !datos ? <Cargando alto={112} /> : <GraficaDona datos={tipos} clave="tipo" alto={112} />}
                        </Suspense>
                        <div className="flex flex-col gap-1">
                            {tipos.map((t, i) => (
                                <div key={t.tipo} className="flex items-center justify-between gap-2 text-caption">
                                    <span className="flex items-center gap-1.5 min-w-0">
                                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PUNTOS[i % PUNTOS.length]}`} />
                                        <span className="truncate text-content-2 font-bold">{rotuloTipoCliente(t.tipo)}</span>
                                    </span>
                                    <span className="tabular-nums text-content-2">{formatMoneyCorto(num(t.ventas))}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="border-t border-divider pt-3 flex flex-col gap-2">
                        <p className="text-micro font-bold uppercase tracking-wide text-content-3">Formas de pago</p>
                        {/* Una barra apilada: el ancho de cada tramo ES la proporción. */}
                        <div className="flex h-3 rounded-full overflow-hidden bg-surface-card-hover" data-medida="dato">
                            {formas.map((f, i) => (
                                <span key={f.forma} className={PUNTOS[i % PUNTOS.length]} style={{ width: `${(num(f.monto) / totalFormas) * 100}%` }} />
                            ))}
                        </div>
                        {formas.map((f, i) => (
                            <div key={f.forma} className="flex items-center justify-between gap-2 text-caption">
                                <span className="flex items-center gap-1.5 min-w-0">
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PUNTOS[i % PUNTOS.length]}`} />
                                    <span className="truncate text-content-2 font-bold">
                                        {f.forma === '13' ? 'A crédito' : (FORMA_PAGO.find(x => x.value === f.forma)?.label ?? f.forma)}
                                    </span>
                                </span>
                                <span className="tabular-nums text-content-2">{formatMoneyCorto(num(f.monto))} · {Math.round((num(f.monto) / totalFormas) * 100)}%</span>
                            </div>
                        ))}
                    </div>
                </Tarjeta>

                <Tarjeta titulo="Pide atención" icon={AlertTriangle}>
                    {/* Clientes que dejaron de comprar: el botón abre una venta ya con ese cliente. */}
                    <div className="flex flex-col gap-1.5">
                        <p className="flex items-center justify-between text-micro font-bold uppercase tracking-wide text-content-3">
                            <span className="flex items-center gap-1.5"><CalendarClock size={12} /> Sin comprar hace +30 días</span>
                            <Badge size="sm" variant={num(datos?.inactivos?.total) ? 'warning' : 'success'} uppercase={false}>{formatQty(num(datos?.inactivos?.total))}</Badge>
                        </p>
                        {(datos?.inactivos?.lista ?? []).slice(0, 4).map(c => (
                            <button key={c.id} type="button" data-inactivo={c.id} onClick={() => navigate(rutaVentaA(c.id))}
                                className="w-full flex items-center justify-between gap-2 rounded-xl px-2 min-h-[var(--tap-min)] text-left hover:bg-surface-card-hover active:scale-[0.99] transition-transform">
                                <span className="min-w-0">
                                    <span className="block text-body-sm font-bold text-content-2 truncate">{c.nombre}</span>
                                    <span className="block text-caption text-content-3 truncate">
                                        {c.ultima ? `Última compra ${fechaNumerica(c.ultima)}` : 'Nunca ha comprado'} · {c.ruta}
                                    </span>
                                </span>
                                <span className="flex items-center gap-1 text-caption font-bold text-brand-text shrink-0">Vender <ChevronRight size={14} /></span>
                            </button>
                        ))}
                    </div>
                    <div className="border-t border-divider pt-3 flex flex-col gap-1.5">
                        <p className="flex items-center justify-between text-micro font-bold uppercase tracking-wide text-content-3">
                            <span className="flex items-center gap-1.5"><Boxes size={12} /> Lotes que vencen en 90 días</span>
                            <Badge size="sm" variant={num(datos?.inventario?.por_vencer_total) ? 'warning' : 'success'} uppercase={false}>{formatQty(num(datos?.inventario?.por_vencer_total))}</Badge>
                        </p>
                        {(datos?.inventario?.por_vencer ?? []).slice(0, 3).map(l => (
                            <div key={l.id} className="flex items-center justify-between gap-2 px-2 text-caption">
                                <span className="min-w-0 truncate text-content-2"><b>{l.nombre}</b> · {l.lote}</span>
                                <span className={`shrink-0 tabular-nums font-bold ${num(l.dias) <= 30 ? 'text-danger-text' : 'text-warning-text'}`}>{formatQty(num(l.existencia))} u. · {num(l.dias)} d</span>
                            </div>
                        ))}
                    </div>
                    <div className="border-t border-divider pt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => navigate(rutaSeccion('perdidas'))}
                            className="rounded-xl border border-divider p-2.5 text-left min-h-[var(--tap-min)] hover:bg-surface-card-hover active:scale-[0.99] transition-transform">
                            <span className="flex items-center gap-1.5 text-caption text-content-3"><PackageX size={12} /> Ventas perdidas</span>
                            <span className="block text-title font-black text-content tabular-nums">{formatQty(num(datos?.perdidas?.pendientes))}</span>
                            <span className="block text-caption text-content-3 truncate">{datos?.perdidas?.top?.[0]?.producto ?? 'Sin pendientes'}</span>
                        </button>
                        <button type="button" onClick={() => navigate(rutaSeccion('inventario'))}
                            className="rounded-xl border border-divider p-2.5 text-left min-h-[var(--tap-min)] hover:bg-surface-card-hover active:scale-[0.99] transition-transform">
                            <span className="flex items-center gap-1.5 text-caption text-content-3"><Boxes size={12} /> Inventario</span>
                            <span className="block text-title font-black text-content tabular-nums">{formatMoneyCorto(num(datos?.inventario?.valor))}</span>
                            <span className="block text-caption text-content-3 truncate">{formatQty(num(datos?.inventario?.sin_existencia))} productos sin existencia</span>
                        </button>
                    </div>
                </Tarjeta>
            </div>
        </div>
    );
}
