import React, { useState, useEffect, memo } from 'react';
import {
    ArrowLeftRight, Stethoscope, FileImage, AlertTriangle, CalendarDays,
    Banknote, FileCheck2, Ban, CreditCard, Receipt, CheckCircle2,
    PackagePlus, Trash2, ImageOff, Minus, Plus, BarChart2, Clock,
} from 'lucide-react';
import Badge from '../../components/common/Badge';
import Checkbox from '../../components/common/Checkbox';
import { formatMoney } from '../../utils/formatNumber';
import { getSignedFileUrl } from '../../utils/storageFiles';
import {
    lineasDe, rechazadasDe, ajustadasDe, contextoMovimiento, fmtFechaHora,
} from './movimientoTexto';
import { CaraPersona, BloquePersonas } from './PersonasSolicitud';
import LaVenta from './VentaDeSolicitud';
import { shortEmployeeName } from '../../utils/nameUtils';
import { ajusteSinCambio, fmtUltimaVenta } from '../../utils/minmaxSolicitud';

// El detalle de una solicitud, en UN solo lugar.
//
// ── Por qué existe ─────────────────────────────────────────────────────────
// Estaba escrito dos veces y las dos copias ya se habían separado: `RequestsView`
// (quien aprueba) tenía bloque para 10 tipos y `EmployeeRequestsView` (quien
// pide) sólo para 2. Y a NINGUNA de las dos le habían agregado los tres tipos
// que mueven producto — carga, descarte y traslado—, así que la solicitud
// llegaba con el producto, la cantidad, la existencia, el lote, el motivo con
// nombre y hasta las fotos guardadas, y lo único que se pintaba era el texto
// libre. Quien aprobaba un descarte veía «inyectorio» y decidía a ciegas sobre
// existencias que no se devuelven con un clic.
//
// Con un solo archivo, agregar un tipo nuevo lo agrega en los dos lados. Que es
// justo lo que no pasó las últimas tres veces.

// `DE_LEGAJO_AJENO` vivía acá: la lista de solicitudes que no hablan del
// expediente de quien las manda —una factura, una existencia— y a las que por
// eso no se les mostraba el código de empleado. Se fue con esa línea el
// 2026-08-17, cuando el código dejó de poder leerse desde el navegador; sin el
// único `if` que la consultaba era una lista que no decidía nada.

const fmtDate = (iso) => !iso ? '—' : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
// `fmtDateFull` vivía acá y lo usaba el recuadro de la factura que reemplazó
// `LaVenta`, que trae su propio formato con hora.

// El ID con el que se ubica la venta. Sale de la solicitud (`erp_invoice_id`) o
// de lo que quedó registrado al aplicarla. NUNCA cae al id interno del portal:
// son dos numeraciones distintas y mostrarlas bajo la misma etiqueta manda a
// buscar la venta equivocada.
const idDeVenta = (meta) => meta?.erp_invoice_id ?? meta?.erp_aplicado?.erp_invoice_id ?? null;

const IdVenta = ({ meta }) => {
    const id = idDeVenta(meta);
    if (!id) return null;
    return <p className="text-caption text-content-3 font-mono mt-0.5">ID de venta {id}</p>;
};

/* ─── La cara de una persona ──────────────────────────────────────────────── */
/**
 * Foto y nombre. **El código no se muestra** — decisión del usuario, 2026-08-10:
 * «con el cambio de vendedor no quiero el código, quiero las fotos y nombre».
 * Un `#140` no le dice a nadie quién atendió; la cara sí.
 *
 * La URL guardada es `photo_url`, o sea la CRUDA de un bucket privado, así que
 * hay que firmarla — pintarla directo daba una imagen rota, que es exactamente
 * lo que hacía este bloque hasta hoy. Sin foto se cae a la inicial, nunca a un
 * hueco.
 */
const Avatar = memo(({ photo, nombre, size = 40 }) => {
    // Se guarda la foto JUNTO a su firma, no la firma sola: si el componente se
    // reusa para otra persona, una firma suelta pintaría la cara anterior hasta
    // que llegue la nueva. Comparar contra `photo` hace imposible ese cruce.
    const [firmada, setFirmada] = useState({ photo: null, url: null });

    useEffect(() => {
        if (!photo) return;
        let vivo = true;
        getSignedFileUrl(photo)
            .then(url => { if (vivo) setFirmada({ photo, url }); })
            .catch(() => {});
        return () => { vivo = false; };
    }, [photo]);

    const src = firmada.photo === photo ? firmada.url : null;
    const inicial = (nombre || '?').trim().charAt(0).toUpperCase();
    return (
        <div className="rounded-full overflow-hidden border border-border-card bg-surface-card-hover
                        flex items-center justify-center shrink-0"
            style={{ width: size, height: size }}>
            {src
                ? <img src={src} alt="" className="w-full h-full object-cover" />
                : <span className="text-content-2 font-black text-body">{inicial}</span>}
        </div>
    );
});
Avatar.displayName = 'Avatar';

