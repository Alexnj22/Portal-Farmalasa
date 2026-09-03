import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    AlertTriangle, ArrowDownLeft, ArrowUpRight, DoorOpen, Landmark, Lock, Paperclip, Printer, Scale, ShieldCheck, ShoppingBag, Wallet,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Button from '../components/common/Button';
import CarrilCards from '../components/common/CarrilCards';
import FilterBar from '../components/common/FilterBar';
import LiquidModal from '../components/common/LiquidModal';
import LiquidSelect from '../components/common/LiquidSelect';
import Notice from '../components/common/Notice';
import FileField from '../components/common/FileField';
import PortalInput from '../components/common/PortalInput';
import IdentidadDeQuienRetira from '../components/bolsas/IdentidadDeQuienRetira';
import ValesDeCaja from '../components/bolsas/ValesDeCaja';
import AvatarConEstado from '../components/common/AvatarConEstado';
import PhotoLightbox from '../components/common/PhotoLightbox';
import SearchInput from '../components/common/SearchInput';
import StatCard from '../components/common/StatCard';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import useCerrarBolsa from '../hooks/useCerrarBolsa';
import useResolverCorte from '../hooks/useResolverCorte';
import {
    abrirCaja, anotarIngreso, anotarSalida, cerrarElDia, cerrarTurno, estadoDeCaja,
    estadoDeCajaEnElOrigen, hayQuePreguntarleAlOrigen, fetchBolsas,
    fetchMovimientosDelPortal, fetchSaldos, fetchSalasConCaja, fetchSalidasDeSalaDelDia,
    anotarAbono, fetchTiposDeMovimiento, fetchTiposDeSalida, fetchValesPendientes, hacerCorte,
    leerBoleta, pedirCorreccion,
    subirComprobante,
} from '../data/bolsas';
import EntregaDelTurno from '../components/cortes/EntregaDelTurno';
import { fetchCortes, fetchPersonas, fetchVentasPorPago } from '../data/cortes';
/* Los cobros de crédito son la TERCERA fuente de efectivo del día, junto con
 * el cajón y las bolsas. Viven en `creditos` porque el cobro se decide allá;
 * acá se miran porque el dinero entra por esta caja. */
import { cobroEnEfectivo, fetchCobrosDelPortal } from '../data/creditos';
import { conLaCuentaBuena, repartirPorCorte } from '../utils/cortesDiagnostico';

/* Sacar dinero de una bolsa se mudó acá desde Bolsas (pedido del usuario,
 * 29-ago): todo lo que mueve efectivo vive en la caja. Es el MISMO componente,
 * no una copia — arrastra su catálogo de motivos, la lectura de la boleta, la
 * identidad de quien retira y el reparto entre bolsas. Va diferido porque
 * arrastra el editor de fotos, y la mayoría de las visitas a esta pantalla no
 * sacan dinero de una bolsa. */
const SalidaDeBolsa = lazy(() => import('../components/bolsas/SalidaDeBolsa'));
/* El abono va diferido por lo mismo: arrastra el buscador del catálogo y la
 * mayoría de las visitas a esta pantalla no apartan nada. */
const DialogoAbono = lazy(() => import('../components/caja/DialogoAbono'));
import { construirComprobanteDeAbono } from '../utils/abonoTicket';
import { construirComprobanteDeCorte } from '../utils/corteTicket';
import { construirComprobanteDeMovimiento } from '../utils/movimientoTicket';
import { conceptoDelPapel } from '../utils/conceptoDelPapel';
import { conSigno, formatMoney } from '../utils/formatNumber';
import { imprimirDocumento } from '../utils/ticketPrint';
import { mensajeAmigable } from '../utils/errorMessages';
import { getSignedFileUrl } from '../utils/storageFiles';

/**
 * Mi caja — el turno de esta sala, ahora.
 *
 * ── Por qué una sola pantalla y no cuatro ──────────────────────────────────
 * Abrir, anotar, cortar y cerrar son actos del MISMO turno y comparten estado.
 * Repartirlos obligaría a saltar de pantalla para seguir un solo día de caja, y
 * una sala tiene una caja: una vista de «aperturas» sería una lista de un
 * elemento con filtros que no recortan nada. Lo que SÍ es una lista —el
 * historial de todas las salas— vive en Cortes, que es la pantalla de mirar.
 *
 * ── El conteo a ciegas ─────────────────────────────────────────────────────
 * Al cortar se pide UN número: el efectivo contado. La pantalla NO dice cuánto
 * debería haber, y no es un olvido — es el control entero. La otra pantalla lo
 * muestra antes de teclear y su total sale de tres casillas que escribe la
 * misma persona, así que inflando la de tarjeta la diferencia queda en cero.
 * Acá lo esperado llega recién en la respuesta, junto con la diferencia.
 *
 * ⚠️ Y sólo vale si el corte se hace únicamente desde acá: mientras la sala
 * pueda cortar en la otra pantalla, ahí ve el esperado.
 */
const VACIO = [];

/* Qué escribir en «Detalle», por tipo.
 *
 * Un `placeholder` genérico no enseña nada, y este campo es justo el que decide
 * si el registro sirve dentro de un mes: sin la pista, «Aplicación de
 * inyección» se llena con «aplicación» —el mismo dato que ya está arriba— en
 * vez de con qué se aplicó. Vive acá y no en la tabla porque es texto de la
 * PANTALLA, no del catálogo: cambia con el diseño del formulario, no con el
 * negocio. */
const PISTA_DE_DETALLE = {
    APLICACION:     'Neurobion 25000',
    GLUCOSA:        'en ayunas',
    ABONO_CREDITO:  'de qué compra',
    // La causa la lee la foto de la boleta del aparato; la pista es por si hay
    // que corregirla a mano.
    POS_PROMERICA:  'CAESS, ANDA, telefono',
    COMPRA:         'agua fria, saldo telefonico',
    PAGO_PROVEEDOR: 'que factura se paga',
    ANTICIPO:       'quincena que descuenta',
    BONIFICACION:   'de que linea',
    DEVOLUCION:     'por que se devuelve',
};

/**
 * `comoPestana` — esta vista es la pestaña «Hoy» de Efectivo desde v2.914.0.
 *
 * Con la prop puesta NO dibuja su propio `GlassViewLayout`: el anfitrión ya
 * puso el marco, el título y la barra de pestañas, y anidar dos marcos daría
 * dos encabezados y dos rellenos. El cuerpo y los diálogos son exactamente los
 * mismos — no hay una versión «de pestaña» de nada, sólo el marco de menos.
 *
 * Sigue exportándose entera y usable sola: si algún día la sala vuelve a tener
 * su pantalla propia, no hay que deshacer nada.
 */
