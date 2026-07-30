import React, { useEffect, useState, useMemo } from 'react';
import Notice from '../components/common/Notice';
import Badge from '../components/common/Badge';
import ViewTabBar from '../components/common/ViewTabBar';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus, ChevronRight, AlertTriangle, CheckCircle2, Clock, FileCheck2, Search, FileSpreadsheet, Building2 } from 'lucide-react';
import LiquidSelect from '../components/common/LiquidSelect';
import GlassViewLayout from '../components/GlassViewLayout';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import NuevoConteoModal from '../components/inventario/NuevoConteoModal';
import { useStaffStore } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { smartFilter } from '../utils/searchUtils';
import FilterBar from '../components/common/FilterBar';
import StatCard from '../components/common/StatCard';
import CarrilCards from '../components/common/CarrilCards';
import ListRow from '../components/common/ListRow';
import { SkeletonText } from '../components/common/StateViews';
import SegmentedControl from '../components/common/SegmentedControl';
import { formatMoney, formatQty } from '../utils/formatNumber';

// 'APROBADO' no está porque nunca existió: aprobar_conteo_inventario escribe
// 'CERRADO'. Las claves bg/text/border tampoco: solo se usaba `variante`, que es
// lo que consume Badge.
const ESTADO_CFG = {
    BORRADOR:    { icon: Clock,        label: 'Borrador',    variante: 'neutral' },
    EN_PROGRESO: { icon: Clock,        label: 'En Progreso', variante: 'warning' },
    FINALIZADO:  { icon: FileCheck2,   label: 'Finalizado',  variante: 'chart-1' },
    CERRADO:     { icon: CheckCircle2, label: 'Cerrado',     variante: 'success' },
};

const SCOPE_LABEL = { TOTAL: 'Total', LABORATORIO: 'Por laboratorio', BAJO_RECETA: 'Bajo Receta', MANUAL: 'Manual', CICLICO: 'Cíclico del mes' };

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

