import React, { useMemo } from 'react';
import AvatarConEstado from '../common/AvatarConEstado';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { Users, Shield, Star, Stethoscope, Briefcase, AlertCircle, Building2, Globe } from 'lucide-react';
import OjoDeTarjeta from '../common/OjoDeTarjeta';
import { clickable } from '@nucleo/utils/clickable';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { idsDeEnfermeria } from '@nucleo/utils/edicionDeSucursal';
import { SIN_ASIGNAR } from '../common/catalogos/constantes';

const safeParse = (obj) => {
    if (typeof obj === 'object' && obj !== null) return obj;
    try { return JSON.parse(obj) || {}; } catch { return {}; }
};

const EMPTY_EMPLOYEES = [];

// 2026-10-29: la tarjeta mostraba «Ingreso: hace N años» y «En sucursal: hace
// N meses» con fechas de MUESTRA (`2023-08-15`, `2024-01-20`) cuando la ficha
// no las tenía — un dato inventado con la misma cara que uno real; «En
// sucursal» no existe en ninguna ficha, así que era SIEMPRE inventado. Se
// quitaron las dos: la antigüedad real ya la pinta el listón del avatar.

const Encabezado = ({ icon: Icon, children }) => (
    <h3 className="flex items-center gap-2 mb-3 text-caption font-black uppercase tracking-widest text-content-3">
        <Icon size={14} strokeWidth={2.5} aria-hidden="true" /> {children}
    </h3>
);

// Un puesto con persona abre su ficha; uno vacío no abre nada y se dibuja
// punteado (`data-tono="dashed"`, §5.1) — la tarjeta que invita a llenarla.
const Puesto = ({ slot, onAbrir, grande = false }) => {
    const emp = slot.employee;
    const Icon = slot.icon;
    if (!emp) {
        return (
            <div data-surface="card" data-tono="dashed" className={`flex items-center gap-3 ${grande ? 'p-4' : 'p-3'}`}>
                <span aria-hidden="true" className={`shrink-0 rounded-xl flex items-center justify-center bg-danger/10 text-danger-text ${grande ? 'w-12 h-12' : 'w-9 h-9'}`}>
                    <Icon size={grande ? 20 : 14} strokeWidth={2.5} />
                </span>
                <div className="min-w-0">
                    <p className="text-body-sm font-bold text-content-2 leading-tight">{slot.roleName}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-micro font-black uppercase tracking-widest text-danger-text">
                        <AlertCircle size={10} strokeWidth={3} aria-hidden="true" /> {slot.required ? 'Falta asignar' : SIN_ASIGNAR}
                    </p>
                </div>
            </div>
        );
    }
    return (
        <div data-surface="card" {...clickable(() => onAbrir(emp), { label: `Ver la ficha de ${shortEmployeeName(emp)}` })}
            className={`relative flex items-center gap-3 cursor-pointer ${grande ? 'p-4' : 'p-3'}`}>
            <AvatarConEstado emp={emp} px={grande ? 48 : 36} radio={grande ? 'rounded-2xl' : 'rounded-lg'} />
            <div className="flex-1 min-w-0">
                <p className={`font-black text-content truncate leading-tight ${grande ? 'text-body' : 'text-body-sm'}`}>{shortEmployeeName(emp)}</p>
                <p className="mt-0.5 text-micro font-black uppercase tracking-widest text-content-3 truncate">{slot.roleName}</p>
            </div>
            <OjoDeTarjeta size={grande ? undefined : 13} className="self-start" />
        </div>
    );
};

