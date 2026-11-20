import React from 'react';
import { formatPct } from '@nucleo/utils/formatNumber';
import { graficaDe, porcionesDe, tipoDe } from '@nucleo/utils/encuestasClientes';

/**
 * La gráfica de una pregunta en Resultados (pedido del usuario, 2026-11-20:
 * «que me muestre mejor los resultados»).
 *
 * Dona cuando se elige UNA respuesta entre pocas (las porciones suman 100 %);
 * barras en la múltiple y en el NPS. SVG propio y no `recharts`: es una
 * figura fija, y así la vista no carga la librería (regla de pesadas).
 *
 * Cada respuesta es un botón: tocarla filtra todos los resultados por quienes
 * la eligieron (`onFiltrar(pregunta, clave)`); tocar la elegida lo quita.
 */

// Paleta categórica en orden de máximo contraste entre vecinos. Las clases
// van escritas enteras para que Tailwind las genere.
const TRAZO = ['stroke-chart-1', 'stroke-chart-4', 'stroke-chart-9', 'stroke-chart-3', 'stroke-chart-6', 'stroke-success', 'stroke-chart-8', 'stroke-warning'];
const FONDO = ['bg-chart-1', 'bg-chart-4', 'bg-chart-9', 'bg-chart-3', 'bg-chart-6', 'bg-success', 'bg-chart-8', 'bg-warning'];
const color = (i, lista) => lista[i % lista.length];

// En el NPS el color es el grupo: detractor, pasivo, promotor.
const fondoNps = (clave) => (Number(clave) >= 9 ? 'bg-success' : Number(clave) >= 7 ? 'bg-warning' : 'bg-danger');
// Sí en verde y No en rojo: el color repite lo que dice el texto.
const SI_NO = { true: ['stroke-success', 'bg-success'], false: ['stroke-danger', 'bg-danger'] };

export default function GraficaDePregunta({ p, numero, filtroActivo, onFiltrar }) {
    const forma = graficaDe(p);
    const total = p.respuestas || 0;
    const elegida = filtroActivo?.pregunta === p.id ? filtroActivo.valor : null;
    const tocar = (clave) => onFiltrar?.(p.id, elegida === clave ? null : clave);

    let cuerpo;
    if (forma === 'ranking') {
        const orden = Object.entries(p.ranking || {}).sort((a, b) => a[1] - b[1]);
        const peor = Math.max(1, ...orden.map(([, pos]) => pos));
        cuerpo = (
            <ol className="space-y-1.5">
                {orden.map(([id, pos], i) => (
                    <li key={id} className="space-y-1">
                        <div className="flex items-baseline gap-2 text-body-sm">
                            <span className="font-semibold text-content w-5 text-right tabular-nums">{i + 1}.</span>
                            <span className="text-content flex-1 min-w-0">{p.opciones?.find((o) => o.id === id)?.texto || id}</span>
                            <span className="text-micro text-content-3">posición promedio {pos}</span>
                        </div>
                        <div className="h-2 ml-7 rounded-full bg-surface-card-hover overflow-hidden" data-medida="dato">
                            {/* El primero, la barra llena: más corta = menos importante. */}
                            <div className={`h-full ${color(i, FONDO)}`} style={{ width: `${Math.max(8, ((peor - pos + 1) / peor) * 100)}%` }} />
                        </div>
                    </li>
                ))}
            </ol>
        );
    } else if (forma === 'numero') {
        cuerpo = (
            <p className="text-body-sm text-content-2">
                Promedio <span className="text-title font-black text-content tabular-nums">{p.promedio ?? '—'}</span>
            </p>
        );
    } else {
        const porciones = porcionesDe(p);
        const siNo = (c, k) => (p.tipo === 'si_no' ? SI_NO[c.clave]?.[k] : null);
        const trazo = (c, i) => siNo(c, 0) || color(i, TRAZO);
        const fondo = (c, i) => siNo(c, 1) || color(i, FONDO);
        cuerpo = forma === 'dona' ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <Dona porciones={porciones} total={total} elegida={elegida} trazo={trazo} />
                <Leyenda porciones={porciones} elegida={elegida} onTocar={tocar} marca={fondo} />
            </div>
        ) : (
            <Barras porciones={porciones} elegida={elegida} onTocar={tocar} total={total}
                marca={(c, i) => (p.tipo === 'nps' ? fondoNps(c.clave) : color(i, FONDO))}
                nota={p.tipo === 'multiple' ? 'Podían marcar varias. Los porcentajes no suman 100 %.' : null} />
        );
    }

    return (
        <div className="space-y-3" data-saly-ancla={`pregunta-${p.id}`}>
            <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-body-sm font-semibold text-content flex-1 min-w-0"><span className="text-content-3">{numero}.</span> {p.texto}</p>
                <span className="text-micro text-content-3">
                    {tipoDe(p.tipo).corto} · {total} resp.{p.puntaje != null ? ` · ${p.puntaje}/100` : ''}
                </span>
            </div>
            {total === 0 ? <p className="text-body-sm text-content-3">Nadie la respondió con estos filtros.</p> : cuerpo}
        </div>
    );
}

