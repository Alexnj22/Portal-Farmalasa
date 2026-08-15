// Extracted from TabPedidos.jsx (Bloque 6.C)
import { CircleDot } from 'lucide-react';
import PeriodPicker from '../../../components/common/PeriodPicker';
import { currentMonthRange } from './helpers';
import FilterBar from '../../../components/common/FilterBar';

/**
 * Los cuatro estados de un pedido. Se declaran acá arriba —y no en el JSX— para
 * que la ranura sepa CUÁNTOS son antes de decidir su forma: `FilterBar.Opciones`
 * da segmentado hasta 3 y select de 4 en adelante, y ese umbral se evalúa sobre
 * este arreglo.
 */
const ESTADOS = [
    { value: 'all',         label: 'Todos los estados' },
    { value: 'confirmado',  label: 'Pendientes' },
    { value: 'enviado',     label: 'En ruta' },
    { value: 'observacion', label: 'Con observación' },
    { value: 'completado',  label: 'Completados' },
];

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

            {/* 4 · estado — un SELECT, no cuatro chips (2026-08-15).
                `FilterBar.Chip` promete filtros INDEPENDIENTES: cada uno se
                prende y se apaga por su cuenta y varios pueden convivir. Acá era
                mentira — `setFilterStatus` guarda UN valor, así que elegir
                «En ruta» apagaba «Pendientes» sin que nada lo anunciara. Un
                `aria-pressed` por chip le dice al lector de pantalla que hay
                cuatro interruptores donde hay una sola decisión.
                Es una-de-N, y de eso se encarga `FilterBar.Opciones`: con cinco
                opciones da `LiquidSelect` solo (§15.3, umbral 3). De paso
                devuelve el ancho de cuatro píldoras a las otras ranuras. */}
            <FilterBar.Section active={filterStatus !== 'all'} onClear={() => setFilterStatus('all')} label="estado">
                <FilterBar.Opciones
                    label="Estado" icon={CircleDot}
                    value={filterStatus}
                    onChange={v => setFilterStatus(v || 'all')}
                    options={ESTADOS}
                    placeholder="Todos los estados"
                    ancho="180px"
                />
            </FilterBar.Section>
        </FilterBar>
    );
}
