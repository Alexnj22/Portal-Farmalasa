import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Package, Scale } from 'lucide-react';
import Badge from '../common/Badge';
import { DataTable, DataRow, DataCell } from '../common/DataTable';
import LiquidModal from '../common/LiquidModal';
import { formatMoney } from '../../utils/formatNumber';

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

/* El rango de días que cubre una tanda, dicho corto. Un solo día se dice
 * «17 ago» y no «17 ago → 17 ago», que sería decir dos veces lo mismo. */
const rangoDeDias = (c) => {
    if (!c?.dia_desde) return '—';
    const corto = (f) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV',
        { day: 'numeric', month: 'short' });
    return c.dia_desde === c.dia_hasta ? corto(c.dia_desde) : `${corto(c.dia_desde)} → ${corto(c.dia_hasta)}`;
};

/* Quiénes contaron, en una línea. Con más de dos se dice el número: tres
 * nombres completos en una celda de tabla no se leen, se estorban. */
const quienesContaron = (c) => {
    const gente = c?.contaron || [];
    if (!gente.length) return null;
    if (gente.length <= 2) return gente.join(' y ');
    return `${gente.length} personas`;
};

/* La diferencia con su signo y su tono. El cero se dice «Cuadró» y no «$0.00»,
 * igual que en la franja del conteo: quien mira esto quiere una respuesta, no
 * una cifra que hay que interpretar. */
