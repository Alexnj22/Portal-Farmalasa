import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, FileText, Scale, UserMinus, XCircle, Calculator, ClipboardCheck } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalTextarea from '../common/PortalTextarea';
import PortalInput from '../common/PortalInput';
import Checkbox from '../common/Checkbox';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { TERMINATION_REASONS, opcionesDeCatalogo } from '@nucleo/data/constants';
import {
    CAUSALES_ART_50, DOCUMENTO_DE_BAJA, PENDIENTES_DE_BAJA, avisosDeBaja, liquidacionEstimada,
} from '@nucleo/utils/bajaLegal';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { formatDate } from '@nucleo/utils/helpers';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

/* El salario mínimo de comercio y servicios vigente desde el 1 de junio de 2025
 * (Decreto Ejecutivo de ese año, +12%). Va como valor inicial EDITABLE y se
 * guarda con la baja: si cambia, quien registra lo corrige y la liquidación
 * queda calculada con el número que se usó. */
const MINIMO_INICIAL = 408.8;

const FUERO = [
    { value: 'NO', label: 'No' },
    { value: 'SI', label: 'Sí — embarazo, postnatal, incapacidad o directiva sindical' },
];

/**
 * Lo que la ley pide para dar de baja a alguien, según el motivo. Vive dentro
 * de `FormNovedad` cuando el tipo es TERMINATION; lo que se escribe acá viaja
 * en `metadata` del evento. Las reglas están en `utils/bajaLegal.js`.
 */
