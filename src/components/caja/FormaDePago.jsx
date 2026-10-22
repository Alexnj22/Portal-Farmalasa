import React, { useState } from 'react';
import { Lock, ReceiptText } from 'lucide-react';
import FileField from '../common/FileField';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import SegmentedControl from '../common/SegmentedControl';
import { leerBoleta } from '@nucleo/data/bolsas';
import { lecturaDeBoleta } from '@nucleo/utils/ingresoDeCaja';
import { formatMoney } from '@nucleo/utils/formatNumber';
import {
    estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL, FORMAS_DE_PAGO, nombreDelComprobante,
} from '@nucleo/utils/formaDePago';

/**
 * Cómo pagó el cliente un ingreso — la misma pieza en los tres diálogos que
 * cobran (el ingreso, la aplicación de inyección y el abono).
 *
 * Controlado: el padre guarda el valor (`FORMA_DE_PAGO_INICIAL`) y sube la foto
 * al anotar, como hace con la de la boleta. La regla de qué falta vive en el
 * núcleo (`estadoDeFormaDePago`), no acá.
 *
 * `onMontoLeido(total)` le avisa al padre el total que leyó la foto, para que
 * llene el cobro si todavía está vacío. Sólo si está vacío: el voucher puede
 * cubrir además una venta, y entonces el cobro es MENOR que el papel.
 *
 * `montoFijo`: el cobro lo pone el servidor (la inyección, Mapfre) y no se
 * puede tocar desde acá — se dice que el voucher cubre ese monto y nada más.
 */
// `aLoAncho`: las opciones ocupan toda la fila, parejas con los demás controles
// del bloque donde va (el cobro de Apartar, 2026-10-22).
export default function FormaDePago({ valor, onCambiar, monto, onMontoLeido, montoFijo = false, deshabilitado = false, aLoAncho = false }) {
    const v = valor ?? FORMA_DE_PAGO_INICIAL;
    const [leyendo, setLeyendo] = useState(false);
    const [aviso, setAviso] = useState(null);
    const estado = estadoDeFormaDePago(v, monto);
    const papel = nombreDelComprobante(v.forma);
    const poner = (cambios) => onCambiar({ ...v, ...cambios });

    const alElegirForma = (forma) => {
        setAviso(null);
        // Volver a efectivo limpia el papel: una foto de voucher colgando de un
        // ingreso en efectivo no prueba nada y confunde a quien lo revise.
        onCambiar(forma === 'EFECTIVO' ? { ...FORMA_DE_PAGO_INICIAL } : { ...FORMA_DE_PAGO_INICIAL, forma });
    };

    const alElegirFoto = async (f) => {
        setAviso(null);
        poner({ foto: f, lectura: null, sinComprobante: false });
        if (!f) return;
        setLeyendo(true);
        const r = await leerBoleta(f, { entidad: null, numeroBoleta: null, monto: null });
        setLeyendo(false);
        const l = lecturaDeBoleta(r, { pideBoleta: true });
        if (l.error) {
            setAviso('No se pudo leer la foto. Escribe el total y el número a mano.');
            onCambiar({ ...v, foto: f, sinComprobante: false });
            return;
        }
        onCambiar({
            ...v, foto: f, sinComprobante: false, lectura: l.lectura,
            comprobanteTotal: l.monto ?? v.comprobanteTotal, numero: l.boleta ?? v.numero,
        });
        if (l.monto != null) onMontoLeido?.(l.monto);
        setAviso(l.monto != null
            ? `La foto leyó ${formatMoney(Number(l.monto))}${l.boleta ? `, número ${l.boleta}` : ''}. Compáralo con el papel.`
            : 'La foto no leyó el total: escríbelo.');
    };

    return (
        <div className="space-y-3">
            {/* `label` de SegmentedControl es sólo para el lector de pantalla:
                el rótulo visible va aparte, con la letra de los demás campos. */}
            <div>
                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Cómo pagó</p>
                <SegmentedControl label="Cómo pagó" options={FORMAS_DE_PAGO} value={v.forma}
                    onChange={alElegirForma} disabled={deshabilitado}
                    {...(aLoAncho ? { layout: 'block', columns: FORMAS_DE_PAGO.length } : {})} />
            </div>

            {estado.noEfectivo && (
                <>
                    {!v.sinComprobante && (
                        <>
                            <FileField label={`Foto del ${papel}`} accept="image/*" value={v.foto}
                                onChange={alElegirFoto} hint={leyendo ? 'Leyendo la foto…' : undefined} />
                            {aviso && <p className="text-caption text-content-2">{aviso}</p>}
                        </>
                    )}

                    {v.foto && (
                        <div className="grid grid-cols-2 gap-3">
                            <PortalInput label={`Total del ${papel}`} inputMode="decimal" prefix="$"
                                value={v.comprobanteTotal} onChange={(e) => poner({ comprobanteTotal: e.target.value })}
                                placeholder="0.00" />
                            <PortalInput label={v.forma === 'TARJETA' ? 'Número del voucher' : 'Referencia'}
                                value={v.numero} maxLength={40} onChange={(e) => poner({ numero: e.target.value })} />
                        </div>
                    )}

                    {/* Lo que el voucher cubre además de este cobro. No frena: la
                        venta con tarjeta llega al portal hasta un minuto después,
                        y el cuadre lo hace `caja_vouchers_del_dia`. */}
                    {v.foto && estado.resto > 0 && (
                        <Notice variant="info" compact icon={ReceiptText}>
                            El {papel} es por más que este cobro: los <b>{formatMoney(estado.resto)}</b> que
                            sobran tienen que ser una venta con tarjeta de hoy. Si no aparece, queda marcado
                            para revisar.
                            {montoFijo && ' El cobro de este ingreso no cambia.'}
                        </Notice>
                    )}

                    {!v.foto && !v.sinComprobante && (
                        <button type="button" onClick={() => poner({ sinComprobante: true })}
                            className="text-caption underline text-content-3 min-h-[var(--tap-min)]">
                            No tengo el {papel}
                        </button>
                    )}

                    {v.sinComprobante && (
                        <>
                            <Notice variant="warning" icon={Lock}>
                                Sin el {papel}, el ingreso se anota pero queda <b>pendiente de autorización</b>.
                                Lo revisa Supervisión o Talento Humano.
                            </Notice>
                            <PortalTextarea label={`Por qué no hay ${papel}`} rows={2} value={v.motivo}
                                onChange={(e) => poner({ motivo: e.target.value })}
                                placeholder="el cliente pagó por transferencia y no mandó la captura" />
                            <button type="button" onClick={() => poner({ sinComprobante: false, motivo: '' })}
                                className="text-caption underline text-content-3 min-h-[var(--tap-min)]">
                                Sí tengo el {papel}: subir la foto
                            </button>
                        </>
                    )}

                    <p className="text-caption text-content-3">
                        No entra al cajón: {v.forma === 'TARJETA' ? 'el dinero llega por el POS' : 'el dinero llega al banco'}.
                    </p>
                </>
            )}
        </div>
    );
}
