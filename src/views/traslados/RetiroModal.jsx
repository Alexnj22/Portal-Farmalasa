import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Camera, PackageCheck, Printer, ScanLine, Truck, UserCheck } from 'lucide-react';
import ModalShell from '../../components/common/ModalShell';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import useCapturaDeCarne from '../../hooks/useCapturaDeCarne';
import { fetchTrasladoPorCodigo, fetchTrasladoParaImprimir } from '../../data/traslados';
import { fetchEmployeeByKioskPin } from '../../data/pedidos';
import {
    fetchRetiroAbierto, fetchPendientesEnSala, cargarBulto, firmarEntrega, soltarBulto,
    cerrarRetiro, DIAS_PARA_ALARMA,
} from '../../data/retiros';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { buscadorDePersonas } from '../solicitudes/movimientoTexto';
import { reimprimirTicketDeTraslado } from '../../utils/imprimirTraslado';
import LecturaQueNoEntro from './LecturaQueNoEntro';

/* La bitácora de la custodia.
 *
 * `retiro_soltar` BORRA la fila, así que sin esto soltar una bolsa no dejaba
 * rastro de ningún tipo: si después falta, no hay dónde leer quién la tuvo ni
 * cuándo dejó de tenerla. Y es justamente la acción cuyo único propósito es
 * asignar responsabilidad. Regla del repo: toda acción de usuario va a
 * `audit_logs`. */
const anotar = (accion, requestId, detalle) => {
    try { useStaff.getState().appendAuditLog(accion, String(requestId ?? ''), detalle); }
    catch (e) { console.error('bitácora del retiro:', e); }   // no puede tumbar la acción
};

const LectorDeCodigo = lazy(() => import('../../components/common/LectorDeCodigo'));

/**
 * El recorrido: escanear las bolsas que uno se lleva y responder por ellas.
 *
 * ── Nadie elige en qué sala está ───────────────────────────────────────────
 * Pedido del usuario: «que él no tenga que seleccionar en qué sala está, que el
 * código de barras lo diga ya». Cada ticket sabe de dónde sale, así que el
 * último escaneo define dónde está parado — y con eso el portal contesta las dos
 * preguntas que importan al llegar a una sucursal:
 *
 *   · **qué dejar**    = lo que ya lleva encima con destino a esa sala
 *   · **qué recoger**  = lo que esa sala tiene esperando salir
 *
 * La segunda es la que evita el olvido, y llega en el momento en que se puede
 * hacer algo: al llegar, no al final del recorrido.
 *
 * ── La entrega la firma alguien de la sala, pero NO traba la carga ─────────
 * Pedido del usuario parado en La Popular (2026-08-25): «sí tiene que
 * confirmar, pero me debe permitir cargar los productos y de último o de
 * primero solicitar quien entrega, pero son complementarias».
 *
 * Hasta hoy la firma era un CANDADO: `retiro_cargar` rebotaba con
 * `FALTA_ENTREGA` y no cargaba nada, así que quien no es de la sala necesitaba
 * a alguien de esa sala parado al lado, carné en mano, **bolsa por bolsa**.
 * Cuatro bolsas eran cuatro interrupciones a la misma persona, y quien llegaba
 * a una sala sin nadie libre no podía ni empezar.
 *
 * Ahora son dos pasos que se dan en cualquier orden y una sola vez por sala:
 * se escanean los tickets, y el carné se pasa antes o después. Lo que queda sin
 * firmar se ve —en el aviso de arriba y en cada renglón—, que es la diferencia
 * entre un paso pendiente y un paso olvidado.
 */
