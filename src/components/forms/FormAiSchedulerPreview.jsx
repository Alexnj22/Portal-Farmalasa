import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, Sparkles, AlertTriangle, Save, X, Utensils, Baby, Users } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';

const AI_LOADING_PHRASES = [
    "Analizando horarios de apertura y cierre...",
    "Calculando picos de tráfico...",
    "Asignando almuerzos escalonados...",
    "Aplicando derechos de lactancia...",
    "Verificando cobertura de personal...",
    "Evaluando viabilidad matemática...",
    "Dando los últimos toques mágicos..."
];

// ------------------------------------------------------------------
// 🛠️ HELPER FUNCTIONS (FORMATO AM/PM Y CÁLCULOS)
// ------------------------------------------------------------------
const formatAMPM = (timeStr) => {
    if (!timeStr) return '';
    let [h, m] = String(timeStr).split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return timeStr;
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const addOneHour = (timeStr) => {
    if (!timeStr) return '';
    let [h, m] = String(timeStr).split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return timeStr;
    h = (h + 1) % 24;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const getLunchStart = (start, end, lunchVal) => {
    if (typeof lunchVal === 'string' && lunchVal.includes(':')) return lunchVal;
    let [h1, m1] = start.split(':').map(Number);
    let [h2, m2] = end.split(':').map(Number);
    let startMins = h1 * 60 + m1;
    let endMins = h2 * 60 + m2;
    if (endMins < startMins) endMins += 1440;
    let midMins = startMins + Math.floor((endMins - startMins) / 2) - 30; 
    let h = Math.floor(midMins / 60) % 24;
    let m = midMins % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const getDailyHours = (start, end, hasLunch, hasLactation) => {
    let [h1, m1] = start.split(':').map(Number);
    let [h2, m2] = end.split(':').map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff < 0) diff += 1440;
    if (hasLunch) diff -= 60; 
    if (hasLactation) diff += 60; 
    return Number((diff / 60).toFixed(1));
};

const FormAiSchedulerPreview = ({ formData = {}, onClose }) => {
    const branchId = formData?.branchId;
    const weekStartDate = formData?.startDate || formData?.weekStartDate; 
    
    const { employees = [], shifts = [], branches = [], saveBulkWeeklyRosters } = useStaff();
    
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [aiResult, setAiResult] = useState(null);
    const [error, setError] = useState(null);
    const [phraseIndex, setPhraseIndex] = useState(0);

    const [editableSchedule, setEditableSchedule] = useState({});

    const currentBranch = useMemo(() => branches.find(b => String(b.id) === String(branchId)), [branches, branchId]);
    const branchEmployees = useMemo(() => {
        if (!branchId || !employees) return [];
        return employees.filter(e => String(e.branchId || e.branch_id) === String(branchId));
    }, [employees, branchId]);
    const otherBranchEmployees = useMemo(() => {
        if (!branchId || !employees) return [];
        return employees.filter(e => String(e.branchId || e.branch_id) !== String(branchId));
    }, [employees, branchId]);

    useEffect(() => {
        if (!isLoading) return;
        const phraseTimer = setInterval(() => setPhraseIndex((prev) => (prev + 1) % AI_LOADING_PHRASES.length), 2200);
        return () => clearInterval(phraseTimer);
    }, [isLoading]);

    useEffect(() => {
        const fetchAiProposal = async () => {
            if (!branchId || !weekStartDate) {
                setError("Faltan datos de la sucursal o de la fecha.");
                setIsLoading(false); return;
            }

            try {
                const { data, error: invokeError } = await supabase.functions.invoke('wfm-ai-scheduler', {
                    body: { 
                        branchId, 
                        weekStartDate,
                        weeklyHours: currentBranch?.weekly_hours || currentBranch?.weeklyHours || {},
                        employees: branchEmployees.map(e => ({ id: e.id, name: e.name, role: e.role, history: e.history })), 
                        otherEmployees: otherBranchEmployees.map(e => ({ id: e.id, name: e.name, role: e.role, branchId: e.branchId || e.branch_id })), 
                        shifts: (shifts || []).map(s => ({ id: s.id, name: s.name, start_time: s.start_time || s.start, end_time: s.end_time || s.end }))
                    }
                });

                if (invokeError) throw invokeError;
                if (data?.error) throw new Error(data.error);

                setAiResult(data.aiSchedule);
                setEditableSchedule(data.aiSchedule?.schedule || {});
            } catch (err) {
                setError(err.message || "Gemini no pudo procesar el horario.");
            } finally {
                setIsLoading(false);
            }
        };

        if (branchEmployees.length > 0) fetchAiProposal();
        else { setError("No hay colaboradores asignados a esta sucursal."); setIsLoading(false); }
    }, [branchId, weekStartDate, branchEmployees, currentBranch, shifts]);

    const handleShiftChange = (empId, dayId, newShiftId) => {
        setEditableSchedule(prev => {
            const updated = { ...prev };
            if (!updated[empId]) updated[empId] = {};
            if (!newShiftId) {
                delete updated[empId][dayId]; 
            } else {
                updated[empId][dayId] = { 
                    ...(updated[empId][dayId] || {}), 
                    shiftId: newShiftId,
                    lunchTime: updated[empId][dayId]?.lunchTime || false,
                    lactationTime: updated[empId][dayId]?.lactationTime || false 
                };
            }
            return updated;
        });
    };

    const toggleModifier = (empId, dayId, modifier) => {
        setEditableSchedule(prev => {
            const updated = { ...prev };
            if (updated[empId]?.[dayId]) {
                updated[empId][dayId][modifier] = !updated[empId][dayId][modifier];
            }
            return updated;
        });
    };

    const handleSaveDraft = async () => {
        setIsSaving(true);
        try {
            await saveBulkWeeklyRosters(weekStartDate, editableSchedule);
            window.dispatchEvent(new CustomEvent('force-history-refresh'));
            if(onClose) onClose();
        } catch (err) {
            alert("Error al guardar: " + err.message);
            setIsSaving(false);
        }
    };

    const calculateWeeklyHours = (empSchedule) => {
        if (!empSchedule) return 0;
        let mins = 0;
        Object.values(empSchedule).forEach(day => {
            if (!day || !day.shiftId) return;
            const shift = (shifts || []).find(s => String(s.id) === String(day.shiftId));
            if (shift) {
                const start = shift.start_time || shift.start;
                const end = shift.end_time || shift.end;
                if (start && end) {
                    let [h1, m1] = start.split(':').map(Number);
                    let [h2, m2] = end.split(':').map(Number);
                    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
                    if (diff < 0) diff += 1440;
                    if (day.lunchTime) diff -= 60;
                    if (day.lactationTime) diff += 60; 
                    mins += diff;
                }
            }
        });
        return Number((mins / 60).toFixed(1));
    };

    // =========================================================================
    // RENDER: PANTALLAS DE ESTADO
    // =========================================================================
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-in fade-in duration-500">
                <div className="relative w-24 h-24 flex items-center justify-center mb-8">
                    <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-400 rounded-full animate-spin [animation-duration:3s] blur-xl opacity-30"></div>
                    <div className="absolute inset-2 bg-gradient-to-bl from-indigo-500 to-purple-500 rounded-full animate-spin [animation-duration:1.5s] blur-md opacity-50"></div>
                    <div className="relative w-16 h-16 bg-white rounded-full flex items-center justify-center border border-purple-200/60 shadow-inner z-10">
                        <Sparkles size={28} strokeWidth={2.5} className="text-purple-600 animate-pulse scale-110" />
                    </div>
                </div>
                <h3 className="text-xl md:text-2xl font-black bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent uppercase tracking-tight mb-2">Gemini Pensando</h3>
                <div className="h-6 flex items-center justify-center overflow-hidden mb-6">
                    <p key={phraseIndex} className="text-[11px] font-bold text-slate-500 uppercase tracking-widest animate-in slide-in-from-bottom-4 fade-in duration-300 ease-out">{AI_LOADING_PHRASES[phraseIndex]}</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="py-12 px-6 text-center">
                <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
                <h3 className="text-lg font-black text-slate-800 mb-2">Error de Generación</h3>
                <p className="text-sm font-bold text-slate-500 mb-6">{error}</p>
                <button onClick={onClose} className="px-6 py-2 bg-slate-100 text-slate-600 rounded-full font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors">Cerrar</button>
            </div>
        );
    }

    const hasCriticalDeficit = aiResult?.warnings?.length > 0;

    // 🚨 VISTA ALTERNATIVA: HORARIO IMPOSIBLE DE CUBRIR
    if (hasCriticalDeficit) {
        return (
            <div className="w-full flex flex-col gap-5 p-2 animate-in fade-in zoom-in-95 duration-500">
                <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex flex-col items-center text-center shadow-sm">
                    <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4 shadow-inner">
                        <AlertTriangle size={32} strokeWidth={2.5} />
                    </div>
                    <h3 className="text-xl font-black text-red-700 mb-2 uppercase tracking-tight">Horario Inviable</h3>
                    <p className="text-[13px] font-bold text-red-600/80 mb-6 max-w-md">
                        Es matemáticamente imposible cubrir la apertura y cierre de la sucursal respetando las 44 horas semanales con el catálogo y personal actual.
                    </p>
                   
                    <div className="w-full bg-white rounded-xl p-5 text-left border border-red-100 mb-4 shadow-sm">
                        <h4 className="text-[11px] font-black text-red-800 uppercase tracking-widest mb-3">Problemas Detectados por Gemini:</h4>
                        <ul className="list-disc pl-5 text-[13px] font-bold text-slate-700 space-y-1.5 leading-relaxed">
                            {aiResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                    </div>

                    {aiResult?.suggestions?.length > 0 && (
                        <div className="w-full bg-amber-50 rounded-xl p-5 text-left border border-amber-200 shadow-sm">
                            <h4 className="text-[11px] font-black text-amber-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <Users size={16}/> Sugerencias para resolverlo:
                            </h4>
                            <ul className="list-disc pl-5 text-[13px] font-bold text-amber-800 space-y-1.5 leading-relaxed">
                                {aiResult.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="flex justify-end pt-2">
                    <button onClick={onClose} className="px-8 h-12 rounded-full bg-slate-100 text-slate-600 font-black text-[11px] uppercase tracking-widest hover:bg-slate-200 hover:text-slate-800 transition-colors shadow-sm active:scale-95">
                        Ajustar Recursos y Volver a intentar
                    </button>
                </div>
            </div>
        );
    }

    // =========================================================================
    // RENDER: TABLA DE HORARIO VIABLE
    // =========================================================================
    return (
        <div className="w-full flex flex-col gap-4 animate-in fade-in duration-500">
            {/* RAZONAMIENTO */}
            <div className="bg-purple-50/50 border border-purple-100 rounded-xl p-4 relative overflow-hidden shadow-sm">
                <Sparkles className="absolute -bottom-4 -right-4 w-24 h-24 text-purple-200 opacity-50 -rotate-12 pointer-events-none" strokeWidth={1} />
                <h4 className="text-[10px] font-black text-purple-600 uppercase tracking-widest flex items-center gap-1.5 mb-1.5"><Sparkles size={12}/> Resumen de Gemini</h4>
                <p className="text-[12px] font-bold text-slate-700 leading-relaxed relative z-10 italic">"{aiResult?.ai_reasoning || 'Horario generado óptimamente.'}"</p>
            </div>

            {/* TABLA DETALLADA */}
            <div className="border border-slate-200 rounded-xl overflow-auto shadow-sm">
                <table className="w-full text-left border-collapse bg-slate-50/50 min-w-[1000px]">
                    <thead className="sticky top-0 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] z-20">
                        <tr>
                            <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-widest w-[180px] bg-white">Colaborador</th>
                            <th className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center border-r border-slate-200 bg-white w-[60px]">Hrs</th>
                            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, i) => (
                                <th key={i} className="p-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center min-w-[120px] bg-white">{day}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 bg-white">
                        {branchEmployees.map(emp => {
                            const empSch = editableSchedule[emp.id] || {};
                            const weeklyHrs = calculateWeeklyHours(empSch);
                            const isOver = weeklyHrs > 44;
                            const isUnder = weeklyHrs < 30; 

                            return (
                                <tr key={emp.id} className="hover:bg-slate-50 transition-colors group/row">
                                    <td className="p-3 border-r border-slate-200 bg-white sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                                        <p className="text-[12px] font-black text-slate-800 truncate">{emp.name}</p>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase truncate">{emp.role}</p>
                                    </td>
                                    <td className="p-2 text-center align-middle border-r border-slate-200">
                                        <span className={`px-2 py-1 rounded-md text-[10px] font-black tracking-widest ${isOver ? 'bg-red-100 text-red-600' : isUnder ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                            {weeklyHrs}H
                                        </span>
                                    </td>
                                    {[1, 2, 3, 4, 5, 6, 0].map(dayId => {
                                        const dayData = empSch[dayId];
                                        const shiftId = dayData?.shiftId;
                                        const shift = shiftId ? shifts.find(s => String(s.id) === String(shiftId)) : null;

                                        let start, end, lunchStart, lunchEnd, dailyHrs;
                                        if (shift) {
                                            start = shift.start_time?.substring(0,5) || shift.start;
                                            end = shift.end_time?.substring(0,5) || shift.end;
                                            if (dayData.lunchTime) {
                                                lunchStart = getLunchStart(start, end, dayData.lunchTime);
                                                lunchEnd = addOneHour(lunchStart);
                                            }
                                            dailyHrs = getDailyHours(start, end, !!dayData.lunchTime, !!dayData.lactationTime);
                                        }

                                        return (
                                            <td key={dayId} className="p-2 align-top border-l border-slate-200/60">
                                                {shift ? (
                                                    <div className="flex flex-col h-full bg-white border border-indigo-100 rounded-lg shadow-sm overflow-hidden hover:border-indigo-300 transition-colors group/cell">
                                                        
                                                        {/* Header de la celda (Selector) */}
                                                        <select 
                                                            value={shiftId || ""}
                                                            onChange={(e) => handleShiftChange(emp.id, dayId, e.target.value)}
                                                            className="w-full bg-indigo-50/30 hover:bg-indigo-50 text-indigo-700 text-[10px] font-black p-2 outline-none text-center border-b border-indigo-50 appearance-none cursor-pointer rounded-none"
                                                        >
                                                            <option value="">LIBRE</option>
                                                            {shifts.map(s => (
                                                                <option key={s.id} value={s.id}>
                                                                    {s.start_time?.substring(0,5) || s.start} - {s.end_time?.substring(0,5) || s.end}
                                                                </option>
                                                            ))}
                                                        </select>

                                                        {/* Desglose AM / PM (SOLO SI HAY ALMUERZO O LACTANCIA) */}
                                                        {(dayData.lunchTime || dayData.lactationTime) && (
                                                            <div className="flex-1 flex flex-col p-1.5 gap-1.5 text-[8.5px] font-bold text-slate-600 tracking-wide mt-1">
                                                                {dayData.lunchTime && (
                                                                    <>
                                                                        <div className="flex justify-between items-center px-1">
                                                                            <span>{formatAMPM(start)}</span>
                                                                            <span className="opacity-40">-</span>
                                                                            <span>{formatAMPM(lunchStart)}</span>
                                                                        </div>
                                                                        <div className="flex justify-center items-center bg-orange-50 text-orange-600 rounded px-1.5 py-0.5 border border-orange-100/50">
                                                                            <span>{formatAMPM(lunchStart)} - {formatAMPM(lunchEnd)}</span>
                                                                        </div>
                                                                        <div className="flex justify-between items-center px-1">
                                                                            <span>{formatAMPM(lunchEnd)}</span>
                                                                            <span className="opacity-40">-</span>
                                                                            <span>{formatAMPM(end)}</span>
                                                                        </div>
                                                                    </>
                                                                )}

                                                                {dayData.lactationTime && (
                                                                    <div className="flex justify-center items-center bg-pink-50 text-pink-600 rounded px-1.5 py-0.5 border border-pink-100/50 mt-0.5">
                                                                        <span>Lactancia (+1h)</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        
                                                        {/* BADGE DE HORAS */}
                                                        <div className={`mt-auto flex justify-center ${dayData.lunchTime || dayData.lactationTime ? 'pb-2' : 'py-3'}`}>
                                                            <span className="bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded text-[9px] font-black tracking-widest border border-slate-200">
                                                                {dailyHrs}H
                                                            </span>
                                                        </div>

                                                        {/* Mini Toolbar Editable */}
                                                        <div className="flex border-t border-slate-100 bg-slate-50/50 mt-auto">
                                                            <button onClick={() => toggleModifier(emp.id, dayId, 'lunchTime')} className={`flex-1 flex justify-center items-center py-1.5 transition-colors ${dayData.lunchTime ? 'text-orange-500 bg-orange-50' : 'text-slate-300 hover:text-orange-400 hover:bg-slate-100'}`} title="Con/Sin Almuerzo">
                                                                <Utensils size={11} strokeWidth={2.5}/>
                                                            </button>
                                                            <div className="w-px bg-slate-200/50"></div>
                                                            <button onClick={() => toggleModifier(emp.id, dayId, 'lactationTime')} className={`flex-1 flex justify-center items-center py-1.5 transition-colors ${dayData.lactationTime ? 'text-pink-500 bg-pink-50' : 'text-slate-300 hover:text-pink-400 hover:bg-slate-100'}`} title="Con/Sin Lactancia">
                                                                <Baby size={11} strokeWidth={2.5}/>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <select 
                                                        value=""
                                                        onChange={(e) => handleShiftChange(emp.id, dayId, e.target.value)}
                                                        className="w-full h-full bg-slate-50 hover:bg-slate-100 text-slate-400 text-[10px] font-black p-2 outline-none text-center border border-dashed border-slate-200 rounded-lg cursor-pointer appearance-none transition-colors"
                                                    >
                                                        <option value="">LIBRE</option>
                                                        {shifts.map(s => (
                                                            <option key={s.id} value={s.id}>
                                                                {s.start_time?.substring(0,5) || s.start} - {s.end_time?.substring(0,5) || s.end}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* BOTONES INFERIORES */}
            <div className="flex items-center justify-end gap-3 pt-2">
                <button onClick={onClose} disabled={isSaving} className="px-5 h-10 md:h-11 rounded-full text-[10px] md:text-[11px] font-bold text-slate-500 uppercase tracking-widest hover:bg-slate-100 transition-colors flex items-center gap-2">
                    <X size={14}/> Descartar
                </button>
                <button onClick={handleSaveDraft} disabled={isSaving} className="px-6 md:px-8 h-10 md:h-11 rounded-full bg-[#007AFF] text-white text-[10px] md:text-[11px] font-black uppercase tracking-widest shadow-[0_8px_20px_rgba(0,122,255,0.3)] hover:bg-[#0066CC] hover:shadow-[0_12px_25px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transition-all duration-300 flex items-center gap-2">
                    {isSaving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16} strokeWidth={2.5}/>} 
                    {isSaving ? 'Guardando...' : 'Aplicar Horario'}
                </button>
            </div>
        </div>
    );
};

export default FormAiSchedulerPreview;