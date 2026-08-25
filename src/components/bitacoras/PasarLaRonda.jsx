import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, MessageSquarePlus, Snowflake, Sparkles, Store, Thermometer, Toilet, Warehouse, LayoutPanelTop } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import { ListaDePuntos } from './PuntosDeLimpieza';
import { fueraDeRango, registrarRonda, rotularRango } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Pasar la ronda — la vuelta entera en una pantalla.
//
// ── De dónde salió ─────────────────────────────────────────────────────────
// De medir cómo se llenaba, no de suponerlo. Sobre los 576 registros de las
// primeras nueve jornadas: **394 (68%) se anotaron a menos de tres minutos del
// anterior**, con 29 segundos de promedio, y 55 vueltas juntaron cinco o seis
// registros seguidos.
//
// ── Se agrupa por MOMENTO, no por área (2026-08-25) ────────────────────────
// La primera versión agrupaba por área —una tarjeta por cada una, con su
// franja adentro— y el usuario lo corrigió con la frase que ordena todo:
// «cuando se toma la temperatura, se toma de un solo en ambos casos, o en los
// 3 si tienen refrigerador». La persona camina UNA vez con el termohigrómetro
// y anota sala, bodega y refrigerador de esa pasada. El eje de la pantalla es
// el momento, y las áreas son sus renglones.
//
// Y así el número queda en una COLUMNA: tres campos alineados bajo el rótulo
// «°C» se leen y se llenan de corrido; tres tarjetas con su etiqueta cada una
// obligan a leer la misma palabra tres veces.
//
// ── Lo que se deja en blanco NO se manda ───────────────────────────────────
// La ronda no es un formulario que haya que completar: es la lista de lo que se
// puede anotar ahora. Si el refrigerador está en la bodega de al lado y todavía
// no se pasó por ahí, ese renglón queda vacío y sigue pendiente en la grilla.
// Un formulario que exige todo lo abierto enseñaría a inventar el que falta.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO_AREA = {
    sala_ventas:        Store,
    bodega:             Warehouse,
    refrigerador:       Snowflake,
    vitrinas:           LayoutPanelTop,
    servicio_sanitario: Toilet,
};

const hhmm = (t) => String(t || '').slice(0, 5);

/** Un renglón de temperatura dentro del momento. */
function RenglonLectura({ item, valor, onCambio, errorServidor }) {
    const { area } = item;
    const Icono = ICONO_AREA[area.tipo] || Thermometer;
    const fuera = fueraDeRango(area, valor.temp);
    const faltaAccion = fuera && !String(valor.accion || '').trim();

    return (
        <>
            {/* Tres columnas fijas para que los campos queden ALINEADOS entre
                renglones: el área se encoge, los números no. En el teléfono los
                dos campos suman 172px y le dejan el resto al nombre. */}
            <div className="grid grid-cols-[minmax(0,1fr)_84px_84px] items-center gap-2">
                <div className="min-w-0">
                    <p className="text-body-sm font-bold text-content-1 truncate flex items-center gap-1.5">
                        <Icono size={14} className="text-content-3 shrink-0" />
                        {area.nombre}
                    </p>
                    <p className="text-label text-content-3 truncate">{rotularRango(area)}</p>
                </div>

                {/* Sin etiqueta: el encabezado de la columna ya dice qué es
                    (`PortalInput` lo contempla y el gate exige `aria-label`).
                    Y sin placeholder: un «0.0» gris se lee como un valor ya
                    escrito, que en una bitácora es justo lo que no puede pasar. */}
                <PortalInput
                    name={`temp-${item.clave}`} type="text" inputMode="decimal" maskType="DECIMAL"
                    aria-label={`Temperatura de ${area.nombre} en grados`}
                    value={valor.temp || ''} onChange={(e) => onCambio({ temp: e.target.value })}
                    inputClassName="tabular-nums text-center px-2" hasError={fuera}
                />
                {area.mide_humedad ? (
                    <PortalInput
                        name={`hum-${item.clave}`} type="text" inputMode="decimal" maskType="DECIMAL"
                        aria-label={`Humedad de ${area.nombre} en porcentaje`}
                        value={valor.hum || ''} onChange={(e) => onCambio({ hum: e.target.value })}
                        inputClassName="tabular-nums text-center px-2"
                    />
                ) : (
                    <span className="text-center text-content-3">—</span>
                )}
            </div>

            {fuera && (
                <div className="space-y-1.5 pl-1">
                    <p className="text-label font-bold text-danger-text flex items-start gap-1.5">
                        <AlertTriangle size={13} className="shrink-0 mt-px" />
                        Fuera del rango. Hay que anotar qué se hizo: una lectura fuera de rango sin acción
                        al lado prueba que se vio y no se actuó.
                    </p>
                    <PortalTextarea
                        name={`accion-${item.clave}`} rows={2}
                        aria-label={`Qué se hizo con la temperatura de ${area.nombre}`}
                        value={valor.accion || ''} onChange={(e) => onCambio({ accion: e.target.value })}
                        placeholder="Se encendió el aire y se bajó la persiana. Recontrolado a las 13:40."
                        compact
                        hasError={faltaAccion}
                    />
                </div>
            )}

            {errorServidor && (
                <p className="text-label text-danger-text font-bold flex items-start gap-1.5 pl-1">
                    <AlertTriangle size={13} className="shrink-0 mt-px" /> {errorServidor}
                </p>
            )}
        </>
    );
}

