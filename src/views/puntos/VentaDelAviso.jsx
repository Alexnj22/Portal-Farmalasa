/**
 * La venta de un aviso de puntos, arriba del perfil del cliente.
 *
 * Pedido del usuario (2026-10-01): «que al abrirlo me dé tanto la venta como el
 * perfil de puntos de ese cliente», y que se vea QUIÉN vendió. Va DENTRO de
 * `ClientePuntosModal` y no en un diálogo propio: dos diálogos apilados es lo
 * que el portal evita, y el perfil ya es el lugar donde se revisa a un cliente.
 *
 * Los datos de la cabecera vienen con el aviso (`puntos_panel_avisos`); sólo
 * los productos se piden acá, con el MISMO lector que usa Ventas.
 */
import React, { useEffect, useState } from 'react';
import { Receipt, CalendarClock, Store, DollarSign, Package } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { SkeletonText } from '../../components/common/StateViews';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { fetchInvoiceItemsForInvoice } from '@nucleo/data/ventas';

export default function VentaDelAviso({ aviso, rotulo, variante, puntosTexto }) {
    const [items, setItems] = useState(null);
    const [fallo, setFallo] = useState(false);

    useEffect(() => {
        if (!aviso?.invoice_id) return undefined;
        let vivo = true;
        (async () => {
            const { data, error } = await fetchInvoiceItemsForInvoice(aviso.invoice_id);
            if (!vivo) return;
            if (error) { console.error('[VentaDelAviso] productos:', error.message); setFallo(true); }
            setItems(data ?? []);
        })();
        return () => { vivo = false; };
    }, [aviso?.invoice_id]);

    if (!aviso) return null;
    // En estos dos la anulación ES el aviso: repetirla en una nota no suma.
    // Los demás ya no llegan con la venta anulada (el panel los saca), así
    // que la nota queda como red por si un tipo nuevo no lo hace.
    const anuladaSinAviso = aviso.venta_vigente === false
        && !['anulada_con_puntos_gastados', 'canje_devuelto'].includes(aviso.tipo);
    // El renglón -999 es el descuento: se cuenta aparte, no como producto.
    const productos = (items ?? []).filter((it) => it.erp_product_id !== -999 && it.descripcion);
    const vendedor = aviso.vendedor ? { id: aviso.vendedor_id, name: aviso.vendedor } : null;
    const cuando = [
        fechaTexto(aviso.venta_fecha, { day: 'numeric', month: 'short', year: 'numeric' }, ''),
        aviso.venta_hora ? hora12(aviso.venta_hora) : '',
    ].filter(Boolean).join(' · ');

    return (
        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-4 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                        <Receipt size={14} /> La venta del aviso
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Badge variant={variante} tone="soft" uppercase={false}>{rotulo}</Badge>
                        <span className="text-body-sm font-bold tabular-nums text-content">{puntosTexto}</span>
                    </div>
                    {aviso.nota && <p className="text-caption text-content-3 mt-1">{aviso.nota}</p>}
                </div>
                {anuladaSinAviso && (
                    <Badge variant="info" tone="soft" uppercase={false}>Anulada después</Badge>
                )}
            </div>

            {anuladaSinAviso && (
                <Notice variant="info" bloque>
                    Esta venta se anuló después del canje ({aviso.venta_estado}). Si la sala la rehízo,
                    la venta nueva aparece en los movimientos del cliente.
                </Notice>
            )}

            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 min-w-0">
                <Campo icono={Receipt} rotulo="Documento" valor={aviso.documento || '—'} />
                <Campo icono={CalendarClock} rotulo="Fecha" valor={cuando || '—'} />
                <Campo icono={Store} rotulo="Sala" valor={aviso.sala || '—'} />
                <Campo icono={DollarSign} rotulo="Total cobrado"
                    valor={aviso.venta_total != null ? formatMoney(aviso.venta_total) : '—'} />
            </dl>

            {/* Regla del portal: quien hizo algo sale con foto y nombre + apellido. */}
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-caption font-bold text-content-3">Vendió</span>
                {vendedor ? (
                    <>
                        <AvatarConEstado emp={vendedor} px={24} radio="rounded-full" marco="" />
                        <span className="text-body-sm font-bold text-content truncate">{shortEmployeeName(vendedor)}</span>
                    </>
                ) : (
                    <span className="text-body-sm text-content-3">Sin vendedor en la factura</span>
                )}
            </div>

            <div className="flex flex-col gap-2 min-w-0">
                <p className="text-caption font-bold text-content-3 flex items-center gap-1.5">
                    <Package size={13} /> Productos
                </p>
                {items == null ? (
                    <SkeletonText lines={2} />
                ) : fallo ? (
                    <p className="text-caption text-content-3">No se pudieron cargar los productos.</p>
                ) : productos.length === 0 ? (
                    <p className="text-caption text-content-3">Esta venta no tiene el detalle de productos.</p>
                ) : (
                    <ul className="flex flex-col divide-y divide-divider min-w-0">
                        {productos.map((it, i) => (
                            <li key={`${it.erp_product_id}-${i}`} className="flex items-center gap-3 px-3 py-2 min-w-0">
                                <div className="min-w-0 flex-1">
                                    <p className="text-body-sm text-content truncate">{it.descripcion}</p>
                                    <p className="text-caption text-content-3 tabular-nums">
                                        {formatQty(it.cantidad)} × {formatMoney(it.precio_unitario)}
                                        {it.presentacion ? ` · ${it.presentacion}` : ''}
                                    </p>
                                </div>
                                <span className="text-body-sm font-bold tabular-nums text-content shrink-0">
                                    {formatMoney(it.total_linea)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

function Campo({ icono: Icono, rotulo, valor }) {
    return (
        <div className="min-w-0">
            <dt className="text-caption font-bold text-content-3 flex items-center gap-1.5 truncate">
                <Icono size={13} className="shrink-0" /> {rotulo}
            </dt>
            <dd className="text-body-sm font-black tabular-nums text-content leading-tight mt-1 truncate">{valor}</dd>
        </div>
    );
}
