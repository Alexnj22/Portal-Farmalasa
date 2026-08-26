import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Package, Scale } from 'lucide-react';
import Badge from '../common/Badge';
import LiquidAvatar from '../common/LiquidAvatar';
import { DataTable, DataRow, DataCell } from '../common/DataTable';
import LiquidModal from '../common/LiquidModal';
import { formatMoney } from '../../utils/formatNumber';
// El rango de días vive en `etapas` porque también lo arma el motor para el
// rótulo de la ranura de la píldora, y este archivo se carga en diferido.
import { rangoDeDias } from '../../views/bolsas/etapas';

/**
 * El archivo de las TANDAS de conteo.
 *
 * «el filtro no puede ser por conteos? así como los depósitos de banco? así se
 * ve más ordenado y más estructurado todo» (usuario, 2026-08-26).
 *
 * Confirmar un conteo movía N bolsas a CONTADA y no dejaba nada que las uniera.
 * Para saber qué se contó el lunes había que acordarse de una bolsa de ese día,
 * abrirla, mirar la hora y agrupar de memoria las que tuvieran la misma —y aun
 * así no se veía el cuadre de la tanda, que es el número por el que se firma—.
 *
 * Un depósito sí era una fila con folio y monto, y por eso se podía mirar. Un
 * conteo no lo era, y son la misma clase de hecho: alguien juntó unas bolsas,
 * las contó y puso su firma.
 *
 * ── Y es donde se leen las DOS firmas ──────────────────────────────────────
 * «yo lo puedo recibir, pero no conté yo ni deposité yo» (usuario, mismo día).
 * `contaron` son todos los que contaron alguna bolsa de la tanda —pueden ser
 * varios, y desde hoy lo son— y `cerrado_por` es quien la firmó. Separarlos es
 * el punto: la pantalla mostraba un nombre solo y se leía como que esa persona
 * había hecho todo el recorrido del dinero.
 *
 * ── La sección entera va detrás de `bolsas_ver_montos` ─────────────────────
 * Igual que los depósitos, y por el mismo motivo: «CNT-260826-1, 43 bolsas» sin
 * cifras no contesta ninguna de las preguntas por las que existe. Quien la
 * dibuja es `CircuitoDeBolsas`, dentro de esa misma guarda.
 */
const fechaLarga = (f) => (f ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}) : '');
const selloDeTiempo = (iso) => (iso ? new Date(iso).toLocaleString('es-SV', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'America/El_Salvador',
}) : '');
const hhmm = (h) => String(h || '').slice(0, 5);
const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2)
    .map((p) => p[0]).join('').toUpperCase();

const COLUMNAS = [
    { key: 'folio', label: 'Conteo' },
    { key: 'fecha', label: 'Fecha' },
    // De qué días es la plata que se contó. Es un RANGO derivado de las bolsas
    // que quedaron adentro, igual que en los depósitos: una tanda cruza días.
    { key: 'dias', label: 'Días', hideBelow: 'md' },
    // La columna que motivó todo esto. Con una sola persona dice su nombre; con
    // varias dice cuántas, y el detalle las lista.
    { key: 'contaron', label: 'Contaron', hideBelow: 'lg' },
    { key: 'esperado', label: 'Debía haber', align: 'right', hideBelow: 'sm' },
    { key: 'contado', label: 'Contado', align: 'right' },
    // Dice lo que queda SIN RESOLVER, no lo que faltó al contar. Ver `Diferencia`.
    { key: 'diferencia', label: 'Sin resolver', align: 'right' },
    { key: 'cuantas', label: 'Bolsas', align: 'right', hideBelow: 'md' },
];

/* Quiénes contaron, en una línea. Con más de dos se dice el número: tres
 * nombres completos en una celda de tabla no se leen, se estorban. */


