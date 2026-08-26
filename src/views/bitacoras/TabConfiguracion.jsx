import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Droplets, LayoutPanelTop, Plus, Snowflake, Sparkles, Store, Thermometer, Toilet, Warehouse } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import Switch from '../../components/common/Switch';
import LiquidSelect from '../../components/common/LiquidSelect';
import EditorDeHorarios from '../../components/bitacoras/EditorDeHorarios';
import PuntosDeLimpieza from '../../components/bitacoras/PuntosDeLimpieza';
import { LoadingState } from '../../components/common/StateViews';
import { PLANTILLA_AREA, TIPO_AREA, aplicarHorarios, areaNueva, crearArea, fetchAreas, guardarArea, rangoDeLaSucursal, rotularRango, soloLimpieza } from '../../data/bitacoras';
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

/** «07:00» → «7:00 AM», para decir el horario en el texto de ayuda. */
const rotularHora12 = (hm) => {
    const [h, m] = String(hm || '').split(':').map(Number);
    if (Number.isNaN(h)) return '';
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/**
 * Un año después de una fecha, sin que el huso la mueva.
 *
 * Es la vigencia habitual de un certificado de calibración: se PROPONE y se
 * puede corregir. Proponerla no es inventar el dato — el campo queda a la vista
 * y editable—; no proponerla obliga a hacer la cuenta de cabeza, que es donde
 * aparece el «2027» escrito sobre un certificado de 2026.
 */
const unAnoDespues = (fecha) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
};

