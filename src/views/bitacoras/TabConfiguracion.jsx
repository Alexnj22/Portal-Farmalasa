import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Droplets, LayoutPanelTop, Plus, Snowflake, Sparkles, Store, Thermometer, Toilet, Warehouse } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import Switch from '../../components/common/Switch';
import LiquidSelect from '../../components/common/LiquidSelect';
import EditorDeHorarios from '../../components/bitacoras/EditorDeHorarios';
import { LoadingState } from '../../components/common/StateViews';
import { PLANTILLA_AREA, TIPO_AREA, areaNueva, crearArea, fetchAreas, guardarArea, rotularRango, soloLimpieza } from '../../data/bitacoras';
import { useStaffStore as useStaff } from '../../store/staffStore';

// ═══════════════════════════════════════════════════════════════════════════
// Configuración de las áreas.
//
// Lo que se toca acá reescribe qué se le va a exigir a la sala TODOS los días,
// y de rebote cambia el número que el regente firma al cerrar el mes. Por eso
// tiene permiso propio (`bitacoras_configurar`) y por eso cada campo dice qué
// consecuencia tiene, en vez de ser una lista de casillas.
//
// ── Los horarios SÍ se editan, desde el 2026-08-25 ────────────────────────
// Pedido del usuario: «permite modificar los horarios por sucursal, para
// limpieza y servicios sanitarios (que lo puedan modificar los jefes)». A qué
// hora se barre no lo dice ninguna norma, lo dice el local.
//
// Lo que hay que saber al tocarlos: la grilla del día y el mes impreso se
// arman con la configuración de HOY, así que cambiar un horario también cambia
// cómo se ven los días ya pasados de este mes. Lo que NO cambia es el resumen
// que el regente firmó: el cierre lo congela. Por eso el editor lo dice en
// pantalla en vez de esconderlo — la alternativa (versionar cada franja por
// fecha) es otra decisión, más grande, y mientras tanto no tener el editor
// obligaba a pedirle a Gerencia que cambiara la hora de barrer.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO = {
    sala_ventas: Store, bodega: Warehouse, refrigerador: Snowflake,
    vitrinas: LayoutPanelTop, servicio_sanitario: Toilet,
};

const hhmm = (t) => String(t || '').slice(0, 5);

