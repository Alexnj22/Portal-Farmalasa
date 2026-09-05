/**
 * Mis puntos — la pantalla del CLIENTE, sin sesión.
 *
 * ── Quién llega acá ─────────────────────────────────────────────────────────
 * Alguien parado en la sala o en su casa, con el teléfono en la mano, que quiere
 * saber una cosa: cuánto tiene. No es personal del portal: no conoce el menú, no
 * sabe qué es una sala ni un correlativo, y no va a volver a intentar si algo se
 * ve raro. Por eso esto es una pantalla sola, sin menú, con un solo camino.
 *
 * ── Se habla en dólares, no en puntos ───────────────────────────────────────
 * «Tenés 420 puntos» no le dice nada a nadie. «$4.20 de descuento» sí. El número
 * de puntos se muestra abajo, como el detalle de dónde sale la cifra que
 * importa.
 *
 * ── Por qué pide dos datos ──────────────────────────────────────────────────
 * Con sólo el teléfono, cualquiera que vea un ticket vería el nombre y el saldo
 * de esa persona. Los dos juntos convierten «probar números» en «adivinar un
 * par». La pantalla lo DICE —«los dos datos que están en tu ficha»— para que no
 * se lea como un trámite de más.
 *
 * ── Por qué acá sí entran los colores del logo ──────────────────────────────
 * DESIGN.md §6 los reserva para donde «la app habla DE SÍ MISMA», y nunca para
 * un dato. Ésta es la única pantalla del portal que ve alguien que no trabaja
 * acá: el verde y el magenta aparecen en la marca, en el resplandor de la
 * tarjeta y en las DOS REGLAS del programa —$1 da un punto, 100 puntos dan un
 * dólar—, que son enunciados del programa, no datos de la persona. El saldo, el
 * avance y los movimientos siguen usando severidad y categoría, como cualquier
 * otro dato del portal.
 *
 * Los dos tonos salen del logo aprobado (`--logo-green` / `--logo-magenta`) y su
 * reparto es el mismo del afiche de la vitrina: verde lo que se gana, magenta lo
 * que se usa. Los `-text` son variantes por tema — el verde lima no se lee sobre
 * claro y el magenta se apaga sobre oscuro.
 *
 * ── Lo que la pantalla explica, y por qué está en las dos mitades ───────────
 * Antes de consultar y después, «Cómo funciona» dice lo mismo: alguien que llega
 * por el código de la vitrina y no encuentra su ficha se va sabiendo cómo se
 * ganan y cómo se usan. El reglamento completo vive en `/reglamento-puntos` y
 * acá sólo se enlaza — un resumen que se pueda desincronizar del reglamento es
 * un resumen que algún día va a decir otra cosa.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
    Loader2, AlertTriangle, ArrowLeft, ShoppingBag, Gift, ShieldCheck,
    CalendarClock, ChevronDown, ChevronUp, ChevronRight, CreditCard, Phone, UserRound, ScrollText,
    KeyRound,
} from 'lucide-react';
import Button from '../components/common/Button';
import PortalInput from '../components/common/PortalInput';
import Notice from '../components/common/Notice';
import Badge from '../components/common/Badge';
import { consultarMisPuntos } from '../data/misPuntos';
import { EMPRESA } from '../constants/empresa';

/**
 * La forma del código de acceso: siete caracteres de un alfabeto sin parecidos
 * (sin O/0, sin I/1, sin S/5…). Vive acá arriba porque la contestan dos: el
 * campo que alguien teclea y el código que viene en la dirección.
 */
const FORMA_DEL_CODIGO = /^[ACDEFGHJKMNPQRTUVWXY34679]{7}$/;

/**
 * El código que trae la dirección, si trae uno con forma buena.
 *
 * El QR del papel es `…/mis-puntos?codigo=K7MP4XN`: quien lo escanea llega con
 * el campo lleno y la consulta ya hecha. Se valida la FORMA antes de usarlo
 * porque un intento fallido gasta uno de los cinco del freno, y ninguno se va a
 * gastar por un enlace mal copiado.
 */
function codigoDeLaDireccion() {
    try {
        const c = new URLSearchParams(window.location.search).get('codigo') ?? '';
        const limpio = c.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return FORMA_DEL_CODIGO.test(limpio) ? limpio : '';
    } catch { return ''; }
}

/** Cuántos puntos hacen falta para poder canjear. Lo dice el reglamento §4. */
const MINIMO_DE_CANJE = 100;

