import React, { useState, useEffect, useRef, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import LiquidSelect from '../../../components/common/LiquidSelect'; // Ajusta la ruta si es necesario
import TimePicker12 from '../../../components/common/TimePicker12'; // Ajusta la ruta si es necesario

// 🚨 Recibimos filterBranch como prop
const InlineDayEditor = memo(({ employee, dateStr, dayId, currentData, shifts, filterBranch, onClose, onSave, anchorRect }) => {
    const [shiftId, setShiftId] = useState(() => {
        if (currentData?.shiftId) return String(currentData.shiftId);
        if (currentData?.isOff) return 'OFF';
        return '';
    });
    
    const [customStart, setCustomStart] = useState(currentData?.customStart || '');
    const [customEnd, setCustomEnd] = useState(currentData?.customEnd || '');
    const [hasLunch, setHasLunch] = useState(currentData?.hasLunch || false);
    const [lunchStart, setLunchStart] = useState(currentData?.lunchStart || '12:00');
    const [hasLactation, setHasLactation] = useState(currentData?.hasLactation || false);
    const [lactationStart, setLactationStart] = useState(currentData?.lactationStart || '15:00');

    const [pos, setPos] = useState({ top: -9999, left: -9999, opacity: 0 });
    const popoverRef = useRef(null);

    // 🚨 FILTRO ESTRICTO: Solo turnos de la sucursal activa en la vista (filterBranch)
    const filteredShifts = useMemo(() => {
        if (!shifts || !filterBranch) return shifts || [];
        
        const targetBranch = String(filterBranch);
        
        return shifts.filter(s => {
            const shiftBranchId = String(s.branch_id || s.branchId);
            // Retorna true si es de la sucursal seleccionada, o si es un turno general (sin sucursal)
            return shiftBranchId === targetBranch || shiftBranchId === 'null' || shiftBranchId === 'undefined' || (!s.branch_id && !s.branchId);
        });
    }, [shifts, filterBranch]);

    useEffect(() => {
        if (shiftId && shiftId !== 'OFF') {
            const template = filteredShifts.find(s => String(s.id) === String(shiftId));
            if (template && !currentData?.customStart) {
                setCustomStart(template.start_time?.substring(0, 5) || template.start);
                setCustomEnd(template.end_time?.substring(0, 5) || template.end);
            }
        }
    }, [shiftId, filteredShifts, currentData]);

    // 🚨 CÁLCULO DE POSICIÓN INTELIGENTE Y REACTIVO
    useEffect(() => {
        if (popoverRef.current && anchorRect) {
            const popRect = popoverRef.current.getBoundingClientRect();
            
            let left = anchorRect.left + 10;
            let top;

            if (anchorRect.top > window.innerHeight / 2) {
                top = anchorRect.top - popRect.height - 10;
            } else {
                top = anchorRect.bottom + 10; 
            }

            if (top < 10) top = 10;
            if (top + popRect.height > window.innerHeight) {
                top = window.innerHeight - popRect.height - 10;
            }

            if (left + popRect.width > window.innerWidth) {
                left = window.innerWidth - popRect.width - 10;
            }

            setPos({ top, left, opacity: 1 });
        }
    }, [anchorRect, shiftId, hasLunch, hasLactation]);

    useEffect(() => {
        const handleScroll = () => onClose();
        const tableScroll = document.getElementById('schedule-table-scroll');
        if (tableScroll) tableScroll.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            if (tableScroll) tableScroll.removeEventListener('scroll', handleScroll);
            window.removeEventListener('scroll', handleScroll);
        };
    }, [onClose]);

    const handleSave = () => {
        const isOffSelected = shiftId === 'OFF';
        const finalShiftId = isOffSelected ? '' : shiftId;
        const finalIsOff = isOffSelected || (!finalShiftId && !customStart);

        onSave(dayId, {
            shiftId: finalShiftId, 
            customStart: finalIsOff ? '' : customStart, 
            customEnd: finalIsOff ? '' : customEnd, 
            hasLunch: finalIsOff ? false : hasLunch, 
            lunchStart: (hasLunch && !finalIsOff) ? lunchStart : null,
            hasLactation: finalIsOff ? false : hasLactation, 
            lactationStart: (hasLactation && !finalIsOff) ? lactationStart : null, 
            isOff: finalIsOff
        });
        onClose();
    };

    // 🚨 Opciones del select generadas a partir de la lista ya filtrada
    const shiftOptions = useMemo(() => {
        return [
            { value: 'OFF', label: 'Libre / Descanso' }, 
            ...filteredShifts.map(s => {
                const start = s.start_time?.substring(0, 5) || s.start?.substring(0, 5) || '';
                const end = s.end_time?.substring(0, 5) || s.end?.substring(0, 5) || '';
                return { 
                    value: String(s.id), 
                    label: `${s.name} (${start} - ${end})` 
                };
            })
        ];
    }, [filteredShifts]);

    return createPortal(
        <>
            <style>{`
                .editor-scrollbar::-webkit-scrollbar { width: 6px; }
                .editor-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .editor-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(148, 163, 184, 0.4); border-radius: 10px; }
            `}</style>
            
            <div className="fixed inset-0 z-[9990]" onClick={(e) => { e.stopPropagation(); onClose(); }}></div>

            <div
                ref={popoverRef}
                style={{ top: pos.top, left: pos.left, opacity: pos.opacity, visibility: pos.opacity === 0 ? 'hidden' : 'visible' }}
                className="fixed z-[9991] w-[290px] max-h-[85vh] bg-white/95 backdrop-blur-3xl rounded-3xl shadow-[0_30px_100px_rgba(0,0,0,0.3)] border border-white transition-opacity duration-200 flex flex-col cursor-default transform-gpu"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-white/50 shrink-0 rounded-t-3xl z-40">
                    <div>
                        <p className="text-[11px] font-black text-[#007AFF] uppercase tracking-widest leading-none mb-1">{new Date(dateStr + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long' })}</p>
                        <p className="text-[14px] font-bold text-slate-700 leading-none">{new Date(dateStr + 'T00:00:00').getDate()}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-red-50 hover:text-red-500 text-slate-500 flex items-center justify-center transition-colors active:scale-95"><X size={16} strokeWidth={3} /></button>
                </div>

                <div className="px-4 pt-4 pb-2 shrink-0 relative z-[9999]">
                    <div className="group/select hover:shadow-md transition-shadow duration-300 rounded-full relative">
                        <LiquidSelect 
                            value={shiftId} 
                            onChange={setShiftId} 
                            options={shiftOptions} 
                            placeholder="Seleccionar Turno..." 
                            clearable={false} 
                            compact 
                        />
                    </div>
                </div>

                <div className="px-4 pb-4 space-y-4 overflow-y-auto editor-scrollbar flex-1 relative z-10">
                    {(shiftId && shiftId !== 'OFF' || customStart) && (
                        <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-100 rounded-2xl shadow-[inset_0_1px_4px_rgba(0,0,0,0.02)] relative z-10 animate-in zoom-in-95 duration-200">
                            <div className="group/time hover:-translate-y-0.5 transition-transform duration-300">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block group-hover/time:text-[#007AFF] transition-colors">Entrada</label>
                                <TimePicker12 value={customStart} onChange={setCustomStart} />
                            </div>
                            <div className="group/time hover:-translate-y-0.5 transition-transform duration-300">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block group-hover/time:text-[#007AFF] transition-colors">Salida</label>
                                <TimePicker12 value={customEnd} onChange={setCustomEnd} />
                            </div>
                        </div>
                    )}

                    {(shiftId && shiftId !== 'OFF' || customStart) && (
                        <div className="space-y-3 relative z-10 animate-in fade-in duration-300">
                            <div className="flex items-center justify-between bg-white border border-orange-100 p-3 rounded-2xl shadow-sm hover:shadow-md hover:border-orange-300 transition-all duration-300 group/row">
                                <label className="flex items-center gap-2.5 cursor-pointer">
                                    <input type="checkbox" checked={hasLunch} onChange={() => setHasLunch(!hasLunch)} className="w-4 h-4 rounded text-orange-500 border-orange-200 focus:ring-orange-500 cursor-pointer transition-transform group-hover/row:scale-110" />
                                    <span className="text-[12px] font-bold text-orange-600 group-hover/row:text-orange-700 transition-colors">Almuerzo</span>
                                </label>
                                {hasLunch && <div className="w-[100px] animate-in fade-in slide-in-from-right-2 duration-300"><TimePicker12 value={lunchStart} onChange={setLunchStart} /></div>}
                            </div>
                            <div className="flex items-center justify-between bg-white border border-pink-100 p-3 rounded-2xl shadow-sm hover:shadow-md hover:border-pink-300 transition-all duration-300 group/row">
                                <label className="flex items-center gap-2.5 cursor-pointer">
                                    <input type="checkbox" checked={hasLactation} onChange={() => setHasLactation(!hasLactation)} className="w-4 h-4 rounded text-pink-500 border-pink-200 focus:ring-pink-500 cursor-pointer transition-transform group-hover/row:scale-110" />
                                    <span className="text-[12px] font-bold text-pink-600 group-hover/row:text-pink-700 transition-colors">Lactancia</span>
                                </label>
                                {hasLactation && <div className="w-[100px] animate-in fade-in slide-in-from-right-2 duration-300"><TimePicker12 value={lactationStart} onChange={setLactationStart} /></div>}
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-3 border-t border-slate-100 bg-white/50 shrink-0 rounded-b-3xl z-30">
                    <button onClick={handleSave} className="w-full py-3.5 bg-gradient-to-r from-[#007AFF] to-[#005CE6] text-white text-[12px] font-black uppercase tracking-widest rounded-xl shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 transition-all duration-300 active:scale-95 active:translate-y-0">
                        Guardar Cambios
                    </button>
                </div>
            </div>
        </>,
        document.body
    );
});

export default InlineDayEditor;