import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Droplets, MessageSquarePlus, Sparkles, Thermometer } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import { fueraDeRango, registrarRonda, rotularRango } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Pasar la ronda — la vuelta entera en una pantalla.
//
// ── De dónde salió ─────────────────────────────────────────────────────────
// De medir cómo se llenaba, no de suponerlo. Sobre los 576 registros de las
// primeras nueve jornadas: **394 (68%) se anotaron a menos de tres minutos del
// anterior**, con 29 segundos de promedio, y 55 vueltas juntaron cinco o seis
// registros seguidos. La sala camina con el termohigrómetro y anota todo de un
// tirón; el portal la obligaba a abrir y cerrar un diálogo por casilla —trece
// al día— y cada apertura es una oportunidad de que suene el teléfono y la
// vuelta quede a medias.
//
// ── El orden de la pantalla es el orden de la CAMINATA ─────────────────────
// Se agrupa por área —sala de ventas, bodega, refrigerador, vitrinas, baño— y
// no por tipo de registro, porque quien la llena está parado frente a un
// termómetro concreto. Una lista con «todas las temperaturas» arriba y «todas
// las limpiezas» abajo obliga a recorrer la sala dos veces.
//
// ── Lo que se deja en blanco NO se manda ───────────────────────────────────
// La ronda no es un formulario que haya que completar: es la lista de lo que se
// puede anotar ahora. Si el refrigerador está en la bodega de al lado y todavía
// no se pasó por ahí, ese renglón queda vacío y sigue pendiente en la grilla.
// Un formulario que exige todo lo abierto enseñaría a inventar el que falta,
// que es exactamente lo que un registro no puede tener.
// ═══════════════════════════════════════════════════════════════════════════

const hhmm = (t) => String(t || '').slice(0, 5);

