import React, { useEffect, useState } from 'react';
import { AlertTriangle, CalendarX, PackageX, Sparkles, TrendingDown, Wallet } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { fetchResumenDeSalas, tonoDelResumen } from '@nucleo/data/resumenSala';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';

// La pestaña «Resumen» de la ficha (PENDIENTES 31 y 32): lo que Sally dijo
// cada mañana, y debajo los números de donde salió — que ninguna frase se
// tenga que creer sin poder mirarla.

const dinero = (v) => formatMoney(v, { decimales: 0 });
const dineroExacto = (v) => formatMoney(v);
const dia = (f, largo = false) => fechaTexto(f, largo
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'short', day: 'numeric', month: 'short' });

const TONO = {
    alta:  { icono: 'text-danger',  badge: 'danger',  label: 'Para atender' },
    media: { icono: 'text-warning', badge: 'warning', label: 'Para mirar' },
    nada:  { icono: 'text-success', badge: 'success', label: 'Sin novedades' },
};

function Bloque({ icon: Icon, titulo, children }) {
    return (
        <section data-surface="row" className="p-4 space-y-2">
            <h4 className="flex items-center gap-2 text-label font-black uppercase tracking-widest text-content-2">
                <Icon size={14} aria-hidden="true" className="text-content-3" /> {titulo}
            </h4>
            {children}
        </section>
    );
}

function Lista({ items, render, vacio }) {
    if (!items?.length) return <p className="text-body-sm text-content-3">{vacio}</p>;
    return <ul className="space-y-1">{items.map((x, i) => <li key={i} className="text-body-sm text-content-2">{render(x)}</li>)}</ul>;
}

function Numeros({ ind }) {
    if (!ind) return null;
    const v = ind.ventas || {};
    const m = ind.meta;
    const f = ind.faltantes_a || {};
    const c = ind.cortes || {};
    const ve = ind.vencimiento || {};
    const diaSemana = fechaTexto(ind.fecha, { weekday: 'long' });
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Bloque icon={TrendingDown} titulo="Ventas">
                <p className="text-body-sm text-content-2">
                    <span className="font-black text-content tabular-nums">{dinero(v.dia)}</span>
                    {v.promedio != null && <> contra <span className="tabular-nums">{dinero(v.promedio)}</span> de sus últimos {v.semanas} {diaSemana}</>}
                    {v.cambio_pct != null && (
                        <span className={`ml-1 font-bold tabular-nums ${v.cambio_pct < 0 ? 'text-danger-text' : 'text-success-text'}`}>
                            ({v.cambio_pct > 0 ? '+' : ''}{Math.round(v.cambio_pct)}%)
                        </span>
                    )}
                </p>
                {ind.feriado && <p className="text-caption text-content-3">Fue feriado ({ind.feriado}): no se compara.</p>}
                {m && (
                    <p className="text-body-sm text-content-2">
                        Meta del mes <span className="tabular-nums">{dinero(m.meta)}</span> · lleva <span className="tabular-nums">{dinero(m.acumulada)}</span> · cerraría en <span className="font-bold tabular-nums">{Math.round(m.pct_proyectado)}%</span>
                    </p>
                )}
            </Bloque>
            <Bloque icon={Wallet} titulo="Cortes de caja">
                <p className="text-body-sm text-content-2">
                    {c.confirmados ? `${c.confirmados} confirmados` : 'Ningún corte confirmado'}
                    {Number(c.faltante) < 0 && <> · <span className="font-bold text-danger-text tabular-nums">{dineroExacto(Math.abs(c.faltante))} de faltante</span></>}
                    {Number(c.sobrante) > 0 && <> · <span className="tabular-nums">{dineroExacto(c.sobrante)} de sobrante</span></>}
                </p>
            </Bloque>
            <Bloque icon={PackageX} titulo={`Faltan de los que más se venden · ${f.total ?? 0}`}>
                <Lista items={f.lista} vacio="No falta ninguno." render={(x) => <>{x.producto} <span className="text-content-3">· mínimo {x.minimo}</span></>} />
                {f.total > (f.lista?.length || 0) && <p className="text-caption text-content-3">y {f.total - f.lista.length} más</p>}
            </Bloque>
            <Bloque icon={CalendarX} titulo="Vencimientos">
                <p className="text-label font-bold text-danger-text">Vencidos y a la venta · {ve.vencidos?.length ?? 0}</p>
                <Lista items={ve.vencidos} vacio="Ninguno."
                    render={(x) => <>{x.producto} <span className="text-content-3 tabular-nums">· lote {x.lote} · {fechaTexto(x.vence, { month: 'short', year: 'numeric' })} · {x.unidades} u.</span></>} />
                <p className="pt-1 text-label font-bold text-warning-text">Vencen en 60 días · {ve.por_vencer?.length ?? 0}</p>
                <Lista items={ve.por_vencer} vacio="Ninguno."
                    render={(x) => <>{x.producto} <span className="text-content-3 tabular-nums">· {fechaTexto(x.vence, { day: 'numeric', month: 'short' })} · {x.unidades} u.</span></>} />
            </Bloque>
        </div>
    );
}

export default function TabResumen({ liveBranch }) {
    const [estado, setEstado] = useState({ cargando: true, resumenes: [], error: null });

    useEffect(() => {
        let vivo = true;
        fetchResumenDeSalas({ branchId: liveBranch?.id, dias: 14 }).then(({ resumenes, error }) => {
            if (vivo) setEstado({ cargando: false, resumenes, error });
        });
        return () => { vivo = false; };
    }, [liveBranch?.id]);

    const { cargando, resumenes, error } = estado;
    const [ultimo, ...anteriores] = resumenes;

    if (cargando) return <SkeletonText lines={4} />;
    if (error) return <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error)}</Notice>;
    if (!ultimo) {
        return <EmptyState icon={Sparkles} title="Todavía no hay resumen"
            subtitle="Sally escribe el de cada día a las 5:30 de la mañana siguiente." />;
    }

    const t = TONO[tonoDelResumen(ultimo)];
    return (
        <div className="space-y-6">
            <header className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Sparkles size={18} aria-hidden="true" className={t.icono} />
                    <h3 className="text-title-sm font-black text-content tracking-tight first-letter:uppercase">{dia(ultimo.fecha, true)}</h3>
                    <Badge variant={t.badge} size="sm" uppercase={false}>{t.label}</Badge>
                </div>
                <p className="text-body text-content leading-relaxed max-w-3xl">{ultimo.texto}</p>
            </header>

            <Numeros ind={ultimo.indicadores} />

            {anteriores.length > 0 && (
                <section className="space-y-2">
                    <h4 className="text-label font-black uppercase tracking-widest text-content-2">Días anteriores</h4>
                    <ul className="divide-y divide-divider border-y border-divider">
                        {anteriores.map((r) => {
                            const tr = TONO[tonoDelResumen(r)];
                            return (
                                <li key={r.id} className="flex items-start gap-3 py-2.5">
                                    <Sparkles size={14} aria-hidden="true" className={`mt-1 shrink-0 ${tr.icono}`} />
                                    <div className="min-w-0">
                                        <p className="text-caption font-bold text-content-3 first-letter:uppercase">{dia(r.fecha)}</p>
                                        <p className="text-body-sm text-content-2 leading-snug">{r.texto}</p>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}
        </div>
    );
}
