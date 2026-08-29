import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeftRight, Clock, Loader2, PackageCheck, Printer, Truck } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import {
    MOTIVOS_RECHAZO, despacharTraslado, recibirTraslado, rechazarTraslado,
    fetchDisponibilidadTraslado,
} from '../../data/traslados';
import { fmtCuando, fmtFechaLarga, resumenItems, lotesPedidos, loQueLlego, piezasDe, renglonesDe } from './trasladoTexto';
import DeclararFaltantes from './DeclararFaltantes';
import { desdeHace, cuantoTardo } from '../solicitudes/movimientoTexto';
import { ChipPersona, FichaPersona } from '../solicitudes/PersonasSolicitud';
import ModalShell from '../../components/common/ModalShell';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { buscadorDePersonas } from '../solicitudes/movimientoTexto';
import { imprimirTicketDeTraslado, reimprimirTicketDeTraslado, loQueVaEnLaBolsa } from '../../utils/imprimirTraslado';

/* Cuántos lotes entran en la TARJETA. El resto se lee en el detalle: con la
 * rejilla igualando alturas, un traslado de doce lotes estira a todas las demás
 * y empuja el botón fuera de la pantalla. Dos es lo que cabe sin que la tarjeta
 * con lotes y la que no los tiene se vean de dos familias distintas. */
const LOTES_EN_TARJETA = 2;

// Las filas de un traslado, en un solo lugar.
//
// Vivían dentro de `WidgetTransferRequests`. Al nacer la vista `/traslados`
// hacían falta en los dos sitios, y la salida fácil —copiarlas— es la que
// termina con dos filas que se parecen y se comportan distinto: la del widget
// preguntando la disponibilidad antes de despachar y la de la vista no, o al
// revés. El envase cambia (modal angosto contra vista ancha); lo que la fila
// DICE y lo que la fila HACE, no.

/** El recorrido, siempre en el mismo sentido: de dónde sale → a dónde va. */
export function Recorrido({ meta, className = '' }) {
    return (
        <span className={`truncate ${className}`}>
            {meta?.origen_branch_name ?? 'La otra sala'} → {meta?.branch_name ?? 'destino'}
        </span>
    );
}

/* ─── Qué trae la caja, renglón por renglón ───────────────────────────────────
 *
 * Los lotes se mostraban APLANADOS —`lotesPedidos` los saca de todos los
 * renglones y los junta— y con un solo producto eso alcanza: el nombre está
 * arriba. Con varios, no. Reportado sobre el traslado de 5 productos del 20-ago:
 * «sólo dice la cantidad de productos y los lotes, pero no veo el listado de
 * productos para confirmar que todo está bien».
 *
 * Y no era sólo un dato que faltaba: dos de esos cinco eran «BRONCODINE FLUX»
 * —uno jarabe de 120 ml y otro gotas de 30 ml—, así que la lista sin nombres se
 * podía cotejar contra el producto equivocado y darla por buena. Un lote sin su
 * producto no es una verificación, es una coincidencia.
 *
 * @param tope Cuántos productos caben antes de resumir el resto. `null` = todos,
 *             que es el detalle. La TARJETA sí lo topa: la rejilla iguala
 *             alturas, y un traslado largo estira a todas las demás y empuja el
 *             botón fuera de la pantalla.
 */
function ListaRenglones({ renglones, tope = null }) {
    const visibles = tope == null ? renglones : renglones.slice(0, tope);
    const deMas    = renglones.length - visibles.length;
    return (
        <div className="flex flex-col gap-1.5">
            {visibles.map(r => (
                <div key={r.idx} className="min-w-0">
                    {/* El nombre a la izquierda y la cuenta a la derecha: es la
                        línea que se lee contra lo que hay en la caja. */}
                    <p className="flex items-baseline justify-between gap-2 text-label font-semibold text-content">
                        <span className="min-w-0 truncate" title={r.nombre}>{r.nombre}</span>
                        <span className="shrink-0 tabular-nums text-content-2">
                            {r.cantidad} {r.presentacion}
                        </span>
                    </p>
                    {/* Sus lotes, SANGRADOS: así se leen como parte del producto
                        de arriba y no como un renglón más de la lista. */}
                    {r.lotes.map((l, i) => (
                        <p key={i} className="pl-3 flex items-baseline justify-between gap-2 text-micro font-semibold text-content-3">
                            <span className="min-w-0 truncate">
                                <span className="font-mono">{l.lote || 'sin lote'}</span>
                                {l.vence && <span> · vence {fmtFechaLarga(l.vence)}</span>}
                            </span>
                            <span className="shrink-0 tabular-nums">
                                {l.unidades} {l.unidades === 1 ? 'unidad' : 'unidades'}
                            </span>
                        </p>
                    ))}
                </div>
            ))}
            {deMas > 0 && (
                <p className="text-micro font-bold text-brand-text">
                    +{deMas} {deMas === 1 ? 'producto más' : 'productos más'}
                </p>
            )}
        </div>
    );
}

/* ─── La decisión: confirmar y enviar, o no poder ─────────────────────────────
 *
 * Aparte de la fila desde el 2026-08-15, cuando la decisión del traslado se
 * mudó a Solicitudes —que es donde se contestan las otras cuatro familias— y
 * dejó de tener un solo hogar. Lo que se comparte es esto y no la fila entera:
 * el modal ya dibuja arriba qué se pide, quién lo pide y de dónde a dónde va,
 * así que meterle la fila completa habría repetido esos tres datos dentro de su
 * propio detalle.
 *
 * Lo que este bloque sabe y no se puede perder al copiarlo —por eso no se
 * copia—: que la existencia se relee AL ABRIR y no al apretar, que sin
 * existencia la única salida es rechazar con el motivo ya elegido, que la
 * sugerencia se arma con el dato fresco y viaja en el aviso, y que «Otro» sin
 * texto no es un motivo.
 */
/**
 * Cuántos PAQUETES de un renglón puede mandar hoy la sala de origen.
 *
 * Las dos escalas son la trampa: la disponibilidad viene en unidades BASE y lo
 * pedido en paquetes de la presentación. `factor` es lo que las une, y es la
 * MISMA cuenta que hace el despachador contra el reporte del sistema —acá es una
 * ayuda para que la casilla venga puesta, allá es la autoridad—.
 *
 * Nunca más de lo pedido: mandar de más no es mandar, es otro traslado.
 */
