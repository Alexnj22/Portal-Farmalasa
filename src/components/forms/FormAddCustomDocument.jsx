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

        setIsInitialized(true);

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
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-2 ml-1">
                    <FilePlus size={12} className="text-[#007AFF]"/> Nombre del Documento
                </label>
                <div className="relative">
                    <input 
                        type="text"
                        value={data.title}
                        onChange={(e) => updateField('title', e.target.value)}
                        placeholder="Ej. Permiso de Rótulos Luminosos"
                        className="w-full bg-white/60 backdrop-blur-md border border-white/80 rounded-2xl px-4 py-3.5 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF] focus:bg-white outline-none transition-all shadow-sm placeholder:text-slate-400/70"
                    />
                </div>
            </div>

            {/* 2. Categoría */}
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-2 ml-1">
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
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-2 ml-1">
                    <UploadCloud size={12} className="text-[#007AFF]"/> {isEditing && !data.url ? 'Subir Archivo Digital' : 'Archivo Digital (Opcional)'}
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
                            ? 'border-emerald-400 bg-emerald-50/50 hover:bg-emerald-50' 
                            : isEditing && !data.url
                                ? 'border-red-300 bg-red-50/30 hover:bg-red-50 hover:border-red-400' // Alerta roja si falta subir en edición
                                : 'border-slate-300 bg-white/60 backdrop-blur-md hover:bg-white hover:border-[#007AFF]/50'
                        }`}
                    >
                        {data.file ? (
                            <div className="flex flex-col items-center text-emerald-600">
                                <CheckCircle2 size={24} strokeWidth={2.5} className="mb-2" />
                                <span className="text-[12px] font-black truncate max-w-[200px]">{data.file.name}</span>
                                <span className="text-[9px] font-bold mt-1 text-emerald-500/70 uppercase tracking-widest">Archivo Listo para Subir</span>
                            </div>
                        ) : data.url ? (
                            <div className="flex flex-col items-center text-emerald-600">
                                <CheckCircle2 size={24} strokeWidth={2.5} className="mb-2" />
                                <span className="text-[12px] font-black truncate max-w-[200px]">Archivo Subido al Servidor</span>
                                <span className="text-[9px] font-bold mt-1 text-emerald-500/70 uppercase tracking-widest">Click para reemplazar</span>
                            </div>
                        ) : (
                            <div className={`flex flex-col items-center ${isEditing ? 'text-red-500' : 'text-slate-500'}`}>
                                <UploadCloud size={24} strokeWidth={1.5} className="mb-2" />
                                <span className="text-[12px] font-black">{isEditing ? 'Falta Documento - Sube el PDF' : 'Subir PDF o Imagen'}</span>
                                <span className={`text-[9px] font-bold mt-1 uppercase tracking-widest ${isEditing ? 'text-red-400' : 'text-slate-400'}`}>Click para explorar</span>
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
                            <p className="text-[13px] font-black text-slate-700 group-hover:text-[#007AFF] transition-colors">¿Tiene fecha de expedición?</p>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">Útil para documentos de renovación periódica.</p>
                        </div>
                        <div className={`w-11 h-6 rounded-full relative transition-colors duration-300 shadow-inner ${data.hasIssueDate ? 'bg-emerald-500' : 'bg-slate-200'}`}>
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
                            <p className="text-[13px] font-black text-slate-700 group-hover:text-amber-500 transition-colors">¿Tiene fecha de vencimiento?</p>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">El sistema te alertará antes de que caduque.</p>
                        </div>
                        <div className={`w-11 h-6 rounded-full relative transition-colors duration-300 shadow-inner ${data.hasExpiration ? 'bg-amber-500' : 'bg-slate-200'}`}>
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