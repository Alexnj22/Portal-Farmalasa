import React, { useState, useMemo, useCallback } from 'react';
import { Scale, ChevronDown, Check, X, AlertTriangle, Loader2 } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Checkbox from '../../components/common/Checkbox';
import LiquidSelect from '../../components/common/LiquidSelect';
import Notice from '../../components/common/Notice';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import {
    CLASIFICACION_OPTIONS, SECTOR_OPTIONS,
    tiposCostoGasto, clasificacionLabel, sectorLabel, tipoCostoGastoLabel, fmtMoneda,
} from '../../utils/f07Catalogos';

/**
 * PanelDeducibilidad — la revisión de la clasificación fiscal, POR REGLA.
 *
 * ── Por qué no es una lista de proveedores ────────────────────────────────
 * La primera versión (v2.584.0) puso la confirmación en el listado: un botón
 * «Confirmar deducibilidad (67)» sobre filas donde ni el estado ni la propuesta
 * se veían. El usuario la rechazó el 2026-08-12 y tenía razón — no se puede
 * confirmar lo que no está en pantalla.
 *
 * El error fue de encuadre, no de detalle. Medido contra producción el
 * 2026-08-13, las 162 fichas sin confirmar caen en 12 reglas:
 *
 *     7 reglas · 67 proveedores · $56,504.16   propuestas del sistema
 *     5 reglas · 36 proveedores ·  $3,220.83   las que la ley condiciona
 *     —        · 59 proveedores ·      $7.94   sin giro registrado
 *
 * Son 12 decisiones, no 162. Y una sola regla —mercadería, Art. 65 nº1— cubre
 * 52 proveedores y el 93% del crédito fiscal. Agrupar por regla es además cómo
 * decide un contador: no mira ocho gasolineras una por una, decide si el
 * reparto es indispensable para el giro.
 *
 * ── El orden es por PLATA, y eso no es un detalle ─────────────────────────
 * Ordenar por cantidad de documentos engaña: comisiones bancarias tiene 190
 * documentos y $81.82 (a $0.43 cada uno) mientras el alquiler tiene 7
 * documentos y $341.30. La tarjeta muestra el crédito fiscal porque es lo que
 * está en juego al apretar el botón.
 *
 * ── Las condicionadas no se «confirman»: se responden ─────────────────────
 * Las propuestas ya traen los valores del anexo derivados del giro, así que
 * confirmarlas es aceptar. Las condicionadas nacen en blanco a propósito —la
 * ley no permite derivarlas— y por eso la tarjeta hace la pregunta legal en
 * texto llano y sólo después de responderla ofrece los campos del F-07.
 *
 * Y una de ellas no se decide en grupo: «giro demasiado genérico» junta
 * hospitales, televisión y «servicios n.c.p.», donde el giro registrado no dice
 * qué se compró. Esa tarjeta manda a revisar una por una en vez de fingir que
 * una respuesta alcanza — que es el mismo error de la pantalla anterior, en
 * chico.
 */

const SIN_GIRO = '__sin_giro__';

// Nombre llano de cada regla. El texto legal completo vive en la base
// (`clasificacion_base_legal`) y se muestra debajo; esto es el título que hace
// falta para reconocerla de un vistazo, y la base no lo tiene.
//
// Se busca por el artículo + una marca del texto, no por igualdad: el texto de
// la base es una frase larga y atarla entera acá sería exactamente la lista a
// mano que se desincroniza. Sin coincidencia el título ES el texto legal —
// degrada, no se rompe.
const TITULOS = [
    [/^Art\. 65 nº1/,                    'Mercadería para reventa'],
    [/^Art\. 65 nº4.*teléfono/i,         'Teléfono e internet'],
    [/^Art\. 65 nº4.*eléctrica/i,        'Energía eléctrica'],
    [/^Art\. 65 nº4.*agua/i,             'Agua (suministro público)'],
    [/^Art\. 65 nº3.*financieros/i,      'Comisiones y servicios financieros'],
    [/^Art\. 65 nº3.*arrendamiento/i,    'Alquiler del local'],
    [/^Art\. 65 nº3 LIVA — servicios/i,  'Otros servicios del giro'],
    [/^Art\. 65-A a\)/,                  'Alimentos y bebidas'],
    [/^Art\. 65-A c\)/,                  'Combustible y repuestos de vehículo'],
    [/^Art\. 65 nº3 LIVA \(exclusión\)/, 'Ferretería y pinturas'],
    [/^Art\. 65 nº2/,                    'Equipo de cómputo'],
    [/^Art\. 65 nº3 LIVA$/,              'Giro demasiado genérico'],
];

