import React, { useCallback, useState } from 'react';
import { AlertTriangle, Check, ClipboardCheck, Clock, LayoutPanelTop, Pencil, Snowflake, Sparkles, Store, Thermometer, Toilet, Warehouse } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import { ResumenDePuntos } from './PuntosDeLimpieza';
import { fueraDeRango, registrarLectura, registrarLimpieza, rotularRango, soloLimpieza } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// La matriz del día — áreas en las filas, momentos en las columnas.
//
// ── Por qué una tabla y no tarjetas ────────────────────────────────────────
// Es la forma del libro de papel que el inspector reconoce, y es la única que
// contesta de un vistazo la pregunta del regente: «¿nos falta alguna?».
// Medido en la versión de tarjetas: **18 tarjetas para 13 registros**, nueve de
// ellas sin decir nada («Sin lectura», «Sin registrar») y siete diciendo
// «Todavía no» — la respuesta más repetida de la pantalla. Todo pesaba igual:
// lo hecho llevaba un borde verde que gritaba y el hueco era una tarjeta
// pálida.
//
// ── Se anota EN la celda ───────────────────────────────────────────────────
// La columna del momento que toca trae los campos adentro: se teclea el número
// y se confirma, sin abrir nada. El diálogo queda para las dos veces en que hay
// algo más que decir — corregir (que exige motivo) y una lectura fuera de rango
// (que exige la acción correctiva). En ese segundo caso lo tecleado VIAJA al
// diálogo: pedir el número otra vez sería castigar a quien encontró el desvío.
//
// ── Lo hecho se calla ──────────────────────────────────────────────────────
// El número en tinta normal y un check chico. En una bitácora lo que necesita
// color es el hueco, no el acierto.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO_AREA = {
    sala_ventas:        Store,
    bodega:             Warehouse,
    refrigerador:       Snowflake,
    vitrinas:           LayoutPanelTop,
    servicio_sanitario: Toilet,
};

const hhmm = (t) => String(t || '').slice(0, 5);

const horaDe = (iso) => {
    if (!iso) return '';
    // En hora de El Salvador, que es la del horario contra el que se compara.
    const d = new Date(new Date(iso).getTime() - 6 * 3600_000);
    return d.toISOString().slice(11, 16);
};

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Una celda de temperatura: el valor, el hueco o los campos para anotarlo. */
function Celda({ area, franja, fecha, puedeAnotar, cerrado, onRecargar, onCorregir, onFueraDeRango }) {
    const [temp, setTemp] = useState('');
    const [hum, setHum]   = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    // El área no lleva este momento (la bodega central tiene los suyos).
    if (!franja) return <td className="px-3 py-2 text-center text-content-3 opacity-40">·</td>;

    const l = franja.lectura;
    const puedeEscribir = puedeAnotar && !cerrado
        && (franja.estado === 'abierta' || franja.estado === 'vencida');

    const guardar = async () => {
        const t = String(temp).trim();
        if (!t) return;
        // Fuera de rango ⇒ el diálogo, que es donde se pide qué se hizo. La
        // base lo rechazaría igual; adelantarlo evita el viaje perdido.
        if (fueraDeRango(area, t)) { onFueraDeRango(area, franja, { temp: t, hum }); return; }
        setError(null);
        setGuardando(true);
        const res = await registrarLectura({
            areaId: area.id, fecha, franja: franja.clave,
            temperatura: Number(t), humedad: area.mide_humedad ? hum : null,
        });
        setGuardando(false);
        if (res.error) { setError(res.error); return; }
        setTemp(''); setHum('');
        onRecargar?.();
    };

    if (l) {
        return (
            <td className={`px-3 py-2 align-middle ${l.fuera_de_rango ? 'bg-danger/5' : ''}`}>
                <div className="flex items-baseline gap-2">
                    <span className={`text-body-lg font-black tabular-nums ${l.fuera_de_rango ? 'text-danger-text' : 'text-content'}`}>
                        {num(l.temperatura)}<span className="text-label font-bold text-content-3"> °C</span>
                    </span>
                    {l.humedad !== null && l.humedad !== undefined && (
                        <span className="text-label font-bold text-content-3 tabular-nums">{num(l.humedad)}%</span>
                    )}
                    {puedeAnotar && !cerrado && (
                        <Button variant="ghost" size="sm" iconOnly icon={Pencil}
                            title="Corregir esta lectura" onClick={() => onCorregir(area, franja)} />
                    )}
                </div>
                <p className="text-micro text-content-3 truncate">
                    {(l.registrado_por_nombre || 'Sin nombre').split(' ').slice(0, 2).join(' ')}
                    {' · '}<span className="tabular-nums">{horaDe(l.registrado_at)}</span>
                    {l.tarde && <span className="text-warning-text font-bold"> · tarde</span>}
                </p>
                {l.fuera_de_rango && (
                    <p className="text-micro text-danger-text font-bold truncate">
                        {l.accion_correctiva || 'Sin acción anotada'}
                    </p>
                )}
            </td>
        );
    }

    if (!puedeEscribir) {
        return (
            <td className="px-3 py-2 text-content-3">
                {franja.estado === 'proxima' ? (
                    <span className="text-label tabular-nums">desde {hhmm(franja.desde)}</span>
                ) : (
                    <span className="text-label">—</span>
                )}
            </td>
        );
    }

    return (
        <td className={`px-3 py-2 ${franja.estado === 'vencida' ? 'bg-danger/5' : 'bg-warning/5'}`}>
            <div className="flex items-center gap-1.5">
                <PortalInput
                    className="w-[74px]" compact name={`t-${area.id}-${franja.clave}`}
                    type="text" inputMode="decimal" maskType="DECIMAL"
                    aria-label={`Temperatura de ${area.nombre} en ${franja.label}`}
                    value={temp} onChange={(e) => setTemp(e.target.value)}
                    inputClassName="tabular-nums text-center px-1"
                />
                {area.mide_humedad && (
                    <PortalInput
                        className="w-[64px]" compact name={`h-${area.id}-${franja.clave}`}
                        type="text" inputMode="decimal" maskType="DECIMAL"
                        aria-label={`Humedad de ${area.nombre} en ${franja.label}`}
                        value={hum} onChange={(e) => setHum(e.target.value)}
                        inputClassName="tabular-nums text-center px-1"
                    />
                )}
                {/* El botón aparece recién cuando hay algo escrito: una fila de
                    seis botones de confirmar siempre visibles es ruido, y el
                    vacío se lee como «acá no hay nada que hacer». */}
                {String(temp).trim() && (
                    <Button variant="primary" size="sm" iconOnly icon={Check}
                        title="Anotar" onClick={guardar} loading={guardando} />
                )}
            </div>
            {franja.estado === 'vencida' && !String(temp).trim() && (
                <p className="text-micro font-bold text-danger-text">se pasó la hora</p>
            )}
            {error && <p className="text-micro font-bold text-danger-text">{error}</p>}
        </td>
    );
}

