import React, { useEffect, useMemo, useState } from 'react';
import { Target, Plus, History } from 'lucide-react';
import Badge from '../../components/common/Badge';
import FilterBar from '../../components/common/FilterBar';
import ListRow from '../../components/common/ListRow';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { SkeletonText } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { fetchMetasHistorico } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymLabelCorto, TRAMO_CFG } from './metasUtils';

const COLS = [
    { key: 'mes',    label: 'Mes' },
    { key: 'sala',   label: 'Sala' },
    { key: 'meta',   label: 'Meta',         align: 'right' },
    { key: 'venta',  label: 'Vendido',      align: 'right' },
    { key: 'pct',    label: 'Cumplimiento', align: 'right' },
    { key: 'bono',   label: 'Bono' },
];

const fmtPct = (v) => formatPct(v);

export default function TabHistorico({ salaNombre, canEdit, onAgregarMeta, reloadKey, searchTerm }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [salaFilter, setSalaFilter] = useState('');
    const [soloConMeta, setSoloConMeta] = useState(false);

    useEffect(() => {
        let alive = true;
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- reset del skeleton antes de re-fetch tras guardar una meta
        setError(null);
        fetchMetasHistorico()
            .then((data) => { if (alive) { setRows(data); setLoading(false); } })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar el histórico')); setLoading(false); } });
        return () => { alive = false; };
    }, [reloadKey]);

    const salaOpts = useMemo(() => {
        const ids = [...new Set(rows.map((r) => r.branch_id))];
        return ids.map((id) => ({ value: String(id), label: salaNombre(id) }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [rows, salaNombre]);

    const filtered = useMemo(() => {
        let base = rows;
        if (salaFilter) base = base.filter((r) => String(r.branch_id) === salaFilter);
        if (soloConMeta) base = base.filter((r) => r.monto_meta != null);
        if (searchTerm?.trim()) {
            const q = searchTerm.trim().toLowerCase();
            base = base.filter((r) => (salaNombre(r.branch_id) || '').toLowerCase().includes(q));
        }
        return base;
    }, [rows, salaFilter, soloConMeta, searchTerm, salaNombre]);

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <FilterBar
                    activeCount={(salaFilter ? 1 : 0) + (soloConMeta ? 1 : 0)}
                    onClear={() => { setSalaFilter(''); setSoloConMeta(false); }}
                    acciones={canEdit ? [{
                        key: 'agregar', icon: Plus, label: 'Agregar meta', variant: 'primary',
                        onClick: () => onAgregarMeta(null, null),
                    }] : []}
                >
                    <FilterBar.Section active={!!salaFilter} onClear={() => setSalaFilter('')} label="sala">
                        <FilterBar.Sucursal
                            value={salaFilter || null}
                            onChange={(v) => setSalaFilter(v || '')}
                            options={salaOpts}
                        />
                    </FilterBar.Section>
                    <FilterBar.Section active={soloConMeta} onClear={() => setSoloConMeta(false)} label="metas">
                        <FilterBar.Opciones
                            label="Qué meses mostrar"
                            value={soloConMeta ? 'CON_META' : 'TODOS'}
                            onChange={(v) => setSoloConMeta(v === 'CON_META')}
                            options={[
                                { value: 'TODOS', label: 'Todos los meses' },
                                { value: 'CON_META', label: 'Solo con meta' },
                            ]}
                        />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {error && (
                <div data-surface="card" className="p-8 text-center">
                    <p className="text-body-sm font-bold text-danger-text">{error}</p>
                </div>
            )}

            {/* Teléfono: una fila por mes-sala (la tabla no reflowa, §32). */}
            <div className="md:hidden space-y-2">
                {loading ? (
                    <div data-surface="card" className="p-4"><SkeletonText lines={5} /></div>
                ) : filtered.map((r) => {
                    const tramo = TRAMO_CFG[r.bono_tier];
                    return (
                        <ListRow
                            key={`${r.year_month}-${r.branch_id}`}
                            icon={History}
                            title={`${salaNombre(r.branch_id)} · ${ymLabelCorto(r.year_month)}`}
                            subtitle={r.monto_meta != null
                                ? `Meta ${formatMoney(r.monto_meta)} · vendido ${formatMoney(r.venta_total)}`
                                : `Vendido ${formatMoney(r.venta_total)}`}
                            trailing={(
                                <span className="flex flex-col items-end gap-1">
                                    {r.monto_meta != null
                                        ? <>
                                            <span className={`text-body-sm font-black tabular-nums ${tramo?.textCls || ''}`}>{fmtPct(r.pct_cumplimiento)}</span>
                                            {tramo && <Badge variant={tramo.variante} size="sm">{tramo.label}</Badge>}
                                          </>
                                        : <Badge variant="neutral" size="sm">Sin meta</Badge>}
                                </span>
                            )}
                        />
                    );
                })}
            </div>

            <div className="hidden md:block">
                <DataTable columns={COLS} loading={loading} empty={{
                    icon: Target,
                    message: 'Sin meses en el histórico',
                    subtext: canEdit
                        ? 'Agrega las metas de meses anteriores y el cumplimiento se calcula solo con las ventas del portal.'
                        : 'El cumplimiento aparece cuando cada mes tiene su meta registrada.',
                    action: canEdit ? { label: 'Agregar meta', onClick: () => onAgregarMeta(null, null) } : undefined,
                }}>
                    {filtered.map((r, i) => {
                        const tramo = TRAMO_CFG[r.bono_tier];
                        return (
                            <DataRow key={`${r.year_month}-${r.branch_id}`} index={i}>
                                <DataCell><span className="text-body-sm font-black text-content-2 whitespace-nowrap">{ymLabelCorto(r.year_month)}</span></DataCell>
                                <DataCell><span className="text-body-sm font-bold">{salaNombre(r.branch_id)}</span></DataCell>
                                <DataCell align="right">
                                    <span className="text-body-sm font-semibold tabular-nums text-content-2">
                                        {r.monto_meta != null ? formatMoney(r.monto_meta) : <span className="opacity-30">—</span>}
                                    </span>
                                </DataCell>
                                <DataCell align="right"><span className="text-body-sm font-black tabular-nums">{formatMoney(r.venta_total)}</span></DataCell>
                                <DataCell align="right">
                                    {r.pct_cumplimiento != null
                                        ? <span className={`text-body-sm font-black tabular-nums ${tramo?.textCls || ''}`}>{fmtPct(r.pct_cumplimiento)}</span>
                                        : <span className="opacity-30 text-body-sm">—</span>}
                                </DataCell>
                                <DataCell>
                                    {r.monto_meta != null
                                        ? (tramo && <Badge variant={tramo.variante} size="sm">{tramo.label}</Badge>)
                                        : <Badge variant="neutral" size="sm">Sin meta</Badge>}
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>
            </div>
        </div>
    );
}
