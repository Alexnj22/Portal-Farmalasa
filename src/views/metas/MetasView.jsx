import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, Gauge, History, CalendarCheck } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { fetchMetasConfig } from '../../data/metas';
import TabTablero from './TabTablero';
import TabHistorico from './TabHistorico';
import TabConfirmacion from './TabConfirmacion';
import MetaModal from './MetaModal';

// Metas por sala — docs/PLAN-METAS-2026-08-03.md. Tablero e Histórico (Fase 1)
// + el flujo de confirmación supervisor→gerente (Fase 2). La vista de sala y
// las bonificaciones llegan en fases siguientes.
export default function MetasView() {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('metas', 'can_edit');
    const canApprove = hasPermission('metas', 'can_approve');
    const branches = useStaffStore((s) => s.branches);
    const [searchParams, setSearchParams] = useSearchParams();

    // Confirmación es la mesa de trabajo del supervisor y el gerente; el resto
    // del módulo es de lectura para cualquiera con el permiso de ver.
    const tabs = useMemo(() => [
        { key: 'tablero',   label: 'Tablero',   icon: Gauge },
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
        const idsVenta = new Set([2, 4, 25, 27, 28, 29]);
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

    return (
        <GlassViewLayout icon={Target} title="Metas" filtersContent={filtersContent}>
            {activeTab === 'tablero' && (
                <TabTablero
                    salaNombre={salaNombre}
                    canEdit={canEdit}
                    onAgregarMeta={abrirModal}
                    reloadKey={reloadKey}
                    bonificacionesActivas={bonificacionesActivas}
                    searchTerm={search}
                />
            )}
            {activeTab === 'confirmacion' && (canEdit || canApprove) && (
                <TabConfirmacion
                    salaNombre={salaNombre}
                    canEdit={canEdit}
                    canApprove={canApprove}
                    reloadKey={reloadKey}
                    onChanged={() => setReloadKey((k) => k + 1)}
                />
            )}
            {activeTab === 'historico' && (
                <TabHistorico
                    salaNombre={salaNombre}
                    canEdit={canEdit}
                    onAgregarMeta={abrirModal}
                    reloadKey={reloadKey}
                    searchTerm={search}
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