/* La diferencia con su signo y su tono. El cero se dice «Cuadró» y no «$0.00»,
 * igual que en la franja del conteo: quien mira esto quiere una respuesta, no
 * una cifra que hay que interpretar.
 *
 * ── Una cifra NO se separa de su signo ─────────────────────────────────────
 * «mira el de diferencia, sale cortado» (usuario, 2026-08-26): dentro de la
 * píldora, el «−» se iba a un renglón y «$1,044.66» al de abajo. Se leía como
 * dos cosas, y una de ellas es la que dice si faltó o sobró dinero.
 *
 * La causa es que `{signo}{monto}` son dos nodos de texto y el «−» (U+2212) es
 * un operador matemático: el navegador puede cortar después de él. Se arregla
 * con UNA cadena y `whitespace-nowrap`, no ensanchando la columna — el corte
 * vuelve en cuanto el monto crece un dígito.
 *
 * `nowrap` va acá y no en `Badge`: hay píldoras del portal con frases enteras
 * adentro («Aún faltan: #1, #2 — se solicitará otro reenvío») que SÍ tienen que
 * envolver, y forzarlas a una línea las haría desbordar la tarjeta en el
 * teléfono. Lo que no se parte es un número, no toda píldora. */
function Diferencia({ valor, size = 'sm' }) {
    const dif = Number(valor || 0);
    if (Math.abs(dif) < 0.01) {
        return <Badge variant="success" size={size} icon={CheckCircle2}>Cuadró</Badge>;
    }
    return (
        <Badge variant={dif < 0 ? 'danger' : 'warning'} size={size} dot className="whitespace-nowrap">
            {`${dif < 0 ? '−' : '+'}${formatMoney(Math.abs(dif))}`}
        </Badge>
    );
}

/**
 * La celda de la columna: **lo que queda sin resolver**, no lo que faltó.
 *
 * «si las diferencias son justificadas debe de decir 0 no?» (usuario,
 * 2026-08-26), y tenía dos números de esta misma pantalla dándole la razón: la
 * baldosa de arriba decía «0 · Sin resolver · todo cuadrado» y esta columna,
 * dos centímetros más abajo, «−$4,592.24». Los dos ciertos, contestando
 * preguntas distintas y sin decir cuál — así es como se aprende a no creerle a
 * ninguno de los dos.
 *
 * Lo firmado NO se pierde: baja a subtexto. Es el hecho —lo que había cuando se
 * contó— y el día que alguien audite la tanda es lo que va a buscar; lo que no
 * puede es seguir ocupando el renglón como si fuera un pendiente.
 *
 * Y el cero de «nunca hubo diferencia» se distingue del cero de «se
 * resolvieron»: el primero dice «Cuadró», el segundo dice `$0.00` con cuántas
 * se resolvieron debajo. Decir «Cuadró» sobre una tanda que tuvo once bolsas
 * descuadradas sería cambiar una media verdad por otra.
 */
function SinResolver({ conteo }) {
    const c = conteo;
    const pendiente = Number(c.pendiente || 0);
    const firmada = Number(c.diferencia || 0);
    const descuadradas = Number(c.descuadradas || 0);
    const resueltas = Number(c.resueltas || 0);

    if (descuadradas === 0 && Math.abs(pendiente) < 0.01) {
        return <Diferencia valor={0} />;
    }
    return (
        <span className="inline-flex flex-col items-end gap-0.5">
            {Math.abs(pendiente) < 0.01 ? (
                <Badge variant="success" size="sm" icon={CheckCircle2} className="whitespace-nowrap">{formatMoney(0)}</Badge>
            ) : (
                <Diferencia valor={pendiente} />
            )}
            <span className="text-micro text-content-3 tabular-nums whitespace-nowrap">
                {resueltas > 0 && `${resueltas} ${resueltas === 1 ? 'resuelta' : 'resueltas'}`}
                {resueltas > 0 && Math.abs(firmada) >= 0.01 ? ' · ' : ''}
                {Math.abs(firmada) >= 0.01
                    && `${firmada < 0 ? '−' : '+'}${formatMoney(Math.abs(firmada))} al contar`}
            </span>
        </span>
    );
}

/* Las columnas de las bolsas de una sala. La SALA no está: es el encabezado de
 * la sección, y repetirla en cada renglón sería decir seis veces lo mismo — que
 * es exactamente el ancho que le faltaba a las otras siete.
 *
 * Todo va `whitespace-nowrap` salvo la causa. Sin eso `LP-1116` se parte en dos
 * renglones y «EDWIN NUÑEZ» en dos más: la tabla intenta caber a la fuerza en
 * vez de ofrecer su barra de desplazamiento, y el resultado es una fila de tres
 * pisos donde nada se alinea con nada. `minWidth` es lo que le dice que puede
 * desbordar. */
