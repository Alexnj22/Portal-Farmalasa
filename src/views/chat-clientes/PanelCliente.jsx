import React, { useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, MessageCircle, Phone, Pill, ShoppingBag, Star } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { SkeletonText } from '../../components/common/StateViews';
import { fetchContextoCliente } from '@nucleo/data/chatClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { telefonoParaWhatsapp } from '@nucleo/utils/codigoDePuntos';
import ClienteAvatar from './ClienteAvatar';
import { RECETA_DEL_CHAT, RESERVA_DEL_CHAT } from '@nucleo/utils/chatClientes';

// «Cliente»: lo que conviene tener a mano mientras se le contesta — quién es,
// cómo llamarlo, sus puntos, lo último que compró (con sus productos), lo que
// tiene reservado y sus tratamientos. Sale de UNA llamada
// (`chat_cliente_contexto`), con la guarda del chat: quien contesta no
// necesita permiso sobre ventas, puntos ni reservas para verlo.
//
// En escritorio ancho va al costado del hilo; en el teléfono y en el panel de
// la burbuja, como una pestaña del hilo (ver `Conversacion`).

const RESERVA = RESERVA_DEL_CHAT;
const RECETA = RECETA_DEL_CHAT;

const corta = (d) => fechaTexto(d, { day: 'numeric', month: 'short', year: 'numeric' });

