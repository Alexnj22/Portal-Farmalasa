import React from 'react';
import { Clock, MapPin, Phone, Smartphone, Store, Truck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { codigoDeReserva } from '@nucleo/data/reservas';
import { cuentasDeReserva, estadoDeReserva, renglonesDe, telefonoLegible } from './reservaVista';

// ═══════════════════════════════════════════════════════════════════════════
// La tarjeta de una reserva en la pantalla de Reservas (2026-10-22).
//
// Pedido del usuario: «que se vea más moderno, se entienda mejor, más
// estructurada; los datos del cliente, de los productos, y que se abra con más
// info». La fila de una línea (`FilaConAcciones`) metía todo en un solo texto
// corrido —código, cliente, sala, plazo, nota del traslado— y había que leerla
// entera para saber de quién era y cuánto faltaba.
//
// Cuatro bloques, siempre en el mismo orden: QUÉ es y en qué va (código y
// estado), DE QUIÉN (cliente y teléfono), QUÉ lleva (productos con su estado) y
// CUÁNTO (total, pagado, falta) con el plazo. Las acciones van al pie, fuera
// del área que abre el detalle: una tarjeta-botón no puede contener botones.
//
// La baldosa del Inicio sigue con `FilaConAcciones`: ahí el espacio es otro.
// ═══════════════════════════════════════════════════════════════════════════
export default function TarjetaDeReserva({ r, todas = false, acciones = null, onAbrir }) {
    const filas = renglonesDe(r);
    const estado = estadoDeReserva(r);
    const { total, pagado, falta, pagadoTodo } = cuentasDeReserva(r);
    const codigo = r.pedido ?? codigoDeReserva(r.id);
    const tel = telefonoLegible(r.telefono);

    return (
        <article data-surface="card" data-tono={estado.tono === 'danger' ? 'danger' : undefined} className="flex flex-col min-w-0">
            <button type="button" onClick={() => onAbrir?.(r)} aria-label={`Ver la reserva ${codigo}`}
                className="group w-full text-left p-4 flex flex-col gap-3 min-w-0 active:scale-[0.99] transition-transform duration-[var(--dur-base)]">
                {/* Qué es y en qué va */}
                <span className="flex items-start gap-2 min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-label font-black tracking-wide text-content tabular-nums">{codigo}</span>
                        <Badge variant={estado.variant} uppercase={false}>{estado.label}</Badge>
                        {todas && r.sala && (
                            <span className="inline-flex items-center gap-1 text-caption text-content-3"><Store size={12} aria-hidden /> {r.sala}</span>
                        )}
                    </span>
                    <OjoDeTarjeta className="self-start mt-0.5" />
                </span>

                {/* De quién */}
                <span className="block min-w-0">
                    <span className="block text-body font-bold text-content break-words">{r.cliente ?? 'Sin cliente'}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-caption text-content-3">
                        {tel && <span className="inline-flex items-center gap-1 tabular-nums"><Phone size={12} aria-hidden /> {tel}</span>}
                        <span className="inline-flex items-center gap-1">
                            <Smartphone size={12} aria-hidden /> {r.tiene_app ? 'Con la app' : 'Sin la app'}
                        </span>
                        {r.entrega === 'domicilio' && (
                            <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden /> A domicilio</span>
                        )}
                    </span>
                </span>

                {/* Qué lleva */}
                <span className="block border-t border-divider pt-3 space-y-2">
                    {filas.map((x) => (
                        <span key={x.id} className="flex items-start justify-between gap-3 min-w-0">
                            <span className="min-w-0">
                                <span className="block text-body-sm font-semibold text-content break-words">
                                    <span className="tabular-nums">{x.cantidad} ×</span> {x.producto}
                                </span>
                                {detalleDelRenglon(x, filas.length > 1) && (
                                    <span className="flex items-center gap-1 text-caption text-content-3 mt-0.5">
                                        {x.estado === 'pendiente' && x.traslado_estado && <Truck size={12} className="shrink-0" aria-hidden />}
                                        <span className="break-words">{detalleDelRenglon(x, filas.length > 1)}</span>
                                    </span>
                                )}
                            </span>
                            <span className="text-body-sm font-semibold text-content-2 tabular-nums shrink-0">
                                {formatMoney(Number(x.precio ?? 0) * Number(x.cantidad ?? 1))}
                            </span>
                        </span>
                    ))}
                </span>

                {/* Cuánto, y hasta cuándo */}
                <span className="block border-t border-divider pt-3">
                    <span className="grid grid-cols-3 gap-2">
                        <Cifra rotulo="Total" valor={total} />
                        <Cifra rotulo={pagadoTodo ? 'Pagado' : 'Anticipo'} valor={pagado} tono={pagado > 0 ? 'text-success-text' : 'text-content-3'} />
                        <Cifra rotulo="Falta" valor={falta} tono={falta > 0.004 ? 'text-warning-text' : 'text-content-3'} />
                    </span>
                    {plazoDe(r) && (
                        <span className="flex items-center gap-1 mt-2 text-caption text-content-3">
                            <Clock size={12} className="shrink-0" aria-hidden /> {plazoDe(r)}
                        </span>
                    )}
                </span>
            </button>

            {acciones && (
                <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 border-t border-divider">{acciones}</div>
            )}
        </article>
    );
}

function Cifra({ rotulo, valor, tono = 'text-content' }) {
    return (
        <span className="block min-w-0">
            <span className="block text-caption text-content-3">{rotulo}</span>
            <span className={`block text-body font-bold tabular-nums ${tono}`}>{formatMoney(valor)}</span>
        </span>
    );
}

// Una línea por producto: en qué va SU parte (sólo cuando dice algo).
function detalleDelRenglon(x, esPedido) {
    if (x.estado === 'pendiente' && x.traslado_estado) {
        const de = x.traslado_sala ? ` de ${x.traslado_sala}` : '';
        const llegaron = Number(x.traslado_llegaron ?? 0);
        return `${x.traslado_nota || `En camino${de}`}${llegaron > 0 ? ` · llegaron ${llegaron} de ${x.cantidad}` : ''}`;
    }
    if (x.estado === 'pendiente') return 'Por apartar en la sala';
    if (esPedido && x.estado === 'lista') return 'Lista';
    if (x.lista_precio) return x.lista_precio === 'mayoreo_plus' ? 'Precio Mayoreo Plus' : 'Precio Mayoreo';
    return '';
}

// Hasta cuándo vale lo que está pasando ahora.
function plazoDe(r) {
    const dia = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short' });
    if (r.estado === 'lista' && r.vence_at) return `Retira hasta el ${dia(r.vence_at)}${r.prorrogada_at ? ' (prorrogada)' : ''}`;
    if (r.estado === 'pendiente' && r.horas_al_preparar) {
        const dias = Math.round(Number(r.horas_al_preparar) / 24);
        return `Al quedar lista tiene ${dias >= 1 ? `${dias} ${dias === 1 ? 'día' : 'días'}` : `${r.horas_al_preparar} h`} para retirarla`;
    }
    if (r.creada) return `Creada el ${dia(r.creada)}`;
    return '';
}
