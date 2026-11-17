import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Package } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import SegmentedControl from '../../components/common/SegmentedControl';
import Notice from '../../components/common/Notice';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12, fechaHora12 } from '@nucleo/utils/hora';
import { exportCsv } from '@nucleo/utils/csvExport';
import { diferenciaDeBolsa, saldoDeBolsa, contadoDeBolsa } from '@nucleo/utils/bolsasReparto';
import { fetchBolsas, fetchSaldos, fetchPersonasDeBolsas } from '@nucleo/data/bolsas';

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
 * mismo detalle que el resto del módulo. Sólo para alcance de todas las
 * sucursales (`soloAdmin`), que es lo que pidió el usuario. */

const ESTADOS = {
    ABIERTA:   { label: 'En la sucursal',      variant: 'info' },
    ENTREGADA: { label: 'Esperando recepción', variant: 'warning' },
    RECIBIDA:  { label: 'Por contar',          variant: 'warning' },
    CONTADA:   { label: 'Contada',             variant: 'success' },
    ANULADA:   { label: 'Anulada',             variant: 'neutral' },
};
const ORDEN_ESTADO = { ABIERTA: 0, ENTREGADA: 1, RECIBIDA: 2, CONTADA: 3, ANULADA: 4 };

const FILTROS = [
    { value: '',          label: 'Todas' },
    { value: 'pendiente', label: 'Pendientes' },
    { value: 'CONTADA',   label: 'Contadas' },
    { value: 'dif',       label: 'Con diferencia' },
    { value: 'ANULADA',   label: 'Anuladas' },
];

const fechaCorta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short' }) : '');
const sello = (iso) => (iso ? fechaHora12(iso, { day: '2-digit', month: 'short' }) : '');

/** El último paso de la bolsa: quién la tiene o quién la cerró. */
function ultimoPaso(b) {
    if (b.estado === 'CONTADA')   return { verbo: 'Contó', id: b.contado_por, at: b.contado_at };
    if (b.estado === 'RECIBIDA')  return { verbo: 'Recibió', id: b.recibida_por, at: b.recibida_at };
    if (b.estado === 'ENTREGADA') return { verbo: 'Entregó', id: b.entregada_por, at: b.entregada_at };
    return { verbo: 'Guardó', id: b.cerrada_por, at: b.cerrada_at };
}

const PAGINA = 200;

