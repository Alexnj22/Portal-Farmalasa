import React, { useEffect, useState } from 'react';
import { FilePlus, Tag, UploadCloud, CheckCircle2 } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';

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
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 mb-2 ml-1">
                    <FilePlus size={12} className="text-brand"/> Nombre del Documento
                </label>
                <div className="relative">
                    <input 
                        type="text"
                        value={data.title}
                        onChange={(e) => updateField('title', e.target.value)}
                        placeholder="Ej. Permiso de Rótulos Luminosos"
                        className="w-full bg-surface-card backdrop-blur-md border border-border-card rounded-2xl px-4 py-3.5 text-sm font-bold text-content-2 focus:ring-2 focus:ring-brand/20 focus:border-brand focus:bg-white outline-none transition-all shadow-sm placeholder:text-content-3/70"
                    />
                </div>
            </div>

            {/* 2. Categoría */}
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 mb-2 ml-1">
                    <Tag size={12} className="text-purple-500"/> Categoría
                </label>
                <LiquidSelect
                    value={data.category}
                    onChange={(val) => updateField('category', val)}
                    options={CATEGORIES}
                    placeholder="Selecciona una categoría..."
                />
            </div>

            {/* 3. Zona de Carga (PDF / Imagen) */}
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 mb-2 ml-1">
                    <UploadCloud size={12} className="text-brand"/> {isEditing && !data.url ? 'Subir Archivo Digital' : 'Archivo Digital (Opcional)'}
                </label>
                <div className="relative">
                    <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={(e) => updateField('file', e.target.files[0])}
                        className="hidden"
                        id="file-upload-custom"
                    />
                    <label 
                        htmlFor="file-upload-custom"
                        className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                            data.file || data.url
                            ? 'border-emerald-400 bg-success/10 hover:bg-success/10' 
                            : isEditing && !data.url
                                ? 'border-red-300 bg-danger/10 hover:bg-danger/10 hover:border-red-400' // Alerta roja si falta subir en edición
                                : 'border-slate-300 bg-surface-card backdrop-blur-md hover:bg-white hover:border-brand/50'
                        }`}
                    >
                        {data.file ? (
                            <div className="flex flex-col items-center text-success">
                                <CheckCircle2 size={24} strokeWidth={2.5} className="mb-2" />
                                <span className="text-[12px] font-black truncate max-w-[200px]">{data.file.name}</span>
                                <span className="text-[9px] font-bold mt-1 text-success/70 uppercase tracking-widest">Archivo Listo para Subir</span>
                            </div>
                        ) : data.url ? (
                            <div className="flex flex-col items-center text-success">
                                <CheckCircle2 size={24} strokeWidth={2.5} className="mb-2" />
                                <span className="text-[12px] font-black truncate max-w-[200px]">Archivo Subido al Servidor</span>
                                <span className="text-[9px] font-bold mt-1 text-success/70 uppercase tracking-widest">Click para reemplazar</span>
                            </div>
                        ) : (
                            <div className={`flex flex-col items-center ${isEditing ? 'text-danger' : 'text-content-3'}`}>
                                <UploadCloud size={24} strokeWidth={1.5} className="mb-2" />
                                <span className="text-[12px] font-black">{isEditing ? 'Falta Documento - Sube el PDF' : 'Subir PDF o Imagen'}</span>
                                <span className={`text-[9px] font-bold mt-1 uppercase tracking-widest ${isEditing ? 'text-danger' : 'text-content-2'}`}>Click para explorar</span>
                            </div>
                        )}
                    </label>
                </div>
            </div>

            {/* 4. Control de Fechas */}
            <div className="pt-4 border-t border-slate-100 space-y-6">
                
                {/* Toggle Fecha de Emisión */}
                <div className="flex flex-col gap-3">
                    <div 
                        className="flex items-center justify-between cursor-pointer group"
                        onClick={() => updateField('hasIssueDate', !data.hasIssueDate)}
                    >
                        <div>
                            <p className="text-[13px] font-black text-content-2 group-hover:text-brand transition-colors">¿Tiene fecha de expedición?</p>
                            <p className="text-[10px] font-bold text-content-3 mt-0.5">Útil para documentos de renovación periódica.</p>
                        </div>
                        <div className={`w-11 h-6 rounded-full relative transition-colors duration-300 shadow-inner ${data.hasIssueDate ? 'bg-emerald-500' : 'bg-surface-card-hover'}`}>
                            <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-300 ${data.hasIssueDate ? 'translate-x-5' : 'translate-x-0'}`}></div>
                        </div>
                    </div>
                    {data.hasIssueDate && (
                        <div className="animate-in slide-in-from-top-2 fade-in duration-300 mt-1">
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
                        onClick={() => updateField('hasExpiration', !data.hasExpiration)}
                    >
                        <div>
                            <p className="text-[13px] font-black text-content-2 group-hover:text-warning transition-colors">¿Tiene fecha de vencimiento?</p>
                            <p className="text-[10px] font-bold text-content-3 mt-0.5">El sistema te alertará antes de que caduque.</p>
                        </div>
                        <div className={`w-11 h-6 rounded-full relative transition-colors duration-300 shadow-inner ${data.hasExpiration ? 'bg-amber-500' : 'bg-surface-card-hover'}`}>
                            <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-300 ${data.hasExpiration ? 'translate-x-5' : 'translate-x-0'}`}></div>
                        </div>
                    </div>
                    {data.hasExpiration && (
                        <div className="animate-in slide-in-from-top-2 fade-in duration-300 mt-1">
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