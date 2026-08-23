import React, { useState } from 'react';
import { Plus, X, FlaskConical } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { Campo, CajaFecha } from './camposDeConteo';
import {
    searchActiveProductsForConteo, fetchProductPresentacionesForConteo,
    fetchErpSucursalIdsForBranch, fetchInventoryLotesForProduct,
} from '../../data/conteoInventario';

/**
 * Alta manual de un producto (o de un lote) dentro de un conteo en curso.
 *
 * Sale de `ConteoDetailView` el 2026-08-23 por peso, no por orden: son 162
 * líneas que sólo existen cuando alguien toca «Agregar», y viajaban en el
 * paquete de una pantalla que se abre de pie frente a un anaquel. El
 * `bundle-gate` lo vio — la vista quedó 1 kB sobre su techo al plegar el
 * encabezado, y éste era el bulto más fácil de sacar sin tocar nada que se use.
 *
 * Se carga con `lazy` + `Suspense` y montado SÓLO mientras está abierto: si se
 * montara siempre, `lazy` bajaría su trozo al entrar y no habría diferido nada.
 */

export default function AddManualItemForm({ branchId, onAdd, onCancel, simple = false }) {
    const { showToast } = useToastStore();
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState(null);
    const [presentacionOpts, setPresentacionOpts] = useState([]);
    const [presentacion, setPresentacion] = useState('');
    const [loteOpts, setLoteOpts] = useState([]);
    const [lote, setLote] = useState('');
    const [loteOtro, setLoteOtro] = useState('');
    const [fechaVencimiento, setFechaVencimiento] = useState('');
    const [saving, setSaving] = useState(false);

    // Antes se filtraban los productos ya presentes en el conteo, lo que hacía
    // imposible el caso más común de una farmacia: el snapshot trae el lote A y
    // en el anaquel aparece también el B. El duplicado real es
    // (producto, presentación, lote), y ahora lo rechaza agregar_item_conteo.
    const handleSearch = async (q) => {
        if (!q || q.trim().length < 2) { setResults([]); return; }
        const { data, error } = await searchActiveProductsForConteo(q.trim());
        if (error) console.error('handleSearch: product search failed:', error.message);
        setResults(data || []);
    };

    const handleSelectProduct = async (val) => {
        const found = results.find((p) => String(p.id) === val) || null;
        setSelected(found);
        setPresentacion('');
        setLote('');
        setLoteOtro('');
        setFechaVencimiento('');
        setPresentacionOpts([]);
        setLoteOpts([]);
        if (!found) return;

        const [{ data: precios, error: preciosErr }, { data: erpMap, error: erpMapErr }] = await Promise.all([
            fetchProductPresentacionesForConteo(found.id),
            fetchErpSucursalIdsForBranch(branchId),
        ]);
        if (preciosErr) console.error('handleSelectProduct: fetch product_precios failed:', preciosErr.message);
        if (erpMapErr) console.error('handleSelectProduct: fetch erp_sucursal_map failed:', erpMapErr.message);
        const tipos = [...new Set((precios || []).map((p) => p.presentaciones?.tipo).filter(Boolean))];
        setPresentacionOpts(tipos.map((t) => ({ value: t, label: t })));

        // Los lotes solo se piden si el conteo los lleva: en sencillo esta
        // consulta no alimentaría ningún campo.
        const erpIds = (erpMap || []).map((m) => m.erp_sucursal_id);
        if (erpIds.length && !simple) {
            const { data: lotes, error: lotesErr } = await fetchInventoryLotesForProduct(found.id, erpIds);
            if (lotesErr) console.error('handleSelectProduct: fetch lotes failed:', lotesErr.message);
            const seen = new Map();
            (lotes || []).forEach((l) => { if (!seen.has(l.lote)) seen.set(l.lote, l.fecha_vencimiento); });
            setLoteOpts(Array.from(seen.entries()).map(([value, fecha]) => ({ value, fecha })));
        }
    };

    const handleSelectLote = (val) => {
        setLote(val);
        if (val === '__OTRO__') { setFechaVencimiento(''); return; }
        const match = loteOpts.find((l) => l.value === val);
        setFechaVencimiento(match?.fecha || '');
    };

    const finalLote = lote === '__OTRO__' ? loteOtro.trim() : lote;
    const canSubmit = selected && presentacion && (simple || finalLote);

    // El costo ya no lo manda el cliente: lo pone agregar_item_conteo con el
    // mismo criterio que el snapshot (costo de la presentación de la línea).
    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            await onAdd({
                erpProductId: selected.id,
                presentacion,
                lote: simple ? null : finalLote,
                fechaVencimiento: simple ? null : (fechaVencimiento || null),
            });
            showToast('Producto agregado', selected.nombre, 'success');
        } catch (err) {
            showToast('No se agregó el producto', mensajeAmigable(err), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-chart-9/10 border border-chart-9/30 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <p className="text-label font-black uppercase tracking-widest text-chart-9-text flex items-center gap-1.5"><FlaskConical size={12} /> Producto no listado en el snapshot</p>
                <Button variant="ghost" icon={X} iconOnly onClick={onCancel} />
            </div>
            <div className="md:w-2/3">
                <Campo label="Producto">
                    <LiquidSelect value={selected ? String(selected.id) : null} onChange={handleSelectProduct} options={results.map((p) => ({ value: String(p.id), label: `${p.nombre}${p.laboratorios?.nombre ? ` · ${p.laboratorios.nombre}` : ''}` }))} placeholder="Buscar producto..." serverSearch onSearchChange={handleSearch} />
                </Campo>
            </div>

            {/* Los cuatro campos del renglón en UNA fila. El vencimiento vivía en
                una fila aparte junto al botón, así que la fecha quedaba desalineada
                de los campos a los que pertenece y el botón parecía parte del
                formulario en vez de su cierre. Las columnas son literales y no
                calculadas: Tailwind escanea el fuente (`grid-cols-${n}` no
                existiría en el CSS). */}
            {/* En un conteo sencillo el renglón se identifica con producto y
                presentación: los otros tres campos no describen nada que este
                conteo guarde, así que no se muestran deshabilitados —se van—. */}
            <div className={`grid grid-cols-1 gap-2 ${simple ? 'md:grid-cols-2' : lote === '__OTRO__' ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                <Campo label="Presentación">
                    <LiquidSelect value={presentacion || null} onChange={setPresentacion} options={presentacionOpts} placeholder={selected ? 'Presentación...' : 'Elige un producto primero'} disabled={!selected} clearable={false} ariaLabel="Presentación" />
                </Campo>
                {!simple && (
                    <Campo label="Lote">
                        <LiquidSelect
                            value={lote || null}
                            onChange={handleSelectLote}
                            options={[...loteOpts.map((l) => ({ value: l.value, label: l.value })), { value: '__OTRO__', label: '+ Otro lote (nuevo)' }]}
                            placeholder={selected ? 'Lote...' : 'Elige un producto primero'}
                            disabled={!selected}
                            clearable={false}
                            ariaLabel="Lote"
                        />
                    </Campo>
                )}
                {!simple && lote === '__OTRO__' && (
                    <Campo label="Número de lote">
                        <PortalInput
                            aria-label="Número de lote nuevo"
                            value={loteOtro}
                            onChange={(e) => setLoteOtro(e.target.value)}
                            placeholder="Ej. A-1234"
                            inputClassName="text-body-xl"
                        />
                    </Campo>
                )}
                {/* Un lote que ya existe en el ERP trae su vencimiento: se muestra
                    pero no se edita, porque cambiarlo acá no cambiaría el del ERP.
                    `aria-disabled` + `title` para que no sea solo un gris. */}
                {!simple && (
                    <Campo label={lote === '__OTRO__' ? 'Vencimiento' : 'Vencimiento (del lote)'}>
                        <CajaFecha
                            inerte={lote !== '__OTRO__'}
                            titulo={lote !== '__OTRO__' ? 'El vencimiento lo trae el lote' : undefined}
                        >
                            <LiquidDatePicker value={fechaVencimiento} onChange={setFechaVencimiento} />
                        </CajaFecha>
                    </Campo>
                )}
            </div>

            {/* El botón cierra el formulario, no es uno de sus campos: fila propia,
                a la derecha. Y el ícono va por la prop `icon`, no como hijo — como
                hijo entra al mismo <span> que el texto y el botón se partía en dos
                renglones ("+" arriba, "Agregar al conteo" abajo). */}
            <div className="flex justify-end">
                <Button tone="chart-9" icon={Plus} loading={saving} disabled={!canSubmit || saving} onClick={handleSubmit}>
                    Agregar al conteo
                </Button>
            </div>
        </div>
    );
}
