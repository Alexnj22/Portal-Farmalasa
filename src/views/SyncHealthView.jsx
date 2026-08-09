import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Badge from '../components/common/Badge';
import { RadioTower, CheckCircle2, AlertCircle, Clock, Globe2 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import TablePagination from '../components/common/TablePagination';
import { useStaffStore as useStaff } from '../store/staffStore';
import { fetchSyncHealthRecent, SYNC_HEALTH_DOMAINS } from '../data/syncHealth';
import { ERP_NAMES } from '../constants/erp';

const DOMAIN_LABELS = {
    products: 'Productos',
    minmax: 'MinMax',
    purchases: 'Compras',
    backup: 'Backup',
};

const TABS = [
    { key: 'todos', label: 'Todos' },
    ...SYNC_HEALTH_DOMAINS.map(d => ({ key: d, label: DOMAIN_LABELS[d] })),
];

const POLL_MS = 30_000;
const EMPTY_ARRAY = [];

function scopeLabel(row, branchMap) {
    if (row.erp_sucursal_id != null) return ERP_NAMES[row.erp_sucursal_id] || `Sucursal ${row.erp_sucursal_id}`;
    if (row.branch_id != null) return branchMap[row.branch_id] || `Sucursal ${row.branch_id}`;
    return 'Global';
}

const SyncHealthView = () => {
    const branches = useStaff(state => state.branches) || EMPTY_ARRAY;
    const branchMap = useMemo(() => {
        const m = {};
        for (const b of branches) m[b.id] = b.name;
        return m;
    }, [branches]);

    const [activeTab, setActiveTab] = useState('todos');
    const [rows, setRows] = useState(EMPTY_ARRAY);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const { data, error } = await fetchSyncHealthRecent();
        if (error) console.error('SyncHealthView: fetch v_sync_health failed:', error.message);
        setRows(data || EMPTY_ARRAY);
        setLoading(false);
    }, []);

    useEffect(() => {
        load(); // eslint-disable-line react-hooks/set-state-in-effect -- fetch inicial + polling (mismo patrón que AuditView.jsx)
        const interval = setInterval(load, POLL_MS);
        return () => clearInterval(interval);
    }, [load]);

    const filteredRows = useMemo(() => {
        if (activeTab === 'todos') return rows;
        return rows.filter(r => r.domain === activeTab);
    }, [rows, activeTab]);

    // ── Paginar: esta vista pintaba TODAS las corridas de una ────────────────
    //
    // Medido el 2026-08-09 en 390px: **25,601px de alto y 4,758 elementos**, o
    // sea 30 pantallas de scroll para leer un monitor. `filteredRows.map(...)`
    // no tenía tope de ninguna clase, y el historial de syncs sólo crece —siete
    // sucursales por dominio, cada minuto— así que el número tampoco tiene
    // techo por sí solo.
    //
    // No es sólo scroll: es el perfil exacto del cierre de pestaña del iPhone
    // (memoria `el techo de memoria es de la PESTAÑA, no de la vista`), donde
    // una lista sin tope se llevó la sesión entera.
    //
    // `TablePagination` es el canónico y ya lo usan Auditoría, Ventas, Compras,
    // Inventario y Productos. El default de 25 es el de Auditoría, que es la
    // otra vista de historial del portal.
    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(25);
    const totalPaginas = Math.max(1, Math.ceil(filteredRows.length / porPagina));
    const filasPagina = useMemo(
        () => filteredRows.slice((pagina - 1) * porPagina, pagina * porPagina),
        [filteredRows, pagina, porPagina],
    );

    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            // Volver a la página 1 al cambiar de pestaña va acá y no en un
            // efecto: es la consecuencia de un acto del usuario, no un estado
            // derivado. Sin esto, quedar en la página 7 y saltar a una pestaña
            // de dos páginas dejaba la tabla vacía sin decir por qué.
            onTabChange={(t) => { setActiveTab(t); setPagina(1); }}
            showSearch={false}
        />
    );

    return (
        <GlassViewLayout icon={RadioTower} title="Salud de Syncs" filtersContent={filtersContent}>
            <div className="p-4 md:p-6">
                <DataTable
                    columns={[
                        { key: 'checked_at', label: 'Fecha / Hora' },
                        { key: 'domain', label: 'Dominio' },
                        { key: 'scope', label: 'Alcance' },
                        { key: 'status', label: 'Estado' },
                        { key: 'error_msg', label: 'Detalle', hideBelow: 'md' },
                    ]}
                    loading={loading}
                    empty={{
                        icon: RadioTower,
                        message: 'Sin corridas',
                        subtext: 'Los syncs de este dominio no han corrido desde que se activó este monitoreo.',
                    }}
                >
                    {filasPagina.map((row, i) => {
                        const dt = new Date(row.checked_at);
                        return (
                            <DataRow key={`${row.domain}-${row.checked_at}-${i}`} index={i}>
                                <DataCell>
                                    <div className="text-label font-bold text-content-2">{dt.toLocaleDateString('es-SV')}</div>
                                    <div className="text-caption text-content-3 flex items-center gap-1 mt-0.5">
                                        <Clock size={9} /> {dt.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </DataCell>
                                <DataCell>
                                    <span className="text-label font-black uppercase tracking-wide text-content-2">
                                        {DOMAIN_LABELS[row.domain] || row.domain}
                                    </span>
                                    {row.source && (
                                        <div className="text-micro text-content-3 mt-0.5">{row.source}</div>
                                    )}
                                </DataCell>
                                <DataCell>
                                    <span className="inline-flex items-center gap-1 text-caption font-semibold text-content-2">
                                        <Globe2 size={10} className="text-content-3" />
                                        {scopeLabel(row, branchMap)}
                                    </span>
                                </DataCell>
                                <DataCell>
                                    {row.success ? (
                                        <Badge variant="success" size="sm" icon={CheckCircle2}>OK</Badge>
                                    ) : (
                                        <Badge variant="danger" size="sm" icon={AlertCircle}>Falló</Badge>
                                    )}
                                </DataCell>
                                <DataCell hideBelow="md" className="text-caption text-content-3 max-w-[320px] truncate" title={row.error_msg || ''}>
                                    {row.error_msg || '—'}
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>

                {filteredRows.length > porPagina && (
                    <div className="mt-3">
                        <TablePagination
                            page={pagina}
                            totalPages={totalPaginas}
                            onPageChange={setPagina}
                            pageSize={porPagina}
                            onPageSizeChange={v => { setPorPagina(Number(v)); setPagina(1); }}
                            total={filteredRows.length}
                            unit="corridas"
                        />
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
};

export default SyncHealthView;