const FormBranchEmployees = ({ formData, onClose, setView, setActiveEmployee }) => {
    const employees = useStaff(state => state.employees) || EMPTY_EMPLOYEES;
    const branchId = String(formData?.id);

    const { plantSlots, opSlots } = useMemo(() => {
        const settings = safeParse(formData?.settings);
        const legal = settings.legal || {};
        const hasInjections = legal.injections === true;
        let jefe = null, subJefe = null;
        const regenteFarmacia = employees.find(e => e.id === legal.regentEmployeeId) || null;
        const referenteFarma = employees.find(e => e.id === legal.pharmacovigilanceEmployeeId) || null;
        const idsEnfermeria = idsDeEnfermeria(legal).map(String);
        const enfermeros = employees.filter(e => idsEnfermeria.includes(String(e.id)));
        const dependientes = [], globals = [];

        employees.forEach(e => {
            const roleUp = (e.role || '').toUpperCase();
            const isBranchDirect = String(e.branchId) === branchId || String(e.branch_id) === branchId;

            if (roleUp.includes('GERENTE') || roleUp.includes('ADMIN') || roleUp.includes('SUPERVISOR')) {
                globals.push(e);
            } else if (isBranchDirect) {
                if (roleUp.includes('JEFE') && !roleUp.includes('SUB')) jefe = e;
                else if (roleUp.includes('SUB JEFE') || roleUp.includes('SUBJEFE')) subJefe = e;
                else if (e.id !== legal.regentEmployeeId && e.id !== legal.pharmacovigilanceEmployeeId && !enfermeros.find(enf => enf.id === e.id)) {
                    dependientes.push(e);
                }
            }
        });

        const oSlots = globals.map(g => {
            const roleUp = (g.role || '').toUpperCase();
            const icon = roleUp.includes('GERENTE') ? Star : roleUp.includes('ADMIN') ? Shield : Briefcase;
            return { id: `glob-${g.id}`, roleName: g.role, employee: g, required: false, icon };
        });
        oSlots.push({ id: 'regente', roleName: 'Regente farmacéutico', employee: regenteFarmacia, required: true, icon: Briefcase });
        oSlots.push({ id: 'referente', roleName: 'Referente de farmacovigilancia', employee: referenteFarma, required: true, icon: Shield });

        const pSlots = [
            { id: 'jefe', roleName: 'Jefe de sucursal', employee: jefe, required: true, icon: Star },
            { id: 'subjefe', roleName: 'Subjefe de sucursal', employee: subJefe, required: true, icon: Shield },
        ];

        if (hasInjections || enfermeros.length > 0) {
            if (enfermeros.length === 0) pSlots.push({ id: 'enf-empty', roleName: 'Regente de enfermería', employee: null, required: true, icon: Stethoscope });
            else enfermeros.forEach((enf, i) => pSlots.push({ id: `enf-${i}`, roleName: 'Regente de enfermería', employee: enf, required: true, icon: Stethoscope }));
        }

        if (dependientes.length === 0) pSlots.push({ id: 'dep-empty', roleName: 'Dependientes', employee: null, required: true, icon: Users });
        else dependientes.forEach((dep, i) => pSlots.push({ id: `dep-${i}`, roleName: dep.role || 'Dependiente', employee: dep, required: false, icon: Users }));

        return { plantSlots: pSlots, opSlots: oSlots };
    }, [employees, branchId, formData]);

    const abrirFicha = (emp) => {
        if (!emp) return;
        if (setActiveEmployee) setActiveEmployee(emp);
        if (setView) setView('empleados');
        if (onClose) onClose();
    };

    return (
        <div className="w-full flex flex-col gap-6 pb-2">
            <section>
                <Encabezado icon={Building2}>Personal de planta</Encabezado>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {plantSlots.map(slot => <Puesto key={slot.id} slot={slot} onAbrir={abrirFicha} grande />)}
                </div>
            </section>

            <section className="pt-5 border-t border-divider">
                <Encabezado icon={Globe}>Soporte de la red</Encabezado>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {opSlots.map(slot => <Puesto key={slot.id} slot={slot} onAbrir={abrirFicha} />)}
                </div>
            </section>
        </div>
    );
};

export default React.memo(FormBranchEmployees);
