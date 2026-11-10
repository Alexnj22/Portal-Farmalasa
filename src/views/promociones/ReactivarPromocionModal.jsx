import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Percent, RotateCcw } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Checkbox from '../../components/common/Checkbox';
import { reactivarPromocion } from '@nucleo/data/promociones';
import { fetchDescuentosDePromocion, moverDescuentosA } from '@nucleo/data/descuentos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hoySV, mesSV, ultimoDiaDelMes } from '@nucleo/utils/fecha';
import { fmtVigencia, separarDescuentosDePromocion } from '@nucleo/utils/promocionesUtils';
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
 * ── Los que no estaban ligados (usuario, 2026-11-10) ──────────────────────
 * Volvió a pasar con Rinokem: su descuento se había cargado directo en la caja
 * y la promoción no lo conocía. Ahora la ventana también trae los SIN LIGAR que
 * la base reconoce como suyos (`fetchDescuentosDePromocion`), los mueve y los
 * liga. Los que encajan en más de una promoción se nombran y NO se mueven:
 * le bajarían el precio a la campaña de otra.
 *
 * ── Modo «descuento» ──────────────────────────────────────────────────────
 * La misma ventana sirve para una promoción VIVA cuyo descuento venció antes
 * que ella (la lista lo avisa con «El precio no bajó»): no reactiva nada,
 * sólo lleva el descuento hasta el fin de la promoción.
 */
/** «31 oct 2026». Con componentes: una fecha sin hora leída como UTC retrocede un día. */
function fechaCorta(iso) {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(y, m - 1, d));
}

