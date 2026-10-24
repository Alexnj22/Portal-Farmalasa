import React from 'react';
import { Clock, FileText, MapPin, MoreHorizontal, Phone, Smartphone, Store, Truck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import OjoDeTarjeta from '../../components/common/OjoDeTarjeta';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { codigoDeReserva } from '@nucleo/data/reservas';
import { cuentasDeReserva, estadoDeReserva, renglonesDe, telefonoLegible } from './reservaVista';
import { InsigniaDeNivel } from './AvisosDeReserva';
import {
    PRODUCTOS_EN_TARJETA, detalleDelRenglonDeReserva, plazoDeReserva, productosOcultos,
} from '@nucleo/utils/reservasDeSala';

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
//
// Segunda vuelta, mismo día: «si una tiene 6 productos se verá muy larga, no
// se verá alineada, los botones no se entienden». Tres reglas:
//   1. Todas las tarjetas de una fila miden lo mismo: el dinero va al pie
//      (`mt-auto`) y cada texto ocupa UNA línea — un nombre largo se corta y el
//      completo vive en el `title` y en el detalle.
//   2. A lo sumo PRODUCTOS_EN_TARJETA renglones; el resto es «+N productos más».
//   3. Botones: los dos que importan, con nombre, a la derecha; el resto
//      (avisar, prorrogar, cancelar) en «Más», que abre el detalle. Nunca un
//      ícono suelto que haya que adivinar.
// ═══════════════════════════════════════════════════════════════════════════
export default function TarjetaDeReserva({ r, todas = false, acciones = [], onAbrir }) {
    const filas = renglonesDe(r);
    const estado = estadoDeReserva(r);
    const { total, pagado, falta, pagadoTodo } = cuentasDeReserva(r);
    const codigo = r.pedido ?? codigoDeReserva(r.id);
    const tel = telefonoLegible(r.telefono);
    const visibles = filas.slice(0, PRODUCTOS_EN_TARJETA);
    const ocultos = filas.length - visibles.length;
    const [principal, segunda] = acciones;
    const hayMas = acciones.length > 2;

    return (
        <article data-surface="card" data-tono={estado.tono === 'danger' ? 'danger' : undefined} className="h-full flex flex-col min-w-0">
            <button type="button" onClick={() => onAbrir?.(r)} aria-label={`Ver la reserva ${codigo}`}
                className="group w-full flex-1 text-left p-4 flex flex-col gap-3 min-w-0 active:scale-[0.99] transition-transform duration-[var(--dur-base)]">
                {/* Qué es y en qué va */}
                <span className="flex items-start gap-2 min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-label font-black tracking-wide text-content tabular-nums">{codigo}</span>
                        <Badge variant={estado.variant} uppercase={false}>{estado.label}</Badge>
                        <InsigniaDeNivel nivel={r.nivel} />
                        {todas && r.sala && (
                            <span className="inline-flex items-center gap-1 text-caption text-content-3"><Store size={12} aria-hidden /> {r.sala}</span>
                        )}
                    </span>
                    <OjoDeTarjeta className="self-start mt-0.5" />
                </span>

                {/* De quién */}
                <span className="block min-w-0">
                    <span className="block text-body font-bold text-content truncate" title={r.cliente ?? undefined}>{r.cliente ?? 'Sin cliente'}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-caption text-content-3">
                        {tel && <span className="inline-flex items-center gap-1 tabular-nums"><Phone size={12} aria-hidden /> {tel}</span>}
                        <span className="inline-flex items-center gap-1">
                            <Smartphone size={12} aria-hidden /> {r.tiene_app ? 'Con la app' : 'Sin la app'}
                        </span>
                        {r.entrega === 'domicilio' && (
                            <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden /> A domicilio</span>
                        )}
                        {r.documento === 'credito_fiscal' && (
                            <span className="inline-flex items-center gap-1"><FileText size={12} aria-hidden /> Crédito fiscal</span>
                        )}
                    </span>
                </span>

                {/* Qué lleva: a lo sumo PRODUCTOS_EN_TARJETA renglones, una línea cada uno */}
                <span className="block border-t border-divider pt-3 space-y-2">
                    {visibles.map((x) => (
                        <span key={x.id} className="flex items-start justify-between gap-3 min-w-0">
                            <span className="min-w-0 flex-1">
                                <span className="block text-body-sm font-semibold text-content truncate" title={x.producto}>
                                    <span className="tabular-nums">{x.cantidad} ×</span> {x.producto}
                                </span>
                                <span className="flex items-center gap-1 text-caption text-content-3 mt-0.5 min-w-0">
                                    {x.estado === 'pendiente' && x.traslado_estado && <Truck size={12} className="shrink-0" aria-hidden />}
                                    <span className="truncate">{detalleDelRenglonDeReserva(x) || `${formatMoney(Number(x.precio ?? 0))} c/u`}</span>
                                </span>
                            </span>
                            <span className="text-body-sm font-semibold text-content-2 tabular-nums shrink-0">
                                {formatMoney(Number(x.precio ?? 0) * Number(x.cantidad ?? 1))}
                            </span>
                        </span>
                    ))}
                    {ocultos > 0 && (
                        <span className="block text-caption font-semibold text-accent-text">
                            {productosOcultos(ocultos)}
                        </span>
                    )}
                </span>

                {/* Cuánto, y hasta cuándo */}
                <span className="block border-t border-divider pt-3 mt-auto">
                    <span className="grid grid-cols-3 gap-2">
                        <Cifra rotulo="Total" valor={total} />
                        <Cifra rotulo={pagadoTodo ? 'Pagado' : 'Anticipo'} valor={pagado} tono={pagado > 0 ? 'text-success-text' : 'text-content-3'} />
                        <Cifra rotulo="Falta" valor={falta} tono={falta > 0.004 ? 'text-warning-text' : 'text-content-3'} />
                    </span>
                    {r.pago_prueba ? (
                        <span className="block mt-2 text-caption font-semibold text-danger-text">El cobro en línea fue de prueba: se cobra en caja</span>
                    ) : plazoDeReserva(r) && (
                        <span className="flex items-center gap-1 mt-2 text-caption text-content-3 min-w-0">
                            <Clock size={12} className="shrink-0" aria-hidden /> <span className="truncate">{plazoDeReserva(r)}</span>
                        </span>
                    )}
                </span>
            </button>

            {acciones.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-3 border-t border-divider">
                    {hayMas && (
                        <Button variant="ghost" size="sm" icon={MoreHorizontal} onClick={() => onAbrir?.(r)}
                            title={acciones.slice(2).map((a) => a.label).join(' · ')}>Más</Button>
                    )}
                    <span className="flex-1" />
                    {segunda && <BotonDeAccion a={segunda} variant="secondary" />}
                    {principal && <BotonDeAccion a={principal} variant={principal.menor ? 'ghost' : 'primary'} />}
                </div>
            )}
        </article>
    );
}

export function BotonDeAccion({ a, variant = 'secondary', size = 'sm', className = '' }) {
    return (
        <Button variant={variant} size={size} icon={a.icon} loading={a.loading} disabled={a.disabled} title={a.title}
            onClick={a.onClick} className={className}>{a.label}</Button>
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
