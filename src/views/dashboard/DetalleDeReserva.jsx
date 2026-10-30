import React from 'react';
import { MessageCircle, Phone } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { BotonDeAccion } from './TarjetaDeReserva';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { codigoDeReserva, whatsappDe } from '@nucleo/data/reservas';
import { textoDeProrroga } from '@nucleo/utils/reservasDeSala';
import { TRASLADO, cuentasDeReserva, estadoDeReserva, formaDePagoLegible, renglonesDe, telefonoLegible } from './reservaVista';
import { HistorialDeAvisos, InsigniaDeNivel } from './AvisosDeReserva';

// ═══════════════════════════════════════════════════════════════════════════
// El detalle de una reserva (2026-10-22): lo que la tarjeta resume, entero.
// Las acciones son las MISMAS que las de la tarjeta (`accionesDeReserva` de
// WidgetReservas, una sola lista): la tarjeta muestra las dos primeras y acá
// están todas, con su nombre. Cada una cierra el detalle antes de actuar, para
// que el diálogo que abre no quede debajo de éste.
// ═══════════════════════════════════════════════════════════════════════════
export default function DetalleDeReserva({ r, acciones = [], onClose }) {
    if (!r) return null;
    const filas = renglonesDe(r);
    const estado = estadoDeReserva(r);
    const { total, pagado, falta, pagadoTodo } = cuentasDeReserva(r);
    const codigo = r.pedido ?? codigoDeReserva(r.id);
    const tel = telefonoLegible(r.telefono);
    const wa = whatsappDe(r.telefono);
    const cuando = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const dia = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short' });
    const fiscal = r.documento === 'credito_fiscal' ? r.datos_fiscales : null;

    const conCierre = (a) => ({ ...a, onClick: () => { onClose(); a.onClick(); } });
    const mayores = acciones.filter((a) => !a.menor).map(conCierre);
    const menores = acciones.filter((a) => a.menor).map(conCierre);

    const fechas = [
        ['Creada', r.creada && cuando(r.creada)],
        ['Lista', r.lista_at && cuando(r.lista_at)],
        ['Retira hasta', r.estado === 'lista' && r.vence_at && `${dia(r.vence_at)}${textoDeProrroga(r)}`],
        ['Avisada', r.avisado_at && `${cuando(r.avisado_at)}${r.avisado_via === 'whatsapp' ? ' · por WhatsApp' : ''}`],
    ].filter(([, v]) => v);

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-xl" ariaLabel={`Reserva ${codigo}`}>
            <LiquidModal.Header
                titulo={<span className="tabular-nums">{codigo}</span>}
                subtitulo={`${r.origen === 'app' ? 'Reservada desde la app' : 'Hecha en la sala'}${r.sala ? ` · ${r.sala}` : ''}`}
                acciones={<>
                    <Badge variant={estado.variant} uppercase={false}>{estado.label}</Badge>
                    <InsigniaDeNivel nivel={r.nivel} />
                </>}
                onClose={onClose} />
            <LiquidModal.Body>
                <div className="space-y-6">
                    {mayores.length > 0 && (
                        <Bloque titulo="Qué hacer">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {mayores.map((a, i) => (
                                    <BotonDeAccion key={a.k} a={a} variant={i === 0 ? 'primary' : 'secondary'} className="w-full" />
                                ))}
                            </div>
                        </Bloque>
                    )}
                    <Bloque titulo="Cliente">
                        <p className="text-body font-bold text-content break-words">{r.cliente ?? 'Sin cliente'}</p>
                        <Datos filas={[
                            ['Teléfono', tel || 'Sin teléfono'],
                            ['App', r.tiene_app ? 'La tiene: los avisos le llegan solos' : 'No la tiene: se le avisa por WhatsApp'],
                            r.entrega === 'domicilio' && ['Entrega', `A domicilio · ${r.direccion_entrega ?? ''}`],
                            fiscal && ['Factura', `Crédito fiscal · ${fiscal.nombre} · NIT ${fiscal.nit} · NRC ${fiscal.nrc}`],
                        ]} />
                        {(tel || wa) && (
                            <div className="flex flex-wrap gap-2">
                                {tel && (
                                    <Button variant="secondary" size="sm" icon={Phone}
                                        onClick={() => { window.location.href = `tel:${String(r.telefono).replace(/\D/g, '')}`; }}>Llamar</Button>
                                )}
                                {wa && (
                                    <Button variant="secondary" size="sm" icon={MessageCircle}
                                        onClick={() => window.open(`https://wa.me/${wa}`, '_blank', 'noopener')}>WhatsApp</Button>
                                )}
                            </div>
                        )}
                    </Bloque>

                    <Bloque titulo={filas.length > 1 ? `Productos · ${filas.length}` : 'Producto'}>
                        <ul className="space-y-3">
                            {filas.map((x) => (
                                <li key={x.id} data-surface="card" className="p-3 space-y-1.5">
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="text-body-sm font-semibold text-content break-words min-w-0">{x.producto}</p>
                                        <p className="text-body-sm font-bold text-content tabular-nums shrink-0">
                                            {formatMoney(Number(x.precio ?? 0) * Number(x.cantidad ?? 1))}
                                        </p>
                                    </div>
                                    <p className="text-caption text-content-3 tabular-nums">
                                        {x.cantidad} × {formatMoney(Number(x.precio ?? 0))}
                                        {Number(x.precio_normal) > Number(x.precio) ? ` · precio normal ${formatMoney(Number(x.precio_normal))}` : ''}
                                        {x.lista_precio ? ` · ${x.lista_precio === 'mayoreo_plus' ? 'Mayoreo Plus' : 'Mayoreo'}` : ''}
                                        {r.pedido ? ` · ${codigoDeReserva(x.id)}` : ''}
                                    </p>
                                    {x.estado === 'pendiente' && (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {TRASLADO[x.traslado_estado] && (
                                                <Badge variant={TRASLADO[x.traslado_estado].variant} uppercase={false}>{TRASLADO[x.traslado_estado].label}</Badge>
                                            )}
                                            <span className="text-caption text-content-2 break-words">
                                                {x.traslado_nota || (x.traslado_estado ? '' : 'Hay que apartarla en la sala.')}
                                                {Number(x.traslado_llegaron) > 0 && ` Llegaron ${x.traslado_llegaron} de ${x.cantidad}.`}
                                            </span>
                                        </div>
                                    )}
                                    {x.encargo && (
                                        <p className="text-caption text-content-2">
                                            Encargo {x.encargo.codigo} · {x.encargo.cantidad} a Bodega
                                            {x.encargo.fecha ? ` · llega ${dia(x.encargo.fecha)}` : ''}
                                        </p>
                                    )}
                                    {x.oferta && <p className="text-caption text-content-3">Oferta: {x.oferta}</p>}
                                </li>
                            ))}
                        </ul>
                    </Bloque>

                    <Bloque titulo="Pago">
                        <div data-surface="card" className="p-3 grid grid-cols-3 gap-2 text-center">
                            <Cifra rotulo="Total" valor={total} />
                            <Cifra rotulo={pagadoTodo ? 'Pagado' : 'Anticipo'} valor={pagado} tono="text-success-text" />
                            <Cifra rotulo="Falta al retirar" valor={falta} tono={falta > 0.004 ? 'text-warning-text' : 'text-content-3'} />
                        </div>
                        <Datos filas={[
                            pagado > 0 && ['Cómo pagó', formaDePagoLegible(r.pago_metodo)],
                            Number(r.costo_envio) > 0 && ['Envío', formatMoney(Number(r.costo_envio))],
                            r.pago_prueba && ['Atención', 'El cobro en línea fue de prueba: no entró dinero, se cobra en caja.'],
                            r.preventa_ref && ['En caja', `Preventa #${r.preventa_ref}${r.factura ? ` · factura ${r.factura}` : ''}`],
                        ]} />
                    </Bloque>

                    {fechas.length > 0 && <Bloque titulo="Fechas"><Datos filas={fechas} /></Bloque>}

                    {/* Reglamento v2, cláusula 9: los avisos con quién los hizo. La base
                        los manda sólo desde la fecha (`avisos`, `aviso_app`). */}
                    {(r.avisos || r.aviso_app || r.registrar_llamada) && (
                        <Bloque titulo="Avisos al cliente"><HistorialDeAvisos avisos={r.avisos} avisoApp={r.aviso_app} /></Bloque>
                    )}

                    {r.bajo_receta && (
                        <Bloque titulo="Receta">
                            <Datos filas={[
                                ['Estado', { pendiente: 'Por revisar', aprobada: 'Aprobada', rechazada: 'Rechazada', otra_foto: 'Se pidió otra foto' }[r.receta_estado] ?? 'Sin receta'],
                                r.receta_motivo && ['Motivo', r.receta_motivo],
                            ]} />
                        </Bloque>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center gap-2 w-full">
                    {menores.map((a) => <BotonDeAccion key={a.k} a={a} variant="ghost" />)}
                    <span className="flex-1" />
                    <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function Bloque({ titulo, children }) {
    return (
        <section className="space-y-2.5">
            <h3 className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">{titulo}</h3>
            {children}
        </section>
    );
}

function Datos({ filas }) {
    const visibles = filas.filter(Boolean);
    if (!visibles.length) return null;
    return (
        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-body-sm">
            {visibles.map(([k, v]) => (
                <React.Fragment key={k}>
                    <dt className="text-content-3">{k}</dt>
                    <dd className="text-content break-words min-w-0">{v}</dd>
                </React.Fragment>
            ))}
        </dl>
    );
}

function Cifra({ rotulo, valor, tono = 'text-content' }) {
    return (
        <div className="min-w-0">
            <p className="text-caption text-content-3">{rotulo}</p>
            <p className={`text-body-lg font-bold tabular-nums ${tono}`}>{formatMoney(valor)}</p>
        </div>
    );
}
