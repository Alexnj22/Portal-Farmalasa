import React, { useMemo, useState } from 'react';
import { History, Search } from 'lucide-react';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { EmptyState } from '../../components/common/StateViews';
import usePaginaEnUrl from '../../hooks/usePaginaEnUrl';
import { fmtUnidades, fmtVigencia } from './promocionesUtils';

/**
 * Las promociones terminadas.
 *
 * Acá SÍ es una tabla: una promoción cerrada es un registro histórico y lo que
 * se hace con ella es buscarla, ordenarla y compararla — no leer su avance.
 */
export default function TabHistorico({ promos, busqueda }) {
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
        return busqueda.trim()
            ? <EmptyState icon={Search} title="Sin resultados"
                subtitle={`Ninguna promoción terminada coincide con "${busqueda.trim()}".`} />
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
                ]}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={ordenar}
                minWidth="320px"
                empty={{ icon: History, message: 'Sin promociones terminadas' }}
            >
                {visibles.map((p, i) => (
                    <DataRow key={p.id} index={i}>
                        <DataCell>
                            <span className="font-medium text-content">{p.nombre}</span>
                            {Array.isArray(p.laboratorios) && p.laboratorios.length > 0 && (
                                <span className="block text-micro text-content-3 truncate">
                                    {p.laboratorios.join(' · ')}
                                </span>
                            )}
                        </DataCell>
                        <DataCell hideBelow="md">
                            <span className="text-caption text-content-3 tabular-nums">
                                {fmtVigencia(p.inicio, p.fin)}
                            </span>
                        </DataCell>
                        <DataCell align="right" hideBelow="lg">{fmtUnidades(p.renglones)}</DataCell>
                        <DataCell align="right">{fmtUnidades(p.lote_total)}</DataCell>
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