/** La limpieza de un área: un chip por turno, y el chip se toca para anotarlo. */
function CeldaLimpieza({ area, fecha, puedeAnotar, cerrado, onRecargar, onDetalle }) {
    const [ocupado, setOcupado] = useState(null);
    const turnos = area.limpiezas || [];
    if (!turnos.length) return <td className="px-3 py-2 text-content-3 opacity-40">·</td>;

    const puntos = area.puntos || [];

    const registrar = async (turno) => {
        // Con dos o más muebles hay algo que elegir, y eso vive en el diálogo.
        // Con uno o ninguno, el chip ES la respuesta: se anota de una.
        if (puntos.length > 1) { onDetalle(area, turno); return; }
        setOcupado(turno.clave);
        const { error } = await registrarLimpieza({
            areaId: area.id, fecha, turno: turno.clave,
            puntos: puntos.map(p => ({ clave: p.clave, hecho: true })),
        });
        setOcupado(null);
        if (!error) onRecargar?.();
    };

    return (
        <td className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
                {turnos.map(t => {
                    const r = t.registro;
                    if (r) {
                        // Quién y a qué hora, a la vista y no en un `title`: es
                        // el «atribuible» y el «contemporáneo» del RTS 6.1.14, y
                        // un dato que sólo aparece al pasar el mouse no existe
                        // para quien mira la pantalla desde el mostrador.
                        return (
                            <span key={t.clave} className="inline-flex flex-col">
                                <span className="inline-flex items-center gap-1 text-label font-bold text-content-2">
                                    <Check size={12} className="text-success-text" />
                                    {t.label}
                                    <ResumenDePuntos registro={r} />
                                </span>
                                <span className="text-micro text-content-3 pl-4 truncate">
                                    {(r.realizada_por_nombre || '').split(' ')[0]}
                                    {' '}<span className="tabular-nums">{horaDe(r.registrado_at)}</span>
                                    {r.tarde && <span className="text-warning-text font-bold"> · tarde</span>}
                                </span>
                            </span>
                        );
                    }
                    if (!puedeAnotar || cerrado || t.estado === 'proxima') {
                        return (
                            <Badge key={t.clave} variant="neutral" size="sm" uppercase={false}>
                                {t.label} {t.estado === 'proxima' ? hhmm(t.desde) : '—'}
                            </Badge>
                        );
                    }
                    return (
                        <Button key={t.clave} size="sm" icon={Sparkles}
                            variant={t.estado === 'vencida' ? 'secondary' : 'primary'}
                            loading={ocupado === t.clave}
                            onClick={() => registrar(t)}>
                            {t.label}
                        </Button>
                    );
                })}
            </div>
        </td>
    );
}