/**
 * ¿Hay que preguntarle los permisos antes de mostrarle el saldo?
 *
 * Sí en dos casos, y son distintos a propósito:
 *
 *   · Nunca contestó (`null`). Es el de los 28,161 registros que entraron antes
 *     de que existiera esta pregunta.
 *   · Contestó que NO al programa. Ahí se vuelve a preguntar cada vez, porque
 *     su saldo quedó congelado esperándolo: si no se le ofreciera volver, la
 *     única forma de deshacer un toque sería ir a una sala de ventas.
 *
 * Quien dijo que no a las PROMOCIONES ya contestó, y no se le insiste: negarse
 * a la publicidad no le cuesta nada y repreguntarlo sería empujarlo.
 */
function faltaResponder(c) {
    if (!c) return false;          // una respuesta vieja del servidor: no se bloquea
    return c.programa !== true || c.promociones === null || c.promociones === undefined;
}

/** Cuántos movimientos se ven sin pedir más. El resto entra con un toque. */
const MOVIMIENTOS_A_LA_VISTA = 6;

const fmtFecha = (d) => {
    if (!d) return '';
    const [a, m, dd] = String(d).slice(0, 10).split('-');
    return a && m && dd ? `${dd}/${m}/${a}` : '';
};

/**
 * Cuántos días faltan para una fecha AAAA-MM-DD.
 *
 * Se compara en UTC a mediodía y NO con `new Date(cadena)`: una fecha sin hora
 * se interpreta como UTC y en El Salvador vuelve un día antes, que acá sería un
 * vencimiento adelantado. Misma trampa que documenta `_shared/puntosLotes.ts`.
 */
const diasHasta = (fecha) => {
    const [a, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
    if (!a || !m || !d) return null;
    const hoy = new Date();
    const destino = Date.UTC(a, m - 1, d, 12);
    const desde = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12);
    return Math.round((destino - desde) / 86400000);
};

/**
 * La cifra que sube hasta su valor.
 *
 * No es adorno: es lo único que se mueve en la pantalla y sirve para que el ojo
 * caiga donde está la respuesta. Respeta `prefers-reduced-motion` —ahí aparece
 * puesta— y arranca del valor final si el navegador no anima.
 */
function useCifraQueSube(valor, ms = 700) {
    // Se decide ANTES del primer pintado y no dentro del efecto: si arrancara
    // siempre en cero y el efecto lo corrigiera después, quien pidió no ver
    // movimiento vería igual un cero parpadeando — que es justo lo que la
    // preferencia quiere evitar.
    const anima = typeof window !== 'undefined'
        && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        && Number.isFinite(valor) && valor > 0;
    const [visible, setVisible] = useState(anima ? 0 : valor);
    const cuadro = useRef(0);

    useEffect(() => {
        if (!anima) return undefined;

        const t0 = performance.now();
        const paso = (t) => {
            const p = Math.min(1, (t - t0) / ms);
            // Salida exponencial: arranca rápido y se acomoda. Sin rebote.
            setVisible(valor * (1 - Math.pow(1 - p, 4)));
            if (p < 1) cuadro.current = requestAnimationFrame(paso);
        };
        cuadro.current = requestAnimationFrame(paso);
        return () => cancelAnimationFrame(cuadro.current);
    }, [anima, valor, ms]);

    return visible;
}

/** Rótulo de sección. Uno solo, para que los seis se vean iguales. */
const Rotulo = ({ children }) => (
    <p className="text-caption uppercase tracking-widest text-content-3 font-black mb-2">
        {children}
    </p>
);

/**
 * Cómo funciona, plegado.
 *
 * Plegado y no siempre abierto porque quien viene a ver su saldo ya sabe cómo
 * funciona; y presente en los dos estados porque quien NO lo sabe llegó por el
 * código de la vitrina. Se monta sólo al abrirse, así que cerrado no hay nada
 * que tabular adentro — que es lo que resuelve `inert` cuando no se puede
 * desmontar (DESIGN.md §14).
 */
