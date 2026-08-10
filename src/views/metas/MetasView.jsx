import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, Gauge, History, CalendarCheck, Coins, Receipt } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { fetchMetasConfig, fetchMetasRows } from '../../data/metas';
import TabTablero from './TabTablero';
import TabHistorico from './TabHistorico';
import TabConfirmacion from './TabConfirmacion';
import TabBono from './TabBono';
import TabGastos from './TabGastos';
import MetaModal from './MetaModal';
import GastoModal from './GastoModal';
import { SALAS_VENTA, ymHoySV, ymSumar } from './metasUtils';

// Metas por sala — docs/planes-cerrados/PLAN-METAS-2026-08-03.md. Tablero e Histórico (Fase 1)
// + el flujo de confirmación supervisor→gerente (Fase 2). Este módulo es de
// supervisión: la sala ve SU meta en el widget «Meta del mes» del Inicio
// (`WidgetMetaSala`), no acá. Las bonificaciones llegan en fases siguientes.
export default function MetasView() {
    const { hasPermission, user, permsLoading } = useAuth();
    const canEdit = hasPermission('metas', 'can_edit');
    const canApprove = hasPermission('metas', 'can_approve');
    // Confirmación ofrece cosas DISTINTAS a quien puede aprobar y a quien no
    // («Aprobar / Devolver» contra «Registrar la autorización del gerente»), así
    // que no puede decidir con los permisos a medio cargar: la pantalla se
    // pintaba con una opción y se corregía sola con la otra.
    const permisosListos = !permsLoading;
    const branches = useStaffStore((s) => s.branches);
    const [searchParams, setSearchParams] = useSearchParams();

    // Confirmación es la mesa de trabajo del supervisor y el gerente; el resto
    // del módulo es de lectura para cualquiera con el permiso de ver.
    const tabs = useMemo(() => [
        { key: 'tablero',   label: 'Tablero',   icon: Gauge },
        { key: 'bono',      label: 'Bono',      icon: Coins },
        ...(canEdit || canApprove ? [{ key: 'confirmacion', label: 'Confirmación', icon: CalendarCheck }] : []),
        // Los gastos por recuperar son una decisión de la empresa, no algo que
        // se consulte: la pestaña solo existe para quien puede cargarlos.
        ...(canEdit ? [{ key: 'gastos', label: 'Gastos', icon: Receipt }] : []),
        { key: 'historico', label: 'Histórico', icon: History },
    ], [canEdit, canApprove]);

    const rawTab = searchParams.get('tab');
    const activeTab = tabs.some((t) => t.key === rawTab) ? rawTab : 'tablero';
    const setActiveTab = (tab) => setSearchParams((p) => { p.set('tab', tab); return p; });

    const [search, setSearch] = useState('');
    const [modal, setModal] = useState(null);          // { ym, branchId } | null
    const [modalGasto, setModalGasto] = useState(false);
    // Estado de las metas de los próximos meses, para que el modal de gasto
    // pueda avisar CUÁLES vuelven a revisión antes de guardar.
    const [metasPorClave, setMetasPorClave] = useState({});
    const [reloadKey, setReloadKey] = useState(0);
    // El interruptor del bono: encendido y HASTA CUÁNDO (null = indefinido).
    // Los dos juntos porque la pestaña Bono los muestra y los cambia como una
    // sola decisión.
    const [bonificacionesActivas, setBonificacionesActivas] = useState(false);
    const [bonificacionesHastaYm, setBonificacionesHastaYm] = useState(null);
    // El día en que el portal propone las metas del mes siguiente. Confirmación
    // lo necesita para no adelantar una sección que todavía no tiene contenido.
    const [diaPropuesta, setDiaPropuesta] = useState(25);

    // `reloadKey` entra en las dependencias: al mover el interruptor desde la
    // pestaña Bono hay que releer, si no el resto de la vista sigue con el
    // estado viejo hasta que alguien recargue la página.
    useEffect(() => {
        let alive = true;
        fetchMetasConfig()
            .then((cfg) => {
                if (!alive) return;
                setBonificacionesActivas(!!cfg?.bonificaciones_activas);
                setBonificacionesHastaYm(cfg?.bonificaciones_hasta_ym ?? null);
                if (cfg?.dia_propuesta) setDiaPropuesta(Number(cfg.dia_propuesta));
            })
            .catch(() => { /* sin config legible: se queda como apagado */ });
        return () => { alive = false; };
    }, [reloadKey]);

    // Solo hace falta para el modal de gasto: saber cuáles de las metas que va a
    // tocar ya estaban firmadas, para decirlo ANTES de guardar.
    useEffect(() => {
        if (!canEdit) return;
        let alive = true;
        const meses = Array.from({ length: 13 }, (_, i) => ymSumar(ymHoySV(), i));
        fetchMetasRows(meses)
            .then((rows) => {
                if (!alive) return;
                const map = {};
                for (const r of rows) map[`${r.branch_id}|${r.year_month}`] = r.estado;
                setMetasPorClave(map);
            })
            .catch(() => { /* sin esto el aviso previo no sale; el servidor igual decide */ });
        return () => { alive = false; };
    }, [canEdit, reloadKey]);

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
                    salaOptions={salaOptions}
                />
            )}
            {activeTab === 'bono' && (
                <TabBono
                    salaNombre={salaNombre}
                    branchOptions={salaOptions}
                    canEdit={canEdit}
                    bonificacionesActivas={bonificacionesActivas}
                    bonificacionesHastaYm={bonificacionesHastaYm}
                    onCambioBono={() => setReloadKey((k) => k + 1)}
                    reloadKey={reloadKey}
                    defaultBranchId={SALAS_VENTA.includes(Number(user?.branchId ?? user?.branch_id))
                        ? Number(user?.branchId ?? user?.branch_id)
                        : SALAS_VENTA[0]}
                />
            )}
            {activeTab === 'confirmacion' && permisosListos && (canEdit || canApprove) && (
                <TabConfirmacion
                    salaNombre={salaNombre}
                    canEdit={canEdit}
                    canApprove={canApprove}
                    reloadKey={reloadKey}
                    onChanged={() => setReloadKey((k) => k + 1)}
                    searchTerm={search}
                    onClearSearch={limpiarBusqueda}
                    diaPropuesta={diaPropuesta}
                />
            )}
            {activeTab === 'gastos' && canEdit && (
                <TabGastos
                    canEdit={canEdit}
                    reloadKey={reloadKey}
                    onChanged={() => setReloadKey((k) => k + 1)}
                    onAgregarGasto={() => setModalGasto(true)}
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

            <GastoModal
                isOpen={modalGasto}
                onClose={() => setModalGasto(false)}
                onSaved={() => setReloadKey((k) => k + 1)}
                salaOptions={salaOptions}
                metasPorClave={metasPorClave}
            />
        </GlassViewLayout>
    );
}