export default function MiCajaView({ comoPestana = false }) {
    // `VACIO` estable y no `|| []`: un arreglo nuevo en cada render invalida
    // los `useMemo` que dependen de él.
    const branches = useStaff((s) => s.branches) ?? VACIO;
    const { user, hasPermission, getScope } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const puedeOperar = hasPermission('caja_vales', 'can_edit');
    // Las salidas de bolsa son del OTRO módulo. Sin este permiso no se leen, y
    // la pantalla lo dice en vez de mostrar una lista incompleta sin avisar.
    const puedeVerBolsas = hasPermission('bolsas', 'can_view');
    // Los cortes son del OTRO módulo, igual que las bolsas.
    const puedeVerCortes = hasPermission('cortes_caja', 'can_view');

    /* ── QUIÉN PUEDE VER CUÁNTO DEBERÍA HABER ──────────────────────────────
     *
     * Regla del usuario (1-sep): «no quiero que vean montos totales, o algo que
     * les diga cuánto deben tener sin ingresar el monto, por transparencia».
     *
     * El conteo a ciegas es TODO el control del corte, y esta pantalla lo
     * estaba entregando por la puerta de al lado: «En la caja $1,134.80» y «De
     * eso, en efectivo $976.10» son exactamente el número que hay que contar.
     * Con eso a la vista, teclear el conteo no es contar — es copiar, y un
     * faltante nunca aparece.
     *
     * El corte es el ALCANCE y no un permiso nuevo: quien mira todas las salas
     * —supervisión, administración— no es quien cuenta ese cajón, así que para
     * él la cifra es información y no una respuesta anticipada. Quien opera una
     * sala la cuenta, y para él es la respuesta.
     *
     * Lo que se esconde es el DINERO, no la actividad: cuántas ventas hubo, a
     * qué hora abrió y quién, todo eso se queda. No dice cuánto hay. */
    const veLosMontos = getScope('cortes_caja') === 'ALL';

    /* El ALCANCE, que es el de `caja_vales` y no el de Cortes.
     *
     * La lista de salas sale de `fetchSalasConCaja`, que lee
     * `cortes_caja_aperturas` — y su RLS recorta por el alcance de
     * **`cortes_caja`**, que es otro módulo. Quien mira todos los cortes y
     * opera sólo su caja recibía las seis salas, elegía una ajena, y
     * `operar-caja` la negaba con un 403 tres clics después. El freno del
     * servidor ya estaba (v2.884.1); lo que faltaba era que la pantalla no
     * ofreciera lo que el servidor iba a negar.
     *
     * `branchId` y no `branch_id`: así se llama en el objeto de la sesión (el
     * resto del portal escribe `user?.branchId ?? user?.branch_id`, acá estaba
     * sólo la forma que no existe). En snake_case valía `undefined` SIEMPRE,
     * así que la sala propia no se elegía nunca — y como el selector se
     * esconde cuando hay una sola opción, quien tiene exactamente una sala se
     * quedaba en «Elige una sala» sin nada arriba que elegir. Ésa es la
     * pantalla vacía que reportó la sala: ni error, ni fila de menos. */
    const alcance = getScope('caja_vales');
    const miSala = user?.branchId ?? user?.branch_id ?? null;

    /* La sala elegida vive en la DIRECCIÓN, no en `useState`.
     *
     * Arranca sin ninguna y la elige quien mira: la ficha de quien supervisa
     * vive en **Administración**, que no tiene caja, así que tomarla de ahí
     * ofrecía la sala equivocada y escondía las seis que sí la tienen.
     *
     * Y va en la dirección por el mismo motivo que la pestaña activa: esta
     * pantalla se recarga sola —la sesión de sala se cierra a los 5 minutos, y
     * el service worker recarga al publicar—, y con la sala en memoria eso
     * devuelve a «Elige una sala» sin decir nada. Además hace que el enlace se
     * pueda pasar («mirá la caja de Salud 4») y que una medición pueda entrar
     * de verdad: el barrido del teléfono midió esta vista con la pantalla
     * vacía y reportó cero hallazgos sobre nada. */
    const [params, setParams] = useSearchParams();
    const sala = params.get('sala') ? Number(params.get('sala')) : null;
    const setSala = useCallback((id) => {
        setParams((p) => {
            if (id == null) p.delete('sala'); else p.set('sala', String(id));
            return p;
        // REEMPLAZA, no empuja: cambiar de sala no es navegar a otro lado, y
        // apilarlo obligaría a apretar «atrás» una vez por cada sala mirada
        // para salir de la pantalla.
        }, { replace: true });
    }, [setParams]);
    const [conCaja, setConCaja] = useState(VACIO);
    const [estado, setEstado] = useState(null);
    /* «No pude leer la caja» y «la caja está cerrada» son respuestas OPUESTAS y
     * se veían igual: la tarjeta decía «Cerrada · Nadie puede vender» sobre una
     * caja abierta desde las 6:58, porque un error dejaba el estado en `null` y
     * `null` se pintaba como cerrada. El aviso de abrir además invita a abrir
     * una caja que ya está abierta. */
    const [noSePudo, setNoSePudo] = useState(null);
    const [pendientes, setPendientes] = useState([]);
    const [cargando, setCargando] = useState(true);
    /* Qué carga es la vigente. Va acá arriba —y no junto a `cargar`— porque
     * `cargar` lo lee: un `useRef` declarado después se leería antes de existir,
     * que no da `undefined` sino que lanza en cada render (`gate:tdz`). */
    const cargaRef = useRef(0);
    const [ocupado, setOcupado] = useState(false);
    const [dialogo, setDialogo] = useState(null);   // 'abrir' | 'ingreso' | 'corte' | 'cerrar'
    const [resultado, setResultado] = useState(null);
    const [bolsas, setBolsas] = useState(VACIO);
    const [movimientos, setMovimientos] = useState(VACIO);
    const [deBolsas, setDeBolsas] = useState(VACIO);
    /* Los cobros de crédito de este día en esta sala. Van con los movimientos y
     * no en una sección aparte: quien acaba de cobrar viene a esta lista a ver
     * que quedó anotado, y una lista de movimientos a la que le falta la
     * entrada de efectivo más grande del día no es una lista de movimientos. */
    const [cobros, setCobros] = useState(VACIO);
    const [ventas, setVentas] = useState(VACIO);
    const [tipos, setTipos] = useState(VACIO);
    // Lo que puede entrar y salir del CAJÓN. Otro catálogo que el de arriba:
    // aquél nombra de dónde sale el dinero de una BOLSA.
    const [tiposDeCaja, setTiposDeCaja] = useState(VACIO);
    const [corrigiendo, setCorrigiendo] = useState(null);
    /* Los cortes del día, COMPLETOS. `estadoDeCaja` ya trae los suyos, pero sin
     * el nombre de quien cortó ni quién lo confirmó — y es justo lo que la sala
     * entra a comprobar: «que todo esté bien» (usuario, 1-sep). Van aparte y no
     * en la respuesta de la caja porque salen de la base, no del sistema de la
     * caja, y llegan aunque él no conteste. */
    const [cortesDelDia, setCortesDelDia] = useState(VACIO);
    const [firmantes, setFirmantes] = useState(() => new Map());
    /** Quién guardó cada bolsa (id → nombre), para la etiqueta que se reimprime. */
    const [embolsaron, setEmbolsaron] = useState(() => new Map());
    /** Quién anotó cada movimiento del día (id → persona, con su foto).
     *
     * Va acá y no adentro de la lista porque son las DOS listas —lo del cajón y
     * lo de las bolsas— resueltas de una vez: son la misma pantalla, y pedir
     * las personas dos veces traería la misma gente dos veces. */
    const [anotaron, setAnotaron] = useState(() => new Map());

    // Cómo se llama cada motivo de salida. Sale de la TABLA y no de una lista
    // escrita acá: un motivo nuevo aparecería en la base y no en la pantalla,
    // que es la regla del rótulo que no es una clave.
    useEffect(() => {
        let vivo = true;
        fetchTiposDeSalida().then((t) => { if (vivo) setTipos(t || VACIO); });
        fetchTiposDeMovimiento().then((t) => { if (vivo) setTiposDeCaja(t || VACIO); });
        return () => { vivo = false; };
    }, []);

    // Cuáles han tenido caja alguna vez. Sirve para DESCUBRIRLAS, no para
    // decidir quién puede operar cuál — eso lo dice el alcance, abajo.
    useEffect(() => {
        let vivo = true;
        fetchSalasConCaja().then((ids) => { if (vivo) setConCaja(ids); });
        return () => { vivo = false; };
    }, []);

    const salas = useMemo(() => {
        /* Con alcance de una sola sala, la lista ES su sala, y va aunque
         * todavía no tenga ninguna apertura: `conCaja` sale del historial, y el
         * historial no puede decidir quién abre la caja por PRIMERA vez. Sin
         * esto, la primera sala en estrenar la pantalla no tendría cómo entrar
         * —«Sin salas con caja» sobre una caja que sí existe—. */
        if (alcance !== 'ALL') {
            return branches.filter((b) => String(b.id) === String(miSala));
        }
        return branches.filter((b) => conCaja.includes(b.id));
    }, [branches, conCaja, alcance, miSala]);

    /* Cuál sale elegida.
     *
     * La que venga en la DIRECCIÓN manda — es lo que hace que una recarga
     * vuelva a donde estaba. Si no viene ninguna: la propia; y si la propia no
     * está en la lista pero hay UNA sola, ésa. Con una única opción no hay
     * ninguna decisión que tomar, y dejarla sin elegir deja la pantalla vacía
     * **sin salida**, porque el selector no se dibuja para una sola sala. Con
     * dos o más se elige a mano: elegir por alguien sería decidir en qué sala
     * opera. */
    useEffect(() => {
        if (sala != null || salas.length === 0) return;
        const propia = salas.find((b) => String(b.id) === String(miSala));
        if (propia) setSala(propia.id);
        else if (salas.length === 1) setSala(salas[0].id);
    }, [salas, miSala, sala, setSala]);

    const nombreSala = useMemo(
        () => branches.find((b) => String(b.id) === String(sala))?.name || '',
        [branches, sala],
    );

    /* Confirmar o descartar SIN salir de acá (pedido del usuario, 1-sep): «al
     * dar hacer corte y obtener resultado debe preguntar si se confirma o se
     * descarta». Antes el corte quedaba PENDIENTE y había que ir a la pestaña
     * de Cortes a resolverlo — y un corte sin resolver no habilita el cierre,
     * así que la sala llegaba al final del día con el candado puesto sin saber
     * por qué. Es el MISMO `useResolverCorte` que usa la pestaña: dos caminos
     * para la misma decisión que escribieran distinto darían dos bitácoras.
     *
     * ⚠️ Va DEBAJO de `nombreSala` y no arriba con los `useState`, y no es
     * cosmético: arriba leía `nombreSala` **antes** de su `const`, y eso no es
     * `undefined` sino un ReferenceError —«Cannot access … before
     * initialization»— en CADA render. Efectivo entera reventaba contra el
     * ErrorBoundary desde la v2.930.0 y el aviso nombraba una letra minificada,
     * así que no decía dónde. Lo caza `no-use-before-define` sobre variables;
     * al mover un hook, comprobar que todo lo que lee ya esté declarado. */
    const { resolver, ocupadoId, dialogoDeEntrega } = useResolverCorte({
        nombreSala: { [sala]: nombreSala }, origen: 'micaja',
    });

    /* Los papeles de una salida de bolsa: el vale y la etiqueta nueva. Sale del
     * hook y no de acá por lo mismo que `useResolverCorte` — tres pantallas
     * ofrecen la salida y la que escriba su propia versión va a salir con un
     * número equivocado pegado en una bolsa. Va debajo de `nombreSala` por la
     * misma razón que el de arriba: leerlo antes de su `const` lanza en cada
     * render, no devuelve `undefined`. */
    const { imprimirTrasLaSalida } = useCerrarBolsa({
        nombreSala: { [sala]: nombreSala }, origen: 'micaja',
    });

    /* El comprobante del corte al rollo.
     *
     * `sala` va explícito por lo mismo que en el comprobante de una diferencia:
     * el papel se anexa al corte, que está EN la sala. Si esta computadora no
     * tiene la ticketera —administración cortando desde la oficina— sale en la
     * caja de esa sucursal, que es donde sirve.
     *
     * Un fallo de impresión NO es un fallo del corte: se avisa y se ofrece
     * repetirlo desde el mismo diálogo. */
    const imprimirCorte = useCallback(async (r) => {
        const ticket = construirComprobanteDeCorte({
            resultado: r, sala: nombreSala, hechoPor: user?.name || '',
            hechoAt: new Date().toISOString(),
        });
        const salida = await imprimirDocumento(ticket, { sala });
        if (salida.ok) {
            showToast('Comprobante del corte enviado a la impresora',
                'Si no sale el papel, vuelve a imprimirlo desde aquí.', 'success');
        } else {
            showToast('No se pudo imprimir el comprobante', salida.detalle, 'error');
        }
        return salida.ok;
    }, [nombreSala, sala, showToast, user]);

    /* El comprobante del abono al rollo.
     *
     * `sala` va explícito por lo mismo que el del corte: el papel se lo lleva el
     * cliente que está PARADO EN ESA SALA. Si esta computadora no tiene la
     * ticketera —administración mirando desde la oficina— sale en la caja de esa
     * sucursal, que es donde está la persona que lo espera. */
    const imprimirAbono = useCallback(async (abono) => {
        const ticket = construirComprobanteDeAbono({
            abono, sala: nombreSala, hechoPor: user?.name || '',
            hechoAt: new Date().toISOString(),
        });
        const salida = await imprimirDocumento(ticket, { sala });
        if (!salida.ok) {
            showToast('No se pudo imprimir el comprobante', salida.detalle, 'error');
        }
        return salida.ok;
    }, [nombreSala, sala, showToast, user]);

    /* El papel de un ingreso o un vale del cajón.
     *
     * Sale como parte del acto, igual que el del corte y el del abono: en la
     * salida es lo que la persona que se lleva el dinero firma, y en el ingreso
     * es lo que se lleva quien lo trajo. Un fallo de impresión NO deshace el
     * movimiento —ya está escrito en la caja—: se avisa y se sigue. */
    const imprimirMovimiento = useCallback(async (mov, tipo, extra) => {
        if (!mov) return false;
        const ticket = construirComprobanteDeMovimiento({
            movimiento: mov,
            etiqueta: tipo?.etiqueta || '',
            detalle: extra?.detalle || '',
            persona: extra?.persona || '',
            comoSeComprobo: extra?.comoSeComprobo || null,
            sala: nombreSala, hechoPor: user?.name || '',
            hechoAt: new Date().toISOString(),
        });
        const salida = await imprimirDocumento(ticket, { sala });
        if (!salida.ok) showToast('No se pudo imprimir el comprobante', salida.detalle, 'error');
        return salida.ok;
    }, [nombreSala, sala, showToast, user]);

    const cargar = useCallback(async () => {
        /* El turno de ESTA carga. Desde que hay trabajo después del pintado
         * —las caras, los saldos y la revalidación contra el origen— una tanda
         * puede volver cuando quien mira ya cambió de sala, y escribiría el
         * estado de una caja sobre la pantalla de otra. El token se compara
         * antes de cada `set`: el que llega tarde se descarta. */
        const token = ++cargaRef.current;
        if (!sala) { setCargando(false); return; }
        setCargando(true);
        /* El estado va PRIMERO y solo: trae el DÍA que la caja tiene abierto, y
         * ese día —no el del calendario— es el que recorta todo lo demás. A las
         * once de la noche con la caja sin cerrar, el calendario ya cambió de
         * día y la caja no: filtrando por el calendario, lo anotado en esa hora
         * desaparece de la pantalla justo mientras todavía cuenta para el corte.
         *
         * Lo que ya NO cuesta es el viaje al sistema de la caja: desde v2.969.0
         * `estadoDeCaja` lo contesta la base (~18 ms) en vez de raspar el panel
         * del origen (p50 815 ms, p99 6,903 ms) con la pantalla en blanco. */
        const e = await estadoDeCaja(sala);
        if (token !== cargaRef.current) return;
        const vivo = e.error ? null : e;
        setNoSePudo(e.error ? mensajeAmigable(e.error) : null);
        const dia = vivo?.dia || new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
        const [v, abiertas, movs, porPago, salidas, cobrados, delDia] = await Promise.all([
            fetchValesPendientes(),
            fetchBolsas({ estados: ['ABIERTA', 'ENTREGADA', 'CONTADA'] }),
            fetchMovimientosDelPortal(sala, dia),
            fetchVentasPorPago({ desde: dia, hasta: dia }),
            // Sin el permiso de bolsas la policy devuelve cero filas y NO un
            // error: preguntar antes es lo que separa «no hubo ninguna» de «no
            // las puedo ver», que en pantalla se leen igual.
            puedeVerBolsas ? fetchSalidasDeSalaDelDia({ sala, dia }) : Promise.resolve(VACIO),
            /* Los cobros de crédito del MISMO día de caja. El rango va de `dia`
             * a `dia` y no del reloj por lo mismo que los movimientos: a las
             * once de la noche con la caja sin cerrar el reloj ya cambió de día
             * y la caja no. */
            fetchCobrosDelPortal({ desde: dia, hasta: dia, branchId: sala }),
            /* Los cortes del día entran a ESTA tanda y ya no después. Sólo
             * necesitan `dia`, que ya está: pedirlos en un paso aparte era un
             * viaje entero de reloj puesto delante del pintado por nada.
             *
             * Sin `cortes_caja` la policy devuelve cero filas y NO un error,
             * así que «no hubo ningún corte» y «no los puedo ver» se leerían
             * igual. Preguntar antes es lo que los separa. */
            puedeVerCortes
                ? fetchCortes({ desde: dia, hasta: dia }).then((f) => (f || [])
                    .filter((c) => String(c.branch_id) === String(sala)))
                : Promise.resolve(VACIO),
        ]);
        if (token !== cargaRef.current) return;
        setMovimientos(movs);
        setDeBolsas(salidas);
        setCobros(cobrados || VACIO);
        setVentas((porPago || []).filter((p) => String(p.branch_id) === String(sala)));
        setEstado(vivo);
        setPendientes((v.filas || []).filter((p) => String(p.branch_id) === String(sala)));
        setCortesDelDia(delDia || VACIO);
        const mias = (abiertas || []).filter((b) => String(b.branch_id) === String(sala));

        /* ── ACÁ YA SE PUEDE PINTAR ──────────────────────────────────────────
         *
         * Todo lo que la pantalla dice está en la mano. Lo que sigue —las caras
         * y el saldo de cada bolsa— no cambia una sola cifra: es la misma regla
         * que la vista de Cortes ya seguía («la tarjeta se pinta con o sin la
         * cara»), y tenerlo detrás del spinner ponía tres viajes de reloj entre
         * el dato y el ojo. */
        setCargando(false);

        /* Las caras, en UN pedido para las cuatro listas. Antes eran tres
         * llamadas encadenadas —los movimientos, los cortes y las bolsas— y
         * cada una además firma las fotos: seis viajes en serie para lo mismo.
         * `fetchPersonas` deduplica, y la misma persona suele estar en varias.
         *
         * De los cortes van los TRES roles que nombran y no sólo quien
         * confirmó: `EntregaDelTurno` pinta la cara de quien entregó y la de
         * quien recibió, y quien sólo recibe cajas no está en el padrón de
         * resolutores — saldría con la inicial, que se lee igual que «no tiene
         * foto».
         *
         * Y el saldo de cada bolsa va en paralelo, no después: `SalidaDeBolsa`
         * elige la más vieja que alcance sola y sin el saldo no puede elegir,
         * pero eso se pregunta al abrir un diálogo, no al entrar. */
        const [saldos, quienes] = await Promise.all([
            fetchSaldos(mias.map((b) => b.id)),
            fetchPersonas([
                ...(movs || []).map((m) => m.registrado_por),
                ...(salidas || []).map((o) => o.registrado_por),
                ...(cobrados || []).map((c) => c.abonado_por),
                ...(delDia || []).flatMap((c) => [c.resuelto_por, c.recibido_por, c.employee_id]),
                ...mias.map((b) => b.cerrada_por),
            ]),
        ]);
        if (token !== cargaRef.current) return;
        const porId = new Map((quienes || []).map((q) => [q.id, q]));
        setAnotaron(porId);
        setFirmantes(porId);
        /* Quién guardó cada bolsa. Va a la etiqueta que se reimprime después de
         * una salida, y sin él `useCerrarBolsa` cae al nombre de QUIEN ESTÁ
         * MIRANDO: la etiqueta diría que la guardó alguien que no la guardó. */
        setEmbolsaron(new Map((quienes || []).map((q) => [q.id, q.name])));
        setBolsas(mias.map((b) => ({ ...b, ...(saldos.get(b.id) || {}) })));

        /* ── Y RECIÉN ACÁ, SI HACE FALTA, SE LE PREGUNTA AL ORIGEN ───────────
         *
         * Sólo en los dos casos en que el portal puede estar diciendo algo que
         * ya no es cierto (ver `hayQuePreguntarleAlOrigen`): que la caja figure
         * cerrada —abrir el turno desde la caja misma no pasa por acá— o que el
         * espejo haya dejado de mantenerse. Con la caja abierta y el espejo al
         * día no se pregunta, que es el caso de casi todo el día.
         *
         * Va DESPUÉS de pintar y nunca antes: su respuesta corrige la tarjeta,
         * no la estrena. Y si el origen no contesta, el `catch` no toca nada —
         * lo que ya está en pantalla salió de la base y sigue siendo cierto. */
        if (!hayQuePreguntarleAlOrigen(vivo)) return;
        const delOrigen = await estadoDeCajaEnElOrigen(sala).catch(() => ({ error: true }));
        if (token !== cargaRef.current || delOrigen?.error || delOrigen?.ok !== true) return;
        setEstado(delOrigen);
        setNoSePudo(null);
    }, [sala, puedeVerBolsas, puedeVerCortes]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de sala


    /* Si el día que la caja tiene abierto no lleva ni un corte, cerrar deja el
     * efectivo de toda la jornada sin contar ni una vez — y el cierre no se
     * deshace. El candado de verdad está en el servidor; esto es para decirlo
     * ANTES y no después de que alguien escriba la palabra. */
    /* CONFIRMADO y no sólo hecho (regla del usuario, 1-sep): «si fue prueba, el
     * corte no es final». Un corte se puede DESCARTAR —es la salida para un
     * conteo mal hecho— y aun así habilitaba el cierre. El candado de verdad
     * está en el servidor; esto es para decirlo ANTES de que alguien escriba la
     * palabra. */
    const cortesC = (estado?.cortes || []).filter((c) => c.tipo === 'C');
    const sinCorteHoy = !cortesC.some((c) => c.estado === 'CONFIRMADO');
    // «No hay corte» y «hay uno sin confirmar» son dos avisos distintos: el
    // primero manda a cortar, el segundo a revisar lo que ya se contó.
    const corteSinConfirmar = sinCorteHoy && cortesC.length > 0;

    /* ── LO QUE YA ESTÁ EMBOLSADO DE HOY ───────────────────────────────────
     *
     * En cada corte confirmado el efectivo se EMBOLSA (regla del usuario,
     * 1-sep): la bolsa se lleva el incremento y el cajón queda vacío. Pero el
     * sistema de la caja **acumula el día entero**, así que el corte de la tarde
     * espera todo lo del día — lo que está en la bolsa de la mañana incluido.
     *
     * Medido en Salud 5 el 1-sep: corte de las 12:36 declarado $488.63 → bolsa
     * de $488.63; corte de las 19:00 declarado **$816.95** → bolsa de $328.32,
     * que es la diferencia. Si en el segundo hubieran contado sólo el cajón
     * habrían declarado ~$328 y el corte habría marcado un faltante de $488 que
     * no existe.
     *
     * Así que la sala cuenta SÓLO EL CAJÓN y esto lo pone el portal. Es lo que
     * pidió el usuario: «que no tenga que sumar ni hacer nada más».
     *
     * Y es el SALDO, no la etiqueta: a una bolsa de hoy se le puede haber sacado
     * dinero —una remesa, un pago— y ese dinero ya no está adentro. Salud 3 hoy:
     * la bolsa S3-1216 nació con $359.60 y `REM-1058` le sacó $119.38, así que
     * aporta $240.22. Esa resta es la parte «menos los vales de caja».
     *
     * Las entregadas también cuentan: el dinero salió de la sala pero el día
     * del sistema de la caja lo sigue contando —entregar no es un vale—, y el
     * corte tiene que declarar lo que ese día vendió. */
    // El día se saca a una constante antes del `useMemo`: leer `estado?.dia`
    // adentro hace que el compilador infiera `estado` entero como dependencia y
    // no pueda conservar la memoización.
    const diaAbierto = estado?.dia ?? null;
    // Cuántas ventas lleva el día. Reemplaza al monto en la tarjeta cuando el
    // monto no se puede mostrar: es actividad, no la respuesta del corte.
    const ventasDelDia = useMemo(
        () => (ventas || []).reduce((n, v) => n + (Number(v.documentos) || 0), 0),
        [ventas],
    );

    const bolsasDeHoy = useMemo(
        () => (bolsas || []).filter((b) => b.fecha && diaAbierto && b.fecha === diaAbierto),
        [bolsas, diaAbierto],
    );
    const yaEmbolsado = useMemo(
        () => bolsasDeHoy.reduce((t, b) => t + (Number(b.saldo ?? b.monto_inicial) || 0), 0),
        [bolsasDeHoy],
    );

    const correr = useCallback(async (fn, exito) => {
        setOcupado(true);
        const r = await fn();
        setOcupado(false);
        /* `showToast` es (título, mensaje, tipo). Los tres avisos de error de
         * esta vista estaban escritos `showToast(mensaje, 'error')`, o sea con
         * la palabra «error» cayendo en el MENSAJE y el tipo quedándose en su
         * default — que es `'success'`. Un rechazo de la caja salía con el
         * ícono de festejo y «error» de subtítulo (visto en Salud 3 el 2-sep
         * al intentar abrir una caja que ya estaba abierta). */
        if (r.error) { showToast('No se pudo', mensajeAmigable(r.error), 'error'); return null; }
        /* ── El `aviso` del servidor GANA sobre el mensaje de éxito ─────────
         *
         * `operar-caja` contesta `ok: true` con un `aviso` cuando el acto salió
         * pero algo quedó a medias: la caja abrió y no se pudo anotar quién, el
         * movimiento se hizo y no se pudo ligar, **el día cerró y no aparece el
         * corte Z**. Los tres viajaban y esta función los tiraba, mostrando
         * «El día quedó cerrado» sobre un cierre sin Z.
         *
         * Reportado el 1-sep en Salud 3: el portal cerró, avisó que el Z no
         * estaba, la pantalla dijo que todo bien, y el Z hubo que hacerlo a
         * mano en el sistema de la caja. La comprobación existía y funcionaba;
         * lo que faltaba era decirlo.
         *
         * Va como advertencia y no como éxito: es lo que hay que atender. */
        if (r.aviso) showToast('Quedó algo pendiente', r.aviso, 'warning');
        else if (exito) showToast(exito, 'success');
        setDialogo(null);
        cargar();
        return r;
    // Memoizada y no una función suelta: `anotarSalidaDelCajon` la lleva en sus
    // dependencias, y una función nueva por render la reharía en cada uno.
    }, [showToast, cargar]);

    const opcionesDeSala = useMemo(
        () => salas.map((b) => ({ value: b.id, label: b.name })),
        [salas],
    );

    /* ── Los papeles de una salida que sí tocó una bolsa ────────────────────
     *
     * **Esto faltaba y el defecto llegó a producción.** El diálogo se cerraba
     * con `onHecho={() => { setDialogo(null); cargar(); }}`, o sea que descartaba
     * la operación y no imprimía NADA: ni el vale que se archiva ni la etiqueta
     * nueva de la bolsa, que desde ese momento dice un efectivo que ya no tiene.
     * Las otras dos pantallas que abren el mismo diálogo —la baldosa del Inicio
     * y el módulo de Bolsas— sí llamaban a `imprimirTrasLaSalida`.
     *
     * Medido en OTR-1060 (Salud 3, 2-sep, $3.37): `bolsas_movimientos.impreso_at`
     * en NULL y **ninguna fila en `cola_impresion`** a esa hora, con la caja de
     * la sala imprimiendo normal seis minutos antes y seis después. O sea que no
     * fue la ticketera: el papel nunca se mandó.
     *
     * Es el MISMO código que corre en las otras dos, y por eso vive en el hook:
     * dos copias de una regla son dos reglas. */
    const trasLaSalidaDeBolsa = useCallback(async (operacion, repartos) => {
        await imprimirTrasLaSalida(operacion, repartos, bolsas, embolsaron);
        setDialogo(null);
        cargar();
    }, [imprimirTrasLaSalida, bolsas, embolsaron, cargar]);

    /* ── Y la salida que sale del CAJÓN ─────────────────────────────────────
     *
     * Otro camino de escritura porque es otro dinero: el del cajón le pertenece
     * al turno abierto, así que se le anota a la caja —el corte de la noche la
     * espera como vale— y no hay bolsa que descontar ni etiqueta que reimprimir.
     * El papel es el mismo comprobante de movimiento que ya imprime un ingreso.
     *
     * Devuelve `{ ok }` en vez de lanzar: el diálogo tiene que poder mostrar el
     * motivo sin perder lo escrito, y la identidad comprobada se suelta sola
     * allá cuando la escritura no entró. */
    const anotarSalidaDelCajon = useCallback(async (datos) => {
        const r = await correr(() => anotarSalida({
            sala,
            monto: datos.monto,
            concepto: datos.concepto,
            tipo: datos.tipo,
            boleta: datos.boleta,
            fotoUrl: datos.fotoUrl,
            recibe: datos.recibe,
            recibidoPor: datos.recibidoPor,
            vale: datos.vale,
            // El texto entero. `concepto` va recortado a 50 porque es lo que le
            // cabe al sistema de la caja; esto es lo que alguien escribió, y sin
            // guardarlo la cola se perdía en los dos lados.
            //
            // Es `conceptoCompleto` y NO `detalle`: `detalle` es la nota suelta
            // que va al PAPEL, sin el rótulo del tipo adelante. Dos textos
            // parecidos con dos trabajos distintos.
            detalle: datos.conceptoCompleto,
        }), 'Salida anotada.');
        // `correr` ya mostró el motivo en un aviso y dejó el diálogo abierto:
        // se devuelve sin texto para no decir lo mismo dos veces.
        if (!r?.ok) return { ok: false };
        // El papel se arma con la fila que devolvió el servidor —con su número y
        // su fecha—, no con lo que el formulario mandó.
        if (r.movimiento) {
            await imprimirMovimiento(r.movimiento, { etiqueta: datos.etiqueta || '' }, {
                detalle: datos.detalle,
                persona: datos.persona?.name || datos.recibe || '',
                // Sale de la FILA, que lo trae del vale consumido: el navegador
                // no decide cómo se comprobó.
                comoSeComprobo: r.movimiento.recibido_metodo || null,
            });
        }
        return { ok: true };
    }, [correr, sala, imprimirMovimiento]);


    /* Las acciones de la vista son un DESCRIPTOR, no botones a mano (§15.5): la
     * vista dice qué se puede hacer y `FilterBar` decide cómo se dibuja en cada
     * tamaño — píldora en escritorio, barra flotante en táctil. Escritas a mano
     * quedaban como una fila suelta en el cuerpo, que es justo lo que §17 saca
     * de ahí.
     *
     * Una sola primaria: el corte con la caja abierta, abrirla cuando no. Con
     * dos, ninguna es la acción principal. */
    const acciones = useMemo(() => {
        if (!puedeOperar || !sala) return [];
        /* Sin saber si está abierta no se ofrece NADA. Ofrecer «Abrir la caja»
         * cuando la lectura falló es invitar a abrir una que ya está abierta:
         * el sistema lo rechaza, pero el que aprieta se entera por un error que
         * parece de otra cosa. */
        if (noSePudo) return [];
        if (!estado?.abierta) {
            return [{ key: 'abrir', icon: DoorOpen, label: 'Abrir la caja', rotulo: 'Abrir',
                variant: 'primary', rotuloFijo: true, onClick: () => setDialogo('abrir') }];
        }
        /* DOS movimientos y no cuatro: Entrada y Salida.
         *
         * «Sacar de una bolsa» era una acción aparte y le pedía a la sala una
         * decisión que le toca al portal: de dónde sale la plata. La decide él,
         * y desde el **2026-09-02 la prioridad es el CAJÓN**: si la caja tiene
         * el efectivo, de ahí sale y se le anota su vale; sólo cuando no lo
         * tiene se abre una bolsa.
         *
         * Estaba al revés —«prefiere siempre las bolsas de cortes anteriores»,
         * regla del 30-ago— y el botón hacía `setDialogo(bolsas.length ? 'bolsa'
         * : 'salida')`: con UNA bolsa abierta el cajón ni se ofrecía. Así se
         * pagaron $3.37 (OTR-1060, Salud 3) abriendo una bolsa sellada del día
         * anterior con el cajón lleno de las ventas de la mañana.
         *
         * Hoy el botón abre SIEMPRE el mismo diálogo y el origen lo decide el
         * monto adentro (`utils/bolsasReparto`).
         *
         * Los rótulos van CORTOS —«Hacer corte», «Entrada», «Salida»— porque
         * ahora no ceden nunca y la píldora no tiene techo: con «Anotar una
         * entrada» se comía el ancho del carril. */
        /* Las CUATRO llevan `rotuloFijo`, que el canónico marca como opt-in y
         * raro — y acá el motivo está escrito porque la excepción es real.
         *
         * El texto de las acciones es lo primero que la píldora cede, y con el
         * carril de cuatro tarjetas al lado lo cedía siempre: los cuatro
         * quedaban en un ícono mudo —una balanza, dos flechas y un candado— y
         * la diferencia entre «anotar una entrada» y «cerrar el día para
         * siempre» era la dirección de una flecha. Lo reportó el usuario.
         *
         * La advertencia del canónico es que una barra con todo rotulado deja
         * de poder degradar y se vuelve «una barra de acciones que además
         * filtra». Acá eso es lo que la barra ES: la vista tiene UN filtro —de
         * qué sala— y cuatro actos que son la pantalla entera. El que degrada
         * es el carril, que se estrecha y desliza. */
        return [
            { key: 'corte', icon: Scale, label: 'Hacer corte', rotulo: 'Corte',
                variant: 'primary', rotuloFijo: true,
                onClick: () => { setResultado(null); setDialogo('corte'); } },
            { key: 'entrada', icon: ArrowDownLeft, label: 'Entrada', rotulo: 'Entrada',
                rotuloFijo: true, onClick: () => setDialogo('ingreso') },
            { key: 'salida', icon: ArrowUpRight, label: 'Salida', rotulo: 'Salida',
                rotuloFijo: true, onClick: () => setDialogo('salida') },
            { key: 'cerrar', icon: Lock, label: 'Cerrar el día', rotulo: 'Cerrar',
                rotuloFijo: true, onClick: () => setDialogo('cerrar') },
        ];
    }, [puedeOperar, sala, estado, noSePudo]);

    /* Un nombre CORTO. La caja escribe «RODRIGO EDUARDO MARQUEZ» y en una
     * tarjeta eso se corta a «RODRIGO EDUARDO M…», que es peor que dos
     * palabras: el apellido —lo que distingue a dos Rodrigos— es justo lo que
     * se pierde. Primer nombre y primer apellido, con mayúscula normal. */
    const corto = useCallback((texto) => {
        const partes = String(texto || '').trim().split(/\s+/).filter(Boolean);
        if (!partes.length) return null;
        const elegidas = partes.length > 2 ? [partes[0], partes[2]] : partes.slice(0, 2);
        return elegidas.map(conMayuscula).join(' ');
    }, []);

    /* Las CUATRO preguntas con las que alguien entra a esta pantalla, y ninguna
     * más (pedido del usuario, 1-sep: «no des tanta información en las cards.
     * lo que interesa más que todo ver es que todo esté bien: la caja, quién
     * abrió, quién hizo el corte y confirmó»).
     *
     * Las de antes contaban pendientes y bolsas —trabajo por hacer, no estado—
     * y repetían la mitad del panel de abajo. */
    const estado_dia = diaAbierto;

    const ultimoCorte = useMemo(
        () => [...cortesDelDia].filter((c) => c.tipo === 'C').pop() || null,
        [cortesDelDia],
    );

    /* TODAS las entregas del día, en orden — no sólo la última.
     *
     * Un día de sala tiene tantas entregas como cortes confirmados, y Salud 3
     * llegó a siete turnos en un día. Con una sola, la pantalla contestaría
     * «quién la tiene» y perdería por dónde pasó, que es lo que hay que
     * reconstruir cuando aparece una diferencia. La cadena la arma
     * `cadenaDeEntregas`.
     *
     * `CIERRE` y `SIN_HORARIO` quedan fuera a propósito: el primero es el
     * último corte del día —no hay a quién entregarle— y el segundo es el
     * instrumento diciendo que no pudo medir. Ninguno de los dos es una entrega
     * que faltó, y pintarlos como tal enseñaría a ignorar el aviso.
     */
    const entregasDelDia = useMemo(
        () => cortesDelDia.filter((c) => c.entrega === 'RECIBIDO' || c.entrega === 'SIN_ENTREGA'),
        [cortesDelDia],
    );

    const cuerpo = (
        <div className="p-4 md:p-6 space-y-6">
                {/* El carril y la píldora comparten UNA fila (§17.0). Las dos
                    mitades —`lg:flex-row` acá y `flex-1` en el carril— son
                    obligatorias: `useMedidaFila` busca el carril en el abuelo de
                    la píldora y le descuenta 314px lo tenga al lado o no, así
                    que en renglones separados roba ancho en silencio. */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* Cuatro números fijos, no un desglose de largo variable
                        (§17.0 — «cuántas tarjetas hay lo fija la vista, nunca el
                        dato»). Van SIEMPRE, también sin sala: esconder el carril
                        le descuenta 314px a la píldora igual —`useMedidaFila` lo
                        busca en el abuelo y reserva su ancho esté o no—. Sin
                        sala dicen «—», que es la respuesta honesta. */}
                    <CarrilCards className="flex-1" ariaLabel="Estado de la caja de esta sala">
                        {/* 1 · ¿Cuánto hay? Lo que el sistema espera adentro
                            AHORA, que hasta v2.886 no estaba en ninguna pantalla. */}
                        {/* Con el conteo a ciegas puesto, esta tarjeta cambia de
                            pregunta: en vez de «cuánto hay» dice «cuántas ventas
                            van», que es actividad y no la respuesta del corte. */}
                        <StatCard icon={Landmark} label={veLosMontos ? 'En la caja' : 'Ventas de hoy'}
                            value={!sala || noSePudo ? '—'
                                : veLosMontos
                                    ? (estado?.registrado != null ? formatMoney(estado.registrado) : '—')
                                    : ventasDelDia}
                            sub={veLosMontos ? undefined : 'se cuenta al cortar'}
                            iconBg="bg-brand/10" iconCls="text-brand-text"
                            loading={cargando} />

                        {/* 2 · ¿Está abierta, y quién la abrió? Tres estados y no
                            dos: abierta, cerrada, y **no se pudo leer**. El
                            tercero decía «Cerrada · Nadie puede vender» sobre una
                            caja abierta desde las 6:58 — la respuesta contraria a
                            la verdad, sin nada que avisara que era una falla.

                            El nombre sale de quién apretó «Abrir la caja» en el
                            PORTAL, y de nadie más. Antes salía del sistema de la
                            caja, que da el nombre de la cuenta con la que la sala
                            abre siempre: La Popular decía «Mi La» —lo que queda
                            de «MI CAJA LA POPULAR» al recortarlo a dos palabras—
                            y las salas cuya cuenta sí lleva un nombre de persona
                            mostraban a ESA persona aunque hubiera abierto otra.
                            Sin fila del portal no se inventa un nombre: se dice
                            que se abrió por fuera, que es la verdad y además es
                            accionable. */}
                        <StatCard icon={noSePudo ? AlertTriangle : estado?.abierta ? DoorOpen : Lock}
                            label={!sala ? 'La caja' : noSePudo ? 'Sin respuesta' : estado?.abierta ? 'Abierta' : 'Cerrada'}
                            value={!sala ? '—' : noSePudo ? 'No se pudo leer'
                                : estado?.abierta ? (estado.desde || 'Abierta') : 'Sin turno'}
                            sub={!sala || noSePudo ? undefined
                                : estado?.abierta
                                    ? (corto(estado.quien) || 'se abrió fuera del portal')
                                    : 'Nadie puede vender'}
                            iconBg={estado?.abierta && !noSePudo ? 'bg-success/10' : 'bg-warning/10'}
                            iconCls={estado?.abierta && !noSePudo ? 'text-success-text' : 'text-warning-text'}
                            valueCls={estado?.abierta && !noSePudo ? 'text-success-text' : 'text-warning-text'}
                            loading={cargando} />

                        {/* 3 · ¿Se cortó, y quién? Sin `cortes_caja` la lista
                            llega vacía por policy, así que se dice «—» en vez de
                            «sin cortar»: son respuestas opuestas.

                            El nombre es el de quien apretó «Hacer corte» en el
                            PORTAL, sellado en la fila. Antes salía de
                            `empleado_texto` —el nombre de la CUENTA con la que
                            la sala corta— y era el mismo defecto que la tarjeta
                            de la caja mostraba como «Mi La»: en tres salas no es
                            una persona y en las otras tres es una que no cortó.
                            Sin fila del portal no se inventa un nombre. */}
                        <StatCard icon={Scale} label="Último corte"
                            value={!sala || !puedeVerCortes ? '—'
                                : ultimoCorte ? String(ultimoCorte.hora).slice(0, 5) : 'Sin cortar'}
                            sub={ultimoCorte
                                ? (corto(ultimoCorte.hizo?.name) || 'se hizo desde la caja')
                                : !puedeVerCortes ? 'sin permiso para verlos' : undefined}
                            iconBg={ultimoCorte ? 'bg-brand/10' : 'bg-warning/10'}
                            iconCls={ultimoCorte ? 'text-brand-text' : 'text-warning-text'}
                            valueCls={!ultimoCorte && sala && puedeVerCortes ? 'text-warning-text' : undefined}
                            loading={cargando} />

                        {/* 4 · ¿Alguien lo revisó? Un corte sin confirmar es
                            trabajo pendiente de otra persona, y es la última
                            pregunta de «¿está todo bien?».

                            La ENTREGA no vive acá: se probó en esta tarjeta y el
                            usuario la rechazó («quiero algo más visual, con la
                            foto»). Y tenía razón de forma: 148px de ancho no dan
                            para una cara, y un nombre suelto bajo el rótulo
                            «Confirmado» nombra a quien confirmó, que es otra
                            persona. Vive en `EntregaDelTurno`. */}
                        <StatCard icon={ShieldCheck} label="Confirmado"
                            value={!sala || !puedeVerCortes || !ultimoCorte ? '—'
                                : ultimoCorte.estado === 'CONFIRMADO' ? 'Sí'
                                    : ultimoCorte.estado === 'DESCARTADO' ? 'Descartado' : 'Falta'}
                            sub={ultimoCorte?.resuelto_por
                                ? (corto(firmantes.get(ultimoCorte.resuelto_por)?.name) || 'sin nombre')
                                : ultimoCorte ? 'nadie lo ha revisado' : undefined}
                            iconBg={ultimoCorte?.estado === 'CONFIRMADO' ? 'bg-success/10' : 'bg-warning/10'}
                            iconCls={ultimoCorte?.estado === 'CONFIRMADO' ? 'text-success-text' : 'text-warning-text'}
                            valueCls={ultimoCorte && ultimoCorte.estado !== 'CONFIRMADO' ? 'text-warning-text' : undefined}
                            loading={cargando} />
                    </CarrilCards>

                    {/* La sala y las acciones van en la píldora, no sueltas en el
                        cuerpo: es el lugar único donde se mira qué recorta la
                        vista y qué se puede hacer (§17, §15.5). Una sola primaria
                        por barra — el corte cuando la caja está abierta, abrirla
                        cuando no.
                        La barra se pinta SIEMPRE, también sin sala elegida: es la
                        ranura donde se elige, y esconderla dejaría el vacío sin
                        salida — que fue el defecto que la trajo acá. */}
                    <div className="flex justify-end min-w-0">
                        <FilterBar acciones={acciones}>
                            {salas.length > 1 && (
                                <FilterBar.Section active={!!sala} label="sucursal">
                                    <FilterBar.Sucursal value={sala} onChange={setSala}
                                        options={opcionesDeSala} />
                                </FilterBar.Section>
                            )}
                        </FilterBar>
                    </div>
                </div>

                {!sala && (
                    <EmptyState compact icon={Wallet}
                        title={salas.length ? 'Elige una sala'
                            : alcance !== 'ALL' ? 'Tu ficha no está en una sala'
                                : 'Sin salas con caja'}
                        subtitle={salas.length
                            ? 'Tu ficha no está en una sala con caja: elige arriba cuál quieres mirar.'
                            /* Con alcance de una sola sala y sin sala en la ficha no hay
                               NADA que ofrecer, y decir «todavía no se ha visto ninguna
                               caja abierta» manda a mirar la caja cuando lo que falta es
                               la ficha. Son dos vacíos distintos y se leían igual. */
                            : alcance !== 'ALL'
                                ? 'Solo puedes operar la caja de tu sala, y tu ficha no tiene ninguna asignada. Pídeselo a Talento Humano.'
                                : 'Todavía no se ha visto ninguna caja abierta, así que no hay nada que mostrar.'} />
                )}

                {sala && cargando && <LoadingState label="Mirando la caja" />}

                {sala && !cargando && noSePudo && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        <span className="font-bold">No se pudo leer la caja de esta sala.</span>
                        <span className="block mt-0.5 font-normal">
                            {noSePudo} — no se sabe si está abierta, así que no se ofrece ninguna
                            acción: abrir una caja que ya está abierta la deja partida en dos.
                        </span>
                        <span className="block mt-2">
                            <Button variant="secondary" size="sm" onClick={cargar}>Volver a intentar</Button>
                        </span>
                    </Notice>
                )}

                {sala && !cargando && !noSePudo && (
                    <>
                        {pendientes.length > 0 && (
                            <Notice variant="warning" icon={Landmark}>
                                Al hacer el corte se anota <b>un solo vale de caja</b> con estas {pendientes.length} salidas.
                                Salieron de una bolsa del día que la caja tiene abierto, así que sigue
                                esperando ese dinero.
                            </Notice>
                        )}

                        <PanelDelDia estado={estado} ventas={ventas} veLosMontos={veLosMontos}
                            entregas={entregasDelDia} personas={firmantes} />

                        {/* Lo que la caja todavía cuenta como suyo de esta sala.
                            Estaba en Bolsas, arriba de todo, y se quitó de ahí:
                            no pide ninguna acción —el corte desde el portal
                            escribe el vale solo— y con forma de aviso se leía
                            como un faltante. Acá está pegado al corte, que es
                            el único momento en que alguien lo necesita: cuando
                            el corte se va a hacer en la pantalla de la caja y
                            no por el portal. Ver el encabezado de
                            `ValesDeCaja`, donde vive el porqué completo. */}
                        <ValesDeCaja sala={sala} />

                        <MovimientosDelDia movimientos={movimientos} deBolsas={deBolsas}
                            cobros={cobros}
                            dia={estado?.dia} tipos={tipos} puedeOperar={puedeOperar}
                            puedeVerBolsas={puedeVerBolsas} onCorregir={setCorrigiendo}
                            anotaron={anotaron} cortes={cortesDelDia} />

                        {!puedeOperar && (
                            <Notice variant="info" icon={Lock}>
                                Puedes ver el estado de la caja, pero no operarla desde el portal.
                            </Notice>
                        )}
                    </>
                )}
        </div>
    );

    const todo = (
        <>
            {cuerpo}

            <DialogoAbrir abierto={dialogo === 'abrir'} ocupado={ocupado}
                onClose={() => setDialogo(null)}
                onAbrir={(monto) => correr(() => abrirCaja({ sala, montoApertura: monto }), 'La caja quedó abierta.')} />

            {/* `key` y no un efecto que limpie al cerrar: el diálogo se
                REMONTA en cada apertura, así que empieza vacío por
                construcción. Sin esto, abrir «Salida» después de una entrada
                llegaba con el tipo de la entrada elegido — y los tipos de los
                dos sentidos no son los mismos, así que el desplegable mostraba
                un código que su propia lista no tiene. */}
            {dialogo === 'abono' && (
                <Suspense fallback={null}>
                    <DialogoAbono abierto ocupado={ocupado} sala={sala}
                        onClose={() => setDialogo(null)}
                        onGuardar={async (datos) => {
                            setOcupado(true);
                            const r = await anotarAbono({
                                sala, monto: datos.monto,
                                clienteNombre: datos.cliente_nombre,
                                clienteTelefono: datos.cliente_telefono,
                                renglones: datos.renglones, total: datos.total,
                                venceEl: datos.vence_el,
                            });
                            setOcupado(false);
                            if (r.error) { showToast('No se pudo anotar el abono', mensajeAmigable(r.error), 'error'); return; }
                            setDialogo(null);
                            cargar();
                            showToast(`Abono anotado · ${r.abono?.folio || ''}`,
                                'El comprobante va a la impresora.', 'success');
                            /* El papel sale como parte del acto, igual que el
                             * comprobante del corte. Y se arma con la fila QUE
                             * QUEDÓ ESCRITA —con su folio y su vencimiento—, no
                             * con lo que el formulario creía estar mandando: si
                             * los dos difieren, el papel dice lo que dice la
                             * base. Un fallo de impresión no deshace el abono. */
                            if (r.abono) await imprimirAbono(r.abono);
                        }} />
                </Suspense>
            )}

            {/* Sólo la ENTRADA. La salida se mudó a `SalidaDeBolsa`, que hoy es
                el único diálogo de salida: tenía el catálogo completo, la
                lectura de la boleta y la identidad por carné, y con el origen
                decidiéndose por el monto dos formularios eran dos respuestas a
                la misma pregunta. Los dos motivos que sólo existían acá
                —bonificación y devolución— se mudaron a `bolsas_tipos_salida`
                con la migración `20260902174000`.

                El componente sigue sabiendo dibujar una salida (`entra=false`);
                esa mitad queda para borrar en una pasada aparte, junto con el
                `identifica_receptor` de `caja_tipos_movimiento`. */}
            <DialogoMovimiento key={dialogo} abierto={dialogo === 'ingreso'}
                entra ocupado={ocupado} sala={sala} userId={user?.id}
                tipos={tiposDeCaja}
                onComprobante={() => setDialogo('abono')}
                onClose={() => setDialogo(null)}
                onAnotar={async (datos, tipoElegido, identificada) => {
                    const r = await correr(
                        () => anotarIngreso({ sala, ...datos }),
                        'Ingreso anotado.',
                    );
                    // El papel se arma con la fila que devolvió el servidor —con
                    // su número y su fecha—, no con lo que el formulario mandó.
                    if (r?.movimiento) {
                        await imprimirMovimiento(r.movimiento, tipoElegido, {
                            detalle: datos.detalle,
                            persona: identificada?.name || datos.recibe || datos.vendedor || '',
                            // Sale de la FILA, que lo trae del vale consumido:
                            // el navegador no decide cómo se comprobó.
                            comoSeComprobo: r.movimiento.recibido_metodo || null,
                        });
                    }
                }} />

            <DialogoCorte abierto={dialogo === 'corte'} ocupado={ocupado} resultado={resultado}
                pendientes={pendientes.length} onImprimir={imprimirCorte}
                yaEmbolsado={yaEmbolsado} bolsasDeHoy={bolsasDeHoy.length}
                resolviendo={ocupadoId != null}
                onResolver={async (estado, motivo) => {
                    /* La fila del corte llega por el sync, que corre después:
                     * se busca por el número que devolvió el sistema de la caja.
                     * Si todavía no está, se dice — y se resuelve desde Cortes,
                     * que es donde va a aparecer. */
                    const delDia = await fetchCortes({ desde: estado_dia, hasta: estado_dia });
                    const mio = (delDia || []).find(
                        (c) => String(c.erp_corte_id) === String(resultado?.id_corte),
                    );
                    if (!mio) {
                        showToast('Todavía no aparece el corte',
                            'Se registró en la caja y llega al portal en unos minutos. '
                            + 'Confírmalo desde Cortes.', 'warning');
                        return;
                    }
                    if (!await resolver(mio, estado, { motivo })) return;
                    /* ── El papel sale al CONFIRMAR, no al cortar ──────────
                     *
                     * Pedido del usuario (2-sep): «si se confirma debería
                     * imprimirse el corte de caja y el de bolsa de efectivo. Si
                     * se descarta ninguno de los dos, para ahorrar papel».
                     *
                     * Hasta acá el comprobante salía apenas se hacía el corte,
                     * o sea ANTES de que existiera la decisión — así que cada
                     * conteo descartado ya había gastado su papel. Medido sobre
                     * los 7 días anteriores: 170 cortes, **91 descartados**. Más
                     * de la mitad del papel se tiraba, y la tasa es estable
                     * (43%–60% todos los días), no es de la semana de arranque.
                     *
                     * La etiqueta de la bolsa ya salía acá: la manda `resolver`
                     * —o sea `useResolverCorte`— justo arriba, para las cuatro
                     * pantallas que confirman. Este es el otro papel del acto.
                     *
                     * Se imprime DESPUÉS de que la confirmación quedó guardada,
                     * no antes: un papel de un corte que no se pudo firmar es
                     * exactamente el desperdicio que esto viene a cortar. Y un
                     * fallo de impresión NO deshace nada —el corte ya está
                     * firmado—: `imprimirCorte` avisa y el botón «Imprimir» del
                     * diálogo lo repite.
                     *
                     * El caso que el botón sigue cubriendo: cuando el corte
                     * todavía no llegó al portal, arriba se sale por `return` y
                     * la confirmación se hace desde Cortes — ahí este papel no
                     * sale solo, y se manda a mano desde acá. */
                    if (estado === 'CONFIRMADO' && resultado?.ok) await imprimirCorte(resultado);
                    /* Confirmar CIERRA EL TURNO (regla del usuario, 1-sep): «al
                     * hacer un corte y confirmarlo deben abrir caja de nuevo la
                     * persona responsable». El corte cuenta lo que hay; cerrar
                     * el turno es lo que hace que ese conteo sea de alguien —
                     * sin eso, el tramo siguiente se le sigue cargando a quien
                     * ya entregó.
                     *
                     * Descartar NO cierra: un conteo que no se firmó no termina
                     * el turno de nadie.
                     *
                     * Y esto NO es el cierre del día: el Z es otro acto. */
                    if (estado === 'CONFIRMADO') {
                        const c = await cerrarTurno(sala);
                        if (c?.error) {
                            showToast('El corte quedó confirmado',
                                'Pero el turno sigue abierto: ' + mensajeAmigable(c.error), 'warning');
                        } else {
                            showToast('Turno cerrado',
                                'Quien siga vendiendo tiene que abrir la caja con su carné.', 'success');
                        }
                    }
                    setDialogo(null); setResultado(null); cargar();
                }}
                onClose={() => { setDialogo(null); setResultado(null); }}
                onCortar={async (efectivo) => {
                    setOcupado(true);
                    const bruto = await hacerCorte({ sala, efectivo });
                    setOcupado(false);
                    if (bruto.error) { showToast('No se pudo hacer el corte', mensajeAmigable(bruto.error), 'error'); return; }
                    const r = conLaCuentaBuena(bruto);
                    setResultado(r);
                    cargar();
                    /* ── ACÁ NO SE IMPRIME NADA ────────────────────────────
                     *
                     * El papel del corte salía justo acá, apenas hecho el corte
                     * — o sea antes de que existiera la decisión, así que un
                     * conteo descartado ya se había gastado su papel. Se movió
                     * a `onResolver`, donde se firma; el porqué y la medición
                     * están ahí. El comprobante existe igual y se puede mandar
                     * cuando se quiera con el botón «Imprimir» del diálogo. */
                }} />

            {dialogo === 'salida' && (
                <Suspense fallback={null}>
                    {/* El ÚNICO diálogo de salida. El origen —cajón o bolsa— lo
                        decide el monto adentro: la prioridad es la caja, y las
                        bolsas son el segundo camino (regla del usuario, 2-sep).

                        `efectivoEnCaja` lo calcula el SERVIDOR y no esta
                        pantalla: «Monto Registrado» del origen incluye las
                        ventas que no fueron en efectivo y lo que ya se embolsó
                        hoy, y la corrección necesita leer `sales_invoices` sin
                        depender del permiso de quien mira. Ver
                        `efectivoEnElCajon` en `operar-caja`. */}
                    <SalidaDeBolsa abierto bolsas={bolsas} saldos={null}
                        sala={sala} efectivoEnCaja={estado?.efectivo ?? null}
                        onSalidaDeCaja={anotarSalidaDelCajon}
                        onClose={() => setDialogo(null)}
                        onHecho={trasLaSalidaDeBolsa} />
                </Suspense>
            )}

            <DialogoCorregir movimiento={corrigiendo} ocupado={ocupado}
                onClose={() => setCorrigiendo(null)}
                onPedir={(que, motivo, montoNuevo) => correr(
                    () => pedirCorreccion({ sala, movimiento: corrigiendo.id, que, motivo, montoNuevo }),
                    'Queda pedido. Alguien tiene que aprobarlo.',
                ).then(() => setCorrigiendo(null))} />

            {dialogo === 'cerrar' && (
                <DialogoCerrar ocupado={ocupado} sinCorte={sinCorteHoy} sinConfirmar={corteSinConfirmar}
                    onClose={() => setDialogo(null)}
                    /* El Z se COMPRUEBA y su respuesta se dice. `z: false` llega
                       como `aviso`, que `correr` ahora muestra. */
                    onCerrar={() => correr(() => cerrarElDia(sala), 'El día quedó cerrado.')} />
            )}

            {/* «¿Quién recibe la caja?» al confirmar un corte. Va dentro de
                `todo` para que aparezca también cuando Efectivo se pinta como
                PESTAÑA de otra vista: colgado del `GlassViewLayout` de abajo,
                ese camino se quedaría sin diálogo y la confirmación esperaría
                para siempre. Ver `useResolverCorte`. */}
            {dialogoDeEntrega}
        </>
    );

    if (comoPestana) return todo;
    return (
        <GlassViewLayout icon={Wallet} title={`Mi caja${nombreSala ? ` · ${nombreSala}` : ''}`}>
            {todo}
        </GlassViewLayout>
    );
}

