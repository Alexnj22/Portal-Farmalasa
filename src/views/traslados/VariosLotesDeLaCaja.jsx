import React from 'react';
import { Plus, X } from 'lucide-react';
import PortalInput from '../../components/common/PortalInput';
import LoteDeLaCaja from './LoteDeLaCaja';
import { FILA_DE_VARIOS_LOTES } from '@nucleo/utils/loteDeCaja';

/**
 * La caja que viene de varios lotes (2026-11-16): un lote, su vencimiento y
 * cuántas unidades trae, por fila. Cada lote se elige con `LoteDeLaCaja`, así
 * que ofrece los ya registrados y frena un número registrado con otra fecha.
 * Lo que falta lo dice `faltaEnVariosLotes`; esta pieza sólo pinta.
 */
export default function VariosLotesDeLaCaja({ erpProductId, producto, total, filas, onChange, onUnSoloLote }) {
    const cambiar = (k, cambio) => onChange(filas.map((f, j) => (j === k ? { ...f, ...cambio } : f)));
    const suma = filas.reduce((n, f) => n + (Number(String(f.unidades).trim()) || 0), 0);
    return (
        <div className="flex flex-col gap-2">
            {filas.map((f, k) => (
                <div key={k} className="flex flex-col gap-1 rounded-lg border border-subtle px-2 py-1.5">
                    <div className="flex items-center gap-2">
                        <p className="flex-1 text-micro font-bold text-content-2">Lote {k + 1}</p>
                        {filas.length > 2 && (
                            <button type="button" aria-label={`Quitar el lote ${k + 1}`}
                                onClick={() => onChange(filas.filter((_, j) => j !== k))}
                                className="min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex items-center justify-center rounded-lg text-content-3 active:scale-[0.97]">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <LoteDeLaCaja erpProductId={erpProductId} producto={producto}
                        valor={f.caja} onChange={v => cambiar(k, { caja: v })} />
                    <PortalInput compact label="Unidades de este lote" inputMode="numeric" placeholder="0"
                        value={f.unidades} onChange={e => cambiar(k, { unidades: e.target.value.replace(/\D/g, '') })} />
                </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onChange([...filas, FILA_DE_VARIOS_LOTES()])}
                    className="min-h-[var(--tap-min)] inline-flex items-center gap-1 text-micro font-bold text-brand-text active:scale-[0.97]">
                    <Plus size={12} /> Otro lote
                </button>
                <button type="button" onClick={onUnSoloLote}
                    className="min-h-[var(--tap-min)] text-micro font-semibold text-content-3 active:scale-[0.97]">
                    Es un solo lote
                </button>
                <span className={`ml-auto text-micro font-bold tabular-nums ${suma === total ? 'text-success-text' : 'text-content-3'}`}>
                    {suma} de {total} unidades
                </span>
            </div>
        </div>
    );
}
