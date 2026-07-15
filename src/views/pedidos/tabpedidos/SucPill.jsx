// Extracted from TabPedidos.jsx (Bloque 6.C)
import { Building2 } from 'lucide-react';
import { ERP_NAMES } from '../../../constants/erp';
import { SUC_COLORS } from './constants';

export default function SucPill({ sucId }) {
    const cls = SUC_COLORS[sucId] ?? 'bg-slate-100 text-slate-600 border-slate-200';
    return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${cls}`}>
            <Building2 size={11} /> {ERP_NAMES[sucId] ?? `Suc. ${sucId}`}
        </span>
    );
}
