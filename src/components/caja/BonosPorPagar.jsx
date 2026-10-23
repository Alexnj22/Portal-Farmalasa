import React, { useCallback, useEffect, useState } from 'react';
import { Gift, AlertTriangle, Warehouse } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalTextarea from '../common/PortalTextarea';
import IdentidadDeQuienRetira from '../bolsas/IdentidadDeQuienRetira';
import { esPagoSinConfirmar, fetchBonosProductoSala, reservarPagoBono, resolverPagoBonoSinConfirmar } from '@nucleo/data/bonosProducto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { useToastStore } from '@nucleo/store/toastStore';

/**
 * Los bonos de promoción que la sala tiene por pagar — Fase 3 de
 * docs/planes-cerrados/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md.
 *
 * Regla del usuario (2026-09-22): el bono de producto se paga EN LA SALA, con
 * salida de efectivo, y lo paga la JEFATURA. El de bodega sale de la caja de
 * Salud 3; el de administración va a planilla y no aparece acá.
 *
 * ── Por qué el dinero sale por `onSalida` y no por una llamada propia ───────
 * Es la salida del cajón de siempre: su freno de doble envío, su comprobante
 * impreso, la identidad de quien se lleva el efectivo y la recarga de la caja.
 * Escribir otra sería una segunda manera de sacar dinero, y se olvidaría de
 * algo. Lo único nuevo es la RESERVA: el monto lo pone el servidor y la clave
 * ata la salida a este bono. Si no cuadra —otro monto, otra persona, alguien
 * que no es la jefatura— la base rechaza la fila antes de tocar la caja.
 *
 * No dibuja nada si la sala no debe ningún bono.
 */
export default function BonosPorPagar({ sala, cajaAbierta, puedeOperar, onSalida }) {
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const [pagando, setPagando] = useState(null);      // el item que se está pagando
    const [resolviendo, setResolviendo] = useState(null); // el item que quedó sin respuesta de la caja
    const [recarga, setRecarga] = useState(0);

    useEffect(() => {
        if (!sala) return undefined;
        let vivo = true;
        fetchBonosProductoSala(sala)
            .then((d) => { if (vivo) { setDatos(d); setError(null); } })
            .catch((e) => { if (vivo) setError(mensajeAmigable(e, 'No se pudieron leer los bonos por pagar')); });
        return () => { vivo = false; };
    }, [sala, recarga]);

    const items = Array.isArray(datos?.items) ? datos.items : [];
    if (error) {
        return (
            <Notice variant="warning" icon={AlertTriangle}>
                No se pudieron leer los bonos de promoción por pagar: {error}
            </Notice>
        );
    }
    if (!items.length) return null;

    const puedePagar = !!datos?.puedo_pagar && puedeOperar;
    const total = items.reduce((a, i) => a + Number(i.monto || 0), 0);

    return (
        <div data-surface="card" className="rounded-2xl p-4 md:p-5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-body-sm font-black text-content">Bonos de promoción por pagar</p>
                    <p className="text-label font-semibold text-content-3 mt-0.5">
                        {!datos?.puedo_pagar
                            ? 'Los paga la jefatura de la sala.'
                            : !cajaAbierta
                                ? 'Abre la caja para pagarlos: el efectivo sale del cajón.'
                                : 'Cada pago sale del cajón y la persona tiene que identificarse para recibirlo.'}
                    </p>
                </div>
                <span className="text-body-sm font-black tabular-nums text-content">{formatMoney(total)}</span>
            </div>

            <ul className="divide-y divide-border-card">
                {items.map((it) => (
                    <li key={it.item} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0 flex items-center gap-2.5">
                            {it.tipo === 'bodega'
                                ? <Warehouse className="w-4 h-4 text-content-3 shrink-0" aria-hidden />
                                : <Gift className="w-4 h-4 text-content-3 shrink-0" aria-hidden />}
                            <div className="min-w-0">
                                <p className="text-body-sm font-bold text-content truncate">
                                    {it.tipo === 'bodega' ? 'Bodega' : shortEmployeeName(it)}
                                </p>
                                <p className="text-label text-content-3 truncate">
                                    {it.promocion}{it.tipo === 'excedente' ? ' · excedente aprobado' : ''}
                                    {/* Quien ya no trabaja sigue apareciendo: lo ganó y se le debe. */}
                                    {it.activo === false ? ' · ya no trabaja' : ''}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-body-sm font-black tabular-nums">{formatMoney(it.monto)}</span>
                            {it.estado === 'enviado' && it.sin_confirmar ? (
                                puedePagar ? (
                                    <Button size="sm" variant="secondary" icon={AlertTriangle} onClick={() => setResolviendo(it)}>
                                        Sin confirmar
                                    </Button>
                                ) : <Badge variant="warning" size="sm">Sin confirmar</Badge>
                            ) : it.estado === 'enviado' ? (
                                <Badge variant="warning" size="sm">En la caja…</Badge>
                            ) : puedePagar && cajaAbierta ? (
                                <Button size="sm" onClick={() => setPagando(it)}>Pagar</Button>
                            ) : null}
                        </div>
                    </li>
                ))}
            </ul>

            {pagando && (
                <DialogoPagarBono
                    item={pagando}
                    onClose={() => setPagando(null)}
                    onSalida={onSalida}
                    onPagado={() => { setPagando(null); setRecarga((n) => n + 1); }}
                    // H20: la reserva dice que el pago anterior quedó sin
                    // confirmar. Repetir puede pagar dos veces: se cierra el
                    // pago y se abre el diálogo que lo resuelve mirando la caja.
                    onSinConfirmar={(it) => {
                        setPagando(null);
                        setResolviendo({ ...it, estado: 'enviado', sin_confirmar: true });
                        setRecarga((n) => n + 1);
                    }}
                    // Una salida que no salió puede haber dejado el bono «en la
                    // caja»: la lista se relee para que lo diga.
                    onFallo={() => setRecarga((n) => n + 1)}
                />
            )}

            {resolviendo && (
                <DialogoSinConfirmar
                    item={resolviendo}
                    onClose={() => setResolviendo(null)}
                    onResuelto={() => { setResolviendo(null); setRecarga((n) => n + 1); }}
                />
            )}
        </div>
    );
}

