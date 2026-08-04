import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, Gauge, History, CalendarCheck, Coins } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { fetchMetasConfig } from '../../data/metas';
import TabTablero from './TabTablero';
import TabHistorico from './TabHistorico';
import TabConfirmacion from './TabConfirmacion';
import TabBono from './TabBono';
import MetaModal from './MetaModal';
import { SALAS_VENTA } from './metasUtils';

// Metas por sala — docs/PLAN-METAS-2026-08-03.md. Tablero e Histórico (Fase 1)
// + el flujo de confirmación supervisor→gerente (Fase 2). Este módulo es de
// supervisión: la sala ve SU meta en el widget «Meta del mes» del Inicio
// (`WidgetMetaSala`), no acá. Las bonificaciones llegan en fases siguientes.
export default function MetasView() {
    const { hasPermission, user } = useAuth();
    const canEdit = hasPermission('metas', 'can_edit');
    const canApprove = hasPermission('metas', 'can_approve');
    const branches = useStaffStore((s) => s.branches);
    const [searchParams, setSearchParams] = useSearchParams();

    // Confirmación es la mesa de trabajo del supervisor y el gerente; el resto
    // del módulo es de lectura para cualquiera con el permiso de ver.
    const tabs = useMemo(() => [
        { key: 'tablero',   label: 'Tablero',   icon: Gauge },
        { key: 'bono',      label: 'Bono',      icon: Coins },
        ...(canEdit || canApprove ? [{ key: 'confirmacion', label: 'Confirmación', icon: CalendarCheck }] : []),
        { key: 'historico', label: 'Histórico', icon: History },
    ], [canEdit, canApprove]);

    const rawTab = searchParams.get('tab');
    const activeTab = tabs.some((t) => t.key === rawTab) ? rawTab : 'tablero';
    const setActiveTab = (tab) => setSearchParams((p) => { p.set('tab', tab); return p; });

    const [search, setSearch] = useState('');
    const [modal, setModal] = useState(null);          // { ym, branchId } | null
    const [reloadKey, setReloadKey] = useState(0);
    const [bonificacionesActivas, setBonificacionesActivas] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchMetasConfig()
            .then((cfg) => { if (alive) setBonificacionesActivas(!!cfg?.bonificaciones_activas); })
            .catch(() => { /* sin config legible: se queda el aviso de suspendidas */ });
        return () => { alive = false; };
    }, []);

    const salaNombre = useCallback(
        (id) => (branches || []).find((b) => b.id === Number(id))?.name || `Sala ${id}`,
        [branches],
    );

    // Solo salas de venta: las mismas 6 que devuelven los RPC del módulo.
    const salaOptions = useMemo(() => {
        const idsVenta = new Set(SALAS_VENTA);
        return (branches || [])
            .filter((b) => idsVenta.has(b.id))
            .map((b) => ({ value: String(b.id), label: b.name }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [branches]);

    const abrirModal = useCallback((ym, branchId) => setModal({ ym, branchId }), []);

    const filtersContent = (
        <ViewTabBar
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar sala..."
        />
    );

    const limpiarBusqueda = useCallback(() => setSearch(''), []);

    return (
        // `transparentBody`: las tres pestañas arman su propio material — el
        // Tablero y Confirmación son grillas de `data-surface="card"`, y el
        // Histórico monta un `DataTable`, que trae su card adentro. Sin esto la
        // card del cuerpo envuelve otra card: el doble borde y doble radio que
        // este proyecto llama «una isla dentro de otra isla» (DESIGN.md §22), y
        // las tarjetas quedan pegadas contra su marco porque esa card no lleva
        // padding. Mismo criterio que Inicio, Sucursales y Roles.
        <GlassViewLayout icon={Target} title="Metas" filtersContent={filtersContent} transparentBody>
            {activeTab === 'tablero' && (
                <TabTablero
                    salaNombre={salaNombre}
                    canEdit={canEdit}
                    onAgregarMeta={abrirModal}
                    reloadKey={reloadKey}
                    bonificacionesActivas={bonificacionesActivas}
                    searchTerm={search}
                    onClearSearch={limpiarBusqueda}
                />
            )}
            {activeTab === 'bono' && (
                <TabBono
                    salaNombre={salaNombre}
                    branchOptions={salaOptions}
                    bonificacionesActivas={bonificacionesActivas}
                    reloadKey={reloadKey}
                    defaultBranchId={SALAS_VENTA.includes(Number(user?.branchId ?? user?.branch_id))
                        ? Number(user?.branchId ?? user?.branch_id)
                        : SALAS_VENTA[0]}
                />
            )}
            {activeTab === 'confirmacion' && (canEdit || canApprove) && (
                <TabConfirmacion
                    salaNombre={salaNombre}
                    canEdit={canEdit}
                    canApprove={canApprove}
                    reloadKey={reloadKey}
                    onChanged={() => setReloadKey((k) => k + 1)}
                    searchTerm={search}
                    onClearSearch={limpiarBusqueda}
                />
            )}
            {activeTab === 'historico' && (
                <TabHistorico
                    salaNombre={salaNombre}
                    canEdit={canEdit}
                    onAgregarMeta={abrirModal}
                    reloadKey={reloadKey}
                    searchTerm={search}
                    onClearSearch={limpiarBusqueda}
                />
            )}

            <MetaModal
                isOpen={modal != null}
                onClose={() => setModal(null)}
                onSaved={() => setReloadKey((k) => k + 1)}
                salaOptions={salaOptions}
                initialYm={modal?.ym || null}
                initialBranchId={modal?.branchId || null}
            />
        </GlassViewLayout>
    );
}
