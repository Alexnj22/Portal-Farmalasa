import React from 'react';
import Button from '../../components/common/Button';

const mesAnio = (v) => { const [a, m] = String(v || '').split('-'); return a && m ? `${m}/${a}` : 'sin fecha'; };
const minus = (s) => String(s || '').toLowerCase();

/**
 * Una caja que ningún lote completa, ofrecida en unidades (2026-11-05).
 * Pedido del usuario: piden 1 caja (×4) y hay 3 blísteres de un lote y 1 de
 * otro. El servidor no la manda sola: dice cómo saldría —cuántas unidades de
 * cada lote— y espera que quien despacha lo confirme.
 */
export default function CajaEnUnidades({ linea, aceptada, onAceptar }) {
    const { producto, presentacion, paquetes, unidades, base, reparto = [] } = linea;
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2">
            <p className="text-micro font-bold text-warning-text leading-snug">
                <span className="text-content">{producto}: </span>
                ningún lote completa {paquetes === 1 ? 'la' : `las ${paquetes}`} {minus(presentacion)}.
                Puede salir como {unidades} {minus(base)}:
            </p>
            <ul className="flex flex-col gap-0.5 text-micro text-content">
                {reparto.map((r) => (
                    <li key={`${r.lote}|${r.vence}`}>
                        {r.unidades} del {/^gen[eé]rico$/i.test(r.lote) ? 'sin lote asignado' : `lote ${r.lote}`}
                        {r.vence ? ` (vence ${mesAnio(r.vence)})` : ''}
                    </li>
                ))}
            </ul>
            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={aceptada ? 'primary' : 'secondary'}
                    role="checkbox" aria-checked={aceptada} onClick={() => onAceptar(!aceptada)}>
                    {aceptada ? `Sale en ${minus(base)}` : `Mandarla en ${unidades} ${minus(base)}`}
                </Button>
            </div>
        </div>
    );
}
