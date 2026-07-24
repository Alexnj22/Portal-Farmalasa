// Extracted from TabPedidos.jsx (Bloque 6.C)
import { UserCircle2 } from 'lucide-react';

export default function EmpChip({ emp, label }) {
    if (!emp) return null;
    return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-content-2 font-medium shrink-0">
            <span className="text-content-3 text-[10px] uppercase tracking-wide">{label}</span>
            {emp.photo
                ? <img src={emp.photo} alt={emp.name} className="w-5 h-5 rounded-full object-cover border border-white shadow-sm" />
                : <span className="w-5 h-5 rounded-full bg-surface-card-hover flex items-center justify-center"><UserCircle2 size={12} className="text-content-3" /></span>
            }
            <span className="text-content font-semibold">{emp.name?.split(' ')[0] ?? '—'}</span>
        </span>
    );
}
