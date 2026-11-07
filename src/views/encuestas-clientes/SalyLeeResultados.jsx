import React, { useState } from 'react';
import { BarChart3, GitCompareArrows, Lightbulb, MapPin, RefreshCw, Store, Users, X } from 'lucide-react';
import SalyAvatar from '../../components/common/SalyAvatar';
import Button from '../../components/common/Button';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { bloquesDeLectura, estadoDeLectura, invitacionDeSaly } from '@nucleo/utils/encuestasLectura';
import { CAMPO } from '@nucleo/utils/encuestasClientes';

/**
 * Saly en Resultados (pedido del usuario 2026-11-07: «que aparezca ya
 * flotando diciendo que al tocarla interpretará todo; si fueran varias
 * sucursales, que pregunte de qué sucursal o si todas; y mejóralo
 * visualmente»).
 *
 * `SalyFlotante` vive abajo a la derecha con su globo; al tocarla, si hay más
 * de un lugar que leer, pregunta cuál. `LecturaDeSaly` pinta lo que leyó por
 * bloques —en pocas palabras, los números, lo que los explica y qué haría—
 * en vez de un párrafo corrido.
 *
 * La burbuja de ayuda general (`SalyBurbuja`) no se anota en esta vista, así
 * que nunca hay dos Saly en pantalla.
 */

/** Los números del texto, en negrita: es lo primero que el ojo busca. */
function ConCifras({ texto }) {
    const partes = String(texto).split(/(\d+(?:[.,]\d+)?\s?%|\(\d+ de \d+\)|\b\d+ de \d+\b)/g);
    return partes.map((p, i) => (i % 2
        ? <strong key={i} className="font-bold text-content tabular-nums">{p}</strong>
        : <React.Fragment key={i}>{p}</React.Fragment>));
}

const ICONO = { numeros: BarChart3, cruces: GitCompareArrows, acciones: Lightbulb };

/**
 * @param {{ lectura: any, nombre: string, leyendo: boolean, onActualizar: () => void }} props
 */
