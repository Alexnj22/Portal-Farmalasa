import React, { useState, useEffect, useMemo } from 'react';
import { ClipboardCheck, X, Check, Loader2, Building2, FlaskConical, ShieldAlert, ListChecks, Search } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import { inputHoverClass } from '../../utils/inputStyles';
import { supabase } from '../../supabaseClient';
import { useStaffStore } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';

const SCOPE_OPTIONS = [
    { value: 'TOTAL', label: 'Todo el inventario', icon: ListChecks },
    { value: 'LABORATORIO', label: 'Por laboratorio', icon: FlaskConical },
    { value: 'BAJO_RECETA', label: 'Solo Bajo Receta (antibióticos)', icon: ShieldAlert },
    { value: 'MANUAL', label: 'Selección manual de productos', icon: Search },
];

const islandClass = "bg-white/60 rounded-[1.5rem] p-4 md:p-5 border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]";
const fieldLabel = "text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between";
const reqBadge = <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>;

const AREA_TYPE_LABEL = { FARMACIA: 'Farmacias', BODEGA: 'Bodega', ADMINISTRATIVA: 'Administración', EXTERNA: 'Personal Externo' };
const TYPE_ORDER = ['FARMACIA', 'BODEGA', 'ADMINISTRATIVA', 'EXTERNA'];
const buildBranchOpts = (branches) => TYPE_ORDER.flatMap((type) => {
    const group = (branches || []).filter((b) => (b.type || 'FARMACIA') === type);
    if (!group.length) return [];
    return [
        { value: `__header_${type}`, label: AREA_TYPE_LABEL[type], isSeparator: true },
        ...group.map((b) => ({ value: String(b.id), label: b.name })),
    ];
});

