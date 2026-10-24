import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { ClipboardList, FileCheck2, Store, PackageSearch, Building2, AlertTriangle, Boxes, Tag, PackageX, LayoutDashboard, HandCoins, ShoppingCart, BarChart3, Wallet, Lock, Route, MapPin, Truck, Loader2 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Notice from '../components/common/Notice';
import { useMarca } from '../plataforma/useMarca';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchEmisor } from '@nucleo/data/distribucion';
import { VISTAS_COMPRAS } from './distribucion/compras';
import { VISTAS_REPORTES } from './distribucion/reportes';
import { VISTAS_CARTERA } from './distribucion/cartera';
import { VISTAS_PEDIDOS, VISTAS_PERDIDAS, PERIODOS, CUBETAS_FACTURACION } from './distribucion/comun';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';

// Cada sección llega por `lazy()` (2026-10-24). Se ve UNA a la vez —es una
// dirección por sección desde el 2026-09-28— y las dieciocho viajaban juntas
// en el trozo de la vista: entrar al Inicio de la distribuidora bajaba también
// la facturación, las compras, la caja y los reportes (203 kB gzip). Mismo
// patrón que PedidosView: sin precarga, React se queda con el trozo después
// de la primera visita.
const TabPedidos = lazy(() => import('./distribucion/TabPedidos'));
const TabDocumentos = lazy(() => import('./distribucion/TabDocumentos'));
const TabClientes = lazy(() => import('./distribucion/TabClientes'));
const TabCatalogo = lazy(() => import('./distribucion/TabCatalogo'));
const TabInventario = lazy(() => import('./distribucion/TabInventario'));
const TabEmisor = lazy(() => import('./distribucion/TabEmisor'));
const SolicitudesDescuento = lazy(() => import('./distribucion/SolicitudesDescuento'));
const TabVentasPerdidas = lazy(() => import('./distribucion/TabVentasPerdidas'));
const TabTablero = lazy(() => import('./distribucion/TabTablero'));
const TabCobros = lazy(() => import('./distribucion/TabCobros'));
const TabCompras = lazy(() => import('./distribucion/TabCompras'));
const TabReportes = lazy(() => import('./distribucion/TabReportes'));
const TabLiquidacion = lazy(() => import('./distribucion/TabLiquidacion'));
const TabCierreDia = lazy(() => import('./distribucion/TabCierreDia'));
const TabReposicion = lazy(() => import('./distribucion/TabReposicion'));
const TabConteo = lazy(() => import('./distribucion/TabConteo'));
const TabCamiones = lazy(() => import('./distribucion/TabCamiones'));
const TabRutas = lazy(() => import('./distribucion/TabRutas'));

// El área en blanco se lee como que algo se rompió: un giro del alto de una
// sección ya dibujada, para que nada salte al llegar.
const Cargando = () => (
    <div className="flex-1 min-h-[320px] grid place-items-center">
        <Loader2 size={24} className="animate-spin text-content-3" strokeWidth={2.5} />
    </div>
);
/** Una sección: su propio `Suspense`, así la que llega no oculta a las ya vistas. */
const Seccion = ({ children }) => <Suspense fallback={<Cargando />}>{children}</Suspense>;

// Distribución — la venta en ruta de la S.A.S. a tiendas, supermercados y
// farmacias. Es otra empresa (otro NIT) con su propio emisor de documentos
// electrónicos: nada de acá toca la facturación de las salas.
//
// Desde el 2026-09-28 vive en su propia entrada (`/torogoz`, ver
// `distribucion/rutas.js`): cada sección es una dirección y el menú de la
// distribuidora es la navegación, así que acá ya no hay pestañas. El orden
// sigue siendo el del trabajo del día.
// Caja y liquidación: por vendedor, y el cierre del día de la empresa (0024).
const VISTAS_CAJA = [
    { key: 'vendedor', label: 'Por vendedor', icon: Wallet },
    { key: 'dia', label: 'Cierre del día', icon: Lock },
];