function ComoFunciona() {
    const [abierto, setAbierto] = useState(false);

    return (
        <div data-surface="card" className="overflow-hidden">
            <button
                type="button"
                onClick={() => setAbierto(v => !v)}
                aria-expanded={abierto}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left
                           min-h-[var(--tap-min)] active:scale-[0.99] transition-transform"
            >
                <ScrollText size={16} className="text-content-3 shrink-0" strokeWidth={2.5} />
                <span className="flex-1 text-body-lg font-black text-content-1">Cómo funciona</span>
                <ChevronDown
                    size={16} strokeWidth={2.5}
                    className={`text-content-3 shrink-0 transition-transform duration-[var(--dur-base)] ${abierto ? 'rotate-180' : ''}`}
                />
            </button>

            {abierto && (
                <div className="px-4 pb-4 space-y-4 animate-in fade-in slide-in-from-top-1 duration-[var(--dur-slow)]">
                    <div className="h-px bg-divider" />

                    <section>
                        <Rotulo>Para ganarlos</Rotulo>
                        <p className="text-body-lg text-content-2 leading-relaxed">
                            Identifícate en caja <strong className="text-content-1">antes de pagar</strong>:
                            con tu registro de cliente frecuente esa compra ya cuenta. Después ya no
                            se puede. La compra tiene que pasar de $1.00, ser al precio normal de la
                            sala e incluir al menos un producto de farmacia o cuidado personal.
                        </p>
                    </section>

                    <section>
                        <Rotulo>Para usarlos</Rotulo>
                        <p className="text-body-lg text-content-2 leading-relaxed">
                            Desde <strong className="text-content-1">100 puntos</strong>, en cualquiera
                            de nuestras salas, mostrando tu documento. De ahí para arriba usas los que
                            quieras. Se gastan primero los más viejos, para que no se te venzan. No se
                            cambian por efectivo ni se devuelven en dinero.
                        </p>
                    </section>

                    <section>
                        <Rotulo>Cuándo vencen</Rotulo>
                        <p className="text-body-lg text-content-2 leading-relaxed">
                            Los de cada compra vencen a los <strong className="text-content-1">12 meses</strong> de
                            esa compra, y no el saldo entero de golpe. Los que ya tienes se pueden
                            usar hasta el 1 de octubre de 2027.
                        </p>
                    </section>

                    <section>
                        <Rotulo>Lo que no acumula</Rotulo>
                        <ul className="space-y-1.5">
                            {[
                                'La compra que lleve algo a precio especial, de mayoreo, de convenio o con cualquier descuento (basta que aparezca en el ticket)',
                                'La compra de $1.00 o menos',
                                'La parte que pagas con puntos',
                                'La factura a nombre de una empresa o institución',
                            ].map((t) => (
                                <li key={t} className="flex gap-2 text-body-lg text-content-2 leading-relaxed">
                                    <span className="text-content-3 shrink-0" aria-hidden="true">·</span>
                                    <span>{t}</span>
                                </li>
                            ))}
                        </ul>
                        {/* La salvedad va junto a la lista y no adentro: es lo que
                            evita la lectura de que un helado ARRUINA la compra. */}
                        <p className="text-body-lg text-content-2 leading-relaxed mt-2">
                            Saldo, recargas y tarjetas telefónicas, bebidas, helados y paletas no
                            acumulan por sí solos. Pero si en la misma compra llevas también algo de
                            farmacia o cuidado personal, <strong className="text-content-1">esa compra sí acumula</strong>.
                        </p>
                    </section>

                    <p className="text-caption text-content-3">
                        Estas condiciones rigen desde el 1 de octubre de 2026.
                    </p>

                    <a
                        href="/reglamento-puntos"
                        className="inline-flex items-center gap-1.5 text-body-lg font-bold text-brand-text
                                   min-h-[var(--tap-min)] hover:underline"
                    >
                        Ver el reglamento completo
                        <ChevronRight size={14} strokeWidth={2.5} />
                    </a>
                </div>
            )}
        </div>
    );
}

/** Un movimiento del historial. Compra suma, canje resta. */
function Movimiento({ m }) {
    const esCanje = m.tipo === 'canje';
    return (
        <div data-surface="card" className="flex items-center gap-3 px-3 py-2.5">
            <div className={`w-8 h-8 rounded-btn flex items-center justify-center shrink-0
                             ${esCanje ? 'bg-chart-3/[0.14]' : 'bg-success/[0.14]'}`}>
                {esCanje
                    ? <Gift size={15} className="text-chart-3-text" strokeWidth={2.5} />
                    : <ShoppingBag size={15} className="text-success-text" strokeWidth={2.5} />}
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-body-lg font-bold text-content-1 leading-tight">
                    {esCanje ? 'Canje' : 'Compra'}
                </p>
                <p className="text-caption text-content-3 truncate">
                    {fmtFecha(m.fecha)}{m.sala ? ` · ${m.sala}` : ''}
                </p>
            </div>
            <span className={`text-body-lg font-black tabular-nums shrink-0
                              ${esCanje ? 'text-chart-3-text' : 'text-success-text'}`}>
                {m.puntos > 0 ? '+' : '−'}{Math.abs(m.puntos).toLocaleString()}
            </span>
        </div>
    );
}

