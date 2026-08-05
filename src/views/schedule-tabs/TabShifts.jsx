import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { tokenMatch } from '../../utils/searchUtils';
import {
    X, Archive, Target, Pencil, Copy,
    AlertTriangle, Search, RotateCcw, Save, Send, Globe, AlertCircle,
    CheckCircle2, Sparkles, Bot, Zap
} from 'lucide-react';
import TimePicker12 from '../../components/common/TimePicker12';
import { formatTime12h } from '../../utils/helpers';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { formatHourAMPM, timeToMins } from '../../utils/scheduleHelpers';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';
import { mensajeAmigable } from '../../utils/errorMessages';

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
        <div data-surface="card" className={`p-5 rounded-header border backdrop-saturate-[180%] flex flex-col gap-4 relative transform-gpu transition-all group h-full
            ${isError
                ? 'border-danger/30 shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glow-danger-lg)]'
                : 'border-chart-9/30 shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-elevation-xl)]'}`}>

            <div className="absolute inset-0 rounded-header overflow-hidden pointer-events-none">
                <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-[60px] opacity-15 group-hover:opacity-30 transition-opacity duration-1000 ${isError ? 'bg-danger' : 'bg-chart-9'}`} />
            </div>

            <div className="flex items-center justify-between relative z-base pr-8">
                <Badge variant={isError ? 'danger' : 'chart-9'} icon={Bot}>{isError ? 'SALY REQUIERE DATOS' : 'SALY SUGIERE'}</Badge>
                {isError
                    ? <AlertTriangle size={16} className="text-danger-text animate-pulse" />
                    : <Sparkles size={16} className="text-chart-9 animate-pulse" />}
            </div>

            <Button variant="ghost" icon={X} title="Ignorar aviso" iconOnly onClick={onDismiss} />

            <div className="relative z-base flex-1">
                <h4 className="font-black text-white text-body-xl leading-tight tracking-tight mb-2">{insight.branch}</h4>
                <p className={`text-body-sm font-medium leading-relaxed ${isError ? 'text-danger/80' : 'text-chart-9/70'}`}>{insight.text}</p>
            </div>

            {insight.action && (
                <div className="mt-auto pt-4 relative z-base">
                    <Button tone="chart-9" icon={Zap} onClick={() => onApply(insight.action)}>Crear este turno</Button>
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
        <div data-surface="card" data-tono={isEditingThis ? 'warning' : undefined}
                    className={`p-5 flex flex-col gap-4 transition-all duration-700 ease-[var(--ease-spring)] group/card relative transform-gpu w-full h-full ${
                        isEditingThis ? 'animate-subtle-shake z-tabs'
                        : isArchived ? 'opacity-80 hover:opacity-100 z-base'
                        : 'z-base hover:z-content'
                    }`}>

            {confirmAction && (
                <div className="absolute inset-0 z-sidebar-desktop bg-surface-card backdrop-blur-xl flex flex-col items-center justify-center gap-3 animate-in zoom-in-95 duration-300 p-5 rounded-header">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm bg-surface-tab-active border ${confirmAction === 'archive' ? 'text-danger border-danger/30' : 'text-success border-success/30'}`}>
                        {confirmAction === 'archive' ? <AlertTriangle size={20} strokeWidth={2.5} /> : <RotateCcw size={20} strokeWidth={2.5} />}
                    </div>
                    <div className="text-center px-4">
                        <h4 className="font-black text-content text-body-lg uppercase tracking-widest mb-1">
                            {confirmAction === 'archive' ? '¿Archivar?' : '¿Reactivar?'}
                        </h4>
                        <p className="text-label font-bold text-content-3 leading-tight">
                            {confirmAction === 'archive' ? 'El turno se ocultará del catálogo.' : 'Volverá a estar disponible.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 mt-2 w-full">
                        <Button variant="secondary" onClick={(e) => { e.stopPropagation(); setConfirmAction(null); }}>Cancelar</Button>
                        <Button
                            className="flex-1"
                            tone={confirmAction === 'archive' ? 'danger' : 'success'}
                            onClick={(e) => { e.stopPropagation(); confirmAction === 'archive' ? onArchive(group.all_ids) : onUnarchive(group.all_ids); setConfirmAction(null); }}>
                            {confirmAction === 'archive' ? 'Archivar' : 'Reactivar'}
                        </Button>
                    </div>
                </div>
            )}

            <div className={`absolute top-4 right-4 flex items-center gap-1.5 transition-opacity duration-500 ease-[var(--ease-spring)] z-sidebar ${isEditingThis || confirmAction ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100 focus-within:opacity-100'}`}>
                {!isArchived && !confirmAction && (
                    <>
                        <Button variant="secondary" icon={Copy} title="Duplicar" iconOnly onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDuplicate(group); }} />
                        <Button
                            icon={Pencil}
                            iconOnly
                            size="sm"
                            tone="warning"
                            soft
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(group); }}
                            title="Editar"
                        />
                        <Button variant="secondary" icon={Archive} title="Archivar" iconOnly onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction('archive'); }} />
                    </>
                )}
                {isArchived && !confirmAction && (
                    <Button variant="secondary" icon={RotateCcw} title="Reactivar" iconOnly onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmAction('unarchive'); }} />
                )}
            </div>

            <div className="flex flex-wrap items-center gap-1 pr-16 relative z-base">
                <Badge size="sm" icon={Globe}>Catálogo Global</Badge>
                {hours > 9 && (
                    <Badge variant="danger" tone="solid" size="sm" icon={AlertTriangle}>+8H</Badge>
                )}
                {isArchived && (
                    <Badge size="sm" icon={Archive}>Archivo</Badge>
                )}
            </div>

            <div className="pr-2 relative z-base">
                <h4 className="font-black text-content text-body-xl leading-tight tracking-tight line-clamp-2">{group.name}</h4>
            </div>

            <div className="flex items-center gap-3 mt-auto border-t border-border-card pt-4 relative z-base">
                <div data-surface="card" className="flex-1 p-3 border-border-card">
                    <span className="text-micro font-black text-content-3 uppercase block mb-1 tracking-widest">Entrada</span>
                    <span className="text-body-lg font-bold text-content-2 tracking-tight">{formatTime12h(group.start)}</span>
                </div>
                <div data-surface="card" className="flex-1 p-3 border-border-card">
                    <span className="text-micro font-black text-content-3 uppercase block mb-1 tracking-widest">Salida</span>
                    <span className="text-body-lg font-bold text-content-2 tracking-tight">{formatTime12h(group.end)}</span>
                </div>
            </div>
        </div>
    );
});