export default function BajaLegal({ formData, setFormData, empleado }) {
    const motivo = formData?.terminationReason || '';
    const poner = (campo, valor) => setFormData((prev) => ({ ...prev, [campo]: valor }));
    const [claveAusencia, setClaveAusencia] = useState(0);

    const esRenuncia = motivo === 'RENUNCIA';
    const esSinResp = motivo === 'DESPIDO_SIN_RESPONSABILIDAD';
    const esDespido = esSinResp || motivo === 'DESPIDO_CON_RESPONSABILIDAD' || motivo === 'ABANDONO';
    const pideAusencias = motivo === 'ABANDONO' || (esSinResp && Number(formData?.causalArt50) === 12);

    const salario = empleado?.base_salary ?? empleado?.salary ?? null;
    const ingreso = empleado?.hire_date || empleado?.hireDate || null;
    // Se guarda como se escribe (para poder borrarlo y teclear otro); se calcula con el número.
    const minimoTexto = formData?.salarioMinimoUsado ?? MINIMO_INICIAL;
    const minimo = Number(String(minimoTexto).replace(',', '.'));

    const liquidacion = useMemo(() => liquidacionEstimada({
        motivo, salarioMensual: salario, ingreso, baja: formData?.date, salarioMinimoMensual: minimo,
    }), [motivo, salario, ingreso, formData?.date, minimo]);

    // La estimación se guarda con la baja: es lo que se le dijo a quien
    // registró, con el mínimo que se usó. Sólo se escribe si cambió.
    useEffect(() => {
        const nueva = liquidacion ? { total: liquidacion.total, rubros: liquidacion.rubros, aniosDeServicio: liquidacion.aniosDeServicio } : null;
        if (JSON.stringify(nueva) !== JSON.stringify(formData?.liquidacionEstimada ?? null)) {
            setFormData((prev) => ({ ...prev, liquidacionEstimada: nueva, salarioMinimoUsado: minimoTexto }));
        }
    }, [liquidacion]); // eslint-disable-line react-hooks/exhaustive-deps

    const avisos = avisosDeBaja(formData, empleado);
    const causales = CAUSALES_ART_50.map((c) => ({ value: String(c.n), label: `${c.n}. ${c.texto}` }));
    const ausencias = formData?.diasDeAusencia || [];

    return (
        <div className="col-span-1 md:col-span-2 relative z-content animate-in fade-in bg-danger/10 p-4 border border-danger/30 rounded-3xl space-y-4">
            <div>
                <label className={rotuloCampo('text-danger')}>Motivo legal de la baja</label>
                <LiquidSelect value={motivo} onChange={(v) => poner('terminationReason', v)} options={opcionesDeCatalogo(TERMINATION_REASONS)}
                    placeholder="Seleccionar causa..." icon={UserMinus} menuPosition="fixed" />
            </div>

            {motivo && (
                <>
                    <div>
                        <label className={rotuloCampo()}>Último día que trabajó</label>
                        <div className="h-[40px]">
                            <LiquidDatePicker value={formData?.ultimoDiaLaborado || ''} onChange={(v) => poner('ultimoDiaLaborado', v || null)} icon={CalendarDays} max={formData?.date || undefined} />
                        </div>
                    </div>

                    {esRenuncia && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className={rotuloCampo()}>Hoja oficial expedida el</label>
                                <div className="h-[40px]">
                                    <LiquidDatePicker value={formData?.hojaRenunciaExpedida || ''} onChange={(v) => poner('hojaRenunciaExpedida', v || null)} icon={FileText} />
                                </div>
                            </div>
                            <div>
                                <label className={rotuloCampo()}>La presentó el</label>
                                <div className="h-[40px]">
                                    <LiquidDatePicker value={formData?.renunciaPresentada || ''} onChange={(v) => poner('renunciaPresentada', v || null)} icon={CalendarDays} />
                                </div>
                            </div>
                            <p className="md:col-span-2 text-caption text-content-3">
                                La renuncia sólo vale en la hoja del Ministerio de Trabajo o del juzgado, presentada dentro de los 10 días de expedida (Art. 402 CT).
                            </p>
                        </div>
                    )}

                    {esDespido && (
                        <div>
                            <label className={rotuloCampo()}>¿Tiene fuero?</label>
                            <LiquidSelect value={formData?.fueroDeclarado || ''} onChange={(v) => poner('fueroDeclarado', v)} options={FUERO}
                                placeholder="Responder..." icon={Scale} menuPosition="fixed" />
                            <p className="text-caption text-content-3 mt-1">Embarazo, descanso postnatal, incapacidad vigente o directiva sindical.</p>
                        </div>
                    )}

                    {esSinResp && (
                        <>
                            <div>
                                <label className={rotuloCampo()}>Causal (Art. 50 CT)</label>
                                <LiquidSelect value={formData?.causalArt50 ? String(formData.causalArt50) : ''} onChange={(v) => poner('causalArt50', v ? Number(v) : null)}
                                    options={causales} placeholder="Elegir causal..." icon={Scale} menuPosition="fixed" />
                            </div>
                            <div>
                                <label className={rotuloCampo()}>Fecha de los hechos</label>
                                <div className="h-[40px]">
                                    <LiquidDatePicker value={formData?.fechaDeLosHechos || ''} onChange={(v) => poner('fechaDeLosHechos', v || null)} icon={CalendarDays} />
                                </div>
                            </div>
                            <PortalTextarea label="Pruebas de la causal" rows={3} value={formData?.pruebas || ''}
                                onChange={(e) => poner('pruebas', e.target.value)}
                                placeholder="Actas, testigos, sanciones previas, cámaras, reportes…" />
                        </>
                    )}

                    {pideAusencias && (
                        <div className="space-y-2">
                            <label className={rotuloCampo()}>Días que faltó sin permiso</label>
                            <div className="h-[40px]">
                                <LiquidDatePicker key={claveAusencia} value="" icon={CalendarDays} selectedDates={ausencias}
                                    onChange={(v) => {
                                        if (v && !ausencias.includes(v)) poner('diasDeAusencia', [...ausencias, v].sort());
                                        setClaveAusencia((k) => k + 1);
                                    }} />
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {ausencias.map((d) => (
                                    <Badge key={d} variant="danger" uppercase={false}>
                                        {formatDate(d)}
                                        <Button variant="ghost" icon={XCircle} iconOnly aria-label={`Quitar ${formatDate(d)}`}
                                            onClick={() => poner('diasDeAusencia', ausencias.filter((x) => x !== d))} />
                                    </Badge>
                                ))}
                                {ausencias.length === 0 && <span className="text-caption text-content-3 italic">Ninguno todavía. Cuentan 2 días seguidos, o 3 en un mismo mes.</span>}
                            </div>
                        </div>
                    )}

                    {motivo === 'ABANDONO' && (
                        <PortalTextarea label="Cómo se le intentó contactar" rows={2} value={formData?.intentoDeContacto || ''}
                            onChange={(e) => poner('intentoDeContacto', e.target.value)}
                            placeholder="Llamadas, mensajes, visita al domicilio — con fechas" />
                    )}

                    <p className="text-caption text-content-2">
                        <b>Respaldo que se adjunta abajo:</b> {DOCUMENTO_DE_BAJA[motivo]}.
                    </p>

                    {avisos.map((a) => (
                        <div key={a} className="flex gap-2 items-start text-caption text-warning-text">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{a}</span>
                        </div>
                    ))}

                    {/* La liquidación: estimación para revisar, no un monto a pagar. */}
                    <div data-surface="card" className="p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <Calculator size={16} className="text-content-2" />
                            <span className="text-label font-black uppercase tracking-widest text-content-2">Liquidación estimada</span>
                        </div>
                        {salario == null ? (
                            <p className="text-caption text-content-3">Sin acceso al salario: la estimación la ve quien tiene el permiso de Salarios.</p>
                        ) : !ingreso || !formData?.date ? (
                            <p className="text-caption text-content-3">Falta la fecha de ingreso o la fecha de baja para calcularla.</p>
                        ) : liquidacion && (
                            <>
                                <ul className="space-y-1">
                                    {liquidacion.rubros.map((r) => (
                                        <li key={r.clave} className="flex justify-between gap-3 text-body-sm">
                                            <span className={r.aplica === true ? 'text-content' : 'text-content-3'}>
                                                {r.texto}{r.aplica === 'revisar' ? ' (a revisar)' : r.aplica === false ? ' (no aplica)' : ''}
                                                <span className="block text-caption text-content-3">{r.base}</span>
                                            </span>
                                            <span className="font-bold tabular-nums">{formatMoney(r.monto)}</span>
                                        </li>
                                    ))}
                                </ul>
                                <div className="flex justify-between border-t border-line pt-2 text-body font-black">
                                    <span>Total estimado</span><span className="tabular-nums">{formatMoney(liquidacion.total)}</span>
                                </div>
                                <p className="text-caption text-content-3">
                                    {liquidacion.aniosDeServicio} años de servicio. El salario de los días trabajados va en la planilla. Revísalo con el contador o el abogado antes de pagar.
                                </p>
                                <PortalInput name="salarioMinimoUsado" label="Salario mínimo mensual usado" inputMode="decimal" maskType="DECIMAL"
                                    value={String(minimoTexto)} onChange={(e) => poner('salarioMinimoUsado', e.target.value)} />
                            </>
                        )}
                    </div>

                    <div data-surface="card" data-tono="danger" className="p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <ClipboardCheck size={16} className="text-content-2" />
                            <span className="text-label font-black uppercase tracking-widest text-content-2">Cierre (se puede completar después)</span>
                        </div>
                        {PENDIENTES_DE_BAJA.map((p) => (
                            <Checkbox key={p.clave} size="sm" checked={!!formData?.[p.clave]} onChange={(v) => poner(p.clave, v)}
                                label={<span className="text-body-sm text-content-2">{p.texto}</span>} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