export default function MisPuntosView() {
    const [dui, setDui] = useState('');
    // Se lee UNA vez, al construir el estado, y no dentro de un efecto: así el
    // campo ya nace lleno en el primer render —nadie ve el formulario vacío
    // parpadear— y no hay un setState sincrónico encadenando renders.
    const [codigo, setCodigo] = useState(codigoDeLaDireccion);
    const [tel, setTel] = useState('');
    // Nace encendido si la dirección trae código: quien llega por el QR está
    // esperando su saldo desde el primer pixel, así que la pantalla dice
    // «cargando» de entrada en vez de mostrar un formulario que se va a llenar
    // solo un instante después.
    const [cargando, setCargando] = useState(() => !!codigoDeLaDireccion());
    const [error, setError] = useState('');
    const [datos, setDatos] = useState(null);
    const [todos, setTodos] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [errorPermisos, setErrorPermisos] = useState('');
    // La identificación con la que se entró, para reusarla al contestar los
    // permisos. En un `ref` y no en estado: no se pinta, así que cambiarla no
    // tiene por qué provocar un render.
    const llaveUsada = useRef(null);

    // ── Dos caminos, y por eso TRES campos ────────────────────────────────
    // El código en un campo propio y no compartiendo el del DUI: así el DUI
    // conserva su máscara y su validación de nueve dígitos —que es lo que evita
    // gastar un intento del freno con algo mal escrito— y el código conserva la
    // suya. Un solo campo que acepta las dos cosas no puede validar ninguna.
    const duiOk = dui.replace(/\D/g, '').length === 9;
    const telOk = tel.replace(/\D/g, '').length >= 8;
    const codigoLimpio = codigo.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const codigoOk = FORMA_DEL_CODIGO.test(codigoLimpio);
    // Con código no se pide teléfono, y no es una excepción para el extranjero:
    // el código es NUESTRO, lo emite una persona en la caja y son 6,100 millones
    // de combinaciones contra un freno de cinco intentos por IP. Ahí el segundo
    // dato no agrega nada. Por documento sí hace falta — un DUI no es secreto,
    // así que solo convertiría esto en un detector de «este DUI es cliente».
    const puedeConsultar = (codigoOk || (duiOk && telOk)) && !cargando;

    /**
     * La consulta, con lo que se va a preguntar dicho explícitamente.
     *
     * `yaEncendido` es para la entrada por QR, donde `cargando` ya nació en
     * `true`: sin él habría que encenderlo otra vez desde el efecto, y un
     * setState sincrónico ahí encadena renders sin necesidad.
     */
    const pedir = async (llave, { yaEncendido = false, consentimiento } = {}) => {
        if (!yaEncendido) { setCargando(true); setError(''); }
        const r = await consultarMisPuntos({ ...llave, consentimiento });
        setCargando(false);
        if (r.ok) {
            // La llave se guarda para poder volver a llamar cuando la persona
            // conteste los permisos: la respuesta se manda por la MISMA puerta,
            // que es la que verifica la identidad y aplica el freno por IP.
            // Mandarla por otro lado sería abrir una segunda entrada con menos
            // controles a la única escritura que esta pantalla admite.
            llaveUsada.current = llave;
            setDatos(r); setTodos(false); return;
        }
        setError(r.mensaje);
    };

    // La respuesta a los permisos. El error se muestra DENTRO de la tarjeta de
    // permisos y no en la pantalla anterior: quien acaba de tocar «Continuar»
    // está mirando ahí, y un aviso que aparece en otro lado se lee como que no
    // pasó nada.
    const responderPermisos = async (consentimiento) => {
        if (!llaveUsada.current) return;
        setGuardando(true); setErrorPermisos('');
        const r = await consultarMisPuntos({ ...llaveUsada.current, consentimiento });
        setGuardando(false);
        if (r.ok) { setDatos(r); return; }
        setErrorPermisos(r.mensaje ?? 'No se pudo guardar tu respuesta.');
    };

    const consultar = (e) => {
        e.preventDefault();
        if (!puedeConsultar) return;
        // El código manda si está completo: es el camino de quien no puede
        // entrar con su documento, y si escribió los dos, ése es el que quiso.
        return pedir(codigoOk ? { documento: codigoLimpio }
                              : { documento: dui, telefono: tel });
    };

    // Quien llegó por el QR del papel no tiene que apretar nada: el código ya
    // vino en la dirección, así que la consulta sale sola. Una sola vez —el
    // `ref` lo garantiza aunque React monte el componente dos veces en
    // desarrollo—, y sólo si de verdad venía uno.
    const yaConsultoSolo = useRef(false);
    useEffect(() => {
        if (yaConsultoSolo.current) return;
        const delEnlace = codigoDeLaDireccion();
        if (!delEnlace) return;
        yaConsultoSolo.current = true;
        pedir({ documento: delEnlace }, { yaEncendido: true }); // eslint-disable-line react-hooks/set-state-in-effect -- con `yaEncendido` no toca el estado hasta después del await, pero la regla no puede verlo
    }, []);

    const volver = () => {
        setDatos(null); setError(''); setDui(''); setTel('');
        setErrorPermisos(''); llaveUsada.current = null;
    };

    return (
        <div className="min-h-[100dvh] flex flex-col items-center px-4 py-8 sm:py-14">
            {/* `data-contenido` lo estampa `GlassViewLayout`, y esta vista no lo
                usa a propósito: no tiene menú. Sin la marca, el barrido del
                teléfono no sabe dónde termina el chasis y la cuenta como vacía
                —midió cero y el cero era del instrumento—. Se declara acá. */}
            <div className="w-full max-w-md space-y-4" data-contenido>

                <header className="flex items-center gap-3 mb-1">
                    {/* El logo aprobado, no un dibujo: fondo transparente, así que
                        sirve en los cuatro temas sin recuadro. */}
                    <img src="/Logo192.png" alt="" width="48" height="48"
                        className="w-12 h-12 shrink-0" />
                    <div className="min-w-0">
                        <h1 className="text-title-lg font-black text-content-1 leading-none">
                            Programa de Puntos
                        </h1>
                        {/* La RAZÓN SOCIAL, no el nombre del portal: «Farmalasa»
                            es el software y el cliente no tiene por qué saber que
                            existe. Sale de `EMPRESA` para que el día que cambie,
                            cambie en un solo lugar. */}
                        <p className="text-body-sm text-content-3 truncate mt-1">
                            {EMPRESA.razonSocial}
                        </p>
                    </div>
                </header>

                {!datos ? (
                    <>
                        <form onSubmit={consultar} noValidate
                            data-surface="card" className="p-4 space-y-3.5">
                            <p className="text-body-lg text-content-2 leading-relaxed">
                                Mira cuántos puntos tienes y cuánto descuento representan.
                                Son los dos datos de tu registro de cliente frecuente.
                            </p>

                            <PortalInput
                                name="dui" label="DUI" icon={CreditCard}
                                maskType="DUI" inputMode="numeric"
                                placeholder="00000000-0" value={dui} autoComplete="off"
                                disabled={codigoOk}
                                onChange={e => setDui(e.target.value)}
                            />
                            <PortalInput
                                name="telefono" label="Teléfono" icon={Phone}
                                maskType="PHONE" inputMode="tel"
                                placeholder="0000-0000" value={tel} autoComplete="tel"
                                disabled={codigoOk}
                                onChange={e => setTel(e.target.value)}
                            />

                            {/* El tercer camino, y va abajo y presentado como lo
                                que es: la salida para quien no puede entrar con
                                su documento. Arriba competiría con el camino que
                                usa casi todo el mundo. */}
                            <div className="pt-1">
                                <p className="text-body-sm text-content-3 mb-2">
                                    ¿La sala te dio un código? Úsalo aquí y no hace
                                    falta lo de arriba.
                                </p>
                                <PortalInput
                                    name="codigo" label="Código" icon={KeyRound}
                                    placeholder="K7M-P4XN" value={codigo}
                                    autoComplete="off" autoCapitalize="characters" spellCheck={false}
                                    onChange={e => setCodigo(e.target.value)}
                                />
                            </div>

                            {error && (
                                <Notice variant="warning" icon={AlertTriangle}>{error}</Notice>
                            )}

                            <Button type="submit" variant="primary" className="w-full"
                                disabled={!puedeConsultar}>
                                {cargando
                                    ? <><Loader2 size={16} className="animate-spin" /> Consultando…</>
                                    : 'Ver mis puntos'}
                            </Button>

                            <p className="text-caption text-content-3 text-center">
                                Si no aparece tu registro, pregunta en cualquiera de nuestras salas.
                            </p>
                        </form>

                        <ComoFunciona />
                    </>
                ) : faltaResponder(datos.consentimiento) ? (
                    <Permisos datos={datos} onResponder={responderPermisos}
                        guardando={guardando} error={errorPermisos} />
                ) : (
                    <Resultado datos={datos} todos={todos} setTodos={setTodos} volver={volver} />
                )}

                {/* El pie va en las DOS pantallas —el formulario y el
                    resultado— y por eso vive acá afuera: esta página pide un
                    documento de identidad y un teléfono, así que el aviso de
                    privacidad tiene que estar donde se escriben, no una
                    pantalla después (Art. 7 de la Ley para la Protección de
                    Datos Personales). */}
                <footer className="pt-2 pb-1 text-center">
                    <p className="text-caption text-content-3">
                        {EMPRESA.razonSocial} · Tel. {EMPRESA.telefono}
                    </p>
                    <a href="/privacidad"
                        className="inline-flex items-center min-h-[var(--tap-min)] px-3 mt-1
                                   text-caption text-content-3 hover:text-content-2 hover:underline
                                   transition-colors duration-[var(--dur-fast)]">
                        Aviso de privacidad
                    </a>
                </footer>
            </div>
        </div>
    );
}

