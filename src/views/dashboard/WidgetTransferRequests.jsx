import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { ArrowLeftRight, CheckCircle2, ScanLine, Send, Truck } from 'lucide-react';
import Button from '../../components/common/Button';
import LanzadorSolicitud from './LanzadorSolicitud';
import { Flujo, FranjaVacia } from './InstrumentoBaldosa';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { useNowTick } from '../../hooks/useNowTick';
import { buscadorDePersonas } from '../solicitudes/movimientoTexto';
import {
    fetchSalasQueCubro, fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir,
} from '../../data/traslados';
import { fetchEnviosVivos, momentoDelEnvio } from '../../data/envios';

// Widget «Traslados entre Salas».
//
// Es el otro extremo de la lista de faltantes de Consulta de Inventario: allá
// una sala pide lo que no tiene, y acá la sala que lo tiene confirma o dice que
// no. Las dos mitades del mismo movimiento.
//
// ── Por qué no vive en Solicitudes ────────────────────────────────────────
// Porque quien confirma un traslado no tiene por qué poder aprobar vacaciones.
// El permiso es `traslados`, aparte de `requests`, y esta pantalla es la única
// que lo consulta. Mandar el aviso a /requests dejaría a una jefatura de sala
// mirando una vista que su permiso no abre.
//
// ── Dos listas, porque son dos momentos ───────────────────────────────────
// «Por confirmar» es lo que otra sala me pide. «Por recibir» es lo que yo pedí,
// ya salió y todavía no entró — el estado que el sistema llama NO RECIBIDO y
// que hoy tiene 20 traslados parados, el más viejo de hace más de una semana.
// Sin la segunda, el producto queda en tránsito y nadie vuelve a mirarlo.

// Las filas —la de confirmar, la de recibir— viven en
// `views/traslados/FilasTraslado.jsx`: las usa también la vista `/traslados`, y
// dos copias de la misma fila terminan comportándose distinto.

