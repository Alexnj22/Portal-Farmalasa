import React, { useState, useMemo, useCallback, useEffect, memo, useRef } from 'react';
import {
    X, Loader2, Archive, Target, Edit3, Copy,
    AlertTriangle, Search, RotateCcw, Save, Send, Globe, AlertCircle,
    CheckCircle2, Sparkles, Bot, Zap
} from 'lucide-react';
import TimePicker12 from '../../components/common/TimePicker12';
import { formatTime12h } from '../../utils/helpers';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { formatHourAMPM, timeToMins } from '../../utils/scheduleHelpers';

const minsToTimeStr = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const formatBranchNames = (names) => {
    if (!names || names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} y ${names[1]}`;
    const last = names[names.length - 1];
    return `${names.slice(0, -1).join(', ')} y ${last}`;
};

// ============================================================================
// SALY SUGGESTION CARD
// ============================================================================
const SuggestionCard = memo(({ insight, onApply, onDismiss }) => {
    const isError = insight.type === 'error';
    return (
        <div className={`p-5 rounded-[2.5rem] border bg-slate-900/80 backdrop-blur-3xl backdrop-saturate-[180%] flex flex-col gap-4 relative transform-gpu transition-all hover:-translate-y-1 group h-full
            ${isError
                ? 'border-rose-500/30 shadow-[inset_0_2px_10px_rgba(244,63,94,0.1),0_8px_30px_rgba(0,0,0,0.1)] hover:shadow-[0_15px_40px_rgba(244,63,94,0.2)]'
                : 'border-cyan-500/30 shadow-[inset_0_2px_10px_rgba(6,182,212,0.1),0_8px_30px_rgba(0,0,0,0.1)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.25)]'}`}>

            <div className="absolute inset-0 rounded-[2.5rem] overflow-hidden pointer-events-none">
                <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-[60px] opacity-15 group-hover:opacity-30 transition-opacity duration-1000 ${isError ? 'bg-rose-500' : 'bg-cyan-500'}`} />
            </div>

            <div className="flex items-center justify-between relative z-10 pr-8">
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border
                    ${isError ? 'text-rose-300 bg-rose-500/10 border-rose-500/20' : 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20'}`}>
                    <Bot size={12} strokeWidth={2} /> {isError ? 'SALY REQUIERE DATOS' : 'SALY SUGIERE'}
                </span>
                {isError
                    ? <AlertTriangle size={16} className="text-rose-400 animate-pulse" />
                    : <Sparkles size={16} className="text-cyan-400 animate-pulse" />}
            </div>

            <button onClick={onDismiss} className="absolute top-5 right-5 p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all active:scale-95 z-20" title="Ignorar aviso">
                <X size={14} strokeWidth={2.5} />
            </button>

            <div className="relative z-10 flex-1">
                <h4 className="font-black text-white text-[16px] leading-tight tracking-tight mb-2">{insight.branch}</h4>
                <p className={`text-[12px] font-medium leading-relaxed ${isError ? 'text-rose-100/80' : 'text-cyan-100/70'}`}>{insight.text}</p>
            </div>

            {insight.action && (
                <div className="mt-auto pt-4 relative z-10">
                    <button type="button" onClick={() => onApply(insight.action)} className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-900 rounded-xl text-[11px] font-black uppercase tracking-widest shadow-[0_4px_15px_rgba(6,182,212,0.3)] transition-all active:scale-95 flex items-center justify-center gap-2">
                        <Zap size={14} strokeWidth={2.5} /> Crear este turno
                    </button>
                </div>
            )}
        </div>
    );
});

