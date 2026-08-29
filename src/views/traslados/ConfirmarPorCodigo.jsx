import React, { useCallback, useState, lazy, Suspense } from 'react';
import { Camera, PackageCheck, ScanLine } from 'lucide-react';
import ModalShell from '../../components/common/ModalShell';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { SkeletonText } from '../../components/common/StateViews';
import useCapturaDeCarne from '../../hooks/useCapturaDeCarne';
import { fetchTrasladoPorCodigo, recibirTraslado } from '../../data/traslados';
import DeclararFaltantes from './DeclararFaltantes';
import { FilaEnvioPorDecidir } from './FilasEnvio';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fmtCuando } from './trasladoTexto';
import LecturaQueNoEntro from './LecturaQueNoEntro';

// La cámara pesa y sólo hace falta si alguien la pide: el camino normal es el
// lector de la sala, que teclea. Regla de las librerías pesadas de CLAUDE.md.
const LectorDeCodigo = lazy(() => import('../../components/common/LectorDeCodigo'));

/**
 * Confirmar que la bolsa llegó, escaneando el ticket que trae pegado.
 *
 * Reemplaza a la firma a lápiz que traía el papel hasta v2.730.3. Una firma no
 * se puede consultar después, no dice a qué hora llegó y —lo que importa acá—
 * no puede avisar que ese traslado YA se había confirmado.
 *
 * ── Los cuatro desenlaces, y por qué ninguno es un error genérico ──────────
 * Lo que se escanea es papel que alguien tiene en la mano, así que «no se pudo»
 * no sirve: hay que decir QUÉ es lo que hay en la mano.
 *
 *   · **Es una bolsa mía y falta recibirla** → se muestra qué trae y se confirma.
 *   · **Ya la recibieron** → se dice quién y cuándo. No es un fallo: es la
 *     respuesta que se vino a buscar, y por eso se pinta en verde y no en rojo.
 *   · **El código es de un pedido de Bodega** → el número de traslado es UNA
 *     sola secuencia compartida, así que un papel de pedido escanea igual de
 *     bien. Decirlo evita el callejón de «ese código no existe» sobre algo que
 *     sí existe.
 *   · **No aparece** → puede ser que no exista o que sea de otra sala; el RLS no
 *     deja distinguirlo y el mensaje dice las dos cosas en vez de afirmar una.
 *
 * ── Dos lectores, un solo camino ──────────────────────────────────────────
 * El de la sala teclea (`useCapturaDeCarne` lo separa de una persona por la
 * velocidad) y la cámara es el respaldo para quien escanea parado junto a las
 * bolsas. Los dos entregan el mismo texto a `buscar`, así que hay un solo
 * detector que corregir.
 *
 * A diferencia del carné, **acá un código tecleado SÍ vale**: el número no está
 * escrito en ninguna parte del papel —va sólo adentro de las barras— así que
 * nadie puede teclearlo de memoria, y no hay presencia que probar.
 */
