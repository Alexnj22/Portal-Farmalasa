// Extracted from TabPedidos.jsx (Bloque 6.C) — carné scanner modal for
// registering apoyo (support staff) on a pedido, keydown-based scan capture.
import { useState, useEffect, useRef, useCallback } from 'react';
import Button from '../../../components/common/Button';
import { SkeletonText } from '../../../components/common/StateViews';
import { Users, ScanLine, Loader2, ShieldAlert, AlertTriangle, UserCircle2, Check } from 'lucide-react';
import { signPhotosDeep } from '../../../utils/storageFiles';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { useToastStore } from '../../../store/toastStore';
import PedidoModal from '../PedidoModal';
import { fetchEmployeeByKioskPin, upsertPedidoApoyo } from '../../../data/pedidos';
import { mensajeAmigable } from '../../../utils/errorMessages';

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
        } catch (err) { setError(mensajeAmigable(err, 'Error al registrar apoyo.')); }
        finally  { setLoading(false); }
    }, [employee, existingApoyo, pedidoId, sucId, currentUserId, tipo, onSuccess, onClose]);

    return (
        <PedidoModal open={open} onClose={onClose}>
                <PedidoModal.Header>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-chart-1 flex items-center justify-center shadow-sm shrink-0">
                            <Users size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-content text-subtitle">Apoyo — {tipo === 'recepcion' ? 'Recepción' : 'Preparación'}</h3>
                            <p className="text-body-sm text-content-2 mt-0.5">Escanea el carnet del empleado</p>
                        </div>
                    </div>
                </PedidoModal.Header>

                <PedidoModal.Body className="space-y-4">
                    {!employee && (
                        <div className="flex flex-col items-center gap-3 py-3">
                            <div className="relative w-16 h-16 rounded-2xl bg-chart-1/10 border-2 border-chart-1/30 flex items-center justify-center">
                                {/* §11 — el latido del aro del escáner es
                                    `animate-pulse` de Tailwind, que además se apaga
                                    solo en Solid y con `prefers-reduced-motion`. Con
                                    framer-motion latía en los cuatro temas. */}
                                <div className="absolute inset-0 rounded-2xl border-2 border-chart-1 pointer-events-none animate-pulse" />
                                <ScanLine size={28} className="text-chart-1-text" />
                                {loading && (
                                    <div className="absolute inset-0 rounded-2xl bg-surface-card flex items-center justify-center"><SkeletonText lines={4} className="w-full max-w-md" /></div>
                                )}
                            </div>

                            {displayDots > 0 && (
                                <div className="flex gap-1.5 h-3 items-center">
                                    {Array.from({ length: Math.min(displayDots, 10) }).map((_, i) => (
                                        <div key={i}
                                            className="w-2 h-2 rounded-full bg-chart-1 animate-in zoom-in duration-[var(--dur-base)]"
                                            style={{ animationDelay: `${i * 20}ms` }}
                                        />
                                    ))}
                                    {displayDots > 10 && <span className="text-caption text-chart-1-text">+{displayDots - 10}</span>}
                                </div>
                            )}

                            <p className="text-body-sm text-content-2 text-center">
                                Apunta el escáner al código de barras<br />del carnet del empleado
                            </p>
                        </div>
                    )}

                    {employee && (
                        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-success/10 border border-success/30
                            animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-base)]">
                            {employee.photo_url
                                ? <img src={employee.photo_url} className="w-12 h-12 rounded-full object-cover border-2 border-border-card shadow" alt="" />
                                : <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center shrink-0"><UserCircle2 size={24} className="text-success" /></div>
                            }
                            <div>
                                <p className="font-bold text-success-text text-body-lg">{employee.name}</p>
                                <p className="text-label text-success-text mt-0.5">Confirma para registrar como apoyo</p>
                            </div>
                        </div>
                    )}

                    {manualWarn && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-body-sm text-danger-text">
                            <ShieldAlert size={14} className="shrink-0 text-danger" />
                            Solo se acepta escaneo. No se permite ingreso manual del teclado.
                        </div>
                    )}
                    {error && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-body-sm text-danger-text">
                            <AlertTriangle size={14} className="shrink-0 text-danger" />
                            {error}
                        </div>
                    )}
                </PedidoModal.Body>

                <PedidoModal.Footer>
                    <div className="flex justify-between gap-2">
                        <Button variant="secondary" onClick={() => { setEmployee(null); setDisplayDots(0); setError(''); setManualWarn(false); bufferRef.current = ''; }}>Limpiar</Button>
                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                            {employee && (
                                <Button disabled={loading} onClick={confirmApoyo}>{loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                    Confirmar</Button>
                            )}
                        </div>
                    </div>
                </PedidoModal.Footer>
        </PedidoModal>
    );
}
