import React, { useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { useStaffStore } from '@nucleo/store/staffStore';
import { avanceSinLote } from '@nucleo/utils/conteoDeInventario';
import { formatQty } from '@nucleo/utils/formatNumber';

/**
 * Cuánto falta para que los regulados de la sucursal tengan toda su existencia
 * en un lote (2026-11-06). Es el avance de la limpieza que hace el conteo que
 * ajusta: la cuenta de la sucursal baja cuando se aprueba un conteo, y la del
 * conteo sube mientras se cuenta.
 *
 * Si no se puede leer, no se muestra: es contexto, no un dato del conteo.
 */
export default function AvanceSinLote({ branchId, conteoId, refrescar }) {
    const fetchReguladosSinLote = useStaffStore((s) => s.fetchReguladosSinLote);
    const [datos, setDatos] = useState(null);

    useEffect(() => {
        let vivo = true;
        fetchReguladosSinLote({ branchId, conteoId })
            .then((d) => { if (vivo) setDatos(d); })
            .catch((e) => console.error('[conteo] regulados sin lote', e));
        return () => { vivo = false; };
    }, [branchId, conteoId, refrescar, fetchReguladosSinLote]);

    if (!datos) return null;
    const suc = avanceSinLote(datos.sucursales, branchId);
    const enConteo = datos.conteo;
    if (!suc.regulados && !enConteo?.sin_lote) return null;
    const pctConteo = enConteo?.sin_lote ? Math.floor((enConteo.contados / enConteo.sin_lote) * 100) : 0;

    return (
        <div className="rounded-card border border-line bg-surface-2 px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-body-sm font-bold text-content">
                <Tags size={16} className="text-content-3" aria-hidden />
                Regulados sin lote
            </div>

            {enConteo?.sin_lote > 0 && (
                <div className="flex flex-col gap-1">
                    <p className="text-caption text-content-2">
                        En este conteo: <strong className="tabular-nums">{formatQty(enConteo.contados)}</strong> de{' '}
                        <strong className="tabular-nums">{formatQty(enConteo.sin_lote)}</strong> productos con existencia sin
                        lote ya contados.
                    </p>
                    <div className="h-2 rounded-full bg-content-3/20 overflow-hidden"
                        role="progressbar" aria-valuenow={pctConteo} aria-valuemin={0} aria-valuemax={100}
                        aria-label="Regulados sin lote contados en este conteo">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${pctConteo}%` }} />
                    </div>
                </div>
            )}

            {suc.regulados > 0 && (
                <div className="flex flex-col gap-1">
                    <p className="text-caption text-content-2">
                        {suc.sucursal ? `En ${suc.sucursal}` : 'En las sucursales'} quedan{' '}
                        <strong className="tabular-nums">{formatQty(suc.sinLote)}</strong> de{' '}
                        <strong className="tabular-nums">{formatQty(suc.regulados)}</strong> regulados con existencia sin lote.
                        {' '}<span className="tabular-nums">{suc.limpios}%</span> ya está todo en su lote. Baja al aprobar un
                        conteo que ajusta.
                    </p>
                    <div className="h-2 rounded-full bg-content-3/20 overflow-hidden"
                        role="progressbar" aria-valuenow={suc.limpios} aria-valuemin={0} aria-valuemax={100}
                        aria-label="Regulados con toda su existencia en un lote">
                        <div className="h-full rounded-full bg-success" style={{ width: `${suc.limpios}%` }} />
                    </div>
                </div>
            )}
        </div>
    );
}