function Area({ area, puedeEditar, onGuardado }) {
    const Icono = ICONO[area.tipo] || Thermometer;
    // Un área que sólo se limpia no tiene termómetro que identificar ni
    // certificado que vencer. Ofrecerle esos dos campos invita a llenarlos con
    // cualquier cosa, y un «calibrado hasta» inventado en el baño ensucia el
    // aviso de calibración vencida, que es un ítem CRÍTICO.
    const sinTemperatura = soloLimpieza(area);
    const esRefrigerador = area.tipo === 'refrigerador';
    const [activa, setActiva] = useState(area.activa);
    const [instrumento, setInstrumento] = useState(area.instrumento || '');
    const [calibrado, setCalibrado] = useState(area.calibrado_hasta || '');
    const [calibradoEl, setCalibradoEl] = useState(area.calibrado_el || '');
    const [puntos, setPuntos] = useState(() => area.puntos || []);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    const [ok, setOk] = useState(false);

    const puntosSucios = JSON.stringify(puntos) !== JSON.stringify(area.puntos || []);
    const sucio = activa !== area.activa
        || instrumento !== (area.instrumento || '')
        || calibrado !== (area.calibrado_hasta || '')
        || calibradoEl !== (area.calibrado_el || '')
        || puntosSucios;


    const guardar = useCallback(async () => {
        setGuardando(true); setError(null); setOk(false);
        const { error: err } = await guardarArea(area.id, {
            activa,
            instrumento: instrumento.trim() || null,
            calibrado_hasta: calibrado || null,
            calibrado_el: calibradoEl || null,
            puntos,
        });
        setGuardando(false);
        if (err) { setError(err); return; }
        // Esto reescribe qué se le exige a la sala todos los días y, de rebote,
        // el número que el regente firma al cerrar el mes. Tiene permiso propio
        // (`bitacoras_configurar`) y no dejaba rastro de quién lo cambió — que
        // es exactamente lo que una bitácora regulada tiene que poder mostrar.
        useStaff.getState().appendAuditLog('CONFIGURAR_AREA_BITACORA', String(area.id), {
            area: area.nombre ?? null, activa,
            instrumento: instrumento.trim() || null,
            calibrado_hasta: calibrado || null, calibrado_el: calibradoEl || null,
            puntos,
        });
        setOk(true);
        onGuardado?.();
    }, [area.id, area.nombre, activa, instrumento, calibrado, calibradoEl, puntos, onGuardado]);

    const vencida = area.calibrado_hasta && area.calibrado_hasta < new Date().toISOString().slice(0, 10);

    return (
        <section data-surface="card" data-tono={sucio ? 'warning' : undefined} className="p-4 space-y-3">
            <header className="flex flex-wrap items-center gap-2">
                <span className="grid place-items-center size-8 rounded-btn bg-brand/10 text-brand-text shrink-0">
                    <Icono size={16} />
                </span>
                <h4 className="text-body font-black text-content">{area.nombre}</h4>
                {/* El tipo, sólo cuando NO repite el nombre: «Bodega · Bodega»
                    y «Sala de ventas · Sala de ventas» era la misma palabra dos
                    veces, y ocupaba el lugar del dato que sí importa (el rango). */}
                {TIPO_AREA[area.tipo] !== area.nombre && (
                    <Badge variant="neutral" size="sm" uppercase={false}>{TIPO_AREA[area.tipo] || area.tipo}</Badge>
                )}
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

            {/* Qué momentos lleva ESTA área — se muestran, no se editan: la
                hora es de la SUCURSAL y se cambia arriba, una vez para todas. La hora no se repite acá: es la
                Repetir la hora en cada área era la mitad de la tarjeta
                diciendo lo mismo cuatro veces. */}
            <div className="flex flex-wrap gap-2">
                {(area.franjas || []).map(f => (
                    <Badge key={f.clave} variant="chart-1" size="sm" uppercase={false}>
                        {f.label}
                    </Badge>
                ))}
                {(area.limpiezas || []).length > 0 && (
                    <Badge variant="chart-3" size="sm" uppercase={false} icon={Sparkles}>
                        {(area.limpiezas || []).map(t => t.label).join(' · ')}
                    </Badge>
                )}
            </div>

            <p className="text-label text-content-3">
                Lleva bitácora desde el {area.vigente_desde}. Los días anteriores no cuentan como faltantes.
            </p>

            {puedeEditar ? (
                <>
                    {/* Las dos columnas con la MISMA anatomía —rótulo arriba,
                        control, pista abajo— y `items-start`: antes una era un
                        `PortalInput` (que dibuja su rótulo adentro) y la otra un
                        bloque a mano, así que los dos campos quedaban a distinta
                        altura y la pista de la derecha se metía en la sección de
                        abajo. */}
                    {/* ── Sólo el refrigerador pide instrumento y calibración ──
                        «Los termómetros digitales, que sepa, no se calibran»
                        (usuario) — y la norma lo respalda: el 5.6.14 que exige
                        certificado vigente vive en la sección 5 del RTS, que es
                        para laboratorios, droguerías y centros de
                        almacenamiento. La sección 6, la de farmacias, pide
                        calibración en un solo lugar: el refrigerador (6.2.19), y
                        la guía de la SRS tiene un único ítem de calibración,
                        el 2.32, CRÍTICO, también del refrigerador. Para el
                        ambiente sólo exige que HAYA termómetro (guía 2.13).

                        El termómetro del ambiente subió a la tarjeta de la
                        sucursal: es el mismo aparato para la sala y la bodega. */}
                    {esRefrigerador && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                            <div className="space-y-1.5 sm:col-span-2">
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                                    Termómetro
                                </p>
                                <PortalInput
                                    name={`inst-${area.id}`} icon={Thermometer}
                                    aria-label="Cómo se identifica el termómetro del refrigerador"
                                    value={instrumento} onChange={(e) => setInstrumento(e.target.value)}
                                    placeholder="Termómetro digital R-01"
                                />
                                <p className="text-label text-content-3 ml-1">
                                    El del refrigerador, que sí lleva certificado
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                                    Última calibración
                                </p>
                                <LiquidDatePicker value={calibradoEl} onChange={(v) => {
                                    setCalibradoEl(v || '');
                                    if (v && !calibrado) setCalibrado(unAnoDespues(v));
                                }} />
                                <p className="text-label text-content-3 ml-1">
                                    La fecha del certificado
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                                    Vence
                                </p>
                                <LiquidDatePicker value={calibrado} onChange={(v) => setCalibrado(v || '')} />
                                <p className="text-label text-content-3 ml-1">
                                    Vencido, invalida las lecturas
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Cada área pregunta por LO SUYO: vitrinas y estantes en
                        el área de vitrinas, cuántos servicios sanitarios en el
                        baño. Así la pregunta no se repite en las cuatro
                        tarjetas —era el reclamo— y a la bodega no se le
                        pregunta por unas vitrinas que no tiene. */}
                    <PuntosDeLimpieza tipoDeArea={area.tipo} puntos={puntos} onCambiar={setPuntos} />

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border-card">
                        <Switch
                            checked={activa}
                            onChange={setActiva}
                            label={activa
                                ? 'El área lleva bitácora'
                                : 'Apagada — no cuenta como faltante'}
                        />
                        {sucio && (
                            <Button variant="primary" size="sm" icon={Check} onClick={guardar}
                                loading={guardando}>
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
 * El reloj de la sucursal: a qué hora se toma cada lectura y cada limpieza.
 *
 * ── Por qué está acá arriba y no en cada área ──────────────────────────────
 * «Las lecturas y la limpieza se hacen al mismo tiempo en ambas áreas»
 * (usuario). La persona camina UNA vez con el termohigrómetro y mira la sala y
 * la bodega en la misma pasada: no hay dos relojes. Preguntarlo por área hacía
 * la misma pregunta cuatro veces y permitía cuatro respuestas distintas para un
 * hecho que es uno solo — y dos áreas con el horario corrido parten la ronda en
 * dos.
 *
 * Lo que se comparte es la HORA. Qué momentos lleva cada área no se toca: las
 * vitrinas se limpian una vez al día y la sala dos, y unificar la lista le
 * habría duplicado la obligación a las vitrinas sin que nadie lo decidiera.
 */
function HorariosDeLaSucursal({ branchId, areas, puedeEditar, onCambio }) {
    // El horario de atención de la sucursal ya está cargado en el portal; de ahí
    // salen las horas que se pueden elegir. Ofrecer de 5 AM a 10:30 PM en todas
    // dejaba poner una lectura con el local cerrado — nadie la toma y el mes la
    // cuenta como faltante todos los días.
    const sucursal = useStaff(st => (st.branches || []).find(b => String(b.id) === String(branchId)));
    const rango = useMemo(() => rangoDeLaSucursal(sucursal), [sucursal]);
    // La unión de los momentos que hoy existen en la sucursal, con la primera
    // hora que aparece. Después de guardar, todas las áreas quedan iguales —
    // que es el punto; antes de guardar puede haber diferencias, y mostrar la
    // primera es la única respuesta honesta sin inventar una.
    const unir = useCallback((campo) => {
        const mapa = new Map();
        for (const a of areas) {
            for (const f of a[campo] || []) if (!mapa.has(f.clave)) mapa.set(f.clave, { ...f });
        }
        return [...mapa.values()];
    }, [areas]);

    const [franjas, setFranjas] = useState(() => unir('franjas'));
    const [limpiezas, setLimpiezas] = useState(() => unir('limpiezas'));
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    const [ok, setOk] = useState(false);

    const sucio = JSON.stringify(franjas) !== JSON.stringify(unir('franjas'))
        || JSON.stringify(limpiezas) !== JSON.stringify(unir('limpiezas'));

    const guardar = useCallback(async () => {
        setGuardando(true); setError(null); setOk(false);
        const { areas: tocadas, error: err } = await aplicarHorarios(branchId, franjas, limpiezas);
        setGuardando(false);
        if (err) { setError(err); return; }
        useStaff.getState().appendAuditLog('CONFIGURAR_HORARIOS_BITACORA', String(branchId), {
            sucursal: branchId, areas: tocadas, franjas, limpiezas,
        });
        setOk(true);
        onCambio?.();
    }, [branchId, franjas, limpiezas, onCambio]);

    if (!franjas.length && !limpiezas.length) return null;

    return (
        <section data-surface="card" data-tono={sucio ? 'warning' : undefined} className="p-4 space-y-3">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-body font-black text-content flex items-center gap-2">
                    <Clock size={16} /> Horarios de la sucursal
                </h4>
                {puedeEditar && sucio && (
                    <Button variant="primary" size="sm" icon={Check} onClick={guardar} loading={guardando}>
                        Guardar
                    </Button>
                )}
            </header>

            <p className="text-label text-content-3">
                Valen para todas las áreas: la vuelta se camina una sola vez.
                {rango && ` Las horas van entre las que abre y cierra la sucursal (${rotularHora12(rango.abre)} a ${rotularHora12(rango.cierra)}).`}
            </p>


            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <EditorDeHorarios tipo="franjas" filas={franjas} rango={rango}
                    onCambiar={puedeEditar ? setFranjas : undefined} />
                <EditorDeHorarios tipo="limpiezas" filas={limpiezas} rango={rango}
                    onCambiar={puedeEditar ? setLimpiezas : undefined} />
            </div>

            {sucio && (
                <Notice variant="warning" compact>
                    <span className="font-bold">El horario nuevo rige también para los días de este
                    mes que ya pasaron.</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        La grilla y el mes impreso se arman con la configuración de hoy. Lo ya
                        anotado no se toca, y el resumen de un mes cerrado y firmado tampoco.
                    </span>
                </Notice>
            )}
            {ok && !sucio && <Notice variant="success" compact>Guardado en todas las áreas.</Notice>}
            {error && <Notice variant="danger" compact icon={AlertTriangle}>{error}</Notice>}
        </section>
    );
}

/**
 * ¿Esta sucursal guarda medicamentos en refrigerador?
 *
 * ── Por qué es un interruptor y no un «área» ───────────────────────────────
 * Corregido por el usuario: «el refrigerador no es un área, significa que se
 * tienen medicamentos ahí, y se lleva control de temperatura y calibración de
 * ese. debe ser un selector no una nueva área, al activarlo pregunta la última
 * calibración».
 *
 * Y es exacto: la sala de ventas y la bodega son lugares del local —están o no
 * están—, mientras que el refrigerador es una PREGUNTA de sí o no cuya
 * respuesta enciende dos obligaciones. El RTS lo dice así: 6.2.18 pide
 * refrigerador de uso exclusivo cuando hay medicamentos que lo requieren,
 * 6.2.19 exige que tenga termómetro CALIBRADO, y 6.2.20 pide registro dos veces
 * al día entre 2 y 8 °C. Ponerlo en la misma lista que «Vitrinas» dejaba la
 * decisión sanitaria escondida detrás de un formulario de alta.
 *
 * Por debajo sigue siendo un área —las lecturas necesitan dónde vivir—, y una
 * vez encendido se configura como las demás. Lo que cambió es la puerta.
 */
function Refrigerador({ branchId, areas, puedeEditar, onCambio }) {
    const refri = areas.find(a => a.tipo === 'refrigerador');
    const activo = Boolean(refri?.activa);
    const [fecha, setFecha] = useState('');
    const [trabajando, setTrabajando] = useState(false);
    const [error, setError] = useState(null);

    const encender = useCallback(async () => {
        setTrabajando(true); setError(null);
        const datos = { activa: true, calibrado_el: fecha, calibrado_hasta: unAnoDespues(fecha) };
        // Si ya existió y se apagó, se vuelve a encender: crear otro chocaría
        // con el UNIQUE (sucursal, tipo, nombre) y, peor, dejaría las lecturas
        // viejas colgando de un área apagada.
        const { error: err } = refri
            ? await guardarArea(refri.id, datos)
            : await crearArea({ ...areaNueva('refrigerador', branchId, areas), ...datos });
        setTrabajando(false);
        if (err) { setError(err); return; }
        useStaff.getState().appendAuditLog('CONFIGURAR_REFRIGERADOR_BITACORA',
            String(refri?.id ?? branchId), { sucursal: branchId, encendido: true, calibrado_el: fecha });
        setFecha('');
        onCambio?.();
    }, [refri, fecha, branchId, areas, onCambio]);

    const apagar = useCallback(async () => {
        if (!refri) return;
        setTrabajando(true); setError(null);
        const { error: err } = await guardarArea(refri.id, { activa: false });
        setTrabajando(false);
        if (err) { setError(err); return; }
        useStaff.getState().appendAuditLog('CONFIGURAR_REFRIGERADOR_BITACORA', String(refri.id),
            { sucursal: branchId, encendido: false });
        onCambio?.();
    }, [refri, branchId, onCambio]);

    return (
        <section data-surface="card" data-tono={activo ? 'chart-1' : undefined} className="p-4 space-y-3">
            <header className="flex flex-wrap items-center gap-2">
                <span className="grid place-items-center size-8 rounded-btn bg-brand/10 text-brand-text shrink-0">
                    <Snowflake size={16} />
                </span>
                <h4 className="text-body font-black text-content">Refrigerador con medicamentos</h4>
                {activo && <Badge variant="chart-1" size="sm" uppercase={false}>2 a 8 °C · dos lecturas al día</Badge>}
            </header>

            <p className="text-label text-content-3">
                Encendido, pide termómetro calibrado y dos lecturas al día entre 2 y 8 °C.
            </p>

            {!puedeEditar ? (
                <p className="text-body-sm font-bold text-content-2">
                    {activo ? 'Encendido.' : 'Esta sucursal no lleva refrigerador.'}
                </p>
            ) : activo ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-body-sm text-content-2">
                        <span className="font-bold text-content">Encendido.</span>{' '}
                        {refri?.calibrado_el
                            ? `Calibrado el ${refri.calibrado_el}${refri.calibrado_hasta ? `, vence el ${refri.calibrado_hasta}` : ''}.`
                            : 'Sin fecha de calibración anotada.'}
                        {' '}Su horario y su calibración se ajustan en la tarjeta del área.
                    </p>
                    <Button variant="secondary" size="sm" onClick={apagar} loading={trabajando}>
                        Apagar
                    </Button>
                </div>
            ) : (
                <div className="flex flex-wrap items-end gap-3">
                    {/* La fecha se pide ANTES de encender, no después: un
                        refrigerador encendido sin calibración anotada es
                        exactamente el hallazgo que busca el inspector, y pedirla
                        «más tarde» es cómo queda vacía para siempre. */}
                    <div className="space-y-1.5">
                        <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                            Última calibración
                        </p>
                        <LiquidDatePicker value={fecha} onChange={(v) => setFecha(v || '')} />
                    </div>
                    <Button variant="primary" size="sm" icon={Check} onClick={encender}
                        loading={trabajando} disabled={!fecha}>
                        Encender
                    </Button>
                    {!fecha && (
                        <p className="text-label text-content-3">
                            Hace falta la fecha del certificado para encenderlo.
                        </p>
                    )}
                </div>
            )}

            {error && <Notice variant="danger" compact icon={AlertTriangle}>{error}</Notice>}
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
            // El refrigerador no se agrega por acá: es un interruptor de la
            // sucursal («no es un área, significa que se tienen medicamentos
            // ahí»), y tiene su propia tarjeta arriba.
            .filter(([t, p]) => t !== 'refrigerador' && !usados.has(`${t}|${p.nombre}`))
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
                refrigerador no se agrega por aquí: tiene su propio interruptor arriba.
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

    // El refrigerador APAGADO no ocupa una tarjeta: su interruptor está arriba
    // y una tarjeta gris de un área que la sucursal no tiene es ruido.
    const visibles = useMemo(
        () => areas.filter(a => a.tipo !== 'refrigerador' || a.activa),
        [areas],
    );


    if (cargando) return <LoadingState label="Cargando la configuración…" />;
    if (error) return <Notice variant="danger" icon={AlertTriangle}>{error.message || 'No se pudo cargar.'}</Notice>;

    return (
        <div className="space-y-4">
            {/* ── El aviso largo se fue (2026-08-25) ───────────────────────
                Medido en iPhone 13: ocupaba 530px de una pantalla de 664 — más
                de la mitad del teléfono antes de ver nada configurable. Sus
                tres ideas ya estaban dichas en la pantalla o se mudaron a donde
                se usan: «un instrumento por área con certificado vigente» es
                ahora la pista del campo Instrumento, «vitrinas y baño son sólo
                limpieza» ya lo dice el badge de cada tarjeta, y lo único que no
                era obvio —que apagar un área la saca del cumplimiento— quedó
                acá y en la etiqueta del interruptor.

                Un aviso que hay que rodar para pasar de largo no se lee: se
                aprende a saltar. */}
            <p className="text-label text-content-3">
                Apaga el área que esta sucursal no tenga: deja de contar como faltante al cerrar
                el mes.
            </p>

            {/* Dos columnas desde `xl`. En una pantalla de escritorio ancha,
                una sola columna estiraba cada campo a 1.800px —un selector de
                hora del ancho de la pantalla para elegir «7:00 AM»— y obligaba
                a rodar cuatro áreas de largo. `items-start` para que una
                tarjeta corta (el baño) no se estire al alto de una larga. */}
            {branchId && areas.length > 0 && (
                <HorariosDeLaSucursal branchId={branchId} areas={areas}
                    puedeEditar={puedeEditar} onCambio={alGuardar} />
            )}

            {branchId && (
                <Refrigerador branchId={branchId} areas={areas}
                    puedeEditar={puedeEditar} onCambio={alGuardar} />
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                {visibles.map(a => (
                    <Area key={a.id} area={a} puedeEditar={puedeEditar} onGuardado={alGuardar} />
                ))}
            </div>

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
