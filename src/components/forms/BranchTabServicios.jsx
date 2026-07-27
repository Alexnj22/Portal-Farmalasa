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
    const islandClass = "bg-surface-card rounded-[2rem] p-6 border border-border-card shadow-[var(--shadow-elevation-xs)]";
    const islandHoverClass = "transition-[transform,box-shadow,background-color,border-color] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[var(--shadow-elevation-sm)] hover:bg-surface-card hover:border-white";
    const inputHoverClass = "transition-[box-shadow,border-color] duration-300 hover:shadow-md hover:border-brand/30 focus-within:ring-4 focus-within:ring-brand/10";

    const servicesList = [
        { id: 'light', icon: Zap, label: 'Energía Eléctrica', placeholder: 'Ej. CAESS', accountLabel: 'Nº de NIC / NPE', color: 'text-warning', bgIcon: 'bg-warning/10' },
        { id: 'water', icon: Droplet, label: 'Agua Potable', placeholder: 'Ej. ANDA', accountLabel: 'Nº de Cuenta', color: 'text-chart-5-text', bgIcon: 'bg-chart-5/10' },
        { id: 'internet', icon: Wifi, label: 'Internet Fijo', placeholder: 'Ej. Tigo / Claro', accountLabel: 'Nº de Contrato / Teléfono', color: 'text-brand-text', bgIcon: 'bg-chart-1/10' },
        { id: 'mobile', icon: Smartphone, label: 'Telefonía Móvil (Flota)', placeholder: 'Ej. Claro', accountLabel: 'Nº de Teléfono', color: 'text-chart-3-text', bgIcon: 'bg-chart-3/10' },
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
                        <h4 className="text-body-sm font-black uppercase tracking-widest text-content">
                            {srv.label}
                        </h4>
                    </div>

                    {/* CAMPOS: Apilados verticalmente */}
                    <div className="flex flex-col gap-5 flex-1">
                        <div>
                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-2 block">Proveedor</label>
                            <LazyInput 
                                placeholder={srv.placeholder} 
                                value={services[srv.id]?.provider || ""} 
                                onChange={(val) => updateServiceField(srv.id, 'provider', val)} 
                                className={`!bg-surface-card shadow-sm h-[42px] text-body border-divider ${inputHoverClass}`} 
                            />
                        </div>
                        <div>
                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-2 block">{srv.accountLabel}</label>
                            <LazyInput 
                                value={services[srv.id]?.account || ""} 
                                onChange={(val) => updateServiceField(srv.id, 'account', val)} 
                                className={`!bg-surface-card shadow-sm h-[42px] text-body font-mono border-divider ${inputHoverClass}`} 
                            />
                        </div>
                        <div>
                            <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-2 block">Día de Pago (1-31)</label>
                            <LazyInput 
                                type="number" 
                                placeholder="Ej: 15" 
                                value={services[srv.id]?.dueDay || ""} 
                                onChange={(val) => updateServiceField(srv.id, 'dueDay', clampInt(val, 1, 31))} 
                                className={`!bg-surface-card shadow-sm h-[42px] text-body border-divider ${inputHoverClass}`} 
                            />
                        </div>
                        
                        {/* 🚨 FIX: LiquidDatePicker con mode="month" */}
                        <div className="relative focus-within:z-sidebar">
                            <label className="text-caption font-black uppercase tracking-widest text-success ml-1 mb-2 flex items-center gap-1.5">
                                <CalendarDays size={12} strokeWidth={2.5}/> Último Mes Pagado
                            </label>
                            <div className="bg-success/10 rounded-[1rem] border border-success/30 shadow-sm flex items-center h-[42px] px-1 relative transition-[box-shadow,border-color] duration-300 hover:shadow-md hover:border-success focus-within:ring-4 focus-within:ring-success/20">
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