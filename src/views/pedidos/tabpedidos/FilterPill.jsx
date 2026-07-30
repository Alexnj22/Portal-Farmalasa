// Extracted from TabPedidos.jsx (Bloque 6.C)
import PeriodPicker from '../../../components/common/PeriodPicker';
import { currentMonthRange } from './helpers';
import FilterBar from '../../../components/common/FilterBar';

/**
 * Los filtros de Pedidos. Desde el 2026-07-30 es un `FilterBar` de verdad.
 *
 * Este archivo era el ÚLTIMO resto del `FilterPill` original —el que §17 dice
 * haber reemplazado— y seguía reconstruyendo el contenedor a mano: su propio
 * `h-14 rounded-2xl border bg-surface-card`, sus propios divisores y un botón de
 * limpiar por ranura. O sea que se veía distinto al resto del portal y no tenía
 * nada de lo que el canónico trae solo: el orden de ranuras, el colapso a barra
 * flotante en el teléfono, el cupo de ranuras por ancho ni el control de
 * desborde.
 *
 * El nombre del archivo se conserva porque lo importa `TabPedidos`; lo que hay
 * adentro ya no es una píldora a mano.
 */
export default function FilterPill({ isBranch, filterSuc, setFilterSuc, filterStatus, setFilterStatus, filterOptions, filterDate, setFilterDate }) {
    const defaultDate = currentMonthRange();
    const dateDirty   = filterDate !== defaultDate;
    const clearAll    = () => { setFilterSuc(''); setFilterStatus('all'); setFilterDate(defaultDate); };
    const activos     = [!isBranch && filterSuc !== '', filterStatus !== 'all', dateDirty].filter(Boolean).length;

    // `FilterBar.Chip` es EXACTAMENTE esto: se apaga al volver a pulsarlo,
    // lleva `aria-pressed` y ya dibuja la × cuando está activo.
    const chipEstado = (key, label, tone = 'brand') => (
        <FilterBar.Chip
            tone={tone}
            active={filterStatus === key}
            onToggle={() => setFilterStatus(v => v === key ? 'all' : key)}
        >
            {label}
        </FilterBar.Chip>
    );

    return (
        <FilterBar onClear={clearAll} activeCount={activos} title="Filtros de pedidos">
            {/* 1 · ámbito */}
            {!isBranch && (
                <FilterBar.Section active={filterSuc !== ''} onClear={() => setFilterSuc('')} label="sucursal">
                    <FilterBar.Sucursal value={filterSuc} onChange={v => setFilterSuc(v)} options={filterOptions} />
                </FilterBar.Section>
            )}

            {/* 3 · tiempo */}
            <FilterBar.Section active={dateDirty} onClear={() => setFilterDate(defaultDate)} label="período">
                <PeriodPicker value={filterDate} onChange={setFilterDate} />
            </FilterBar.Section>

            {/* 4 · estado */}
            <FilterBar.Section active={filterStatus !== 'all'} onClear={() => setFilterStatus('all')} label="estado">
                {chipEstado('confirmado',  'Pendientes')}
                {chipEstado('enviado',     'En ruta')}
                {chipEstado('observacion', 'Con observación', 'warning')}
                {chipEstado('completado',  'Completados',     'success')}
            </FilterBar.Section>
        </FilterBar>
    );
}
