import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Camera, PackageCheck, ScanLine, Truck, UserCheck } from 'lucide-react';
import ModalShell from '../../components/common/ModalShell';
import CuerpoDialogo from '../../components/common/CuerpoDialogo';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import useCapturaDeCarne from '../../hooks/useCapturaDeCarne';
import { fetchTrasladoPorCodigo } from '../../data/traslados';
import { fetchEmployeeByKioskPin } from '../../data/pedidos';
import {
    fetchRetiroAbierto, fetchPendientesEnSala, cargarBulto, soltarBulto, cerrarRetiro,
    DIAS_PARA_ALARMA,
} from '../../data/retiros';
import { mensajeAmigable } from '../../utils/errorMessages';

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
 * ── La entrega la firma alguien de la sala ─────────────────────────────────
 * El servidor decide si hace falta —quien retira siendo de esa sala, o
 * cubriéndola, firma solo— y cuando hace falta contesta `FALTA_ENTREGA`. La
 * pantalla NO adivina eso: intenta cargar, y si el servidor pide el carné,
 * lo pide. Así la regla vive en un solo lugar.
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
    // La bolsa que espera la firma de quien entrega.
    const [pidiendoFirma, setPidiendoFirma] = useState(null);   // { requestId, origen }

    const recargar = useCallback(async (branchId = null) => {
        const { retiro: r } = await fetchRetiroAbierto();
        setRetiro(r ?? { retiro_id: null, bultos: [] });
        if (branchId) {
            const { pendientes: p } = await fetchPendientesEnSala(branchId);
            setPendientes(p ?? []);
        }
        setCargando(false);
    }, []);

    useEffect(() => {
        if (!abierto) return;
        recargar(salaActual?.id ?? null);
        // `salaActual` a propósito fuera: recargar al cambiar de sala lo hace
        // quien la cambia, y ponerlo acá volvería a consultar en cada render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto, recargar]);

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
                if (r?.codigo === 'FALTA_ENTREGA' && !entregoId) {
                    // El servidor dice que hace falta la firma. Se pide acá y se
                    // reintenta con ella: la pantalla no decide cuándo hace falta.
                    setPidiendoFirma({ codigo, origen: traslado.origen });
                    return;
                }
                setError(r?.error ?? 'No se pudo cargar esa bolsa.');
                return;
            }

            // De dónde salió ES dónde estamos parados. Con eso se recarga lo que
            // queda esperando acá — que es la alerta que evita el olvido.
            const sala = { id: traslado.branch_id_destino, nombre: traslado.origen };
            const origenId = r.origen_branch_id ?? null;
            setPidiendoFirma(null);
            setSalaActual({ id: origenId ?? sala.id, nombre: traslado.origen });
            await recargar(origenId ?? null);
            onCambio?.();
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo leer ese código.'));
        } finally {
            setOcupado(false);
        }
    }, [recargar, onCambio]);

    /* El lector físico queda armado mientras no haya un diálogo encima: con la
     * cámara abierta o esperando una firma, una ráfaga de teclas entraría por
     * dos caminos a la vez. */
    const { teclas } = useCapturaDeCarne(
        abierto && !conCamara && !pidiendoFirma && !ocupado, escanear,
    );

    /** La firma de quien entrega: su carné, y se reintenta la carga. */
    const leerFirma = useCallback(async (code) => {
        setOcupado(true); setError('');
        try {
            const { data, error: e } = await fetchEmployeeByKioskPin(String(code).toUpperCase().trim());
            if (e)     { setError(mensajeAmigable(e, 'No se pudo confirmar el carné.')); return; }
            if (!data) { setError('Ese carné no es de nadie.'); return; }
            const pendiente = pidiendoFirma;
            setPidiendoFirma(null);
            await escanear(pendiente.codigo, data.id);
        } catch (e) {
            // Sin este `catch`, un lector que rebota o una red que se cae dejan
            // la pantalla igual que antes de pasar el carné: quien está parado
            // ahí lo vuelve a pasar creyendo que no leyó. El `finally` solo
            // apaga el reloj y no dice nada.
            setError(mensajeAmigable(e, 'No se pudo confirmar el carné.'));
        } finally { setOcupado(false); }
    }, [pidiendoFirma, escanear]);

    useCapturaDeCarne(abierto && Boolean(pidiendoFirma) && !ocupado, leerFirma);

    const bultos = useMemo(() => retiro?.bultos ?? [], [retiro]);

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
        setAviso('Recorrido cerrado.');
        await recargar(salaActual?.id ?? null);
        onCambio?.();
    };

    const soltar = async (requestId) => {
        setOcupado(true); setError('');
        const r = await soltarBulto(requestId);
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo soltar esa bolsa.'); return; }
        await recargar(salaActual?.id ?? null);
        onCambio?.();
    };

    if (!abierto) return null;

    return (
        <ModalShell open onClose={() => !ocupado && onCerrar()} maxWidthClass="max-w-2xl"
            closeOnEsc={!ocupado} surface={null} ariaLabel="Recorrido de retiro">
            <CuerpoDialogo
                titulo="Lo que llevas"
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

                    {pidiendoFirma ? (
                        <Notice variant="warning" icon={UserCheck}>
                            Esa bolsa está guardada en <strong>{pidiendoFirma.origen}</strong> y vos no
                            sos de ahí. Pasá el carné de quien te la entrega.
                            {teclas > 0 && ' Leyendo…'}
                        </Notice>
                    ) : (
                        <div className="flex items-center gap-2">
                            <ScanLine size={18} className="text-chart-1-text shrink-0" />
                            <p className="text-body-sm text-content-2 flex-1">
                                {ocupado ? 'Leyendo…' : 'Esperando el ticket de la próxima bolsa'}
                            </p>
                            <Button variant="secondary" icon={Camera} disabled={ocupado}
                                onClick={() => setConCamara(true)}>Cámara</Button>
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
                        <Notice variant="warning">
                            Acá quedan <strong>{pendientes.length}</strong> esperando salir
                            {pendientes.some(p => p.destino) && `, para ${[...new Set(pendientes.map(p => p.destino).filter(Boolean))].join(', ')}`}.
                            Escaneá su ticket si te las llevás.
                        </Notice>
                    )}

                    {/* El manifiesto */}
                    {!cargando && bultos.length === 0 && (
                        <EmptyState icon={Truck} title="Todavía no llevas nada"
                            subtitle="Escaneá el ticket de la primera bolsa y el recorrido arranca solo." />
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
