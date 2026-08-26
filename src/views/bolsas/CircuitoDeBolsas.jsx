import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import {
    AlertTriangle, Banknote, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, HandCoins, Inbox, Landmark, Package, Printer, Scale, Send, ShieldCheck,
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
    confirmarConteo, desmarcarConteoBolsa, fetchBolsas, fetchBolsasConDiferencia,
    fetchPersonasDeBolsas, fetchPorDepositar, fetchSaldos, marcarConteoBolsa,
    recibirBolsas, resolverDiferenciaBolsa,
} from '../../data/bolsas';
import { clickable } from '../../utils/clickable';
import { tokenMatch } from '../../utils/searchUtils';
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

/* Y el depósito al banco: sólo hace falta al cerrar el día, después de haber
 * confirmado un conteo. */
const DepositoAlBanco = lazy(() => import('../../components/bolsas/DepositoAlBanco'));

/* Y el archivo de los depósitos: arrastra `DataTable`, y sólo se mira cuando
 * alguien va a cuadrar contra el banco. */
const DepositosAlBanco = lazy(() => import('../../components/bolsas/DepositosAlBanco'));

/**
 * El proceso entero de una bolsa de efectivo, una etapa por vez.
 *
 * Pedido del usuario (2026-08-15): «el widget es para acceder fácil, pero debe
 * haber una vista donde se haga todo el proceso, donde cuando se cuente el
 * dinero en admin se ponga que todo bien». Esto es esa vista. Vivió como
 * pestaña de Cortes de caja hasta el 2026-08-24, y hoy es su propio módulo —
 * el porqué está en `BolsasView`.
 *
 * ── Las etapas eran cuatro bloques apilados; hoy son PESTAÑAS ───────────────
 * «me estoy perdiendo en los pasos, al tener tantos, me pierdo y no sé dónde
 * está qué» (usuario, 2026-08-24).
 *
 * Hasta ese día las cuatro etapas se dibujaban una debajo de la otra, en el
 * orden en que pasan las cosas, con el argumento de que verlas en fila explica
 * el circuito sin que nadie lo enseñe. El argumento era bueno y el resultado
 * fue otro: con los dos avisos de arriba, las diferencias sin resolver, las
 * cuatro etapas y el archivo de depósitos, la pantalla llegó a OCHO bloques
 * apilados —tres de ellos plegados— y encontrar algo pasó a ser scrollear y
 * abrir. Un diseño que hay que recorrer entero para saber qué hay no explica
 * nada: esconde.
 *
 * La etapa activa vive en la DIRECCIÓN (`usePestanaEnUrl`, en `BolsasView`) y
 * el precio de esconder las otras tres lo paga el CONTADOR de cada píldora:
 * la fila dice «En la sala 3 · Esperando 0 · Por contar 5 · Finalizadas 12»
 * sin abrir ninguna. Sin ese número la separación sería justamente el defecto
 * que este circuito no puede tener —una bolsa trabada seis días detrás de una
 * pestaña que nadie abre—, y por eso el contador se construyó ANTES de partir
 * la pantalla, no después.
 *
 * Y por eso el buscador filtra las CUATRO etapas y no sólo la abierta: al
 * escribir un folio, los contadores dicen en qué pestaña cayó. Ésa es la otra
 * mitad de «no sé dónde está qué» — la primera es cuánto trabajo hay en cada
 * paso, la segunda es dónde quedó ESTA bolsa.
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
 * ── Las acciones viven en la píldora, y son las de la ETAPA abierta ─────────
 * «los botones de sacar dinero, entregar dinero, deben estar en el filterpill»
 * (usuario, 2026-08-17). Es §17 al pie de la letra: `FilterBar` lleva los
 * filtros de la vista **y sus acciones**. Estaban colgados de la etapa «En la
 * sala», que además las escondía al hacer scroll.
 *
 * La píldora la dibuja `BolsasView` —una por vista—, así que este motor las
 * PUBLICA por `onAcciones` y sigue siendo dueño de sus diálogos. Al revés (que
 * el padre supiera cuántas bolsas hay en la sala para poder deshabilitarlas)
 * habría que cargar las bolsas dos veces.
 *
 * Cambian con la pestaña porque el trabajo cambia con la pestaña: en la sala se
 * saca y se entrega, en «Finalizadas» se deposita al banco. Una píldora con las
 * cuatro acciones de las cuatro etapas ofrecería en cada pantalla tres botones
 * que no son de ahí.
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


/* «Hoy» / «Ayer» y si no la fecha corta. Es el MISMO rótulo que usa el diálogo
 * de entrega para agrupar por día — dos formas distintas de nombrar el mismo día
 * en dos pantallas del mismo circuito obligan a traducir mentalmente. */
const correrDia = (fecha, dias) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};
const rotularDia = (fecha) => {
    const hoy = hoySV();
    if (fecha === hoy) return 'Hoy';
    if (fecha === correrDia(hoy, -1)) return 'Ayer';
    return fechaCorta(fecha);
};

/* ── Qué se ve plegado dentro de «Finalizadas», y por qué se recuerda ───────
 *
 * «que las secciones sean plegables, asi solo se ve lo que mas interesa. por
 * ejemplo contadas no lo necesito ver» (usuario, 2026-08-24).
 *
 * Ese pedido lo cumplían los chevrones cuando las cuatro etapas vivían
 * apiladas. Desde que son pestañas lo cumple la pestaña —abrir una es cerrar
 * las otras tres— y lo único que sigue compartiendo pantalla con otra cosa es
 * lo que hay dentro de «Finalizadas»: el archivo de bolsas contadas y el
 * archivo de depósitos al banco.
 *
 * Ahí el plegado sigue valiendo, y con un cambio: **«Contadas» ya no arranca
 * cerrada**. Antes lo hacía porque nadie entraba a la pantalla a mirar el
 * archivo; ahora, quien abre la pestaña «Finalizadas» entró a eso. Los
 * depósitos sí siguen cerrados: son la otra pregunta, la de cuadrar contra el
 * banco, y sólo se abre cuando toca.
 *
 * Se guarda en el navegador y NO en la dirección, a diferencia de la pestaña
 * activa (`usePestanaEnUrl`). Son dos cosas distintas: la pestaña es a dónde
 * fuiste —se comparte con un enlace y se pierde al recargar—, y esto es cómo te
 * gusta ver la pantalla, que es de esta persona y de este equipo. Pegarlo a la
 * URL obligaría a que un enlace compartido impusiera el gusto de quien lo mandó.
 *
 * Cada lectura y cada escritura va en `try`: en una ventana privada, o con el
 * navegador configurado para bloquear datos de sitio, el acceso LANZA — y una
 * pantalla de dinero no se puede quedar en blanco por una preferencia.
 */
const CLAVE_PLEGADO = 'bolsas:etapas-cerradas';
const CERRADAS_LA_PRIMERA_VEZ = ['depositos'];

function usePlegado() {
    const [cerradas, setCerradas] = useState(() => {
        try {
            const guardado = localStorage.getItem(CLAVE_PLEGADO);
            if (guardado) return new Set(JSON.parse(guardado));
        } catch { /* sin almacenamiento: se usa el default y no se guarda */ }
        return new Set(CERRADAS_LA_PRIMERA_VEZ);
    });

    const guardar = (n) => {
        try { localStorage.setItem(CLAVE_PLEGADO, JSON.stringify([...n])); } catch { /* ídem */ }
        return n;
    };

    const alternar = useCallback((clave) => setCerradas((s) => {
        const n = new Set(s);
        if (n.has(clave)) n.delete(clave); else n.add(clave);
        return guardar(n);
    }), []);

    /* Ya no hay «abrir a la fuerza»: lo usaba la recepción para que las bolsas
     * que acababan de pasar a «Por contar» no aterrizaran dentro de una sección
     * cerrada, y eso hoy lo resuelve el cambio de pestaña. */
    return { cerradas, alternar };
}

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
/* Antes de contar hay que saber contra qué. La tarjeta muestra la cifra sola y
 * arriba a la derecha; cuando la bolsa tiene vales adentro eso no alcanza —el
 * dinero que debe haber ya no es el que se guardó, y quien cuenta necesita
 * saber cuánto se llevaron los papeles sin abrir el detalle—.
 *
 * Va detrás de `bolsas_ver_montos` como toda cifra de esta pantalla. Jefe/a de
 * Compras cuenta dinero y no ve montos: es una decisión vieja del usuario, no un
 * descuido, y esto no la cambia. */
