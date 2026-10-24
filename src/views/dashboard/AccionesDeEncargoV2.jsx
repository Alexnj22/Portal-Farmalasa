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
    const valida = fecha && fecha >= hoySV() && fecha !== encargo.fecha_estimada;
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Cambiar la fecha del encargo">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{`Nueva fecha para ${encargo.codigo}`}</h2>
                <p className="text-body-sm text-content-2">{encargo.cantidad} × {encargo.producto}{encargo.fecha_estimada ? ` · hoy dice ${fechaTexto(encargo.fecha_estimada, { day: 'numeric', month: 'long' })}` : ''}</p>
            </LiquidModal.Header>
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
                    onClick={async () => { setEnviando(true); await onGuardar(fecha, motivo.trim() || null); setEnviando(false); }}>Cambiar y avisar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

// Cláusula 4.6: el proveedor no entregó. Es el CLIENTE quien elige: la
// devolución completa (sale autorizada, se entrega como vale de caja desde
// Reservas) o dejarlo a su favor para otro producto.
export function NoEntrego({ encargo, reglas, onClose, onResolver }) {
    const [eleccion, setEleccion] = useState('devolucion');
    const [nota, setNota] = useState('');
    const [enviando, setEnviando] = useState(false);
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="El proveedor no entregó">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{`El proveedor no entregó ${encargo.codigo}`}</h2>
                <p className="text-body-sm text-content-2">{encargo.cantidad} × {encargo.producto} · pagado {formatMoney(encargo.anticipo)}</p>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <SegmentedControl label="Qué eligió el cliente" value={eleccion} onChange={setEleccion} layout="block" columns={2}
                        options={[{ value: 'devolucion', label: 'Devolución completa' }, { value: 'saldo', label: 'Saldo a favor' }]} />
                    <Notice variant="info" compact icon={eleccion === 'devolucion' ? PackageX : Wallet}>
                        {eleccion === 'devolucion'
                            ? `Se le devuelve todo (${formatMoney(encargo.anticipo)}) en efectivo. Queda en Reservas como «Entregar en efectivo» y sale como vale de caja.`
                            : `Lo pagado queda a su favor por ${vigenciaDelSaldo(reglas)}, para otro producto en cualquier sucursal.`}
                        {' '}No se deshace.
                    </Notice>
                    <PortalTextarea label="Nota (opcional)" rows={2} value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)}
                        placeholder="Ej. El proveedor lo descontinuó" />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Volver</Button>
                <Button icon={eleccion === 'devolucion' ? PackageX : Wallet} loading={enviando}
                    onClick={async () => { setEnviando(true); await onResolver(eleccion, nota.trim() || null); setEnviando(false); }}>
                    {eleccion === 'devolucion' ? 'Devolver todo' : 'Dejar a su favor'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
