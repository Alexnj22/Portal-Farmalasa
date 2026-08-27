// Extracted from TabPedidos.jsx (Bloque 6.C) — carné scanner modal for
// registering apoyo (support staff) on a pedido.
//
// La captura del escaneo y el panel que la dibuja salieron de acá el
// 2026-08-17 (`hooks/useCapturaDeCarne` + `components/common/EsperaDeCarne`):
// la entrega del efectivo pide lo mismo, y el usuario la pidió «así como
// apoyo». Dos copias del detector se corrigen por separado — que es justo lo
// que pasó con el PIN contra el código.
import { useState, useEffect, useCallback } from 'react';
import Button from '../../../components/common/Button';
import Badge from '../../../components/common/Badge';
import EsperaDeCarne from '../../../components/common/EsperaDeCarne';
import AvatarConEstado from '../../../components/common/AvatarConEstado';
import { Users, Loader2, AlertTriangle, UserCircle2, Check } from 'lucide-react';
import { signPhotosDeep } from '../../../utils/storageFiles';
import useCapturaDeCarne from '../../../hooks/useCapturaDeCarne';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { useToastStore } from '../../../store/toastStore';
import PedidoModal from '../PedidoModal';
import { fetchEmployeeByKioskPin, upsertPedidoApoyo } from '../../../data/pedidos';
import { mensajeAmigable } from '../../../utils/errorMessages';
import { shortEmployeeName } from '../../../utils/nameUtils';

export default function ApoioScanModal({ open, onClose, pedidoId, sucId, currentUserId, existingApoyo = [], onSuccess, tipo = 'preparacion' }) {
    const [employee,    setEmployee]    = useState(null);
    const [error,       setError]       = useState('');
    const [loading,     setLoading]     = useState(false);
    // Cuántos entraron en esta pasada. No es lo mismo que `existingApoyo`, que
    // trae también a los que ya estaban de antes: esto es lo que acaba de hacer
    // quien está parado frente a la pantalla.
    const [anotados,    setAnotados]    = useState([]);

    const lookupPin = useCallback(async (code) => {
        setLoading(true);
        setError('');
        try {
            const { data, error } = await fetchEmployeeByKioskPin(code.toUpperCase().trim());
            // El servidor tiene DOS respuestas distintas y antes se mostraban
            // como una sola: «no reconozco ese carné» y «llevas demasiados
            // carnés seguidos sin reconocer, espera unos minutos». La segunda
            // llega como error y decía «Error al buscar empleado», que no dice
            // qué hacer — y es justo la que aparece después de insistir.
            if (error) { setError(mensajeAmigable(error, 'No se pudo confirmar el carné.')); return; }
            if (data) { await signPhotosDeep(data); setEmployee(data); }
            else       setError('Ese carné no es de nadie de esta sucursal.');
        } catch (err) { setError(mensajeAmigable(err, 'No se pudo confirmar el carné.')); }
        finally   { setLoading(false); }
    }, []);

    const { teclas, manual, limpiar } = useCapturaDeCarne(open, lookupPin);

    // Un tecleo a mano deja al que se acababa de reconocer fuera de la pantalla:
    // lo que se confirma es lo que ENTRÓ por el lector, y nada más.
    const reconocido = manual ? null : employee;

    useEffect(() => {
        if (!open) {
            setEmployee(null);
            setError('');
            setAnotados([]);
            limpiar();
        }
    }, [open, limpiar]);

    // Queda listo para el carné siguiente, sin cerrar. En Bodega se anotan
    // varios seguidos y hasta el 2026-08-17 cada uno costaba volver a abrir el
    // modal desde la tarjeta.
    const listoParaElSiguiente = useCallback(() => {
        setEmployee(null);
        setError('');
        limpiar();
    }, [limpiar]);

    const confirmApoyo = useCallback(async () => {
        if (!employee) return;
        if (existingApoyo.some(a => a.id === employee.id)) {
            useToastStore.getState().showToast(
                'Ya está de apoyo',
                `${shortEmployeeName(employee)} ya está registrado en este pedido.`,
                'warning'
            );
            listoParaElSiguiente();
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
            setAnotados(prev => prev.some(a => a.id === employee.id) ? prev : [...prev, employee]);
            // Anotar a alguien NO cierra: el escáner queda esperando el
            // siguiente carné. Se cierra desde «Listo», y para entonces cada
            // apoyo ya está guardado — no hay nada pendiente de confirmar.
            listoParaElSiguiente();
        } catch (err) { setError(mensajeAmigable(err, 'No se pudo registrar el apoyo.')); }
        finally  { setLoading(false); }
    }, [employee, existingApoyo, pedidoId, sucId, currentUserId, tipo, onSuccess, listoParaElSiguiente]);

    return (
        <PedidoModal open={open} onClose={onClose}>
                <PedidoModal.Header>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-chart-1 flex items-center justify-center shadow-sm shrink-0">
                            <Users size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-content text-subtitle">Apoyo — {tipo === 'recepcion' ? 'Recepción' : 'Preparación'}</h3>
                            <p className="text-body-sm text-content-2 mt-0.5">Escanea los carnés, uno tras otro</p>
                        </div>
                    </div>
                </PedidoModal.Header>

                <PedidoModal.Body className="space-y-4">
                    {!reconocido && (
                        <EsperaDeCarne teclas={teclas} manual={manual} ocupado={loading} />
                    )}

                    {reconocido && (
                        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-success/10 border border-success/30
                            animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-base)]">
                            {reconocido.photo_url
                                ? <img src={reconocido.photo_url} className="w-12 h-12 rounded-full object-cover border-2 border-border-card shadow" alt="" />
                                : <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center shrink-0"><UserCircle2 size={24} className="text-success" /></div>
                            }
                            <div>
                                <p className="font-bold text-success-text text-body-lg">{shortEmployeeName(reconocido)}</p>
                                <p className="text-label text-success-text mt-0.5">Confirma para registrar como apoyo</p>
                            </div>
                        </div>
                    )}

                    {/* Lo que ya quedó guardado en esta pasada. Sin esto, cada
                        escaneo borraba al anterior de la pantalla y no había
                        forma de saber cuántos llevabas — y como el modal ya no
                        se cierra al confirmar, esa cuenta es justamente lo que
                        dice si falta alguien. Mismo canónico que los chips de
                        apoyo de la tarjeta: `Badge` neutro + `LiquidAvatar`, y
                        la foto por `photo` (firmada) antes que `photo_url`. */}
                    {anotados.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-caption font-semibold text-content-2 uppercase tracking-wide shrink-0">
                                {anotados.length === 1 ? 'Anotado:' : `Anotados (${anotados.length}):`}
                            </span>
                            {anotados.map(a => (
                                <Badge key={a.id} variant="success" uppercase={false} className="pl-1">
                                    <AvatarConEstado emp={a} px={20} radio="rounded-full" marco="" />
                                    {shortEmployeeName(a)}
                                </Badge>
                            ))}
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
                        <Button variant="secondary" onClick={listoParaElSiguiente}>Limpiar</Button>
                        <div className="flex gap-2">
                            {/* «Cancelar» mientras no se anotó a nadie; «Listo»
                                en cuanto hay alguien guardado, porque cerrar ya
                                no deshace nada. */}
                            <Button variant="secondary" onClick={onClose}>{anotados.length > 0 ? 'Listo' : 'Cancelar'}</Button>
                            {reconocido && (
                                <Button disabled={loading} onClick={confirmApoyo}>{loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                    Confirmar</Button>
                            )}
                        </div>
                    </div>
                </PedidoModal.Footer>
        </PedidoModal>
    );
}
