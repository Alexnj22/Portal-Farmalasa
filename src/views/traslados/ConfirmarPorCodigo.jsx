import React, { useCallback, useState, lazy, Suspense } from 'react';
import { Camera, PackageCheck, ScanLine } from 'lucide-react';
import ModalShell from '../../components/common/ModalShell';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { SkeletonText } from '../../components/common/StateViews';
import useCapturaDeCarne from '../../hooks/useCapturaDeCarne';
import { fetchTrasladoPorCodigo, recibirTraslado } from '../../data/traslados';
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

    const buscar = useCallback(async (codigo) => {
        setBuscando(true); setError(''); setHallado(null); setListo(null);
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
    const { teclas, diagnostico } = useCapturaDeCarne(
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
        if (!abierto) { setHallado(null); setListo(null); setError(''); setConCamara(false); }
    }

    const confirmar = async () => {
        if (!hallado?.id) return;
        setOcupado(true); setError('');
        const r = await recibirTraslado(hallado.id);
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
        setListo(hallado);
        setHallado(null);
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
                    {hallado?.id && !hallado.ya_recibido && (
                        <Button icon={PackageCheck} loading={ocupado} disabled={ocupado} onClick={confirmar}>
                            {ocupado ? 'Confirmando…' : 'Sí, llegó completa'}
                        </Button>
                    )}
                    {(hallado || listo) && !ocupado && (
                        <Button variant="secondary" onClick={() => { setHallado(null); setListo(null); setError(''); }}>
                            Escanear otro
                        </Button>
                    )}
                    <Button variant="secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</Button>
                </>}>
                <div className="flex flex-col gap-3 text-left">
                    {error && <Notice variant="danger">{error}</Notice>}

                    {listo && (
                        <Notice variant="success">
                            Confirmada la llegada de {listo.origen ?? 'la otra sala'}. Escanea la
                            siguiente bolsa cuando quieras.
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
                            {diagnostico && <LecturaQueNoEntro d={diagnostico} />}
                            <Button variant="secondary" icon={Camera} onClick={() => setConCamara(true)}>
                                Usar la cámara
                            </Button>
                        </div>
                    )}

                    {hallado && !hallado.id && (
                        <Notice variant={hallado.es_de_un_pedido ? 'warning' : 'danger'}>
                            {hallado.es_de_un_pedido
                                ? 'Ese ticket es de un pedido de Bodega, no de un traslado entre salas. Se recibe desde Pedidos.'
                                : 'No encontramos ese ticket. Puede que sea de otra sala, o que el código no se haya leído bien.'}
                        </Notice>
                    )}

                    {hallado?.id && (
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
