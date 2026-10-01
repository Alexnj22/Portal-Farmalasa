import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    MapPin, ShoppingBag, XCircle, UserRound, DoorClosed, UserX, HandCoins, Navigation, Loader2, CheckCircle2, Route, ArrowUp, ArrowDown, Save, Plus, Phone, AlertTriangle,
} from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import FilterBar from '../../components/common/FilterBar';
import FiltroDia from './FiltroDia';
import Campo from './Campo';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { hoySV, diasDesde } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import {
    fetchRutaDelDia, registrarVisita, fetchRutas, guardarRuta, fetchClientesDeRuta, ordenarRuta, fetchVendedores, mensajeDeDistribucion,
} from '@nucleo/data/distribucion';
import { rutaVentaA } from './rutas';
import { rotuloTipoCliente } from './comun';

// Rutas y visitas (borrador 0027). «Hoy»: los clientes de las rutas que tocan
// ese día, en su orden, con lo que conviene saber antes de entrar —qué debe,
// si está atrasado, cuándo compró— y qué pasó en la visita. «Armar rutas»
// (quien administra): días, vendedor y orden de recorrido.

const RESULTADOS = [
    { value: 'sin_pedido', label: 'Sin pedido', icon: XCircle },
    { value: 'cerrado', label: 'Cerrado', icon: DoorClosed },
    { value: 'no_estaba', label: 'No estaba', icon: UserX },
    { value: 'cobro', label: 'Sólo cobro', icon: HandCoins },
];
const DIAS = [{ n: 1, c: 'L' }, { n: 2, c: 'M' }, { n: 3, c: 'Mi' }, { n: 4, c: 'J' }, { n: 5, c: 'V' }, { n: 6, c: 'S' }, { n: 7, c: 'D' }];
const ROTULO_RESULTADO = Object.fromEntries(RESULTADOS.map(r => [r.value, r.label]));