const COLUMNAS_BOLSA = [
    { key: 'folio', label: 'Bolsa' },
    { key: 'dia', label: 'Día' },
    { key: 'esperado', label: 'Debía haber', align: 'right', hideBelow: 'md' },
    { key: 'contado', label: 'Contado', align: 'right' },
    { key: 'dif', label: 'Diferencia', align: 'right' },
    { key: 'conto', label: 'La contó', hideBelow: 'md' },
    { key: 'causa', label: 'Causa', hideBelow: 'lg' },
];

/**
 * Una persona: SIEMPRE la cara con el nombre completo.
 *
 * «que SIEMPRE LA FOTO CON NOMBRE Y APELLIDO» (usuario, 2026-08-26). Un nombre
 * suelto en una columna de tabla se lee como un dato más; con la cara al lado
 * se reconoce sin leerlo, que es lo que hace falta cuando la pregunta es «¿y
 * ésta quién la contó?».
 *
 * Sin foto NO se cae a texto pelado: `LiquidAvatar` pinta las iniciales, así
 * que la columna mantiene su forma y la fila no cambia de alto según quién sea.
 */
function Persona({ nombre, foto, className = '' }) {
    if (!nombre) return <span className="text-content-3">—</span>;
    return (
        <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
            <LiquidAvatar
                src={foto} alt={nombre}
                fallbackText={iniciales(nombre)}
                className="w-5 h-5 rounded-full shrink-0 text-micro"
            />
            <span className="text-caption text-content-2 whitespace-nowrap">{nombre}</span>
        </span>
    );
}

/* Una cifra del cuadre, con su rótulo arriba en versalitas. Es la misma forma
 * que la franja de «Por contar» — que se lea igual acá que allá es lo que
 * permite seguir la cuenta meses después. */
function Cifra({ rotulo, children, fuerte = false }) {
    return (
        <div>
            <div className="text-micro font-black uppercase tracking-widest text-content-3">
                {rotulo}
            </div>
            <div className={`tabular-nums leading-none mt-1 whitespace-nowrap ${fuerte
                ? 'text-display font-black text-content' : 'text-title font-bold text-content-2'}`}>
                {children}
            </div>
        </div>
    );
}

/** La tabla de bolsas de UNA sala. */
function BolsasDeLaSala({ bolsas }) {
    return (
        <DataTable
            columns={COLUMNAS_BOLSA}
            minWidth="820px"
            empty={{ icon: Package, message: 'Sin bolsas' }}
        >
            {(bolsas || []).map((b, i) => {
                const dif = Math.round((Number(b.contado || 0) - Number(b.esperado || 0)) * 100) / 100;
                const cuadra = Math.abs(dif) < 0.01;
                return (
                    <DataRow key={b.id} index={i}>
                        <DataCell>
                            <span className="font-bold text-content whitespace-nowrap">{b.folio}</span>
                        </DataCell>
                        <DataCell>
                            <span className="text-caption text-content-2 tabular-nums whitespace-nowrap">
                                {fechaLarga(b.fecha)} · {hhmm(b.hora)}
                            </span>
                        </DataCell>
                        <DataCell align="right" hideBelow="md">
                            <span className="tabular-nums text-content-2 whitespace-nowrap">
                                {formatMoney(b.esperado)}
                            </span>
                        </DataCell>
                        <DataCell align="right">
                            <span className="font-bold tabular-nums text-content whitespace-nowrap">
                                {formatMoney(b.contado)}
                            </span>
                        </DataCell>
                        <DataCell align="right">
                            {/* La que cuadró se dice con una raya y no con una
                                insignia verde: en una lista de 25 donde cuatro
                                fallaron, veintiún «✓ Cuadró» tapan a las cuatro
                                que importan. */}
                            {cuadra
                                ? <span className="text-content-3 tabular-nums">—</span>
                                : <Diferencia valor={dif} />}
                        </DataCell>
                        <DataCell hideBelow="md">
                            <Persona nombre={b.contado_por} foto={b.contado_por_foto} />
                        </DataCell>
                        <DataCell hideBelow="lg">
                            {b.dif_causa ? (
                                <span className="text-caption text-content-2">
                                    {b.dif_causa}
                                    {b.dif_por ? <span className="text-content-3"> · {b.dif_por}</span> : null}
                                </span>
                            ) : (
                                <span className="text-content-3">—</span>
                            )}
                        </DataCell>
                    </DataRow>
                );
            })}
        </DataTable>
    );
}