/** Dona: un círculo por porción con `stroke-dasharray`, empezando arriba. */
function Dona({ porciones, total, elegida, trazo }) {
    const R = 42;
    const C = 2 * Math.PI * R;
    // Dónde empieza cada porción: la suma de las anteriores, calculada antes de pintar.
    const inicios = porciones.reduce((a, c) => [...a, a[a.length - 1] + (total ? (c.n / total) * C : 0)], [0]);
    const mayor = porciones.reduce((a, c) => (c.n > (a?.n ?? -1) ? c : a), null);
    const centro = elegida != null ? porciones.find((c) => c.clave === elegida) : mayor;
    return (
        <div className="relative w-36 h-36 shrink-0 self-center" data-medida="dato">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" role="img"
                aria-label={porciones.map((c) => `${c.label}: ${c.n}`).join(', ')}>
                <circle cx="50" cy="50" r={R} fill="none" strokeWidth="14" className="stroke-surface-card-hover" />
                {porciones.map((c, i) => {
                    if (!c.n || !total) return null;
                    const largo = (c.n / total) * C;
                    const desde = inicios[i];
                    // 1 unidad de aire entre porciones vecinas, si hay más de una.
                    const aire = c.n === total ? 0 : Math.min(1, largo / 2);
                    return (
                        <circle key={c.clave} cx="50" cy="50" r={R} fill="none" strokeWidth="14"
                            className={`${trazo(c, i)} transition-opacity duration-[var(--dur-base)] ${elegida != null && elegida !== c.clave ? 'opacity-25' : ''}`}
                            strokeDasharray={`${Math.max(0, largo - aire)} ${C}`} strokeDashoffset={-desde} />
                    );
                })}
            </svg>
            {centro && total > 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
                    <span className="text-title font-black text-content tabular-nums leading-none">{formatPct(centro.pct, { decimales: 0 })}</span>
                    <span className="text-micro text-content-3 line-clamp-2 mt-0.5">{centro.label}</span>
                </div>
            )}
        </div>
    );
}

function Leyenda({ porciones, elegida, onTocar, marca }) {
    return (
        <ul className="flex-1 min-w-0 space-y-0.5">
            {porciones.map((c, i) => (
                <li key={c.clave}>
                    <BotonDeRespuesta c={c} activa={elegida === c.clave} apagada={elegida != null && elegida !== c.clave}
                        onClick={() => onTocar(c.clave)}>
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${marca(c, i)}`} />
                        <span className="text-body-sm text-content flex-1 min-w-0 text-left">{c.label}</span>
                        <span className="text-micro text-content-3 tabular-nums">{c.n}</span>
                        <span className="text-body-sm font-semibold text-content tabular-nums w-11 text-right">{formatPct(c.pct, { decimales: 0 })}</span>
                    </BotonDeRespuesta>
                </li>
            ))}
        </ul>
    );
}

function Barras({ porciones, elegida, onTocar, marca, nota }) {
    const max = Math.max(1, ...porciones.map((c) => c.pct));
    return (
        <div className="space-y-1">
            <ul className="space-y-0.5">
                {porciones.map((c, i) => (
                    <li key={c.clave}>
                        <BotonDeRespuesta c={c} activa={elegida === c.clave} apagada={elegida != null && elegida !== c.clave}
                            onClick={() => onTocar(c.clave)} columna>
                            <div className="flex items-baseline gap-2 w-full">
                                <span className="text-body-sm text-content flex-1 min-w-0 text-left">{c.label}</span>
                                <span className="text-micro text-content-3 tabular-nums">{c.n}</span>
                                <span className="text-body-sm font-semibold text-content tabular-nums w-11 text-right">{formatPct(c.pct, { decimales: 0 })}</span>
                            </div>
                            <div className="h-2.5 w-full rounded-full bg-surface-card-hover overflow-hidden" data-medida="dato">
                                <div className={`h-full rounded-full ${marca(c, i)}`} style={{ width: `${(c.pct / max) * 100}%` }} />
                            </div>
                        </BotonDeRespuesta>
                    </li>
                ))}
            </ul>
            {nota && <p className="text-micro text-content-3">{nota}</p>}
        </div>
    );
}

/** Una respuesta tocable: filtra por ella. */
function BotonDeRespuesta({ c, activa, apagada, onClick, columna = false, children }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={activa}
            title={activa ? 'Quitar este filtro' : `Ver sólo a quienes respondieron «${c.label}»`}
            className={`w-full min-h-[var(--tap-min)] px-2 py-1 rounded-btn flex ${columna ? 'flex-col justify-center gap-1' : 'items-center gap-2'}
                hover:bg-surface-card-hover active:scale-[0.99] transition-[opacity,background-color,transform] duration-[var(--dur-fast)]
                ${activa ? 'bg-brand/10 ring-1 ring-inset ring-brand/30' : ''} ${apagada ? 'opacity-45' : ''}`}>
            {children}
        </button>
    );
}
