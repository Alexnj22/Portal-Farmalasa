import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import useBorrador from '../../hooks/useBorrador';
import {
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Stethoscope, Coffee,
    ClipboardList, Send, X, AlertCircle, AlertTriangle, Info, Clock, CalendarDays,
    XCircle, User,
} from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import FileField from '../../components/common/FileField';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { REQUEST_TYPES } from '../../store/slices/requestsSlice';
import { fetchEmployeeEventsByTypes } from '../../data/employeeSelfService';
import { shortEmployeeName } from '../../utils/nameUtils';

/**
 * El formulario de una solicitud personal, en un modal.
 *
 * ── De dónde sale ─────────────────────────────────────────────────────────
 * Era el panel izquierdo de «Mis Solicitudes», fijo a media pantalla, y al
 * fusionarse las dos rutas no podía seguir siéndolo: en la vista unificada el
 * espacio es de la LISTA, y un formulario que ocupa 450px permanentes se los
 * quita aunque no se esté escribiendo nada.
 *
 * Lo que se mudó tal cual —y es lo que hay que cuidar al tocarlo, porque cada
 * una nació de un caso real y ninguna da error cuando falta:
 *
 *   · la antigüedad («faltan 43 días para cumplir 1 año»), que decide si se
 *     puede pedir vacaciones;
 *   · el choque con una incapacidad aprobada, que bloquea permiso, cambio de
 *     turno y otra incapacidad — con comparación ESTRICTA en el rango, para que
 *     una incapacidad pueda empezar el día que termina la anterior;
 *   · la boleta del ISSS obligatoria desde el día 4;
 *   · el turno de cada uno en la fecha del cambio, y si el compañero está
 *     incapacitado, de permiso o de vacaciones ese día.
 *
 * ── Y lo que se agregó ────────────────────────────────────────────────────
 *   · **A nombre de quién.** Antes eran dos formularios: éste sólo sabía
 *     mandar las propias, y Talento Humano tenía otro —cuatro campos— para
 *     mandar la de un empleado. El de RRHH no tenía NINGUNA de las guardas de
 *     arriba: se podían aprobar vacaciones a alguien con nueve meses de
 *     antigüedad. Ahora es el mismo formulario y el empleado es un campo.
 *   · **El resumen vive en el encabezado** y se arma solo. Es la única línea
 *     que no se va con el scroll, y dice exactamente lo que se va a mandar.
 *   · **Horas Extra** tenía tipo pero no formulario: se mandaba con una fecha
 *     suelta y sin cuántas horas eran. Ahora pide las dos cosas.
 *   · **Ya tenés una pendiente de este tipo**, para cualquier tipo. Antes sólo
 *     lo miraba vacaciones.
 */

// Los siete tipos que hablan de una PERSONA. Los operativos —descartes,
// cargas, traslados, facturación— no entran acá: son de la sala y tienen su
// propia pantalla, que es todo el sentido de que sean dos ámbitos.
const TIPOS = [
    { key: 'VACATION',     icon: Palmtree,    label: 'Vacaciones'   },
    { key: 'PERMIT',       icon: FileText,    label: 'Permiso'      },
    { key: 'DISABILITY',   icon: Stethoscope, label: 'Incapacidad'  },
    { key: 'SHIFT_CHANGE', icon: RefreshCw,   label: 'Cambio Turno' },
    { key: 'ADVANCE',      icon: DollarSign,  label: 'Anticipo'     },
    { key: 'CERTIFICATE',  icon: FileCheck,   label: 'Constancia'   },
    { key: 'OVERTIME',     icon: Coffee,      label: 'Horas extra'  },
];

const CERT_TYPES = [
    { key: 'LABORAL',  label: 'Constancia Laboral',    desc: 'Confirma la relación de trabajo' },
    { key: 'SALARIO',  label: 'Constancia de Salario', desc: 'Incluye el salario mensual' },
    { key: 'BANCARIA', label: 'Constancia Bancaria',   desc: 'Para gestión o apertura de cuenta' },
];

const fmtCorto = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })
    : '';
const fmtLargo = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

/** Días de un rango, contando los dos extremos. */
function diasDe(inicio, fin) {
    if (!inicio || !fin) return 0;
    const a = new Date(inicio + 'T00:00:00');
    const b = new Date(fin + 'T00:00:00');
    return Math.round((b - a) / 86400000) + 1;
}

/** El rótulo de un período de incapacidad, para los avisos. */
const periodo = (d) => `${fmtCorto(d.startDate)} – ${fmtCorto(d.endDate)}`;