/* ─── El contenido del modal ──────────────────────────────────────────────── */
// Ya no pide nada: recibe las dos listas que la baldosa trajo al montarse, así
// que abrir el modal muestra el contenido en vez de un esqueleto.
function PanelTraslados({ porConfirmar, porRecibir, envios, error, onCambio }) {
    const [abrirEscaneo, setAbrirEscaneo] = useState(false);
    const [abrirRetiro,  setAbrirRetiro]  = useState(false);
    const { hasPermission, getScope, user } = useAuth();
    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const employees = useStaffStore(s => s.employees);

    // Confirmar un traslado es el permiso `traslados`; recibir lo que uno pidió
    // no lo necesita. Son dos cosas distintas y por eso son dos secciones: la
    // primera solo aparece para quien puede decidir sobre el producto de su
    // sala. El RLS ya no le mostraría las filas de todos modos — esto evita el
    // encabezado de una lista que siempre va a estar vacía.
    const puedeConfirmar = hasPermission('traslados', 'can_approve');

    /* La PERSONA entera —con su foto— para las caras de la tarjeta, con el mismo
     * respaldo que la vista: `employees_select` esconde a los cargos `is_su`, y
     * quien despacha un traslado suele ser uno de ésos. Las dos pantallas
     * comparten la tarjeta, así que comparten también de dónde saca las caras —
     * es la deriva que el encabezado de `FilasTraslado` viene a evitar. */
    const personasDeSolicitudes = useStaffStore(s => s.personasDeSolicitudes);
    const resolverPersonas      = useStaffStore(s => s.resolverPersonasDeSolicitudes);
    const personaPor = useMemo(() => {
        const enElMaestro = buscadorDePersonas(employees);
        return (id) => (id ? (enElMaestro(id) ?? personasDeSolicitudes?.[String(id)] ?? null) : null);
    }, [employees, personasDeSolicitudes]);

    /* El nombre suelto, resuelto por `personaPor` — o sea con el mismo respaldo
     * que las caras, y como ya lo hace la vista `/traslados`.
     *
     * Salía del maestro de personal a secas y por eso decía «Alguien» SIEMPRE en
     * esta lista, no por casualidad: el maestro trae a la gente de la sala
     * propia, y quien pide un traslado es por definición de OTRA sala —pide la
     * que no tiene, confirma la que sí—. Es el mismo hueco que la bandeja de
     * Solicitudes ya tapaba y esta tarjeta no. */
    const nombrePor = useCallback((id) => personaPor(id)?.name ?? 'Alguien', [personaPor]);

    useEffect(() => {
        const faltan = [...new Set([...(porConfirmar ?? []), ...(porRecibir ?? [])]
            .flatMap(f => [f.employee_id, f.approver_id])
            .filter(id => id && !(employees ?? []).some(e => e.id === id)))];
        if (faltan.length > 0) resolverPersonas(faltan);
    }, [porConfirmar, porRecibir, employees, resolverPersonas]);

    /* El mismo reloj que la vista: la tarjeta dice cuánto lleva el traslado en
     * camino, y las dos pantallas comparten la tarjeta — dejarlo sólo en una
     * sería la deriva que el encabezado de `FilasTraslado` viene a evitar. */
    const ahora = useNowTick(60_000);

    /* Los envíos, repartidos por MOMENTO — que es lo mismo que decir «por a
     * quién le toca hacer algo». La pregunta se contesta en `momentoDelEnvio` y
     * no acá: un envío le aparece a las dos salas y NO dice lo mismo a cada una,
     * así que si cada pantalla lo resolviera por su cuenta terminarían mostrando
     * estados distintos del mismo envío. */
    const porMomento = useMemo(() => {
        const g = { por_decidir: [], por_despachar: [], en_camino: [], por_recibir_devolucion: [] };
        for (const e of envios ?? []) {
            const m = momentoDelEnvio(e, miBranch);
            if (g[m]) g[m].push(e);
        }
        return g;
    }, [envios, miBranch]);

    /* Enviar es `can_edit` —sacar producto de una sala—, no `can_approve`, que
     * es decidir sobre lo que llega.
     *
     * Y la sala propia hace falta SÓLO sin alcance sobre todas. Exigirla siempre
     * escondía el botón justo a quien más lo necesita: supervisión y
     * administración no tienen sala asignada, y son quienes reparten un producto
     * nuevo entre las siete. Con alcance, la sala se elige por renglón. */
    const puedeEnviar = hasPermission('traslados', 'can_edit')
        && (getScope('traslados') === 'ALL' || Boolean(miBranch));
    const [abrirEnvio, setAbrirEnvio] = useState(false);

    const cargando = porConfirmar === null || porRecibir === null || envios === null;
    const vacio = !cargando
        && (!puedeConfirmar || porConfirmar.length === 0)
        && porRecibir.length === 0
        && (envios ?? []).length === 0;

    return (
        <div className="flex flex-col gap-4 flex-1 min-h-0">
            {/* ── Acá NO va un encabezado ──────────────────────────────────
                Vivía uno —ícono, «Traslados entre salas» y su bajada— y
                `LanzadorSolicitud` ya pinta exactamente eso en la cabecera del
                modal: el mismo ícono, el mismo título y una bajada que dice lo
                mismo con otras palabras. Reportado con una captura: «hay doble
                encabezado».

                La nota que lo justificaba —«sin él el modal se abre en una caja
                con un mensaje suelto»— era cierta cuando este panel se dibujaba
                sin cabecera propia del modal. Hoy la tiene, y repetirla roba el
                alto que la lista necesita. */}

            {/* Empujar producto a otra sala. Va ARRIBA y no al final: es lo
                único que se puede EMPEZAR desde acá —todo lo demás es contestar
                algo que ya existe—, y un botón de empezar debajo de una lista
                de pendientes no se encuentra el día que la lista está larga.
                `primary` y ancho completo: es LA acción de esta pantalla, y en
                secundario se leía como una fila más del listado. */}
            {/* Las DOS cosas que se pueden empezar desde acá, juntas y arriba.
                Confirmar escaneando faltaba: vivía sólo en la vista de
                Traslados, y quien recibe una bolsa trabaja en el tablero — o
                sea que la acción estaba donde no se la busca. En una fila
                cuando entran; apiladas en el teléfono. */}
            <div className="shrink-0 flex flex-col sm:flex-row gap-2">
                {puedeEnviar && (
                    <Button variant="primary" icon={Send}
                        className="min-h-[var(--tap-min)] w-full"
                        onClick={() => setAbrirEnvio(true)}>
                        Enviar producto a otra sala
                    </Button>
                )}
                <Button variant="secondary" icon={ScanLine}
                    className="min-h-[var(--tap-min)] w-full"
                    onClick={() => setAbrirEscaneo(true)}>
                    Confirmar escaneando el ticket
                </Button>
                <Button variant="secondary" icon={Truck}
                    className="min-h-[var(--tap-min)] w-full"
                    onClick={() => setAbrirRetiro(true)}>
                    Lo que llevas
                </Button>
            </div>

            {abrirRetiro && (
                <Suspense fallback={null}>
                    <RetiroModal abierto onCerrar={() => setAbrirRetiro(false)} onCambio={onCambio} />
                </Suspense>
            )}

            {abrirEscaneo && (
                <Suspense fallback={null}>
                    <ConfirmarPorCodigo
                        abierto
                        onCerrar={() => setAbrirEscaneo(false)}
                        onHecho={onCambio}
                    />
                </Suspense>
            )}

            {abrirEnvio && (
                <Suspense fallback={null}>
                    <EnviarProductoModal
                        onClose={() => setAbrirEnvio(false)}
                        onListo={onCambio}
                    />
                </Suspense>
            )}

            {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

            {cargando && <SkeletonText lines={3} />}

            {vacio && (
                <EmptyState linea icon={CheckCircle2} title="Sin traslados pendientes" />
            )}

            {!cargando && puedeConfirmar && porConfirmar.length > 0 && (
                <div className="flex flex-col gap-2">
                    {/* «de tu sala» sólo si TODOS salen de la sala propia —el
                        mismo cuidado que el encabezado de acá abajo—. Desde
                        v2.657.0 esta lista puede traer los de una sala que uno
                        está CUBRIENDO mientras está cerrada, y ahí el producto
                        no sale de tu sala: sale de la de al lado. Cuál es cada
                        uno lo dice la píldora de la tarjeta. */}
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        {porConfirmar.every(f => String(f.metadata?.origen_branch_id ?? '') === String(miBranch ?? ''))
                            ? 'Te piden de tu sala'
                            : 'Te piden'}
                    </p>
                    <Suspense fallback={null}>
                        {/* Dos columnas: en `max-w-3xl` una sola estira cada
                            tarjeta a lo ancho del modal para tres renglones de
                            texto, y cuatro traslados ya no entran en la
                            pantalla.

                            Sin `auto-rows-fr`: igualaba TODAS las filas a la más
                            alta y dejaba un hueco de ~120px en las cortas. El
                            `stretch` que trae grid por defecto ya empareja las
                            de una misma fila, que es lo que hace falta para que
                            los botones queden a la misma altura. */}
                        <div className="grid gap-2 md:grid-cols-2">
                            {porConfirmar.map(f => (
                                <FilaPorConfirmar key={f.id} fila={f} nombrePor={nombrePor} onHecho={onCambio}
                                    miBranch={miBranch} />
                            ))}
                        </div>
                    </Suspense>
                </div>
            )}

            {!cargando && porRecibir.length > 0 && (
                <div className="flex flex-col gap-2">
                    {/* «a tu sala» solo si TODOS son de la sala propia. Con
                        alcance de todas las sucursales entran los de otras, y
                        ahí ese encabezado dice algo falso — visto en la prueba
                        del 2026-08-06, donde Salud 1 leía «en camino a tu sala»
                        sobre un traslado que iba a Salud 2. */}
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        {porRecibir.every(f => String(f.metadata?.branch_id ?? '') === String(miBranch ?? ''))
                            ? 'En camino a tu sala'
                            : 'En camino'}
                    </p>
                    <Suspense fallback={null}>
                        <div className="grid gap-2 md:grid-cols-2">
                            {porRecibir.map(f => (
                                <FilaPorRecibir key={f.id} fila={f} onHecho={onCambio} ahora={ahora} personaPor={personaPor} />
                            ))}
                        </div>
                    </Suspense>
                </div>
            )}

            {/* ── Los envíos ────────────────────────────────────────────────
                Van DESPUÉS del traslado y en su propio bloque: son el mismo
                movimiento al revés, pero lo que hay que hacer con ellos es
                distinto, y mezclarlos en una lista sola obligaría a leer cada
                tarjeta para saber si te toca contestar o sólo mirar.

                El orden es el de la urgencia: lo que espera una decisión tuya,
                lo que se te quedó a medio salir, lo que te devuelven, y al final
                lo que sólo hay que mirar. */}
            {!cargando && porMomento.por_decidir.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Te enviaron
                    </p>
                    <Suspense fallback={null}>
                        <div className="grid gap-2 md:grid-cols-2">
                            {porMomento.por_decidir.map(e => (
                                <FilaEnvioPorDecidir key={e.id} envio={e} onHecho={onCambio} ahora={ahora} />
                            ))}
                        </div>
                    </Suspense>
                </div>
            )}

            {!cargando && porMomento.por_despachar.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Sin salir de tu sala
                    </p>
                    <Suspense fallback={null}>
                        <div className="grid gap-2 md:grid-cols-2">
                            {porMomento.por_despachar.map(e => (
                                <FilaEnvioPorDespachar key={e.id} envio={e} onHecho={onCambio} ahora={ahora} />
                            ))}
                        </div>
                    </Suspense>
                </div>
            )}

            {!cargando && porMomento.por_recibir_devolucion.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Te devuelven
                    </p>
                    <Suspense fallback={null}>
                        <div className="grid gap-2 md:grid-cols-2">
                            {porMomento.por_recibir_devolucion.map(e => (
                                <FilaDevolucionPorRecibir key={e.id} envio={e} onHecho={onCambio} ahora={ahora} />
                            ))}
                        </div>
                    </Suspense>
                </div>
            )}

            {!cargando && porMomento.en_camino.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Enviaste
                    </p>
                    <Suspense fallback={null}>
                        <div className="grid gap-2 md:grid-cols-2">
                            {porMomento.en_camino.map(e => (
                                <FilaEnvioEnCamino key={e.id} envio={e} ahora={ahora} />
                            ))}
                        </div>
                    </Suspense>
                </div>
            )}
        </div>
    );
}

