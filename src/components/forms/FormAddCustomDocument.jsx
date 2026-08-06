import React, { useEffect, useState } from 'react';
import Switch from '../common/Switch';
import { FilePlus, Tag } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import FileField from '../common/FileField';
import PortalInput from '../common/PortalInput';
import { clickable } from '../../utils/clickable';

const CATEGORIES = [
    { value: 'Permisos y Licencias', label: 'Permisos y Licencias' },
    { value: 'Documentos Legales', label: 'Documentos Legales' },
    { value: 'Fiscal y Financiero', label: 'Fiscal y Financiero' },
    { value: 'Operativo y Logística', label: 'Operativo y Logística' },
    { value: 'Recursos Humanos', label: 'Recursos Humanos' },
    { value: 'Otro', label: 'Otro' }
];

const FormAddCustomDocument = ({ formData, setFormData, type }) => {
    const [isInitialized, setIsInitialized] = useState(false);

    // 1. Inicialización Inteligente (Nuevo vs Edición)
    useEffect(() => {
        // Si ya lo inicializamos, no hacemos nada más
        if (isInitialized) return;

        // Extraemos la sucursal (ya sea que venga directo en formData o dentro de formData.branch)
        const branchData = formData.branch || formData;
        const isEditing = type === 'editCustomDocument' && formData.docId;
        
        let initialDocData = {
            title: '',
            category: CATEGORIES[0].value,
            hasIssueDate: false,
            issueDate: '',
            hasExpiration: false,
            expDate: '',
            file: null,
            url: null // Guardamos la url original por si solo quiere editar texto
        };

        // Si estamos editando, buscamos el documento en el JSON de la sucursal
        if (isEditing && branchData?.settings?.customDocs) {
            const existingDoc = branchData.settings.customDocs.find(d => d.id === formData.docId);
            if (existingDoc) {
                // Si encontramos el documento, precargamos el formulario con sus datos
                initialDocData = {
                    title: existingDoc.title || '',
                    category: existingDoc.category || CATEGORIES[0].value,
                    hasIssueDate: !!existingDoc.hasIssueDate, // Convertir a booleano estricto
                    issueDate: existingDoc.issueDate || '',
                    hasExpiration: !!existingDoc.hasExpiration, // Convertir a booleano estricto
                    expDate: existingDoc.expDate || '',
                    file: null, // El archivo físico siempre inicia en null para subir uno nuevo
                    url: existingDoc.url || null
                };
            }
        }

        // Guardamos el estado inicial en el formData global
        setFormData(prev => ({
            ...prev,
            newDocData: initialDocData
        }));

        setIsInitialized(true); // eslint-disable-line react-hooks/set-state-in-effect -- inicialización única guardada por el flag isInitialized

    }, [formData, setFormData, type, isInitialized]);

    const data = formData.newDocData;
    
    // Mientras carga la inicialización, no mostramos nada para evitar flasheos
    if (!data || !isInitialized) return null;

    const isEditing = type === 'editCustomDocument';

    const updateField = (field, value) => {
        setFormData(prev => ({
            ...prev,
            newDocData: { ...prev.newDocData, [field]: value }
        }));
    };

    return (
        <div className="space-y-6">
            
            {/* 1. Nombre del Documento */}
            <PortalInput
                label="Nombre del Documento" name="doc-titulo" icon={FilePlus}
                value={data.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="Ej. Permiso de Rótulos Luminosos"
            />

            {/* 2. Categoría */}
            <div>
                <label className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 mb-2 ml-1">
                    <Tag size={12} className="text-chart-3-text"/> Categoría
                </label>
                <LiquidSelect
                    value={data.category}
                    onChange={(val) => updateField('category', val)}
                    options={CATEGORIES}
                    placeholder="Selecciona una categoría..."
                />
            </div>

            {/* 3. Zona de Carga (PDF / Imagen) — canónico `FileField` (2c).
                `missing` conserva el rojo que este formulario ya usaba: editando
                un registro que existe pero no tiene archivo, falta algo, y eso
                no es lo mismo que un adjunto opcional en blanco. */}
            <FileField
                label={isEditing && !data.url ? 'Subir Archivo Digital' : 'Archivo Digital (Opcional)'}
                accept=".pdf,image/*"
                file={data.file}
                url={data.url}
                onChange={f => updateField('file', f)}
                emptyState={isEditing && !data.url ? 'missing' : 'neutral'}
            />

            {/* 4. Control de Fechas */}
            <div className="pt-4 border-t border-divider space-y-6">
                
                {/* Toggle Fecha de Emisión */}
                <div className="flex flex-col gap-3">
                    <div 
                        className="flex items-center justify-between cursor-pointer group"
                        {...clickable(() => updateField('hasIssueDate', !data.hasIssueDate))}
                    >
                        <div>
                            <p className="text-body font-black text-content-2 group-hover:text-brand-text transition-colors">¿Tiene fecha de expedición?</p>
                            <p className="text-caption font-bold text-content-3 mt-0.5">Útil para documentos de renovación periódica.</p>
                        </div>
                        {/* Indicador: la fila entera ya es clickeable. */}
                        <Switch checked={data.hasIssueDate} size="md" variant="success" />
                    </div>
                    {data.hasIssueDate && (
                        <div className="animate-in slide-in-from-top-2 fade-in duration-[var(--dur-slow)] mt-1">
                            <LiquidDatePicker
                                value={data.issueDate}
                                onChange={(date) => updateField('issueDate', date)}
                                placeholder="Seleccionar expedición"
                            />
                        </div>
                    )}
                </div>

                {/* Toggle Fecha de Vencimiento */}
                <div className="flex flex-col gap-3">
                    <div 
                        className="flex items-center justify-between cursor-pointer group"
                        {...clickable(() => updateField('hasExpiration', !data.hasExpiration))}
                    >
                        <div>
                            <p className="text-body font-black text-content-2 group-hover:text-warning transition-colors">¿Tiene fecha de vencimiento?</p>
                            <p className="text-caption font-bold text-content-3 mt-0.5">El sistema te alertará antes de que caduque.</p>
                        </div>
                        {/* Indicador: la fila entera ya es clickeable. */}
                        <Switch checked={data.hasExpiration} size="md" variant="warning" />
                    </div>
                    {data.hasExpiration && (
                        <div className="animate-in slide-in-from-top-2 fade-in duration-[var(--dur-slow)] mt-1">
                            <LiquidDatePicker
                                value={data.expDate}
                                onChange={(date) => updateField('expDate', date)}
                                placeholder="Seleccionar vencimiento"
                            />
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default FormAddCustomDocument;