export default function ReactivarPromocionModal({ promo, open, onClose, onReactivada, modo = 'reactivar' }) {
    const soloDescuento = modo === 'descuento';
    // Sugiere el fin del mes en curso, que es como se negocian casi todas. En
    // modo descuento la fecha es la de la promoción: es lo que tiene que cubrir.
    const [fin, setFin] = useState(() => (soloDescuento ? promo?.fin : ultimoDiaDelMes(mesSV())));
    const [ocupado, setOcupado] = useState(false);
    const [fallo, setFallo] = useState(null);
    const hoy = hoySV();
    const fechaValida = !!fin && fin >= hoy;

    // Los descuentos de la promoción —ligados y sin ligar—: null mientras carga.
    // Se piden SIEMPRE, no sólo si tiene ligados: el que falta es justo el que
    // la promoción no conoce.
    const [descuentos, setDescuentos] = useState(null);
    const [falloDescuentos, setFalloDescuentos] = useState(null);
    const [moverDescuento, setMoverDescuento] = useState(true);
    // Después de reactivar: lo que la caja no aceptó, por descuento.
    const [reactivada, setReactivada] = useState(soloDescuento);
    const [pendientes, setPendientes] = useState([]);

    useEffect(() => {
        if (!promo?.id) return undefined;
        let vivo = true;
        (async () => {
            try {
                const filas = await fetchDescuentosDePromocion(promo.id);
                if (vivo) setDescuentos(filas);
            } catch (e) {
                if (vivo) {
                    setDescuentos([]);
                    setFalloDescuentos(mensajeAmigable(e, 'No se pudo leer el descuento de esta promoción.'));
                }
            }
        })();
        return () => { vivo = false; };
    }, [promo?.id]);

    const { aMover, dudosos } = separarDescuentosDePromocion(descuentos ?? []);
    const hayDescuentos = aMover.length > 0;
    const cargandoDescuentos = descuentos === null;

    /* Mueve los que se le pidan y devuelve los que no entraron, con su motivo.
       Uno que falla no frena a los demás: cada uno es una escritura aparte. El
       que no estaba ligado queda ligado a esta promoción. */
    const moverDescuentos = (lista) => moverDescuentosA(lista, fin,
        (e) => mensajeAmigable(e, 'No se pudo mover el descuento.'), { promocionId: promo.id });

    const guardar = async () => {
        setFallo(null);
        setOcupado(true);
        try {
            if (!reactivada) {
                await reactivarPromocion(promo.id, fin);
                setReactivada(true);
            }
            if (hayDescuentos && (moverDescuento || soloDescuento)) {
                const quedan = await moverDescuentos(aMover);
                if (quedan.length) { setPendientes(quedan); return; }
            }
            onReactivada?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, soloDescuento ? 'No se pudo mover el descuento.' : 'No se pudo reactivar la promoción.'));
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

    const titulo = soloDescuento ? 'Mover el descuento' : 'Reactivar promoción';

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel={titulo}>
            <LiquidModal.Header titulo={titulo}
                subtitulo={<span className="break-words">{promo?.nombre} · {fmtVigencia(promo?.inicio, promo?.fin)}</span>}
                onClose={onClose} />

            <LiquidModal.Body>
                <div className="space-y-4">
                    {soloDescuento ? (
                        <p className="text-body text-content-2">
                            La promoción sigue activa hasta el {fechaCorta(promo?.fin)}, pero su descuento ya
                            venció: el precio en caja no está bajando. Se lleva el descuento hasta esa misma fecha.
                        </p>
                    ) : (
                        <>
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
                        </>
                    )}

                    {cargandoDescuentos && (
                        <p className="text-caption text-content-3">Buscando el descuento de esta promoción…</p>
                    )}

                    {falloDescuentos && (
                        <Notice variant="warning" icon={Percent}>
                            {falloDescuentos} {soloDescuento ? 'Revisa' : 'Después de reactivarla, revisa'} su
                            fecha desde la pestaña <span className="font-semibold">Descuentos</span>.
                        </Notice>
                    )}

                    {hayDescuentos && !pendientes.length && (
                        <div className="space-y-2">
                            {soloDescuento ? (
                                <p className="text-caption font-semibold text-content-2">
                                    {aMover.length === 1 ? 'Se mueve este descuento' : 'Se mueven estos descuentos'} hasta el {fechaCorta(fin)}:
                                </p>
                            ) : (
                                <Checkbox
                                    checked={moverDescuento}
                                    onChange={setMoverDescuento}
                                    disabled={reactivada}
                                    label={`Mover también el descuento hasta el ${fechaCorta(fin)}`}
                                    description="Esta promoción baja el precio en la venta. Si no lo mueves, el precio no baja aunque la promoción esté activa."
                                />
                            )}
                            <ul className={`space-y-1 ${soloDescuento ? '' : 'pl-8'}`}>
                                {aMover.map((d) => (
                                    <li key={d.id} className="text-caption text-content-2 break-words">
                                        <span className="font-semibold">{d.descripcion}</span>
                                        {' · '}{d.tipo === '%' ? `${Number(d.monto)} %` : `${formatMoney(Number(d.monto))} por unidad`}
                                        {' · '}{d.productos?.length ?? 0} producto{d.productos?.length === 1 ? '' : 's'}
                                        {' · '}hoy {fmtVigencia(d.inicio, d.fin)}
                                        {d.ligado === false && (
                                            <span className="text-content-3"> · se cargó aparte; queda ligado a esta promoción</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {dudosos.length > 0 && !pendientes.length && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            <p className="mb-1">
                                {dudosos.length === 1 ? 'Este descuento podría ser' : 'Estos descuentos podrían ser'} de
                                esta promoción o de otra que arrancó igual, así que no se mueve{dudosos.length === 1 ? '' : 'n'} solo{dudosos.length === 1 ? '' : 's'}:
                            </p>
                            <ul className="space-y-1">
                                {dudosos.map((d) => (
                                    <li key={d.id} className="break-words">
                                        <span className="font-semibold">{d.descripcion}</span> · hoy {fmtVigencia(d.inicio, d.fin)}
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-1">Si es de esta, cambia su fecha desde la pestaña <span className="font-semibold">Descuentos</span>.</p>
                        </Notice>
                    )}

                    {soloDescuento && !cargandoDescuentos && !hayDescuentos && !falloDescuentos && (
                        <Notice variant="info" icon={Percent}>
                            No se encontró un descuento que mover. Revisa la pestaña <span className="font-semibold">Descuentos</span>.
                        </Notice>
                    )}

                    {pendientes.length > 0 && (
                        <div className="space-y-2">
                            {!soloDescuento && (
                                <Notice variant="success" icon={CheckCircle2}>
                                    La promoción ya quedó reactivada.
                                </Notice>
                            )}
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
                            icon={soloDescuento ? Percent : RotateCcw}
                            loading={ocupado}
                            disabled={!fechaValida || cargandoDescuentos || (soloDescuento && !hayDescuentos)}
                            onClick={guardar}
                        >
                            {soloDescuento ? 'Mover el descuento' : 'Reactivar'}
                        </Button>
                    </>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
