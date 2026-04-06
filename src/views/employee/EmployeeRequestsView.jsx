import React, { useState, useCallback, useEffect } from 'react';
import { ClipboardList, Plus, Loader2, Check, X, Palmtree, FileText, RefreshCw, Coffee, DollarSign, FileCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';
import { REQUEST_TYPES, REQUEST_STATUS } from '../../store/slices/requestsSlice';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';

const EmployeeRequestsView = () => {
    const { user } = useAuth();
    const { createRequest, cancelRequest, holidays } = useStaffStore();

    const [requests, setRequests]         = useState([]);
    const [isLoading, setIsLoading]       = useState(false);
    const [showForm, setShowForm]         = useState(false);
    const [formType, setFormType]         = useState('VACATION');
    const [formNote, setFormNote]         = useState('');
    const [payload, setPayload]           = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const load = useCallback(async () => {
        if (!user?.id) return;
        setIsLoading(true);
        const { data } = await supabase
            .from('approval_requests')
            .select('id, type, status, note, approver_note, created_at')
            .eq('employee_id', user.id)
            .order('created_at', { ascending: false });
        setRequests(data || []);
        setIsLoading(false);
    }, [user?.id]);

    useEffect(() => { load(); }, [load]);

    const handleSubmit = async () => {
        setIsSubmitting(true);
        const result = await createRequest(user.id, formType, payload, formNote.trim());
        setIsSubmitting(false);
        if (result) {
            useToastStore.getState().showToast('Enviada', `Solicitud de ${REQUEST_TYPES[formType]?.label} registrada.`, 'success');
            setFormNote(''); setPayload({}); setShowForm(false);
            load();
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo crear la solicitud.', 'error');
        }
    };

    const handleCancel = async (id) => {
        await cancelRequest(id);
        load();
    };

    return (
        <div className="px-4 pt-4 pb-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-[18px] font-black text-slate-800 flex items-center gap-2">
                    <ClipboardList size={18} className="text-[#007AFF]" strokeWidth={2.5} />
                    Mis Solicitudes
                </h2>
                <button
                    onClick={() => setShowForm(v => !v)}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-br from-[#007AFF] to-[#005CE6] text-white rounded-full font-black text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] transition-all hover:-translate-y-0.5 active:scale-95"
                >
                    <Plus size={13} strokeWidth={3} /> Nueva
                </button>
            </div>

            {/* Formulario */}
            {showForm && (
                <div className="rounded-[1.75rem] border border-[#007AFF]/20 bg-white/80 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,122,255,0.06)] p-5 space-y-4 animate-in slide-in-from-top-3 duration-300">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Tipo</p>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { key: 'VACATION',    icon: Palmtree },
                                { key: 'PERMIT',      icon: FileText },
                                { key: 'SHIFT_CHANGE',icon: RefreshCw },
                                { key: 'OVERTIME',    icon: Coffee },
                                { key: 'ADVANCE',     icon: DollarSign },
                                { key: 'CERTIFICATE', icon: FileCheck },
                            ].map(({ key, icon: Icon }) => {
                                const conf = REQUEST_TYPES[key];
                                return (
                                    <button key={key} type="button"
                                        onClick={() => { setFormType(key); setPayload({}); }}
                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-bold transition-all ${
                                            formType === key
                                                ? `${conf.color} ${conf.border} shadow-sm`
                                                : 'border-slate-200 text-slate-500 hover:border-slate-300 bg-white'
                                        }`}
                                    >
                                        <Icon size={13} strokeWidth={2} /> {conf.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                            {formType === 'VACATION' ? 'Período de Vacaciones' : formType === 'PERMIT' ? 'Días de Permiso' : 'Fecha'}
                        </p>
                        {formType === 'VACATION' ? (
                            <RangeDatePicker
                                startDate={payload.startDate || ''} endDate={payload.endDate || ''}
                                onRangeChange={(s, e) => setPayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                                holidays={holidays} defaultDays={15} label="vacaciones"
                            />
                        ) : (
                            <LiquidDatePicker
                                value={payload.date || ''}
                                onChange={(v) => setPayload(prev => ({ ...prev, date: v }))}
                                placeholder="Seleccionar fecha" holidays={holidays}
                            />
                        )}
                    </div>

                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                            Motivo / Descripción <span className="text-red-400">*</span>
                        </p>
                        <textarea
                            value={formNote} onChange={e => setFormNote(e.target.value)}
                            rows={3} placeholder="Describe tu solicitud..."
                            className="w-full px-4 py-3 rounded-[1.25rem] border border-slate-200 bg-white text-[13px] text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF]/50 resize-none transition-all"
                        />
                    </div>

                    <div className="flex gap-2 justify-end">
                        <button type="button"
                            onClick={() => { setShowForm(false); setFormNote(''); setPayload({}); }}
                            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-500 text-[12px] font-medium hover:bg-slate-50 transition-all"
                        >
                            Cancelar
                        </button>
                        <button type="button"
                            disabled={!formNote.trim() || isSubmitting}
                            onClick={handleSubmit}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#007AFF] hover:bg-[#0066DD] text-white text-[12px] font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                        >
                            {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.5} />}
                            Enviar
                        </button>
                    </div>
                </div>
            )}

            {/* Lista */}
            {isLoading ? (
                <div className="flex justify-center py-10 text-slate-400 gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-[12px]">Cargando…</span>
                </div>
            ) : requests.length === 0 ? (
                <div className="flex flex-col items-center py-16 gap-2 text-slate-400">
                    <ClipboardList size={36} strokeWidth={1.2} />
                    <p className="text-[13px] font-semibold">Sin solicitudes registradas</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {requests.map(req => {
                        const typeConf = REQUEST_TYPES[req.type]    || { label: req.type,   color: 'bg-slate-100 text-slate-600', border: 'border-slate-200' };
                        const statConf = REQUEST_STATUS[req.status] || { label: req.status, color: 'bg-slate-100 text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' };
                        const TypeIcon = { VACATION: Palmtree, PERMIT: FileText, SHIFT_CHANGE: RefreshCw, OVERTIME: Coffee, ADVANCE: DollarSign, CERTIFICATE: FileCheck }[req.type] || FileText;
                        return (
                            <div key={req.id} className={`flex items-start gap-4 p-4 rounded-[1.5rem] border bg-white/60 backdrop-blur-md ${typeConf.border}`}>
                                <div className={`w-9 h-9 rounded-[1rem] flex items-center justify-center flex-shrink-0 ${typeConf.color}`}>
                                    <TypeIcon size={16} strokeWidth={2} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${typeConf.color} ${typeConf.border}`}>{typeConf.label}</span>
                                        <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${statConf.color} ${statConf.border}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${statConf.dot}`} />{statConf.label}
                                        </span>
                                    </div>
                                    {req.note && <p className="text-[12px] text-slate-600 line-clamp-2">{req.note}</p>}
                                    {req.approver_note && <p className="text-[11px] text-slate-400 mt-1 italic">Nota: {req.approver_note}</p>}
                                    <p className="text-[10px] text-slate-400 mt-1">{new Date(req.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                                </div>
                                {req.status === 'PENDING' && (
                                    <button onClick={() => handleCancel(req.id)}
                                        className="flex-shrink-0 p-2 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                                        title="Cancelar solicitud"
                                    >
                                        <X size={14} strokeWidth={2} />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default EmployeeRequestsView;
