import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { SkeletonText } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { explicarMetaPropuesta } from '../../data/metas';
import { ymLabelCorto } from './metasUtils';

// De dónde sale la propuesta. La fórmula (decisión del usuario, 2026-08-05):
//
//   ritmo    = (venta m-3 + m-2 + m-1) ÷ (días m-3 + m-2 + m-1)
//   propuesta = ritmo × días del mes objetivo × factor
//
// Desde el 2026-08-25 el mes m-1 puede ser el que TODAVÍA NO CERRÓ, con su venta
// llevada a mes completo. La propuesta se genera el 25, así que antes de eso los
// tres meses base eran mayo·junio·julio para una meta de septiembre, y el factor
// salía de julio — el mismo mes contra el que se había calculado la meta de
// agosto. El RPC lo marca por mes (`meses_base[].proyectado`) y para el último
// (`ultimo_proyectado`), y esos dos son los que cambian el texto de acá: si el
// panel dijera "cerró" sobre un mes en curso, estaría afirmando algo falso con
// un número correcto.
//
// El factor sale de cómo cerró la sala el mes -1, y va al REVÉS de lo que uno
// esperaría: al que se quedó corto se le pide crecer más (1.10) y al que va bien
// se le pide sostenerse (1.02). El criterio es recuperar terreno, no premiar.
//
// Sin cumplimiento medible —sala nueva, o un mes -1 sin meta— el factor es 1.00,
// y desde 20260805231843 eso vive en el RPC, no en el tramo de abajo de la
// tabla: cuando esos tramos se reordenaron, el caso "sin cumplimiento" se fue
// montado con ellos y pasó a 1.10 sin que nada avisara.
//
// Es la misma dirección que tenía el empuje de la fórmula anterior —exigirle más
// a la que viene floja— pero medida por cumplimiento en vez de por venta por
// hora abierta, que es un dato que se entiende sin que se lo expliquen.
//
// Se pide al ABRIR: son seis tarjetas y traer seis desgloses que casi nadie
// mira serían seis llamadas por nada.

