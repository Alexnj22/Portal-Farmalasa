import React from 'react';
import { Building2, ShieldCheck, Briefcase, Clock, DollarSign } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidAvatar from '../common/LiquidAvatar';

const CONTRACT_TYPE_OPTIONS = [
    { value: 'INDEFINIDO',   label: 'Indefinido (Fijo)' },
    { value: 'TEMPORAL',     label: 'Temporal / Plazo Fijo' },
    { value: 'MEDIO_TIEMPO', label: 'Medio Tiempo (Part-Time)' },
    { value: 'SERVICIOS',    label: 'Servicios Profesionales' },
];

const TYPE_ORDER = ['FARMACIA', 'BODEGA', 'ADMINISTRATIVA', 'EXTERNA'];
const AREA_LABEL  = { FARMACIA: 'Farmacias', BODEGA: 'Bodega', ADMINISTRATIVA: 'Administración', EXTERNA: 'Personal Externo' };

const portalProps = {
    menuPortalTarget: typeof document !== 'undefined' ? document.body : null,
    menuPosition: 'fixed',
    styles: { menuPortal: base => ({ ...base, zIndex: 99999 }) },
};

const inputHover = 'transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus-within:ring-4 focus-within:ring-[#007AFF]/10 focus-within:border-[#007AFF]/50';
const island    = 'bg-white/60 rounded-[1.5rem] p-4 md:p-5 border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]';
const reqBadge  = <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200 text-[8px]">Requerido</span>;

const FormRehireEmployee = ({ formData, setFormData, branches, roles }) => {
    const set = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));

    const branchOpts = TYPE_ORDER.flatMap(type => {
        const group = (branches || []).filter(b => (b.type || 'FARMACIA') === type);
        if (!group.length) return [];
        return [
            { value: `__header_${type}`, label: AREA_LABEL[type], isSeparator: true },
            ...group.map(b => ({ value: String(b.id), label: b.name })),
        ];
    });

    const roleOpts = (roles || []).map(r => ({ value: String(r.id), label: r.name }));

    const lastExit = formData.contract_end_date
        ? new Date(formData.contract_end_date + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })
        : 'No registrada';

    const handleContractChange = (v) => {
        set('rehire_contract_type', v);
        if (v === 'MEDIO_TIEMPO') set('rehire_weekly_hours', '22');
        else if (formData.rehire_weekly_hours === '22') set('rehire_weekly_hours', '44');
    };

    return (
        <div className="flex flex-col gap-4 w-full">

            {/* TARJETA EMPLEADO */}
            <div className={`${island} flex items-center gap-4`}>
                <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-white shadow-md shrink-0 bg-slate-100 flex items-center justify-center">
                    <LiquidAvatar src={formData.photo_url || formData.photo} alt={formData.name} fallbackText={formData.name} className="w-full h-full" />
                </div>
                <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Recontratando a</p>
                    <p className="font-black text-slate-800 text-[16px] leading-tight truncate">{formData.name}</p>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                        Código <span className="font-black text-slate-700">{formData.code}</span>
                        {' · '}Última salida: <span className="font-black text-slate-700">{lastExit}</span>
                    </p>
                </div>
            </div>

            {/* NUEVO CONTRATO */}
            <div className={island}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {/* Fecha de ingreso */}
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                            Nueva Fecha de Ingreso {reqBadge}
                        </label>
                        <div className={`bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] px-1.5 ${inputHover} ${!formData.rehire_hire_date ? 'border-red-400 bg-red-50/50' : 'border-slate-200/80'}`}>
                            <LiquidDatePicker value={formData.rehire_hire_date || ''} onChange={v => set('rehire_hire_date', v)} placeholder="DD / MM / AAAA" />
                        </div>
                    </div>

                    {/* Tipo de contrato */}
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Tipo de Contrato</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHover}`}>
                            <LiquidSelect value={formData.rehire_contract_type || 'INDEFINIDO'} onChange={handleContractChange}
                                options={CONTRACT_TYPE_OPTIONS} clearable={false} icon={Briefcase} {...portalProps} />
                        </div>
                    </div>

                    {/* Sucursal */}
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                            Sucursal {reqBadge}
                        </label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHover} ${!formData.rehire_branch_id ? 'border border-red-400 bg-red-50/50 rounded-[1rem]' : ''}`}>
                            <LiquidSelect value={formData.rehire_branch_id || ''} onChange={v => set('rehire_branch_id', v)}
                                options={branchOpts} placeholder="Seleccionar..." clearable={false} icon={Building2} {...portalProps} />
                        </div>
                    </div>

                    {/* Cargo principal */}
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between">
                            Cargo Principal {reqBadge}
                        </label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHover} ${!formData.rehire_role_id ? 'border border-red-400 bg-red-50/50 rounded-[1rem]' : ''}`}>
                            <LiquidSelect value={formData.rehire_role_id || ''} onChange={v => set('rehire_role_id', v)}
                                options={roleOpts} placeholder="Cargo..." clearable={false} icon={ShieldCheck} {...portalProps} />
                        </div>
                    </div>

                    {/* Cargo secundario */}
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Cargo Secundario (Apoyo)</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHover}`}>
                            <LiquidSelect value={formData.rehire_secondary_role_id || ''} onChange={v => set('rehire_secondary_role_id', v)}
                                options={roleOpts} placeholder="Opcional..." clearable icon={ShieldCheck} {...portalProps} />
                        </div>
                    </div>

                    {/* Horas semanales */}
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Horas Semanales</label>
                        <div className={`relative bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] ${inputHover}`}>
                            <div className="absolute left-3 text-slate-400"><Clock size={14} strokeWidth={2.5} /></div>
                            <input type="number" value={formData.rehire_weekly_hours || '44'} onChange={e => set('rehire_weekly_hours', e.target.value)}
                                className="w-full h-full bg-transparent text-[13px] font-bold text-slate-700 outline-none pl-9 pr-4" />
                        </div>
                    </div>

                    {/* Salario base */}
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Salario Base</label>
                        <div className={`relative bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] ${inputHover}`}>
                            <div className="absolute left-3 text-slate-400 font-black text-[13px]">$</div>
                            <input type="number" value={formData.rehire_base_salary || ''} onChange={e => set('rehire_base_salary', e.target.value)}
                                placeholder="0.00" className="w-full h-full bg-transparent text-[13px] font-bold text-slate-700 outline-none pl-8 pr-4" />
                        </div>
                    </div>

                    {/* Motivo */}
                    <div className="md:col-span-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Motivo / Notas</label>
                        <textarea value={formData.rehire_notes || ''} onChange={e => set('rehire_notes', e.target.value)}
                            rows={2}
                            placeholder="Ej. Regresa tras cierre de proyecto externo, aplica para período de prueba..."
                            className={`w-full bg-white rounded-[1rem] border border-slate-200/80 shadow-sm text-[12px] font-medium text-slate-700 outline-none px-4 py-2.5 resize-none ${inputHover}`} />
                    </div>

                </div>
            </div>
        </div>
    );
};

export default FormRehireEmployee;