/** Un renglón de limpieza: una casilla, sus muebles, y la nota si hace falta. */
function RenglonLimpieza({ item, valor, onCambio, errorServidor }) {
    const { area, bloque } = item;
    const Icono = ICONO_AREA[area.tipo] || Sparkles;
    const [conNota, setConNota] = useState(false);
    const [abierto, setAbierto] = useState(false);

    const puntos = area.puntos || [];
    const marcadas = valor.puntos || new Set();
    const faltan = puntos.length - [...marcadas].filter(c => puntos.some(p => p.clave === c)).length;

    // Marcar el turno marca TODOS sus muebles: el día normal es que se limpió
    // todo, y ése no puede costar seis toques. Lo que faltó se desmarca abriendo
    // el detalle — la excepción es la que merece el trabajo.
    const alternarTurno = (marcada) => onCambio({
        marcada,
        puntos: marcada ? new Set(puntos.map(p => p.clave)) : new Set(),
    });

    return (
        <>
            <div className="flex items-center justify-between gap-2">
                <Checkbox
                    name={`limpieza-${item.clave}`}
                    checked={Boolean(valor.marcada)}
                    onChange={alternarTurno}
                    label={
                        <span className="flex items-center gap-1.5">
                            <Icono size={13} className="text-content-3 shrink-0" />
                            {area.nombre}
                            <span className="font-medium text-content-3">· {bloque.label}</span>
                        </span>
                    }
                />
                <div className="flex items-center gap-1 shrink-0">
                    {valor.marcada && puntos.length > 0 && (
                        <Button variant="ghost" size="sm"
                            icon={abierto ? ChevronDown : ChevronRight}
                            onClick={() => setAbierto(a => !a)}>
                            <span className={`tabular-nums ${faltan ? 'text-danger-text font-black' : ''}`}>
                                {puntos.length - faltan} de {puntos.length}
                            </span>
                        </Button>
                    )}
                    {valor.marcada && !conNota && (
                        <Button variant="ghost" size="sm" iconOnly icon={MessageSquarePlus}
                            title="Anotar algo" onClick={() => setConNota(true)} />
                    )}
                </div>
            </div>

            {valor.marcada && abierto && puntos.length > 0 && (
                <ListaDePuntos compacta puntos={puntos} marcadas={marcadas}
                    onCambiar={(s) => onCambio({ puntos: s })} />
            )}

            {/* La nota es opcional a propósito: la norma pide el REGISTRO de la
                limpieza, no su descripción, y un campo obligatorio que no aporta
                produce «ok» ciento veinte veces — el ruido que hace ilegible un
                libro. Por eso está escondida hasta que hace falta. */}
            {valor.marcada && conNota && (
                <PortalTextarea
                    name={`obs-${item.clave}`} rows={2}
                    aria-label={`Observación de la limpieza de ${area.nombre}`}
                    value={valor.obs || ''} onChange={(e) => onCambio({ obs: e.target.value })}
                    placeholder="Una gotera, una vitrina que hubo que reacomodar…"
                    compact
                />
            )}

            {errorServidor && (
                <p className="text-label text-danger-text font-bold flex items-start gap-1.5">
                    <AlertTriangle size={13} className="shrink-0 mt-px" /> {errorServidor}
                </p>
            )}
        </>
    );
}