function Diferencia({ valor, size = 'sm' }) {
    const dif = Number(valor || 0);
    if (Math.abs(dif) < 0.01) {
        return <Badge variant="success" size={size} icon={CheckCircle2}>Cuadró</Badge>;
    }
    return (
        <Badge variant={dif < 0 ? 'danger' : 'warning'} size={size} dot>
            {dif < 0 ? '−' : '+'}{formatMoney(Math.abs(dif))}
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
                <Badge variant="success" size="sm" icon={CheckCircle2}>{formatMoney(0)}</Badge>
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

/** El detalle: el cuadre que se firmó, quién hizo qué, y bolsa por bolsa. */
function Detalle({ conteo, nombreSala, onClose }) {
    const c = conteo;
    return (
        <LiquidModal open={!!c} onClose={onClose}
            maxWidth="max-w-lg" className="h-fit" ariaLabel={`Conteo ${c.folio}`}>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">{c.folio}</h3>
                    <p className="text-caption text-content-3">
                        {fechaLarga(c.fecha)} · lo firmó {c.cerrado_por || '—'} · {selloDeTiempo(c.cerrado_at)}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {/* Las mismas tres cifras y en el mismo orden que la franja de
                    «Por contar»: lo que debía haber, lo que se contó, la resta.
                    Que se lea igual acá que allá es lo que permite volver a
                    seguir la cuenta meses después. */}
                <div data-surface="card" className="px-4 py-3 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                        <span>Debía haber</span><span>{formatMoney(c.total_esperado)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                        <span>Se contó</span><span>{formatMoney(c.total_contado)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                        <span>Diferencia al contar</span>
                        <span>{Math.abs(Number(c.diferencia || 0)) < 0.01
                            ? 'Cuadró'
                            : `${Number(c.diferencia) < 0 ? '−' : '+'}${formatMoney(Math.abs(Number(c.diferencia)))}`}</span>
                    </div>
                    {/* Las DOS cifras, y la de abajo es la que manda: lo firmado
                        es el hecho, lo pendiente es lo que todavía hay que
                        hacer. Juntas se lee de corrido «faltaron $4,592.24 y no
                        queda nada sin explicar», que es la frase entera. */}
                    <div className="flex items-baseline justify-between gap-3 pt-1.5 border-t border-line">
                        <span className="text-subtitle font-bold text-content">Sin resolver</span>
                        {Math.abs(Number(c.pendiente || 0)) < 0.01 && Number(c.descuadradas || 0) > 0 ? (
                            <Badge variant="success" size="md" icon={CheckCircle2}>{formatMoney(0)}</Badge>
                        ) : (
                            <Diferencia valor={c.pendiente} size="md" />
                        )}
                    </div>
                </div>

                {/* Las dos firmas, dichas por separado y con su verbo. Es la
                    corrección del pedido: contar y firmar son dos actos y
                    pueden ser dos personas. */}
                <p className="text-caption text-content-2">
                    <span className="font-bold text-content">
                        {(c.contaron?.length || 0) === 1 ? 'La contó: ' : 'La contaron: '}
                    </span>
                    {(c.contaron || []).join(', ') || '—'}
                    {c.cerrado_por ? ` · la firmó ${c.cerrado_por}.` : '.'}
                </p>

                {Number(c.descuadradas) > 0 && (() => {
                    const abiertas = Number(c.descuadradas) - Number(c.resueltas || 0);
                    return (
                        <p className="text-caption text-content-2">
                            <span className="font-bold text-content">
                                {Number(c.descuadradas) === 1 ? 'Una bolsa no cuadró' : `${c.descuadradas} bolsas no cuadraron`}
                            </span>
                            {abiertas > 0
                                ? ` · ${abiertas === 1 ? 'falta anotar una causa' : `faltan ${abiertas} causas por anotar`}.`
                                : ' · todas tienen su causa anotada.'}
                        </p>
                    );
                })()}

                {/* Qué días entraron y cuánto de cada uno. Va ANTES de las
                    bolsas porque es la pregunta que se hace primero: con 43
                    bolsas, la lista de a una no responde «¿cuánto se contó del
                    martes?». */}
                {(c.por_dia?.length || 0) > 1 && (
                    <div className="space-y-1.5">
                        <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                            Por día
                        </h4>
                        <div data-surface="card" className="px-4 py-3 space-y-1.5">
                            {c.por_dia.map((x) => (
                                <div key={x.fecha}
                                    className="flex items-baseline justify-between gap-3 tabular-nums">
                                    <span className="text-caption text-content-2">
                                        {fechaLarga(x.fecha)}
                                        <span className="text-content-3">
                                            {' '}· {x.cuantas} {Number(x.cuantas) === 1 ? 'bolsa' : 'bolsas'}
                                        </span>
                                    </span>
                                    <span className="text-label font-bold text-content shrink-0">
                                        {formatMoney(x.contado)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="space-y-1.5">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                        {c.bolsas?.length || 0} {c.bolsas?.length === 1 ? 'bolsa' : 'bolsas'}
                    </h4>
                    <div className="space-y-1.5">
                        {(c.bolsas || []).map((b) => {
                            const dif = Math.round((Number(b.contado || 0) - Number(b.esperado || 0)) * 100) / 100;
                            const cuadra = Math.abs(dif) < 0.01;
                            return (
                                <div key={b.id} data-surface="card" className="px-3 py-2 space-y-1">
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="min-w-0">
                                            <span className="text-label font-bold text-content">{b.folio}</span>
                                            <span className="text-caption text-content-3">
                                                {' '}{nombreSala?.[b.branch_id] || ''} · {fechaLarga(b.fecha)} · {hhmm(b.hora)}
                                            </span>
                                        </span>
                                        <span className="text-label font-bold tabular-nums text-content shrink-0">
                                            {formatMoney(b.contado)}
                                        </span>
                                    </div>
                                    {/* Quién contó ESTA bolsa. Va en cada renglón y
                                        no sólo arriba porque es lo que se pregunta
                                        cuando una no cuadra: «¿quién la contó?»,
                                        no «¿quién contó ese día?». */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {!cuadra && <Diferencia valor={dif} />}
                                        {b.contado_por && (
                                            <span className="text-caption text-content-3">
                                                La contó {b.contado_por}
                                            </span>
                                        )}
                                        {b.dif_causa && (
                                            <span className="text-caption text-content-3 min-w-0 truncate">
                                                · {b.dif_causa}
                                                {b.dif_por ? ` (${b.dif_por})` : ''}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
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
    lista = [], cargando = false, nombreSala, conteoId = '', plegada, onPlegar,
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
                                {rangoDeDias(c)}
                            </span>
                        </DataCell>
                        <DataCell hideBelow="lg">
                            {quienesContaron(c)
                                ? <span className="text-caption text-content-2">{quienesContaron(c)}</span>
                                : <span className="text-content-3">—</span>}
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
                <Detalle conteo={abierto} nombreSala={nombreSala} onClose={() => setAbierto(null)} />
            )}
        </section>
    );
}
