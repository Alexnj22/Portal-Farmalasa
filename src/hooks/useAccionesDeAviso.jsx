import React, { useCallback, useMemo, useState, lazy, Suspense } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { MODULO_QUE_DECIDE } from '../constants/solicitudModulos';
import { mensajeAmigable } from '../utils/errorMessages';
import { useDecidirSolicitud } from './useDecidirSolicitud';
import useCortesDeAvisos, { AVISOS_DE_CORTE } from './useCortesDeAvisos';
import useResolverCorte from './useResolverCorte';
import { seConfirmaDeUnClic } from '../utils/cortesDiagnostico';
import { esAvisoDeMinMax, cargarFilaDeAviso, paraDecidir } from '../data/solicitudDeAviso';

/* Decidir DESDE el aviso — la campana y el historial, con las mismas reglas.
 *
 * Vivía entero dentro de `NotificationBell`. El 2026-09-04 la vista
 * `/notificaciones` empezó a dibujar la misma tarjeta y el usuario notó lo que
 * faltaba: «que se vean igual en cuanto a diseño y utilidad». El diseño lo
 * resuelve `TarjetaDeAviso`; la UTILIDAD —aprobar, rechazar, confirmar un corte,
 * revisar un traslado— es esto, y copiarlo habría sido copiar las reglas de
 * quién puede decidir qué.
 *
 * Devuelve dos cosas: `acciones`, que va tal cual a la tarjeta, y `dialogos`,
 * que el llamador tiene que rendir **fuera** de la lista — el diálogo de rechazo
 * y el detalle del corte se dibujan por encima de todo y tienen que sobrevivir a
 * que el panel que los abrió se cierre.
 *
 * @param avisos       la lista que se está mostrando (para leer sus cortes)
 * @param activo       si vale la pena leer los cortes ahora (el panel abierto)
 * @param alAbrirDialogo  se llama antes de abrir cualquier diálogo. La campana
 *                        la usa para cerrarse: encimados quedan dos superficies
 *                        peleando por el mismo toque. La vista no pasa nada.
 */
const ModalSolicitud = lazy(() =>
    import('../views/solicitudes/TarjetaSolicitud').then(m => ({ default: m.ModalSolicitud })));
const CorteDetalleModal = lazy(() => import('../components/cortes/CorteDetalleModal'));

