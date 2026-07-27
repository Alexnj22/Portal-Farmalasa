// Extracted from TabPedidos.jsx (Bloque 6.C)
import { Building2, X } from 'lucide-react';
import Button from '../../../components/common/Button';
import LiquidSelect from '../../../components/common/LiquidSelect';
import PeriodPicker from '../../../components/common/PeriodPicker';
import { currentMonthRange } from './helpers';

export default function FilterPill({ isBranch, filterSuc, setFilterSuc, filterStatus, setFilterStatus, filterOptions, filterDate, setFilterDate }) {
    const defaultDate = currentMonthRange();
    const dateDirty   = filterDate !== defaultDate;
    const hasActive   = (!isBranch && filterSuc !== '') || filterStatus !== 'all' || dateDirty;
    const clearAll    = () => { setFilterSuc(''); setFilterStatus('all'); setFilterDate(defaultDate); };

    const statusBtn = (key, label, activeClass = 'bg-chart-1-solid text-white border-chart-1') => (
        <button
            onClick={() => setFilterStatus(v => v === key ? 'all' : key)}
            className={`flex items-center gap-1 text-label px-3 py-1 rounded-full border font-medium transition-colors whitespace-nowrap shrink-0 ${
                filterStatus === key
                    ? activeClass
                    : 'bg-surface-card text-content-3 border-divider hover:border-divider hover:text-content-2'
            }`}
        >
            {label}{filterStatus === key && <X size={9} strokeWidth={3} className="ml-0.5" />}
        </button>
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
                {statusBtn('observacion','Con observación', 'bg-warning-solid text-white border-warning')}
                {statusBtn('completado', 'Completados',     'bg-success-solid text-white border-success')}
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
