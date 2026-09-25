import React, { useMemo, useState } from 'react';
import { ChevronRight, HandCoins, Search, ShieldCheck } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import { EmptyState, LoadingState } from '../common/StateViews';
import ResolverDiferencia from './ResolverDiferencia';
import useSobreviveAlCierre from '../../hooks/useSobreviveAlCierre';
import { clickable } from '../../utils/clickable';
import { formatMoney } from '../../utils/formatNumber';
import { hora12 } from '../../utils/hora';
import { fechaTexto } from '../../utils/fecha';

/**
 * La pestaña «Diferencias» de /caja: qué días tuvieron diferencia, cómo quedó
 * cada uno y qué falta hacer con ellos.
 *
 * Lo pidió el usuario el 2026-09-25 mirando Salud 2 del 24-sep: «no entiendo
 * dónde debo corregir, cómo quedó el día». La lista de cortes mostraba el TRAMO
 * de cada uno —el último del día decía $0.00— y la resolución vivía escondida
 * dentro del detalle de cada corte. Acá la unidad es el DÍA, y lo primero que
 * se lee es cómo cerró.
 *
 * Cada día se abre en su ficha: los cortes que no cuadraron, en orden, y para
 * cada uno la misma resolución de siempre (`ResolverDiferencia`) — causa
 * encontrada con comprobante, o responsables y abonos. No es un segundo
 * formulario: es el mismo, puesto donde se lo busca.
 */

const ESTADO = {
    sin_resolver:  { label: 'Sin resolver', variant: 'danger' },
    por_confirmar: { label: 'Falta confirmar el corte', variant: 'warning' },
    con_saldo:     { label: 'Por cobrar', variant: 'warning' },
    por_registrar: { label: 'Por anotar', variant: 'info' },
    // Un sobrante sin causa no es trabajo pendiente: queda en el acumulado de
    // la sala para el inventario (usuario, 2026-09-25).
    acumulado:     { label: 'Acumulado', variant: 'info' },
    resuelto:      { label: 'Resuelto', variant: 'success' },
};

// La fecha de un corte es la de la sala: se lee a mediodía UTC para que ningún
// huso la corra de día.
const rotularFecha = (f) => fechaTexto(f, {
    weekday: 'short', day: 'numeric', month: 'short' });

const colorDe = (n) => (Number(n) < 0 ? 'text-danger-text' : Number(n) > 0 ? 'text-warning-text' : 'text-success-text');

const conSigno = (n) => {
    const v = Number(n || 0);
    return v > 0 ? `+${formatMoney(v)}` : formatMoney(v);
};

// El monto del día en el signo que se está mirando. Nunca el neto: faltantes
// y sobrantes no se restan entre sí (ver LA REGLA en `diferenciasDeCaja.js`).
const montoDelDia = (d, signo) => (signo === 'sobra' ? Number(d.sobrante || 0) : Math.abs(Number(d.faltante || 0)));
const tituloDelDia = (d, signo) => (signo === 'sobra'
    ? `Sobraron ${formatMoney(montoDelDia(d, signo))}`
    : `Faltaron ${formatMoney(montoDelDia(d, signo))}`);

const clave = (d) => `${d.branch_id}|${d.fecha}`;

