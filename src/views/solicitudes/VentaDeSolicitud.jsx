import React, { useState, useEffect, memo } from 'react';
import { Receipt, AlertTriangle, ShieldCheck, ShieldAlert, Ban } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { formatMoney } from '../../utils/formatNumber';
import { fetchInvoiceById, fetchInvoiceItemsForInvoice } from '../../data/ventas';
import { tieneSelloMh } from '../../data/facturacion';
import { shortEmployeeName } from '../../utils/nameUtils';
import { CaraPersona } from './PersonasSolicitud';

/* La venta entera, adentro de la solicitud que pide tocarla.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 * Las cuatro solicitudes de facturación —anular, cambiar el pago, el vendedor o
 * el cliente— mostraban cuatro datos: correlativo, total, fecha y el motivo. Con
 * eso no se puede decidir. Pedido del usuario, 2026-08-11: «no me dice nada, la
 * venta, tipo de pago, productos… son criterios para aprobar o no».
 *
 * Lo que hace falta para decidir una anulación es la venta: a quién se le
 * vendió, quién la atendió, cómo la pagó, qué se llevó, y —lo que más pesa— si
 * Hacienda ya la selló y si alguien ya la anuló.
 *
 * ── De dónde sale cada cosa ────────────────────────────────────────────────
 * La solicitud guarda una FOTO al pedirla (correlativo, fecha, total, forma de
 * pago). Eso se muestra siempre, sin depender de ningún permiso. El resto
 * —cliente, vendedor, estado, sello, desglose— se lee de la venta viva, que es
 * la que manda al momento de decidir: entre que se pidió y que se decide, la
 * venta pudo anularse o llegarle el sello.
 *
 * La cabecera de la venta vive detrás de `ventas.can_view` (con su alcance por
 * sala) y las líneas están abiertas a cualquier autenticado. Si la cabecera no
 * llega, NO es un error: es alguien sin ese permiso, y lo que se pinta es la
 * foto de la solicitud. Nunca se inventa lo que no se pudo leer.
 */

const ESTADOS_ANULADA = ['NULA', 'DTE INVALIDADO EN MH'];

const fmtFecha = (iso) => !iso ? '—'
    : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });

