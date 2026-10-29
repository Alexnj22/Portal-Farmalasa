import React, { useEffect, useMemo, useState } from 'react';
import { Layers, Pill } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fechaTexto } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import {
    TIPO_MOVIMIENTO, enCajas, estadoDeFila, explicarDiferencia, filasDelRegistro, saldoCorrido,
} from '@nucleo/utils/registroAntibioticos';

// ═══════════════════════════════════════════════════════════════════════════
// El registro de antibióticos POR LOTE (Guía SRS 3.3/3.4, CRÍTICOS).
//
// Por sucursal y por mes: cada lote con su saldo inicial, lo que entró, lo que
// salió, lo que debería haber y lo que hay. Al tocar un lote se ven sus
// movimientos uno por uno —fecha, documento, de dónde o a quién, quién— con el
// saldo después de cada uno. Todo en UNIDADES (cápsula, tableta, ampolla): es
// la única medida en la que compras, traslados y ventas suman entre sí.
//
// Un lote sin saldo inicial conocido NO se cuadra: se dice, en vez de inventar
// un cero. Desde el 29-oct hay foto diaria por lote, así que desde noviembre
// todos los lotes tienen base.
// ═══════════════════════════════════════════════════════════════════════════

const fmtNum = (v) => (v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('es-SV', { maximumFractionDigits: 0 }));
const fmtSigno = (v) => (v > 0 ? `+${fmtNum(v)}` : fmtNum(v));
const fmtDia = (f) => fechaTexto(f, { day: 'numeric', month: 'short' }, '—');
const fmtVence = (f) => fechaTexto(f, { month: 'short', year: 'numeric' }, '');

const ESTADO = {
    cuadra: { variant: 'success', label: 'Cuadra' },
    diferencia: { variant: 'danger', label: 'Diferencia' },
    sin_base: { variant: 'neutral', label: 'Sin saldo inicial' },
    sin_lote: { variant: 'warning', label: 'Sin lote' },
};

// Cada fila es un lote y tocarla abre sus movimientos: un destino de verdad.
// La primera celda es un bloque (producto, lote y vencimiento en dos líneas).
const MOVIL = {
    usarAccionDeFila: true, apilada: true,
    identidad: 'lote', ancla: 'diferencia', chips: ['existencia'],
};

/** Una cantidad con su equivalente en cajas debajo, cuando aporta. */
function Cantidad({ u, factor, fuerte = false, tono = '' }) {
    const cajas = enCajas(u, factor);
    return (
        <div className="flex flex-col items-end leading-tight">
            <span className={`tabular-nums ${fuerte ? 'font-bold text-content' : 'text-content-2'} ${tono}`}>{fmtNum(u)}</span>
            {cajas && <span className="text-caption text-content-3 tabular-nums whitespace-nowrap">{cajas}</span>}
        </div>
    );
}

