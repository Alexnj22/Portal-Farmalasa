import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, ClipboardCheck, Clock, Droplets, LayoutPanelTop, Pencil, Snowflake, Sparkles, Store, Thermometer, Toilet, Warehouse } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import AnotarLectura from '../../components/bitacoras/AnotarLectura';
import AnotarLimpieza from '../../components/bitacoras/AnotarLimpieza';
import PasarLaRonda from '../../components/bitacoras/PasarLaRonda';
import { ResumenDePuntos } from '../../components/bitacoras/PuntosDeLimpieza';
import { TIPO_AREA, bloquesDeLaRonda, rotularRango, soloLimpieza } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// La captura del día.
//
// ── Se pinta la GRILLA COMPLETA, no las lecturas que existen ───────────────
// Cada franja del día tiene su casilla, tenga lectura o no. Una bitácora que
// sólo lista lo que se anotó no puede contestar «¿nos falta alguna?», que es la
// pregunta del inspector — y es la misma lección que dejaron los cortes de caja:
// vacío y completo se ven idénticos cuando sólo se muestran los registros que
// hay.
//
// ── El estado lo decide la BASE, no esta pantalla ──────────────────────────
// `abierta`, `proxima`, `vencida` y `hecha` vienen calculados contra la hora de
// El Salvador. Calcularlos acá con la hora del navegador haría que un equipo
// con el reloj corrido —o alguien mirando desde otro huso— viera abierta una
// franja que ya venció, y anotara «a tiempo» algo que no lo está. El ítem
// 6.1.14 del RTS pide que el registro sea CONTEMPORÁNEO; eso no se puede
// verificar con un reloj que cada quien tiene distinto.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO_AREA = {
    sala_ventas:        Store,
    bodega:             Warehouse,
    refrigerador:       Snowflake,
    vitrinas:           LayoutPanelTop,
    servicio_sanitario: Toilet,
};

// El aspecto de cada estado. Vive acá y no repartido por el JSX porque son
// cuatro estados × dos bloques (lectura y limpieza) y desparramarlos garantiza
// que uno quede distinto. Los tonos son los del canon de §5.1 —`success`,
// `warning`, `danger`— no rótulos propios: `data-tono` es un contrato con
// `index.css`, y un valor inventado no pinta nada y tampoco falla.
const ASPECTO = {
    hecha:   { tono: 'success', badge: 'success', rotulo: 'Anotada' },
    abierta: { tono: 'warning', badge: 'warning', rotulo: 'Toca ahora' },
    vencida: { tono: 'danger',  badge: 'danger',  rotulo: 'Se pasó la hora' },
    proxima: { tono: undefined, badge: 'neutral', rotulo: 'Todavía no' },
};

const hhmm = (t) => String(t || '').slice(0, 5);