function Conteo({ bolsa, ocupado, ocupadoDesmarcar, onContar, onDesmarcar, verMontos }) {
    const [abierto, setAbierto] = useState(false);
    const [valor, setValor] = useState('');
    const vales = Number(bolsa.vales || 0);

    const guardar = () => {
        const n = Number(String(valor).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) return;
        onContar(bolsa, n);
        setAbierto(false);
        setValor('');
    };

    /* ── Ya contada, pero todavía no cerrada ────────────────────────────────
     * La bolsa se queda acá con su monto escrito hasta que se confirme la tanda.
     * Se muestra el resultado —cuadró, o cuánto faltó/sobró— y el camino de
     * vuelta: mientras el conteo no esté confirmado, contar de nuevo es gratis.
     * Ése es justamente el punto de haberlo separado en dos pasos. */
    if (bolsa.conteo_marcado != null) {
        const dif = Math.round((Number(bolsa.conteo_marcado) - saldoDe(bolsa)) * 100) / 100;
        const cuadra = Math.abs(dif) < 0.01;
        return (
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap w-full">
                {cuadra
                    ? <Badge variant="success" size="sm" icon={CheckCircle2}>Cuadró</Badge>
                    : (
                        <Badge variant={dif < 0 ? 'danger' : 'warning'} size="sm" dot>
                            {dif < 0 ? 'Faltó' : 'Sobró'}
                            {verMontos ? ` ${formatMoney(Math.abs(dif))}` : ''}
                        </Badge>
                    )}
                {verMontos && (
                    <span className="text-caption text-content-2 tabular-nums">
                        Se contaron <b className="text-content">{formatMoney(bolsa.conteo_marcado)}</b>
                    </span>
                )}
                <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
                    <Button variant="ghost" size="sm" loading={ocupadoDesmarcar}
                        onClick={() => onDesmarcar(bolsa)}>
                        Contar de nuevo
                    </Button>
                </div>
            </div>
        );
    }

    if (!abierto) {
        return (
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap w-full">
                {verMontos && (
                    <span className="text-caption text-content-2 tabular-nums">
                        Debe haber <b className="text-content">{formatMoney(saldoDe(bolsa))}</b>
                        {vales > 0 && (
                            <span className="text-content-3">
                                {' '}· {bolsa.salidas} {Number(bolsa.salidas) === 1 ? 'vale' : 'vales'}
                                {' '}por {formatMoney(vales)} adentro
                            </span>
                        )}
                    </span>
                )}
                <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
                <Button variant="secondary" size="sm" icon={Scale} onClick={() => setAbierto(true)}>
                    No cuadra
                </Button>
                {/* El camino de un toque es el que va a usarse en casi todas, así
                    que es el botón primario y manda el monto que la pantalla
                    mostró — el servidor lo recalcula y rechaza si cambió.

                    Y ese monto es el SALDO, nunca `monto_inicial`. Mandaba el
                    inicial, y en una bolsa con vales adentro los dos no son lo
                    mismo: «Cuadra» escribía como contado el dinero que se
                    guardó, contra un esperado que ya tenía restado lo que
                    salió. O sea que apretar el botón que dice que todo está
                    bien registraba un SOBRANTE del tamaño de los vales, y
                    disparaba el aviso «Sobró dinero en una bolsa» a la sala.
                    Medido el 2026-08-24: S3-1086 va a contarse con $625.48
                    guardados y $31.67 adentro — el botón habría inventado
                    $593.81 de sobrante. */}
                <Button variant="primary" size="sm" icon={CheckCircle2} loading={ocupado}
                    onClick={() => onContar(bolsa, saldoDe(bolsa))}>
                    Cuadra
                </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 flex-wrap w-full">
            <span className="text-caption text-content-2">
                Se contaron
                {verMontos && (
                    <span className="text-content-3 tabular-nums">
                        {' '}(debía haber {formatMoney(saldoDe(bolsa))})
                    </span>
                )}
            </span>
            <PortalInput
                compact
                name={`contado-${bolsa.id}`}
                aria-label={`Cuanto se conto en la bolsa ${bolsa.folio}`}
                inputMode="decimal" maskType="DECIMAL"
                value={valor} onChange={(e) => setValor(e.target.value)}
                placeholder={String(saldoDe(bolsa))}
                className="w-32"
                inputClassName="tabular-nums"
            />
            <div className="flex items-center gap-1.5 ml-auto">
                <Button variant="ghost" size="sm" onClick={() => { setAbierto(false); setValor(''); }}>
                    Cancelar
                </Button>
                <Button variant="primary" size="sm" loading={ocupado} disabled={valor === ''}
                    onClick={guardar}>
                    Anotar
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
function Etapa({ icon: Icon, titulo, ayuda, grupos, total, montoTotal, accion, accionDeGrupo,
    elegidasDe, vacio, verMontos, plegada = false, onPlegar }) {
    /* El desglose por día de TODA la etapa: junta los días de las seis salas.
     * Del más reciente al más viejo, que es como se pregunta («¿y lo de hoy?»).
     * Es una vuelta sobre lo que ya está agrupado, no una consulta más. */
    const porFecha = new Map();
    for (const g of grupos) {
        for (const d of (g.dias ?? [])) {
            if (!porFecha.has(d.fecha)) porFecha.set(d.fecha, { fecha: d.fecha, lista: [] });
            porFecha.get(d.fecha).lista.push(...d.lista);
        }
    }
    const resumenPorDia = [...porFecha.values()]
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    return (
        <section className="space-y-2">
            {/* El encabezado ENTERO pliega, y el conteo se queda visible al
                cerrar: es lo que hace que una sección cerrada siga informando —
                «Contadas · 12 bolsas» sin las doce tarjetas. Si el número
                desapareciera con el contenido, cerrar sería esconder.

                Pero sólo pliega SI HAY con qué compartir la pantalla. Desde que
                las etapas son pestañas, las tres pendientes son lo único que
                hay en la suya: un chevron ahí no ahorra nada y, peor, dibuja un
                control que promete esconder lo único que se vino a ver. Sin
                `onPlegar` el encabezado es un título y no un botón — y no un
                botón deshabilitado, que sería un blanco de dedo de 44px que no
                hace nada (§15.8). */}
            <div className="flex items-baseline justify-between gap-3 px-1 flex-wrap">
                <h3 className="text-label font-bold text-content">
                    {onPlegar ? (
                        <button type="button" onClick={onPlegar} aria-expanded={!plegada}
                            className="flex items-center gap-2 min-h-[var(--tap-min)] text-left
                                       hover:text-content-2 transition-colors">
                            {plegada ? <ChevronDown size={14} className="text-content-3 shrink-0" />
                                : <ChevronUp size={14} className="text-content-3 shrink-0" />}
                            <Icon size={15} className="text-content-3" />
                            {titulo}
                        </button>
                    ) : (
                        <span className="flex items-center gap-2 text-left">
                            <Icon size={15} className="text-content-3" />
                            {titulo}
                        </span>
                    )}
                </h3>
                {/* Los TRES totales de la pantalla, de mayor a menor: éste es el
                    de la etapa entera. Va con más peso que su cuenta de bolsas
                    porque es la cifra contra la que se cuadra el trabajo del
                    día — el número de bolsas dice cuánto falta hacer, el monto
                    dice cuánto dinero hay en juego. */}
                <span className="text-caption text-content-3 tabular-nums">
                    {total} {total === 1 ? 'bolsa' : 'bolsas'}
                    {verMontos && total > 0 && (
                        <> · <b className="text-label font-bold text-content">{formatMoney(montoTotal)}</b></>
                    )}
                </span>
            </div>
            {!plegada && ayuda && <p className="text-caption text-content-3 px-1">{ayuda}</p>}

            {/* ── La franja de totales ────────────────────────────────────────
                «aun no veo tan claro la informacion, se ve pequeno, no tiene
                peso, no veo la venta diaria total y la venta del total de las
                bolsas» (usuario, 2026-08-24).

                Los números ESTABAN —en el encabezado, en el de cada sala, en el
                de cada día— y los tres vivían en texto de 11px, gris, alineado a
                la derecha. Un dato que hay que buscar no está puesto: quien
                cuenta dinero necesita leer de un vistazo cuánto tiene que
                cuadrar, y eso no se lee en una nota al pie.

                Acá va el total de la etapa a 26px y el desglose por día a 18px,
                los dos en negrita y con cifras alineadas. El desglose es de la
                ETAPA entera, no de una sala: es la pregunta de quien tiene las
                bolsas de todas las salas sobre la mesa.

                Sin `bolsas_ver_montos` no hay franja — no es que se muestre
                vacía: sin cifras no queda nada que mostrar. */}
            {!plegada && verMontos && total > 0 && (
                <div data-surface="card"
                    className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 px-4 py-3">
                    <div>
                        <div className="text-display font-black tabular-nums text-content leading-none">
                            {formatMoney(montoTotal)}
                        </div>
                        <div className="text-caption text-content-2 mt-1.5">
                            en {total} {total === 1 ? 'bolsa' : 'bolsas'}
                        </div>
                    </div>
                    {resumenPorDia.length > 1 && (
                        <div className="flex flex-wrap gap-x-8 gap-y-3">
                            {resumenPorDia.map((d) => (
                                <div key={d.fecha}>
                                    <div className="text-micro font-black uppercase tracking-widest text-content-3">
                                        {rotularDia(d.fecha)}
                                    </div>
                                    <div className="text-title-sm font-bold tabular-nums text-content mt-0.5">
                                        {formatMoney(suma(d.lista))}
                                    </div>
                                    <div className="text-micro text-content-3 tabular-nums">
                                        {d.lista.length} {d.lista.length === 1 ? 'bolsa' : 'bolsas'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {!plegada && accion}
            {plegada ? null : total === 0
                ? <EmptyState linea icon={Icon} title={vacio} />
                : grupos.map((g) => {
                    /* Lo elegido DENTRO de esta sala. El encabezado de la sala y
                       su botón hablan de lo que se va a hacer, no de lo que la
                       sala mandó: quien recibe tiene seis bolsas en la mano,
                       marca seis, y necesita leer «6 de 10 · $x» ahí mismo, al
                       lado de las casillas.
                       Sin esto el botón decía «Recibir las 10» con las seis
                       marcadas al lado —y recibía las diez—, así que recibir
                       parcialmente era imposible por el único control que se ve
                       junto a la sala. */
                    const elegidasAca = elegidasDe?.(g.lista) ?? VACIO;
                    const parcial = elegidasAca.length > 0 && elegidasAca.length < g.lista.length;
                    const enJuego = parcial ? elegidasAca : g.lista;
                    return (
                    <div key={g.branchId} className="space-y-1.5">
                        {/* La acción de grupo va en el encabezado de la sala
                            porque recibir se hace POR SALA: llega el recolector
                            con las de Salud 3 y se acusan todas juntas. Marcar
                            casilla por casilla existe para el caso en que
                            faltó alguna, que es el raro. */}
                        <div className="flex items-baseline justify-between gap-3 px-1">
                            <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                {g.nombre}
                            </h4>
                            <span className="flex items-baseline gap-2 shrink-0">
                                {/* El segundo de los tres totales: el de la sucursal.
                                    Baja un escalón de peso respecto al de la etapa y
                                    sube uno respecto al del día, para que la jerarquía
                                    se lea sin leer los rótulos.
                                    Con una selección parcial dice las DOS cifras
                                    —«6 de 10»— porque sola, la de la selección se
                                    lee como si la sala hubiera mandado seis. */}
                                <span className="text-caption text-content-3 tabular-nums shrink-0">
                                    {parcial
                                        ? `${enJuego.length} de ${g.lista.length} bolsas`
                                        : `${g.lista.length} ${g.lista.length === 1 ? 'bolsa' : 'bolsas'}`}
                                    {verMontos && (
                                        <> · <b className="text-body-xl font-bold text-content">{formatMoney(suma(enJuego))}</b></>
                                    )}
                                </span>
                                {accionDeGrupo?.(g, enJuego, parcial)}
                            </span>
                        </div>
                        {/* Un renglón por día, con lo suyo. El día sale igual con
                            uno solo: saber de qué día es lo que se está contando
                            nunca sobra, y es lo primero que se pregunta quien
                            tiene la bolsa en la mano. */}
                        {(g.dias ?? [{ fecha: null, lista: g.lista }]).map((d) => {
                            /* El día sigue a la sala: si arriba dice «6 de 10»,
                               los renglones de abajo tienen que sumar esas seis.
                               Que uno cuente lo elegido y el otro lo mandado
                               deja dos cifras que no cierran entre sí, y quien
                               cuadra dinero contra el papel no sabe cuál mirar. */
                            const elegidasDelDia = parcial ? elegidasDe?.(d.lista) ?? VACIO : d.lista;
                            return (
                            <div key={d.fecha ?? 'todo'} className="space-y-1.5">
                                {d.fecha && (
                                    <div className="flex items-baseline justify-between gap-3 px-1">
                                        <span className="text-subtitle font-bold text-content-2">
                                            {rotularDia(d.fecha)}
                                        </span>
                                        {/* Con un solo día su cuenta sería la de la sala,
                                            palabra por palabra, así que ahí se calla: repetir
                                            la misma cifra dos renglones seguidos enseña a no
                                            leer ninguna de las dos. Cuando SÍ dice algo
                                            distinto, se dice con tamaño de leerse. */}
                                        {(g.dias?.length ?? 1) > 1 && (
                                            <span className="text-caption text-content-3 tabular-nums shrink-0">
                                                {parcial
                                                    ? `${elegidasDelDia.length} de ${d.lista.length} bolsas`
                                                    : `${d.lista.length} ${d.lista.length === 1 ? 'bolsa' : 'bolsas'}`}
                                                {verMontos && (
                                                    <> · <b className="font-bold text-content-2">{formatMoney(suma(elegidasDelDia))}</b></>
                                                )}
                                            </span>
                                        )}
                                    </div>
                                )}
                                <div className="grid gap-2 grid-cols-1 xl:grid-cols-2">
                                    {d.lista.map((b) => b.nodo)}
                                </div>
                            </div>
                            );
                        })}
                    </div>
                    );
                })}
        </section>
    );
}

export default function CircuitoDeBolsas({
    etapa = 'sala', busqueda = '',
    desde, hasta, sala, nombreSala,
    onAcciones, onMetricas, onConteos, onAmpliarPeriodo, onIrAEtapa,
}) {
    const { hasPermission, getScope } = useAuth();
    /* ── La sala ve SU etapa; el resto del circuito es de administración ──
     *
     * «para las salas de venta, solo debe salir en la sala, nada mas. las demas
     * secciones son para los que tienen alcance todos» (usuario, 2026-08-24).
     *
     * Las otras tres etapas describen trabajo que la sala no hace y no puede
     * hacer: confirmar la recepción y contar el dinero exigen `bolsas_conteo`,
     * que ningún cargo de sala tiene. Dibujárselas era mostrarle tres bloques
     * de sólo lectura sobre el efectivo de las otras cinco salas, y enterrar el
     * único que sí es suyo debajo de ellos.
     *
     * El alcance sale de `bolsas` y no de un cargo escrito acá: los cuatro
     * cargos de sala están en `BRANCH` y los cuatro de administración en `ALL`,
     * y el día que se cree un cargo nuevo la pantalla lo acompaña sola.
     * Terminal idéntico al de `auth_module_scope()` en la base. */
    const alcanceTodos = getScope('bolsas') === 'ALL';
    const puedeEntregar = hasPermission('bolsas', 'can_edit');
    const puedeContar = hasPermission('bolsas_conteo', 'can_edit');
    const verMontos = hasPermission('bolsas_ver_montos');
    const verCards = hasPermission('bolsas_ver_cards');
    const showToast = useToastStore((s) => s.showToast);
    const empleados = useStaff((st) => st.employees);

    const [bolsas, setBolsas] = useState([]);
    /* Las diferencias sin resolver vienen APARTE y sin fechas: son lo único que
     * no puede depender del período (ver `fetchBolsasConDiferencia`), y para una
     * sala son lo único que vuelve después de entregar. */
    const [diferencias, setDiferencias] = useState([]);
    /* Lo contado y todavía sin llevar al banco. Viene SIN rango, como las
     * diferencias: efectivo confirmado que no se depositó es un pendiente,
     * y un pendiente no puede desaparecer por mover unas fechas. */
    const [porDepositar, setPorDepositar] = useState([]);
    const [depositando, setDepositando] = useState(false);
    const { cerradas, alternar: plegar } = usePlegado();
    /* El instante de la última lectura. «Entregada hace más de un día» se mide
     * contra ESTO y no contra `Date.now()` en el render: leer el reloj mientras
     * se dibuja hace que dos renders del mismo estado den resultados distintos
     * (`react-hooks/purity`). Y además es más honesto — la antigüedad es contra
     * los datos que hay en pantalla, que son los de esta lectura. */
    const [leidoEn, setLeidoEn] = useState(() => Date.now());
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

    /* `silencioso` = volver a bajar los datos SIN borrar la pantalla.
     *
     * `setCargando(true)` reemplaza la vista entera por «Buscando las bolsas»,
     * y eso está bien la primera vez y al mover el período —lo que se va a
     * mostrar es otra cosa—. Después de una acción es lo contrario: el
     * contenido es casi el mismo, y borrarlo devuelve el scroll al tope y hace
     * parpadear todo. Contando bolsa por bolsa, eso pasaba en CADA toque. */
    const cargar = useCallback(async ({ silencioso = false } = {}) => {
        if (!silencioso) setCargando(true);
        // Las pendientes se BAJAN todas y se recortan acá; las contadas ya vienen
        // del período, **por la fecha en que se CONTARON** — filtrarlas por la
        // fecha del corte hacía que una bolsa vieja recién contada desapareciera
        // de la pantalla al firmarla.
        //
        // Se bajan todas y no sólo las del rango porque el aviso de «hay N
        // pendientes fuera de estas fechas» necesita saber que existen: son las
        // que el filtro esconde, y esconderlas sin decirlo es justo lo que no
        // puede pasar con dinero esperando en una sala.
        const [vivas, contadas, conDif] = await Promise.all([
            fetchBolsas({ estados: ['ABIERTA', 'ENTREGADA', 'RECIBIDA'] }),
            fetchBolsas({ desde, hasta, estados: ['CONTADA'], porFechaDeConteo: true }),
            fetchBolsasConDiferencia(),
        ]);
        const paraBanco = await fetchPorDepositar();
        // Una diferencia puede estar además dentro del rango: se deduplica por
        // id para no dibujar la misma bolsa dos veces en «Contadas».
        const vistas = new Set((contadas || []).map((b) => b.id));
        const todas = [...(vivas || []), ...(contadas || []),
            ...(conDif || []).filter((b) => !vistas.has(b.id))];
        // El saldo va pegado a la bolsa desde el principio: si llegara después,
        // la pantalla mostraría por un instante el monto guardado como si fuera
        // el efectivo que hay adentro.
        const saldos = await fetchSaldos(todas.map((b) => b.id));
        setBolsas(todas.map((b) => ({ ...b, ...(saldos.get(b.id) || {}) })));
        setDiferencias((conDif || []).map((b) => ({ ...b, ...(saldos.get(b.id) || {}) })));
        setPorDepositar(paraBanco || []);
        setLeidoEn(Date.now());
        setCargando(false);
        const firmas = todas.flatMap((b) => [b.cerrada_por, b.entregada_por, b.recibida_por, b.contado_por, b.dif_por]);
        const gente = await fetchPersonasDeBolsas(firmas);
        setPersonas(new Map(gente.map((p) => [p.id, p])));
    }, [desde, hasta]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al entrar y al mover el período

    const deLaSala = useMemo(
        () => (sala ? bolsas.filter((b) => String(b.branch_id) === String(sala)) : bolsas),
        [bolsas, sala],
    );

    /* ── El buscador recorta las CUATRO etapas, no la abierta ───────────────
     *
     * Es la mitad del pedido que las pestañas solas no cubren: «no sé dónde
     * está qué» es dos preguntas, y la segunda es dónde quedó ESTA bolsa. Al
     * filtrar las cuatro, el contador de cada píldora contesta en cuál cayó —
     * escribir un folio deja la fila en «En la sala 0 · Esperando 1 · Por
     * contar 0 · Finalizadas 0» y el trabajo de buscar ya está hecho.
     *
     * Filtrar sólo la etapa abierta habría sido peor que no tener buscador:
     * daría cero resultados sobre una bolsa que existe, y quien lo lea concluye
     * que la bolsa no está en el sistema.
     *
     * Va por `tokenMatch` —el canónico de §24— sobre lo que alguien tiene a
     * mano cuando pregunta por una bolsa: el folio de la etiqueta pegada, la
     * sala, el día, la caja, el monto y quién la firmó. El nombre sale del
     * padrón de empleados y no del `Map` de `personas`, que llega DESPUÉS de la
     * primera pintada: buscar por un nombre y no encontrarlo durante un segundo
     * es la clase de resultado que enseña a desconfiar del buscador. */
    const coincide = useCallback((b) => {
        if (!busqueda.trim()) return true;
        return tokenMatch(busqueda,
            b.folio, nombreSala[b.branch_id], b.fecha, rotularDia(b.fecha), b.hora, b.caja,
            String(b.monto_inicial ?? ''), String(b.saldo ?? ''), String(b.contado ?? ''),
            nombrePersona.get(b.cerrada_por), nombrePersona.get(b.entregada_por),
            nombrePersona.get(b.recibida_por), nombrePersona.get(b.contado_por));
    }, [busqueda, nombreSala, nombrePersona]);

    /* Con alcance de una sala la pantalla es UNA etapa, así que todo lo que se
     * cuenta —el vacío, lo que el rango dejó afuera, el aviso— se cuenta sobre
     * las bolsas que están en la sala y nada más. Filtrar sólo al dibujar
     * dejaría a un dependiente leyendo «3 bolsas pendientes quedaron fuera de
     * estas fechas» sin ninguna sección donde pudieran aparecer. */
    const delAlcance = useMemo(
        () => (alcanceTodos ? deLaSala : deLaSala.filter((b) => b.estado === 'ABIERTA'))
            .filter(coincide),
        [deLaSala, alcanceTodos, coincide],
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
        () => delAlcance.filter((b) => b.estado !== 'CONTADA' && !enRango(b)),
        [delAlcance, enRango],
    );

    const enPantalla = useMemo(
        () => delAlcance.filter((b) => b.estado === 'CONTADA' || enRango(b)),
        [delAlcance, enRango],
    );

    // La fecha de la pendiente más vieja que quedó afuera: es hasta dónde tiene
    // que estirarse el período para que el aviso deje de tener razón.
    // El rango no trajo NADA. Con las cuatro etapas dibujadas eso son cuatro
    // encabezados, cuatro líneas de ayuda y cuatro cajas de «no hay» apiladas —
    // media pantalla explicando un vacío. Se dice una vez.
    // Las diferencias sin resolver se dibujan aparte y sin período, así que
    // una pantalla con diferencias NO está vacía: decir «sin bolsas en estas
    // fechas» arriba de una bolsa que falta cuadrar es contradecirse.
    const vacioTotal = enPantalla.length === 0 && !(!alcanceTodos && diferencias.length > 0);

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

    /* Sale del servidor y NO de `contadas`, que viene recortada por el período:
     * una diferencia sin resolver de hace tres semanas desaparecía de la tarjeta
     * por dejar el rango en «Hoy», y es justo la que más hay que ver. El filtro
     * de sala es el mismo de la vista; el de alcance lo puso ya la policy. */
    const sinResolver = useMemo(
        () => (sala ? diferencias.filter((b) => String(b.branch_id) === String(sala)) : diferencias)
            .filter(coincide),
        [diferencias, sala, coincide],
    );

    // Las que además quedaron fuera del rango: el aviso no puede decir «están
    // abajo, en Contadas» sobre una bolsa que el período no dibuja.
    /* Las que ya se contaron y esperan el cierre, y las que faltan. El botón de
     * confirmar sale de acá: mientras haya alguna sin contar lo dice, pero no
     * bloquea — puede faltar una sala que no llegó, y lo ya contado no tiene por
     * qué quedar en el aire por eso. */
    const marcadas = useMemo(
        () => porContar.filter((b) => b.conteo_marcado != null),
        [porContar],
    );
    const sinMarcar = useMemo(
        () => porContar.filter((b) => b.conteo_marcado == null),
        [porContar],
    );

    const sinResolverFuera = useMemo(
        () => sinResolver.filter((b) => !enRango(b)),
        [sinResolver, enRango],
    );

    // Entregadas hace más de un día y todavía sin recibir. Se mide contra
    // `entregada_at` —cuándo salió de la sala— y no contra la fecha del corte:
    // una bolsa vieja entregada hace diez minutos no tiene nada de malo.
    const enCaminoViejas = useMemo(
        () => enCamino.filter((b) => b.entregada_at
            && leidoEn - Date.parse(b.entregada_at) > 24 * 3600_000),
        [enCamino, leidoEn],
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

    /**
     * El plomería de toda acción: ocupado, error, aviso y refresco.
     *
     * `recargar: false` es para las acciones que YA saben qué cambió. Los RPC
     * de conteo devuelven `RETURNS public.bolsas`, o sea la fila entera y
     * fresca: volver a bajar las bolsas después es pedirle al servidor algo que
     * ya está en la mano, y encima cuatro viajes (las vivas, las contadas, las
     * de diferencia, los saldos y la gente). Esas acciones pasan `conLaFila`
     * para pegar lo que volvió, y no recargan nada.
     */
    const correr = useCallback(async (clave, fn, exito, { recargar = true, conLaFila } = {}) => {
        setOcupado(clave);
        const { data, error } = await fn();
        setOcupado(null);
        if (error) {
            showToast?.('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return false;
        }
        showToast?.(exito, '', 'success');
        setElegidas(new Set());
        conLaFila?.(data);
        if (recargar) cargar({ silencioso: true });
        return true;
    }, [showToast, cargar]);

    /* Pega en su sitio la fila que devolvió el RPC, sin bajar nada.
     *
     * Se SUPERPONE (`{ ...b, ...fila }`) y no reemplaza: `saldo`, `vales` y
     * `salidas` no son columnas de `bolsas` —salen de `get_bolsas_saldos` y se
     * pegan al cargar—, así que reemplazar la fila las borraría y `saldoDe`
     * caería a `monto_inicial`. En una bolsa con vales adentro esos dos números
     * son distintos, que es exactamente el error que costó el sobrante
     * inventado de v2.743.x. */
    const parchar = useCallback((fila) => {
        if (!fila?.id) return;
        setBolsas((prev) => prev.map((b) => (b.id === fila.id ? { ...b, ...fila } : b)));
    }, []);

    /* `cargar` NO se pasa pelada a un hijo: ahora recibe opciones, así que el
     * argumento con que el hijo llame al callback decidiría si la pantalla se
     * borra. Envuelta, la decisión se queda acá. */
    const recargarEnSilencio = useCallback(() => { cargar({ silencioso: true }); }, [cargar]);

    /**
     * Entregar NO imprime nada (usuario, 2026-08-24: «al enviar las bolsas de
     * efectivo, imprime un ticket, eso no debe de pasar. ya queda registrado»).
     *
     * Hasta acá salía un comprobante para que lo firmaran la sala y quien se
     * lleva el dinero. El papel no agregaba nada: la entrega ya queda con su
     * folio, su hora y las DOS personas —quien entregó y quien retiró, ésta
     * identificada por su carné contra el servidor—, y la recepción la firma
     * después administración. Un papel más no prueba nada que el registro no
     * pruebe mejor, y obliga a la sala a tener ticketera para poder entregar.
     *
     * Los papeles que SÍ siguen: la etiqueta de afuera de la bolsa y el vale de
     * adentro. Esos dos viven en el mundo físico —se pegan y se guardan dentro
     * de la bolsa— y son contra lo que administración cuenta.
     */
    const trasLaEntrega = recargarEnSilencio;

    /* Confirmar la recepción MUEVE la bolsa de pestaña: sale de «Esperando
     * recepción» y aparece en «Por contar». Sin llevar a quien apretó, el botón
     * se ve como que las bolsas se borraron — la etapa de origen se queda vacía
     * y lo que pasó está en otra pantalla.
     *
     * Con las etapas apiladas esto era abrir la sección y hacer scroll; con
     * pestañas es cambiar de pestaña, que además deja la dirección apuntando a
     * donde quedó el trabajo. El aviso lo dice igual, porque quien mira el
     * teléfono puede no ver moverse la fila de arriba.
     *
     * ── Pero SÓLO cuando no queda nada esperando ────────────────────────────
     * «al momento de confirmar recepcion, que no me lleve a conteo, a no ser
     * que le de en confirmar todas» (usuario, 2026-08-26).
     *
     * El argumento de arriba vale para el caso que lo escribió —recibir todo—,
     * y se cae solo en el que existe desde que se puede recibir de menos:
     * quedan seis de Salud 1 y las tres de Salud 3, y la pestaña se cambia
     * igual. Ahí no hay ninguna etapa vacía que explicar; hay trabajo a medio
     * hacer del que se saca a quien lo está haciendo, y volver cuesta un toque
     * más y perder el scroll.
     *
     * O sea que la regla no es «recibir lleva a contar» sino «llevar a contar
     * cuando acá ya no queda nada que hacer» — que es lo mismo el día que se
     * recibe todo, y lo contrario el día que se recibe una parte. Se mide
     * contra lo que la pantalla muestra (`enCamino`, ya recortado por período y
     * búsqueda), que es contra lo que también cuenta el botón de «todas». */
    const recibir = useCallback(async (lista) => {
        const quedanEsperando = enCamino.length - lista.length;
        const ok = await correr('recibir',
            () => recibirBolsas(lista.map((b) => b.id)),
            lista.length === 1
                ? 'Recepción confirmada · ya está en «Por contar»'
                : `Recepción de ${lista.length} bolsas confirmada · ya están en «Por contar»`);
        if (!ok) return;
        if (quedanEsperando <= 0) onIrAEtapa?.('contar');
    }, [correr, onIrAEtapa, enCamino]);

    /* Contar una bolsa la MARCA. La bolsa se queda en «Por contar» con su monto
     * escrito hasta que se confirma la tanda entera — «debe pasar hasta que se
     * confirme todo el conteo» (usuario, 2026-08-24).
     *
     * `correr` limpia la selección al terminar, y acá no hay ninguna que limpiar:
     * marcar no usa casillas. No molesta, pero por eso el aviso dice qué queda
     * pendiente y no «listo».
     *
     * ── Y NO recarga la pantalla ────────────────────────────────────────────
     * «al dar en cuadra, por que actualiza? hace que pierda el flujo y
     * eficiencia» (usuario, 2026-08-26).
     *
     * Cada toque bajaba TODO otra vez —las vivas, las contadas, las de
     * diferencia, los saldos, la gente— y encima con `setCargando(true)`, o sea
     * borrando la vista y devolviendo el scroll al tope. Contar es la acción
     * más repetida del circuito: una tanda de treinta bolsas eran treinta
     * pantallas en blanco y ~150 viajes al servidor, y después de cada uno hay
     * que volver a encontrar dónde se estaba.
     *
     * Y no hacía falta ninguno: marcar cambia TRES columnas de UNA bolsa, no le
     * mueve el estado —sigue en «Por contar»— ni crea diferencias ni toca los
     * depósitos, y el RPC devuelve la fila ya escrita. Se pega y listo. Lo que
     * sí recarga es confirmar la tanda, que ahí sí cambia de estado, escribe
     * las diferencias y avisa a las salas. */
    const contar = useCallback((bolsa, monto) => correr(`contar-${bolsa.id}`,
        () => marcarConteoBolsa(bolsa.id, monto, saldoDe(bolsa)),
        Math.abs(monto - saldoDe(bolsa)) < 0.01
            ? `${bolsa.folio} cuadró · falta confirmar el conteo`
            : `${bolsa.folio} anotada · falta confirmar el conteo`,
        { recargar: false, conLaFila: parchar }), [correr, parchar]);

    const desmarcar = useCallback((bolsa) => correr(`desmarcar-${bolsa.id}`,
        () => desmarcarConteoBolsa(bolsa.id),
        `${bolsa.folio} vuelve a estar sin contar`,
        { recargar: false, conLaFila: parchar }), [correr, parchar]);

    /* El cierre de la tanda: acá pasa todo lo que antes pasaba bolsa por bolsa
     * —el cambio de estado, la bitácora y el aviso a cada sala—. Después de esto
     * ya no se puede corregir un conteo, sólo resolver su diferencia. */
    const confirmar = useCallback(async (marcadas) => {
        const ok = await correr('confirmar-conteo',
            () => confirmarConteo(marcadas.map((b) => b.id)),
            marcadas.length === 1
                ? 'Conteo confirmado · 1 bolsa cerrada'
                : `Conteo confirmado · ${marcadas.length} bolsas cerradas`);
        if (!ok) return;
        onIrAEtapa?.('finalizadas');
    }, [correr, onIrAEtapa]);

    /**
     * Después de sacar dinero salen DOS papeles por bolsa: el vale que queda
     * adentro y la etiqueta nueva de afuera. La etiqueta se reimprime sola
     * porque la anterior dejó de ser cierta en ese mismo momento — dejarla
     * pendiente sería dejar una bolsa con un número equivocado pegado encima.
     */
    const traslimSalida = useCallback(async (_oper, repartos) => {
        await imprimirTrasLaSalida(repartos, bolsas, nombrePersona);
        cargar({ silencioso: true });
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
        /* Y dentro de cada sala, por DÍA.
         *
         * «que aparezca cuanto es por dia, y el total de la sucursal y el total
         * del conteo» (usuario, 2026-08-24). Los dos totales de arriba ya
         * estaban; el que faltaba es el del día, y es el que se usa: a
         * administración le llegan las bolsas en tandas por día, y lo que se
         * cuadra contra el papel es «lo del martes».
         *
         * Es el mismo corte que usa el diálogo de entrega, que pregunta por
         * DÍAS y no por bolsas — o sea que la sala manda por día y ahora
         * administración cuenta por día. El `Map` conserva el orden que ya
         * traía la lista (la etapa la ordenó antes), así que no se reordena. */
        return [...porSala.entries()].map(([branchId, sub]) => {
            const porDia = new Map();
            for (const b of sub) {
                if (!porDia.has(b.fecha)) porDia.set(b.fecha, []);
                porDia.get(b.fecha).push(b);
            }
            return {
                branchId,
                nombre: nombreSala[branchId] || `Sucursal ${branchId}`,
                lista: sub,
                dias: [...porDia.entries()].map(([fecha, deEseDia]) => ({ fecha, lista: deEseDia })),
            };
        });
    }, [nombreSala, personas, elegidas, alternar, setAbierta, verMontos]);

    // ── Las dos acciones, publicadas a la píldora de la vista ───────────────
    // Ninguna depende de haber marcado bolsas: quien va a pagar una remesa sabe
    // el monto, no de qué bolsa sale —eso lo elige el portal—, y la entrega
    // pregunta por DÍAS, que es como la sala piensa lo que se lleva.
    //
    // Son de la etapa «En la sala» y por eso sólo salen ahí: sacar dinero de una
    // bolsa que ya salió de la sala no es una operación que exista, y ofrecerla
    // desde «Por contar» sería un botón que abre un diálogo con la lista vacía.
    //
    // Las otras tres etapas no publican acciones a la píldora, y es deliberado:
    // confirmar la recepción, confirmar el conteo y depositar al banco llevan
    // pegado un NÚMERO —cuántas bolsas y cuánto dinero— que es la mitad de la
    // decisión. Ese número no cabe en una píldora que además tiene que mostrar
    // los filtros, así que esos tres botones se quedan junto a la cifra que
    // están confirmando. Un botón de dinero sin su monto al lado se aprieta a
    // ciegas.
    const acciones = useMemo(() => (puedeEntregar && etapa === 'sala' ? [
        {
            key: 'sacar', icon: HandCoins, label: 'Sacar dinero', rotulo: 'Sacar',
            disabled: !enSala.length, onClick: () => setSacando(true),
        },
        {
            key: 'entregar', icon: Send, label: 'Entregar dinero', rotulo: 'Entregar',
            variant: 'primary', disabled: !enSala.length, onClick: () => setEntregando(true),
        },
    ] : VACIO), [puedeEntregar, etapa, enSala.length, setSacando, setEntregando]);

    // ── El número de cada pestaña, publicado a la píldora del header ───────
    //
    // El contador es el PRECIO de haber partido la pantalla en pestañas: una
    // pestaña cerrada esconde lo suyo, y en un circuito de efectivo lo escondido
    // es dinero parado. Con el número, la fila entera se lee sin abrir nada —
    // que es lo que las cuatro etapas apiladas hacían y lo que no se podía
    // perder al separarlas.
    //
    // Cuenta lo que la pestaña VA A MOSTRAR, filtros incluidos: el mismo período
    // y el mismo buscador que recortan el cuerpo. Un contador que contara el
    // total mandaría a una pestaña que va a salir vacía, que es peor que no
    // tener contador.
    //
    // «Esperando recepción» se pone en rojo cuando hay alguna de más de un día:
    // es el estado más riesgoso del circuito —el dinero no está ni en la sala ni
    // en administración— y es el único cuyo problema no se ve entrando a la
    // pestaña, porque adentro esas bolsas se ven igual que las de hace diez
    // minutos. `Contador` devuelve `null` en cero, así que las pestañas al día
    // no dibujan nada.
    const conteos = useMemo(() => ({
        sala: enSala.length,
        camino: enCamino.length,
        contar: porContar.length,
        finalizadas: contadas.length,
        tonos: { camino: enCaminoViejas.length ? 'danger' : undefined },
    }), [enSala.length, enCamino.length, porContar.length, contadas.length, enCaminoViejas.length]);

    useEffect(() => { onConteos?.(conteos); }, [conteos, onConteos]);

    // ── El carril, publicado a la píldora de la vista ──────────────────────
    // «necesita cards la vista» (usuario, 2026-08-20).
    //
    // ── Y desde el 24-ago NO repiten los números de las pestañas ───────────
    // Las cuatro tarjetas eran «En la sala · En camino · Por contar · Sin
    // resolver», o sea el desglose por etapa. Con las etapas convertidas en
    // pestañas —cada una con su contador— ese carril pasó a decir por segunda
    // vez lo que ya dice la fila de arriba, y §17.0 lo nombra: «un carril que
    // es un desglose por categoría disfrazado de métricas» contesta UNA sola
    // pregunta dibujada como cuatro. Su lugar ya es la navegación.
    //
    // Lo que queda son las TRES cifras que ninguna pestaña contesta, porque
    // cruzan las cuatro:
    //
    //   · cuánto dinero está fuera de administración (sala + camino), que es la
    //     exposición real del circuito y vive repartida en dos pestañas;
    //   · cuántos días lleva la más vieja, que es la alarma — y hasta hoy sólo
    //     se veía entrando a la etapa donde estuviera;
    //   · cuánto quedó sin cuadrar.
    //
    // Son TRES y no cuatro, y el cuarto se cayó midiendo. «Al banco» —lo contado
    // y sin depositar— salía cortado y, sobre todo, ya vive con más peso del
    // que una tarjeta le puede dar: encabeza la pestaña «Finalizadas» a 26px y
    // con su botón al lado. Repetirlo acá costaba ancho a los otros tres.
    //
    // El ancho es la razón concreta y se midió el 2026-08-24: el piso de una
    // tarjeta son 148px (§17.0) y ahí caben ~8 caracteres, así que `$1,224.50`
    // salía `$1,224.` con puntos suspensivos y además un escalón tipográfico
    // más chico que sus vecinas — la fila quedaba despareja. Con tres, cada una
    // llega a 184px a 1512 y el monto se lee entero. Es §17.0 al pie de la
    // letra: «cuántas tarjetas hay lo fija la vista, nunca el dato».
    //
    // Los rótulos son cortos a propósito, y se midieron: el piso de una tarjeta
    // son 148px (§17.0) y ahí entran unos 12 caracteres. «En circulación» (14)
    // salía «En circulaci…» y «Sin depositar» (13) salía «Sin deposita…» — o sea
    // que el rótulo dejaba de nombrar la métrica, que es lo único que hace. Hoy
    // son «Sin recibir» y «Al banco», y el matiz vive en el `sub`, que es
    // exactamente para lo que existe.
    //
    // No filtran al tocarlas, y por eso van sin `onClick`: la etapa ya es la
    // pestaña, y ninguna de estas cuatro cifras ES una etapa — «En circulación»
    // vive en dos a la vez. Una tarjeta que llevara a un sitio parcial diría
    // menos que el número que ya muestra.
    //
    // Los montos siguen a `bolsas_ver_montos` y NO a `bolsas_ver_cards`: son dos
    // preguntas distintas —ver el resumen y ver cuánta plata hay—, y con una
    // sola llave el carril se habría llevado los montos a quien no los ve. Sin
    // montos cada tarjeta cae a su CUENTA, que sigue contestando lo suyo.
    const metricas = useMemo(() => {
        if (!verCards) return VACIO;
        const cifra = (lista) => (verMontos ? formatMoney(suma(lista)) : String(lista.length));
        const cuantas = (n) => `${n} ${n === 1 ? 'bolsa' : 'bolsas'}`;

        const enCirculacion = [...enSala, ...enCamino];
        // La más vieja de lo que sigue pendiente, mirando las TRES etapas: la
        // antigüedad se cuenta desde la fecha del corte, que es cuando ese
        // efectivo dejó de estar en la caja.
        const pendientes = [...enSala, ...enCamino, ...porContar];
        const masVieja = pendientes.reduce(
            (peor, b) => (peor && String(peor.fecha) <= String(b.fecha) ? peor : b), null);
        const diasMasVieja = masVieja ? diasDesde(masVieja.fecha) : 0;

        return [
            { clave: 'circulacion', icon: HandCoins, label: 'Sin recibir',
              value: cifra(enCirculacion),
              sub: enCirculacion.length
                  ? `${enCirculacion.length} en sala o en camino`
                  : 'todo recibido',
              iconBg: 'bg-brand/10', iconCls: 'text-brand-text' },
            { clave: 'masVieja', icon: CalendarDays, label: 'La más vieja',
              value: masVieja ? `${diasMasVieja} d` : '—',
              sub: masVieja
                  ? `${nombreSala[masVieja.branch_id] || 'sin sala'} · ${rotularDia(masVieja.fecha)}`
                  : 'sin pendientes',
              iconBg: diasMasVieja >= DIAS_DE_ALARMA ? 'bg-danger/10' : 'bg-surface-card-hover',
              iconCls: diasMasVieja >= DIAS_DE_ALARMA ? 'text-danger-text' : 'text-content-3',
              valueCls: diasMasVieja >= DIAS_DE_ALARMA ? 'text-danger-text' : 'text-content' },
            { clave: 'sinResolver', icon: Scale, label: 'Sin resolver',
              value: verMontos && sinResolver.length
                  ? formatMoney(sinResolver.reduce((a, b) => a + Math.abs(diferenciaDe(b) ?? 0), 0))
                  : String(sinResolver.length),
              sub: sinResolver.length ? `${cuantas(sinResolver.length)} sin cuadrar` : 'todo cuadrado',
              iconBg: sinResolver.length ? 'bg-danger/10' : 'bg-success/10',
              iconCls: sinResolver.length ? 'text-danger-text' : 'text-success-text',
              valueCls: sinResolver.length ? 'text-danger-text' : 'text-success-text' },
        ];
    }, [verCards, verMontos, enSala, enCamino, porContar, sinResolver, nombreSala]);

    useEffect(() => { onMetricas?.(metricas); }, [metricas, onMetricas]);
    useEffect(() => () => onMetricas?.(VACIO), [onMetricas]);

    useEffect(() => { onAcciones?.(acciones); }, [acciones, onAcciones]);
    // Al salir de la pestaña la píldora tiene que quedar sin ellas: son acciones
    // de Bolsas, no de la vista.
    useEffect(() => () => onAcciones?.([]), [onAcciones]);

    if (cargando) return <LoadingState label="Buscando las bolsas" />;

    const elegidasEnCamino = elegidasDe(enCamino);
    const gruposEnCamino = new Set(enCamino.map((b) => b.branch_id)).size;
    // Cuántas SALAS toca lo elegido. Es lo que decide si el botón de arriba
    // aporta algo: con una sola sala el de su encabezado ya hace exactamente
    // eso, y al lado de las casillas.
    const salasElegidasEnCamino = new Set(elegidasEnCamino.map((b) => b.branch_id)).size;

    return (
        <div className="space-y-6">
            {/* Lo que el rango dejó afuera se DICE. Es la contraparte de que el
                período ahora recorte también lo pendiente: sin este aviso, una
                bolsa que lleva tres semanas en una sala desaparecería de la
                pantalla por mover unas fechas, y nada en pantalla lo delataría —
                que es exactamente el modo en que este circuito puede perder
                dinero sin un error. El botón trae el rango hasta la más vieja. */}
            {/* El aviso va en el `action` del canónico —texto a la izquierda,
                botón a la derecha— y no con el botón metido en el cuerpo, que es
                como salió primero: una caja del ancho de la pantalla, casi vacía,
                con el botón colgando en su propio renglón. «Ese aviso nada que
                ver, se ve súper mal» (usuario, 2026-08-20).

                Y sólo sale cuando además HAY algo en pantalla. Si el rango no
                trae nada, lo dice el vacío de abajo: dos textos diciendo lo mismo
                sobre una pantalla en blanco es de lo que se quejaba. */}
            {pendientesFuera.length > 0 && !vacioTotal && (
                <Notice variant="warning" icon={AlertTriangle}
                    action={onAmpliarPeriodo && masViejaFuera ? (
                        <Button variant="secondary" size="sm" icon={CalendarDays}
                            onClick={() => onAmpliarPeriodo(masViejaFuera)}>
                            Ver todas
                        </Button>
                    ) : null}>
                    {pendientesFuera.length === 1 ? 'Una bolsa pendiente' : `${pendientesFuera.length} bolsas pendientes`}
                    {verMontos && ` por ${formatMoney(suma(pendientesFuera))}`}
                    {' '}quedaron fuera de estas fechas y siguen esperando.
                </Notice>
            )}

            {/* Una diferencia sin cuadrar es lo ÚNICO que sale en las cuatro
                pestañas, y es a propósito: vive en «Finalizadas», o sea en la
                que menos se abre, y es la que no puede esperar a que alguien
                pase por ahí. Un aviso que sólo aparece donde ya estás mirando
                no avisa nada.

                El botón lleva a la pestaña donde están. Antes abría la sección
                plegada y hacía scroll; hoy cambia de pestaña, que además deja la
                dirección apuntando ahí — se puede pasar el enlace. Y no sale en
                «Finalizadas», donde el botón llevaría al sitio donde ya se
                está. */}
            {alcanceTodos && sinResolver.length > 0 && etapa !== 'finalizadas' && (
                <Notice variant="danger" icon={AlertTriangle}
                    action={(
                        <Button variant="secondary" size="sm" icon={Scale}
                            onClick={() => onIrAEtapa?.('finalizadas')}>
                            Ver
                        </Button>
                    )}>
                    <span className="font-bold">
                        {sinResolver.length === 1
                            ? 'Hay una bolsa contada que no cuadró y sigue sin resolver'
                            : `Hay ${sinResolver.length} bolsas contadas que no cuadraron y siguen sin resolver`}
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Están en «Finalizadas».
                    </span>
                </Notice>
            )}

            {/* ── Lo único que vuelve a la sala después de entregar ──────
                «al entregarlos ya no es responsabilidad de la sala, solo que
                les aparezca si se reporta una diferencia encontrada en alguna
                bolsa de efectivo, para buscar solucion» (usuario, 2026-08-24).

                Va con el MONTO de la diferencia aunque la sala no tenga
                `bolsas_ver_montos`, y es deliberado: ese permiso esconde cuánto
                efectivo hay en juego —para no publicar el dinero en sala—, no
                cuánto falta en la bolsa propia. Buscar $8 y buscar $600 son dos
                búsquedas distintas, y el aviso que el servidor ya le manda a la
                sala al contar dice exactamente esa cifra desde el 15-ago. Lo que
                sigue sin verse es el saldo de la bolsa, que es lo que el permiso
                protege.

                Sin botón de resolver: eso lo decide quien contó. */}
            {!alcanceTodos && sinResolver.length > 0 && (
                <section className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3 px-1 flex-wrap">
                        <h3 className="text-label font-bold text-content flex items-center gap-2">
                            <Scale size={15} className="text-danger-text" />
                            Diferencias por resolver
                        </h3>
                        <span className="text-caption text-content-3 tabular-nums">
                            {sinResolver.length} {sinResolver.length === 1 ? 'bolsa' : 'bolsas'}
                        </span>
                    </div>
                    <p className="text-caption text-content-3 px-1">
                        Administración contó estas bolsas y el dinero no coincidió. Ya
                        no están en la sala: se muestran para buscar qué pasó.
                    </p>
                    <div className="grid gap-2 grid-cols-1 xl:grid-cols-2">
                        {sinResolver.map((b) => {
                            const dif = diferenciaDe(b);
                            return (
                                <Bolsa key={b.id} bolsa={b} sala={nombreSala[b.branch_id]}
                                    personas={personas} onAbrir={setAbierta} verMontos={verMontos}>
                                    <Badge variant={dif < 0 ? 'danger' : 'warning'} size="sm" dot>
                                        {dif < 0 ? 'Faltó' : 'Sobró'} {formatMoney(Math.abs(dif))}
                                    </Badge>
                                    <span className="text-caption text-content-3">
                                        Contada el {selloDeTiempo(b.contado_at)}
                                    </span>
                                </Bolsa>
                            );
                        })}
                    </div>
                </section>
            )}

            {vacioTotal ? (
                <EmptyState
                    icon={Package}
                    title="Sin bolsas en estas fechas"
                    subtitle={pendientesFuera.length
                        ? `${pendientesFuera.length === 1 ? 'La bolsa pendiente que hay está' : `Las ${pendientesFuera.length} bolsas pendientes que hay están`} fuera del rango${verMontos ? ` y suman ${formatMoney(suma(pendientesFuera))}` : ''}.`
                        : alcanceTodos
                            ? 'Ninguna sala guardó efectivo en este período.'
                            : 'Esta sala no guardó efectivo en este período.'}
                    action={onAmpliarPeriodo && masViejaFuera ? (
                        <Button variant="secondary" icon={CalendarDays}
                            onClick={() => onAmpliarPeriodo(masViejaFuera)}>
                            Ver todas las pendientes
                        </Button>
                    ) : null}
                />
            ) : (<>
            {/* ── 1. En la sala ─────────────────────────────────────────── */}
            {etapa === 'sala' && (
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
                                    cargar({ silencioso: true });
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
            )}

            {/* Las tres etapas siguientes son de ADMINISTRACIÓN: confirmar la
                recepción y contar el dinero exigen `bolsas_conteo`, y el archivo
                de contadas es de las seis salas. Con alcance de una sala la
                pantalla termina en «En la sala». */}
            {alcanceTodos && (<>
            {etapa === 'camino' && (<>
            {/* ── 2. Esperando recepción ──────────────────────────────────
                Es el estado MÁS riesgoso del circuito —la bolsa no está en la
                sala ni en administración, la tiene una persona en el camino— y
                era el único sin alarma: la de los 4 días sólo mira las que están
                en la sala. Una bolsa entregada que nunca llegó se veía igual que
                una entregada hace diez minutos. */}
            {alcanceTodos && enCaminoViejas.length > 0 && (
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
                /* Tres caminos, del más usado al más raro (usuario, 2026-08-24:
                   «recibir todo de un solo tambien»):
                     · llegó todo → un botón;
                     · llegó lo de una sala → el botón de su encabezado;
                     · faltó alguna → las casillas, que es el caso excepcional.
                   El de «todo» sólo sale cuando hay más de una sala: con una
                   sola sería el mismo botón dos veces.
                   Y por lo mismo, desde que el botón de la sala obedece a las
                   casillas, el de arriba sólo sale cuando lo elegido cruza dos
                   salas: si todo lo marcado es de Salud 1, el de su encabezado
                   ya dice «Recibir las 6» y repetirlo arriba es el mismo botón
                   dos veces, uno de ellos lejos de las casillas que lo mandan. */
                accion={puedeContar && ((elegidasEnCamino.length > 0 && salasElegidasEnCamino > 1) ? (
                    <Button variant="primary" size="sm" icon={Inbox} loading={ocupado === 'recibir'}
                        onClick={() => recibir(elegidasEnCamino)}>
                        Confirmar recepción de {elegidasEnCamino.length}
                        {verMontos ? ` · ${formatMoney(suma(elegidasEnCamino))}` : ''}
                    </Button>
                ) : (elegidasEnCamino.length === 0 && enCamino.length > 0 && gruposEnCamino > 1 && (
                    <Button variant="primary" size="sm" icon={Inbox} loading={ocupado === 'recibir'}
                        onClick={() => recibir(enCamino)}>
                        Confirmar las {enCamino.length} que llegaron
                    </Button>
                )))}
                /* Y el botón de la sala recibe LO ELEGIDO cuando hay algo
                   elegido ahí: es el control que está al lado de las casillas,
                   así que es el que tiene que obedecerlas. */
                accionDeGrupo={puedeContar ? (g, enJuego, parcial) => (
                    <Button variant="secondary" size="sm" icon={Inbox}
                        loading={ocupado === 'recibir'}
                        onClick={() => recibir(enJuego)}>
                        {enJuego.length === 1
                            ? (parcial ? 'Recibir la elegida' : 'Recibir')
                            : `Recibir las ${enJuego.length}`}
                    </Button>
                ) : null}
                elegidasDe={puedeContar ? elegidasDe : null}
                verMontos={verMontos}
                vacio={pendientesFuera.length ? "Nada en camino en estas fechas" : "Nada en camino"}
            />
            </>)}

            {/* ── 3. Por contar ─────────────────────────────────────────── */}
            {etapa === 'contar' && (
            <Etapa
                icon={Banknote}
                titulo="Por contar"
                ayuda="Se cuenta sala por sala y, dentro de cada una, día por día. Nada se cierra hasta confirmar el conteo: mientras tanto se puede contar de nuevo."
                accion={puedeContar && marcadas.length > 0 && (
                    <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
                        <Button variant="primary" size="sm" icon={ShieldCheck}
                            loading={ocupado === 'confirmar-conteo'}
                            onClick={() => confirmar(marcadas)}>
                            Confirmar el conteo · {marcadas.length}
                            {marcadas.length === 1 ? ' bolsa' : ' bolsas'}
                            {verMontos ? ` · ${formatMoney(marcadas.reduce((a, b) => a + Number(b.conteo_marcado || 0), 0))}` : ''}
                        </Button>
                        {/* Decirlo sin bloquear. Una sala que todavía no llegó no
                            puede dejar en el aire lo que ya se contó, pero cerrar
                            sin saber que faltan dos es otra cosa. */}
                        {sinMarcar.length > 0 && (
                            <span className="text-caption text-warning-text">
                                {sinMarcar.length === 1
                                    ? 'Queda 1 bolsa sin contar'
                                    : `Quedan ${sinMarcar.length} bolsas sin contar`}
                                {' '}· se cerrarán sólo las contadas
                            </span>
                        )}
                    </div>
                )}
                grupos={conNodo(porContar, {
                    pie: (b) => (puedeContar ? (
                        <Conteo bolsa={b}
                            ocupado={ocupado === `contar-${b.id}`}
                            ocupadoDesmarcar={ocupado === `desmarcar-${b.id}`}
                            onContar={contar} onDesmarcar={desmarcar} verMontos={verMontos} />
                    ) : null),
                })}
                total={porContar.length} montoTotal={suma(porContar)}
                verMontos={verMontos}
                vacio={pendientesFuera.length ? "Nada pendiente de contar en estas fechas" : "Nada pendiente de contar"}
            />
            )}

            {/* ── FINALIZADAS: el depósito, el archivo y los depósitos ─────
                Es la única pestaña que lleva más de un bloque, y por eso es la
                única donde el plegado sigue existiendo: acá sí hay algo con qué
                compartir la pantalla. */}
            {etapa === 'finalizadas' && (<>

            {/* ── El depósito al banco ─────────────────────────────────────
                Lo que sigue después de confirmar un conteo, y por eso va DESPUÉS
                de «Por contar» y antes del archivo: es trabajo pendiente, no
                historia.

                No se dibuja como etapa porque no lo es — las bolsas ya están
                contadas y siguen en «Contadas». Esto es la decisión de cuánto de
                todo eso se lleva al banco hoy.

                Viene sin rango a propósito: efectivo confirmado que nadie
                depositó es un pendiente, y un pendiente no puede desaparecer por
                mover unas fechas. */}
            {puedeContar && porDepositar.length > 0 && (
                <div data-surface="card" className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 py-3">
                    <div>
                        <div className="text-micro font-black uppercase tracking-widest text-content-3">
                            Contado y sin llevar al banco
                        </div>
                        {verMontos ? (
                            <div className="text-display font-black tabular-nums text-content leading-none mt-1">
                                {formatMoney(porDepositar.reduce((a, b) => a + Number(b.contado || 0), 0))}
                            </div>
                        ) : (
                            <div className="text-display font-black tabular-nums text-content leading-none mt-1">
                                {porDepositar.length}
                            </div>
                        )}
                        <div className="text-caption text-content-2 mt-1.5">
                            en {porDepositar.length} {porDepositar.length === 1 ? 'bolsa' : 'bolsas'}
                        </div>
                    </div>
                    <Button variant="primary" size="sm" icon={Landmark}
                        onClick={() => setDepositando(true)}>
                        Depósito al banco
                    </Button>
                </div>
            )}

            {/* ── 4. Contadas ───────────────────────────────────────────── */}
            <Etapa
                icon={ShieldCheck}
                titulo="Contadas"
                ayuda={`El historial ${rangoEnPalabras}, por la fecha en que se contaron. Lo que se contó queda; resolver una diferencia no lo cambia.${
                    sinResolverFuera.length
                        ? ` Además ${sinResolverFuera.length === 1 ? 'sale una bolsa sin resolver de fuera' : `salen ${sinResolverFuera.length} bolsas sin resolver de fuera`} de estas fechas: una diferencia no se esconde por mover el período.`
                        : ''}`}
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
                plegada={cerradas.has('contadas')} onPlegar={() => plegar('contadas')}
                vacio="Sin bolsas contadas en estas fechas"
            />

            {/* ── El archivo de los depósitos ──────────────────────────────
                Va al final y ARRANCA CERRADO. «Contadas» dejó de arrancar así
                el 2026-08-24 —quien abre esta pestaña vino a ver el archivo— y
                esto no: es la OTRA pregunta, la de cuadrar contra el banco, y
                sólo se abre cuando toca hacerla.

                Detrás de `bolsas_ver_montos` va la sección ENTERA y no sólo las
                cifras: «DEP-260824-1, 8 bolsas» sin montos no contesta ninguna
                de las preguntas por las que existe. */}
            {verMontos && (
                <Suspense fallback={null}>
                    <DepositosAlBanco desde={desde} hasta={hasta} nombreSala={nombreSala}
                        plegada={cerradas.has('depositos')}
                        onPlegar={() => plegar('depositos')} />
                </Suspense>
            )}

            </>)}

            </>)}

            </>)}

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
                        onCambio={recargarEnSilencio}
                    />
                </Suspense>
            )}

            {depositando && (
                <Suspense fallback={null}>
                    <DepositoAlBanco
                        abierto={depositando}
                        bolsas={porDepositar}
                        personas={empleados}
                        onClose={() => setDepositando(false)}
                        onHecho={recargarEnSilencio}
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
