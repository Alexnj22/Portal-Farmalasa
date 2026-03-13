import React, { useMemo } from 'react';
import { Building2, MapPin, Phone, Smartphone, Map, Map as MapIcon, Navigation } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import { LazyInput, formatPhoneMask } from './BranchHelpers';

const BranchTabGeneral = ({
    formData, setFormData, name, openingDate, location, 
    departmentList = [], municipalityList = [], // 🚨 Prevención por default
    updateNestedSetting, getTabStatus
}) => {

    // 🚨 FIX DEL ERROR: Agregamos ( || [] ) para asegurar que map nunca lea undefined
    const depOptions = useMemo(() => 
        (departmentList || []).map(d => ({ value: d, label: d }))
    , [departmentList]);

    const munOptions = useMemo(() => 
        (municipalityList || []).map(m => ({ value: m, label: m }))
    , [municipalityList]);

    // 🚨 DISEÑO COMPACTO: p-4 y rounded-[1.5rem] para ahorrar espacio vertical
    const islandClass = "bg-white/60 rounded-[1.5rem] p-4 md:p-5 border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]";
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-white/80";
    
    // Altura optimizada h-[40px] para encajar perfecto
    const inputHoverClass = "transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus-within:ring-4 focus-within:ring-[#007AFF]/10 focus-within:border-[#007AFF]/50";

    return (
        // 🚨 COMPRESIÓN: space-y-4 en lugar de space-y-6
        <div className="space-y-4 w-full">
            
            {/* ISLA 1: IDENTIDAD */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-[#007AFF]/10 text-[#007AFF] rounded-[0.8rem] border border-[#007AFF]/20 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                        <Building2 size={16} strokeWidth={2.5} />
                    </div>
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Identidad de Sucursal</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between transition-colors">
                            Nombre Comercial * {getTabStatus(1) === 'red' && !name.trim() && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-[0_2px_8px_rgba(239,68,68,0.2)] border border-red-200">Requerido</span>}
                        </label>
                        <LazyInput
                            required
                            icon={Building2}
                            placeholder="Ej: La Popular Centro"
                            value={name}
                            onChange={(val) => setFormData(prev => ({ ...prev, name: val, branchName: val }))}
                            className={`!bg-white shadow-sm h-[40px] text-[13px] ${inputHoverClass} ${getTabStatus(1) === 'red' && !name.trim() ? '!border-red-400 !bg-red-50/50 hover:!border-red-500' : 'border-slate-200/80'}`}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Fecha de Apertura</label>
                        <div className={`bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] px-1.5 relative z-30 ${inputHoverClass}`}>
                            <LiquidDatePicker
                                value={openingDate}
                                onChange={(val) => setFormData(prev => ({ ...prev, openingDate: val, opening_date: val }))}
                                placeholder="DD/MM/AAAA"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ISLA 2: UBICACIÓN */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-emerald-50 text-emerald-600 rounded-[0.8rem] border border-emerald-100/50 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                        <MapPin size={16} strokeWidth={2.5} />
                    </div>
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Ubicación Geográfica</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative z-20"> 
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Departamento</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                            <LiquidSelect
                                value={location.department || ""}
                                onChange={(val) => {
                                    updateNestedSetting('location', 'department', val);
                                    updateNestedSetting('location', 'municipality', '');
                                }}
                                options={depOptions}
                                placeholder="-- Seleccionar --"
                                icon={MapIcon}
                            />
                        </div>
                    </div>

                    <div className="relative z-10">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                            Distrito / Municipio
                            {getTabStatus(1) === 'orange' && !location.municipality && <span className="text-amber-500 font-bold bg-amber-50 px-2 py-0.5 rounded-md shadow-[0_2px_8px_rgba(245,158,11,0.2)] border border-amber-200">Falta info</span>}
                        </label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                            <LiquidSelect
                                value={location.municipality || ""}
                                onChange={(val) => updateNestedSetting('location', 'municipality', val)}
                                options={munOptions}
                                placeholder={location.department ? '-- Seleccionar --' : 'Elija Depto.'}
                                icon={Navigation}
                                disabled={!location.department}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                            Dirección Exacta
                            {getTabStatus(1) === 'orange' && !formData.address?.trim() && <span className="text-amber-500 font-bold bg-amber-50 px-2 py-0.5 rounded-md shadow-[0_2px_8px_rgba(245,158,11,0.2)] border border-amber-200">Falta info</span>}
                        </label>
                        <LazyInput
                            placeholder="Barrio El Centro, 1ra Av. Norte..."
                            value={formData.address || ""}
                            onChange={(val) => setFormData(prev => ({ ...prev, address: val }))}
                            className={`!bg-white shadow-sm h-[40px] text-[13px] ${inputHoverClass} ${getTabStatus(1) === 'orange' && !formData.address?.trim() ? '!border-amber-400 !bg-amber-50/50 hover:!border-amber-500' : 'border-slate-200/80'}`}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Enlace Google Maps</label>
                        <LazyInput
                            icon={Map}
                            placeholder="https://maps.google.com/..."
                            value={location.mapsUrl || ""}
                            onChange={(val) => updateNestedSetting('location', 'mapsUrl', val)}
                            className={`!bg-white border-slate-200/80 shadow-sm h-[40px] text-[13px] ${inputHoverClass}`}
                        />
                    </div>
                </div>
            </div>

            {/* ISLA 3: CONTACTO */}
            <div className={`${islandClass} ${islandHoverClass}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-indigo-50 text-indigo-500 rounded-[0.8rem] border border-indigo-100/50 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                        <Phone size={16} strokeWidth={2.5} />
                    </div>
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Canales de Contacto</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                            Teléfono Fijo
                            {getTabStatus(1) === 'orange' && !formData.phone && <span className="text-amber-500 font-bold bg-amber-50 px-2 py-0.5 rounded-md shadow-[0_2px_8px_rgba(245,158,11,0.2)] border border-amber-200">Falta info</span>}
                        </label>
                        <LazyInput
                            icon={Phone}
                            placeholder="2222-0001"
                            value={formData.phone || ""}
                            onChange={(val) => setFormData(prev => ({ ...prev, phone: formatPhoneMask(val) }))}
                            maxLength={9}
                            className={`!bg-white shadow-sm h-[40px] text-[13px] ${inputHoverClass} ${getTabStatus(1) === 'orange' && !formData.phone ? '!border-amber-400 !bg-amber-50/50 hover:!border-amber-500' : 'border-slate-200/80'}`}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                            Celular / WhatsApp
                            {getTabStatus(1) === 'orange' && !formData.cell && <span className="text-amber-500 font-bold bg-amber-50 px-2 py-0.5 rounded-md shadow-[0_2px_8px_rgba(245,158,11,0.2)] border border-amber-200">Falta info</span>}
                        </label>
                        <LazyInput
                            icon={Smartphone}
                            placeholder="7000-0001"
                            value={formData.cell || ""}
                            onChange={(val) => setFormData(prev => ({ ...prev, cell: formatPhoneMask(val) }))}
                            maxLength={9}
                            className={`!bg-white shadow-sm h-[40px] text-[13px] ${inputHoverClass} ${getTabStatus(1) === 'orange' && !formData.cell ? '!border-amber-400 !bg-amber-50/50 hover:!border-amber-500' : 'border-slate-200/80'}`}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default React.memo(BranchTabGeneral);