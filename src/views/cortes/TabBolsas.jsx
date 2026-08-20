import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import {
    AlertTriangle, Banknote, CalendarDays, CheckCircle2, HandCoins, Inbox, Package, Printer, Scale, Send, ShieldCheck,
} from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Checkbox from '../../components/common/Checkbox';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import {
    contarBolsa, fetchBolsas, fetchEntrega, fetchPersonasDeBolsas, fetchSaldos,
    recibirBolsas, resolverDiferenciaBolsa,
} from '../../data/bolsas';
import { clickable } from '../../utils/clickable';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useAuth } from '../../context/AuthContext';
import useCerrarBolsa from '../../hooks/useCerrarBolsa';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';

/* El detalle se baja al ABRIR una bolsa, no al entrar a la pestaña: arrastra el
 * motor de impresion y el visor de archivos firmados, y la lista se ve entera
 * sin tocar nada. Mismo criterio que `CorteDetalleModal` en la baldosa del
 * Inicio, y lo obliga el gate de bundle: importado de forma estática, la vista
 * pasaba de 72 a 75 kB y su tope es 72. */
const DetalleDeBolsa = lazy(() => import('../../components/bolsas/DetalleDeBolsa'));

/* Y el formulario de salida igual: arrastra `FileField` y el selector de
 * personas, y sólo hace falta al apretar «Sacar dinero». */
const SalidaDeBolsa = lazy(() => import('../../components/bolsas/SalidaDeBolsa'));
const EntregaDeBolsas = lazy(() => import('../../components/bolsas/EntregaDeBolsas'));

/**
 * El proceso entero de una bolsa de efectivo, en una pantalla.
 *
 * Pedido del usuario (2026-08-15): «el widget es para acceder fácil, pero debe
 * haber una vista donde se haga todo el proceso, donde cuando se cuente el
 * dinero en admin se ponga que todo bien». Esto es esa vista, y va como pestaña
 * de Cortes de caja porque es lo que le pasa al dinero DESPUÉS del corte.
 *
 * ── Las secciones son las ETAPAS, no filtros ────────────────────────────────
 * Cuatro bloques en el orden en que pasan las cosas: en la sala → esperando
 * recepción → por contar → contadas. No es una lista con una píldora de estado:
 * cada etapa tiene una acción distinta y un dueño distinto, y verlas en orden es
 * lo que hace que la pantalla explique el circuito sin que nadie lo enseñe.
 *
 * ── Y las tres firmas son de tres personas ──────────────────────────────────
 * La sala entrega, administración acusa recibo, administración cuenta. El
 * servidor rechaza que quien entregó firme la recepción — dos confirmaciones de
 * la misma persona no son un control, son dos clics.
 *
 * ── El período recorta TODO, y lo que esconde lo dice ───────────────────────
 * Hasta el 2026-08-20 las tres etapas pendientes lo ignoraban: la idea era que
 * una bolsa de seis días es justamente la que hay que ver. El efecto real fue
 * otro — mover las fechas no cambiaba nada en pantalla, y el usuario lo reportó
 * dos veces («no tiene sentido que el filtro de fecha sea hoy», y después «al
 * moverme entre fechas, aún así me muestra siempre las pendientes»). Un filtro
 * que no filtra enseña a desconfiar del que sí.
 *
 * Hoy recorta las cuatro etapas, y lo que el rango deja afuera sale en un aviso
 * con un botón que estira el período hasta la pendiente más vieja. Esconder una
 * bolsa pendiente sólo es aceptable si la pantalla dice que la escondió.
 *
 * ── Las dos acciones viven en la píldora ────────────────────────────────────
 * «los botones de sacar dinero, entregar dinero, deben estar en el filterpill»
 * (usuario, 2026-08-17). Es §17 al pie de la letra: `FilterBar` lleva los
 * filtros de la vista **y sus acciones**. Estaban colgados de la etapa «En la
 * sala», que además las escondía al hacer scroll.
 *
 * La píldora la dibuja `CortesView` —una por vista—, así que esta pestaña
 * PUBLICA sus acciones por `onAcciones` y sigue siendo dueña de sus diálogos.
 * Al revés (que el padre supiera cuántas bolsas hay en la sala para poder
 * deshabilitarlas) habría que cargar las bolsas dos veces.
 *
 * ── Y los montos, detrás de `bolsas_ver_montos` ─────────────────────────────
 * «los totales de dinero no los deben ver los dependientes, solo quien tenga
 * permisos» (mismo día). Mismo canon que `facturacion_ver_montos`. Sin el
 * permiso la pantalla dice cuántas bolsas, de qué día y con qué folio —todo lo
 * que hace falta para moverlas— y ni una cifra.
 */

const hhmm = (hora) => String(hora || '').slice(0, 5);
const fechaCorta = (f) => (f ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
}) : '');
const selloDeTiempo = (iso) => (iso ? new Date(iso).toLocaleString('es-SV', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'America/El_Salvador',
}) : '');
const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const fechaLarga = (f) => (f ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'long', timeZone: 'UTC',
}) : '');
const diasDesde = (f) => Math.max(0, Math.round(
    (Date.parse(`${hoySV()}T12:00:00Z`) - Date.parse(`${f}T12:00:00Z`)) / 86_400_000,
));

