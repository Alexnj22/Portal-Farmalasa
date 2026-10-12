import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarHeart, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import Notice from '../common/Notice';
import Switch from '../common/Switch';
import PortalInput from '../common/PortalInput';
import TimePicker12 from '../common/TimePicker12';
import LiquidDatePicker from '../common/LiquidDatePicker';
import { LoadingState } from '../common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import {
    borrarHorarioEspecial, fetchFeriadosNacionales, fetchHorariosEspeciales, guardarHorarioEspecial,
} from '@nucleo/data/horarios';
import {
    fechaLarga, fechaSV, horaDelHorario, horarioDeDomingo, proximosFeriados, rangoLegible,
} from '@nucleo/utils/horarioDelChat';

/**
 * Horarios especiales de una sala (2026-10-12): un día puntual con otro
 * horario, o cerrado. Manda sobre todo lo demás en `horario_de_sala()`:
 *   especial  >  feriado (usa el horario de DOMINGO)  >  día de la semana.
 *
 * A diferencia del horario semanal de arriba —que viaja con el botón
 * «Guardar» del formulario—, cada día especial se guarda AL MOMENTO en su
 * propia tabla (`sucursal_horario_especial`): no depende del resto del
 * formulario y el chat de la app lo empieza a usar enseguida.
 *
 * Abajo, de sólo lectura, los feriados nacionales de los próximos 60 días con
 * el horario que aplicará si nadie carga nada, y un atajo para cambiarlo.
 */

const VACIO = { fecha: '', cerrada: false, abre: '', cierra: '', motivo: '' };
const DIAS_DE_FERIADOS = 60;

