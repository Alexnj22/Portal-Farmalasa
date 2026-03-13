import React from 'react';
import { Zap, Droplet, Wifi, Smartphone, CalendarDays } from 'lucide-react';
import { LazyInput, clampInt } from './BranchHelpers';
import LiquidDatePicker from '../common/LiquidDatePicker';

const BranchTabServicios = ({ services, updateServiceField }) => {

    // 🚨 GPU LOCK: Mantenemos el scroll ultra fluido a 60 FPS
    const gpuLockStyle = {
        transform: 'translateZ(0)',
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        willChange: 'transform'
    };

    // 🚨 ESTILOS LIQUID GLASS CONSISTENTES
    const islandClass = "bg-white/60 rounded-[2rem] p-6 border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)]";
    const islandHoverClass = "transition-[transform,box-shadow,background-color,border-color] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_10px_40px_rgba(0,0,0,0.06)] hover:bg-white/80 hover:border-white";
    const inputHoverClass = "transition-[box-shadow,border-color] duration-300 hover:shadow-md hover:border-[#007AFF]/30 focus-within:ring-4 focus-within:ring-[#007AFF]/10";

    const servicesList = [
        { id: 'light', icon: Zap, label: 'Energía Eléctrica', placeholder: 'Ej. CAESS', accountLabel: 'Nº de NIC / NPE', color: 'text-amber-500', bgIcon: 'bg-amber-50' },
        { id: 'water', icon: Droplet, label: 'Agua Potable', placeholder: 'Ej. ANDA', accountLabel: 'Nº de Cuenta', color: 'text-cyan-500', bgIcon: 'bg-cyan-50' },
        { id: 'internet', icon: Wifi, label: 'Internet Fijo', placeholder: 'Ej. Tigo / Claro', accountLabel: 'Nº de Contrato / Teléfono', color: 'text-[#007AFF]', bgIcon: 'bg-blue-50' },
        { id: 'mobile', icon: Smartphone, label: 'Telefonía Móvil (Flota)', placeholder: 'Ej. Claro', accountLabel: 'Nº de Teléfono', color: 'text-purple-500', bgIcon: 'bg-purple-50' },
    ];

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full" style={gpuLockStyle}>
            {servicesList.map((srv) => (
                <div key={srv.id} className={`${islandClass} ${islandHoverClass} flex flex-col`} style={gpuLockStyle}>
                    
                    {/* ENCABEZADO CON ÍCONO COLOREADO */}
                    <div className="flex items-center gap-3 mb-5">
                        <div className={`p-2 ${srv.bgIcon} ${srv.color} rounded-[0.8rem] border border-white shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]`}>
                            <srv.icon size={18} strokeWidth={2.5} />
                        </div>
                        <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">
                            {srv.label}
                        </h4>
                    </div>

                    {/* CAMPOS: Apilados verticalmente */}
                    <div className="flex flex-col gap-5 flex-1">
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Proveedor</label>
                            <LazyInput 
                                placeholder={srv.placeholder} 
                                value={services[srv.id]?.provider || ""} 
                                onChange={(val) => updateServiceField(srv.id, 'provider', val)} 
                                className={`!bg-white shadow-sm h-[42px] text-[13px] border-slate-200/80 ${inputHoverClass}`} 
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">{srv.accountLabel}</label>
                            <LazyInput 
                                value={services[srv.id]?.account || ""} 
                                onChange={(val) => updateServiceField(srv.id, 'account', val)} 
                                className={`!bg-white shadow-sm h-[42px] text-[13px] font-mono border-slate-200/80 ${inputHoverClass}`} 
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">Día de Pago (1-31)</label>
                            <LazyInput 
                                type="number" 
                                placeholder="Ej: 15" 
                                value={services[srv.id]?.dueDay || ""} 
                                onChange={(val) => updateServiceField(srv.id, 'dueDay', clampInt(val, 1, 31))} 
                                className={`!bg-white shadow-sm h-[42px] text-[13px] border-slate-200/80 ${inputHoverClass}`} 
                            />
                        </div>
                        
                        {/* 🚨 FIX: LiquidDatePicker con mode="month" */}
                        <div className="relative focus-within:z-50">
                            <label className="text-[10px] font-black uppercase tracking-widest text-emerald-600 ml-1 mb-2 flex items-center gap-1.5">
                                <CalendarDays size={12} strokeWidth={2.5}/> Último Mes Pagado
                            </label>
                            <div className="bg-emerald-50/50 rounded-[1rem] border border-emerald-200 shadow-sm flex items-center h-[42px] px-1 relative transition-[box-shadow,border-color] duration-300 hover:shadow-md hover:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-400/20">
                                <LiquidDatePicker
                                    mode="month" 
                                    value={services[srv.id]?.paidThrough || ""} 
                                    onChange={(val) => updateServiceField(srv.id, 'paidThrough', val)} 
                                    placeholder="Seleccionar Mes"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default React.memo(BranchTabServicios);