// Inventario: lotes / reposición, en `?inventario=`.
const VISTAS_INVENTARIO = [
    { key: 'lotes', label: 'Lotes', icon: Boxes },
    { key: 'reposicion', label: 'Reposición', icon: PackageSearch },
    { key: 'conteo', label: 'Conteo y bajas', icon: ClipboardList },
    { key: 'camiones', label: 'Camiones', icon: Truck },
];

// Rutas: hoy / armar (sólo quien administra), en `?rutas=`.
const VISTAS_RUTAS = [
    { key: 'hoy', label: 'Hoy', icon: MapPin },
    { key: 'armar', label: 'Armar rutas', icon: Route },
];

const TABS = [
    { key: 'inicio',     label: 'Inicio',     icon: LayoutDashboard },
    { key: 'rutas',      label: 'Rutas',      icon: Route },
    { key: 'pedidos',    label: 'Pedidos',    icon: ClipboardList },
    { key: 'documentos', label: 'Facturación', icon: FileCheck2 },
    { key: 'cobros',     label: 'Cuentas por cobrar', icon: HandCoins },
    { key: 'liquidacion', label: 'Caja y liquidación', icon: Wallet },
    { key: 'clientes',   label: 'Clientes',   icon: Store },
    { key: 'catalogo',   label: 'Catálogo',   icon: PackageSearch },
    { key: 'compras',    label: 'Compras',    icon: ShoppingCart },
    { key: 'inventario', label: 'Inventario', icon: Boxes },
    { key: 'perdidas',   label: 'Ventas perdidas', icon: PackageX },
    { key: 'reportes',   label: 'Reportes',   icon: BarChart3 },
    { key: 'solicitudes', label: 'Solicitudes', icon: Tag },
    { key: 'emisor',     label: 'Empresa',    icon: Building2 },
];

