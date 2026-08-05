import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { SkeletonText } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { explicarMetaPropuesta } from '../../data/metas';
import { ymLabelCorto } from './metasUtils';

// De dónde sale la propuesta, en tres pasos con el monto que va quedando.
//
// Pedido del usuario (2026-08-05): que el gerente entienda la fórmula Y por qué
// es un buen cálculo. La primera versión mostraba los factores pero no lo que
// hay detrás de cada uno —el 0.9867 salía como un número caído del cielo— y
// escondía el empuje cuando era cero, así que una sala que rinde bien nunca se
// enteraba de que ese mecanismo existe ni de que quedó fuera por rendir bien.
//
// El argumento más fuerte es el contraste con el promedio, y por eso está con su
// número al lado: sin él, «usamos la mediana» es una afirmación; con él, se ve
// que evitó pedir $1,654 de más por el mes raro de otra sala.
//
// Se pide al ABRIR: son seis tarjetas y traer seis desgloses que casi nadie mira
// serían seis llamadas por nada.

const Paso = ({ n, titulo, factor, monto, children }) => (
    <div className="flex gap-2.5">
        <span className="text-micro font-black text-content-3 tabular-nums pt-0.5 w-3 shrink-0">{n}</span>
        <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
                <p className="text-micro font-black uppercase tracking-widest text-content-3">
                    {titulo}
                    {factor && <span className="text-content-2 tabular-nums normal-case tracking-normal"> {factor}</span>}
                </p>
                <p className="text-label font-black tabular-nums text-content shrink-0">{monto}</p>
            </div>
            <div className="text-micro font-semibold text-content-3 leading-relaxed mt-0.5">{children}</div>
        </div>
    </div>
);