/**
 * `2026-08-30` → `sáb 30 ago`.
 *
 * El mediodía y `timeZone: 'UTC'` no son adorno: una fecha sin hora se lee como
 * medianoche UTC y en San Salvador eso es el día ANTERIOR, así que el rótulo
 * mostraría un día que no es. Es el mismo idioma que ya usan Cortes y las
 * bitácoras.
 */
const fechaLegible = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
        weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
    })
    : '');

/* La hora de un movimiento, en el huso de la SALA y no en el del navegador.
 * `registrado_at` es un instante con zona; leído en local, alguien mirando desde
 * otro huso vería la remesa de las 12:59 a otra hora y no tendría cómo saberlo. */
const horaLegible = (cuando) => (cuando
    ? new Date(cuando).toLocaleTimeString('es-SV', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'America/El_Salvador',
    })
    : '');

/* Para buscar: sin tildes y en minúsculas de los dos lados. Quien escribe
 * «aplicacion» tiene que encontrar «Aplicación», y el papel imprime todo en
 * mayúsculas. */
const plano = (t) => String(t ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Sale del dato, no de una lista escrita a mano: `efectivo` → `Efectivo`. */
const conMayuscula = (t) => {
    const s = String(t || '').trim();
    return s ? s[0].toUpperCase() + s.slice(1) : '—';
};

/**
 * El día de esta caja, en una tarjeta: qué caja es, desde cuándo, quién la
 * abrió, con cuánto, y qué se ha vendido — **por todas las formas de pago**.
 *
 * Las formas importan y no son un adorno: el comprobante de la caja lista al
 * pie sólo tarjeta y crédito, así que una transferencia o un cheque quedan
 * sumados dentro del «efectivo» y nadie los ve por separado. La cifra sale de
 * las facturas del portal, que es la fuente independiente del papel.
 *
 * NO dice cuánto DEBERÍA haber en el cajón — eso es el conteo a ciegas del
 * corte y se decide arriba, en el diálogo. Acá está lo vendido, que es otra
 * cosa: quien cuenta billetes no puede derivar el esperado de esto sin sumarle
 * la apertura y restarle los vales, y ése es justo el trabajo que hace el corte.
 */
function PanelDelDia({ estado, ventas, veLosMontos = true, entregas, personas }) {
    /* La caja CERRADA no borra la entrega. El panel existía sólo mientras
     * hubiera turno abierto —sin turno no hay ventas que desglosar—, y colgarle
     * la cadena de manos con esa misma guarda la habría hecho desaparecer justo
     * al final del día, que es cuando alguien pregunta con quién quedó. */
    const hayEntrega = (entregas || []).length > 0;
    if (!estado?.abierta && !hayEntrega) return null;

    const filas = [...(ventas || [])]
        .map((v) => ({ tipo: String(v.tipo_pago), docs: Number(v.documentos || 0), total: Number(v.total || 0) }))
        .sort((a, b) => b.total - a.total);
    const total = filas.reduce((s, f) => s + f.total, 0);
    const efectivo = filas.find((f) => f.tipo.toLowerCase() === 'efectivo')?.total ?? 0;

    /* La fila de «Caja · Abierta desde · La abrió · Monto de apertura» se fue de
     * acá: decía LO MISMO que las tarjetas de arriba, tres centímetros más
     * abajo y con el nombre completo en mayúsculas. Lo único que no repetía era
     * el monto de apertura, que va ahora al pie del desglose — es parte de la
     * cuenta del día, no del encabezado. */
    return (
        <div data-surface="card" className="rounded-2xl p-4 md:p-5 space-y-4">
            {/* Por qué manos pasó la caja. Va de ENCABEZADO y no en una tarjeta
                propia: una caja de ancho completo para una línea de contenido
                deja ~1400px vacíos en un monitor de 1900 («espacios
                desperdiciados», usuario 3-sep). Acá comparte borde y relleno
                con el dinero del turno, que es de lo que habla. */}
            {hayEntrega && (
                <div className="pb-3 border-b border-border-card">
                    <EntregaDelTurno entregas={entregas} personas={personas} />
                </div>
            )}

            {estado?.abierta && (
            <div className="space-y-2">
                <h3 className="text-caption font-black uppercase tracking-widest text-content-2">
                    Vendido hoy, por forma de pago
                </h3>
                {filas.length === 0 ? (
                    /* Cero ventas y «no pude leerlas» se ven igual si no se dice
                       cuál es: acá es cero de verdad sólo si la caja acaba de
                       abrir, así que se nombra el caso en vez de mostrar nada. */
                    <p className="text-body-sm text-content-3">
                        Todavía no hay ninguna venta registrada en este día.
                    </p>
                ) : (
                    <>
                        {/* Las formas de pago SIN monto cuando no se pueden ver.
                            Se quedan porque dicen algo que no es la respuesta:
                            cuántas ventas hubo de cada forma, que sirve para
                            saber si el día fue de tarjeta o de efectivo sin
                            decir cuánto. */}
                        <ul className="divide-y divide-border/60">
                            {filas.map((f) => (
                                <li key={f.tipo} className="flex items-baseline justify-between gap-3 py-1.5">
                                    <span className="text-body-sm text-content">
                                        {conMayuscula(f.tipo)}
                                    </span>
                                    <span className="tabular-nums font-semibold text-content">
                                        {veLosMontos
                                            ? formatMoney(f.total)
                                            : `${f.docs} venta${f.docs === 1 ? '' : 's'}`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {veLosMontos ? (
                            <>
                                <div className="flex items-baseline justify-between gap-3 pt-1">
                                    <span className="text-body-sm font-bold text-content">Total vendido</span>
                                    <span className="tabular-nums font-black text-content">{formatMoney(total)}</span>
                                </div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="text-body-sm text-content-2">De eso, en efectivo</span>
                                    <span className="tabular-nums font-bold text-brand-text">{formatMoney(efectivo)}</span>
                                </div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="text-body-sm text-content-2">Con lo que abrió la caja</span>
                                    <span className="tabular-nums text-content-2">
                                        {estado.apertura != null ? formatMoney(estado.apertura) : '—'}
                                    </span>
                                </div>
                            </>
                        ) : (
                            /* Se DICE por qué no está, en vez de dejar el hueco.
                               Un total que desaparece sin explicación se lee como
                               que la pantalla falló, y el primero que lo vea va a
                               reportarlo como defecto. */
                            <p className="text-caption text-content-3 pt-1">
                                Los montos no se muestran antes del corte: el conteo se hace contando,
                                y verlos de antemano sería copiarlos.
                            </p>
                        )}
                    </>
                )}
            </div>
            )}
        </div>
    );
}


/**
 * Todo lo que movió efectivo en este día de caja, en UNA lista.
 *
 * Son dos orígenes y hasta hoy se veía uno solo: lo que entra y sale del CAJÓN,
 * y lo que sale de una BOLSA. Una remesa de $500 pagada con la bolsa de
 * anteayer no aparecía en ninguna pantalla del turno, aunque el dinero salió de
 * la sala igual.
 *
 * Y la diferencia entre los dos no es decorativa, así que cada línea la dice:
 * una bolsa **del día que la caja tiene abierto** se convierte en vale al
 * cortar —ese dinero la caja todavía lo espera—; una de un **corte anterior**
 * no toca la caja, porque su propio cierre ya lo descontó. Es la regla que
 * decide si el corte de esta tarde cuadra o falta.
 */
function MovimientosDelDia({ movimientos, deBolsas, cobros, dia, tipos, puedeOperar, puedeVerBolsas,
    onCorregir, anotaron, cortes }) {
    const etiquetaDe = (codigo) =>
        tipos?.find((t) => t.codigo === codigo)?.etiqueta || conMayuscula(codigo);

    /* ── El comprobante se ve ACÁ, y se firma al apretar ────────────────────
     *
     * La URL guardada es un identificador, no algo que se pueda pintar:
     * `payment-proofs` es un bucket privado. Se firma al apretar y no al cargar
     * la lista — un día puede tener veinte movimientos, y pedir veinte enlaces
     * firmados por si acaso es pedir veinte que nadie va a mirar. Es el mismo
     * camino que `DetalleDeBolsa`. */
    const [foto, setFoto] = useState(null);      // { clave, url } | { clave, error }
    const [firmando, setFirmando] = useState(null);
    const [ampliada, setAmpliada] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const verComprobante = useCallback(async (clave, url) => {
        if (foto?.clave === clave) { setFoto(null); return; }
        setFirmando(clave);
        try {
            const firmada = await getSignedFileUrl(url);
            setFoto(firmada ? { clave, url: firmada } : { clave, error: true });
        } catch {
            setFoto({ clave, error: true });
        }
        setFirmando(null);
    }, [foto]);

    const lineas = useMemo(() => {
        const delCajon = (movimientos || []).map((m) => ({
            clave: `caja-${m.id}`,
            cuando: m.registrado_at,
            /* El COMPLETO cuando lo hay. `concepto` es lo que le cupo al
             * sistema de la caja —50 caracteres— y por eso la remesa de $50 de
             * Salud 4 se leía «… · MONEYGRAM · PAGO D». Las filas anteriores al
             * 2026-09-02 no tienen el completo y caen al recortado, que es todo
             * lo que se guardó de ellas. */
            titulo: m.detalle || m.concepto,
            entra: m.tipo === 'ENTRADA',
            monto: Number(m.monto || 0),
            anulado: !!m.anulado_at,
            origen: 'De la caja',
            detalle: [
                m.numero_boleta ? `boleta ${m.numero_boleta}` : null,
                m.erp_movimiento_id ? null : 'sin llegar a la caja',
            ].filter(Boolean),
            quien: m.registrado_por,
            foto: m.foto_url || null,
            movimiento: m,
        }));
        const deLasBolsas = (deBolsas || []).map((o) => {
            const total = Math.abs(Number(o.monto || 0));
            const deHoy = Number(o.montoDeHoy || 0);
            return {
                clave: `bolsa-${o.id}`,
                cuando: o.registrado_at,
                titulo: `${etiquetaDe(o.tipo)}${o.entidad ? ` · ${o.entidad}` : ''}`,
                entra: false,
                monto: total,
                anulado: !!o.anulada_at,
                origen: 'De una bolsa',
                avisa: o.tocaLaCaja,
                detalle: [o.folio, o.numero_boleta ? `boleta ${o.numero_boleta}` : null].filter(Boolean),
                quien: o.registrado_por,
                foto: o.foto_url || null,
                /* El DESGLOSE, no una frase.
                 *
                 * Una salida grande se reparte entre las bolsas que alcancen, y
                 * de días distintos: la remesa REM-1058 son $500 en tres bolsas
                 * —$119.38 de hoy y $380.62 de dos del 31-ago— y sólo la primera
                 * parte toca el corte que viene. Escrito como frase única, la
                 * pantalla tenía que elegir UNA de las dos verdades y decía «de
                 * una bolsa de hoy» sobre los $500 enteros. Bolsa por bolsa no
                 * hay que elegir. */
                reparto: o.bolsasUsadas || [],
                afectaElCorte: deHoy,
                parcial: deHoy > 0.005 && deHoy < total - 0.005,
            };
        });
        /* ── Los cobros de crédito ─────────────────────────────────────────
         *
         * Son la tercera fuente, y hasta hoy no se veían por ningún lado. El
         * dinero de un cobro en efectivo entra a ESTE cajón —el corte lo va a
         * pedir en billetes, y por eso `cortes_caja.cobros_portal_efectivo` se
         * lo suma al esperado— así que su sitio es esta lista y no otra
         * pantalla.
         *
         * Lo que el sistema de la caja anota de un cobro es un renglón que dice
         * `POR ABONO A CREDITO` y nada más: sin cliente, sin crédito y sin
         * quién cobró. Acá van los tres, que es lo que convierte «entró plata»
         * en «se le cobró a fulana el crédito 2288».
         *
         * ⚠️ **El que no es efectivo NO toca el cajón** y por eso lleva
         * `sinEfectivo`: sale en la lista —se hizo, y hay que poder verlo— pero
         * fuera de la suma del tramo. Sumado, inventaría un sobrante del
         * tamaño de la transferencia. */
        const deCreditos = (cobros || []).map((c) => {
            const efvo = cobroEnEfectivo(c);
            return {
                clave: `cobro-${c.id}`,
                cuando: c.created_at,
                titulo: `Cobro de crédito · ${c.cliente || 'Sin nombre'}`,
                entra: true,
                monto: Number(c.monto || 0),
                anulado: !!c.anulado_at,
                origen: 'Cobro de un crédito',
                sinEfectivo: !efvo,
                detalle: [
                    `crédito ${c.credito_erp}`,
                    efvo ? 'en efectivo' : `${String(c.forma || 'otra forma').toLowerCase()} · no entra al cajón`,
                    c.documento ? `documento ${c.documento}` : null,
                    Number(c.saldo_despues) > 0.004
                        ? `queda debiendo ${formatMoney(c.saldo_despues)}`
                        : 'crédito saldado',
                ].filter(Boolean),
                quien: c.abonado_por,
                foto: c.comprobante_url || null,
            };
        });

        return [...delCajon, ...deLasBolsas, ...deCreditos]
            .sort((a, b) => String(b.cuando || '').localeCompare(String(a.cuando || '')));
    }, [movimientos, deBolsas, cobros, tipos]); // eslint-disable-line react-hooks/exhaustive-deps -- `etiquetaDe` sale de `tipos`

    /* ── El buscador ───────────────────────────────────────────────────────
     *
     * Pedido del usuario (2026-09-02), junto con el de que la boleta llene el
     * concepto: «así cualquier cosa podemos buscar».
     *
     * Busca en TODO lo que identifica un movimiento —el concepto, la boleta, el
     * folio de la operación, quién lo anotó y el monto— y no sólo en el título:
     * el dato con el que alguien vuelve a encontrar un pago suele ser el número
     * de teléfono o la boleta, que viven en el concepto y en el detalle, no en
     * un campo aparte.
     *
     * Sin tildes y sin mayúsculas de los dos lados: quien escribe «aplicacion»
     * tiene que encontrar «Aplicación», y en el papel todo viene en mayúsculas.
     *
     * Filtra ANTES de repartir por corte, no después: si un grupo se queda sin
     * resultados no tiene que aparecer vacío — `repartirPorCorte` ya saca los
     * grupos sin líneas. */
    const filtradas = useMemo(() => {
        const q = plano(busqueda);
        if (!q) return lineas;
        return lineas.filter((l) => plano([
            l.titulo,
            l.origen,
            ...(l.detalle || []),
            anotaron?.get(l.quien)?.name,
            // El monto se busca como se lee: «300» encuentra −$300.00.
            l.monto?.toFixed?.(2),
        ].filter(Boolean).join(' ')).includes(q));
    }, [lineas, busqueda, anotaron]);

    /* Repartidos por corte: qué ya contó un corte firmado y qué sigue
     * pendiente. La regla vive en `repartirPorCorte` y no acá — usa el mismo
     * criterio que `conTramo` para decidir qué corte corre la línea, y escrita
     * dos veces el día que cambie una, la pantalla diría «ya registrado» sobre
     * algo que la diferencia todavía va a medir. */
    const grupos = useMemo(() => repartirPorCorte(filtradas, cortes), [filtradas, cortes]);

    if (!lineas.length && puedeVerBolsas) return null;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-caption font-black uppercase tracking-widest text-content-2">
                    Movimientos de este día{dia ? ` · ${fechaLegible(dia)}` : ''}
                </h3>
                {/* Sale sólo cuando hay algo que filtrar: un buscador sobre dos
                    movimientos es un control que estorba. */}
                {lineas.length > 2 && (
                    <SearchInput value={busqueda} onChange={setBusqueda} size="sm"
                        className="w-full sm:w-64"
                        placeholder="Buscar por concepto, boleta, quién o monto"
                        ariaLabel="Buscar en los movimientos de este día" />
                )}
            </div>

            {/* Sin el permiso del otro módulo la lista sale incompleta y sin
                error: la policy devuelve cero filas. Decirlo es la diferencia
                entre «no hubo ninguna» y «no las puedo ver». */}
            {!puedeVerBolsas && (
                <Notice variant="info" icon={ShoppingBag}>
                    Aquí sólo ves lo que entró y salió de la caja. Las salidas pagadas con una bolsa
                    de efectivo necesitan el permiso de Bolsas.
                </Notice>
            )}

            {lineas.length === 0 && (
                <p className="text-body-sm text-content-3">Todavía no se ha movido efectivo en este día.</p>
            )}

            {/* Una lista vacía por el filtro se lee igual que un día sin
                movimientos, y no es lo mismo: acá sí hubo, sólo que ninguno
                coincide. */}
            {lineas.length > 0 && filtradas.length === 0 && (
                <p className="text-body-sm text-content-3">
                    Ningún movimiento de este día coincide con «{busqueda.trim()}».
                </p>
            )}

            {grupos.map((g) => (
                <div key={g.corte?.id ?? 'sin-cortar'} className="space-y-2">
                    {/* ── El encabezado del tramo ────────────────────────────
                        El de arriba es el que importa: es lo que el próximo
                        corte va a medir, y por eso lleva su suma. Los de abajo
                        ya los contó un corte firmado, y ahí lo que hace falta
                        es sólo saber cuál. */}
                    <div className={`flex items-baseline justify-between gap-3 flex-wrap
                                     pt-1 ${g.corte ? '' : 'border-b border-divider pb-1.5'}`}>
                        <span className="text-caption font-bold text-content-2">
                            {!g.corte
                                ? 'Sin cortar todavía'
                                : g.corte.tipo === 'Z'
                                    ? `Después del cierre del día · ${g.corte.hora}`
                                    : `Ya contados en el corte de las ${g.corte.hora}`}
                            {/* Y a quién se le entregó la caja al confirmarlo,
                                que es el otro nombre del mismo acto: el corte
                                cierra el turno. Acá cabe el nombre COMPLETO —la
                                tarjeta del carril lo tiene que acortar— y es
                                donde queda pegado a lo que ese corte contó. */}
                            {g.corte?.recibe && (
                                <span className="font-normal text-content-3">
                                    {` · la recibió ${g.corte.recibe}`}
                                </span>
                            )}
                            {g.corte?.entrega === 'SIN_ENTREGA' && (
                                <span className="font-normal text-warning-text">
                                    {' · se confirmó sin entregar la caja'}
                                </span>
                            )}
                        </span>
                        <span className="text-caption text-content-3 tabular-nums">
                            {g.lineas.length}{g.lineas.length === 1 ? ' movimiento' : ' movimientos'}
                            {/* `sinEfectivo` fuera de la suma: es lo que se cobró
                                con tarjeta o transferencia, y ese dinero no está
                                en el cajón que el corte va a contar. */}
                            {!g.corte && ` · ${conSigno(g.lineas.reduce(
                                (t, l) => t + ((l.anulado || l.sinEfectivo) ? 0
                                    : (l.entra ? l.monto : -l.monto)), 0,
                            ))}`}
                        </span>
                    </div>

                    {g.lineas.map((l) => (
                <div key={l.clave} data-surface="card" className="rounded-xl px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <p className={`text-body-sm font-semibold ${l.anulado ? 'text-content-3 line-through' : 'text-content'}`}>
                                {l.titulo}
                            </p>
                            {/* La HORA primero. Es lo que se busca al reclamar
                                un movimiento —«¿cuál de las tres remesas?»— y
                                el dato viajaba desde siempre: se usaba sólo
                                para ordenar la lista y no se pintaba. */}
                            <p className="text-caption text-content-3">
                                <span className="tabular-nums">{horaLegible(l.cuando)}</span>
                                {` · ${l.origen}`}{l.detalle.length ? ` · ${l.detalle.join(' · ')}` : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            {/* Apagado cuando no toca el cajón: en verde y con
                                el resto de las entradas, un cobro con tarjeta se
                                lee como billetes que hay que tener. */}
                            <span className={`tabular-nums font-bold ${
                                l.sinEfectivo ? 'text-content-3'
                                    : l.entra ? 'text-success-text' : 'text-warning-text'}`}>
                                {l.entra ? '' : '−'}{formatMoney(l.monto)}
                            </span>
                            {puedeOperar && l.movimiento && !l.anulado && (
                                <Button variant="ghost" size="sm" onClick={() => onCorregir(l.movimiento)}>
                                    Corregir
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* ── Quién lo anotó, y su comprobante ──────────────────
                        Un movimiento de dinero sin autor no se puede reclamar,
                        y sin la boleta no se puede comprobar. Los dos datos
                        estaban guardados y ninguno se pintaba: la remesa de $50
                        de Salud 4 se veía como una línea suelta sin hora, sin
                        nombre y sin foto. Es el mismo bloque de firma que
                        llevan las tarjetas de corte y de bolsa. */}
                    {(l.quien || l.foto) && (
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            {l.quien && anotaron?.get(l.quien) ? (
                                <span className="flex items-center gap-1.5 min-w-0">
                                    <AvatarConEstado emp={anotaron.get(l.quien)} px={20}
                                        radio="rounded-full" marco="" />
                                    <span className="text-caption text-content-3 truncate">
                                        Lo anotó {anotaron.get(l.quien).name}
                                    </span>
                                </span>
                            ) : <span />}
                            {l.foto && (
                                <Button variant="ghost" size="sm" icon={Paperclip}
                                    loading={firmando === l.clave}
                                    onClick={() => verComprobante(l.clave, l.foto)}>
                                    {foto?.clave === l.clave ? 'Ocultar' : 'Ver boleta'}
                                </Button>
                            )}
                        </div>
                    )}

                    {/* La foto, adentro de la lista y no en otra pestaña: quien
                        la mira está comparándola contra el monto de al lado.
                        Ampliarla es un clic más, con el canónico de siempre. */}
                    {foto?.clave === l.clave && (
                        foto.error ? (
                            <p className="text-caption text-danger-text">
                                No se pudo abrir la boleta. Vuelve a intentarlo.
                            </p>
                        ) : (
                            <button type="button" onClick={() => setAmpliada(foto.url)}
                                aria-label={`Ampliar la boleta de ${l.titulo}`}
                                className="block w-full rounded-lg overflow-hidden
                                           min-h-[var(--tap-min)] active:scale-[0.99]">
                                <img src={foto.url} alt={`Boleta de ${l.titulo}`}
                                    className="w-full max-h-64 object-contain bg-surface-input/40" />
                            </button>
                        )
                    )}

                    {/* De qué bolsa salió cada parte. Una fila por bolsa, con lo
                        que aporta y si toca el corte. Es lo que la frase no podía
                        decir sin elegir una de las dos verdades. */}
                    {(l.reparto || []).length > 0 && (
                        <div className="rounded-lg bg-surface-input/40 px-3 py-2 space-y-1">
                            {l.reparto.map((b) => (
                                <div key={b.folio} className="flex items-baseline justify-between gap-3 text-caption">
                                    <span className="text-content-2 min-w-0 truncate">
                                        {b.folio}
                                        <span className="text-content-3"> · {fechaLegible(b.fecha)}</span>
                                    </span>
                                    <span className="flex items-baseline gap-2 shrink-0">
                                        <span className="tabular-nums text-content-2">{formatMoney(b.monto)}</span>
                                        <span className={b.deHoy ? 'text-warning-text font-semibold' : 'text-content-3'}>
                                            {b.deHoy ? 'entra al corte' : 'ya cerrada'}
                                        </span>
                                    </span>
                                </div>
                            ))}
                            {/* La suma sólo cuando hay más de una bolsa: con una
                                sola repetiría el monto de arriba. */}
                            {l.reparto.length > 1 && (
                                <div className="flex items-baseline justify-between gap-3 pt-1 border-t border-border/60
                                                text-caption font-bold">
                                    <span className="text-content">Afecta el corte de hoy</span>
                                    <span className={`tabular-nums ${l.afectaElCorte > 0 ? 'text-warning-text' : 'text-content-3'}`}>
                                        {l.afectaElCorte > 0 ? formatMoney(l.afectaElCorte) : 'nada'}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                    </div>
                    ))}
                </div>
            ))}

            {/* A pantalla completa. `PhotoLightbox` es el canónico — el mismo
                que usa el detalle de una bolsa para la misma foto. */}
            <PhotoLightbox src={ampliada} alt="Boleta del movimiento"
                onClose={() => setAmpliada(null)} />
        </div>
    );
}

/**
 * El marco de los diálogos de esta vista.
 *
 * ── EL PIE VA EN `pie`, NO ENTRE LOS HIJOS (2026-09-02) ────────────────────
 *
 * Reportado por el usuario sobre «Anotar un ingreso»: *«no me sale guardar ni
 * nada»*. La tarjeta llegaba hasta «La foto leyó mal: corregir a mano» y ahí se
 * terminaba — sin Cancelar y sin Anotar, o sea un formulario lleno que no se
 * puede enviar.
 *
 * `Marco` metía TODO —cabecera, campos y botones— en un solo `div`, saltándose
 * la anatomía de `LiquidModal`. La tarjeta tiene tope de alto (`max-h-[88dvh]`),
 * así que sin un cuerpo que scrollee lo que sobra se corta, y **lo primero que
 * se corta es lo último: el pie**. En un monitor alto no se nota; en el de la
 * sala, sí — y el tipo con foto obligatoria es justo el diálogo más largo.
 *
 * Es el MISMO defecto que `LiquidModal` documenta haber cerrado el 2026-08-15
 * («el pie —donde vive Confirmar— era lo primero en irse»), reaparecido porque
 * esta vista no usa `Header`/`Body`/`Footer`. Un canónico que se puede saltear
 * se saltea: la corrección es usarlo.
 */
function Marco({ abierto, onClose, titulo, bajada, pie, children }) {
    if (!abierto) return null;
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-sm" ariaLabel={titulo}>
            <LiquidModal.Header>
                <h3 className="text-h3 font-bold text-content">{titulo}</h3>
                {bajada && <p className="text-body-sm text-content-2 mt-1">{bajada}</p>}
            </LiquidModal.Header>
            <LiquidModal.Body className="space-y-4">{children}</LiquidModal.Body>
            {/* `justify-end` en escritorio: el pie canónico reparte con
                `justify-between`, y con dos botones eso los manda a las
                esquinas opuestas. Acá son «Cancelar» y la acción, que van
                juntos a la derecha. En táctil el canónico los apila y esta
                clase no interviene. */}
            {pie && <LiquidModal.Footer className="gap-2 md:justify-end">{pie}</LiquidModal.Footer>}
        </LiquidModal>
    );
}

function DialogoAbrir({ abierto, ocupado, onClose, onAbrir }) {
    const [monto, setMonto] = useState('');
    return (
        <Marco abierto={abierto} onClose={onClose} titulo="Abrir la caja"
            bajada="Con cuánto efectivo arranca la caja. Si arranca en cero, déjalo vacío."
            pie={<>
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado}
                    onClick={() => onAbrir(Number(monto || 0))}>Abrir</Button>
            </>}
        >
            {/* Texto y no `type="number"`: el campo numérico nativo no tiene
                separador decimal en el teléfono, y esto es dinero. */}
            <PortalInput label="Monto de apertura" inputMode="decimal" value={monto}
                onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
        </Marco>
    );
}

/**
 * Un movimiento del cajón: entra o sale. Un solo diálogo para los dos porque es
 * el mismo acto con el signo dado vuelta — y dos diálogos gemelos se separan el
 * día que alguien mejora uno.
 *
 * ── La foto manda sobre lo tecleado ────────────────────────────────────────
 * Si el papel es una boleta —el pago de un recibo, una remesa del POS—, la foto
 * llena el monto y el número. Es la misma lectura que usa la salida de bolsa, y
 * el criterio es el de allá: lo que dice el papel gana, porque el papel es la
 * verdad de la operación y un número tecleado encima sólo puede alejarse de él.
 */
/**
 * Anotar lo que entra o sale del cajón.
 *
 * ── La foto va PRIMERO, y lo que ella lea no se teclea ────────────────────
 * Hasta el 31-ago el cuadro pedía los tres datos y la foto era un adjunto más;
 * hoy es al revés, y lo pidió el usuario: **primero la foto**, y monto, número
 * y concepto se llenan solos con lo que diga el papel. Sólo queda abierto lo
 * que el lector NO pudo identificar.
 *
 * El motivo es el mismo que en la salida de una bolsa: cuando el dato existe
 * impreso, teclearlo sólo agrega una forma de equivocarse, y un monto tecleado
 * distinto del de la boleta no se descubre nunca — las dos cifras viven en
 * sitios distintos y nadie las enfrenta.
 *
 * ── Y hay una salida cuando el papel no se deja leer ──────────────────────
 * «Escribirlo a mano» tiene que seguir existiendo: una boleta arrugada, una
 * térmica borrada o una foto movida no pueden dejar a la sala sin poder anotar
 * lo que ya pasó. Por eso el candado es POR CAMPO —se cierra el que la foto
 * llenó, no el cuadro entero— y hay un botón para abrirlos todos.
 *
 * ── El código de vendedor ya no se pregunta ───────────────────────────────
 * Sale de quien está adentro, y lo resuelve el servidor con la sesión. Era el
 * único campo que pedía teclear algo que el portal ya sabe.
 */
function DialogoMovimiento({ abierto, entra, ocupado, sala, userId, tipos = [], onClose, onAnotar, onComprobante }) {
    /* QUÉ es, antes que cuánto.
     *
     * El diálogo empezaba pidiendo la foto de una boleta, y eso está bien para
     * el pago de un recibo — pero el ingreso más frecuente de todos es la
     * aplicación de una inyección, que no tiene boleta ninguna. Medido: ~600 en
     * 60 días, escritas de quince maneras distintas porque el concepto era un
     * campo de texto. Ahora el tipo se elige primero y **él decide qué se
     * pregunta**: si pide foto, si pide el número de la boleta, si pide a quién.
     *
     * El concepto no desaparece: pasa a ser el DETALLE del tipo. «Aplicación de
     * inyección» es lo que se suma; «Neurobion 25000» es lo que la sala quería
     * anotar. */
    const [codigo, setCodigo] = useState('');
    /* Quién se lleva el efectivo, COMPROBADO. `persona` y `vale` salen juntos
     * del servidor: el navegador no elige a quién se le atribuye el dinero, y
     * el secreto del carné nunca pasa por acá. */
    const [persona, setPersona] = useState(null);
    const [vale, setVale] = useState(null);
    // 'DATOS' → 'IDENTIDAD'. Son dos pantallas y no una porque el lector de
    // carné es un `keydown` global que NO cancela la tecla: con el formulario
    // dibujado, la ráfaga del carné se escribiría dentro del campo que tenga el
    // foco, a la vista. Mismo motivo que en la salida de una bolsa.
    const [paso, setPaso] = useState('DATOS');
    const [monto, setMonto] = useState('');
    const [concepto, setConcepto] = useState('');
    const [boleta, setBoleta] = useState('');
    // Sólo la salida sigue preguntándolo: «recibe» es quien se lleva el efectivo
    // y eso no está en ningún papel ni en la sesión — lo sabe quien lo entrega.
    const [recibe, setRecibe] = useState('');
    const [foto, setFoto] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [aviso, setAviso] = useState(null);
    // Qué llenó la foto. Esos campos quedan cerrados: el papel manda.
    const [deLaFoto, setDeLaFoto] = useState({});
    // La escotilla, cuando el papel no se deja leer o leyó mal.
    const [aMano, setAMano] = useState(false);

    const delSentido = useMemo(
        () => tipos.filter((t) => t.sentido === (entra ? 'ENTRADA' : 'SALIDA')),
        [tipos, entra],
    );
    const tipo = useMemo(() => delSentido.find((t) => t.codigo === codigo) || null,
        [delSentido, codigo]);

    // El detalle deja de ser obligatorio cuando el TIPO ya dice qué fue: exigir
    // que alguien escriba «aplicación» debajo de un desplegable que dice
    // «Aplicacion de inyeccion» es pedir el mismo dato dos veces.
    const exigeDetalle = !tipo || tipo.codigo.startsWith('OTRO');
    // Con identidad, el nombre NO se teclea: sale de quien quedó reconocido.
    const identifica = !!tipo?.identifica_receptor;
    const valido = !!tipo
        && Number(monto) > 0
        && (!exigeDetalle || concepto.trim().length > 2)
        && (!tipo.pide_boleta || boleta.trim().length > 0)
        && (tipo.foto !== 'OBLIGATORIA' || !!foto)
        && (!tipo.pide_persona || identifica || recibe.trim().length > 1);

    // La foto sólo manda la vuelta del cuadro cuando el tipo la pide. Con
    // `foto: 'NO'` —la aplicación, la glucosa— los campos salen directo: pedir
    // una boleta que no existe es lo que hacía que se escribiera a mano.
    const pedirDatos = tipo && (tipo.foto === 'NO' || !!foto || aMano);

    /* Un tipo con comprobante NO se llena acá: cambia de diálogo.
     *
     * El abono levanta un compromiso —cliente, productos, plazo, saldo— y sale
     * un papel. Meter todo eso en este formulario lo volvería largo para los
     * otros seis tipos, que son casi todas las veces. Se decide por la BANDERA
     * del catálogo y no por `codigo === 'ABONO_CLIENTE'`, para que un segundo
     * tipo con papel no obligue a volver acá. */
    const elegirTipo = (v) => {
        const elegido = delSentido.find((t) => t.codigo === v);
        if (elegido?.lleva_comprobante && onComprobante) { onComprobante(elegido); return; }
        setCodigo(v);
    };
    const cerrado = (campo) => !!deLaFoto[campo] && !aMano;

    const alElegirFoto = async (f) => {
        setFoto(f);
        setAviso(null);
        setDeLaFoto({});
        if (!f) return;
        setLeyendo(true);
        const r = await leerBoleta(f, { entidad: null, numeroBoleta: null, monto: null });
        setLeyendo(false);
        if (r?.error) {
            setAviso('No se pudo leer la foto. Escribe los datos a mano.');
            setAMano(true);
            return;
        }
        const leido = r?.leido || {};
        const puesto = {};
        if (Number.isFinite(Number(leido.monto)) && Number(leido.monto) > 0) {
            setMonto(String(leido.monto)); puesto.monto = true;
        }
        if (leido.numero_boleta) { setBoleta(String(leido.numero_boleta)); puesto.boleta = true; }
        const texto = conceptoDelPapel(leido);
        if (texto) { setConcepto(texto.slice(0, 50)); puesto.concepto = true; }
        setDeLaFoto(puesto);

        const nombres = { monto: 'el monto', boleta: 'el número', concepto: 'el concepto' };
        const llenados = Object.keys(puesto).map((k) => nombres[k]);
        const faltan = ['monto', 'boleta', 'concepto'].filter((k) => !puesto[k]).map((k) => nombres[k]);
        setAviso(llenados.length
            ? `La foto llenó ${llenados.join(', ')}.${faltan.length ? ` Falta ${faltan.join(' y ')}.` : ''}`
            : 'La foto no se dejó leer. Escribe los datos a mano.');
        if (!llenados.length) setAMano(true);
    };

    const guardar = async () => {
        let fotoUrl = null;
        if (foto) {
            try { fotoUrl = await subirComprobante(foto, { salaId: sala, userId }); } catch { fotoUrl = null; }
        }
        onAnotar({
            monto: Number(monto),
            // Lo que se GUARDA como concepto es el rótulo del tipo más el
            // detalle: del otro lado —el sistema de la caja— no hay tipo, sólo
            // un campo de texto, y ahí el papel tiene que seguir diciendo qué
            // fue. El `tipo` viaja aparte y es lo que se puede sumar.
            concepto: [tipo?.etiqueta, concepto.trim()].filter(Boolean).join(' · ').slice(0, 50),
            /* El mismo texto SIN recortar. `concepto` es lo que le cabe al
             * sistema de la caja —50 caracteres, medidos— y esto es lo que se
             * escribió. Guardar sólo el primero perdía la cola en los dos
             * lados: la remesa de $50 de Salud 4 quedó en «… · PAGO D». */
            conceptoCompleto: [tipo?.etiqueta, concepto.trim()].filter(Boolean).join(' · '),
            tipo: tipo?.codigo || null,
            boleta: boleta.trim() || null, fotoUrl,
            /* El ingreso ya no manda vendedor: lo resuelve el servidor con la
             * sesión de quien lo anota. Pero SÍ manda la persona cuando el tipo
             * la pide —«de quién» en un abono a crédito—, y va por `vendedor`
             * porque es el campo que el sistema de la caja recibe del lado de
             * la entrada; del lado de la salida el campo se llama `recibe`. */
            ...(entra
                ? (tipo?.pide_persona ? { vendedor: recibe.trim() } : {})
                : {
                    recibe: identifica ? '' : recibe.trim(),
                    // El vale es de un solo uso y lo consume el SERVIDOR. Acá
                    // sólo viaja; el secreto con el que se emitió nunca llegó.
                    recibidoPor: identifica ? persona?.id : null,
                    vale: identifica ? vale : null,
                }),
            // Para el papel: el detalle suelto y quién, sin el rótulo pegado.
            detalle: concepto.trim(),
        }, tipo, identifica ? persona : null);
    };

    /* El paso del carné va SOLO en pantalla, sin ningún campo de texto dibujado.
     * `useCapturaDeCarne` es un `keydown` global que no cancela la tecla: con el
     * formulario a la vista, la ráfaga del carné se escribiría dentro del campo
     * que tenga el foco — el número del carné, legible, en un campo de concepto.
     * Es el mismo defecto que se corrigió en el login (v2.638.0). */
    if (paso === 'IDENTIDAD') {
        return (
            <Marco abierto={abierto} onClose={onClose} titulo="Quién se lleva el efectivo"
                bajada={`${formatMoney(Number(monto) || 0)} · ${tipo?.etiqueta || ''}${concepto.trim() ? ` · ${concepto.trim()}` : ''}`}
                pie={<>
                    <Button variant="ghost" onClick={() => setPaso('DATOS')}>Atrás</Button>
                    <Button variant="primary" disabled={ocupado || !persona || !vale} onClick={guardar}>
                        Anotar
                    </Button>
                </>}
            >
                <IdentidadDeQuienRetira
                    activo={!!abierto && !ocupado}
                    persona={persona}
                    onIdentificada={({ persona: p, vale: v }) => { setPersona(p); setVale(v); }}
                    onOlvidar={() => { setPersona(null); setVale(null); }}
                    bloqueado={ocupado}
                />
            </Marco>
        );
    }

    return (
        <Marco abierto={abierto} onClose={onClose}
            titulo={entra ? 'Anotar un ingreso' : 'Anotar una salida'}
            bajada={entra
                ? 'Dinero que entra a la caja y no es una venta: el pago de un recibo, un depósito a cuenta.'
                : 'Sale del cajón porque ninguna bolsa de cortes anteriores alcanza. Esto sí se le anota a la caja.'}
            pie={<>
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                {/* Con identidad el botón no anota: pasa al carné. Anotar antes
                    de comprobar dejaría plata salida a nombre de nadie si la
                    comprobación falla. */}
                <Button variant="primary" disabled={ocupado || leyendo || !valido}
                    onClick={() => (identifica ? setPaso('IDENTIDAD') : guardar())}>
                    {identifica ? 'Continuar' : 'Anotar'}
                </Button>
            </>}
        >
            {/* Lo primero, y de la TABLA: una lista escrita a mano en el
                `.jsx` se desincroniza de la base sin avisar. */}
            {/* `clearable={false}`: sin eso el desplegable ofrece «Todos»
                arriba de la lista, que es su forma de limpiar un FILTRO. Acá no
                es un filtro — es una elección obligatoria, y «Todos» no es un
                tipo de movimiento: no significa nada y deja el formulario sin
                el único dato que decide qué se pregunta. */}
            <LiquidSelect label={entra ? 'Qué entra' : 'Qué sale'} value={codigo}
                onChange={elegirTipo} options={delSentido.map((t) => ({ value: t.codigo, label: t.etiqueta }))}
                clearable={false} placeholder="Elige de qué se trata" />
            {tipo?.leyenda && <p className="text-caption text-content-2">{tipo.leyenda}</p>}

            {/* La foto sólo cuando el tipo la usa. Ofrecerla siempre es lo que
                hacía que la aplicación de una inyección —que no tiene boleta—
                pasara por el aro de «no tengo boleta» seiscientas veces. */}
            {tipo && tipo.foto !== 'NO' && (
                <>
                    <FileField label={tipo.foto === 'OBLIGATORIA' ? 'Foto de la boleta (obligatoria)' : 'Foto de la boleta'}
                        accept="image/*" value={foto}
                        onChange={alElegirFoto} hint={leyendo ? 'Leyendo la foto…' : undefined} />
                    {aviso && <p className="text-caption text-content-2">{aviso}</p>}

                    {!pedirDatos && !leyendo && (
                        <Notice variant="info" icon={Landmark}>
                            Sube la foto de la boleta y el monto, el número y el detalle se llenan solos.
                            {tipo.foto !== 'OBLIGATORIA' && (
                                <button type="button" onClick={() => setAMano(true)}
                                    className="block mt-1 underline font-bold text-content-2 min-h-[var(--tap-min)]">
                                    No tengo boleta: escribirlo a mano
                                </button>
                            )}
                        </Notice>
                    )}
                </>
            )}

            {pedirDatos && (
                <>
                    <PortalInput label="Monto" inputMode="decimal" value={monto} readOnly={cerrado('monto')}
                        onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
                    {tipo.pide_boleta && (
                        <PortalInput label="Número de boleta" value={boleta} readOnly={cerrado('boleta')}
                            onChange={(e) => setBoleta(e.target.value)} placeholder="000375" />
                    )}
                    {/* «Detalle» y no «Concepto»: el concepto ya lo dice el
                        tipo. Acá va lo que el tipo no puede saber — qué se
                        aplicó, de qué era el recibo. */}
                    <PortalInput label={exigeDetalle ? 'Detalle' : 'Detalle (opcional)'}
                        value={concepto} maxLength={50} readOnly={cerrado('concepto')}
                        onChange={(e) => setConcepto(e.target.value)}
                        placeholder={PISTA_DE_DETALLE[tipo.codigo] || (entra ? 'de qué se trata' : 'en qué se gastó')} />
                    {/* Con identidad no hay campo: el nombre sale de quien
                        quedó reconocido, y teclearlo sería contestar dos veces
                        la misma pregunta —la mitad de ellas mal—. Se pide en el
                        paso siguiente, con la pantalla limpia. */}
                    {tipo.pide_persona && !identifica && (
                        <PortalInput label={entra ? 'De quién' : 'Quién recibe'} value={recibe} maxLength={60}
                            onChange={(e) => setRecibe(e.target.value)}
                            placeholder={entra ? 'nombre del cliente' : 'nombre de quien se lleva el efectivo'} />
                    )}
                    {tipo.pide_persona && identifica && (
                        <Notice variant="info" icon={Lock}>
                            Al continuar se le pide el <b>carné</b> a quien se lleva el efectivo.
                            Si no lo trae, ahí mismo puede entrar con su usuario y contraseña.
                        </Notice>
                    )}
                    {/* La foto puede leer mal, y entonces hay que poder corregirla.
                        Es un botón y no un campo siempre abierto: abrirlos sin
                        pedirlo devolvería el problema que la foto vino a resolver. */}
                    {Object.keys(deLaFoto).length > 0 && !aMano && (
                        <button type="button" onClick={() => setAMano(true)}
                            className="text-caption underline text-content-3 min-h-[var(--tap-min)]">
                            La foto leyó mal: corregir a mano
                        </button>
                    )}
                </>
            )}

        </Marco>
    );
}

function DialogoCorte({ abierto, ocupado, resultado, pendientes, yaEmbolsado = 0, bolsasDeHoy = 0,
    resolviendo = false, onResolver, onClose, onCortar, onImprimir }) {
    const [efectivo, setEfectivo] = useState('');
    const valido = efectivo !== '' && Number(efectivo) >= 0;
    /* Lo que se declara es el ACUMULADO del día; lo que se cuenta, sólo el
     * cajón. La suma la hace el portal — ver `yaEmbolsado` en la vista. */
    const declarado = (Number(efectivo) || 0) + yaEmbolsado;

    // Con resultado, la pantalla cambia de trabajo: ya no pide un número, dice
    // cómo salió. Son dos momentos y no dos diálogos porque es el mismo acto.
    if (resultado) {
        const dif = Number(resultado.diferencia || 0);
        const cuadro = Math.abs(dif) < 0.005;
        return (
            <Marco abierto={abierto} onClose={onClose} titulo={cuadro ? 'El corte cuadró' : 'El corte tiene diferencia'}
                pie={<>
                    {resultado.ok && (
                        <Button variant="secondary" icon={Printer} onClick={() => onImprimir(resultado)}>
                            Imprimir
                        </Button>
                    )}
                    {resultado.ok && onResolver ? (
                        <>
                            <Button variant="ghost" disabled={resolviendo}
                                onClick={() => onResolver('DESCARTADO', 'Conteo descartado desde la caja')}>
                                Descartar
                            </Button>
                            <Button variant="primary" disabled={resolviendo}
                                onClick={() => onResolver('CONFIRMADO')}>
                                Confirmar el corte
                            </Button>
                        </>
                    ) : (
                        <Button variant="primary" onClick={onClose}>Entendido</Button>
                    )}
                </>}
            >
                <div className="space-y-1 text-body-sm">
                    <p className="text-content-2">Contaste <b className="text-content tabular-nums">{formatMoney(resultado.contado)}</b></p>
                    <p className={`text-h3 font-bold tabular-nums ${cuadro ? 'text-success-text' : dif > 0 ? 'text-warning-text' : 'text-danger-text'}`}>
                        {conSigno(dif)}
                    </p>
                    {/* Por qué este número y no el que guardó el sistema de la
                        caja. Lo escribe `notaDeCifra`, que es quien decidió la
                        cifra, así que no puede contradecirla. */}
                    {resultado.nota && (
                        <p className="text-caption text-content-2 pt-1">
                            <b className="text-content">{resultado.nota.titulo}.</b>{' '}
                            {resultado.nota.detalle}
                        </p>
                    )}
                    {/* De dónde sale lo esperado. Se muestra por el mismo motivo
                        que va impreso: el número que el portal calculaba salió
                        mal una vez, así que una cifra sin su cuenta pide que se
                        le crea. */}
                    {(resultado.tiquete?.lineas || []).length > 0 && (
                        <div className="pt-2 space-y-0.5">
                            {resultado.tiquete.lineas.map((l) => (
                                <p key={l.rotulo} className="flex justify-between text-caption text-content-3">
                                    <span>{l.rotulo}</span>
                                    <span className="tabular-nums">{formatMoney(l.monto)}</span>
                                </p>
                            ))}
                            <p className="flex justify-between text-caption font-semibold text-content-2 pt-1 border-t border-divider">
                                <span>Debía haber</span>
                                <span className="tabular-nums">{formatMoney(resultado.esperado)}</span>
                            </p>
                        </div>
                    )}
                    {/* Las formas que no pasan por la caja, COMO VENGAN: se
                        pintan las que trajo el tiquete, no dos escritas acá. Con
                        «tarjeta» y «crédito» fijas, una forma nueva no aparece
                        como cero — desaparece, y el número sigue cuadrando
                        diciendo de menos. Ya costó los $2.20 de Salud 2. */}
                    {(resultado.tiquete?.formas || []).length > 0 && (
                        <div className="pt-2 space-y-0.5">
                            <p className="text-caption text-content-3">No pasa por la caja</p>
                            {resultado.tiquete.formas.map((f) => (
                                <p key={f.rotulo} className="flex justify-between text-caption text-content-3">
                                    <span className="capitalize">{f.rotulo}</span>
                                    <span className="tabular-nums">{formatMoney(f.monto)}</span>
                                </p>
                            ))}
                        </div>
                    )}
                    {resultado.vale && (
                        <p className="text-caption text-content-3">
                            Se anotó un vale de caja de {formatMoney(resultado.vale.monto)} antes del corte.
                        </p>
                    )}
                    {!resultado.ok && (
                        <p className="text-caption text-danger-text">
                            El corte no quedó registrado: {resultado.respuesta || 'el sistema lo rechazó'}
                        </p>
                    )}
                    {/* El corte se registró pero NO del tipo que se pidió, o no
                        se pudo comprobar cuál salió. Es un aviso y no una nota
                        al pie porque cambia lo que hay que hacer: el 31-ago el
                        primer corte desde el portal salió una LECTURA, el
                        sistema contestó «success», y nadie se enteró hasta que
                        alguien lo repitió. */}
                    {resultado.ok && resultado.aviso && (
                        <p className="text-caption text-danger-text font-bold">
                            {resultado.aviso}
                        </p>
                    )}
                </div>
                {/* ── La decisión, acá mismo ────────────────────────────
                    Un corte queda PENDIENTE hasta que alguien lo firma, y sin
                    firma no se puede cerrar el día. Mandar a otra pestaña a
                    resolverlo hacía que la sala llegara al cierre con el
                    candado puesto sin saber por qué. Y quien acaba de contar
                    es quien sabe si el conteo estuvo bien. */}
                {resultado.ok && onResolver && (
                    <Notice variant="info" icon={ShieldCheck}>
                        <span className="font-bold">¿Este conteo es el bueno?</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Confírmalo para que cuente como el corte del día. Si fue una prueba
                            o contaste mal, descártalo y vuelve a hacerlo.
                        </span>
                    </Notice>
                )}
            </Marco>
        );
    }

    return (
        <Marco abierto={abierto} onClose={onClose} titulo="Hacer el corte"
            bajada="Cuenta SÓLO el efectivo que hay en el cajón ahora. Lo que ya está en las bolsas de hoy lo suma el portal."
            pie={<>
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || !valido}
                    onClick={() => onCortar(declarado)}>Hacer el corte</Button>
            </>}
        >
            {pendientes > 0 && (
                <Notice variant="info" icon={Landmark}>
                    Antes del corte se anota un <b>vale de caja</b> con {pendientes} salida{pendientes === 1 ? '' : 's'} del día.
                </Notice>
            )}
            <PortalInput label="Efectivo en el cajón" inputMode="decimal" value={efectivo}
                onChange={(e) => setEfectivo(e.target.value)} placeholder="0.00" autoFocus />

            {/* La suma, a la vista.
                Mostrar lo ya embolsado NO rompe el conteo a ciegas: no es lo que
                el sistema espera, es lo que la sala misma guardó y lleva escrito
                en la etiqueta de cada bolsa. Lo que sigue sin verse —y es el
                control— es cuánto DEBERÍA haber. Al revés: como el portal pone
                esa mitad y nadie la puede inflar, lo único que se teclea es un
                conteo de verdad. */}
            {yaEmbolsado > 0 && (
                <div className="space-y-1 text-body-sm">
                    <div className="flex justify-between gap-3">
                        <span className="text-content-2">
                            Ya en {bolsasDeHoy === 1 ? 'la bolsa' : `las ${bolsasDeHoy} bolsas`} de hoy
                        </span>
                        <span className="tabular-nums text-content-2">{formatMoney(yaEmbolsado)}</span>
                    </div>
                    <div className="flex justify-between gap-3 pt-1 border-t border-border/60">
                        <span className="font-bold text-content">Se declara</span>
                        <span className="tabular-nums font-black text-content">{formatMoney(declarado)}</span>
                    </div>
                    <p className="text-caption text-content-3">
                        El sistema de la caja cuenta el día entero, así que el corte declara todo
                        lo del día — no sólo lo del cajón.
                    </p>
                </div>
            )}

        </Marco>
    );
}

/**
 * Cerrar el día. Una confirmación, con el aviso adentro.
 *
 * El cierre emite el cierre del día y **no se deshace**: esa caja no se vuelve a
 * abrir. Por eso el diálogo no pregunta «¿estás seguro?» a secas — dice qué
 * queda del otro lado del botón, que es lo único que puede hacer que alguien se
 * detenga.
 *
 * Lo monta el llamador sólo cuando está abierto.
 */
function DialogoCerrar({ ocupado, sinCorte, sinConfirmar, onClose, onCerrar }) {
    /* Sin corte CONFIRMADO no se cierra, y se dice ANTES. El servidor lo
     * rechaza igual —ahí está el candado— pero enterarse recién al apretar es
     * hacer perder el tiempo por una condición que la pantalla ya conocía al
     * pintar. */
    if (sinCorte) {
        return (
            <Marco abierto onClose={onClose}
                titulo={sinConfirmar ? 'El corte no está confirmado' : 'Falta el corte'}
                bajada={sinConfirmar
                    ? 'Se hizo un corte, pero nadie lo confirmó todavía.'
                    : 'Esta caja todavía no tiene ningún corte del día.'}>
                <Notice variant="warning" icon={AlertTriangle}>
                    {sinConfirmar
                        ? <>Un corte descartado o sin revisar no cuenta como conteo del día:
                            si fue una prueba, no es final. Confírmalo en <b>Cortes</b> antes de
                            cerrar — el cierre no se deshace.</>
                        : <>Si cierras ahora, el efectivo de toda la jornada queda sin contar ni una vez,
                            y el cierre no se deshace. Haz el corte primero.</>}
                </Notice>
                <div className="flex justify-end">
                    <Button variant="primary" onClick={onClose}>Entendido</Button>
                </div>
            </Marco>
        );
    }

    return (
        <Marco abierto onClose={onClose} titulo="Cerrar el día"
            bajada="Esto cierra la caja de hoy y emite el cierre del día."
            pie={<>
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado} onClick={onCerrar}>
                    Cerrar el día
                </Button>
            </>}
        >
            <Notice variant="danger" icon={AlertTriangle}>
                <span className="font-bold">No se puede deshacer.</span>
                <span className="block mt-0.5 font-normal">
                    La caja de este día no se vuelve a abrir: lo que quede sin anotar ya no se
                    podrá anotar, y las bolsas de hoy pasan a ser de un día cerrado.
                </span>
            </Notice>
        </Marco>
    );
}

/**
 * Pedir que se anule o se corrija un movimiento ya anotado.
 *
 * Pide, no cambia: lo que ya está del otro lado lo corrige quien aprueba. Es la
 * misma decisión que el portal ya toma para anular una factura, y por eso va por
 * la misma bandeja en vez de tener una cola propia donde algo se quede esperando
 * sin que nadie lo mire.
 */
function DialogoCorregir({ movimiento, ocupado, onClose, onPedir }) {
    const [que, setQue] = useState('ANULAR');
    const [motivo, setMotivo] = useState('');
    const [montoNuevo, setMontoNuevo] = useState('');
    if (!movimiento) return null;
    const valido = motivo.trim().length >= 5
        && (que === 'ANULAR' || Number(montoNuevo) > 0);

    return (
        <Marco abierto onClose={onClose} titulo="Pedir una corrección"
            bajada={`${movimiento.concepto} · ${formatMoney(movimiento.monto)}`}
            pie={<>
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || !valido}
                    onClick={() => onPedir(que, motivo.trim(), que === 'MONTO' ? Number(montoNuevo) : null)}>
                    Pedir
                </Button>
            </>}
        >
            <div className="flex gap-2">
                <Button size="sm" variant={que === 'ANULAR' ? 'primary' : 'secondary'}
                    onClick={() => setQue('ANULAR')}>Anularlo</Button>
                <Button size="sm" variant={que === 'MONTO' ? 'primary' : 'secondary'}
                    onClick={() => setQue('MONTO')}>Corregir el monto</Button>
            </div>
            {que === 'MONTO' && (
                <PortalInput label="Monto correcto" inputMode="decimal" value={montoNuevo}
                    onChange={(e) => setMontoNuevo(e.target.value)} placeholder="0.00" />
            )}
            <PortalInput label="Motivo" value={motivo} maxLength={200}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Se anotó dos veces" />
        </Marco>
    );
}