export default function DistribucionView({ seccion = 'inicio' }) {
    // Otra empresa, otros colores (index.css). El layout de Torogoz ya lo
    // pone; acá queda por si la vista se abre sola.
    useMarca('distribucion');
    const actual = TABS.find(t => t.key === seccion) ?? TABS[0];
    const tab = actual.key;
    // Pedidos se divide en pendientes / finalizados / anulados; la pestaña
    // vive en `?vista=` (las demás secciones no tienen pestañas).
    const [vista, setVista] = usePestanaEnUrl(VISTAS_PEDIDOS, 'pendientes', 'vista');
    // Ventas perdidas: pendientes / atendidas / descartadas, en `?estado=`.
    const [estadoPerdida, setEstadoPerdida] = usePestanaEnUrl(VISTAS_PERDIDAS, 'pendiente', 'estado');
    // El tablero: el período en `?periodo=`.
    const [periodo, setPeriodo] = usePestanaEnUrl(PERIODOS, '30d', 'periodo');
    // Facturación: por resolver / todos / sellados / invalidados, en `?cubeta=`.
    const [cubeta, setCubeta] = usePestanaEnUrl(CUBETAS_FACTURACION, 'accion', 'cubeta');
    // Cuentas por cobrar: con saldo / atrasados / sobre el límite, en `?cartera=`.
    const [vistaCartera, setVistaCartera] = usePestanaEnUrl(VISTAS_CARTERA, 'saldo', 'cartera');
    // Compras: recibidas / borradores / anuladas, en `?compras=`.
    const [vistaCompras, setVistaCompras] = usePestanaEnUrl(VISTAS_COMPRAS, 'recibida', 'compras');
    // Caja: por vendedor / cierre del día (éste, sólo quien administra), en `?caja=`.
    // Reportes: utilidad / libro de compras, en `?reporte=`.
    const [vistaReporte, setVistaReporte] = usePestanaEnUrl(VISTAS_REPORTES, 'utilidad', 'reporte');
    const { hasPermission } = useAuth();
    const puedeVender = hasPermission('distribucion', 'can_edit');
    const puedeConfigurar = hasPermission('distribucion_config', 'can_edit');
    const vistasCaja = useMemo(() => VISTAS_CAJA.filter(v => puedeConfigurar || v.key !== 'dia'), [puedeConfigurar]);
    const [vistaCaja, setVistaCaja] = usePestanaEnUrl(vistasCaja, 'vendedor', 'caja');
    const [vistaInventario, setVistaInventario] = usePestanaEnUrl(VISTAS_INVENTARIO, 'lotes', 'inventario');
    const vistasRutas = useMemo(() => VISTAS_RUTAS.filter(v => puedeConfigurar || v.key !== 'armar'), [puedeConfigurar]);
    const [vistaRutas, setVistaRutas] = usePestanaEnUrl(vistasRutas, 'hoy', 'rutas');

    const [emisor, setEmisor] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [buscar, setBuscar] = useState('');

    const cargarEmisor = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            setEmisor(await fetchEmisor());
        } catch (e) {
            console.error('DistribucionView: emisor', e);
            setError('No se pudieron cargar los datos de la empresa. Revisa la conexión e intenta de nuevo.');
        } finally {
            setCargando(false);
        }
    }, []);
    useEffect(() => { cargarEmisor(); }, [cargarEmisor]);

    // Montar al visitar: cada pestaña trae su propia lista.
    const [visitadas, setVisitadas] = useState(() => new Set([tab]));
    if (!visitadas.has(tab)) setVisitadas(new Set(visitadas).add(tab));
    // El buscador es de la pestaña, no de la vista: al cambiar, se limpia.
    useEffect(() => { setBuscar(''); }, [tab]);

    const conBuscador = tab !== 'emisor' && tab !== 'solicitudes' && tab !== 'inicio' && tab !== 'liquidacion' && tab !== 'rutas';
    const conPestanasSinBuscador = (tab === 'liquidacion' && vistasCaja.length > 1) || (tab === 'rutas' && vistasRutas.length > 1);
    const placeholder = useMemo(() => ({
        pedidos: 'Buscar por cliente o número…',
        documentos: 'Cliente, número de control o código de generación…',
        clientes: 'Buscar por nombre, NIT, DUI o NRC…',
        catalogo: 'Buscar producto…',
        inventario: 'Buscar producto o lote…',
        perdidas: 'Buscar producto o cliente…',
        cobros: 'Buscar cliente o ruta…',
        compras: 'Proveedor o número del documento…',
        reportes: 'Buscar…',
    }[tab] ?? 'Buscar…'), [tab]);

    const comunes = { emisor, puedeVender, puedeConfigurar, buscar };

    return (
        <GlassViewLayout
            icon={actual.icon}
            title={actual.label}
            filtersContent={tab === 'inicio' ? (
                <ViewTabBar tabs={PERIODOS} activeTab={periodo} onTabChange={setPeriodo} showSearch={false} />
            ) : conPestanasSinBuscador ? (
                <ViewTabBar tabs={tab === 'rutas' ? vistasRutas : vistasCaja} activeTab={tab === 'rutas' ? vistaRutas : vistaCaja}
                    onTabChange={tab === 'rutas' ? setVistaRutas : setVistaCaja} showSearch={false} />
            ) : conBuscador ? (
                <ViewTabBar tabs={tab === 'pedidos' ? VISTAS_PEDIDOS : tab === 'perdidas' ? VISTAS_PERDIDAS : tab === 'documentos' ? CUBETAS_FACTURACION : tab === 'cobros' ? VISTAS_CARTERA : tab === 'compras' ? VISTAS_COMPRAS : tab === 'reportes' ? VISTAS_REPORTES : tab === 'inventario' ? VISTAS_INVENTARIO : [actual]}
                    activeTab={tab === 'pedidos' ? vista : tab === 'perdidas' ? estadoPerdida : tab === 'documentos' ? cubeta : tab === 'cobros' ? vistaCartera : tab === 'compras' ? vistaCompras : tab === 'reportes' ? vistaReporte : tab === 'inventario' ? vistaInventario : tab}
                    onTabChange={tab === 'pedidos' ? setVista : tab === 'perdidas' ? setEstadoPerdida : tab === 'documentos' ? setCubeta : tab === 'cobros' ? setVistaCartera : tab === 'compras' ? setVistaCompras : tab === 'reportes' ? setVistaReporte : tab === 'inventario' ? setVistaInventario : () => {}}
                    searchValue={buscar} onSearchChange={setBuscar}
                    placeholder={placeholder} showSearch />
            ) : null}
            transparentBody
        >
            {error && (
                <div className="p-5 md:p-6"><Notice variant="danger" icon={AlertTriangle}>{error}</Notice></div>
            )}
            {!cargando && !error && !emisor && tab !== 'emisor' && tab !== 'inicio' && (
                <div className="p-5 md:p-6">
                    <Notice variant="warning" icon={Building2}>
                        Todavía no están cargados los datos de la empresa que factura.
                        {puedeConfigurar ? ' Complétalos en Empresa.' : ' Pídele a quien administra la distribuidora que los complete.'}
                    </Notice>
                </div>
            )}

            {visitadas.has('inicio') && (
                <div className={tab === 'inicio' ? '' : 'hidden'}><Seccion><TabTablero periodo={periodo} /></Seccion></div>
            )}
            {visitadas.has('rutas') && (
                <div className={tab === 'rutas' ? '' : 'hidden'}><Seccion><TabRutas {...comunes} vista={vistaRutas} /></Seccion></div>
            )}
            {visitadas.has('pedidos') && (
                <div className={tab === 'pedidos' ? '' : 'hidden'}><Seccion><TabPedidos {...comunes} vista={vista} onVista={setVista} /></Seccion></div>
            )}
            {visitadas.has('documentos') && (
                <div className={tab === 'documentos' ? '' : 'hidden'}><Seccion><TabDocumentos {...comunes} /></Seccion></div>
            )}
            {visitadas.has('clientes') && (
                <div className={tab === 'clientes' ? '' : 'hidden'}><Seccion><TabClientes {...comunes} /></Seccion></div>
            )}
            {visitadas.has('catalogo') && (
                <div className={tab === 'catalogo' ? '' : 'hidden'}><Seccion><TabCatalogo {...comunes} /></Seccion></div>
            )}
            {visitadas.has('inventario') && (
                <div className={tab === 'inventario' ? '' : 'hidden'}>
                    <Seccion>
                        {vistaInventario === 'reposicion' ? <TabReposicion {...comunes} />
                            : vistaInventario === 'conteo' ? <TabConteo {...comunes} />
                            : vistaInventario === 'camiones' ? <TabCamiones {...comunes} /> : <TabInventario {...comunes} />}
                    </Seccion>
                </div>
            )}
            {visitadas.has('cobros') && (
                <div className={tab === 'cobros' ? '' : 'hidden'}><Seccion><TabCobros {...comunes} vista={vistaCartera} /></Seccion></div>
            )}
            {visitadas.has('compras') && (
                <div className={tab === 'compras' ? '' : 'hidden'}><Seccion><TabCompras {...comunes} vista={vistaCompras} /></Seccion></div>
            )}
            {visitadas.has('liquidacion') && (
                <div className={tab === 'liquidacion' ? '' : 'hidden'}>
                    <Seccion>
                        {vistaCaja === 'dia' && puedeConfigurar ? <TabCierreDia {...comunes} /> : <TabLiquidacion {...comunes} />}
                    </Seccion>
                </div>
            )}
            {visitadas.has('reportes') && (
                <div className={tab === 'reportes' ? '' : 'hidden'}><Seccion><TabReportes {...comunes} vista={vistaReporte} /></Seccion></div>
            )}
            {visitadas.has('perdidas') && (
                <div className={tab === 'perdidas' ? '' : 'hidden'}><Seccion><TabVentasPerdidas {...comunes} vista={estadoPerdida} /></Seccion></div>
            )}
            {visitadas.has('solicitudes') && (
                <div className={tab === 'solicitudes' ? '' : 'hidden'}><Seccion><SolicitudesDescuento /></Seccion></div>
            )}
            {visitadas.has('emisor') && (
                <div className={tab === 'emisor' ? '' : 'hidden'}>
                    <Seccion><TabEmisor {...comunes} onGuardado={cargarEmisor} /></Seccion>
                </div>
            )}
        </GlassViewLayout>
    );
}
