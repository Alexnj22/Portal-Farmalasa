import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertOctagon, AlertTriangle, ArrowRight, BadgeCheck, Building2, Check, CheckCircle2, ClipboardCheck, Eye, FileCheck2,
    GraduationCap, Minus, PackageX, ShieldCheck, Undo2,
} from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import IconoEnCaja from '../../components/common/IconoEnCaja';
import IconoPorNombre from '../../components/common/IconoPorNombre';
import Notice from '../../components/common/Notice';
import PuntoDeEstado from '../../components/common/PuntoDeEstado';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { EmptyState, Skeleton } from '../../components/common/StateViews';
import { fetchResumenDeCumplimiento, mensajeDeCumplimiento } from '@nucleo/data/cumplimiento';
import { mapaDeLaRed, nombreDelSemestre } from '@nucleo/utils/cumplimiento';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';

const RegistroModal = lazy(() => import('./RegistroModal'));

/*
 * El tablero de cumplimiento (2026-11-11; rehecho el 2026-11-14, dos veces).
 *
 * Tres preguntas, en este orden:
 *   1. ¿Cómo va la red?  — el anillo (obligaciones cumplidas sobre las que
 *      aplican) y tres cifras: urgentes, por anotar, salas al día.
 *   2. ¿Qué toca hacer?  — una tarjeta por obligación con algo pendiente, de lo
 *      urgente a lo menos: por qué la pide la norma, una barra con una franja
 *      por sala (verde la que cumple) y las salas que faltan. Tocar una sala
 *      abre el formulario ya con esa sala (el reporte cero, con su semestre);
 *      lo que no se resuelve anotando lleva a su pestaña filtrada.
 *   3. ¿Dónde está cada cosa? — el mapa: obligaciones contra salas, una casilla
 *      por cruce. Sólo en pantallas anchas; en el teléfono las tarjetas ya
 *      dicen lo mismo.
 * Los números salen de `cumplimiento_resumen`; el cruce, de `mapaDeLaRed`.
 */

const ICONOS = { AlertOctagon, Undo2, BadgeCheck, FileCheck2, ClipboardCheck, GraduationCap, Eye, PackageX };
const TONO_CAJA = { danger: 'danger', warning: 'warning', info: 'neutro' };
const TONO_BADGE = { danger: 'danger', warning: 'warning', info: 'neutral' };
const FRANJA = { ok: 'bg-success', danger: 'bg-danger', warning: 'bg-warning', info: 'bg-content-3' };
const PESO = { danger: 0, warning: 1, info: 2 };

