import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Landmark, Package } from 'lucide-react';
import Badge from '../common/Badge';
import { DataTable, DataRow, DataCell } from '../common/DataTable';
import LiquidModal from '../common/LiquidModal';
import { fetchDepositos } from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';

/**
 * El archivo de los depósitos al banco.
 *
 * Cada depósito ya quedaba guardado entero desde v2.739.0 —folio, fecha, lo
 * contado, lo que entró de afuera, lo que fue al banco, el remanente y las tres
 * personas—, y no había ninguna pantalla que lo mostrara. Para saber cuánto se
 * depositó el lunes había que acordarse de una bolsa de ese día, abrirla, leer
 * su bitácora, encontrar el folio del depósito… y aun así no ver el monto.
 *
 * Un registro que no se puede mirar no sirve para aquello por lo que se guardó:
 * cuadrar contra el estado de cuenta del banco, seguirle la pista al remanente,
 * y darse cuenta de que un día se depositó de menos.
 *
 * ── La sección entera va detrás de `bolsas_ver_montos` ─────────────────────
 * No sólo las cifras: la sección. Un depósito SIN sus montos no es una fila
 * incompleta, es una fila que no dice nada — «DEP-260824-1, 8 bolsas» no
 * responde ninguna de las tres preguntas de arriba. Distinto de la lista de
 * bolsas, donde el folio y el día alcanzan para moverlas físicamente.
 */
const fechaLarga = (f) => (f ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}) : '');
const selloDeTiempo = (iso) => (iso ? new Date(iso).toLocaleString('es-SV', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'America/El_Salvador',
}) : '');
const hhmm = (h) => String(h || '').slice(0, 5);

const COLUMNAS = [
    { key: 'folio', label: 'Depósito' },
    { key: 'fecha', label: 'Fecha' },
    // «podré ver por ejemplo cada conteo? los días y el monto que se llevó al
    // banco / se contó?» (usuario, 2026-08-26). La fila decía sólo lo que fue
    // al banco, así que no se podía leer de un vistazo cuánto se había contado
    // ni de qué días era esa plata — las dos preguntas de quien cuadra contra
    // el estado de cuenta. Los días van en `Días`, que es un RANGO derivado de
    // las bolsas que quedaron adentro.
    { key: 'dias', label: 'Días', hideBelow: 'md' },
    // El banco. Los depósitos anteriores al 2026-08-26 se cerraron sin
    // registrarlo, así que su celda dice «—» y no miente con un nombre.
    { key: 'banco', label: 'Banco', hideBelow: 'lg' },
    { key: 'total_contado', label: 'Contado', align: 'right', hideBelow: 'sm' },
    { key: 'monto_deposito', label: 'Al banco', align: 'right' },
    { key: 'remanente', label: 'Remanente', align: 'right' },
    { key: 'cuantas', label: 'Bolsas', align: 'right', hideBelow: 'md' },
];

/* El rango de días que cubre un depósito, dicho corto. Un solo día se dice
 * «17 ago» y no «17 ago → 17 ago», que sería decir dos veces lo mismo. */
const rangoDeDias = (d) => {
    if (!d?.dia_desde) return '—';
    const corto = (f) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV',
        { day: 'numeric', month: 'short' });
    return d.dia_desde === d.dia_hasta ? corto(d.dia_desde) : `${corto(d.dia_desde)} → ${corto(d.dia_hasta)}`;
};

