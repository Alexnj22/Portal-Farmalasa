/**
 * Transcribir una solicitud de datos y resolverla.
 *
 * ── Por qué se transcribe y no se llena en línea ────────────────────────────
 * La hoja la llena la persona en la sala de ventas, a mano, y firma. Esa firma
 * es el requisito de la letra g) del Art. 18 y no se sustituye con un formulario
 * web: quien escribe desde una página pública puede ser cualquiera. Lo que este
 * modal hace es pasar al registro lo que ya está escrito y firmado, para que el
 * plazo se pueda contar y la respuesta se pueda probar.
 *
 * ── La fecha que importa es la del ACUSE ────────────────────────────────────
 * `recibida_at` la escribe quien recibió la hoja, y de ella cuelgan los veinte
 * días hábiles del Art. 20. `impresa_at` no cuenta plazos: una hoja puede
 * imprimirse hoy y volver llena la semana que viene.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FileText, Loader2, ShieldCheck, Clock, Search, Printer, Download, UserCheck } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { saveDraft, loadDraft, clearDraft } from '../../utils/draftUtils';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { DERECHOS, guardarSolicitud, plazoDe, buscarPersona, resumenDeCliente } from '../../data/solicitudesDatos';
import { papelDeRespuesta, filasParaPortabilidad } from '../../utils/respuestaDeDatos';
import { abrirVentanaDeImpresion, escribirEImprimir, VENTANA_BLOQUEADA } from '../../utils/ventanaDeImpresion';
import { exportCsv } from '../../utils/csvExport';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { shortEmployeeName } from '../../utils/nameUtils';

const paraInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const VIAS = [
    { value: 'SALA',    label: 'En la sala de ventas' },
    { value: 'CORREO',  label: 'Por correo electrónico' },
    { value: 'IMPRESA', label: 'Impresa' },
];

const DOCUMENTOS = [
    { value: 'DUI',       label: 'Documento Único de Identidad' },
    { value: 'PASAPORTE', label: 'Pasaporte' },
    { value: 'CARNE',     label: 'Carné de residente' },
];

/**
 * El envoltorio existe sólo para MONTAR el cuerpo con `key`.
 *
 * Sin esa llave habría que rellenar el formulario desde un efecto cada vez que
 * cambia la solicitud, y un `setState` dentro de un efecto encadena renders.
 * Con la llave, React desmonta y vuelve a montar: el estado nace ya con los
 * valores de la fila, en el inicializador perezoso, y no hay efecto que
 * sincronizar.
 */
export default function SolicitudModal({ open, solicitud, onClose, onGuardada }) {
    if (!open || !solicitud) return null;
    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-3xl"
            ariaLabel={`Solicitud ${solicitud.folio_txt}`}>
            <Cuerpo key={solicitud.id} solicitud={solicitud}
                onClose={onClose} onGuardada={onGuardada} />
        </LiquidModal>
    );
}