export default function ModalNuevaPersonal({
    open = true,
    onClose,
    // A nombre de quién nace la solicitud. Con `puedeElegirEmpleado` el campo
    // se ofrece; sin él, es de quien la manda y no hay nada que elegir.
    sujetoId,
    puedeElegirEmpleado = false,
    // Todo lo que ya tiene la vista — se pasa en vez de volver a pedirlo: son
    // las mismas filas que la lista de atrás está mostrando.
    empleados = [],
    solicitudes = [],
    holidays = [],
    onEnviado,
}) {
    const createRequest        = useStaffStore(s => s.createRequest);
    const uploadFileToStorage  = useStaffStore(s => s.uploadFileToStorage);

    const [empleadoId, setEmpleadoId] = useState(String(sujetoId ?? ''));
    const [tipo,       setTipo]       = useState('VACATION');
    const [payload,    setPayload]    = useState({});
    const [nota,       setNota]       = useState('');
    const [archivo,    setArchivo]    = useState(null);
    const [error,      setError]      = useState('');
    const [enviando,   setEnviando]   = useState(false);
    // El picker de días de permiso se remonta para volver a quedar vacío: es un
    // campo de "agregar", no de "elegir", así que conservar el último valor
    // impediría agregar dos veces el mismo día por error… y también volver a
    // agregarlo después de quitarlo.
    const [permPickerKey, setPermPickerKey] = useState(0);
    const [tipoAbierto,   setTipoAbierto]   = useState(true);

    /* ── La solicitud se guarda sola mientras se escribe ────────────────────
     *
     * Una solicitud de vacaciones o de permiso lleva fechas, un motivo escrito
     * y a veces un archivo. La sesión de los cargos de sala se cierra sola a
     * los 5 minutos, y hasta ahora todo eso se perdía sin dejar rastro.
     *
     * **El archivo NO entra**: un `File` no se puede serializar, y guardar su
     * nombre sin el contenido sería prometer algo que al recuperar no está.
     * Vuelve a adjuntarse, que es un clic. */
    const { recuperado, descartar } = useBorrador(
        'solicitud_personal', { empleadoId, tipo, payload, nota }, { activo: open },
    );

    // Se repone al ABRIR: el modal nace vacío, así que no hay nada que pisar.
    //
    // El pestillo es un `ref` y no estado: no se pinta, y como estado dispararía
    // un render de más por apertura además de caer bajo
    // `react-hooks/set-state-in-effect`.
    const repuesto = useRef(false);
    useEffect(() => {
        if (!open) { repuesto.current = false; return; }
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        // El sujeto lo puede fijar quien abre el modal (`sujetoId`): en ese caso
        // manda él, no el borrador — si no, abrir la solicitud de una persona
        // podría repoblarla con OTRA.
        // Repone el formulario UNA vez al abrir. No hay cascada: el pestillo
        // `repuesto` ya se cerró arriba, así que la segunda pasada sale antes.
        /* eslint-disable react-hooks/set-state-in-effect */
        if (!sujetoId && recuperado.empleadoId) setEmpleadoId(recuperado.empleadoId);
        if (recuperado.tipo) setTipo(recuperado.tipo);
        if (recuperado.payload) setPayload(recuperado.payload);
        if (recuperado.nota) setNota(recuperado.nota);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [open, recuperado, sujetoId]);

    const sujeto = useMemo(
        () => (empleados || []).find(e => String(e.id) === String(empleadoId)) ?? null,
        [empleados, empleadoId]);

    const opcionesEmpleado = useMemo(() =>
        (empleados || [])
            .filter(e => e.status !== 'INACTIVO')
            .map(e => ({ value: String(e.id), label: e.name }))
    , [empleados]);

    // Las del sujeto, que son las que deciden sus guardas. Con el formulario
    // viejo de RRHH esto no existía: se mandaba la solicitud sin mirar si la
    // persona ya tenía vacaciones aprobadas o una incapacidad encima.
    const suyas = useMemo(
        () => (solicitudes || []).filter(r => String(r.employee_id) === String(empleadoId)),
        [solicitudes, empleadoId]);

    // ── Antigüedad y ventana de vacaciones ───────────────────────────────────
    const antiguedad = useMemo(() => {
        if (!sujeto?.hireDate) return null;
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const ingreso = new Date(sujeto.hireDate + 'T12:00:00'); ingreso.setHours(0, 0, 0, 0);
        const msAnio = 365.25 * 24 * 3600 * 1000;
        const aniosExactos = (hoy - ingreso) / msAnio;
        const mesesTotales = Math.floor((hoy - ingreso) / (30.44 * 24 * 3600 * 1000));
        const anios = Math.floor(aniosExactos);
        const meses = mesesTotales - anios * 12;

        if (aniosExactos < 1) {
            const primerAniv = new Date(ingreso); primerAniv.setFullYear(ingreso.getFullYear() + 1);
            const faltan = Math.ceil((primerAniv - hoy) / (24 * 3600 * 1000));
            return { habilitado: false, anios, meses, faltan, ingreso: sujeto.hireDate };
        }

        const ultimoAniv = new Date(ingreso); ultimoAniv.setFullYear(ingreso.getFullYear() + anios);
        const finVentana = new Date(ultimoAniv); finVentana.setDate(finVentana.getDate() + 90);
        const proxAniv = new Date(ingreso); proxAniv.setFullYear(ingreso.getFullYear() + anios + 1);

        return {
            habilitado: true, anios, meses, ingreso: sujeto.hireDate,
            enVentana:    hoy <= finVentana,
            inicioVentana: ultimoAniv.toISOString().split('T')[0],
            finVentana:    finVentana.toISOString().split('T')[0],
            proxAniv:      proxAniv.toISOString().split('T')[0],
        };
    }, [sujeto]);

    const vacacionExistente = useMemo(() => ({
        aprobada:  suyas.find(r => r.type === 'VACATION' && r.status === 'APPROVED'),
        pendiente: suyas.find(r => r.type === 'VACATION' && r.status === 'PENDING'),
    }), [suyas]);

    /* Una pendiente del mismo tipo. No bloquea —puede haber dos permisos en
     * curso— pero se dice: mandar la misma solicitud dos veces por no acordarse
     * es el error más barato de evitar de todos los que hay acá. */
    const pendienteDelTipo = useMemo(
        () => suyas.find(r => r.type === tipo && r.status === 'PENDING') ?? null,
        [suyas, tipo]);

    // Incapacidades aprobadas todavía vigentes (no se bloquean días ya pasados).
    const incapacidades = useMemo(() => {
        const hoy = new Date().toISOString().split('T')[0];
        return suyas
            .filter(r => r.type === 'DISABILITY' && r.status === 'APPROVED')
            .map(r => {
                const meta = typeof r.metadata === 'object' && r.metadata !== null
                    ? r.metadata
                    : (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })();
                return { startDate: meta.startDate, endDate: meta.endDate };
            })
            .filter(d => d.startDate && d.endDate && d.endDate >= hoy);
    }, [suyas]);

    const choqueEnDia = useCallback((fecha) =>
        incapacidades.find(d => fecha >= d.startDate && fecha <= d.endDate) ?? null
    , [incapacidades]);

    /* Estricta (`<`, `>`) a propósito: una incapacidad puede empezar el mismo
     * día que termina la anterior — es una extensión médica, no un solape. */
    const choqueEnRango = useCallback((desde, hasta) =>
        incapacidades.find(d => desde < d.endDate && hasta > d.startDate) ?? null
    , [incapacidades]);

    // ── Cambio de turno ──────────────────────────────────────────────────────
    const companeros = useMemo(() =>
        (empleados || []).filter(e =>
            String(e.branch_id ?? e.branchId) === String(sujeto?.branch_id ?? sujeto?.branchId) &&
            String(e.id) !== String(empleadoId) &&
            e.status === 'ACTIVO')
    , [empleados, sujeto, empleadoId]);

    const companero = useMemo(
        () => empleados?.find(e => String(e.id) === String(payload.targetEmployeeId)) ?? null,
        [empleados, payload.targetEmployeeId]);

    const turnoDe = useCallback((emp, fecha) => {
        if (!emp?.weeklySchedule || !fecha) return null;
        return emp.weeklySchedule[new Date(fecha + 'T12:00:00').getDay()] || null;
    }, []);

    const turnoPropio    = useMemo(() => turnoDe(sujeto, payload.date),    [turnoDe, sujeto, payload.date]);
    const turnoCompanero = useMemo(() => turnoDe(companero, payload.date), [turnoDe, companero, payload.date]);

    // Si el compañero está incapacitado / de permiso / de vacaciones ese día.
    const [companeroOcupado, setCompaneroOcupado] = useState(null);
    useEffect(() => {
        if (!payload.targetEmployeeId || !payload.date) { setCompaneroOcupado(null); return; } // eslint-disable-line react-hooks/set-state-in-effect -- limpia antes de volver a preguntar por otro compañero/fecha
        let cancelado = false;
        fetchEmployeeEventsByTypes(payload.targetEmployeeId).then(({ data }) => {
            if (cancelado) return;
            if (!data?.length) { setCompaneroOcupado(null); return; }
            const d = payload.date;
            const bloqueo = data.find(ev => d >= ev.date && d <= (ev.metadata?.endDate || ev.date));
            const rotulos = { DISABILITY: 'incapacitado', PERMIT: 'con permiso', VACATION: 'de vacaciones' };
            setCompaneroOcupado(bloqueo ? { motivo: rotulos[bloqueo.type] || 'no disponible' } : null);
        });
        return () => { cancelado = true; };
    }, [payload.targetEmployeeId, payload.date]);

    // ── Guardas que apagan el botón ──────────────────────────────────────────
    const diasIncapacidad = Number(payload.days) || 0;
    const finIncapacidad = useMemo(() => {
        if (!payload.startDate || diasIncapacidad < 1) return null;
        const d = new Date(payload.startDate + 'T00:00:00');
        d.setDate(d.getDate() + diasIncapacidad - 1);
        return d.toISOString().split('T')[0];
    }, [payload.startDate, diasIncapacidad]);

    const necesitaISSS = tipo === 'DISABILITY' && diasIncapacidad > 3;
    const solapeISSS   = tipo === 'DISABILITY' && finIncapacidad
        ? choqueEnRango(payload.startDate, finIncapacidad) : null;

    const bloqueadoPorIncapacidad = useMemo(() => {
        if (tipo === 'PERMIT')       return (payload.permissionDates || []).some(d => choqueEnDia(d));
        if (tipo === 'SHIFT_CHANGE') return payload.date ? !!choqueEnDia(payload.date) : false;
        if (tipo === 'DISABILITY')   return !!solapeISSS;
        return false;
    }, [tipo, payload, choqueEnDia, solapeISSS]);

    // ── El resumen del encabezado ────────────────────────────────────────────
    // Lo que se va a mandar, en una línea, siempre a la vista. No es adorno: el
    // cuerpo scrollea y las fechas quedan arriba, así que al llegar al botón de
    // enviar ya no se ven.
    const resumen = useMemo(() => {
        const nombre = REQUEST_TYPES[tipo]?.label ?? tipo;
        if (tipo === 'VACATION' && payload.startDate && payload.endDate) {
            const n = diasDe(payload.startDate, payload.endDate);
            return `${nombre} · ${fmtCorto(payload.startDate)} — ${fmtCorto(payload.endDate)} · ${n} día${n === 1 ? '' : 's'}`;
        }
        if (tipo === 'PERMIT') {
            const n = (payload.permissionDates || []).length;
            return n ? `${nombre} · ${n} día${n === 1 ? '' : 's'}` : nombre;
        }
        if (tipo === 'DISABILITY' && payload.startDate && diasIncapacidad >= 1) {
            return `${nombre} · ${fmtCorto(payload.startDate)} — ${fmtCorto(finIncapacidad)} · ${diasIncapacidad} día${diasIncapacidad === 1 ? '' : 's'}`;
        }
        if (tipo === 'SHIFT_CHANGE' && payload.date && companero) {
            return `${nombre} · ${fmtCorto(payload.date)} · con ${shortEmployeeName(companero)}`;
        }
        if (tipo === 'ADVANCE' && payload.amount) {
            return `${nombre} · $${Number(payload.amount).toLocaleString('es-SV')}`;
        }
        if (tipo === 'CERTIFICATE' && payload.certificateType) {
            return CERT_TYPES.find(c => c.key === payload.certificateType)?.label ?? nombre;
        }
        if (tipo === 'OVERTIME' && payload.date) {
            return payload.hours
                ? `${nombre} · ${fmtCorto(payload.date)} · ${payload.hours} h`
                : `${nombre} · ${fmtCorto(payload.date)}`;
        }
        return nombre;
    }, [tipo, payload, diasIncapacidad, finIncapacidad, companero]);

    const cambiarTipo = (k) => {
        setTipo(k);
        setPayload({});
        setError('');
        setArchivo(null);
        setPermPickerKey(0);
        setTipoAbierto(false);
    };

    const agregarDiaPermiso = (fecha) => {
        if (!fecha) return;
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        if (new Date(fecha + 'T12:00:00') < hoy) return;
        const choque = choqueEnDia(fecha);
        if (choque) {
            setError(`Hay una incapacidad del ${periodo(choque)} — ese día no se puede pedir permiso.`);
            return;
        }
        setPayload(prev => {
            const ya = prev.permissionDates || [];
            return ya.includes(fecha) ? prev : { ...prev, permissionDates: [...ya, fecha].sort() };
        });
        setPermPickerKey(k => k + 1);
    };

    const quitarDiaPermiso = (fecha) => setPayload(prev => ({
        ...prev,
        permissionDates: (prev.permissionDates || []).filter(d => d !== fecha),
    }));

    const enviar = async (e) => {
        e?.preventDefault();
        setError('');

        if (!empleadoId)   { setError('Elige a nombre de quién va la solicitud.'); return; }
        if (!nota.trim())  { setError('El motivo es obligatorio.'); return; }

        if (tipo === 'VACATION') {
            if (!payload.startDate || !payload.endDate) { setError('Selecciona el período de vacaciones.'); return; }
            if (!antiguedad?.habilitado) { setError('Todavía no se cumple 1 año en la empresa para pedir vacaciones.'); return; }
            if (vacacionExistente.aprobada) { setError('Ya hay vacaciones aprobadas para este período.'); return; }
            if (payload.startDate.slice(0, 4) < String(new Date().getFullYear())) {
                setError('No se pueden elegir fechas de años anteriores.'); return;
            }
        }
        if (tipo === 'PERMIT') {
            if (!(payload.permissionDates || []).length) { setError('Selecciona al menos un día de permiso.'); return; }
            const chocado = payload.permissionDates.find(d => choqueEnDia(d));
            if (chocado) {
                setError(`El día ${fmtCorto(chocado)} cae dentro de una incapacidad vigente (${periodo(choqueEnDia(chocado))}).`);
                return;
            }
        }
        if (tipo === 'SHIFT_CHANGE') {
            if (!payload.targetEmployeeId || !payload.date) { setError('Selecciona el compañero y la fecha del cambio.'); return; }
            const propio = choqueEnDia(payload.date);
            if (propio) { setError(`Hay una incapacidad del ${periodo(propio)} — no se puede cambiar turno esa fecha.`); return; }
            if (companeroOcupado) { setError(`El compañero está ${companeroOcupado.motivo} en esa fecha.`); return; }
        }
        if (tipo === 'ADVANCE' && (!payload.amount || Number(payload.amount) <= 0)) {
            setError('Ingresa el monto del anticipo.'); return;
        }
        if (tipo === 'CERTIFICATE' && !payload.certificateType) {
            setError('Selecciona el tipo de constancia.'); return;
        }
        if (tipo === 'OVERTIME') {
            if (!payload.date) { setError('Selecciona la fecha de las horas extra.'); return; }
            if (!payload.hours || Number(payload.hours) <= 0) { setError('Ingresa cuántas horas.'); return; }
        }
        if (tipo === 'DISABILITY') {
            if (!payload.startDate || diasIncapacidad < 1) { setError('Ingresa la fecha de inicio y la cantidad de días.'); return; }
            if (solapeISSS) { setError(`Ya hay una incapacidad aprobada del ${periodo(solapeISSS)} — esas fechas se solapan.`); return; }
        }

        setEnviando(true);

        const final = { ...payload };
        if (tipo === 'DISABILITY') {
            final.endDate = finIncapacidad;
            if (archivo) {
                const url = await uploadFileToStorage(archivo, 'documents', 'disability');
                if (url) final.docUrl = url;
                final.docName = archivo.name;
            }
        }

        const ok = await createRequest(empleadoId, tipo, final, nota.trim());
        setEnviando(false);
        if (ok) {
            useToastStore.getState().showToast(
                'Enviada', `Solicitud de ${REQUEST_TYPES[tipo]?.label} registrada.`, 'success');
            descartar();   // se envió de verdad: el borrador ya no sirve
            onEnviado?.();
            onClose?.();
        } else {
            setError('No se pudo crear la solicitud. Intenta de nuevo.');
        }
    };

    // ── El detalle de cada tipo ──────────────────────────────────────────────
    const detalle = () => {
        if (tipo === 'VACATION') {
            const hayRango = payload.startDate && payload.endDate;
            return (
                <div className="space-y-3">
                    {antiguedad && (
                        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-2xl border text-label font-bold ${
                            antiguedad.habilitado
                                ? 'bg-success/10 border-success/30 text-success-text'
                                : 'bg-warning/10 border-warning/30 text-warning-text'}`}>
                            <Clock size={13} className="flex-shrink-0" strokeWidth={2.5} />
                            {antiguedad.habilitado
                                ? <span>En la empresa hace <strong>{antiguedad.anios} año{antiguedad.anios !== 1 ? 's' : ''}{antiguedad.meses > 0 ? ` y ${antiguedad.meses} mes${antiguedad.meses !== 1 ? 'es' : ''}` : ''}</strong></span>
                                : <span>Faltan <strong>{antiguedad.faltan} día{antiguedad.faltan !== 1 ? 's' : ''}</strong> para cumplir 1 año · Ingreso: {fmtLargo(antiguedad.ingreso)}</span>}
                        </div>
                    )}

                    {!sujeto?.hireDate && empleadoId && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            Sin fecha de ingreso en el expediente no se puede verificar la antigüedad.
                        </Notice>
                    )}

                    {vacacionExistente.aprobada && (() => {
                        const m = typeof vacacionExistente.aprobada.metadata === 'object' ? vacacionExistente.aprobada.metadata : {};
                        return (
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-warning/10 border border-warning/30 text-label font-bold text-warning-text">
                                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                                <span>Ya hay vacaciones aprobadas{m.startDate ? ` del ${fmtLargo(m.startDate)} al ${fmtLargo(m.endDate)}` : ''}. No se puede pedir otra.</span>
                            </div>
                        );
                    })()}

                    {!vacacionExistente.aprobada && vacacionExistente.pendiente && (() => {
                        const m = typeof vacacionExistente.pendiente.metadata === 'object' ? vacacionExistente.pendiente.metadata : {};
                        return (
                            <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-brand/8 border border-brand/20 text-label font-bold text-brand-text">
                                <Info size={13} className="flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                                <span>Hay vacaciones en revisión{m.startDate ? ` — ${fmtLargo(m.startDate)} al ${fmtLargo(m.endDate)}` : ''}.</span>
                            </div>
                        );
                    })()}

                    {!vacacionExistente.aprobada && antiguedad?.habilitado && (
                        <>
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] ml-1">
                                        Período de Vacaciones
                                    </label>
                                    {hayRango && (
                                        <Button variant="ghost" icon={X}
                                            onClick={() => setPayload(p => ({ ...p, startDate: '', endDate: '' }))}>Limpiar</Button>
                                    )}
                                </div>
                                <RangeDatePicker
                                    startDate={payload.startDate || ''} endDate={payload.endDate || ''}
                                    onRangeChange={(s, e) => setPayload(p => ({ ...p, startDate: s, endDate: e }))}
                                    holidays={holidays} defaultDays={15} label="vacaciones"
                                />
                            </div>
                            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-card-hover border border-divider text-caption font-bold text-content-3">
                                <CalendarDays size={11} strokeWidth={2} />
                                {antiguedad.enVentana
                                    ? <>Ventana disponible: {fmtLargo(antiguedad.inicioVentana)} — {fmtLargo(antiguedad.finVentana)}</>
                                    : <>Próximo período disponible desde {fmtLargo(antiguedad.proxAniv)}</>}
                            </div>
                        </>
                    )}
                </div>
            );
        }

        if (tipo === 'PERMIT') {
            const dias = payload.permissionDates || [];
            return (
                <div className="space-y-3">
                    {incapacidades.length > 0 && (
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl bg-warning/10 border border-warning/30">
                            <AlertTriangle size={13} className="text-warning flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                            <div>
                                <p className="text-caption font-black text-warning-text uppercase tracking-wide">Incapacidad activa</p>
                                <p className="text-label font-medium text-warning-text leading-snug">
                                    {incapacidades.map(periodo).join(', ')} — los días cubiertos no están disponibles.
                                </p>
                            </div>
                        </div>
                    )}
                    <div>
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1.5 ml-1">
                            <CalendarDays size={11} strokeWidth={2.5} className="text-chart-3-text" />
                            Días de Permiso
                            {dias.length > 0 && <span className="text-content-3 normal-case tracking-normal font-bold">· {dias.length}</span>}
                        </label>
                        <div className="bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
                            <LiquidDatePicker key={permPickerKey} value="" onChange={agregarDiaPermiso} holidays={holidays} />
                        </div>
                    </div>
                    {dias.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {dias.map(d => (
                                <Badge key={d} variant="chart-3" uppercase={false}>
                                    {new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                                    <Button variant="ghost" icon={XCircle} iconOnly
                                        aria-label={`Quitar ${fmtCorto(d)}`}
                                        onClick={() => quitarDiaPermiso(d)} />
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

        if (tipo === 'SHIFT_CHANGE') {
            const hayTurnos = payload.targetEmployeeId && payload.date;
            return (
                <div className="space-y-3">
                    <div>
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                            Compañero de intercambio
                        </label>
                        <LiquidSelect
                            value={payload.targetEmployeeId || ''}
                            onChange={v => setPayload(p => ({ ...p, targetEmployeeId: v }))}
                            placeholder="Seleccionar compañero..."
                            options={companeros.map(e => ({ value: String(e.id), label: `${e.name} — ${e.role || 'Empleado'}` }))}
                        />
                        {companeros.length === 0 && (
                            <p className="text-label text-content-3 mt-1.5 ml-1">
                                No hay otros compañeros activos en la misma sala.
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1.5 ml-1">
                            <CalendarDays size={11} strokeWidth={2.5} className="text-chart-9" />
                            Fecha del cambio
                        </label>
                        <div className="bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
                            <LiquidDatePicker value={payload.date || ''}
                                onChange={v => setPayload(p => ({ ...p, date: v }))} holidays={holidays} />
                        </div>
                    </div>

                    {payload.date && choqueEnDia(payload.date) && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30 text-label font-bold text-danger-text">
                            <AlertTriangle size={13} className="flex-shrink-0" strokeWidth={2.5} />
                            Hay una incapacidad ese día ({periodo(choqueEnDia(payload.date))}) — no se puede cambiar turno
                        </div>
                    )}
                    {companeroOcupado && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30 text-label font-bold text-danger-text">
                            <AlertTriangle size={13} className="flex-shrink-0" strokeWidth={2.5} />
                            {companero ? shortEmployeeName(companero) : 'El compañero'} está {companeroOcupado.motivo} ese día — no puede hacer el cambio
                        </div>
                    )}

                    {hayTurnos && !companeroOcupado && (
                        <div className="grid grid-cols-2 gap-2">
                            <div data-surface="card" className="p-3">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">Turno ese día</p>
                                <p className="text-body-sm font-black text-content-2">
                                    {turnoPropio ? `${turnoPropio.start} – ${turnoPropio.end}` : '—'}
                                </p>
                                {!turnoPropio && <p className="text-micro text-content-3 mt-0.5">Sin turno asignado</p>}
                            </div>
                            <div className="bg-chart-9/10 border border-chart-9/20 rounded-2xl p-3">
                                <p className="text-micro font-black text-chart-9-text uppercase tracking-widest mb-1">
                                    Turno de {companero ? shortEmployeeName(companero) : 'compañero'}
                                </p>
                                <p className="text-body-sm font-black text-chart-9-text">
                                    {turnoCompanero ? `${turnoCompanero.start} – ${turnoCompanero.end}` : '—'}
                                </p>
                                {!turnoCompanero && <p className="text-micro text-chart-9 mt-0.5">Sin turno asignado</p>}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        if (tipo === 'ADVANCE') {
            return (
                <PortalInput
                    label="Monto solicitado" name="sol-monto" prefix="$"
                    inputMode="decimal" maskType="DECIMAL"
                    value={payload.amount || ''}
                    onChange={e => setPayload(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0.00"
                />
            );
        }

        if (tipo === 'CERTIFICATE') {
            return (
                <div>
                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">
                        Tipo de Constancia
                    </label>
                    <LiquidSelect
                        value={payload.certificateType || ''}
                        onChange={v => setPayload(p => ({ ...p, certificateType: v }))}
                        placeholder="Seleccionar tipo de constancia..."
                        options={CERT_TYPES.map(c => ({ value: c.key, label: c.label }))}
                    />
                    {payload.certificateType && (
                        <p className="text-label text-content-3 mt-1.5 ml-1">
                            {CERT_TYPES.find(c => c.key === payload.certificateType)?.desc}
                        </p>
                    )}
                </div>
            );
        }

        /* Horas Extra no tenía formulario: el tipo existía y se mandaba con una
         * fecha suelta, sin cuántas horas eran — o sea que quien la aprobaba no
         * tenía el dato que define la solicitud. */
        if (tipo === 'OVERTIME') {
            return (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                            Fecha
                        </label>
                        <div className="bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
                            <LiquidDatePicker value={payload.date || ''}
                                onChange={v => setPayload(p => ({ ...p, date: v }))} holidays={holidays} />
                        </div>
                    </div>
                    <PortalInput
                        label="Cantidad de horas" name="sol-horas"
                        type="number" min="1" max="12" step="1"
                        value={payload.hours || ''}
                        onChange={e => setPayload(p => ({ ...p, hours: e.target.value }))}
                        placeholder="Ej. 3"
                    />
                </div>
            );
        }

        if (tipo === 'DISABILITY') {
            return (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                Primer día
                            </label>
                            <div className="bg-surface-card border border-divider rounded-xl h-10 overflow-hidden">
                                <LiquidDatePicker value={payload.startDate || ''}
                                    onChange={v => setPayload(p => ({ ...p, startDate: v }))}
                                    holidays={holidays} />
                            </div>
                        </div>
                        <PortalInput
                            label="Cantidad de días" name="sol-dias"
                            type="number" min="1" max="365"
                            value={payload.days || ''}
                            onChange={e => setPayload(p => ({ ...p, days: e.target.value }))}
                            placeholder="Ej. 3"
                        />
                    </div>

                    {finIncapacidad && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border bg-danger/10 border-danger/30 text-danger-text w-fit text-caption font-black uppercase tracking-widest">
                            <Stethoscope size={11} className="text-danger flex-shrink-0" strokeWidth={2.5} />
                            <span>Hasta {new Date(finIncapacidad + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                        </div>
                    )}

                    {solapeISSS && (
                        <Notice variant="danger" icon={AlertTriangle}>
                            Ya hay una incapacidad aprobada del {periodo(solapeISSS)} — las fechas elegidas se solapan.
                        </Notice>
                    )}

                    <div>
                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                            {necesitaISSS
                                ? <span>Boleta ISSS <span className="text-danger">*</span><span className="text-content-3 ml-1 normal-case font-medium">(obligatoria para cobertura ISSS)</span></span>
                                : <span>Certificado Médico <span className="text-content-3 ml-1 normal-case font-medium">(opcional)</span></span>}
                        </label>
                        <FileField accept=".pdf,.jpg,.jpeg,.png" file={archivo} onChange={setArchivo}
                            hint="PDF, JPG o PNG — también se puede adjuntar después" />
                    </div>

                    {necesitaISSS && (
                        <Notice variant="warning" icon={Info}>
                            Desde el día 4 aplica la cobertura del ISSS, que cubre el 75% del salario. La boleta
                            oficial se presenta dentro de 3 días hábiles para poder tramitar el reembolso.
                        </Notice>
                    )}

                    <div className="px-4 py-2.5 rounded-2xl bg-danger/10 border border-danger/30">
                        <p className="text-label font-bold text-danger-text leading-relaxed">
                            Talento Humano la recibe como urgente. Los días se marcan en el horario al aprobarse.
                        </p>
                    </div>
                </div>
            );
        }

        return null;
    };

    const tipoElegido = TIPOS.find(t => t.key === tipo);
    const IconoTipo   = tipoElegido?.icon ?? FileText;

    return (
        <LiquidModal open={open} onClose={() => !enviando && onClose?.()} maxWidth="max-w-2xl" ariaLabel="Nueva solicitud" zClass="z-toast">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-card-hover">
                        <ClipboardList size={16} strokeWidth={2} className="text-content-2" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-body font-black text-content leading-tight truncate">Nueva solicitud</p>
                        {/* El resumen ES el subtítulo: se arma solo y es lo único
                            que no se va con el scroll del cuerpo. */}
                        <p className="text-label text-content-3 mt-0.5 truncate">{resumen}</p>
                    </div>
                    <Button variant="ghost" size="xs" icon={X} iconOnly
                        onClick={() => !enviando && onClose?.()} aria-label="Cerrar" />
                </div>

                {puedeElegirEmpleado && (
                    <div className="mt-3">
                        <LiquidSelect
                            value={empleadoId}
                            onChange={v => { setEmpleadoId(v ?? ''); setPayload({}); setError(''); }}
                            options={opcionesEmpleado}
                            placeholder="A nombre de..."
                            icon={User}
                            compact
                            clearable={false}
                        />
                    </div>
                )}
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-5">
                {error && (
                    <Notice variant="warning" icon={AlertCircle} className="animate-in fade-in slide-in-from-top-2">
                        {error}
                    </Notice>
                )}

                {pendienteDelTipo && (
                    <Notice variant="info" icon={Info}>
                        Ya hay una solicitud de {REQUEST_TYPES[tipo]?.label} en revisión desde el{' '}
                        {fmtLargo(String(pendienteDelTipo.created_at).slice(0, 10))}.
                    </Notice>
                )}

                <div>
                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">
                        Tipo de Solicitud
                    </label>
                    {tipoAbierto ? (
                        /* Sin `<div className="grid">` alrededor: `SegmentedControl`
                           en bloque YA ES una grilla, y envolverlo lo mete en una
                           sola celda con las etiquetas encimadas. */
                        <SegmentedControl
                            layout="block" columns={3} stacked
                            label="Tipo de solicitud"
                            value={tipo}
                            onChange={cambiarTipo}
                            options={TIPOS.map(({ key, icon, label }) => ({
                                value: key, label, icon,
                                tone: REQUEST_TYPES[key]?.variante ?? 'brand',
                            }))}
                        />
                    ) : (
                        <Button
                            variant="secondary"
                            tone={REQUEST_TYPES[tipo]?.variante ?? 'brand'}
                            soft size="lg" className="w-full justify-start"
                            icon={IconoTipo}
                            aria-expanded={false}
                            aria-label={`Tipo de solicitud: ${tipoElegido?.label}. Cambiar`}
                            onClick={() => setTipoAbierto(true)}
                        >
                            <span className="flex-1 text-left uppercase tracking-widest">{tipoElegido?.label}</span>
                            <Badge size="sm" className="ml-2">Cambiar</Badge>
                        </Button>
                    )}
                </div>

                {detalle()}

                <div>
                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                        Motivo / Descripción <span className="text-danger">*</span>
                    </label>
                    <PortalTextarea
                        value={nota}
                        onChange={e => { setNota(e.target.value); if (error) setError(''); }}
                        rows={4}
                        placeholder="Describe la solicitud..."
                        disabled={enviando}
                    />
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="secondary" disabled={enviando} onClick={() => onClose?.()}>Cancelar</Button>
                <Button icon={Send} loading={enviando}
                    disabled={enviando || bloqueadoPorIncapacidad || !empleadoId}
                    onClick={enviar}>
                    {enviando ? 'Enviando…' : 'Enviar solicitud'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
