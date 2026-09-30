import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ClipboardList, FileCheck2, Store, PackageSearch, Building2, AlertTriangle, Boxes, Tag, PackageX, LayoutDashboard, HandCoins, ShoppingCart, BarChart3 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Notice from '../components/common/Notice';
import { useMarca } from '../plataforma/useMarca';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchEmisor } from '@nucleo/data/distribucion';
import TabPedidos from './distribucion/TabPedidos';
import TabDocumentos from './distribucion/TabDocumentos';
import TabClientes from './distribucion/TabClientes';
import TabCatalogo from './distribucion/TabCatalogo';
import TabInventario from './distribucion/TabInventario';
import TabEmisor from './distribucion/TabEmisor';
import SolicitudesDescuento from './distribucion/SolicitudesDescuento';
import TabVentasPerdidas from './distribucion/TabVentasPerdidas';
import TabTablero from './distribucion/TabTablero';
import TabCobros from './distribucion/TabCobros';
import TabCompras from './distribucion/TabCompras';
import { VISTAS_COMPRAS } from './distribucion/compras';
import TabReportes from './distribucion/TabReportes';
import { VISTAS_REPORTES } from './distribucion/reportes';
import { VISTAS_CARTERA } from './distribucion/cartera';
import { VISTAS_PEDIDOS, VISTAS_PERDIDAS, PERIODOS, CUBETAS_FACTURACION } from './distribucion/comun';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';

// Distribución — la venta en ruta de la S.A.S. a tiendas, supermercados y
// farmacias. Es otra empresa (otro NIT) con su propio emisor de documentos
// electrónicos: nada de acá toca la facturación de las salas.
//
// Desde el 2026-09-28 vive en su propia entrada (`/torogoz`, ver
// `distribucion/rutas.js`): cada sección es una dirección y el menú de la
// distribuidora es la navegación, así que acá ya no hay pestañas. El orden
// sigue siendo el del trabajo del día.
const TABS = [
    { key: 'inicio',     label: 'Inicio',     icon: LayoutDashboard },
    { key: 'pedidos',    label: 'Pedidos',    icon: ClipboardList },
    { key: 'documentos', label: 'Facturación', icon: FileCheck2 },
    { key: 'cobros',     label: 'Cuentas por cobrar', icon: HandCoins },
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
    // Reportes: utilidad / libro de compras, en `?reporte=`.
    const [vistaReporte, setVistaReporte] = usePestanaEnUrl(VISTAS_REPORTES, 'utilidad', 'reporte');
    const { hasPermission } = useAuth();
    const puedeVender = hasPermission('distribucion', 'can_edit');
    const puedeConfigurar = hasPermission('distribucion_config', 'can_edit');

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

    const conBuscador = tab !== 'emisor' && tab !== 'solicitudes' && tab !== 'inicio';
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
            ) : conBuscador ? (
                <ViewTabBar tabs={tab === 'pedidos' ? VISTAS_PEDIDOS : tab === 'perdidas' ? VISTAS_PERDIDAS : tab === 'documentos' ? CUBETAS_FACTURACION : tab === 'cobros' ? VISTAS_CARTERA : tab === 'compras' ? VISTAS_COMPRAS : tab === 'reportes' ? VISTAS_REPORTES : [actual]}
                    activeTab={tab === 'pedidos' ? vista : tab === 'perdidas' ? estadoPerdida : tab === 'documentos' ? cubeta : tab === 'cobros' ? vistaCartera : tab === 'compras' ? vistaCompras : tab === 'reportes' ? vistaReporte : tab}
                    onTabChange={tab === 'pedidos' ? setVista : tab === 'perdidas' ? setEstadoPerdida : tab === 'documentos' ? setCubeta : tab === 'cobros' ? setVistaCartera : tab === 'compras' ? setVistaCompras : tab === 'reportes' ? setVistaReporte : () => {}}
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
                <div className={tab === 'inicio' ? '' : 'hidden'}><TabTablero periodo={periodo} /></div>
            )}
            {visitadas.has('pedidos') && (
                <div className={tab === 'pedidos' ? '' : 'hidden'}><TabPedidos {...comunes} vista={vista} onVista={setVista} /></div>
            )}
            {visitadas.has('documentos') && (
                <div className={tab === 'documentos' ? '' : 'hidden'}><TabDocumentos {...comunes} /></div>
            )}
            {visitadas.has('clientes') && (
                <div className={tab === 'clientes' ? '' : 'hidden'}><TabClientes {...comunes} /></div>
            )}
            {visitadas.has('catalogo') && (
                <div className={tab === 'catalogo' ? '' : 'hidden'}><TabCatalogo {...comunes} /></div>
            )}
            {visitadas.has('inventario') && (
                <div className={tab === 'inventario' ? '' : 'hidden'}><TabInventario {...comunes} /></div>
            )}
            {visitadas.has('cobros') && (
                <div className={tab === 'cobros' ? '' : 'hidden'}><TabCobros {...comunes} vista={vistaCartera} /></div>
            )}
            {visitadas.has('compras') && (
                <div className={tab === 'compras' ? '' : 'hidden'}><TabCompras {...comunes} vista={vistaCompras} /></div>
            )}
            {visitadas.has('reportes') && (
                <div className={tab === 'reportes' ? '' : 'hidden'}><TabReportes {...comunes} vista={vistaReporte} /></div>
            )}
            {visitadas.has('perdidas') && (
                <div className={tab === 'perdidas' ? '' : 'hidden'}><TabVentasPerdidas {...comunes} vista={estadoPerdida} /></div>
            )}
            {visitadas.has('solicitudes') && (
                <div className={tab === 'solicitudes' ? '' : 'hidden'}><SolicitudesDescuento /></div>
            )}
            {visitadas.has('emisor') && (
                <div className={tab === 'emisor' ? '' : 'hidden'}>
                    <TabEmisor {...comunes} onGuardado={cargarEmisor} />
                </div>
            )}
        </GlassViewLayout>
    );
}