function Cuerpo({ solicitud, onClose, onGuardada }) {
    const showToast = useToastStore((s) => s.showToast);
    const claveBorrador = `solicitud_datos_${solicitud.id}`;

    // El borrador se recupera al montar. La sesión de sala se cierra sola a los
    // cinco minutos, y transcribir una hoja entera lleva más que eso.
    const [f, setF] = useState(() => loadDraft(claveBorrador) ?? {
        recibida_at: paraInput(solicitud.recibida_at) || paraInput(new Date().toISOString()),
        solicitante_nombre:    solicitud.solicitante_nombre    ?? '',
        solicitante_documento: solicitud.solicitante_documento ?? '',
        solicitante_numero:    solicitud.solicitante_numero    ?? '',
        solicitante_direccion: solicitud.solicitante_direccion ?? '',
        solicitante_telefono:  solicitud.solicitante_telefono  ?? '',
        solicitante_correo:    solicitud.solicitante_correo    ?? '',
        por_representacion:    !!solicitud.por_representacion,
        representacion_doc:    solicitud.representacion_doc    ?? '',
        derechos:              solicitud.derechos              ?? [],
        descripcion:           solicitud.descripcion           ?? '',
        via_respuesta:         solicitud.via_respuesta         ?? 'SALA',
        identidad_documento:   solicitud.identidad_documento   ?? 'DUI',
        identidad_numero:      solicitud.identidad_numero      ?? '',
        resolucion:            solicitud.resolucion            ?? '',
        notas:                 solicitud.notas                 ?? '',
    });
    const [guardando, setGuardando] = useState(false);

    // ── Encontrar a la persona ────────────────────────────────────────────
    // `null` es «todavía no se buscó» y un objeto es «se buscó»: son estados
    // distintos, y pintar «no se encontró» antes de haber buscado sería mentir.
    const [hallazgo, setHallazgo] = useState(null);
    const [buscando, setBuscando] = useState(false);

    useEffect(() => { saveDraft(claveBorrador, f); }, [claveBorrador, f]);

    const buscar = async () => {
        setBuscando(true);
        try {
            const r = await buscarPersona({
                numero: f.identidad_numero || f.solicitante_numero,
                nombre: f.solicitante_nombre,
            });
            // El resumen se pide sólo cuando hay UNA ficha: con varias, elegir
            // por nosotros es adivinar de quién son los datos que se entregan.
            const cliente = r.clientes.length === 1 ? r.clientes[0] : null;
            const resumen = cliente ? await resumenDeCliente(cliente.id) : null;
            setHallazgo({ ...r, cliente, empleado: r.empleados.length === 1 ? r.empleados[0] : null, resumen });
        } catch (e) {
            showToast('No se pudo buscar', mensajeAmigable(e), 'error');
        } finally {
            setBuscando(false);
        }
    };

    const imprimirRespuesta = () => {
        const win = abrirVentanaDeImpresion({ ancho: 900, alto: 1000 });
        if (!win) { showToast('No se pudo imprimir', VENTANA_BLOQUEADA, 'error'); return; }
        const r = escribirEImprimir(win, papelDeRespuesta({
            solicitud: { ...solicitud, solicitante_nombre: f.solicitante_nombre, recibida_at: f.recibida_at },
            cliente: hallazgo?.cliente ?? null,
            empleado: hallazgo?.empleado ?? null,
            resumen: hallazgo?.resumen ?? null,
        }));
        useStaff.getState().appendAuditLog?.('ENTREGAR_DATOS_SOLICITUD', String(solicitud.id),
            { folio: solicitud.folio_txt, formato: 'papel' });
        if (!r.ok) showToast('No se pudo imprimir', r.motivo ?? 'La ventana no respondió.', 'error');
    };

    const descargarArchivo = () => {
        const filas = filasParaPortabilidad({
            cliente: hallazgo?.cliente ?? null,
            empleado: hallazgo?.empleado ?? null,
            resumen: hallazgo?.resumen ?? null,
        });
        exportCsv(['Grupo', 'Dato', 'Valor'], filas,
            `datos-${solicitud.folio_txt}.csv`, 'datos_personales');
        useStaff.getState().appendAuditLog?.('ENTREGAR_DATOS_SOLICITUD', String(solicitud.id),
            { folio: solicitud.folio_txt, formato: 'csv', filas: filas.length });
    };

    const set = useCallback((k, v) => setF((p) => ({ ...p, [k]: v })), []);
    const alternarDerecho = useCallback((clave) => setF((p) => {
        const y = p.derechos ?? [];
        return { ...p, derechos: y.includes(clave) ? y.filter((d) => d !== clave) : [...y, clave] };
    }), []);

    const plazo = useMemo(() => plazoDe(solicitud), [solicitud]);

    // Lo que hace falta para que la fila deje de ser una hoja impresa y pase a
    // ser una solicitud en trámite: quién pide, qué pide, cuándo se recibió y
    // con qué documento se comprobó que es quien dice.
    const faltaParaRecibir = useMemo(() => {
        const faltan = [];
        if (!f.recibida_at)                 faltan.push('la fecha del acuse');
        if (!f.solicitante_nombre?.trim())  faltan.push('el nombre');
        if (!(f.derechos?.length))          faltan.push('qué solicita');
        if (!f.identidad_numero?.trim())    faltan.push('el número del documento cotejado');
        return faltan;
    }, [f]);

    const guardar = useCallback(async (estado) => {
        if (!solicitud) return;
        setGuardando(true);
        try {
            const campos = {
                estado,
                recibida_at: f.recibida_at ? new Date(f.recibida_at).toISOString() : null,
                solicitante_nombre:    f.solicitante_nombre?.trim()    || null,
                solicitante_documento: f.solicitante_documento?.trim() || null,
                solicitante_numero:    f.solicitante_numero?.trim()    || null,
                solicitante_direccion: f.solicitante_direccion?.trim() || null,
                solicitante_telefono:  f.solicitante_telefono?.trim()  || null,
                solicitante_correo:    f.solicitante_correo?.trim()    || null,
                por_representacion:    !!f.por_representacion,
                representacion_doc:    f.representacion_doc?.trim()    || null,
                derechos:              f.derechos ?? [],
                descripcion:           f.descripcion?.trim()           || null,
                via_respuesta:         f.via_respuesta                 || null,
                identidad_documento:   f.identidad_documento           || null,
                identidad_numero:      f.identidad_numero?.trim()      || null,
                notas:                 f.notas?.trim()                 || null,
            };
            if (estado === 'RESUELTA') {
                campos.resolucion  = f.resolucion?.trim() || null;
                campos.resuelta_at = new Date().toISOString();
            }
            const fila = await guardarSolicitud(solicitud.id, campos);
            useStaff.getState().appendAuditLog?.(
                estado === 'RESUELTA' ? 'RESOLVER_SOLICITUD_DATOS' : 'REGISTRAR_SOLICITUD_DATOS',
                String(solicitud.id),
                { folio: solicitud.folio_txt, derechos: campos.derechos });
            if (claveBorrador) clearDraft(claveBorrador);
            showToast('Guardado', `Solicitud ${solicitud.folio_txt}`, 'success');
            onGuardada?.(fila);
            onClose?.();
        } catch (e) {
            showToast('No se pudo guardar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
        }
    }, [solicitud, f, claveBorrador, showToast, onGuardada, onClose]);

    const resuelta = solicitud.estado === 'RESUELTA';

    return (
        <>
            <LiquidModal.Header>
                <div className="flex items-start justify-between gap-4 w-full">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <FileText size={18} className="text-brand-text shrink-0" />
                            <h2 className="text-title font-black text-content truncate">
                                Solicitud {solicitud.folio_txt}
                            </h2>
                        </div>
                        <p className="text-caption text-content-3 mt-1">
                            Impresa el {new Date(solicitud.impresa_at).toLocaleDateString('es-SV',
                                { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                    </div>
                    {plazo && (
                        <Badge variant={plazo.vencida ? 'danger' : plazo.apremia ? 'warning' : 'neutral'}
                            icon={Clock} uppercase={false}>
                            {plazo.vencida
                                ? `Vencida hace ${Math.abs(plazo.restan)} d.h.`
                                : `Quedan ${plazo.restan} días hábiles`}
                        </Badge>
                    )}
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="flex flex-col gap-5">
                    {plazo?.vencida && (
                        <Notice variant="danger" bloque>
                            El plazo del Art. 20 ya pasó. No atender en tiempo y forma es una
                            infracción grave. Resuelve y deja anotado por qué se atrasó.
                        </Notice>
                    )}

                    <Seccion titulo="Quién solicita">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <PortalInput label="Nombre completo" name="solicitante_nombre" colSpan={2}
                                value={f.solicitante_nombre ?? ''} readOnly={resuelta}
                                onChange={(e) => set('solicitante_nombre', e.target.value)} />
                            <PortalInput label="Tipo de documento" name="solicitante_documento"
                                value={f.solicitante_documento ?? ''} readOnly={resuelta}
                                onChange={(e) => set('solicitante_documento', e.target.value)} />
                            <PortalInput label="Número" name="solicitante_numero"
                                value={f.solicitante_numero ?? ''} readOnly={resuelta}
                                onChange={(e) => set('solicitante_numero', e.target.value)} />
                            <PortalInput label="Dirección" name="solicitante_direccion" colSpan={2}
                                value={f.solicitante_direccion ?? ''} readOnly={resuelta}
                                onChange={(e) => set('solicitante_direccion', e.target.value)} />
                            <PortalInput label="Teléfono" name="solicitante_telefono"
                                value={f.solicitante_telefono ?? ''} readOnly={resuelta}
                                onChange={(e) => set('solicitante_telefono', e.target.value)} />
                            <PortalInput label="Correo electrónico" name="solicitante_correo"
                                value={f.solicitante_correo ?? ''} readOnly={resuelta}
                                onChange={(e) => set('solicitante_correo', e.target.value)} />
                        </div>
                        <label className="flex items-center gap-2.5 mt-3 min-h-[var(--tap-min)] cursor-pointer">
                            <input type="checkbox" checked={!!f.por_representacion} disabled={resuelta}
                                onChange={(e) => set('por_representacion', e.target.checked)}
                                className="w-4 h-4 accent-[var(--brand)]" />
                            <span className="text-body-sm text-content-2">Solicita por otra persona, a quien representa</span>
                        </label>
                        {f.por_representacion && (
                            <PortalInput label="Documento que lo autoriza a representar" name="representacion_doc"
                                value={f.representacion_doc ?? ''} readOnly={resuelta}
                                onChange={(e) => set('representacion_doc', e.target.value)} />
                        )}
                    </Seccion>

                    {/* ── Encontrar a la persona en el portal ────────────
                        Sin esto, resolver un acceso significa buscar a mano en
                        Clientes, en Personal y en Puntos, y armar la respuesta
                        copiando. Tres pantallas y una transcripción es donde se
                        pierde un dato. */}
                    <Seccion titulo="Qué consta en el portal"
                        nota="Busca por el número del documento cotejado; si no hay número, por el nombre.">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="secondary" icon={buscando ? Loader2 : Search}
                                disabled={buscando || !(f.identidad_numero?.trim() || f.solicitante_numero?.trim() || f.solicitante_nombre?.trim())}
                                onClick={buscar}>Buscar a esta persona</Button>
                            {hallazgo && (
                                <>
                                    <Button variant="secondary" icon={Printer}
                                        onClick={imprimirRespuesta}>Imprimir la respuesta</Button>
                                    {(f.derechos ?? []).includes('portabilidad') && (
                                        <Button variant="secondary" icon={Download}
                                            onClick={descargarArchivo}>Descargar en archivo</Button>
                                    )}
                                </>
                            )}
                        </div>

                        {hallazgo && (
                            <div data-surface="card" className="p-3.5 flex flex-col gap-2">
                                {hallazgo.porNombre && (
                                    <Notice variant="warning" compact>
                                        Se buscó por nombre porque no hay número de documento. Un nombre
                                        trae homónimos: comprueba que la ficha sea la de esta persona
                                        antes de entregarle nada.
                                    </Notice>
                                )}
                                {hallazgo.clientes.length > 1 && (
                                    <Notice variant="warning" compact>
                                        {hallazgo.clientes.length} fichas de cliente coinciden. Afiná el
                                        documento: no se puede elegir por usted de quién son los datos.
                                    </Notice>
                                )}
                                {hallazgo.cliente && (
                                    <p className="text-body-sm text-content-2 flex items-start gap-2">
                                        <UserCheck size={15} className="text-success-text mt-0.5 shrink-0" />
                                        <span>
                                            <strong className="text-content">{hallazgo.cliente.name}</strong>
                                            {' · ficha de cliente'}
                                            {hallazgo.resumen?.compras
                                                ? ` · ${hallazgo.resumen.compras.facturas ?? 0} documentos de venta`
                                                : ''}
                                            {hallazgo.resumen?.puntos
                                                ? ` · ${hallazgo.resumen.puntos.saldo ?? 0} puntos`
                                                : ''}
                                        </span>
                                    </p>
                                )}
                                {hallazgo.empleado && (
                                    <p className="text-body-sm text-content-2 flex items-start gap-2">
                                        <UserCheck size={15} className="text-success-text mt-0.5 shrink-0" />
                                        <span>
                                            <strong className="text-content">{shortEmployeeName(hallazgo.empleado)}</strong>
                                            {' · expediente de personal'}
                                        </span>
                                    </p>
                                )}
                                {!hallazgo.cliente && !hallazgo.empleado && hallazgo.clientes.length <= 1 && (
                                    <p className="text-body-sm text-content-3">
                                        No consta ninguna ficha con esos datos. La respuesta se imprime
                                        igual y dice que no hay información suya, que también es una
                                        respuesta al acceso.
                                    </p>
                                )}
                            </div>
                        )}
                    </Seccion>

                    <Seccion titulo="Qué solicita">
                        <div className="flex flex-col gap-1.5">
                            {DERECHOS.map((d) => (
                                <label key={d.clave}
                                    className="flex items-start gap-2.5 min-h-[var(--tap-min)] cursor-pointer">
                                    <input type="checkbox" disabled={resuelta}
                                        checked={(f.derechos ?? []).includes(d.clave)}
                                        onChange={() => alternarDerecho(d.clave)}
                                        className="w-4 h-4 mt-1 accent-[var(--brand)]" />
                                    <span className="min-w-0">
                                        <span className="text-body-sm font-bold text-content">{d.rotulo}</span>
                                        <span className="text-caption text-content-3 block">{d.que}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <PortalTextarea label="A qué información se refiere" name="descripcion" rows={3}
                            value={f.descripcion ?? ''} readOnly={resuelta}
                            onChange={(e) => set('descripcion', e.target.value)} />
                    </Seccion>

                    <Seccion titulo="Recepción y comprobación de identidad"
                        nota="Esta fecha es la que hace correr los veinte días hábiles.">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <PortalInput label="Fecha y hora del acuse" name="recibida_at" type="datetime-local"
                                value={f.recibida_at ?? ''} readOnly={resuelta}
                                onChange={(e) => set('recibida_at', e.target.value)} />
                            <div>
                                <span className="text-caption font-bold text-content-2 block mb-1.5">Documento cotejado</span>
                                <LiquidSelect value={f.identidad_documento ?? 'DUI'} options={DOCUMENTOS}
                                    disabled={resuelta} clearable={false}
                                    onChange={(v) => set('identidad_documento', v)} />
                            </div>
                            <PortalInput label="Número del documento cotejado" name="identidad_numero"
                                value={f.identidad_numero ?? ''} readOnly={resuelta}
                                onChange={(e) => set('identidad_numero', e.target.value)} />
                            <div>
                                <span className="text-caption font-bold text-content-2 block mb-1.5">Cómo desea la respuesta</span>
                                <LiquidSelect value={f.via_respuesta ?? 'SALA'} options={VIAS}
                                    disabled={resuelta} clearable={false}
                                    onChange={(v) => set('via_respuesta', v)} />
                            </div>
                        </div>
                    </Seccion>

                    <Seccion titulo="Resolución">
                        <PortalTextarea label="Qué se resolvió y con qué fundamento" name="resolucion" rows={4}
                            value={f.resolucion ?? ''} readOnly={resuelta}
                            onChange={(e) => set('resolucion', e.target.value)} />
                        <PortalTextarea label="Notas internas" name="notas" rows={2}
                            value={f.notas ?? ''} readOnly={resuelta}
                            onChange={(e) => set('notas', e.target.value)} />
                    </Seccion>
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                    <p className="text-caption text-content-3 min-w-0 flex-1">
                        {resuelta
                            ? `Resuelta el ${new Date(solicitud.resuelta_at).toLocaleDateString('es-SV')}`
                            : faltaParaRecibir.length
                                ? `Falta ${faltaParaRecibir.join(', ')}.`
                                : 'Listo para registrar.'}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                        {!resuelta && (
                            <>
                                <Button variant="secondary" disabled={guardando || faltaParaRecibir.length > 0}
                                    icon={guardando ? Loader2 : undefined}
                                    onClick={() => guardar('RECIBIDA')}>Guardar</Button>
                                <Button variant="primary" icon={ShieldCheck}
                                    disabled={guardando || faltaParaRecibir.length > 0 || !f.resolucion?.trim()}
                                    onClick={() => guardar('RESUELTA')}>Dar por resuelta</Button>
                            </>
                        )}
                    </div>
                </div>
            </LiquidModal.Footer>
        </>
    );
}

function Seccion({ titulo, nota, children }) {
    return (
        <section className="flex flex-col gap-3">
            <div>
                <h3 className="text-body-sm font-black text-content uppercase tracking-wide">{titulo}</h3>
                {nota && <p className="text-caption text-content-3 mt-0.5">{nota}</p>}
            </div>
            {children}
        </section>
    );
}
