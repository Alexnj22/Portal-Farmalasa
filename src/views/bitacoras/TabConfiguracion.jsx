import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Droplets, Snowflake, Store, Thermometer, Warehouse } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import Switch from '../../components/common/Switch';
import { LoadingState } from '../../components/common/StateViews';
import { TIPO_AREA, fetchAreas, guardarArea, rotularRango } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Configuración de las áreas.
//
// Lo que se toca acá reescribe qué se le va a exigir a la sala TODOS los días,
// y de rebote cambia el número que el regente firma al cerrar el mes. Por eso
// tiene permiso propio (`bitacoras_configurar`) y por eso cada campo dice qué
// consecuencia tiene, en vez de ser una lista de casillas.
//
// Las franjas no se editan acá todavía: cambiar el horario de una franja a
// mitad de mes reescribe hacia atrás qué se esperaba cada día, y eso necesita
// decidir primero si el cambio rige desde hoy o desde siempre. Mientras tanto
// se cambian con `vigente_desde`, que es la respuesta honesta a esa pregunta.
// ═══════════════════════════════════════════════════════════════════════════

const ICONO = { sala_ventas: Store, bodega: Warehouse, refrigerador: Snowflake };

const hhmm = (t) => String(t || '').slice(0, 5);

function Area({ area, puedeEditar, onGuardado }) {
    const Icono = ICONO[area.tipo] || Thermometer;
    const [activa, setActiva] = useState(area.activa);
    const [instrumento, setInstrumento] = useState(area.instrumento || '');
    const [calibrado, setCalibrado] = useState(area.calibrado_hasta || '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    const [ok, setOk] = useState(false);

    const sucio = activa !== area.activa
        || instrumento !== (area.instrumento || '')
        || calibrado !== (area.calibrado_hasta || '');

    const guardar = useCallback(async () => {
        setGuardando(true); setError(null); setOk(false);
        const { error: err } = await guardarArea(area.id, {
            activa,
            instrumento: instrumento.trim() || null,
            calibrado_hasta: calibrado || null,
        });
        setGuardando(false);
        if (err) { setError(err); return; }
        setOk(true);
        onGuardado?.();
    }, [area.id, activa, instrumento, calibrado, onGuardado]);

    const vencida = area.calibrado_hasta && area.calibrado_hasta < new Date().toISOString().slice(0, 10);

    return (
        <section data-surface="card" data-tono={sucio ? 'warning' : undefined} className="p-4 space-y-3">
            <header className="flex flex-wrap items-center gap-2">
                <span className="grid place-items-center size-8 rounded-btn bg-brand/10 text-brand-text shrink-0">
                    <Icono size={16} />
                </span>
                <h4 className="text-body font-black text-content">{area.nombre}</h4>
                <Badge variant="neutral" size="sm" uppercase={false}>{TIPO_AREA[area.tipo] || area.tipo}</Badge>
                <Badge variant="chart-1" size="sm" uppercase={false}>{rotularRango(area)}</Badge>
                {area.mide_humedad && (
                    <Badge variant="neutral" size="sm" uppercase={false} icon={Droplets}>humedad</Badge>
                )}
                {vencida && <Badge variant="danger" size="sm" uppercase={false}>Calibración vencida</Badge>}
            </header>

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

            <p className="text-label text-content-3">
                Lleva bitácora desde el {area.vigente_desde}. Los días anteriores no cuentan como faltantes.
            </p>

            {puedeEditar ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <PortalInput
                            label="Instrumento" name={`inst-${area.id}`} icon={Thermometer}
                            value={instrumento} onChange={(e) => setInstrumento(e.target.value)}
                            placeholder="Termohigrómetro TH-01"
                            helperText="Cómo se identifica el aparato de esta área"
                        />
                        <PortalInput
                            label="Calibrado hasta" name={`cal-${area.id}`} type="date"
                            value={calibrado} onChange={(e) => setCalibrado(e.target.value)}
                            helperText="Un certificado vencido invalida las lecturas"
                        />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <Switch
                            checked={activa}
                            onChange={setActiva}
                            label={activa ? 'El área lleva bitácora' : 'Área apagada — no se le pide nada'}
                        />
                        {sucio && (
                            <Button variant="primary" size="sm" icon={Check} onClick={guardar} loading={guardando}>
                                Guardar
                            </Button>
                        )}
                    </div>

                    {!activa && area.activa && (
                        <Notice variant="warning" compact>
                            Al apagarla deja de pedir lecturas desde hoy. Lo ya anotado no se toca.
                        </Notice>
                    )}
                    {ok && !sucio && <Notice variant="success" compact>Guardado.</Notice>}
                    {error && <Notice variant="danger" compact icon={AlertTriangle}>{error}</Notice>}
                </>
            ) : (
                <p className="text-label text-content-3">
                    {area.instrumento || 'Sin instrumento identificado'}
                    {area.calibrado_hasta ? ` · calibrado hasta ${area.calibrado_hasta}` : ' · sin fecha de calibración'}
                </p>
            )}
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
            </Notice>

            {areas.map(a => (
                <Area key={a.id} area={a} puedeEditar={puedeEditar} onGuardado={alGuardar} />
            ))}

            {!areas.length && (
                <Notice variant="warning" icon={AlertTriangle}>
                    {sucursalNombre} no tiene áreas configuradas.
                </Notice>
            )}
        </div>
    );
}
