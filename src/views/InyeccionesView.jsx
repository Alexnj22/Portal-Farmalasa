import React, { useCallback, useMemo, useState } from 'react';
import { BookOpen, Hourglass, Settings2, Syringe, HandCoins } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import TabPorCobrar from './inyecciones/TabPorCobrar';
import TabPendientes from './inyecciones/TabPendientes';
import TabBitacora from './inyecciones/TabBitacora';
import TabAjustes from './inyecciones/TabAjustes';

/*
 * Inyecciones — vista propia (2026-10-02).
 *
 * Era la pestaña «Inyecciones» de Ventas, que adivinaba por hora a qué venta
 * iba cada cobro. Desde que el cobro se asigna a su venta al cobrarse (Mi caja
 * → Aplicación de inyección) hay un REGISTRO —qué se pagó, qué se aplicó,
 * quién y dónde—, y el usuario la pidió aparte: «no es solo venta ni dinero».
 *
 *   · Por cobrar   ventas con inyección y si su aplicación se cobró (supervisión:
 *                  nombra al vendedor, la sala no la ve — decisión 2026-09-23).
 *   · Pendientes   lo pagado y sin aplicar, por cliente.
 *   · Bitácora     cada aplicación: quién cobró, quién aplicó, cuándo y dónde.
 *   · Ajustes      precios y aplicaciones por producto.
 *
 * El alcance es el del módulo `inyecciones`: con «su sala» la sucursal queda
 * fija en la propia, y las funciones de la base lo vuelven a imponer.
 */

// Las salas que venden. Misma lista que Ventas.
const SALAS_QUE_VENDEN = [4, 25, 27, 28, 29, 2];

const TODAS = [
    { key: 'por-cobrar', label: 'Por cobrar', icon: HandCoins },
    { key: 'pendientes', label: 'Pendientes', icon: Hourglass },
    { key: 'bitacora',   label: 'Bitácora',   icon: BookOpen },
    { key: 'ajustes',    label: 'Ajustes',    icon: Settings2 },
];

const PISTAS = {
    'por-cobrar': 'Buscar cliente, factura o inyección...',
    pendientes:   'Buscar cliente, factura o inyección...',
    bitacora:     'Buscar cliente, factura o inyección...',
};

export default function InyeccionesView() {
    const { user, hasPermission, getScope } = useAuth();
    const branches = useStaff((s) => s.branches);
    // Cada permiso escrito literal: el gate de permisos busca la consulta por
    // su clave, y una clave armada en un bucle le resulta invisible.
    const puede = {
        'por-cobrar': hasPermission('inyecciones_tab_por_cobrar'),
        pendientes:   hasPermission('inyecciones_tab_pendientes'),
        bitacora:     hasPermission('inyecciones_tab_bitacora'),
        ajustes:      hasPermission('inyecciones_dosis') || hasPermission('inyecciones_precios'),
    };
    const llave = Object.entries(puede).filter(([, v]) => v).map(([k]) => k).join(',');
    const visibles = useMemo(() => TODAS.filter((t) => llave.split(',').includes(t.key)), [llave]);
    const [pestana, setPestana] = usePestanaEnUrl(visibles, visibles[0]?.key ?? 'pendientes');
    const branchLocked = getScope('inyecciones') !== 'ALL';
    const [filterBranch, setFilterBranchRaw] = useState(branchLocked ? String(user?.branchId || '') : '');
    const setFilterBranch = useCallback((v) => { if (!branchLocked) setFilterBranchRaw(v); }, [branchLocked]);
    const [rawSearch, setRawSearch, debouncedSearch] = useBusqueda();

    const branchOptions = useMemo(
        () => (branches || []).filter((b) => SALAS_QUE_VENDEN.includes(b.id)).map((b) => ({ value: String(b.id), label: b.name })),
        [branches],
    );
    const nombreSala = useCallback((id) => (branches || []).find((b) => b.id === id)?.name || '—', [branches]);

    const filtersContent = (
        <ViewTabBar
            tabs={visibles}
            activeTab={pestana}
            onTabChange={setPestana}
            {...(PISTAS[pestana] ? { searchValue: rawSearch, onSearchChange: setRawSearch, placeholder: PISTAS[pestana] } : {})}
        />
    );

    const comunes = { filterBranch, setFilterBranch, branchOptions, branchLocked, searchTerm: debouncedSearch, nombreSala };

    return (
        <GlassViewLayout icon={Syringe} title="Inyecciones" filtersContent={filtersContent}>
            {pestana === 'por-cobrar' && <TabPorCobrar {...comunes} />}
            {pestana === 'pendientes' && <TabPendientes {...comunes} />}
            {pestana === 'bitacora' && <TabBitacora {...comunes} />}
            {pestana === 'ajustes' && <TabAjustes />}
        </GlassViewLayout>
    );
}
