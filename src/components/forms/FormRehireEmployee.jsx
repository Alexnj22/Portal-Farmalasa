import React from 'react';
import Badge from '../common/Badge';
import { Building2, ShieldCheck, Briefcase, Clock, DollarSign } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidAvatar from '../common/LiquidAvatar';
import PortalTextarea from '../common/PortalTextarea';
import PortalInput from '../common/PortalInput';
import { shortEmployeeName } from '../../utils/nameUtils';

const CONTRACT_TYPE_OPTIONS = [
    { value: 'INDEFINIDO',   label: 'Indefinido (Fijo)' },
    { value: 'TEMPORAL',     label: 'Temporal / plazo fijo' },
    { value: 'MEDIO_TIEMPO', label: 'Medio tiempo (part-time)' },
    { value: 'SERVICIOS',    label: 'Servicios profesionales' },
];

const TYPE_ORDER = ['FARMACIA', 'BODEGA', 'ADMINISTRATIVA', 'EXTERNA'];
const AREA_LABEL  = { FARMACIA: 'Farmacias', BODEGA: 'Bodega', ADMINISTRATIVA: 'Administración', EXTERNA: 'Personal Externo' };

const portalProps = {
    menuPortalTarget: typeof document !== 'undefined' ? document.body : null,
    menuPosition: 'fixed',
    styles: { menuPortal: base => ({ ...base, zIndex: 99999 }) },
};

const inputHover = 'transition-all duration-[var(--dur-slow)] hover:shadow-md hover:border-brand/40 focus-within:ring-4 focus-within:ring-brand/10 focus-within:border-brand/50';
const island    = 'bg-surface-card rounded-3xl p-4 md:p-5 border border-border-card shadow-[var(--shadow-glass-3)]';
const reqBadge  = <Badge variant="danger" size="sm" uppercase={false}>Requerido</Badge>;

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
                <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-border-card shadow-md shrink-0 bg-surface-card-hover flex items-center justify-center">
                    <LiquidAvatar src={formData.photo || formData.photo_url} alt={formData.name} fallbackText={shortEmployeeName(formData)} className="w-full h-full" />
                </div>
                <div className="min-w-0">
                    <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-0.5">Recontratando a</p>
                    <p className="font-black text-content text-body-xl leading-tight truncate">{formData.name}</p>
                    <p className="text-label text-content-3 font-medium mt-0.5">
                        {/* El código de carné ya no se muestra: es la contraseña con la
                            que se entra al portal, y esta tarjeta es sólo para reconocer a
                            quién se está recontratando. Se ve y se edita en Personal, con
                            el permiso que corresponde. */}
                        Última salida: <span className="font-black text-content-2">{lastExit}</span>
                    </p>
                </div>
            </div>

            {/* NUEVO CONTRATO */}
            <div className={island}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {/* Fecha de ingreso */}
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                            Nueva Fecha de Ingreso {reqBadge}
                        </label>
                        <div className={`bg-surface-card rounded-2xl border shadow-sm flex items-center h-[40px] px-1.5 ${inputHover} ${!formData.rehire_hire_date ? 'border-danger bg-danger/10' : 'border-divider'}`}>
                            <LiquidDatePicker value={formData.rehire_hire_date || ''} onChange={v => set('rehire_hire_date', v)} />
                        </div>
                    </div>

                    {/* Tipo de contrato */}
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Tipo de contrato</label>
                        <LiquidSelect value={formData.rehire_contract_type || 'INDEFINIDO'} onChange={handleContractChange}
                            options={CONTRACT_TYPE_OPTIONS} clearable={false} icon={Briefcase} {...portalProps} />
                    </div>

                    {/* Sucursal */}
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                            Sucursal {reqBadge}
                        </label>
                        <LiquidSelect invalid={!formData.rehire_branch_id} value={formData.rehire_branch_id || ''} onChange={v => set('rehire_branch_id', v)}
                            options={branchOpts} placeholder="Seleccionar..." clearable={false} icon={Building2} {...portalProps} />
                    </div>

                    {/* Cargo principal */}
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between">
                            Cargo Principal {reqBadge}
                        </label>
                        <LiquidSelect invalid={!formData.rehire_role_id} value={formData.rehire_role_id || ''} onChange={v => set('rehire_role_id', v)}
                            options={roleOpts} placeholder="Cargo..." clearable={false} icon={ShieldCheck} {...portalProps} />
                    </div>

                    {/* Cargo secundario */}
                    <div>
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Cargo Secundario (Apoyo)</label>
                        <LiquidSelect value={formData.rehire_secondary_role_id || ''} onChange={v => set('rehire_secondary_role_id', v)}
                            options={roleOpts} placeholder="Opcional..." clearable icon={ShieldCheck} {...portalProps} />
                    </div>

                    {/* Horas semanales */}
                    <PortalInput
                        label="Horas semanales" name="rehire-horas" icon={Clock}
                        type="number"
                        value={formData.rehire_weekly_hours || '44'}
                        onChange={e => set('rehire_weekly_hours', e.target.value)}
                    />

                    {/* Salario base */}
                    <PortalInput
                        label="Salario Base" name="rehire-salario" prefix="$"
                        inputMode="decimal" maskType="DECIMAL" placeholder="0.00"
                        value={formData.rehire_base_salary || ''}
                        onChange={e => set('rehire_base_salary', e.target.value)}
                    />

                    {/* Motivo */}
                    <div className="md:col-span-2">
                        <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Motivo / Notas</label>
                        <PortalTextarea value={formData.rehire_notes || ''} onChange={e => set('rehire_notes', e.target.value)}
                            rows={2}
                            placeholder="Ej. Regresa tras cierre de proyecto externo, aplica para período de prueba..." />
                    </div>

                </div>
            </div>
        </div>
    );
};

export default FormRehireEmployee;
