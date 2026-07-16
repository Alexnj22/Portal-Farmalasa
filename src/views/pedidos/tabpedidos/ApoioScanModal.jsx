// Extracted from TabPedidos.jsx (Bloque 6.C) — carné scanner modal for
// registering apoyo (support staff) on a pedido, keydown-based scan capture.
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, ScanLine, Loader2, ShieldAlert, AlertTriangle, UserCircle2, CheckCheck } from 'lucide-react';
import { signPhotosDeep } from '../../../utils/storageFiles';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { useToastStore } from '../../../store/toastStore';
import PedidoModal from '../PedidoModal';
import { fetchEmployeeByKioskPin, upsertPedidoApoyo } from '../../../data/pedidos';

export default function ApoioScanModal({ open, onClose, pedidoId, sucId, currentUserId, existingApoyo = [], onSuccess, tipo = 'preparacion' }) {
    const [displayDots, setDisplayDots] = useState(0);
    const [employee,    setEmployee]    = useState(null);
    const [error,       setError]       = useState('');
    const [loading,     setLoading]     = useState(false);
    const [manualWarn,  setManualWarn]  = useState(false);

    const bufferRef   = useRef('');
    const lastTimeRef = useRef(0);
    const timerRef    = useRef(null);
    const isManRef    = useRef(false);

    useEffect(() => {
        if (!open) {
            bufferRef.current  = '';
            lastTimeRef.current = 0;
            isManRef.current   = false;
            setDisplayDots(0);
            setEmployee(null);
            setError('');
            setManualWarn(false);
        }
    }, [open]);

    const lookupPin = useCallback(async (code) => {
        setLoading(true);
        setError('');
        try {
            const { data, error } = await fetchEmployeeByKioskPin(code.toUpperCase().trim());
            if (error) console.error('lookupPin: fetch employee failed:', error.message);
            if (data) { await signPhotosDeep(data); setEmployee(data); setManualWarn(false); }
            else       setError(error ? 'Error al buscar empleado.' : 'No se encontró ningún empleado con ese carnet.');
        } catch { setError('Error al buscar empleado.'); }
        finally   { setLoading(false); }
    }, []);

    useEffect(() => {
        if (!open) return;
        const handleKey = (e) => {
            if (e.key === 'Escape') return;
            const now = Date.now();
            const gap = now - lastTimeRef.current;
            lastTimeRef.current = now;

            if (e.key === 'Enter') {
                const buf = bufferRef.current;
                bufferRef.current = '';
                setDisplayDots(0);
                clearTimeout(timerRef.current);
                if (buf.length >= 3 && !isManRef.current) lookupPin(buf);
                isManRef.current = false;
                return;
            }
            if (e.key.length !== 1) return;

            if (bufferRef.current.length > 0 && gap > 80) {
                // Manual typing detected
                isManRef.current = true;
                setManualWarn(true);
                setEmployee(null);
                bufferRef.current = e.key;
                setDisplayDots(1);
            } else {
                if (bufferRef.current.length === 0) isManRef.current = false;
                bufferRef.current += e.key;
                setDisplayDots(bufferRef.current.length);
            }

            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                bufferRef.current = '';
                isManRef.current  = false;
                setDisplayDots(0);
            }, 500);
        };
        document.addEventListener('keydown', handleKey, { capture: true });
        return () => { document.removeEventListener('keydown', handleKey, { capture: true }); clearTimeout(timerRef.current); };
    }, [open, lookupPin]);

    const confirmApoyo = useCallback(async () => {
        if (!employee) return;
        if (existingApoyo.some(a => a.id === employee.id)) {
            useToastStore.getState().showToast(
                'Ya está de apoyo',
                `${employee.name} ya está registrado en este pedido.`,
                'warning'
            );
            onClose();
            return;
        }
        setLoading(true);
        try {
            const { error: e } = await upsertPedidoApoyo(
                { pedido_id: pedidoId, erp_sucursal_id: sucId, employee_id: employee.id, registered_by: currentUserId, tipo }
            );
            if (e) throw e;
            useStaff.getState().appendAuditLog('PEDIDO_APOYO_REGISTRADO', pedidoId, { sucursal_id: sucId, employee_id: employee.id });
            onSuccess(employee);
            onClose();
        } catch (err) { setError(err?.message || 'Error al registrar apoyo.'); }
        finally  { setLoading(false); }
    }, [employee, existingApoyo, pedidoId, sucId, currentUserId, tipo, onSuccess, onClose]);

    return (
        <PedidoModal open={open} onClose={onClose}>
                <PedidoModal.Header>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center shadow-sm shrink-0">
                            <Users size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 text-[15px]">Apoyo — {tipo === 'recepcion' ? 'Recepción' : 'Preparación'}</h3>
                            <p className="text-[12px] text-slate-600 mt-0.5">Escanea el carnet del empleado</p>
                        </div>
                    </div>
                </PedidoModal.Header>

                <PedidoModal.Body className="space-y-4">
                    {!employee && (
                        <div className="flex flex-col items-center gap-3 py-3">
                            <div className="relative w-16 h-16 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center">
                                <motion.div
                                    className="absolute inset-0 rounded-2xl border-2 border-blue-400 pointer-events-none"
                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                    transition={{ duration: 1.6, repeat: Infinity }}
                                />
                                <ScanLine size={28} className="text-blue-500" />
                                {loading && (
                                    <div className="absolute inset-0 rounded-2xl bg-white/80 flex items-center justify-center">
                                        <Loader2 size={18} className="animate-spin text-blue-500" />
                                    </div>
                                )}
                            </div>

                            {displayDots > 0 && (
                                <div className="flex gap-1.5 h-3 items-center">
                                    {Array.from({ length: Math.min(displayDots, 10) }).map((_, i) => (
                                        <motion.div key={i}
                                            className="w-2 h-2 rounded-full bg-blue-400"
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            transition={{ type: 'spring', stiffness: 600, delay: i * 0.02 }}
                                        />
                                    ))}
                                    {displayDots > 10 && <span className="text-[10px] text-blue-400">+{displayDots - 10}</span>}
                                </div>
                            )}

                            <p className="text-[12px] text-slate-600 text-center">
                                Apunta el escáner al código de barras<br />del carnet del empleado
                            </p>
                        </div>
                    )}

                    {employee && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200"
                        >
                            {employee.photo_url
                                ? <img src={employee.photo_url} className="w-12 h-12 rounded-full object-cover border-2 border-white shadow" alt="" />
                                : <div className="w-12 h-12 rounded-full bg-emerald-200 flex items-center justify-center shrink-0"><UserCircle2 size={24} className="text-emerald-600" /></div>
                            }
                            <div>
                                <p className="font-bold text-emerald-800 text-[14px]">{employee.name}</p>
                                <p className="text-[11px] text-emerald-600 mt-0.5">Confirma para registrar como apoyo</p>
                            </div>
                        </motion.div>
                    )}

                    {manualWarn && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700">
                            <ShieldAlert size={14} className="shrink-0 text-red-500" />
                            Solo se acepta escaneo. No se permite ingreso manual del teclado.
                        </div>
                    )}
                    {error && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700">
                            <AlertTriangle size={14} className="shrink-0 text-red-500" />
                            {error}
                        </div>
                    )}
                </PedidoModal.Body>

                <PedidoModal.Footer>
                    <div className="flex justify-between gap-2">
                        <button onClick={() => { setEmployee(null); setDisplayDots(0); setError(''); setManualWarn(false); bufferRef.current = ''; }}
                            className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-[12px] transition-colors">
                            Limpiar
                        </button>
                        <div className="flex gap-2">
                            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-[13px] font-medium transition-colors">
                                Cancelar
                            </button>
                            {employee && (
                                <button onClick={confirmApoyo} disabled={loading}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 text-[13px] transition-colors disabled:opacity-50 shadow-sm"
                                >
                                    {loading ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}
                                    Confirmar
                                </button>
                            )}
                        </div>
                    </div>
                </PedidoModal.Footer>
        </PedidoModal>
    );
}