// `hora` es un `time` de Postgres («13:09:10»), no un instante: se formatea a
// mano. Pasarlo por `new Date()` le pegaría la zona horaria del navegador y
// correría la hora de la venta.
const fmtHoraVenta = (hhmmss) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmmss ?? ''));
    if (!m) return '';
    const h = Number(m[1]);
    const ampm = h < 12 ? 'a. m.' : 'p. m.';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m[2]} ${ampm}`;
};

const fmtVence = (iso) => !iso ? null
    : new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', { month: 'short', year: 'numeric' });

/** Un dato con su rótulo, en la rejilla de la cabecera. */
const Dato = ({ rotulo, children, className = '' }) => (
    <div className={`min-w-0 ${className}`}>
        <p className="text-micro font-black uppercase tracking-widest text-content-3">{rotulo}</p>
        <div className="text-label font-bold text-content-2 leading-tight">{children}</div>
    </div>
);

const Linea = ({ it, n, resta }) => {
    const vence = fmtVence(it.fecha_vencimiento);
    const detalle = [it.presentacion, it.lote && `lote ${it.lote}`, vence && `vence ${vence}`]
        .filter(Boolean).join(' · ');
    return (
        <div className="flex items-start gap-2 py-1.5 border-t border-divider first:border-t-0">
            <span className="text-micro font-black text-content-3 w-4 shrink-0 text-right pt-0.5">{n}</span>
            <div className="flex-1 min-w-0">
                <p className={`text-label font-bold leading-tight ${resta ? 'text-content-3 italic' : 'text-content-2'}`}>
                    {it.descripcion || (resta ? 'Ajuste sobre la venta' : 'Sin descripción')}
                </p>
                {detalle && <p className="text-micro text-content-3 leading-tight truncate">{detalle}</p>}
            </div>
            <div className="text-right shrink-0">
                <p className={`text-label font-bold tabular-nums ${resta ? 'text-content-3' : 'text-content-2'}`}>
                    {resta ? '−' : ''}{formatMoney(it.total_linea || 0)}
                </p>
                {!resta && (
                    <p className="text-micro text-content-3 tabular-nums">
                        {Number(it.cantidad || 0).toLocaleString('es-SV')} × {formatMoney(it.precio_unitario || 0)}
                    </p>
                )}
            </div>
        </div>
    );
};

const LaVenta = memo(({ meta, employeesById }) => {
    const invoiceId = meta?.invoice_id ?? null;
    const [venta, setVenta]   = useState(null);
    const [lineas, setLineas] = useState(null);

    useEffect(() => {
        if (!invoiceId) return;
        let vivo = true;
        // Las dos lecturas van juntas y ninguna tumba a la otra: la cabecera
        // puede quedar fuera por permiso y las líneas llegar igual.
        fetchInvoiceById(invoiceId)
            .then(({ data, error }) => {
                if (error) console.error('LaVenta: cabecera:', error.message);
                if (vivo) setVenta(data ?? null);
            })
            .catch(e => console.error('LaVenta: cabecera:', e?.message ?? e));
        fetchInvoiceItemsForInvoice(invoiceId)
            .then(({ data, error }) => {
                if (error) console.error('LaVenta: líneas:', error.message);
                if (vivo) setLineas(data ?? []);
            })
            .catch(e => { console.error('LaVenta: líneas:', e?.message ?? e); if (vivo) setLineas([]); });
        return () => { vivo = false; };
    }, [invoiceId]);

    /* Sin id de venta no hay nada que esperar: una solicitud vieja, de antes de
     * que la metadata lo guardara, se queda con la foto y sin líneas. Se deriva
     * en vez de sembrarlo con un `setState` dentro del efecto — eso es un render
     * en cascada y el compilador de React lo rechaza. */
    const cargando = invoiceId ? lineas === null : false;
    const filas    = lineas ?? [];

    // La foto de la solicitud es el respaldo; la venta viva manda.
    const correlativo = venta?.correlativo   ?? meta?.correlativo;
    const tipoDoc     = venta?.tipo_documento ?? meta?.tipo_documento;
    const total       = venta?.total         ?? meta?.total;
    const fecha       = venta?.fecha         ?? meta?.fecha;
    const pago        = venta?.tipo_pago     ?? meta?.tipo_pago ?? meta?.current_pago;
    const sala        = meta?.branch_name;

    const vendedor = venta?.cod_vendedor
        ? [...(employeesById?.values() ?? [])].find(e => String(e.code) === String(venta.cod_vendedor))
        : null;

    const anulada  = ESTADOS_ANULADA.includes(String(venta?.estado ?? '').toUpperCase());
    const conSello = tieneSelloMh(venta?.recibido_mh);

    /* ── Que los renglones cuadren con el total ────────────────────────────
     *
     * Casi siempre cuadran: 2,980 de 3,000 facturas de agosto. Los que no,
     * suelen traer un renglón SIN DESCRIPCIÓN que la venta **resta** en vez de
     * sumar —un descuento, la parte que cubre un seguro— guardado con signo
     * positivo. Medido sobre julio y agosto: de 132 facturas descuadradas, 59
     * tienen ese renglón y en las 59 la diferencia se explica exactamente
     * restándolo. Las otras 73 tienen otra causa, y no se adivina.
     *
     * Así que la interpretación no se asume: se COMPRUEBA contra el total de la
     * venta, que es el que fue a Hacienda. Si restando esos renglones la cuenta
     * cierra, se pintan como resta; si no cierra de ninguna de las dos formas,
     * se dice que no cuadra en vez de mostrar una suma que engaña. */
    const suma = (lista) => lista.reduce((t, it) => t + Number(it.total_linea || 0), 0);
    const sinDescripcion = filas.filter(it => !it.descripcion);

    const sumaCruda = suma(filas);
    const sumaRestando = sumaCruda - 2 * suma(sinDescripcion);
    const cuadra   = (n) => total != null && Math.abs(Number(total) - n) <= 0.02;

    const restarSinDescripcion = !cuadra(sumaCruda) && sinDescripcion.length > 0 && cuadra(sumaRestando);
    const sumaMostrada = restarSinDescripcion ? sumaRestando : sumaCruda;
    const hayDescuadre = filas.length > 0 && total != null && !cuadra(sumaMostrada);

    // Un ajuste no es mercadería: no entra en el conteo de unidades.
    const unidades = filas
        .filter(it => !(restarSinDescripcion && !it.descripcion))
        .reduce((t, it) => t + Number(it.cantidad || 0), 0);

    return (
        <div className="space-y-2">
            {/* Dos avisos que cambian la decisión y que antes no se veían. */}
            {anulada && (
                <Notice variant="danger" icon={Ban}>
                    Esta venta ya figura como anulada ({venta.estado}). No hace falta anularla de nuevo.
                </Notice>
            )}

            <div data-surface="card" className="overflow-hidden">
                {/* Cabecera: qué venta y por cuánto */}
                <div className="px-3 py-2.5 flex items-start gap-2 border-b border-divider">
                    <Receipt size={14} className="text-content-2 shrink-0 mt-0.5" strokeWidth={2} />
                    <div className="flex-1 min-w-0">
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">La venta</p>
                        <p className="text-body font-black text-content leading-tight truncate">{correlativo ?? '—'}</p>
                        <p className="text-caption text-content-3">
                            {fmtFecha(fecha)}{venta?.hora ? `, ${fmtHoraVenta(venta.hora)}` : ''}
                            {sala ? ` · ${sala}` : ''}
                        </p>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-title font-black text-content tabular-nums leading-none">{formatMoney(total || 0)}</p>
                        {tipoDoc && (
                            <Badge variant={tipoDoc === 'CCF' ? 'danger' : 'neutral'} size="sm" className="mt-1">{tipoDoc}</Badge>
                        )}
                    </div>
                </div>

                {/* A quién, quién y cómo */}
                <div className="px-3 py-2.5 grid grid-cols-2 gap-x-3 gap-y-2.5 border-b border-divider">
                    <Dato rotulo="Cliente" className="col-span-2">
                        <span className="break-words">{venta?.cliente || meta?.current_cliente || 'Consumidor final'}</span>
                    </Dato>
                    <Dato rotulo="Forma de pago">
                        <span className="capitalize">{pago || '—'}</span>
                    </Dato>
                    <Dato rotulo="Atendió">
                        {vendedor ? (
                            <span className="flex items-center gap-1.5 min-w-0">
                                <CaraPersona persona={vendedor} px={20} />
                                <span className="truncate">{shortEmployeeName(vendedor)}</span>
                            </span>
                        ) : (
                            <span className="text-content-3">
                                {venta?.cod_vendedor ? `Código ${venta.cod_vendedor}` : '—'}
                            </span>
                        )}
                    </Dato>
                    {venta && (
                        <>
                            <Dato rotulo="Hacienda">
                                <span className={`flex items-center gap-1 ${conSello ? 'text-success' : 'text-warning-text'}`}>
                                    {conSello
                                        ? <><ShieldCheck size={12} strokeWidth={2.5} /> Con sello</>
                                        : <><ShieldAlert size={12} strokeWidth={2.5} /> Sin sello</>}
                                </span>
                            </Dato>
                            <Dato rotulo="Estado">
                                <span className={anulada ? 'text-danger' : 'text-content-2'}>{venta.estado || '—'}</span>
                            </Dato>
                        </>
                    )}
                </div>

                {/* Qué se llevó */}
                <div className="px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                        <p className="text-micro font-black uppercase tracking-widest text-content-3">
                            Qué se vendió
                        </p>
                        {filas.length > 0 && (
                            <p className="text-micro text-content-3">
                                {filas.length} {filas.length === 1 ? 'renglón' : 'renglones'}
                                {unidades > 0 && ` · ${Number(unidades).toLocaleString('es-SV')} ${unidades === 1 ? 'unidad' : 'unidades'}`}
                            </p>
                        )}
                    </div>

                    {cargando ? (
                        <div className="space-y-1.5 py-1">
                            {[0, 1, 2].map(i => <div key={i} className="h-4 skeleton rounded-full" />)}
                        </div>
                    ) : filas.length === 0 ? (
                        <p className="text-caption text-content-3 italic py-1">
                            No hay detalle de productos guardado para esta venta.
                        </p>
                    ) : (
                        /* Sin techo propio a propósito: los botones de decidir
                           viven en el pie fijo del diálogo, así que una venta
                           larga no los empuja fuera de la pantalla. Un segundo
                           área de desplazamiento adentro del cuerpo sí molesta
                           —en el teléfono uno arrastra y se mueve la lista de
                           adentro en vez del modal—. */
                        <div>
                            {filas.map((it, i) => (
                                <Linea key={i} it={it} n={i + 1}
                                    resta={restarSinDescripcion && !it.descripcion} />
                            ))}
                        </div>
                    )}

                    {/* El desglose fiscal, cuando se pudo leer la venta */}
                    {venta && (
                        <div className="mt-2 pt-2 border-t border-divider flex items-baseline justify-between gap-2">
                            <p className="text-micro text-content-3">
                                Gravado {formatMoney(venta.subtotal || 0)} · IVA {formatMoney(venta.iva || 0)}
                                {Number(venta.retencion || 0) > 0 && ` · Retención ${formatMoney(venta.retencion)}`}
                            </p>
                            <p className="text-label font-black text-content tabular-nums">{formatMoney(total || 0)}</p>
                        </div>
                    )}
                </div>
            </div>

            {hayDescuadre && (
                <Notice variant="warning" icon={AlertTriangle}>
                    Los renglones suman {formatMoney(sumaMostrada)} y la venta dice {formatMoney(total)} —
                    una diferencia de {formatMoney(Math.abs(Number(total) - sumaMostrada))}. El detalle
                    guardado no explica el total: revisa la venta antes de decidir.
                </Notice>
            )}
        </div>
    );
});
LaVenta.displayName = 'LaVenta';

export default LaVenta;
