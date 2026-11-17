import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Package, Receipt, Scale, ShieldCheck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Notice from '../../components/common/Notice';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12, fechaHora12 } from '@nucleo/utils/hora';
import { diferenciaDeBolsa, saldoDeBolsa, contadoDeBolsa } from '@nucleo/utils/bolsasReparto';
import { fetchBolsas, fetchSaldos, fetchPersonasDeBolsas, fetchDiferenciasDeCortes, fetchEstadosDeDiferenciaDeCortes } from '@nucleo/data/bolsas';
import { ESTADO_DIFERENCIA_ROTULO } from '@nucleo/utils/diferenciasDeCaja';
import { ESTADO_DE_BOLSA, FILTROS_TODAS_BOLSAS } from '@nucleo/constants/bolsas';

/* ── «Todas»: cada bolsa de un rango, en la etapa que esté ───────────────────
 *
 * «si quiero ver todas, por ejemplo del 1 al 15 de este mes?» (usuario,
 * 2026-11-17). Las otras pestañas son TRABAJO —entregar, recibir, contar— y
 * cada una muestra sólo su etapa; además «Finalizadas» recorta por el día en
 * que se CONTÓ, así que una bolsa del corte del 14 contada el 17 no salía en
 * el 1–15. Ninguna contestaba «¿qué bolsas hubo esos días?».
 *
 * Ésta sí: recorta por la FECHA DEL CORTE —el día del dinero, que es el que
 * alguien tiene en la cabeza cuando pregunta— y trae los cinco estados,
 * anuladas incluidas (una anulada que no aparece es una bolsa que desapareció).
 *
 * Es de lectura: las acciones siguen en su pestaña. Tocar una fila abre el
 * mismo detalle que el resto del módulo. Sin descarga (lo pidió el usuario). Sólo para alcance de todas las
 * sucursales (`soloAdmin`), que es lo que pidió el usuario. */

const ESTADOS = ESTADO_DE_BOLSA;
const ORDEN_ESTADO = { ABIERTA: 0, ENTREGADA: 1, RECIBIDA: 2, CONTADA: 3, ANULADA: 4 };


const fechaCorta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short' }) : '');
const sello = (iso) => (iso ? fechaHora12(iso, { day: '2-digit', month: 'short' }) : '');
const tonoDif = (n) => (n < -0.005 ? 'text-danger-text' : n > 0.005 ? 'text-warning-text' : 'text-content');

/** Faltó / Sobró / Cuadró. `null` = no aplica; `undefined` = no se pudo leer. */
function Diferencia({ valor, resuelta = false }) {
    if (valor === undefined) return <span className="text-caption text-content-3">Sin dato</span>;
    if (valor == null) return <span className="text-content-3">—</span>;
    if (Math.abs(valor) < 0.01) return <span className="text-caption text-success-text">Cuadró</span>;
    return (
        <span className={`font-bold tabular-nums whitespace-nowrap ${resuelta ? 'text-content-2' : tonoDif(valor)}`}>
            {valor < 0 ? 'Faltó ' : 'Sobró '}{formatMoney(Math.abs(valor))}
        </span>
    );
}

/** El último paso de la bolsa: quién la tiene o quién la cerró. */
function ultimoPaso(b) {
    if (b.estado === 'CONTADA')   return { verbo: 'Contó', id: b.contado_por, at: b.contado_at };
    if (b.estado === 'RECIBIDA')  return { verbo: 'Recibió', id: b.recibida_por, at: b.recibida_at };
    if (b.estado === 'ENTREGADA') return { verbo: 'Entregó', id: b.entregada_por, at: b.entregada_at };
    return { verbo: 'Guardó', id: b.cerrada_por, at: b.cerrada_at };
}

/* El filtro vive en la píldora de la vista (`filtro`/`onFiltro`) y las cifras
 * suben a la fila de tarjetas de arriba (`onMetricas`): una sola fila, no dos. */
