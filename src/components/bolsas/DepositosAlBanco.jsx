import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, ChevronDown, ChevronUp, Image as ImageIcon, Landmark, Package, Paperclip } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import FileField from '../common/FileField';
import Notice from '../common/Notice';
import PhotoLightbox from '../common/PhotoLightbox';
import PromptModal from '../common/PromptModal';
import { DataTable, DataRow, DataCell } from '../common/DataTable';
import LiquidModal from '../common/LiquidModal';
import {
    adjuntarComprobanteDeposito, anularDeposito, fetchDepositos, subirComprobante,
} from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { getSignedFileUrl } from '../../utils/storageFiles';
import { useToastStore } from '../../store/toastStore';

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
    // A dónde fue: el banco, o la persona a la que se le entregó en mano.
    // Los depósitos anteriores al 2026-08-26 se cerraron sin registrar el
    // banco, así que su celda dice «—» y no miente con un nombre.
    { key: 'banco', label: 'A dónde', hideBelow: 'lg' },
    { key: 'total_contado', label: 'Contado', align: 'right', hideBelow: 'sm' },
    { key: 'monto_deposito', label: 'Al banco', align: 'right' },
    { key: 'monto_efectivo', label: 'En mano', align: 'right', hideBelow: 'sm' },
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
function Detalle({ deposito, nombreSala, onClose, onCambio }) {
    const d = deposito;
    const showToast = useToastStore((st) => st.showToast);
    const [ocupado, setOcupado] = useState(null);
    const [error, setError] = useState(null);
    const [ampliada, setAmpliada] = useState(null);
    const [corrigiendo, setCorrigiendo] = useState(false);
    const anulado = !!d.anulado_at;
    const anterior = d.destino === 'ANTERIOR';

    /* La boleta se ve firmada y en el momento: el bucket es privado y la URL
     * guardada es la pública, que sola no abre nada (regla 10). */
    const verComprobante = async () => {
        setOcupado('ver'); setError(null);
        try {
            const firmada = await getSignedFileUrl(d.comprobante_url);
            if (firmada) setAmpliada(firmada);
            else setError('No se pudo abrir el comprobante. Vuelve a intentar en un momento.');
        } catch { setError('No se pudo abrir el comprobante.'); }
        setOcupado(null);
    };

    const anexar = async (archivo) => {
        if (!archivo) return;
        setOcupado('subir'); setError(null);
        try {
            const url = await subirComprobante(archivo, { salaId: 'cierres', userId: d.id });
            const { error: err } = await adjuntarComprobanteDeposito(d.id, url);
            if (err) throw err;
            showToast('Comprobante anexado', d.folio, 'success');
            onCambio?.();
            onClose?.();
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo anexar el comprobante.'));
        }
        setOcupado(null);
    };

    const corregir = async (motivo) => {
        setOcupado('corregir'); setError(null);
        const { error: err } = await anularDeposito(d.id, motivo);
        setOcupado(null);
        if (err) { setError(mensajeAmigable(err, 'No se pudo corregir el cierre.')); return; }
        setCorrigiendo(false);
        showToast('Cierre corregido',
            `${d.folio} · sus ${d.cuantas} ${Number(d.cuantas) === 1 ? 'bolsa vuelve' : 'bolsas vuelven'} a estar por cerrar`,
            'success');
        onCambio?.();
        onClose?.();
    };

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
                    {/* Las DOS restas, cada una sólo si existe. Un cierre
                        repartido las muestra las dos; uno que fue entero a un
                        lado no dibuja un renglón en cero. */}
                    {Number(d.monto_deposito) > 0 && (
                        <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                            <span className="min-w-0">Al banco{d.banco ? ` · ${d.banco}` : ''}</span>
                            <span className="shrink-0 whitespace-nowrap">{`− ${formatMoney(d.monto_deposito)}`}</span>
                        </div>
                    )}
                    {Number(d.monto_efectivo) > 0 && (
                        <div className="flex items-baseline justify-between gap-3 text-caption text-content-2 tabular-nums">
                            <span className="min-w-0">En efectivo{d.entregado_a ? ` · ${d.entregado_a}` : ''}</span>
                            <span className="shrink-0 whitespace-nowrap">{`− ${formatMoney(d.monto_efectivo)}`}</span>
                        </div>
                    )}
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

                {d.destino === 'EFECTIVO' && d.entregado_a && (
                    <p className="text-caption text-content-2">
                        <span className="font-bold text-content">Se le entregó en mano a: </span>
                        {d.entregado_a}.
                    </p>
                )}

                {d.llevado_por && (
                    <p className="text-caption text-content-2">
                        <span className="font-bold text-content">Lo llevó al banco: </span>
                        {d.llevado_por}.
                    </p>
                )}

                {/* El remanente se dice, no se le asigna a nadie: es efectivo
                    del dueño y el portal no le sigue la pista. Los cierres
                    anteriores al 2026-08-26 sí guardaron a quién se le entregó,
                    y eso pasó — pero no se muestra, porque leerlo invita a
                    creer que hay un seguimiento que no existe. */}
                {Number(d.remanente) >= 0.01 && (
                    <p className="text-caption text-content-2">
                        <span className="font-bold text-content">Quedaron {formatMoney(d.remanente)} </span>
                        sin salir por el portal.
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

                {error && <Notice variant="danger">{error}</Notice>}

                {/* ── El comprobante del banco ────────────────────────────────
                    «que se pueda anexar el comprobante del banco» (usuario,
                    2026-08-26). Se anexa DESPUÉS de cerrar y no al cerrar: la
                    boleta sale al volver de la ventanilla, y exigirla antes
                    empujaría a registrar el efectivo tarde — que es peor.

                    Sólo donde significa algo: un cierre entero en mano no tiene
                    boleta de banco que anexar, y uno anterior al circuito
                    tampoco. */}
                {!anterior && Number(d.monto_deposito) > 0 && (
                    <div className="space-y-1.5">
                        <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                            Comprobante del banco
                        </h4>
                        {d.comprobante_url ? (
                            <Button variant="secondary" size="sm" icon={ImageIcon}
                                loading={ocupado === 'ver'} onClick={verComprobante}>
                                Ver el comprobante
                            </Button>
                        ) : anulado ? (
                            <p className="text-caption text-content-3">
                                Este cierre se corrigió: ya no lleva comprobante.
                            </p>
                        ) : (
                            <FileField
                                label="Anexar la boleta"
                                accept="image/*,application/pdf"
                                onChange={anexar}
                                disabled={ocupado === 'subir'}
                            />
                        )}
                    </div>
                )}

                {anulado && (
                    <Notice variant="warning" icon={Ban}>
                        <span className="font-bold">Este cierre se corrigió</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            {d.anulado_motivo} · {d.anulado_por || '—'} · {selloDeTiempo(d.anulado_at)}.
                            {' '}Sus bolsas volvieron a estar por cerrar.
                        </span>
                    </Notice>
                )}
            </LiquidModal.Body>

            {/* Corregir es la única marcha atrás del cierre, y hasta hoy no
                existía: era el paso con más campos donde equivocarse —banco,
                persona, reparto, comprobante— y ninguna forma de deshacerlo.
                No borra: deja el cierre anulado con su motivo y devuelve las
                bolsas a pendiente, igual que anular un vale. */}
            {!anulado && !anterior && (
                <LiquidModal.Footer>
                    <Button variant="ghost" size="sm" icon={Ban}
                        onClick={() => setCorrigiendo(true)}>
                        Corregir el cierre
                    </Button>
                    <Button variant="secondary" className="ml-auto" onClick={onClose}>Cerrar</Button>
                </LiquidModal.Footer>
            )}

            <PhotoLightbox src={ampliada} alt={`Comprobante de ${d.folio}`}
                onClose={() => setAmpliada(null)} />

            <PromptModal
                isOpen={corrigiendo}
                onClose={() => setCorrigiendo(false)}
                onConfirm={corregir}
                isProcessing={ocupado === 'corregir'}
                required
                title={`Corregir el cierre ${d.folio}`}
                message={`Sus ${d.cuantas} ${Number(d.cuantas) === 1 ? 'bolsa vuelve' : 'bolsas vuelven'} a estar por cerrar y este registro queda anulado con tu nombre. No se borra nada.`}
                placeholder="Por qué se corrige…"
                confirmText="Corregir"
            />
        </LiquidModal>
    );
}

export default function DepositosAlBanco({ desde, hasta, nombreSala, plegada, onPlegar }) {
    const [lista, setLista] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [abierto, setAbierto] = useState(null);

    /* Se pide SIEMPRE, también con la sección cerrada (2026-08-26).
     *
     * Antes no: «cerrada no se pide nada, es archivo». Pero el encabezado sí
     * pintaba el contador, así que sobre cuatro depósitos reales decía
     * **«0 depósitos»** — un cero que no significaba «no hay» sino «todavía no
     * miré», y los dos se ven igual. En la pantalla del efectivo eso no es una
     * imprecisión: es el número equivocado en el sitio donde se controla el
     * dinero. Es `feedback_cero_hallazgos_y_cero_datos_se_ven_igual`.
     *
     * Y arrastraba al aviso de las boletas faltantes, que vive fuera del bloque
     * plegable justamente para leerse con la sección cerrada: con la lista vacía
     * no salía nunca, o sea que el aviso existía y no avisaba.
     *
     * El costo es un RPC sobre una tabla de cuatro filas al entrar a la
     * pestaña. La sección de Conteos ya lo hacía así —su lista se la pasa el
     * motor, que la carga siempre— y por el mismo motivo. */
    const cargar = useCallback(async () => {
        setCargando(true);
        setLista(await fetchDepositos({ desde, hasta }));
        setCargando(false);
    }, [desde, hasta]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al entrar y al mover el período

    /* Un cierre CORREGIDO ya no cuenta —sus bolsas volvieron a estar por
     * cerrar— y uno `ANTERIOR` tampoco: su «remanente» no es dinero que alguien
     * tenga, es «no se registró a dónde fue». Sumarlo pondría $32,006.16 en el
     * acumulado del Gerente General, que es exactamente lo contrario de
     * seguirle la pista al remanente. */
    /* Un cierre CORREGIDO ya no cuenta —sus bolsas volvieron a estar por
     * cerrar— y uno `ANTERIOR` tampoco: no registra ningún movimiento.
     *
     * El remanente NO se acumula: «ya no es responsabilidad ni control del
     * portal, es efectivo del dueño» (usuario, 2026-08-26). Un total de
     * remanentes sería un saldo, y un saldo es exactamente el seguimiento que
     * el portal dejó de hacer. En cada cierre sigue estando, porque ahí cierra
     * la cuenta de ese cierre. */
    const totales = useMemo(() => lista
        .filter((d) => !d.anulado_at && d.destino !== 'ANTERIOR')
        .reduce((a, d) => ({
            banco: a.banco + Number(d.monto_deposito || 0),
            efectivo: a.efectivo + Number(d.monto_efectivo || 0),
            /* Los que fueron al banco y NO tienen boleta. Cuadrar contra el
               estado de cuenta es lo único para lo que este registro existe, y
               ese es el momento en que hace falta el papel.

               Medido el 2026-08-26: los dos únicos depósitos reales —$19,250 y
               $16,175— estaban sin comprobante. El campo se había agregado el
               día anterior y la fila sólo marcaba a los que SÍ lo tenían: un
               clip ausente no se lee como «falta», se lee como nada. */
            sinBoleta: a.sinBoleta
                + ((Number(d.monto_deposito || 0) >= 0.01 && !d.comprobante_url) ? 1 : 0),
            sinBoletaMonto: a.sinBoletaMonto
                + ((Number(d.monto_deposito || 0) >= 0.01 && !d.comprobante_url)
                    ? Number(d.monto_deposito || 0) : 0),
        }), { banco: 0, efectivo: 0, sinBoleta: 0, sinBoletaMonto: 0 }), [lista]);

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
            {totales.sinBoleta > 0 && (
                <Notice variant="warning" icon={AlertTriangle} className="mx-1">
                    {totales.sinBoleta === 1
                        ? 'Un depósito al banco no tiene su boleta'
                        : `${totales.sinBoleta} depósitos al banco no tienen su boleta`}
                    {` (${formatMoney(totales.sinBoletaMonto)}).`}
                    {' '}Se anexa abriendo el cierre.
                </Notice>
            )}

            {!plegada && (<>
            <p className="text-caption text-content-3 px-1">
                Cada cierre del efectivo contado: lo que fue al banco —para cuadrar contra el
                estado de cuenta— y lo que se entregó en mano.
                {totales.efectivo >= 0.01 && ` En mano: ${formatMoney(totales.efectivo)}.`}
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
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                                <span className={`font-bold ${d.anulado_at ? 'text-content-3 line-through' : 'text-content'}`}>
                                    {d.folio}
                                </span>
                                {d.anulado_at && <Badge variant="neutral" size="sm">Corregido</Badge>}
                                {d.destino === 'ANTERIOR' && <Badge variant="neutral" size="sm">Anterior</Badge>}
                                {d.comprobante_url ? (
                                    <Paperclip size={12} className="text-content-3 shrink-0"
                                        aria-label="Con comprobante del banco" />
                                ) : (
                                    /* Sólo donde la boleta EXISTE: un cierre en
                                       mano o `ANTERIOR` no tiene banco del cual
                                       traerla, y pedírsela sería un aviso que
                                       nadie puede apagar. */
                                    Number(d.monto_deposito || 0) >= 0.01 && !d.anulado_at && (
                                        <Badge variant="warning" size="sm">Sin boleta</Badge>
                                    )
                                )}
                            </span>
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
                            {/* Un cierre repartido nombra los dos lados: decir
                                sólo uno sería decir la mitad de a dónde fue. */}
                            {[d.banco, d.entregado_a && `en mano · ${d.entregado_a}`].filter(Boolean).length ? (
                                <span className="text-caption text-content-2">
                                    {[d.banco, d.entregado_a && `en mano · ${d.entregado_a}`].filter(Boolean).join(' + ')}
                                </span>
                            ) : <span className="text-content-3">—</span>}
                        </DataCell>
                        <DataCell align="right" hideBelow="sm">
                            <span className="tabular-nums text-content-2">
                                {formatMoney(d.total_contado)}
                            </span>
                        </DataCell>
                        <DataCell align="right">
                            {Number(d.monto_deposito) > 0
                                ? <span className="font-bold tabular-nums text-content">{formatMoney(d.monto_deposito)}</span>
                                : <span className="text-content-3 tabular-nums">—</span>}
                        </DataCell>
                        <DataCell align="right" hideBelow="sm">
                            {Number(d.monto_efectivo) > 0
                                ? <span className="font-bold tabular-nums text-content">{formatMoney(d.monto_efectivo)}</span>
                                : <span className="text-content-3 tabular-nums">—</span>}
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
                <Detalle deposito={abierto} nombreSala={nombreSala}
                    onClose={() => setAbierto(null)} onCambio={cargar} />
            )}
        </section>
    );
}
