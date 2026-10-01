import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Percent, RotateCcw } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Checkbox from '../../components/common/Checkbox';
import { reactivarPromocion } from '@nucleo/data/promociones';
import { fetchDescuento, fetchIdsDeDescuentosDePromocion, moverFinDeDescuento } from '@nucleo/data/descuentos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hoySV, mesSV, ultimoDiaDelMes } from '@nucleo/utils/fecha';
import { fmtVigencia } from '@nucleo/utils/promocionesUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import Campo from './Campo';

/**
 * Reactivar una promoción terminada (usuario, 2026-10-01: «si la quiero
 * reactivar, ¿cómo hago?»).
 *
 * Ya se podía, pero sólo de a un producto y desde una ficha a la que una
 * terminada no llegaba: Histórico no tenía acciones, y «Editar» vivía en las
 * tarjetas de Activas, donde las terminadas no se listan. Con 102 productos en
 * una sola promoción, de a uno tampoco era un camino.
 *
 * Se pide UNA fecha porque es lo que se negocia: «la extendemos hasta el 31».
 * Tiene que ser hoy o después — con una fecha pasada el ciclo diario la vuelve
 * a cerrar a la mañana siguiente y parecería que el botón no hizo nada.
 *
 * ── El descuento de la caja (usuario, 2026-10-01) ─────────────────────────
 * Reactivó Rinokem y el precio no bajó: el descuento tiene sus propias fechas
 * y reactivar no lo movía. Hoy, si la promoción tiene descuentos LIGADOS, una
 * casilla —marcada, a la vista, con qué descuento y hasta cuándo— los mueve
 * a la misma fecha. No es escribir en silencio: se ve antes de apretar.
 *
 * Va DESPUÉS de reactivar y por separado: la promoción vive en el portal y el
 * descuento en la caja, no hay transacción que abarque los dos. Si la caja
 * falla o devuelve avisos (otro descuento que ya toma esos productos, un
 * precio bajo el costo), la promoción queda reactivada y la ventana lo dice
 * con nombre, y deja reintentar sólo lo que faltó.
 *
 * Un descuento cargado directo en la caja no está ligado: el portal no sabe
 * que existe y no lo puede mover.
 */
/** «31 oct 2026». Con componentes: una fecha sin hora leída como UTC retrocede un día. */
function fechaCorta(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(y, m - 1, d));
}