/* Las filas del traslado, diferidas — y es un ahorro de verdad, no del gate.
 *
 * Se dibujan sólo cuando la consulta VOLVIÓ con algo: mientras no hay nada
 * pendiente —que es como está el tablero la mayor parte del tiempo— esta
 * baldosa muestra un `EmptyState` y nunca las toca. Estaban en el cierre
 * estático del Inicio igual: 6.1 kB gzip que bajaba todo el mundo en cada
 * entrada, para un caso que además llega DESPUÉS de una consulta.
 *
 * El `Suspense` envuelve la lista entera y no cada fila: son hermanas del mismo
 * trozo, así que una sola frontera alcanza.
 *
 * `fallback={null}`: el encabezado de la sección ya está pintado y las filas
 * llegan un instante después. Un esqueleto acá aparecería justo cuando el
 * esqueleto de la carga se acaba de ir — dos parpadeos para lo mismo. */
const FilaPorConfirmar = lazy(() =>
    import('../traslados/FilasTraslado').then(m => ({ default: m.FilaPorConfirmar })));
const FilaPorRecibir = lazy(() =>
    import('../traslados/FilasTraslado').then(m => ({ default: m.FilaPorRecibir })));

/* Y las del envío, por el mismo motivo: la mayor parte del tiempo no hay
 * ninguno, y el compositor —que trae buscador, presentaciones y borrador— sólo
 * hace falta cuando alguien va a mandar algo. */
