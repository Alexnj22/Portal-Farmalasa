import React, { useState } from 'react';
import { CalendarClock, PackageX, Wallet } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import Notice from '../../components/common/Notice';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { vigenciaDelSaldo } from '@nucleo/utils/abonoTicket';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useToastStore } from '@nucleo/store/toastStore';

// Quien llama avisa sus propios errores; esto cubre el que se le escape, para
// que el botón no quede trabado ni el fallo pase en silencio.
const avisarFallo = (showToast, err) => showToast('No se pudo', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');

// ═══════════════════════════════════════════════════════════════════════════
// Las dos acciones de un encargo que trae el reglamento de reservas v2 (rige
// desde `reglas_v2_desde()`, 2026-11-15). Las habilita la base
// (`puede_cambiar_fecha`, `puede_no_entrego` de `encargos_de_sucursal`), así
// que antes de la fecha no aparecen. Cada diálogo tiene dos campos cortos y se
// resuelve en el momento, por eso no guarda borrador.
// ═══════════════════════════════════════════════════════════════════════════

// Cláusula 4.4: la fecha estimada no es garantizada; si cambia, se le avisa al
// cliente. Lo hace Compras (o administración); la base manda el aviso.
export function CambiarFecha({ encargo, onClose, onGuardar }) {
    const [fecha, setFecha] = useState(encargo.fecha_estimada && encargo.fecha_estimada >= hoySV() ? encargo.fecha_estimada : sumarDias(hoySV(), 3));
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const showToast = useToastStore((s) => s.showToast);
    const valida = fecha && fecha >= hoySV() && fecha !== encargo.fecha_estimada;
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Cambiar la fecha del encargo">
            <LiquidModal.Header titulo={`Nueva fecha para ${encargo.codigo}`}
                subtitulo={<>{encargo.cantidad} × {encargo.producto}{encargo.fecha_estimada ? ` · hoy dice ${fechaTexto(encargo.fecha_estimada, { day: 'numeric', month: 'long' })}` : ''}</>}
                onClose={onClose} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Llega aproximadamente</span>
                        <LiquidDatePicker value={fecha} onChange={setFecha} />
                    </div>
                    <PortalTextarea label="Motivo para el cliente (opcional)" rows={2} value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Ej. El proveedor atrasó el envío" />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Volver</Button>
                <Button icon={CalendarClock} loading={enviando} disabled={!valida}
                    onClick={async () => { setEnviando(true); try { await onGuardar(fecha, motivo.trim() || null); } catch (err) { avisarFallo(showToast, err); } finally { setEnviando(false); } }}>Cambiar y avisar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

// Cláusula 4.6: el proveedor no entregó. Es el CLIENTE quien elige: aplicar lo
// pagado a otro producto (saldo a favor) o la devolución completa, que se
// tramita como devolución en efectivo (cláusula 8.3, procedimiento §5): la sala
// la pide, administración la autoriza o la niega, y la sala la entrega.
export function NoEntrego({ encargo, reglas, onClose, onResolver }) {
    const [eleccion, setEleccion] = useState('devolucion');
    const [nota, setNota] = useState('');
    const [enviando, setEnviando] = useState(false);
    const showToast = useToastStore((s) => s.showToast);
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="El proveedor no entregó">
            <LiquidModal.Header titulo={`El proveedor no entregó ${encargo.codigo}`}
                subtitulo={<>{encargo.cantidad} × {encargo.producto} · pagado {formatMoney(encargo.anticipo)}</>}
                onClose={onClose} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    <SegmentedControl label="Qué eligió el cliente" value={eleccion} onChange={setEleccion} layout="block" columns={2}
                        options={[{ value: 'devolucion', label: 'Devolución completa' }, { value: 'saldo', label: 'Otro producto' }]} />
                    <Notice variant="info" compact icon={eleccion === 'devolucion' ? PackageX : Wallet}>
                        {eleccion === 'devolucion'
                            ? `Se pide la devolución de ${formatMoney(encargo.anticipo)} en efectivo. Administración la autoriza o la niega; cuando esté autorizada, se entrega desde Reservas. Mientras tanto queda a su favor.`
                            : `Lo pagado queda a su favor por ${vigenciaDelSaldo(reglas)}, para otro producto en cualquier sucursal. No se deshace.`}
                    </Notice>
                    <PortalTextarea label="Nota (opcional)" rows={2} value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)}
                        placeholder="Ej. El proveedor lo descontinuó" />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Volver</Button>
                <Button icon={eleccion === 'devolucion' ? PackageX : Wallet} loading={enviando}
                    onClick={async () => { setEnviando(true); try { await onResolver(eleccion, nota.trim() || null); } catch (err) { avisarFallo(showToast, err); } finally { setEnviando(false); } }}>
                    {eleccion === 'devolucion' ? 'Pedir la devolución' : 'Dejar a su favor'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