export default function ConfirmarPorCodigo({ abierto, onCerrar, onHecho }) {
    const [buscando, setBuscando] = useState(false);
    const [ocupado,  setOcupado]  = useState(false);
    const [error,    setError]    = useState('');
    const [hallado,  setHallado]  = useState(null);
    const [conCamara, setConCamara] = useState(false);
    const [listo,    setListo]    = useState(null);   // el que se acaba de recibir
    // Lo que la sala dice que NO venía en la bolsa. Vacío es el camino normal.
    const [faltaron, setFaltaron] = useState([]);

    const buscar = useCallback(async (codigo) => {
        setBuscando(true); setError(''); setHallado(null); setListo(null); setFaltaron([]);
        const { traslado, error: e } = await fetchTrasladoPorCodigo(codigo);
        setBuscando(false);
        if (e) { setError(mensajeAmigable(e, 'No se pudo leer ese código.')); return; }
        setHallado(traslado);
    }, []);

    // La captura global de teclas sólo existe mientras el diálogo está abierto y
    // no hay nada que confirmar: con una bolsa ya en pantalla, un escaneo nuevo
    // la reemplazaría sin que nadie lo pidiera.
    //
    // `aceptarTecleado` + `sinEnter`: acá el candado de velocidad no protege
    // nada —el número no está impreso en el papel, así que no hay memoria que
    // valga— y en cambio TIRABA la lectura de todo lector que no manda Enter, o
    // que teclea con un hueco de más de 80ms entre caracteres. En las dos
    // formas el diálogo se quedaba en «Esperando el código del ticket» sin
    // decir nada, y la cámara del teléfono leía el mismo papel a la primera.
    const { teclas, diagnostico, eventos } = useCapturaDeCarne(
        abierto && !hallado && !listo && !conCamara, buscar,
        { aceptarTecleado: true, sinEnter: true },
    );

    /* Se limpia AL CERRAR, y se ajusta durante el render y no en un efecto.
     *
     * Un efecto que llama a `setState` provoca un render en cascada —lo marca
     * `react-hooks/set-state-in-effect`— y acá no hace falta: React documenta
     * este patrón justamente para «reiniciar cuando una prop cambia». Sin la
     * limpieza, volver a abrir el diálogo mostraría la bolsa del escaneo
     * anterior como si fuera la que se acaba de leer, que es la peor confusión
     * posible en una pantalla que confirma llegadas. */
    const [estabaAbierto, setEstabaAbierto] = useState(abierto);
    if (abierto !== estabaAbierto) {
        setEstabaAbierto(abierto);
        if (!abierto) { setHallado(null); setListo(null); setError(''); setConCamara(false); setFaltaron([]); }
    }

    const confirmar = async () => {
        if (!hallado?.id) return;
        setOcupado(true); setError('');
        const r = await recibirTraslado(hallado.id, faltaron);
        setOcupado(false);
        if (!r?.ok) {
            // El servidor tiene la última palabra y sabe decir que ya se recibió
            // —`YA_RECIBIDO`—, que es distinto de un fallo: entre que se escaneó
            // y se apretó, alguien más pudo haberla recibido.
            if (r?.codigo === 'YA_RECIBIDO') {
                setHallado({ ...hallado, ya_recibido: true });
                setError('');
                return;
            }
            setError(r?.error ?? 'No se pudo confirmar la llegada.');
            return;
        }
        // El faltante NO puede tumbar la recepción: el producto ya entró. Se dice
        // aparte, que es lo único honesto — la caja llegó y lo que faltó quedó
        // sin anotar, y esas dos cosas hay que poder verlas juntas.
        if (r?.faltante_error) setError(r.faltante_error);
        setListo({ ...hallado, faltaron: faltaron.length });
        setHallado(null);
        setFaltaron([]);
        onHecho?.();
    };

    if (!abierto) return null;

    return (
        <ModalShell open onClose={() => !ocupado && onCerrar()} maxWidthClass="max-w-lg"
            closeOnEsc={!ocupado} surface={null} ariaLabel="Recibir traslado escaneando el ticket">
            <CuerpoDialogo
                titulo="Recibir traslado"
                subtitulo="Pasa el lector por el código del ticket de la bolsa"
                icono={ScanLine}
                anchoEscritorio="max-w-lg"
                pie={<>
                    {hallado?.id && !hallado.ya_recibido && !hallado.es_un_envio && (
                        /* El rótulo cambia con lo que se declaró, y no es
                           cosmético: apretar «Sí, llegó completa» habiendo
                           escrito que faltaron dos es el botón contradiciendo
                           al formulario de arriba. */
                        <Button icon={PackageCheck} loading={ocupado} disabled={ocupado} onClick={confirmar}>
                            {ocupado ? 'Confirmando…'
                                : (faltaron.length ? 'Recibir y anotar lo que faltó' : 'Sí, llegó completa')}
                        </Button>
                    )}
                    {(hallado || listo) && !ocupado && (
                        <Button variant="secondary" onClick={() => { setHallado(null); setListo(null); setError(''); setFaltaron([]); }}>
                            Escanear otro
                        </Button>
                    )}
                    <Button variant="secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</Button>
                </>}>
                <div className="flex flex-col gap-3 text-left">
                    {error && <Notice variant="danger">{error}</Notice>}

                    {listo && (
                        <Notice variant={listo.faltaron ? 'warning' : 'success'}>
                            Confirmada la llegada de {listo.origen ?? 'la otra sala'}.
                            {listo.faltaron
                                ? ` Quedó anotado que faltaron ${listo.faltaron} ${listo.faltaron === 1 ? 'producto' : 'productos'};`
                                  + ` ya le avisamos a ${listo.origen ?? 'la otra sala'}.`
                                : ' Escanea la siguiente bolsa cuando quieras.'}
                        </Notice>
                    )}

                    {buscando && <SkeletonText lines={3} />}

                    {!hallado && !listo && !buscando && (
                        <div className="flex flex-col items-center gap-3 py-4">
                            <div className="relative w-16 h-16 rounded-2xl bg-chart-1/10 border-2 border-chart-1/30 flex items-center justify-center">
                                <div className="absolute inset-0 rounded-2xl border-2 border-chart-1 pointer-events-none animate-pulse" />
                                <ScanLine size={28} className="text-chart-1-text" />
                            </div>
                            <p className="text-body-sm text-content-2 text-center">
                                {teclas > 0 ? 'Leyendo…' : 'Esperando el código del ticket'}
                            </p>
                            {/* ── Qué mandó el lector, cuando no alcanzó ───────
                                Si esta caja se dibuja, la última ráfaga NO se
                                entregó — una que se entrega deja `hallado` y
                                este bloque no se pinta. Y sin decirlo, «el
                                lector no funciona» y «el lector no manda nada»
                                se ven idénticos, que son dos problemas con dos
                                arreglos distintos y en dos sitios distintos. */}
                            <LecturaQueNoEntro d={diagnostico} eventos={eventos} />
                            <Button variant="secondary" icon={Camera} onClick={() => setConCamara(true)}>
                                Usar la cámara
                            </Button>
                        </div>
                    )}

                    {/* ── La bolsa de un ENVÍO ─────────────────────────────
                        No se recibe de un botón: nadie la pidió, así que se
                        decide producto por producto —me la quedo, la devuelvo,
                        o no llegó—. La pantalla que hace eso ya existe y es la
                        misma de la lista: reusarla es lo que evita dos
                        decisiones que se parecen y se comportan distinto. */}
                    {hallado?.es_un_envio && hallado.envio_bolsa && (
                        <FilaEnvioPorDecidir
                            envio={hallado.envio_bolsa}
                            onHecho={() => { setListo({ origen: hallado.envio_bolsa.origen_branch_name }); setHallado(null); onHecho?.(); }}
                        />
                    )}
                    {hallado?.es_un_envio && !hallado.envio_bolsa && (
                        <Notice variant="danger">
                            Ese ticket es de una bolsa que no puedes ver: es de otras salas.
                        </Notice>
                    )}

                    {hallado && !hallado.id && !hallado.es_un_envio && (
                        <Notice variant={hallado.es_de_un_pedido ? 'warning' : 'danger'}>
                            {hallado.es_de_un_pedido
                                ? 'Ese ticket es de un pedido de Bodega, no de un traslado entre salas. Se recibe desde Pedidos.'
                                : 'No encontramos ese ticket. Puede que sea de otra sala, o que el código no se haya leído bien.'}
                        </Notice>
                    )}

                    {hallado?.id && !hallado.es_un_envio && (
                        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
                            <p className="text-body-sm font-bold text-content-1">
                                {hallado.origen ?? 'La otra sala'} → {hallado.destino ?? 'esta sala'}
                            </p>
                            <p className="text-micro text-content-3">
                                Envió {hallado.envio ?? 'alguien'} · Salió {fmtCuando(hallado.despachado_at)}
                            </p>
                            <ul className="flex flex-col gap-1">
                                {(hallado.items ?? []).map((it, i) => (
                                    <li key={i} className="flex justify-between gap-3 text-body-sm">
                                        <span className="text-content-2">{it?.descripcion ?? 'Sin nombre'}</span>
                                        <span className="font-bold text-content-1">{it?.cantidad}</span>
                                    </li>
                                ))}
                            </ul>
                            {hallado.ya_recibido && (
                                <Notice variant="success">
                                    Esta bolsa ya se había confirmado
                                    {hallado.recibio ? `, la recibió ${hallado.recibio}` : ''}
                                    {hallado.recibido_at ? ` ${fmtCuando(hallado.recibido_at)}` : ''}.
                                </Notice>
                            )}
                            {!hallado.ya_recibido && (
                                <DeclararFaltantes
                                    items={hallado.items ?? []}
                                    valor={faltaron}
                                    onCambio={setFaltaron}
                                    deshabilitado={ocupado}
                                    origen={hallado.origen}
                                />
                            )}
                        </div>
                    )}
                </div>
            </CuerpoDialogo>

            {conCamara && (
                <Suspense fallback={null}>
                    <LectorDeCodigo
                        abierto
                        titulo="Escanear el ticket de la bolsa"
                        onCerrar={() => setConCamara(false)}
                        onLeer={(v) => { setConCamara(false); buscar(v); }}
                    />
                </Suspense>
            )}
        </ModalShell>
    );
}