const horaDe = (iso) => {
    if (!iso) return '';
    // La hora de captura se muestra en hora de El Salvador, que es la que tiene
    // sentido al lado de una franja definida en hora de El Salvador.
    const d = new Date(new Date(iso).getTime() - 6 * 3600_000);
    return d.toISOString().slice(11, 16);
};

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Una casilla de la grilla: la franja con su lectura, o el hueco. */
function Casilla({ franja, area, puedeAnotar, cerrado, onAnotar, onCorregir }) {
    const asp = ASPECTO[franja.estado] || ASPECTO.proxima;
    const l = franja.lectura;

    return (
        <div data-surface="card" data-tono={asp.tono}
            className="p-3 flex flex-col gap-2 min-w-0">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-body-sm font-bold text-content-1 truncate">{franja.label}</p>
                    <p className="text-label text-content-3 tabular-nums">{hhmm(franja.desde)}–{hhmm(franja.hasta)}</p>
                </div>
                <Badge variant={asp.badge} size="sm" uppercase={false} className="shrink-0">{asp.rotulo}</Badge>
            </div>

            {l ? (
                <>
                    <div className="flex items-baseline gap-3">
                        <span className={`text-title font-black tabular-nums ${l.fuera_de_rango ? 'text-danger-text' : 'text-content'}`}>
                            {num(l.temperatura)}<span className="text-body-sm font-bold"> °C</span>
                        </span>
                        {l.humedad !== null && l.humedad !== undefined && (
                            <span className="text-body-sm font-bold text-content-3 tabular-nums">
                                {num(l.humedad)}% HR
                            </span>
                        )}
                    </div>

                    {/* Quién y a qué hora: el «atribuible» y el «contemporáneo»
                        del RTS 6.1.14, uno al lado del otro. La marca de tarde
                        no se esconde — es la mitad del valor del registro. */}
                    <p className="text-label text-content-3 truncate">
                        {l.registrado_por_nombre || 'Sin nombre'} · <span className="tabular-nums">{horaDe(l.registrado_at)}</span>
                        {l.tarde && <span className="text-warning-text font-bold"> · fuera de hora</span>}
                        {l.correcciones > 0 && <span> · {l.correcciones} corrección{l.correcciones > 1 ? 'es' : ''}</span>}
                    </p>

                    {l.fuera_de_rango && (
                        <Notice variant="danger" compact icon={AlertTriangle}>
                            {l.accion_correctiva || 'Fuera de rango sin acción anotada'}
                        </Notice>
                    )}

                    {puedeAnotar && !cerrado && (
                        <Button variant="ghost" size="sm" icon={Pencil} onClick={() => onCorregir(area, franja)}>
                            Corregir
                        </Button>
                    )}
                </>
            ) : (
                <>
                    <p className="text-body-sm text-content-3">Sin lectura</p>
                    {puedeAnotar && !cerrado && franja.estado !== 'proxima' && (
                        <Button variant={franja.estado === 'abierta' ? 'primary' : 'secondary'} size="sm"
                            icon={Thermometer} onClick={() => onAnotar(area, franja)}>
                            Anotar
                        </Button>
                    )}
                    {franja.estado === 'proxima' && (
                        <p className="text-label text-content-3 flex items-center gap-1">
                            <Clock size={12} /> Se habilita a las <span className="tabular-nums">{hhmm(franja.desde)}</span>
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

/** El turno de limpieza. Misma anatomía, menos datos. */
function CasillaLimpieza({ turno, area, puedeAnotar, cerrado, onAnotar }) {
    const asp = ASPECTO[turno.estado] || ASPECTO.proxima;
    const r = turno.registro;
    return (
        <div data-surface="card" data-tono={asp.tono} className="p-3 flex flex-col gap-2 min-w-0">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-body-sm font-bold text-content-1 truncate">{turno.label}</p>
                    <p className="text-label text-content-3 tabular-nums">{hhmm(turno.desde)}–{hhmm(turno.hasta)}</p>
                </div>
                <Badge variant={asp.badge} size="sm" uppercase={false} className="shrink-0">{asp.rotulo}</Badge>
            </div>
            {r ? (
                <>
                    <p className="text-body-sm font-bold text-content flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="flex items-center gap-1.5">
                            <Check size={14} className="text-success-text" /> Realizada
                        </span>
                        {/* Cuántos muebles se limpiaron de los que lleva el área.
                            En rojo si faltó alguno: un registro que sólo sabe
                            decir «sí» no prueba nada. */}
                        <ResumenDePuntos registro={r} />
                    </p>
                    <p className="text-label text-content-3 truncate">
                        {r.realizada_por_nombre || 'Sin nombre'} · <span className="tabular-nums">{horaDe(r.registrado_at)}</span>
                        {r.tarde && <span className="text-warning-text font-bold"> · fuera de hora</span>}
                    </p>
                    {r.observaciones && <p className="text-label text-content-2">{r.observaciones}</p>}
                </>
            ) : (
                <>
                    <p className="text-body-sm text-content-3">Sin registrar</p>
                    {puedeAnotar && !cerrado && turno.estado !== 'proxima' && (
                        <Button variant={turno.estado === 'abierta' ? 'primary' : 'secondary'} size="sm"
                            icon={Sparkles} onClick={() => onAnotar(area, turno)}>
                            Registrar
                        </Button>
                    )}
                </>
            )}
        </div>
    );
}

export default function TabHoy({ dia, cargando, error, puedeAnotar, onRecargar }) {
    const [anotando, setAnotando]   = useState(null);   // { area, franja, lectura? }
    const [limpiando, setLimpiando] = useState(null);   // { area, turno }
    const [enRonda, setEnRonda]     = useState(false);

    const cerrado = Boolean(dia?.cerrado);

    const abrirAnotar   = useCallback((area, franja) => setAnotando({ area, franja, lectura: null }), []);
    const abrirCorregir = useCallback((area, franja) => setAnotando({ area, franja, lectura: franja.lectura }), []);
    const abrirLimpieza = useCallback((area, turno) => setLimpiando({ area, turno }), []);

    const cerrar = useCallback((huboCambio) => {
        setAnotando(null);
        setLimpiando(null);
        setEnRonda(false);
        if (huboCambio) onRecargar?.();
    }, [onRecargar]);

    // `useMemo` y no `||` a secas: un array nuevo en cada render invalidaría el
    // memo de abajo siempre, que es justo lo que el lint marca.
    const areas = useMemo(() => dia?.areas || [], [dia]);

    // Todo lo que se puede anotar ahora, en el orden de la caminata.
    const ronda = useMemo(() => bloquesDeLaRonda(dia), [dia]);

    // ── `?ronda=1` abre la vuelta sin pasar por la grilla ───────────────────
    // Lo usan el atajo del Inicio y el aviso de franja por vencerse. Sin esto,
    // el aviso deja a la persona mirando la grilla y todavía tiene que
    // encontrar el botón — que es justo el paso que el aviso venía a evitar.
    //
    // El parámetro se CONSUME: si se quedara en la dirección, cerrar el
    // diálogo lo volvería a abrir en el render siguiente. Y se espera a que el
    // día esté cargado, porque antes la lista está vacía y no habría nada que
    // abrir.
    const [params, setParams] = useSearchParams();
    const pidenRonda = params.get('ronda') === '1';
    useEffect(() => {
        if (!pidenRonda || cargando) return;
        setParams(p => { p.delete('ronda'); return p; }, { replace: true });
        // eslint-disable-next-line react-hooks/set-state-in-effect -- lo pide la dirección, no un render
        if (puedeAnotar && !cerrado && ronda.length > 0) setEnRonda(true);
    }, [pidenRonda, cargando, puedeAnotar, cerrado, ronda.length, setParams]);

    // Las áreas que hoy no aplican se muestran aparte, pero se muestran: que no
    // aparecieran sería esconder una parte de la sala, y el día que alguien
    // configure mal los días de la semana nadie lo notaría.
    //
    // Y las que SÓLO se limpian —vitrinas, servicio sanitario— van a un bloque
    // compacto al final. Cada una es un área de verdad, con su cumplimiento
    // propio y su tabla en el mes impreso, pero darle a cada una un encabezado
    // grande y una fila entera para una casilla desplaza hacia abajo justo lo
    // que se abre esta pantalla a hacer: las lecturas de temperatura.
    const { conLecturas, deLimpieza, enPausa } = useMemo(() => ({
        conLecturas: areas.filter(a => a.aplica_hoy !== false && !soloLimpieza(a)),
        deLimpieza:  areas.filter(a => a.aplica_hoy !== false && soloLimpieza(a)),
        enPausa:     areas.filter(a => a.aplica_hoy === false),
    }), [areas]);

    if (cargando) return <LoadingState label="Cargando la bitácora del día…" />;

    // Un rechazo de permiso NO se puede ver como una lista vacía: quien lo sufre
    // sólo puede reportar «me sale vacía», que es exactamente lo que pasó con el
    // módulo `sesiones` (§2-bis del checklist de vista nueva). El 42501 tiene
    // arreglo concreto y por eso se nombra.
    if (error) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {error.code === '42501'
                    ? 'Tu cargo no tiene el módulo de bitácoras. Hay que otorgarlo en Permisos.'
                    : (error.message || 'No se pudo cargar la bitácora.')}
            </Notice>
        );
    }

    if (!areas.length) {
        return (
            <EmptyState icon={Thermometer}
                title="Sin áreas configuradas"
                subtitle="Esta sucursal todavía no tiene áreas. Se definen en la pestaña Configuración." />
        );
    }

    return (
        <div className="space-y-5">
            {cerrado && (
                <Notice variant="info">
                    Este mes ya está cerrado y firmado. Para anotar o corregir algo hay que reabrirlo
                    desde Cierre de mes, y esa reapertura queda registrada.
                </Notice>
            )}

            {/* ── Pasar la ronda ────────────────────────────────────────
                Medido el 2026-08-25 sobre los primeros 576 registros: el 68% se
                anotó a menos de tres minutos del anterior, con 29 segundos de
                promedio. La sala ya camina la vuelta entera de un tirón; esto
                le da UNA pantalla para toda la vuelta en vez de trece diálogos.

                Aparece con dos o más pendientes: con uno solo, el botón de esa
                casilla ya está ahí y un segundo camino hacia lo mismo sería
                ruido. */}
            {puedeAnotar && !cerrado && ronda.length > 1 && (
                <div data-surface="card" data-tono="warning"
                    className="p-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-body-sm font-bold text-content-1">
                            Hay {ronda.length} registros para anotar
                        </p>
                        <p className="text-label text-content-3">
                            Se llenan todos de una vez, en el orden en que se camina la sala.
                        </p>
                    </div>
                    <Button variant="primary" icon={ClipboardCheck} onClick={() => setEnRonda(true)}>
                        Pasar la ronda
                    </Button>
                </div>
            )}

            {conLecturas.map((area) => {
                const Icono = ICONO_AREA[area.tipo] || Thermometer;
                return (
                    <section key={area.id} className="space-y-3">
                        <header className="flex flex-wrap items-center gap-2">
                            <span className="grid place-items-center size-8 rounded-btn bg-brand/10 text-brand-text shrink-0">
                                <Icono size={16} />
                            </span>
                            <h3 className="text-body-lg font-black text-content">{area.nombre}</h3>
                            <Badge variant="neutral" size="sm" uppercase={false}>{TIPO_AREA[area.tipo] || area.tipo}</Badge>
                            <Badge variant="chart-1" size="sm" uppercase={false}>{rotularRango(area)}</Badge>
                            {area.mide_humedad && (
                                <Badge variant="neutral" size="sm" uppercase={false} icon={Droplets}>humedad</Badge>
                            )}
                            {/* La calibración vencida es un ítem CRÍTICO (RTS
                                5.6.14) y no lo vigila nadie más: si el aviso no
                                está pegado al área, no se ve nunca. */}
                            {area.calibracion_vencida && (
                                <Badge variant="danger" size="sm" uppercase={false}>Calibración vencida</Badge>
                            )}
                        </header>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {(area.franjas || []).map((f) => (
                                <Casilla key={f.clave} franja={f} area={area}
                                    puedeAnotar={puedeAnotar} cerrado={cerrado}
                                    onAnotar={abrirAnotar} onCorregir={abrirCorregir} />
                            ))}
                        </div>

                        {(area.limpiezas || []).length > 0 && (
                            <>
                                <p className="text-label font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5 pt-1">
                                    <Sparkles size={13} /> Limpieza y orden
                                </p>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {area.limpiezas.map((t) => (
                                        <CasillaLimpieza key={t.clave} turno={t} area={area}
                                            puedeAnotar={puedeAnotar} cerrado={cerrado}
                                            onAnotar={abrirLimpieza} />
                                    ))}
                                </div>
                            </>
                        )}
                    </section>
                );
            })}

            {deLimpieza.length > 0 && (
                <section className="space-y-3">
                    <p className="text-label font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
                        <Sparkles size={13} /> Sólo limpieza
                    </p>
                    {deLimpieza.map((area) => {
                        const Icono = ICONO_AREA[area.tipo] || Sparkles;
                        return (
                            <div key={area.id} className="space-y-2">
                                <header className="flex flex-wrap items-center gap-2">
                                    <span className="grid place-items-center size-7 rounded-btn bg-brand/10 text-brand-text shrink-0">
                                        <Icono size={14} />
                                    </span>
                                    <h3 className="text-body font-black text-content">{area.nombre}</h3>
                                </header>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {(area.limpiezas || []).map((t) => (
                                        <CasillaLimpieza key={t.clave} turno={t} area={area}
                                            puedeAnotar={puedeAnotar} cerrado={cerrado}
                                            onAnotar={abrirLimpieza} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </section>
            )}

            {enPausa.length > 0 && (
                <Notice variant="info" compact>
                    Hoy no se lleva bitácora en {enPausa.map(a => a.nombre).join(', ')} — así está
                    configurada el área. Los días que no aplican no cuentan como faltantes al cerrar el mes.
                </Notice>
            )}

            {enRonda && (
                <PasarLaRonda fecha={dia.fecha} bloques={ronda} onCerrar={cerrar} />
            )}
            {anotando && (
                <AnotarLectura
                    area={anotando.area}
                    franja={anotando.franja}
                    lectura={anotando.lectura}
                    fecha={dia.fecha}
                    onCerrar={cerrar}
                />
            )}
            {limpiando && (
                <AnotarLimpieza
                    area={limpiando.area}
                    turno={limpiando.turno}
                    fecha={dia.fecha}
                    onCerrar={cerrar}
                />
            )}
        </div>
    );
}
