import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Lightbulb, Medal, TrendingDown, TrendingUp, Target } from 'lucide-react';
import AvatarConEstado from '../common/AvatarConEstado';
import Notice from '../common/Notice';
import { LoadingState } from '../common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchComoVaLaSalaHoy, fetchMetaSala } from '@nucleo/data/metas';
import { avanceDeMetaDelDia } from '@nucleo/utils/cajaDelDia';
import { armarDia, ideaDelMomento, relojDelDia, ritmoDelDia } from '@nucleo/utils/comoVaHoy';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

const GraficaDelDia = lazy(() => import('./GraficaDelDia'));
const CADA_MS = 120_000;

const TONO = {
    arriba: { icono: TrendingUp, clase: 'text-success-text', fondo: 'bg-success/10', titulo: 'Vas arriba de lo esperado' },
    ritmo: { icono: Target, clase: 'text-brand-text', fondo: 'bg-brand/10', titulo: 'Vas al ritmo' },
    bajo: { icono: TrendingDown, clase: 'text-warning-text', fondo: 'bg-warning/10', titulo: 'Vas bajo de lo esperado' },
};

/**
 * «Cómo va hoy» en el kiosco de caja (pedido del usuario, 2026-11-17): la
 * venta del día contra lo esperado a esta hora, los que más venden y, si va
 * bajo, una idea para subirla. Los montos sólo con
 * `dash_meta_sala_vista_completa`, como el widget del Inicio; sin él, en %.
 */