const tituloDeRegla = (baseLegal) => {
    if (!baseLegal) return 'Sin giro registrado';
    for (const [re, titulo] of TITULOS) if (re.test(baseLegal)) return titulo;
    return baseLegal;
};

// La pregunta que hay que responder, en el idioma del negocio, y su par de
// respuestas. `unoPorUno` = este grupo no se decide en tanda.
//
// `clasificacion_nota` (que trae la base) es la EXPLICACIÓN legal y se muestra
// igual; esto es la PREGUNTA, que es otra cosa: la nota describe la condición,
// la pregunta dice qué tiene que contestar quien está mirando.
//
// `aplica` es el punto de partida de los campos del anexo cuando la respuesta es
// «sí» — se puede cambiar antes de confirmar, no es una decisión tomada.
const PREGUNTAS = [
    [/^Art\. 65-A a\)/, {
        q: '¿La farmacia revende estos alimentos y bebidas?',
        si: 'Sí, se revenden', no: 'No, es consumo interno',
        // Si se revenden son activo realizable, igual que la mercadería.
        aplica: { f07_clasificacion: '1', f07_sector: '2', f07_tipo_costo_gasto: '5' },
    }],
    [/^Art\. 65-A c\)/, {
        q: '¿El vehículo es estrictamente indispensable para el giro?',
        si: 'Sí, es indispensable', no: 'No lo es',
        aplica: { f07_clasificacion: '2', f07_sector: '4', f07_tipo_costo_gasto: '1' },
    }],
    [/^Art\. 65 nº3 LIVA \(exclusión\)/, {
        q: '¿Fue mantenimiento, o fue obra sobre el local?',
        si: 'Fue mantenimiento', no: 'Fue obra sobre el local',
        aplica: { f07_clasificacion: '2', f07_sector: '4', f07_tipo_costo_gasto: '2' },
    }],
    [/^Art\. 65 nº2/, {
        q: '¿El equipo conserva su individualidad?',
        si: 'Sí, la conserva', no: 'No la conserva',
        aplica: { f07_clasificacion: '2', f07_sector: '4', f07_tipo_costo_gasto: '2' },
    }],
    // Sin `si`/`no`: hospitales, televisión y «servicios n.c.p.» no comparten
    // una respuesta. Fingir que sí sería el error de la pantalla anterior.
    [/^Art\. 65 nº3 LIVA$/, { q: 'Este grupo no se decide de una vez.', unoPorUno: true }],
];

const preguntaDeRegla = (baseLegal) => {
    if (!baseLegal) return null;
    for (const [re, p] of PREGUNTAS) if (re.test(baseLegal)) return p;
    return null;
};

const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : 0);

const GRID_FILA = 'grid-cols-[24px_minmax(0,1fr)_60px_92px] sm:grid-cols-[24px_minmax(0,1fr)_minmax(0,0.8fr)_60px_92px]';

// ── La lista desplegable de una regla ───────────────────────────────────────
function ListaProveedores({ rows, excluidos, onToggle, seleccionable, onAbrirFicha }) {
    return (
        <div data-surface="card" className="overflow-hidden">
            <div className={`grid items-center gap-3 px-3 py-1.5 text-micro font-black uppercase tracking-widest text-content-3 ${GRID_FILA}`}>
                <span />
                <span>Proveedor</span>
                <span className="hidden sm:block">Giro</span>
                <span className="text-right">Docs</span>
                <span className="text-right">Crédito</span>
            </div>
            {rows.map(r => (
                <div key={r.id} className="border-t border-divider flex items-center">
                    <label className={`grid items-center gap-3 px-3 py-2 text-body-sm flex-1 min-w-0 ${GRID_FILA}
                        ${seleccionable ? 'cursor-pointer' : ''}`}>
                        {seleccionable
                            ? <Checkbox size="sm" checked={!excluidos.has(r.id)} onChange={() => onToggle(r.id)} aria-label={`Incluir ${r.nombre}`} />
                            : <span />}
                        {/* min-w-0 + truncate: sin el primero el ítem del grid no
                            cede y un nombre largo estira la fila entera. */}
                        <span className="min-w-0 truncate font-bold text-content" title={r.nombre}>{r.nombre}</span>
                        <span className="hidden sm:block min-w-0 truncate text-caption text-content-3" title={r.desc_actividad || ''}>
                            {r.desc_actividad || '—'}
                        </span>
                        <span className="text-right tabular-nums text-content-2">{r.ccf}</span>
                        <span className="text-right tabular-nums font-black text-content">{fmtMoneda(r.credito_fiscal)}</span>
                    </label>
                    {/* La salida para el caso que no entra en la regla — y la
                        única acción del grupo que no se decide en tanda. */}
                    <Button variant="ghost" size="xs" className="shrink-0 mr-2" onClick={() => onAbrirFicha(r)}>
                        Abrir ficha
                    </Button>
                </div>
            ))}
        </div>
    );
}

