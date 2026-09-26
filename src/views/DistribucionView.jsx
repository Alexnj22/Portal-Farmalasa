import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Truck, ClipboardList, FileCheck2, Store, PackageSearch, Building2, AlertTriangle } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Notice from '../components/common/Notice';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useAuth } from '../context/AuthContext';
import { fetchEmisor } from '../data/distribucion';
import TabPedidos from './distribucion/TabPedidos';
import TabDocumentos from './distribucion/TabDocumentos';
import TabClientes from './distribucion/TabClientes';
import TabCatalogo from './distribucion/TabCatalogo';
import TabEmisor from './distribucion/TabEmisor';

// Distribución — la venta en ruta de la S.A.S. a tiendas, supermercados y
// farmacias. Es otra empresa (otro NIT) con su propio emisor de documentos
// electrónicos: nada de acá toca la facturación de las salas.
//
// Las cinco pestañas siguen el orden del trabajo del día: se toma el pedido,
// se factura, y lo demás (clientes, precios, datos de la empresa) se mira
// cuando hace falta.
const TABS = [
    { key: 'pedidos',    label: 'Pedidos',    icon: ClipboardList },
    { key: 'documentos', label: 'Documentos', icon: FileCheck2 },
    { key: 'clientes',   label: 'Clientes',   icon: Store },
    { key: 'catalogo',   label: 'Catálogo',   icon: PackageSearch },
    { key: 'emisor',     label: 'Empresa',    icon: Building2 },
];

export default function DistribucionView() {
    const [tab, setTab] = usePestanaEnUrl(TABS, 'pedidos');
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

    const conBuscador = tab !== 'emisor';
    const placeholder = useMemo(() => ({
        pedidos: 'Buscar por cliente o número…',
        documentos: 'Buscar por cliente o número de control…',
        clientes: 'Buscar por nombre, NIT, DUI o NRC…',
        catalogo: 'Buscar producto…',
    }[tab] ?? 'Buscar…'), [tab]);

    const comunes = { emisor, puedeVender, puedeConfigurar, buscar };

    return (
        <GlassViewLayout
            icon={Truck}
            title="Distribución"
            filtersContent={(
                <ViewTabBar tabs={TABS} activeTab={tab} onTabChange={setTab}
                    searchValue={buscar} onSearchChange={setBuscar}
                    placeholder={placeholder} showSearch={conBuscador} />
            )}
            transparentBody
        >
            {error && (
                <div className="p-5 md:p-6"><Notice variant="danger" icon={AlertTriangle}>{error}</Notice></div>
            )}
            {!cargando && !error && !emisor && tab !== 'emisor' && (
                <div className="p-5 md:p-6">
                    <Notice variant="warning" icon={Building2}>
                        Todavía no están cargados los datos de la empresa que factura.
                        {puedeConfigurar ? ' Complétalos en la pestaña Empresa.' : ' Pídele a quien administra Distribución que los complete.'}
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
            {visitadas.has('emisor') && (
                <div className={tab === 'emisor' ? '' : 'hidden'}>
                    <TabEmisor {...comunes} onGuardado={cargarEmisor} />
                </div>
            )}
        </GlassViewLayout>
    );
}
