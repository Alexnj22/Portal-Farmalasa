// Piezas de «Cargar compra» que usan la pantalla y la propuesta
// (`PropuestaDeCompra.jsx`), 2026-11-06.

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import Button from '../../components/common/Button';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import AvisoParecidos from '../../components/common/AvisoParecidos';
import { buscarProductos } from '@nucleo/data/cargarCompra';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { lotesDelRenglon, problemaDeLotes } from '@nucleo/utils/cargaDeCompra';

/**
 * ¿Llegó todo lo facturado? Lo normal es que sí, así que es un interruptor y
 * no un número en blanco: sólo al marcar «Faltó» se pide cuántas llegaron.
 * Vacío sigue significando «todo» para quien guarda.
 */
export function Llegaron({ total, valor, onChange, puedeEditar }) {
    const conNumero = valor !== '' && valor != null;
    const [falto, setFalto] = useState(conNumero);
    const n = conNumero ? Number(valor) : null;
    return (
        <div className="min-w-0">
            <p className={rotuloCampo('text-content-3', { denso: true })}>¿Llegó todo?</p>
            <SegmentedControl size="sm" label="¿Llegó todo?" disabled={!puedeEditar}
                value={falto ? 'falto' : 'todo'}
                options={[{ value: 'todo', label: 'Sí, todo' }, { value: 'falto', label: 'Faltó' }]}
                onChange={v => { setFalto(v === 'falto'); if (v === 'todo') onChange(''); }} />
            {falto && (
                <div className="mt-2 flex items-center gap-2">
                    <div className="w-24 shrink-0">
                        <PortalInput compact inputMode="numeric" readOnly={!puedeEditar} aria-label="Unidades que llegaron"
                            placeholder="0" value={valor ?? ''}
                            onChange={e => onChange(e.target.value.replace(/[^\d]/g, ''))} />
                    </div>
                    <span className="text-caption text-content-2 tabular-nums">llegaron, de {total}</span>
                </div>
            )}
            {falto && n != null && n < total && (
                <p className="mt-1 text-caption font-bold text-warning-text tabular-nums">
                    Faltan {total - n}. Quedan «por llegar».
                </p>
            )}
        </div>
    );
}

/* ─── Elegir el producto a mano ────────────────────────────────────────────── */
export function BuscadorProducto({ onElegir, onCancelar }) {
    const [q, setQ] = useState('');
    const [res, setRes] = useState([]);
    const [sonParecidos, setSonParecidos] = useState(false);

    useEffect(() => {
        let vivo = true;
        const t = setTimeout(async () => {
            const { filas, aproximado } = await buscarProductos(q);
            if (vivo) { setRes(filas); setSonParecidos(!!aproximado); }
        }, 250);
        return () => { vivo = false; clearTimeout(t); };
    }, [q]);

    return (
        <div className="mt-2 space-y-2">
            <PortalInput value={q} onChange={e => setQ(e.target.value)} tono="brand"
                placeholder="Buscar el producto por nombre…" aria-label="Buscar producto" />
            {sonParecidos && res.length > 0 && <AvisoParecidos texto={q} />}
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {res.map(p => (
                    <button key={p.id} type="button" onClick={() => onElegir(p)}
                        className="text-left px-3 py-2 rounded-xl hover:bg-surface-tab-active transition-colors">
                        <span className="text-label text-content">{p.nombre}</span>
                        {p.codigo_barras && (
                            <span className="block text-micro text-content-3 font-mono">{p.codigo_barras}</span>
                        )}
                    </button>
                ))}
                {q.length >= 3 && res.length === 0 && (
                    <p className="text-micro text-content-3 px-1">Nada coincide con «{q}».</p>
                )}
            </div>
            <Button size="xs" variant="ghost" onClick={onCancelar}>Cancelar</Button>
        </div>
    );
}

/* ─── Varios lotes en un renglón (2026-11-24) ──────────────────────────────── */
/**
 * El proveedor factura un renglón y llegan dos o más lotes. El primero es el de
 * los campos Lote/Vence de arriba y se queda con el resto de las unidades: el
 * total siempre cuadra con la factura.
 */
export function LotesDelRenglon({ r, aj, puedeEditar, onCambiar }) {
    const lotes = lotesDelRenglon(r, aj);
    if (!lotes) return null;
    const problema = problemaDeLotes(r, aj);
    const total = lotes.reduce((a, l) => a + l.unidades, 0);
    const poner = (k, cambio) => onCambiar(aj.otrosLotes.map((l, j) => (j === k ? { ...l, ...cambio } : l)));
    return (
        <div className="mt-3 space-y-2" data-campo="lotes">
            <p className="text-caption text-content-2 tabular-nums">
                Lote 1{aj.lote ? ` (${aj.lote})` : ''}: <b>{Math.max(lotes[0].unidades, 0)}</b> unidades, el resto de las {total}.
            </p>
            {aj.otrosLotes.map((l, k) => (
                <div key={k} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] gap-2 items-end">
                    <PortalInput compact labelDenso label={`Lote ${k + 2}`} readOnly={!puedeEditar} value={l.lote}
                        onChange={e => poner(k, { lote: e.target.value })} />
                    <CampoMesAnio compact label="Vence" value={l.vence} onChange={v => poner(k, { vence: v })} />
                    <PortalInput compact labelDenso label="Unidades" inputMode="numeric" readOnly={!puedeEditar} value={l.unidades}
                        onChange={e => poner(k, { unidades: e.target.value.replace(/[^\d]/g, '') })} />
                    {puedeEditar && (
                        <Button size="xs" variant="ghost" icon={X} aria-label={`Quitar el lote ${k + 2}`}
                            onClick={() => onCambiar(aj.otrosLotes.filter((_, j) => j !== k))} />
                    )}
                </div>
            ))}
            {problema && <Notice variant="danger">{problema}</Notice>}
        </div>
    );
}