function DialogoPagarBono({ item, onClose, onSalida, onPagado, onSinConfirmar, onFallo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [persona, setPersona] = useState(null);
    const [vale, setVale] = useState(null);
    const [guardando, setGuardando] = useState(false);
    // El monto lo pone la reserva, en vivo: si cambió desde que se leyó la
    // lista (una anulación, una factura que llegó tarde) se frena y se muestra
    // el número nuevo antes de sacar efectivo. La jefatura no puede contar un
    // monto y que la caja registre otro.
    const [montoNuevo, setMontoNuevo] = useState(null);
    const monto = montoNuevo ?? Number(item.monto);

    const esBodega = item.tipo === 'bodega';
    const nombre = esBodega ? 'Bodega' : shortEmployeeName(item);
    // El vendedor cobra EN PERSONA: si se identifica otro, no se paga. La base
    // lo rechaza igual; decirlo acá evita llegar al rechazo.
    const otraPersona = !esBodega && persona && persona.id !== item.employee_id;

    const alIdentificar = useCallback(({ persona: p, vale: v }) => { setPersona(p); setVale(v); }, []);
    const olvidar = useCallback(() => { setPersona(null); setVale(null); }, []);

    const pagar = async () => {
        setGuardando(true);
        try {
            const r = await reservarPagoBono(item.item);
            if (Math.abs(Number(r.monto) - monto) >= 0.005) {
                setMontoNuevo(Number(r.monto));
                showToast('El monto cambió', `Ahora son ${formatMoney(r.monto)}. Revisa y vuelve a apretar «Pagar».`, 'warning');
                return;
            }
            const salida = await onSalida({
                monto: Number(r.monto),
                concepto: r.concepto,
                conceptoCompleto: r.concepto,
                tipo: 'BONO_PROMOCION',
                etiqueta: 'Bono de promoción',
                detalle: `${r.concepto} · ${esBodega ? 'Bodega' : nombre}`,
                recibidoPor: persona?.id ?? null,
                vale,
                persona,
                clave: r.clave,
            });
            if (salida?.ok) onPagado();
            else { olvidar(); onFallo(); }   // el vale ya se gastó en el intento: hay que volver a identificarse
        } catch (err) {
            if (esPagoSinConfirmar(err)) {
                showToast('Pago sin confirmar', mensajeAmigable(err), 'warning');
                onSinConfirmar(item);
                return;
            }
            showToast('No se pudo pagar', mensajeAmigable(err, 'Vuelve a intentarlo.'), 'error');
            olvidar();
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Pagar bono de promoción">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">Pagar bono · {nombre}</h3>
                    <p className="text-body-sm text-content-2 mt-1">
                        {item.promocion}{item.tipo === 'excedente' ? ' (excedente aprobado)' : ''}.
                        Saca <b className="text-content">{formatMoney(monto)}</b> del cajón y
                        entrégalo {esBodega ? 'a quien recibe por bodega' : `a ${nombre}`}.
                    </p>
                </div>

                <IdentidadDeQuienRetira
                    activo={!guardando}
                    persona={persona}
                    onIdentificada={alIdentificar}
                    onOlvidar={olvidar}
                    bloqueado={guardando}
                    rotulo="Recibe el bono"
                    sujeto={esBodega ? 'quien recibe el bono de bodega' : nombre}
                />

                {montoNuevo != null && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        El bono cambió de {formatMoney(item.monto)} a {formatMoney(montoNuevo)} desde que
                        se abrió la lista. Se paga el monto nuevo.
                    </Notice>
                )}

                {otraPersona && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        Se identificó {shortEmployeeName(persona)}, pero el bono es de {nombre}.
                        Lo tiene que recibir la persona que lo ganó.
                    </Notice>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose} disabled={guardando}>Volver</Button>
                    <Button onClick={pagar} loading={guardando}
                        disabled={!persona || !vale || otraPersona}>
                        Pagar {formatMoney(monto)}
                    </Button>
                </div>
            </div>
        </LiquidModal>
    );
}

/**
 * El pago se mandó a la caja y la caja no contestó. Pudo haberlo anotado
 * igual, así que repetirlo a ciegas podía pagar dos veces: se mira la caja y
 * se contesta. «Salió» lo da por pagado; «No salió» anula el movimiento y el
 * bono vuelve a quedar por pagar.
 */
function DialogoSinConfirmar({ item, onClose, onResuelto }) {
    const showToast = useToastStore((s) => s.showToast);
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);
    const nombre = item.tipo === 'bodega' ? 'Bodega' : shortEmployeeName(item);

    const resolver = async (salio) => {
        setGuardando(true);
        try {
            await resolverPagoBonoSinConfirmar(item.item, salio, nota.trim());
            showToast(salio ? 'Bono pagado' : 'Pago anulado',
                salio ? `${formatMoney(item.monto)} quedan como pagados.` : 'El bono vuelve a quedar por pagar.', 'success');
            onResuelto();
        } catch (err) {
            showToast('No se pudo resolver', mensajeAmigable(err, 'Vuelve a intentarlo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Pago sin confirmar">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">Pago sin confirmar · {nombre}</h3>
                    <p className="text-body-sm text-content-2 mt-1">
                        Se mandó la salida de <b className="text-content">{formatMoney(item.monto)}</b> y la caja
                        no confirmó. Revisa en la caja si el movimiento salió antes de repetirlo.
                    </p>
                </div>
                <PortalTextarea
                    label="Qué viste en la caja"
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    rows={2}
                    readOnly={guardando}
                />
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={onClose} disabled={guardando}>Volver</Button>
                    <Button variant="secondary" onClick={() => resolver(false)} disabled={guardando || !nota.trim()}>
                        No salió
                    </Button>
                    <Button onClick={() => resolver(true)} loading={guardando} disabled={!nota.trim()}>
                        Sí salió
                    </Button>
                </div>
            </div>
        </LiquidModal>
    );
}
