import React, { useState } from 'react';
import { CheckCircle2, Circle, Clock, MoreHorizontal, Store } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BotonDeAccion } from './TarjetaDeReserva';

// ═══════════════════════════════════════════════════════════════════════════
// La tarjeta de lo que NO es una reserva en la pantalla de Reservas
// (2026-10-22): saldos a favor, devoluciones por entregar y encargos.
//
// Mismas reglas que `TarjetaDeReserva`, para que la pantalla se lea igual de
// arriba abajo: código y estado arriba, el cliente, una línea por dato (un
// texto largo se corta y el completo queda en el `title`), las cifras al pie
// para que todas las tarjetas de una fila midan lo mismo, y botones CON
// NOMBRE — la primera acción a la derecha en primario, la segunda al lado, y
// las demás en «Más». Nunca un ícono suelto que haya que adivinar.
//
// No abre un detalle: lo que estas filas tienen para mostrar entra entero.
// Por eso no lleva el ojo (§5.3: el ojo promete «hay más para ver»).
//
// `acciones`: [{ k, label, icon, onClick, title?, loading?, disabled? }], en
// orden de importancia — la misma forma que `accionesDeReserva`.
//
// `pasos` + `ahora` (2026-11-04, encargos): el recorrido con quién hizo cada
// paso (foto y nombre corto) y, debajo, qué toca ahora y con qué botón.
// ═══════════════════════════════════════════════════════════════════════════
export default function TarjetaCompacta({
    codigo, estado = null, sala = null, cliente, lineas = [], cifras = [], plazo = null, aviso = null, acciones = [], tono = null,
    pasos = null, ahora = null, titulo = null, etiquetas = [], bloques = [],
}) {
    const [masAbierto, setMasAbierto] = useState(false);
    const [principal, segunda, ...resto] = acciones;

    return (
        <article data-surface="card" data-tono={tono ?? undefined} className="h-full flex flex-col min-w-0">
            <div className="flex-1 p-4 flex flex-col gap-3 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="text-label font-black tracking-wide text-content tabular-nums">{codigo}</span>
                    {estado && <Badge variant={estado.variant ?? 'neutral'} uppercase={false}>{estado.label}</Badge>}
                    {sala && <span className="inline-flex items-center gap-1 text-caption text-content-3"><Store size={12} aria-hidden /> {sala}</span>}
                </div>

                {titulo ? (
                    <div className="space-y-1.5 min-w-0">
                        <p className="text-body font-bold text-content leading-snug line-clamp-2" title={titulo}>{titulo}</p>
                        {etiquetas.filter(Boolean).length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {etiquetas.filter(Boolean).map((t) => (
                                    <Badge key={t.label} variant={t.variant ?? 'neutral'} uppercase={false} title={t.title}>{t.label}</Badge>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-body font-bold text-content truncate" title={cliente ?? undefined}>{cliente ?? 'Sin cliente'}</p>
                )}

                {bloques.filter(Boolean).length > 0 && (
                    <div className="grid gap-2 min-w-0">
                        {bloques.filter(Boolean).map((b) => <Bloque key={b.k} b={b} />)}
                    </div>
                )}

                {lineas.length > 0 && (
                    <div className="border-t border-divider pt-3 space-y-0.5 min-w-0">
                        {lineas.filter(Boolean).map((l, i) => (
                            <p key={i} className={`truncate ${i === 0 ? 'text-body-sm font-semibold text-content' : 'text-caption text-content-3'}`} title={l}>{l}</p>
                        ))}
                    </div>
                )}

                {pasos?.length > 0 && <Pasos pasos={pasos} ahora={ahora} />}

                {(cifras.length > 0 || aviso || plazo) ? (
                <div className="border-t border-divider pt-3 mt-auto">
                    {cifras.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                            {cifras.map((c) => (
                                <div key={c.rotulo} className="min-w-0">
                                    <p className="text-caption text-content-3">{c.rotulo}</p>
                                    <p className={`text-body font-bold tabular-nums ${c.tono ?? 'text-content'}`}>
                                        {typeof c.valor === 'number' ? formatMoney(c.valor) : c.valor}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                    {aviso ? (
                        <p className="mt-2 text-caption font-semibold text-warning-text truncate" title={aviso}>{aviso}</p>
                    ) : plazo && (
                        <p className="flex items-center gap-1 mt-2 text-caption text-content-3 min-w-0">
                            <Clock size={12} className="shrink-0" aria-hidden /> <span className="truncate">{plazo}</span>
                        </p>
                    )}
                </div>
                ) : <span className="mt-auto" aria-hidden />}
            </div>

            {acciones.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-3 border-t border-divider">
                    {resto.length > 0 && (
                        <Button variant="ghost" size="sm" icon={MoreHorizontal} onClick={() => setMasAbierto(true)}
                            title={resto.map((a) => a.label).join(' · ')}>Más</Button>
                    )}
                    <span className="flex-1" />
                    {segunda && <BotonDeAccion a={segunda} variant="secondary" />}
                    {principal && <BotonDeAccion a={principal} variant="primary" />}
                </div>
            )}

            {masAbierto && (
                <LiquidModal open onClose={() => setMasAbierto(false)} maxWidth="max-w-sm" ariaLabel={`Más acciones de ${codigo}`}>
                    <LiquidModal.Header titulo={codigo} subtitulo={cliente} compacto
                        onClose={() => setMasAbierto(false)} />
                    <LiquidModal.Body>
                        <div className="grid gap-2">
                            {acciones.map((a, i) => (
                                <BotonDeAccion key={a.k} variant={i === 0 ? 'primary' : 'secondary'} className="w-full"
                                    a={{ ...a, onClick: () => { setMasAbierto(false); a.onClick(); } }} />
                            ))}
                        </div>
                    </LiquidModal.Body>
                    <LiquidModal.Footer>
                        <Button variant="ghost" size="sm" onClick={() => setMasAbierto(false)}>Cerrar</Button>
                    </LiquidModal.Footer>
                </LiquidModal>
            )}
        </article>
    );
}

const cuando = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Un bloque con rótulo («Lo pidió», «Respuesta de Bodega»): quién, cuándo, qué
// dijo y su nota entre comillas. `pendiente` lo pinta apagado y punteado.
function Bloque({ b }) {
    const Icono = b.icon;
    return (
        <section className={`rounded-xl border px-3 py-2.5 min-w-0 space-y-1 ${b.pendiente ? 'border-dashed border-divider' : 'border-divider bg-surface-card-hover'}`}
            aria-label={b.rotulo}>
            <p className="flex items-center gap-1.5 text-caption font-black uppercase tracking-widest text-content-3">
                {Icono && <Icono size={12} aria-hidden />} {b.rotulo}
            </p>
            {(b.persona || b.quien) && (
                <p className="flex items-center gap-1.5 text-body-sm font-semibold text-content min-w-0">
                    {b.persona && <AvatarConEstado emp={b.persona} px={20} mostrarChip={false} />}
                    <span className="truncate" title={b.persona ? shortEmployeeName(b.persona) : b.quien}>{b.persona ? shortEmployeeName(b.persona) : b.quien}</span>
                </p>
            )}
            {(b.detalle || b.at) && (
                <p className="text-caption text-content-3 truncate">{[b.detalle, b.at ? cuando(b.at) : null].filter(Boolean).join(' · ')}</p>
            )}
            {b.texto && <p className={`text-body-sm ${b.pendiente ? 'text-content-3' : 'text-content-2'}`}>{b.texto}</p>}
            {b.nota && <p className="text-caption italic text-content-2 line-clamp-3" title={b.nota}>«{b.nota}»</p>}
        </section>
    );
}


// El recorrido del encargo: lo hecho con su persona, lo que falta en gris.
function Pasos({ pasos, ahora }) {
    return (
        <div className="border-t border-divider pt-3 space-y-2 min-w-0">
            <ol className="space-y-1.5 min-w-0" aria-label="Pasos del encargo">
                {pasos.map((p) => (
                    <li key={p.clave} className="flex items-start gap-2 min-w-0">
                        {p.hecho
                            ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success-text" aria-label="Hecho" />
                            : <Circle size={16} className="mt-0.5 shrink-0 text-content-3" aria-label="Falta" />}
                        <div className="min-w-0 flex-1">
                            <p className={`text-body-sm ${p.hecho ? 'text-content font-semibold' : 'text-content-3'}`}>{p.titulo}</p>
                            {p.hecho && (p.persona || p.quien || p.at) && (
                                <p className="flex items-center gap-1.5 text-caption text-content-3 min-w-0">
                                    {p.persona && <AvatarConEstado emp={p.persona} px={20} mostrarChip={false} />}
                                    <span className="truncate">
                                        {[p.persona ? shortEmployeeName(p.persona) : p.quien, p.at ? cuando(p.at) : null].filter(Boolean).join(' · ')}
                                    </span>
                                </p>
                            )}
                        </div>
                    </li>
                ))}
            </ol>
            {ahora && (
                <p className="text-body-sm text-content-2 rounded-xl bg-surface-card-hover px-3 py-2">
                    <span className="font-semibold text-content">Ahora: </span>{ahora}
                </p>
            )}
        </div>
    );
}
