// Extracted from TabPedidos.jsx (Bloque 6.C)
import { Building2, X } from 'lucide-react';
import LiquidSelect from '../../../components/common/LiquidSelect';
import PeriodPicker from '../../../components/common/PeriodPicker';
import { currentMonthRange } from './helpers';

export default function FilterPill({ isBranch, filterSuc, setFilterSuc, filterStatus, setFilterStatus, filterOptions, filterDate, setFilterDate }) {
    const defaultDate = currentMonthRange();
    const dateDirty   = filterDate !== defaultDate;
    const hasActive   = (!isBranch && filterSuc !== '') || filterStatus !== 'all' || dateDirty;
    const clearAll    = () => { setFilterSuc(''); setFilterStatus('all'); setFilterDate(defaultDate); };

    const statusBtn = (key, label, activeClass = 'bg-blue-600 text-white border-blue-600') => (
        <button
            onClick={() => setFilterStatus(v => v === key ? 'all' : key)}
            className={`flex items-center gap-1 text-[11px] px-3 py-1 rounded-full border font-medium transition-colors whitespace-nowrap shrink-0 ${
                filterStatus === key
                    ? activeClass
                    : 'bg-white text-content-3 border-slate-200 hover:border-slate-300 hover:text-content-2'
            }`}
        >
            {label}{filterStatus === key && <X size={9} strokeWidth={3} className="ml-0.5" />}
        </button>
    );

    return (
        <div className="group flex items-center gap-0 h-14 rounded-2xl border border-slate-200/70 bg-surface-card backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 hover:border-slate-200 overflow-visible shrink-0">

            {/* Sucursal (solo bodega) */}
            {!isBranch && (
                <>
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible" style={{ width: '150px' }}>
                            <LiquidSelect value={filterSuc} onChange={v => setFilterSuc(v)} options={filterOptions} placeholder="Todas" icon={Building2} compact bare />
                        </div>
                        {filterSuc !== '' && (
                            <button onClick={() => setFilterSuc('')} title="Quitar sucursal" className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-danger/10 hover:bg-red-500 text-danger hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>
                    <div className="h-5 w-px bg-surface-card-hover shrink-0" />
                </>
            )}

            {/* Fecha */}
            <div className="flex items-center">
                <div className="px-2 py-2 overflow-visible">
                    <PeriodPicker value={filterDate} onChange={setFilterDate} />
                </div>
                {dateDirty && (
                    <button onClick={() => setFilterDate(defaultDate)} title="Quitar fecha" className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-danger/10 hover:bg-red-500 text-danger hover:text-white transition-all shrink-0 hover:scale-110">
                        <X size={9} strokeWidth={3} />
                    </button>
                )}
            </div>

            <div className="h-5 w-px bg-surface-card-hover shrink-0" />

            {/* Estado */}
            <div className="flex items-center gap-1 px-2 py-1.5">
                {statusBtn('confirmado', 'Pendientes')}
                {statusBtn('enviado',    'En ruta')}
                <div className="h-3.5 w-px bg-surface-card-hover mx-0.5 shrink-0" />
                {statusBtn('observacion','Con observación', 'bg-amber-500 text-white border-amber-500')}
                {statusBtn('completado', 'Completados',     'bg-emerald-600 text-white border-emerald-600')}
            </div>

            {hasActive && (
                <>
                    <div className="h-5 w-px bg-surface-card-hover shrink-0" />
                    <button onClick={clearAll} className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-danger/10 hover:bg-red-500 text-danger hover:text-white transition-all duration-200 shrink-0">
                        <X size={11} strokeWidth={3} />
                    </button>
                </>
            )}
        </div>
    );
}