const FilaEnvioPorDecidir = lazy(() =>
    import('../traslados/FilasEnvio').then(m => ({ default: m.FilaEnvioPorDecidir })));
const FilaEnvioPorDespachar = lazy(() =>
    import('../traslados/FilasEnvio').then(m => ({ default: m.FilaEnvioPorDespachar })));
const FilaEnvioEnCamino = lazy(() =>
    import('../traslados/FilasEnvio').then(m => ({ default: m.FilaEnvioEnCamino })));
const FilaDevolucionPorRecibir = lazy(() =>
    import('../traslados/FilasEnvio').then(m => ({ default: m.FilaDevolucionPorRecibir })));
const EnviarProductoModal = lazy(() => import('./EnviarProductoModal'));
const ConfirmarPorCodigo  = lazy(() => import('../traslados/ConfirmarPorCodigo'));
const RetiroModal         = lazy(() => import('../traslados/RetiroModal'));

/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
//
// Trae las listas al montarse y de ahí sale el número, igual que en «Facturas de
// mi Sala» (v2.515.2). Antes eran cuatro viajes por apertura: contar al montar,
// las dos listas al abrir, y contar OTRA VEZ porque el panel llamaba `onCambio`
// al final de cada carga — incluida la primera, cuando entre el montaje y la
// apertura no había cambiado nada.
//
// El total NO es `porConfirmar.length`: sale del `count` exacto que devuelve la
// misma consulta. La lista está topada en 201 filas, así que contar por su largo
// sería un tope silencioso esperando a que alguien lo cruce.
export default function WidgetTransferRequests() {
    const { user, getScope } = useAuth();
    const [porConfirmar, setPorConfirmar] = useState(null);
    const [porRecibir,   setPorRecibir]   = useState(null);
    const [envios,       setEnvios]       = useState(null);
    const [pendientes,   setPendientes]   = useState(null);
    const [error,        setError]        = useState('');

    /* Cada lista mira UN extremo del traslado: «te piden» es donde está el
     * producto y «en camino» es lo que llega a mi sala. El RLS deja ver los dos
     * —tiene que hacerlo: una sala es origen de unos y destino de otros—, así
     * que sin recorte la baldosa mezclaba lo ajeno con lo propio. Medido el
     * 17-ago: La Popular veía sus 3 propias solicitudes bajo «Te piden de tu
     * sala», y Salud 5 tenía dos «en camino» y ninguno venía a Salud 5.
     *
     * Y «te piden» no se recorta por «origen = mi sala»: eso dejaría afuera a la
     * sala de respaldo, que despacha por la que está cerrada. Las salas que uno
     * cubre las dice la base — la misma función que consulta la policy. */
    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const branchId = getScope('traslados') === 'ALL' ? null : miBranch;

    const cargar = useCallback(async () => {
        // La cobertura depende de la HORA, así que se pregunta en cada carga: a
        // las 17:00 Bodega cierra y sus traslados pasan a ser de quien la cubre.
        const cubiertas = branchId ? await fetchSalasQueCubro(branchId) : [];
        // Los envíos van en el MISMO viaje: son la otra mitad del movimiento y
        // pedirlos aparte haría que la baldosa se dibuje dos veces, una con la
        // mitad del contenido. Su alcance lo decide el RLS, no `branchId`.
        const [a, b, c] = await Promise.all([
            fetchTrasladosPorConfirmar({ branchIds: branchId ? [branchId, ...cubiertas] : null }),
            fetchTrasladosPorRecibir({ branchId }),
            fetchEnviosVivos(),
        ]);
        if (a.error || b.error || c.error) {
            setError((a.error ?? b.error ?? c.error).message ?? 'No se pudo leer.');
        }
        setPorConfirmar(a.filas);
        setPorRecibir(b.filas);
        setEnvios(c.envios);
        setPendientes(a.total);
    }, [branchId]);

    // El `setState` ocurre DESPUÉS del `await`, no en el cuerpo del efecto, así
    // que no encadena renders — la regla no puede distinguirlo. Misma anotación
    // y mismo motivo que en `TrasladosView`.
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    /* El número de la baldosa cuenta lo que ESPERA UNA RESPUESTA TUYA, no las
     * filas que hay: lo que te piden de tu sala más lo que te enviaron y todavía
     * no miraste. Lo que está en camino no cuenta —no hay nada que hacer con
     * ello— y por eso vive en el detalle. */
    const porDecidir = useMemo(
        () => (envios ?? []).filter(e => momentoDelEnvio(e, miBranch) === 'por_decidir').length,
        [envios, miBranch],
    );
    const enVuelo = useMemo(() => {
        const cuenta = (m) => (envios ?? []).filter(e => momentoDelEnvio(e, miBranch) === m).length;
        return (porRecibir?.length ?? 0) + cuenta('en_camino') + cuenta('por_despachar')
             + cuenta('por_recibir_devolucion');
    }, [envios, miBranch, porRecibir]);

    return (
        <LanzadorSolicitud
            icon={ArrowLeftRight}
            label="Traslados entre salas"
            pendientes={pendientes === null ? null : pendientes + porDecidir}
            etiquetaPendientes="por contestar"
            etiquetaPendientesPlural="por contestar"
            vacio="Sin traslados"
            tono="brand"
            // Ancho para DOS columnas de tarjetas. En `max-w-lg` cada tarjeta
            // ocupaba el modal entero y la lista se leía como una tira infinita
            // —reportado con una captura de cuatro traslados en camino, que ya
            // no entraban en la pantalla—.
            maxWidth="max-w-3xl"
            descripcion="Pedir y enviar producto entre salas, y contestar lo que te llega"
            // Las dos mitades del mismo movimiento. La baldosa ya traía las dos
            // listas al montarse y pintaba SÓLO la primera: lo que uno está
            // esperando de otra sala —la mitad que hace levantar el teléfono—
            // estaba en memoria y no se mostraba. Cero consultas nuevas.
            instrumento={porConfirmar === null
                ? <FranjaVacia />
                : <Flujo entra={(pendientes ?? 0) + porDecidir} sale={enVuelo} />}
            detalle={enVuelo ? `${enVuelo} en vuelo` : null}
        >
            {/* Sin `min-h` ni scroller propio: el cuerpo canónico
                (`LiquidModal.Body`) ya scrollea, y el alto lo topa el modal. */}
            {() => (
                <PanelTraslados
                    porConfirmar={porConfirmar}
                    porRecibir={porRecibir}
                    envios={envios}
                    error={error}
                    onCambio={cargar}
                />
            )}
        </LanzadorSolicitud>
    );
}