export function LecturaDeSaly({ lectura, nombre, leyendo, onActualizar }) {
    const e = estadoDeLectura(lectura);
    if (leyendo) {
        return (
            <section data-surface="card" className="p-4 sm:p-5 flex items-center gap-3" aria-live="polite">
                <SalyAvatar animo="pensando" size={48} />
                <div className="min-w-0">
                    <p className="text-body font-semibold text-content">Estoy leyendo los resultados de {nombre}…</p>
                    <p className="text-body-sm text-content-3">Cruzo las respuestas entre sí para ver qué explica cada cosa. Tardo menos de un minuto.</p>
                </div>
            </section>
        );
    }
    if (!lectura?.texto) return null;
    const bloques = bloquesDeLectura(lectura.texto);
    const resumen = bloques.find((b) => b.clave === 'resumen') || (bloques[0]?.titulo == null ? bloques[0] : null);
    const resto = bloques.filter((b) => b !== resumen);

    return (
        <section data-surface="card" className="p-4 sm:p-5 space-y-4" aria-label="Lo que Saly leyó de los resultados">
            <div className="flex flex-wrap items-center gap-3">
                <SalyAvatar animo="atencion" size={48} />
                <div className="min-w-0 flex-1">
                    <TituloDeSeccion nivel="seccion">Qué significan los resultados</TituloDeSeccion>
                    <p className="text-caption text-content-3">
                        Saly leyó {lectura.respuestas_n} respuesta{lectura.respuestas_n === 1 ? '' : 's'} de {nombre}
                        {' · '}{fechaTexto(lectura.generado_at, { day: 'numeric', month: 'short' })} {hora12(lectura.generado_at)}
                    </p>
                </div>
                {e.puede && (
                    <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onActualizar}>
                        Leer otra vez ({e.nuevas} nuevas)
                    </Button>
                )}
            </div>

            {resumen && (
                <div data-animo="atencion" className="saly-toque rounded-2xl rounded-tl-md px-4 py-3">
                    <p className="text-micro font-black uppercase tracking-widest text-content-3 mb-1">En pocas palabras</p>
                    <p className="text-body sm:text-body-lg leading-relaxed text-content">
                        <ConCifras texto={[resumen.texto, ...resumen.puntos].filter(Boolean).join(' ')} />
                    </p>
                </div>
            )}

            {resto.map((b) => {
                const Icono = ICONO[b.clave] || BarChart3;
                const acciones = b.clave === 'acciones';
                const items = b.puntos.length ? b.puntos : [b.texto];
                return (
                    <div key={`${b.clave}-${b.titulo}`} className="space-y-2">
                        <p className="flex items-center gap-1.5 text-micro font-black uppercase tracking-widest text-content-3">
                            <Icono size={13} aria-hidden="true" /> {b.titulo}
                        </p>
                        {b.puntos.length > 0 && b.texto && <p className="text-body-sm text-content-2">{b.texto}</p>}
                        <ul className={acciones ? 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-2 md:grid-cols-2'}>
                            {items.map((t, i) => (
                                <li key={i}
                                    className="flex items-start gap-2.5 rounded-xl bg-surface-card-hover px-3 py-2.5 text-body-sm leading-relaxed text-content-2">
                                    {acciones ? (
                                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-micro font-black text-white">
                                            {i + 1}
                                        </span>
                                    ) : (
                                        <Icono size={15} className="mt-0.5 shrink-0 text-content-3" aria-hidden="true" />
                                    )}
                                    <span className="min-w-0"><ConCifras texto={t} /></span>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </section>
    );
}

/**
 * @param {{ lectura: any, lugares: {value: number|null, label: string, respuestas: number}[],
 *           leyendo: boolean, onLeer: (branchId: number|null) => void }} props
 */
export default function SalyFlotante({ lectura, lugares, leyendo, onLeer }) {
    const [eligiendo, setEligiendo] = useState(false);
    const [callada, setCallada] = useState(false);
    const varias = lugares.length > 1;
    const invitacion = invitacionDeSaly(lectura, { varias });
    if (!invitacion && !leyendo) return null;

    const tocar = () => {
        if (leyendo) return;
        setCallada(false);
        if (varias) setEligiendo((v) => !v);
        else onLeer(lugares[0]?.value ?? null);
    };
    const elegir = (v) => { setEligiendo(false); onLeer(v); };

    const globo = leyendo ? 'Estoy leyendo… ya casi.' : invitacion;

    return (
        <div className="fixed right-[max(16px,var(--sa-right))] bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom)))] z-tabs flex items-end gap-2 pointer-events-none">
            {eligiendo ? (
                <div data-surface="dropdown" role="dialog" aria-label="¿Qué resultados leo?"
                    className="pointer-events-auto w-[min(18rem,calc(100vw-6.5rem))] rounded-2xl rounded-br-md overflow-hidden">
                    <div data-animo="atencion" className="saly-toque rounded-[inherit] px-3 pb-3 pt-2">
                        <div className="flex items-center justify-between">
                            <p className="text-body-sm font-bold text-content">¿Qué resultados leo?</p>
                            <button type="button" onClick={() => setEligiendo(false)} aria-label="Cerrar"
                                className="grid min-h-[var(--tap-min)] min-w-[var(--tap-min)] place-items-center rounded-full text-content-3 hover:text-content active:scale-[0.97]">
                                <X size={16} aria-hidden="true" />
                            </button>
                        </div>
                        <ul className="grid gap-1">
                            {lugares.map((l) => {
                                const Icono = l.value == null ? Users : l.value === CAMPO ? MapPin : Store;
                                return (
                                    <li key={String(l.value)}>
                                        <button type="button" onClick={() => elegir(l.value)} data-interactive=""
                                            className="flex w-full min-h-[var(--tap-min)] items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-surface-card-hover active:scale-[0.97]">
                                            <Icono size={16} className="shrink-0 text-content-3" aria-hidden="true" />
                                            <span className={`flex-1 text-body-sm ${l.value == null ? 'font-semibold text-content' : 'text-content'}`}>{l.label}</span>
                                            <span className="text-micro tabular-nums text-content-3">{l.respuestas} resp.</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            ) : !callada && globo && (
                <div data-surface="dropdown" className="pointer-events-auto w-[min(15rem,calc(100vw-6.5rem))] rounded-2xl rounded-br-md overflow-hidden">
                    <div data-animo={leyendo ? 'pensando' : 'atencion'} className="saly-toque rounded-[inherit] flex items-start gap-1 py-2 pl-3 pr-1">
                        <button type="button" onClick={tocar} className="flex-1 text-left text-body-sm text-content py-1">{globo}</button>
                        {!leyendo && (
                            <button type="button" onClick={() => setCallada(true)} aria-label="Ocultar el mensaje de Saly"
                                className="grid min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0 place-items-center rounded-full text-content-3 hover:text-content active:scale-[0.97]">
                                <X size={14} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                </div>
            )}
            <button type="button" onClick={tocar} aria-label={leyendo ? 'Saly está leyendo los resultados' : 'Saly: interpretar los resultados'}
                aria-expanded={varias ? eligiendo : undefined}
                className="pointer-events-auto shrink-0 rounded-full active:scale-[0.97] transition-transform">
                <SalyAvatar animo={leyendo ? 'pensando' : 'atencion'} size={60} decorativa />
            </button>
        </div>
    );
}
