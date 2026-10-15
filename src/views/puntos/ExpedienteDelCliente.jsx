/**
 * Todo lo de un cliente para atenderlo en el mostrador (2026-10-15).
 *
 * Lo pinta la pestaña «Escanear» de Puntos después de leer la tarjeta. NO
 * repite el perfil de puntos (`ClientePuntosModal`) ni la ficha fiscal
 * (`FormClienteDetail`): los ABRE con sus dos botones. Lo que agrega es lo que
 * ninguno de los dos mostraba y la caja necesita con la persona enfrente —
 * si es empleado o mayorista, si tiene la app, qué reservas y encargos esperan,
 * qué créditos debe, qué inyecciones pagó y no se aplicó, sus tratamientos y
 * sus últimas compras—. Todo sale de UNA lectura (`cliente_expediente`).
 *
 * ── «A futuro venderle» ─────────────────────────────────────────────────────
 * Las acciones sobre el cliente viven en `acciones` (la fila de botones del
 * encabezado). Vender será un botón más ahí, que reciba `exp.cliente` —con su
 * precio de mayorista y sus puntos ya resueltos acá— y abra la venta. No se
 * deja un hueco vacío: cuando exista, se agrega a la fila.
 */
import React from 'react';
import {
    Contact, IdCard, Phone, Mail, Star, Smartphone, BellRing, BellOff, ShoppingBag, PackageCheck,
    Syringe, Pill, CreditCard, Receipt, CalendarClock, Pencil,
} from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, fechaTexto } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { edadDelCredito, severidadDeDias } from '@nucleo/data/creditos';
import {
    ESTADO_DE_ENCARGO, ESTADO_DE_RESERVA, estadoDeLaApp, marcasDelCliente,
} from '@nucleo/utils/expedienteDelCliente';

const pts = (n) => formatQty(Number(n) || 0);
// 100 puntos = US$1.00 (cláusula 4 del reglamento).
const dolares = (n) => formatMoney((Number(n) || 0) / 100);
const corta = (iso) => fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' }, '—');

function Panel({ icono: Icono, titulo, nota, children }) {
    return (
        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-3 min-w-0">
            <div className="min-w-0">
                <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                    <Icono size={14} /> {titulo}
                </h3>
                {nota && <p className="text-caption text-content-3 mt-1">{nota}</p>}
            </div>
            {children}
        </section>
    );
}

function Nada({ children }) {
    return <p className="text-body-sm text-content-3">{children}</p>;
}

/** Un renglón de lista: lo principal a la izquierda, la cifra a la derecha. */
function Renglon({ titulo, detalle, cifra, sub, insignia }) {
    return (
        <div className="flex items-start gap-3 py-2 min-w-0">
            <div className="min-w-0 flex-1">
                <p className="text-body-sm font-bold text-content truncate">{titulo}</p>
                {detalle && <p className="text-caption text-content-3 truncate">{detalle}</p>}
                {insignia && <div className="mt-1">{insignia}</div>}
            </div>
            {(cifra || sub) && (
                <div className="text-right shrink-0">
                    {cifra && <p className="text-body-sm font-black tabular-nums text-content">{cifra}</p>}
                    {sub && <p className="text-caption text-content-3 tabular-nums">{sub}</p>}
                </div>
            )}
        </div>
    );
}

/**
 * @param {object}   exp            lo que devuelve `cliente_expediente`
 * @param {Function} onVerPuntos    abre el perfil de puntos (movimientos, ajustar)
 * @param {Function} onVerFicha     abre la ficha del cliente
 * @param {boolean}  puedeEditarFicha
 */
