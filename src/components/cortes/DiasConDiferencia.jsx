import React, { useMemo, useState } from 'react';
import { ChevronRight, HandCoins, Search, ShieldCheck, Users } from 'lucide-react';
import AvatarConEstado from '../common/AvatarConEstado';
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
import { desgloseDelDia, responsablesDelDia } from '../../utils/diferenciasDeCaja';
import { shortEmployeeName } from '../../utils/nameUtils';

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
const clave = (d) => `${d.branch_id}|${d.fecha}`;

/* Los tramos de la barra, en el orden en que se leen: primero lo que ya
 * volvió, después lo que falta. Las clases van LITERALES para que Tailwind las
 * vea (ver la nota de `AvatarConEstado`). */
const TRAMOS = {
    falta: [
        { k: 'abonado',      label: 'Abonado',      barra: 'bg-success',  punto: 'bg-success' },
        { k: 'explicado',    label: 'Con causa',    barra: 'bg-chart-1',  punto: 'bg-chart-1' },
        { k: 'porCobrar',    label: 'Por cobrar',   barra: 'bg-warning',  punto: 'bg-warning' },
        { k: 'porConfirmar', label: 'Por confirmar', barra: 'bg-chart-8', punto: 'bg-chart-8' },
        { k: 'sinResolver',  label: 'Sin resolver', barra: 'bg-danger',   punto: 'bg-danger' },
    ],
    sobra: [
        { k: 'explicado',    label: 'Con causa',    barra: 'bg-chart-1',  punto: 'bg-chart-1' },
        { k: 'acumulado',    label: 'Acumulado',    barra: 'bg-warning',  punto: 'bg-warning' },
        { k: 'porConfirmar', label: 'Por confirmar', barra: 'bg-chart-8', punto: 'bg-chart-8' },
    ],
};

const PUNTO_ESTADO = {
    sin_resolver: 'bg-danger', por_confirmar: 'bg-chart-8', con_saldo: 'bg-warning',
    por_registrar: 'bg-chart-1', acumulado: 'bg-warning', resuelto: 'bg-success',
};

/** El anillo de lo recuperado: el ancho del arco ES el dato. */
function AnilloRecuperado({ pct, px = 60 }) {
    const r = 24;
    const largo = 2 * Math.PI * r;
    const color = pct >= 100 ? 'text-success-text' : pct > 0 ? 'text-warning-text' : 'text-danger-text';
    return (
        <div className="relative shrink-0" style={{ width: px, height: px }} data-medida="dato"
             role="img" aria-label={`${pct}% recuperado`}>
            <svg viewBox="0 0 60 60" className="w-full h-full -rotate-90" aria-hidden="true">
                <circle cx="30" cy="30" r={r} fill="none" strokeWidth="6" className="stroke-border-card" />
                <circle
                    cx="30" cy="30" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
                    stroke="currentColor" className={`${color} transition-[stroke-dashoffset] duration-[var(--dur-lento)]`}
                    strokeDasharray={largo} strokeDashoffset={largo * (1 - Math.min(100, pct) / 100)}
                />
            </svg>
            <span className={`absolute inset-0 grid place-items-center text-caption font-black tabular-nums ${color}`}>
                {pct}%
            </span>
        </div>
    );
}

