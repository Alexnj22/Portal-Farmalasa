import React, { useMemo } from 'react';
import { FileText, Receipt, Award, CreditCard, Eye, FolderOpen } from 'lucide-react';
import { openStoredFile } from '../../utils/storageFiles';
import { getExpiryBadge, getExpiringDocuments } from '../../utils/documentExpiry';

// Ícono por categoría de documento del expediente (employees.employee_documents JSONB) —
// mismo expediente que EmployeeFormModal, mostrado aquí en modo solo-lectura desde Mi
// Perfil (el propio empleado) y EmployeeDetailView (RRHH viendo a un empleado).
const docIcon = (category) => {
    if (category?.startsWith('ANUALIDAD')) return Receipt;
    if (category === 'SRS' || category === 'ENFERMERIA' || category === 'CONTRATO_REGENCIA') return Award;
    if (category?.startsWith('DUI') || category === 'DOCUMENTO_IDENTIDAD') return CreditCard;
    return FileText;
};

const DocumentRow = ({ doc }) => {
    const Icon = docIcon(doc.category);
    const badge = getExpiryBadge(doc.expiry_date);
    const hasFile = !!doc.url;
    return (
        <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/60 backdrop-blur-sm border border-white/80 hover:bg-white/85 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-all duration-200">
            <div className="w-9 h-9 rounded-xl bg-slate-100/80 border border-slate-200/60 flex items-center justify-center shrink-0">
                <Icon size={15} className="text-slate-500" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-slate-700 truncate">{doc.title || doc.category}</p>
                {doc.expiry_date && (
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                        Vence {new Date(doc.expiry_date + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {badge && (
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${badge.className}`}>{badge.label}</span>
                )}
                {hasFile ? (
                    <button
                        type="button"
                        onClick={() => openStoredFile(doc.url)}
                        className="w-8 h-8 rounded-full bg-[#0052CC]/10 text-[#0052CC] flex items-center justify-center hover:bg-[#0052CC]/20 hover:-translate-y-0.5 transition-all duration-200 active:scale-[0.97] shrink-0"
                        title="Ver documento"
                    >
                        <Eye size={13} strokeWidth={2.2} />
                    </button>
                ) : (
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 whitespace-nowrap">Pendiente</span>
                )}
            </div>
        </div>
    );
};

// Lista de solo lectura del expediente de un empleado — vencidos/por vencer primero.
// Usada por EmployeeProfileView (el propio empleado) y EmployeeDetailView (RRHH).
const EmployeeDocumentsList = ({ documents, emptyLabel = 'Sin documentos registrados' }) => {
    const ordered = useMemo(() => {
        const docs = Array.isArray(documents) ? documents : [];
        const expiring = getExpiringDocuments(docs);
        const expiringCategories = new Set(expiring.map(d => d.category));
        const rest = docs.filter(d => !expiringCategories.has(d.category));
        return [...expiring, ...rest];
    }, [documents]);

    if (ordered.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[160px] animate-in fade-in zoom-in-95 duration-700">
                <div className="relative flex flex-col items-center text-center">
                    <div className="absolute top-2 w-20 h-20 rounded-full blur-[40px] opacity-20 bg-slate-400" />
                    <div className="relative z-10 w-12 h-12 rounded-[1rem] flex items-center justify-center mb-3 bg-white/70 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] text-slate-400">
                        <FolderOpen size={22} strokeWidth={1.5} />
                    </div>
                    <h3 className="font-bold text-[14px] text-slate-700 tracking-tight">{emptyLabel}</h3>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {ordered.map(doc => <DocumentRow key={doc.category} doc={doc} />)}
        </div>
    );
};

export default EmployeeDocumentsList;