export default function ExpedienteDelCliente({ exp, onVerPuntos, onVerFicha, puedeEditarFicha }) {
    const c = exp?.cliente;
    if (!c) return null;
    const marcas = marcasDelCliente(exp);
    const app = estadoDeLaApp(exp.app);
    const saldo = Number(exp.puntos?.saldo) || 0;
    const porVencer = exp.por_vencer ?? [];

    // Créditos: el plazo lo decide `edadDelCredito` (30 días), el mismo juez
    // que Cuentas por cobrar. `null` = el cargo no ve la cartera.
    const creditos = (exp.creditos ?? []).map((cr) => ({ ...cr, ...edadDelCredito(cr.fecha, cr.saldo) }));
    const deuda = creditos.reduce((s, cr) => s + (Number(cr.saldo) || 0), 0);
    const vencidos = creditos.filter((cr) => cr.vencido).length;

    const reservas = exp.reservas ?? [];
    const encargos = exp.encargos ?? [];
    const inyecciones = exp.inyecciones ?? [];
    const pendientes = reservas.length + encargos.length + inyecciones.length;

    return (
        <div className="flex flex-col gap-4 min-w-0">
            {/* ── Quién es ────────────────────────────────────────────────── */}
            <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-4 min-w-0">
                <div className="flex items-start gap-3 min-w-0">
                    <span className="w-11 h-11 rounded-full bg-brand/10 text-brand-text flex items-center justify-center shrink-0">
                        <Contact size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                        {/* Un cliente no es un empleado: el nombre va como está en
                            su ficha (las excepciones de `nameUtils`). */}
                        <h2 className="text-body-lg sm:text-title font-black text-content leading-tight line-clamp-2">
                            {c.nombre || 'Cliente sin nombre'}
                        </h2>
                        <p className="text-caption text-content-3 mt-1 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><IdCard size={12} />{c.dui || 'Sin DUI'}</span>
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Phone size={12} />{c.telefono || 'Sin teléfono'}</span>
                            {c.email && <span className="inline-flex items-center gap-1.5 min-w-0 truncate"><Mail size={12} className="shrink-0" />{c.email}</span>}
                        </p>
                        {marcas.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {marcas.map((m) => (
                                    <Badge key={m.clave} size="sm" variant={m.tono} uppercase={false}>{m.rotulo}</Badge>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                {/* Las acciones sobre el cliente. Vender irá aquí. */}
                <div className="flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" icon={Star} onClick={() => onVerPuntos?.(c)}>
                        Puntos y movimientos
                    </Button>
                    <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onVerFicha?.(c)}>
                        {puedeEditarFicha ? 'Editar cliente' : 'Ver ficha'}
                    </Button>
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 min-w-0">
                {/* ── Puntos ──────────────────────────────────────────────── */}
                <Panel icono={Star} titulo="Puntos"
                    nota={exp.nivel?.nombre ? `Nivel ${exp.nivel.nombre} · compró ${formatMoney(exp.nivel.compra_12m)} en 12 meses` : null}>
                    <div>
                        <p className="text-3xl font-black tabular-nums text-content leading-none">{dolares(saldo)}</p>
                        <p className="text-caption text-content-3 mt-1">{pts(saldo)} puntos de descuento</p>
                    </div>
                    {porVencer.length > 0 ? (
                        <div className="flex flex-col gap-1">
                            <p className="text-caption font-bold text-warning-text flex items-center gap-1.5">
                                <CalendarClock size={13} /> Vencen pronto
                            </p>
                            {porVencer.map((v) => (
                                <p key={v.vence_el} className="text-caption text-content-2 tabular-nums">
                                    <span className="font-black">{pts(v.puntos)}</span> ({dolares(v.puntos)}) el {fechaNumerica(v.vence_el)}
                                </p>
                            ))}
                        </div>
                    ) : <Nada>Nada vence en los próximos 60 días.</Nada>}
                </Panel>

                {/* ── La app ──────────────────────────────────────────────── */}
                <Panel icono={Smartphone} titulo="App Puntos Salud">
                    {!app ? (
                        <Nada>No ha entrado a la app.{exp.puntos?.tiene_codigo ? ' Ya tiene su código de acceso.' : ''}</Nada>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <p className="text-body-sm font-bold text-content">{app.rotulo}</p>
                            {app.tiene && (
                                <p className={`text-caption flex items-center gap-1.5 ${app.avisos ? 'text-success-text' : 'text-content-3'}`}>
                                    {app.avisos ? <BellRing size={13} /> : <BellOff size={13} />}
                                    {app.avisos ? 'Le llegan los avisos' : 'Tiene los avisos apagados'}
                                </p>
                            )}
                            {app.ultimoUso && (
                                <p className="text-caption text-content-3">Último uso: {fechaHora12(app.ultimoUso)}</p>
                            )}
                        </div>
                    )}
                </Panel>

                {/* ── Lo que espera algo de la sala ──────────────────────── */}
                <Panel icono={PackageCheck} titulo="Pendientes"
                    nota={pendientes ? null : 'Sin reservas, encargos ni inyecciones por aplicar.'}>
                    {pendientes > 0 && (
                        <div className="flex flex-col divide-y divide-divider">
                            {reservas.map((r) => {
                                const e = ESTADO_DE_RESERVA[r.estado] ?? { rotulo: r.estado, tono: 'neutral' };
                                return (
                                    <Renglon key={`r${r.id}`} titulo={`${r.cantidad} × ${r.producto_nombre}`}
                                        detalle={[r.pedido ? `Reserva ${r.pedido}` : 'Reserva', r.sala,
                                            r.entrega === 'domicilio' ? 'a domicilio' : null,
                                            r.estado === 'lista' && r.vence_at ? `retira antes de ${fechaHora12(r.vence_at)}` : null]
                                            .filter(Boolean).join(' · ')}
                                        cifra={r.precio_unitario != null ? formatMoney(Number(r.precio_unitario) * Number(r.cantidad || 1)) : null}
                                        sub={r.pago_estado === 'pagado' ? 'Pagada' : r.pago_estado === 'anticipo' ? 'Con anticipo' : null}
                                        insignia={<Badge size="sm" variant={e.tono} uppercase={false}>{e.rotulo}</Badge>} />
                                );
                            })}
                            {encargos.map((g) => {
                                const e = ESTADO_DE_ENCARGO[g.estado] ?? { rotulo: g.estado, tono: 'neutral' };
                                return (
                                    <Renglon key={`e${g.id}`} titulo={`${g.cantidad} × ${g.producto_nombre}`}
                                        detalle={['Encargo', g.sala, g.fecha_estimada ? `para el ${fechaNumerica(g.fecha_estimada)}` : null]
                                            .filter(Boolean).join(' · ')}
                                        cifra={g.precio_unitario != null ? formatMoney(Number(g.precio_unitario) * Number(g.cantidad || 1)) : null}
                                        sub={Number(g.anticipo) > 0 ? `Anticipo ${formatMoney(g.anticipo)}` : null}
                                        insignia={<Badge size="sm" variant={e.tono} uppercase={false}>{e.rotulo}</Badge>} />
                                );
                            })}
                            {inyecciones.map((i) => (
                                <Renglon key={`i${i.id}`} titulo={i.producto}
                                    detalle={['Inyección pagada sin aplicar', i.sala, i.pagada_at ? corta(i.pagada_at) : null].filter(Boolean).join(' · ')}
                                    cifra={i.precio != null ? formatMoney(i.precio) : null}
                                    insignia={<Badge size="sm" variant="warning" uppercase={false}><Syringe size={11} className="inline mr-1" />Por aplicar</Badge>} />
                            ))}
                        </div>
                    )}
                </Panel>

                {/* ── Créditos (sólo con el permiso de la cartera) ───────── */}
                {exp.creditos != null && (
                    <Panel icono={CreditCard} titulo="Créditos"
                        nota={creditos.length
                            ? `Debe ${formatMoney(deuda)}${vencidos ? ` · ${vencidos} vencido${vencidos === 1 ? '' : 's'}` : ''}`
                            : null}>
                        {creditos.length === 0 ? <Nada>No debe nada.</Nada> : (
                            <div className="flex flex-col divide-y divide-divider">
                                {creditos.map((cr) => {
                                    const sev = severidadDeDias(cr.dias, cr.saldo);
                                    return (
                                        <Renglon key={cr.id}
                                            titulo={`${cr.tipo_doc || 'Documento'} ${cr.numero_doc || ''}`.trim()}
                                            detalle={[fechaNumerica(cr.fecha), cr.sala].filter(Boolean).join(' · ')}
                                            cifra={formatMoney(cr.saldo)}
                                            sub={`de ${formatMoney(cr.total)}`}
                                            insignia={(
                                                <Badge size="sm" variant={sev.variant} tone={sev.tone} uppercase={false}>
                                                    {cr.vencido ? `Vencido · ${cr.dias} días` : sev.porVencer ? `Vence pronto · ${cr.dias} días` : `${cr.dias} días`}
                                                </Badge>
                                            )} />
                                    );
                                })}
                            </div>
                        )}
                    </Panel>
                )}

                {/* ── Tratamientos de la app ─────────────────────────────── */}
                <Panel icono={Pill} titulo="Tratamientos"
                    nota="Lo que compra seguido; la app le recuerda cuándo le toca.">
                    {(exp.tratamientos ?? []).length === 0 ? <Nada>Sin tratamientos activos.</Nada> : (
                        <div className="flex flex-col divide-y divide-divider">
                            {exp.tratamientos.map((t) => (
                                <Renglon key={t.id} titulo={t.nombre}
                                    detalle={`Cada ${t.intervalo_dias} días${t.ultima_compra ? ` · última compra ${fechaNumerica(t.ultima_compra)}` : ''}`}
                                    cifra={t.proxima ? corta(t.proxima) : null} sub={t.proxima ? 'le toca' : null} />
                            ))}
                        </div>
                    )}
                </Panel>

                {/* ── Últimas compras ────────────────────────────────────── */}
                <Panel icono={Receipt} titulo="Últimas compras">
                    {(exp.compras ?? []).length === 0 ? <Nada>Sin compras registradas.</Nada> : (
                        <div className="flex flex-col divide-y divide-divider">
                            {exp.compras.map((f) => (
                                <Renglon key={f.id} titulo={f.sala || 'Sala'}
                                    detalle={`${fechaNumerica(f.fecha)} · ${f.tipo_documento || ''}`.trim()}
                                    cifra={formatMoney(f.total)} />
                            ))}
                        </div>
                    )}
                    <div>
                        <Button variant="ghost" size="sm" icon={ShoppingBag} onClick={() => onVerPuntos?.(c)}>
                            Ver todo en sus movimientos
                        </Button>
                    </div>
                </Panel>
            </div>
        </div>
    );
}
