// Extracted from TabPedidos.jsx (Bloque 6.C)
import { Building2, X } from 'lucide-react';
import Button from '../../../components/common/Button';
import LiquidSelect from '../../../components/common/LiquidSelect';
import PeriodPicker from '../../../components/common/PeriodPicker';
import { currentMonthRange } from './helpers';
import FilterBar from '../../../components/common/FilterBar';

export default function FilterPill({ isBranch, filterSuc, setFilterSuc, filterStatus, setFilterStatus, filterOptions, filterDate, setFilterDate }) {
    const defaultDate = currentMonthRange();
    const dateDirty   = filterDate !== defaultDate;
    const hasActive   = (!isBranch && filterSuc !== '') || filterStatus !== 'all' || dateDirty;
    const clearAll    = () => { setFilterSuc(''); setFilterStatus('all'); setFilterDate(defaultDate); };

    // `FilterBar.Chip` es EXACTAMENTE esto: se apaga al volver a pulsarlo,
    // lleva `aria-pressed` y ya dibuja la × cuando está activo — que era lo
    // último que este botón hacía a mano. El `activeClass` pasa a ser `tone`.
    const statusBtn = (key, label, tone = 'brand') => (
        <FilterBar.Chip
            tone={tone}
            active={filterStatus === key}
            onToggle={() => setFilterStatus(v => v === key ? 'all' : key)}
        >
            {label}
        </FilterBar.Chip>
    );

    return (
        <div className="group flex items-center gap-0 h-14 rounded-2xl border border-divider bg-surface-card backdrop-blur-sm shadow-[var(--shadow-glass-1)] transition-all duration-300 hover:shadow-[var(--shadow-glass-3)] hover:-translate-y-0.5 hover:border-divider overflow-visible shrink-0">

            {/* Sucursal (solo bodega) */}
            {!isBranch && (
                <>
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible" style={{ width: '150px' }}>
                            <LiquidSelect value={filterSuc} onChange={v => setFilterSuc(v)} options={filterOptions} placeholder="Todas" icon={Building2} compact bare />
                        </div>
                        {filterSuc !== '' && (
                            <Button variant="destructive" icon={X} title="Quitar sucursal" iconOnly onClick={() => setFilterSuc('')} />
                        )}
                    </div>
                    <div className="h-5 w-px bg-divider shrink-0" />
                </>
            )}

            {/* Fecha */}
            <div className="flex items-center">
                <div className="px-2 py-2 overflow-visible">
                    <PeriodPicker value={filterDate} onChange={setFilterDate} />
                </div>
                {dateDirty && (
                    <Button variant="destructive" icon={X} title="Quitar fecha" iconOnly onClick={() => setFilterDate(defaultDate)} />
                )}
            </div>

            <div className="h-5 w-px bg-divider shrink-0" />

            {/* Estado */}
            <div className="flex items-center gap-1 px-2 py-1.5">
                {statusBtn('confirmado', 'Pendientes')}
                {statusBtn('enviado',    'En ruta')}
                <div className="h-3.5 w-px bg-divider mx-0.5 shrink-0" />
                {statusBtn('observacion','Con observación', 'warning')}
                {statusBtn('completado', 'Completados',     'success')}
            </div>

            {hasActive && (
                <>
                    <div className="h-5 w-px bg-divider shrink-0" />
                    <Button variant="destructive" size="xs" icon={X} iconOnly onClick={clearAll} />
                </>
            )}
        </div>
    );
}
