import React from 'react';
import Button from '../../components/common/Button';

const mesAnio = (v) => { const [a, m] = String(v || '').split('-'); return a && m ? `${m}/${a}` : 'sin fecha'; };
const igual = (a, b) => a && b && a.lote === b.lote && (a.vence || '') === (b.vence || '');

/**
 * Cuál lote sale de un renglón cuando el que pidió la solicitud no está, o
 * cuando quien despacha lo cambia a mano (2026-11-05). La cuenta de qué se
 * ofrece vive en `utils/loteDeEnvio`; acá sólo se elige.
 *
 * Con una opción, viene marcada. Con varias, ninguna: se toca la que se manda.
 * Así «mandar otro sólo por mandar» exige un toque sobre un lote con nombre.
 */
export default function ElegirLoteDeEnvio({ producto, pedidos = [], opciones, valor, onElegir, onCerrar }) {
    const varias = (opciones?.length ?? 0) > 1;
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2">
            <p className="text-micro font-bold text-warning-text leading-snug">
                {producto && <span className="text-content">{producto}: </span>}
                {pedidos.length
                    ? `el lote ${pedidos.join(', ')} que pidieron no está en tu sala o no alcanza. ¿Cuál mandas?`
                    : '¿Qué lote mandas?'}
            </p>
            {opciones == null ? (
                <p className="text-micro text-content-3">Revisando los lotes de tu sala…</p>
            ) : opciones.length === 0 ? (
                <p className="text-micro font-semibold text-danger-text leading-snug">
                    Ningún lote de tu sala alcanza para todo el renglón. Manda menos o rechaza.
                </p>
            ) : (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Lote que sale de ${producto}`}>
                    {opciones.map((o) => (
                        <Button
                            key={`${o.lote}|${o.vence}`} size="sm"
                            variant={igual(valor, o) ? 'primary' : 'secondary'}
                            role="radio" aria-checked={Boolean(igual(valor, o))}
                            onClick={() => onElegir({ lote: o.lote, vence: o.vence, sinAsignar: o.sinAsignar })}
                        >
                            {o.sinAsignar
                                ? `Sin lote asignado · hay ${o.unidades}`
                                : `${o.lote} · vence ${mesAnio(o.vence)} · hay ${o.unidades}`}
                        </Button>
                    ))}
                </div>
            )}
            {varias && !valor && (
                <p className="text-micro text-warning-text leading-snug">
                    Hay {opciones.length} lotes: toca el que vas a mandar.
                </p>
            )}
            {valor && (
                <p className="text-micro font-semibold text-content leading-snug">
                    {valor.sinAsignar
                        ? 'Sale sin lote asignado: copia abajo el lote de la caja.'
                        : `Sale el lote ${valor.lote} (vence ${mesAnio(valor.vence)}).`}
                </p>
            )}
            {onCerrar && (
                <div>
                    <Button size="sm" variant="ghost" onClick={onCerrar}>Dejar el lote pedido</Button>
                </div>
            )}
        </div>
    );
}
