import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import {
    BadgePercent, CalendarClock, CalendarDays, Flame, Package, Sparkles, Lightbulb, Medal, PackageCheck, PartyPopper, Receipt, ShoppingBag, Target, TrendingDown, TrendingUp,
} from 'lucide-react';
import AvatarConEstado from '../common/AvatarConEstado';
import Notice from '../common/Notice';
import { LoadingState } from '../common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchComoVaLaSalaHoy, fetchParaVenderEnLaSala } from '@nucleo/data/metas';
import { armarDia, datosDeApoyo, ideaDelMomento, relojDelDia, ritmoDelDia } from '@nucleo/utils/comoVaHoy';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { venceTexto } from '@nucleo/utils/venceCorto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

const GraficaDelDia = lazy(() => import('./GraficaDelDia'));
const CADA_MS = 120_000;
const VENDER_CADA_MS = 600_000;

const TONO = {
    arriba: { icono: TrendingUp, clase: 'text-success-text', fondo: 'bg-success/10', titulo: 'Vas arriba de lo esperado' },
    ritmo: { icono: Target, clase: 'text-brand-text', fondo: 'bg-brand/10', titulo: 'Vas al ritmo' },
    bajo: { icono: TrendingDown, clase: 'text-warning-text', fondo: 'bg-warning/10', titulo: 'Vas bajo de lo esperado' },
};

const pct = (v) => `${Math.round(v * 100)} %`;
const conSigno = (n) => (n == null ? '' : `${n > 0 ? '+' : ''}${n} %`);
const fechaCorta = (f) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f)); return m ? `${m[3]}/${m[2]}` : ''; };
const tonoDe = (n) => (n == null ? 'text-content-3' : n >= 0 ? 'text-success-text' : 'text-warning-text');

/**
 * «Cómo va hoy» en el kiosco de caja (pedido del usuario, 2026-11-17).
 *
 * Los montos los decide la base: `como_va_la_sala_hoy` sólo manda dinero a
 * quien tiene `dash_meta_sala_vista_completa` (jefes y gerencia). A los demás
 * todo les llega como porcentaje de la meta del día, y así se pinta: el
 * dependiente ve cómo va sin ver cuánto vende la sucursal.
 */