/** El anillo del porcentaje. Decorativo: el número va escrito adentro y en el texto. */
function Anillo({ pct }) {
    const R = 42;
    const L = 2 * Math.PI * R;
    const tono = pct >= 90 ? 'text-success' : pct >= 60 ? 'text-warning' : 'text-danger';
    return (
        <div className="relative w-28 h-28 shrink-0" aria-hidden>
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" className="stroke-current text-surface-card-hover" />
                <circle cx="50" cy="50" r={R} fill="none" strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={L} strokeDashoffset={L * (1 - pct / 100)}
                    className={`stroke-current ${tono} transition-[stroke-dashoffset] duration-[var(--dur-lento)]`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-title font-black text-content tabular-nums">{pct}%</span>
        </div>
    );
}

export default function TabResumen({ onIr, pestanas, puedeAnotar }) {
    const [salas, setSalas] = useState(null);
    const [error, setError] = useState(null);
    const [anotando, setAnotando] = useState(null); // { tipo, branchId, sala, inicial }
    const hoy = hoySV();

    const cargar = useCallback(() => {
        let vivo = true;
        fetchResumenDeCumplimiento().then(({ salas: s, error: e }) => {
            if (!vivo) return;
            setError(e ? mensajeDeCumplimiento(e) : null);
            setSalas(s);
        });
        return () => { vivo = false; };
    }, []);
    useEffect(() => cargar(), [cargar]);

    const mapa = useMemo(() => mapaDeLaRed(salas || [], hoy, fechaTexto, pestanas), [salas, hoy, pestanas]);

    // Las obligaciones con algo pendiente, de lo urgente a lo menos (y, entre
    // iguales, la que falta en más salas primero).
    const porHacer = useMemo(() => mapa.filas.map((f) => {
        const faltan = mapa.salas.filter((s) => s.celdas[f.clave]?.estado === 'falta');
        const aplican = mapa.salas.filter((s) => s.celdas[f.clave]?.estado !== 'na');
        const tono = faltan.reduce((t, s) => (PESO[s.celdas[f.clave].tono] < PESO[t] ? s.celdas[f.clave].tono : t), 'info');
        const semestre = faltan.find((s) => s.celdas[f.clave].semestre)?.celdas[f.clave].semestre;
        return { ...f, faltan, aplican, tono, semestre };
    }).filter((f) => f.faltan.length > 0)
        .sort((a, b) => PESO[a.tono] - PESO[b.tono] || b.faltan.length - a.faltan.length), [mapa]);
    const alDia = mapa.filas.filter((f) => !porHacer.some((p) => p.clave === f.clave));

    if (error) return <Notice variant="danger">{error}</Notice>;
    if (!salas) {
        return (
            <div className="space-y-4" aria-busy="true" aria-label="Revisando cada sala…">
                <Skeleton h={144} rounded="var(--radius-card)" />
                <Skeleton h={112} rounded="var(--radius-card)" />
                <Skeleton h={112} rounded="var(--radius-card)" />
            </div>
        );
    }
    if (salas.length === 0) return <EmptyState icon={ShieldCheck} title="Sin salas para revisar" />;

    const tocar = (f, s) => {
        const c = s.celdas[f.clave];
        if (f.crea && puedeAnotar(f.tab)) {
            setAnotando({ tipo: f.crea, branchId: s.branch_id, sala: s.sala, inicial: c?.semestre ? { periodo: c.semestre } : null });
        } else {
            onIr(f.tab, s.branch_id);
        }
    };
    const total = mapa.salas.length;
    const faltanTodas = mapa.aplicables - mapa.cumplidas;

    return (
        <div className="space-y-8">
            {/* ── 1. Cómo va la red ─────────────────────────────────────── */}
            <section data-surface="card" data-tono={faltanTodas ? undefined : 'success'}
                className="p-5 md:p-6 flex flex-col lg:flex-row lg:items-center gap-6">
                <div className="flex items-center gap-5 lg:flex-1 min-w-0">
                    <Anillo pct={mapa.pct} />
                    <div className="min-w-0 space-y-1">
                        <p className="text-caption font-bold text-content-3">Cumplimiento de la red</p>
                        <p className="text-title-lg font-black text-content leading-tight">
                            {faltanTodas ? `${faltanTodas} pendiente${faltanTodas === 1 ? '' : 's'}` : 'Todo al día'}
                        </p>
                        <p className="text-body-sm text-content-3">
                            Se cumplen {mapa.cumplidas} de {mapa.aplicables} obligaciones en {total} sala{total === 1 ? '' : 's'}.
                        </p>
                    </div>
                </div>
                <dl className="grid grid-cols-3 gap-2 lg:w-[34rem] shrink-0">
                    {[
                        { k: 'urgentes', label: 'Urgentes', valor: mapa.urgentes, icono: AlertTriangle, tono: mapa.urgentes ? 'danger' : 'neutro', sub: mapa.urgentes ? 'plazo legal corriendo' : 'nada vencido' },
                        { k: 'anotar', label: 'Por anotar', valor: mapa.pendientes, icono: ClipboardCheck, tono: mapa.pendientes ? 'warning' : 'neutro', sub: 'registros que faltan' },
                        { k: 'salas', label: 'Salas al día', valor: `${mapa.salasAlDia}/${total}`, icono: Building2, tono: mapa.salasAlDia === total ? 'success' : mapa.salasAlDia ? 'brand' : 'neutro', sub: 'sin nada pendiente' },
                    ].map((x) => {
                        const Icono = x.icono;
                        return (
                            <div key={x.k} className="rounded-xl bg-surface-card-hover p-3 md:p-4 flex flex-col gap-2 min-w-0">
                                <IconoEnCaja tono={x.tono} tamano="sm"><Icono size={16} /></IconoEnCaja>
                                <dd className={`text-title-lg font-black tabular-nums leading-none ${x.tono === 'danger' ? 'text-danger-text' : 'text-content'}`}>{x.valor}</dd>
                                <dt className="min-w-0">
                                    <span className="block text-body-sm font-bold text-content-2 truncate">{x.label}</span>
                                    <span className="block text-caption text-content-3 truncate max-sm:hidden">{x.sub}</span>
                                </dt>
                            </div>
                        );
                    })}
                </dl>
            </section>

            {/* ── 2. Qué toca hacer ─────────────────────────────────────── */}
            {porHacer.length === 0 ? (
                <div data-surface="card" data-tono="success" className="p-6 flex items-center gap-4">
                    <IconoEnCaja tono="success" tamano="lg"><CheckCircle2 size={22} /></IconoEnCaja>
                    <div>
                        <p className="text-body font-bold text-content">Todas las salas están al día</p>
                        <p className="text-body-sm text-content-3">Lo que se lleva en el portal está completo en toda la red.</p>
                    </div>
                </div>
            ) : (
                <section className="space-y-3">
                    <TituloDeSeccion nivel="seccion">Qué toca hacer</TituloDeSeccion>
                    <ul className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                        {porHacer.map((f) => {
                            const anotable = f.crea && puedeAnotar(f.tab);
                            const titulo = f.clave === 'fv_semestre' && f.semestre
                                ? `Reporte de ${nombreDelSemestre(f.semestre).toLowerCase()}` : f.titulo;
                            return (
                                <li key={f.clave} data-surface="card" data-tono={f.tono === 'danger' ? 'danger' : undefined}
                                    className="p-5 flex flex-col gap-4">
                                    <div className="flex items-start gap-4">
                                        <IconoEnCaja tono={TONO_CAJA[f.tono]} tamano="lg">
                                            <IconoPorNombre iconos={ICONOS} nombre={f.icono} size={22} />
                                        </IconoEnCaja>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-body font-bold text-content">{titulo}</p>
                                                <Badge variant={TONO_BADGE[f.tono]} uppercase={false}>
                                                    {f.faltan.length === f.aplican.length ? 'Falta en todas' : `Falta en ${f.faltan.length} de ${f.aplican.length}`}
                                                </Badge>
                                            </div>
                                            <p className="text-body-sm text-content-3 mt-1">{f.porQue}</p>
                                        </div>
                                    </div>

                                    {/* Una franja por sala: verde la que cumple. */}
                                    <div className="flex gap-1" role="img"
                                        aria-label={`${f.aplican.length - f.faltan.length} de ${f.aplican.length} salas al día`}>
                                        {f.aplican.map((s) => {
                                            const c = s.celdas[f.clave];
                                            return <span key={s.branch_id}
                                                className={`h-1.5 flex-1 rounded-full ${c.estado === 'ok' ? FRANJA.ok : FRANJA[c.tono]}`} />;
                                        })}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        {f.faltan.map((s) => {
                                            const c = s.celdas[f.clave];
                                            return (
                                                <button key={s.branch_id} type="button" onClick={() => tocar(f, s)}
                                                    title={anotable ? `Anotar en ${s.sala}` : c.texto}
                                                    className="group inline-flex items-center gap-2 pl-3 pr-2 min-h-[var(--tap-min)] rounded-full border border-border-card bg-surface-card text-body-sm font-bold text-content hover:bg-surface-card-hover hover:border-border-input active:scale-[0.97] transition-colors">
                                                    {s.sala}
                                                    {c.detalle && <Badge variant={TONO_BADGE[c.tono]} uppercase={false}>{c.detalle}</Badge>}
                                                    <ArrowRight size={14} className="text-content-3 group-hover:text-content transition-colors" aria-hidden />
                                                </button>
                                            );
                                        })}
                                        <Button variant="ghost" size="sm" className="ml-auto max-sm:hidden" onClick={() => onIr(f.tab, null)}>
                                            Ver registros
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {/* ── 3. El mapa de la red (pantallas anchas) ───────────────── */}
            {total > 1 && (
                <section className="space-y-3 max-md:hidden">
                    <TituloDeSeccion nivel="seccion">Mapa de la red</TituloDeSeccion>
                    <div data-surface="card" className="p-2 overflow-x-auto">
                        <div role="table" aria-label="Obligaciones por sala" className="grid w-full"
                            style={{ gridTemplateColumns: `minmax(13rem, 1.4fr) repeat(${total}, minmax(5rem, 1fr))`, minWidth: `${13 + total * 5}rem` }}>
                            <div role="row" className="contents">
                                <div role="columnheader" className="px-3 py-3 text-caption font-bold text-content-3">Obligación</div>
                                {mapa.salas.map((s) => (
                                    <div key={s.branch_id} role="columnheader" className="px-2 py-3 text-center">
                                        <p className="text-body-sm font-bold text-content truncate">{s.sala}</p>
                                        <p className={`text-caption ${s.faltan ? 'text-content-3' : 'text-success-text font-bold'}`}>
                                            {s.faltan ? `${s.faltan} pendiente${s.faltan === 1 ? '' : 's'}` : 'Al día'}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            {mapa.filas.map((f) => (
                                <div key={f.clave} role="row" className="contents">
                                    <div role="rowheader" className="px-3 py-2 flex items-center gap-3 border-t border-divider">
                                        <IconoPorNombre iconos={ICONOS} nombre={f.icono} size={16} className="text-content-3 shrink-0" />
                                        <span className="text-body-sm font-bold text-content-2">{f.titulo}</span>
                                    </div>
                                    {mapa.salas.map((s) => {
                                        const c = s.celdas[f.clave];
                                        return (
                                            <div key={s.branch_id} role="cell" className="px-2 py-2 flex items-center justify-center border-t border-divider">
                                                {c.estado === 'na' ? (
                                                    <Minus size={14} className="text-content-3" aria-label="No aplica" />
                                                ) : c.estado === 'ok' ? (
                                                    <IconoEnCaja tono="success" tamano="sm" forma="circulo"><Check size={16} aria-label="Al día" /></IconoEnCaja>
                                                ) : (
                                                    <button type="button" onClick={() => tocar(f, s)} title={c.texto} aria-label={`${f.titulo} en ${s.sala}: ${c.texto}`}
                                                        className="rounded-full active:scale-[0.94] hover:scale-110 transition-transform">
                                                        <IconoEnCaja tono={TONO_CAJA[c.tono]} tamano="sm" forma="circulo"
                                                            className={c.tono === 'danger' ? 'ring-1 ring-danger/30' : ''}>
                                                            {c.detalle && /^\d+$/.test(c.detalle)
                                                                ? <span className="text-caption font-black tabular-nums">{c.detalle}</span>
                                                                : <AlertTriangle size={14} />}
                                                        </IconoEnCaja>
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-content-3 px-1">
                        <span className="inline-flex items-center gap-1.5"><PuntoDeEstado className="bg-success" />Al día</span>
                        <span className="inline-flex items-center gap-1.5"><PuntoDeEstado className="bg-warning" />Por anotar</span>
                        <span className="inline-flex items-center gap-1.5"><PuntoDeEstado className="bg-danger" />Urgente</span>
                        <span className="inline-flex items-center gap-1.5"><Minus size={12} aria-hidden />No aplica</span>
                        <span>· Toca una casilla para resolverla.</span>
                    </div>
                </section>
            )}

            {/* ── Lo que ya se cumple ───────────────────────────────────── */}
            {alDia.length > 0 && porHacer.length > 0 && (
                <section className="space-y-3">
                    <TituloDeSeccion nivel="seccion">Al día en toda la red</TituloDeSeccion>
                    <div className="flex flex-wrap gap-2">
                        {alDia.map((f) => (
                            <span key={f.clave} className="inline-flex items-center gap-2 px-3 min-h-[var(--tap-min)] rounded-full bg-success/10 text-body-sm font-bold text-success-text">
                                <CheckCircle2 size={16} aria-hidden />{f.titulo}
                            </span>
                        ))}
                    </div>
                </section>
            )}

            {anotando && (
                <Suspense fallback={null}>
                    <RegistroModal tipo={anotando.tipo} modo="crear" branchId={anotando.branchId} sala={anotando.sala} inicial={anotando.inicial}
                        onClose={() => setAnotando(null)}
                        onHecho={() => { setAnotando(null); cargar(); }} />
                </Suspense>
            )}
        </div>
    );
}
