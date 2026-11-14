import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, FileText, Scale, UserMinus, XCircle, Calculator, ClipboardCheck, Printer, CheckCircle2, Circle, ArrowRight, PackageCheck } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalTextarea from '../common/PortalTextarea';
import PortalInput from '../common/PortalInput';
import Checkbox from '../common/Checkbox';
import Badge from '../common/Badge';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import { irAlCampo } from '../../plataforma/irAlCampo';
import { TERMINATION_REASONS, opcionesDeCatalogo } from '@nucleo/data/constants';
import {
    CAUSALES_ART_50, DOCUMENTO_DE_BAJA, DIAS_DE_LA_SEMANA, SALARIO_MINIMO_INICIAL, avisosDeBaja, pendientesDeBaja, diasDePreaviso, liquidacionEstimada,
    requisitosDeBaja, respaldoDeBajaObligatorio, estadoDeActivos, conActivo,
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

const DEVOLUCION = [
    // Se pregunta «¿lo devolvió?» y se responde con un verbo: «Pendiente» no
    // decía si no lo devolvió o si nunca lo tuvo (2026-11-14, pedido del usuario).
    { value: 'SI', label: 'Devolvió', tone: 'success' },
    { value: 'NO', label: 'No devolvió', tone: 'warning' },
    { value: 'NA', label: 'No tenía', tone: 'neutro' },
];

/**
 * Un campo de la baja, marcado con `data-campo` para que «lo que falta» y el
 * aviso del pie puedan llevar hasta él (`irAlCampo`). Si es el SIGUIENTE que
 * falta, dice debajo qué le falta — en el campo, no sólo al pie del modal.
 */
function Campo({ campo, rotulo, siguiente, children, ayuda, className = '' }) {
    return (
        <div data-campo={campo} data-falta={siguiente ? '' : undefined} className={className}>
            {rotulo && <label className={rotuloCampo(siguiente ? 'text-warning-text' : undefined)}>{rotulo}</label>}
            {children}
            {siguiente ? (
                <p className="flex gap-1.5 items-start text-caption font-semibold text-warning-text mt-1.5" role="status">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" /> <span>{siguiente}</span>
                </p>
            ) : ayuda ? <p className="text-caption text-content-3 mt-1">{ayuda}</p> : null}
        </div>
    );
}

/** El título de una sección del formulario: ícono, nombre y, a la derecha, su estado. */
function TituloSeccion({ icon: Icon, children, estado }) {
    return (
        <div className="flex items-center gap-2">
            <Icon size={16} className="text-content-2 shrink-0" />
            <span className="text-label font-black uppercase tracking-widest text-content-2 flex-1 min-w-0">{children}</span>
            {estado}
        </div>
    );
}

/**
 * Lo que falta para registrar la baja, a la vista y de un toque: cada renglón
 * lleva a su campo. Antes sólo se decía UNA cosa al pie del modal, lejos del
 * campo, y al resolverla aparecía la siguiente (2026-11-14).
 */
function LoQueFalta({ requisitos, onIr }) {
    const listos = requisitos.filter((r) => !r.problema).length;
    const total = requisitos.length;
    const siguiente = requisitos.find((r) => r.problema);
    const pct = total ? Math.round((listos / total) * 100) : 0;
    return (
        <div data-surface="card" data-tono={siguiente ? 'warning' : 'success'} className="p-4 space-y-3">
            <div className="flex items-center gap-3">
                {siguiente
                    ? <AlertTriangle size={18} className="text-warning-text shrink-0" />
                    : <CheckCircle2 size={18} className="text-success-text shrink-0" />}
                <div className="flex-1 min-w-0">
                    <p className="text-body font-black text-content">
                        {siguiente ? 'Falta completar para registrar la baja' : 'Todo listo para registrar la baja'}
                    </p>
                    <p className="text-caption text-content-3">
                        {siguiente ? `${listos} de ${total} listos · toca uno para ir a ese campo` : 'Revisa la liquidación y el cierre antes de guardar.'}
                    </p>
                </div>
                <span className={`text-body-lg font-black tabular-nums ${siguiente ? 'text-warning-text' : 'text-success-text'}`}>{listos}/{total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-card-hover overflow-hidden" aria-hidden="true">
                <div className={`h-full rounded-full transition-[width] duration-[var(--dur-slow)] ${siguiente ? 'bg-warning-solid' : 'bg-success-solid'}`} style={{ width: `${pct}%` }} />
            </div>
            {siguiente && (
                <div className="flex flex-wrap gap-2">
                    {requisitos.map((r) => {
                        const esSiguiente = r === siguiente;
                        return r.problema ? (
                            <Button key={r.campo} size="xs" icon={esSiguiente ? ArrowRight : Circle}
                                variant={esSiguiente ? undefined : 'secondary'} tone={esSiguiente ? 'warning' : null} soft={esSiguiente}
                                title={r.problema} onClick={() => onIr(r.campo)}>
                                {r.rotulo}
                            </Button>
                        ) : (
                            <Button key={r.campo} size="xs" variant="ghost" icon={CheckCircle2} onClick={() => onIr(r.campo)}>
                                <span className="text-success-text">{r.rotulo}</span>
                            </Button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

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

    // Lo que falta, campo por campo, más los dos que viven fuera de este
    // bloque (las observaciones y el respaldo, en FormNovedad).
    const requisitos = useMemo(() => {
        const lista = requisitosDeBaja(formData, empleado);
        if (!motivo) return lista;
        lista.push({ campo: 'note', rotulo: 'Observaciones', problema: String(formData?.note || '').trim() ? null : 'Escribe las observaciones o la justificación.' });
        if (respaldoDeBajaObligatorio(motivo) && !formData?._editingEventId) {
            lista.push({ campo: 'file', rotulo: 'Respaldo firmado', problema: formData?.file ? null : 'Falta adjuntar el respaldo.' });
        }
        return lista;
    }, [formData, empleado, motivo]);
    const siguiente = requisitos.find((r) => r.problema);
    // El problema de un campo SÓLO si es el siguiente que falta: marcar en
    // rojo todo lo vacío desde el primer segundo es regañar, no guiar.
    const falta = (campo) => (siguiente?.campo === campo ? siguiente.problema : null);
    const raiz = useRef(null);
    const ir = (campo) => irAlCampo(campo, raiz.current?.closest('form') || document);

    const activos = estadoDeActivos(formData);
    const pendientes = pendientesDeBaja(motivo);
    const cierreListos = pendientes.filter((p) => formData?.[p.clave]).length + (activos.completo ? 1 : 0);
    const cierreTotal = pendientes.length + 1;

    return (
        <div ref={raiz} className="col-span-1 md:col-span-2 relative z-content animate-in fade-in space-y-4">
            <div data-surface="card" data-tono="danger" className="p-4">
                <Campo campo="terminationReason" siguiente={falta('terminationReason')}>
                    <label className={rotuloCampo('text-danger-text')}>Motivo legal de la baja</label>
                    <LiquidSelect value={motivo} onChange={(v) => poner('terminationReason', v)} options={opcionesDeCatalogo(TERMINATION_REASONS)}
                        placeholder="Seleccionar causa..." icon={UserMinus} menuPosition="fixed" />
                </Campo>
            </div>

            {motivo && (
                <>
                    <LoQueFalta requisitos={requisitos} onIr={ir} />

                    {/* ── Fechas y requisitos legales ───────────────────── */}
                    <div data-surface="card" className="p-4 space-y-4">
                        <TituloSeccion icon={Scale}>Fechas y requisitos legales</TituloSeccion>

                        <Campo campo="ultimoDiaLaborado" rotulo="Último día que trabajó" siguiente={falta('ultimoDiaLaborado')}>
                            <div className="h-[40px]">
                                <LiquidDatePicker value={formData?.ultimoDiaLaborado || ''} onChange={(v) => poner('ultimoDiaLaborado', v || null)} icon={CalendarDays} max={formData?.date || undefined} />
                            </div>
                        </Campo>

                        {esRenuncia && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Campo campo="hojaRenunciaExpedida" rotulo="Hoja oficial expedida el" siguiente={falta('hojaRenunciaExpedida')}>
                                    <div className="h-[40px]">
                                        <LiquidDatePicker value={formData?.hojaRenunciaExpedida || ''} onChange={(v) => poner('hojaRenunciaExpedida', v || null)} icon={FileText} />
                                    </div>
                                </Campo>
                                <Campo campo="renunciaPresentada" rotulo="La presentó el" siguiente={falta('renunciaPresentada')}>
                                    <div className="h-[40px]">
                                        <LiquidDatePicker value={formData?.renunciaPresentada || ''} onChange={(v) => poner('renunciaPresentada', v || null)} icon={CalendarDays} />
                                    </div>
                                </Campo>
                                <p className="md:col-span-2 text-caption text-content-3">
                                    La renuncia sólo vale en la hoja del Ministerio de Trabajo o del juzgado, presentada dentro de los 10 días de expedida (Art. 402 CT).
                                </p>
                            </div>
                        )}

                        {esDespido && (
                            <Campo campo="fueroDeclarado" rotulo="¿Tiene fuero?" siguiente={falta('fueroDeclarado')}
                                ayuda="Una embarazada, desde el embarazo hasta 6 meses después del descanso postnatal (Art. 113 CT); quien tiene una incapacidad vigente; o directivos de un sindicato, durante su cargo y un año después (Art. 248 CT). Con fuero, el despido no termina el contrato.">
                                <LiquidSelect value={formData?.fueroDeclarado || ''} onChange={(v) => poner('fueroDeclarado', v)} options={FUERO}
                                    placeholder="Responder..." icon={Scale} menuPosition="fixed" />
                            </Campo>
                        )}

                        {esSinResp && (
                            <>
                                <Campo campo="causalArt50" rotulo="Causal (Art. 50 CT)" siguiente={falta('causalArt50')}>
                                    <LiquidSelect value={formData?.causalArt50 ? String(formData.causalArt50) : ''} onChange={(v) => poner('causalArt50', v ? Number(v) : null)}
                                        options={causales} placeholder="Elegir causal..." icon={Scale} menuPosition="fixed" />
                                </Campo>
                                <Campo campo="fechaDeLosHechos" rotulo="Fecha de los hechos" siguiente={falta('fechaDeLosHechos')}>
                                    <div className="h-[40px]">
                                        <LiquidDatePicker value={formData?.fechaDeLosHechos || ''} onChange={(v) => poner('fechaDeLosHechos', v || null)} icon={CalendarDays} />
                                    </div>
                                </Campo>
                                <Campo campo="pruebas" siguiente={falta('pruebas')}>
                                    <PortalTextarea label="Pruebas de la causal" rows={3} value={formData?.pruebas || ''}
                                        onChange={(e) => poner('pruebas', e.target.value)}
                                        placeholder="Actas, testigos, sanciones previas, cámaras, reportes…" />
                                </Campo>
                            </>
                        )}

                        {pideAusencias && (
                            <Campo campo="diaDeDescanso" rotulo="Su día de descanso semanal"
                                ayuda="Si falta el sábado y el lunes y el domingo es su descanso, son dos días laborales seguidos.">
                                <LiquidSelect value={formData?.diaDeDescanso != null ? String(formData.diaDeDescanso) : ''} clearable
                                    onChange={(v) => poner('diaDeDescanso', v === '' || v == null ? null : Number(v))}
                                    options={DIAS_DE_LA_SEMANA.map((d, i) => ({ value: String(i), label: d }))}
                                    placeholder="Opcional" icon={CalendarDays} menuPosition="fixed" />
                            </Campo>
                        )}

                        {pideAusencias && (
                            <Campo campo="diasDeAusencia" rotulo="Días que faltó sin permiso" siguiente={falta('diasDeAusencia')}>
                                <div className="space-y-2">
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
                            </Campo>
                        )}

                        {motivo === 'ABANDONO' && (
                            <Campo campo="intentoDeContacto" siguiente={falta('intentoDeContacto')}>
                                <PortalTextarea label="Cómo se le intentó contactar" rows={2} value={formData?.intentoDeContacto || ''}
                                    onChange={(e) => poner('intentoDeContacto', e.target.value)}
                                    placeholder="Llamadas, mensajes, visita al domicilio — con fechas" />
                            </Campo>
                        )}

                        {avisos.map((a) => (
                            <div key={a} className="flex gap-2 items-start text-caption text-warning-text">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{a}</span>
                            </div>
                        ))}
                    </div>

                    {/* ── Respaldo ──────────────────────────────────────── */}
                    <div data-surface="card" className="p-4 space-y-2">
                        <TituloSeccion icon={FileText}
                            estado={<Badge variant={respaldoDeBajaObligatorio(motivo) ? 'warning' : 'neutral'} size="sm">{respaldoDeBajaObligatorio(motivo) ? 'Obligatorio' : 'Puede ir después'}</Badge>}>
                            Respaldo
                        </TituloSeccion>
                        <p className="text-body-sm text-content-2">Se adjunta al final: {DOCUMENTO_DE_BAJA[motivo]}.</p>
                        {conActa && (
                            <div className="space-y-1 pt-1">
                                <Button variant="secondary" size="sm" icon={Printer} onClick={imprimirActaYCarta}>Imprimir acta y carta</Button>
                                <p className="text-caption text-content-3">
                                    La persona no tiene que firmar: la carta la firma el patrono o su representante, y se entrega o se envía a su domicilio (Art. 55 CT).
                                </p>
                                {errorPapel && <p className="text-caption text-warning-text">{errorPapel}</p>}
                            </div>
                        )}
                    </div>

                    {/* La liquidación: estimación para revisar, no un monto a pagar.
                        Los dos campos van FUERA del cálculo: antes vivían dentro y,
                        al borrar el salario mínimo, el cálculo daba vacío y se
                        llevaba la casilla con él — no había dónde volver a
                        escribirlo (2026-11-11). */}
                    <div data-surface="card" className="p-4 space-y-3">
                        <TituloSeccion icon={Calculator}
                            estado={liquidacion && salario != null && minimoValido && ingreso && formData?.date
                                ? <span className="text-body font-black tabular-nums text-content">{formatMoney(acordado > 0 ? acordado : liquidacion.total)}</span> : null}>
                            Liquidación
                        </TituloSeccion>
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
                                        <ul className="divide-y divide-border-card">
                                            {liquidacion.rubros.map((r) => (
                                                <li key={r.clave} className="flex justify-between gap-3 py-2 text-body-sm">
                                                    <span className={r.aplica === true ? 'text-content' : 'text-content-3'}>
                                                        {r.texto}
                                                        {r.aplica === 'revisar' && <Badge variant="warning" size="sm" uppercase={false} className="ml-2">Consultar con el abogado · no se suma</Badge>}
                                                        {r.aplica === false && <Badge variant="neutral" size="sm" uppercase={false} className="ml-2">No corresponde</Badge>}
                                                        <span className="block text-caption text-content-3">{r.base}</span>
                                                    </span>
                                                    <span className={`font-bold tabular-nums ${r.aplica === true ? 'text-content' : 'text-content-3'}`}>{formatMoney(r.monto)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <div className="flex justify-between border-t border-border-card pt-2 text-body font-black">
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

                    {/* ── Cierre: no frena el registro, se anota ─────────────
                        Lo que se le entregó va artículo por artículo: con una
                        sola casilla, quien devolvía todo menos el uniforme no
                        tenía respuesta (2026-11-14). */}
                    <div data-surface="card" className="p-4 space-y-3">
                        <TituloSeccion icon={ClipboardCheck}
                            estado={<Badge variant={cierreListos === cierreTotal ? 'success' : 'neutral'} size="sm" uppercase={false}>{cierreListos} de {cierreTotal}</Badge>}>
                            Cierre
                        </TituloSeccion>
                        <p className="text-caption text-content-3 -mt-1">No impide guardar: se puede completar después, corrigiendo la baja desde el historial.</p>

                        <div data-campo="activosDevueltos" className="rounded-2xl border border-border-card p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <PackageCheck size={15} className={activos.completo ? 'text-success-text' : 'text-content-2'} />
                                <span className="text-body-sm font-bold text-content flex-1">¿Devolvió lo que se le entregó?</span>
                                {activos.pendientes.length > 0 && (
                                    <Badge variant="warning" size="sm" uppercase={false}>No devolvió: {activos.pendientes.map((a) => a.texto.toLowerCase()).join(', ')}</Badge>
                                )}
                            </div>
                            <ul className="divide-y divide-border-card">
                                {activos.items.map((a) => (
                                    <li key={a.clave} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
                                        <span className="flex-1 min-w-0 text-body-sm text-content-2">
                                            ¿Devolvió {a.pregunta}?{a.detalle && <span className="block text-caption text-content-3">{a.detalle}</span>}
                                        </span>
                                        <SegmentedControl size="sm" label={`${a.texto}: ¿lo devolvió?`} options={DEVOLUCION} value={a.estado}
                                            onChange={(v) => setFormData((prev) => ({ ...prev, ...conActivo(prev, a.clave, v) }))} />
                                    </li>
                                ))}
                            </ul>
                            {activos.pendientes.length > 0 && (
                                <p className="text-caption text-content-3">Anota en las observaciones qué no devolvió y cuándo lo va a hacer.</p>
                            )}
                        </div>

                        <div className="space-y-1">
                            {pendientes.map((p) => (
                                <Checkbox key={p.clave} size="sm" checked={!!formData?.[p.clave]} onChange={(v) => poner(p.clave, v)}
                                    label={<span className="text-body-sm text-content-2">{p.texto}</span>} />
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
