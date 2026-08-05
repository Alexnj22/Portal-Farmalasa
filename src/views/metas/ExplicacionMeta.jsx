import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { SkeletonText } from '../../components/common/StateViews';
import { formatMoney } from '../../utils/formatNumber';
import { explicarMetaPropuesta } from '../../data/metas';
import { ymLabelCorto } from './metasUtils';

// De dónde sale la propuesta. Pedido del usuario (2026-08-05): que el número no
// caiga del cielo.
//
// Se pide al ABRIR y no al cargar la pestaña: son seis tarjetas, y traer seis
// desgloses que casi nadie va a mirar es gastar seis llamadas por nada.
//
// Lo importante: el servidor devuelve también el monto RECALCULADO, y acá se
// compara contra el que está guardado. Si no coinciden, se dice — un desglose
// que explica un número distinto al que muestra la tarjeta es peor que no
// explicar nada, porque parece que sí lo explica.
export default function ExplicacionMeta({ branchId, yearMonth, montoPropuesto }) {
    const [abierto, setAbierto] = useState(false);
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(false);

    const alternar = () => {
        const nuevo = !abierto;
        setAbierto(nuevo);
        if (nuevo && !datos && !cargando) {
            setCargando(true);
            explicarMetaPropuesta({ branchId, yearMonth })
                .then((d) => { setDatos(d); setCargando(false); })
                .catch(() => { setError(true); setCargando(false); });
        }
    };

    const coincide = datos != null && montoPropuesto != null
        && Math.abs(Number(datos.recalculada) - Number(montoPropuesto)) < 0.01;

    return (
        <div className="mt-1">
            <button
                type="button" onClick={alternar}
                aria-expanded={abierto}
                className="inline-flex items-center gap-1 text-micro font-black uppercase tracking-widest text-content-3 hover:text-content-2 transition-colors"
            >
                {abierto ? <ChevronUp size={11} strokeWidth={3} /> : <ChevronDown size={11} strokeWidth={3} />}
                De dónde sale
            </button>

            {abierto && (
                <div className="mt-2 space-y-2">
                    {cargando && <SkeletonText lines={3} />}

                    {error && (
                        <p className="text-label font-semibold text-content-3">
                            No se pudo traer el detalle del cálculo.
                        </p>
                    )}

                    {datos && (
                        <>
                            {/* Los tres meses que forman el ritmo: es el insumo
                                que más pesa y el único que alguien puede
                                contrastar contra lo que recuerda del negocio. */}
                            <div className="space-y-0.5">
                                <p className="text-micro font-black uppercase tracking-widest text-content-3">
                                    Los 3 meses cerrados que se usaron
                                </p>
                                {(datos.meses_base || []).map((m) => (
                                    <p key={m.ym} className="text-micro font-semibold text-content-2 tabular-nums">
                                        {ymLabelCorto(m.ym)} · {formatMoney(m.venta)} en {m.dias} días
                                    </p>
                                ))}
                            </div>

                            <div className="space-y-0.5 pt-1">
                                <p className="text-micro font-black uppercase tracking-widest text-content-3">La cuenta</p>
                                <p className="text-micro font-semibold text-content-2 tabular-nums leading-relaxed">
                                    <strong className="text-content">{formatMoney(datos.ritmo_dia)}</strong> por día
                                    {' × '}<strong className="text-content">{datos.dias_mes}</strong> días del mes
                                    {' × '}<strong className="text-content">{Number(datos.estacional).toFixed(4)}</strong> por el peso del mes
                                    {' × '}(<strong className="text-content">{Number(datos.crecimiento).toFixed(2)}</strong> de crecimiento
                                    {Number(datos.empuje) > 0 && (
                                        <> {'+ '}<strong className="text-content">{Number(datos.empuje).toFixed(4)}</strong> de empuje</>
                                    )})
                                </p>
                            </div>

                            {/* La comprobación: rehacer la cuenta tiene que dar
                                el mismo número que está arriba. */}
                            {coincide ? (
                                <p className="text-micro font-semibold text-success-text tabular-nums">
                                    = {formatMoney(datos.recalculada)} — el mismo monto de arriba.
                                </p>
                            ) : (
                                <p className="text-micro font-semibold text-warning-text tabular-nums flex items-start gap-1">
                                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                    <span>
                                        Rehaciendo la cuenta hoy da {formatMoney(datos.recalculada)}, y la propuesta
                                        guardada es {formatMoney(montoPropuesto)}. Manda la guardada: es la que se
                                        calculó el día que se propuso.
                                    </span>
                                </p>
                            )}

                            <p className="text-micro font-semibold text-content-3 leading-relaxed pt-1">
                                El <strong className="text-content-2">peso del mes</strong> compara cuánto rindió este
                                mismo mes el año pasado contra el ritmo que traía; se mide en las 6 salas y se usa la
                                mediana, para que una sala rara no arrastre a las demás.
                                {Number(datos.empuje) > 0 && (
                                    <> El <strong className="text-content-2">empuje</strong> se le suma a una sala que
                                    rinde menos por hora abierta que la mediana — acá son {datos.horas_semana} horas
                                    por semana. Nunca pasa del 2%.</>
                                )}
                            </p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