export default function ConteoInventarioView() {
    const navigate = useNavigate();
    const { user, hasPermission, getScope } = useAuth();
    const canEdit = hasPermission('conteo_inventario', 'can_edit');
    const conteos = useStaffStore((s) => s.conteosInventario);
    const loading = useStaffStore((s) => s.conteosInventarioLoading);
    const fetchConteosInventario = useStaffStore((s) => s.fetchConteosInventario);
    const branches = useStaffStore((s) => s.branches);

    // El scope del permiso ya lo aplica RLS: con BRANCH, la consulta solo trae
    // los conteos de su sucursal. Acá el selector es para el que ve TODAS y
    // necesita mirar una sola — con BRANCH queda fijado y deshabilitado, para
    // que se vea de qué sucursal son los datos y no parezca "todo el portal".
    const isBranchScoped = getScope('conteo_inventario') === 'BRANCH';

    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [branchFilter, setBranchFilter] = useState(isBranchScoped ? String(user?.branchId || '') : '');
    // Qué necesita atención. Es un filtro y no solo un rótulo: la pregunta real de
    // esta pantalla no es "cuántos conteos hay" sino "cuál me está esperando".
    const [foco, setFoco] = useState('TODOS');

    useEffect(() => { fetchConteosInventario(); }, [fetchConteosInventario]);

    const branchOpts = useMemo(() => {
        const conIdsUsados = new Set((conteos || []).map((c) => String(c.branch_id)));
        return (branches || [])
            .filter((b) => conIdsUsados.has(String(b.id)) || !isBranchScoped)
            .map((b) => ({ value: String(b.id), label: b.name }));
    }, [branches, conteos, isBranchScoped]);

    // Un conteo CERRADO con diferencias y sin ajuste registrado es trabajo a
    // medias: la diferencia está medida y firmada, pero el stock del ERP sigue
    // mintiendo. Antes solo se veía fila por fila.
    const faltaAjuste = (c) => c.status === 'CERRADO' && c.total_diferencias > 0 && !c.ajuste_erp_aplicado;

    const resumen = useMemo(() => {
        const base = branchFilter
            ? (conteos || []).filter((c) => String(c.branch_id) === branchFilter)
            : (conteos || []);
        return {
            total: base.length,
            abiertos: base.filter((c) => ['BORRADOR', 'EN_PROGRESO'].includes(c.status)).length,
            porAprobar: base.filter((c) => c.status === 'FINALIZADO').length,
            sinAjuste: base.filter(faltaAjuste).length,
        };
    }, [conteos, branchFilter]);

    const FOCOS = {
        ABIERTOS: (c) => ['BORRADOR', 'EN_PROGRESO'].includes(c.status),
        POR_APROBAR: (c) => c.status === 'FINALIZADO',
        SIN_AJUSTE: faltaAjuste,
    };

    const { results: filtered, isFuzzy: isSearchFuzzy } = useMemo(() => {
        let base = branchFilter
            ? (conteos || []).filter((c) => String(c.branch_id) === branchFilter)
            : (conteos || []);
        if (FOCOS[foco]) base = base.filter(FOCOS[foco]);
        if (!search.trim()) return { results: base, isFuzzy: false };
        return smartFilter(search, base, (c) => [c.branches?.name]);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- FOCOS es un literal estable por render y no cambia el resultado
    }, [conteos, search, branchFilter, foco]);

    // D3.9 (2026-07-27): barra reescrita a mano → canónico.
    const filtersContent = (
        <ViewTabBar
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar por sucursal..."
            // Ni el filtro de sucursal ni la acción van acá: §17 es explícito en
            // que los dos viven en el CUERPO de la vista, y el header es
            // navegación y buscador.
        />
    );

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Conteo de Inventario" filtersContent={filtersContent}>
            {/* Resumen arriba, y cada tarjeta es un FILTRO. La pregunta de esta
                pantalla no es "cuántos conteos hay" sino "cuál me está esperando":
                un finalizado sin aprobar bloquea a alguien, y un cerrado sin ajuste
                registrado es trabajo a medias que antes solo se veía fila por fila. */}
            <CarrilCards className="mb-4" ariaLabel="Resumen de conteos">
                {/* Ésta NO es un filtro: es el total, y por eso no lleva `active` ni
                    `onClick`. Con `active` StatCard dibuja una × de "quitar este
                    filtro", y quitar "todos" no significa nada. */}
                <StatCard
                    icon={ClipboardCheck} label="Conteos" value={formatQty(resumen.total)}
                    sub={branchFilter ? 'en esta sucursal' : 'en total'}
                />
                <StatCard
                    icon={Clock} label="Abiertos" value={formatQty(resumen.abiertos)}
                    iconBg="bg-warning/10" iconCls="text-warning-text"
                    valueCls={resumen.abiertos ? 'text-warning-text' : 'text-content'}
                    sub="contándose ahora"
                    active={foco === 'ABIERTOS'} onClick={() => setFoco((f) => (f === 'ABIERTOS' ? 'TODOS' : 'ABIERTOS'))}
                />
                <StatCard
                    icon={FileCheck2} label="Por aprobar" value={formatQty(resumen.porAprobar)}
                    iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                    valueCls={resumen.porAprobar ? 'text-chart-1-text' : 'text-content'}
                    sub="esperan otra firma"
                    active={foco === 'POR_APROBAR'} onClick={() => setFoco((f) => (f === 'POR_APROBAR' ? 'TODOS' : 'POR_APROBAR'))}
                />
                <StatCard
                    icon={FileSpreadsheet} label="Sin ajustar" value={formatQty(resumen.sinAjuste)}
                    iconBg="bg-danger/10" iconCls="text-danger"
                    valueCls={resumen.sinAjuste ? 'text-danger' : 'text-content'}
                    sub="el ERP sigue sin corregir"
                    active={foco === 'SIN_AJUSTE'} onClick={() => setFoco((f) => (f === 'SIN_AJUSTE' ? 'TODOS' : 'SIN_AJUSTE'))}
                />
            </CarrilCards>

            {/* §17: los filtros de la vista, en UNA píldora, en el cuerpo y a la
                derecha. El segmentado pasa a bloque de 2 columnas en teléfono — en
                riel sus cuatro opciones no caben en la hoja inferior. */}
            <div className="flex justify-end mb-4">
                <FilterBar activeCount={(branchFilter && !isBranchScoped ? 1 : 0) + (foco !== 'TODOS' ? 1 : 0)}
                    onClear={() => { if (!isBranchScoped) setBranchFilter(''); setFoco('TODOS'); }}
                    acciones={canEdit ? [{
                        key: 'nuevo', icon: Plus, label: 'Nuevo Conteo', variant: 'primary',
                        onClick: () => setShowModal(true),
                    }] : []}>
                    <FilterBar.Section
                        active={!!branchFilter && !isBranchScoped}
                        onClear={() => setBranchFilter('')}
                        label="sucursal"
                    >
                        <FilterBar.Sucursal
                            value={branchFilter || null}
                            onChange={(v) => setBranchFilter(v || '')}
                            options={branchOpts}
                            disabled={isBranchScoped}
                        />
                    </FilterBar.Section>
                    <FilterBar.Section active={foco !== 'TODOS'} onClear={() => setFoco('TODOS')} label="estado">
                        {/* Cuatro opciones: `FilterBar.Opciones` las da como select.
                            Con eso se va el `layout=block/columns=2`, que existía solo
                            porque en el teléfono el riel de cuatro no entraba. */}
                        <FilterBar.Opciones
                            label="Filtrar por lo que necesita atención"
                            value={foco}
                            onChange={setFoco}
                            options={[
                                { value: 'TODOS', label: 'Todos' },
                                { value: 'ABIERTOS', label: 'Abiertos' },
                                { value: 'POR_APROBAR', label: 'Por aprobar' },
                                { value: 'SIN_AJUSTE', label: 'Sin ajustar' },
                            ]}
                        />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {isSearchFuzzy && search && (
                <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{search}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
            )}
            {/* Teléfono: una fila por conteo. La tabla son 8 columnas y aun con 4
                visibles desbordaba 298px a 320 (medido) — `DataTable` no reflowa a
                tarjetas (§32), así que se cierra acá igual que en el detalle. Se usa
                `ListRow`, que es el canónico de esta anatomía exacta: caja al
                principio, contenido, algo al final. */}
            <div className="md:hidden space-y-2">
                {loading ? (
                    <div data-surface="card" className="p-4"><SkeletonText lines={5} /></div>
                ) : filtered.length === 0 ? (
                    <div data-surface="card" className="p-8 text-center">
                        <ClipboardCheck size={28} className="mx-auto text-content-3 mb-2" />
                        <p className="text-body-sm font-bold text-content-3">
                            {foco === 'TODOS' ? 'Sin conteos de inventario' : 'Nada pendiente acá'}
                        </p>
                    </div>
                ) : filtered.map((c) => {
                    const es = ESTADO_CFG[c.status] || ESTADO_CFG.BORRADOR;
                    const valorNeto = (c.valor_sobrante || 0) - (c.valor_faltante || 0);
                    return (
                        <ListRow
                            key={c.id}
                            icon={es.icon}
                            // El tono de la fila dice el estado sin gastar una línea:
                            // lo que falta ajustar es lo urgente de esta pantalla.
                            tone={faltaAjuste(c) ? 'peligro' : null}
                            title={c.branches?.name || '—'}
                            subtitle={`${fmtDate(c.created_at)} · ${SCOPE_LABEL[c.scope_type] || c.scope_type}`}
                            onClick={() => navigate(`/conteo-inventario/${c.id}`)}
                            trailing={(
                                <span className="flex flex-col items-end gap-1">
                                    <Badge variant={es.variante} size="sm">{es.label}</Badge>
                                    {c.total_diferencias > 0 && (
                                        <span className="text-caption font-bold text-warning-text tabular-nums">
                                            {c.total_diferencias} dif · {formatMoney(valorNeto)}
                                        </span>
                                    )}
                                    {faltaAjuste(c) && (
                                        <Badge variant="warning" size="sm" icon={FileSpreadsheet} uppercase={false}>Falta ajuste</Badge>
                                    )}
                                    {c.total_pendientes > 0 && !c.pendientes_como_cero && (
                                        <Badge variant="danger" size="sm" uppercase={false}>Parcial</Badge>
                                    )}
                                </span>
                            )}
                        />
                    );
                })}
            </div>

            <div className="hidden md:block">
            <DataTable columns={COLS} loading={loading} empty={{
                icon: ClipboardCheck,
                message: foco === 'TODOS' ? 'Sin conteos de inventario' : 'Nada pendiente acá',
                subtext: foco === 'TODOS'
                    ? 'Un conteo toma una foto del inventario del ERP y la compara con lo que hay en el anaquel.'
                    : 'Ningún conteo cae en este filtro. Prueba con "Todos".',
                action: foco !== 'TODOS'
                    ? { label: 'Ver todos', onClick: () => setFoco('TODOS') }
                    : (canEdit ? { label: 'Nuevo Conteo', onClick: () => setShowModal(true) } : undefined),
            }}>
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
                                <span className={`text-label font-bold tabular-nums ${valorNeto < 0 ? 'text-danger' : valorNeto > 0 ? 'text-chart-1-text' : 'text-content-3'}`}>{formatMoney(valorNeto)}</span>
                            </DataCell>
                            <DataCell align="center">
                                <div className="flex flex-col items-center gap-1">
                                    <Badge variant={es.variante} size="sm" icon={es.icon}>{es.label}</Badge>
                                    {/* Aprobado no es el final: el stock lo corrige el ERP.
                                        Un conteo firmado y sin ajustar es trabajo a medias. */}
                                    {c.status === 'CERRADO' && c.total_diferencias > 0 && !c.ajuste_erp_aplicado && (
                                        <Badge variant="warning" size="sm" icon={FileSpreadsheet} uppercase={false}>Falta ajuste ERP</Badge>
                                    )}
                                </div>
                            </DataCell>
                            <DataCell align="right">
                                <ChevronRight size={16} className="text-content-3" />
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
            </div>

            <NuevoConteoModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onCreated={(id) => navigate(`/conteo-inventario/${id}`)}
            />
        </GlassViewLayout>
    );
}