/** El detalle: la cuenta que se hizo y qué bolsas se fueron adentro. */
function Detalle({ deposito, nombreSala, onClose }) {
    const d = deposito;
    return (
        <LiquidModal open={!!d} onClose={onClose}
            maxWidth="max-w-lg" className="h-fit" ariaLabel={`Depósito ${d.folio}`}>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">{d.folio}</h3>
                    <p className="text-caption text-content-3">
                        {fechaLarga(d.fecha)} · cerrado por {d.cerrado_por || '—'} · {selloDeTiempo(d.cerrado_at)}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {/* La misma cuenta que se vio al cerrarlo, en el mismo orden.
                    Que se lea igual acá que allá es lo que permite volver a
                    seguirla meses después. */}
                <div data-surface="card" className="px-4 py-3 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                        <span>Contado</span><span>{formatMoney(d.total_contado)}</span>
                    </div>
                    {Number(d.aporte) > 0 && (
                        <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                            <span>Entró de afuera</span><span>+ {formatMoney(d.aporte)}</span>
                        </div>
                    )}
                    <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                        <span className="min-w-0">Al banco{d.banco ? ` · ${d.banco}` : ''}</span>
                        <span className="shrink-0">− {formatMoney(d.monto_deposito)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 pt-1.5 border-t border-line">
                        <span className="text-subtitle font-bold text-content">Remanente</span>
                        <span className="text-title-sm font-black tabular-nums text-content">
                            {formatMoney(d.remanente)}
                        </span>
                    </div>
                </div>

                {Number(d.aporte) > 0 && d.aporte_nota && (
                    <p className="text-caption text-content-2">
                        <span className="font-bold text-content">De dónde salió lo que entró: </span>
                        {d.aporte_nota}
                    </p>
                )}

                {d.llevado_por && (
                    <p className="text-caption text-content-2">
                        <span className="font-bold text-content">Lo llevó al banco: </span>
                        {d.llevado_por}.
                    </p>
                )}

                {Number(d.remanente) >= 0.01 && (
                    <p className="text-caption text-content-2">
                        <span className="font-bold text-content">El remanente </span>
                        lo entregó {d.entregado_por || '—'}
                        {d.recibido_por ? ` a ${d.recibido_por}` : ''}.
                    </p>
                )}

                {d.nota && (
                    <p className="text-caption text-content-2">
                        <span className="font-bold text-content">Nota: </span>{d.nota}
                    </p>
                )}

                {/* Qué días entraron, y cuánto de cada uno. Va ANTES de las
                    bolsas porque es la pregunta que se hace primero: con 43
                    bolsas, la lista de a una no responde «¿cuánto entró del
                    martes?». Sale de las bolsas del depósito, así que no puede
                    dejar de coincidir con ellas. */}
                {(d.por_dia?.length || 0) > 1 && (
                    <div className="space-y-1.5">
                        <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                            Por día
                        </h4>
                        <div data-surface="card" className="px-4 py-3 space-y-1.5">
                            {d.por_dia.map((x) => (
                                <div key={x.fecha}
                                    className="flex items-baseline justify-between gap-3 tabular-nums">
                                    <span className="text-caption text-content-2">
                                        {fechaLarga(x.fecha)}
                                        <span className="text-content-3">
                                            {' '}· {x.cuantas} {Number(x.cuantas) === 1 ? 'bolsa' : 'bolsas'}
                                        </span>
                                    </span>
                                    <span className="text-label font-bold text-content shrink-0">
                                        {formatMoney(x.contado)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="space-y-1.5">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                        {d.bolsas?.length || 0} {d.bolsas?.length === 1 ? 'bolsa' : 'bolsas'}
                    </h4>
                    <div className="space-y-1.5">
                        {(d.bolsas || []).map((b) => (
                            <div key={b.id} data-surface="card"
                                className="flex items-baseline justify-between gap-3 px-3 py-2">
                                <span className="min-w-0">
                                    <span className="text-label font-bold text-content">{b.folio}</span>
                                    <span className="text-caption text-content-3">
                                        {' '}{nombreSala?.[b.branch_id] || ''} · {fechaLarga(b.fecha)} · {hhmm(b.hora)}
                                    </span>
                                </span>
                                <span className="text-label font-bold tabular-nums text-content shrink-0">
                                    {formatMoney(b.contado)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </LiquidModal.Body>
        </LiquidModal>
    );
}

export default function DepositosAlBanco({ desde, hasta, nombreSala, plegada, onPlegar }) {
    const [lista, setLista] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [abierto, setAbierto] = useState(null);

    /* Cerrada no se pide nada: es archivo, y el caso normal es no abrirla. */
    const cargar = useCallback(async () => {
        if (plegada) return;
        setCargando(true);
        setLista(await fetchDepositos({ desde, hasta }));
        setCargando(false);
    }, [desde, hasta, plegada]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al entrar y al mover el período

    const totales = useMemo(() => lista.reduce((a, d) => ({
        banco: a.banco + Number(d.monto_deposito || 0),
        remanente: a.remanente + Number(d.remanente || 0),
    }), { banco: 0, remanente: 0 }), [lista]);

    return (
        <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1 flex-wrap">
                <h3 className="text-label font-bold text-content">
                    <button type="button" onClick={onPlegar} aria-expanded={!plegada}
                        className="flex items-center gap-2 min-h-[var(--tap-min)] text-left
                                   hover:text-content-2 transition-colors">
                        {plegada ? <ChevronDown size={14} className="text-content-3 shrink-0" />
                            : <ChevronUp size={14} className="text-content-3 shrink-0" />}
                        <Landmark size={15} className="text-content-3" />
                        Depósitos al banco
                    </button>
                </h3>
                <span className="text-caption text-content-3 tabular-nums">
                    {lista.length} {lista.length === 1 ? 'depósito' : 'depósitos'}
                    {lista.length > 0 && (
                        <> · <b className="text-label font-bold text-content">{formatMoney(totales.banco)}</b></>
                    )}
                </span>
            </div>
            {!plegada && (<>
            <p className="text-caption text-content-3 px-1">
                Lo que se llevó al banco, para cuadrar contra el estado de cuenta.
                {totales.remanente >= 0.01 && ` En remanentes: ${formatMoney(totales.remanente)}.`}
            </p>

            <DataTable
                columns={COLUMNAS}
                loading={cargando}
                /* El toque de la fila va a un destino de verdad —la cuenta del
                   depósito y sus bolsas—, no a la hoja genérica. */
                movil={{ usarAccionDeFila: true }}
                minWidth="560px"
                empty={{ icon: Landmark, message: 'Sin depósitos en estas fechas' }}
            >
                {lista.map((d, i) => (
                    <DataRow key={d.id} index={i} onClick={() => setAbierto(d)}>
                        <DataCell>
                            <span className="font-bold text-content">{d.folio}</span>
                        </DataCell>
                        <DataCell>{fechaLarga(d.fecha)}</DataCell>
                        {/* Los días que cubre y lo contado. Van ANTES de «Al
                            banco» porque es el orden de la cuenta: de qué días
                            es la plata, cuánta se contó, cuánta se llevó. */}
                        <DataCell hideBelow="md">
                            <span className="text-caption text-content-2 tabular-nums">
                                {rangoDeDias(d)}
                            </span>
                        </DataCell>
                        <DataCell hideBelow="lg">
                            {d.banco
                                ? <span className="text-caption text-content-2">{d.banco}</span>
                                : <span className="text-content-3">—</span>}
                        </DataCell>
                        <DataCell align="right" hideBelow="sm">
                            <span className="tabular-nums text-content-2">
                                {formatMoney(d.total_contado)}
                            </span>
                        </DataCell>
                        <DataCell align="right">
                            <span className="font-bold tabular-nums text-content">
                                {formatMoney(d.monto_deposito)}
                            </span>
                        </DataCell>
                        <DataCell align="right">
                            {Number(d.remanente) >= 0.01 ? (
                                <Badge variant="neutral" size="sm">{formatMoney(d.remanente)}</Badge>
                            ) : (
                                <span className="text-content-3 tabular-nums">—</span>
                            )}
                        </DataCell>
                        <DataCell align="right" hideBelow="md">
                            <span className="inline-flex items-center gap-1 text-content-2 tabular-nums">
                                <Package size={12} className="text-content-3" />
                                {d.cuantas}
                            </span>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            </>)}

            {abierto && (
                <Detalle deposito={abierto} nombreSala={nombreSala} onClose={() => setAbierto(null)} />
            )}
        </section>
    );
}
