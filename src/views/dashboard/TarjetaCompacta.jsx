import React, { useState } from 'react';
import { Clock, MoreHorizontal, Store } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import { formatMoney } from '@nucleo/utils/formatNumber';
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
// ═══════════════════════════════════════════════════════════════════════════
export default function TarjetaCompacta({
    codigo, estado = null, sala = null, cliente, lineas = [], cifras = [], plazo = null, aviso = null, acciones = [], tono = null,
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

                <p className="text-body font-bold text-content truncate" title={cliente ?? undefined}>{cliente ?? 'Sin cliente'}</p>

                {lineas.length > 0 && (
                    <div className="border-t border-divider pt-3 space-y-0.5 min-w-0">
                        {lineas.filter(Boolean).map((l, i) => (
                            <p key={i} className={`truncate ${i === 0 ? 'text-body-sm font-semibold text-content' : 'text-caption text-content-3'}`} title={l}>{l}</p>
                        ))}
                    </div>
                )}

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
