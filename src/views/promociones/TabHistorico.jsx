import React, { useMemo, useState } from 'react';
import { History, Search, RotateCcw, Copy } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { EmptyState } from '../../components/common/StateViews';
import usePaginaEnUrl from '../../plataforma/usePaginaEnUrl';
import { fmtUnidades, fmtLote, fmtVigencia, rotuloMes, esLaboratorio } from '@nucleo/utils/promocionesUtils';

/**
 * Las promociones terminadas.
 *
 * Acá SÍ es una tabla: una promoción cerrada es un registro histórico y lo que
 * se hace con ella es buscarla, ordenarla y compararla — no leer su avance.
 *
 * Y es el ÚNICO sitio donde una terminada se ve, así que sus acciones viven
 * acá (usuario, 2026-10-01: «si la quiero reactivar, ¿cómo hago?»). Antes la
 * tabla no tenía ninguna: reactivar exigía «Editar», que sólo estaba en las
 * tarjetas de Activas, donde las terminadas no se listan.
 */
export default function TabHistorico({ promos, busqueda, filtrando = false, puedeEditar, onReactivar, onDuplicar, onSeguir }) {
    const [sortKey, setSortKey] = useState('fin');
    const [sortDir, setSortDir] = useState('desc');

    const ordenadas = useMemo(() => {
        const copia = [...promos];
        copia.sort((a, b) => {
            const va = a[sortKey], vb = b[sortKey];
            if (va == null) return 1;
            if (vb == null) return -1;
            const cmp = typeof va === 'number'
                ? va - vb
                : String(va).localeCompare(String(vb), 'es');
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return copia;
    }, [promos, sortKey, sortDir]);

    // La página vive en la DIRECCIÓN: una recarga —y la sesión de sala se cierra
    // sola a los 5 minutos— devolvería a la primera sin decir nada.
    const { page, pageSize, totalPages, setPage, setPageSize } =
        usePaginaEnUrl({ total: ordenadas.length });

    const visibles = useMemo(
        () => ordenadas.slice((page - 1) * pageSize, page * pageSize),
        [ordenadas, page, pageSize],
    );

    const ordenar = (key) => {
        if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDir('desc'); }
    };

    if (!promos.length) {
        return busqueda.trim() || filtrando
            ? <EmptyState icon={Search} title="Sin resultados"
                subtitle={busqueda.trim()
                    ? `Ninguna promoción terminada coincide con "${busqueda.trim()}".`
                    : 'Ninguna promoción terminada coincide con los filtros puestos.'} />
            : <EmptyState icon={History} title="Todavía no hay promociones terminadas"
                subtitle="Cuando una promoción cierre su último producto, se guarda aquí con lo que dejó." />;
    }

    return (
        <div className="space-y-3">
            <DataTable
                columns={[
                    { key: 'nombre',     label: 'Promoción', sortable: true },
                    { key: 'fin',        label: 'Vigencia', sortable: true, hideBelow: 'md' },
                    { key: 'renglones',  label: 'Productos', align: 'right', sortable: true, hideBelow: 'lg' },
                    { key: 'lote_total', label: 'Lote', align: 'right', sortable: true },
                    ...(puedeEditar ? [{ key: 'acciones', label: '', align: 'right' }] : []),
                ]}
                /* Tocar la fila abre su Seguimiento: el vacío prometía que acá
                   se guarda «con lo que dejó», y no había cómo verlo. */
                movil={puedeEditar ? { usarAccionDeFila: true, acciones: true } : { usarAccionDeFila: true }}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={ordenar}
                minWidth="320px"
                empty={{ icon: History, message: 'Sin promociones terminadas' }}
            >
                {visibles.map((p, i) => (
                    <DataRow key={p.id} index={i} onClick={onSeguir ? () => onSeguir(p.id) : undefined}>
                        <DataCell>
                            <span className="font-medium text-content inline-flex items-center gap-1.5">
                                {p.nombre}
                                {esLaboratorio(p) && (
                                    <Badge variant="neutral" size="sm">Laboratorio</Badge>
                                )}
                            </span>
                            {Array.isArray(p.laboratorios) && p.laboratorios.length > 0 && (
                                <span className="block text-micro text-content-3 truncate">
                                    {p.laboratorios.join(' · ')}
                                </span>
                            )}
                        </DataCell>
                        <DataCell hideBelow="md">
                            <span className="text-caption text-content-3 tabular-nums">
                                {esLaboratorio(p) ? rotuloMes(p.year_month) : fmtVigencia(p.inicio, p.fin)}
                            </span>
                        </DataCell>
                        {/* Un guion y no un cero: la de laboratorio no tiene
                            productos ni lote, y un «0» se lee como un dato — la
                            promoción parecería no haber tenido nada. */}
                        <DataCell align="right" hideBelow="lg">
                            {esLaboratorio(p) ? '—' : fmtUnidades(p.renglones)}
                        </DataCell>
                        <DataCell align="right">
                            {esLaboratorio(p) ? '—' : fmtLote(p.lote_total)}
                        </DataCell>
                        {puedeEditar && (
                            <DataCell align="right">
                                <span className="inline-flex items-center gap-1 justify-end">
                                    {/* La de laboratorio vive por MES: no se
                                        «extiende», se crea la del mes siguiente
                                        —duplicándola—. */}
                                    {!esLaboratorio(p) && (
                                        <Button variant="secondary" size="sm" icon={RotateCcw}
                                            onClick={(e) => { e.stopPropagation(); onReactivar?.(p); }}>
                                            Reactivar
                                        </Button>
                                    )}
                                    <Button variant="ghost" size="sm" icon={Copy} iconOnly
                                        title="Duplicar esta promoción"
                                        aria-label={`Duplicar ${p.nombre}`}
                                        onClick={(e) => { e.stopPropagation(); onDuplicar?.(p); }} />
                                </span>
                            </DataCell>
                        )}
                    </DataRow>
                ))}
            </DataTable>

            {/* Hermano suelto del DataTable, nunca envuelto (DESIGN.md §14). */}
            <TablePagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                total={ordenadas.length}
                unit="promociones"
            />
        </div>
    );
}
