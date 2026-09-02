import { Undo2, Check, X, Loader2, Truck, PackageCheck, AlertTriangle, FlaskConical } from 'lucide-react';
import Button from '../../../components/common/Button';
import PortalInput from '../../../components/common/PortalInput';
import Badge from '../../../components/common/Badge';
import EmpChip from './EmpChip';
import EvidenciaFotos from '../../../components/common/EvidenciaFotos';

// La devolución de un renglón, pegada a su diferencia.
//
// Es una conversación de tres turnos y ninguno se saltea: la sala pide, bodega
// decide —y al aceptar el producto sale de la sala—, y bodega confirma la
// entrada. Ese tercero es el que faltaba: sin él el producto queda en tránsito,
// fuera de la sala y todavía no en bodega, que es peor que estar en cualquiera
// de los dos lados.
//
// Por eso el estado `enviada` se pinta en `warning` y no en `success`: salir no
// es haber llegado.

const MOTIVO_LABEL = {
    faltante: 'No llegó', danado: 'Dañado', vencido: 'Vencido', sobrante: 'Llegó de más',
};

export default function DevolucionBloque({
    dev, isBranch, busyAction, empMap = new Map(), readOnly = false,
    onMover, onRecibir, onProbar,
}) {
    // ── Todavía no hay devolución ────────────────────────────────────────────
    // Acá vivía el botón «Devolver a bodega», que era la puerta de entrada. Ya
    // no: devolver es UNA de las dos salidas de la decisión (2026-08-18), y la
    // decisión es la única puerta. Tener las dos abiertas era tener dos
    // conversaciones sobre el mismo renglón — la forma de que una diga que sí y
    // la otra que no.
    //
    // Este bloque queda con lo que nadie más hace: mover el producto y firmar
    // que entró.
    if (!dev) return null;

    const moviendo   = busyAction === `devmov_${dev.id}`;
    const probando   = busyAction === `devsim_${dev.id}`;
    const recibiendo = busyAction === `devrec_${dev.id}`;
    const quienPidio = dev.solicitada_por ? empMap.get(dev.solicitada_por) : null;
    const quienDecidio = dev.decidida_por ? empMap.get(dev.decidida_por) : null;

    // El movimiento NO es otra tarjeta adentro de la del renglón: son dos
    // anillos concéntricos y §5.1 de DESIGN.md lo prohíbe. Es una franja
    // separada por una línea, igual que la decisión de arriba — y el estado lo
    // dice el ícono y el rótulo, no un rectángulo de color más.
    const acento = {
        enviada:    'text-warning-text',
        recibiendo: 'text-warning-text',
        recibida:   'text-success-text',
        rechazada:  'text-danger-text',
        error:      'text-danger-text',
    }[dev.estado] ?? 'text-content-2';

    // El sentido cambia las dos puntas de cada rótulo. Un sobrante sale de
    // BODEGA y entra a la SALA — decir «salió de la sala» ahí manda a buscar el
    // producto al lugar equivocado.
    const aLaSala = dev.sentido === 'a_sala';
    const deDonde = aLaSala ? 'bodega'   : 'la sala';
    const aDonde  = aLaSala ? 'la sala'  : 'bodega';

    const rotulo = {
        solicitada: 'Movimiento pedido',
        aceptada:   `Acordado — falta que salga de ${deDonde}`,
        enviando:   `Saliendo de ${deDonde}…`,
        enviada:    `Salió de ${deDonde} — falta que entre a ${aDonde}`,
        recibiendo: `Entrando a ${aDonde}…`,
        recibida:   `Entró en ${aDonde}`,
        rechazada:  'Movimiento rechazado',
        error:      'El movimiento no se pudo hacer',
    }[dev.estado] ?? dev.estado;

    return (
        <div className="border-t border-divider pt-2.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
                <Undo2 size={12} className={`shrink-0 ${acento}`} />
                <span className={`text-label font-bold ${acento}`}>{rotulo}</span>
                <Badge variant="neutral" size="sm" uppercase={false}>{MOTIVO_LABEL[dev.motivo] ?? dev.motivo}</Badge>
                <span className="text-caption text-content-3">{dev.cantidad}</span>
                {dev.estado === 'recibida' && <PackageCheck size={12} className="text-success shrink-0" />}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-caption text-content-3">
                <span>{dev.viaja
                    ? 'El producto viaja de vuelta a bodega.'
                    : aLaSala
                        ? 'No viaja nada: el producto ya está en la sala.'
                        : 'No viaja nada: quedó en bodega desde el principio.'}</span>
                <EmpChip emp={quienPidio} prefijo="Pedida por" size="xs" />
            </div>

            {dev.nota && <p className="text-caption text-content-2 italic">«{dev.nota}»</p>}

            {/* La foto del daño: lo único que bodega puede mirar para decidir.
                `EvidenciaFotos` es el canónico de «lo que ya está subido» —abre
                la foto en el visor y no en otra pestaña, y dibuja la miniatura
                que NO se pudo firmar en vez de dejar un hueco. Acá vivía una
                copia a mano que hacía las dos cosas peor. */}
            <EvidenciaFotos urls={dev.evidencia_urls} titulo="Foto del producto" />

            {dev.aviso && (
                <p className="text-caption text-warning-text flex items-start gap-1.5">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" />{dev.aviso}
                </p>
            )}
            {dev.error_msg && (
                <p className="text-caption text-danger flex items-start gap-1.5">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" />{dev.error_msg}
                </p>
            )}
            {dev.motivo_rechazo && (
                <div className="flex items-center gap-2 flex-wrap text-caption text-danger">
                    <span><strong>Bodega dijo que no:</strong> {dev.motivo_rechazo}</span>
                    <EmpChip emp={quienDecidio} size="xs" tono="danger-text" />
                </div>
            )}

            {readOnly ? null : (<>
                {/* Acá estaba «Aceptar / No devolver». El acuerdo ahora se
                    da arriba, en la decisión, y la devolución nace ACEPTADA:
                    volver a preguntarlo sería la misma conversación dos veces.
                    Una fila vieja en «solicitada» sigue pudiendo cerrarse desde
                    la bitácora, pero ya no nacen así. */}
                {dev.estado === 'solicitada' && (
                    <p className="text-caption text-content-3 italic">
                        Pedida con el circuito anterior — resolvela desde la decisión de arriba.
                    </p>
                )}

                {/* ── Salió: falta que entre ── */}
                {(dev.estado === 'enviada' || dev.estado === 'error') && !isBranch && dev.id_traslado && (
                    <div className="space-y-1.5">
                        <Button tone="warning" icon={PackageCheck} disabled={recibiendo}
                            onClick={() => onRecibir?.(dev.id)}>
                            {recibiendo ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar entrada'}
                        </Button>
                        <p className="text-micro text-content-3 leading-snug">
                            {dev.viaja
                                ? 'Confírmalo cuando tengas el producto en la mano, no antes.'
                                : 'Como no viaja nada, se puede confirmar ya mismo.'}
                        </p>
                    </div>
                )}
                {dev.estado === 'enviada' && isBranch && (
                    <p className="text-caption text-content-3 italic">
                        {aLaSala          ? 'Falta que bodega confirme la entrada en tu sala.'
                         : dev.viaja      ? 'Falta que bodega lo reciba.'
                         :                  'Falta que bodega lo confirme.'}
                    </p>
                )}

                {/* ── Aceptada pero todavía adentro: se vuelve a intentar ──
                    Aceptar y mover son un gesto solo para quien aprieta; acá
                    abajo son dos escrituras, y ésta es la que puede fallar
                    —sin existencia, presentación cambiada, pausa— sin borrar
                    el acuerdo. */}
                {(dev.estado === 'aceptada'
                  || (dev.estado === 'error' && !dev.id_traslado && !dev.detalle?.revisar_a_mano)) && !isBranch && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button tone="chart-3" icon={Truck} disabled={moviendo || probando}
                            onClick={() => onMover?.(dev.id)}>
                            {moviendo ? <Loader2 size={10} className="animate-spin" />
                                      : (aLaSala ? 'Sacarlo de bodega' : 'Sacarlo de la sala')}
                        </Button>
                        {/* La misma corrida SIN escribir. La función hace todas
                            las comprobaciones contra el sistema —abre la sesión,
                            busca el producto, resuelve la presentación, mide la
                            existencia, reparte los lotes— y no toca una línea.
                            Existía desde el día uno (`simulacro` es su valor por
                            omisión) y no había forma de dispararla, así que un
                            movimiento pausado era un freno sin salida: la única
                            manera de saber si iba a andar era dejarlo andar. */}
                        <Button variant="secondary" icon={FlaskConical} disabled={moviendo || probando}
                            onClick={() => onProbar?.(dev.id)}
                            title="Hace todas las comprobaciones contra el sistema y no mueve nada">
                            {probando ? <Loader2 size={10} className="animate-spin" /> : 'Probar sin mover nada'}
                        </Button>
                    </div>
                )}

                {/* Una línea que se cortó a mitad de camino NO se reintenta sola:
                    puede haber entrado en el sistema sin que se alcanzara a
                    anotar, y repetirla movería el producto dos veces. */}
                {dev.estado === 'error' && dev.detalle?.revisar_a_mano && (
                    <p className="text-caption text-danger-text font-semibold">
                        Hay que revisarla a mano antes de volver a intentar — busca «{dev.clave}».
                    </p>
                )}

            </>)}
        </div>
    );
}
