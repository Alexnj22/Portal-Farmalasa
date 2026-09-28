import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ClipboardList, FileCheck2, Store, PackageSearch, Building2, AlertTriangle, Boxes, Tag } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Notice from '../components/common/Notice';
import { useMarca } from '../plataforma/useMarca';
import { useAuth } from '../context/AuthContext';
import { fetchEmisor } from '../data/distribucion';
import TabPedidos from './distribucion/TabPedidos';
import TabDocumentos from './distribucion/TabDocumentos';
import TabClientes from './distribucion/TabClientes';
import TabCatalogo from './distribucion/TabCatalogo';
import TabInventario from './distribucion/TabInventario';
import TabEmisor from './distribucion/TabEmisor';
import SolicitudesDescuento from './distribucion/SolicitudesDescuento';

// Distribución — la venta en ruta de la S.A.S. a tiendas, supermercados y
// farmacias. Es otra empresa (otro NIT) con su propio emisor de documentos
// electrónicos: nada de acá toca la facturación de las salas.
//
// Desde el 2026-09-28 vive en su propia entrada (`/torogoz`, ver
// `distribucion/rutas.js`): cada sección es una dirección y el menú de la
// distribuidora es la navegación, así que acá ya no hay pestañas. El orden
// sigue siendo el del trabajo del día.
const TABS = [
    { key: 'pedidos',    label: 'Pedidos',    icon: ClipboardList },
    { key: 'documentos', label: 'Documentos', icon: FileCheck2 },
    { key: 'clientes',   label: 'Clientes',   icon: Store },
    { key: 'catalogo',   label: 'Catálogo',   icon: PackageSearch },
    { key: 'inventario', label: 'Inventario', icon: Boxes },
    { key: 'solicitudes', label: 'Solicitudes', icon: Tag },
    { key: 'emisor',     label: 'Empresa',    icon: Building2 },
];

export default function DistribucionView({ seccion = 'pedidos' }) {
    // Otra empresa, otros colores (index.css). El layout de Torogoz ya lo
    // pone; acá queda por si la vista se abre sola.
    useMarca('distribucion');
    const actual = TABS.find(t => t.key === seccion) ?? TABS[0];
    const tab = actual.key;
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

    const conBuscador = tab !== 'emisor' && tab !== 'solicitudes';
    const placeholder = useMemo(() => ({
        pedidos: 'Buscar por cliente o número…',
        documentos: 'Buscar por cliente o número de control…',
        clientes: 'Buscar por nombre, NIT, DUI o NRC…',
        catalogo: 'Buscar producto…',
        inventario: 'Buscar producto o lote…',
    }[tab] ?? 'Buscar…'), [tab]);

    const comunes = { emisor, puedeVender, puedeConfigurar, buscar };

    return (
        <GlassViewLayout
            icon={actual.icon}
            title={actual.label}
            filtersContent={conBuscador ? (
                <ViewTabBar tabs={[actual]} activeTab={tab} onTabChange={() => {}}
                    searchValue={buscar} onSearchChange={setBuscar}
                    placeholder={placeholder} showSearch />
            ) : null}
            transparentBody
        >
            {error && (
                <div className="p-5 md:p-6"><Notice variant="danger" icon={AlertTriangle}>{error}</Notice></div>
            )}
            {!cargando && !error && !emisor && tab !== 'emisor' && (
                <div className="p-5 md:p-6">
                    <Notice variant="warning" icon={Building2}>
                        Todavía no están cargados los datos de la empresa que factura.
                        {puedeConfigurar ? ' Complétalos en Empresa.' : ' Pídele a quien administra la distribuidora que los complete.'}
                    </Notice>
                </div>
            )}

            {visitadas.has('pedidos') && (
                <div className={tab === 'pedidos' ? '' : 'hidden'}><TabPedidos {...comunes} /></div>
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
