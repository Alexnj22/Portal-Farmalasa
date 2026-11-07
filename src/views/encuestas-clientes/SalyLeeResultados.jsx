import React from 'react';
import { BarChart3, GitCompareArrows, Lightbulb, RefreshCw } from 'lucide-react';
import SalyAvatar from '../../components/common/SalyAvatar';
import Button from '../../components/common/Button';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { bloquesDeLectura, estadoDeLectura } from '@nucleo/utils/encuestasLectura';

/**
 * Lo que Saly leyó de los resultados (pedido del usuario 2026-11-07: «mejóralo
 * visualmente»), por bloques —en pocas palabras, los números, lo que los
 * explica y qué haría— en vez de un párrafo corrido.
 *
 * La Saly que FLOTA no vive acá: es la burbuja de siempre (`SalyBurbuja`, el
 * espacio que ya tiene en Efectivo), a la que esta vista le pasa un aviso con
 * `avisoDeLectura`. Una Saly propia flotando chocaba con la burbuja del chat y
 * con las flechas de subir y bajar (usuario: «¿por qué sale ahí? si Saly
 * tiene su espacio»). Sin burbuja (hoy está en prueba con una sola persona),
 * esta tarjeta invita a pedir la lectura.
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
export default function LecturaDeSaly({ lectura, nombre, leyendo, onActualizar }) {
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
    if (!lectura?.texto) {
        if (!e.puede) return null;
        return (
            <section data-surface="card" className="p-4 sm:p-5 flex flex-wrap items-center gap-3">
                <SalyAvatar animo="atencion" size={48} />
                <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold text-content">¿Te digo qué significan estos resultados?</p>
                    <p className="text-body-sm text-content-3">
                        Leo los números de {nombre}, cruzo las respuestas entre sí y te digo qué haría.
                    </p>
                </div>
                <Button variant="primary" size="sm" onClick={onActualizar}>Léelos, Saly</Button>
            </section>
        );
    }
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
