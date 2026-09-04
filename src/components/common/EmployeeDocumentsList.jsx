import React, { useMemo } from 'react';
import Button from './Button';
import Badge from './Badge';
import { Eye, FolderOpen } from 'lucide-react';
import { openStoredFile } from '../../utils/storageFiles';
import { getExpiryBadge, getExpiringDocuments } from '../../utils/documentExpiry';
import { nombreDeDocumento, iconoDeCategoria, tinteDeCategoria } from '../../utils/documentosDelExpediente';


const DocumentRow = ({ doc }) => {
    const Icon = iconoDeCategoria(doc.category);
    const tinte = tinteDeCategoria(doc.category);
    const badge = getExpiryBadge(doc.expiry_date);
    const hasFile = !!doc.url;
    return (
        <div data-surface="card" className="flex items-center gap-3 p-3.5 transition-all duration-[var(--dur-base)]">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tinte.iconBg}`}>
                {/* eslint-disable-next-line react-hooks/static-components -- Icon sale de `iconoDeCategoria`, que elige entre íconos ya importados; no crea un componente nuevo */}
                <Icon size={15} className={tinte.iconCls} strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-body-sm font-bold text-content truncate">{nombreDeDocumento(doc)}</p>
                {doc.expiry_date && (
                    <p className="text-caption text-content-3 font-medium mt-0.5">
                        Vence {new Date(doc.expiry_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {badge && (
                    <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                )}
                {hasFile ? (
                    <Button size="sm" icon={Eye} title="Ver documento" iconOnly onClick={() => openStoredFile(doc.url)} />
                ) : (
                    <Badge variant="warning" size="sm" className="whitespace-nowrap">Pendiente</Badge>
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
            <div className="flex flex-col items-center justify-center min-h-[160px] animate-in fade-in zoom-in-95 duration-[var(--dur-lento)]">
                <div className="relative flex flex-col items-center text-center">
                    <div className="absolute top-2 w-20 h-20 rounded-full blur-[40px] opacity-20 bg-content-3" />
                    <div data-surface="dropdown" className="relative z-base w-12 h-12 flex items-center justify-center mb-3 text-content-3">
                        <FolderOpen size={22} strokeWidth={1.5} />
                    </div>
                    <h3 className="font-bold text-body-lg text-content tracking-tight">{emptyLabel}</h3>
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