const DIAS_DE_ALARMA = 4;

// Una sola referencia vacía: devolver `[]` en cada render haría que el carril de
// la vista se creyera cambiado siempre.
const VACIO = [];

// `monto_inicial` es lo que se guardó; el SALDO es lo que debe haber en billetes
// hoy. Desde que se puede sacar dinero de una bolsa, sumar lo guardado sería
// decir que hay plata que ya no está.
const saldoDe = (b) => Number(b.saldo ?? b.monto_inicial ?? 0);
const suma = (lista) => lista.reduce((a, b) => a + saldoDe(b), 0);
const diferenciaDe = (b) => (b.contado == null ? null : Math.round((Number(b.contado) - saldoDe(b)) * 100) / 100);

/** Una bolsa, con lo que hay que saber de ella en cualquier etapa. */
function Bolsa({ bolsa, sala, personas, seleccionada, onSeleccionar, children, alarma, onAbrir, verMontos }) {
    const dias = diasDesde(bolsa.fecha);
    const quien = personas.get(bolsa.contado_por || bolsa.recibida_por || bolsa.entregada_por || bolsa.cerrada_por);
    return (
        <div data-surface="card" className="flex flex-col gap-1.5 p-3 group"
            {...(onAbrir ? clickable(() => onAbrir(bolsa), { label: `Ver el detalle de la bolsa ${bolsa.folio}` }) : {})}>
            <div className="flex items-start gap-2">
                {/* `Checkbox` y no la casilla nativa: la nativa se pinta con el
                    color del sistema operativo e ignora los cuatro temas
                    (DESIGN.md §15.4, «reemplaza a `<input type="checkbox">`
                    siempre»). Frena el clic porque la tarjeta entera abre el
                    detalle. */}
                {onSeleccionar && (
                    <span className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                            size="sm"
                            checked={seleccionada}
                            onChange={() => onSeleccionar(bolsa.id)}
                            aria-label={`Elegir la bolsa ${bolsa.folio}`}
                        />
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-label font-bold text-content truncate">{bolsa.folio}</span>
                        {sala && <span className="text-caption text-content-2 truncate">{sala}</span>}
                    </div>
                    <div className="text-caption text-content-3 truncate tabular-nums">
                        Corte del {fechaCorta(bolsa.fecha)} · {hhmm(bolsa.hora)}
                        {bolsa.caja ? ` · ${bolsa.caja}` : ''}
                    </div>
                </div>
                {/* La cifra grande es lo que DEBE HABER en billetes. Cuando salió
                    dinero, lo guardado va abajo: si sólo se mostrara el monto
                    inicial, la pantalla estaría prometiendo plata que ya no está
                    adentro. Sin `bolsas_ver_montos` no hay cifra — queda el ojo,
                    que es lo que dice que la tarjeta se abre. */}
                <div className="text-right shrink-0">
                    <div className="text-label font-bold tabular-nums text-content flex items-center gap-1.5 justify-end">
                        {verMontos && formatMoney(saldoDe(bolsa))}
                        {onAbrir && <OjoDeTarjeta size={13} />}
                    </div>
                    {verMontos && Number(bolsa.vales || 0) > 0 && (
                        <div className="text-caption text-content-3 tabular-nums">
                            de {formatMoney(bolsa.monto_inicial)}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
                {Number(bolsa.vales || 0) > 0 && (
                    <Badge variant="info" size="sm">
                        {bolsa.salidas} {Number(bolsa.salidas) === 1 ? 'vale' : 'vales'}
                        {verMontos ? ` · ${formatMoney(bolsa.vales)}` : ''}
                    </Badge>
                )}
                {alarma && dias >= DIAS_DE_ALARMA && (
                    <Badge variant="danger" size="sm" dot>{dias} días en sala</Badge>
                )}
                {!bolsa.etiqueta_impresa_at && bolsa.estado === 'ABIERTA' && (
                    <Badge variant="warning" size="sm">Sin etiqueta</Badge>
                )}
                {quien && (
                    <span className="flex items-center gap-1.5 min-w-0">
                        <LiquidAvatar
                            src={quien.photo_url} alt={quien.name}
                            fallbackText={iniciales(quien.name)}
                            className="w-5 h-5 rounded-full shrink-0 text-micro"
                        />
                        <span className="text-caption text-content-3 truncate">{quien.name}</span>
                    </span>
                )}
                {/* Frena el clic: la tarjeta abre el detalle, y un boton de
                    adentro no puede abrirlo ademas de hacer lo suyo. */}
                {children && (
                    <span className="contents" onClick={(e) => e.stopPropagation()}>{children}</span>
                )}
            </div>
        </div>
    );
}

/** El conteo de UNA bolsa: cuadra de un toque, o se escribe lo que se contó. */
function Conteo({ bolsa, ocupado, onContar }) {
    const [abierto, setAbierto] = useState(false);
    const [valor, setValor] = useState('');

    const guardar = () => {
        const n = Number(String(valor).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) return;
        onContar(bolsa, n);
    };

    if (!abierto) {
        return (
            <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
                <Button variant="secondary" size="sm" icon={Scale} onClick={() => setAbierto(true)}>
                    No cuadra
                </Button>
                {/* El camino de un toque es el que va a usarse en casi todas, así
                    que es el botón primario y manda el monto que la pantalla
                    mostró — el servidor lo recalcula y rechaza si cambió. */}
                <Button variant="primary" size="sm" icon={CheckCircle2} loading={ocupado}
                    onClick={() => onContar(bolsa, Number(bolsa.monto_inicial))}>
                    Cuadra
                </Button>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 flex-wrap w-full">
            <span className="text-caption text-content-2">Se contaron</span>
            <PortalInput
                compact
                name={`contado-${bolsa.id}`}
                aria-label={`Cuanto se conto en la bolsa ${bolsa.folio}`}
                inputMode="decimal" maskType="DECIMAL"
                value={valor} onChange={(e) => setValor(e.target.value)}
                placeholder={String(bolsa.monto_inicial)}
                className="w-32"
                inputClassName="tabular-nums"
            />
            <div className="flex items-center gap-1.5 ml-auto">
                <Button variant="ghost" size="sm" onClick={() => { setAbierto(false); setValor(''); }}>
                    Cancelar
                </Button>
                <Button variant="primary" size="sm" loading={ocupado} disabled={valor === ''}
                    onClick={guardar}>
                    Guardar conteo
                </Button>
            </div>
        </div>
    );
}

/** Resolver la diferencia de una bolsa ya contada. */
function Resolver({ bolsa, ocupado, onResolver }) {
    const [causa, setCausa] = useState('');
    const dif = diferenciaDe(bolsa);
    const falta = dif < 0;

    return (
        <div className="flex items-center gap-1.5 flex-wrap w-full">
            <PortalInput
                compact
                name={`causa-${bolsa.id}`}
                aria-label={`Por que ${falta ? 'falto' : 'sobro'} en la bolsa ${bolsa.folio}`}
                value={causa} onChange={(e) => setCausa(e.target.value)}
                placeholder={falta ? 'Por qué faltó y qué se hizo…' : 'Por qué sobró y qué se hizo…'}
                className="flex-1 min-w-[10rem]"
            />
            <div className="flex items-center gap-1.5 ml-auto">
                <Button variant="secondary" size="sm" disabled={!causa.trim()} loading={ocupado}
                    onClick={() => onResolver(bolsa, 'JUSTIFICA', causa)}>
                    Justificar
                </Button>
                <Button variant="primary" size="sm" disabled={!causa.trim()} loading={ocupado}
                    onClick={() => onResolver(bolsa, falta ? 'REPONE' : 'RETIRA', causa)}>
                    {falta ? 'Repuesto' : 'Retirado'}
                </Button>
            </div>
        </div>
    );
}

/**
 * Una etapa del circuito, con su total y su acción de conjunto.
 *
 * ── Y separada POR SALA, como los cortes (2026-08-20) ───────────────────────
 * «No está separado por sucursal, así como los cortes» (usuario). Ordenarlas por
 * sala no alcanzaba: en una rejilla de dos columnas, 56 bolsas seguidas se leen
 * como una sola lista y el cambio de sala pasa entre dos tarjetas sin que nada
 * lo marque. Es el mismo encabezado en versalitas que usa `CortesView` para sus
 * grupos, y por el mismo motivo: entregar, recibir y contar se hacen POR SALA.
 *
 * El encabezado sale igual con una sola sala. Repetirlo no cuesta nada y saber
 * de qué sala es lo que se está mirando nunca sobra — que es justo lo que se
 * pierde cuando alguien deja filtrada una sala y se olvida.
 */
function Etapa({ icon: Icon, titulo, ayuda, grupos, total, montoTotal, accion, vacio, verMontos }) {
    return (
        <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1 flex-wrap">
                <h3 className="text-label font-bold text-content flex items-center gap-2">
                    <Icon size={15} className="text-content-3" />
                    {titulo}
                </h3>
                <span className="text-caption text-content-3 tabular-nums">
                    {total} {total === 1 ? 'bolsa' : 'bolsas'}
                    {verMontos && total > 0 && ` · ${formatMoney(montoTotal)}`}
                </span>
            </div>
            {ayuda && <p className="text-caption text-content-3 px-1">{ayuda}</p>}
            {accion}
            {total === 0
                ? <EmptyState linea icon={Icon} title={vacio} />
                : grupos.map((g) => (
                    <div key={g.branchId} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3 px-1">
                            <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                {g.nombre}
                            </h4>
                            <span className="text-micro text-content-3 tabular-nums">
                                {g.lista.length} {g.lista.length === 1 ? 'bolsa' : 'bolsas'}
                                {verMontos && ` · ${formatMoney(suma(g.lista))}`}
                            </span>
                        </div>
                        <div className="grid gap-2 grid-cols-1 xl:grid-cols-2">
                            {g.lista.map((b) => b.nodo)}
                        </div>
                    </div>
                ))}
        </section>
    );
}

export default function TabBolsas({ desde, hasta, sala, nombreSala, onAcciones, onMetricas, onAmpliarPeriodo }) {
    const { hasPermission } = useAuth();
    const puedeEntregar = hasPermission('bolsas', 'can_edit');
    const puedeContar = hasPermission('bolsas_conteo', 'can_edit');
    const verMontos = hasPermission('bolsas_ver_montos');
    const verCards = hasPermission('bolsas_ver_cards');
    const showToast = useToastStore((s) => s.showToast);
    const empleados = useStaff((st) => st.employees);

    const [bolsas, setBolsas] = useState([]);
    const [personas, setPersonas] = useState(() => new Map());
    const [cargando, setCargando] = useState(true);
    const [elegidas, setElegidas] = useState(() => new Set());
    const [ocupado, setOcupado] = useState(null);
    const [sacando, setSacando] = useState(false);
    const [entregando, setEntregando] = useState(false);
    // Qué bolsa está abierta en el detalle: es donde viven la foto del
    // comprobante, la bitácora y las dos anulaciones.
    const [abierta, setAbierta] = useState(null);

    // El rango, dicho en la pantalla. La píldora ya lo muestra, pero arriba y
    // fuera de la sección que recorta: quien mira «Contadas» y la ve corta
    // necesita leer ahí mismo hasta dónde llega. Un solo día se dice «del 20 de
    // agosto», no «del 20 al 20».
    const rangoEnPalabras = useMemo(() => (desde === hasta
        ? `del ${fechaLarga(desde)}`
        : `del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`), [desde, hasta]);

    const { imprimir, imprimirTrasLaSalida } = useCerrarBolsa({ nombreSala, origen: 'modulo' });
    const nombrePersona = useMemo(() => {
        const m = new Map();
        for (const e of empleados || []) m.set(e.id, e.name);
        return m;
    }, [empleados]);

    const cargar = useCallback(async () => {
        setCargando(true);
        // Las pendientes se BAJAN todas y se recortan acá; las contadas ya vienen
        // del período, **por la fecha en que se CONTARON** — filtrarlas por la
        // fecha del corte hacía que una bolsa vieja recién contada desapareciera
        // de la pantalla al firmarla.
        //
        // Se bajan todas y no sólo las del rango porque el aviso de «hay N
        // pendientes fuera de estas fechas» necesita saber que existen: son las
        // que el filtro esconde, y esconderlas sin decirlo es justo lo que no
        // puede pasar con dinero esperando en una sala.
        const [vivas, contadas] = await Promise.all([
            fetchBolsas({ estados: ['ABIERTA', 'ENTREGADA', 'RECIBIDA'] }),
            fetchBolsas({ desde, hasta, estados: ['CONTADA'], porFechaDeConteo: true }),
        ]);
        const todas = [...(vivas || []), ...(contadas || [])];
        // El saldo va pegado a la bolsa desde el principio: si llegara después,
        // la pantalla mostraría por un instante el monto guardado como si fuera
        // el efectivo que hay adentro.
        const saldos = await fetchSaldos(todas.map((b) => b.id));
        setBolsas(todas.map((b) => ({ ...b, ...(saldos.get(b.id) || {}) })));
        setCargando(false);
        const firmas = todas.flatMap((b) => [b.cerrada_por, b.entregada_por, b.recibida_por, b.contado_por, b.dif_por]);
        const gente = await fetchPersonasDeBolsas(firmas);
        setPersonas(new Map(gente.map((p) => [p.id, p])));
    }, [desde, hasta]);

    useEffect(() => { cargar(); }, [cargar]);

    const deLaSala = useMemo(
        () => (sala ? bolsas.filter((b) => String(b.branch_id) === String(sala)) : bolsas),
        [bolsas, sala],
    );

    // ── El período recorta TODA la pantalla, también lo pendiente ────────────
    //
    // Hasta el 2026-08-20 sólo recortaba el archivo de las contadas: las tres
    // etapas pendientes lo ignoraban a propósito —una bolsa que lleva seis días
    // esperando es la que hay que ver— y el resultado fue que mover las fechas
    // no cambiaba nada en pantalla. «Al moverme entre fechas, aún así me muestra
    // siempre las pendientes» (usuario, 2026-08-20). Un filtro que no filtra es
    // peor que no tenerlo: enseña a desconfiar del que sí filtra.
    //
    // Lo que protegía el diseño viejo se conserva de otra forma, y mejor: lo que
    // el rango deja afuera se DICE, con un botón que lo trae. Antes no se decía
    // nada porque no había nada que decir; ahora el aviso es la única razón por
    // la que esconder una bolsa pendiente es aceptable.
    const enRango = useCallback(
        (b) => String(b.fecha) >= String(desde) && String(b.fecha) <= String(hasta),
        [desde, hasta],
    );

    const pendientesFuera = useMemo(
        () => deLaSala.filter((b) => b.estado !== 'CONTADA' && !enRango(b)),
        [deLaSala, enRango],
    );

    const enPantalla = useMemo(
        () => deLaSala.filter((b) => b.estado === 'CONTADA' || enRango(b)),
        [deLaSala, enRango],
    );

    // La fecha de la pendiente más vieja que quedó afuera: es hasta dónde tiene
    // que estirarse el período para que el aviso deje de tener razón.
    const masViejaFuera = useMemo(
        () => pendientesFuera.reduce((min, b) => (min && min <= b.fecha ? min : b.fecha), null),
        [pendientesFuera],
    );

    // Primero por SUCURSAL y después por fecha (pedido del usuario, 2026-08-20).
    // Ordenadas sólo por fecha, las bolsas de las seis salas quedaban intercaladas
    // —una de Salud 1, una de Salud 4, otra de Salud 1— y quien mira una etapa
    // mira una sala: entregar, recibir y contar se hacen por sala, no por día.
    // Se ordena por el NOMBRE de la sala y no por su id: el id no es el orden que
    // ve nadie.
    const porEstado = useCallback(
        (e) => enPantalla.filter((b) => b.estado === e)
            .sort((a, b) => String(nombreSala[a.branch_id] || '').localeCompare(String(nombreSala[b.branch_id] || ''), 'es')
                || String(a.fecha).localeCompare(String(b.fecha))
                || String(a.hora).localeCompare(String(b.hora))),
        [enPantalla, nombreSala],
    );

    const enSala     = useMemo(() => porEstado('ABIERTA'), [porEstado]);
    const enCamino   = useMemo(() => porEstado('ENTREGADA'), [porEstado]);
    const porContar  = useMemo(() => porEstado('RECIBIDA'), [porEstado]);
    // Las contadas van igual por sala, pero de la más reciente a la más vieja
    // DENTRO de cada una: es un archivo, y de un archivo se mira el final.
    // (`.reverse()` sobre la lista entera invertía también el orden de las salas.)
    const contadas   = useMemo(() => porEstado('CONTADA')
        .sort((a, b) => String(nombreSala[a.branch_id] || '').localeCompare(String(nombreSala[b.branch_id] || ''), 'es')
            || String(b.fecha).localeCompare(String(a.fecha))
            || String(b.hora).localeCompare(String(a.hora))),
        [porEstado, nombreSala]);

    const sinResolver = useMemo(
        () => contadas.filter((b) => Math.abs(diferenciaDe(b) ?? 0) >= 0.01 && !b.dif_at),
        [contadas],
    );

    // Entregadas hace más de un día y todavía sin recibir. Se mide contra
    // `entregada_at` —cuándo salió de la sala— y no contra la fecha del corte:
    // una bolsa vieja entregada hace diez minutos no tiene nada de malo.
    const enCaminoViejas = useMemo(
        () => enCamino.filter((b) => b.entregada_at
            && Date.now() - Date.parse(b.entregada_at) > 24 * 3600_000),
        [enCamino],
    );

    const alternar = useCallback((id) => setElegidas((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    }), []);

    const elegidasDe = useCallback(
        (lista) => lista.filter((b) => elegidas.has(b.id)),
        [elegidas],
    );

    const correr = useCallback(async (clave, fn, exito) => {
        setOcupado(clave);
        const { error } = await fn();
        setOcupado(null);
        if (error) {
            showToast?.('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return false;
        }
        showToast?.(exito, '', 'success');
        setElegidas(new Set());
        cargar();
        return true;
    }, [showToast, cargar]);

    /**
     * Terminada la entrega sale UN papel: el comprobante que firman quien
     * entrega y quien se lleva el dinero. Es el que estaba escrito desde el
     * 15-ago y nunca tuvo de dónde salir.
     *
     * `soloDirecta`: este papel también sale solo. Si la computadora no tiene
     * la ticketera no se abre ningún diálogo — se reimprime desde la sala.
     */
    const trasLaEntrega = useCallback(async (entrega) => {
        try {
            const d = await fetchEntrega(entrega.id);
            if (d) {
                const [{ imprimirDocumento }, { construirComprobanteDeEntrega }] = await Promise.all([
                    import('../../utils/ticketPrint'),
                    import('../../utils/bolsaComprobante'),
                ]);
                await imprimirDocumento(construirComprobanteDeEntrega({
                    entrega: { folio: d.entrega?.folio, entregado_at: d.entrega?.entregada_at },
                    sala: d.sala,
                    bolsas: d.bolsas || [],
                    entregadoPor: d.entregado_por,
                    recibidoPor: d.recibido_por,
                }), { soloDirecta: true, sala: entrega.branch_id });
            }
        } catch (err) {
            // Que no salga el papel no deshace una entrega ya firmada.
            console.error('bolsas: no se pudo imprimir el comprobante de entrega:', err?.message);
        }
        cargar();
    }, [cargar]);

    const recibir = useCallback((lista) => correr('recibir',
        () => recibirBolsas(lista.map((b) => b.id)),
        lista.length === 1 ? 'Recepción confirmada' : `Recepción de ${lista.length} bolsas confirmada`), [correr]);

    const contar = useCallback((bolsa, monto) => correr(`contar-${bolsa.id}`,
        () => contarBolsa(bolsa.id, monto, saldoDe(bolsa)),
        Math.abs(monto - saldoDe(bolsa)) < 0.01
            ? `${bolsa.folio} cuadró`
            : `${bolsa.folio} quedó marcada`), [correr]);

    /**
     * Después de sacar dinero salen DOS papeles por bolsa: el vale que queda
     * adentro y la etiqueta nueva de afuera. La etiqueta se reimprime sola
     * porque la anterior dejó de ser cierta en ese mismo momento — dejarla
     * pendiente sería dejar una bolsa con un número equivocado pegado encima.
     */
    const traslimSalida = useCallback(async (_oper, repartos) => {
        await imprimirTrasLaSalida(repartos, bolsas, nombrePersona);
        cargar();
    }, [imprimirTrasLaSalida, bolsas, nombrePersona, cargar]);

    const resolver = useCallback((bolsa, via, causa) => correr(`resolver-${bolsa.id}`,
        () => resolverDiferenciaBolsa(bolsa.id, via, causa),
        'Diferencia resuelta'), [correr]);

    // Arma los nodos y los reparte por sala, conservando el orden que ya traía la
    // lista (sala, y dentro de la sala por fecha): un `Map` mantiene el orden de
    // inserción, así que no hace falta volver a ordenar los grupos.
    const conNodo = useCallback((lista, extra) => {
        const porSala = new Map();
        for (const b of lista) {
            const nodo = (
                <Bolsa
                    key={b.id} bolsa={b} sala={nombreSala[b.branch_id]} personas={personas}
                    seleccionada={elegidas.has(b.id)}
                    onSeleccionar={extra?.elegible ? alternar : null}
                    alarma={extra?.alarma}
                    onAbrir={setAbierta}
                    verMontos={verMontos}
                >
                    {extra?.pie?.(b)}
                </Bolsa>
            );
            if (!porSala.has(b.branch_id)) porSala.set(b.branch_id, []);
            porSala.get(b.branch_id).push({ ...b, nodo });
        }
        return [...porSala.entries()].map(([branchId, sub]) => ({
            branchId,
            nombre: nombreSala[branchId] || `Sucursal ${branchId}`,
            lista: sub,
        }));
    }, [nombreSala, personas, elegidas, alternar, setAbierta, verMontos]);

    // ── Las dos acciones, publicadas a la píldora de la vista ───────────────
    // Ninguna depende de haber marcado bolsas: quien va a pagar una remesa sabe
    // el monto, no de qué bolsa sale —eso lo elige el portal—, y la entrega
    // pregunta por DÍAS, que es como la sala piensa lo que se lleva.
    const acciones = useMemo(() => (puedeEntregar ? [
        {
            key: 'sacar', icon: HandCoins, label: 'Sacar dinero', rotulo: 'Sacar',
            disabled: !enSala.length, onClick: () => setSacando(true),
        },
        {
            key: 'entregar', icon: Send, label: 'Entregar dinero', rotulo: 'Entregar',
            variant: 'primary', disabled: !enSala.length, onClick: () => setEntregando(true),
        },
    ] : []), [puedeEntregar, enSala.length]);

    // ── El carril, publicado a la píldora de la vista ──────────────────────
    // «necesita cards la vista» (usuario, 2026-08-20). Las cuatro cifras son las
    // del CIRCUITO, no las del período: tres etapas pendientes —que ignoran el
    // período a propósito— más lo que quedó sin resolver del archivo.
    //
    // «En camino» lleva su propio subtítulo cuando hay alguna de más de un día:
    // es el estado más riesgoso —el dinero no está ni en la sala ni en
    // administración— y era el único que no se veía sin bajar hasta su sección.
    //
    // Los montos siguen a `bolsas_ver_montos` y NO a este permiso: son dos
    // preguntas distintas —ver el resumen y ver cuánta plata hay—, y con una
    // sola llave el carril se habría llevado los montos a quien no los ve.
    const metricas = useMemo(() => {
        if (!verCards) return VACIO;
        const cifra = (lista) => (verMontos ? formatMoney(suma(lista)) : String(lista.length));
        const cuantas = (n) => `${n} ${n === 1 ? 'bolsa' : 'bolsas'}`;
        return [
            { clave: 'sala', icon: Package, label: 'En la sala',
              value: cifra(enSala), sub: cuantas(enSala.length),
              iconBg: 'bg-brand/10', iconCls: 'text-brand-text' },
            { clave: 'camino', icon: Send, label: 'En camino',
              value: cifra(enCamino),
              sub: enCaminoViejas.length
                  ? `${cuantas(enCamino.length)} · ${enCaminoViejas.length} de más de un día`
                  : cuantas(enCamino.length),
              iconBg: enCaminoViejas.length ? 'bg-warning/10' : 'bg-surface-card-hover',
              iconCls: enCaminoViejas.length ? 'text-warning-text' : 'text-content-3',
              valueCls: enCaminoViejas.length ? 'text-warning-text' : 'text-content' },
            { clave: 'contar', icon: Banknote, label: 'Por contar',
              value: cifra(porContar), sub: cuantas(porContar.length),
              iconBg: 'bg-surface-card-hover', iconCls: 'text-content-3' },
            { clave: 'sinResolver', icon: Scale, label: 'Sin resolver',
              value: String(sinResolver.length),
              sub: sinResolver.length ? 'contadas y sin cuadrar' : 'todo cuadrado',
              iconBg: sinResolver.length ? 'bg-danger/10' : 'bg-success/10',
              iconCls: sinResolver.length ? 'text-danger-text' : 'text-success-text',
              valueCls: sinResolver.length ? 'text-danger-text' : 'text-success-text' },
        ];
    }, [verCards, verMontos, enSala, enCamino, enCaminoViejas, porContar, sinResolver]);

    useEffect(() => { onMetricas?.(metricas); }, [metricas, onMetricas]);
    useEffect(() => () => onMetricas?.(VACIO), [onMetricas]);

    useEffect(() => { onAcciones?.(acciones); }, [acciones, onAcciones]);
    // Al salir de la pestaña la píldora tiene que quedar sin ellas: son acciones
    // de Bolsas, no de la vista.
    useEffect(() => () => onAcciones?.([]), [onAcciones]);

    if (cargando) return <LoadingState label="Buscando las bolsas" />;

    const elegidasEnCamino = elegidasDe(enCamino);

    return (
        <div className="space-y-6">
            {/* Lo que el rango dejó afuera se DICE. Es la contraparte de que el
                período ahora recorte también lo pendiente: sin este aviso, una
                bolsa que lleva tres semanas en una sala desaparecería de la
                pantalla por mover unas fechas, y nada en pantalla lo delataría —
                que es exactamente el modo en que este circuito puede perder
                dinero sin un error. El botón trae el rango hasta la más vieja. */}
            {pendientesFuera.length > 0 && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <span className="font-bold">
                        {pendientesFuera.length === 1
                            ? 'Hay una bolsa pendiente fuera de estas fechas'
                            : `Hay ${pendientesFuera.length} bolsas pendientes fuera de estas fechas`}
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        {verMontos && `Suman ${formatMoney(suma(pendientesFuera))}. `}
                        Siguen esperando aunque el filtro no las muestre.
                    </span>
                    {onAmpliarPeriodo && masViejaFuera && (
                        <Button variant="secondary" size="sm" icon={CalendarDays} className="mt-2"
                            onClick={() => onAmpliarPeriodo(masViejaFuera)}>
                            Ver todas las pendientes
                        </Button>
                    )}
                </Notice>
            )}

            {sinResolver.length > 0 && (
                <Notice variant="danger" icon={AlertTriangle}>
                    <span className="font-bold">
                        {sinResolver.length === 1
                            ? 'Hay una bolsa contada que no cuadró y sigue sin resolver'
                            : `Hay ${sinResolver.length} bolsas contadas que no cuadraron y siguen sin resolver`}
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Están abajo, en «Contadas».
                    </span>
                </Notice>
            )}

            {/* ── 1. En la sala ─────────────────────────────────────────── */}
            <Etapa
                icon={Package}
                titulo="En la sala"
                ayuda="Nacen solas al confirmar el corte. La etiqueta se imprime acá y se pega a la bolsa."
                grupos={conNodo(enSala, {
                    // Sin casilla: entregar dejó de elegirse bolsa por bolsa
                    // —el diálogo pregunta por DÍAS— y una casilla que ya no
                    // manda a ningún lado es adorno, no control.
                    alarma: true,
                    pie: (b) => (
                        <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
                            <Button variant="secondary" size="sm" icon={Printer}
                                loading={ocupado === `imprimir-${b.id}`}
                                onClick={async () => {
                                    setOcupado(`imprimir-${b.id}`);
                                    await imprimir(b, { cerradaPor: nombrePersona.get(b.cerrada_por) });
                                    setOcupado(null);
                                    cargar();
                                }}>
                                {b.etiqueta_impresa_at ? 'Reimprimir' : 'Imprimir etiqueta'}
                            </Button>
                        </div>
                    ),
                })}
                total={enSala.length} montoTotal={suma(enSala)}
                verMontos={verMontos}
                vacio={pendientesFuera.length ? "Sin efectivo esperando en las salas en estas fechas" : "Sin efectivo esperando en las salas"}
            />

            {/* ── 2. Esperando recepción ──────────────────────────────────
                Es el estado MÁS riesgoso del circuito —la bolsa no está en la
                sala ni en administración, la tiene una persona en el camino— y
                era el único sin alarma: la de los 4 días sólo mira las que están
                en la sala. Una bolsa entregada que nunca llegó se veía igual que
                una entregada hace diez minutos. */}
            {enCaminoViejas.length > 0 && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <span className="font-bold">
                        {enCaminoViejas.length === 1
                            ? 'Una bolsa lleva más de un día entregada y sin recibir'
                            : `${enCaminoViejas.length} bolsas llevan más de un día entregadas y sin recibir`}
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        {verMontos && `Suman ${formatMoney(suma(enCaminoViejas))}. `}
                        Mientras nadie confirme la recepción, ese dinero no está ni en la
                        sala ni en administración.
                    </span>
                </Notice>
            )}

            <Etapa
                icon={Send}
                titulo="Esperando recepción"
                ayuda="Ya salieron de la sala. Administración confirma cuántas llegaron, sin contar el dinero todavía."
                grupos={conNodo(enCamino, { elegible: puedeContar })}
                total={enCamino.length} montoTotal={suma(enCamino)}
                accion={puedeContar && elegidasEnCamino.length > 0 && (
                    <Button variant="primary" size="sm" icon={Inbox} loading={ocupado === 'recibir'}
                        onClick={() => recibir(elegidasEnCamino)}>
                        Confirmar recepción de {elegidasEnCamino.length}
                        {verMontos ? ` · ${formatMoney(suma(elegidasEnCamino))}` : ''}
                    </Button>
                )}
                verMontos={verMontos}
                vacio={pendientesFuera.length ? "Nada en camino en estas fechas" : "Nada en camino"}
            />

            {/* ── 3. Por contar ─────────────────────────────────────────── */}
            <Etapa
                icon={Banknote}
                titulo="Por contar"
                ayuda="Recibidas y sin contar. Un toque en «Cuadra» cuando el dinero coincide."
                grupos={conNodo(porContar, {
                    pie: (b) => (puedeContar ? (
                        <Conteo bolsa={b} ocupado={ocupado === `contar-${b.id}`} onContar={contar} />
                    ) : null),
                })}
                total={porContar.length} montoTotal={suma(porContar)}
                verMontos={verMontos}
                vacio={pendientesFuera.length ? "Nada pendiente de contar en estas fechas" : "Nada pendiente de contar"}
            />

            {/* ── 4. Contadas ───────────────────────────────────────────── */}
            <Etapa
                icon={ShieldCheck}
                titulo="Contadas"
                ayuda={`El historial ${rangoEnPalabras}, por la fecha en que se contaron. Lo que se contó queda; resolver una diferencia no lo cambia.`}
                grupos={conNodo(contadas, {
                    pie: (b) => {
                        const dif = diferenciaDe(b);
                        const cuadra = Math.abs(dif ?? 0) < 0.01;
                        return (
                            <>
                                {cuadra
                                    ? <Badge variant="success" size="sm" icon={CheckCircle2}>Cuadró</Badge>
                                    : (
                                        <Badge variant={dif < 0 ? 'danger' : 'warning'} size="sm" dot>
                                            {dif < 0 ? 'Faltó' : 'Sobró'}
                                            {verMontos ? ` ${formatMoney(Math.abs(dif))}` : ''}
                                        </Badge>
                                    )}
                                {b.dif_at && (
                                    <Badge variant="neutral" size="sm">
                                        {b.dif_via === 'REPONE' ? 'Repuesto' : b.dif_via === 'RETIRA' ? 'Retirado' : 'Justificado'}
                                    </Badge>
                                )}
                                {!cuadra && !b.dif_at && (puedeContar || puedeEntregar) && (
                                    <Resolver bolsa={b} ocupado={ocupado === `resolver-${b.id}`} onResolver={resolver} />
                                )}
                                {b.dif_causa && (
                                    <span className="text-caption text-content-3 w-full truncate">
                                        {b.dif_causa} · {selloDeTiempo(b.dif_at)}
                                    </span>
                                )}
                            </>
                        );
                    },
                })}
                total={contadas.length} montoTotal={suma(contadas)}
                verMontos={verMontos}
                vacio="Sin bolsas contadas en estas fechas"
            />

            {abierta && (
                <Suspense fallback={null}>
                    <DetalleDeBolsa
                        bolsa={abierta}
                        sala={abierta ? nombreSala[abierta.branch_id] : ''}
                        // Quién GUARDÓ el dinero, no quién está mirando: al
                        // anular un vale la etiqueta se reimprime desde ahí
                        // adentro, y sin esto el «Guardo» del papel nuevo
                        // saldría con el nombre de quien anuló.
                        cerradaPor={nombrePersona.get(abierta.cerrada_por)}
                        onClose={() => setAbierta(null)}
                        onCambio={cargar}
                    />
                </Suspense>
            )}

            {entregando && (
                <Suspense fallback={null}>
                    <EntregaDeBolsas
                        abierto={entregando}
                        bolsas={enSala}
                        saldoDe={saldoDe}
                        verMontos={verMontos}
                        nombreSala={enSala.length ? nombreSala[enSala[0].branch_id] : ''}
                        onClose={() => setEntregando(false)}
                        onHecho={trasLaEntrega}
                    />
                </Suspense>
            )}

            {sacando && (
                <Suspense fallback={null}>
                    <SalidaDeBolsa
                abierto={sacando}
                bolsas={enSala}
                saldos={null}
                onClose={() => setSacando(false)}
                onHecho={traslimSalida}
            />
                </Suspense>
            )}
        </div>
    );
}