/** Un renglón de lectura: la franja con sus dos campos. */
function RenglonLectura({ item, valor, onCambio, errorServidor }) {
    const { area, bloque } = item;
    const fuera = fueraDeRango(area, valor.temp);
    const faltaAccion = fuera && !String(valor.accion || '').trim();

    return (
        <div data-surface="card" data-tono={errorServidor ? 'danger' : undefined} className="p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Thermometer size={14} className="text-content-3 shrink-0" />
                <p className="text-body-sm font-bold text-content-1">{bloque.label}</p>
                <span className="text-label text-content-3 tabular-nums">
                    {hhmm(bloque.desde)}–{hhmm(bloque.hasta)}
                </span>
                <Badge variant="chart-1" size="sm" uppercase={false}>{rotularRango(area)}</Badge>
                {bloque.estado === 'vencida' && (
                    <Badge variant="warning" size="sm" uppercase={false} icon={Clock}>Se pasó la hora</Badge>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* `alto`: el campo se llena DE PIE y con una mano, mirando el
                    aparato y no la pantalla. Y `type="text"` con máscara
                    DECIMAL, nunca `type="number"`: el campo nativo se traga la
                    coma sin avisar y «24,9» entraba como 249 °C. */}
                <PortalInput
                    label="Temperatura (°C)" name={`temp-${item.clave}`} type="text" inputMode="decimal"
                    maskType="DECIMAL" icon={Thermometer} alto
                    value={valor.temp || ''} onChange={(e) => onCambio({ temp: e.target.value })}
                    placeholder="0.0" inputClassName="tabular-nums" hasError={fuera}
                />
                {area.mide_humedad && (
                    <PortalInput
                        label="Humedad (% HR)" name={`hum-${item.clave}`} type="text" inputMode="decimal"
                        maskType="DECIMAL" icon={Droplets} alto
                        value={valor.hum || ''} onChange={(e) => onCambio({ hum: e.target.value })}
                        placeholder="—" inputClassName="tabular-nums" helperText="Informativa"
                    />
                )}
            </div>

            {fuera && (
                <>
                    <Notice variant="danger" compact icon={AlertTriangle}>
                        <span className="font-bold">Fuera del rango de {rotularRango(area)}.</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Hay que anotar qué se hizo: una lectura fuera de rango sin acción al lado
                            prueba que se vio y no se actuó.
                        </span>
                    </Notice>
                    <PortalTextarea
                        label="Qué se hizo" name={`accion-${item.clave}`} required rows={2}
                        value={valor.accion || ''} onChange={(e) => onCambio({ accion: e.target.value })}
                        placeholder="Se encendió el aire acondicionado y se bajó la persiana. Recontrolado a las 13:40 en 28.1 °C."
                    />
                    {faltaAccion && (
                        <p className="text-label text-danger-text font-bold">
                            Sin esto, este renglón no se va a guardar.
                        </p>
                    )}
                </>
            )}

            {errorServidor && (
                <p className="text-label text-danger-text font-bold flex items-start gap-1.5">
                    <AlertTriangle size={13} className="shrink-0 mt-px" /> {errorServidor}
                </p>
            )}
        </div>
    );
}

/** Un renglón de limpieza: una casilla, y la observación sólo si hace falta. */
function RenglonLimpieza({ item, valor, onCambio, errorServidor }) {
    const { bloque } = item;
    const [conNota, setConNota] = useState(false);

    return (
        <div data-surface="card" data-tono={errorServidor ? 'danger' : undefined} className="p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox
                    name={`limpieza-${item.clave}`}
                    checked={Boolean(valor.marcada)}
                    onChange={(marcada) => onCambio({ marcada })}
                    label={
                        <span className="flex flex-wrap items-center gap-2">
                            <Sparkles size={13} className="text-content-3 shrink-0" />
                            <span className="font-bold">{bloque.label}</span>
                            <span className="text-label text-content-3 tabular-nums font-normal">
                                {hhmm(bloque.desde)}–{hhmm(bloque.hasta)}
                            </span>
                            {bloque.estado === 'vencida' && (
                                <Badge variant="warning" size="sm" uppercase={false}>Se pasó la hora</Badge>
                            )}
                        </span>
                    }
                />
                {valor.marcada && !conNota && (
                    <Button variant="ghost" size="sm" icon={MessageSquarePlus} onClick={() => setConNota(true)}>
                        Anotar algo
                    </Button>
                )}
            </div>

            {/* La observación es opcional a propósito: la norma pide el registro
                de la limpieza, no su descripción, y un campo obligatorio que no
                aporta produce «ok» ciento veinte veces — el ruido que hace
                ilegible un libro. Por eso está escondida hasta que hace falta. */}
            {valor.marcada && conNota && (
                <PortalTextarea
                    label="Observaciones (opcional)" name={`obs-${item.clave}`} rows={2}
                    value={valor.obs || ''} onChange={(e) => onCambio({ obs: e.target.value })}
                    placeholder="Sólo si hay algo que anotar: una gotera, una vitrina que hubo que reacomodar…"
                />
            )}

            {errorServidor && (
                <p className="text-label text-danger-text font-bold flex items-start gap-1.5">
                    <AlertTriangle size={13} className="shrink-0 mt-px" /> {errorServidor}
                </p>
            )}
        </div>
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

    // Agrupado por ÁREA y en el orden en que vienen: es el orden de la caminata.
    const porArea = useMemo(() => {
        const mapa = new Map();
        for (const it of pendientes) {
            const arr = mapa.get(it.area.id) || { area: it.area, items: [] };
            arr.items.push(it);
            mapa.set(it.area.id, arr);
        }
        return [...mapa.values()];
    }, [pendientes]);

    // Lo que se va a mandar. Un renglón vacío no viaja: la ronda es lo que se
    // pudo anotar en esta vuelta, no una lista para completar.
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
                salida.push({
                    clave: it.clave, tipo: 'limpieza', area_id: it.area.id, fecha,
                    turno: it.bloque.clave,
                    observaciones: String(v.obs || '').trim() || null,
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
            maxWidth="max-w-2xl" ariaLabel="Pasar la ronda">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Pasar la ronda</h3>
                    <p className="text-caption text-content-3">
                        Todo lo que se puede anotar ahora. Lo que dejes en blanco queda pendiente.
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-5">
                {Object.keys(errores).length > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <span className="font-bold">Quedaron renglones sin guardar.</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Lo demás ya está anotado. Acá abajo está el motivo de cada uno.
                        </span>
                    </Notice>
                )}

                {porArea.map(({ area, items: filas }) => (
                    <section key={area.id} className="space-y-2">
                        <h4 className="text-label font-black uppercase tracking-widest text-content-3">
                            {area.nombre}
                        </h4>
                        {filas.map(it => (
                            it.tipo === 'lectura' ? (
                                <RenglonLectura key={it.clave} item={it}
                                    valor={valores[it.clave] || {}}
                                    onCambio={(p) => cambiar(it.clave, p)}
                                    errorServidor={errores[it.clave]} />
                            ) : (
                                <RenglonLimpieza key={it.clave} item={it}
                                    valor={valores[it.clave] || {}}
                                    onCambio={(p) => cambiar(it.clave, p)}
                                    errorServidor={errores[it.clave]} />
                            )
                        ))}
                    </section>
                ))}

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={cerrar} disabled={guardando}>
                    {huboCambio ? 'Listo' : 'Cancelar'}
                </Button>
                <Button variant="primary" icon={Check} onClick={guardar} loading={guardando}
                    disabled={!items.length || incompletos.length > 0}>
                    {items.length ? `Anotar ${items.length} registro${items.length > 1 ? 's' : ''}` : 'Anotar'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