/** Una persona en una tarjeta de «antes → después». */
const Persona = ({ photo, nombre, vacio = 'Sin asignar' }) => (
    <div className="flex items-center gap-2 mt-1">
        <Avatar photo={photo} nombre={nombre} size={36} />
        <p className="text-label font-black text-content-2 leading-tight min-w-0 break-words">
            {nombre || vacio}
        </p>
    </div>
);

/* ─── Rótulo de sección ───────────────────────────────────────────────────── */
const Rotulo = ({ children }) => (
    <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">{children}</p>
);

const Caja = ({ children, tono = 'card', className = '' }) => {
    const fondo = tono === 'card'
        ? 'bg-surface-card border-border-card'
        : 'bg-surface-card-hover border-divider';
    return <div className={`px-3 py-2.5 rounded-2xl border ${fondo} ${className}`}>{children}</div>;
};

/* ─── Las fotos de evidencia ──────────────────────────────────────────────── */
//
// El widget de movimiento OBLIGA a tomarlas cuando el producto está dañado, las
// sube a `inventario-evidencia` y guarda su URL. Nunca se mostraron en ninguna
// pantalla: quien aprobaba un descarte por daño no podía ver el daño.
//
// El bucket es PRIVADO, así que la URL guardada —que es la de formato público,
// como manda la regla— no sirve para mostrar nada por sí sola: hay que firmarla.
// `inventario-evidencia` faltaba en `PRIVATE_BUCKETS`, o sea que aunque alguien
// hubiera escrito este bloque antes, las fotos habrían salido rotas.
const EvidenciaFotos = memo(({ urls }) => {
    const [firmadas, setFirmadas] = useState(null);

    useEffect(() => {
        let vivo = true;
        Promise.all((urls ?? []).map(u => getSignedFileUrl(u).catch(() => null)))
            .then(r => { if (vivo) setFirmadas(r); });
        return () => { vivo = false; };
    }, [urls]);

    if (!urls?.length) return null;

    return (
        <div>
            <Rotulo>Evidencia</Rotulo>
            <div className="flex flex-wrap gap-2">
                {(firmadas ?? urls.map(() => null)).map((src, i) => src ? (
                    <a key={i} href={src} target="_blank" rel="noreferrer"
                        className="w-16 h-16 rounded-xl overflow-hidden border border-border-card bg-surface-card-hover
                                   transition-transform duration-[var(--dur-fast)] hover:scale-105">
                        <img src={src} alt={`Evidencia ${i + 1}`} className="w-full h-full object-cover" />
                    </a>
                ) : (
                    <div key={i} className="w-16 h-16 rounded-xl border border-divider bg-surface-card-hover
                                            flex items-center justify-center">
                        {firmadas ? <ImageOff size={16} className="text-content-3" strokeWidth={2} />
                                  : <div className="w-full h-full skeleton rounded-xl" />}
                    </div>
                ))}
            </div>
        </div>
    );
});
EvidenciaFotos.displayName = 'EvidenciaFotos';

/* ─── Las líneas de un movimiento ─────────────────────────────────────────── */
/**
 * Producto, cantidad, existencia, lote y vencimiento — una fila por línea.
 *
 * En modo decisión cada fila lleva su casilla: es lo que permite aprobar unas y
 * rechazar otras sin obligar a quien pidió a mandar todo de nuevo.
 *
 * `existencia` es la que HABÍA cuando se pidió, no la de ahora, y por eso se
 * rotula «había». Decir «quedan» sería prometer un número que el sistema no
 * volvió a mirar.
 */