const Paso = ({ n, titulo, monto, children }) => (
    <div className="flex gap-2.5">
        <span className="text-micro font-black text-content-3 tabular-nums pt-0.5 w-3 shrink-0">{n}</span>
        <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
                <p className="text-micro font-black uppercase tracking-widest text-content-3">{titulo}</p>
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

    // Sólo puede haber uno —el mes anterior al objetivo—, pero se busca en vez
    // de asumir la última posición: el día que la fórmula acepte dos, este
    // texto no se queda hablando del que ya cerró.
    const mesProyectado = (d?.meses_base || []).find((m) => m.proyectado);

    return (
        <div className="mt-1">
            <button
                type="button" onClick={alternar} aria-expanded={abierto}
                // 113×15: acá el tamaño **sí** es el diseño — es un rótulo al pie
                // de la tarjeta, no un botón, y agrandarlo lo convertiría en otra
                // cosa. `.blanco-tactil` sube el área de impacto a 44 sin tocar
                // la pintura, igual que en el aspa de `LiquidSelect` y las cajas
                // de MIN·MAX. Necesita `relative`: el pseudo-elemento se ancla ahí.
                className="blanco-tactil relative inline-flex items-center gap-1 text-micro font-black uppercase tracking-widest text-content-3 hover:text-content-2 active:scale-[0.97] transition-[color,transform]"
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
                            <Paso n="1" titulo="Su ritmo diario" monto={`${formatMoney(d.ritmo_dia)}/día`}>
                                {(d.meses_base || []).map((m, i) => (
                                    <span key={m.ym} className="tabular-nums">
                                        {i > 0 && ' · '}{ymLabelCorto(m.ym)} {formatMoney(m.venta)}
                                        {m.proyectado && (
                                            <span className="text-content-2 font-black"> proy.</span>
                                        )}
                                    </span>
                                ))}
                                <br />
                                <strong className="text-content-2 tabular-nums">{formatMoney(d.suma_venta)}</strong>
                                {' entre los '}
                                <strong className="text-content-2 tabular-nums">{d.suma_dias} días</strong>
                                {' de esos tres meses. Se divide por días y no por meses, para que uno de 30 y uno de 31 no pesen distinto.'}
                                {mesProyectado && (
                                    <span className="block mt-1">
                                        <strong className="text-content-2">{ymLabelCorto(mesProyectado.ym)}</strong>
                                        {' todavía no cierra: entra con lo que lleva vendido llevado a mes '}
                                        {'completo. Dejarlo afuera armaría la meta con el ritmo de hace un mes.'}
                                    </span>
                                )}
                            </Paso>

                            <Paso n="2" titulo={`Por los ${d.dias_mes} días del mes`} monto={formatMoney(d.sub_ritmo)}>
                                Lo que vendería el mes si mantuviera exactamente ese ritmo.
                            </Paso>

                            <Paso n="3" titulo={`Por el factor ${Number(d.factor).toFixed(2)}`} monto={formatMoney(d.recalculada)}>
                                {/* El factor lo dice el RPC, nunca un literal escrito acá: el
                                    "1.00" que estaba clavado siguió afirmándose mientras el
                                    cálculo devolvía 1.10, y el encabezado de este mismo paso
                                    lo desmentía dos líneas más arriba. */}
                                {d.pct_ultimo != null ? (
                                    <>
                                        {/* Un mes en curso no «cerró»: el número es el mismo,
                                            pero el verbo sería una afirmación falsa. */}
                                        {d.ultimo_proyectado ? 'Viene cerrando ' : 'Cerró '}
                                        <strong className="text-content-2">{ymLabelCorto(d.ym_ultimo)}</strong> en{' '}
                                        <strong className={Number(d.pct_ultimo) >= 100 ? 'text-success-text' : 'text-warning-text'}>
                                            {formatPct(d.pct_ultimo)}
                                        </strong>
                                        {d.meta_ultimo != null && (
                                            <> de su meta de <span className="tabular-nums">{formatMoney(d.meta_ultimo)}</span></>
                                        )}.
                                    </>
                                ) : (
                                    <>Ese mes no tuvo meta, así que no hay cumplimiento que medir y el
                                       factor queda en {Number(d.factor).toFixed(2)}: no se pide crecimiento
                                       sobre algo que no se pudo medir.</>
                                )}
                                {/* La tabla completa, con el tramo de esta sala marcado: así se
                                    ve que el factor no es un número elegido a dedo. Sin
                                    cumplimiento medible NO se marca ninguno — el 1.00 no es un
                                    tramo, y marcar el de "<90%" le informaría a la sala que
                                    cerró corta un mes en el que ni siquiera tuvo meta. */}
                                <span className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 max-w-[220px]">
                                    {(d.tramos || []).map((t, i, arr) => {
                                        const esSuyo = d.pct_ultimo != null && Number(t.factor) === Number(d.factor);
                                        const hasta = i === 0 ? null : Number(arr[i - 1].desde) - 0.01;
                                        return (
                                            <React.Fragment key={t.desde}>
                                                <span className={`tabular-nums ${esSuyo ? 'text-content font-black' : ''}`}>
                                                    {i === 0 ? `≥ ${t.desde}%` : Number(t.desde) === 0 ? `< ${hasta + 0.01}%` : `${t.desde}% – ${hasta}%`}
                                                </span>
                                                <span className={`tabular-nums text-right ${esSuyo ? 'text-content font-black' : ''}`}>
                                                    {Number(t.factor).toFixed(2)}
                                                </span>
                                            </React.Fragment>
                                        );
                                    })}
                                </span>
                                <span className="block mt-1">
                                    A la sala que se quedó corta se le pide crecer más, para que
                                    <strong className="text-content-2"> recupere terreno</strong> en vez de
                                    quedarse ahí. A la que va bien se le pide sostenerse.
                                </span>
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
                                        Con la fórmula de hoy da {formatMoney(d.recalculada)} y la propuesta
                                        guardada es {formatMoney(montoPropuesto)}. Manda la guardada: es la que
                                        se calculó el día que se propuso.
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