export default function NuevoConteoModal({ isOpen, onClose, onCreated }) {
    const { showToast } = useToastStore();
    const { user, hasPermission, getScope } = useAuth();
    const branches = useStaffStore((s) => s.branches);
    const crearConteoInventario = useStaffStore((s) => s.crearConteoInventario);

    const isBranchScoped = getScope('conteo_inventario') === 'BRANCH';

    const [branchId, setBranchId] = useState('');
    const [scopeType, setScopeType] = useState('TOTAL');
    const [laboratorioId, setLaboratorioId] = useState('');
    const [laboratorios, setLaboratorios] = useState([]);
    const [manualResults, setManualResults] = useState([]);
    const [manualSelected, setManualSelected] = useState([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setBranchId(isBranchScoped ? String(user?.branchId || '') : '');
        setScopeType('TOTAL');
        setLaboratorioId('');
        setManualResults([]);
        setManualSelected([]);
    }, [isOpen, isBranchScoped, user?.branchId]);

    useEffect(() => {
        if (!isOpen || scopeType !== 'LABORATORIO') return;
        supabase.from('laboratorios').select('id, nombre').order('nombre').then(({ data, error }) => {
            if (error) console.error('NuevoConteoModal: fetch laboratorios failed:', error.message);
            setLaboratorios(data || []);
        });
    }, [isOpen, scopeType]);

    const branchOpts = useMemo(() => buildBranchOpts(branches), [branches]);
    const laboratorioOpts = laboratorios.map((l) => ({ value: String(l.id), label: l.nombre }));

    const handleManualSearch = async (q) => {
        if (!q || q.trim().length < 2) { setManualResults([]); return; }
        const { data, error } = await supabase.from('products').select('id, nombre, laboratorios(nombre)').eq('activo', true).ilike('nombre', `%${q.trim()}%`).order('nombre').limit(30);
        if (error) console.error('NuevoConteoModal: search products failed:', error.message);
        setManualResults((data || []).filter((p) => !manualSelected.some((s) => s.id === p.id)));
    };

    const canEdit = hasPermission('conteo_inventario', 'can_edit');
    const institucionMissing = scopeType === 'LABORATORIO' && !laboratorioId;
    const manualMissing = scopeType === 'MANUAL' && manualSelected.length === 0;
    const isValid = branchId && scopeType && !institucionMissing && !manualMissing;

    const handleCreate = async () => {
        if (!isValid) return;
        setSaving(true);
        try {
            const conteoId = await crearConteoInventario({
                branchId: parseInt(branchId, 10),
                scopeType,
                scopeFilter: scopeType === 'LABORATORIO' ? { laboratorio_id: parseInt(laboratorioId, 10) } : null,
                erpProductIds: scopeType === 'MANUAL' ? manualSelected.map((p) => p.id) : null,
            });
            showToast('Conteo iniciado', 'Se generó el snapshot de inventario', 'success');
            onCreated?.(conteoId);
            onClose();
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;
    const squircleClass = "w-12 h-12 flex items-center justify-center rounded-[1.25rem] shrink-0 border border-white/80 shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-white/70 backdrop-blur-md";

    return (
        <LiquidModal open={isOpen} onClose={onClose} maxWidth="max-w-2xl" className="max-h-[90vh] h-fit" ariaLabel="Nuevo Conteo de Inventario">
            <div className="flex-none bg-transparent px-6 md:px-10 py-6 border-b border-white/40 flex items-center justify-between relative z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <div className={`${squircleClass} text-teal-600`}><ClipboardCheck size={22} strokeWidth={2.5} /></div>
                    <div>
                        <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg md:text-xl leading-none mb-1">Nuevo Conteo de Inventario</h3>
                        <p className="text-[10px] md:text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Auditoría Física</p>
                    </div>
                </div>
                <button type="button" onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/60 border border-white/90 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all shadow-sm active:scale-[0.97] shrink-0 hover:scale-105">
                    <X size={18} strokeWidth={2.5} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide relative z-10 w-full">
                <div className="flex flex-col min-h-full w-full px-6 md:px-10 py-6 gap-4">
                    <div className={islandClass}>
                        <label className={fieldLabel}><span>Sucursal</span>{!branchId && reqBadge}</label>
                        <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${!branchId ? '!border-red-400 !bg-red-50/50' : ''}`}>
                            <LiquidSelect value={branchId} onChange={setBranchId} options={branchOpts} placeholder="Seleccionar sucursal..." icon={Building2} clearable={false} disabled={isBranchScoped} />
                        </div>

                        <label className={`${fieldLabel} mt-4`}>Alcance del conteo</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {SCOPE_OPTIONS.map((opt) => {
                                const Icon = opt.icon;
                                const active = scopeType === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setScopeType(opt.value)}
                                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] font-bold text-left transition-all ${active ? 'bg-teal-600 border-teal-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-teal-300'}`}
                                    >
                                        <Icon size={14} className="shrink-0" /> {opt.label}
                                    </button>
                                );
                            })}
                        </div>

                        {scopeType === 'LABORATORIO' && (
                            <div className="mt-4">
                                <label className={fieldLabel}><span>Laboratorio</span>{institucionMissing && reqBadge}</label>
                                <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${institucionMissing ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                    <LiquidSelect value={laboratorioId} onChange={setLaboratorioId} options={laboratorioOpts} placeholder="Seleccionar laboratorio..." icon={FlaskConical} clearable={false} />
                                </div>
                            </div>
                        )}

                        {scopeType === 'MANUAL' && (
                            <div className="mt-4">
                                <label className={fieldLabel}><span>Productos a incluir</span>{manualMissing && reqBadge}</label>
                                <LiquidSelect value={null} onChange={(val) => {
                                    const found = manualResults.find((p) => String(p.id) === val);
                                    if (found) { setManualSelected((prev) => [...prev, found]); setManualResults((prev) => prev.filter((p) => p.id !== found.id)); }
                                }} options={manualResults.map((p) => ({ value: String(p.id), label: `${p.nombre}${p.laboratorios?.nombre ? ` · ${p.laboratorios.nombre}` : ''}` }))} placeholder="Buscar producto..." serverSearch onSearchChange={handleManualSearch} icon={Search} />
                                {manualSelected.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {manualSelected.map((p) => (
                                            <span key={p.id} className="flex items-center gap-1 text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 px-2 py-1 rounded-full">
                                                {p.nombre}
                                                <button type="button" onClick={() => setManualSelected((prev) => prev.filter((x) => x.id !== p.id))} className="hover:text-red-500"><X size={10} /></button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-none px-6 md:px-10 py-5 bg-transparent border-t border-white/40 flex justify-between items-center relative z-10 shrink-0">
                <button type="button" onClick={onClose} disabled={saving} className="px-6 py-3 h-12 rounded-full bg-white/50 border border-white/80 text-slate-500 font-bold text-[11px] uppercase tracking-widest hover:bg-white hover:text-slate-800 transition-colors disabled:opacity-50">
                    Cancelar
                </button>
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={saving || !isValid || !canEdit}
                    className={`px-8 py-3 h-12 font-black text-[11px] uppercase tracking-[0.2em] rounded-full flex items-center gap-2 transition-all duration-300 ${(!isValid || !canEdit) && !saving ? 'bg-slate-300 text-white shadow-none cursor-not-allowed' : 'bg-teal-600 text-white shadow-[0_8px_20px_rgba(13,148,136,0.3)] hover:bg-teal-700 hover:-translate-y-0.5 active:scale-[0.97]'}`}
                >
                    {saving ? <><Loader2 size={16} className="animate-spin" /> Generando snapshot...</> : <><Check size={16} strokeWidth={3} /> Iniciar Conteo</>}
                </button>
            </div>
        </LiquidModal>
    );
}