function paquetesQueSalen(linea, item) {
    const factor  = Number(item?.factor) || 1;
    const pedidos = Number(item?.cantidad) || 0;
    const hay     = Math.floor(Number(linea?.unidades ?? 0) / factor);
    return Math.max(0, Math.min(pedidos, hay));
}

/** Cómo se llama un renglón. El nombre guardado manda; el número es el repuesto. */
function nombreDe(linea, items) {
    return linea?.descripcion
        ?? items?.[linea?.idx]?.descripcion
        ?? `#${linea?.erp_product_id ?? '?'}`;
}

export function DecisionTraslado({ fila, onHecho }) {
    /* La sala y el nombre se SACAN de acá, no se reciben como props.
     *
     * Este componente lo montan tres pantallas —la tarjeta de Solicitudes, la
     * campana y la fila de Traslados— y una prop que hace falta para imprimir
     * sería una prop que dos de las tres se olvidan: el ticket saldría en la
     * caja equivocada, o sin decir quién pidió, y en ninguno de los dos casos
     * falla nada visible. Es [[feedback_una_prop_opt_in_es_una_prop_olvidada]]
     * aplicado antes de cometerlo: `miBranch` ya se pasa así a `FilaPorConfirmar`
     * y allá SÍ es opcional, porque allá sólo decide un rótulo.
     *
     * `miBranch` es la sala de quien está mirando, o sea de quien despacha, o
     * sea donde está la bolsa. Cuando una sala cubre a otra que está cerrada,
     * el que confirma es el de la sala que cubre — así que sale correcta por
     * construcción, sin tener que mirar `por_respaldo`. */
    const { user } = useAuth();
    const employees = useStaff(s => s.employees);
    const meta = fila.metadata ?? {};
    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const quienPide = useMemo(
        () => buscadorDePersonas(employees)(fila.employee_id)?.name ?? null,
        [employees, fila.employee_id],
    );

    const [modo,     setModo]     = useState(null);   // null | 'rechazo'
    /* Arranca VACÍO, no en el primer motivo de la lista.
     *
     * Venía `MOTIVOS_RECHAZO[0]`, o sea «Producto ya encargado» ya elegido, y
     * eso convertía el motivo en un trámite: se apretaba Rechazar sin tocar el
     * desplegable y la base lo aceptaba porque el valor estaba. Medido sobre
     * los rechazos reales del 11 al 18 de agosto: **6 de 8 decían exactamente
     * ese primer motivo**. No es que el producto estuviera encargado seis
     * veces; es que nadie lo eligió.
     *
     * Es el mismo arreglo que las bolsas de efectivo (v2.657.7): un motivo que
     * viene de fábrica no es un motivo, es un valor por defecto disfrazado de
     * decisión. Pedido del usuario, 2026-08-18. */
    const [motivo,   setMotivo]   = useState(null);
    const [texto,    setTexto]    = useState('');
    const [ocupado,  setOcupado]  = useState(false);
    const [error,    setError]    = useState('');
    const [disp,     setDisp]     = useState(null);   // null = todavía no se sabe
    /* Cuántos paquetes sale de cada renglón, por índice y como texto —es lo que
     * hay en la casilla—. Arranca en lo MÁXIMO que se puede mandar, que con
     * existencia de sobra es lo pedido y con existencia corta es lo que hay:
     * así la casilla ya trae la respuesta y sólo se toca para cambiarla. */
    const [cuantos,  setCuantos]  = useState({});
    /* Por qué no sale todo. Obligatorio en cuanto se manda de menos: es lo
     * único que le va a explicar a quien pidió por qué le llegan 2 de 3. */
    const [porQue,   setPorQue]   = useState('');

    // Los renglones tal como se guardaron. De acá salen la presentación y la
    // cantidad PEDIDA; la disponibilidad trae lo que hay. Son dos fuentes y no
    // una porque lo pedido no cambia y lo que hay sí.
    const items = useMemo(
        () => (Array.isArray(fila.metadata?.items) ? fila.metadata.items : []),
        [fila.metadata],
    );

    // Se pregunta al abrir y no al apretar: entre que alguien pide y alguien
    // contesta, la sala pudo vender lo último que le quedaba —o habérselo
    // enviado a otra sala que pidió antes—. Sin esto, quien confirma se entera
    // recién cuando el sistema le rebota el despacho.
    useEffect(() => {
        let cancelado = false;
        fetchDisponibilidadTraslado(fila.id).then(r => {
            if (cancelado || r.error) return;
            const d = r.disponibilidad;
            setDisp(d);

            const lin = Array.isArray(d?.lineas) ? d.lineas : [];
            setCuantos(Object.fromEntries(
                lin.map(l => [l.idx, String(paquetesQueSalen(l, items[l.idx]))]),
            ));

            // Si no queda NADA que mandar, la única salida honesta es rechazar
            // — y con el motivo que corresponde ya elegido, para no hacer buscar
            // lo que el portal ya sabe. Se decide acá, donde llega la respuesta,
            // y no en un efecto que vigile `disp`: es la misma decisión y un
            // solo sitio.
            if (lin.length > 0 && lin.every(l => paquetesQueSalen(l, items[l.idx]) === 0)) {
                setModo('rechazo');
                setMotivo('Sin existencia en físico');
            }
        });
        return () => { cancelado = true; };
    }, [fila.id, items]);

    const lineas = useMemo(() => (Array.isArray(disp?.lineas) ? disp.lineas : []), [disp]);

    /* Todavía no se sabe qué hay: o está viajando la respuesta, o no se pudo
     * preguntar. En los dos casos la tarjeta se comporta como antes de que esto
     * existiera —se manda lo pedido y decide el servidor—, que es lo único
     * honesto: dejar el botón apagado por una consulta que falló sería impedir
     * despachar por un dato que es una ayuda, no la autoridad. */
    const sinDatos = lineas.length === 0;

    const pedidoDe = (idx) => Number(items[idx]?.cantidad) || 0;
    const maxDe    = (l)   => paquetesQueSalen(l, items[l.idx]);
    const saleDe   = (idx) => {
        const n = Math.floor(Number(cuantos[idx]));
        return Number.isFinite(n) && n > 0 ? n : 0;
    };

    // Lo que va a viajar. Índices con su cantidad, nunca los renglones.
    const aceptadas = lineas
        .map(l => ({ i: l.idx, cantidad: Math.min(saleDe(l.idx), pedidoDe(l.idx)) }))
        .filter(a => a.cantidad > 0);

    // Que no quede NADA en físico es un hecho de la existencia; que no quede
    // nada en las casillas es una decisión de quien despacha. Se distinguen a
    // propósito: el aviso rojo habla de lo primero, y decir «ya no puedes» sobre
    // alguien que acaba de escribir un cero sería contarle mal lo que pasó.
    const nadaEnFisico = !sinDatos && lineas.every(l => maxDe(l) === 0);
    const hayQueMandar = aceptadas.length > 0;
    const recortado    = hayQueMandar && (
        aceptadas.length < lineas.length || aceptadas.some(a => a.cantidad !== pedidoDe(a.i))
    );

    /* A quién más pedirle, por renglón. El texto viaja en el aviso de rechazo:
     * quien pidió no tiene por qué volver a buscar dónde hay. Se arma acá y no
     * en la base porque acá está el dato fresco que se acaba de mirar. */
    const conAlternativa = lineas.filter(l => (l.alternativas ?? []).length > 0);
    const sugerencia = conAlternativa.length === 0
        ? ''
        : conAlternativa.map((l) => {
            const donde = l.alternativas.slice(0, 3).map(a => `${a.sala} (${a.unidades})`).join(', ');
            // Con un solo renglón el nombre del producto ya está en la tarjeta y
            // repetirlo alarga la frase; con varios es lo único que distingue
            // una sugerencia de la otra.
            return lineas.length === 1 ? `Sí hay en ${donde}` : `${nombreDe(l, items)}: ${donde}`;
        }).join(' · ');

    const confirmar = async () => {
        setError(''); setOcupado(true);
        const r = await despacharTraslado(
            fila.id,
            recortado ? porQue.trim() : '',
            // `null` es «sale todo lo pedido»: el camino normal hace exactamente
            // el mismo viaje que antes de que existiera el despacho parcial.
            recortado ? aceptadas : null,
        );
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo despachar.'); return; }

        /* El ticket que va pegado a la bolsa, y que reemplaza al tirro escrito a
         * mano. Sale DESPUÉS del despacho y no antes, por dos motivos: lleva el
         * número del traslado, que recién existe cuando el movimiento entró; y
         * un papel impreso sobre un despacho que después falla manda una bolsa
         * que nadie va a poder recibir.
         *
         * No se espera y no puede fallar el despacho —`imprimirTicketDeTraslado`
         * no lanza—: para acá el producto YA se movió, así que un problema de
         * papel no puede mostrarse como si la operación no hubiera salido. Si el
         * papel no sale, se dice aparte y se reimprime desde la tarjeta.
         *
         * La caja es la de QUIEN DESPACHA (`miBranch`), no la sala dueña del
         * producto: cuando una sala cubre a otra que está cerrada, la bolsa está
         * en su mostrador y es ahí donde tiene que salir el papel. */
        imprimirTicketDeTraslado({
            sala: miBranch,
            familia: 'solicitud',
            aplicado: r.aplicado,
            origen: meta.origen_branch_name,
            destino: meta.branch_name,
            pide: quienPide,
            items: loQueVaEnLaBolsa(items, recortado ? aceptadas : []),
        }).then((res) => {
            if (!res?.ok) setError(`Se envió, pero el ticket no salió: ${res?.detalle ?? 'sin detalle'}`);
        // El `catch` NO sobra aunque `imprimirTicketDeTraslado` prometa no
        // lanzar: sin él, el día que esa promesa deje de cumplirse —o que este
        // mismo `then` reviente— queda una rejection sin dueño, que en el
        // navegador es un error de consola que nadie mira y acá lo destapó la
        // prueba del papel muerto. La promesa que no se espera se protege en su
        // sitio, no en la confianza de que el otro lado se porte bien.
        }).catch((e) => {
            console.error('ticket de traslado:', e);
            setError('Se envió, pero el ticket no salió.');
        });

        // Con el desenlace: quien lo abrió desde un aviso necesita saber en qué
        // terminó para apagar el botón con el rótulo correcto. Las listas que ya
        // lo usaban recargan entero y lo ignoran.
        onHecho('APPROVED');
    };

    const rechazar = async () => {
        setError(''); setOcupado(true);
        const { error: e } = await rechazarTraslado(fila.id, motivo, texto, sugerencia);
        setOcupado(false);
        if (e) { setError(e.message ?? 'No se pudo rechazar.'); return; }
        // Despachar y recibir pasan por la función del servidor, que deja su
        // propio rastro. Rechazar se escribe desde el navegador y no dejaba
        // ninguno: una sala que se queda sin lo que pidió no tenía forma de
        // saber quién dijo que no ni por qué.
        useStaff.getState().appendAuditLog('RECHAZAR_TRASLADO', String(fila.id),
            { motivo, detalle: texto || null, sugerencia: sugerencia || null });
        onHecho('REJECTED');
    };

    // Sin motivo no hay rechazo, y «Otro» sin texto no explica nada: es el
    // motivo vacío con otro nombre. Las dos cosas las rechaza la base igual —se
    // avisan acá para no gastar el viaje— y las dos son la misma regla: quien
    // rechaza tiene que decir por qué.
    const puedeRechazar = Boolean(motivo) && (motivo !== 'Otro' || texto.trim().length > 0);

    // Y la misma regla del otro lado: mandar de menos también hay que explicarlo.
    // El servidor lo exige igual; acá se avisa para no gastar el viaje.
    const puedeConfirmar = sinDatos || (hayQueMandar && (!recortado || porQue.trim().length > 0));

    return (
        <div className="flex flex-col gap-2">
            {/* Por qué te aparece un traslado de una sala que no es la tuya.
                Sin esta línea, quien lo ve tiene que adivinar si es un error.

                Lo dice el SERVIDOR —`respaldo` sale de la misma función que
                autoriza el despacho—, no una cuenta del navegador: así el
                aviso no puede prometer algo que después el despacho rebote. Y
                sólo viene cuando de verdad estás cubriendo a esa sala en este
                momento; en el caso normal la clave no existe y acá no se pinta
                nada. */}
            {disp?.respaldo && (
                <p className="text-micro font-semibold text-brand-text leading-snug">
                    {disp.respaldo.sala} está cerrada: lo despachas tú por ellos, y mañana
                    les llega el aviso de lo que salió.
                </p>
            )}

            {/* Lo que la sala tiene AHORA, no cuando se lo pidieron — y ya con
                lo que salió y todavía no aparece en el conteo descontado. */}
            {nadaEnFisico && (
                <p className="text-micro font-semibold text-danger-text leading-snug">
                    Ya no puedes enviarlo: quedan {lineas[0]?.unidades ?? 0}
                    {(lineas[0]?.en_vuelo ?? 0) > 0
                        && ` (${lineas[0].en_vuelo} ya salieron y el conteo todavía no lo refleja)`}.
                    {sugerencia && ` ${sugerencia}.`}
                </p>
            )}

            {/* ── Cuánto sale de cada renglón ─────────────────────────────────
                Reportado así: «me solicitan 3 pero solo puedo mandar 2 porque ya
                vendí 1 ahorita, ¿puedo modificar la cantidad a enviar?».

                La casilla viene puesta en lo máximo que se puede mandar, así que
                el caso normal —sale todo— se sigue despachando de un botón sin
                tocar nada. Bajarla es la excepción, y entonces pide el motivo.

                No aparece cuando ya no queda nada en físico: ahí no hay ninguna
                cantidad que elegir y la única salida es rechazar. */}
            {!nadaEnFisico && !sinDatos && (
                <ul className="flex flex-col gap-1.5">
                    {lineas.map(l => {
                        const pedido = pedidoDe(l.idx);
                        const max    = maxDe(l);
                        const sale   = Math.min(saleDe(l.idx), pedido);
                        const factor = Number(items[l.idx]?.factor) || 1;
                        const queda  = (l.unidades ?? 0) - sale * factor;
                        return (
                            <li key={l.idx} className="flex items-center gap-2">
                                {/* La casilla va PRIMERO para que el renglón se
                                    lea como una frase: «[2] de 3 UNIDAD ·
                                    alcanza para 2». Con el número a la derecha
                                    hay que leerlo al revés. */}
                                <div className="w-16 shrink-0">
                                    <PortalInput
                                        type="number"
                                        min="0"
                                        max={String(pedido)}
                                        value={cuantos[l.idx] ?? ''}
                                        onChange={e => setCuantos(c => ({ ...c, [l.idx]: e.target.value }))}
                                        aria-label={`Cuántos envías de ${nombreDe(l, items)}`}
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    {/* El nombre sólo cuando hay más de uno: con
                                        un renglón la tarjeta ya lo dice arriba, y
                                        repetirlo es ruido en el caso normal. */}
                                    {lineas.length > 1 && (
                                        <p className="text-micro font-semibold text-content leading-snug truncate">
                                            {nombreDe(l, items)}
                                        </p>
                                    )}
                                    <p className="text-micro text-content-3 leading-snug">
                                        de {pedido} {items[l.idx]?.presentacion_tipo ?? ''}
                                        {max < pedido && ` · alcanza para ${max}`}
                                    </p>
                                    {/* El mínimo INFORMA, no impide: que la sala
                                        quede en cero es decisión de quien
                                        despacha. Decisión del usuario,
                                        2026-08-06. */}
                                    {sale > 0 && (l.minimo ?? 0) > 0 && queda < l.minimo && (
                                        <p className="text-micro font-semibold text-warning-text leading-snug">
                                            Te quedas en {queda} y tu mínimo es {l.minimo}.
                                        </p>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* Mandar de menos hay que explicarlo: es lo único que va a llegarle
                a quien pidió junto con la caja incompleta. */}
            {recortado && (
                <PortalTextarea
                    value={porQue}
                    onChange={e => setPorQue(e.target.value)}
                    rows={2}
                    placeholder="¿Por qué no sale todo?"
                />
            )}

            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}

            {modo !== 'rechazo' ? (
                <div className="flex gap-2">
                    <Button size="sm" disabled={ocupado || !puedeConfirmar} onClick={confirmar}>
                        {ocupado && <Loader2 size={13} className="animate-spin" />}
                        {ocupado ? 'Enviando...' : recortado ? 'Enviar lo que hay' : 'Confirmar y enviar'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setModo('rechazo')}>
                        No puedo
                    </Button>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <LiquidSelect
                        value={motivo}
                        onChange={v => setMotivo(v ?? null)}
                        options={MOTIVOS_RECHAZO.map(m => ({ value: m, label: m }))}
                        placeholder="Motivo..."
                        clearable={false}
                    />
                    {/* La sugerencia se muestra acá y además viaja en el aviso:
                        quien pidió no tiene por qué volver a buscar dónde hay. */}
                    {sugerencia && (
                        <p className="text-micro text-content-3 leading-snug px-1">
                            Se le va a sugerir: {sugerencia}
                        </p>
                    )}
                    <PortalTextarea
                        value={texto}
                        onChange={e => setTexto(e.target.value)}
                        rows={2}
                        placeholder={motivo === 'Otro' ? 'Escribe el motivo' : 'Algo más que agregar (opcional)'}
                    />
                    <div className="flex gap-2">
                        <Button size="sm" variant="destructive" disabled={ocupado || !puedeRechazar} onClick={rechazar}>
                            {ocupado && <Loader2 size={13} className="animate-spin" />}
                            Rechazar
                        </Button>
                        {/* Sin «Volver» cuando ya no queda nada: no hay a dónde
                            volver — confirmar sería prometer lo que no está. */}
                        {!nadaEnFisico && (
                            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setModo(null)}>
                                Volver
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Una solicitud, con sus dos respuestas ───────────────────────────────────
 *
 * La tarjeta del widget del tablero: qué se pide, quién lo pide, y debajo la
 * decisión. En Solicitudes esos tres primeros datos ya los pinta el detalle, así
 * que allá se usa `DecisionTraslado` a secas.
 *
 * @param miBranch La sala de quien mira. Sirve para UNA cosa: saber si el
 *                 producto sale de acá o de otra sala. Desde v2.657.0 esta
 *                 lista puede traer las dos —una sala cubre a otra mientras
 *                 está cerrada— y hasta entonces el origen no hacía falta
 *                 decirlo porque siempre era el mismo. Opcional: sin él la
 *                 tarjeta se ve como antes en vez de afirmar lo que no sabe.
 */
export function FilaPorConfirmar({ fila, nombrePor, onHecho, miBranch = null }) {
    const meta = fila.metadata ?? {};

    /* De dónde sale el producto, cuando NO es de esta sala.
     *
     * Sale del metadata de la solicitud, que es un hecho —quién despacha lo
     * decide el servidor, y eso ya se dice adentro de la decisión—. Acá sólo se
     * nombra la sala de la que va a salir el producto, que es lo que cambia lo
     * que hay que ir a buscar y de qué estante.
     *
     * Píldora y no color de tarjeta: en esta familia **el color está reservado
     * al estado** —pendiente, aprobada, rechazada— y el tipo se dice por ícono
     * y por nombre. Es la decisión de la auditoría de tema, escrita en
     * `TarjetaSolicitud`: nueve tintes compitiendo ya la habían roto una vez. */
    const origenId = Number(meta.origen_branch_id ?? 0);
    const deOtraSala = Boolean(miBranch) && origenId > 0 && origenId !== Number(miBranch);
    const renglones = renglonesDe(meta);

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-start gap-2">
                <ArrowLeftRight size={13} className="text-brand-text shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="flex-1 min-w-0">
                    <p className="text-label font-black text-content leading-tight">
                        {resumenItems(meta)}
                    </p>
                    {deOtraSala && (
                        <div className="mt-1">
                            <Badge variant="warning" size="sm">
                                Sale de {meta.origen_branch_name ?? 'otra sala'}
                            </Badge>
                        </div>
                    )}
                    {/* Lo que pidieron, con sus lotes. Va ACÁ —bajo lo que se
                        pide y antes de quién lo pide— porque es parte de qué se
                        pide, no del contexto.

                        Con VARIOS productos, por producto: el renglón de arriba
                        dice «3 productos · 3 unidades», y tres lotes sueltos
                        debajo no dicen de cuál es cada uno — que es justo lo que
                        el despachador tiene que ir a buscar al estante. Las
                        casillas de la decisión traen el nombre para decidir
                        cuánto sale; el lote a buscar está acá, junto al suyo. */}
                    {renglones.length > 1 ? (
                        <div className="mt-1">
                            <ListaRenglones renglones={renglones} />
                        </div>
                    ) : lotesPedidos(meta).length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5">
                            {lotesPedidos(meta).map((l, i) => (
                                <p key={i} className="text-micro text-content-2 font-semibold">
                                    <span className="font-mono text-content-3">{l.lote || 'sin lote'}</span>
                                    {l.vence && <span className="text-content-3"> · {fmtFechaLarga(l.vence)}</span>}
                                    {' — '}{l.unidades} {l.unidades === 1 ? 'unidad' : 'unidades'}
                                </p>
                            ))}
                        </div>
                    )}
                    <p className="text-micro text-content-3 mt-0.5 truncate">
                        {nombrePor(fila.employee_id)} · {meta.branch_name ?? 'otra sala'} · {fmtCuando(fila.created_at)}
                    </p>
                    {fila.note && (
                        <p className="text-micro text-content-2 mt-1 leading-snug">{fila.note}</p>
                    )}
                </div>
            </div>
            <DecisionTraslado fila={fila} onHecho={onHecho} />
        </div>
    );
}

/* ─── Lo que pedí y ya salió ──────────────────────────────────────────────────
 *
 * Rehecha el 2026-08-17 sobre la geometría de `RequestCard` —`px-4 py-3.5`,
 * `gap-2.5`, y el pie separado por su propia línea—, que es la tarjeta canónica
 * del portal para «un asunto y qué hacer con él». Antes era una versión más
 * chica y escrita aparte, y se notaba: la misma cosa contada con otro ritmo.
 *
 * Cuatro cosas que estaban mal y por qué importan:
 *
 *  1. **El botón ocupaba el ancho entero.** No estaba pedido: el contenedor es
 *     `flex-col`, que estira a sus hijos, así que en un monitor el botón medía
 *     1.700 px para una acción de una sala. Hoy va en el pie y sólo se estira en
 *     el teléfono, donde eso SÍ es el canon (§32).
 *  2. **El nombre del producto iba detrás de la cuenta.** «6 UNIDAD · CREMA…»
 *     empieza por el dato que se repite en todas las filas; lo que distingue una
 *     de otra es el nombre, y quedaba desplazado. Se invirtió: el nombre es el
 *     ancla y la cuenta es una insignia.
 *  3. **El recorrido estaba en tinta terciaria, del tamaño más chico y pegado a
 *     la hora.** Es el dato que dice si el traslado es tuyo — con alcance de
 *     todas las salas la lista mezcla siete.
 *  4. **No se veía cuánto llevaba en camino**, sólo la hora de salida. Un
 *     traslado parado tres días se leía igual que uno de hace diez minutos, y
 *     esta lista existe justamente porque había 20 parados, el más viejo de más
 *     de una semana.
 *
 * Y muestra los lotes, que sólo salían del lado de quien despacha. Quien recibe
 * es quien tiene la caja en la mano: es el único que puede comprobar que el lote
 * que llegó es el que se pidió.
 *
 * @param ahora      El reloj de `useNowTick`, para «hace 20 min». Opcional: sin
 *                   él la tarjeta muestra la hora de salida y nada más, en vez
 *                   de un número congelado en el último render.
 * @param personaPor Resuelve un id de empleado a su FILA —con foto y cargo—,
 *                   cayendo al mapa de personas escondidas. Opcional: sin él la
 *                   tarjeta no inventa el circuito, simplemente no lo dibuja.
 */
export function FilaPorRecibir({ fila, onHecho, ahora = null, personaPor = null }) {
    const [ocupado, setOcupado] = useState(false);
    const [error,   setError]   = useState('');
    const [abierto, setAbierto] = useState(false);
    /* Lo que la sala dice que NO venía en la bolsa. Vive acá y no en el modal
     * porque quien lo manda es `recibir`, que también vive acá: con el estado
     * adentro del modal, cerrarlo perdería lo escrito sin decir nada. */
    const [faltaron, setFaltaron] = useState([]);
    const meta   = fila.metadata ?? {};
    const piezas = piezasDe(meta);
    const lotes  = lotesPedidos(meta);
    const renglones = renglonesDe(meta);
    const lotesDeMas = Math.max(0, lotes.length - LOTES_EN_TARJETA);

    // Salió cuando se despachó, que es lo que `updated_at` guarda en esta etapa.
    const salio  = fila.updated_at ?? fila.created_at;
    const espera = desdeHace(salio, ahora);
    // Más de un día en camino ya no es «en camino»: es un traslado trabado. Se
    // tiñe solo para que la cola se lea sin contar horas — mismo recurso que la
    // espera larga de `RequestCard`.
    const trabado = Boolean(ahora) && (ahora - new Date(salio).getTime()) > 86400000;

    /* Las PERSONAS, no sus nombres: `ChipPersona` necesita la fila entera para
     * poner la cara. El id se comprueba acá para que una fila vieja sin
     * despachante no dibuje el rótulo «Envió» sobre un vacío. */
    const quienPidio = personaPor ? personaPor(fila.employee_id) : null;
    const quienEnvio = personaPor ? personaPor(fila.approver_id) : null;

    const recibir = async () => {
        setError(''); setOcupado(true);
        const r = await recibirTraslado(fila.id, faltaron);
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo recibir.'); return; }
        /* El faltante NO puede tumbar la recepción: el producto ya entró al
         * inventario. Que no se haya podido anotar se dice, y no se calla — es
         * lo único que manda a alguien a buscar la caja hoy. */
        if (r?.faltante_error) { setError(r.faltante_error); return; }
        setFaltaron([]);
        onHecho();
    };

    /* `h-full` + el `mt-auto` del pie: en la rejilla de la vista las tarjetas
     * miden lo mismo de alto aunque una traiga lotes y la otra no, y el botón de
     * todas queda a la misma altura. Sin esto cada una se encoge a su contenido
     * y la fila se ve rota — reportado: «las cards deben medir lo mismo de
     * alto». Suelta (en el widget del tablero) `h-full` no hace nada. */
    return (
      <>
        <div data-surface="card" className="group px-4 py-3.5 flex flex-col gap-2.5 h-full">
            {/* La cara de la tarjeta ABRE el detalle, y la acción se queda
                afuera. `data-filo="ceder"` es lo que hace que el destello del
                canto corra el rectángulo de la TARJETA y no el del botón: sin
                él, el filo cortaba la tarjeta justo encima del pie (§5.bis). */}
            {/* `min-h-[var(--tap-min)]`: la cara de la tarjeta medía **308×40**
                con un solo renglón de contenido —el ancho sobra, el alto queda
                4px por debajo de los 44 del blanco de dedo (§32)—, y es lo que
                abre el detalle del traslado. Lo encontró el barrido móvil al
                cubrir esta ruta por primera vez. En escritorio `--tap-min` vale
                0 y no cambia nada.

                `active:scale-[0.99]`: y no acusaba el toque. En el teléfono no
                hay cursor ni realce de hover, así que el acuse ES la única señal
                de que el toque entró — y son **23 tarjetas** en esta lista, o
                sea la lista entera. Lo levantó la corrida ACOSTADO. */}
            <button type="button" data-filo="ceder" onClick={() => setAbierto(true)}
                className="text-left flex items-start gap-3.5 w-full min-h-[var(--tap-min)] active:scale-[0.99]"
                aria-label={`Ver el detalle de ${piezas?.nombre ?? 'este traslado'}`}>
                {/* ── El ANCLA: cuánto viene ────────────────────────────────
                    Acá había un camión de 16px en un disco. Decía «esto es un
                    traslado» —que ya lo dice el encabezado de la sección— y no
                    decía nada más; mientras tanto la cantidad viajaba como una
                    píldora gris del mismo peso que el resto, o sea que la
                    tarjeta no tenía un solo punto de entrada para la mirada.
                    Reportado así: «no se le ve peso a nada».

                    El número manda porque es lo que hay que cotejar contra la
                    caja que uno tiene enfrente, y de paso hace de estado: se
                    tiñe cuando el traslado lleva más de un día parado. */}
                <span className={`shrink-0 w-[3.25rem] rounded-xl px-1 py-1.5 flex flex-col items-center justify-center
                                  ring-1 ring-inset ${trabado ? 'bg-danger/10 ring-danger/25' : 'bg-warning/10 ring-warning/20'}`}>
                    <span className={`text-h3 font-black leading-none tabular-nums ${trabado ? 'text-danger-text' : 'text-warning-text'}`}>
                        {piezas?.numero ?? '—'}
                    </span>
                    <span className={`mt-1 text-[0.5625rem] font-black uppercase tracking-wider leading-none text-center
                                      ${trabado ? 'text-danger-text/80' : 'text-warning-text/80'}`}>
                        {piezas?.unidad ?? ''}
                    </span>
                </span>

                <div className="flex-1 min-w-0">
                    {/* El ancla: qué es. `line-clamp-2` y no `truncate` porque
                        los nombres de producto se distinguen por el final
                        —presentación y laboratorio— y cortarlos en una línea
                        deja dos filas idénticas.

                        `min-h` de dos renglones: la rejilla iguala alturas, así
                        que un nombre de dos líneas al lado de uno de una dejaba
                        a la corta con un hueco. Reservar el alto acá lo reparte
                        parejo en vez de acumularlo abajo. */}
                    <p className="text-body font-black text-content leading-snug line-clamp-2 min-h-[2.5em]"
                        title={piezas?.nombre ?? resumenItems(meta)}>
                        {piezas?.nombre ?? resumenItems(meta)}
                    </p>

                    {/* De dónde a dónde. Las salas en tinta plena y la flecha
                        apagada: el recorrido son dos NOMBRES, y pintarlo todo
                        del mismo gris lo convertía en una cadena de texto que
                        había que leer entera para saber si el traslado era
                        tuyo. Va SIEMPRE: con alcance de todas las sucursales
                        esta lista mezcla las siete. */}
                    <p className="mt-1 text-label font-bold text-content-2 truncate">
                        {meta?.origen_branch_name ?? 'otra sala'}
                        <span className="text-content-3 font-medium"> → </span>
                        {meta?.branch_name ?? 'destino'}
                    </p>

                    {/* Qué trae la caja. Quien recibe es el único que puede
                        comprobarlo — pero en la tarjeta va TOPADO: un traslado
                        de doce renglones empujaba el botón fuera de la pantalla
                        y estiraba a todas las demás, porque la rejilla iguala
                        alturas. El resto se lee entero en el detalle.

                        Con VARIOS productos, el ancla es el producto y los
                        lotes cuelgan de él: arriba la tarjeta dice «5
                        productos», y cinco lotes sueltos debajo no dicen cuál
                        es de cuál. Con uno solo el nombre ya está arriba y van
                        los lotes a secas, como siempre. */}
                    {renglones.length > 1 ? (
                        <div className="mt-1.5">
                            <ListaRenglones renglones={renglones} tope={LOTES_EN_TARJETA} />
                        </div>
                    ) : lotes.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-0.5">
                            {lotes.slice(0, LOTES_EN_TARJETA).map((l, i) => (
                                <p key={i} className="text-micro text-content-2 font-semibold">
                                    <span className="font-mono text-content-3">{l.lote || 'sin lote'}</span>
                                    {l.vence && <span className="text-content-3"> · {fmtFechaLarga(l.vence)}</span>}
                                    {' — '}{l.unidades} {l.unidades === 1 ? 'unidad' : 'unidades'}
                                </p>
                            ))}
                            {lotesDeMas > 0 && (
                                <p className="text-micro font-bold text-brand-text">
                                    +{lotesDeMas} {lotesDeMas === 1 ? 'lote más' : 'lotes más'}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <OjoDeTarjeta className="self-start mt-1" />
            </button>

            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}

            {/* El pie, como en `RequestCard`: a la izquierda cuándo salió y
                cuánto lleva, a la derecha qué se hace con eso. El botón sólo se
                estira en el teléfono. */}
            {/* ── El pie: desde cuándo, entre quiénes, y qué se hace ──────
                Antes eran dos renglones apilados a la izquierda con el botón al
                costado, y los rótulos «PIDIÓ» y «ENVIÓ» en versalitas negras
                competían con el nombre del producto. Son contexto, no titular.

                Lo que SÍ sube de peso es la espera: en una cola cuyo motivo de
                existir es que hay traslados parados —veinte, el más viejo de más
                de una semana— «hace 4 días» es lo que decide si hay que ir a
                buscar la caja hoy. */}
            <div className="mt-auto pt-2.5 border-t border-divider flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3 min-w-0">
                    <span className={`flex items-center gap-1.5 min-w-0 shrink-0
                                      ${trabado ? 'text-danger-text' : 'text-content-2'}`}>
                        <Clock size={12} strokeWidth={2.5} className="shrink-0" />
                        <span className="text-label font-black truncate">
                            {espera ? `${espera} en camino` : `Salió ${fmtCuando(salio)}`}
                        </span>
                    </span>

                    {/* Las caras, sin rótulo: la flecha entre las dos ya dice
                        quién pidió y quién despachó, en el mismo sentido en que
                        se lee el recorrido de arriba. El nombre entero vive en
                        el detalle. */}
                    {/* `role="img"` + `aria-label` y no `title`: las dos caras
                        con la flecha son un DIBUJO del circuito, no prosa con
                        ayuda al pasar el ratón — y un `title` en un span no
                        interactivo no llega al lector de pantalla ni al
                        teléfono, que es donde más se usa esta lista (§15.10). */}
                    {(quienPidio || quienEnvio) && (
                        <span className="flex items-center gap-1.5 min-w-0 justify-end" role="img"
                            aria-label={[quienEnvio && `Envió ${quienEnvio.name}`,
                                         quienPidio && `pidió ${quienPidio.name}`].filter(Boolean).join(', ')}>
                            {quienEnvio && <ChipPersona persona={quienEnvio} soloFoto />}
                            {quienPidio && quienEnvio && (
                                <span className="text-content-3 text-micro shrink-0">→</span>
                            )}
                            {quienPidio && <ChipPersona persona={quienPidio} soloFoto />}
                        </span>
                    )}
                </div>

                {/* Ancho completo: es la única acción de la tarjeta y en media
                    columna un botón chico a la derecha se pierde. */}
                <Button size="sm" icon={PackageCheck} loading={ocupado} disabled={ocupado}
                    onClick={recibir} className="w-full">
                    {ocupado ? 'Recibiendo…'
                        : (faltaron.length ? 'Recibir y anotar lo que faltó' : 'Ya llegó, recibir')}
                </Button>
            </div>
        </div>

        {abierto && (
            <ModalTraslado fila={fila} piezas={piezas} lotes={lotes} salio={salio}
                quienPidio={quienPidio} quienEnvio={quienEnvio} ahora={ahora}
                faltaron={faltaron} onFaltaron={setFaltaron}
                ocupado={ocupado} error={error} onRecibir={recibir}
                onCerrar={() => setAbierto(false)} />
        )}
      </>
    );
}

/* ─── El detalle de un traslado en camino ─────────────────────────────────────
 *
 * Existe porque los lotes no caben. La tarjeta los topa en dos —un traslado de
 * doce empujaba el botón fuera de la pantalla, y como la rejilla iguala
 * alturas, estiraba también a todas las demás—; acá van todos, con su
 * vencimiento y sus unidades, que es lo que hay que cotejar contra la caja que
 * uno tiene en la mano.
 *
 * Y de paso contesta lo que la tarjeta sólo insinúa: las horas exactas de las
 * dos puntas del circuito, con `FichaPersona`, que es el mismo bloque con que
 * Solicitudes muestra quién pidió y quién resolvió.
 *
 * Recibir se puede desde acá también. No es una segunda forma de hacerlo: es el
 * MISMO `recibir` de la tarjeta, pasado por prop — copiarlo habría creado dos
 * caminos que se separan en cuanto alguien toque uno.
 */
function ModalTraslado({ fila, piezas, lotes, salio, quienPidio, quienEnvio, ahora,
                         faltaron = [], onFaltaron = null,
                         ocupado, error, onRecibir, onCerrar }) {
    const meta = fila.metadata ?? {};
    const renglones = renglonesDe(meta);
    const { user } = useAuth();
    const [imprimiendo, setImprimiendo] = useState(false);
    const [avisoPapel, setAvisoPapel] = useState('');

    /* Volver a sacar el MISMO papel, y nada más (pedido del usuario: «solo debe
     * poder imprimir»). No anula el anterior ni deja marca: lo que se está
     * arreglando es una impresora, no un hecho del negocio — un ticket que no
     * salió legible no cambia nada de lo que pasó con el producto.
     *
     * La caja es la de QUIEN REIMPRIME, no la del despacho: el papel lo levanta
     * quien aprieta el botón. */
    const volverAImprimir = async () => {
        setImprimiendo(true); setAvisoPapel('');
        const r = await reimprimirTicketDeTraslado({
            metadata: meta,
            pide: quienPidio?.name ?? null,
            sala: user?.branchId ?? user?.branch_id ?? null,
        });
        setImprimiendo(false);
        setAvisoPapel(r?.ok
            // `ok` significa RECIBIDO por la caja, nunca «salió papel»: la
            // respuesta del programa de la caja es opaca y prometer en pantalla
            // lo que no se sabe es peor que no decir nada.
            ? 'El ticket se mandó a la impresora.'
            : `No se pudo imprimir: ${r?.detalle ?? 'sin detalle'}`);
    };

    return (
        <ModalShell open onClose={() => !ocupado && onCerrar()} maxWidthClass="max-w-lg"
            zClass="z-toast" closeOnEsc={!ocupado} surface={null}
            ariaLabel={`Traslado de ${piezas?.nombre ?? 'un producto'}`}>
            <CuerpoDialogo
                titulo={piezas?.nombre ?? resumenItems(meta)}
                subtitulo={[piezas?.cuenta, `Salió ${fmtCuando(salio)}`].filter(Boolean).join(' · ')}
                icono={Truck}
                tono="warning"
                anchoEscritorio="max-w-lg"
                pie={<>
                    {/* El rótulo cambia con lo que se declaró: apretar «Ya
                        llegó, recibir» habiendo escrito que faltaron dos es el
                        botón contradiciendo al formulario de arriba. */}
                    <Button icon={PackageCheck} loading={ocupado} disabled={ocupado} onClick={onRecibir}>
                        {ocupado ? 'Recibiendo…'
                            : (faltaron.length ? 'Recibir y anotar lo que faltó' : 'Ya llegó, recibir')}
                    </Button>
                    {/* Sólo con número: sin él no hay código de barras, así que
                        el papel no sería el mismo — y ese traslado se confirma a
                        mano, que es lo que ya decía el ticket original. */}
                    {meta?.erp_traslado?.id_traslado && (
                        <Button variant="secondary" icon={Printer} loading={imprimiendo}
                            disabled={ocupado || imprimiendo} onClick={volverAImprimir}>
                            {imprimiendo ? 'Imprimiendo…' : 'Imprimir el ticket'}
                        </Button>
                    )}
                    <Button variant="secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</Button>
                </>}>
                <div className="flex flex-col gap-3 text-left">
                    <div className="flex items-center justify-center gap-2 text-body-sm font-bold text-content-2">
                        <Recorrido meta={meta} />
                    </div>

                    {/* Lo que trae la caja, en su propia superficie: es la lista
                        que se coteja renglón por renglón contra lo que llegó.

                        Con VARIOS productos va por producto, con sus lotes
                        adentro — antes iban los lotes sueltos y no se sabía cuál
                        era de cuál (ver `ListaRenglones`). Con uno solo el
                        nombre ya está en el título del modal, así que repetirlo
                        sería decir dos veces lo mismo: ahí van los lotes a
                        secas, como siempre. */}
                    {renglones.length > 1 ? (
                        <div data-surface="card" className="px-3 py-2.5">
                            <p className="text-micro font-black uppercase tracking-widest text-content-3 mb-1.5">
                                Los {renglones.length} productos que se pidieron
                            </p>
                            <ListaRenglones renglones={renglones} />
                        </div>
                    ) : lotes.length > 0 && (
                        <div data-surface="card" className="px-3 py-2.5">
                            <p className="text-micro font-black uppercase tracking-widest text-content-3 mb-1.5">
                                {lotes.length === 1 ? 'El lote que se pidió' : `Los ${lotes.length} lotes que se pidieron`}
                            </p>
                            <div className="flex flex-col gap-1">
                                {lotes.map((l, i) => (
                                    <p key={i} className="flex items-baseline justify-between gap-2 text-label text-content-2 font-semibold">
                                        <span className="min-w-0 truncate">
                                            <span className="font-mono text-content-3">{l.lote || 'sin lote'}</span>
                                            {l.vence && <span className="text-content-3"> · vence {fmtFechaLarga(l.vence)}</span>}
                                        </span>
                                        <span className="shrink-0 tabular-nums">
                                            {l.unidades} {l.unidades === 1 ? 'unidad' : 'unidades'}
                                        </span>
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Y si al abrir la caja falta algo ──────────────────
                        Va acá, junto a la lista contra la que se cotejó, y no
                        en la tarjeta: la tarjeta es el camino rápido —la bolsa
                        llegó completa, que es el caso normal— y un formulario
                        sobre el camino normal es un formulario que se aprende a
                        saltear. Se abre a propósito, que es exactamente lo que
                        quiere decir «vi de menos». */}
                    {onFaltaron && (
                        <DeclararFaltantes
                            items={loQueLlego(meta)}
                            valor={faltaron}
                            onCambio={onFaltaron}
                            deshabilitado={ocupado}
                            origen={meta?.origen_branch_name}
                        />
                    )}

                    {fila.note && (
                        <p className="text-label text-content-2 leading-snug">{fila.note}</p>
                    )}

                    {/* Las dos puntas, con hora. En la tarjeta sólo caben los
                        nombres; acá se ve cuándo pidió y cuándo salió, que es
                        lo que contesta «¿por qué tarda?». */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <FichaPersona rotulo="Pidió" persona={quienPidio} vacio="Sin registro"
                            cuando={fila.created_at} apunte={desdeHace(fila.created_at, ahora)} />
                        <FichaPersona rotulo="Envió" persona={quienEnvio} vacio="Sin registro"
                            cuando={salio} apunte={cuantoTardo(fila.created_at, salio)} tono="warning" />
                    </div>

                    {avisoPapel && (
                        <p className="text-label text-content-2 font-medium">{avisoPapel}</p>
                    )}
                    {error && <p className="text-label text-danger-text font-medium">{error}</p>}
                </div>
            </CuerpoDialogo>
        </ModalShell>
    );
}

// La fila de historial vivía acá y se retiró el 2026-08-07: el historial es una
// lista de REGISTROS y va en `DataTable` (§32), que da la tabla en escritorio,
// las fichas en el teléfono y el vacío, los tres de una. Reportado sobre la
// primera versión de la vista: «no es canónico, dónde están las cards».
// Lo que queda acá son las dos filas de ACCIÓN, que sí son tarjetas porque
// llevan un formulario adentro.