export default function TodasLasBolsas({
    desde, hasta, sala, busqueda = '', nombreSala = {}, verMontos, onAbrir, version,
}) {
    const [bolsas, setBolsas] = useState(null);
    const [error, setError] = useState(false);
    const [personas, setPersonas] = useState(() => new Map());
    const [filtro, setFiltro] = useState('');
    const [orden, setOrden] = useState({ key: 'fecha', dir: 'desc' });
    const [mostrar, setMostrar] = useState(PAGINA);

    // Gana la lectura más nueva: el período y el refresco del módulo pueden
    // cruzarse, y la vieja no puede pisar a la nueva.
    const lecturaRef = useRef(0);
    const cargar = useCallback(async ({ silencioso = false } = {}) => {
        const esta = ++lecturaRef.current;
        if (!silencioso) setBolsas(null);
        const filas = await fetchBolsas({ desde, hasta, estados: [] });
        if (esta !== lecturaRef.current) return;
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

    useEffect(() => { cargar(); setMostrar(PAGINA); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al entrar y al mover el período
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

    const conDif = useCallback((b) => b.estado === 'CONTADA' && Math.abs(diferenciaDeBolsa(b) || 0) >= 0.01, []);

    const visibles = useMemo(() => {
        const f = delAlcance.filter((b) => {
            if (!filtro) return true;
            if (filtro === 'pendiente') return ['ABIERTA', 'ENTREGADA', 'RECIBIDA'].includes(b.estado);
            if (filtro === 'dif') return conDif(b);
            return b.estado === filtro;
        });
        const s = orden.dir === 'asc' ? 1 : -1;
        const cmp = {
            fecha: (a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora).localeCompare(String(b.hora)),
            sala: (a, b) => String(nombreSala[a.branch_id] || '').localeCompare(String(nombreSala[b.branch_id] || ''), 'es'),
            monto: (a, b) => saldoDeBolsa(a) - saldoDeBolsa(b),
            dif: (a, b) => (diferenciaDeBolsa(a) ?? 0) - (diferenciaDeBolsa(b) ?? 0),
            estado: (a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado],
        }[orden.key];
        return [...f].sort((a, b) => s * cmp(a, b) || String(b.fecha).localeCompare(String(a.fecha)));
    }, [delAlcance, filtro, orden, nombreSala, conDif]);

    // Las cifras del rango. Las anuladas no suman: no son dinero.
    const resumen = useMemo(() => {
        const vivas = delAlcance.filter((b) => b.estado !== 'ANULADA');
        const contadas = vivas.filter((b) => b.estado === 'CONTADA');
        const pendientes = vivas.filter((b) => b.estado !== 'CONTADA');
        const neto = contadas.reduce((a, b) => a + (diferenciaDeBolsa(b) || 0), 0);
        return {
            cuantas: vivas.length,
            monto: vivas.reduce((a, b) => a + saldoDeBolsa(b), 0),
            pendientes: pendientes.length,
            montoPendiente: pendientes.reduce((a, b) => a + saldoDeBolsa(b), 0),
            contadas: contadas.length,
            contado: contadas.reduce((a, b) => a + (Number(contadoDeBolsa(b)) || 0), 0),
            conDif: contadas.filter(conDif).length,
            neto: Math.round(neto * 100) / 100,
        };
    }, [delAlcance, conDif]);

    const exportar = () => {
        const encabezado = ['Fecha', 'Hora', 'Sucursal', 'Folio', 'Caja', 'Estado',
            ...(verMontos ? ['Guardado', 'En la bolsa', 'Contado', 'Diferencia'] : []),
            'Causa de la diferencia', 'Guardó', 'Entregó', 'Recibió', 'Contó', 'Contada el'];
        const filas = visibles.map((b) => {
            const dif = diferenciaDeBolsa(b);
            return [
                b.fecha, b.hora ? hora12(b.hora) : '', nombreSala[b.branch_id] || '', b.folio || '', b.caja || '',
                ESTADOS[b.estado]?.label || b.estado,
                ...(verMontos ? [
                    Number(b.monto_inicial || 0).toFixed(2), saldoDeBolsa(b).toFixed(2),
                    b.estado === 'CONTADA' && contadoDeBolsa(b) != null ? Number(contadoDeBolsa(b)).toFixed(2) : '',
                    b.estado === 'CONTADA' && dif != null ? dif.toFixed(2) : '',
                ] : []),
                b.dif_causa || '', nombre(b.cerrada_por), nombre(b.entregada_por),
                nombre(b.recibida_por), nombre(b.contado_por), b.contado_at ? sello(b.contado_at) : '',
            ];
        });
        exportCsv(encabezado, filas, `bolsas_${desde}_a_${hasta}.csv`, 'bolsas');
    };

    const columnas = [
        { key: 'fecha', label: 'Fecha', sortable: true },
        { key: 'sala', label: 'Sucursal', sortable: true },
        { key: 'folio', label: 'Folio', hideBelow: 'md' },
        ...(verMontos ? [
            { key: 'monto', label: 'En la bolsa', align: 'right', sortable: true },
            { key: 'dif', label: 'Diferencia', align: 'right', sortable: true, hideBelow: 'lg' },
        ] : []),
        { key: 'estado', label: 'Estado', sortable: true },
        { key: 'paso', label: 'Último paso', hideBelow: 'lg' },
    ];

    const onSort = (key) => setOrden((o) => ({ key, dir: o.key === key && o.dir === 'desc' ? 'asc' : 'desc' }));
    const cuantasPorFiltro = (v) => {
        if (!v) return delAlcance.length;
        if (v === 'pendiente') return delAlcance.filter((b) => ['ABIERTA', 'ENTREGADA', 'RECIBIDA'].includes(b.estado)).length;
        if (v === 'dif') return delAlcance.filter(conDif).length;
        return delAlcance.filter((b) => b.estado === v).length;
    };

    return (
        <section className="space-y-4">
            {verMontos && bolsas && (
                <CarrilCards ariaLabel="Resumen de las bolsas del período">
                    <StatCard icon={Package} label="Bolsas" value={resumen.cuantas}
                        sub={formatMoney(resumen.monto)} />
                    <StatCard label="Pendientes" value={resumen.pendientes}
                        sub={formatMoney(resumen.montoPendiente)}
                        onClick={resumen.pendientes ? () => setFiltro('pendiente') : undefined} />
                    <StatCard label="Contadas" value={resumen.contadas} sub={formatMoney(resumen.contado)}
                        onClick={resumen.contadas ? () => setFiltro('CONTADA') : undefined} />
                    <StatCard label="Diferencia neta" value={formatMoney(resumen.neto)}
                        valueCls={resumen.neto < 0 ? 'text-danger-text' : resumen.neto > 0 ? 'text-warning-text' : 'text-content'}
                        sub={`${resumen.conDif} con diferencia`}
                        onClick={resumen.conDif ? () => setFiltro('dif') : undefined} />
                </CarrilCards>
            )}

            {error && (
                <Notice variant="danger">No se pudieron cargar todas las bolsas. Recarga la página.</Notice>
            )}

            <DataTable
                columns={columnas}
                sortKey={orden.key} sortDir={orden.dir} onSort={onSort}
                loading={bolsas === null}
                minWidth="720px"
                movil={{ usarAccionDeFila: true }}
                empty={{ icon: Package, message: 'No hay bolsas en estas fechas' }}
                toolbar={(
                    <div className="w-full flex items-center justify-between gap-3 flex-wrap">
                        <SegmentedControl size="sm" label="Mostrar"
                            options={FILTROS.map((f) => ({ ...f, label: `${f.label} (${cuantasPorFiltro(f.value)})` }))}
                            value={filtro} onChange={(v) => { setFiltro(v); setMostrar(PAGINA); }} />
                        <Button variant="secondary" size="sm" icon={Download}
                            disabled={!visibles.length} onClick={exportar}>
                            Descargar
                        </Button>
                    </div>
                )}
                footer={visibles.length > mostrar ? (
                    <div className="flex justify-center py-2">
                        <Button variant="ghost" size="sm" onClick={() => setMostrar((m) => m + PAGINA)}>
                            Ver más ({visibles.length - mostrar} restantes)
                        </Button>
                    </div>
                ) : null}
            >
                {visibles.slice(0, mostrar).map((b, i) => {
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
                                {b.caja && <span className="block text-caption text-content-3">Caja {b.caja}</span>}
                            </DataCell>
                            <DataCell><span className="font-mono text-caption text-content-2">{b.folio}</span></DataCell>
                            {verMontos && (
                                <DataCell align="right">
                                    <span className={`font-bold tabular-nums ${b.estado === 'ANULADA' ? 'text-content-3 line-through' : 'text-content'}`}>
                                        {formatMoney(saldoDeBolsa(b))}
                                    </span>
                                </DataCell>
                            )}
                            {verMontos && (
                                <DataCell align="right">
                                    {dif == null ? <span className="text-content-3">—</span>
                                        : Math.abs(dif) < 0.01 ? <span className="text-caption text-success-text">Cuadró</span>
                                            : (
                                                <span className={`font-bold tabular-nums ${dif < 0 ? 'text-danger-text' : 'text-warning-text'}`}>
                                                    {dif < 0 ? 'Faltó ' : 'Sobró '}{formatMoney(Math.abs(dif))}
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
