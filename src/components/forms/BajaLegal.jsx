import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, FileText, Scale, UserMinus, XCircle, Calculator, ClipboardCheck, Printer } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalTextarea from '../common/PortalTextarea';
import PortalInput from '../common/PortalInput';
import Checkbox from '../common/Checkbox';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { TERMINATION_REASONS, opcionesDeCatalogo } from '@nucleo/data/constants';
import {
    CAUSALES_ART_50, DOCUMENTO_DE_BAJA, DIAS_DE_LA_SEMANA, SALARIO_MINIMO_INICIAL, avisosDeBaja, pendientesDeBaja, diasDePreaviso, liquidacionEstimada,
} from '@nucleo/utils/bajaLegal';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { useStaffStore } from '@nucleo/store/staffStore';
import { registrarEgreso } from '@nucleo/data/egreso';
import { abrirVentanaDeImpresion, escribirEImprimir, VENTANA_BLOQUEADA } from '../../plataforma/ventanaDeImpresion';
import { formatDate } from '@nucleo/utils/helpers';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

// El salario mínimo inicial (editable) vive en el núcleo: lo usa también la app.
const MINIMO_INICIAL = SALARIO_MINIMO_INICIAL;

const FUERO = [
    { value: 'NO', label: 'No' },
    { value: 'SI', label: 'Sí — embarazada o en los 6 meses después del postnatal, incapacitada o directiva sindical' },
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
    const [errorPapel, setErrorPapel] = useState(null);
    const sucursales = useStaffStore((s) => s.branches);

    const esRenuncia = motivo === 'RENUNCIA';
    const esSinResp = motivo === 'DESPIDO_SIN_RESPONSABILIDAD';
    const esDespido = esSinResp || motivo === 'DESPIDO_CON_RESPONSABILIDAD' || motivo === 'ABANDONO';
    const pideAusencias = motivo === 'ABANDONO' || (esSinResp && Number(formData?.causalArt50) === 12);

    const salario = empleado?.base_salary ?? empleado?.salary ?? null;
    const ingreso = empleado?.hire_date || empleado?.hireDate || null;
    // Se guarda como se escribe (para poder borrarlo y teclear otro); se calcula con el número.
    const minimoTexto = formData?.salarioMinimoUsado ?? MINIMO_INICIAL;
    const minimo = Number(String(minimoTexto).replace(',', '.'));
    const minimoValido = minimo > 0;
    // Lo que de verdad se va a pagar, si no es lo estimado: lo negoció la
    // empresa o lo calculó el contador. Opcional; vacío = se paga lo estimado.
    const acordadoTexto = formData?.montoAcordado ?? '';
    const acordado = Number(String(acordadoTexto).replace(',', '.'));

    const preavisoDias = diasDePreaviso(formData);
    const liquidacion = useMemo(() => liquidacionEstimada({
        motivo, salarioMensual: salario, ingreso, baja: formData?.date, salarioMinimoMensual: minimo, preavisoDias,
    }), [motivo, salario, ingreso, formData?.date, minimo, preavisoDias]);

    // La estimación se guarda con la baja: es lo que se le dijo a quien
    // registró, con el mínimo que se usó. Sólo se escribe si cambió.
    useEffect(() => {
        const nueva = liquidacion ? { total: liquidacion.total, rubros: liquidacion.rubros, aniosDeServicio: liquidacion.aniosDeServicio } : null;
        if (JSON.stringify(nueva) !== JSON.stringify(formData?.liquidacionEstimada ?? null)) {
            setFormData((prev) => ({ ...prev, liquidacionEstimada: nueva, salarioMinimoUsado: minimoTexto }));
        }
    }, [liquidacion]); // eslint-disable-line react-hooks/exhaustive-deps

    // El acta de inasistencias y la carta del patrono (Art. 55 CT): se imprimen
    // con lo llenado, se firman y se suben después (`papelDeBaja`).
    const imprimirActaYCarta = async () => {
        setErrorPapel(null);
        const win = abrirVentanaDeImpresion({ ancho: 1000, alto: 800 });
        if (!win) { setErrorPapel(VENTANA_BLOQUEADA); return; }
        const papel = await import('@nucleo/utils/papelDeBaja').catch(() => null);
        if (!papel) {
            try { win.close(); } catch { /* ya no está */ }
            setErrorPapel('No se pudo preparar la impresión. Revisa tu conexión y vuelve a intentar.');
            return;
        }
        const sucursal = (sucursales || []).find((b) => String(b.id) === String(empleado?.branchId ?? empleado?.branch_id))?.name;
        const res = escribirEImprimir(win, papel.htmlDeActaYCarta({ empleado, sucursal, cargo: empleado?.role, formData }));
        if (!res.ok) { setErrorPapel(res.motivo); return; }
        registrarEgreso('personal', { formato: 'pdf', filas: 1, detalle: { papel: 'acta_y_carta_de_terminacion', employee_id: empleado?.id } });
    };
    const conActa = motivo === 'ABANDONO' || esSinResp;

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
                            <p className="text-caption text-content-3 mt-1">Una embarazada, desde el embarazo hasta 6 meses después del descanso postnatal (Art. 113 CT); quien tiene una incapacidad vigente; o directivos de un sindicato, durante su cargo y un año después (Art. 248 CT). Con fuero, el despido no termina el contrato.</p>
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
                        <div>
                            <label className={rotuloCampo()}>Su día de descanso semanal</label>
                            <LiquidSelect value={formData?.diaDeDescanso != null ? String(formData.diaDeDescanso) : ''} clearable
                                onChange={(v) => poner('diaDeDescanso', v === '' || v == null ? null : Number(v))}
                                options={DIAS_DE_LA_SEMANA.map((d, i) => ({ value: String(i), label: d }))}
                                placeholder="Opcional" icon={CalendarDays} menuPosition="fixed" />
                            <p className="text-caption text-content-3 mt-1">Si falta el sábado y el lunes y el domingo es su descanso, son dos días laborales seguidos.</p>
                        </div>
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
                    {conActa && (
                        <div className="space-y-1">
                            <Button variant="secondary" size="sm" icon={Printer} onClick={imprimirActaYCarta}>Imprimir acta y carta</Button>
                            <p className="text-caption text-content-3">
                                La persona no tiene que firmar: la carta la firma el patrono o su representante, y se entrega o se envía a su domicilio (Art. 55 CT).
                            </p>
                            {errorPapel && <p className="text-caption text-warning-text">{errorPapel}</p>}
                        </div>
                    )}

                    {avisos.map((a) => (
                        <div key={a} className="flex gap-2 items-start text-caption text-warning-text">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{a}</span>
                        </div>
                    ))}

                    {/* La liquidación: estimación para revisar, no un monto a pagar.
                        Los dos campos van FUERA del cálculo: antes vivían dentro y,
                        al borrar el salario mínimo, el cálculo daba vacío y se
                        llevaba la casilla con él — no había dónde volver a
                        escribirlo (2026-11-11). */}
                    <div data-surface="card" className="p-3 space-y-3">
                        <div className="flex items-center gap-2">
                            <Calculator size={16} className="text-content-2" />
                            <span className="text-label font-black uppercase tracking-widest text-content-2">Liquidación</span>
                        </div>
                        {salario == null ? (
                            <p className="text-caption text-content-3">Sólo la ve quien tiene permiso para ver salarios.</p>
                        ) : (
                            <>
                                {!ingreso || !formData?.date ? (
                                    <p className="text-caption text-content-3">Para calcularla faltan la fecha de ingreso de la ficha o la fecha de la baja.</p>
                                ) : !minimoValido ? (
                                    <p className="text-caption text-warning-text">Escribe el salario mínimo para calcularla.</p>
                                ) : liquidacion && (
                                    <>
                                        <ul className="space-y-1">
                                            {liquidacion.rubros.map((r) => (
                                                <li key={r.clave} className="flex justify-between gap-3 text-body-sm">
                                                    <span className={r.aplica === true ? 'text-content' : 'text-content-3'}>
                                                        {r.texto}{r.aplica === 'revisar' ? ' — consultar con el abogado, no se suma' : r.aplica === false ? ' — no corresponde' : ''}
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
                                            Calculado con {liquidacion.aniosDeServicio} años de servicio. Los días trabajados del último período se pagan en la planilla, no aquí. Es una estimación: confírmala con el contador o el abogado antes de pagar.
                                        </p>
                                    </>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <PortalInput name="salarioMinimoUsado" label="Salario mínimo mensual" inputMode="decimal" maskType="DECIMAL"
                                        value={String(minimoTexto)} onChange={(e) => poner('salarioMinimoUsado', e.target.value)}
                                        placeholder={String(MINIMO_INICIAL)} />
                                    <PortalInput name="montoAcordado" label="Total que se pagará" inputMode="decimal" maskType="DECIMAL"
                                        value={String(acordadoTexto)} onChange={(e) => poner('montoAcordado', e.target.value)}
                                        placeholder={liquidacion ? String(liquidacion.total) : 'Opcional'} />
                                </div>
                                <p className="text-caption text-content-3">
                                    El mínimo de comercio y servicios es ${MINIMO_INICIAL.toFixed(2)}; cámbialo si es otro. Si se pagará un total distinto al estimado —porque se negoció o porque el contador lo calculó—, escríbelo en «Total que se pagará». Si lo dejas vacío, se toma el estimado.
                                </p>
                                {acordado > 0 && liquidacion && Math.abs(acordado - liquidacion.total) >= 0.01 && (
                                    <p className="text-caption text-content-2">
                                        Se pagará <b>{formatMoney(acordado)}</b>, {formatMoney(Math.abs(acordado - liquidacion.total))} {acordado > liquidacion.total ? 'más' : 'menos'} que lo estimado. Quedan guardados los dos.
                                    </p>
                                )}
                            </>
                        )}
                    </div>

                    <div data-surface="card" data-tono="danger" className="p-3 space-y-2">
                        <div className="flex items-center gap-2">
                            <ClipboardCheck size={16} className="text-content-2" />
                            <span className="text-label font-black uppercase tracking-widest text-content-2">Cierre (se puede completar después)</span>
                        </div>
                        {pendientesDeBaja(motivo).map((p) => (
                            <Checkbox key={p.clave} size="sm" checked={!!formData?.[p.clave]} onChange={(v) => poner(p.clave, v)}
                                label={<span className="text-body-sm text-content-2">{p.texto}</span>} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
