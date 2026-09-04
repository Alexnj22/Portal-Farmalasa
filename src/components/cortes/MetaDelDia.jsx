import React, { useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { formatMoney } from '../../utils/formatNumber';
import { fetchMetaSala } from '../../data/metas';
import { useAuth } from '../../context/AuthContext';

/**
 * Cómo va la sala contra la meta de HOY, en la pestaña «Hoy» de Efectivo.
 *
 * ── Por qué acá y no en la ficha de caja ───────────────────────────────────
 * Se probó dentro de `FichasDeCaja` y no encajaba por dos motivos, los dos
 * medidos: sólo aparecía cuando había UNA ficha —o sea nunca para quien
 * supervisa las seis salas, que es la mayoría de quien abre esa pantalla— y el
 * tema de esa tarjeta es el TURNO de caja (quién abrió, a qué hora), no las
 * ventas de la sala. Acá es la pantalla de la sala mirando su propio día, que
 * es de quién es esta pregunta.
 *
 * ── La meta del DÍA es la del mes repartida entre sus días ─────────────────
 * La misma definición que usa `avisar_cierre_del_dia` para armar el aviso de
 * la noche. No es un concepto nuevo: dos sitios que repartan la meta con
 * reglas distintas terminan dando dos porcentajes del mismo día, y no hay
 * forma de saber cuál mira quien los ve.
 *
 * ── Los permisos los decide el RPC, no esta pantalla ───────────────────────
 * `get_meta_sala` devuelve CERO filas sin `dash_meta_sala` y acota por su
 * propio alcance, así que acá no se reimplementa la regla — sólo se evita la
 * llamada cuando ya se sabe que no va a traer nada. Los montos son la otra
 * mitad: sin `dash_meta_sala_vista_completa` queda el porcentaje, que es
 * exactamente lo que hace el widget del Inicio. El widget no desaparece,
 * cambia de idioma.
 *
 * ── La barra no se pinta de alarma cuando va baja ──────────────────────────
 * A las 9 de la mañana el 15% es lo normal. Un tono de alarma que aparece
 * todas las mañanas es un tono que nadie mira a las 6 de la tarde, que es
 * cuando significaría algo. Azul mientras avanza, verde cuando ya llegó.
 */
export default function MetaDelDia({ branchId }) {
    const { hasPermission } = useAuth();
    const puedeVer = hasPermission('dash_meta_sala');
    const conMontos = hasPermission('dash_meta_sala_vista_completa');
    const [meta, setMeta] = useState(null);

    useEffect(() => {
        if (!puedeVer || branchId == null) return undefined;
        let vivo = true;
        /* Se guarda CON la sala a la que pertenece. Al cambiar de sala, la
         * respuesta vieja sigue en el estado hasta que llega la nueva: sin el
         * amarre, la barra mostraría el avance de la otra sala durante un
         * instante y nada delataría el cambiazo. */
        fetchMetaSala(branchId)
            .then((row) => { if (vivo) setMeta({ branchId, row }); })
            // Una meta que no se pudo leer NO es una meta en cero: el bloque no
            // se dibuja. Un 0% sobre una sala que vendió toda la mañana es peor
            // que no decir nada.
            .catch(() => { if (vivo) setMeta({ branchId, row: null }); });
        return () => { vivo = false; };
    }, [puedeVer, branchId]);

    const avance = useMemo(() => {
        if (branchId == null || meta?.branchId !== branchId) return null;
        const metaMes = Number(meta?.row?.monto_meta);
        const dias    = Number(meta?.row?.dias_mes);
        const vendido = Number(meta?.row?.venta_hoy);
        if (!Number.isFinite(metaMes) || metaMes <= 0) return null;
        if (!Number.isFinite(dias) || dias <= 0) return null;
        if (!Number.isFinite(vendido)) return null;
        const metaDia = metaMes / dias;
        return { meta: metaDia, vendido, pct: Math.round(vendido / metaDia * 100) };
    }, [meta, branchId]);

    if (!avance) return null;
    const llego = avance.pct >= 100;

    return (
        <div data-surface="card" className="rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 w-8 h-8 rounded-xl grid place-items-center bg-brand/10"
                        aria-hidden="true">
                        <Target className="w-4 h-4 text-brand-text" />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                            Meta de hoy
                        </span>
                        {conMontos && (
                            <span className="block text-body-sm font-black tabular-nums text-content">
                                {formatMoney(avance.vendido)}
                                <span className="font-semibold text-content-3"> de {formatMoney(avance.meta)}</span>
                            </span>
                        )}
                    </span>
                </span>
                <span className={`text-h4 font-black tabular-nums shrink-0 ${llego ? 'text-success-text' : 'text-content'}`}>
                    {avance.pct}%
                </span>
            </div>

            <div className="mt-3 h-2 rounded-full bg-content-3/20 overflow-hidden"
                role="progressbar" aria-valuenow={avance.pct} aria-valuemin={0} aria-valuemax={100}
                aria-label="Avance de la meta de hoy">
                <div className={`h-full rounded-full ${llego ? 'bg-success' : 'bg-brand'}`}
                    style={{ width: `${Math.min(100, avance.pct)}%` }} />
            </div>
        </div>
    );
}
