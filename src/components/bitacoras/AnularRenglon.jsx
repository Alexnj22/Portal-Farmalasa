import React, { useCallback, useState } from 'react';
import { AlertTriangle, Ban } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalTextarea from '../common/PortalTextarea';
import { MOTIVOS_ANULACION, anularRenglon } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Anular un renglón. Nunca se borra.
//
// Un libro foliado no pierde renglones: los tacha con el motivo al lado, y el
// número sigue ahí. Un folio que falta es una pregunta que hay que contestar
// delante de un inspector.
//
// ── El motivo sale de una lista, no de un campo libre ──────────────────────
// Con texto libre el libro se llena de «anulada» y deja de poder contestar
// cuántas devoluciones hubo — que es justo lo que pide el ítem 3.2 de la guía:
// «son registradas las devoluciones realizadas por antibiótico».
//
// ── Anular puede REABRIR una receta ────────────────────────────────────────
// Si el paciente devolvió lo último que se le entregó, esa receta vuelve a
// tener pendiente. La cuenta la rehace la base; acá sólo se muestra.
// ═══════════════════════════════════════════════════════════════════════════

const num = (v) => (v === null || v === undefined ? '—' : String(Number(v)));

export default function AnularRenglon({ renglon, onCerrar }) {
    const [motivo, setMotivo]   = useState('');
    const [detalle, setDetalle] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError]     = useState(null);

    const faltaDetalle = motivo === 'otro' && !detalle.trim();

    const anular = useCallback(async () => {
        setGuardando(true);
        setError(null);
        const { resultado, error: err } = await anularRenglon({
            dispensacionId: renglon.id, motivo, detalle,
        });
        setGuardando(false);
        if (err) { setError(err); return; }
        onCerrar(true, resultado);
    }, [renglon.id, motivo, detalle, onCerrar]);

    return (
        <LiquidModal open onClose={guardando ? undefined : () => onCerrar(false)}
            maxWidth="max-w-md" className="h-fit" ariaLabel="Anular el renglón">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Anular el folio {renglon.folio_txt}</h3>
                    <p className="text-caption text-content-3 truncate">
                        {renglon.producto_nombre} · {num(renglon.cantidad)}
                        {renglon.lote ? ` · lote ${renglon.lote}` : ''}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                <Notice variant="info" icon={Ban}>
                    <span className="font-bold">El renglón no se borra: queda tachado con el motivo.</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        El folio sigue en el libro. Un número que falta es una pregunta que hay que
                        contestar delante de un inspector.
                    </span>
                </Notice>

                <LiquidSelect
                    label="Por qué se anula"
                    value={motivo} onChange={(v) => setMotivo(v || '')}
                    options={MOTIVOS_ANULACION}
                    placeholder="Elige el motivo…"
                />

                {motivo === 'devolucion' && (
                    <Notice variant="warning">
                        <span className="font-bold">La devolución queda registrada como tal.</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Si esta entrega pertenecía a una receta, esa receta vuelve a tener pendiente
                            lo que se devolvió.
                        </span>
                    </Notice>
                )}

                <PortalTextarea
                    label={motivo === 'otro' ? 'Cuál' : 'Detalle (opcional)'}
                    name="detalle" required={motivo === 'otro'}
                    value={detalle} onChange={(e) => setDetalle(e.target.value)} rows={3}
                    placeholder={motivo === 'devolucion'
                        ? 'El paciente devolvió el frasco sin abrir.'
                        : 'Qué pasó con este renglón.'}
                    hasError={faltaDetalle}
                />

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={() => onCerrar(false)} disabled={guardando}>
                    Cancelar
                </Button>
                <Button variant="destructive" icon={Ban} onClick={anular}
                    loading={guardando} disabled={!motivo || faltaDetalle}>
                    Anular el renglón
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