export const LineasMovimiento = memo(({
    meta, seleccion, onToggle, onCantidad, cantidades, rechazadas, ajustadas, esCarga = false,
}) => {
    const items = lineasDe(meta);
    if (items.length === 0) {
        return (
            <Caja tono="hover">
                <p className="text-caption text-content-2 font-medium">Esta solicitud no trae detalle de productos.</p>
            </Caja>
        );
    }

    const decidiendo = typeof onToggle === 'function';

    return (
        <div data-surface="card" className="overflow-hidden">
            {items.map((it, i) => {
                const motivoRechazo = rechazadas?.get(i);
                const marcada  = decidiendo ? seleccion?.has(i) : !motivoRechazo;
                const pedida   = Number(it.cantidad) || 0;
                // La cantidad que se va a aplicar: la que el aprobador dejó, o
                // la pedida. Nunca puede superar a la pedida — aprobar MÁS de lo
                // que alguien pidió no es aprobar, es otra solicitud.
                const actual   = decidiendo ? (cantidades?.get(i) ?? pedida) : (ajustadas?.get(i) ?? pedida);
                const recortada = actual !== pedida;
                const unidad   = it.presentacion_tipo ?? 'u';

                return (
                    <div key={i}
                        className={`px-3 py-2.5 ${i > 0 ? 'border-t border-divider' : ''}
                                    ${motivoRechazo || (decidiendo && !marcada) ? 'opacity-55' : ''}`}>
                        <div className="flex items-start gap-2.5">
                            {decidiendo && (
                                <div className="pt-0.5 shrink-0">
                                    <Checkbox size="sm" checked={Boolean(marcada)}
                                        onChange={() => onToggle(i)} name={`linea-${i}`} />
                                </div>
                            )}

                            <div className="flex-1 min-w-0">
                                <p className={`text-label font-bold text-content-2 leading-tight
                                               ${motivoRechazo ? 'line-through' : ''}`}>
                                    {it.descripcion ?? `Producto #${it.erp_product_id}`}
                                </p>
                                <p className="text-micro text-content-3 mt-0.5">
                                    {!decidiendo && `${actual} ${unidad}`}
                                    {!decidiendo && Number.isFinite(Number(it.existencia)) && ' · '}
                                    {Number.isFinite(Number(it.existencia)) && `había ${it.existencia}`}
                                </p>
                                {(it.lote || it.numero_lote || it.vence) && (
                                    <p className="text-micro text-content-3 mt-0.5">
                                        <span className="font-mono">{it.lote || it.numero_lote || 'sin lote'}</span>
                                        {it.vence && ` · vence ${fmtDate(it.vence)}`}
                                    </p>
                                )}
                                {motivoRechazo && (
                                    <p className="text-micro font-semibold text-danger-text mt-1">
                                        No entró — {motivoRechazo}
                                    </p>
                                )}
                                {!decidiendo && recortada && !motivoRechazo && (
                                    <p className="text-micro font-semibold text-warning-text mt-1">
                                        Entraron {actual} de las {pedida} que se pidieron
                                    </p>
                                )}
                            </div>

                            {!decidiendo && (
                                <Badge variant={esCarga ? 'success' : 'neutral'} size="sm" uppercase={false}
                                    className="shrink-0 mt-0.5">
                                    {motivoRechazo ? '—' : `${esCarga ? '+' : '−'}${actual}`}
                                </Badge>
                            )}
                        </div>

                        {/* Cuánto de esa línea entra. Pedido del usuario: no
                            alcanzaba con quitar renglones enteros —«quitar unos,
                            o modificar unos»—, porque lo normal es que de las 4
                            que se pidieron entren 2. El tope es lo pedido. */}
                        {decidiendo && marcada && typeof onCantidad === 'function' && (
                            <div className="flex items-center gap-2 mt-2 ml-7">
                                <button type="button" aria-label="Quitar uno"
                                    disabled={actual <= 1}
                                    onClick={() => onCantidad(i, actual - 1)}
                                    className="w-11 h-11 rounded-xl border border-border-card bg-surface-card
                                               flex items-center justify-center text-content-2
                                               disabled:opacity-40 active:scale-[0.97]
                                               transition-transform duration-[var(--dur-fast)]">
                                    <Minus size={15} strokeWidth={2.5} />
                                </button>
                                <div className="min-w-[92px] text-center">
                                    <p className="text-body font-black text-content leading-none">{actual}</p>
                                    <p className="text-micro text-content-3 mt-0.5">{unidad}</p>
                                </div>
                                <button type="button" aria-label="Agregar uno"
                                    disabled={actual >= pedida}
                                    onClick={() => onCantidad(i, actual + 1)}
                                    className="w-11 h-11 rounded-xl border border-border-card bg-surface-card
                                               flex items-center justify-center text-content-2
                                               disabled:opacity-40 active:scale-[0.97]
                                               transition-transform duration-[var(--dur-fast)]">
                                    <Plus size={15} strokeWidth={2.5} />
                                </button>
                                {recortada && (
                                    <span className="text-micro text-warning-text font-semibold">
                                        pidió {pedida}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});
LineasMovimiento.displayName = 'LineasMovimiento';

/* ─── Encabezado de un movimiento: por qué y dónde ────────────────────────── */
const CabeceraMovimiento = ({ req, meta, unidadesAplicadas = null }) => {
    const { motivo, sala, origen, unidades } = contextoMovimiento(meta);
    const esTraslado = req.type === 'INVENTORY_TRANSFER_REQUEST';
    const esCarga    = req.type === 'INVENTORY_LOAD_REQUEST';
    const Icono      = esTraslado ? ArrowLeftRight : esCarga ? PackagePlus : Trash2;

    // El total de arriba tiene que seguir a lo que se está decidiendo. Si dice
    // «9 unidades» mientras abajo se dejaron 5, el número más grande de la
    // pantalla es el único que miente.
    const vivo    = unidadesAplicadas ?? unidades;
    const cambió  = unidadesAplicadas !== null && unidadesAplicadas !== unidades;

    return (
        <Caja tono="hover">
            <div className="flex items-start gap-2">
                <Icono size={14} className="text-content-2 shrink-0 mt-0.5" strokeWidth={2} />
                <div className="flex-1 min-w-0">
                    <Rotulo>{esTraslado ? 'Recorrido' : esCarga ? 'Se carga en' : 'Se descarga de'}</Rotulo>
                    <p className="text-body-sm font-bold text-content-2">
                        {esTraslado ? `${origen ?? 'Otra sala'} → ${sala ?? 'destino'}` : (sala ?? 'Sin sala')}
                    </p>
                    {motivo && <p className="text-caption text-content-2 mt-0.5">{motivo}</p>}
                </div>
                <div className="text-right shrink-0">
                    <p className={`text-body font-black ${cambió ? 'text-warning-text' : 'text-content-2'}`}>{vivo}</p>
                    <p className="text-micro text-content-3">
                        {cambió ? `de ${unidades}` : (vivo === 1 ? 'unidad' : 'unidades')}
                    </p>
                </div>
            </div>
        </Caja>
    );
};

/* ─── Constancia de lo que se aplicó ──────────────────────────────────────── */
//
// Sin esto, aprobar y que el cambio ocurra fuera del portal se ve igual que
// aprobar y que no ocurra nada.
//
// Tenía UNA sola forma —la de facturación, con `campo`/`de`/`a`— y a un
// movimiento de inventario lo pintaba como «— → —», porque su constancia no
// tiene esos campos sino líneas, unidades y costo. Ahora cada familia se lee
// con la suya.
const BloqueAplicado = ({ req, aplicado }) => {
    if (!aplicado) return null;
    const esMovimiento = req.type?.startsWith('INVENTORY_');

    return (
        <Caja tono="hover" className="space-y-1">
            <Rotulo>Aplicado</Rotulo>
            {esMovimiento ? (
                <p className="text-label font-bold text-content">
                    {aplicado.lineas ?? 0} {aplicado.lineas === 1 ? 'producto' : 'productos'}
                    {' · '}{aplicado.unidades ?? 0} {aplicado.unidades === 1 ? 'unidad' : 'unidades'}
                    {Number.isFinite(Number(aplicado.total)) && ` · ${formatMoney(aplicado.total)}`}
                    {aplicado.by_name && ` · por ${aplicado.by_name}`}
                </p>
            ) : (
                <p className="text-label font-bold text-content">
                    {aplicado.campo === 'anulacion'
                        ? 'Factura anulada'
                        : `${aplicado.de || '—'} → ${aplicado.a || '—'}`}
                    {aplicado.by_name && ` · por ${aplicado.by_name}`}
                </p>
            )}
            {aplicado.hacienda?.sello && (
                <p className="text-micro text-content-3 font-mono break-all">
                    Sello de Hacienda: {aplicado.hacienda.sello}
                </p>
            )}
            {aplicado.concepto_recortado && (
                <p className="text-micro text-content-3">El detalle se guardó abreviado.</p>
            )}
        </Caja>
    );
};

/* ─── El bloque que depende del tipo ──────────────────────────────────────── */
export const BloquePorTipo = ({ req, meta, seleccion, onToggle, onCantidad, cantidades, employeesById }) => {
    const t = req.type;

    /* Los tres que mueven producto de verdad. */
    if (t === 'INVENTORY_LOAD_REQUEST' || t === 'INVENTORY_DISCARD_REQUEST' || t === 'INVENTORY_TRANSFER_REQUEST') {
        // Las unidades que de verdad van a entrar, mientras se decide.
        const deLinea = (l, i) => cantidades?.get(i) ?? (Number(l?.cantidad) || 0);
        const aplicadas = seleccion
            ? [...seleccion].reduce((s, i) => s + deLinea(lineasDe(meta)[i], i), 0)
            : (cantidades
                ? lineasDe(meta).reduce((s, l, i) => s + deLinea(l, i), 0)
                : null);
        return (
            <div className="space-y-2">
                <CabeceraMovimiento req={req} meta={meta} unidadesAplicadas={aplicadas} />
                <LineasMovimiento meta={meta} seleccion={seleccion} onToggle={onToggle}
                    onCantidad={onCantidad} cantidades={cantidades}
                    rechazadas={rechazadasDe(meta)} ajustadas={ajustadasDe(meta)}
                    esCarga={t === 'INVENTORY_LOAD_REQUEST'} />
                <EvidenciaFotos urls={meta.evidencia_urls} />
            </div>
        );
    }

    /* Min/Max — vive en otra tabla y se muestra acá igual que el resto. */
    if (t === 'MINMAX_CHANGE_REQUEST') {
        const baja = Number(meta.min_pedido) < Number(meta.min_actual);
        // «— · —» y «0 · 0» son el mismo número para la reposición: el pedido
        // entra por MAX > 0, y ahí el «—» vale 0. Desde el 2026-08-14 el
        // formulario y el disparador `trg_mmcr_solicitud_con_efecto` cortan las
        // propuestas así, pero las que ya estaban pendientes siguen acá y no
        // pueden decir «deja de reponerse»: hace rato que no se repone.
        //
        // El par de HOY sale de lo que la solicitud guardó al crearse, o sea el
        // retrato del momento — es lo único que este detalle tiene a mano, y
        // alcanza para no afirmar una consecuencia que no existe.
        const aprobada  = req?.status === 'APPROVED';
        const rechazada = req?.status === 'REJECTED';
        const nOnull = v => (v === null || v === undefined || v === '' ? null : Number(v));
        const sinCambio = ajusteSinCambio(
            { min: nOnull(meta.min_actual), max: nOnull(meta.max_actual) },
            nOnull(meta.min_pedido), nOnull(meta.max_pedido));
        return (
            <div className="space-y-2">
                <Caja tono="hover">
                    <div className="flex items-start gap-2">
                        <BarChart2 size={14} className="text-content-2 shrink-0 mt-0.5" strokeWidth={2} />
                        <div className="flex-1 min-w-0">
                            <Rotulo>Producto</Rotulo>
                            <p className="text-body-sm font-bold text-content-2 leading-tight">
                                {meta.producto ?? `#${meta.erp_product_id}`}
                            </p>
                            {meta.branch_name && <p className="text-caption text-content-2 mt-0.5">{meta.branch_name}</p>}
                        </div>
                    </div>
                </Caja>
                {/* «Se pide» sólo es cierto mientras nadie contestó. Sobre una
                    solicitud ya aprobada —que es como se la mira la mayor parte
                    del tiempo, porque quedan en la bandeja— decía que se está
                    pidiendo algo que ya se aplicó. **Nuevo** vale en los tres
                    estados. Pedido del usuario, 2026-08-14.

                    Y su pareja cambia con el estado: aprobada, lo de la
                    izquierda ya no es «Hoy» —hoy la sala está en el otro par—
                    sino lo que había ANTES. Rechazada no cambió nada, así que
                    ahí «Hoy» sigue siendo verdad. */}
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>{aprobada ? 'Antes' : 'Hoy'}</Rotulo>
                        <p className="text-body-sm font-black text-content-2">
                            MIN {meta.min_actual ?? '—'} · MAX {meta.max_actual ?? '—'}
                        </p>
                    </Caja>
                    <Caja tono="hover">
                        <Rotulo>Nuevo</Rotulo>
                        <p className={`text-body-sm font-black ${baja ? 'text-warning-text' : 'text-content-2'}`}>
                            MIN {meta.min_pedido ?? '—'} · MAX {meta.max_pedido ?? '—'}
                        </p>
                    </Caja>
                </div>
                {/* Los dos avisos hablan de una CONSECUENCIA, así que no tienen
                    nada que decir sobre una solicitud rechazada: ahí no pasó
                    nada. Y sobre una aprobada hablan en pasado — «aprobado
                    esto, el producto no vuelve a entrar» sobre algo aprobado
                    ayer anuncia como futuro lo que ya ocurrió. */}
                {sinCambio && !rechazada && (
                    <div className="px-3 py-2.5 rounded-2xl border border-warning/30 bg-warning/10">
                        <p className="text-caption text-warning-text font-semibold leading-snug">
                            {aprobada ? 'No cambió nada: ' : 'Aprobarlo no cambia nada: '}
                            {meta.branch_name || 'la sucursal'} {aprobada ? 'ya estaba' : 'ya está'}
                            {nOnull(meta.min_actual) === null ? ' sin MIN ni MAX' : ` en MIN ${meta.min_actual} · MAX ${meta.max_actual}`},
                            que es lo mismo que {aprobada ? 'se pidió' : 'se pide'}.
                        </p>
                    </div>
                )}
                {/* El 0 · 0 no es «un número más chico»: apaga la reposición.
                    Quien aprueba lo tiene que leer, no deducirlo de dos ceros. */}
                {!sinCambio && !rechazada && Number(meta.min_pedido) === 0 && Number(meta.max_pedido) === 0 && (
                    <div className="px-3 py-2.5 rounded-2xl border border-warning/30 bg-warning/10">
                        <p className="text-caption text-warning-text font-semibold leading-snug">
                            {aprobada
                                ? <>Dejó de reponerse: el producto ya no entra en los pedidos
                                    de {meta.branch_name || 'la sucursal'} hasta que alguien le fije un MIN y un MAX.</>
                                : <>Deja de reponerse: aprobado esto, el producto no vuelve a entrar en los
                                    pedidos de {meta.branch_name || 'la sucursal'} hasta que alguien le fije un MIN y un MAX.</>}
                        </p>
                    </div>
                )}
                {/* Las tres cifras que dicen si el producto está vivo. Sueltas
                    no alcanzan: 26 en seis meses puede ser 26 el mes pasado o
                    26 con la última venta en enero, y sólo la fecha lo separa.
                    Se muestra el bloque aunque falte alguna —las solicitudes
                    anteriores al 2026-08-14 no traen las dos nuevas— y lo que
                    falta va como «—», nunca como 0. */}
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>Vendidas este mes</Rotulo>
                        <p className="text-body font-black text-content-2 tabular-nums">
                            {Number.isFinite(Number(meta.ventas_mes)) && meta.ventas_mes != null
                                ? Number(meta.ventas_mes).toLocaleString() : '—'}
                        </p>
                    </Caja>
                    <Caja>
                        <Rotulo>Vendidas en 6 meses</Rotulo>
                        <p className="text-body font-black text-content-2 tabular-nums">
                            {Number.isFinite(Number(meta.ventas_6m)) && meta.ventas_6m != null
                                ? Number(meta.ventas_6m).toLocaleString() : '—'}
                        </p>
                    </Caja>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>En sala</Rotulo>
                        <p className="text-body font-black text-content-2 tabular-nums">
                            {Number.isFinite(Number(meta.existencia)) && meta.existencia != null
                                ? `${Number(meta.existencia).toLocaleString()} und` : '—'}
                        </p>
                    </Caja>
                    <Caja>
                        <Rotulo>Última venta</Rotulo>
                        <p className={`text-body-sm font-black leading-tight ${meta.ultima_venta ? 'text-content-2' : 'text-content-3'}`}>
                            {meta.ultima_venta ? fmtUltimaVenta(meta.ultima_venta) : '—'}
                        </p>
                    </Caja>
                </div>
            </div>
        );
    }

    if (t === 'SHIFT_CHANGE') {
        return (
            <div className="space-y-2">
                {(meta.targetEmployeeName || meta.date) && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-chart-3/10 border border-chart-3/30">
                        <ArrowLeftRight size={12} className="text-chart-3-text flex-shrink-0" strokeWidth={2} />
                        <div className="flex flex-wrap items-center gap-2">
                            {meta.targetEmployeeName && <span className="text-body-sm font-bold text-chart-3-text">↔ {meta.targetEmployeeName}</span>}
                            {meta.date && <span className="text-label text-chart-3-text">{new Date(meta.date+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'long', day: '2-digit', month: 'long' })}</span>}
                        </div>
                    </div>
                )}
                {(meta.myShift || meta.targetShift) && (
                    <div className="grid grid-cols-2 gap-2">
                        <Caja>
                            <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5 truncate" title={req.employee?.name}>{shortEmployeeName(req.employee)}</p>
                            <p className="text-label font-black text-content-2">{meta.myShift || '—'}</p>
                        </Caja>
                        <div className="bg-chart-3/10 border border-chart-3/30 rounded-2xl p-2.5">
                            <p className="text-micro font-black text-chart-3-text uppercase tracking-widest mb-0.5 truncate" title={meta.targetEmployeeName}>{shortEmployeeName(meta.targetEmployeeName)}</p>
                            <p className="text-label font-black text-content-2">{meta.targetShift || '—'}</p>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (t === 'DISABILITY') {
        return (
            <div className="space-y-2">
                {meta.startDate && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30">
                        <Stethoscope size={13} className="text-danger flex-shrink-0" strokeWidth={2} />
                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-danger mb-0.5">Período</p>
                            <p className="text-body font-bold text-danger-text">
                                {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                                {meta.days && <span className="text-danger font-medium ml-1.5">· {meta.days}d</span>}
                            </p>
                            {Number(meta.days) > 3 && <p className="text-caption text-content-2 font-black mt-0.5">Requiere boleta ISSS</p>}
                        </div>
                    </div>
                )}
                {meta.docUrl ? (
                    <a href={meta.docUrl} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card border border-border-card text-label font-bold text-content-2 hover:text-brand-text transition-all">
                        <FileImage size={12} strokeWidth={2} />{meta.docName || 'Ver certificado adjunto'}
                    </a>
                ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-card-hover border border-divider">
                        <AlertTriangle size={11} className="text-warning flex-shrink-0" strokeWidth={2} />
                        <p className="text-caption text-content-2 font-medium">Sin certificado adjunto.</p>
                    </div>
                )}
            </div>
        );
    }

    if (t === 'VACATION' && meta.startDate) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-success/10 border border-success/30">
                <CalendarDays size={13} className="text-success flex-shrink-0" strokeWidth={2} />
                <div>
                    <p className="text-caption font-black uppercase tracking-widest text-success mb-0.5">Período</p>
                    <p className="text-body-sm font-bold text-success-text">
                        {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate ? ` — ${fmtDate(meta.endDate)}` : ''}
                    </p>
                </div>
            </div>
        );
    }

    if (t === 'PERMIT' && (meta.permissionDates || []).length > 0) {
        return (
            <div className="px-3 py-2.5 rounded-2xl bg-success/10 border border-success/30">
                <p className="text-caption font-black uppercase tracking-widest text-success-text mb-2">Días de Permiso</p>
                <div className="flex flex-wrap gap-1.5">
                    {meta.permissionDates.map(d => (
                        <Badge key={d} variant="success" uppercase={false}>{new Date(d+'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' })}</Badge>
                    ))}
                </div>
            </div>
        );
    }

    /* Horas Extra. El formulario pide la fecha Y cuántas horas desde la fusión
     * de «Mis Solicitudes» (v2.557.0) — pero acá no había rama, así que el dato
     * se guardaba y no se pintaba: quien aprueba abría la solicitud y sólo veía
     * el motivo. Capturar el número que define la solicitud y no mostrarlo deja
     * el defecto exactamente donde estaba. */
    if (t === 'OVERTIME' && (meta.date || meta.hours)) {
        return (
            <Caja tono="hover" className="flex items-center gap-2">
                <Clock size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                <div>
                    <Rotulo>Horas extra</Rotulo>
                    <p className="text-body font-black text-content-2">
                        {meta.hours ? `${meta.hours} h` : 'Sin especificar'}
                    </p>
                    {meta.date && (
                        <p className="text-caption text-content-2">
                            {new Date(meta.date + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'long', day: '2-digit', month: 'long' })}
                        </p>
                    )}
                </div>
            </Caja>
        );
    }

    if (t === 'ADVANCE' && meta.amount) {
        return (
            <Caja tono="hover" className="flex items-center gap-2">
                <Banknote size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                <div>
                    <Rotulo>Monto solicitado</Rotulo>
                    <p className="text-body font-black text-content-2">${Number(meta.amount).toLocaleString('es-SV')}</p>
                </div>
            </Caja>
        );
    }

    if (t === 'CERTIFICATE' && meta.certificateType) {
        return (
            <Caja tono="hover" className="flex items-center gap-2">
                <FileCheck2 size={13} className="text-content-2 flex-shrink-0" strokeWidth={2} />
                <div>
                    <Rotulo>Tipo</Rotulo>
                    <p className="text-body-sm font-bold text-content-2">
                        {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                    </p>
                </div>
            </Caja>
        );
    }

    /* ── Las cuatro de facturación ─────────────────────────────────────────
     * Todas hablan de la MISMA venta, así que todas abren con ella entera
     * —cliente, quién atendió, forma de pago, sello, productos— y después
     * dicen qué se pide cambiar. Antes cada una mostraba cuatro datos sueltos
     * (correlativo, total, fecha) y con eso no se decide nada. */
    if (t === 'ANNULMENT_REQUEST' && meta.correlativo) {
        return (
            <div className="space-y-2">
                <LaVenta meta={meta} employeesById={employeesById} />
                {meta.reason && (
                    <Caja>
                        <Rotulo>Motivo de anulación</Rotulo>
                        <p className="text-label font-bold text-content-2">{meta.reason}</p>
                    </Caja>
                )}
                <IdVenta meta={meta} />
            </div>
        );
    }

    if (t === 'PAYMENT_CHANGE_REQUEST' && meta.correlativo) {
        return (
            <div className="space-y-2">
                <LaVenta meta={meta} employeesById={employeesById} />
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>Pago actual</Rotulo>
                        <p className="text-body-sm font-black text-content-2 capitalize">{meta.current_pago || '—'}</p>
                    </Caja>
                    <Caja tono="hover">
                        <Rotulo>Cambiar a</Rotulo>
                        <p className="text-body-sm font-black text-content-2 capitalize">{meta.new_pago || '—'}</p>
                    </Caja>
                </div>
                <IdVenta meta={meta} />
            </div>
        );
    }

    if (t === 'VENDOR_CHANGE_REQUEST' && meta.correlativo) {
        return (
            <div className="space-y-2">
                <LaVenta meta={meta} employeesById={employeesById} />
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>Atendió</Rotulo>
                        <Persona photo={meta.current_vendor_photo} nombre={meta.current_vendor_name}
                            vacio="Sin vendedor" />
                    </Caja>
                    <Caja tono="hover">
                        <Rotulo>Pasa a</Rotulo>
                        <Persona photo={meta.new_vendor_photo} nombre={meta.new_vendor_name} />
                    </Caja>
                </div>
                <IdVenta meta={meta} />
            </div>
        );
    }

    if (t === 'CLIENT_CHANGE_REQUEST' && meta.correlativo) {
        return (
            <div className="space-y-2">
                <LaVenta meta={meta} employeesById={employeesById} />
                <div className="grid grid-cols-2 gap-2">
                    <Caja>
                        <Rotulo>Cliente actual</Rotulo>
                        <p className="text-label font-black text-content-2 leading-tight">{meta.current_cliente || 'Sin nombre'}</p>
                    </Caja>
                    <Caja tono="hover">
                        <Rotulo>Cambiar a</Rotulo>
                        <p className="text-label font-black text-content-2 leading-tight">{meta.new_client_name}</p>
                        {(meta.new_client_nit || meta.new_client_dui) && (
                            <p className="text-micro text-content-3 font-mono mt-0.5">{meta.new_client_nit ? `NIT ${meta.new_client_nit}` : `DUI ${meta.new_client_dui}`}</p>
                        )}
                    </Caja>
                </div>
                <IdVenta meta={meta} />
            </div>
        );
    }

    return null;
};

/* ─── El detalle completo ─────────────────────────────────────────────────── */
/**
 * Todo lo que se sabe de una solicitud: su bloque de tipo, el motivo de quien la
 * pidió, la constancia de lo aplicado, la nota de quien decidió y el historial.
 *
 * `seleccion`/`onToggle` sólo se pasan cuando se está DECIDIENDO por línea; sin
 * ellos el detalle es de lectura y las líneas se ven sin casillas.
 */
export default function DetalleSolicitud({ req, employeesById, seleccion, onToggle, onCantidad, cantidades }) {
    const meta = (typeof req.metadata === 'object' && req.metadata) ? req.metadata : {};
    const isRejected = req.status === 'REJECTED';

    const personaDelNivel = (ap) => (ap.approverId ? employeesById?.get(String(ap.approverId)) : null) ?? null;

    return (
        <div className="space-y-2.5 text-left">
            {/* Quién y cuándo, antes que el qué. */}
            <BloquePersonas req={req} empleadosPorId={employeesById} />

            <BloquePorTipo req={req} meta={meta} seleccion={seleccion} onToggle={onToggle}
                onCantidad={onCantidad} cantidades={cantidades} employeesById={employeesById} />

            <BloqueAplicado req={req} aplicado={meta.erp_aplicado ?? meta.erp_traslado} />

            {req.note && (
                <div>
                    <Rotulo>Motivo de quien la envió</Rotulo>
                    <p className="text-body-sm text-content-2 bg-surface-card rounded-2xl p-3 border border-border-card leading-relaxed">{req.note}</p>
                </div>
            )}

            {isRejected && req.approver_note && (
                <div className="px-3 py-2.5 rounded-2xl bg-danger/10 border border-danger/30">
                    <p className="text-micro font-black uppercase tracking-widest text-danger mb-1">Motivo de rechazo</p>
                    <p className="text-body-sm text-danger-text font-medium leading-relaxed">{req.approver_note}</p>
                </div>
            )}

            {!isRejected && req.approver_note && (
                <div className="px-3 py-2.5 rounded-2xl bg-success/10 border border-success/30">
                    <p className="text-micro font-black uppercase tracking-widest text-success mb-1">Nota de quien decidió</p>
                    <p className="text-body-sm text-success-text font-medium leading-relaxed">{req.approver_note}</p>
                </div>
            )}

            {/* El historial sólo tiene algo que agregar cuando hubo MÁS de un
                nivel: con uno solo repite, palabra por palabra, la ficha de
                quien decidió que está arriba. */}
            {req.approvals?.length > 1 && (
                <div className="space-y-1.5">
                    <Rotulo>Historial</Rotulo>
                    {req.approvals.map((ap, i) => {
                        const quien = personaDelNivel(ap);
                        return (
                            <div key={i} className="flex items-start gap-2 bg-success/10 border border-success/30 rounded-2xl p-2.5">
                                {quien
                                    ? <CaraPersona persona={quien} className="w-7 h-7 rounded-full mt-0.5" />
                                    : <CheckCircle2 size={12} className="text-success mt-0.5 flex-shrink-0" strokeWidth={2.5} />}
                                <div className="min-w-0">
                                    <p className="text-label font-black text-success-text">
                                        {quien ? `${shortEmployeeName(quien)}${quien.role ? ` · ${quien.role}` : ''}` : `Nivel ${ap.level}`}
                                    </p>
                                    <p className="text-micro text-content-3 mt-0.5">{fmtFechaHora(ap.approvedAt)}</p>
                                    {ap.approverNote && <p className="text-caption text-content-2 mt-0.5 italic">&ldquo;{ap.approverNote}&rdquo;</p>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Acá se mostraba el CÓDIGO de empleado de quien pidió. Se retiró
                el 2026-08-17: desde que ese código es la contraseña del carné,
                la base no se lo deja leer a nadie salvo al servicio —
                `authenticated` no tiene SELECT sobre esa columna— así que la
                línea no podía tener dato. Peor: pedirla hacía fallar la
                consulta ENTERA de las personas de la solicitud (ver
                `COLUMNAS_PERSONA` en `requestsSlice`), o sea que el precio de
                un número que nunca se pintaba lo pagaban el nombre y la cara.
                Si algún día hace falta ubicar a alguien en su legajo, el camino
                es su ficha de personal, no esta pantalla. */}
        </div>
    );
}

export { EvidenciaFotos };