/**
 * Una pregunta con dos botones, sin ninguno marcado de entrada.
 *
 * No es una casilla, y la diferencia importa: una casilla vacía significa a la
 * vez «no quiero» y «no la leí», y el Art. 27 letra d) pide que el
 * consentimiento sea inequívoco. Con dos botones no hay respuesta por omisión —
 * cualquiera de las dos exige haber tocado.
 */
function Pregunta({ texto, valor, onElegir }) {
    return (
        <div className="space-y-2.5">
            <p className="text-body text-content-2 leading-relaxed">{texto}</p>
            <div className="flex gap-2">
                <Button type="button" size="sm" className="flex-1"
                    variant={valor === true ? 'primary' : 'secondary'}
                    aria-pressed={valor === true}
                    onClick={() => onElegir(true)}>
                    Sí, acepto
                </Button>
                <Button type="button" size="sm" className="flex-1"
                    variant={valor === false ? 'primary' : 'secondary'}
                    aria-pressed={valor === false}
                    onClick={() => onElegir(false)}>
                    No
                </Button>
            </div>
        </div>
    );
}

/**
 * Los dos permisos, antes del saldo.
 *
 * Son DOS y no uno porque son dos finalidades distintas, y el Art. 27 letra b)
 * pide que el consentimiento sea específico: una sola pregunta para las dos
 * cosas no valdría para ninguna de las dos.
 *
 * El texto de cada una viene del SERVIDOR, no está escrito acá. Es el mismo
 * que se archiva como prueba, así que lo que la persona lee y lo que queda
 * guardado no pueden separarse — y el día que se reescriba, las respuestas
 * viejas conservan la redacción con la que se dieron.
 */