function Area({ area, puedeEditar, onGuardado }) {
    const Icono = ICONO[area.tipo] || Thermometer;
    // Un área que sólo se limpia no tiene termómetro que identificar ni
    // certificado que vencer. Ofrecerle esos dos campos invita a llenarlos con
    // cualquier cosa, y un «calibrado hasta» inventado en el baño ensucia el
    // aviso de calibración vencida, que es un ítem CRÍTICO.
    const sinTemperatura = soloLimpieza(area);
    const [activa, setActiva] = useState(area.activa);
    const [instrumento, setInstrumento] = useState(area.instrumento || '');
    const [calibrado, setCalibrado] = useState(area.calibrado_hasta || '');
    const [franjas, setFranjas] = useState(() => area.franjas || []);
    const [limpiezas, setLimpiezas] = useState(() => area.limpiezas || []);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    const [ok, setOk] = useState(false);

    // Los horarios se comparan por su JSON: son listas cortas y el orden importa
    // (es el orden en que se pintan), así que una comparación campo por campo
    // sería la misma cuenta escrita más larga.
    const horariosSucios = JSON.stringify(franjas) !== JSON.stringify(area.franjas || [])
        || JSON.stringify(limpiezas) !== JSON.stringify(area.limpiezas || []);
    const sucio = activa !== area.activa
        || instrumento !== (area.instrumento || '')
        || calibrado !== (area.calibrado_hasta || '')
        || horariosSucios;

    // El CHECK de la base lo dice también, pero acá se puede decir con palabras:
    // un área encendida sin nada que registrar no tiene sentido, y el error de
    // Postgres («viola la restricción bitacora_areas_con_algo_que_registrar»)
    // no le explica nada a nadie.
    const sinNadaQueRegistrar = activa && franjas.length === 0 && limpiezas.length === 0;

    const guardar = useCallback(async () => {
        setGuardando(true); setError(null); setOk(false);
        const { error: err } = await guardarArea(area.id, {
            activa,
            instrumento: instrumento.trim() || null,
            calibrado_hasta: calibrado || null,
            franjas,
            limpiezas,
        });
        setGuardando(false);
        if (err) { setError(err); return; }
        // Esto reescribe qué se le exige a la sala todos los días y, de rebote,
        // el número que el regente firma al cerrar el mes. Tiene permiso propio
        // (`bitacoras_configurar`) y no dejaba rastro de quién lo cambió — que
        // es exactamente lo que una bitácora regulada tiene que poder mostrar.
        useStaff.getState().appendAuditLog('CONFIGURAR_AREA_BITACORA', String(area.id), {
            area: area.nombre ?? null, activa,
            instrumento: instrumento.trim() || null, calibrado_hasta: calibrado || null,
            // Los horarios entran en la bitácora de auditoría enteros: son
            // exactamente lo que decide qué se le va a exigir a la sala, y un
            // «se cambió la configuración» sin decir a qué no sirve de nada.
            franjas, limpiezas,
        });
        setOk(true);
        onGuardado?.();
    }, [area.id, area.nombre, activa, instrumento, calibrado, franjas, limpiezas, onGuardado]);

    const vencida = area.calibrado_hasta && area.calibrado_hasta < new Date().toISOString().slice(0, 10);

    return (
        <section data-surface="card" data-tono={sucio ? 'warning' : undefined} className="p-4 space-y-3">
            <header className="flex flex-wrap items-center gap-2">
                <span className="grid place-items-center size-8 rounded-btn bg-brand/10 text-brand-text shrink-0">
                    <Icono size={16} />
                </span>
                <h4 className="text-body font-black text-content">{area.nombre}</h4>
                <Badge variant="neutral" size="sm" uppercase={false}>{TIPO_AREA[area.tipo] || area.tipo}</Badge>
                {sinTemperatura ? (
                    <Badge variant="chart-3" size="sm" uppercase={false} icon={Sparkles}>sólo limpieza</Badge>
                ) : (
                    <>
                        <Badge variant="chart-1" size="sm" uppercase={false}>{rotularRango(area)}</Badge>
                        {area.mide_humedad && (
                            <Badge variant="neutral" size="sm" uppercase={false} icon={Droplets}>humedad</Badge>
                        )}
                        {vencida && <Badge variant="danger" size="sm" uppercase={false}>Calibración vencida</Badge>}
                    </>
                )}
            </header>

            {!puedeEditar && (
                <div className="flex flex-wrap gap-2">
                    {(area.franjas || []).map(f => (
                        <Badge key={f.clave} variant="chart-1" size="sm" uppercase={false}>
                            {f.label} {hhmm(f.desde)}–{hhmm(f.hasta)}
                        </Badge>
                    ))}
                    {(area.limpiezas || []).map(t => (
                        <Badge key={t.clave} variant="chart-3" size="sm" uppercase={false}>
                            Limpieza {t.label} {hhmm(t.desde)}–{hhmm(t.hasta)}
                        </Badge>
                    ))}
                </div>
            )}

            <p className="text-label text-content-3">
                Lleva bitácora desde el {area.vigente_desde}. Los días anteriores no cuentan como faltantes.
            </p>

            {puedeEditar ? (
                <>
                    {!sinTemperatura && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <PortalInput
                                label="Instrumento" name={`inst-${area.id}`} icon={Thermometer}
                                value={instrumento} onChange={(e) => setInstrumento(e.target.value)}
                                placeholder="Termohigrómetro TH-01"
                                helperText="Cómo se identifica el aparato de esta área"
                            />
                            <div>
                                <p className="text-label font-bold uppercase tracking-widest text-content-3 mb-1.5">
                                    Calibrado hasta
                                </p>
                                <LiquidDatePicker value={calibrado} onChange={(v) => setCalibrado(v || '')} />
                                <p className="text-label text-content-3 mt-1">
                                    Un certificado vencido invalida las lecturas
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Los horarios. Sólo se ofrecen las lecturas cuando el
                        área mide temperatura: un baño con «franja de mañana»
                        pediría una lectura que no existe. */}
                    {!sinTemperatura && (
                        <EditorDeHorarios tipo="franjas" filas={franjas} onCambiar={setFranjas} />
                    )}
                    <EditorDeHorarios tipo="limpiezas" filas={limpiezas} onCambiar={setLimpiezas} />

                    {horariosSucios && (
                        <Notice variant="warning" compact>
                            <span className="font-bold">El horario nuevo rige también para los días
                            de este mes que ya pasaron.</span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                La grilla y el mes impreso se arman con la configuración de hoy. Lo
                                ya anotado no se toca, y el resumen de un mes cerrado y firmado
                                tampoco: ése queda congelado.
                            </span>
                        </Notice>
                    )}

                    {sinNadaQueRegistrar && (
                        <Notice variant="danger" compact icon={AlertTriangle}>
                            Un área encendida necesita al menos un horario. Agrega uno o apaga el área.
                        </Notice>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <Switch
                            checked={activa}
                            onChange={setActiva}
                            label={activa ? 'El área lleva bitácora' : 'Área apagada — no se le pide nada'}
                        />
                        {sucio && (
                            <Button variant="primary" size="sm" icon={Check} onClick={guardar}
                                loading={guardando} disabled={sinNadaQueRegistrar}>
                                Guardar
                            </Button>
                        )}
                    </div>

                    {!activa && area.activa && (
                        <Notice variant="warning" compact>
                            Al apagarla deja de pedir {sinTemperatura ? 'registros' : 'lecturas'} desde
                            hoy. Lo ya anotado no se toca.
                        </Notice>
                    )}
                    {ok && !sucio && <Notice variant="success" compact>Guardado.</Notice>}
                    {error && <Notice variant="danger" compact icon={AlertTriangle}>{error}</Notice>}
                </>
            ) : !sinTemperatura && (
                <p className="text-label text-content-3">
                    {area.instrumento || 'Sin instrumento identificado'}
                    {area.calibrado_hasta ? ` · calibrado hasta ${area.calibrado_hasta}` : ' · sin fecha de calibración'}
                </p>
            )}
        </section>
    );
}

/**
 * Agregar un área que esta sucursal todavía no lleva.
 *
 * Nació de una pregunta del usuario que no tenía respuesta: «¿cómo activo un
 * refrigerador en una sucursal?». No se podía — el refrigerador existía sólo
 * en la bodega central porque lo había puesto la semilla, y abrir uno en una
 * sala exigía tocar la base a mano. El RTS 6.2.18 lo pide en todo
 * establecimiento que conserve medicamentos que lo requieran, así que abrirlo
 * tiene que ser una decisión de sala, no una migración.
 *
 * Los horarios del área nueva se COPIAN de las de esa misma sucursal (ver
 * `areaNueva`): la bodega central abre a las 08:00 y cierra a las 17:00, y un
 * refrigerador creado ahí con el horario de las farmacias pediría una lectura
 * de tarde que nadie puede tomar.
 */
function AgregarArea({ branchId, areas, onCreada }) {
    const [tipo, setTipo] = useState('');
    const [nombre, setNombre] = useState('');
    const [creando, setCreando] = useState(false);
    const [error, setError] = useState(null);

    // Sólo los tipos que faltan: la base tiene UNIQUE (sucursal, tipo, nombre),
    // así que ofrecer uno repetido termina en un error de Postgres en vez de en
    // un aviso. Un segundo refrigerador se agrega escribiéndole otro nombre.
    const disponibles = useMemo(() => {
        const usados = new Set(areas.map(a => `${a.tipo}|${a.nombre}`));
        return Object.entries(PLANTILLA_AREA)
            .filter(([t, p]) => !usados.has(`${t}|${p.nombre}`))
            .map(([t]) => ({ value: t, label: TIPO_AREA[t] || t }));
    }, [areas]);

    const crear = useCallback(async () => {
        if (!tipo) return;
        setCreando(true); setError(null);
        const base = areaNueva(tipo, branchId, areas);
        if (nombre.trim()) base.nombre = nombre.trim();
        const { id, error: err } = await crearArea(base);
        setCreando(false);
        if (err) { setError(err); return; }
        useStaff.getState().appendAuditLog('CREAR_AREA_BITACORA', String(id ?? ''), {
            sucursal: branchId, tipo, nombre: base.nombre,
        });
        setTipo(''); setNombre('');
        onCreada?.();
    }, [tipo, nombre, branchId, areas, onCreada]);

    if (!disponibles.length) return null;

    return (
        <section data-surface="card" className="p-4 space-y-3">
            <h4 className="text-body font-black text-content flex items-center gap-2">
                <Plus size={16} /> Agregar un área
            </h4>
            <p className="text-label text-content-3">
                Nace encendida y con los horarios de las áreas que esta sucursal ya lleva. El
                refrigerador arranca en 2 a 8 °C, que es lo que exige el reglamento para la
                cadena de frío.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3">
                <div className="space-y-1.5">
                    <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                        Qué área
                    </p>
                    <LiquidSelect value={tipo} onChange={setTipo} options={disponibles}
                        placeholder="Elegir…" />
                </div>
                <PortalInput
                    label="Cómo se llama" name="nombre-area-nueva"
                    value={nombre} onChange={(e) => setNombre(e.target.value)}
                    placeholder={tipo ? PLANTILLA_AREA[tipo]?.nombre : 'Opcional'}
                    helperText="opcional"
                />
                <Button variant="primary" icon={Plus} onClick={crear} loading={creando} disabled={!tipo}>
                    Agregar
                </Button>
            </div>
            {error && <Notice variant="danger" compact icon={AlertTriangle}>{error}</Notice>}
        </section>
    );
}

export default function TabConfiguracion({ branchId, sucursalNombre, puedeEditar, onCambio }) {
    const [areas, setAreas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);

    const cargar = useCallback(async () => {
        if (!branchId) return;
        setCargando(true);
        const { areas: a, error: e } = await fetchAreas(branchId);
        setAreas(a);
        setError(e);
        setCargando(false);
    }, [branchId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de sala
    useEffect(() => { cargar(); }, [cargar]);

    const alGuardar = useCallback(() => { cargar(); onCambio?.(); }, [cargar, onCambio]);

    if (cargando) return <LoadingState label="Cargando la configuración…" />;
    if (error) return <Notice variant="danger" icon={AlertTriangle}>{error.message || 'No se pudo cargar.'}</Notice>;

    return (
        <div className="space-y-4">
            <Notice variant="info">
                <span className="font-bold">El reglamento exige un instrumento independiente por área.</span>
                <span className="block mt-0.5 font-normal text-content-2">
                    Uno para la sala de ventas y otro para la bodega, cada uno con certificado de
                    calibración vigente. Si una sala es un solo ambiente, apaga el área que no existe:
                    así deja de contar como faltante al cerrar el mes.
                </span>
                <span className="block mt-1.5 font-normal text-content-2">
                    Las vitrinas y el servicio sanitario son áreas de <strong>sólo limpieza</strong>: no
                    llevan temperatura ni instrumento, pero sí su propio registro y su propio
                    cumplimiento. Si esta sucursal no tiene alguna, apágala igual que las demás.
                </span>
            </Notice>

            {areas.map(a => (
                <Area key={a.id} area={a} puedeEditar={puedeEditar} onGuardado={alGuardar} />
            ))}

            {!areas.length && (
                <Notice variant="warning" icon={AlertTriangle}>
                    {sucursalNombre} no tiene áreas configuradas.
                </Notice>
            )}

            {puedeEditar && branchId && (
                <AgregarArea branchId={branchId} areas={areas} onCreada={alGuardar} />
            )}
        </div>
    );
}