export default function DiasConDiferencia({
    dias = [],
    // La lista completa del tipo, para la ficha: `dias` es sólo la página, y
    // después de abonar un día puede cambiar de estado y salirse de ella sin
    // que la ficha abierta deba cerrarse.
    diasParaFicha = null,
    cargando = false,
    error = null,
    nombreSala = {},
    puedeResolver = false,
    busqueda = '',
    onCambio,
    onLimpiarBusqueda,
    onVerTodos,
    filtroActivo = 'PENDIENTES',
    signo = 'falta',
}) {
    const [abierto, setAbierto] = useState(null);

    // Ya viene ordenada y paginada (`ordenarDias` en la vista).
    const ordenados = dias;

    // La ficha lee el día VIVO de la lista: después de abonar se recarga, y la
    // ficha tiene que mostrar el saldo nuevo sin cerrarse.
    const diaAbierto = useMemo(
        () => (abierto ? (diasParaFicha || dias).find((d) => clave(d) === abierto) || null : null),
        [abierto, dias, diasParaFicha],
    );
    const visible = useSobreviveAlCierre(diaAbierto);

    if (cargando && !dias.length) return <LoadingState label="Buscando los días con diferencia" />;

    if (error) {
        return (
            <Notice variant="danger">
                No se pudieron leer los días con diferencia. Vuelve a cargar la pantalla.
            </Notice>
        );
    }

    if (!ordenados.length) {
        if (busqueda) {
            return (
                <EmptyState
                    compact icon={Search} title="Sin resultados"
                    subtitle={`Ningún día con diferencia coincide con «${busqueda}».`}
                    action={<Button variant="secondary" onClick={onLimpiarBusqueda}>Limpiar la búsqueda</Button>}
                />
            );
        }
        return filtroActivo === 'PENDIENTES' || filtroActivo === 'TODOS' ? (
            <EmptyState
                compact icon={ShieldCheck} iconClass="text-success-text"
                title={signo === 'sobra' ? 'Sin sobrantes' : 'Sin faltantes pendientes'}
                subtitle={signo === 'sobra'
                    ? 'Ningún corte quedó arriba de lo esperado.'
                    : 'Todos tienen su causa, o están pagados y anotados en el sistema.'}
                action={onVerTodos && <Button variant="secondary" onClick={onVerTodos}>Ver todos los días</Button>}
            />
        ) : (
            <EmptyState compact icon={HandCoins} title="Sin días en este estado"
                action={onVerTodos && <Button variant="secondary" onClick={onVerTodos}>Ver todos los días</Button>} />
        );
    }

    return (
        <>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                {ordenados.map((d) => {
                    const e = ESTADO[d.estadoDif] || ESTADO.resuelto;
                    const sala = nombreSala[d.branch_id] || `Sucursal ${d.branch_id}`;
                    return (
                        <div
                            key={clave(d)}
                            data-surface="card"
                            className="p-3 space-y-2 cursor-pointer active:scale-[0.97] transition-transform min-h-[var(--tap-min)]"
                            {...clickable(() => setAbierto(clave(d)), { label: `Abrir ${sala} del ${rotularFecha(d.fecha)}` })}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-label font-bold text-content truncate">{sala}</div>
                                    <div className="text-caption text-content-3 capitalize">{rotularFecha(d.fecha)}</div>
                                </div>
                                <Badge variant={e.variant} size="sm" dot>{e.label}</Badge>
                            </div>

                            <div className={`text-body font-bold tabular-nums ${signo === 'sobra' ? 'text-warning-text' : 'text-danger-text'}`}>
                                {tituloDelDia(d, signo)}
                            </div>

                            <div className="space-y-0.5">
                                {d.cortes.map((c) => (
                                    <div key={c.id} className="flex items-baseline justify-between gap-2 text-caption">
                                        <span className="text-content-2">Corte de las {hora12(c.hora)}</span>
                                        <span className={`tabular-nums font-bold ${colorDe(c.tramo)}`}>{conSigno(c.tramo)}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center justify-between gap-2 text-caption">
                                <span className="text-content-3">
                                    {d.saldo > 0
                                        ? `Por cobrar ${formatMoney(d.saldo)}`
                                        : `${d.cortes.length} de ${d.cortes_del_dia} ${Number(d.cortes_del_dia) === 1 ? 'corte' : 'cortes'} del día`}
                                </span>
                                <ChevronRight className="w-4 h-4 text-content-3" aria-hidden="true" />
                            </div>
                        </div>
                    );
                })}
            </div>

            <LiquidModal
                open={!!diaAbierto}
                onClose={() => setAbierto(null)}
                maxWidth="max-w-2xl"
                ariaLabel="La diferencia del día"
            >
                {visible && (
                    <>
                        <LiquidModal.Header>
                            <div className="min-w-0">
                                <h3 className="text-body font-bold text-content">
                                    {nombreSala[visible.branch_id] || `Sucursal ${visible.branch_id}`}
                                </h3>
                                <p className="text-caption text-content-3 capitalize">{rotularFecha(visible.fecha)}</p>
                            </div>
                        </LiquidModal.Header>

                        <LiquidModal.Body className="space-y-4">
                            {/* Lo primero: cuánto, en el signo que se mira. Nunca el
                                neto del día: un sobrante no paga un faltante. */}
                            <div data-surface="card" className="p-3 space-y-1">
                                <span className="text-caption font-black uppercase tracking-widest text-content-3">
                                    {signo === 'sobra' ? 'Sobrante del día' : 'Faltante del día'}
                                </span>
                                <div className={`text-title font-bold tabular-nums ${signo === 'sobra' ? 'text-warning-text' : 'text-danger-text'}`}>
                                    {formatMoney(montoDelDia(visible, signo))}
                                </div>
                                <p className="text-caption text-content-2">
                                    {signo === 'sobra'
                                        ? 'Queda en el acumulado de la sala para el inventario. Si tiene causa, explícalo con su comprobante y sale del acumulado.'
                                        : 'Cada corte se paga o se explica con su comprobante. El sobrante de otro corte no lo compensa.'}
                                </p>
                            </div>

                            {visible.cortes.map((c) => {
                                const e = ESTADO[c.estadoDif] || ESTADO.resuelto;
                                const corte = {
                                    id: c.id, fecha: visible.fecha, hora: c.hora, branch_id: visible.branch_id,
                                    estado: c.estado, empleado_texto: c.empleado_texto, tramo: c.tramo, tipo: 'C',
                                };
                                return (
                                    <section key={c.id} className="space-y-2">
                                        <div className="flex items-center justify-between gap-2 flex-wrap px-1">
                                            <div className="min-w-0">
                                                <span className="text-label font-bold text-content">
                                                    Corte de las {hora12(c.hora)}
                                                </span>
                                                <span className={`ml-2 text-label font-bold tabular-nums ${colorDe(c.tramo)}`}>
                                                    {conSigno(c.tramo)}
                                                </span>
                                            </div>
                                            <Badge variant={e.variant} size="sm" dot>{e.label}</Badge>
                                        </div>

                                        {c.estado === 'PENDIENTE' && (
                                            <Notice variant="warning">
                                                Este corte todavía no se confirmó. Revísalo en la pestaña Cortes:
                                                si el conteo estuvo mal, se descarta y la diferencia desaparece.
                                            </Notice>
                                        )}

                                        <ResolverDiferencia
                                            corte={corte}
                                            nombreSala={nombreSala}
                                            diferencia={c.diferencia && c.diferencia.via ? c.diferencia : null}
                                            personasResueltas={c.diferencia?.personas || []}
                                            puedeResolver={puedeResolver}
                                            origen="diferencias"
                                            onCambio={onCambio}
                                        />

                                        {!puedeResolver && !c.diferencia && Number(c.tramo) < 0 && (
                                            <p className="text-caption text-content-3 px-1">
                                                Sin resolver. Quien opera la caja de la sala lo resuelve desde aquí.
                                            </p>
                                        )}
                                    </section>
                                );
                            })}
                        </LiquidModal.Body>

                        <LiquidModal.Footer>
                            <Button variant="secondary" onClick={() => setAbierto(null)}>Cerrar</Button>
                        </LiquidModal.Footer>
                    </>
                )}
            </LiquidModal>
        </>
    );
}