function Permisos({ datos, onResponder, guardando, error }) {
    const c = datos.consentimiento ?? {};
    // Arranca en lo que ya haya contestado. Para el programa eso es `false`
    // sólo si declinó antes: se le muestra su propia respuesta, no un formulario
    // en blanco que lo obligue a acordarse de qué había dicho.
    const [programa, setPrograma] = useState(c.programa ?? null);
    const [promos, setPromos] = useState(c.promociones ?? null);

    const completo = typeof programa === 'boolean' && typeof promos === 'boolean';

    return (
        <div data-surface="card" className="p-4 space-y-4">
            <div className="space-y-1">
                <h2 className="text-title font-bold text-content-1">
                    Hola, {datos.nombre}
                </h2>
                <p className="text-body-sm text-content-3 leading-relaxed">
                    Antes de mostrarte tus puntos necesitamos tu permiso para dos cosas.
                    Puedes cambiarlo cuando quieras.
                </p>
            </div>

            <Pregunta texto={c.textos?.programa} valor={programa} onElegir={setPrograma} />

            {programa === false && (
                <Notice variant="warning" bloque>
                    Sales del programa y dejas de acumular puntos. Los que ya tienes
                    quedan guardados, sin vencer y sin poder canjearse, hasta que
                    vuelvas a entrar aquí y aceptes.
                </Notice>
            )}

            <div className="h-px bg-divider" />

            <Pregunta texto={c.textos?.promociones} valor={promos} onElegir={setPromos} />

            {error && <Notice variant="danger">{error}</Notice>}

            <Button type="button" variant="primary" className="w-full"
                disabled={!completo || guardando}
                onClick={() => onResponder({ programa, promociones: promos })}>
                {guardando ? 'Guardando…' : 'Continuar'}
            </Button>

            <p className="text-caption text-content-3 leading-relaxed">
                Decir que no a las promociones no afecta tus puntos. El detalle de qué
                datos usamos y qué puedes pedirnos está en el{' '}
                <a href="/privacidad" className="underline hover:text-content-2">aviso de privacidad</a>.
            </p>
        </div>
    );
}

