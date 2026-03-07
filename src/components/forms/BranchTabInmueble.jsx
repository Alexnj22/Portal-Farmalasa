import React, { useMemo } from 'react';
import { Building2, Home, Trash2, User, Phone, DollarSign, CalendarDays, Landmark, FileText, AlertCircle, Flame, BugOff } from 'lucide-react';
import { LazyInput, Switch, FileUploader, clampInt, formatPhoneMask } from './BranchHelpers';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect';

const BranchTabInmueble = ({ 
    isRented, rent, rentContract, legal, setFormData, 
    updateNestedSetting, handleContractChange, getTabStatus, safeParse 
}) => {
    
    // 🚨 CLASES MAESTRAS LIQUIDGLASS
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_10px_40px_rgba(0,0,0,0.06)] hover:bg-white/80 hover:border-white";
    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/30 focus-within:ring-4 focus-within:ring-[#007AFF]/10";

    // 🚨 TIPOS DE EXTINTORES MÁS COMUNES
    const extinguisherOptions = useMemo(() => [
        { value: 'ABC', label: 'Polvo Químico Seco (ABC)' },
        { value: 'CO2', label: 'Dióxido de Carbono (CO2)' },
        { value: 'AGUA', label: 'Agua Presurizada' },
        { value: 'ESPUMA', label: 'Espuma (AFFF)' },
        { value: 'K', label: 'Acetato de Potasio (Clase K)' },
        { value: 'MIXTO', label: 'Múltiples Tipos' },
    ], []);

    return (
        <div className="space-y-6">
            
            {/* 🚨 ISLA 1: INMUEBLE Y ARRENDAMIENTO */}
            <div className={`bg-white/60 rounded-[2rem] p-6 border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] ${islandHoverClass}`}>
                
                {/* Cabecera y Switch */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-white/60 pb-5">
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-[#007AFF] flex items-center gap-2">
                        <Home size={16} strokeWidth={2.5} /> Inmueble y Arrendamiento
                    </h4>
                    
                    <div className="flex items-center gap-4 bg-white/80 backdrop-blur-md border border-white shadow-sm px-5 py-2.5 rounded-2xl transition-all duration-300 hover:shadow-md">
                        <span className={`text-[10px] font-black uppercase tracking-widest transition-colors ${!isRented ? 'text-purple-600' : 'text-slate-400'}`}>Propio</span>
                        <Switch on={isRented} onToggle={() => {
                            const nextState = isRented ? "OWNED" : "RENTED";
                            setFormData(prev => ({
                                ...prev, settings: { ...safeParse(prev.settings), propertyType: nextState, rent: nextState === "RENTED" ? (safeParse(prev.settings)?.rent || { contract: {} }) : null }
                            }));
                        }} />
                        <span className={`text-[10px] font-black uppercase tracking-widest transition-colors ${isRented ? 'text-[#007AFF]' : 'text-slate-400'}`}>Alquilado</span>
                    </div>
                </div>

                {isRented ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-in fade-in zoom-in-95 duration-500 bg-white/40 p-5 rounded-[1.5rem] border border-white/60 shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)]">
                        
                        <div className="md:col-span-2">
                            {/* 🚨 CORRECCIÓN: animate-pulse reemplazado por border-red-200 shadow-[0_0_8px_rgba(239,68,68,0.5)] */}
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 flex justify-between items-center">
                                Arrendador (Dueño) * {getTabStatus(3) === 'red' && !rent.landlordName && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200 shadow-[0_0_8px_rgba(239,68,68,0.5)]">Requerido</span>}
                            </label>
                            <LazyInput 
                                required 
                                icon={User}
                                placeholder="Ej: Inversiones Robles S.A. de C.V."
                                className={`!bg-white shadow-sm ${inputHoverClass} ${getTabStatus(3)==='red' && !rent.landlordName ? '!border-red-400 !bg-red-50/50 hover:!border-red-500':'border-slate-200/80'}`} 
                                value={rent.landlordName ?? ""} 
                                onChange={(val) => updateNestedSetting('rent', 'landlordName', val)} 
                            />
                        </div>

                        <div>
                            {/* 🚨 CORRECCIÓN */}
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 flex justify-between items-center">
                                Teléfono * {getTabStatus(3) === 'red' && !rent.landlordPhone && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200 shadow-[0_0_8px_rgba(239,68,68,0.5)]">Requerido</span>}
                            </label>
                            <LazyInput 
                                required 
                                icon={Phone}
                                placeholder="2222-0000"
                                pattern="[0-9]{4}-[0-9]{4}" 
                                className={`!bg-white shadow-sm ${inputHoverClass} ${getTabStatus(3)==='red' && !rent.landlordPhone ? '!border-red-400 !bg-red-50/50 hover:!border-red-500':'border-slate-200/80'}`} 
                                value={rent.landlordPhone ?? ""} 
                                onChange={(val) => updateNestedSetting('rent', 'landlordPhone', formatPhoneMask(val))} 
                            />
                        </div>
                        <div>
                            {/* 🚨 CORRECCIÓN */}
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 flex justify-between items-center">
                                Mensualidad ($) * {getTabStatus(3) === 'red' && !rent.amount && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200 shadow-[0_0_8px_rgba(239,68,68,0.5)]">Requerido</span>}
                            </label>
                            <LazyInput 
                                required 
                                type="number" 
                                icon={DollarSign}
                                placeholder="0.00"
                                className={`!bg-white shadow-sm ${inputHoverClass} ${getTabStatus(3)==='red' && !rent.amount ? '!border-red-400 !bg-red-50/50 hover:!border-red-500':'border-slate-200/80'}`} 
                                value={rent.amount ?? ""} 
                                onChange={(val) => updateNestedSetting('rent', 'amount', val === "" ? null : Number(val))} 
                            />
                        </div>

                        <div className="relative z-50">
                            {/* 🚨 CORRECCIÓN */}
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 flex justify-between items-center">
                                Inicio Contrato * {getTabStatus(3) === 'red' && !rentContract.startDate && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200 shadow-[0_0_8px_rgba(239,68,68,0.5)]">Requerido</span>}
                            </label>
                            <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-sm flex items-center h-[42px] px-1 relative ${inputHoverClass} ${getTabStatus(3)==='red' && !rentContract.startDate ? '!border-red-400 bg-red-50/50' : ''}`}>
                                <LiquidDatePicker
                                    value={rentContract.startDate ?? ""}
                                    onChange={(val) => handleContractChange('startDate', val || null)}
                                    placeholder="DD/MM/AAAA"
                                />
                            </div>
                        </div>

                        <div>
                            {/* 🚨 CORRECCIÓN */}
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 flex justify-between items-center">
                                Vigencia (Meses) * {getTabStatus(3) === 'red' && !rentContract.termMonths && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200 shadow-[0_0_8px_rgba(239,68,68,0.5)]">Requerido</span>}
                            </label>
                            <LazyInput 
                                required 
                                type="number" 
                                icon={CalendarDays}
                                placeholder="Ej: 12"
                                className={`!bg-white shadow-sm ${inputHoverClass} ${getTabStatus(3)==='red' && !rentContract.termMonths ? '!border-red-400 !bg-red-50/50 hover:!border-red-500':'border-slate-200/80'}`} 
                                value={rentContract.termMonths ?? ""} 
                                onChange={(val) => handleContractChange('termMonths', val === "" ? null : clampInt(val, 1, 240))} 
                            />
                        </div>

                        {rentContract.endDate && (
                            <div className="md:col-span-2 flex items-center gap-3 bg-amber-50/80 border border-amber-200 p-3 rounded-2xl animate-in slide-in-from-bottom-2 duration-500">
                                <AlertCircle size={18} className="text-amber-500 shrink-0" />
                                <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">
                                    Vencimiento calculado del contrato: <span className="text-amber-900 bg-white px-3 py-1 rounded-lg shadow-sm ml-2">{new Date(rentContract.endDate).toLocaleDateString()}</span>
                                </p>
                            </div>
                        )}

                        <div className="md:col-span-2 mt-2 pt-4 border-t border-slate-200/60">
                            <FileUploader 
                                label="Contrato de Arrendamiento (PDF)" 
                                icon={FileText}
                                file={rentContract.documentFile} 
                                url={rentContract.documentUrl} 
                                onChange={(f) => handleContractChange('documentFile', f)} 
                            />
                        </div>
                    </div>
                ) : (
                    <div className="py-10 text-center bg-white/40 rounded-[1.5rem] border border-white/60 shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)] animate-in fade-in duration-500">
                        <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <Building2 size={28} strokeWidth={2} />
                        </div>
                        <p className="text-slate-500 font-black uppercase tracking-widest text-[12px]">
                            Local Propio
                        </p>
                        <p className="text-slate-400 font-bold text-[11px] mt-1">
                            No se requiere información de arrendamiento.
                        </p>
                    </div>
                )}
            </div>

            {/* 🚨 GRID INTERMEDIO: ALCALDÍA Y DESECHOS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* ISLA 2: ALCALDÍA */}
                <div className={`bg-white/60 rounded-[2rem] p-6 border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col ${islandHoverClass}`}>
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-[#007AFF] mb-5 flex items-center gap-2">
                        <Landmark size={16} strokeWidth={2.5} /> Permisos Municipales
                    </h4>
                    <div className="space-y-4 flex-1">
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Nº de Cuenta Municipal</label>
                            <LazyInput 
                                icon={FileText}
                                placeholder="Ej: 12345-A"
                                value={legal.municipalAccount || ""} 
                                onChange={(val) => updateNestedSetting('legal', 'municipalAccount', val)} 
                                className={`!bg-white shadow-sm ${inputHoverClass} border-slate-200/80`} 
                            />
                        </div>
                        <div className="relative z-40">
                            <label className="text-[10px] font-black uppercase tracking-widest text-amber-600 ml-1 mb-2 block flex items-center gap-1.5">
                                <AlertCircle size={12} strokeWidth={3} /> Próx. Renovación / Pago
                            </label>
                            <div className={`bg-amber-50/50 rounded-2xl border border-amber-200 shadow-sm flex items-center h-[42px] px-1 relative ${inputHoverClass}`}>
                                <LiquidDatePicker
                                    value={legal.municipalExpiration || ""}
                                    onChange={(val) => updateNestedSetting('legal', 'municipalExpiration', val)}
                                    placeholder="DD/MM/AAAA"
                                />
                            </div>
                        </div>
                        <div className="pt-2">
                            <FileUploader 
                                label="Solvencia Municipal (PDF)" 
                                file={legal.municipalFile} 
                                url={legal.municipalUrl} 
                                onChange={(f) => updateNestedSetting('legal', 'municipalFile', f)} 
                            />
                        </div>
                    </div>
                </div>

                {/* ISLA 3: DESECHOS */}
                <div className={`bg-white/60 rounded-[2rem] p-6 border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col ${islandHoverClass}`}>
                    <div className="flex items-center justify-between mb-5">
                        <h4 className="text-[12px] font-black uppercase tracking-widest text-[#007AFF] flex items-center gap-2">
                            <Trash2 size={16} strokeWidth={2.5} /> Desechos Bioinfecciosos
                        </h4>
                        <Switch on={legal.wasteManagement || false} onToggle={() => updateNestedSetting('legal', 'wasteManagement', !legal.wasteManagement)} />
                    </div>
                    
                    {legal.wasteManagement ? (
                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-500 flex-1">
                            <div className="relative z-40">
                                <label className="text-[10px] font-black uppercase tracking-widest text-amber-600 ml-1 mb-2 block flex items-center gap-1.5">
                                    <AlertCircle size={12} strokeWidth={3} /> Vencimiento Contrato
                                </label>
                                <div className={`bg-amber-50/50 rounded-2xl border border-amber-200 shadow-sm flex items-center h-[42px] px-1 relative ${inputHoverClass}`}>
                                    <LiquidDatePicker
                                        value={legal.wasteExpiration || ""}
                                        onChange={(val) => updateNestedSetting('legal', 'wasteExpiration', val)}
                                        placeholder="DD/MM/AAAA"
                                    />
                                </div>
                            </div>
                            <div className="pt-2">
                                <FileUploader 
                                    label="Contrato de Desechos (PDF)" 
                                    file={legal.wasteFile} 
                                    url={legal.wasteUrl} 
                                    onChange={(f) => updateNestedSetting('legal', 'wasteFile', f)} 
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center bg-white/40 rounded-[1.5rem] border border-white/60 shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)] p-6">
                            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-3">
                                <Trash2 size={20} strokeWidth={2} />
                            </div>
                            <p className="text-slate-400 font-bold text-[11px] uppercase tracking-widest leading-relaxed">
                                Gestión de desechos<br/>desactivada
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* 🚨 NUEVO GRID: EXTINTORES Y FUMIGACIÓN */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* ISLA 4: EXTINTORES */}
                <div className={`bg-white/60 rounded-[2rem] p-6 border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col ${islandHoverClass}`}>
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-orange-600 mb-5 flex items-center gap-2">
                        <Flame size={16} strokeWidth={2.5} /> Extintores
                    </h4>
                    
                    {/* 🚨 3 Filas para balancear altura */}
                    <div className="space-y-4 flex-1">
                        
                        {/* Fila 1: Cantidad */}
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Cant. Extintores</label>
                            <LazyInput 
                                type="number" 
                                placeholder="Ej: 2"
                                value={legal.extinguisherCount || ""} 
                                onChange={(val) => updateNestedSetting('legal', 'extinguisherCount', val ? Number(val) : null)} 
                                className={`!bg-white shadow-sm ${inputHoverClass} border-slate-200/80`} 
                            />
                        </div>

                        {/* Fila 2: Tipo de Extintor */}
                        <div className="relative z-50">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Tipo Principal</label>
                            <div className={`rounded-2xl ${inputHoverClass}`}>
                                <LiquidSelect
                                    value={legal.extinguisherType || ""}
                                    onChange={(val) => updateNestedSetting('legal', 'extinguisherType', val)}
                                    options={extinguisherOptions}
                                    placeholder="-- Seleccionar --"
                                />
                            </div>
                        </div>

                        {/* Fila 3: Vencimiento */}
                        <div className="relative z-40">
                            <label className="text-[10px] font-black uppercase tracking-widest text-amber-600 ml-1 mb-2 block flex items-center gap-1.5">
                                <AlertCircle size={12} strokeWidth={3} /> Vencimiento
                            </label>
                            <div className={`bg-amber-50/50 rounded-2xl border border-amber-200 shadow-sm flex items-center h-[42px] px-1 relative ${inputHoverClass}`}>
                                <LiquidDatePicker
                                    value={legal.extinguisherExpiration || ""}
                                    onChange={(val) => updateNestedSetting('legal', 'extinguisherExpiration', val)}
                                    placeholder="DD/MM/AAAA"
                                />
                            </div>
                        </div>
                        
                    </div>
                </div>

                {/* ISLA 5: CONTROL DE PLAGAS Y FUMIGACIÓN */}
                <div className={`bg-white/60 rounded-[2rem] p-6 border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col ${islandHoverClass}`}>
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-emerald-600 mb-5 flex items-center gap-2">
                        <BugOff size={16} strokeWidth={2.5} /> Control de Plagas y Fumigación
                    </h4>
                    
                    {/* 🚨 3 Filas para balancear altura */}
                    <div className="space-y-4 flex-1">
                        
                        {/* Fila 1: Empresa Fumigadora */}
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Empresa Proveedora</label>
                            <LazyInput 
                                icon={Building2}
                                placeholder="Nombre de la empresa"
                                value={legal.pestControlCompany || ""} 
                                onChange={(val) => updateNestedSetting('legal', 'pestControlCompany', val)} 
                                className={`!bg-white shadow-sm ${inputHoverClass} border-slate-200/80`} 
                            />
                        </div>

                        {/* Fila 2: Última Fumigación */}
                        <div className="relative z-30">
                            <label className="text-[10px] font-black uppercase tracking-widest text-emerald-600 ml-1 mb-2 block flex items-center gap-1.5">
                                <CalendarDays size={12} strokeWidth={3} /> Última Fumigación
                            </label>
                            <div className={`bg-white rounded-2xl border border-slate-200/80 shadow-sm flex items-center h-[42px] px-1 relative ${inputHoverClass}`}>
                                <LiquidDatePicker
                                    value={legal.lastFumigationDate || ""}
                                    onChange={(val) => updateNestedSetting('legal', 'lastFumigationDate', val)}
                                    placeholder="DD/MM/AAAA"
                                />
                            </div>
                        </div>

                        {/* Fila 3: Certificado */}
                        <div className="pt-2 border-t border-slate-200/60 mt-2">
                            <FileUploader 
                                label="Certificado de Fumigación (PDF)" 
                                file={legal.fumigationFile} 
                                url={legal.fumigationUrl} 
                                onChange={(f) => updateNestedSetting('legal', 'fumigationFile', f)} 
                            />
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};

export default BranchTabInmueble;