export default function TodasLasBolsas({
    desde, hasta, sala, busqueda = '', nombreSala = {}, verMontos, onAbrir, version,
    filtro = '', onFiltro, onMetricas, onOpciones,
}) {
    const [bolsas, setBolsas] = useState(null);
    const [error, setError] = useState(false);
    const [personas, setPersonas] = useState(() => new Map());
    const [orden, setOrden] = useState({ key: 'fecha', dir: 'desc' });
    // Diferencia del CORTE por `corte_id` (no la del conteo). `null` = no se pudo leer.
    const [difCortes, setDifCortes] = useState(() => new Map());
    // Si esa diferencia del corte ya se resolvió (mismo estado que Cortes de caja).
    const [estCortes, setEstCortes] = useState(() => new Map());

    // Gana la lectura más nueva: el período y el refresco del módulo pueden
    // cruzarse, y la vieja no puede pisar a la nueva.
    const lecturaRef = useRef(0);
    const cargar = useCallback(async ({ silencioso = false } = {}) => {
        const esta = ++lecturaRef.current;
        if (!silencioso) setBolsas(null);
        const [filas, cortes, estados] = await Promise.all([
            fetchBolsas({ desde, hasta, estados: [] }),
            fetchDiferenciasDeCortes({ desde, hasta }),
            fetchEstadosDeDiferenciaDeCortes({ desde, hasta }),
        ]);
        if (esta !== lecturaRef.current) return;
        setDifCortes(cortes);
        setEstCortes(estados || new Map());
        if (filas == null) { setError(true); setBolsas([]); return; }
        const saldos = await fetchSaldos(filas.map((b) => b.id));
        if (esta !== lecturaRef.current) return;
        // Sin saldos no se puede decir cuánto hay en cada bolsa: mejor avisarlo
        // que pintar ceros que se leen como bolsas vacías.
        setError(saldos == null);
        setBolsas(filas.map((b) => ({ ...b, ...(saldos?.get(b.id) || {}) })));
        const gente = await fetchPersonasDeBolsas(filas.flatMap((b) => [
            b.cerrada_por, b.entregada_por, b.recibida_por, b.contado_por]));
        if (esta !== lecturaRef.current) return;
        setPersonas(new Map((gente || []).map((p) => [p.id, p])));
    }, [desde, hasta]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al entrar y al mover el período
    const primera = useRef(true);
    useEffect(() => {
        if (primera.current) { primera.current = false; return; }
        cargar({ silencioso: true }); // eslint-disable-line react-hooks/set-state-in-effect -- recarga silenciosa cuando el módulo avisa que algo cambió
    }, [version]); // eslint-disable-line react-hooks/exhaustive-deps -- sólo cuando el módulo avisa que algo cambió

    const nombre = useCallback((id) => (id && personas.get(id) ? shortEmployeeName(personas.get(id)) : ''), [personas]);

    const delAlcance = useMemo(() => (bolsas || []).filter((b) => {
        if (sala && String(b.branch_id) !== String(sala)) return false;
        if (!busqueda.trim()) return true;
        return tokenMatch(busqueda, b.folio, nombreSala[b.branch_id], b.fecha, fechaCorta(b.fecha),
            b.caja, ESTADOS[b.estado]?.label, String(b.monto_inicial ?? ''), String(b.saldo ?? ''),
            String(b.contado ?? ''), nombre(b.cerrada_por), nombre(b.entregada_por),
            nombre(b.recibida_por), nombre(b.contado_por));
    }), [bolsas, sala, busqueda, nombreSala, nombre]);

    // Con diferencia SIN resolver: la resuelta ya tiene causa y no cuenta (usuario, 2026-11-17).
    const conDif = useCallback((b) => b.estado === 'CONTADA' && !b.dif_at && Math.abs(diferenciaDeBolsa(b) || 0) >= 0.01, []);
    /** La diferencia del corte de esta bolsa: número, `null` (sin dato) o `undefined` (no se pudo leer). */
    const difDelCorte = useCallback((b) => {
        if (!b.corte_id) return null;
        if (difCortes == null) return undefined;
        return difCortes.get(b.corte_id) ?? null;
    }, [difCortes]);
    const conDifCorte = useCallback((b) => Math.abs(difDelCorte(b) || 0) >= 0.01, [difDelCorte]);
    const estadoDelCorte = useCallback((b) => (conDifCorte(b) ? estCortes.get(b.corte_id)?.estado || null : null),
        [conDifCorte, estCortes]);
    /* Trabajo pendiente = lo que Cortes de caja marca en rojo o ámbar. `resuelto`
     * ya tiene causa y `acumulado` es un sobrante que queda para el inventario
     * (usuario, 2026-09-25): ninguno de los dos cuenta como diferencia. */
    const corteSinResolver = useCallback((b) => {
        const e = estadoDelCorte(b);
        return conDifCorte(b) && e !== 'resuelto' && e !== 'acumulado';
    }, [conDifCorte, estadoDelCorte]);

    const visibles = useMemo(() => {
        const f = delAlcance.filter((b) => {
            if (!filtro) return true;
            if (filtro === 'pendiente') return ['ABIERTA', 'ENTREGADA', 'RECIBIDA'].includes(b.estado);
            if (filtro === 'dif') return conDif(b);
            if (filtro === 'difcorte') return conDifCorte(b);
            if (filtro === 'cortesinresolver') return corteSinResolver(b);
            return b.estado === filtro;
        });
        const s = orden.dir === 'asc' ? 1 : -1;
        const cmp = {
            fecha: (a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora).localeCompare(String(b.hora)),
            sala: (a, b) => String(nombreSala[a.branch_id] || '').localeCompare(String(nombreSala[b.branch_id] || ''), 'es'),
            monto: (a, b) => saldoDeBolsa(a) - saldoDeBolsa(b),
            dif: (a, b) => (diferenciaDeBolsa(a) ?? 0) - (diferenciaDeBolsa(b) ?? 0),
            corte: (a, b) => (difDelCorte(a) ?? 0) - (difDelCorte(b) ?? 0),
            estado: (a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado],
        }[orden.key];
        return [...f].sort((a, b) => s * cmp(a, b) || String(b.fecha).localeCompare(String(a.fecha)));
    }, [delAlcance, filtro, orden, nombreSala, conDif, conDifCorte, difDelCorte, corteSinResolver]);

    // Las cifras del rango. Las anuladas no suman: no son dinero.
    const resumen = useMemo(() => {
        const vivas = delAlcance.filter((b) => b.estado !== 'ANULADA');
        const contadas = vivas.filter((b) => b.estado === 'CONTADA');
        const pendientes = vivas.filter((b) => b.estado !== 'CONTADA');
        const neto = contadas.filter((b) => !b.dif_at).reduce((a, b) => a + (diferenciaDeBolsa(b) || 0), 0);
        // Un corte puede tener varias bolsas: su diferencia se cuenta una vez.
        const cortesVistos = new Map();
        // Lo resuelto ya tiene causa: no cuenta como diferencia (usuario, 2026-11-17).
        for (const b of vivas) {
            if (b.corte_id && !cortesVistos.has(b.corte_id) && corteSinResolver(b)) {
                cortesVistos.set(b.corte_id, difDelCorte(b));
            }
        }
        const difsCorte = [...cortesVistos.values()];
        return {
            cuantas: vivas.length,
            monto: vivas.reduce((a, b) => a + saldoDeBolsa(b), 0),
            pendientes: pendientes.length,
            montoPendiente: pendientes.reduce((a, b) => a + saldoDeBolsa(b), 0),
            contadas: contadas.length,
            contado: contadas.reduce((a, b) => a + (Number(contadoDeBolsa(b)) || 0), 0),
            conDif: contadas.filter(conDif).length,
            neto: Math.round(neto * 100) / 100,
            netoCortes: Math.round(difsCorte.reduce((a, d) => a + (d || 0), 0) * 100) / 100,
            cortesConDif: difsCorte.filter((d) => Math.abs(d || 0) >= 0.01).length,
        };
    }, [delAlcance, conDif, difDelCorte, corteSinResolver]);

    const columnas = [
        { key: 'fecha', label: 'Fecha', sortable: true },
        { key: 'sala', label: 'Sucursal', sortable: true },
        ...(verMontos ? [
            { key: 'monto', label: 'En la bolsa', align: 'right', sortable: true },
            { key: 'corte', label: 'Dif. del corte', align: 'center', sortable: true, hideBelow: 'md' },
            { key: 'dif', label: 'Dif. del conteo', align: 'center', sortable: true, hideBelow: 'md' },
        ] : []),
        { key: 'estado', label: 'Estado', sortable: true },
        { key: 'paso', label: 'Último paso', hideBelow: 'lg' },
    ];

    const onSort = (key) => setOrden((o) => ({ key, dir: o.key === key && o.dir === 'desc' ? 'asc' : 'desc' }));

    // Las opciones de la píldora, con cuántas hay en cada una.
    const opciones = useMemo(() => {
        const cuenta = (v) => {
            if (!v) return delAlcance.length;
            if (v === 'pendiente') return delAlcance.filter((b) => ['ABIERTA', 'ENTREGADA', 'RECIBIDA'].includes(b.estado)).length;
            if (v === 'dif') return delAlcance.filter(conDif).length;
            if (v === 'difcorte') return delAlcance.filter(conDifCorte).length;
            if (v === 'cortesinresolver') return delAlcance.filter(corteSinResolver).length;
            return delAlcance.filter((b) => b.estado === v).length;
        };
        return FILTROS_TODAS_BOLSAS.filter((f) => f.value).map((f) => ({ ...f, label: `${f.label} (${cuenta(f.value)})` }));
    }, [delAlcance, conDif, conDifCorte, corteSinResolver]);
    useEffect(() => { onOpciones?.(opciones); }, [opciones, onOpciones]);

    /* «en card me interesa más ver cuánto es en total $» (usuario, 2026-11-17):
     * la cifra grande es el dinero; la cantidad va en el rótulo. */
    const cuantas = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
    const metricas = useMemo(() => (bolsas && verMontos ? [
        { clave: 't-bolsas', icon: Package, value: formatMoney(resumen.monto),
            label: `En ${cuantas(resumen.cuantas, 'bolsa', 'bolsas')}` },
        { clave: 't-pend', icon: Clock, value: formatMoney(resumen.montoPendiente),
            label: `${cuantas(resumen.pendientes, 'pendiente', 'pendientes')}`,
            onClick: resumen.pendientes ? () => onFiltro?.('pendiente') : undefined },
        { clave: 't-cont', icon: ShieldCheck, value: formatMoney(resumen.contado),
            label: `${cuantas(resumen.contadas, 'contada', 'contadas')}`,
            onClick: resumen.contadas ? () => onFiltro?.('CONTADA') : undefined },
        { clave: 't-difc', icon: Receipt, value: formatMoney(resumen.netoCortes), valueCls: tonoDif(resumen.netoCortes),
            label: `Cortes · ${cuantas(resumen.cortesConDif, 'sin resolver', 'sin resolver')}`,
            onClick: resumen.cortesConDif ? () => onFiltro?.('cortesinresolver') : undefined },
        { clave: 't-dif', icon: Scale, value: formatMoney(resumen.neto), valueCls: tonoDif(resumen.neto),
            label: `Conteo · ${cuantas(resumen.conDif, 'sin resolver', 'sin resolver')}`,
            onClick: resumen.conDif ? () => onFiltro?.('dif') : undefined },
    ] : []), [bolsas, verMontos, resumen, onFiltro]);
    useEffect(() => { onMetricas?.(metricas); }, [metricas, onMetricas]);
    useEffect(() => () => { onMetricas?.([]); onOpciones?.([]); }, [onMetricas, onOpciones]);

    const pag = usePaginaEnUrl({ total: visibles.length, tamPorDefecto: 50 });
    const { resetPage } = pag;
    // Cambiar QUÉ lista es devuelve a la primera página.
    useEffect(() => { resetPage(); }, [filtro, busqueda, sala, desde, hasta]); // eslint-disable-line react-hooks/exhaustive-deps -- sólo al cambiar la lista
    const tramo = visibles.slice((pag.page - 1) * pag.pageSize, pag.page * pag.pageSize);

    return (
        <section className="space-y-4">
            {error && (
                <Notice variant="danger">No se pudieron cargar todas las bolsas. Recarga la página.</Notice>
            )}

            <DataTable
                columns={columnas}
                sortKey={orden.key} sortDir={orden.dir} onSort={onSort}
                loading={bolsas === null}
                minWidth="720px"
                movil={{ usarAccionDeFila: true }}
                empty={{ icon: Package, message: 'Sin bolsas en estas fechas' }}
                footer={visibles.length > pag.pageSize ? (
                    <TablePagination page={pag.page} totalPages={pag.totalPages}
                        onPageChange={pag.setPage} pageSize={pag.pageSize}
                        onPageSizeChange={pag.setPageSize} total={visibles.length} unit="bolsas" />
                ) : null}
            >
                {tramo.map((b, i) => {
                    const est = ESTADOS[b.estado] || { label: b.estado, variant: 'neutral' };
                    const dif = b.estado === 'CONTADA' ? diferenciaDeBolsa(b) : null;
                    const paso = ultimoPaso(b);
                    const quien = paso.id ? personas.get(paso.id) : null;
                    return (
                        <DataRow key={b.id} index={i} onClick={() => onAbrir?.(b)}>
                            <DataCell>
                                <span className="font-bold text-content tabular-nums">{fechaCorta(b.fecha)}</span>
                                {b.hora && <span className="block text-caption text-content-3">{hora12(b.hora)}</span>}
                            </DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content">{nombreSala[b.branch_id] || '—'}</span>
                                {b.caja && <span className="block text-caption text-content-3 truncate">{b.caja}</span>}
                            </DataCell>
                            {verMontos && (
                                <DataCell align="right">
                                    <span className={`font-bold tabular-nums ${b.estado === 'ANULADA' ? 'text-content-3 line-through' : 'text-content'}`}>
                                        {formatMoney(saldoDeBolsa(b))}
                                    </span>
                                </DataCell>
                            )}
                            {verMontos && (
                                <DataCell align="center">
                                    <Diferencia valor={difDelCorte(b)} resuelta={!!estadoDelCorte(b) && !corteSinResolver(b)} />
                                    {estadoDelCorte(b) && (
                                        <span className={`block text-caption ${corteSinResolver(b) ? 'text-danger-text' : 'text-content-3'}`}>
                                            {ESTADO_DIFERENCIA_ROTULO[estadoDelCorte(b)]?.label}
                                        </span>
                                    )}
                                </DataCell>
                            )}
                            {verMontos && (
                                <DataCell align="center">
                                    <Diferencia valor={dif} resuelta={!!b.dif_at} />
                                    {dif != null && Math.abs(dif) >= 0.01 && (
                                        <span className={`block text-caption ${b.dif_at ? 'text-content-3' : 'text-danger-text'}`}>
                                            {b.dif_at ? 'Resuelto' : 'Sin resolver'}
                                        </span>
                                    )}
                                </DataCell>
                            )}
                            <DataCell>
                                <Badge variant={est.variant} size="sm" dot className="whitespace-nowrap">{est.label}</Badge>
                            </DataCell>
                            <DataCell>
                                {quien ? (
                                    <span className="flex items-center gap-1.5 min-w-0">
                                        <AvatarConEstado emp={quien} px={20} marco="" />
                                        <span className="text-caption text-content-3 truncate">
                                            {paso.verbo} {shortEmployeeName(quien)}{paso.at ? ` · ${sello(paso.at)}` : ''}
                                        </span>
                                    </span>
                                ) : <span className="text-content-3">—</span>}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </section>
    );
}