function DetalleLote({ fila, registro, onClose }) {
    const movimientos = useMemo(() => saldoCorrido(fila), [fila]);
    const explicacion = explicarDiferencia(fila);
    const estado = estadoDeFila(fila);
    const cp = fila.cuadre_producto;

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-4xl" ariaLabel={`Lote ${fila.lote}`}>
            <LiquidModal.Header titulo={fila.producto} onClose={onClose}
                subtitulo={<>
                    Lote {fila.lote}{fila.vence ? ` · vence ${fmtVence(fila.vence)}` : ''}
                    {fila.factor_caja > 1 ? ` · caja de ${fila.factor_caja}` : ''}
                </>} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={ESTADO[estado].variant} size="md" uppercase={false}>{ESTADO[estado].label}</Badge>
                        {fila.en_el_libro && <Badge variant="info" size="md" uppercase={false}>Va al libro bajo receta</Badge>}
                        {fila.aproximado && <Badge variant="warning" size="md" uppercase={false}>Reparto aproximado</Badge>}
                        {fila.en_vencidos > 0 && (
                            <Badge variant="warning" size="md" uppercase={false}>{fmtNum(fila.en_vencidos)} en vencidos</Badge>
                        )}
                    </div>

                    {explicacion && (
                        <Notice variant={estado === 'diferencia' ? 'warning' : 'info'} compact>{explicacion}</Notice>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {[
                            ['Saldo inicial', fila.inicial],
                            ['Entradas', fila.entradas],
                            ['Salidas', fila.salidas ? -fila.salidas : 0],
                            ['Debería haber', fila.final_calculado],
                            ['Hay', fila.existencia],
                        ].map(([label, v]) => (
                            <div key={label} className="rounded-lg bg-surface-2 px-3 py-2">
                                <p className="text-caption text-content-3">{label}</p>
                                <Cantidad u={v} factor={fila.factor_caja} fuerte />
                            </div>
                        ))}
                    </div>

                    <DataTable
                        columns={[
                            { key: 'fecha', label: 'Fecha' },
                            { key: 'tipo', label: 'Movimiento' },
                            { key: 'documento', label: 'Documento' },
                            { key: 'quien', label: 'Responsable' },
                            { key: 'unidades', label: 'Unidades', align: 'right' },
                            { key: 'saldo', label: 'Saldo', align: 'right' },
                        ]}
                        minWidth="680px"
                        dense
                        movil={{ identidad: 'tipo', ancla: 'unidades', chips: ['fecha', 'saldo'] }}
                        empty={{ icon: Layers, message: 'Sin movimientos este mes' }}
                    >
                        {movimientos.map((m, i) => (
                            <DataRow key={`${m.fecha}-${m.documento}-${i}`} index={i}>
                                <DataCell><span className="tabular-nums text-content-2">{fmtDia(m.fecha)}</span></DataCell>
                                <DataCell>
                                    <div className="flex flex-col leading-tight">
                                        <span className="text-body-sm font-semibold text-content-2">{TIPO_MOVIMIENTO[m.tipo] ?? m.tipo}</span>
                                        {m.detalle && <span className="text-caption text-content-3">{m.detalle}</span>}
                                    </div>
                                </DataCell>
                                <DataCell><span className="text-caption text-content-2">{m.documento || '—'}</span></DataCell>
                                <DataCell><span className="text-caption text-content-2">{m.responsable || '—'}</span></DataCell>
                                <DataCell align="right">
                                    <span className={`tabular-nums font-semibold ${m.unidades < 0 ? 'text-danger-text' : 'text-success-text'}`}>
                                        {fmtSigno(m.unidades)}{m.aproximado ? '*' : ''}
                                    </span>
                                </DataCell>
                                <DataCell align="right"><span className="tabular-nums text-content-2">{fmtNum(m.saldo)}</span></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>

                    {fila.aproximado && (
                        <p className="text-caption text-content-3">
                            * En ese traslado los lotes anotados no suman lo enviado: la cantidad se repartió entre ellos.
                        </p>
                    )}
                    {cp && (
                        <p className="text-caption text-content-3">
                            El producto entero ({registro?.desde ? `desde el ${fmtDia(registro.desde)}` : 'este mes'}):
                            {' '}inicial {fmtNum(cp.inicial)}, movimientos {fmtSigno(Number(cp.neto))}, hay {fmtNum(cp.existencia)}
                            {cp.diferencia !== null && cp.diferencia !== undefined
                                ? (Number(cp.diferencia) === 0 ? ' — cuadra.' : ` — diferencia ${fmtSigno(Number(cp.diferencia))}.`)
                                : '.'}
                        </p>
                    )}
                </div>
            </LiquidModal.Body>
        </LiquidModal>
    );
}

/**
 * La tabla del registro. La cabecera —el carril, la sala, el mes y la
 * descarga— la pone `BitacorasView` en la fila canónica (§17.0), igual que en
 * las demás pestañas: acá sólo vive lo que se lee debajo.
 *
 * Los números de las tarjetas y los de la tabla salen del MISMO conteo
 * (`contarPorEstado`); antes las tarjetas usaban el resumen del servidor, que
 * no cuenta los lotes «sin lote», y una pantalla decía 87 y la otra 94.
 */
export default function TabRegistroLote({ registro, cargando, error, filtro, busqueda }) {
    const [abierta, setAbierta] = useState(null);

    const filas = useMemo(() => filasDelRegistro(registro), [registro]);
    const visibles = useMemo(() => filas.filter(f => {
        const estado = estadoDeFila(f);
        if (filtro !== 'todos' && estado !== filtro && !(filtro === 'sin_base' && estado === 'sin_lote')) return false;
        return !busqueda || tokenMatch(`${f.producto} ${f.lote}`, busqueda);
    }), [filas, filtro, busqueda]);

    const { page, pageSize, totalPages, setPage, setPageSize, resetPage } =
        usePaginaEnUrl({ total: visibles.length, tamPorDefecto: 50 });
    useEffect(() => { resetPage(); }, [filtro, busqueda, registro]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = visibles.slice((page - 1) * pageSize, page * pageSize);

    // Sin saldo inicial no se cuadra. En el primer mes es porque todavía no
    // había inventario por lote guardado: se cuadra solo desde el siguiente.
    const primerMes = registro?.inicial_de !== 'foto';
    // «Desde nov.»: corto, para que la insignia no parta la columna en tres renglones.
    const desdeCuando = useMemo(() => {
        const [y, m] = String(registro?.desde || '').split('-').map(Number);
        if (!y || !m) return 'Mes siguiente';
        const sig = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
        return `Desde ${fechaTexto(sig, { month: 'short' }, '')}`;
    }, [registro?.desde]);
    const r = registro?.resumen;

    return (
        <div className="space-y-4">
            {error ? (
                <Notice variant="danger">{error}</Notice>
            ) : registro && (primerMes || registro.existencia_de !== 'foto' || r?.sin_lote_unidades > 0) && (
                <Notice variant="info" compact>
                    {primerMes && 'Este es el primer mes del registro: sólo cuadran los lotes que entraron desde el 11 de agosto. Desde el mes siguiente cuadran todos. '}
                    {registro.existencia_de === 'ahora' && '«Hay» es la existencia de este momento. '}
                    {!registro.existencia_de && 'De ese mes no quedó inventario al cierre, así que no se puede comparar. '}
                    {r?.sin_lote_unidades > 0 && `${fmtNum(r.sin_lote_unidades)} unidades entraron sin lote anotado.`}
                </Notice>
            )}

            <DataTable
                columns={[
                    { key: 'lote', label: 'Producto y lote' },
                    { key: 'inicial', label: 'Inicial', align: 'right' },
                    { key: 'entradas', label: 'Entradas', align: 'right' },
                    { key: 'salidas', label: 'Salidas', align: 'right' },
                    { key: 'calculado', label: 'Debería', align: 'right' },
                    { key: 'existencia', label: 'Hay', align: 'right' },
                    { key: 'diferencia', label: 'Diferencia', align: 'right' },
                ]}
                loading={cargando}
                skeletonRows={8}
                minWidth="860px"
                movil={MOVIL}
                empty={{
                    icon: Pill,
                    message: busqueda ? 'Ningún lote coincide con la búsqueda'
                        : filtro === 'diferencia' ? 'Ningún lote con diferencia este mes'
                            : 'Sin lotes que mostrar',
                }}
            >
                {pagina.map((f, i) => {
                    const estado = estadoDeFila(f);
                    return (
                        <DataRow key={f.clave} index={i} onClick={() => setAbierta(f)}>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold text-content">{f.producto}</p>
                                <p className="text-caption text-content-3 flex flex-wrap items-center gap-1.5 mt-0.5">
                                    <span>Lote {f.lote}{f.vence ? ` · vence ${fmtVence(f.vence)}` : ''}</span>
                                    {f.en_el_libro && <Badge variant="info" size="sm">Libro</Badge>}
                                </p>
                            </DataCell>
                            <DataCell align="right"><Cantidad u={f.inicial} factor={f.factor_caja} /></DataCell>
                            <DataCell align="right"><Cantidad u={f.entradas} factor={f.factor_caja} /></DataCell>
                            <DataCell align="right"><Cantidad u={f.salidas} factor={f.factor_caja} /></DataCell>
                            <DataCell align="right"><Cantidad u={f.final_calculado} factor={f.factor_caja} /></DataCell>
                            <DataCell align="right"><Cantidad u={f.existencia} factor={f.factor_caja} fuerte /></DataCell>
                            <DataCell align="right">
                                {estado === 'cuadra' || estado === 'diferencia' ? (
                                    <Badge variant={ESTADO[estado].variant} size="sm">
                                        {estado === 'cuadra' ? 'Cuadra' : fmtSigno(f.diferencia)}
                                    </Badge>
                                ) : (
                                    <Badge variant={ESTADO[estado].variant} size="sm" className="whitespace-nowrap">
                                        {estado === 'sin_lote' ? 'Sin lote' : primerMes ? desdeCuando : 'Sin base'}
                                    </Badge>
                                )}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
            {!cargando && visibles.length > 0 && (
                <TablePagination
                    page={page} totalPages={totalPages} onPageChange={setPage}
                    pageSize={pageSize} onPageSizeChange={setPageSize}
                    total={filas.length} filteredTotal={visibles.length} unit="lotes"
                />
            )}

            {abierta && <DetalleLote fila={abierta} registro={registro} onClose={() => setAbierta(null)} />}
        </div>
    );
}
