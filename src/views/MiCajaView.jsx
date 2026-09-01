import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    AlertTriangle, ArrowDownLeft, ArrowUpRight, Clock, DoorOpen, Landmark, Lock, Printer,
    Scale, ShoppingBag, Wallet,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Button from '../components/common/Button';
import CarrilCards from '../components/common/CarrilCards';
import FilterBar from '../components/common/FilterBar';
import LiquidModal from '../components/common/LiquidModal';
import Notice from '../components/common/Notice';
import FileField from '../components/common/FileField';
import PortalInput from '../components/common/PortalInput';
import StatCard from '../components/common/StatCard';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import {
    abrirCaja, anotarIngreso, anotarSalida, cerrarElDia, estadoDeCaja, fetchBolsas,
    fetchMovimientosDelPortal, fetchSaldos, fetchSalasConCaja, fetchSalidasDeSalaDelDia,
    fetchTiposDeSalida, fetchValesPendientes, hacerCorte, leerBoleta, pedirCorreccion,
    subirComprobante,
} from '../data/bolsas';
import { fetchVentasPorPago } from '../data/cortes';
import { diferenciaDelCorte, notaDeCifra } from '../utils/cortesDiagnostico';

/* Sacar dinero de una bolsa se mudó acá desde Bolsas (pedido del usuario,
 * 29-ago): todo lo que mueve efectivo vive en la caja. Es el MISMO componente,
 * no una copia — arrastra su catálogo de motivos, la lectura de la boleta, la
 * identidad de quien retira y el reparto entre bolsas. Va diferido porque
 * arrastra el editor de fotos, y la mayoría de las visitas a esta pantalla no
 * sacan dinero de una bolsa. */
const SalidaDeBolsa = lazy(() => import('../components/bolsas/SalidaDeBolsa'));
import { construirComprobanteDeCorte } from '../utils/corteTicket';
import { conSigno, formatMoney } from '../utils/formatNumber';
import { imprimirDocumento } from '../utils/ticketPrint';
import { mensajeAmigable } from '../utils/errorMessages';

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

/**
 * La cuenta del corte recién hecho, resuelta por el MISMO juez que la tabla.
 *
 * `hacer-corte-caja` devuelve las dos cuentas sin elegir: la del formulario del
 * origen —que arrastra su defecto conocido, sumar los cobros de crédito un
 * número entero de veces de más— y las piezas del tiquete. Quién gana lo decide
 * `diferenciaDelCorte`, que es la función con la que se lee la tabla de cortes
 * desde el 13-ago, se contrastó contra un testigo independiente (el aviso de
 * sala) y conoce el único caso en que la buena es la del formulario: un corte
 * hecho ANTES de que entraran los cobros del día, donde el tiquete suma uno que
 * a esa hora no existía.
 *
 * Va acá y no en la edge function por eso mismo: el corte recién hecho no puede
 * contarse distinto que el mismo corte mirado mañana en la tabla. Dos jueces
 * para la misma pregunta es cómo se llega a dos números.
 *
 * Sin tiquete no hay qué comparar y queda la del formulario, que es todo lo que
 * hay — el papel lo declara.
 */