/** La barra apilada del día y su leyenda. Sólo los tramos que tienen algo. */
function BarraDelDia({ desglose, signo }) {
    const tramos = TRAMOS[signo === 'sobra' ? 'sobra' : 'falta'].filter((t) => desglose[t.k] > 0);
    if (!desglose.total) return null;
    return (
        <div className="space-y-1.5">
            <div className="flex h-2 rounded-full overflow-hidden bg-border-card gap-px" data-medida="dato">
                {tramos.map((t) => (
                    <div key={t.k} className={`h-full ${t.barra} transition-[width] duration-[var(--dur-lento)]`}
                         style={{ width: `${(desglose[t.k] / desglose.total) * 100}%` }} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-caption">
                {tramos.map((t) => (
                    <span key={t.k} className="inline-flex items-center gap-1.5 text-content-2">
                        <span className={`w-2 h-2 rounded-full ${t.punto}`} aria-hidden="true" />
                        {t.label}
                        <span className="font-bold tabular-nums text-content">{formatMoney(desglose[t.k])}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

/** Las caras de quienes responden, encimadas, con cuánto debe el grupo. */
function CarasResponsables({ personas }) {
    if (!personas.length) {
        return (
            <span className="inline-flex items-center gap-1.5 text-caption text-content-3">
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
                Sin responsables asignados
            </span>
        );
    }
    const visibles = personas.slice(0, 4);
    const resto = personas.length - visibles.length;
    const nombres = personas.slice(0, 2).map((p) => shortEmployeeName(p.nombre)).join(', ');
    return (
        <div className="flex items-center gap-2 min-w-0">
            <div className="flex -space-x-2 shrink-0">
                {visibles.map((p) => (
                    <AvatarConEstado
                        key={p.persona_id}
                        emp={{ id: p.persona_id, name: p.nombre }}
                        px={28} radio="rounded-full" mostrarChip={false}
                        marco="border-2 border-surface"
                    />
                ))}
                {resto > 0 && (
                    <span className="w-7 h-7 rounded-full border-2 border-surface bg-border-card grid place-items-center text-micro font-black text-content-2">
                        +{resto}
                    </span>
                )}
            </div>
            <span className="text-caption text-content-2 truncate">
                {nombres}{personas.length > 2 ? ` y ${personas.length - 2} más` : ''}
            </span>
        </div>
    );
}

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
                    const desglose = desgloseDelDia(d, signo);
                    const personas = signo === 'sobra' ? [] : responsablesDelDia(d);
                    return (
                        <div
                            key={clave(d)}
                            data-surface="card"
                            className="p-4 space-y-3 cursor-pointer active:scale-[0.97] transition-transform min-h-[var(--tap-min)]"
                            {...clickable(() => setAbierto(clave(d)), { label: `Abrir ${sala} del ${rotularFecha(d.fecha)}` })}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-label font-bold text-content truncate">{sala}</div>
                                    <div className="text-caption text-content-3 capitalize">{rotularFecha(d.fecha)}</div>
                                </div>
                                <Badge variant={e.variant} size="sm" dot>{e.label}</Badge>
                            </div>

                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-caption font-black uppercase tracking-widest text-content-3">
                                        {signo === 'sobra' ? 'Sobraron' : 'Faltaron'}
                                    </div>
                                    <div className={`text-title font-bold tabular-nums leading-tight ${signo === 'sobra' ? 'text-warning-text' : 'text-danger-text'}`}>
                                        {formatMoney(montoDelDia(d, signo))}
                                    </div>
                                    {signo !== 'sobra' && (
                                        <div className="text-caption text-content-2 tabular-nums">
                                            Recuperado {formatMoney(desglose.cubierto)}
                                        </div>
                                    )}
                                </div>
                                {signo !== 'sobra' && <AnilloRecuperado pct={desglose.pct} />}
                            </div>

                            <BarraDelDia desglose={desglose} signo={signo} />

                            <ol className="space-y-1 border-t border-border-card pt-2">
                                {d.cortes.map((c) => {
                                    const ec = ESTADO[c.estadoDif] || ESTADO.resuelto;
                                    return (
                                        <li key={c.id} className="flex items-center gap-2 text-caption">
                                            <span className={`w-2 h-2 rounded-full shrink-0 ${PUNTO_ESTADO[c.estadoDif] || 'bg-success'}`} aria-hidden="true" />
                                            <span className="text-content-2 shrink-0">{hora12(c.hora)}</span>
                                            <span className="text-content-3 truncate flex-1">{ec.label}</span>
                                            <span className={`tabular-nums font-bold ${colorDe(c.tramo)}`}>{conSigno(c.tramo)}</span>
                                        </li>
                                    );
                                })}
                            </ol>

                            <div className="flex items-center justify-between gap-2 border-t border-border-card pt-2">
                                {signo === 'sobra' ? (
                                    <span className="text-caption text-content-3">
                                        {d.cortes.length} de {d.cortes_del_dia} {Number(d.cortes_del_dia) === 1 ? 'corte' : 'cortes'} del día
                                    </span>
                                ) : (
                                    <CarasResponsables personas={personas} />
                                )}
                                <div className="flex items-center gap-1 shrink-0">
                                    {d.saldo > 0 && (
                                        <span className="text-caption font-bold tabular-nums text-warning-text">
                                            Debe {formatMoney(d.saldo)}
                                        </span>
                                    )}
                                    <ChevronRight className="w-4 h-4 text-content-3" aria-hidden="true" />
                                </div>
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
                                <div className="flex items-center justify-between gap-3">
                                    <div className={`text-title font-bold tabular-nums ${signo === 'sobra' ? 'text-warning-text' : 'text-danger-text'}`}>
                                        {formatMoney(montoDelDia(visible, signo))}
                                    </div>
                                    {signo !== 'sobra' && <AnilloRecuperado pct={desgloseDelDia(visible, signo).pct} px={52} />}
                                </div>
                                <BarraDelDia desglose={desgloseDelDia(visible, signo)} signo={signo} />
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
