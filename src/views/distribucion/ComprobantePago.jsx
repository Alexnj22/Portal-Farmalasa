import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, ScanLine, Loader2, RotateCcw } from 'lucide-react';
import FileField from '../../components/common/FileField';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import { formatMoney } from '../../utils/formatNumber';
import { leerComprobante } from '../../data/distribucion';
import { leerMonto } from './comun';

// Adjuntar el comprobante de un pago y decidir qué pasa si no cuadra.
//
// Tres salidas, y ninguna traba la venta:
//   · el monto leído COINCIDE → «coincide»;
//   · no coincide → la persona elige: usar el del comprobante (sólo si el pago
//     todavía se puede cambiar) o dejar el del pago diciendo POR QUÉ;
//   · no se pudo leer (sin lector, foto borrosa) → la persona escribe el monto
//     que dice el papel, y se compara igual. Un comprobante que nadie leyó no
//     queda marcado como verificado.
//
// Devuelve con `onListo({ archivo, lectura, montoLeido, verificacion, nota, montoNuevo })`.

const TEXTO_FORMA = { '02': 'de la tarjeta', '03': 'de la tarjeta', '04': 'del cheque', '05': 'de la transferencia', '08': 'del pago electrónico', '99': 'del pago' };

export default function ComprobantePago({ forma, montoEsperado, puedeCambiarMonto = false, onListo }) {
    const [archivo, setArchivo] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [resultado, setResultado] = useState(null); // respuesta del lector
    const [montoPapel, setMontoPapel] = useState(''); // escrito a mano cuando no hubo lectura
    const [nota, setNota] = useState('');

    const leer = async (f) => {
        setArchivo(f);
        setResultado(null);
        setNota('');
        setMontoPapel('');
        if (!f) return;
        setLeyendo(true);
        try {
            setResultado(await leerComprobante(f, montoEsperado, forma));
        } catch (e) {
            // Leer es ayuda: si falla, se sigue a mano con el monto escrito.
            console.error('ComprobantePago: lectura', e);
            setResultado({ sinLector: true, leido: null, coincide: null, error: e.message });
        } finally {
            setLeyendo(false);
        }
    };

    const leido = resultado?.leido;
    const hubieronDatos = resultado && !resultado.sinLector && leido?.es_comprobante && leido?.legible !== false && Number.isFinite(Number(leido?.monto));
    const noEsComprobante = resultado && !resultado.sinLector && leido && leido.es_comprobante === false;
    const montoLeido = hubieronDatos ? Number(leido.monto) : leerMonto(montoPapel);
    const esperado = montoEsperado == null ? null : Number(montoEsperado);
    const cuadra = montoLeido != null && esperado != null && Math.abs(montoLeido - esperado) < 0.005;
    const sinComparar = esperado == null; // «el resto»: el monto final lo calcula el documento

    const terminar = ({ verificacion, notaFinal, montoNuevo = null }) => onListo?.({
        archivo, lectura: leido ?? null, montoLeido, verificacion, nota: notaFinal ?? null, montoNuevo,
    });

    return (
        <div className="flex flex-col gap-2">
            <FileField label={`Comprobante ${TEXTO_FORMA[forma] ?? 'del pago'}`} accept="image/*,application/pdf"
                file={archivo} hint="Foto del voucher, captura de la transferencia o del cheque" density="sm"
                onChange={leer} busy={leyendo} busyLabel="Leyendo el comprobante…" />

            {leyendo && <p className="text-caption text-content-3 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Leyendo el monto…</p>}

            {noEsComprobante && (
                <Notice variant="warning" icon={AlertTriangle} compact action={<Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => leer(null)}>Otra foto</Button>}>
                    No parece un comprobante de pago{leido.motivo ? `: ${leido.motivo}` : ''}.
                </Notice>
            )}

            {archivo && resultado && !noEsComprobante && !hubieronDatos && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption text-content-3 flex items-center gap-1.5">
                        <ScanLine size={12} /> {resultado.sinLector ? 'El lector de comprobantes no está disponible.' : 'No se pudo leer el monto con seguridad.'}
                        {' '}Escribe el monto que dice el papel.
                    </p>
                    <PortalInput name="monto-comprobante" label="Monto del comprobante" inputMode="decimal" value={montoPapel}
                        onChange={(e) => setMontoPapel(e.target.value)} />
                </div>
            )}

            {archivo && montoLeido != null && !noEsComprobante && (
                sinComparar ? (
                    <Notice variant="info" icon={ScanLine} compact
                        action={<Button size="sm" variant="secondary" onClick={() => terminar({ verificacion: hubieronDatos ? 'coincide' : 'sin_lectura', notaFinal: hubieronDatos ? null : 'Monto escrito por quien subió el comprobante.' })}>Adjuntar</Button>}>
                        El comprobante dice {formatMoney(montoLeido)}. Esta forma de pago es «el resto»: se compara al facturar.
                    </Notice>
                ) : cuadra ? (
                    <Notice variant="success" icon={CheckCircle2} compact
                        action={<Button size="sm" variant="secondary" onClick={() => terminar({ verificacion: hubieronDatos ? 'coincide' : 'sin_lectura', notaFinal: hubieronDatos ? null : 'Monto escrito por quien subió el comprobante; coincide.' })}>Adjuntar</Button>}>
                        El comprobante dice {formatMoney(montoLeido)}: coincide con el pago.
                    </Notice>
                ) : (
                    <div className="flex flex-col gap-2 rounded-xl border border-warning/40 p-3">
                        <p className="text-body-sm text-content-2">
                            <AlertTriangle size={14} className="inline text-warning-text mr-1" />
                            El comprobante dice <b>{formatMoney(montoLeido)}</b> y el pago es <b>{formatMoney(esperado)}</b>. ¿Cuál es el correcto?
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {puedeCambiarMonto && (
                                <Button size="sm" variant="secondary" onClick={() => terminar({ verificacion: hubieronDatos ? 'coincide' : 'sin_lectura', notaFinal: hubieronDatos ? null : 'Monto escrito por quien subió el comprobante.', montoNuevo: montoLeido })}>
                                    Usar {formatMoney(montoLeido)} (el del comprobante)
                                </Button>
                            )}
                            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => leer(null)}>Es otra foto</Button>
                        </div>
                        <PortalInput name="nota-diferencia" label={`Dejar ${formatMoney(esperado)}: ¿por qué no coincide?`} value={nota}
                            placeholder="Ej.: pagó en dos transferencias; esta es la primera" onChange={(e) => setNota(e.target.value)} />
                        <div>
                            <Button size="sm" variant="secondary" disabled={!nota.trim()}
                                onClick={() => terminar({ verificacion: 'diferencia_aceptada', notaFinal: nota })}>
                                Dejar {formatMoney(esperado)} y adjuntar
                            </Button>
                        </div>
                    </div>
                )
            )}
        </div>
    );
}
