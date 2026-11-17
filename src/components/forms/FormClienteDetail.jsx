import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Check, IdCard, MapPin, Phone, ShieldCheck, Receipt,
    History, AlertTriangle, Store, Building2, Wand2,
} from 'lucide-react';
import { enAscii, esTextoSeguro } from '@nucleo/utils/preventa';
import Button from '../common/Button';
import Badge from '../common/Badge';
import Notice from '../common/Notice';
import LiquidSelect from '../common/LiquidSelect';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import SegmentedControl from '../common/SegmentedControl';
import { LoadingState } from '../common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import {
    fetchCustomerDetail, updateCustomerFiscal, pushClienteAlErp, motivoSinAplicar,
    codigoDeError, mensajeDeError, crearCliente, altaClienteEnCaja,
} from '@nucleo/data/customers';
import {
    EL_SALVADOR_GEO, municipiosDe, distritosDe, normalizarGeo, conciliarGeo,
} from '@nucleo/data/elSalvadorGeo';
import {
    validarCliente, camposRequeridos, esContribuyente as esFiscal,
    ETIQUETA_CAMPO as ETIQUETAS, CAMPOS_FICHA, CATEGORIAS_CLIENTE, cambiosDeFicha,
    camposDeCategoria, conCategoria, cargarGiros, giroDelCatalogo } from '@nucleo/utils/clienteValidacion';
import useBorrador from '@nucleo/hooks/useBorrador';
import AvisoDeBorrador from '../common/AvisoDeBorrador';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { hora12 } from '@nucleo/utils/hora';
import { fechaNumerica } from '@nucleo/utils/fecha';

const CATEGORIAS = CATEGORIAS_CLIENTE;

// Los campos que el ERP guarda y que esta ficha edita. El orden es el del
// formulario, no el de la tabla.
const CAMPOS = CAMPOS_FICHA;

const ETIQUETA_CAMPO = ETIQUETAS;

const fmtDate = (d) => fechaNumerica(d, { vacio: '—' });
/**
 * Los años cumplidos.
 *
 * Se parte la cadena a mano en vez de `new Date('1958-02-28')`: esa forma la lee
 * el navegador como UTC, y en El Salvador (UTC−6) eso resta un día — un
 * cumpleaños del 1 de marzo se mostraría el 28 de febrero. Es
 * [[feedback_una_fecha_sin_hora_leida_como_utc_retrocede]] aplicado acá.
 */
const edadDe = (iso) => {
    if (!iso) return null;
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const hoy = new Date();
    let edad = hoy.getFullYear() - a;
    if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) edad--;
    return edad;
};

const fmtDateTime = (d) => {
    if (!d) return '—';
    return `${fmtDate(d)} ${hora12(new Date(d))}`;
};

function SectionHeader({ icon: Icon, children }) {
    return (
        <h4 className="text-label font-black uppercase tracking-widest text-brand-text flex items-center gap-2 pt-5 border-t border-divider">
            <Icon size={13} strokeWidth={2.5} /> {children}
        </h4>
    );
}

function Dato({ label, value, valueCls = 'text-content-2' }) {
    return (
        <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-widest text-content-3">{label}</p>
            <p className={`text-body-sm font-bold tabular-nums ${valueCls}`}>{value}</p>
        </div>
    );
}

// ── Actividad ────────────────────────────────────────────────────────────────