export default function ComoVaHoy({ sala, ahora }) {
    const { user, hasPermission } = useAuth();
    const puedeVer = hasPermission('dash_meta_sala');
    const [datos, setDatos] = useState(null);
    const [falla, setFalla] = useState(false);

    const leer = useCallback(async () => {
        try {
            const dia = await fetchComoVaLaSalaHoy(sala);
            setDatos({ sala, dia });
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

    const [vender, setVender] = useState(null);
    useEffect(() => {
        if (!sala) return undefined;
        let vivo = true;
        const leerVender = () => fetchParaVenderEnLaSala(sala)
            .then((d) => { if (vivo) setVender({ sala, ...d }); })
            .catch(() => {});
        const primera = setTimeout(leerVender, 0);
        const id = setInterval(() => { if (document.visibilityState === 'visible') leerVender(); }, VENDER_CADA_MS);
        return () => { vivo = false; clearTimeout(primera); clearInterval(id); };
    }, [sala]);

    const cuenta = useMemo(() => {
        if (!datos || datos.sala !== sala || !datos.dia.base_tipo) return null;
        const reloj = relojDelDia(ahora);
        const dia = armarDia({ hoy: datos.dia.hoy, tipica: datos.dia.tipica, pasada: datos.dia.semana_pasada,
            metaDia: datos.dia.base_tipo === 'meta' ? 1 : null, reloj });
        if (!dia) return null;
        return { ...dia, ritmo: ritmoDelDia(dia), apoyo: datosDeApoyo(datos.dia, reloj) };
    }, [datos, sala, ahora]);

    if (!puedeVer) return <Notice variant="info">Tu cargo no ve cómo va la venta del día.</Notice>;
    if (falla && !datos) return <Notice variant="warning">No se pudo leer la venta de hoy. Intenta de nuevo en un momento.</Notice>;
    if (!datos) return <LoadingState />;

    const { dia } = datos;
    const montos = Boolean(dia.montos && dia.base);
    // Una parte de la base del día, dicha como se le puede decir a quien mira.
    const cifra = (parte) => (montos ? formatMoney(parte * dia.base) : pct(parte));
    const esMeta = dia.base_tipo === 'meta';
    const tono = cuenta?.ritmo ? TONO[cuenta.ritmo] : null;
    const alRitmo = cuenta && cuenta.esperadoAhora > 0 ? Math.round((cuenta.vendido / cuenta.esperadoAhora) * 100) : null;
    const falta = cuenta ? Math.max(0, cuenta.esperadoAhora - cuenta.vendido) : 0;
    const vendedores = dia.vendedores ?? [];
    const productos = dia.productos ?? [];
    const ap = cuenta?.apoyo;

    return (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="flex flex-col gap-4 min-w-0">
                <section data-surface="card" className="p-5 flex flex-col gap-4">
                    {tono ? (
                        <div className={`flex items-center gap-4 rounded-[var(--radius-card)] p-4 ${tono.fondo}`}>
                            <tono.icono size={32} className={`${tono.clase} shrink-0`} aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                                <p className={`text-title-lg font-black ${tono.clase}`}>{tono.titulo}</p>
                                <p className="text-body-sm text-content-2">
                                    {cuenta.ritmo === 'bajo'
                                        ? `Faltan ${cifra(falta)}${esMeta && !montos ? ' de la meta del día' : ''} para ir al ritmo de esta hora. ¡Todavía se alcanza!`
                                        : cuenta.ritmo === 'arriba' ? '¡Buen trabajo, equipo! Sigan así hasta el cierre.' : 'Mantengan el paso para llegar a la meta.'}
                                </p>
                            </div>
                            {alRitmo != null && (
                                <div className="text-right shrink-0">
                                    <p className={`text-display font-black tabular-nums leading-none ${tono.clase}`}>{alRitmo} %</p>
                                    <p className="text-label text-content-3">de lo esperado ahora</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-body-sm text-content-3">Todavía es temprano para comparar.</p>
                    )}

                    {cuenta && (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <Cifra icono={Target} rotulo={esMeta ? 'Avance de la meta del día' : 'Avance de un día normal'}
                                valor={montos ? formatMoney(cuenta.vendido * dia.base) : pct(cuenta.vendido)}
                                nota={montos ? `${pct(cuenta.vendido)} de ${formatMoney(dia.base)}` : null} fuerte />
                            <Cifra icono={TrendingUp} rotulo="Lo esperado a esta hora" valor={cifra(cuenta.esperadoAhora)} />
                            <Cifra icono={Receipt} rotulo="Ventas hoy" valor={String(ap.ventasHoy)}
                                nota={ap.ventasVsNormal != null ? `${conSigno(ap.ventasVsNormal)} que lo normal` : null} notaTono={tonoDe(ap.ventasVsNormal)} />
                            <Cifra icono={ShoppingBag} rotulo="Ticket promedio"
                                valor={montos && ap.ticketHoy != null ? formatMoney(ap.ticketHoy * dia.base) : conSigno(ap.ticketVsNormal) || '—'}
                                nota={ap.ticketVsNormal != null ? (montos ? `${conSigno(ap.ticketVsNormal)} que lo normal` : 'que lo normal') : null}
                                notaTono={tonoDe(ap.ticketVsNormal)} />
                        </div>
                    )}

                    {cuenta ? (
                        <Suspense fallback={<div className="h-[240px]" />}>
                            <GraficaDelDia serie={cuenta.serie} base={montos ? dia.base : null} />
                        </Suspense>
                    ) : (
                        <Notice variant="info">Aún no hay suficiente historia de esta sucursal para comparar.</Notice>
                    )}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-label text-content-3">
                        <Leyenda clase="bg-[var(--chart-1)]">Hoy</Leyenda>
                        <Leyenda clase="border-t-2 border-dashed border-content-3 h-0">Lo esperado (lo normal de este día{esMeta ? ', llevado a la meta' : ''})</Leyenda>
                        <Leyenda clase="bg-[var(--chart-3)]">Semana pasada</Leyenda>
                    </div>
                </section>

                {ap && (
                    <div className="grid gap-3 md:grid-cols-3">
                        <Dato icono={CalendarDays} titulo="Contra la semana pasada"
                            valor={ap.vsSemanaPasada != null ? conSigno(ap.vsSemanaPasada) : '—'} valorTono={tonoDe(ap.vsSemanaPasada)}
                            detalle="El mismo día, a esta misma hora." />
                        <Dato icono={Flame} titulo="La hora fuerte que viene"
                            valor={ap.horaFuerte != null ? hora12(`${ap.horaFuerte}:00`) : 'Ya pasó'}
                            detalle={ap.horaFuerte != null ? 'Es cuando más se vende este día. Prepárate.' : 'Lo que queda del día es más tranquilo.'} />
                        <Dato icono={Target} titulo="La meta del mes"
                            valor={dia.mes?.pct_cumplimiento != null ? `${Math.round(dia.mes.pct_cumplimiento)} %` : '—'}
                            detalle={dia.mes ? `Al paso de hoy cierra en ${Math.round(dia.mes.pct_proyectado ?? 0)} %. Quedan ${dia.mes.dias_restantes} días.` : 'Esta sucursal no tiene meta este mes.'} />
                    </div>
                )}

                {cuenta?.ritmo === 'bajo' && (
                    <section data-surface="card" className="p-4 flex items-start gap-3">
                        <Lightbulb size={24} className="text-warning-text shrink-0" aria-hidden="true" />
                        <p className="text-body text-content"><span className="font-bold">Idea para subir la venta: </span>{ideaDelMomento(ahora)}</p>
                    </section>
                )}
                {cuenta?.ritmo === 'arriba' && (
                    <section data-surface="card" className="p-4 flex items-start gap-3">
                        <PartyPopper size={24} className="text-success-text shrink-0" aria-hidden="true" />
                        <p className="text-body text-content">Hoy van mejor que un día normal.{esMeta ? ' Cada venta de más acerca el bono del mes.' : ' Cada venta de más suma.'}</p>
                    </section>
                )}
                {vender && vender.sala === sala && (
                    <div className="grid gap-4 md:grid-cols-3 items-start">
                        <Lista icono={BadgePercent} titulo="Promociones vigentes" vacio="No hay promociones vigentes."
                            filas={(vender.promociones ?? []).map((p) => ({
                                clave: `${p.id}-${p.promocion}`, nombre: p.nombre, foto: p.foto_url,
                                detalle: p.promocion,
                                chip: p.fin ? `Hasta el ${fechaCorta(p.fin)}` : 'Vigente', chipTono: 'brand',
                                extra: Number(p.bono) > 0 ? `Bono ${formatMoney(p.bono)}${Number(p.unidades_por_bono) > 1 ? ` cada ${p.unidades_por_bono}` : ''}` : null,
                            }))} />
                        <Lista icono={Sparkles} titulo="Ofrécelos hoy" vacio="Nada que sugerir por ahora."
                            nota="Se venden bien y la sucursal los tiene."
                            filas={(vender.utilidad ?? []).map((p) => ({
                                clave: p.id, nombre: p.nombre, foto: p.foto_url,
                                detalle: `${p.ventas} ventas este mes`,
                                chip: `${Number(p.existencia)} en existencia`, chipTono: 'success',
                            }))} />
                        <Lista icono={CalendarClock} titulo="Vence pronto: véndelo primero" vacio="Nada vence en los próximos 6 meses."
                            nota={vender.vence_total > (vender.vence ?? []).length ? `Son ${vender.vence_total} lotes. Aquí van los más próximos.` : null}
                            filas={(vender.vence ?? []).map((p, i) => ({
                                clave: `${p.id}-${p.lote}-${i}`, nombre: p.nombre, foto: p.foto_url,
                                detalle: `${p.cantidad} en existencia`,
                                chip: `Vence ${venceTexto(p.vence)}`, chipTono: 'warning',
                            }))} />
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-4">
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
                                const parte = v.parte_del_dia != null ? Math.round(v.parte_del_dia * 100) : null;
                                return (
                                    <li key={v.id} className={`flex items-center gap-3 rounded-[var(--radius-btn)] p-2 ${yo ? 'bg-brand/10' : ''}`}>
                                        <span className={`w-6 text-center text-title font-black ${i === 0 ? 'text-warning-text' : 'text-content-3'}`}>{i + 1}</span>
                                        <AvatarConEstado emp={{ id: v.id, name: v.name, photo: v.photo_url }} px={40} mostrarChip={false} pendientes={false} />
                                        <div className="min-w-0 flex-1 leading-tight">
                                            <p className="text-body font-bold text-content truncate">{shortEmployeeName(v)}{yo ? ' (tú)' : ''}</p>
                                            <p className="text-label text-content-3">{v.ventas} {v.ventas === 1 ? 'venta' : 'ventas'}</p>
                                            {parte != null && (
                                                <div className="mt-1 h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
                                                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, parte)}%` }} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            {montos && v.total != null && <p className="text-body font-bold tabular-nums text-content">{formatMoney(v.total)}</p>}
                                            {parte != null && <p className={montos ? 'text-label text-content-3' : 'text-body font-bold tabular-nums text-content'}>{parte} %</p>}
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                    {vendedores.length > 0 && <p className="text-label text-content-3">El % es la parte de la venta de hoy que hizo cada quien.</p>}
                </section>

                <Lista icono={PackageCheck} titulo="Lo más vendido hoy" vacio="Todavía no hay ventas hoy."
                    filas={productos.map((p, i) => ({
                        clave: `${p.nombre}-${i}`, nombre: p.nombre, foto: p.foto_url, puesto: i + 1,
                        chip: `${p.ventas} ${p.ventas === 1 ? 'venta' : 'ventas'}`, chipTono: 'brand',
                        detalle: `${Number(p.cantidad)} ${Number(p.cantidad) === 1 ? 'unidad' : 'unidades'}`,
                    }))} />

            </div>
        </div>
    );
}


const CHIP = {
    brand: 'bg-brand/10 text-brand-text',
    success: 'bg-success/10 text-success-text',
    warning: 'bg-warning/10 text-warning-text',
};

function FotoProducto({ src }) {
    const [rota, setRota] = useState(false);
    return (
        <div className="w-14 h-14 shrink-0 rounded-[var(--radius-btn)] bg-surface-card-hover overflow-hidden flex items-center justify-center">
            {src && !rota
                ? <img src={src} alt="" loading="lazy" onError={() => setRota(true)} className="w-full h-full object-contain p-1" />
                : <Package size={22} className="text-content-3" aria-hidden="true" />}
        </div>
    );
}

function Lista({ icono: Icono, titulo, filas, vacio, nota = null }) {
    return (
        <section data-surface="card" className="p-4 flex flex-col gap-3 min-w-0">
            <h2 className="text-title font-black text-content flex items-center gap-2">
                <Icono size={20} className="text-brand-text shrink-0" aria-hidden="true" /> {titulo}
            </h2>
            {filas.length === 0 ? (
                <p className="text-body-sm text-content-3">{vacio}</p>
            ) : (
                <ul className="flex flex-col gap-1">
                    {filas.map((f) => (
                        <li key={f.clave} className="flex items-center gap-3 rounded-[var(--radius-btn)] p-1.5 -mx-1.5">
                            <div className="relative shrink-0">
                                <FotoProducto src={f.foto} />
                                {f.puesto != null && (
                                    <span className={`absolute -top-1.5 -left-1.5 w-6 h-6 rounded-full flex items-center justify-center text-label font-black tabular-nums ${f.puesto === 1
                                        ? 'bg-warning text-white' : 'bg-surface-card border border-border-card text-content-2'}`}>{f.puesto}</span>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 leading-tight flex flex-col gap-1">
                                <p className="text-body-sm font-semibold text-content line-clamp-2">{f.nombre}</p>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {f.chip && <span className={`text-label font-bold rounded-full px-2 py-0.5 ${CHIP[f.chipTono] ?? CHIP.brand}`}>{f.chip}</span>}
                                    {f.extra && <span className="text-label font-bold rounded-full px-2 py-0.5 bg-success/10 text-success-text">{f.extra}</span>}
                                    {f.detalle && <span className="text-label text-content-3 truncate">{f.detalle}</span>}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {nota && <p className="text-label text-content-3">{nota}</p>}
        </section>
    );
}

function Cifra({ icono: Icono, rotulo, valor, nota = null, notaTono = 'text-content-3', fuerte = false }) {
    return (
        <div className="rounded-[var(--radius-btn)] bg-surface-card-hover p-3 min-w-0">
            <p className="text-label text-content-3 flex items-center gap-1.5"><Icono size={14} aria-hidden="true" />{rotulo}</p>
            <p className={`tabular-nums truncate ${fuerte ? 'text-title-lg font-black text-content' : 'text-title font-bold text-content'}`}>{valor}</p>
            {nota && <p className={`text-label font-semibold ${notaTono}`}>{nota}</p>}
        </div>
    );
}

function Dato({ icono: Icono, titulo, valor, valorTono = 'text-content', detalle }) {
    return (
        <section data-surface="card" className="p-4 flex flex-col gap-1">
            <p className="text-label text-content-3 flex items-center gap-1.5"><Icono size={14} aria-hidden="true" />{titulo}</p>
            <p className={`text-title-lg font-black tabular-nums ${valorTono}`}>{valor}</p>
            <p className="text-label text-content-3">{detalle}</p>
        </section>
    );
}

function Leyenda({ clase, children }) {
    return <span className="inline-flex items-center gap-1.5"><span className={`inline-block w-4 h-1 rounded-full ${clase}`} aria-hidden="true" />{children}</span>;
}