// ============================================================================
// TURNO CARD
// ============================================================================
const TurnoCard = memo(({ group, onEdit, onDuplicate, onArchive, onUnarchive, isEditingThis, onCancelEditing }) => {
    const [confirmAction, setConfirmAction] = useState(null);
    const isArchived = group.shifts_data.every(s => s.is_active === false || s.isActive === false);

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                if (confirmAction) setConfirmAction(null);
                else if (isEditingThis && onCancelEditing) onCancelEditing();
            }
        };
        if (confirmAction || isEditingThis) window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [confirmAction, isEditingThis, onCancelEditing]);

    const hours = useMemo(() => {
        if (!group.start) return 0;
        let mins = timeToMins(group.end) - timeToMins(group.start);
        if (mins < 0) mins += 1440;
        return mins / 60;
    }, [group]);

    return (
        <div className={`p-5 rounded-[2.5rem] border flex flex-col gap-4 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group/card relative transform-gpu w-full h-full ${
            isEditingThis
                ? 'bg-white/90 backdrop-blur-3xl backdrop-saturate-[180%] border-amber-300/80 shadow-[0_8px_30px_rgba(245,158,11,0.15),inset_0_2px_10px_rgba(255,255,255,0.9)] animate-subtle-shake z-30'
                : isArchived
                    ? 'border-white/40 opacity-80 hover:opacity-100 shadow-[0_4px_16px_rgba(0,0,0,0.03)] bg-white/40 backdrop-blur-xl hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] z-10'
                    : 'border-white/80 shadow-[inset_0_1px_6px_rgba(255,255,255,0.6),0_6px_20px_rgba(0,0,0,0.04)] hover:shadow-[inset_0_1px_6px_rgba(255,255,255,0.8),0_15px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 bg-white/50 backdrop-blur-3xl backdrop-saturate-[180%] z-10 hover:z-20'
        }`}>

            {confirmAction && (
                <div className="absolute inset-0 z-[60] bg-white/95 backdrop-blur-xl flex flex-col items-center justify-center gap-3 animate-in zoom-in-95 duration-300 p-5 rounded-[2.5rem]">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm bg-white border ${confirmAction === 'archive' ? 'text-red-500 border-red-100' : 'text-emerald-500 border-emerald-100'}`}>
                        {confirmAction === 'archive' ? <AlertTriangle size={20} strokeWidth={2.5} /> : <RotateCcw size={20} strokeWidth={2.5} />}
                    </div>
                    <div className="text-center px-4">
                        <h4 className="font-black text-slate-800 text-[14px] uppercase tracking-widest mb-1">
                            {confirmAction === 'archive' ? '¿Archivar?' : '¿Reactivar?'}
                        </h4>
                        <p className="text-[11px] font-bold text-slate-500 leading-tight">
                            {confirmAction === 'archive' ? 'El turno se ocultará del catálogo.' : 'Volverá a estar disponible.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 mt-2 w-full">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmAction(null); }} className="flex-1 py-3 rounded-xl bg-white shadow-sm border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all active:scale-95">
                            Cancelar
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); confirmAction === 'archive' ? onArchive(group.all_ids) : onUnarchive(group.all_ids); setConfirmAction(null); }} className={`flex-1 py-3 rounded-xl text-white text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-sm ${confirmAction === 'archive' ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
                            {confirmAction === 'archive' ? 'Archivar' : 'Reactivar'}
                        </button>
                    </div>
                </div>
            )}

            <div className={`absolute top-4 right-4 flex items-center gap-1.5 transition-opacity duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] z-50 ${isEditingThis || confirmAction ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'}`}>
                {!isArchived && !confirmAction && (
                    <>
                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDuplicate(group); }} className="p-2 rounded-full bg-white/80 backdrop-blur-md border border-white text-[#007AFF]/60 hover:bg-white hover:text-[#007AFF] transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.05)] active:scale-95 hover:-translate-y-0.5 cursor-pointer" title="Duplicar">
                            <Copy size={12} strokeWidth={2.5} />
                        </button>
                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(group); }} className={`p-2 rounded-full backdrop-blur-md transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.05)] border active:scale-95 hover:-translate-y-0.5 cursor-pointer ${isEditingThis ? 'bg-amber-100 text-amber-600 border-amber-300' : 'bg-white/80 text-amber-500 border-white hover:bg-white hover:text-amber-600'}`} title="Editar">
                            <Edit3 size={12} strokeWidth={2.5} />
                        </button>
                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction('archive'); }} className="p-2 rounded-full bg-white/80 backdrop-blur-md border border-white text-slate-400 hover:bg-white hover:text-red-500 transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.05)] active:scale-95 hover:-translate-y-0.5 cursor-pointer" title="Archivar">
                            <Archive size={12} strokeWidth={2.5} />
                        </button>
                    </>
                )}
                {isArchived && !confirmAction && (
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction('unarchive'); }} className="p-2 rounded-full bg-white/80 backdrop-blur-md border border-white text-emerald-500 hover:bg-white hover:text-emerald-600 transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.05)] active:scale-95 hover:-translate-y-0.5 cursor-pointer" title="Reactivar">
                        <RotateCcw size={12} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-1 pr-16 relative z-10">
                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border border-slate-200/50">
                    <Globe size={10} strokeWidth={2} /> Catálogo Global
                </span>
                {hours > 9 && (
                    <span className="flex items-center gap-1 text-white bg-red-500 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest shadow-[0_2px_10px_rgba(239,68,68,0.3)] animate-pulse">
                        <AlertTriangle size={10} strokeWidth={2.5} /> +8H
                    </span>
                )}
                {isArchived && (
                    <span className="text-[9px] font-bold text-slate-500 bg-white/50 border border-white/60 px-2 py-1 rounded-md flex items-center gap-1 uppercase tracking-widest">
                        <Archive size={10} strokeWidth={2.5} /> Archivo
                    </span>
                )}
            </div>

            <div className="pr-2 relative z-10">
                <h4 className="font-black text-slate-800 text-[16px] leading-tight tracking-tight line-clamp-2">{group.name}</h4>
            </div>

            <div className="flex items-center gap-3 mt-auto border-t border-white/60 pt-4 relative z-10">
                <div className="flex-1 bg-white/60 backdrop-blur-md p-3 rounded-2xl border border-white shadow-[inset_0_1px_4px_rgba(255,255,255,0.9)]">
                    <span className="text-[8px] font-black text-slate-400 uppercase block mb-1 tracking-widest">Entrada</span>
                    <span className="text-[14px] font-bold text-slate-700 tracking-tight">{formatTime12h(group.start)}</span>
                </div>
                <div className="flex-1 bg-white/60 backdrop-blur-md p-3 rounded-2xl border border-white shadow-[inset_0_1px_4px_rgba(255,255,255,0.9)]">
                    <span className="text-[8px] font-black text-slate-400 uppercase block mb-1 tracking-widest">Salida</span>
                    <span className="text-[14px] font-bold text-slate-700 tracking-tight">{formatTime12h(group.end)}</span>
                </div>
            </div>
        </div>
    );
});