// ── Tarjeta de una regla ────────────────────────────────────────────────────
function TarjetaRegla({ grupo, canEdit, busy, onConfirmarPropuesta, onResolver, onAbrirFicha }) {
    const [abierta, setAbierta] = useState(false);
    const [excluidos, setExcluidos] = useState(() => new Set());
    // null = todavía no respondió la pregunta legal; true/false = la respuesta.
    const [respuesta, setRespuesta] = useState(null);
    const [anexo, setAnexo] = useState(() => grupo.pregunta?.aplica || {});

    const esPropuesta = grupo.estado === 'propuesta';
    const pregunta = grupo.pregunta;

    const toggle = useCallback((id) => {
        setExcluidos(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const ids = useMemo(
        () => grupo.rows.filter(r => !excluidos.has(r.id)).map(r => r.id),
        [grupo.rows, excluidos],
    );
    const n = ids.length;
    const cuantos = (k) => (k === 1 ? 'el 1' : `los ${k}`);

    // Decidible en tanda: hay pregunta y tiene par de respuestas.
    const decidibleEnTanda = !!pregunta && !pregunta.unoPorUno;

    return (
        <article data-surface="card" className={`p-4 space-y-3 border-l-[3px] ${esPropuesta ? 'border-l-brand' : 'border-l-warning'}`}>
            <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                    <h4 className="text-body-lg font-black text-content text-balance">{grupo.titulo}</h4>
                    <p className="text-caption font-black text-content-2">
                        {grupo.baseLegal || 'Sin giro registrado en la ficha'}
                    </p>
                    <p className="text-caption text-content-3 tabular-nums mt-0.5">
                        {grupo.rows.length} proveedor{grupo.rows.length === 1 ? '' : 'es'} · {grupo.ccf} documento{grupo.ccf === 1 ? '' : 's'}
                    </p>
                </div>
                <div className="text-right shrink-0">
                    <span className="block text-title leading-tight font-black tabular-nums text-content">
                        {fmtMoneda(grupo.credito)}
                    </span>
                    <span className="text-micro uppercase tracking-widest font-black text-content-3">crédito fiscal</span>
                </div>
            </div>

            {/* La propuesta, deletreada. Es justo lo que faltaba en la pantalla
                anterior: el botón pedía confirmar sin decir qué. */}
            {esPropuesta && (
                <div data-surface="card" className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <span className="text-micro uppercase tracking-widest font-black text-content-3">Propuesta</span>
                    <Badge variant="success" uppercase={false}>Sí da crédito fiscal</Badge>
                    {[clasificacionLabel(grupo.f07.f07_clasificacion),
                      sectorLabel(grupo.f07.f07_sector),
                      tipoCostoGastoLabel(grupo.f07.f07_tipo_costo_gasto)]
                        .filter(Boolean)
                        .map(t => <Badge key={t} variant="neutral" uppercase={false}>{t}</Badge>)}
                </div>
            )}

            {/* La pregunta legal y la nota que la explica. Va ARRIBA de los
                controles a propósito: se decide leyendo esto. */}
            {pregunta && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <p className="text-body font-black text-content mb-1">{pregunta.q}</p>
                    {grupo.nota && <p className="text-body-sm text-content-2">{grupo.nota}</p>}
                    {grupo.dominante && grupo.rows.length > 1 && grupo.credito > 0 && (
                        <p className="text-caption text-content-3 tabular-nums mt-1.5">
                            El más grande del grupo es <span className="font-black text-content-2">{grupo.dominante.nombre}</span>
                            {` — ${fmtMoneda(grupo.dominante.credito_fiscal)}, el ${pct(grupo.dominante.credito_fiscal, grupo.credito)}% de lo que está en juego aquí.`}
                        </p>
                    )}
                </Notice>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {esPropuesta && canEdit && (
                    <Button
                        size="sm"
                        icon={busy ? Loader2 : Check}
                        disabled={busy || n === 0}
                        title={n === 0
                            ? 'Quitaste a todos de la lista — no queda nada que confirmar'
                            : 'Queda confirmada con tu nombre y la fecha. Sólo desde ahí el libro de compras la usa'}
                        onClick={() => onConfirmarPropuesta(ids)}
                    >
                        Confirmar {cuantos(n)}
                    </Button>
                )}

                {/* El grupo que NO se decide en tanda tiene una sola acción, y es
                    abrir la lista: ahí cada fila lleva su «Abrir ficha». Ofrecerle
                    un Sí/No sería fingir que seis casos distintos comparten una
                    respuesta — el mismo error de la pantalla anterior, en chico. */}
                {pregunta?.unoPorUno && (
                    <Button size="sm" disabled={busy} onClick={() => setAbierta(true)}>
                        Revisar uno por uno
                    </Button>
                )}

                {/* `respuesta === null` mantiene separados los dos pasos: primero
                    se contesta la pregunta legal, después se clasifica. */}
                {decidibleEnTanda && canEdit && respuesta === null && (
                    <>
                        <Button size="sm" variant="secondary" icon={Check} disabled={busy}
                            onClick={() => { setRespuesta(true); setAnexo(pregunta.aplica || {}); }}>
                            {pregunta.si}
                        </Button>
                        <Button size="sm" variant="secondary" icon={X} disabled={busy}
                            onClick={() => setRespuesta(false)}>
                            {pregunta.no}
                        </Button>
                    </>
                )}

                <Button size="sm" variant="ghost" aria-expanded={abierta} onClick={() => setAbierta(a => !a)}>
                    {abierta ? 'Ocultar' : `Ver ${cuantos(grupo.rows.length)}`}
                    <ChevronDown size={13} strokeWidth={2.5}
                        className={`transition-transform duration-[var(--dur-base)] ${abierta ? 'rotate-180' : ''}`} />
                </Button>
            </div>

            {/* Respondida la pregunta, recién ahí los campos del anexo. Con «no»
                no hay nada que clasificar: no deducible es no deducible. */}
            {respuesta !== null && (
                <div className="space-y-3 pt-1">
                    {respuesta ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label className="text-micro font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Costo o gasto</label>
                                <LiquidSelect
                                    value={anexo.f07_clasificacion || ''}
                                    onChange={(v) => setAnexo(a => ({ ...a, f07_clasificacion: v, f07_tipo_costo_gasto: '' }))}
                                    options={CLASIFICACION_OPTIONS} placeholder="Sin definir" clearable={false} compact />
                            </div>
                            <div>
                                <label className="text-micro font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">Sector</label>
                                <LiquidSelect
                                    value={anexo.f07_sector || ''}
                                    onChange={(v) => setAnexo(a => ({ ...a, f07_sector: v }))}
                                    options={SECTOR_OPTIONS} placeholder="Sin definir" clearable={false} compact />
                            </div>
                            <div>
                                <label className="text-micro font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block"
                                    title="Se filtra según Costo o Gasto: el manual del F-07 no admite las mismas opciones para los dos">
                                    Tipo de costo o gasto
                                </label>
                                <LiquidSelect
                                    value={anexo.f07_tipo_costo_gasto || ''}
                                    onChange={(v) => setAnexo(a => ({ ...a, f07_tipo_costo_gasto: v }))}
                                    options={tiposCostoGasto(anexo.f07_clasificacion)}
                                    placeholder={anexo.f07_clasificacion ? 'Sin definir' : 'Elige antes costo o gasto'}
                                    disabled={!anexo.f07_clasificacion}
                                    clearable={false} compact />
                            </div>
                        </div>
                    ) : (
                        <Notice variant="neutral">
                            Quedan como <span className="font-black">no deducibles</span>: su IVA no entra al libro de compras
                            como crédito fiscal. Son {fmtMoneda(grupo.credito)}.
                        </Notice>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            size="sm"
                            icon={busy ? Loader2 : Check}
                            disabled={busy || n === 0 || (respuesta && !anexo.f07_tipo_costo_gasto)}
                            title={respuesta && !anexo.f07_tipo_costo_gasto
                                ? 'Falta el tipo de costo o gasto que pide el anexo'
                                : 'Queda confirmada con tu nombre y la fecha'}
                            onClick={() => onResolver(ids, {
                                iva_deducible: respuesta,
                                f07_clasificacion: respuesta && anexo.f07_clasificacion ? Number(anexo.f07_clasificacion) : null,
                                f07_sector: respuesta && anexo.f07_sector ? Number(anexo.f07_sector) : null,
                                f07_tipo_costo_gasto: respuesta && anexo.f07_tipo_costo_gasto ? Number(anexo.f07_tipo_costo_gasto) : null,
                                // Gravada si da crédito fiscal; si no, no hay
                                // operación que declarar por esta vía.
                                f07_tipo_operacion: respuesta ? 1 : null,
                            })}
                        >
                            Confirmar {cuantos(n)} como {respuesta ? 'deducibles' : 'no deducibles'}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRespuesta(null)}>Cancelar</Button>
                    </div>
                </div>
            )}

            {abierta && (
                <ListaProveedores
                    rows={grupo.rows}
                    excluidos={excluidos}
                    onToggle={toggle}
                    seleccionable={canEdit && (esPropuesta || respuesta !== null)}
                    onAbrirFicha={onAbrirFicha}
                />
            )}
        </article>
    );
}

// ── El resto sin giro registrado: callado, y con su propio desplegable ──────
function BloqueSinGiro({ grupo, decisiones, onAbrirFicha }) {
    const [abierto, setAbierto] = useState(false);
    const vacio = new Set();
    return (
        <div data-surface="card" data-tono="dashed" className="p-4 space-y-2.5">
            <div className="flex items-baseline gap-3 flex-wrap">
                <h4 className="text-body font-black text-content-2">Sin giro registrado</h4>
                <span className="ml-auto text-body-sm text-content-3 tabular-nums">
                    {grupo.rows.length} proveedores · {grupo.ccf} documento{grupo.ccf === 1 ? '' : 's'} · {fmtMoneda(grupo.credito)}
                </span>
            </div>
            <p className="text-body-sm text-content-3 max-w-[68ch]">
                Nunca llegó un documento suyo con el giro adentro, así que no hay regla que derivar.
                No entran al conteo de las {decisiones} decisiones.
            </p>
            <Button size="sm" variant="ghost" aria-expanded={abierto} onClick={() => setAbierto(a => !a)}>
                {abierto ? 'Ocultar' : `Ver los ${grupo.rows.length}`}
                <ChevronDown size={13} strokeWidth={2.5}
                    className={`transition-transform duration-[var(--dur-base)] ${abierto ? 'rotate-180' : ''}`} />
            </Button>
            {abierto && (
                <ListaProveedores rows={grupo.rows} excluidos={vacio} onToggle={() => {}}
                    seleccionable={false} onAbrirFicha={onAbrirFicha} />
            )}
        </div>
    );
}

// ── El panel ───────────────────────────────────────────────────────────────
export default function PanelDeducibilidad({ rows, loading, canEdit, busy, onConfirmarPropuesta, onResolver, onAbrirFicha }) {
    const { propuestas, condicionadas, sinGiro, totales } = useMemo(() => {
        const mapa = new Map();
        for (const r of rows) {
            const key = r.clasificacion_base_legal || SIN_GIRO;
            let g = mapa.get(key);
            if (!g) {
                g = {
                    key,
                    baseLegal: r.clasificacion_base_legal || null,
                    nota: r.clasificacion_nota || null,
                    estado: r.clasificacion_estado,
                    titulo: tituloDeRegla(r.clasificacion_base_legal),
                    pregunta: preguntaDeRegla(r.clasificacion_base_legal),
                    // Las filas de una regla comparten los valores del anexo:
                    // salieron todas de la misma fila de la siembra.
                    f07: {
                        f07_clasificacion: r.f07_clasificacion,
                        f07_sector: r.f07_sector,
                        f07_tipo_costo_gasto: r.f07_tipo_costo_gasto,
                    },
                    rows: [], ccf: 0, credito: 0,
                };
                mapa.set(key, g);
            }
            g.rows.push(r);
            g.ccf += Number(r.ccf) || 0;
            g.credito += Number(r.credito_fiscal) || 0;
        }

        const grupos = [...mapa.values()];
        for (const g of grupos) {
            g.rows.sort((a, b) =>
                Number(b.credito_fiscal) - Number(a.credito_fiscal) ||
                (a.nombre || '').localeCompare(b.nombre || ''));
            g.dominante = g.rows[0];
        }
        // Por crédito fiscal y no por documentos: comisiones bancarias tiene 190
        // documentos y $81.82 — ordenar por conteo pone arriba lo que menos pesa.
        const porPlata = (a, b) => b.credito - a.credito || a.titulo.localeCompare(b.titulo);

        const propuestas    = grupos.filter(g => g.estado === 'propuesta').sort(porPlata);
        const condicionadas = grupos.filter(g => g.estado !== 'propuesta' && g.key !== SIN_GIRO).sort(porPlata);
        const sinGiro       = grupos.find(g => g.key === SIN_GIRO) || null;

        const suma = (gs) => gs.reduce((acc, g) => ({
            provs: acc.provs + g.rows.length,
            credito: acc.credito + g.credito,
        }), { provs: 0, credito: 0 });

        const prop = suma(propuestas);
        const cond = suma(condicionadas);

        return {
            propuestas, condicionadas, sinGiro,
            totales: {
                prop, cond,
                // Las decisiones son las REGLAS, no los proveedores — y los sin
                // giro no cuentan: no son trabajo, son 59 fichas con un
                // documento entre todas.
                decisiones: propuestas.length + condicionadas.length,
                credito: prop.credito + cond.credito + (sinGiro?.credito || 0),
            },
        };
    }, [rows]);

    if (loading) return <LoadingState label="Cargando la clasificación…" />;
    if (!rows.length) {
        return (
            <EmptyState
                icon={Scale}
                title="Todo clasificado"
                subtitle="Cada proveedor tiene su deducibilidad confirmada. El libro de compras ya puede usarlas."
            />
        );
    }

    const tarjeta = (g) => (
        <TarjetaRegla
            key={g.key}
            grupo={g}
            canEdit={canEdit}
            busy={busy}
            onConfirmarPropuesta={onConfirmarPropuesta}
            onResolver={onResolver}
            onAbrirFicha={onAbrirFicha}
        />
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
                <span className="text-display leading-none font-black tracking-tight tabular-nums text-content">
                    {fmtMoneda(totales.credito)}
                </span>
                <p className="text-body-sm text-content-2 max-w-[46ch]">
                    de crédito fiscal esperando una decisión, en <span className="font-black text-content">{totales.decisiones} decisiones</span>.
                    El libro de compras sólo usa las confirmadas.
                </p>
            </div>

            {propuestas.length > 0 && (
                <section className="space-y-3">
                    <header className="flex items-baseline gap-3 flex-wrap pb-2 border-b border-divider">
                        <h3 className="text-label font-black uppercase tracking-widest text-content-2">Propuestas del sistema</h3>
                        <span className="ml-auto text-body-sm text-content-3 tabular-nums">
                            <b className="text-content-2">{totales.prop.provs}</b> proveedores · <b className="text-content-2">{fmtMoneda(totales.prop.credito)}</b>
                        </span>
                    </header>
                    <div className="space-y-2.5">{propuestas.map(tarjeta)}</div>
                </section>
            )}

            {condicionadas.length > 0 && (
                <section className="space-y-3">
                    <header className="flex items-baseline gap-3 flex-wrap pb-2 border-b border-divider">
                        <h3 className="text-label font-black uppercase tracking-widest text-content-2">Las que la ley condiciona</h3>
                        <span className="ml-auto text-body-sm text-content-3 tabular-nums">
                            <b className="text-content-2">{totales.cond.provs}</b> proveedores · <b className="text-content-2">{fmtMoneda(totales.cond.credito)}</b>
                        </span>
                    </header>
                    <div className="space-y-2.5">{condicionadas.map(tarjeta)}</div>
                </section>
            )}

            {/* Callado y al final: 59 fichas con UN documento entre todas. En la
                pantalla anterior ocupaban el 62% de la lista de pendientes y
                escondían las 36 que sí hay que decidir. */}
            {sinGiro && (
                <BloqueSinGiro grupo={sinGiro} decisiones={totales.decisiones} onAbrirFicha={onAbrirFicha} />
            )}
        </div>
    );
}