export default function RetiroModal({ abierto, onCerrar, onCambio }) {
    const [cargando,  setCargando]  = useState(true);
    const [retiro,    setRetiro]    = useState({ retiro_id: null, bultos: [] });
    const [salaActual, setSalaActual] = useState(null);   // { id, nombre }
    const [pendientes, setPendientes] = useState([]);
    const [error,     setError]     = useState('');
    const [aviso,     setAviso]     = useState('');
    const [ocupado,   setOcupado]   = useState(false);
    const [conCamara, setConCamara] = useState(false);
    /* El lector deja de leer tickets y pasa a leer un carné.
     *
     * Es un MODO y no «la bolsa que espera firma», que es lo que era antes: la
     * firma ya no pertenece a una bolsa sino al recorrido, y vale para todas las
     * de esa sala. Un solo lector armado a la vez — con los dos, una ráfaga de
     * teclas entraría por dos caminos. */
    const [modoFirma, setModoFirma] = useState(false);
    const { user } = useAuth();
    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const [imprimiendo, setImprimiendo] = useState(null);   // request_id en curso

    const recargar = useCallback(async (branchId = null) => {
        const { retiro: r } = await fetchRetiroAbierto();
        setRetiro(r ?? { retiro_id: null, bultos: [] });
        if (branchId) {
            const { pendientes: p } = await fetchPendientesEnSala(branchId);
            setPendientes(p ?? []);
        } else {
            // Se LIMPIA, no se deja como estaba: sin sala conocida, la lista
            // anterior sería «acá quedan 4 esperando salir» sobre una sucursal
            // de la que ya nos fuimos. Un dato viejo con cara de actual es peor
            // que ninguno.
            setPendientes([]);
        }
        setCargando(false);
    }, []);

    /* Al abrir se pregunta por la sala PROPIA, no por «ninguna».
     *
     * `salaActual` sale del último escaneo, así que hasta ahora la lista de «acá
     * quedan N esperando salir» no existía hasta escanear algo. Eso deja afuera
     * justo al caso que la necesita: la bolsa cuyo ticket NO salió no se puede
     * escanear, y sin escanearla no aparecía la lista desde donde reimprimirlo.
     * Un candado que se abre con la llave que está adentro. */
    useEffect(() => {
        if (!abierto) return;
        recargar(salaActual?.id ?? miBranch ?? null);
        // `salaActual` a propósito fuera: recargar al cambiar de sala lo hace
        // quien la cambia, y ponerlo acá volvería a consultar en cada render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto, recargar, miBranch]);

    /** Un código leído: se resuelve, se carga, y se aprende dónde estamos. */
    const escanear = useCallback(async (codigo, entregoId = null) => {
        setOcupado(true); setError(''); setAviso('');
        try {
            const { traslado } = await fetchTrasladoPorCodigo(codigo);
            if (!traslado?.id) {
                setError(traslado?.es_de_un_pedido
                    ? 'Ese ticket es de un pedido de Bodega, no de un traslado entre salas.'
                    : 'No encontramos ese ticket. Puede que el código no se haya leído bien.');
                return;
            }
            if (traslado.ya_recibido) {
                setError(`Esa bolsa ya se recibió${traslado.recibio ? `, la recibió ${traslado.recibio}` : ''}.`);
                return;
            }

            const r = await cargarBulto(traslado.id, entregoId);
            if (!r?.ok) {
                setError(r?.error ?? 'No se pudo cargar esa bolsa.');
                return;
            }
            // La bolsa YA está cargada. Si le falta firma se dice, no se traba:
            // el aviso de arriba lleva la cuenta y el carné se pasa cuando se
            // pueda. Si en cambio se heredó una firma dada antes, se nombra a
            // quien entrega — que es la confirmación de que ese paso ya se dio.
            if (r.falta_firma) {
                setAviso(`Cargada. Falta el carné de quien entrega en ${traslado.origen ?? 'esa sala'}.`);
            } else if (r.entrego) {
                setAviso(`Cargada · te la entrega ${r.entrego}.`);
            }

            /* De dónde salió ES dónde estamos parados.
             *
             * El id y el nombre tienen que salir del MISMO lugar. Estuvieron
             * cruzados: el id era el del DESTINO —lo único que traía la
             * consulta— y el nombre el del ORIGEN, así que el panel decía
             * «Dejar en Salud 1» y listaba las bolsas que iban a Salud 4. Hoy
             * los dos vienen de `retiro_cargar`, que devuelve el origen. */
            const origenId = r.origen_branch_id ?? null;
            setSalaActual(origenId ? { id: origenId, nombre: traslado.origen } : null);
            anotar('CARGAR_BULTO', traslado.id, {
                origen: traslado.origen ?? null, destino: traslado.destino ?? null,
                firma_propia: r.firma_propia === true, falta_firma: r.falta_firma === true,
                entrego: r.entrego ?? null,
            });
            await recargar(origenId);
            onCambio?.();
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo leer ese código.'));
        } finally {
            setOcupado(false);
        }
    }, [recargar, onCambio]);

    /* El lector físico queda armado mientras no esté leyendo otra cosa: con la
     * cámara abierta o en modo firma, una ráfaga de teclas entraría por dos
     * caminos a la vez. */
    //
    // Y con el candado de velocidad SUELTO: lo que se lee acá es el ticket de
    // una bolsa, no un carné. Su número no está impreso, así que nadie lo puede
    // teclear de memoria y no hay presencia que probar; lo único que hacía el
    // candado era tirar en silencio la lectura de un lector sin sufijo Enter.
    // La firma de abajo —ésa sí es un carné— lo conserva.
    const { teclas, diagnostico, eventos } = useCapturaDeCarne(
        abierto && !conCamara && !modoFirma && !ocupado, escanear,
        { aceptarTecleado: true, sinEnter: true },
    );

    /** La firma de quien entrega: su carné, una vez, para toda su sala.
     *
     * No reintenta ninguna carga —eso era cuando la firma era el candado—: sella
     * lo que ya va encima de esa sala y queda vigente para lo que se escanee
     * después. Por eso `firmadas: 0` no es un fallo: es firmar de primero. */
    const leerFirma = useCallback(async (code) => {
        setOcupado(true); setError(''); setAviso('');
        try {
            const { data, error: e } = await fetchEmployeeByKioskPin(String(code).toUpperCase().trim());
            if (e)     { setError(mensajeAmigable(e, 'No se pudo confirmar el carné.')); return; }
            if (!data) { setError('Ese carné no es de nadie.'); return; }

            const r = await firmarEntrega(data.id);
            if (!r?.ok) { setError(r?.error ?? 'No se pudo registrar la firma.'); return; }

            setModoFirma(false);
            const n = Number(r.firmadas ?? 0);
            setAviso(n > 0
                ? `${r.quien} firmó la entrega de ${n} ${n === 1 ? 'bolsa' : 'bolsas'}.`
                : `${r.quien} queda como quien entrega lo que te lleves de su sala.`);
            anotar('FIRMAR_ENTREGA', retiro?.retiro_id, { quien: r.quien ?? null, bolsas: n });
            await recargar(salaActual?.id ?? miBranch ?? null);
            onCambio?.();
        } catch (e) {
            // Sin este `catch`, un lector que rebota o una red que se cae dejan
            // la pantalla igual que antes de pasar el carné: quien está parado
            // ahí lo vuelve a pasar creyendo que no leyó. El `finally` solo
            // apaga el reloj y no dice nada.
            setError(mensajeAmigable(e, 'No se pudo confirmar el carné.'));
        } finally { setOcupado(false); }
    }, [recargar, onCambio, retiro, salaActual, miBranch]);

    const { teclas: teclasCarne } = useCapturaDeCarne(abierto && modoFirma && !ocupado, leerFirma);

    /** El MISMO ticket otra vez, cuando el papel no sirvió.
     *
     * Sólo imprime (condición del usuario): no anula el anterior, no marca nada
     * y no pide motivo. Lo que se arregla es una impresora, no un hecho del
     * negocio — un ticket ilegible no cambió nada de lo que pasó con el producto.
     *
     * El nombre de quien pidió se resuelve con el mismo respaldo que las
     * tarjetas: quien pide un traslado es por definición de OTRA sala, así que
     * el maestro de personal no lo trae y sin el respaldo el papel saldría sin
     * el renglón «Pide» — o sea, distinto del original. */
    const volverAImprimir = useCallback(async (requestId) => {
        setImprimiendo(requestId); setError(''); setAviso('');
        try {
            const { fila } = await fetchTrasladoParaImprimir(requestId);
            if (!fila?.metadata) { setError('No se pudo leer ese traslado.'); return; }

            const idPide = fila.employee_id;
            const st = useStaff.getState();
            const cache = idPide ? await st.resolverPersonasDeSolicitudes([idPide]) : {};
            const pide = idPide
                ? (buscadorDePersonas(st.employees)(idPide)?.name
                    ?? cache?.[String(idPide)]?.name ?? null)
                : null;

            const r = await reimprimirTicketDeTraslado({
                metadata: fila.metadata,
                pide,
                sala: miBranch,
                familia: fila.type === 'INVENTORY_TRANSFER_PUSH' ? 'envio' : 'solicitud',
            });
            // `ok` es RECIBIDO por la caja, nunca «salió papel»: lo que contesta
            // el programa de la caja es opaco, y prometer en pantalla lo que no
            // se sabe manda a alguien a buscar un papel que no está.
            if (r?.ok) setAviso('El ticket se mandó a la impresora.');
            else setError(`No se pudo imprimir: ${r?.detalle ?? 'sin detalle'}`);
        } catch (e) {
            // Sin este `catch`, una red caída deja la pantalla igual que antes
            // de apretar: quien está parado ahí lo vuelve a apretar creyendo que
            // no entró, y termina con dos papeles iguales pegados a una bolsa.
            // El `finally` sólo apaga el reloj y no dice nada. Es el mismo
            // hueco que `leerFirma` acá abajo ya tenía tapado.
            setError(mensajeAmigable(e, 'No se pudo imprimir el ticket.'));
        } finally {
            setImprimiendo(null);
        }
    }, [miBranch]);

    const bultos = useMemo(() => retiro?.bultos ?? [], [retiro]);

    /* Lo que va encima sin la firma de quien lo entregó, por sala.
     *
     * Lo agrupa el servidor y no esta pantalla: es la misma cuenta que decide a
     * quién sirve cada carné, y hacerla dos veces es garantizar que un día
     * difieran. Acá sólo se pinta. */
    const sinFirma = useMemo(() => retiro?.sin_firma ?? [], [retiro]);
    const bolsasSinFirma = useMemo(
        () => sinFirma.reduce((n, s) => n + Number(s.bolsas ?? 0), 0), [sinFirma]);

    /* Lo que va a la sala donde estamos parados: es «lo que hay que dejar acá».
     * Se calcula sobre el manifiesto y no se consulta: el portal ya sabe qué
     * lleva encima. */
    const paraEstaSala = useMemo(
        () => (salaActual?.id ? bultos.filter(b => Number(b.branch_id_destino) === Number(salaActual.id)) : []),
        [bultos, salaActual],
    );

    const cerrar = async () => {
        setOcupado(true); setError(''); setAviso('');
        const r = await cerrarRetiro();
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo cerrar el recorrido.'); return; }
        anotar('CERRAR_RETIRO', retiro?.retiro_id, { bultos: bultos.length });
        setAviso('Recorrido cerrado.');
        await recargar(salaActual?.id ?? null);
        onCambio?.();
    };

    const soltar = async (requestId) => {
        setOcupado(true); setError('');
        const r = await soltarBulto(requestId);
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo soltar esa bolsa.'); return; }
        // La fila se borra: esta anotación es el ÚNICO rastro de que existió.
        anotar('SOLTAR_BULTO', requestId, { sala: salaActual?.nombre ?? null });
        await recargar(salaActual?.id ?? null);
        onCambio?.();
    };

    if (!abierto) return null;

    return (
        <ModalShell open onClose={() => !ocupado && onCerrar()} maxWidthClass="max-w-2xl"
            closeOnEsc={!ocupado} surface={null} ariaLabel="Llevar productos entre salas">
            <CuerpoDialogo
                titulo="Llevar productos"
                subtitulo={salaActual?.nombre
                    ? `Estás en ${salaActual.nombre} · pasa el lector por cada ticket`
                    : 'Pasa el lector por el ticket de cada bolsa que cargues'}
                icono={Truck}
                anchoEscritorio="max-w-2xl"
                pie={<>
                    <Button variant="secondary" icon={PackageCheck} disabled={ocupado}
                        onClick={cerrar}>
                        Terminar recorrido
                    </Button>
                    <Button variant="secondary" disabled={ocupado} onClick={onCerrar}>Cerrar</Button>
                </>}>
                <div className="flex flex-col gap-3 text-left">
                    {error && <Notice variant="danger">{error}</Notice>}
                    {aviso && <Notice variant="success">{aviso}</Notice>}

                    {/* La firma pendiente va ARRIBA del lector y se queda ahí.
                        Es lo único de esta pantalla que se puede olvidar sin que
                        nada falle: la bolsa ya está cargada y el recorrido sigue
                        andando igual. */}
                    {!modoFirma && bolsasSinFirma > 0 && (
                        <Notice variant="warning" icon={UserCheck}>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="flex-1 min-w-[12rem]">
                                    Falta el carné de quien te entrega{' '}
                                    {sinFirma.map((f, i) => (
                                        <React.Fragment key={f.branch_id ?? i}>
                                            {i > 0 && ', '}
                                            <strong>{f.bolsas}</strong> en {f.sala ?? 'una sala'}
                                        </React.Fragment>
                                    ))}. Se pasa una sola vez por sala.
                                </span>
                                <Button variant="secondary" icon={UserCheck} disabled={ocupado}
                                    onClick={() => { setModoFirma(true); setError(''); setAviso(''); }}>
                                    Pasar carné
                                </Button>
                            </div>
                        </Notice>
                    )}

                    {modoFirma ? (
                        <Notice variant="info" icon={UserCheck}>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="flex-1 min-w-[12rem]">
                                    Pasa el carné de quien te entrega el producto. Vale para todo lo
                                    que te lleves de su sala en este recorrido, lo hayas escaneado ya
                                    o no.
                                    {teclasCarne > 0 && ' Leyendo…'}
                                </span>
                                <Button variant="secondary" icon={ScanLine} disabled={ocupado}
                                    onClick={() => setModoFirma(false)}>
                                    Volver a los tickets
                                </Button>
                            </div>
                        </Notice>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <ScanLine size={18} className="text-chart-1-text shrink-0" />
                                {/* `teclas` ANTES que `ocupado`, y ése era el
                                    problema: este renglón sólo miraba `ocupado`,
                                    que no se enciende hasta que sale la consulta.
                                    O sea que mientras el lector teclea la
                                    pantalla no se movía **ni cuando la lectura
                                    entraba bien** — y con eso, «no cambia nada al
                                    escanear» no distinguía un lector mudo de uno
                                    que anda. Se probó acá y la prueba no podía
                                    contestar. */}
                                <p className="text-body-sm text-content-2 flex-1">
                                    {teclas > 0 ? 'Leyendo…'
                                        : ocupado ? 'Buscando el ticket…'
                                            : 'Esperando el ticket de la próxima bolsa'}
                                </p>
                                {/* «De primero»: el carné se puede pasar ANTES de
                                    escanear nada, y ahí no hay ninguna bolsa
                                    pendiente que dispare el aviso de arriba. Sin
                                    este botón, la mitad del pedido del usuario no
                                    tendría por dónde entrar. */}
                                {bolsasSinFirma === 0 && (
                                    <Button variant="secondary" icon={UserCheck} disabled={ocupado}
                                        title="Pasar el carné de quien entrega"
                                        onClick={() => { setModoFirma(true); setError(''); setAviso(''); }}>
                                        Carné
                                    </Button>
                                )}
                                <Button variant="secondary" icon={Camera} disabled={ocupado}
                                    onClick={() => setConCamara(true)}>Cámara</Button>
                            </div>
                            {/* Qué mandó el lector, cuando no alcanzó. Mismo
                                instrumento que en «Recibir traslado» — y el
                                mismo componente, no una copia. */}
                            <LecturaQueNoEntro d={diagnostico} eventos={eventos} />
                        </div>
                    )}

                    {cargando && <SkeletonText lines={3} />}

                    {/* Lo que hay que DEJAR acá. Va primero: es lo que se hace al
                        llegar, antes de cargar nada nuevo. */}
                    {paraEstaSala.length > 0 && (
                        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
                            <p className="text-label font-black uppercase tracking-wide text-content-2">
                                Dejar en {salaActual.nombre} · {paraEstaSala.length}
                            </p>
                            {paraEstaSala.map(b => (
                                <p key={b.request_id} className="text-body-sm text-content-2">
                                    {(b.items ?? []).map(i => i?.descripcion).filter(Boolean).join(', ') || 'Sin detalle'}
                                </p>
                            ))}
                            <p className="text-micro text-content-3">
                                Las confirma la sala al recibirlas, y ahí salen de tu responsabilidad.
                            </p>
                        </div>
                    )}

                    {/* Lo que queda esperando SALIR de acá — la alerta que evita
                        el olvido, y llega cuando todavía se puede hacer algo. */}
                    {pendientes.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <Notice variant="warning">
                                Acá quedan <strong>{pendientes.length}</strong> esperando salir
                                {pendientes.some(p => p.destino) && `, para ${[...new Set(pendientes.map(p => p.destino).filter(Boolean))].join(', ')}`}.
                                Escanea su ticket si te las llevas.
                            </Notice>
                            {/* ── Y cada una con su ticket a mano ──────────────
                                Acá es donde tiene que estar el botón de volver a
                                imprimirlo: son las bolsas que están FÍSICAMENTE
                                en esta sala esperando salir, o sea exactamente
                                aquéllas cuyo papel alguien puede necesitar otra
                                vez. Una bolsa cuyo ticket no salió no se puede
                                escanear, así que el camino no podía depender de
                                escanearla. */}
                            {pendientes.map(p => (
                                <div key={p.request_id} data-surface="card"
                                    className="px-3 py-2 flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-body-sm font-bold text-content-1 truncate">
                                            {p.origen ?? '?'} → {p.destino ?? '?'}
                                        </p>
                                        <p className="text-micro text-content-3 truncate">
                                            {(p.items ?? []).map(i => i?.descripcion).filter(Boolean).join(', ') || 'Sin detalle'}
                                        </p>
                                    </div>
                                    {/* Sin número no hay código de barras, y un
                                        ticket sin barras no es el mismo papel:
                                        ese traslado se confirma a mano, que es
                                        lo que ya decía el original. */}
                                    {p.codigo && (
                                        <Button variant="secondary" size="sm" icon={Printer}
                                            title="Volver a imprimir el ticket"
                                            loading={imprimiendo === p.request_id}
                                            disabled={ocupado || imprimiendo === p.request_id}
                                            onClick={() => volverAImprimir(p.request_id)}>
                                            Ticket
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* El manifiesto */}
                    {!cargando && bultos.length === 0 && (
                        <EmptyState icon={Truck} title="Todavía no llevas nada"
                            subtitle="Escanea el ticket de la primera bolsa y el recorrido arranca solo." />
                    )}

                    {bultos.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <p className="text-label font-black uppercase tracking-wide text-content-2">
                                Encima tuyo · {bultos.length}
                            </p>
                            {bultos.map(b => (
                                <div key={b.request_id} data-surface="card"
                                    className="px-3 py-2 flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-body-sm font-bold text-content-1 truncate">
                                            {b.origen ?? '?'} → {b.destino ?? '?'}
                                        </p>
                                        <p className="text-micro text-content-3 truncate">
                                            {(b.items ?? []).map(i => i?.descripcion).filter(Boolean).join(', ') || 'Sin detalle'}
                                        </p>
                                        {b.entrego && (
                                            <p className="text-micro text-content-3">Te la entregó {b.entrego}</p>
                                        )}
                                        {/* Sin firma NO es lo mismo que sin
                                            `entrego`: una bolsa retirada de la
                                            sala propia nunca lo va a tener y
                                            está bien. Lo distingue el servidor. */}
                                        {b.falta_firma && (
                                            <p className="text-micro text-warning-text">Falta el carné de quien la entregó</p>
                                        )}
                                    </div>
                                    {b.dias >= DIAS_PARA_ALARMA && (
                                        <Badge variante="danger">{b.dias} días</Badge>
                                    )}
                                    <Button variant="secondary" disabled={ocupado}
                                        onClick={() => soltar(b.request_id)}>Soltar</Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </CuerpoDialogo>

            {conCamara && (
                <Suspense fallback={null}>
                    <LectorDeCodigo abierto titulo="Escanear el ticket de la bolsa"
                        onCerrar={() => setConCamara(false)}
                        onLeer={(v) => { setConCamara(false); escanear(v); }} />
                </Suspense>
            )}
        </ModalShell>
    );
}