export default function ExplicacionMeta({ branchId, yearMonth, montoPropuesto }) {
    const [abierto, setAbierto] = useState(false);
    const [d, setD] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(false);

    const alternar = () => {
        const nuevo = !abierto;
        setAbierto(nuevo);
        if (nuevo && !d && !cargando) {
            setCargando(true);
            explicarMetaPropuesta({ branchId, yearMonth })
                .then((x) => { setD(x); setCargando(false); })
                .catch(() => { setError(true); setCargando(false); });
        }
    };

    const coincide = d != null && montoPropuesto != null
        && Math.abs(Number(d.recalculada) - Number(montoPropuesto)) < 0.01;

    // Cuánto se desvió ESTA sala el mismo mes del año pasado, y cuánto se cree
    // de la señal: n/(n+1), o sea 86% con las 6 salas.
    const desvioPropio = d ? (Number(d.idx_propio) - 1) * 100 : 0;
    const confianza = d ? (Number(d.n_salas) / (Number(d.n_salas) + 1)) * 100 : 0;
    const deMasConPromedio = d ? Number(d.con_promedio) - Number(d.recalculada) : 0;
    const hayEmpuje = d && Number(d.empuje) > 0;

    return (
        <div className="mt-1">
            <button
                type="button" onClick={alternar} aria-expanded={abierto}
                className="inline-flex items-center gap-1 text-micro font-black uppercase tracking-widest text-content-3 hover:text-content-2 transition-colors"
            >
                {abierto ? <ChevronUp size={11} strokeWidth={3} /> : <ChevronDown size={11} strokeWidth={3} />}
                De dónde sale
            </button>

            {abierto && (
                <div className="mt-2">
                    {cargando && <SkeletonText lines={4} />}
                    {error && (
                        <p className="text-label font-semibold text-content-3">
                            No se pudo traer el detalle del cálculo.
                        </p>
                    )}

                    {d && (
                        <div className="space-y-2.5">
                            <Paso n="1" titulo="Su propio ritmo" monto={formatMoney(d.sub_ritmo)}>
                                {(d.meses_base || []).map((m, i) => (
                                    <span key={m.ym} className="tabular-nums">
                                        {i > 0 && ' · '}{ymLabelCorto(m.ym)} {formatMoney(m.venta)}
                                    </span>
                                ))}
                                <br />
                                <strong className="text-content-2 tabular-nums">{formatMoney(d.ritmo_dia)} por día</strong>
                                {' × '}{d.dias_mes} días del mes. Por día y no por mes, para que un mes de 30
                                y uno de 31 no digan cosas distintas.
                            </Paso>

                            <Paso
                                n="2" titulo="El peso del mes"
                                factor={`× ${Number(d.estacional).toFixed(4)}`}
                                monto={formatMoney(d.sub_estacional)}
                            >
                                Este mismo mes del año pasado esta sala vendió{' '}
                                <strong className="text-content-2 tabular-nums">{formatMoney(d.venta_ap)}</strong>
                                {' '}y a su ritmo le tocaban{' '}
                                <strong className="text-content-2 tabular-nums">{formatMoney(d.esperado_ap)}</strong>
                                {' — '}
                                <strong className={desvioPropio < 0 ? 'text-danger-text' : 'text-success-text'}>
                                    {desvioPropio >= 0 ? '+' : ''}{desvioPropio.toFixed(1)}%
                                </strong>.
                                <br />
                                {/* El contraste con el promedio es el argumento de por qué
                                    el cálculo es bueno, y sin el número es solo una frase. */}
                                Pero no se usa el de esta sala: se toma la{' '}
                                <strong className="text-content-2">mediana de las {d.n_salas}</strong>{' '}
                                (<span className="tabular-nums">{Number(d.idx_mediana).toFixed(4)}</span>),
                                porque que un mes sea flojo es del calendario, no de una sala.
                                {deMasConPromedio > 0.5 && (
                                    <>
                                        {' '}Con el <strong className="text-content-2">promedio</strong>{' '}
                                        (<span className="tabular-nums">{Number(d.idx_promedio).toFixed(4)}</span>,
                                        que dos salas atípicas empujan hacia arriba) esta meta sería{' '}
                                        <strong className="text-warning-text tabular-nums">{formatMoney(d.con_promedio)}</strong>
                                        {' — '}<strong className="text-warning-text tabular-nums">{formatMoney(deMasConPromedio)} más</strong>.
                                    </>
                                )}
                                <br />
                                Y se aplica al <strong className="text-content-2">{confianza.toFixed(0)}%</strong>:
                                hay un solo año de historia y un dato no es una tendencia.
                            </Paso>

                            <Paso
                                n="3" titulo="Lo que se pide de más"
                                factor={`× ${(Number(d.crecimiento) + Number(d.empuje)).toFixed(4)}`}
                                monto={formatMoney(d.recalculada)}
                            >
                                <strong className="text-content-2">
                                    {formatPct((Number(d.crecimiento) - 1) * 100, { decimales: 0 })} de crecimiento
                                </strong>, igual para todas las salas.
                                <br />
                                {/* El empuje se muestra SIEMPRE, valga cero o no: que una
                                    sala no lo lleve es información — dice que rinde por
                                    encima de la mediana. */}
                                {hayEmpuje ? (
                                    <>
                                        <strong className="text-warning-text">
                                            +{formatPct(Number(d.empuje) * 100, { decimales: 2 })} de empuje
                                        </strong>: vende{' '}
                                        <span className="tabular-nums">{formatMoney(d.por_hora)}</span> por hora abierta
                                        contra <span className="tabular-nums">{formatMoney(d.por_hora_med)}</span> de mediana.
                                        {Number(d.empuje) >= Number(d.empuje_max) && (
                                            <> Está en el tope de {formatPct(Number(d.empuje_max) * 100, { decimales: 0 })}.</>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <strong className="text-success-text">Sin empuje</strong>: vende{' '}
                                        <span className="tabular-nums">{formatMoney(d.por_hora)}</span> por hora abierta
                                        contra <span className="tabular-nums">{formatMoney(d.por_hora_med)}</span> de
                                        mediana. El empuje solo le suma hasta{' '}
                                        {formatPct(Number(d.empuje_max) * 100, { decimales: 0 })} a las que rinden por
                                        debajo — comparar ventas sin mirar las horas abiertas castigaría a la que abre menos.
                                    </>
                                )}
                            </Paso>

                            {/* La comprobación: rehacer la cuenta tiene que dar el mismo
                                número que muestra la tarjeta. */}
                            {coincide ? (
                                <p className="text-micro font-black tabular-nums text-success-text pt-0.5 border-t border-border-card">
                                    = {formatMoney(d.recalculada)} — el mismo monto de arriba.
                                </p>
                            ) : (
                                <p className="text-micro font-semibold text-warning-text tabular-nums flex items-start gap-1 pt-0.5 border-t border-border-card">
                                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                    <span>
                                        Rehaciendo la cuenta hoy da {formatMoney(d.recalculada)} y la propuesta
                                        guardada es {formatMoney(montoPropuesto)}. Manda la guardada: es la que se
                                        calculó el día que se propuso.
                                    </span>
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