// La ubicación de la visita se pide SÓLO en la app (Capacitor) y SÓLO al
// registrar la visita de la ruta (decisión del usuario, 2026-10-01: «solo para
// las apps, y solo cuando se haga ruta de pedido»). En el navegador no se
// pregunta nada: además `vercel.json` manda `geolocation=()`, que la apaga en
// todo el sitio. El plugin nativo no depende de esa cabecera: pide su propio
// permiso al sistema la primera vez.
const esApp = () => !!window.Capacitor?.isNativePlatform?.();
let geoPromise = null;
function getGeo() {
    if (!geoPromise) {
        geoPromise = import('@capacitor/geolocation')
            .then(m => m.Geolocation)
            .catch(err => { geoPromise = null; throw err; });
    }
    return geoPromise;
}
/** La ubicación del teléfono, si la da en 8 segundos. Sin ella, la visita cuenta igual. */
async function ubicacion() {
    if (!esApp()) return null;
    try {
        const Geo = await getGeo();
        const p = await Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
        return { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch (e) {
        console.warn('rutas: sin ubicación para la visita', e?.message ?? e);
        return null;
    }
}
const comoLlegar = (c) => (c.lat != null && c.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.nombre} ${c.direccion ?? ''} Chalatenango El Salvador`)}`);

function Hoy({ puedeConfigurar }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const showToast = useToastStore(s => s.showToast);
    const [params, setParams] = useSearchParams();
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') ?? '') ? params.get('fecha') : hoySV();
    const vendedorId = (puedeConfigurar && params.get('vendedor')) || user?.id;
    const cambiar = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
    const [vendedores, setVendedores] = useState([]);
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState(null);

    const cargar = useCallback(async () => {
        if (!vendedorId) return;
        setCargando(true);
        setError('');
        try { setDatos(await fetchRutaDelDia(vendedorId, fecha)); } catch (e) { console.error('ruta', e); setError(mensajeDeDistribucion(e)); } finally { setCargando(false); }
    }, [vendedorId, fecha]);
    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => { if (puedeConfigurar) fetchVendedores().then(setVendedores).catch(() => {}); }, [puedeConfigurar]);

    const clientes = useMemo(() => datos?.clientes ?? [], [datos]);
    const n = { total: clientes.length, venta: clientes.filter(c => c.estado === 'venta').length, visitados: clientes.filter(c => c.estado !== 'pendiente').length };
    const esHoy = fecha === hoySV();
    const esMio = vendedorId === user?.id;

    const visitar = async (c, resultado) => {
        setOcupado(`${c.id}:${resultado}`);
        try {
            const gps = await ubicacion();
            await registrarVisita(c.id, resultado, gps ?? {});
            useStaff.getState().appendAuditLog('DISTRIBUCION_VISITA', String(c.id), { resultado, con_gps: !!gps });
            showToast(`${c.nombre}: ${ROTULO_RESULTADO[resultado]}`, gps && c.lat == null ? 'Se guardó la ubicación del cliente.' : '', 'success');
            await cargar();
        } catch (e) {
            showToast('No se pudo registrar la visita', mensajeDeDistribucion(e), 'error');
        } finally {
            setOcupado(null);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Avance a la izquierda, la píldora de filtros a la derecha (DESIGN §17). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Avance de la ruta">
                    <StatCard icon={MapPin} label="Por visitar" value={formatQty(n.total - n.visitados)} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub={`de ${formatQty(n.total)} clientes`} />
                    <StatCard icon={ShoppingBag} label="Con venta" value={formatQty(n.venta)} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub={n.visitados ? `${Math.round((n.venta / n.visitados) * 100)}% de los visitados` : 'Todavía nadie'} />
                    <StatCard icon={CheckCircle2} label="Visitados" value={formatQty(n.visitados)} loading={cargando}
                        iconBg="bg-chart-3/10" iconCls="text-chart-3" sub={datos?.fuera_de_ruta ? `+ ${datos.fuera_de_ruta} ventas fuera de ruta` : 'Venta o visita registrada'} />
                </CarrilCards>
                <div className="flex justify-end min-w-0">
                    <FilterBar onClear={() => { cambiar('fecha', ''); cambiar('vendedor', ''); }}
                        activeCount={(fecha !== hoySV() ? 1 : 0) + (params.get('vendedor') ? 1 : 0)}>
                        <FilterBar.Section active={fecha !== hoySV()} onClear={() => cambiar('fecha', '')} label="fecha">
                            <FiltroDia fecha={fecha} max={null} onChange={(d) => cambiar('fecha', d !== hoySV() ? d : '')} />
                        </FilterBar.Section>
                        {puedeConfigurar && (
                            <FilterBar.Section active={!!params.get('vendedor')} onClear={() => cambiar('vendedor', '')} label="vendedor">
                                <FilterBar.Opciones label="Vendedor" icon={UserRound} umbral={1} ancho="200px"
                                    value={vendedorId ?? ''} onChange={(v) => cambiar('vendedor', v || '')}
                                    options={vendedores.map(v => ({ value: v.id, label: shortEmployeeName(v.name) }))} />
                            </FilterBar.Section>
                        )}
                    </FilterBar>
                </div>
            </div>
            {datos?.rutas?.length > 0 && <p className="text-caption text-content-3">{datos.rutas.map(r => r.nombre).join(' · ')}</p>}
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            {!cargando && clientes.length === 0 && (
                <Notice variant="info" icon={Route}>
                    {datos?.rutas?.length ? 'Las rutas de este día no tienen clientes.' : 'Este día no tiene rutas asignadas.'}
                    {puedeConfigurar ? ' Se arman en «Armar rutas».' : ''}
                </Notice>
            )}
            <ol className="flex flex-col gap-2" aria-label="Clientes de la ruta">
                {clientes.map((c, i) => (
                    <li key={c.id} data-surface="card" className={`p-3 flex flex-col gap-2 ${c.estado !== 'pendiente' ? 'opacity-75' : ''}`} data-cliente-ruta={c.estado}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex gap-3">
                                <span className="w-7 h-7 rounded-full bg-surface-card-hover flex items-center justify-center text-caption font-black text-content-2 shrink-0">{i + 1}</span>
                                <div className="min-w-0">
                                    <p className="text-body-sm font-black text-content truncate">{c.nombre}</p>
                                    <p className="text-caption text-content-3 truncate">{rotuloTipoCliente(c.tipo)}{c.direccion ? ` · ${c.direccion}` : ''}</p>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {Number(c.saldo) > 0 && <Badge size="sm" variant={Number(c.vencido) > 0 ? 'danger' : 'neutral'} uppercase={false}>
                                            Debe {formatMoney(Number(c.saldo))}{Number(c.vencido) > 0 ? ` · ${formatMoney(Number(c.vencido))} atrasado` : ''}</Badge>}
                                        {c.ultima_compra
                                            ? <Badge size="sm" variant={diasDesde(c.ultima_compra) > 30 ? 'warning' : 'neutral'} uppercase={false}>compró hace {diasDesde(c.ultima_compra)} días</Badge>
                                            : <Badge size="sm" variant="info" uppercase={false}>nunca ha comprado</Badge>}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                {c.estado === 'venta' && <Badge size="sm" variant="success" uppercase={false}>Vendió {formatMoney(Number(c.venta))}</Badge>}
                                {c.estado === 'visitado' && <Badge size="sm" variant="neutral" uppercase={false}>{ROTULO_RESULTADO[c.visita?.resultado] ?? 'Visitado'}</Badge>}
                                {c.estado === 'pendiente' && <Badge size="sm" variant="warning" uppercase={false}>Pendiente</Badge>}
                            </div>
                        </div>
                        {esHoy && esMio && (
                            <div className="flex flex-wrap gap-1.5">
                                <Button size="sm" variant="primary" icon={ShoppingBag} onClick={() => navigate(rutaVentaA(c.id))}>Vender</Button>
                                {RESULTADOS.map(r => (
                                    <Button key={r.value} size="sm" variant="secondary" icon={ocupado === `${c.id}:${r.value}` ? Loader2 : r.icon} disabled={!!ocupado}
                                        onClick={() => visitar(c, r.value)}>{r.label}</Button>
                                ))}
                                <a href={comoLlegar(c)} target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 text-caption font-bold text-brand-text px-2 min-h-[var(--tap-min)] active:scale-[0.97]">
                                    <Navigation size={14} /> Cómo llegar
                                </a>
                                {c.telefono && (
                                    <a href={`tel:${c.telefono}`} className="inline-flex items-center gap-1.5 text-caption font-bold text-brand-text px-2 min-h-[var(--tap-min)] active:scale-[0.97]">
                                        <Phone size={14} /> Llamar
                                    </a>
                                )}
                            </div>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
}

function Armar() {
    const showToast = useToastStore(s => s.showToast);
    const [rutas, setRutas] = useState([]);
    const [vendedores, setVendedores] = useState([]);
    const [sel, setSel] = useState(null);           // ruta en edición (objeto con los campos del formulario)
    const [clientes, setClientes] = useState([]);
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState('');

    const cargar = useCallback(async () => {
        try {
            const [r, v] = await Promise.all([fetchRutas(), fetchVendedores()]);
            setRutas(r); setVendedores(v);
        } catch (e) { setError(mensajeDeDistribucion(e)); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    const elegir = async (r) => {
        setSel(r ? { id: r.id, nombre: r.nombre, vendedorId: r.vendedor_id ?? '', dias: r.dias ?? [], activo: r.activo } : { id: null, nombre: '', vendedorId: '', dias: [], activo: true });
        setClientes(r ? await fetchClientesDeRuta(r.id).catch(() => []) : []);
    };
    const mover = (i, d) => setClientes(cs => { const n = [...cs]; const j = i + d; if (j < 0 || j >= n.length) return cs; [n[i], n[j]] = [n[j], n[i]]; return n; });
    const guardar = async () => {
        setOcupado('guardar');
        setError('');
        try {
            const id = await guardarRuta({ id: sel.id, nombre: sel.nombre, vendedorId: sel.vendedorId, dias: sel.dias, activo: sel.activo });
            if (sel.id && clientes.length) await ordenarRuta(sel.id, clientes.map(c => c.id));
            useStaff.getState().appendAuditLog('DISTRIBUCION_RUTA', String(id), { nombre: sel.nombre, dias: sel.dias, vendedor: sel.vendedorId || null });
            showToast('Ruta guardada', sel.nombre, 'success');
            await cargar();
            setSel(s => ({ ...s, id }));
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado('');
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section data-surface="card" className="p-4 flex flex-col gap-2" aria-label="Rutas">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-body font-black text-content">Rutas</h3>
                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => elegir(null)}>Nueva ruta</Button>
                </div>
                <ul className="divide-y divide-divider">
                    {rutas.map(r => (
                        <li key={r.id}>
                            <button type="button" onClick={() => elegir(r)} data-ruta={r.id}
                                className={`w-full text-left py-2 px-2 rounded-xl min-h-[var(--tap-min)] active:scale-[0.99] ${sel?.id === r.id ? 'bg-brand/10' : 'hover:bg-surface-card-hover'}`}>
                                <span className="block text-body-sm font-bold text-content-2">{r.nombre}{!r.activo && ' (inactiva)'}</span>
                                <span className="block text-caption text-content-3">
                                    {r.vendedor?.name ? shortEmployeeName(r.vendedor.name) : 'Sin vendedor'} · {r.dias?.length ? DIAS.filter(d => r.dias.includes(d.n)).map(d => d.c).join(' ') : 'sin días'}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </section>
            {sel && (
                <section data-surface="card" className="p-4 flex flex-col gap-3 lg:col-span-2" aria-label="Editar ruta">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <PortalInput label="Nombre" name="nombre-ruta" value={sel.nombre} onChange={(e) => setSel(s => ({ ...s, nombre: e.target.value }))} />
                        <Campo label="Vendedor">
                            <LiquidSelect value={sel.vendedorId} onChange={(v) => setSel(s => ({ ...s, vendedorId: v ?? '' }))} icon={Route} ariaLabel="Vendedor de la ruta"
                                options={vendedores.map(v => ({ value: v.id, label: shortEmployeeName(v.name) }))} placeholder="Vendedor…" clearLabel="Sin vendedor" />
                        </Campo>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Días de visita">
                        <span className="text-caption text-content-3 mr-1">Se visita:</span>
                        {DIAS.map(d => {
                            const on = sel.dias.includes(d.n);
                            return (
                                <button key={d.n} type="button" aria-pressed={on} data-dia={d.n}
                                    onClick={() => setSel(s => ({ ...s, dias: on ? s.dias.filter(x => x !== d.n) : [...s.dias, d.n].sort() }))}
                                    className={`w-10 h-10 min-h-[var(--tap-min)] rounded-full text-caption font-black border active:scale-[0.95] ${on ? 'bg-brand text-white border-brand' : 'border-divider text-content-2 hover:bg-surface-card-hover'}`}>
                                    {d.c}
                                </button>
                            );
                        })}
                    </div>
                    {sel.id && (
                        <div>
                            <p className="text-caption font-bold text-content-2 mb-1">Orden de visita ({clientes.length} clientes)</p>
                            {clientes.length === 0 ? <p className="text-caption text-content-3">Sin clientes. Se asignan desde la ficha del cliente (campo Ruta).</p> : (
                                <ol className="divide-y divide-divider">
                                    {clientes.map((c, i) => (
                                        <li key={c.id} className="py-1.5 flex items-center gap-2" data-orden-cliente={c.id}>
                                            <span className="w-6 text-caption tabular-nums text-content-3">{i + 1}</span>
                                            <span className="flex-1 min-w-0 truncate text-body-sm text-content-2">{c.nombre}</span>
                                            <Button size="xs" variant="ghost" iconOnly icon={ArrowUp} title={`Subir ${c.nombre}`} disabled={i === 0} onClick={() => mover(i, -1)} />
                                            <Button size="xs" variant="ghost" iconOnly icon={ArrowDown} title={`Bajar ${c.nombre}`} disabled={i === clientes.length - 1} onClick={() => mover(i, 1)} />
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                    )}
                    <div className="flex justify-end">
                        <Button variant="primary" icon={ocupado === 'guardar' ? Loader2 : Save} disabled={!sel.nombre.trim() || !!ocupado} onClick={guardar}>Guardar ruta</Button>
                    </div>
                </section>
            )}
        </div>
    );
}

export default function TabRutas({ puedeConfigurar, vista = 'hoy' }) {
    return <div className="p-3 md:p-5">{vista === 'armar' && puedeConfigurar ? <Armar /> : <Hoy puedeConfigurar={puedeConfigurar} />}</div>;
}