export default function PanelCliente({ customerId, arriba = null }) {
    const [ctx, setCtx] = useState(undefined);
    const [error, setError] = useState(null);
    const [abierta, setAbierta] = useState(null);

    useEffect(() => {
        // Sin reiniciar el estado acá: el hilo se monta con `key` por
        // conversación, así que otro cliente es otro panel.
        let vivo = true;
        fetchContextoCliente(customerId)
            .then((d) => { if (vivo) setCtx(d); })
            .catch((err) => { if (vivo) setError(mensajeAmigable(err, 'No se pudo cargar la información del cliente.')); });
        return () => { vivo = false; };
    }, [customerId]);

    if (error) return <div className="p-4"><Notice variant="danger">{error}</Notice></div>;
    if (ctx === undefined) return <div className="p-4"><SkeletonText lines={6} /></div>;
    if (!ctx) return <div className="p-4"><Notice variant="info">Este cliente ya no está registrado.</Notice></div>;

    const wa = telefonoParaWhatsapp(ctx.telefono);
    const tel = String(ctx.telefono ?? '').replace(/\D/g, '');
    const fila = 'min-h-[var(--tap-min)] active:scale-[0.97]';

    return (
        <div className="p-4 space-y-4 text-content">
            {/* Quién es —foto, nombre, tipo y nivel— ya lo dice el encabezado
                del hilo, que queda arriba: repetirlo acá era ver dos veces al
                mismo cliente (reportado el 2026-10-21). Arriba van los datos de
                la conversación que pasa el hilo (`arriba`). */}
            {arriba}

            {ctx.telefono && (
                <section className="flex flex-wrap gap-2">
                    {tel && (
                        <a href={`tel:${tel}`} data-surface="card"
                            className={`inline-flex items-center gap-1.5 rounded-btn px-3 text-label font-semibold text-content hover:text-brand-text ${fila}`}>
                            <Phone size={14} /> {ctx.telefono}
                        </a>
                    )}
                    {wa && (
                        <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" data-surface="card"
                            className={`inline-flex items-center gap-1.5 rounded-btn px-3 text-label font-semibold text-content hover:text-brand-text ${fila}`}>
                            <MessageCircle size={14} /> WhatsApp
                        </a>
                    )}
                </section>
            )}

            <section data-surface="card" className="rounded-card p-3 grid grid-cols-2 gap-3">
                <div>
                    <p className="text-micro text-content-3 flex items-center gap-1"><Star size={11} /> Puntos</p>
                    <p className="text-body-lg font-black tabular-nums">{formatQty(ctx.saldo_puntos)}</p>
                </div>
                <div>
                    <p className="text-micro text-content-3">Compró en 12 meses</p>
                    <p className="text-body-lg font-black tabular-nums">{formatMoney(Number(ctx.compra_12m) || 0)}</p>
                </div>
            </section>

            {/* ── Últimas compras ─────────────────────────────────────── */}
            <Seccion icono={ShoppingBag} titulo="Últimas compras" vacio="Todavía no tiene compras registradas." n={ctx.compras.length}>
                <ul className="space-y-1.5">
                    {ctx.compras.map((f) => {
                        const expandida = abierta === f.id;
                        return (
                            <li key={f.id} data-surface="card" className="rounded-card overflow-hidden">
                                <button type="button" aria-expanded={expandida}
                                    onClick={() => setAbierta(expandida ? null : f.id)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left ${fila}`}>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-body-sm font-semibold truncate">{corta(f.fecha)} · {f.sala ?? 'Sucursal'}</span>
                                        <span className="block text-label text-content-3">
                                            {f.n_productos} {f.n_productos === 1 ? 'producto' : 'productos'}
                                        </span>
                                    </span>
                                    <span className="text-body-sm font-black tabular-nums">{formatMoney(Number(f.total))}</span>
                                    <ChevronDown size={16} className={`shrink-0 text-content-3 transition-transform duration-[var(--dur-fast)] ${expandida ? 'rotate-180' : ''}`} />
                                </button>
                                {expandida && (
                                    <ul className="px-3 pb-2 space-y-1 border-t border-border-card pt-2">
                                        {(f.productos ?? []).map((p, i) => (
                                            <li key={i} className="flex items-start gap-2 text-label">
                                                <span className="tabular-nums text-content-3 shrink-0">{formatQty(Number(p.cantidad), { decimalesMax: 2 })}×</span>
                                                <span className="min-w-0 flex-1 break-words">{p.descripcion}</span>
                                                <span className="tabular-nums shrink-0">{formatMoney(Number(p.total))}</span>
                                            </li>
                                        ))}
                                        {f.n_productos > (f.productos?.length ?? 0) && (
                                            <li className="text-micro text-content-3">y {f.n_productos - f.productos.length} más</li>
                                        )}
                                    </ul>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </Seccion>

            {/* ── Reservas vivas ──────────────────────────────────────── */}
            <Seccion icono={CalendarClock} titulo="Reservas activas" vacio="No tiene reservas activas." n={ctx.reservas.length}>
                <ul className="space-y-1.5">
                    {ctx.reservas.map((r) => {
                        const est = RESERVA[r.estado] ?? { label: r.estado, variant: 'neutral' };
                        return (
                            <li key={r.id} data-surface="card" className="rounded-card px-3 py-2 space-y-1">
                                <div className="flex items-start gap-2">
                                    <span className="min-w-0 flex-1 text-body-sm font-semibold break-words">
                                        {r.cantidad > 1 ? `${r.cantidad}× ` : ''}{r.producto_nombre}
                                    </span>
                                    <Badge variant={est.variant} size="sm" uppercase={false}>{est.label}</Badge>
                                </div>
                                <p className="text-label text-content-3">
                                    {r.entrega === 'domicilio' ? 'A domicilio' : (r.sala ?? 'Sucursal')}
                                    {r.pedido ? ` · ${r.pedido}` : ''}
                                    {r.receta_estado ? ` · ${RECETA[r.receta_estado] ?? r.receta_estado}` : ''}
                                </p>
                            </li>
                        );
                    })}
                </ul>
            </Seccion>

            {/* ── Mis tratamientos ────────────────────────────────────── */}
            <Seccion icono={Pill} titulo="Tratamientos" vacio="No tiene tratamientos en su app." n={ctx.tratamientos.length}>
                <ul className="space-y-1.5">
                    {ctx.tratamientos.map((t) => (
                        <li key={t.id} data-surface="card" className="rounded-card px-3 py-2">
                            <div className="flex items-start gap-2">
                                <span className="min-w-0 flex-1 text-body-sm font-semibold break-words">{t.nombre}</span>
                                {t.estado === 'suspendido' && <Badge variant="neutral" size="sm" uppercase={false}>Pausado</Badge>}
                            </div>
                            <p className="text-label text-content-3">
                                Cada {t.intervalo_dias} días{t.se_acaba ? ` · se le acaba el ${corta(t.se_acaba)}` : ''}
                            </p>
                        </li>
                    ))}
                </ul>
            </Seccion>
        </div>
    );
}

function Seccion({ icono: Icono, titulo, vacio, n, children }) {
    return (
        <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-caption font-black uppercase tracking-widest text-content-2">
                <Icono size={13} /> {titulo}
            </h3>
            {n ? children : <p className="text-label text-content-3">{vacio}</p>}
        </section>
    );
}
