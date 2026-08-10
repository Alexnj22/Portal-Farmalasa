import React, { useCallback, useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchMetaSala } from '../../data/metas';
import BarraAvance from '../metas/BarraAvance';
import { TRAMO_CFG, tramoLabel, ymLabel } from '../metas/metasUtils';

// La meta de la sala en el Inicio. Es el mismo dato que el tablero del módulo,
// pero contado desde la sala y para HOY: cuánto lleva el mes, cuánto vendió hoy,
// cuánto falta y a qué ritmo diario hay que ir para llegar. El módulo Metas es
// de supervisión (las 6 salas, el flujo de aprobación); esto es lo que la sala
// necesita ver todos los días sin ir a buscarlo.
//
// Se refresca solo: cada 5 minutos y al volver a la pestaña. Un número que dice
// "hoy llevas X" y se queda congelado desde que abriste el portal a las 8 de la
// mañana miente, y nadie recarga el Inicio para verificarlo.
const REFRESCO_MS = 5 * 60 * 1000;

// Al cambiar de sala el widget se REMONTA (el padre le pasa `key`), así que el
// skeleton vuelve solo: no hace falta un setLoading(true) dentro del efecto.
export default function WidgetMetaSala({ selectedBranchId = null, conSelector = false }) {
    const [row, setRow] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const cargar = useCallback(() => {
        let vivo = true;
        fetchMetaSala(selectedBranchId)
            .then((data) => { if (vivo) { setRow(data); setError(null); setLoading(false); } })
            .catch((err) => { if (vivo) { setError(mensajeAmigable(err, 'No se pudo cargar la meta')); setLoading(false); } });
        return () => { vivo = false; };
    }, [selectedBranchId]);

    useEffect(() => {
        const cancelar = cargar();
        const timer = setInterval(cargar, REFRESCO_MS);
        const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
        document.addEventListener('visibilitychange', alVolver);
        return () => {
            cancelar();
            clearInterval(timer);
            document.removeEventListener('visibilitychange', alVolver);
        };
    }, [cargar]);

    if (loading) {
        return <div className="p-1"><SkeletonText lines={4} /></div>;
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center px-4 text-center">
                <p className="text-body-sm font-bold text-danger-text">{error}</p>
            </div>
        );
    }

    // Sin fila: el usuario no tiene sala asignada, o su sala no vende.
    if (!row) {
        return (
            <EmptyState
                linea
                icon={Target}
                title="Sin sala asignada"
                subtitle="Pide que te asignen una sala para ver su meta del mes."
            />
        );
    }

    const sinMeta = row.monto_meta == null;
    const tramo = TRAMO_CFG[row.bono_tier];
    const oficial = row.estado === 'oficial';

    return (
        <div className="h-full flex flex-col px-4 pb-4 pt-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    {/* Con selector arriba el nombre de la sala ya está dicho:
                        repetirlo acá sería la misma palabra dos veces. */}
                    {!conSelector && (
                        <p className="text-label font-black text-content leading-tight truncate">{row.sala}</p>
                    )}
                    <p className="text-micro font-bold text-content-3 tabular-nums mt-0.5">
                        {ymLabel(row.year_month)} · día {row.dias_transcurridos} de {row.dias_mes}
                    </p>
                </div>
                {/* «Sin meta ASIGNADA»: desde que el tramo más bajo se llama
                    «Sin meta» con el bono apagado, sin el adjetivo las dos
                    insignias serían la misma palabra para dos cosas distintas. */}
                {sinMeta
                    ? <Badge variant="neutral" size="sm">Sin meta asignada</Badge>
                    : !oficial
                        ? <Badge variant="warning" size="sm">Pendiente de aprobar</Badge>
                        : tramo && <Badge variant={tramo.variante} size="sm">{tramoLabel(row.bono_tier, row.bonificaciones_activas)}</Badge>}
            </div>

            {sinMeta ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-1.5 py-3">
                    <span className="text-2xl font-black tabular-nums tracking-tight">{formatMoney(row.venta_acumulada)}</span>
                    <p className="text-label font-semibold text-content-3 max-w-[240px]">
                        Vendido este mes. Todavía no hay meta para {ymLabel(row.year_month).toLowerCase()}.
                    </p>
                </div>
            ) : (
                <>
                    {/* La meta, con su nombre y en su propio renglón. Estaba —
                        «de $41,155.66»— pegada al final de la línea del vendido
                        y en gris chico: el número que le da nombre al widget era
                        el menos visible de la tarjeta, y había que deducir cuál
                        de los dos era. Es la misma forma que las tarjetas por
                        sala del Tablero: «Meta $X» arriba, el vendido debajo. */}
                    <p className="text-label font-bold text-content-2 tabular-nums mt-1.5">
                        Meta <span className="text-content font-black">{formatMoney(row.monto_meta)}</span>
                    </p>
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-2xl font-black tabular-nums tracking-tight">{formatMoney(row.venta_acumulada)}</span>
                        <span className="text-body-sm font-black text-chart-1-text tabular-nums">{formatPct(row.pct_cumplimiento)}</span>
                        <span className="text-label font-semibold text-content-3">vendido</span>
                    </div>

                    <BarraAvance
                        pct={Number(row.pct_cumplimiento)}
                        pctProyectado={row.pct_proyectado != null ? Number(row.pct_proyectado) : null}
                        umbralMedio={Number(row.umbral_medio)}
                        umbralTotal={Number(row.umbral_total)}
                    />

                    <div className="mt-3 space-y-1">
                        <p className="text-label font-semibold text-content-2 tabular-nums">
                            Hoy llevas <strong>{formatMoney(row.venta_hoy)}</strong>
                            {row.proyeccion != null && (
                                <> · cierra en <strong>{formatMoney(row.proyeccion)}</strong>
                                    {' → '}<strong className={tramo?.textCls || ''}>{formatPct(row.pct_proyectado)}</strong></>
                            )}
                        </p>
                        {row.falta > 0 ? (
                            <p className="text-label font-semibold text-content-3 tabular-nums">
                                Faltan <strong className="text-content-2">{formatMoney(row.falta)}</strong> en {row.dias_restantes} día{row.dias_restantes !== 1 ? 's' : ''}
                                {row.ritmo_necesario != null && <> · <strong className="text-content-2">{formatMoney(row.ritmo_necesario)}</strong> por día</>}
                            </p>
                        ) : (
                            <p className="text-label font-bold text-success-text tabular-nums">
                                Meta alcanzada · {formatMoney(row.venta_acumulada - row.monto_meta)} por encima
                            </p>
                        )}
                        {/* Se retiró «El bono se muestra solo como referencia»
                            (2026-08-10): con el interruptor apagado el widget ya
                            no nombra ningún bono —la insignia habla de la meta—,
                            así que el único sitio donde aparecía la palabra era
                            la aclaración de que no aplica. Además era la línea
                            que se salía de la tarjeta y quedaba cortada. */}
                    </div>
                </>
            )}
        </div>
    );
}