function conLaCuentaBuena(r) {
    if (!r?.ok || !r?.tiquete?.total_caja) return r;
    // La forma que espera el canónico: es una fila de `cortes_caja`.
    const comoCorte = {
        total_declarado: r.contado,
        esperado: r.esperado,
        diferencia_erp: r.diferencia,
        tk_total_caja: r.tiquete.total_caja,
        tk_cobros_credito: r.tiquete.cobros_credito,
    };
    const d = diferenciaDelCorte(comoCorte);
    return {
        ...r,
        esperado: d.esperado, diferencia: d.valor, fuente: d.fuente,
        // Por qué este número y no el que guardó el sistema. `null` cuando no
        // hay nada que explicar, y entonces el papel no dice nada.
        nota: notaDeCifra(comoCorte),
        segun_el_sistema: { esperado: r.esperado, diferencia: r.diferencia },
    };
}

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
    const [ocupado, setOcupado] = useState(false);
    const [dialogo, setDialogo] = useState(null);   // 'abrir' | 'ingreso' | 'corte' | 'cerrar'
    const [resultado, setResultado] = useState(null);
    const [bolsas, setBolsas] = useState(VACIO);
    const [movimientos, setMovimientos] = useState(VACIO);
    const [deBolsas, setDeBolsas] = useState(VACIO);
    const [ventas, setVentas] = useState(VACIO);
    const [tipos, setTipos] = useState(VACIO);
    const [corrigiendo, setCorrigiendo] = useState(null);

    // Cómo se llama cada motivo de salida. Sale de la TABLA y no de una lista
    // escrita acá: un motivo nuevo aparecería en la base y no en la pantalla,
    // que es la regla del rótulo que no es una clave.
    useEffect(() => {
        let vivo = true;
        fetchTiposDeSalida().then((t) => { if (vivo) setTipos(t || VACIO); });
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

    const cargar = useCallback(async () => {
        if (!sala) { setCargando(false); return; }
        setCargando(true);
        /* El estado va PRIMERO y solo, aunque cueste un viaje más de reloj: trae
         * el DÍA que la caja tiene abierto, y ese día —no el del calendario— es
         * el que recorta todo lo demás. A las once de la noche con la caja sin
         * cerrar, el calendario ya cambió de día y la caja no: filtrando por el
         * calendario, lo anotado en esa hora desaparece de la pantalla justo
         * mientras todavía cuenta para el corte. */
        const e = await estadoDeCaja(sala);
        const vivo = e.error ? null : e;
        setNoSePudo(e.error ? mensajeAmigable(e.error) : null);
        const dia = vivo?.dia || new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
        const [v, abiertas, movs, porPago, salidas] = await Promise.all([
            fetchValesPendientes(),
            fetchBolsas({ estados: ['ABIERTA', 'ENTREGADA', 'CONTADA'] }),
            fetchMovimientosDelPortal(sala, dia),
            fetchVentasPorPago({ desde: dia, hasta: dia }),
            // Sin el permiso de bolsas la policy devuelve cero filas y NO un
            // error: preguntar antes es lo que separa «no hubo ninguna» de «no
            // las puedo ver», que en pantalla se leen igual.
            puedeVerBolsas ? fetchSalidasDeSalaDelDia({ sala, dia }) : Promise.resolve(VACIO),
        ]);
        setMovimientos(movs);
        setDeBolsas(salidas);
        setVentas((porPago || []).filter((p) => String(p.branch_id) === String(sala)));
        setEstado(vivo);
        setPendientes((v.filas || []).filter((p) => String(p.branch_id) === String(sala)));
        // Sólo las de esta sala y con su saldo: `SalidaDeBolsa` elige la más
        // vieja que alcance sola, y sin el saldo no puede elegir.
        const mias = (abiertas || []).filter((b) => String(b.branch_id) === String(sala));
        const saldos = await fetchSaldos(mias.map((b) => b.id));
        setBolsas(mias.map((b) => ({ ...b, ...(saldos.get(b.id) || {}) })));
        setCargando(false);
    }, [sala, puedeVerBolsas]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de sala

    const totalPendiente = pendientes.reduce((s, p) => s + Number(p.monto || 0), 0);

    /* Si el día que la caja tiene abierto no lleva ni un corte, cerrar deja el
     * efectivo de toda la jornada sin contar ni una vez — y el cierre no se
     * deshace. El candado de verdad está en el servidor; esto es para decirlo
     * ANTES y no después de que alguien escriba la palabra. */
    const sinCorteHoy = !(estado?.cortes || []).some((c) => c.tipo === 'C');

    const correr = async (fn, exito) => {
        setOcupado(true);
        const r = await fn();
        setOcupado(false);
        if (r.error) { showToast(mensajeAmigable(r.error), 'error'); return null; }
        if (exito) showToast(exito, 'success');
        setDialogo(null);
        cargar();
        return r;
    };

    const opcionesDeSala = useMemo(
        () => salas.map((b) => ({ value: b.id, label: b.name })),
        [salas],
    );

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
         * decisión que le toca al portal: de dónde sale la plata. Hoy la
         * decide él —regla del usuario, 30-ago— y **prefiere siempre las bolsas
         * de cortes anteriores**: ese dinero ya lo descontó su propio cierre,
         * así que sacarlo de ahí no le mueve nada a la caja de hoy. Sólo cuando
         * ninguna bolsa alcanza, sale del cajón, y entonces sí hay que anotarlo.
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
                rotuloFijo: true, onClick: () => setDialogo(bolsas.length ? 'bolsa' : 'salida') },
            { key: 'cerrar', icon: Lock, label: 'Cerrar el día', rotulo: 'Cerrar',
                rotuloFijo: true, onClick: () => setDialogo('cerrar') },
        ];
    }, [puedeOperar, sala, estado, noSePudo, bolsas.length]);

    /* El nombre de la sala vivía en el título de la vista, y como pestaña ya no
     * hay título propio. Sin esto, quien mira la caja de OTRA sala no tiene
     * nada en pantalla que se lo diga — y operar la caja equivocada no se
     * deshace. Con una sola sala el selector tampoco se dibuja (§ el selector
     * se esconde con una opción), así que este rótulo es lo único que queda. */
    const cuerpo = (
        <div className="p-4 md:p-6 space-y-6">
            {comoPestana && nombreSala && (
                <h2 className="text-label font-bold text-content -mb-2">Caja de {nombreSala}</h2>
            )}

                {/* El carril y la píldora comparten UNA fila (§17.0). Las dos
                    mitades —`lg:flex-row` acá y `flex-1` en el carril— son
                    obligatorias: `useMedidaFila` busca el carril en el abuelo de
                    la píldora y le descuenta 314px lo tenga al lado o no, así
                    que en renglones separados roba ancho en silencio. */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* Cuatro números fijos, no un desglose de largo variable
                        (§17.0 — «cuántas tarjetas hay lo fija la vista, nunca el
                        dato»). El estado de la caja es el primero porque es la
                        pregunta con la que alguien entra a esta pantalla.
                        Va SIEMPRE, también sin sala: cuántas tarjetas hay lo fija
                        la vista y no el dato, y esconder el carril le descuenta
                        314px a la píldora igual —`useMedidaFila` lo busca en el
                        abuelo y reserva su ancho esté o no—. Sin sala dicen «—»,
                        que es la respuesta honesta. */}
                    <CarrilCards className="flex-1" ariaLabel="Estado de la caja de esta sala">
                        {/* Lo que el sistema espera adentro AHORA. Es la primera
                            pregunta de quien entra —«¿cuánto hay?»— y hasta hoy
                            no estaba en ninguna pantalla del portal. Lo trae el
                            mismo panel que dice si la caja está abierta, así que
                            no cuesta una petición más. */}
                        <StatCard icon={Landmark} label="En la caja"
                            value={sala && !noSePudo && estado?.registrado != null ? formatMoney(estado.registrado) : '—'}
                            sub={estado?.abierta ? `Turno ${estado.turno} · caja ${estado.caja}` : undefined}
                            iconBg="bg-brand/10" iconCls="text-brand-text"
                            loading={cargando} />
                        {/* Tres estados y no dos: abierta, cerrada, y **no se
                            pudo leer**. El tercero decía «Cerrada · Nadie puede
                            vender» sobre una caja abierta desde las 6:58 — la
                            respuesta contraria a la verdad, y sin nada que
                            avisara que era una falla. */}
                        <StatCard icon={noSePudo ? AlertTriangle : estado?.abierta ? DoorOpen : Lock}
                            label={!sala ? 'La caja' : noSePudo ? 'Sin respuesta' : estado?.abierta ? 'Abierta' : 'Cerrada'}
                            value={!sala ? '—' : noSePudo ? 'No se pudo leer'
                                : estado?.abierta ? (estado.desde || 'Abierta') : 'Sin turno'}
                            sub={!sala ? 'Elige una sala'
                                : noSePudo ? 'No se sabe si está abierta'
                                    : estado?.abierta ? (estado.quien || 'sin nombre') : 'Nadie puede vender'}
                            iconBg={estado?.abierta && !noSePudo ? 'bg-success/10' : 'bg-warning/10'}
                            iconCls={estado?.abierta && !noSePudo ? 'text-success-text' : 'text-warning-text'}
                            valueCls={estado?.abierta && !noSePudo ? 'text-success-text' : 'text-warning-text'}
                            loading={cargando} />
                        <StatCard icon={ArrowUpRight} label="Por anotar"
                            value={sala ? pendientes.length : '—'}
                            sub={sala ? formatMoney(totalPendiente) : undefined}
                            iconBg="bg-warning/10" iconCls="text-warning-text"
                            valueCls={pendientes.length ? 'text-warning-text' : undefined}
                            loading={cargando} />
                        <StatCard icon={ArrowDownLeft} label="Anotado hoy"
                            value={sala ? movimientos.length : '—'}
                            sub={bolsas.length ? `${bolsas.length} bolsa${bolsas.length === 1 ? '' : 's'} en sala` : undefined}
                            iconBg="bg-brand/10" iconCls="text-brand-text"
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

                        <PanelDelDia estado={estado} ventas={ventas} />

                        <MovimientosDelDia movimientos={movimientos} deBolsas={deBolsas}
                            dia={estado?.dia} tipos={tipos} puedeOperar={puedeOperar}
                            puedeVerBolsas={puedeVerBolsas} onCorregir={setCorrigiendo} />

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

            <DialogoMovimiento abierto={dialogo === 'ingreso' || dialogo === 'salida'}
                entra={dialogo === 'ingreso'} ocupado={ocupado} sala={sala} userId={user?.id}
                onClose={() => setDialogo(null)}
                onAnotar={(datos) => correr(
                    () => (dialogo === 'ingreso' ? anotarIngreso : anotarSalida)({ sala, ...datos }),
                    dialogo === 'ingreso' ? 'Ingreso anotado.' : 'Salida anotada.',
                )} />

            <DialogoCorte abierto={dialogo === 'corte'} ocupado={ocupado} resultado={resultado}
                pendientes={pendientes.length} onImprimir={imprimirCorte}
                onClose={() => { setDialogo(null); setResultado(null); }}
                onCortar={async (efectivo) => {
                    setOcupado(true);
                    const bruto = await hacerCorte({ sala, efectivo });
                    setOcupado(false);
                    if (bruto.error) { showToast(mensajeAmigable(bruto.error), 'error'); return; }
                    const r = conLaCuentaBuena(bruto);
                    setResultado(r);
                    cargar();
                    /* El papel sale solo, como parte del acto — igual que al
                     * resolver una diferencia. El sistema de la caja arma su
                     * tiquete pero sólo lo imprime desde SU pantalla, que es de
                     * la que las salas salieron: cortar desde el portal dejaba
                     * al turno sin el papel que se anexa al corte del día.
                     *
                     * Va después de `setResultado` a propósito: si la ticketera
                     * no contesta, la pantalla ya muestra el resultado y el
                     * corte no se deshace por un problema de impresión. */
                    if (r.ok) imprimirCorte(r);
                }} />

            {dialogo === 'bolsa' && (
                <Suspense fallback={null}>
                    <SalidaDeBolsa abierto bolsas={bolsas} saldos={null}
                        onClose={() => setDialogo(null)}
                        onHecho={() => { setDialogo(null); cargar(); }} />
                </Suspense>
            )}

            <DialogoCorregir movimiento={corrigiendo} ocupado={ocupado}
                onClose={() => setCorrigiendo(null)}
                onPedir={(que, motivo, montoNuevo) => correr(
                    () => pedirCorreccion({ sala, movimiento: corrigiendo.id, que, motivo, montoNuevo }),
                    'Queda pedido. Alguien tiene que aprobarlo.',
                ).then(() => setCorrigiendo(null))} />

            {dialogo === 'cerrar' && (
                <DialogoCerrar ocupado={ocupado} sinCorte={sinCorteHoy}
                    onClose={() => setDialogo(null)}
                    onCerrar={() => correr(() => cerrarElDia(sala), 'El día quedó cerrado.')} />
            )}
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
function PanelDelDia({ estado, ventas }) {
    if (!estado?.abierta) return null;

    const filas = [...(ventas || [])]
        .map((v) => ({ tipo: String(v.tipo_pago), docs: Number(v.documentos || 0), total: Number(v.total || 0) }))
        .sort((a, b) => b.total - a.total);
    const total = filas.reduce((s, f) => s + f.total, 0);
    const efectivo = filas.find((f) => f.tipo.toLowerCase() === 'efectivo')?.total ?? 0;

    return (
        <div data-surface="card" className="rounded-2xl p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <Dato icono={Landmark} rotulo="Caja"
                    valor={`Caja ${estado.caja ?? '—'} · turno ${estado.turno ?? '—'}`} />
                <Dato icono={Clock} rotulo="Abierta desde" valor={estado.desde || 'sin hora'} />
                <Dato icono={DoorOpen} rotulo="La abrió" valor={estado.quien || 'sin nombre'} />
                <Dato icono={Wallet} rotulo="Monto de apertura"
                    valor={estado.apertura != null ? formatMoney(estado.apertura) : '—'} />
            </div>

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
                        <ul className="divide-y divide-border/60">
                            {filas.map((f) => (
                                <li key={f.tipo} className="flex items-baseline justify-between gap-3 py-1.5">
                                    <span className="text-body-sm text-content">
                                        {conMayuscula(f.tipo)}
                                        <span className="text-caption text-content-3">
                                            {' '}· {f.docs} documento{f.docs === 1 ? '' : 's'}
                                        </span>
                                    </span>
                                    <span className="tabular-nums font-semibold text-content">
                                        {formatMoney(f.total)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <div className="flex items-baseline justify-between gap-3 pt-1">
                            <span className="text-body-sm font-bold text-content">Total vendido</span>
                            <span className="tabular-nums font-black text-content">{formatMoney(total)}</span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-body-sm text-content-2">De eso, en efectivo</span>
                            <span className="tabular-nums font-bold text-brand-text">{formatMoney(efectivo)}</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function Dato({ icono: Icono, rotulo, valor }) {
    return (
        <div className="min-w-0">
            <p className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                <Icono className="w-3.5 h-3.5" aria-hidden="true" />
                {rotulo}
            </p>
            <p className="text-body-sm font-semibold text-content truncate">{valor}</p>
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
function MovimientosDelDia({ movimientos, deBolsas, dia, tipos, puedeOperar, puedeVerBolsas, onCorregir }) {
    const etiquetaDe = (codigo) =>
        tipos?.find((t) => t.codigo === codigo)?.etiqueta || conMayuscula(codigo);

    const lineas = useMemo(() => {
        const delCajon = (movimientos || []).map((m) => ({
            clave: `caja-${m.id}`,
            cuando: m.registrado_at,
            titulo: m.concepto,
            entra: m.tipo === 'ENTRADA',
            monto: Number(m.monto || 0),
            anulado: !!m.anulado_at,
            origen: 'De la caja',
            detalle: [
                m.numero_boleta ? `boleta ${m.numero_boleta}` : null,
                m.erp_movimiento_id ? null : 'sin llegar a la caja',
            ].filter(Boolean),
            movimiento: m,
        }));
        const deLasBolsas = (deBolsas || []).map((o) => ({
            clave: `bolsa-${o.id}`,
            cuando: o.registrado_at,
            titulo: `${etiquetaDe(o.tipo)}${o.entidad ? ` · ${o.entidad}` : ''}`,
            entra: false,
            monto: Math.abs(Number(o.monto || 0)),
            anulado: !!o.anulada_at,
            // El nombre completo del origen, porque de eso depende el corte.
            origen: o.tocaLaCaja ? 'De una bolsa de hoy' : 'De una bolsa de un corte anterior',
            avisa: o.tocaLaCaja,
            detalle: [
                o.folio,
                o.numero_boleta ? `boleta ${o.numero_boleta}` : null,
                o.tocaLaCaja ? 'se anota como vale al cortar' : 'no toca la caja de hoy',
            ].filter(Boolean),
        }));
        return [...delCajon, ...deLasBolsas]
            .sort((a, b) => String(b.cuando || '').localeCompare(String(a.cuando || '')));
    }, [movimientos, deBolsas, tipos]); // eslint-disable-line react-hooks/exhaustive-deps -- `etiquetaDe` sale de `tipos`

    if (!lineas.length && puedeVerBolsas) return null;

    return (
        <div className="space-y-2">
            <h3 className="text-caption font-black uppercase tracking-widest text-content-2">
                Movimientos de este día{dia ? ` · ${fechaLegible(dia)}` : ''}
            </h3>

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

            {lineas.map((l) => (
                <div key={l.clave} data-surface="card"
                    className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <p className={`text-body-sm font-medium ${l.anulado ? 'text-content-3 line-through' : 'text-content'}`}>
                            {l.titulo}
                        </p>
                        <p className="text-caption text-content-3">
                            <span className={l.avisa ? 'text-warning-text font-semibold' : undefined}>
                                {l.origen}
                            </span>
                            {l.detalle.length ? ` · ${l.detalle.join(' · ')}` : ''}
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className={`tabular-nums font-bold ${l.entra ? 'text-success-text' : 'text-warning-text'}`}>
                            {l.entra ? '' : '−'}{formatMoney(l.monto)}
                        </span>
                        {puedeOperar && l.movimiento && !l.anulado && (
                            <Button variant="ghost" size="sm" onClick={() => onCorregir(l.movimiento)}>
                                Corregir
                            </Button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function Marco({ abierto, onClose, titulo, bajada, children }) {
    if (!abierto) return null;
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-sm" ariaLabel={titulo}>
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">{titulo}</h3>
                    {bajada && <p className="text-body-sm text-content-2 mt-1">{bajada}</p>}
                </div>
                {children}
            </div>
        </LiquidModal>
    );
}

function DialogoAbrir({ abierto, ocupado, onClose, onAbrir }) {
    const [monto, setMonto] = useState('');
    return (
        <Marco abierto={abierto} onClose={onClose} titulo="Abrir la caja"
            bajada="Con cuánto efectivo arranca la caja. Si arranca en cero, déjalo vacío.">
            {/* Texto y no `type="number"`: el campo numérico nativo no tiene
                separador decimal en el teléfono, y esto es dinero. */}
            <PortalInput label="Monto de apertura" inputMode="decimal" value={monto}
                onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado}
                    onClick={() => onAbrir(Number(monto || 0))}>Abrir</Button>
            </div>
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
 * Un concepto legible a partir de lo que dice el papel.
 *
 * `tipo_operacion` + `entidad` son lo que el lector ya extrae, y juntos dicen
 * exactamente lo que alguien escribiría a mano: «Pago de CAESS». Es una FRASE
 * derivada del dato, no un catálogo — si el papel no dice el tipo, queda el
 * nombre solo, y si no dice ninguno de los dos, el campo se abre para escribir.
 */
function conceptoDelPapel(leido) {
    const quien = String(leido?.red_remesas || leido?.entidad || '').trim();
    if (!quien) return '';
    switch (String(leido?.tipo_operacion || '').toUpperCase()) {
        case 'PAGO_SERVICIO': return `Pago de ${quien}`;
        case 'REMESA':        return `Remesa ${quien}`;
        case 'DEPOSITO':      return `Depósito ${quien}`;
        case 'COMPRA':        return `Compra en ${quien}`;
        default:              return quien;
    }
}

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
function DialogoMovimiento({ abierto, entra, ocupado, sala, userId, onClose, onAnotar }) {
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

    const valido = Number(monto) > 0 && concepto.trim().length > 2;
    // Antes de la foto no se pide nada: ésa es la vuelta del cuadro. Se abre
    // igual si alguien elige escribirlo a mano.
    const pedirDatos = !!foto || aMano;
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
            monto: Number(monto), concepto: concepto.trim(),
            boleta: boleta.trim() || null, fotoUrl,
            // El ingreso ya no manda vendedor: lo resuelve el servidor con la
            // sesión de quien lo anota.
            ...(entra ? {} : { recibe: recibe.trim() }),
        });
    };

    return (
        <Marco abierto={abierto} onClose={onClose}
            titulo={entra ? 'Anotar un ingreso' : 'Anotar una salida'}
            bajada={entra
                ? 'Dinero que entra a la caja y no es una venta: el pago de un recibo, un depósito a cuenta.'
                : 'Sale del cajón porque ninguna bolsa de cortes anteriores alcanza. Esto sí se le anota a la caja.'}>
            <FileField label="Foto de la boleta" accept="image/*" value={foto}
                onChange={alElegirFoto} hint={leyendo ? 'Leyendo la foto…' : undefined} />
            {aviso && <p className="text-caption text-content-2">{aviso}</p>}

            {!pedirDatos && !leyendo && (
                <Notice variant="info" icon={Landmark}>
                    Sube la foto de la boleta y el monto, el número y el concepto se llenan solos.
                    <button type="button" onClick={() => setAMano(true)}
                        className="block mt-1 underline font-bold text-content-2 min-h-[var(--tap-min)]">
                        No tengo boleta: escribirlo a mano
                    </button>
                </Notice>
            )}

            {pedirDatos && (
                <>
                    <PortalInput label="Monto" inputMode="decimal" value={monto} readOnly={cerrado('monto')}
                        onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
                    <PortalInput label="Número de boleta" value={boleta} readOnly={cerrado('boleta')}
                        onChange={(e) => setBoleta(e.target.value)} placeholder="000375" />
                    <PortalInput label="Concepto" value={concepto} maxLength={50} readOnly={cerrado('concepto')}
                        onChange={(e) => setConcepto(e.target.value)}
                        placeholder={entra ? 'Pago de CAESS' : 'Compra de agua fría'} />
                    {!entra && (
                        <PortalInput label="Quién recibe" value={recibe} maxLength={60}
                            onChange={(e) => setRecibe(e.target.value)}
                            placeholder="nombre de quien se lleva el efectivo" />
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

            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || leyendo || !valido} onClick={guardar}>
                    Anotar
                </Button>
            </div>
        </Marco>
    );
}

function DialogoCorte({ abierto, ocupado, resultado, pendientes, onClose, onCortar, onImprimir }) {
    const [efectivo, setEfectivo] = useState('');
    const valido = efectivo !== '' && Number(efectivo) >= 0;

    // Con resultado, la pantalla cambia de trabajo: ya no pide un número, dice
    // cómo salió. Son dos momentos y no dos diálogos porque es el mismo acto.
    if (resultado) {
        const dif = Number(resultado.diferencia || 0);
        const cuadro = Math.abs(dif) < 0.005;
        return (
            <Marco abierto={abierto} onClose={onClose} titulo={cuadro ? 'El corte cuadró' : 'El corte tiene diferencia'}>
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
                </div>
                <div className="flex justify-end gap-2">
                    {resultado.ok && (
                        <Button variant="secondary" icon={Printer} onClick={() => onImprimir(resultado)}>
                            Imprimir de nuevo
                        </Button>
                    )}
                    <Button variant="primary" onClick={onClose}>Entendido</Button>
                </div>
            </Marco>
        );
    }

    return (
        <Marco abierto={abierto} onClose={onClose} titulo="Hacer el corte"
            bajada="Cuenta el efectivo de la caja y escribe cuánto hay. No se muestra cuánto debería haber: eso aparece después.">
            {pendientes > 0 && (
                <Notice variant="info" icon={Landmark}>
                    Antes del corte se anota un <b>vale de caja</b> con {pendientes} salida{pendientes === 1 ? '' : 's'} del día.
                </Notice>
            )}
            <PortalInput label="Efectivo contado" inputMode="decimal" value={efectivo}
                onChange={(e) => setEfectivo(e.target.value)} placeholder="0.00" autoFocus />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || !valido}
                    onClick={() => onCortar(Number(efectivo))}>Hacer el corte</Button>
            </div>
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
function DialogoCerrar({ ocupado, sinCorte, onClose, onCerrar }) {
    /* Sin corte no se cierra, y se dice ANTES. El servidor lo rechaza igual
     * —ahí está el candado— pero enterarse recién al apretar es hacer perder el
     * tiempo por una condición que la pantalla ya conocía al pintar. */
    if (sinCorte) {
        return (
            <Marco abierto onClose={onClose} titulo="Falta el corte"
                bajada="Esta caja todavía no tiene ningún corte del día.">
                <Notice variant="warning" icon={AlertTriangle}>
                    Si cierras ahora, el efectivo de toda la jornada queda sin contar ni una vez,
                    y el cierre no se deshace. Haz el corte primero.
                </Notice>
                <div className="flex justify-end">
                    <Button variant="primary" onClick={onClose}>Entendido</Button>
                </div>
            </Marco>
        );
    }

    return (
        <Marco abierto onClose={onClose} titulo="Cerrar el día"
            bajada="Esto cierra la caja de hoy y emite el cierre del día.">
            <Notice variant="danger" icon={AlertTriangle}>
                <span className="font-bold">No se puede deshacer.</span>
                <span className="block mt-0.5 font-normal">
                    La caja de este día no se vuelve a abrir: lo que quede sin anotar ya no se
                    podrá anotar, y las bolsas de hoy pasan a ser de un día cerrado.
                </span>
            </Notice>
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado} onClick={onCerrar}>
                    Cerrar el día
                </Button>
            </div>
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
            bajada={`${movimiento.concepto} · ${formatMoney(movimiento.monto)}`}>
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
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || !valido}
                    onClick={() => onPedir(que, motivo.trim(), que === 'MONTO' ? Number(montoNuevo) : null)}>
                    Pedir
                </Button>
            </div>
        </Marco>
    );
}