function PanelActividad({ actividad, facturas, bitacora }) {
    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Dato label="Facturas" value={(actividad?.facturas ?? 0).toLocaleString('es-SV')} />
                <Dato label="Facturado" value={formatMoney(actividad?.total ?? 0)} />
                <Dato label="Créditos fiscales" value={(actividad?.facturas_ccf ?? 0).toLocaleString('es-SV')} />
                <Dato label="Anuladas"
                    value={(actividad?.facturas_anuladas ?? 0).toLocaleString('es-SV')}
                    valueCls={actividad?.facturas_anuladas ? 'text-danger-text' : 'text-content-2'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Dato label="Primera compra" value={fmtDate(actividad?.primera_fecha)} />
                <Dato label="Última compra" value={fmtDate(actividad?.ultima_fecha)} />
            </div>

            <SectionHeader icon={Receipt}>Últimas facturas</SectionHeader>
            {facturas.length === 0 ? (
                <p className="text-body-sm text-content-3">Sin facturas registradas.</p>
            ) : (
                <div className="space-y-1.5">
                    {facturas.map(f => (
                        <div key={f.id}
                            className="flex items-center gap-3 px-3 py-2 rounded-btn bg-surface-card-hover/60 border border-divider">
                            <span className="text-caption tabular-nums text-content-3 w-[74px] shrink-0">{fmtDate(f.fecha)}</span>
                            <Badge size="sm" variant={f.tipo_documento === 'CCF' ? 'info' : 'neutral'}>
                                {f.tipo_documento}
                            </Badge>
                            <span className="text-caption text-content-3 truncate min-w-0 flex-1" title={f.sucursal}>
                                {f.sucursal || '—'}
                            </span>
                            {f.estado !== 'FINALIZADA' && (
                                <Badge size="sm" variant="danger">Anulada</Badge>
                            )}
                            <span className="text-body-sm font-bold tabular-nums text-content-2 shrink-0">
                                {formatMoney(f.total)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <SectionHeader icon={History}>Cambios en los datos</SectionHeader>
            {bitacora.length === 0 ? (
                <p className="text-body-sm text-content-3">Los datos no se han editado desde el portal.</p>
            ) : (
                <div className="space-y-1.5">
                    {bitacora.map((h, i) => (
                        <div key={i} className="px-3 py-2 rounded-btn bg-surface-card-hover/60 border border-divider">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-caption font-black uppercase tracking-widest text-content-2">
                                    {ETIQUETA_CAMPO[h.campo] || h.campo}
                                </span>
                                <span className="text-caption text-content-3">{fmtDateTime(h.changed_at)}</span>
                                {h.changed_by_nombre && (
                                    <span className="text-caption text-content-3">· {h.changed_by_nombre}</span>
                                )}
                                {/* La bitácora es también la cola de la Fase 2:
                                    lo que todavía no viajó al ERP se ve acá.
                                    "Descartado" va primero porque es un estado
                                    final: el ERP se movió antes de que esta
                                    edición llegara, así que ya no va a viajar
                                    nunca. Cuando las dos se veían igual, el
                                    aviso de "sin enviar" quedaba encendido para
                                    siempre sobre algo que ya estaba decidido. */}
                                {h.descartado_at
                                    ? <Badge size="sm" variant="neutral">Descartado: ya había otro valor</Badge>
                                    : !h.erp_synced_at && <Badge size="sm" variant="warning">Sin aplicar</Badge>}
                            </div>
                            <p className="text-caption text-content-3 mt-0.5 break-words">
                                <span className="line-through">{h.valor_anterior || '(vacío)'}</span>
                                {' → '}
                                <span className="text-content-2 font-bold">{h.valor_nuevo || '(vacío)'}</span>
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Formulario ───────────────────────────────────────────────────────────────

// La ficha vacía con la que nace un cliente (2026-11-15: los clientes se crean
// en el portal y el portal les da el número de la caja).
const FICHA_NUEVA = Object.freeze(
    Object.fromEntries(CAMPOS.map(c => [c, c === 'categoria' ? 'Consumidor' : ''])));

// ── El tipo de cliente, primero ──────────────────────────────────────────────
// En el alta lo primero que se elige es QUÉ es el cliente, y de eso sale qué
// se pide (2026-11-15, «que sea fácil y eficiente»). Tres grupos y no seis
// opciones: casi todos son consumidores o contribuyentes, y el canon pone el
// tope de un segmentado en tres (DESIGN.md §15.3). Las variantes raras se
// eligen después, sólo dentro de su grupo.
const GRUPO_DE = {
    'Consumidor': 'consumidor', 'Contribuyente': 'contribuyente',
    'Gran Contribuyente': 'contribuyente', 'Contribuyente Exento': 'contribuyente',
    'Extranjero': 'otro', 'Menor de edad': 'otro',
};
const PRIMERA_DEL_GRUPO = { consumidor: 'Consumidor', contribuyente: 'Contribuyente', otro: 'Extranjero' };
const VARIANTES = {
    contribuyente: ['Contribuyente', 'Gran Contribuyente', 'Contribuyente Exento'],
    otro: ['Extranjero', 'Menor de edad'],
};
const QUE_ES = {
    'Consumidor': 'Persona que compra. Lleva factura: basta su DUI (o su NIT), el teléfono y dónde vive.',
    'Contribuyente': 'Inscrito en IVA: se le emite crédito fiscal. Pide NIT, NRC, giro, correo y dirección.',
    'Gran Contribuyente': 'Como un contribuyente, y además es agente de retención: lleva su porcentaje.',
    'Contribuyente Exento': 'Inscrito en IVA pero exento del impuesto. Pide los mismos datos que un contribuyente.',
    'Extranjero': 'No tiene DUI: se identifica con su pasaporte.',
    'Menor de edad': 'No tiene documento propio: basta el nombre, el teléfono y dónde vive.',
};

/** Lo que llega ya escrito (desde el buscador del Inicio): sólo campos de la ficha. */
const inicialDe = (x) => Object.fromEntries(Object.entries(x || {})
    .filter(([k, v]) => CAMPOS.includes(k) && k !== 'categoria' && v != null && String(v).trim()));

// Lo que pide `cliente_crear` además del formulario de siempre: nombre y
// apellido, y un documento según la categoría (FALTA_DOCUMENTO en la base).
function faltaAlNacer(f) {
    const faltan = [];
    if (String(f?.name ?? '').trim().split(/\s+/).filter(Boolean).length < 2) faltan.push('name');
    if (f?.categoria === 'Extranjero') { if (!String(f?.pasaporte ?? '').trim()) faltan.push('pasaporte'); }
    else if (f?.categoria !== 'Menor de edad'
        && !String(f?.dui ?? '').trim() && !String(f?.nit ?? '').trim()) faltan.push('dui');
    return faltan;
}

const ROTULO_COMPLETAR = { nit: 'NIT', nrc: 'NRC', giro: 'giro', direccion: 'dirección', phone: 'teléfono', email: 'correo', dui: 'DUI' };

const FormClienteDetail = ({ formData }) => {
    // Sin `id` es un alta. Al crearse, la misma ventana pasa a ser la ficha de
    // ese cliente: así se ve en vivo cuando la caja le da su número.
    const [idCreado, setIdCreado] = useState(null);
    const id = formData?.id ?? idCreado;
    const esNuevo = !id;
    // Crear lo decide `clientes_crear` (lo mira quien abre el alta); ya creada,
    // corregirla vuelve a ser el permiso de editar de siempre.
    const canEdit = esNuevo || formData?.canEdit !== false;
    const [vuelta, setVuelta] = useState(0);   // releer la ficha tras el alta en la caja

    const [cargando, setCargando] = useState(true);
    const [cliente, setCliente] = useState(null);
    const [actividad, setActividad] = useState(null);
    const [facturas, setFacturas] = useState([]);
    const [bitacora, setBitacora] = useState([]);
    const [panel, setPanel] = useState('ficha');

    const [form, setForm] = useState(null);
    const [guardando, setGuardando] = useState(false);
    // El catálogo de giros de Hacienda, cargado aparte (ver `cargarGiros`).
    const [giros, setGiros] = useState([]);
    useEffect(() => {
        let vivo = true;
        cargarGiros().then(g => { if (vivo) setGiros(g); })
            .catch(e => console.error('FormClienteDetail.jsx: giros', e));
        return () => { vivo = false; };
    }, []);

    /* La ficha fiscal se EDITA, así que el borrador se OFRECE y no se repone
     * solo: reponer sobre un registro vivo escribiría datos viejos encima de lo
     * que otra persona —o la corrida nocturna de fichas— cambió en el medio, y
     * acá eso no es un detalle: los campos que se tocan son los que Hacienda
     * mira en un documento fiscal.
     *
     * Sólo se guarda con la ficha ya cargada (`form` deja de ser `null`): antes
     * de eso, guardar escribiría el vacío encima de lo que hubiera. */
    const claveBorrador = id ? `cliente_${id}` : 'cliente_nuevo';
    const { recuperado: borrador, cuando: borradorCuando, descartar: descartarBorrador } =
        useBorrador(claveBorrador, form, { activo: canEdit && !!form });
    const [ofrecido, setOfrecido] = useState(false);
    useEffect(() => { setOfrecido(false); }, [claveBorrador]);
    const [error, setError] = useState('');
    // El servidor exige un sí explícito para tocar los datos fiscales de un
    // contribuyente. Cuando lo pide, se muestra el aviso y el siguiente clic
    // reenvía confirmando — el candado real vive en el RPC, no acá.
    const [pideConfirmacion, setPideConfirmacion] = useState(false);

    // Sólo cuenta la ÚLTIMA lectura. Al crear un cliente se cruzan dos (la de
    // abrir su ficha y la de después de pedirle el número): si la vieja llega
    // tarde pisa a la nueva, y la segunda escritura del formulario la guardaba
    // el borrador como «cambios sin guardar» (medido en pruebas, 2026-11-15).
    const pedidoRef = useRef(0);
    const inicial = formData?.inicial;
    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        if (!id) {
            setCliente({ ...FICHA_NUEVA });
            setForm({ ...FICHA_NUEVA, ...inicialDe(inicial) });
            setCargando(false);
            return;
        }
        setCargando(true);
        // Sin ficha mientras se relee: así el borrador se apaga y vuelve a armar
        // su guarda, y la ficha recién leída no cuenta como «cambios sin guardar».
        setForm(null);
        try {
            const d = await fetchCustomerDetail(id);
            if (mio !== pedidoRef.current) return;
            // El ERP rotula en MAYÚSCULA y sin tildes, y los selects comparan
            // por igualdad: sin conciliar, 687 de las 894 fichas con distrito se
            // ven VACÍAS teniéndolo. Se concilia la ficha ENTERA —no solo el
            // formulario— para que el diff de `cambios` no marque una
            // modificación que nadie hizo.
            const conciliado = d.cliente
                ? { ...d.cliente, ...conciliarGeo(d.cliente) } : null;
            setCliente(conciliado);
            setActividad(d.actividad || null);
            setFacturas(d.facturas || []);
            setBitacora(d.bitacora || []);
            setForm(Object.fromEntries(CAMPOS.map(c => [c, conciliado?.[c] ?? ''])));
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('FormClienteDetail.jsx: ', e);
            setError(mensajeDeError(e));
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, [id, inicial]);

    useEffect(() => { cargar(); }, [cargar, vuelta]);

    // La cascada se normaliza en un solo lugar (`normalizarGeo`), el mismo que
    // usa el servidor como regla: cambiar el departamento no puede dejar vivo un
    // municipio de otro, ni un distrito que ya no pertenece a nadie.
    const setGeo = useCallback((parcial) => {
        setForm(p => ({ ...p, ...normalizarGeo({ ...p, ...parcial }) }));
    }, []);

    const esContribuyente = esFiscal(form?.categoria);

    // Los documentos que se ven dependen de la categoría. En una ficha que ya
    // existe, lo que tiene escrito se sigue viendo aunque la categoría no lo
    // lleve: esconder un dato guardado es perderlo de vista.
    const lleva = useMemo(() => camposDeCategoria(form?.categoria), [form?.categoria]);
    const ver = (campo) => lleva.has(campo)
        || (!esNuevo && !!String(cliente?.[campo] ?? '').trim());

    // Un solo veredicto para toda la ficha, calculado en `clienteValidacion`:
    // el formulario pinta, no decide. `errores` es "está mal escrito" y `faltan`
    // es "todavía no lo llenaste" — se muestran distinto porque se leen distinto.
    const v = useMemo(() => {
        const r = validarCliente(form, cliente);
        if (!esNuevo) return r;
        const extra = faltaAlNacer(form).filter(c => !r.faltan.includes(c) && !r.errores[c]);
        return extra.length ? { ...r, faltan: [...r.faltan, ...extra], ok: false } : r;
    }, [form, cliente, esNuevo]);
    const requeridos = useMemo(
        () => new Set(camposRequeridos(form?.categoria)), [form?.categoria]);

    // Un cliente de mostrador no es una persona: no lleva ficha fiscal y el
    // servidor rechaza el guardado con ES_MOSTRADOR. Sin esto el botón queda
    // habilitado para que el viaje termine en un error que ya sabíamos.
    const editable = canEdit && !cliente?.mostrador;

    // `faltan` NO se marca en rojo hasta que la persona intenta guardar: abrir
    // una ficha vieja e incompleta y encontrarla en rojo entera es hostil, y
    // además no es un error suyo. Lo mal escrito sí se marca al instante,
    // porque eso sí lo acaba de teclear.
    const [intentoGuardar, setIntentoGuardar] = useState(false);

    // Solo viaja lo que cambió. Es lo contrario del POST del ERP —que borra lo
    // que no se le manda— y hace que la bitácora registre ediciones reales en
    // vez de una fila por campo cada vez que alguien abre y guarda.
    const cambios = useMemo(() => cambiosDeFicha(form, cliente), [form, cliente]);

    const hayCambios = Object.keys(cambios).length > 0;

    // Cuándo se señala un requerido vacío. NO al abrir: encontrar en rojo una
    // ficha vieja e incompleta es hostil, y además no es culpa de quien la
    // abrió. Sí en cuanto hay algo pendiente de guardar — para entonces ya está
    // editando, y si no se le dice se topa con un botón apagado y sin motivo.
    // (Ese era el callejón: el aviso colgaba de `intentoGuardar`, que no puede
    //  ocurrir porque el botón deshabilitado no dispara el clic.)
    const señalarFaltantes = intentoGuardar || hayCambios;
    const marcarFalta = (campo) => señalarFaltantes && v.faltan.includes(campo);
    // Al crear, lo que falta puede no ser «para facturar» sino para identificar
    // a la persona (nombre y apellido, un documento): se dice eso.
    const FALTA_AL_NACER = {
        name: 'Nombre y apellido',
        dui: form?.categoria === 'Extranjero' ? undefined : 'DUI o NIT',
        pasaporte: 'El pasaporte, si es extranjero',
    };
    // Quien abre la ficha para completar una venta (Preventa, 2026-11-16:
    // «al dar en completar, que visualmente me diga qué falta») dice qué le
    // falta: `formData.completar = { campos, motivo, categoria? }`. Ahí sí se
    // marca al abrir, porque abrirla ES ir a completar eso.
    const completar = formData?.completar ?? null;
    const pendientes = (completar?.campos ?? []).filter(c => !String(form?.[c] ?? '').trim());
    const faltaCategoria = Boolean(completar?.categoria) && !esFiscal(form?.categoria);
    const errorDe = (campo) =>
        v.errores[campo] || (pendientes.includes(campo) ? (completar.rotulo ?? completar.motivo) : undefined) || (marcarFalta(campo)
            ? (esNuevo && FALTA_AL_NACER[campo]) || 'Requerido para facturar' : undefined);

    const guardar = useCallback(async (confirmando = false) => {
        setIntentoGuardar(true);
        // Cinturón además del botón deshabilitado: `guardar(true)` se llama
        // también desde el botón "Confirmar" del aviso fiscal, que es otro
        // camino y no pasa por el `disabled` del principal.
        if (!v.ok) return;
        setGuardando(true);
        setError('');
        if (esNuevo) {
            try {
                const r = await crearCliente(cambios);
                descartarBorrador();
                setIdCreado(r.id);
                formData?.onSaved?.(r);
                const toast = useToastStore.getState().showToast;
                if (r.existente) {
                    toast('Ya estaba registrado',
                        `${r.name} ya estaba registrado${r.por === 'nombre' ? ' con ese nombre' : ' con ese documento'}. Se abrieron sus datos.`,
                        'info');
                } else {
                    toast('Cliente creado', 'Asignándole su número…', 'success');
                    // Como el empuje de una edición: la ficha ya está guardada, y
                    // si la caja no contesta se reintenta sola en unos minutos.
                    const a = await altaClienteEnCaja(r.id);
                    if (a?.hecho) toast('Listo para facturar', `Cliente número ${a.erp_id}.`, 'success');
                    else toast('Creado, falta el número',
                        a?.revisar ? 'Hay que revisarlo: aparece en «Sin número» de la lista de clientes.'
                            : 'Se le asigna solo en unos minutos.',
                        'warning');
                    setVuelta(n => n + 1);
                }
            } catch (e) {
                console.error('FormClienteDetail.jsx: crear', e);
                setError(mensajeDeError(e));
            } finally {
                setGuardando(false);
            }
            return;
        }
        try {
            // La bitácora la anota `updateCustomerFiscal` (D3).
            await updateCustomerFiscal(id, cambios, { confirmarFiscal: confirmando }, { nombre: cliente?.name });
            const n = Object.keys(cambios).length;
            useToastStore.getState().showToast(
                'Datos actualizados',
                `${n} campo${n !== 1 ? 's' : ''} guardado${n !== 1 ? 's' : ''}. Aplicando el cambio…`,
                'success');
            setPideConfirmacion(false);
            // La ficha quedó guardada: el borrador ya no sirve. Va DESPUÉS del
            // `await`, para que un guardado fallido no se lleve lo escrito.
            descartarBorrador();
            formData?.onSaved?.();
            await cargar();

            // El empuje al ERP va DESPUÉS de dar por guardada la ficha y de
            // refrescarla: el guardado en el portal ya terminó, y el ERP es un
            // servidor ajeno que puede tardar. Si falla, la edición queda en la
            // cola y protegida — no se pierde, solo llega más tarde.
            const r = await pushClienteAlErp(id);
            if (r?.empujado) {
                useToastStore.getState().showToast(
                    'Cambio aplicado', `Se actualizó el cliente número ${r.erp_id}.`, 'success');
            } else {
                useToastStore.getState().showToast(
                    'Guardado, falta aplicarlo',
                    motivoSinAplicar(r),
                    'warning');
            }
            await cargar();
        } catch (e) {
            if (codigoDeError(e) === 'REQUIERE_CONFIRMACION_FISCAL') {
                setPideConfirmacion(true);
                setError('');
            } else {
                console.error('FormClienteDetail.jsx: guardar', e);
                setError(mensajeDeError(e));
            }
        } finally {
            setGuardando(false);
        }
    }, [id, cambios, cliente, formData, cargar, descartarBorrador, esNuevo, v.ok]);

    if (cargando) return <LoadingState label="Cargando los datos…" />;

    // `!form`: una relectura que falló deja la ficha vieja pero sin formulario.
    if (!cliente || !form) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {error || 'No se pudieron cargar los datos.'}
            </Notice>
        );
    }

    const municipioOpts = municipiosDe(form.departamento).map(m => ({ value: m, label: m }));
    const catalogoDistritos = distritosDe(form.municipio);
    const distritoOpts = catalogoDistritos.map(d => ({ value: d, label: d }));
    // Las 207 abreviaturas del ERP ("SN MIG MERCEDES") que ninguna
    // normalización resuelve: se agregan como opción para que el campo muestre
    // lo que la ficha realmente tiene, en vez de aparecer vacío y empujar a
    // reemplazarlo por otro distrito.
    if (form.distrito && !catalogoDistritos.includes(form.distrito)) {
        distritoOpts.unshift({ value: form.distrito, label: `${form.distrito} (como está guardado)` });
    }

    return (
        <div className="space-y-5">
            {borrador && !ofrecido && panel === 'ficha' && (
                <AvisoDeBorrador
                    cuando={borradorCuando}
                    onRecuperar={() => { setForm(f => ({ ...f, ...borrador })); setOfrecido(true); }}
                    onDescartar={() => { descartarBorrador(); setOfrecido(true); }}
                />
            )}

            {!esNuevo && <SegmentedControl
                options={[
                    { value: 'ficha', label: 'Datos fiscales' },
                    { value: 'actividad', label: 'Actividad' },
                    // «Puntos» se fue a la vista Puntos (2026-09-25): ahí están
                    // el saldo, los movimientos y el código de acceso.
                ]}
                value={panel}
                onChange={setPanel}
                label="Sección de los datos del cliente"
            />}

            {completar && !cliente.mostrador && (faltaCategoria || pendientes.length > 0) && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <span className="font-bold">{completar.motivo}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                        {[faltaCategoria && `Tipo ${completar.categoria}`, ...pendientes.map(c => ETIQUETA_CAMPO[c] ?? c)]
                            .filter(Boolean).map(t => <Badge key={t} size="sm" variant="warning" uppercase={false}>{t}</Badge>)}
                    </span>
                    {faltaCategoria && <span className="block mt-1.5 text-caption">Elige Contribuyente arriba: así aparecen sus campos.</span>}
                </Notice>
            )}

            {cliente.mostrador && (
                <Notice variant="warning" icon={Store}>
                    Es el cliente genérico del mostrador. Lleva las ventas sin cliente.
                    No se puede editar.
                </Notice>
            )}

            {cliente.nombre_corrupto && (
                <Notice variant="danger" icon={AlertTriangle}>
                    El nombre tiene las tildes mal escritas. Corrígelo a mano.
                </Notice>
            )}

            {panel === 'actividad' ? (
                <PanelActividad actividad={actividad} facturas={facturas} bitacora={bitacora} />
            ) : (
                <div className="space-y-5">
                    {/* Tipo e identidad */}
                    <div className="space-y-3">
                        <SectionHeader icon={IdCard}>Tipo de cliente</SectionHeader>
                        {/* El mismo selector al crear y al editar (2026-11-16, usuario: «¿por qué
                            el editor no es como el creador?»). Al editar no se borra nada al
                            cambiar de tipo: lo escrito sigue a la vista. */}
                        {(esNuevo || editable) && (
                            <div className={`space-y-2 ${faltaCategoria ? 'rounded-2xl ring-1 ring-danger/30 p-2' : ''}`}>
                                <SegmentedControl
                                    value={GRUPO_DE[form.categoria] ?? (esNuevo ? 'consumidor' : '')}
                                    onChange={g => setForm(p => (GRUPO_DE[p.categoria] === g ? p
                                        : esNuevo ? conCategoria(p, PRIMERA_DEL_GRUPO[g]) : { ...p, categoria: PRIMERA_DEL_GRUPO[g] }))}
                                    label="Tipo de cliente"
                                    options={[
                                        { value: 'consumidor', label: 'Consumidor' },
                                        { value: 'contribuyente', label: 'Contribuyente' },
                                        { value: 'otro', label: 'Otro' },
                                    ]}
                                />
                                {VARIANTES[GRUPO_DE[form.categoria]] && (
                                    <LiquidSelect
                                        value={form.categoria}
                                        onChange={v => v && setForm(p => (esNuevo ? conCategoria(p, v) : { ...p, categoria: v }))}
                                        options={VARIANTES[GRUPO_DE[form.categoria]].map(c => ({ value: c, label: c }))}
                                        clearable={false}
                                        ariaLabel="Qué clase de cliente"
                                    />
                                )}
                                {QUE_ES[form.categoria] && <p className="text-caption text-content-3 ml-1">{QUE_ES[form.categoria]}</p>}
                            </div>
                        )}
                        {!esNuevo && !editable && (
                            <Dato label="Categoría" value={form.categoria || 'Sin categoría'} />
                        )}
                    </div>

                    <div className="space-y-3">
                        <SectionHeader icon={IdCard}>Identidad</SectionHeader>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <PortalInput
                                    name="name" label="Nombre" required
                                    value={form.name} readOnly={!editable}
                                    hasError={!!errorDe('name')} errorMessage={errorDe('name')}
                                    helperText={esContribuyente
                                        ? 'Nombre o razón social, como en su tarjeta de IVA. Se guarda en mayúscula'
                                        : form.categoria === 'Extranjero'
                                            ? 'Nombre y apellido, como en el pasaporte. Se guarda en mayúscula'
                                            : esNuevo ? 'Nombre y apellido, como en el DUI. Se guarda en mayúscula' : 'Se guarda en mayúscula'}
                                    onChange={e => setForm(p => ({ ...p, name: e.target.value.toUpperCase() }))}
                                />
                                {/* Caja no acepta a su nombre a quien lleva tilde o Ñ: sin esto no
                                    se le puede dar crédito fiscal, crédito ni puntos desde Preventa. */}
                                {editable && form.name && !esTextoSeguro(form.name) && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-warning/10 px-3 py-2">
                                        <AlertTriangle size={14} className="shrink-0 text-warning-text" />
                                        <p className="flex-1 min-w-0 text-caption font-semibold text-warning-text">
                                            Caja no acepta tildes ni Ñ en el nombre. Quedaría: <span className="font-black">{enAscii(form.name)}</span>
                                        </p>
                                        <Button size="sm" variant="secondary" icon={Wand2}
                                            onClick={() => setForm(p => ({ ...p, name: enAscii(p.name) }))}>Corregir</Button>
                                    </div>
                                )}
                            </div>
                            {ver('dui') && <PortalInput
                                name="dui" label="DUI" maskType="DUI"
                                placeholder="00000000-0"
                                value={form.dui} readOnly={!editable}
                                hasError={!!errorDe('dui')} errorMessage={errorDe('dui')}
                                helperText={esNuevo && !esContribuyente ? 'O el NIT, si no tiene DUI' : undefined}
                                onChange={e => setForm(p => ({ ...p, dui: e.target.value }))}
                            />}
                            {!esNuevo && form.categoria === 'Menor de edad' && (
                                <p className="sm:col-span-2 text-caption text-content-3 ml-1">
                                    Un menor de edad no lleva documento. Se identifica por nombre y teléfono.
                                </p>
                            )}
                            {/* De SÓLO LECTURA a propósito. El guardado de esta
                                ficha va por `update_customer_fiscal`, que es la
                                vía FISCAL: pide confirmación para tocar a un
                                contribuyente, lo anota como cambio fiscal y lo
                                empuja al sistema de origen. Un cumpleaños no es
                                nada de eso, así que meterlo por ahí lo trataría
                                como lo que no es. Editarlo necesita su propio
                                camino, y todavía no existe. */}
                            {cliente.fecha_nacimiento && (
                                <Dato label="Fecha de nacimiento"
                                    value={`${fmtDate(cliente.fecha_nacimiento)} · ${edadDe(cliente.fecha_nacimiento)} años`} />
                            )}
                            {ver('nit') && <PortalInput
                                name="nit" label="NIT" maskType="NIT"
                                placeholder="14 dígitos"
                                required={requeridos.has('nit')}
                                value={form.nit} readOnly={!editable}
                                hasError={!!errorDe('nit')} errorMessage={errorDe('nit')}
                                helperText={esContribuyente ? 'El de la tarjeta de IVA; una persona puede usar su DUI' : undefined}
                                onChange={e => setForm(p => ({ ...p, nit: e.target.value }))}
                            />}
                            {ver('nrc') && <PortalInput
                                name="nrc" label="NRC" maskType="NRC"
                                placeholder="4 a 8 dígitos"
                                required={requeridos.has('nrc')}
                                value={form.nrc} readOnly={!editable}
                                hasError={!!errorDe('nrc')} errorMessage={errorDe('nrc')}
                                helperText={esContribuyente ? 'Requerido para emitirle crédito fiscal' : undefined}
                                onChange={e => setForm(p => ({ ...p, nrc: e.target.value }))}
                            />}
                            {ver('pasaporte') && <PortalInput
                                name="pasaporte" label="Pasaporte"
                                required={esNuevo && form.categoria === 'Extranjero'}
                                value={form.pasaporte} readOnly={!editable}
                                hasError={!!errorDe('pasaporte')} errorMessage={errorDe('pasaporte')}
                                onChange={e => setForm(p => ({ ...p, pasaporte: e.target.value.toUpperCase() }))}
                            />}
                            {/* El giro sale del catálogo de actividades de
                                Hacienda: escrito a mano, la caja no lo
                                reconoce y el CCF no lo acepta. Un giro viejo
                                escrito con otras tildes se reconoce igual
                                (`giroDelCatalogo`); uno que no está se ve tal
                                cual hasta que alguien elija del listado. */}
                            {ver('giro') && <div className="sm:col-span-2" data-campo="giro">
                                <label className={rotuloCampo(errorDe('giro') ? 'text-danger-text' : 'text-content-3')}>
                                    Giro{requeridos.has('giro') ? ' *' : ''}
                                </label>
                                <LiquidSelect
                                    value={giroDelCatalogo(form.giro, giros) ?? form.giro}
                                    onChange={v => setForm(p => ({ ...p, giro: v || '' }))}
                                    options={giroDelCatalogo(form.giro, giros) || !form.giro
                                        ? giros
                                        : [{ value: form.giro, label: form.giro, sublabel: 'No está en el listado del MH' }, ...giros]}
                                    placeholder={giros.length ? 'Busca la actividad económica' : 'Cargando actividades…'}
                                    clearable={!requeridos.has('giro')}
                                    disabled={!editable || !giros.length}
                                    ariaLabel="Giro o actividad económica"
                                />
                                {errorDe('giro') && (
                                    <p className="text-caption text-danger-text mt-1 ml-1 font-bold">{errorDe('giro')}</p>
                                )}
                            </div>}
                        </div>
                    </div>

                    {/* Contacto */}
                    <div className="space-y-3">
                        <SectionHeader icon={Phone}>Contacto</SectionHeader>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <PortalInput
                                name="phone" label="Teléfono" type="tel" required
                                maskType="PHONE" placeholder="0000-0000"
                                value={form.phone} readOnly={!editable}
                                hasError={!!errorDe('phone')} errorMessage={errorDe('phone')}
                                helperText="La factura lo pide"
                                onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                            />
                            <PortalInput
                                name="telefono2" label="Teléfono 2" type="tel"
                                maskType="PHONE" placeholder="0000-0000"
                                value={form.telefono2} readOnly={!editable}
                                hasError={!!errorDe('telefono2')} errorMessage={errorDe('telefono2')}
                                onChange={e => setForm(p => ({ ...p, telefono2: e.target.value }))}
                            />
                            <div className="sm:col-span-2">
                                <PortalInput
                                    name="email" label="Correo" type="email"
                                    required={requeridos.has('email')}
                                    value={form.email} readOnly={!editable}
                                    hasError={!!errorDe('email')} errorMessage={errorDe('email')}
                                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Ubicación */}
                    <div className="space-y-3">
                        <SectionHeader icon={MapPin}>Ubicación</SectionHeader>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="sm:col-span-3">
                                <PortalInput
                                    name="direccion" label="Dirección"
                                    required={requeridos.has('direccion')}
                                    value={form.direccion} readOnly={!editable}
                                    hasError={!!errorDe('direccion')} errorMessage={errorDe('direccion')}
                                    onChange={e => setForm(p => ({ ...p, direccion: e.target.value.toUpperCase() }))}
                                />
                            </div>
                            <div>
                                <label className={rotuloCampo('text-content-3')}>
                                    Departamento
                                </label>
                                <LiquidSelect
                                    value={form.departamento}
                                    onChange={v => setGeo({ departamento: v || null, municipio: null, distrito: null })}
                                    options={Object.keys(EL_SALVADOR_GEO).map(d => ({ value: d, label: d }))}
                                    placeholder="Sin departamento"
                                    clearable={false}
                                    disabled={!editable}
                                    ariaLabel="Departamento"
                                />
                            </div>
                            <div>
                                <label className={rotuloCampo('text-content-3')}>
                                    Municipio
                                </label>
                                <LiquidSelect
                                    value={form.municipio}
                                    onChange={v => setGeo({ municipio: v || null, distrito: null })}
                                    options={municipioOpts}
                                    placeholder={form.departamento ? 'Sin municipio' : 'Selecciona el departamento'}
                                    clearable={false}
                                    disabled={!editable || !form.departamento}
                                    ariaLabel="Municipio"
                                />
                            </div>
                            <div>
                                <label className={rotuloCampo('text-content-3')}>
                                    Distrito
                                </label>
                                <LiquidSelect
                                    value={form.distrito}
                                    onChange={v => setGeo({ distrito: v || null })}
                                    options={distritoOpts}
                                    placeholder={form.municipio ? 'Sin distrito' : 'Selecciona el municipio'}
                                    clearable={false}
                                    disabled={!editable || !form.municipio}
                                    ariaLabel="Distrito"
                                />
                                {/* El distrito es obligatorio en el receptor de un
                                    DTE 2.0 — decirlo acá evita que se descubra al
                                    momento de facturar. */}
                                {esContribuyente && !form.distrito && (
                                    <p className="text-caption text-warning-text mt-1 ml-1 font-bold">
                                        El crédito fiscal pide el distrito, con departamento y municipio.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Fiscal y notas */}
                    <div className="space-y-3">
                        <SectionHeader icon={ShieldCheck}>{ver('retencion_pct') ? 'Retención y notas' : 'Notas'}</SectionHeader>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {ver('retencion_pct') && <PortalInput
                                name="retencion_pct" label="Retención %"
                                maskType="PERCENT" inputMode="numeric"
                                value={form.retencion_pct} readOnly={!editable}
                                hasError={!!errorDe('retencion_pct')}
                                errorMessage={errorDe('retencion_pct')}
                                helperText="0 a 100"
                                onChange={e => setForm(p => ({ ...p, retencion_pct: e.target.value }))}
                            />}
                            {!esNuevo && <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">
                                    Origen
                                </p>
                                <div className="flex items-center gap-2 h-10">
                                    {cliente.erp_id
                                        ? <Badge variant="success" icon={Building2}>Cliente número {cliente.erp_id}</Badge>
                                        : <Badge variant="neutral">Sin número</Badge>}
                                </div>
                            </div>}
                            <div className="sm:col-span-2">
                                <label className={rotuloCampo('text-content-3')}>
                                    Notas
                                </label>
                                <PortalTextarea
                                    value={form.notes}
                                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                                    rows={3}
                                    readOnly={!editable}
                                    placeholder="Notas internas (no salen del portal)"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Barra de guardar fija al fondo — este modal vive en HIDES_FOOTER de
                UnifiedModal, igual que el detalle de proveedor. */}
            {editable && panel === 'ficha' && (
                <div data-pegajoso className="sticky bottom-0 z-content -mx-1 px-1 pt-4 pb-1 mt-2 border-t border-divider space-y-2">
                    {error && (
                        <Notice variant="danger" icon={AlertTriangle} compact>{error}</Notice>
                    )}
                    {/* Un botón deshabilitado sin explicación es una pared. Se
                        dice qué falta y cómo se llama en el formulario, para
                        que la persona lo encuentre sin adivinar. */}
                    {señalarFaltantes && v.faltan.length > 0 && (
                        <Notice variant="warning" icon={AlertTriangle} compact>
                            Falta {v.faltan.length === 1 ? 'un dato' : `${v.faltan.length} datos`}{esNuevo
                                ? ' para crear el cliente'
                                : <> que la factura exige{esContribuyente ? ' para un contribuyente' : ''}</>}:{' '}
                            <span className="font-black">
                                {v.faltan.map(c => (esNuevo && FALTA_AL_NACER[c]) || ETIQUETA_CAMPO[c] || c).join(', ')}
                            </span>.
                        </Notice>
                    )}
                    {Object.keys(v.errores).length > 0 && (
                        <Notice variant="danger" icon={AlertTriangle} compact>
                            Revisa{' '}
                            <span className="font-black">
                                {Object.keys(v.errores).map(c => ETIQUETA_CAMPO[c] || c).join(', ')}
                            </span>.
                        </Notice>
                    )}
                    {pideConfirmacion && (
                        <Notice variant="warning" icon={ShieldCheck}
                            action={
                                <Button size="sm" variant="secondary" disabled={guardando}
                                    onClick={() => guardar(true)}>
                                    Confirmar
                                </Button>
                            }>
                            Estás cambiando datos fiscales de un contribuyente. Son los que se
                            declaran al MH. Confirma para guardar.
                        </Notice>
                    )}
                    <Button size="lg" icon={Check} loading={guardando} disabled={(!esNuevo && !hayCambios) || !v.ok}
                        title={!hayCambios ? 'No hay cambios que guardar'
                            : !v.ok ? 'Hay datos incompletos o mal escritos' : undefined}
                        onClick={() => guardar(false)}>
                        {esNuevo ? (guardando ? 'Creando…' : 'Crear cliente')
                            : guardando ? 'Guardando…' : <>Guardar cambios{hayCambios ? ` (${Object.keys(cambios).length})` : ''}</>}
                    </Button>
                </div>
            )}
        </div>
    );
};

export default FormClienteDetail;