export function useAccionesDeAviso({ avisos = [], activo = true, alAbrirDialogo = null, origen = 'campana' } = {}) {
    const { hasPermission } = useAuth();
    const branches   = useStaff(s => s.branches);
    const employees  = useStaff(s => s.employees);
    const markNotificationRead   = useStaff(s => s.markNotificationRead);
    const marcarAvisoResuelto    = useStaff(s => s.marcarAvisoDeSolicitudResuelto);

    const empleadosPorId = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);

    const cerrarLoQueEsteAbierto = useCallback(() => { alAbrirDialogo?.(); }, [alAbrirDialogo]);

    /* ── Quién puede decidir qué ─────────────────────────────────────────────
     * Cada solicitud con SU permiso, y desde v2.576.0 eso ya no es «uno por
     * pantalla» sino uno por FAMILIA: quien puede anular una factura no
     * necesariamente puede aprobar un descarte de inventario. El aviso trae el
     * tipo en `metadata.request_type`, así que se resuelve por solicitud y no
     * por una bandera calculada una vez para todas.
     *
     * `MODULO_QUE_DECIDE` es el mismo mapa que usa la bandeja y el espejo de
     * `modulo_de_aprobacion()` en Postgres. */
    const moduloDelAviso = (n) => {
        if (n.type === 'MINMAX_PENDING') return 'requests_minmax';
        if (n.type !== 'REQUEST_PENDING') return null;
        return MODULO_QUE_DECIDE[n.metadata?.request_type] ?? 'requests';
    };

    /* Un traslado NO se decide desde acá: confirmarlo relee la existencia de la
       sala de origen justo antes de despachar. Aprobarlo por fuera lo marcaría
       APROBADO **sin mover nada** y lo haría desaparecer de las tres pestañas de
       Traslados. */
    const esTraslado = (n) => n.metadata?.request_type === 'INVENTORY_TRANSFER_REQUEST';

    /* `resuelta` la escribe el trigger `marcar_notificacion_solicitud_resuelta`
       en el momento en que la solicitud deja de estar PENDING. Sin eso, el aviso
       seguiría ofreciendo Aprobar/Rechazar sobre algo ya decidido. */
    const puedeDecidir = useCallback((n) => {
        if (esTraslado(n)) return false;
        const modulo = moduloDelAviso(n);
        return !!modulo && hasPermission(modulo, 'can_approve')
            && !!n.metadata?.request_id && !n.metadata?.resuelta;
    }, [hasPermission]);

    const trasladoPorResolver = useCallback((n) =>
        n.type === 'REQUEST_PENDING' && esTraslado(n) && !n.metadata?.resuelta
        && hasPermission('traslados', 'can_approve'),
    [hasPermission]);

    const [decidiendoId, setDecidiendoId] = useState(null);
    const [rechazo, setRechazo] = useState(null);   // { req, accion }
    const cerrarRechazo = useCallback(() => setRechazo(null), []);
    const { decidir, ocupado: decidiendo } = useDecidirSolicitud({ onAplicado: cerrarRechazo });

    /* ── El corte de caja ────────────────────────────────────────────────────
     * El corte NO sale del aviso: el aviso trae su id y el corte se relee. Una
     * fila de `notifications` es la foto del momento en que se capturó, así que
     * ofrecer «Confirmar» sobre ella dejaría el botón vivo después de que otra
     * persona lo resolvió. */
    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches || []) m[b.id] = b.name;
        return m;
    }, [branches]);
    const { porId: cortesPorId, recargar: recargarCortes } = useCortesDeAvisos(avisos, activo);
    const { resolver: resolverElCorte, ocupadoId: corteOcupado,
            dialogoDeEntrega } = useResolverCorte({ nombreSala, origen });
    const puedeResolverCortes = hasPermission('cortes_caja', 'can_edit');
    const [corteAbierto, setCorteAbierto] = useState(null);   // { corte, modo }
    const [montarDetalleCorte, setMontarDetalleCorte] = useState(false);

    /* El corte del aviso, sólo si de verdad hay algo que resolver: el cierre del
       día (Z) no se confirma, y uno ya resuelto tampoco. */
    const corteDe = useCallback((n) => {
        if (!AVISOS_DE_CORTE.has(n.type) || !puedeResolverCortes) return null;
        const c = cortesPorId.get(String(n.metadata?.corte_id));
        return c && c.tipo === 'C' && c.estado === 'PENDIENTE' ? c : null;
    }, [cortesPorId, puedeResolverCortes]);

    const abrirCorte = useCallback((n, corte, modo) => {
        if (!n.read_at) markNotificationRead(n.id);
        cerrarLoQueEsteAbierto();
        setMontarDetalleCorte(true);
        setCorteAbierto({ corte, modo });
    }, [markNotificationRead, cerrarLoQueEsteAbierto]);

    const onConfirmarCorte = useCallback(async (n, corte) => {
        if (corteOcupado) return;
        if (!seConfirmaDeUnClic(corte)) { abrirCorte(n, corte, 'confirmar'); return; }
        if (!n.read_at) markNotificationRead(n.id);
        if (await resolverElCorte(corte, 'CONFIRMADO')) recargarCortes();
    }, [corteOcupado, abrirCorte, markNotificationRead, resolverElCorte, recargarCortes]);

    const onDescartarCorte = useCallback((n, corte) => abrirCorte(n, corte, 'descartar'), [abrirCorte]);

    /* La solicitud no viaja en el aviso: el aviso trae su id. Se pide al apretar
       y no al pintar la lista — prefetchear doce solicitudes para que quizá se
       decida una es pagar doce viajes por adelantado. */
    const traerSolicitud = async (n) => {
        try {
            const fila = await cargarFilaDeAviso(n);
            if (!fila) {
                useToastStore.getState().showToast('Ya no está',
                    'Esta solicitud ya no está disponible.', 'error');
                return null;
            }
            return paraDecidir(fila, esAvisoDeMinMax(n));
        } catch (err) {
            useToastStore.getState().showToast('No se pudo',
                mensajeAmigable(err, 'No se pudo abrir la solicitud.'), 'error');
            return null;
        }
    };

    /* Y antes de aplicar, se mira el estado REAL. El aviso es una fila aparte de
       la solicitud: otra pestaña —u otra persona— pudo resolverla y esto seguiría
       ofreciendo los dos botones. La base lo frena igual (el UPDATE va
       condicionado a PENDING), pero rebotar sin decir por qué se lee como que el
       botón no hace nada. */
    const yaResuelta = (n, req) => {
        if (req.status === 'PENDING') return false;
        useToastStore.getState().showToast('Ya estaba resuelta',
            'Alguien más la decidió mientras tanto.', 'info');
        marcarAvisoResuelto(n.metadata.request_id, req.status);
        return true;
    };

    /* Sin `try { … } finally { setDecidiendoId(null) }`, y no es cuestión de
     * gusto: medido con eslint el 2026-08-14, un `try/finally` acá hacía que el
     * compilador de React ABANDONARA el componente entero. Y tampoco hace falta:
     * ni `traerSolicitud` ni `decidir` lanzan. */
    const onAprobar = useCallback(async (n) => {
        if (decidiendoId) return;
        if (!n.read_at) markNotificationRead(n.id);
        setDecidiendoId(n.id);
        const req = await traerSolicitud(n);
        // Sin `aceptadas`: desde el aviso se aprueba COMPLETO. Dejar líneas
        // afuera es una edición y vive en el diálogo, que es donde se ven los
        // renglones y se puede recortar la cantidad.
        if (req && !yaResuelta(n, req)) {
            await decidir({ req, modo: 'approve', nota: '', aceptadas: null });
        }
        setDecidiendoId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [decidiendoId, markNotificationRead, decidir]);

    const onRechazar = useCallback(async (n) => {
        if (decidiendoId) return;
        if (!n.read_at) markNotificationRead(n.id);
        setDecidiendoId(n.id);
        const req = await traerSolicitud(n);
        if (req && !yaResuelta(n, req)) {
            cerrarLoQueEsteAbierto();
            setRechazo({ req, accion: 'reject' });
        }
        setDecidiendoId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [decidiendoId, markNotificationRead, cerrarLoQueEsteAbierto]);

    /* El traslado abre el MISMO diálogo, sin decisión desplegada. Sigue sin pasar
       por `decidir`: aprobarlo con `approveRequest` lo marcaría APROBADO sin
       mover un solo producto. */
    const onResolverTraslado = useCallback(async (n) => {
        if (decidiendoId) return;
        if (!n.read_at) markNotificationRead(n.id);
        setDecidiendoId(n.id);
        const req = await traerSolicitud(n);
        if (req && !yaResuelta(n, req)) {
            cerrarLoQueEsteAbierto();
            setRechazo({ req, accion: null });
        }
        setDecidiendoId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [decidiendoId, markNotificationRead, cerrarLoQueEsteAbierto]);

    const acciones = useMemo(() => ({
        puedeDecidir, trasladoPorResolver, corteDe,
        decidiendoId, decidiendo, corteOcupado,
        onAprobar, onRechazar, onResolverTraslado, onConfirmarCorte, onDescartarCorte,
    }), [puedeDecidir, trasladoPorResolver, corteDe, decidiendoId, decidiendo, corteOcupado,
        onAprobar, onRechazar, onResolverTraslado, onConfirmarCorte, onDescartarCorte]);

    /* Los diálogos van FUERA de la lista, y no es un detalle de estilo: el de
       rechazo cierra el panel al abrirse, y montado dentro de él se desmontaría
       con él — el modal que lee el estado que lo abre se vacía al cerrarlo. */
    const dialogos = (
        <>
            {rechazo && (
                <Suspense fallback={null}>
                    <ModalSolicitud
                        key={rechazo.req.id}
                        req={rechazo.req}
                        canApprove
                        employeesById={empleadosPorId}
                        accionInicial={rechazo.accion}
                        ocupado={decidiendo}
                        onCerrar={() => !decidiendo && setRechazo(null)}
                        onDecidir={decidir}
                        /* El traslado lo aplica una Edge Function y su aviso tiene
                           fila propia: el disparador de la base lo marca resuelto,
                           pero eso llega por realtime y el panel todavía ofrecería
                           el botón. Se apaga acá. */
                        onResuelto={(estado) => marcarAvisoResuelto(rechazo.req.id, estado)}
                    />
                </Suspense>
            )}

            {/* Se queda montado con `corte` en nulo —igual que en el módulo y en
                el Inicio—: es lo que le deja hacer su salida en vez de
                desaparecer de golpe. */}
            {montarDetalleCorte && (
                <Suspense fallback={null}>
                    <CorteDetalleModal
                        corte={corteAbierto?.corte ?? null}
                        nombreSala={nombreSala}
                        modoInicial={corteAbierto?.modo ?? null}
                        origen={origen}
                        onClose={() => setCorteAbierto(null)}
                        onResuelto={recargarCortes}
                    />
                </Suspense>
            )}

            {/* La entrega de la caja al confirmar — ver `useResolverCorte`. */}
            {dialogoDeEntrega}
        </>
    );

    return { acciones, dialogos, empleadosPorId, recargarCortes };
}

export default useAccionesDeAviso;