export default function PasarLaRonda({ fecha, bloques, onCerrar }) {
    const [pendientes, setPendientes] = useState(bloques);
    const [valores, setValores]   = useState({});
    const [errores, setErrores]   = useState({});
    const [guardando, setGuardando] = useState(false);
    const [error, setError]       = useState(null);
    const [huboCambio, setHuboCambio] = useState(false);

    const cambiar = useCallback((clave, parche) => {
        setValores(v => ({ ...v, [clave]: { ...(v[clave] || {}), ...parche } }));
    }, []);

    // ── Agrupado por MOMENTO ────────────────────────────────────────────────
    // La clave es el horario, no el rótulo: dos áreas pueden llamar «Mañana» a
    // ventanas distintas —la bodega central abre a las 08:00 y las farmacias a
    // las 07:00— y juntarlas diría una hora que no es la de nadie.
    const momentos = useMemo(() => {
        const mapa = new Map();
        for (const it of pendientes) {
            const clave = `${it.bloque.desde}|${it.bloque.hasta}`;
            const g = mapa.get(clave) || {
                clave, label: it.bloque.label, desde: it.bloque.desde, hasta: it.bloque.hasta,
                estado: it.bloque.estado, lecturas: [], limpiezas: [],
            };
            (it.tipo === 'lectura' ? g.lecturas : g.limpiezas).push(it);
            // Si algo de ese momento ya venció, el momento entero está vencido:
            // es la señal que decide si se anota corriendo o con calma.
            if (it.bloque.estado === 'vencida') g.estado = 'vencida';
            mapa.set(clave, g);
        }
        return [...mapa.values()].sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
    }, [pendientes]);

    // Lo que se va a mandar. Un renglón vacío no viaja.
    const items = useMemo(() => {
        const salida = [];
        for (const it of pendientes) {
            const v = valores[it.clave] || {};
            if (it.tipo === 'lectura') {
                const temp = String(v.temp ?? '').trim();
                if (!temp) continue;
                salida.push({
                    clave: it.clave, tipo: 'lectura', area_id: it.area.id, fecha,
                    franja: it.bloque.clave,
                    temperatura: Number(temp),
                    humedad: it.area.mide_humedad && String(v.hum ?? '').trim() !== ''
                        ? Number(v.hum) : null,
                    accion: String(v.accion || '').trim() || null,
                });
            } else if (v.marcada) {
                const suyos = it.area.puntos || [];
                salida.push({
                    clave: it.clave, tipo: 'limpieza', area_id: it.area.id, fecha,
                    turno: it.bloque.clave,
                    observaciones: String(v.obs || '').trim() || null,
                    puntos: suyos.map(p => ({ clave: p.clave, hecho: (v.puntos || new Set()).has(p.clave) })),
                });
            }
        }
        return salida;
    }, [pendientes, valores, fecha]);

    // Una lectura fuera de rango sin acción la rechaza la base. Frenarla acá no
    // reemplaza esa guarda —se puede llamar al RPC sin pasar por la pantalla—:
    // evita mandar una vuelta entera para que vuelva con un renglón caído.
    const incompletos = useMemo(() => pendientes.filter(it => {
        if (it.tipo !== 'lectura') return false;
        const v = valores[it.clave] || {};
        if (!String(v.temp ?? '').trim()) return false;
        return fueraDeRango(it.area, v.temp) && !String(v.accion || '').trim();
    }), [pendientes, valores]);

    const guardar = useCallback(async () => {
        setError(null);
        setGuardando(true);
        const res = await registrarRonda(items);
        setGuardando(false);

        if (res.error) { setError(res.error); return; }
        if (res.guardados > 0) setHuboCambio(true);

        const fallidas = new Map((res.fallidos || []).map(f => [f.clave, f.error]));
        if (!fallidas.size) { onCerrar(true); return; }

        // Lo que entró desaparece; lo que no, se queda con su motivo a la vista y
        // con lo tecleado intacto. Cerrar acá obligaría a rehacer de memoria una
        // lectura que se acaba de tomar.
        const enviadas = new Set(items.map(i => i.clave));
        setPendientes(p => p.filter(it => !enviadas.has(it.clave) || fallidas.has(it.clave)));
        setErrores(Object.fromEntries(fallidas));
    }, [items, onCerrar]);

    const cerrar = useCallback(() => onCerrar(huboCambio), [huboCambio, onCerrar]);

    return (
        <LiquidModal open onClose={guardando ? undefined : cerrar}
            maxWidth="max-w-lg" ariaLabel="Pasar la ronda">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Pasar la ronda</h3>
                    <p className="text-caption text-content-3">
                        Lo que dejes en blanco queda pendiente.
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {Object.keys(errores).length > 0 && (
                    <Notice variant="warning" compact icon={AlertTriangle}>
                        <span className="font-bold">Quedaron renglones sin guardar.</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Lo demás ya está anotado. Acá abajo está el motivo de cada uno.
                        </span>
                    </Notice>
                )}

                {momentos.map((m) => (
                    <section key={m.clave} data-surface="card"
                        data-tono={m.estado === 'vencida' ? 'warning' : undefined}
                        className="p-3 space-y-3">
                        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <h4 className="text-body-sm font-black text-content">{m.label}</h4>
                            <span className="text-label text-content-3 tabular-nums">
                                {hhmm(m.desde)}–{hhmm(m.hasta)}
                            </span>
                            {m.estado === 'vencida' && (
                                <Badge variant="warning" size="sm" uppercase={false} icon={Clock}>
                                    Se pasó la hora
                                </Badge>
                            )}
                        </header>

                        {m.lecturas.length > 0 && (
                            <div className="space-y-2">
                                {/* El rótulo de la columna, UNA vez para todos los
                                    renglones: es lo que permite que los campos no
                                    lleven etiqueta y queden alineados. */}
                                <div className="grid grid-cols-[minmax(0,1fr)_84px_84px] gap-2">
                                    <span />
                                    <span className="text-label font-black uppercase tracking-widest text-content-3 text-center">°C</span>
                                    <span className="text-label font-black uppercase tracking-widest text-content-3 text-center">% HR</span>
                                </div>
                                {m.lecturas.map(it => (
                                    <RenglonLectura key={it.clave} item={it}
                                        valor={valores[it.clave] || {}}
                                        onCambio={(p) => cambiar(it.clave, p)}
                                        errorServidor={errores[it.clave]} />
                                ))}
                            </div>
                        )}

                        {m.limpiezas.length > 0 && (
                            <div className="space-y-1.5 pt-1 border-t border-border-card">
                                <p className="text-label font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5 pt-1">
                                    <Sparkles size={12} /> Limpieza
                                </p>
                                {m.limpiezas.map(it => (
                                    <RenglonLimpieza key={it.clave} item={it}
                                        valor={valores[it.clave] || {}}
                                        onCambio={(p) => cambiar(it.clave, p)}
                                        errorServidor={errores[it.clave]} />
                                ))}
                            </div>
                        )}
                    </section>
                ))}

                {error && <Notice variant="danger" compact icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={cerrar} disabled={guardando}>
                    {huboCambio ? 'Listo' : 'Cancelar'}
                </Button>
                <Button variant="primary" icon={Check} onClick={guardar} loading={guardando}
                    disabled={!items.length || incompletos.length > 0}>
                    {items.length ? `Anotar ${items.length}` : 'Anotar'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