export default function MatrizDelDia({
    dia, areas, momentos, puedeAnotar, cerrado, onRecargar,
    onCorregir, onFueraDeRango, onDetalleLimpieza, onRonda, pendientes,
}) {
    const conLecturas = areas.filter(a => !soloLimpieza(a));
    const soloLimp = areas.filter(a => soloLimpieza(a));

    const fila = useCallback((area) => (
        <tr key={area.id} className="border-t border-border-card">
            <td className="px-3 py-2 min-w-[190px]">
                <div className="flex items-center gap-2">
                    <span className="grid place-items-center size-7 rounded-btn bg-brand/10 text-brand-text shrink-0">
                        {React.createElement(ICONO_AREA[area.tipo] || Thermometer, { size: 14 })}
                    </span>
                    <span className="min-w-0">
                        <b className="block text-body-sm font-bold text-content-1 truncate">{area.nombre}</b>
                        <span className="block text-micro text-content-3 truncate">
                            {soloLimpieza(area) ? 'sólo limpieza' : rotularRango(area)}
                            {area.calibracion_vencida && ' · calibración vencida'}
                        </span>
                    </span>
                </div>
            </td>
            {!soloLimpieza(area) ? momentos.map(m => (
                <Celda key={m.clave} area={area} fecha={dia.fecha}
                    franja={(area.franjas || []).find(f => f.clave === m.clave)}
                    puedeAnotar={puedeAnotar} cerrado={cerrado} onRecargar={onRecargar}
                    onCorregir={onCorregir} onFueraDeRango={onFueraDeRango} />
            )) : (
                <td colSpan={momentos.length} className="px-3 py-2 text-label text-content-3">
                    No lleva temperatura
                </td>
            )}
            <CeldaLimpieza area={area} fecha={dia.fecha} puedeAnotar={puedeAnotar}
                cerrado={cerrado} onRecargar={onRecargar} onDetalle={onDetalleLimpieza} />
        </tr>
    ), [dia.fecha, momentos, puedeAnotar, cerrado, onRecargar, onCorregir, onFueraDeRango, onDetalleLimpieza]);

    return (
        <div data-surface="card" className="p-3 space-y-3">
            {puedeAnotar && !cerrado && pendientes > 1 && (
                <div className="flex justify-end">
                    <Button variant="primary" size="sm" icon={ClipboardCheck} onClick={onRonda}>
                        Pasar la ronda · {pendientes}
                    </Button>
                </div>
            )}

            {/* La tabla rueda dentro de su caja: el cuerpo de la página nunca
                se mueve de lado (§32). */}
            <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                    <thead>
                        <tr className="text-left">
                            <th className="px-3 pb-2">
                                <span className="text-label font-black uppercase tracking-widest text-content-3">Área</span>
                            </th>
                            {momentos.map(m => (
                                <th key={m.clave} className={`px-3 pb-2 ${m.ahora ? 'bg-warning/10' : ''}`}>
                                    <span className="block text-body-sm font-black text-content">{m.label}</span>
                                    <span className="block text-micro text-content-3 tabular-nums">
                                        {hhmm(m.desde)}–{hhmm(m.hasta)}
                                    </span>
                                </th>
                            ))}
                            <th className="px-3 pb-2">
                                <span className="text-label font-black uppercase tracking-widest text-content-3">Limpieza</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {conLecturas.map(fila)}
                        {soloLimp.map(fila)}
                    </tbody>
                </table>
            </div>

            {cerrado && (
                <Notice variant="info" compact icon={AlertTriangle}>
                    Este mes ya está cerrado y firmado. Para anotar o corregir hay que reabrirlo
                    desde Cierre de mes, y esa reapertura queda registrada.
                </Notice>
            )}

            <p className="text-micro text-content-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1"><Check size={11} className="text-success-text" /> anotado</span>
                <span className="inline-flex items-center gap-1"><Clock size={11} className="text-warning-text" /> toca ahora</span>
                <span>— se pasó la hora</span>
                <span>· no lleva ese momento</span>
            </p>
        </div>
    );
}
