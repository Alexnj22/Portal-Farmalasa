/**
 * Imponer una sanción del RIT Art. 83.
 *
 * ── La escalera se PROPONE, no se aplica sola ───────────────────────────────
 * La base calcula qué peldaño permite el reglamento y muestra en qué se apoya;
 * quien firma elige. Es a propósito: el Art. 83 dice que la sanción «deberá ser
 * proporcional a la falta», y la proporción la juzga una persona. Lo que la
 * pantalla evita es lo contrario — que alguien salte de la nada a una suspensión
 * sin ver que no hay antecedentes.
 *
 * ── Por qué se ven los antecedentes ─────────────────────────────────────────
 * Porque este registro existe para sostener un despido en un juicio. Una
 * pantalla que dijera «peldaño 3» sin mostrar las faltas de los últimos 60 días
 * pediría un acto de fe justo donde hace falta evidencia.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 * No registra la terminación del contrato. Se muestra como quinto peldaño para
 * que se vea dónde termina la escalera, y no se puede elegir: es una baja, con
 * su liquidación y su causal del Art. 50.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldAlert, Loader2, AlertTriangle, Info } from 'lucide-react';
import ModalShell from '../common/ModalShell';
import Button from '../common/Button';
import LiquidSelect from '../common/LiquidSelect';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import Notice from '../common/Notice';
import Badge from '../common/Badge';
import { listarFaltas, consultarEscalera, registrarSancion, PELDANOS } from '../../data/disciplina';
import { EVENT_TYPES } from '../../data/constants';
import { saveDraft, loadDraft, clearDraft } from '../../utils/draftUtils';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';

const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtFecha = (iso) => {
    if (!iso) return '';
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function SancionModal({ open, onClose, empleado, onGuardado }) {
    // El borrador es por PERSONA: dos sanciones a dos personas distintas no se
    // pisan, y volver a abrir la de alguien recupera lo que se estaba
    // escribiendo. La sesión de sala se cierra sola a los 5 minutos y un
    // formulario en memoria se pierde entero sin dejar rastro.
    const claveBorrador = `sancion:${empleado?.id || 'sin-ficha'}`;

    const [faltas, setFaltas]         = useState([]);
    const [falta, setFalta]           = useState('');
    const [peldano, setPeldano]       = useState(null);
    const [fecha, setFecha]           = useState(hoyISO);
    const [dias, setDias]             = useState('');
    const [autorizacion, setAutoriz]  = useState('');
    const [nota, setNota]             = useState('');
    const [escalera, setEscalera]     = useState(null);
    const [cargando, setCargando]     = useState(false);
    const [guardando, setGuardando]   = useState(false);
    const toast = useToastStore(s => s.addToast);

    useEffect(() => {
        if (!open) return;
        listarFaltas().then(setFaltas).catch(err => toast(mensajeAmigable(err), 'error'));
        const b = loadDraft(claveBorrador);
        if (b) {
            setFalta(b.falta || '');
            setFecha(b.fecha || hoyISO());
            setDias(b.dias || '');
            setAutoriz(b.autorizacion || '');
            setNota(b.nota || '');
        }
    }, [open, claveBorrador, toast]);

    useEffect(() => {
        if (!open || !falta) return;
        saveDraft(claveBorrador, { falta, fecha, dias, autorizacion, nota });
    }, [open, claveBorrador, falta, fecha, dias, autorizacion, nota]);

    // Al elegir la falta se le pregunta a la base qué peldaño toca. La consulta
    // depende de la FECHA además de la falta: la ventana de 60 días se cuenta
    // desde el día de la sanción, no desde hoy.
    useEffect(() => {
        if (!open || !falta || !empleado?.id) { setEscalera(null); return; }
        let vivo = true;
        setCargando(true);
        consultarEscalera(empleado.id, falta, fecha)
            .then(r => {
                if (!vivo) return;
                setEscalera(r);
                setPeldano(p => p ?? r?.peldano ?? 1);
            })
            .catch(err => { if (vivo) toast(mensajeAmigable(err), 'error'); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [open, falta, fecha, empleado?.id, toast]);

    // El peldaño 3 es de UN día por definición del Art. 83; el 4 va de 2 a 30.
    // Se refleja acá para que el campo no ofrezca lo que la base va a rechazar.
    useEffect(() => {
        if (peldano === 3) setDias('1');
        else if (peldano === 4 && (dias === '1' || dias === '')) setDias('2');
    }, [peldano]); // eslint-disable-line react-hooks/exhaustive-deps

    const esSuspension = peldano === 3 || peldano === 4;
    const puedeGuardar = useMemo(() => {
        if (!falta || !peldano || !fecha || guardando) return false;
        if (peldano === 4) {
            const n = Number(dias);
            if (!Number.isFinite(n) || n < 2 || n > 30) return false;
            if (!autorizacion.trim()) return false;
        }
        return true;
    }, [falta, peldano, fecha, dias, autorizacion, guardando]);

    const guardar = useCallback(async () => {
        setGuardando(true);
        try {
            await registrarSancion({
                employeeId:   empleado.id,
                falta,
                peldano,
                fecha,
                dias:         esSuspension ? Number(dias) : null,
                nota:         nota.trim() || null,
                autorizacion: autorizacion.trim() || null,
            });
            clearDraft(claveBorrador);
            toast('Sanción registrada', 'success');
            onGuardado?.();
            onClose?.();
        } catch (err) {
            toast(mensajeAmigable(err), 'error');
        } finally {
            setGuardando(false);
        }
    }, [empleado, falta, peldano, fecha, dias, nota, autorizacion, esSuspension,
        claveBorrador, toast, onGuardado, onClose]);

    const antecedentes = escalera?.antecedentes || [];

    return (
        <ModalShell open={open} onClose={onClose} maxWidthClass="max-w-xl" ariaLabel="Registrar una sanción">
            <div className="p-5 sm:p-6 space-y-5">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-btn bg-warning/10 flex items-center justify-center shrink-0">
                        <ShieldAlert size={22} className="text-warning-text" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-h4 font-black text-content-1 leading-tight">Registrar una sanción</h2>
                        <p className="text-caption text-content-3 truncate">{empleado?.name} · RIT Art. 83</p>
                    </div>
                </div>

                <LiquidSelect
                    label="Falta cometida"
                    value={falta}
                    onChange={setFalta}
                    options={faltas.map(f => ({ value: f.clave, label: f.articulo ? `${f.nombre} — ${f.articulo}` : f.nombre }))}
                    placeholder="-- Elegir la falta --"
                    disabled={guardando}
                    clearable={false}
                />

                {cargando && (
                    <p className="flex items-center gap-2 text-body-sm text-content-3">
                        <Loader2 size={15} className="animate-spin" /> Revisando los antecedentes…
                    </p>
                )}

                {escalera && !cargando && (
                    <>
                        {/* En qué se apoya la propuesta. Va ANTES de los peldaños: se
                            lee el motivo y después se elige, no al revés. */}
                        <Notice variant={escalera.faltas_en_60_dias > 0 ? 'warning' : 'info'} icon={Info}>
                            {escalera.faltas_en_60_dias > 0
                                ? `${escalera.faltas_en_60_dias} falta(s) en los últimos 60 días. El Art. 83 permite subir de peldaño por reincidencia.`
                                : escalera.verbales_misma_causa > 0
                                    ? `${escalera.verbales_misma_causa} amonestación(es) verbal(es) por esta misma causa. El num. 2 permite pasar a la escrita.`
                                    : 'Sin antecedentes que habiliten subir de peldaño.'}
                            {escalera.rectificado_el && ` Se cuenta desde el memorando del Art. 86 del ${fmtFecha(escalera.rectificado_el)}.`}
                        </Notice>

                        <div className="space-y-2">
                            <p className="text-caption uppercase tracking-widest text-content-3 font-black">Sanción</p>
                            {PELDANOS.map(p => {
                                const elegido   = peldano === p.n;
                                const propuesto = escalera.peldano === p.n;
                                return (
                                    <button
                                        key={p.n}
                                        type="button"
                                        disabled={p.noElegible || guardando}
                                        onClick={() => setPeldano(p.n)}
                                        data-surface="card"
                                        className={`w-full text-left px-4 py-3 min-h-[var(--tap-min)] flex items-start gap-3
                                                    active:scale-[0.97] transition-transform duration-[var(--dur-fast)]
                                                    ${elegido ? 'ring-2 ring-brand/45' : ''}
                                                    ${p.noElegible ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <span className="text-body-sm font-black tabular-nums text-content-3 w-4 shrink-0">{p.n}</span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-2 flex-wrap">
                                                <span className="text-body-sm font-bold text-content-1">{p.nombre}</span>
                                                {propuesto && <Badge size="sm" variant="brand">Propuesta</Badge>}
                                                {p.noElegible && <Badge size="sm" variant="neutral">Se registra como baja</Badge>}
                                            </span>
                                            <span className="block text-caption text-content-3">{p.detalle}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {antecedentes.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="text-caption uppercase tracking-widest text-content-3 font-black">Antecedentes</p>
                                {antecedentes.slice(0, 6).map(a => (
                                    <div key={a.id} data-surface="card" className="flex items-center gap-3 px-3 py-2">
                                        <span className="text-caption tabular-nums text-content-3 w-[86px] shrink-0">{fmtFecha(a.date)}</span>
                                        <span className="text-caption text-content-2 flex-1 min-w-0 truncate">
                                            {EVENT_TYPES[a.type]?.label || a.type}
                                        </span>
                                        {a.reclamo === 'REVOCADA' && <Badge size="sm" variant="neutral">Revocada</Badge>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <PortalInput
                        name="fecha" label="Fecha" type="date"
                        value={fecha} onChange={e => setFecha(e.target.value)} disabled={guardando}
                    />
                    {esSuspension && (
                        <PortalInput
                            name="dias" label="Días sin goce de salario" inputMode="numeric"
                            value={dias} onChange={e => setDias(e.target.value)}
                            disabled={guardando || peldano === 3}
                        />
                    )}
                </div>

                {peldano === 4 && (
                    <>
                        <Notice variant="warning" icon={AlertTriangle}>
                            Una suspensión de más de un día necesita la autorización y calificación de
                            motivos del Director General de Inspección de Trabajo. Sin ese dato no se guarda.
                        </Notice>
                        <PortalInput
                            name="autorizacion" label="Autorización del Director General de Inspección de Trabajo"
                            placeholder="Resolución y fecha"
                            value={autorizacion} onChange={e => setAutoriz(e.target.value)} disabled={guardando}
                        />
                    </>
                )}

                <PortalTextarea
                    name="nota" label="Qué pasó" rows={3}
                    placeholder="Los hechos, en las palabras de quien los presenció"
                    value={nota} onChange={e => setNota(e.target.value)} disabled={guardando}
                />

                {/* La constancia firmada NO se sustituye con este formulario: el
                    Art. 83 pide la firma de ambas partes y el compromiso escrito
                    «con puño y letra». Se imprime, se firma y se sube al
                    expediente colgada de este mismo registro. */}
                <Notice variant="info" icon={Info}>
                    Después de guardar, imprimí la constancia, firmala con el trabajador y subila
                    al expediente: el reglamento exige la firma de ambas partes.
                </Notice>

                <div className="flex gap-3 justify-end">
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button variant="primary" onClick={guardar} disabled={!puedeGuardar}>
                        {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando…</> : 'Registrar sanción'}
                    </Button>
                </div>
            </div>
        </ModalShell>
    );
}
