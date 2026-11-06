import React from 'react';
import { Hash, CalendarClock } from 'lucide-react';
import { mesAnioTexto } from '@nucleo/utils/fecha';
import { esLoteGenerico, rotuloDeLote } from '@nucleo/utils/unidadesInventario';

/* El lote de un renglón, como chips: el número (lo que se coteja contra la
 * caja) y el vencimiento en MM/AAAA. El rótulo dice DE DÓNDE sale el dato,
 * porque no es lo mismo el lote que viajó que el que alguien pidió: antes del
 * despacho es una intención, después es un hecho. «GENERICO» se dice «Sin lote
 * asignado» y sin fecha —la de un genérico no es de ninguna caja—. */
const ROTULO_FUENTE = { salio: 'Salió', apartado: 'Apartado', pedido: 'Pidió' };

const LotesConFuente = ({ lotes: crudos, className = 'mt-1.5' }) => {
    if (!Array.isArray(crudos) || crudos.length === 0) return null;
    // Dos «GENERICO» con distinto vencimiento se ven idénticos (la fecha no se
    // muestra): se dicen una vez.
    const vistos = new Set();
    const lotes = crudos.filter(l => {
        const g = esLoteGenerico(l.lote) || !l.lote;
        const clave = g ? 'sin-lote' : `${l.lote}|${l.vence ?? ''}`;
        if (vistos.has(clave) && (g || l.fuente !== 'salio')) return false;
        vistos.add(clave);
        return true;
    });
    const varios = lotes.length > 1;
    return (
        <div className={`flex flex-wrap items-center gap-1 text-micro font-bold ${className}`}>
            {ROTULO_FUENTE[lotes[0].fuente] && (
                <span className="text-content-3 uppercase tracking-wider mr-0.5">
                    {ROTULO_FUENTE[lotes[0].fuente]} {varios ? 'lotes' : 'lote'}
                </span>
            )}
            {lotes.map((l, k) => {
                const generico = esLoteGenerico(l.lote) || !l.lote;
                return (
                    <span key={k} className="inline-flex items-center gap-1">
                        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ring-1 ring-inset ${
                            generico ? 'bg-warning/10 ring-warning/30 text-warning-text' : 'bg-surface-input ring-divider text-content'
                        }`}>
                            <Hash size={10} strokeWidth={2.5} className="shrink-0 text-content-3" />
                            <span className={generico ? '' : 'font-mono'}>
                                {l.lote ? rotuloDeLote(l.lote) : 'Sin lote'}
                            </span>
                        </span>
                        {l.vence && !esLoteGenerico(l.lote) && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-surface-input px-1.5 py-0.5 ring-1 ring-inset ring-divider text-content-2 tabular-nums">
                                <CalendarClock size={10} strokeWidth={2.5} className="shrink-0 text-content-3" />
                                {mesAnioTexto(l.vence)}
                            </span>
                        )}
                        {varios && l.fuente === 'salio' && l.unidades > 0 && (
                            <span className="text-content-3 tabular-nums">×{l.unidades}</span>
                        )}
                    </span>
                );
            })}
        </div>
    );
};

export default LotesConFuente;