/**
 * El detalle: el cuadre que se firmó, quién hizo qué, y **sala por sala**.
 *
 * ── Por qué está seccionado por sucursal (2026-08-26) ──────────────────────
 * «necesito tener totales diario por sucursal, que esté seccionado por
 * sucursal» (usuario).
 *
 * El desglose «Por día» sumaba las seis salas en una cifra por fecha, que es la
 * pregunta de quien mira la tanda entera. Pero el conteo se HACE sala por sala
 * y día por día —es el proceso que el propio usuario dictó el 24-ago— así que
 * la cifra contra la que se cuadra el trabajo real no estaba en ninguna parte:
 * había que sumar de memoria las cuatro filas de Salud 1 en una lista de 25.
 *
 * Ahora cada sala es una sección con su total, sus días y su tabla. La columna
 * «Sala» desapareció de las filas —la dice el encabezado— y ese ancho es
 * justamente el que les faltaba a las demás para no partirse en dos renglones.
 */
function Detalle({ conteo, onClose }) {
    const c = conteo;
    const abiertas = Number(c.descuadradas || 0) - Number(c.resueltas || 0);
    const firmada = Number(c.diferencia || 0);
    const pendiente = Number(c.pendiente || 0);
    return (
        <LiquidModal open={!!c} onClose={onClose}
            maxWidth="max-w-5xl" className="h-fit" ariaLabel={`Conteo ${c.folio}`}>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">{c.folio}</h3>
                    <p className="text-caption text-content-3">
                        {rangoDeDias(c.dia_desde, c.dia_hasta)} · {c.cuantas} {Number(c.cuantas) === 1 ? 'bolsa' : 'bolsas'}
                        {' '}· {selloDeTiempo(c.cerrado_at)}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-5">
                {/* Las cuatro cifras en UNA fila, en el orden en que se leen:
                    lo que debía haber, lo que se contó, la resta, y lo que
                    todavía no explicó nadie. La última es la que manda y por eso
                    va aparte, contra el borde. */}
                <div data-surface="card"
                    className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 px-4 py-3">
                    <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                        <Cifra rotulo="Debía haber">{formatMoney(c.total_esperado)}</Cifra>
                        <Cifra rotulo="Se contó" fuerte>{formatMoney(c.total_contado)}</Cifra>
                        <Cifra rotulo="Diferencia al contar">
                            {Math.abs(firmada) < 0.01
                                ? <span className="text-success-text">Cuadró</span>
                                : (
                                    <span className={firmada < 0 ? 'text-danger-text' : 'text-warning-text'}>
                                        {`${firmada < 0 ? '−' : '+'}${formatMoney(Math.abs(firmada))}`}
                                    </span>
                                )}
                        </Cifra>
                    </div>
                    <div className="text-right">
                        <div className="text-micro font-black uppercase tracking-widest text-content-3">
                            Sin resolver
                        </div>
                        <div className="mt-1.5">
                            {Math.abs(pendiente) < 0.01 && Number(c.descuadradas || 0) > 0 ? (
                                <Badge variant="success" size="md" icon={CheckCircle2} className="whitespace-nowrap">{formatMoney(0)}</Badge>
                            ) : (
                                <Diferencia valor={pendiente} size="md" />
                            )}
                        </div>
                    </div>
                </div>

                {/* Las dos firmas, con su cara y su verbo. Contar y firmar son
                    dos actos y pueden ser dos personas — que es el pedido que
                    dio origen a toda esta pantalla. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-caption font-bold text-content">
                            {(c.contaron?.length || 0) === 1 ? 'La contó' : 'La contaron'}
                        </span>
                        {(c.contaron || []).length
                            ? c.contaron.map((p) => (
                                <Persona key={p.name} nombre={p.name} foto={p.photo_url} />
                            ))
                            : <span className="text-content-3">—</span>}
                    </span>
                    <span className="flex items-center gap-2">
                        <span className="text-caption font-bold text-content">La firmó</span>
                        <Persona nombre={c.cerrado_por} foto={c.cerrado_por_foto} />
                    </span>
                </div>

                {Number(c.descuadradas) > 0 && (
                    <p className="text-caption text-content-2">
                        <span className="font-bold text-content">
                            {Number(c.descuadradas) === 1 ? 'Una bolsa no cuadró' : `${c.descuadradas} bolsas no cuadraron`}
                        </span>
                        {abiertas > 0
                            ? ` · ${abiertas === 1 ? 'falta anotar una causa' : `faltan ${abiertas} causas por anotar`}.`
                            : ' · todas tienen su causa anotada.'}
                    </p>
                )}

                {/* ── Sala por sala ─────────────────────────────────────────
                    Encabezado con su total, la franja de sus días, y su tabla.
                    Es el orden en que se cuenta: se toma la sala, se apilan sus
                    días, y recién ahí se abre bolsa por bolsa. */}
                {(c.por_sala || []).map((s) => (
                    <section key={s.branch_id} className="space-y-2">
                        <div className="flex items-baseline justify-between gap-3 px-1 flex-wrap">
                            <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                {s.sala}
                            </h4>
                            <span className="text-caption text-content-3 tabular-nums">
                                {s.cuantas} {Number(s.cuantas) === 1 ? 'bolsa' : 'bolsas'}
                                {' '}· <b className="text-label font-bold text-content">{formatMoney(s.contado)}</b>
                                {Number(s.descuadradas) > 0 && (
                                    <span className="text-danger-text">
                                        {' '}· {s.descuadradas} sin cuadrar
                                    </span>
                                )}
                            </span>
                        </div>

                        {/* Los días de ESTA sala. Con uno solo se calla: su cifra
                            sería la del encabezado, palabra por palabra, y
                            repetirla dos renglones seguidos enseña a no leer
                            ninguna de las dos. */}
                        {(s.dias?.length || 0) > 1 && (
                            <div data-surface="card" className="flex flex-wrap gap-x-10 gap-y-3 px-4 py-3">
                                {s.dias.map((d) => (
                                    <div key={d.fecha}>
                                        <div className="text-micro font-black uppercase tracking-widest text-content-3">
                                            {fechaLarga(d.fecha)}
                                        </div>
                                        <div className="text-title-sm font-bold tabular-nums text-content mt-0.5">
                                            {formatMoney(d.contado)}
                                        </div>
                                        <div className="text-micro text-content-3 tabular-nums">
                                            {d.cuantas} {Number(d.cuantas) === 1 ? 'bolsa' : 'bolsas'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <BolsasDeLaSala bolsas={s.bolsas} />
                    </section>
                ))}
            </LiquidModal.Body>
        </LiquidModal>
    );
}

/**
 * La lista llega POR PROP y no se pide acá (2026-08-26).
 *
 * Antes esta sección hacía su propia consulta y se la ahorraba cuando estaba
 * plegada, que era lo correcto mientras fuera la única que las necesitaba.
 * Desde que la píldora de la vista filtra POR TANDA hay dos consumidores, y con
 * cada uno pidiendo lo suyo la ranura del filtro se quedaba sin opciones justo
 * cuando la sección estaba cerrada — un filtro vacío que no dice por qué.
 * Ahora las carga `CircuitoDeBolsas`, que es quien ya carga todo lo demás.
 */
export default function ConteosDeBolsas({
    lista = [], cargando = false, conteoId = '', plegada, onPlegar,
}) {
    const [abierto, setAbierto] = useState(null);

    /* Con una tanda elegida en la píldora, la tabla muestra ESA. Si mostrara las
     * tres mientras «Contadas» ya está recortada, las dos mitades de la misma
     * pantalla estarían hablando de conjuntos distintos. */
    const filas = useMemo(
        () => (conteoId ? lista.filter((c) => String(c.id) === String(conteoId)) : lista),
        [lista, conteoId],
    );

    /* `abiertas` es lo que le falta a alguien, y por eso es lo que se dice: las
       descuadradas ya resueltas no son trabajo pendiente. Es el mismo criterio
       que la columna «Sin resolver» y que la baldosa del carril — tres sitios
       de la misma pantalla contando lo mismo. */
    const totales = useMemo(() => filas.reduce((a, c) => ({
        contado: a.contado + Number(c.total_contado || 0),
        abiertas: a.abiertas + Math.max(0, Number(c.descuadradas || 0) - Number(c.resueltas || 0)),
    }), { contado: 0, abiertas: 0 }), [filas]);

    return (
        <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1 flex-wrap">
                <h3 className="text-label font-bold text-content">
                    <button type="button" onClick={onPlegar} aria-expanded={!plegada}
                        className="flex items-center gap-2 min-h-[var(--tap-min)] text-left
                                   hover:text-content-2 transition-colors">
                        {plegada ? <ChevronDown size={14} className="text-content-3 shrink-0" />
                            : <ChevronUp size={14} className="text-content-3 shrink-0" />}
                        <Scale size={15} className="text-content-3" />
                        Conteos
                    </button>
                </h3>
                <span className="text-caption text-content-3 tabular-nums">
                    {filas.length} {filas.length === 1 ? 'conteo' : 'conteos'}
                    {filas.length > 0 && (
                        <> · <b className="text-label font-bold text-content">{formatMoney(totales.contado)}</b></>
                    )}
                </span>
            </div>
            {!plegada && (<>
            <p className="text-caption text-content-3 px-1">
                Cada tanda que se firmó, con lo que debía haber, lo que se contó y quién la contó.
                {totales.abiertas > 0 && ` ${totales.abiertas === 1
                    ? 'Una bolsa no cuadró y sigue sin causa anotada'
                    : `${totales.abiertas} bolsas no cuadraron y siguen sin causa anotada`} en estas fechas.`}
            </p>

            <DataTable
                columns={COLUMNAS}
                loading={cargando}
                /* El toque de la fila va a un destino de verdad —el cuadre de la
                   tanda y sus bolsas—, no a la hoja genérica. */
                movil={{ usarAccionDeFila: true }}
                minWidth="640px"
                empty={{ icon: Scale, message: conteoId
                    ? 'Ese conteo no cae en estas fechas'
                    : 'Sin conteos firmados en estas fechas' }}
            >
                {filas.map((c, i) => (
                    <DataRow key={c.id} index={i} onClick={() => setAbierto(c)}>
                        <DataCell>
                            <span className="font-bold text-content">{c.folio}</span>
                        </DataCell>
                        <DataCell>{fechaLarga(c.fecha)}</DataCell>
                        <DataCell hideBelow="md">
                            <span className="text-caption text-content-2 tabular-nums">
                                {rangoDeDias(c.dia_desde, c.dia_hasta)}
                            </span>
                        </DataCell>
                        <DataCell hideBelow="lg">
                            {/* Con más de dos, la cara de las dos primeras y el
                               resto en número: tres avatares con nombre no
                               entran en una celda, y el detalle los lista. */}
                            {(c.contaron || []).length ? (
                                <span className="inline-flex items-center gap-2 flex-wrap">
                                    {c.contaron.slice(0, 2).map((p) => (
                                        <Persona key={p.name} nombre={p.name} foto={p.photo_url} />
                                    ))}
                                    {c.contaron.length > 2 && (
                                        <span className="text-caption text-content-3">
                                            +{c.contaron.length - 2}
                                        </span>
                                    )}
                                </span>
                            ) : <span className="text-content-3">—</span>}
                        </DataCell>
                        <DataCell align="right" hideBelow="sm">
                            <span className="tabular-nums text-content-2">
                                {formatMoney(c.total_esperado)}
                            </span>
                        </DataCell>
                        <DataCell align="right">
                            <span className="font-bold tabular-nums text-content">
                                {formatMoney(c.total_contado)}
                            </span>
                        </DataCell>
                        <DataCell align="right">
                            <SinResolver conteo={c} />
                        </DataCell>
                        <DataCell align="right" hideBelow="md">
                            <span className="inline-flex items-center gap-1 text-content-2 tabular-nums">
                                <Package size={12} className="text-content-3" />
                                {c.cuantas}
                            </span>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            </>)}

            {abierto && (
                <Detalle conteo={abierto} onClose={() => setAbierto(null)} />
            )}
        </section>
    );
}