export default function ReactivarPromocionModal({ promo, open, onClose, onReactivada }) {
    // Sugiere el fin del mes en curso, que es como se negocian casi todas.
    const [fin, setFin] = useState(() => ultimoDiaDelMes(mesSV()));
    const [ocupado, setOcupado] = useState(false);
    const [fallo, setFallo] = useState(null);
    const hoy = hoySV();
    const fechaValida = !!fin && fin >= hoy;

    // Los descuentos ligados: null mientras carga, [] si no tiene.
    const [descuentos, setDescuentos] = useState(promo?.descuentos > 0 ? null : []);
    const [falloDescuentos, setFalloDescuentos] = useState(null);
    const [moverDescuento, setMoverDescuento] = useState(true);
    // Después de reactivar: lo que la caja no aceptó, por descuento.
    const [reactivada, setReactivada] = useState(false);
    const [pendientes, setPendientes] = useState([]);

    useEffect(() => {
        if (!(promo?.descuentos > 0)) return undefined;
        let vivo = true;
        (async () => {
            try {
                const ids = await fetchIdsDeDescuentosDePromocion(promo.id);
                const filas = await Promise.all(ids.map((id) => fetchDescuento(id)));
                if (vivo) setDescuentos(filas);
            } catch (e) {
                if (vivo) {
                    setDescuentos([]);
                    setFalloDescuentos(mensajeAmigable(e, 'No se pudo leer el descuento de esta promoción.'));
                }
            }
        })();
        return () => { vivo = false; };
    }, [promo?.id, promo?.descuentos]);

    const hayDescuentos = descuentos?.length > 0;
    const cargandoDescuentos = descuentos === null;

    /* Mueve los que se le pidan y devuelve los que no entraron, con su motivo.
       Uno que falla no frena a los demás: cada uno es una escritura aparte. */
    const moverDescuentos = async (lista) => {
        const quedan = [];
        for (const d of lista) {
            try {
                // Sólo se fuerza lo que ya mostró avisos y quien aprieta leyó;
                // un reintento por error de red vuelve a pasar por los avisos.
                const r = await moverFinDeDescuento(d.id, fin, { forzar: !!d.avisos });
                if (r.avisos) quedan.push({ ...d, avisos: r.avisos.map((a) => a.texto) });
            } catch (e) {
                quedan.push({ ...d, error: mensajeAmigable(e, 'No se pudo mover el descuento.') });
            }
        }
        return quedan;
    };

    const guardar = async () => {
        setFallo(null);
        setOcupado(true);
        try {
            if (!reactivada) {
                await reactivarPromocion(promo.id, fin);
                setReactivada(true);
            }
            if (hayDescuentos && moverDescuento) {
                const quedan = await moverDescuentos(descuentos);
                if (quedan.length) { setPendientes(quedan); return; }
            }
            onReactivada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo reactivar la promoción.'));
        } finally {
            setOcupado(false);
        }
    };

    // Reintento de lo que faltó. Con avisos, quien aprieta ya los leyó.
    const moverIgual = async () => {
        setOcupado(true);
        try {
            const quedan = await moverDescuentos(pendientes);
            if (quedan.length) { setPendientes(quedan); return; }
            onReactivada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo mover el descuento.'));
        } finally {
            setOcupado(false);
        }
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel="Reactivar promoción">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Reactivar promoción</h2>
                <p className="text-caption text-content-3 break-words">
                    {promo?.nombre} · {fmtVigencia(promo?.inicio, promo?.fin)}
                </p>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="space-y-4">
                    <Campo rotulo="Hasta cuándo">
                        {reactivada
                            ? <p className="text-body text-content">{fechaCorta(fin)}</p>
                            : <LiquidDatePicker value={fin} onChange={setFin} min={hoy} />}
                    </Campo>
                    {fin && !fechaValida && (
                        <p className="text-caption text-danger-text">
                            Tiene que ser hoy o una fecha posterior.
                        </p>
                    )}

                    <p className="text-caption text-content-3">
                        Todos sus productos vuelven a contar hasta esa fecha, con el mismo lote,
                        reparto y bono. Los que cerraron porque se vendió el lote no se reabren:
                        mover la fecha no agrega producto.
                    </p>

                    {promo?.descuentos > 0 && cargandoDescuentos && (
                        <p className="text-caption text-content-3">Leyendo el descuento de esta promoción…</p>
                    )}

                    {falloDescuentos && (
                        <Notice variant="warning" icon={Percent}>
                            {falloDescuentos} Después de reactivarla, revisa su fecha desde la
                            pestaña <span className="font-semibold">Descuentos</span>.
                        </Notice>
                    )}

                    {hayDescuentos && !pendientes.length && (
                        <div className="space-y-2">
                            <Checkbox
                                checked={moverDescuento}
                                onChange={setMoverDescuento}
                                disabled={reactivada}
                                label={`Mover también el descuento hasta el ${fechaCorta(fin)}`}
                                description="Esta promoción baja el precio en la venta. Si no lo mueves, el precio no baja aunque la promoción esté activa."
                            />
                            <ul className="space-y-1 pl-8">
                                {descuentos.map((d) => (
                                    <li key={d.id} className="text-caption text-content-2 break-words">
                                        <span className="font-semibold">{d.descripcion}</span>
                                        {' · '}{d.tipo === '%' ? `${Number(d.monto)} %` : `${formatMoney(Number(d.monto))} por unidad`}
                                        {' · '}{d.productos?.length ?? 0} producto{d.productos?.length === 1 ? '' : 's'}
                                        {' · '}hoy {fmtVigencia(d.inicio, d.fin)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {pendientes.length > 0 && (
                        <div className="space-y-2">
                            <Notice variant="success" icon={CheckCircle2}>
                                La promoción ya quedó reactivada.
                            </Notice>
                            <Notice variant="warning" icon={AlertTriangle}>
                                <p className="mb-1">Falta mover {pendientes.length === 1 ? 'el descuento' : 'estos descuentos'}:</p>
                                <ul className="space-y-1">
                                    {pendientes.map((d) => (
                                        <li key={d.id} className="break-words">
                                            <span className="font-semibold">{d.descripcion}</span>
                                            {': '}{d.error ?? d.avisos.join(' ')}
                                        </li>
                                    ))}
                                </ul>
                            </Notice>
                        </div>
                    )}

                    {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                {pendientes.length > 0 ? (
                    <>
                        <Button variant="secondary" onClick={() => onReactivada?.()}>Dejarlo así</Button>
                        <Button icon={Percent} loading={ocupado} onClick={moverIgual}>
                            {pendientes.some((d) => d.error) ? 'Reintentar' : 'Moverlo igual'}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                        <Button
                            icon={RotateCcw}
                            loading={ocupado}
                            disabled={!fechaValida || cargandoDescuentos}
                            onClick={guardar}
                        >
                            Reactivar
                        </Button>
                    </>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