// ============================================================================
// TAB SHIFTS — CATÁLOGO GLOBAL
// ============================================================================
const TabShifts = ({ branches, searchTerm = '' }) => {
    const shifts = useStaffStore(s => s.shifts);
    const addShift = useStaffStore(s => s.addShift);
    const updateShift = useStaffStore(s => s.updateShift);
    const archiveShift = useStaffStore(s => s.archiveShift);
    const unarchiveShift = useStaffStore(s => s.unarchiveShift);
    const { showToast } = useToastStore();

    const [isLoading, setIsLoading]       = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [currentForm, setCurrentForm]   = useState({ start: '', end: '', name: '' });
    const [dismissedSugs, setDismissedSugs] = useState(new Set());
    const [shiftTab, setShiftTab]         = useState('ACTIVE');

    useEffect(() => {
        if (currentForm.start && !currentForm.end) {
            setCurrentForm(prev => ({ ...prev, end: '16:00' }));
        }
    }, [currentForm.start, currentForm.end]);

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
        return shifts
            .filter(s => {
                const isActive    = s.is_active !== false && s.isActive !== false;
                const matchesTab  = (shiftTab === 'ACTIVE' && isActive) || (shiftTab === 'ARCHIVED' && !isActive);
                const matchesSearch = !searchTerm || tokenMatch(searchTerm, s.name);
                return matchesTab && matchesSearch;
            })
            .reduce((map, s) => {
                const key = `${s.name}_${s.start_time || s.start}_${s.end_time || s.end}`;
                if (!map[key]) map[key] = { groupId: key, name: s.name, start: s.start_time || s.start, end: s.end_time || s.end, all_ids: [s.id], shifts_data: [s] };
                else { map[key].all_ids.push(s.id); map[key].shifts_data.push(s); }
                return map;
            }, {});
    }, [shifts, shiftTab, searchTerm]);

    const sortedShifts = useMemo(() =>
        Object.values(globalShifts).sort((a, b) => timeToMins(a.start) - timeToMins(b.start)),
    [globalShifts]);

    // ── ACCIONES ─────────────────────────────────────────────────────────────
    const applySuggestion = useCallback((action) => {
        setEditingGroup(null);
        setCurrentForm({ start: action.start, end: action.end, name: '' });
        showToast('Sugerencia Aplicada', 'Verifica las horas y guarda el turno.', 'info');
    }, [showToast]);

    const dismissSuggestion = useCallback((key) => {
        setDismissedSugs(prev => new Set(prev).add(key));
    }, []);

    const handleSaveShift = async (e) => {
        if (e) e.preventDefault();
        if (!currentForm.start || !currentForm.end) { showToast('Campos incompletos', 'Asegúrate de darle horas al turno.', 'error'); return; }
        if (hasBlockingError) { showToast('Error Operativo', 'Resuelve las advertencias de Saly antes de guardar.', 'error'); return; }
        const effectiveName = currentForm.name.trim() || autoName;
        setIsLoading(true);
        try {
            if (editingGroup) {
                await updateShift(editingGroup.shifts_data[0].id, { name: effectiveName, start_time: `${currentForm.start}:00`, end_time: `${currentForm.end}:00`, branch_id: null });
                showToast('Éxito', 'Turno actualizado en el catálogo global', 'success');
            } else {
                await addShift({ name: effectiveName, start: currentForm.start, end: currentForm.end, branchId: null });
                showToast('Éxito', 'Turno añadido al catálogo global', 'success');
            }
            cancelEditing();
        } catch (err) {
            showToast('Error al guardar', mensajeAmigable(err, 'Verifica tu conexión'), 'error');
        } finally { setIsLoading(false); }
    };

    const handleDuplicate = useCallback((group) => {
        setEditingGroup(null);
        setCurrentForm({ start: group.start, end: group.end, name: group.name });
        showToast('Modo Duplicar', 'Ajusta las horas o el nombre y guarda el nuevo turno.', 'info');
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
        setCurrentForm({ start: group.start, end: group.end, name: group.name });
    }, []);

    const cancelEditing = useCallback(() => {
        setEditingGroup(null);
        setCurrentForm({ start: '', end: '', name: '' });
    }, []);

    const isEmpty = sortedShifts.length === 0 && globalInsights.length === 0;

    return (
        <div className="flex flex-col lg:flex-row items-start gap-6 md:gap-8 px-2 md:px-0 w-full h-[calc(100vh-230px)] lg:h-[calc(100vh-180px)]">
            <style>{`@keyframes subtle-shake { 0%,100%{transform:rotate(0deg) scale(1.01);}25%{transform:rotate(-0.5deg) scale(1.01);}75%{transform:rotate(0.5deg) scale(1.01);}} .animate-subtle-shake{animation:subtle-shake 0.4s ease-in-out infinite;}`}</style>

            {/* ── COLUMNA IZQUIERDA: FORMULARIO ── */}
            <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 z-sidebar transform-gpu">
                <div data-surface="card" className={`p-6 md:p-8 transition-all duration-700 ease-[var(--ease-spring)] flex flex-col hover:border-border-card hover:bg-surface-card transform-gpu ${editingGroup ? 'border-warning/40 shadow-[var(--shadow-glass-3)]' : 'border-border-card shadow-[var(--shadow-glass-sm)]'}`}>

                    <div className="flex justify-between items-center mb-6 relative z-base">
                        <h3 className="font-bold text-content flex items-center gap-2 text-subtitle">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${editingGroup ? 'bg-warning-solid' : 'bg-brand'}`}>
                                {editingGroup ? <Pencil size={16} strokeWidth={2.5} /> : <Target size={16} strokeWidth={2.5} />}
                            </div>
                            <span className="font-black uppercase tracking-tight ml-1">{editingGroup ? 'Editar Turno' : 'Nuevo Turno'}</span>
                        </h3>
                        {editingGroup && (
                            <Button variant="secondary" icon={X} onClick={cancelEditing}>Cancelar</Button>
                        )}
                    </div>

                    <form onSubmit={handleSaveShift} className="space-y-6 relative z-base flex-1 flex flex-col">
                        <div className="bg-surface-card-hover border border-divider p-3 rounded-xl flex items-start gap-2.5 mb-2">
                            <Globe size={16} className="text-content-3 mt-0.5 shrink-0" strokeWidth={2.5} />
                            <p className="text-label font-medium text-content-3 leading-snug">
                                Este turno se añadirá al <strong>Catálogo Global</strong> y podrá ser utilizado por cualquier sucursal.
                            </p>
                        </div>

                        <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                            <div className="pt-2 grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">Entrada</label>
                                    <TimePicker12 value={currentForm.start} onChange={v => setCurrentForm(f => ({ ...f, start: v }))} />
                                </div>
                                <div>
                                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">Salida</label>
                                    <TimePicker12 value={currentForm.end} onChange={v => setCurrentForm(f => ({ ...f, end: v }))} />
                                </div>
                            </div>
                        </div>

                        <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                            <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">Nombre del turno</label>
                            <div className="flex gap-2 mb-2">
                                <SegmentedControl
                                    layout="block" columns={3}
                                    options={['Apertura','Enlace','Cierre'].map(t => ({ value: t, label: t }))}
                                    value={currentForm.name}
                                    onChange={t => setCurrentForm(f => ({ ...f, name: t }))}
                                    label="Tipo de turno" className="mb-2" />
                            </div>
                            <PortalInput
                                aria-label="Nombre personalizado del turno"
                                value={currentForm.name}
                                onChange={e => setCurrentForm(f => ({ ...f, name: e.target.value }))}
                                placeholder={`Nombre personalizado (ej: ${autoName})`}
                            />
                        </div>

                        {currentForm.start && currentForm.end && (
                            <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                                <div data-surface="card" className="rounded-2xl p-4 border border-chart-9/30 shadow-[var(--shadow-glass-3)] relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-24 h-24 bg-chart-9 rounded-full blur-[50px] opacity-20 pointer-events-none" />
                                    <div className="flex items-center justify-between border-b border-border-card pb-3 mb-3 relative z-base">
                                        <div className="flex items-center gap-1.5 text-caption font-black text-chart-9 uppercase tracking-widest">
                                            <Bot size={13} /> SALY AI AUDITOR
                                        </div>
                                        <div className="flex items-center gap-1 text-chart-9/70 font-bold text-body-sm uppercase tracking-tight">
                                            <Sparkles size={13} className="text-chart-9" /> {autoName}
                                        </div>
                                    </div>
                                    <div className="relative z-base">
                                        {activeAlerts.length > 0 ? (
                                            <div className="flex flex-col gap-2.5">
                                                {activeAlerts.map((alert, idx) => (
                                                    <div key={idx} className={`p-3 rounded-xl flex items-start gap-2.5 border ${alert.type === 'error' ? 'bg-danger/20 border-danger/30 text-danger' : 'bg-warning/20 border-warning/30 text-warning'}`}>
                                                        {alert.type === 'error' ? <AlertCircle size={15} className="shrink-0 mt-0.5 text-danger-text" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5 text-warning" />}
                                                        <span className="text-label font-bold leading-snug">{alert.text}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="p-3 text-center">
                                                <CheckCircle2 size={24} className="text-success mx-auto" strokeWidth={1.5} />
                                                <p className="text-caption font-black text-success uppercase tracking-widest mt-2">Horario coherente</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <Button
                            type="submit"
                            size="lg"
                            className="w-full mt-auto"
                            loading={isLoading}
                            disabled={hasBlockingError || !currentForm.start || !currentForm.end}
                            tone={editingGroup ? 'warning' : null}
                            icon={editingGroup ? Save : Send}
                        >
                            {isLoading ? 'Procesando...' : editingGroup ? 'Guardar Cambios' : 'Registrar Turno'}
                        </Button>
                    </form>
                </div>
            </div>

            {/* ── COLUMNA DERECHA: CATÁLOGO ── */}
            <div className="flex-1 flex flex-col min-w-0 w-full h-[100dvh] overflow-y-auto overscroll-contain pb-32 scrollbar-hide -mt-[140px] md:-mt-[190px] pt-[140px] md:pt-[190px] pointer-events-auto">

                {/* Sub-tabs: Activos / Archivo */}
                <div className="flex items-center px-3 md:px-4 pt-4 pb-2">
                    <SegmentedControl
                        label="Turnos a mostrar"
                        value={shiftTab}
                        onChange={setShiftTab}
                        options={[{ value: 'ACTIVE', label: 'Activos' }, { value: 'ARCHIVED', label: 'Archivo' }]}
                    />
                </div>

                <div className="space-y-5 flex-1 px-3 md:px-4 pb-4">
                    {isEmpty ? (
                        <div className="flex flex-col items-center justify-center h-full min-h-[400px] animate-in fade-in zoom-in-95 duration-700 ease-[var(--ease-spring)]">
                            <div className="relative group flex flex-col items-center text-center">
                                <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${searchTerm ? 'bg-brand' : shiftTab === 'ACTIVE' ? 'bg-success' : 'bg-content-3'}`} />
                                <div className={`relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card backdrop-blur-xl border border-border-card shadow-[var(--shadow-elevation-md)] transition-all duration-700 ease-[var(--ease-spring)] group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] ${searchTerm ? 'text-brand-text' : shiftTab === 'ACTIVE' ? 'text-success' : 'text-content-3'}`}>
                                    {searchTerm ? <Search size={40} strokeWidth={2} /> : shiftTab === 'ACTIVE' ? <CheckCircle2 size={40} strokeWidth={2} /> : <Archive size={40} strokeWidth={2} />}
                                </div>
                                <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">
                                    {searchTerm ? 'Sin resultados' : shiftTab === 'ACTIVE' ? 'Catálogo al día' : 'Archivo vacío'}
                                </h3>
                                <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">
                                    {searchTerm ? `No hay turnos que coincidan con "${searchTerm}".` : shiftTab === 'ACTIVE' ? 'No hay turnos activos registrados.' : 'Aquí aparecerán los turnos archivados.'}
                                </p>
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
