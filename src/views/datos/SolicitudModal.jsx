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
import { FileText, Loader2, ShieldCheck, Clock, Printer, Download, UserCheck, AlertTriangle } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import SearchInput from '../../components/common/SearchInput';
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
import { duiValido, telefonoValido, correoValido } from '../../utils/clienteValidacion';

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

const ORIGEN = {
    cliente: 'cliente', empleado: 'personal', practicante: 'horas sociales',
    proveedor: 'proveedor', receta: 'receta',
};

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
    const [termino, setTermino] = useState(() =>
        solicitud.solicitante_numero || solicitud.solicitante_nombre || '');
    const [candidatos, setCandidatos] = useState([]);

    /* Una solicitud resuelta no se toca: apaga el buscador y deja los campos
       en sólo lectura. Va ACÁ ARRIBA porque el efecto de la búsqueda lo lee —
       declarado abajo, `gate:tdz` lo cuenta como deuda diferida. */
    const resuelta = solicitud.estado === 'RESUELTA';

    useEffect(() => { saveDraft(claveBorrador, f); }, [claveBorrador, f]);

    /**
     * Busca MIENTRAS se escribe, sin botón.
     *
     * ── Por qué no hay «Buscar» (2026-09-05) ──────────────────────────────
     * Pedido del usuario. Un botón al lado del campo convierte una búsqueda en
     * dos actos, y el segundo se olvida: el formulario de abajo se puede llenar
     * a mano sin apretarlo nunca, que es justo lo que este selector existe para
     * evitar —un dígito de más y la persona queda sin cruzar con la base—.
     *
     * ── Qué se busca lo decide lo escrito ─────────────────────────────────
     * Nueve dígitos es un DUI, ocho es un teléfono, y cualquier otra cosa es un
     * nombre. Adivinar acá y no pedir tres campos es lo que hace que se use.
     *
     * ── Los 300 ms y el mínimo de tres letras ─────────────────────────────
     * La consulta cruza seis orígenes (clientes, empleados, proveedores,
     * practicantes, recetas…), así que dispararla en cada tecla es trabajo
     * tirado: se espera a que se deje de escribir. Y con menos de tres letras
     * la respuesta serían cientos de filas que no acercan a nadie — es el mismo
     * criterio que el buscador de productos.
     *
     * `vivo` no es ceremonia: escribiendo rápido salen varias consultas y
     * vuelven desordenadas. Sin él, la respuesta de «edw» puede llegar DESPUÉS
     * de la de «edwin» y pisar la lista buena con una más vieja.
     */
    useEffect(() => {
        const t = termino.trim();
        if (resuelta) return undefined;
        if (t.length < 3) { setCandidatos([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- sin término no hay lista que mostrar; dejarla puesta ofrecería resultados de otra búsqueda
        let vivo = true;
        const id = setTimeout(async () => {
            const digitos = t.replace(/\D/g, '');
            setBuscando(true);
            try {
                const r = await buscarPersona({
                    numero: digitos.length === 9 ? t : '',
                    telefono: digitos.length === 8 ? t : '',
                    nombre: digitos.length === 9 || digitos.length === 8 ? '' : t,
                });
                if (!vivo) return;
                setCandidatos((r.donde ?? []).flatMap((d) => d.filas.map((x) => comoPersona(d.clave, x))));
                // El resumen se pide sólo cuando hay UNA ficha de cliente: con
                // varias, elegir por nosotros es adivinar de quién son los datos.
                const resumen = r.cliente ? await resumenDeCliente(r.cliente.id) : null;
                if (vivo) setHallazgo({ ...r, resumen });
            } catch (e) {
                if (vivo) showToast('No se pudo buscar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setBuscando(false);
            }
        }, 300);
        return () => { vivo = false; clearTimeout(id); };
    }, [termino, resuelta, showToast]);

    /** Elegir a alguien LLENA los campos: es el punto de todo el selector. */
    const elegir = (c) => {
        setF((p) => ({
            ...p,
            solicitante_nombre:    c.nombre    || p.solicitante_nombre,
            solicitante_documento: c.documento || p.solicitante_documento,
            solicitante_numero:    c.numero    || p.solicitante_numero,
            solicitante_telefono:  c.telefono  || p.solicitante_telefono,
            solicitante_correo:    c.correo    || p.solicitante_correo,
            solicitante_direccion: c.direccion || p.solicitante_direccion,
            identidad_numero:      p.identidad_numero || (c.documento === 'DUI' ? c.numero : ''),
        }));
        setCandidatos([]);
    };

    const imprimirRespuesta = () => {
        const win = abrirVentanaDeImpresion({ ancho: 900, alto: 1000 });
        if (!win) { showToast('No se pudo imprimir', VENTANA_BLOQUEADA, 'error'); return; }
        const r = escribirEImprimir(win, papelDeRespuesta({
            solicitud: { ...solicitud, solicitante_nombre: f.solicitante_nombre, recibida_at: f.recibida_at },
            cliente: hallazgo?.cliente ?? null,
            empleado: hallazgo?.empleado ?? null,
            resumen: hallazgo?.resumen ?? null,
            donde: hallazgo?.donde ?? [],
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

    // Los tres campos que tienen FORMA. Se validan con el canónico de clientes,
    // que ya sabe el dígito verificador del DUI: escribir la comprobación acá
    // daría un segundo criterio y el día que difieran nadie va a saber cuál manda.
    const malDui = !!f.solicitante_numero?.trim() && f.solicitante_documento === 'DUI'
        && !duiValido(f.solicitante_numero);
    const malTel = !!f.solicitante_telefono?.trim() && !telefonoValido(f.solicitante_telefono);
    const malCorreo = !!f.solicitante_correo?.trim() && !correoValido(f.solicitante_correo);
    const malIdent = !!f.identidad_numero?.trim() && f.identidad_documento === 'DUI'
        && !duiValido(f.identidad_numero);

    // Lo que hace falta para que la fila deje de ser una hoja impresa y pase a
    // ser una solicitud en trámite: quién pide, qué pide, cuándo se recibió y
    // con qué documento se comprobó que es quien dice.
    const faltaParaRecibir = useMemo(() => {
        const faltan = [];
        if (!f.recibida_at)                 faltan.push('la fecha del acuse');
        if (!f.solicitante_nombre?.trim())  faltan.push('el nombre');
        if (!(f.derechos?.length))          faltan.push('qué solicita');
        if (!f.identidad_numero?.trim())    faltan.push('el número del documento cotejado');
        if (malDui)    faltan.push('un DUI válido');
        if (malIdent)  faltan.push('un DUI cotejado válido');
        if (malTel)    faltan.push('un teléfono de ocho dígitos');
        if (malCorreo) faltan.push('un correo con forma de correo');
        return faltan;
    }, [f, malDui, malIdent, malTel, malCorreo]);

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

                    <Seccion titulo="Quién solicita"
                        nota="Búscala primero: elegirla llena los campos y evita que un dígito de más los deje sin cruzar con la base.">
                        {/* El buscador va ARRIBA de los campos, no al lado. Con
                            los campos primero, quien transcribe los llena a mano
                            y el buscador queda como un extra que nadie aprieta;
                            arriba, la forma natural es encontrar y confirmar. */}
                        {/* `SearchInput` y no un `PortalInput` con un botón al
                            lado: es el canónico del buscador dentro de un modal
                            y trae lo que hace falta acá —el spinner en el sitio
                            de la lupa, la ✕ para limpiar y el contrato de
                            Escape—. El rótulo va aparte porque el canónico no
                            dibuja uno: el placeholder desaparece al escribir, y
                            «Nombre, DUI o teléfono» es justo lo que hay que
                            seguir viendo mientras se escribe. */}
                        <div className="space-y-1 min-w-0">
                            <span className="text-label uppercase tracking-wide font-semibold text-content-2">
                                Nombre, DUI o teléfono
                            </span>
                            <SearchInput
                                value={termino}
                                onChange={setTermino}
                                disabled={resuelta}
                                loading={buscando}
                                placeholder="Escribe un nombre, un DUI o un teléfono…"
                                ariaLabel="Buscar a la persona por nombre, DUI o teléfono"
                            />
                        </div>

                        {candidatos.length > 0 && (
                            <div data-surface="card" className="p-2 flex flex-col gap-1">
                                {candidatos.map((c, k) => (
                                    <button key={`${c.origen}-${k}`} type="button"
                                        onClick={() => elegir(c)}
                                        className="text-left px-3 py-2.5 min-h-[var(--tap-min)] rounded-card
                                                   hover:bg-surface-card-hover transition-colors
                                                   duration-[var(--dur-fast)] flex items-baseline gap-2">
                                        <span className="text-body-sm font-bold text-content min-w-0 truncate">
                                            {c.origen === 'empleado' ? shortEmployeeName({ name: c.nombre }) : c.nombre}
                                        </span>
                                        <span className="text-caption text-content-3 shrink-0">
                                            {ORIGEN[c.origen]}{c.numero ? ` · ${c.numero}` : ''}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <PortalInput label="Nombre completo" name="solicitante_nombre" colSpan={2}
                                value={f.solicitante_nombre ?? ''} readOnly={resuelta}
                                onChange={(e) => set('solicitante_nombre', e.target.value)} />
                            <div>
                                <span className="text-caption font-bold text-content-2 block mb-1.5">Tipo de documento</span>
                                <LiquidSelect value={f.solicitante_documento || 'DUI'} options={DOCUMENTOS}
                                    disabled={resuelta} clearable={false}
                                    onChange={(v) => set('solicitante_documento', v)} />
                            </div>
                            <PortalInput label="Número" name="solicitante_numero"
                                value={f.solicitante_numero ?? ''} readOnly={resuelta}
                                maskType={f.solicitante_documento === 'DUI' ? 'DUI' : undefined}
                                hasError={malDui} errorMessage="Ese DUI no pasa su dígito verificador."
                                onChange={(e) => set('solicitante_numero', e.target.value)} />
                            <PortalInput label="Dirección" name="solicitante_direccion" colSpan={2}
                                value={f.solicitante_direccion ?? ''} readOnly={resuelta}
                                onChange={(e) => set('solicitante_direccion', e.target.value)} />
                            <PortalInput label="Teléfono" name="solicitante_telefono" maskType="PHONE"
                                value={f.solicitante_telefono ?? ''} readOnly={resuelta}
                                hasError={malTel} errorMessage="Un teléfono son ocho dígitos."
                                onChange={(e) => set('solicitante_telefono', e.target.value)} />
                            <PortalInput label="Correo electrónico" name="solicitante_correo" type="email"
                                value={f.solicitante_correo ?? ''} readOnly={resuelta}
                                hasError={malCorreo} errorMessage="Ese correo no tiene forma de correo."
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
                        nota="Sale de la búsqueda de arriba. Es lo que se le entrega si pidió acceso.">
                        {!hallazgo ? (
                            <p className="text-body-sm text-content-3">
                                Todavía no se ha buscado. Usa el buscador de arriba.
                            </p>
                        ) : (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button variant="secondary" icon={Printer}
                                        onClick={imprimirRespuesta}>Imprimir la respuesta</Button>
                                    {(f.derechos ?? []).includes('portabilidad') && (
                                        <Button variant="secondary" icon={Download}
                                            onClick={descargarArchivo}>Descargar en archivo</Button>
                                    )}
                                </div>

                                <div data-surface="card" className="p-3.5 flex flex-col gap-2">
                                    {hallazgo.fallaron?.length > 0 && (
                                        <Notice variant="danger" bloque>
                                            No se pudo consultar {hallazgo.fallaron.join(', ')}. Esta búsqueda
                                            está incompleta: no la uses para responder que no hay información.
                                        </Notice>
                                    )}
                                    {hallazgo.porNombre && (
                                        <Notice variant="warning" compact>
                                            Se buscó por nombre. Un nombre trae homónimos: comprueba que la
                                            ficha sea la de esta persona antes de entregarle nada.
                                        </Notice>
                                    )}

                                    {/* Se listan los CINCO sitios, hayan encontrado
                                        o no. Enseñar sólo los que dieron resultado
                                        dejaría invisible lo que se miró, y «no
                                        consta» sólo vale si se sabe dónde se buscó. */}
                                    <ul className="flex flex-col gap-1.5">
                                        {(hallazgo.donde ?? []).map((d) => (
                                            <li key={d.clave} className="text-body-sm flex items-start gap-2">
                                                {d.falló
                                                    ? <AlertTriangle size={15} className="text-danger-text mt-0.5 shrink-0" />
                                                    : d.filas.length
                                                        ? <UserCheck size={15} className="text-success-text mt-0.5 shrink-0" />
                                                        : <span className="w-[15px] shrink-0" />}
                                                <span className="min-w-0 text-content-2">
                                                    <span className="text-content-3">{d.rotulo}: </span>
                                                    {d.falló ? 'no se pudo consultar'
                                                        : d.filas.length === 0 ? 'sin coincidencias'
                                                        : d.filas.length === 1 ? <strong className="text-content">{nombreDe(d)}</strong>
                                                        : `${d.filas.length} coincidencias`}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>

                                    {hallazgo.total === 0 && !hallazgo.fallaron?.length && (
                                        <Notice variant="info" bloque>
                                            Con esos datos no aparece nada. Antes de responder que no consta
                                            información, prueba con el otro documento, con el teléfono o con
                                            el nombre: un dato guardado de otra forma no aparece, y eso no es
                                            lo mismo que no existir.
                                        </Notice>
                                    )}
                                </div>
                            </>
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
                                maskType={f.identidad_documento === 'DUI' ? 'DUI' : undefined}
                                hasError={malIdent} errorMessage="Ese DUI no pasa su dígito verificador."
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

/**
 * Aplana una fila de cualquiera de los cinco sitios a lo que pide el formulario.
 *
 * Cada tabla guarda lo mismo con otro nombre: el proveedor tiene `nombre` y
 * `correo`, el cliente `name` y `email`, el practicante el nombre partido en
 * dos. Traducir acá y no en cada sitio es lo que permite que elegir a una
 * persona llene los campos sin importar de dónde salió.
 */
function comoPersona(clave, x) {
    const base = { origen: clave };
    if (clave === 'practicante') return { ...base,
        nombre: `${x.first_names ?? ''} ${x.last_names ?? ''}`.trim(),
        documento: 'DUI', numero: x.dui, telefono: x.phone, correo: '', direccion: '' };
    if (clave === 'proveedor') return { ...base,
        nombre: x.nombre, documento: x.dui ? 'DUI' : 'NIT', numero: x.dui || x.nit,
        telefono: x.telefono, correo: x.correo, direccion: x.direccion };
    if (clave === 'receta') return { ...base,
        nombre: x.paciente_nombre, documento: 'DUI', numero: x.paciente_documento,
        telefono: '', correo: '', direccion: '' };
    if (clave === 'empleado') return { ...base,
        nombre: x.name, documento: 'DUI', numero: x.dui,
        telefono: x.phone, correo: x.email, direccion: x.address };
    return { ...base, nombre: x.name, documento: x.dui ? 'DUI' : 'NIT',
        numero: x.dui || x.nit, telefono: x.phone, correo: x.email, direccion: x.direccion };
}

/** El nombre que muestra cada sitio: no todos lo guardan en `name`. */
function nombreDe(d) {
    const fila = d.filas[0] ?? {};
    if (d.clave === 'practicante') return `${fila.first_names ?? ''} ${fila.last_names ?? ''}`.trim();
    if (d.clave === 'proveedor') return fila.nombre ?? '';
    if (d.clave === 'receta') return fila.paciente_nombre ?? '';
    if (d.clave === 'empleado') return shortEmployeeName(fila);
    return fila.name ?? '';
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