/**
 * Lo que se ve después de consultar.
 *
 * Sale aparte del formulario porque son dos pantallas, no dos ramas de la misma:
 * comparten el encabezado y el pie, y nada más.
 */
function Resultado({ datos, todos, setTodos, volver }) {
    const cifra = useCifraQueSube(datos.equivale);
    const puedeCanjear = datos.saldo >= MINIMO_DE_CANJE;
    const faltan = Math.max(0, MINIMO_DE_CANJE - datos.saldo);
    const avance = Math.min(100, Math.round((datos.saldo / MINIMO_DE_CANJE) * 100));

    const movimientos = datos.movimientos ?? [];
    const visibles = todos ? movimientos : movimientos.slice(0, MOVIMIENTOS_A_LA_VISTA);

    return (
        <div className="space-y-4">

            {/* ── La tarjeta ─────────────────────────────────────────────────
                El resplandor son los dos colores del logo, y es lo único
                decorativo de la pantalla: marca que esto es SU tarjeta y no una
                fila de un sistema. Va detrás del texto y sin captar el toque. */}
            <div data-surface="card" className="relative overflow-hidden p-6
                                                animate-in fade-in zoom-in-95 duration-[var(--dur-slow)]">
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="absolute -top-16 -right-10 w-44 h-44 rounded-full bg-logo-green/25 blur-[60px]" />
                    <div className="absolute -bottom-20 -left-12 w-48 h-48 rounded-full bg-logo-magenta/25 blur-[70px]" />
                </div>

                <div className="relative">
                    <p className="text-caption uppercase tracking-widest text-content-3 font-black">
                        Tienes disponible
                    </p>
                    {/* El dinero es lo grande; los puntos, el detalle que
                        explica de dónde sale. Al revés nadie lo entiende. */}
                    <p className="text-display-xl font-black text-content-1 tabular-nums leading-none my-2">
                        ${cifra.toFixed(2)}
                    </p>
                    <p className="text-body-xl text-content-2 font-bold tabular-nums">
                        {datos.saldo.toLocaleString()} puntos
                    </p>

                    <div className="h-px bg-divider my-4" />

                    {/* El nombre NO se recorta: es el de quien está mirando, y
                        «MARÍA ISABEL GUZMÁN DE HER…» se lee como que el portal
                        tiene mal su ficha. Dos líneas cuestan menos que eso. */}
                    <div className="flex items-start gap-2 min-w-0">
                        <UserRound size={14} className="text-content-3 shrink-0 mt-0.5" strokeWidth={2.5} />
                        <p className="text-body-sm text-content-2 leading-snug">
                            <span className="text-content-3">A nombre de </span>
                            <strong className="text-content-1">{datos.nombre}</strong>
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Si ya puede canjear, o cuánto le falta ─────────────────────
                Es lo único accionable de la pantalla, y por eso va pegado al
                saldo. Tres de cada cuatro clientes activos no llegan a los 100
                en seis meses, así que el caso normal es el de abajo: se dice
                cuánto falta, sin traducirlo a cuánto hay que gastar. */}
            {datos.saldo > 0 && (
                puedeCanjear ? (
                    <div data-surface="card" className="flex items-center gap-3 px-4 py-3.5">
                        <div className="w-9 h-9 rounded-btn bg-success/[0.14] flex items-center justify-center shrink-0">
                            <ShieldCheck size={16} className="text-success-text" strokeWidth={2.5} />
                        </div>
                        <p className="text-body-lg text-content-2 leading-snug">
                            <strong className="text-content-1">Ya puedes canjearlos.</strong>{' '}
                            En cualquiera de nuestras salas, mostrando tu documento.
                        </p>
                    </div>
                ) : (
                    <div data-surface="card" className="px-4 py-3.5">
                        <div className="flex items-baseline justify-between gap-3 mb-2.5">
                            <p className="text-body-lg text-content-1 font-bold">
                                Te faltan <span className="tabular-nums">{faltan.toLocaleString()}</span> puntos
                            </p>
                            <p className="text-caption text-content-3 tabular-nums shrink-0">
                                {datos.saldo} / {MINIMO_DE_CANJE}
                            </p>
                        </div>
                        <div className="w-full h-2 rounded-full bg-surface-card-hover overflow-hidden"
                            role="progressbar" aria-valuenow={avance} aria-valuemin={0} aria-valuemax={100}
                            aria-label="Avance hacia el canje mínimo">
                            <div className="h-full bg-success transition-all duration-[var(--dur-slow)]"
                                style={{ width: `${avance}%` }} />
                        </div>
                        <p className="text-caption text-content-3 mt-2">
                            El canje mínimo es de {MINIMO_DE_CANJE} puntos, o sea $1.00.
                        </p>
                    </div>
                )
            )}

            {datos.aviso && (
                <Notice variant="info" icon={Gift}>{datos.aviso}</Notice>
            )}

            {/* Cuándo vencen. Va JUNTO al saldo y no al final: es la mitad de la
                información que el saldo no da, y quien entra a ver cuánto tiene
                necesita saber hasta cuándo lo tiene. Si el servidor no pudo
                cuadrar los grupos manda la lista vacía y acá no se pinta nada —
                una fecha equivocada organiza una compra que no era. */}
            {datos.vencimientos?.length > 0 && (
                <section>
                    <Rotulo>Cuándo vencen</Rotulo>
                    <div className="space-y-1.5">
                        {datos.vencimientos.map((v) => {
                            const dias = diasHasta(v.vence);
                            const pronto = dias !== null && dias <= 30;
                            return (
                                <div key={v.vence} data-surface="card"
                                    className="flex items-center gap-3 px-3 py-2.5">
                                    <CalendarClock
                                        size={15} strokeWidth={2.5}
                                        className={`shrink-0 ${pronto ? 'text-warning' : 'text-content-3'}`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-body-lg text-content-1 font-bold tabular-nums leading-tight">
                                            {fmtFecha(v.vence)}
                                        </p>
                                        {dias !== null && (
                                            <p className="text-caption text-content-3">
                                                {dias <= 0 ? 'Vence hoy' : dias === 1 ? 'Falta 1 día' : `Faltan ${dias.toLocaleString()} días`}
                                            </p>
                                        )}
                                    </div>
                                    {pronto
                                        ? <Badge size="sm" variant="warning">{v.puntos.toLocaleString()} pts</Badge>
                                        : <span className="text-body-lg font-black tabular-nums text-content-1 shrink-0">
                                            {v.puntos.toLocaleString()} pts
                                        </span>}
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-caption text-content-3 mt-2">
                        Cada compra lleva su propia fecha, y al canjear se usan primero los más viejos.
                    </p>
                </section>
            )}

            {/* Lo ganado y lo usado desde siempre. El servidor ya los mandaba y
                la pantalla los tiraba: son los dos números que convierten un
                saldo en una historia. */}
            {(datos.acumulados > 0 || datos.canjeados > 0) && (
                <section>
                    <Rotulo>Desde que eres cliente</Rotulo>
                    <div data-surface="card" className="flex items-stretch">
                        <div className="flex-1 px-4 py-3.5 min-w-0">
                            <p className="text-caption text-content-3 font-bold">Has ganado</p>
                            <p className="text-title-sm font-black text-success-text tabular-nums leading-tight">
                                {datos.acumulados.toLocaleString()}
                            </p>
                            <p className="text-caption text-content-3">puntos</p>
                        </div>
                        <div className="w-px bg-divider my-3" />
                        <div className="flex-1 px-4 py-3.5 min-w-0">
                            <p className="text-caption text-content-3 font-bold">Has usado</p>
                            <p className="text-title-sm font-black text-chart-3-text tabular-nums leading-tight">
                                {datos.canjeados.toLocaleString()}
                            </p>
                            <p className="text-caption text-content-3">puntos</p>
                        </div>
                    </div>
                </section>
            )}

            {movimientos.length > 0 && (
                <section>
                    <Rotulo>Tus movimientos</Rotulo>
                    <div className="space-y-1.5">
                        {visibles.map((m, i) => <Movimiento key={`${m.fecha}-${i}`} m={m} />)}
                    </div>
                    {movimientos.length > MOVIMIENTOS_A_LA_VISTA && (
                        <Button variant="ghost" size="sm" onClick={() => setTodos(v => !v)}
                            className="w-full mt-2">
                            {todos
                                ? <><ChevronUp size={14} /> Ver sólo los últimos</>
                                : <><ChevronDown size={14} /> Ver los {movimientos.length - MOVIMIENTOS_A_LA_VISTA} anteriores</>}
                        </Button>
                    )}
                </section>
            )}

            <ComoFunciona />

            <Button variant="ghost" onClick={volver} className="w-full">
                <ArrowLeft size={16} /> Hacer otra consulta
            </Button>
        </div>
    );
}
