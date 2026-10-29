/**
 * Personal › Seguro de vida colectivo.
 *
 * ── Lo que pidió el usuario (2026-10-14) ───────────────────────────────────
 *
 * «Debe haber un apartado general donde se suba foto del documento general, y
 * cada pago de cada año (envían un documento con el listado de personas que se
 * pagó, ahí debe reconocer y actualizar el estado a solvente). El documento
 * general es igual cada año, y como documento personal se agrega a cada
 * empleado el certificado del asegurado.»
 *
 * Tres bloques, en el orden en que se usan:
 *   1. el pago del periodo vigente — el único que cambia cada año;
 *   2. quién está solvente y a quién le falta el certificado;
 *   3. la póliza, que se carga una vez.
 *
 * ── El listado se PROPONE, no se aplica solo ───────────────────────────────
 *
 * Los nombres los lee un modelo sobre una foto. Igual que el acuse del
 * Ministerio (`AsignarDocumentoAVarios`): el portal cruza contra las fichas,
 * propone, y quien mira confirma. Alguien marcado «solvente» por un error de
 * lectura queda sin seguro sin que nadie lo note — justo el día que importa.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, X, Check, UserCheck, UserPlus, Loader2, AlertTriangle, FileText, FileWarning, Save, Pencil, Plus } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import FileField from '../../components/common/FileField';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { fetchPoliza, fetchPagos, guardarPoliza, subirArchivoDelSeguro, registrarPago } from '@nucleo/data/seguroDeVida';
import { primaPorPersona, periodoVigente, rotuloDelPeriodo, estadoEnElSeguro } from '@nucleo/utils/seguroDeVida';
import { cruzarConElPadron } from '@nucleo/data/documentosCompartidos';
import { analizarDocumento } from '@nucleo/data/ia';
import { getStoragePathFromUrl, openStoredFile } from '@nucleo/utils/storageFiles';
import { soloPersonalEnPlanilla } from '@nucleo/utils/tipoDeFicha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';

const dinero = (n) => formatMoney(n === '' ? null : n);

const tieneCertificado = (e) => (e.employee_documents || [])
    .some(d => d?.category === 'CERTIFICADO_SEGURO_VIDA' && d?.url);

export default function SeguroDeVidaColectivo({ open, onClose, canEdit }) {
    const employees = useStaff(s => s.employees);
    const appendAuditLog = useStaff(s => s.appendAuditLog);
    const toast = useToastStore(s => s.showToast);
    const activos = useMemo(
        () => soloPersonalEnPlanilla((employees || []).filter(e => e.status === 'ACTIVO'))
            .sort((a, b) => String(a.name).localeCompare(String(b.name))),
        [employees]);

    const [poliza, setPoliza] = useState(null);
    const [pagos, setPagos] = useState(null);       // null = cargando
    const [fallo, setFallo] = useState(null);

    // Recargar = subir la versión; el efecto es el único que lee.
    const [version, setVersion] = useState(0);
    const cargar = useCallback(() => setVersion(v => v + 1), []);
    useEffect(() => {
        if (!open) return undefined;
        let vivo = true;
        Promise.all([fetchPoliza(), fetchPagos()])
            .then(([p, g]) => { if (vivo) { setFallo(null); setPoliza(p); setPagos(g); } })
            .catch(e => { if (vivo) { setFallo(mensajeAmigable(e) || 'No se pudo cargar el seguro.'); setPagos([]); } });
        return () => { vivo = false; };
    }, [open, version]);

    const mes = poliza?.mes_de_pago || 11;
    const vigente = periodoVigente(new Date(), mes);
    const pagoVigente = (pagos || []).find(p => p.anio === vigente) || null;
    const prima = primaPorPersona(poliza);

    // `null` = no se está registrando; un número = el año que se registra.
    const [registrando, setRegistrando] = useState(null);

    const solventes = activos.filter(e => estadoEnElSeguro(e.id, pagoVigente).clave === 'solvente').length;
    const sinCertificado = activos.filter(e => !tieneCertificado(e)).length;

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-3xl" ariaLabel="Seguro de vida colectivo">
            <LiquidModal.Header icono={ShieldCheck} tono="neutral" titulo="Seguro de vida colectivo"
                subtitulo={poliza ? `${poliza.aseguradora} · se paga cada ${['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][mes - 1]}` : 'Cargando…'}
                // El foco al abrir va a la ✕ y no al primer campo (que es el de la
                // póliza, al fondo): ModalShell lo respeta si ya hay algo enfocado,
                // y así el teléfono no abre desplazado hasta la mitad de la lista.
                onClose={onClose} enfocarCierre />

            <LiquidModal.Body className="flex flex-col gap-5">
                    {fallo && <Notice variant="danger" compact>{fallo}</Notice>}

                    {pagos === null ? (
                        <div className="flex items-center gap-2 text-content-3 text-label py-8 justify-center">
                            <Loader2 size={16} className="animate-spin" /> Cargando…
                        </div>
                    ) : registrando !== null ? (
                        <RegistrarPago
                            anio={registrando}
                            pagoExistente={(pagos || []).find(p => p.anio === registrando) || null}
                            prima={prima}
                            activos={activos}
                            onCancelar={() => setRegistrando(null)}
                            onGuardado={(r) => {
                                appendAuditLog?.('SEGURO_VIDA_PAGO', String(registrando), { cubiertos: r?.cubiertos });
                                toast('Pago registrado', `${r?.cubiertos ?? 0} personas en el listado de ${registrando}.`, 'success');
                                setRegistrando(null);
                                cargar();
                            }}
                        />
                    ) : (
                        <>
                            {/* ── 1. El pago del periodo vigente ─────────────── */}
                            <section className="flex flex-col gap-2">
                                <div className="flex items-end justify-between gap-2 flex-wrap">
                                    <div>
                                        <p className="text-caption font-black uppercase tracking-widest text-content-2">Pago {vigente}</p>
                                        <p className="text-micro text-content-3 font-medium">Cubre {rotuloDelPeriodo(vigente, mes)}</p>
                                    </div>
                                    {canEdit && (
                                        <Button size="sm" variant={pagoVigente ? 'secondary' : 'primary'}
                                            icon={pagoVigente ? Pencil : Plus}
                                            onClick={() => setRegistrando(vigente)}>
                                            {pagoVigente ? 'Corregir listado' : `Registrar pago ${vigente}`}
                                        </Button>
                                    )}
                                </div>
                                {pagoVigente ? (
                                    <div data-surface="card" className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <Dato rotulo="Pagado el" valor={fechaNumerica(pagoVigente.fecha_pago, { vacio: '—' })} />
                                        <Dato rotulo="Monto" valor={dinero(pagoVigente.monto_total)} />
                                        <Dato rotulo="Por persona" valor={dinero(pagoVigente.prima_por_persona)} />
                                        <Dato rotulo="En el listado" valor={`${(pagoVigente.cubiertos || []).length}`} />
                                        {pagoVigente.comprobante_url && (
                                            <Button variant="ghost" size="sm" icon={FileText} className="col-span-2 md:col-span-4 justify-self-start"
                                                onClick={() => openStoredFile(pagoVigente.comprobante_url)}>
                                                Ver el listado de la aseguradora
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <Notice variant="warning" compact>
                                        Todavía no se registró el pago de {vigente}. Cuando llegue el listado de la aseguradora,
                                        súbelo y el portal deja a cada persona como solvente.
                                        {prima != null && ` Estimado: ${activos.length} personas × ${dinero(prima)} = ${dinero(prima * activos.length)}.`}
                                    </Notice>
                                )}
                            </section>

                            {/* ── 2. Las personas ─────────────────────────────── */}
                            {/* Antes: una fila por persona con DOS pastillas, y sin
                                pago registrado las trece decían lo mismo
                                («Sin certificado · Pendiente»). Una pastilla igual
                                en todas no informa: el resumen lo dice una vez y
                                la fila sólo marca lo que distingue a esa persona. */}
                            <section className="flex flex-col gap-2">
                                <p className="text-caption font-black uppercase tracking-widest text-content-2">Personas</p>
                                <div className="grid grid-cols-3 gap-2">
                                    <Cifra rotulo="Solventes" valor={`${solventes}/${activos.length}`}
                                        tono={pagoVigente && solventes === activos.length ? 'success' : 'warning'} />
                                    <Cifra rotulo="Sin cubrir" valor={pagoVigente ? activos.length - solventes : '—'}
                                        tono={pagoVigente && activos.length - solventes > 0 ? 'danger' : 'neutral'} />
                                    <Cifra rotulo="Certificados" valor={`${activos.length - sinCertificado}/${activos.length}`}
                                        tono={sinCertificado ? 'warning' : 'success'} />
                                </div>
                                {sinCertificado > 0 && (
                                    <p className="flex items-center gap-1.5 text-micro font-medium text-content-3">
                                        <FileWarning size={13} strokeWidth={2.5} className="shrink-0 text-warning-text" />
                                        Le falta el certificado de asegurado en su expediente.
                                    </p>
                                )}
                                <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                                    {activos.map(e => {
                                        const est = estadoEnElSeguro(e.id, pagoVigente);
                                        const cert = tieneCertificado(e);
                                        return (
                                            <div key={e.id} data-surface="card" className="px-3 py-2 flex items-center gap-2.5 min-h-[var(--tap-min)]">
                                                <AvatarConEstado emp={e} px={28} mostrarChip={false} />
                                                <span className="flex-1 min-w-0 text-label font-bold text-content truncate">{shortEmployeeName(e)}</span>
                                                {/* Sin pago registrado todas están igual: eso ya
                                                    lo dice el aviso de arriba, no cada fila. */}
                                                {pagoVigente && (
                                                    <Badge variant={est.variant} size="sm" uppercase={false}>
                                                        {est.clave === 'solvente' ? 'Solvente' : 'No cubierto'}
                                                    </Badge>
                                                )}
                                                {!cert && (
                                                    <span role="img" aria-label="Sin certificado de asegurado"
                                                        className="shrink-0 text-warning-text">
                                                        <FileWarning size={15} strokeWidth={2.5} />
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>

                            {/* ── 3. La póliza ────────────────────────────────── */}
                            <Poliza poliza={poliza} canEdit={canEdit}
                                onGuardada={(p) => {
                                    setPoliza(p);
                                    appendAuditLog?.('SEGURO_VIDA_POLIZA', String(p.id), { suma: p.suma_asegurada, tasa: p.tasa_por_millar });
                                    toast('Póliza guardada', '', 'success');
                                }} />

                            {/* ── Los años anteriores ─────────────────────────── */}
                            {(pagos || []).filter(p => p.anio !== vigente).length > 0 && (
                                <section className="flex flex-col gap-2">
                                    <p className="text-caption font-black uppercase tracking-widest text-content-2">Pagos anteriores</p>
                                    {(pagos || []).filter(p => p.anio !== vigente).map(p => (
                                        <div key={p.id} data-surface="card" className="px-3 py-2 flex items-center gap-3 flex-wrap min-h-[var(--tap-min)]">
                                            <span className="text-label font-black text-content">{p.anio}</span>
                                            <span className="flex-1 min-w-0 text-micro text-content-3 font-medium">
                                                {dinero(p.monto_total)} · {(p.cubiertos || []).length} personas
                                            </span>
                                            {p.comprobante_url && (
                                                <Button variant="ghost" size="sm" icon={FileText} iconOnly title="Ver el listado"
                                                    onClick={() => openStoredFile(p.comprobante_url)} />
                                            )}
                                            {canEdit && (
                                                <Button variant="ghost" size="sm" icon={Pencil} iconOnly title="Corregir"
                                                    onClick={() => setRegistrando(p.anio)} />
                                            )}
                                        </div>
                                    ))}
                                </section>
                            )}
                        </>
                    )}
            </LiquidModal.Body>
        </LiquidModal>
    );
}

const TONO_CIFRA = {
    success: 'text-success-text', warning: 'text-warning-text',
    danger: 'text-danger-text', neutral: 'text-content',
};
function Cifra({ rotulo, valor, tono = 'neutral' }) {
    return (
        <div data-surface="card" className="px-3 py-2 min-w-0">
            <p className="text-micro font-black uppercase tracking-widest text-content-3 truncate">{rotulo}</p>
            <p className={`text-body font-black tabular-nums ${TONO_CIFRA[tono] || TONO_CIFRA.neutral}`}>{valor}</p>
        </div>
    );
}

function Dato({ rotulo, valor }) {
    return (
        <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-widest text-content-3">{rotulo}</p>
            <p className="text-label font-bold text-content truncate">{valor}</p>
        </div>
    );
}

/* ── La póliza: se carga una vez ─────────────────────────────────────────── */
const BORRADOR_POLIZA = 'seguro-vida-poliza';
function Poliza({ poliza, canEdit, onGuardada }) {
    const [f, setF] = useState(null);
    const [subiendo, setSubiendo] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);
    // Borrador: la sesión de sala se cierra sola a los pocos minutos y esto se
    // escribe mirando un papel (gate:borradores).
    useEffect(() => {
        const base = poliza ? { ...poliza } : { aseguradora: 'MAPFRE', suma_asegurada: 5000, tasa_por_millar: 6.5 };
        const borrador = loadDraft(BORRADOR_POLIZA);
        setF(borrador && borrador.id === base.id ? { ...base, ...borrador } : base);
    }, [poliza]);
    if (!f) return null;
    const set = (k, v) => setF(prev => { const n = { ...prev, [k]: v }; saveDraft(BORRADOR_POLIZA, n); return n; });
    const calculada = primaPorPersona({ ...f, prima_por_persona: null });

    const subir = async (archivo) => {
        if (!archivo) { set('documento_url', null); set('documento_nombre', null); return; }
        setSubiendo(true); setFallo(null);
        try {
            const url = await subirArchivoDelSeguro(archivo, 'poliza');
            setF(prev => ({ ...prev, documento_url: url, documento_nombre: archivo.name }));
        } catch (e) { setFallo(mensajeAmigable(e) || 'No se pudo subir.'); }
        finally { setSubiendo(false); }
    };
    const guardar = async () => {
        setGuardando(true); setFallo(null);
        try { onGuardada(await guardarPoliza(f)); clearDraft(BORRADOR_POLIZA); }
        catch (e) { setFallo(mensajeAmigable(e) || e?.message || 'No se pudo guardar.'); }
        finally { setGuardando(false); }
    };
    const sumaMala = !(Number(f.suma_asegurada) > 0);
    const tasaMala = !(Number(f.tasa_por_millar) > 0);

    return (
        <section className="flex flex-col gap-2">
            <div>
                <p className="text-caption font-black uppercase tracking-widest text-content-2">La póliza</p>
                <p className="text-micro text-content-3 font-medium">El documento general — es el mismo cada año. La suma asegurada es igual para todos.</p>
            </div>
            <div data-surface="card" className="p-3 flex flex-col gap-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <PortalInput label="Aseguradora" value={f.aseguradora || ''} readOnly={!canEdit}
                        onChange={e => set('aseguradora', e.target.value)} />
                    <PortalInput label="Número de póliza" value={f.numero_poliza || ''} readOnly={!canEdit}
                        placeholder="Opcional" onChange={e => set('numero_poliza', e.target.value)} />
                    <PortalInput label="Suma asegurada por persona" prefix="$" inputMode="decimal" maskType="DECIMAL"
                        value={f.suma_asegurada ?? ''} readOnly={!canEdit} hasError={sumaMala} errorMessage="Mayor a 0"
                        onChange={e => set('suma_asegurada', e.target.value)} />
                    <PortalInput label="Tasa (por millar, anual)" inputMode="decimal" maskType="DECIMAL"
                        value={f.tasa_por_millar ?? ''} readOnly={!canEdit} hasError={tasaMala} errorMessage="Mayor a 0"
                        onChange={e => set('tasa_por_millar', e.target.value)} />
                    <PortalInput label="Prima por persona" prefix="$" inputMode="decimal" maskType="DECIMAL"
                        value={f.prima_por_persona ?? ''} readOnly={!canEdit}
                        placeholder={calculada != null ? `${calculada.toFixed(2)} (calculada)` : ''}
                        helperText="· vacío = suma × tasa"
                        onChange={e => set('prima_por_persona', e.target.value)} />
                </div>
                <FileField label="Documento de la póliza" accept=".pdf,image/*"
                    url={f.documento_url} name={f.documento_nombre}
                    onChange={subir} busy={subiendo} disabled={!canEdit} />
                {fallo && <Notice variant="danger" compact>{fallo}</Notice>}
                {canEdit && (
                    <Button size="sm" variant="primary" icon={Save} className="self-end"
                        onClick={guardar} loading={guardando} disabled={guardando || subiendo || sumaMala || tasaMala}>
                        Guardar póliza
                    </Button>
                )}
            </div>
        </section>
    );
}

/* ── Registrar el pago de un año con su listado ─────────────────────────── */
function RegistrarPago({ anio, pagoExistente, prima, activos, onCancelar, onGuardado }) {
    // Borrador: el listado ya leído y revisado es lo caro de perder si la
    // sesión se cierra sola en medio (gate:borradores).
    const claveBorrador = `seguro-vida-pago-${anio}`;
    const borrador = useMemo(() => loadDraft(claveBorrador), [claveBorrador]);
    // Cada fila: { clave, nombre (del papel), employee_id|null }
    const [filas, setFilas] = useState(() => borrador?.filas || (pagoExistente?.cubiertos || []).map(c => ({
        clave: c.employee_id || c.nombre_en_documento, nombre: c.nombre_en_documento, employee_id: c.employee_id,
    })));
    const [archivo, setArchivo] = useState(null);
    const [comprobante, setComprobante] = useState(() => borrador?.comprobante || { url: pagoExistente?.comprobante_url || null, nombre: pagoExistente?.comprobante_nombre || null });
    const [leyendo, setLeyendo] = useState(false);
    const [fecha, setFecha] = useState(() => borrador?.fecha ?? (pagoExistente?.fecha_pago || ''));
    const [monto, setMonto] = useState(() => borrador?.monto ?? (pagoExistente?.monto_total ?? ''));
    const [primaPago, setPrimaPago] = useState(() => borrador?.primaPago ?? (pagoExistente?.prima_por_persona ?? (prima ?? '')));
    useEffect(() => { saveDraft(claveBorrador, { filas, comprobante, fecha, monto, primaPago }); },
        [claveBorrador, filas, comprobante, fecha, monto, primaPago]);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState(null);
    const [aviso, setAviso] = useState(null);

    const porId = useMemo(() => new Map(activos.map(e => [e.id, e])), [activos]);
    const tomados = new Set(filas.map(f => f.employee_id).filter(Boolean));

    const leerListado = async (file) => {
        setArchivo(file);
        if (!file) { setComprobante({ url: null, nombre: null }); return; }
        setLeyendo(true); setFallo(null); setAviso(null);
        try {
            const url = await subirArchivoDelSeguro(file, `pago-${anio}`);
            setComprobante({ url, nombre: file.name });
            const stored = getStoragePathFromUrl(url);
            const { data, error } = await analizarDocumento({
                filePath: stored.path, bucketName: stored.bucket, buscarPersonas: true,
            });
            const nombres = !error && data?.success && Array.isArray(data.aiData?.personas)
                ? data.aiData.personas.filter(n => String(n || '').trim()) : [];
            if (!nombres.length) {
                setAviso('No se pudo leer el listado del documento. Marca a las personas a mano.');
                return;
            }
            const cruce = cruzarConElPadron(nombres, activos);
            setFilas(cruce.map(c => ({ clave: c.nombre, nombre: c.nombre, employee_id: c.empleado?.id || null, posible: c.posible || null, ambiguo: c.ambiguo })));
            const sin = cruce.filter(c => !c.empleado).length;
            setAviso(`Se leyeron ${nombres.length} nombres${sin ? `; ${sin} sin ficha reconocida — revísalos` : ', todos con ficha'}.`);
        } catch (e) {
            setFallo(mensajeAmigable(e) || 'No se pudo subir el listado.');
        } finally { setLeyendo(false); }
    };

    const elegir = (clave, id) => setFilas(prev => prev.map(f => f.clave === clave ? { ...f, employee_id: id || null, posible: null } : f));
    const quitar = (clave) => setFilas(prev => prev.filter(f => f.clave !== clave));
    const agregar = (id) => {
        const e = porId.get(id);
        if (!e) return;
        setFilas(prev => [...prev, { clave: id, nombre: e.name, employee_id: id }]);
    };
    const faltan = activos.filter(e => !tomados.has(e.id));
    const conFicha = filas.filter(f => f.employee_id).length;
    // Sin nadie en la lista no hay estimado: «$0.00 (estimado)» se leía como dato.
    const estimado = filas.length && primaPago !== '' && Number.isFinite(Number(primaPago)) ? Number(primaPago) * filas.length : null;

    const guardar = async () => {
        setGuardando(true); setFallo(null);
        try {
            const r = await registrarPago({
                anio,
                fecha_pago: fecha || null,
                monto_total: monto === '' ? (estimado ?? null) : Number(monto),
                prima_por_persona: primaPago === '' ? null : Number(primaPago),
                comprobante_url: comprobante.url, comprobante_nombre: comprobante.nombre,
                cubiertos: filas.map(f => ({ employee_id: f.employee_id || null, nombre: f.nombre })),
            });
            clearDraft(claveBorrador);
            onGuardado(r);
        } catch (e) {
            setFallo(mensajeAmigable(e) || e?.message || 'No se pudo guardar el pago.');
        } finally { setGuardando(false); }
    };

    return (
        <section className="flex flex-col gap-3">
            <div>
                <p className="text-caption font-black uppercase tracking-widest text-content-2">
                    {pagoExistente ? 'Corregir' : 'Registrar'} el pago {anio}
                </p>
                <p className="text-micro text-content-3 font-medium">
                    Sube el documento con el listado que envía la aseguradora: el portal lee los nombres y los cruza con las fichas.
                    Revisa la lista antes de guardar — quien quede afuera no aparece como solvente.
                </p>
            </div>

            <FileField label="Listado de la aseguradora" accept=".pdf,image/*"
                file={archivo} url={comprobante.url} name={comprobante.nombre}
                onChange={leerListado} busy={leyendo} busyLabel="Leyendo el listado…" />
            {aviso && <Notice variant="info" compact>{aviso}</Notice>}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                    <label className={rotuloCampo('text-content-3')}>Fecha de pago</label>
                    <LiquidDatePicker value={fecha} onChange={setFecha} />
                </div>
                <PortalInput label="Prima por persona" prefix="$" inputMode="decimal" maskType="DECIMAL"
                    value={primaPago} onChange={e => setPrimaPago(e.target.value)} />
                <PortalInput label="Monto total pagado" prefix="$" inputMode="decimal" maskType="DECIMAL"
                    value={monto} onChange={e => setMonto(e.target.value)}
                    placeholder={estimado != null ? `${estimado.toFixed(2)} (estimado)` : ''} />
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-label font-black text-content">{filas.length} en el listado · {conFicha} con ficha</p>
            </div>
            <div className="flex flex-col gap-1.5">
                {filas.map(f => {
                    const e = f.employee_id ? porId.get(f.employee_id) : null;
                    const opciones = activos.filter(x => x.id === f.employee_id || !tomados.has(x.id))
                        .map(x => ({ value: x.id, label: x.name }));
                    return (
                        <div key={f.clave} data-surface="card" className="p-2.5 flex flex-col gap-2">
                            <div className="flex items-center gap-3 min-h-[var(--tap-min)]">
                                <span className={`w-8 h-8 rounded-btn shrink-0 flex items-center justify-center ${e ? 'bg-success/12' : 'bg-warning/12'}`}>
                                    {e ? <UserCheck size={15} className="text-success" strokeWidth={2.5} />
                                       : <UserPlus size={15} className="text-warning" strokeWidth={2.5} />}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-label font-black text-content truncate">{f.nombre}</span>
                                    <span className="block text-micro text-content-3 font-medium truncate">
                                        {e ? `Ficha: ${shortEmployeeName(e)}` : 'Sin ficha — elige a quién corresponde, o déjalo así'}
                                    </span>
                                </span>
                                {f.ambiguo && <Badge variant="warning" size="sm">Hay dos iguales</Badge>}
                                <Button variant="ghost" size="sm" icon={X} iconOnly title="Quitar del listado" onClick={() => quitar(f.clave)} />
                            </div>
                            {!e && (
                                <div className="flex flex-col gap-2 pl-11">
                                    {f.posible && !tomados.has(f.posible.id) && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="flex-1 min-w-[8rem] text-micro text-content-2 font-semibold">¿Es {shortEmployeeName(f.posible)}?</span>
                                            <Button variant="secondary" size="sm" icon={Check} onClick={() => elegir(f.clave, f.posible.id)}>Sí</Button>
                                        </div>
                                    )}
                                    <LiquidSelect value="" onChange={(id) => elegir(f.clave, id)} options={opciones}
                                        placeholder="Elegir su ficha" compact />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {faltan.length > 0 && (
                <LiquidSelect value="" onChange={agregar}
                    options={faltan.map(x => ({ value: x.id, label: x.name }))}
                    placeholder={`Agregar a alguien que no salió en la lectura (${faltan.length} sin listar)`} icon={UserPlus} />
            )}

            {fallo && (
                <Notice variant="danger" compact>
                    <span className="flex items-center gap-1.5"><AlertTriangle size={14} className="shrink-0" /> {fallo}</span>
                </Notice>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => { clearDraft(claveBorrador); onCancelar(); }} disabled={guardando}>Cancelar</Button>
                <Button variant="primary" size="sm" icon={Check} onClick={guardar}
                    loading={guardando} disabled={guardando || leyendo || filas.length === 0}>
                    Guardar pago {anio}
                </Button>
            </div>
        </section>
    );
}
