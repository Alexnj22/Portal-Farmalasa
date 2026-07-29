import React, { useEffect, useState, useMemo } from 'react';
import Badge from '../components/common/Badge';
import ViewTabBar from '../components/common/ViewTabBar';
import TabBarAction from '../components/common/TabBarAction';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, ChevronRight, AlertTriangle, CheckCircle2, Clock, FileCheck2, Search, X } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import NuevoConteoModal from '../components/inventario/NuevoConteoModal';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { smartFilter } from '../utils/searchUtils';

// 'APROBADO' no está porque nunca existió: aprobar_conteo_inventario escribe
// 'CERRADO'. Las claves bg/text/border tampoco: solo se usaba `variante`, que es
// lo que consume Badge.
const ESTADO_CFG = {
    BORRADOR:    { icon: Clock,        label: 'Borrador',    variante: 'neutral' },
    EN_PROGRESO: { icon: Clock,        label: 'En Progreso', variante: 'warning' },
    FINALIZADO:  { icon: FileCheck2,   label: 'Finalizado',  variante: 'chart-1' },
    CERRADO:     { icon: CheckCircle2, label: 'Cerrado',     variante: 'success' },
};

const SCOPE_LABEL = { TOTAL: 'Total', LABORATORIO: 'Por laboratorio', BAJO_RECETA: 'Bajo Receta', MANUAL: 'Manual' };

const COLS = [
    { key: 'fecha', label: 'Fecha', align: 'left' },
    { key: 'sucursal', label: 'Sucursal', align: 'left' },
    { key: 'alcance', label: 'Alcance', align: 'left', hideBelow: 'md' },
    { key: 'items', label: 'Ítems', align: 'center', hideBelow: 'md' },
    { key: 'diferencias', label: 'Diferencias', align: 'center' },
    { key: 'valor', label: 'Valor Neto', align: 'right', hideBelow: 'lg' },
    { key: 'estado', label: 'Estado', align: 'center' },
    { key: 'acciones', label: '', align: 'right' },
];

const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtMoney = (n) => n == null ? '—' : `$${Number(n).toFixed(2)}`;

export default function ConteoInventarioView() {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('conteo_inventario', 'can_edit');
    const conteos = useStaffStore((s) => s.conteosInventario);
    const loading = useStaffStore((s) => s.conteosInventarioLoading);
    const fetchConteosInventario = useStaffStore((s) => s.fetchConteosInventario);

    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);

    useEffect(() => { fetchConteosInventario(); }, [fetchConteosInventario]);

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    const { results: filtered, isFuzzy: isSearchFuzzy } = useMemo(() => {
        if (!search.trim()) return { results: conteos, isFuzzy: false };
        return smartFilter(search, conteos, (c) => [c.branches?.name]);
    }, [conteos, search]);

    // D3.9 (2026-07-27): barra reescrita a mano → canónico.
    const filtersContent = (
        <ViewTabBar
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar por sucursal..."
            trailingActions={canEdit && (
                <TabBarAction icon={Plus} variant="primary" onClick={() => setShowModal(true)}>
                    Nuevo Conteo
                </TabBarAction>
            )}
        />
    );

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Conteo de Inventario" filtersContent={filtersContent}>
            {isSearchFuzzy && search && (
                <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-xl bg-warning/10 border border-warning/30 text-label text-warning-text font-semibold">
                    <Search size={12} strokeWidth={2.5} className="shrink-0" />
                    Resultados similares para &ldquo;{search}&rdquo; — no se encontraron coincidencias exactas
                </div>
            )}
            <DataTable columns={COLS} loading={loading} empty={{ icon: ClipboardCheck, message: 'Sin conteos de inventario registrados' }}>
                {filtered.map((c, i) => {
                    const es = ESTADO_CFG[c.status] || ESTADO_CFG.BORRADOR;
                    const valorNeto = (c.valor_sobrante || 0) - (c.valor_faltante || 0);
                    return (
                        <DataRow key={c.id} index={i} onClick={() => navigate(`/conteo-inventario/${c.id}`)}>
                            <DataCell><span className="text-body-sm font-semibold text-content-2">{fmtDate(c.created_at)}</span></DataCell>
                            <DataCell><span className="text-body-sm font-bold text-content">{c.branches?.name || '—'}</span></DataCell>
                            <DataCell hideBelow="md"><span className="text-label text-content-3">{SCOPE_LABEL[c.scope_type] || c.scope_type}</span></DataCell>
                            <DataCell align="center" hideBelow="md">
                                <div className="flex flex-col items-center gap-0.5">
                                    <span className="text-label tabular-nums text-content-2">{c.total_contados ?? '—'}/{c.total_items ?? '—'}</span>
                                    {/* Un conteo cerrado con renglones sin contar y sin
                                        valuar NO es un cuadre: tiene que verse desde la lista,
                                        no solo al abrirlo. */}
                                    {c.total_pendientes > 0 && !c.pendientes_como_cero && (
                                        <Badge variant="danger" size="sm" uppercase={false}>Parcial</Badge>
                                    )}
                                </div>
                            </DataCell>
                            <DataCell align="center">
                                {c.total_diferencias > 0 ? (
                                    <Badge variant="warning" icon={AlertTriangle} uppercase={false}>{c.total_diferencias}</Badge>
                                ) : c.total_diferencias === 0 ? (
                                    <span className="text-caption font-bold text-success">Sin diferencias</span>
                                ) : <span className="text-content-3">—</span>}
                            </DataCell>
                            <DataCell align="right" hideBelow="lg">
                                <span className={`text-label font-bold tabular-nums ${valorNeto < 0 ? 'text-danger' : valorNeto > 0 ? 'text-chart-1-text' : 'text-content-3'}`}>{fmtMoney(valorNeto)}</span>
                            </DataCell>
                            <DataCell align="center">
                                <Badge variant={es.variante} size="sm" icon={es.icon}>{es.label}</Badge>
                            </DataCell>
                            <DataCell align="right">
                                <ChevronRight size={16} className="text-content-3" />
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            <NuevoConteoModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onCreated={(id) => navigate(`/conteo-inventario/${id}`)}
            />
        </GlassViewLayout>
    );
}
