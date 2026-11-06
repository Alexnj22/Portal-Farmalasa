// Piezas de «Cargar compra» que usan la pantalla y la propuesta
// (`PropuestaDeCompra.jsx`), 2026-11-06.

import { useState, useEffect } from 'react';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import AvisoParecidos from '../../components/common/AvisoParecidos';
import { buscarProductos } from '@nucleo/data/cargarCompra';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

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
                    Faltan {total - n}: quedan «por llegar».
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