export default function HorariosEspeciales({ branchId, weeklyHours }) {
    const { user, hasPermission } = useAuth();
    const puedeEditar = hasPermission('branches', 'can_edit');
    const hoy = fechaSV();

    const [especiales, setEspeciales] = useState(null);
    const [feriados, setFeriados] = useState([]);
    const [error, setError] = useState('');
    const [f, setF] = useState(VACIO);
    const [guardando, setGuardando] = useState(false);
    const [borrando, setBorrando] = useState(null);
    const [porBorrar, setPorBorrar] = useState(null);

    const cargar = useCallback(async () => {
        if (!branchId) return;
        try {
            const [esp, fer] = await Promise.all([fetchHorariosEspeciales(branchId, hoy), fetchFeriadosNacionales()]);
            setEspeciales(esp);
            setFeriados(fer);
        } catch (e) {
            setError(e?.message || 'No se pudieron leer los horarios especiales.');
            setEspeciales((x) => x ?? []);
        }
    }, [branchId, hoy]);

    useEffect(() => { cargar(); }, [cargar]);

    const domingo = useMemo(() => horarioDeDomingo(weeklyHours), [weeklyHours]);
    const porFecha = useMemo(() => new Map((especiales ?? []).map((e) => [e.fecha, e])), [especiales]);
    const proximos = useMemo(() => proximosFeriados(feriados, { desde: hoy, dias: DIAS_DE_FERIADOS }), [feriados, hoy]);

    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
    const horasMal = !f.cerrada && (!f.abre || !f.cierra || f.abre >= f.cierra);
    const fechaMal = !f.fecha || f.fecha < hoy;
    const listo = puedeEditar && !!user?.id && !guardando && !fechaMal && !horasMal;
    const reemplaza = f.fecha ? porFecha.get(f.fecha) : null;

    const guardar = async () => {
        setGuardando(true); setError('');
        try {
            await guardarHorarioEspecial({ branchId, ...f, employeeId: user.id });
            setF(VACIO);
            await cargar();
        } catch (e) {
            setError(e?.message || 'No se pudo guardar el horario especial.');
        } finally {
            setGuardando(false);
        }
    };

    const borrar = async (e) => {
        setBorrando(e.id); setError('');
        try {
            await borrarHorarioEspecial({ id: e.id, branchId, fecha: e.fecha });
            setPorBorrar(null);
            await cargar();
        } catch (err) {
            setError(err?.message || 'No se pudo borrar el horario especial.');
        } finally {
            setBorrando(null);
        }
    };

    // Lleva un día (un feriado o uno ya cargado) al formulario para cambiarlo.
    const editarDia = (fecha, base = {}) => {
        const actual = porFecha.get(fecha);
        setF({
            fecha,
            cerrada: actual ? !!actual.cerrada : !!base.cerrada,
            abre: actual?.abre ? horaDelHorario(actual.abre) : (base.abre || ''),
            cierra: actual?.cierra ? horaDelHorario(actual.cierra) : (base.cierra || ''),
            motivo: actual?.motivo || base.motivo || '',
        });
    };

    if (!branchId) return null;

    return (
        <section data-surface="card" className="rounded-card p-4 md:p-5 flex flex-col gap-4 mt-4" aria-label="Horarios especiales">
            <div className="flex items-center gap-3">
                <CalendarClock size={18} className="text-brand-text shrink-0" />
                <div className="min-w-0">
                    <h4 className="text-body-sm font-black text-content">Horarios especiales (feriados y días puntuales)</h4>
                    <p className="text-caption text-content-3">Mandan sobre el horario semanal ese día. Se guardan al momento, aparte del botón «Guardar».</p>
                </div>
            </div>

            {error && <Notice variant="danger" bloque>{error}</Notice>}

            {puedeEditar && (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <p className="text-micro font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Día</p>
                            <LiquidDatePicker value={f.fecha} min={hoy} onChange={(v) => setF((x) => ({ ...x, fecha: v || '' }))} />
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-3 min-h-[var(--tap-min)] py-2">
                                <Switch checked={f.cerrada} onChange={set('cerrada')} label="Cerrada todo el día" />
                                <span className="text-body-sm font-bold text-content">Cerrada todo el día</span>
                            </label>
                        </div>
                    </div>
                    {!f.cerrada && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <p className="text-micro font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Abre</p>
                                <TimePicker12 value={f.abre} defaultMeridiem="AM" onChange={set('abre')} />
                            </div>
                            <div>
                                <p className="text-micro font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Cierra</p>
                                <TimePicker12 value={f.cierra} defaultMeridiem="PM" onChange={set('cierra')} />
                            </div>
                        </div>
                    )}
                    <PortalInput label="Motivo (opcional)" name="horario-especial-motivo" value={f.motivo} maxLength={120}
                        placeholder="Por ejemplo: Día de los Difuntos" onChange={(e) => set('motivo')(e.target.value)} />
                    {!f.cerrada && f.abre && f.cierra && f.abre >= f.cierra && (
                        <Notice variant="warning">La hora de cierre tiene que ser después de la de apertura.</Notice>
                    )}
                    {reemplaza && (
                        <Notice variant="info">Ese día ya tiene un horario especial: se va a reemplazar.</Notice>
                    )}
                    <div className="flex flex-wrap justify-end gap-2">
                        {(f.fecha || f.motivo || f.abre || f.cierra || f.cerrada) && (
                            <Button variant="ghost" size="sm" onClick={() => setF(VACIO)} disabled={guardando}>Limpiar</Button>
                        )}
                        <Button variant="primary" size="sm" icon={guardando ? Loader2 : Plus} disabled={!listo} onClick={guardar}>
                            {reemplaza ? 'Reemplazar este día' : 'Agregar día especial'}
                        </Button>
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-2">
                <p className="text-micro font-black uppercase tracking-widest text-content-3">Próximos días especiales</p>
                {especiales === null ? <LoadingState label="Cargando horarios especiales" /> : !especiales.length ? (
                    <p className="text-caption text-content-3">No hay ninguno cargado desde hoy.</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {especiales.map((e) => (
                            <li key={e.id} data-surface="card" className="rounded-card px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <div className="flex-1 min-w-0">
                                    <p className="text-body-sm font-bold text-content first-letter:uppercase">{fechaLarga(e.fecha)}</p>
                                    {e.motivo && <p className="text-caption text-content-3 truncate">{e.motivo}</p>}
                                </div>
                                {e.cerrada
                                    ? <Badge variant="danger" uppercase={false}>Cerrada</Badge>
                                    : <Badge variant="info" uppercase={false}>{rangoLegible(e.abre, e.cierra)}</Badge>}
                                {puedeEditar && (porBorrar === e.id ? (
                                    <span className="flex items-center gap-1.5">
                                        <Button variant="ghost" size="sm" onClick={() => setPorBorrar(null)} disabled={borrando === e.id}>No</Button>
                                        <Button variant="destructive" size="sm" icon={borrando === e.id ? Loader2 : Trash2}
                                            disabled={borrando === e.id} onClick={() => borrar(e)}>Sí, borrar</Button>
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1">
                                        <Button variant="ghost" size="sm" icon={Pencil} iconOnly title="Cambiar este día"
                                            onClick={() => editarDia(e.fecha)} />
                                        <Button variant="ghost" size="sm" icon={Trash2} iconOnly title="Borrar este día"
                                            onClick={() => setPorBorrar(e.id)} />
                                    </span>
                                ))}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <p className="text-micro font-black uppercase tracking-widest text-content-3">{`Feriados nacionales · próximos ${DIAS_DE_FERIADOS} días`}</p>
                {!proximos.length ? (
                    <p className="text-caption text-content-3">No hay feriados nacionales en los próximos {DIAS_DE_FERIADOS} días.</p>
                ) : (
                    <ul className="flex flex-col gap-1.5">
                        {proximos.map((h) => {
                            const esp = porFecha.get(h.fecha);
                            return (
                                <li key={h.fecha} data-surface="card" className="rounded-card px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                    <CalendarHeart size={15} className="text-warning-text shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-body-sm font-bold text-content">
                                            {h.nombre} <span className="font-medium text-content-3">· {fechaLarga(h.fecha)}</span>
                                        </p>
                                        <p className="text-caption text-content-2">
                                            {esp
                                                ? (esp.cerrada ? 'Tiene horario especial: cerrada' : `Tiene horario especial: ${rangoLegible(esp.abre, esp.cierra)}`)
                                                : (domingo ? `Usará horario de domingo: ${rangoLegible(domingo.abre, domingo.cierra)}` : 'Usará horario de domingo: cerrada')}
                                        </p>
                                    </div>
                                    {puedeEditar && (
                                        <Button variant="secondary" size="sm" onClick={() => editarDia(h.fecha, { ...(domingo ?? { cerrada: true }), motivo: h.nombre })}>
                                            Cambiar para este día
                                        </Button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </section>
    );
}
