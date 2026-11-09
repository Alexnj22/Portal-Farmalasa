// Partir un renglón de la factura en varios productos (2026-11-09): el pack de
// dos productos distintos que el proveedor factura en uno, o el «2 PACK» que
// aquí se separa y se carga por unidad.

import { useState } from 'react';
import { Split, Plus, X } from 'lucide-react';
import Button from '../../components/common/Button';
import Checkbox from '../../components/common/Checkbox';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import { guardarParticion } from '@nucleo/data/cargarCompra';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { BuscadorProducto } from './CargarCompraPiezas';

/** El costo repartido según las unidades; el último se queda con el redondeo. */
const parejo = (filas) => {
    const total = filas.reduce((a, f) => a + (Number(f.unidades) || 0), 0);
    if (!(total > 0)) return filas;
    let queda = 100;
    return filas.map((f, k) => {
        if (k === filas.length - 1) return { ...f, porcentaje: String(Math.round(queda * 100) / 100) };
        const pct = Math.round((Number(f.unidades) || 0) / total * 10000) / 100;
        queda -= pct;
        return { ...f, porcentaje: String(pct) };
    });
};
const FILA = { producto: null, unidades: '1', porcentaje: '' };

export default function PartirRenglon({ renglon, partesActuales, llave, emisorNit, documentId, proveedor, onCerrar, onGuardado }) {
    const yaPartido = partesActuales.length > 0;
    const [filas, setFilas] = useState(() => (yaPartido
        ? partesActuales.map(x => ({ producto: { id: x.parte.product_id, nombre: x.producto }, unidades: String(x.parte.unidades), porcentaje: String(x.parte.porcentaje) }))
        : parejo([{ ...FILA }, { ...FILA }])));
    const [aMano, setAMano] = useState(yaPartido);
    const [recordar, setRecordar] = useState(true);
    const [buscando, setBuscando] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');

    // Lo facturado: de la parte ya repartida se reconstruye el renglón original.
    const facturadas = yaPartido ? Number(partesActuales[0].parte.cantidad_factura) : Number(renglon.cantidad);
    const cobradoDe = (x) => Number(x.cantidad) * Number(x.costo) - Number(x.descuento ?? 0);
    const cobrado = yaPartido ? partesActuales.reduce((a, x) => a + cobradoDe(x), 0) : cobradoDe(renglon);

    const poner = (k, cambio) => setFilas(l => {
        const n = l.map((f, j) => (j === k ? { ...f, ...cambio } : f));
        return aMano ? n : parejo(n);
    });
    const suma = Math.round(filas.reduce((a, f) => a + (Number(f.porcentaje) || 0), 0) * 100) / 100;
    const ids = filas.map(f => f.producto?.id).filter(Boolean);
    const problema = filas.some(f => !f.producto) ? 'Elige el producto de cada parte.'
        : new Set(ids).size !== ids.length ? 'El mismo producto está dos veces: súmalo en una sola parte.'
        : filas.some(f => !Number.isInteger(Number(f.unidades)) || Number(f.unidades) < 1) ? 'Las unidades tienen que ser números enteros.'
        : filas.length === 1 && Number(filas[0].unidades) < 2 ? 'Con un solo producto de 1 unidad no hay nada que partir.'
        : filas.some(f => !(Number(f.porcentaje) > 0)) ? 'Cada parte tiene que llevar algo del costo.'
        : suma !== 100 ? `El costo tiene que sumar 100 % y va en ${suma} %.` : null;

    const guardar = async (partes) => {
        setGuardando(true); setError('');
        const { error: e } = await guardarParticion({
            emisorNit, llave, partes, documentId: recordar ? null : documentId,
            contexto: { proveedor, descripcion: renglon.descripcion, documento: documentId },
        });
        setGuardando(false);
        if (e) { setError(e); return; }
        onGuardado();
    };
    const confirmarPartes = () => guardar(filas.map(f => ({
        product_id: f.producto.id, unidades: Number(f.unidades), porcentaje: Number(f.porcentaje),
    })));

    return (
        <LiquidModal open onClose={() => !guardando && onCerrar()} maxWidth="max-w-2xl" ariaLabel="Partir renglón">
            <LiquidModal.Header titulo="Partir renglón" subtitulo={renglon.descripcion} icono={Split} onClose={() => !guardando && onCerrar()} />
            <LiquidModal.Body>
                <p className="text-label text-content-2 tabular-nums">
                    La factura cobra {facturadas} × {formatMoney(cobrado / (facturadas || 1))} = <b>{formatMoney(cobrado)}</b>. Di qué trae cada una que factura el proveedor.
                </p>
                <div className="mt-4 space-y-3">
                    {filas.map((f, k) => {
                        const entran = facturadas * (Number(f.unidades) || 0);
                        const costo = entran > 0 ? cobrado * (Number(f.porcentaje) || 0) / 100 / entran : 0;
                        return (
                            <div key={k} data-surface="card" className="p-3">
                                <div className="flex items-center gap-2">
                                    <p className={`flex-1 min-w-0 text-body font-black ${f.producto ? 'text-content' : 'text-content-3'}`}>
                                        {f.producto?.nombre ?? 'Sin producto'}
                                    </p>
                                    <Button size="xs" variant="ghost" onClick={() => setBuscando(buscando === k ? null : k)}>
                                        {f.producto ? 'Cambiar' : 'Elegir producto'}
                                    </Button>
                                    {filas.length > 1 && (
                                        <Button size="xs" variant="ghost" icon={X} aria-label="Quitar esta parte"
                                            onClick={() => { setBuscando(null); setFilas(l => { const n = l.filter((_, j) => j !== k); return aMano ? n : parejo(n); }); }} />
                                    )}
                                </div>
                                {buscando === k && (
                                    <BuscadorProducto onCancelar={() => setBuscando(null)}
                                        onElegir={(p) => { poner(k, { producto: { id: p.id, nombre: p.nombre } }); setBuscando(null); }} />
                                )}
                                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                                    <PortalInput compact labelDenso label="Unidades por cada una" inputMode="numeric" value={f.unidades}
                                        onChange={e => poner(k, { unidades: e.target.value.replace(/[^\d]/g, '') })} />
                                    <PortalInput compact labelDenso label="% del costo" inputMode="decimal" value={f.porcentaje}
                                        onChange={e => { setAMano(true); setFilas(l => l.map((x, j) => (j === k ? { ...x, porcentaje: e.target.value.replace(/[^\d.]/g, '') } : x))); }} />
                                    <p className="col-span-2 sm:col-span-1 text-caption text-content-2 tabular-nums">
                                        Entran <b>{entran}</b> a {formatMoney(costo)}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {filas.length < 6 && (
                        <Button size="xs" variant="ghost" icon={Plus} onClick={() => setFilas(l => { const n = [...l, { ...FILA }]; return aMano ? n : parejo(n); })}>
                            Otro producto
                        </Button>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => { setAMano(false); setFilas(parejo); }}>Repartir parejo</Button>
                </div>
                {documentId != null && (
                    <div className="mt-4">
                        <Checkbox size="sm" label="Recordar para las próximas facturas de este producto" checked={recordar} onChange={() => setRecordar(r => !r)} />
                    </div>
                )}
                {problema && <p className="mt-3 text-caption font-bold text-warning-text">{problema}</p>}
                {error && <Notice variant="danger" className="mt-3">{error}</Notice>}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center gap-2 w-full flex-wrap">
                    {yaPartido && (
                        <Button variant="ghost" loading={guardando} onClick={() => guardar([])}>Dejar entero</Button>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        <Button variant="ghost" disabled={guardando} onClick={onCerrar}>Cancelar</Button>
                        <Button loading={guardando} disabled={!!problema} onClick={confirmarPartes}>Guardar</Button>
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