// ============================================================================
// TAB SHIFTS — CATÁLOGO GLOBAL
// ============================================================================
const TabShifts = ({ branches, shiftTab }) => {
    const { shifts, addShift, updateShift, archiveShift, unarchiveShift } = useStaffStore();
    const { showToast } = useToastStore();

    const [isLoading, setIsLoading]       = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [currentForm, setCurrentForm]   = useState({ start: '', end: '' });
    const [dismissedSugs, setDismissedSugs] = useState(new Set());
    const [localSearch, setLocalSearch]   = useState('');
    const searchInputRef = useRef(null);

    useEffect(() => {
        if (currentForm.start && !currentForm.end) {
            setCurrentForm(prev => ({ ...prev, end: '16:00' }));
        }
    }, [currentForm.start]);

    const validBranches = useMemo(() => {
        if (!branches) return [];
        return branches.filter(b => {
            const name = (b.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            return !name.includes('bodega') && !name.includes('administracion') && !name.includes('externos');
        });
    }, [branches]);

    const getBranchLimits = useCallback((branchId) => {
        const b = validBranches.find(br => String(br.id) === String(branchId));
        let minO = 1440, maxC = 0, hasValidHours = false;

        if (b) {
            let sch = b.weekly_hours;
            if (typeof sch === 'string') { try { sch = JSON.parse(sch); } catch { sch = null; } }
            if (sch && typeof sch === 'object' && Object.keys(sch).length > 0) {
                Object.values(sch).forEach(d => {
                    if (d?.isOpen && d.start && d.end) {
                        const cleanStart = String(d.start).replace(/[^0-9:]/g, '').trim();
                        const cleanEnd   = String(d.end).replace(/[^0-9:]/g, '').trim();
                        if (cleanStart && cleanEnd) {
                            const oMins = timeToMins(cleanStart);
                            let cMins   = timeToMins(cleanEnd);
                            if (cMins < oMins) cMins += 1440;
                            if (oMins < minO) minO = oMins;
                            if (cMins > maxC) maxC = cMins;
                            hasValidHours = true;
                        }
                    }
                });
            }
        }
        return { minOpen: minO, maxClose: maxC, hasValidHours, branchName: b?.name };
    }, [validBranches]);

    // ── SALY AI INSIGHTS ────────────────────────────────────────────────────
    const globalInsights = useMemo(() => {
        if (editingGroup || currentForm.start) return [];
        const activeShifts = shifts.filter(s => s.is_active !== false && s.isActive !== false);

        if (activeShifts.length === 0) {
            return [{ key: 'empty_catalog', type: 'suggestion', branch: 'Catálogo Vacío', text: 'No tienes ningún turno creado. Te sugiero crear el turno estándar de apertura (7:00 am - 4:00 pm).', action: { start: '07:00', end: '16:00' } }];
        }

        const catalogMins = activeShifts.map(s => {
            const sMins = timeToMins(s.start_time?.substring(0, 5) || s.start);
            let eMins   = timeToMins(s.end_time?.substring(0, 5)   || s.end);
            if (eMins < sMins) eMins += 1440;
            return { id: s.id, start: sMins, end: eMins };
        });

        const map = {};
        validBranches.forEach(b => {
            const limits = getBranchLimits(b.id);
            if (!limits.hasValidHours) {
                const sig = 'error_no_hours';
                if (!map[sig]) map[sig] = { type: 'error', branches: [], reason: 'no_hours', action: null };
                map[sig].branches.push(b.name);
                return;
            }
            const validForBranch = catalogMins.filter(s => s.start >= limits.minOpen && s.end <= limits.maxClose);
            if (validForBranch.length === 0) {
                const sig = `error_no_valid_${limits.minOpen}_${limits.maxClose}`;
                if (!map[sig]) map[sig] = { type: 'error', branches: [], reason: 'no_valid_shifts', limits, action: { start: minsToTimeStr(limits.minOpen), end: minsToTimeStr(Math.min(limits.minOpen + 540, limits.maxClose)) } };
                map[sig].branches.push(b.name);
                return;
            }
            let branchMinStart = 1440, branchMaxEnd = 0;
            validForBranch.forEach(s => { if (s.start < branchMinStart) branchMinStart = s.start; if (s.end > branchMaxEnd) branchMaxEnd = s.end; });
            if (branchMinStart > limits.minOpen + 30) {
                const sig = `sug_apertura_${limits.minOpen}_${branchMinStart}`;
                if (!map[sig]) map[sig] = { type: 'suggestion', branches: [], reason: 'apertura_global', limits, branchMinStart, action: { start: minsToTimeStr(limits.minOpen), end: minsToTimeStr(Math.min(limits.minOpen + 540, limits.maxClose)) } };
                map[sig].branches.push(b.name);
            }
            if (branchMaxEnd < limits.maxClose - 30) {
                const sig = `sug_cierre_${limits.maxClose}_${branchMaxEnd}`;
                if (!map[sig]) map[sig] = { type: 'suggestion', branches: [], reason: 'cierre_global', limits, branchMaxEnd, action: { start: minsToTimeStr(Math.max(limits.maxClose - 540, limits.minOpen)), end: minsToTimeStr(limits.maxClose) } };
                map[sig].branches.push(b.name);
            }
        });

        return Object.entries(map)
            .filter(([key]) => !dismissedSugs.has(key))
            .map(([key, val]) => {
                const isPlural = val.branches.length > 1;
                const branch = formatBranchNames([...val.branches]);
                let text = '';
                if (val.reason === 'no_hours') text = isPlural ? 'No tienen su horario operativo configurado. Configúralo en el Módulo Sucursales para que Saly pueda auditar.' : 'No tiene su horario operativo configurado. Configúralo en el Módulo Sucursales para que Saly pueda auditar.';
                else if (val.reason === 'no_valid_shifts') text = isPlural ? `Operan de ${formatHourAMPM(Math.floor(val.limits.minOpen/60))} a ${formatHourAMPM(Math.floor(val.limits.maxClose/60))}. Ningún turno global encaja legalmente aquí.` : `Opera de ${formatHourAMPM(Math.floor(val.limits.minOpen/60))} a ${formatHourAMPM(Math.floor(val.limits.maxClose/60))}. Ningún turno global encaja legalmente aquí.`;
                else if (val.reason === 'apertura_global') text = isPlural ? `Abren a las ${formatHourAMPM(Math.floor(val.limits.minOpen/60))} pero los turnos válidos empiezan a las ${formatHourAMPM(Math.floor(val.branchMinStart/60))}. Crea un turno de apertura exacto.` : `Abre a las ${formatHourAMPM(Math.floor(val.limits.minOpen/60))} pero los turnos válidos empiezan a las ${formatHourAMPM(Math.floor(val.branchMinStart/60))}. Crea un turno de apertura exacto.`;
                else if (val.reason === 'cierre_global') text = isPlural ? `Cierran a las ${formatHourAMPM(Math.floor(val.limits.maxClose/60))} pero los turnos válidos terminan a las ${formatHourAMPM(Math.floor(val.branchMaxEnd/60))}. Crea un turno de cierre exacto.` : `Cierra a las ${formatHourAMPM(Math.floor(val.limits.maxClose/60))} pero los turnos válidos terminan a las ${formatHourAMPM(Math.floor(val.branchMaxEnd/60))}. Crea un turno de cierre exacto.`;
                return { key, type: val.type, branch, text, action: val.action };
            })
            .slice(0, 6);
    }, [validBranches, shifts, editingGroup, currentForm.start, getBranchLimits, dismissedSugs]);

    const { autoName, activeAlerts, hasBlockingError } = useMemo(() => {
        let classification = 'Turno Estándar';
        const alerts = [];
        let isBlocking = false;

        if (currentForm.start && currentForm.end) {
            const sMins = timeToMins(currentForm.start);
            let eMins   = timeToMins(currentForm.end);
            if (eMins < sMins) eMins += 1440;

            if (sMins <= 480)       classification = 'Apertura';
            else if (eMins >= 1020) classification = 'Cierre';
            else                    classification = 'Enlace';

            const duration = (eMins - sMins) / 60;
            if (duration > 9) alerts.push({ type: 'warning', text: `El turno excede las 9 horas (${duration.toFixed(1)}h). Considera el cansancio del personal.` });

            const isDuplicate = shifts.some(s => {
                if (s.is_active === false || s.isActive === false) return false;
                const sStart = s.start_time?.substring(0, 5) || s.start;
                const sEnd   = s.end_time?.substring(0, 5)   || s.end;
                const isNotCurrent = editingGroup ? !editingGroup.all_ids.includes(s.id) : true;
                return sStart === currentForm.start && sEnd === currentForm.end && isNotCurrent;
            });
            if (isDuplicate) { alerts.push({ type: 'error', text: 'Ya existe un turno global con exactamente este mismo horario.' }); isBlocking = true; }
        }
        return { autoName: classification, activeAlerts: alerts, hasBlockingError: isBlocking };
    }, [currentForm, shifts, editingGroup]);

    // ── FILTERED + SORTED SHIFTS ─────────────────────────────────────────────
    const globalShifts = useMemo(() => {
        if (!shifts) return [];
        const q = localSearch.trim().toLowerCase();
        return shifts
            .filter(s => {
                const isActive    = s.is_active !== false && s.isActive !== false;
                const matchesTab  = (shiftTab === 'ACTIVE' && isActive) || (shiftTab === 'ARCHIVED' && !isActive);
                const matchesSearch = !q || (s.name || '').toLowerCase().includes(q);
                return matchesTab && matchesSearch;
            })
            .reduce((map, s) => {
                const key = `${s.name}_${s.start_time || s.start}_${s.end_time || s.end}`;
                if (!map[key]) map[key] = { groupId: key, name: s.name, start: s.start_time || s.start, end: s.end_time || s.end, all_ids: [s.id], shifts_data: [s] };
                else { map[key].all_ids.push(s.id); map[key].shifts_data.push(s); }
                return map;
            }, {});
    }, [shifts, shiftTab, localSearch]);

    const sortedShifts = useMemo(() =>
        Object.values(globalShifts).sort((a, b) => timeToMins(a.start) - timeToMins(b.start)),
    [globalShifts]);

    // ── ACCIONES ─────────────────────────────────────────────────────────────
    const applySuggestion = useCallback((action) => {
        setEditingGroup(null);
        setCurrentForm({ start: action.start, end: action.end });
        showToast('Sugerencia Aplicada', 'Verifica las horas y guarda el turno.', 'info');
    }, [showToast]);

    const dismissSuggestion = useCallback((key) => {
        setDismissedSugs(prev => new Set(prev).add(key));
    }, []);

    const handleSaveShift = async (e) => {
        if (e) e.preventDefault();
        if (!currentForm.start || !currentForm.end) { showToast('Campos incompletos', 'Asegúrate de darle horas al turno.', 'error'); return; }
        if (hasBlockingError) { showToast('Error Operativo', 'Resuelve las advertencias de Saly antes de guardar.', 'error'); return; }
        setIsLoading(true);
        try {
            if (editingGroup) {
                await updateShift(editingGroup.shifts_data[0].id, { name: autoName, start_time: `${currentForm.start}:00`, end_time: `${currentForm.end}:00`, branch_id: null });
                showToast('Éxito', 'Turno actualizado en el catálogo global', 'success');
            } else {
                await addShift({ name: autoName, start: currentForm.start, end: currentForm.end, branchId: null });
                showToast('Éxito', 'Turno añadido al catálogo global', 'success');
            }
            cancelEditing();
        } catch (err) {
            showToast('Error al guardar', err.message || 'Verifica tu conexión', 'error');
        } finally { setIsLoading(false); }
    };

    const handleDuplicate = useCallback((group) => {
        setEditingGroup(null);
        setCurrentForm({ start: group.start, end: group.end });
        showToast('Modo Duplicar', 'Copia las horas para crear uno nuevo.', 'info');
    }, [showToast]);

    const handleArchiveGroup = useCallback(async (ids) => {
        try { for (const id of ids) await archiveShift(id); showToast('Archivado', 'Turno oculto del catálogo.', 'success'); }
        catch { showToast('Error', 'No se pudo archivar.', 'error'); }
    }, [archiveShift, showToast]);

    const handleUnarchiveGroup = useCallback(async (ids) => {
        try { for (const id of ids) await unarchiveShift(id); showToast('Reactivado', 'Turno disponible en catálogo.', 'success'); }
        catch { showToast('Error', 'No se pudo reactivar.', 'error'); }
    }, [unarchiveShift, showToast]);

    const startEditing = useCallback((group) => {
        setEditingGroup(group);
        setCurrentForm({ start: group.start, end: group.end });
    }, []);

    const cancelEditing = useCallback(() => {
        setEditingGroup(null);
        setCurrentForm({ start: '', end: '' });
    }, []);

    const isEmpty = sortedShifts.length === 0 && globalInsights.length === 0;

    return (
        <div className="flex flex-col lg:flex-row items-start gap-6 md:gap-8 px-2 md:px-0 w-full h-[calc(100vh-230px)] lg:h-[calc(100vh-180px)]">
            <style>{`@keyframes subtle-shake { 0%,100%{transform:rotate(0deg) scale(1.01);}25%{transform:rotate(-0.5deg) scale(1.01);}75%{transform:rotate(0.5deg) scale(1.01);}} .animate-subtle-shake{animation:subtle-shake 0.4s ease-in-out infinite;}`}</style>

            {/* ── COLUMNA IZQUIERDA: FORMULARIO ── */}
            <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 z-[50] transform-gpu">
                <div className={`bg-white/40 backdrop-blur-3xl backdrop-saturate-[180%] border p-6 md:p-8 rounded-[2.5rem] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col hover:border-white hover:bg-white/50 hover:-translate-y-1 hover:shadow-[0_20px_60px_rgba(0,0,0,0.05),inset_0_1px_6px_rgba(255,255,255,0.7)] transform-gpu ${editingGroup ? 'border-amber-300/80 shadow-[0_8px_30px_rgba(245,158,11,0.08),inset_0_1px_4px_rgba(255,255,255,0.7)]' : 'border-white/80 shadow-[inset_0_1px_6px_rgba(255,255,255,0.7),0_10px_40px_rgba(0,0,0,0.03)]'}`}>

                    <div className="flex justify-between items-center mb-6 relative z-10">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2 text-[15px]">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${editingGroup ? 'bg-amber-500' : 'bg-[#007AFF]'}`}>
                                {editingGroup ? <Edit3 size={16} strokeWidth={2.5} /> : <Target size={16} strokeWidth={2.5} />}
                            </div>
                            <span className="font-black uppercase tracking-tight ml-1">{editingGroup ? 'Editar Turno' : 'Nuevo Turno'}</span>
                        </h3>
                        {editingGroup && (
                            <button onClick={cancelEditing} className="flex items-center gap-1.5 text-[10px] md:text-[11px] font-black uppercase tracking-widest text-red-500 bg-red-50 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl transition-all duration-300 border border-red-200 shadow-sm active:scale-95 group">
                                <X size={14} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-300" /> Cancelar
                            </button>
                        )}
                    </div>

                    <form onSubmit={handleSaveShift} className="space-y-6 relative z-10 flex-1 flex flex-col">
                        <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl flex items-start gap-2.5 mb-2">
                            <Globe size={16} className="text-slate-400 mt-0.5 shrink-0" strokeWidth={2.5} />
                            <p className="text-[11px] font-medium text-slate-500 leading-snug">
                                Este turno se añadirá al <strong>Catálogo Global</strong> y podrá ser utilizado por cualquier sucursal.
                            </p>
                        </div>

                        <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                            <div className="pt-2 grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">Entrada</label>
                                    <TimePicker12 value={currentForm.start} onChange={v => setCurrentForm(f => ({ ...f, start: v }))} />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">Salida</label>
                                    <TimePicker12 value={currentForm.end} onChange={v => setCurrentForm(f => ({ ...f, end: v }))} />
                                </div>
                            </div>
                        </div>

                        {currentForm.start && currentForm.end && (
                            <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                                <div className="bg-slate-900/80 backdrop-blur-3xl rounded-2xl p-4 border border-cyan-500/30 shadow-[inset_0_2px_10px_rgba(6,182,212,0.1),0_10px_30px_rgba(0,0,0,0.15)] relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500 rounded-full blur-[50px] opacity-20 pointer-events-none" />
                                    <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3 relative z-10">
                                        <div className="flex items-center gap-1.5 text-[10px] font-black text-cyan-400 uppercase tracking-widest">
                                            <Bot size={13} /> SALY AI AUDITOR
                                        </div>
                                        <div className="flex items-center gap-1 text-cyan-100 font-bold text-[12px] uppercase tracking-tight">
                                            <Sparkles size={13} className="text-cyan-400" /> {autoName}
                                        </div>
                                    </div>
                                    <div className="relative z-10">
                                        {activeAlerts.length > 0 ? (
                                            <div className="flex flex-col gap-2.5">
                                                {activeAlerts.map((alert, idx) => (
                                                    <div key={idx} className={`p-3 rounded-xl flex items-start gap-2.5 border ${alert.type === 'error' ? 'bg-rose-500/20 border-rose-500/30 text-rose-200' : 'bg-amber-500/20 border-amber-500/30 text-amber-200'}`}>
                                                        {alert.type === 'error' ? <AlertCircle size={15} className="shrink-0 mt-0.5 text-rose-400" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" />}
                                                        <span className="text-[11px] font-bold leading-snug">{alert.text}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="p-3 text-center">
                                                <CheckCircle2 size={24} className="text-emerald-400 mx-auto" strokeWidth={1.5} />
                                                <p className="text-[10px] font-black text-emerald-300 uppercase tracking-widest mt-2">Horario coherente</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading || hasBlockingError || !currentForm.start || !currentForm.end}
                            className={`w-full py-4 mt-auto active:scale-[0.98] text-white rounded-[1.25rem] font-black uppercase tracking-widest text-[12px] transition-all duration-500 flex items-center justify-center gap-2 border-none disabled:opacity-50 disabled:cursor-not-allowed ${editingGroup ? 'bg-amber-500 hover:bg-amber-600 shadow-[0_8px_20px_rgba(245,158,11,0.3)]' : 'bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_8px_20px_rgba(0,122,255,0.3)] hover:shadow-[0_12px_25px_rgba(0,122,255,0.4)]'}`}
                        >
                            {isLoading
                                ? <><Loader2 size={18} className="animate-spin" /> Procesando...</>
                                : editingGroup
                                    ? <><Save size={18} strokeWidth={2.5} /> Guardar Cambios</>
                                    : <><Send size={18} strokeWidth={2.5} /> Registrar Turno</>}
                        </button>
                    </form>
                </div>
            </div>

            {/* ── COLUMNA DERECHA: CATÁLOGO ── */}
            <div className="flex-1 flex flex-col min-w-0 w-full h-[100dvh] overflow-y-auto overscroll-contain pb-32 scrollbar-hide -mt-[140px] md:-mt-[190px] pt-[140px] md:pt-[190px] pointer-events-auto">

                {/* Buscador inline */}
                <div className="px-3 md:px-4 pt-4 pb-3">
                    <div className="flex items-center gap-3 bg-white/50 backdrop-blur-xl border border-white/70 rounded-[2rem] px-4 h-12 shadow-[inset_0_1px_4px_rgba(255,255,255,0.8),0_4px_16px_rgba(0,0,0,0.04)] transition-all duration-300 focus-within:bg-white/80 focus-within:shadow-[inset_0_1px_4px_rgba(255,255,255,0.9),0_4px_20px_rgba(0,122,255,0.08)] focus-within:border-[#007AFF]/20">
                        <Search size={15} className="text-slate-400 shrink-0" strokeWidth={2.5} />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Buscar turnos por nombre…"
                            value={localSearch}
                            onChange={e => setLocalSearch(e.target.value)}
                            className="flex-1 bg-transparent outline-none text-[13px] font-semibold text-slate-700 placeholder-slate-400"
                        />
                        {localSearch && (
                            <button onClick={() => { setLocalSearch(''); searchInputRef.current?.focus(); }} className="text-slate-400 hover:text-slate-600 transition-colors active:scale-90">
                                <X size={14} strokeWidth={2.5} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="space-y-5 flex-1 px-3 md:px-4 pb-4">
                    {isEmpty ? (
                        <div className="flex flex-col items-center justify-center h-full min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                            <div className="relative group flex flex-col items-center text-center">
                                <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${localSearch ? 'bg-[#007AFF]' : shiftTab === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                <div className={`relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-2 group-hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] ${localSearch ? 'text-[#007AFF]' : shiftTab === 'ACTIVE' ? 'text-emerald-500' : 'text-slate-400'}`}>
                                    {localSearch ? <Search size={40} strokeWidth={2} /> : shiftTab === 'ACTIVE' ? <CheckCircle2 size={40} strokeWidth={2} /> : <Archive size={40} strokeWidth={2} />}
                                </div>
                                <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">
                                    {localSearch ? 'Sin resultados' : shiftTab === 'ACTIVE' ? 'Catálogo al día' : 'Archivo vacío'}
                                </h3>
                                <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">
                                    {localSearch ? `No hay turnos que coincidan con "${localSearch}".` : shiftTab === 'ACTIVE' ? 'No hay turnos activos registrados.' : 'Aquí aparecerán los turnos archivados.'}
                                </p>
                                {localSearch && (
                                    <button onClick={() => setLocalSearch('')} className="mt-4 px-4 py-2 rounded-full bg-[#007AFF]/10 text-[#007AFF] text-[11px] font-black uppercase tracking-widest hover:bg-[#007AFF]/20 transition-colors active:scale-95">
                                        Limpiar búsqueda
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5 w-full">
                            {globalInsights.map(insight => (
                                <SuggestionCard key={insight.key} insight={insight} onApply={applySuggestion} onDismiss={() => dismissSuggestion(insight.key)} />
                            ))}
                            {sortedShifts.map(group => (
                                <TurnoCard
                                    key={group.groupId}
                                    group={group}
                                    onEdit={() => editingGroup?.groupId === group.groupId ? cancelEditing() : startEditing(group)}
                                    onDuplicate={handleDuplicate}
                                    onArchive={handleArchiveGroup}
                                    onUnarchive={handleUnarchiveGroup}
                                    isEditingThis={editingGroup?.groupId === group.groupId}
                                    onCancelEditing={cancelEditing}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TabShifts;
