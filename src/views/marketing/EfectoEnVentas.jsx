import React, { useState } from 'react';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import Button from '../../components/common/Button';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney, formatPct, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { variacionDeVentas } from '@nucleo/utils/marketing';
import { fetchEfectoEnVentas } from '@nucleo/data/marketing';

/**
 * ¿Se vendió más de la promoción mientras corría la pieza? Se pide al tocar:
 * recorre las ventas de sus productos y no hace falta cada vez que se abre.
 */
export default function EfectoEnVentas({ pieza }) {
    const showToast = useToastStore((s) => s.showToast);
    const [efecto, setEfecto] = useState(null);
    const [cargando, setCargando] = useState(false);

    const medir = async () => {
        setCargando(true);
        try {
            setEfecto(await fetchEfectoEnVentas(pieza.id) || { vacio: true });
        } catch (err) {
            showToast('No se pudo medir', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setCargando(false);
        }
    };

    const v = variacionDeVentas(efecto);
    const sube = v?.pct != null && v.pct >= 0;
    const Flecha = sube ? TrendingUp : TrendingDown;

    return (
        <div data-surface="card" className="p-3 space-y-2">
            <div className="flex items-center gap-2">
                <BarChart3 size={14} className="text-content-3" />
                <span className="text-label uppercase tracking-wide font-semibold text-content-2">Ventas de la promoción</span>
                {!v && (
                    <Button variant="ghost" size="xs" className="ml-auto" loading={cargando} onClick={medir}>Medir</Button>
                )}
            </div>
            {efecto?.pendiente && (
                <p className="text-body-sm text-content-3">Se puede medir desde el {fechaTexto(efecto.desde, { day: 'numeric', month: 'long' })}.</p>
            )}
            {(efecto?.sin_productos || efecto?.vacio) && (
                <p className="text-body-sm text-content-3">La promoción no tiene productos para comparar.</p>
            )}
            {v && (
                <>
                    <div className="flex items-baseline gap-3 flex-wrap">
                        <span className="text-body-lg font-semibold tabular-nums text-content">{formatMoney(v.durante)}</span>
                        {v.pct != null ? (
                            <span className={`flex items-center gap-1 text-label font-semibold ${sube ? 'text-success' : 'text-danger'}`}>
                                <Flecha size={14} /> {sube ? '+' : ''}{formatPct(v.pct, { decimales: 0 })}
                            </span>
                        ) : <span className="text-label text-content-3">sin ventas antes</span>}
                    </div>
                    <p className="text-caption text-content-3">
                        {efecto.dias} días desde el {fechaTexto(efecto.desde, { day: 'numeric', month: 'short' })}: {formatQty(v.unidadesDurante)} unidades,
                        contra {formatMoney(v.antes)} ({formatQty(v.unidadesAntes)} unidades) los {efecto.dias} días anteriores.
                        Es una referencia: la temporada y el inventario también mueven la venta.
                    </p>
                </>
            )}
        </div>
    );
}