export default function ComoVaHoy({ sala, ahora }) {
    const { user, hasPermission } = useAuth();
    const puedeVer = hasPermission('dash_meta_sala');
    const conMontos = hasPermission('dash_meta_sala_vista_completa');
    const [datos, setDatos] = useState(null);
    const [falla, setFalla] = useState(false);

    const leer = useCallback(async () => {
        try {
            const [meta, dia] = await Promise.all([fetchMetaSala(sala).catch(() => null), fetchComoVaLaSalaHoy(sala)]);
            setDatos({ sala, meta, dia });
            setFalla(false);
        } catch {
            setFalla(true);
        }
    }, [sala]);

    useEffect(() => {
        if (!puedeVer || !sala) return undefined;
        const primera = setTimeout(leer, 0);
        const id = setInterval(() => { if (document.visibilityState === 'visible') leer(); }, CADA_MS);
        return () => { clearTimeout(primera); clearInterval(id); };
    }, [puedeVer, sala, leer]);

    const cuenta = useMemo(() => {
        if (!datos || datos.sala !== sala) return null;
        const avance = avanceDeMetaDelDia(datos.meta);
        const dia = armarDia({ hoy: datos.dia.hoy, tipica: datos.dia.tipica, metaDia: avance?.meta ?? null, reloj: relojDelDia(ahora) });
        return dia ? { ...dia, ritmo: ritmoDelDia(dia), metaDia: avance?.meta ?? null } : null;
    }, [datos, sala, ahora]);

    if (!puedeVer) return <Notice variant="info">Tu cargo no ve cómo va la venta del día.</Notice>;
    if (falla && !datos) return <Notice variant="warning">No se pudo leer la venta de hoy. Intenta de nuevo en un momento.</Notice>;
    if (!datos) return <LoadingState />;

    const vendedores = datos.dia.vendedores ?? [];
    const tono = cuenta?.ritmo ? TONO[cuenta.ritmo] : null;
    const pct = (v) => (cuenta?.base ? `${Math.round((v / cuenta.base) * 100)} %` : '');
    const monto = (v) => (conMontos ? formatMoney(v) : pct(v));
    const falta = cuenta ? Math.max(0, cuenta.esperadoAhora - cuenta.vendido) : 0;

    return (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <section data-surface="card" className="p-5 flex flex-col gap-4 min-w-0">
                {tono ? (
                    <div className={`flex items-start gap-3 rounded-[var(--radius-card)] p-4 ${tono.fondo}`}>
                        <tono.icono size={28} className={`${tono.clase} shrink-0`} aria-hidden="true" />
                        <div className="min-w-0">
                            <p className={`text-title font-black ${tono.clase}`}>{tono.titulo}</p>
                            <p className="text-body-sm text-content-2">
                                {cuenta.ritmo === 'bajo'
                                    ? (conMontos ? `Faltan ${formatMoney(falta)} para ir al ritmo de esta hora. ¡Todavía se alcanza!` : 'Todavía se alcanza. Cada venta cuenta.')
                                    : cuenta.ritmo === 'arriba' ? '¡Buen trabajo! Sigan así hasta el cierre.' : 'Mantengan el paso para llegar a la meta.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className="text-body-sm text-content-3">Todavía es temprano para comparar.</p>
                )}

                {cuenta && (
                    <div className="grid grid-cols-3 gap-3">
                        <Cifra rotulo="Vendido hoy" valor={monto(cuenta.vendido)} fuerte />
                        <Cifra rotulo="Esperado a esta hora" valor={monto(cuenta.esperadoAhora)} />
                        <Cifra rotulo={cuenta.conMeta ? 'Meta del día' : 'Un día normal'} valor={monto(cuenta.base)} />
                    </div>
                )}

                {cuenta ? (
                    <Suspense fallback={<div className="h-[220px]" />}>
                        <GraficaDelDia serie={cuenta.serie} ocultarMontos={!conMontos} base={cuenta.base} />
                    </Suspense>
                ) : (
                    <Notice variant="info">Aún no hay suficiente historia de esta sucursal para comparar.</Notice>
                )}
                <p className="text-label text-content-3">La línea punteada es lo que la sucursal suele llevar a cada hora este mismo día de la semana{cuenta?.conMeta ? ', llevado a la meta del día' : ''}.</p>

                {cuenta?.ritmo === 'bajo' && (
                    <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border-card p-4">
                        <Lightbulb size={22} className="text-warning-text shrink-0" aria-hidden="true" />
                        <p className="text-body text-content"><span className="font-bold">Idea para subir la venta: </span>{ideaDelMomento(ahora)}</p>
                    </div>
                )}
            </section>

            <section data-surface="card" className="p-5 flex flex-col gap-3">
                <h2 className="text-title font-black text-content flex items-center gap-2">
                    <Medal size={20} className="text-brand-text" aria-hidden="true" /> Los que más venden hoy
                </h2>
                {vendedores.length === 0 ? (
                    <p className="text-body-sm text-content-3">Todavía no hay ventas hoy.</p>
                ) : (
                    <ol className="flex flex-col gap-2">
                        {vendedores.map((v, i) => {
                            const yo = Number(v.id) === Number(user?.id);
                            return (
                                <li key={v.id} className={`flex items-center gap-3 rounded-[var(--radius-btn)] p-2 ${yo ? 'bg-brand/10' : ''}`}>
                                    <span className={`w-7 text-center text-title font-black ${i === 0 ? 'text-warning-text' : 'text-content-3'}`}>{i + 1}</span>
                                    <AvatarConEstado emp={{ id: v.id, name: v.name, photo: v.photo_url }} px={40} mostrarChip={false} pendientes={false} />
                                    <div className="min-w-0 flex-1 leading-tight">
                                        <p className="text-body font-bold text-content truncate">{shortEmployeeName(v)}{yo ? ' (tú)' : ''}</p>
                                        <p className="text-label text-content-3">{v.ventas} {v.ventas === 1 ? 'venta' : 'ventas'}</p>
                                    </div>
                                    {conMontos && <span className="text-body font-bold tabular-nums text-content">{formatMoney(v.total)}</span>}
                                </li>
                            );
                        })}
                    </ol>
                )}
            </section>
        </div>
    );
}

function Cifra({ rotulo, valor, fuerte = false }) {
    return (
        <div className="rounded-[var(--radius-btn)] bg-surface-card-hover p-3 min-w-0">
            <p className="text-label text-content-3">{rotulo}</p>
            <p className={`tabular-nums truncate ${fuerte ? 'text-title-lg font-black text-content' : 'text-title font-bold text-content-2'}`}>{valor}</p>
        </div>
    );
}
