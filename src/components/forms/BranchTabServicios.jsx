import React from 'react';
import { Zap, Droplet, Wifi, Smartphone } from 'lucide-react';
import { LazyInput, clampInt } from './BranchHelpers';

const BranchTabServicios = ({ services, updateServiceField }) => {
    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
            {[
                { id: 'light', icon: Zap, label: 'Energía Eléctrica', placeholder: 'Ej. CLESA', accountLabel: 'Nº de NIC / NPE' },
                { id: 'water', icon: Droplet, label: 'Agua Potable', placeholder: 'Ej. ANDA', accountLabel: 'Nº de Cuenta' },
                { id: 'internet', icon: Wifi, label: 'Internet Fijo', placeholder: 'Ej. Tigo / Claro', accountLabel: 'Nº de Contrato' },
                { id: 'mobile', icon: Smartphone, label: 'Telefonía Móvil (Flota)', placeholder: 'Ej. Movistar', accountLabel: 'Nº de Teléfono Asociado' },
            ].map((srv) => (
                <div key={srv.id} className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-200">
                    <h4 className={`text-[12px] font-black uppercase tracking-widest text-slate-800 mb-6 flex items-center gap-2 border-b border-slate-200 pb-3 text-slate-800`}>
                        <srv.icon size={16} /> {srv.label}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
                        <div className="md:col-span-2">
                            <label className="text-[9px] font-black uppercase text-slate-500 ml-1 mb-2 block">Proveedor</label>
                            <LazyInput placeholder={srv.placeholder} value={services[srv.id]?.provider || ""} onChange={(val) => updateServiceField(srv.id, 'provider', val)} className={`w-full py-2.5 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] font-bold text-sm`} />
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-[9px] font-black uppercase text-slate-500 ml-1 mb-2 block">{srv.accountLabel}</label>
                            <LazyInput value={services[srv.id]?.account || ""} onChange={(val) => updateServiceField(srv.id, 'account', val)} className={`w-full py-2.5 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] font-bold font-mono text-slate-600 text-sm`} />
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-[9px] font-black uppercase text-slate-500 ml-1 mb-2 block">Día de Pago (1-31)</label>
                            <LazyInput type="number" min="1" max="31" placeholder="Ej: 15" value={services[srv.id]?.dueDay || ""} onChange={(val) => updateServiceField(srv.id, 'dueDay', clampInt(val, 1, 31))} className={`w-full py-2.5 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] font-bold text-sm`} />
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-[9px] font-black uppercase text-emerald-600 ml-1 mb-2 block">Último Mes Pagado</label>
                            <LazyInput type="month" value={services[srv.id]?.paidThrough || ""} onChange={(val) => updateServiceField(srv.id, 'paidThrough', val)} className={`w-full py-2.5 rounded-[1rem] bg-white border border-emerald-200 outline-none focus:border-emerald-500 font-bold text-emerald-700 text-sm`} />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default BranchTabServicios;