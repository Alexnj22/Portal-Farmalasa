import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    ShoppingCart, Loader2, Save, PackageCheck, FileJson, Plus, Trash2, AlertTriangle, CheckCircle2, Ban, Truck, Wand2, Link2,
} from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import useBorrador from '@nucleo/hooks/useBorrador';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { fetchCompra, fetchMemoriaProveedor, guardarCompra, recibirCompra, anularCompra, fetchReferenciasRelacionada } from '@nucleo/data/distribucionCompras';
import {
    TIPOS_COMPRA, totalesCalculados, totalEsperado, subtotalRenglon, problemasDeCompra, leerDteDelProveedor, cambiarUnidadesPor, toleranciaDeCuadre,
    evaluarPrecioRelacionada,
} from './compras';
import ProveedorModal from './ProveedorModal';

// Una compra a proveedor, de la captura a la bodega.
//
// El ERP la carga como una lista de productos y un total escrito a mano, y
// nada impide que no cuadren: la mercadería entra igual y el costo queda mal
// para siempre. Acá se escriben los MONTOS DEL PAPEL (o se leen del JSON del
// proveedor) y los renglones por separado, y la pantalla dice en vivo si
// cuadran —lo mismo que va a exigir la base al recibir—. Sin cuadrar, no entra.
//
// Guardar deja un borrador (la sesión se cierra sola: nada se pierde); RECIBIR
// mueve inventario y costo promedio, y no se deshace: se anula, sólo mientras
// todo lo que entró siga en bodega.

const vacio = () => ({
    client_uuid: crypto.randomUUID(), proveedor_id: '', tipo_doc: '03', numero: '', codigo_generacion: '', fecha: hoySV(),
    condicion: 1, vence: '', gravada: '', exenta: '', iva: '', percepcion: '', retencion: '', total: '', nota: '', items: [],
});
const renglonVacio = () => ({ key: crypto.randomUUID(), product_id: null, cantidad: '', costo_unitario: '', lote: '', vence: '' });
// Los rótulos que no son de un PortalInput, con la misma forma que los de él.
const ROTULO = rotuloCampo();
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const monto = (v) => (v === '' || v === null || v === undefined ? '' : String(v));

function CampoMonto({ label, name, value, onChange, esperado, disabled }) {
    const ok = esperado === undefined || value === '' || Math.abs(num(value) - esperado) <= 0.01;
    return (
        <PortalInput label={label} name={name} inputMode="decimal" value={value} readOnly={disabled}
            onChange={(e) => onChange(e.target.value)} hasError={!ok}
            errorMessage={esperado !== undefined ? `Debería ser ${formatMoney(esperado)}` : undefined} />
    );
}

export default function CompraModal({ compraId = null, emisor, proveedores, catalogo, puedeEditar, onClose, onCambio, onProveedores }) {
    const showToast = useToastStore(s => s.showToast);
    const [c, setC] = useState(() => (compraId ? null : vacio()));
    const [estado, setEstado] = useState(compraId ? null : 'borrador');
    const [detalle, setDetalle] = useState(null);
    const [jsonCrudo, setJsonCrudo] = useState(null);
    const [emisorDelJson, setEmisorDelJson] = useState(null);
    const [altaProveedor, setAltaProveedor] = useState(null);
    const [ocupado, setOcupado] = useState('');
    const [error, setError] = useState('');
    const [motivo, setMotivo] = useState('');
    const [anulando, setAnulando] = useState(false);
    const archivo = useRef(null);
    const editable = puedeEditar && estado === 'borrador';

    // Una compra nueva se guarda sola en el navegador mientras se captura.
    const { recuperado, descartar } = useBorrador(!compraId && emisor ? `distribucion-compra-nueva-${emisor.id}` : null, c,
        { vale: (v) => !!(v?.numero || v?.items?.length) });
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado || compraId) return;
        repuesto.current = true;
        setC({ ...vacio(), ...recuperado });
    }, [recuperado, compraId]);

    useEffect(() => {
        if (!compraId) return undefined;
        let vivo = true;
        fetchCompra(compraId).then(d => {
            if (!vivo) return;
            setDetalle(d);
            setEstado(d.estado);
            setC({
                id: d.id, client_uuid: d.client_uuid, proveedor_id: String(d.proveedor_id), tipo_doc: d.tipo_doc, numero: d.numero,
                codigo_generacion: d.codigo_generacion ?? '', fecha: d.fecha, condicion: d.condicion, vence: d.vence ?? '',
                gravada: monto(d.gravada), exenta: monto(d.exenta), iva: monto(d.iva), percepcion: monto(d.percepcion),
                retencion: monto(d.retencion), total: monto(d.total), nota: d.nota ?? '',
                items: (d.dist_compra_items ?? []).sort((a, b) => a.id - b.id).map(i => ({
                    key: String(i.id), product_id: i.product_id, codigo_proveedor: i.codigo_proveedor, descripcion_proveedor: i.descripcion_proveedor,
                    cantidad: String(i.cantidad), costo_unitario: String(Number(i.costo_unitario)), lote: i.lote ?? '', vence: i.vence ?? '',
                    lote_id: i.lote_id, nombre: i.products?.nombre,
                })),
            });
        }).catch(e => { if (vivo) setError(mensajeDeDistribucion(e)); });
        return () => { vivo = false; };
    }, [compraId]);

    const provId = c?.proveedor_id ?? '';
    const proveedor = proveedores.find(p => String(p.id) === String(provId));

    const set = (k) => (v) => setC(x => ({ ...x, [k]: v }));
    const setItem = (i, cambios) => setC(x => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...cambios } : it)) }));

    // Al crédito, el vencimiento sale del plazo del proveedor si nadie lo escribió.
    useEffect(() => {
        if (!editable || !c || Number(c.condicion) !== 2 || c.vence || !proveedor?.plazo_dias || !c.fecha) return;
        setC(x => ({ ...x, vence: sumarDias(x.fecha, proveedor.plazo_dias) }));
    }, [editable, c?.condicion, c?.fecha, proveedor?.plazo_dias]); // eslint-disable-line react-hooks/exhaustive-deps

    const opcionesProducto = useMemo(() => catalogo.map(p => ({ value: String(p.product_id), label: p.nombre })), [catalogo]);
    const opcionesProveedor = useMemo(() => proveedores.filter(p => p.activo || String(p.id) === String(provId))
        .map(p => ({ value: String(p.id), label: p.nombre, sublabel: p.nit ? `NIT ${p.nit}` : undefined })), [proveedores, provId]);

    const calc = useMemo(() => (c ? totalesCalculados(c.items, c.tipo_doc) : { productos: 0, iva: 0 }), [c]);

    // ── Parte relacionada: el precio tiene que ser el de mercado (0022) ──
    // Avisa por renglón; no bloquea. En una Factura el costo trae el IVA, así
    // que se compara sin él.
    const [refs, setRefs] = useState({});
    const idsProductos = (c?.items ?? []).map(it => it.product_id).filter(Boolean).sort().join(',');
    useEffect(() => {
        if (!proveedor?.relacionada || !idsProductos) { setRefs({}); return undefined; }
        let vivo = true;
        const t = setTimeout(() => {
            fetchReferenciasRelacionada(idsProductos.split(',')).then(r => { if (vivo) setRefs(r); }).catch(e => console.error('referencias', e));
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [proveedor?.relacionada, idsProductos]);
    const avisosPrecio = useMemo(() => {
        if (!proveedor?.relacionada || !c) return [];
        return c.items.map(it => evaluarPrecioRelacionada(
            c.tipo_doc === '03' ? num(it.costo_unitario) : num(it.costo_unitario) / 1.13, refs[it.product_id]));
    }, [proveedor?.relacionada, c, refs]);
    const conAviso = avisosPrecio.filter(a => a.length).length;
    const problemas = useMemo(() => (c ? problemasDeCompra(c) : []), [c]);
    const conProblema = useMemo(() => new Set(problemas.map(p => p.campo)), [problemas]);

    // ── El JSON del proveedor ─────────────────────────────────────────────
    const aplicarJson = useCallback(async (json, provs = proveedores) => {
        const pre = leerDteDelProveedor(json);
        const prov = pre.emisor.nit ? provs.find(p => p.nit === pre.emisor.nit) : null;
        const mem = prov ? await fetchMemoriaProveedor(prov.id).catch(() => ({})) : {};
        const { compra, items } = leerDteDelProveedor(json, { memoria: mem });
        setEmisorDelJson(prov ? null : pre.emisor);
        setC(x => ({
            ...x, ...compra, proveedor_id: prov ? String(prov.id) : x.proveedor_id,
            codigo_generacion: compra.codigo_generacion ?? '',
            gravada: monto(compra.gravada), exenta: monto(compra.exenta), iva: monto(compra.iva),
            percepcion: monto(compra.percepcion), retencion: monto(compra.retencion), total: monto(compra.total),
            vence: compra.condicion === 2 && prov?.plazo_dias ? sumarDias(compra.fecha, prov.plazo_dias) : '',
            items: items.map(it => ({ ...it, key: crypto.randomUUID(), cantidad: String(it.cantidad), costo_unitario: String(it.costo_unitario) })),
        }));
    }, [proveedores]);

    const cargarArchivo = async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setError('');
        try {
            const json = JSON.parse(await f.text());
            setJsonCrudo(json);
            await aplicarJson(json);
        } catch (err) {
            setError(err instanceof SyntaxError ? 'El archivo no es un JSON válido.' : (err?.message || 'No se pudo leer el archivo.'));
        }
    };

    const copiarCalculado = () => setC(x => {
        const gravada = calc.productos;
        const iva = x.tipo_doc === '03' ? calc.iva : 0;
        return { ...x, gravada: String(gravada), exenta: x.exenta || '0', iva: String(iva),
            total: String(totalEsperado({ ...x, gravada, iva })) };
    });

    const payload = () => ({
        id: c.id ?? null, client_uuid: c.client_uuid, proveedor_id: Number(c.proveedor_id), tipo_doc: c.tipo_doc,
        numero: c.numero.trim(), codigo_generacion: c.codigo_generacion?.trim() || null, fecha: c.fecha,
        condicion: Number(c.condicion), vence: Number(c.condicion) === 2 ? c.vence || null : null,
        gravada: num(c.gravada), exenta: num(c.exenta), iva: num(c.iva), percepcion: num(c.percepcion), retencion: num(c.retencion), total: num(c.total),
        nota: c.nota,
        items: c.items.filter(it => it.product_id).map(it => ({
            product_id: Number(it.product_id), codigo_proveedor: it.codigo_proveedor ?? null, descripcion_proveedor: it.descripcion_proveedor ?? null,
            unidades_por: it.unidades_por ?? 1, cantidad: Math.round(num(it.cantidad)), costo_unitario: num(it.costo_unitario),
            lote: String(it.lote ?? '').trim().toUpperCase(), vence: it.vence || null,
        })),
    });

    const guardar = async ({ recibir = false } = {}) => {
        setOcupado(recibir ? 'recibir' : 'guardar');
        setError('');
        try {
            const id = await guardarCompra(payload());
            setC(x => ({ ...x, id }));
            descartar();
            if (recibir) {
                const r = await recibirCompra(id);
                useStaff.getState().appendAuditLog('DISTRIBUCION_COMPRA_RECIBIDA', String(id),
                    { proveedor: proveedor?.nombre, numero: c.numero.trim(), total: num(c.total), renglones: r?.renglones });
                showToast?.('Compra recibida', `${r?.renglones ?? ''} productos entraron a bodega con su costo.`, 'success');
                onCambio();
                onClose();
                return;
            }
            useStaff.getState().appendAuditLog('DISTRIBUCION_COMPRA_BORRADOR', String(id), { numero: c.numero.trim() });
            showToast?.('Borrador guardado', 'Puedes seguir después: queda en Borradores.', 'success');
            onCambio();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado('');
        }
    };

    const anular = async () => {
        if (!motivo.trim()) return;
        setOcupado('anular');
        setError('');
        try {
            await anularCompra(c.id, motivo.trim());
            useStaff.getState().appendAuditLog('DISTRIBUCION_COMPRA_ANULADA', String(c.id), { numero: c.numero, estado_previo: estado, motivo: motivo.trim() });
            showToast?.(estado === 'recibida' ? 'Compra anulada' : 'Borrador descartado', estado === 'recibida' ? 'Las unidades salieron de bodega y el costo se recalculó.' : '', 'success');
            onCambio();
            onClose();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado('');
        }
    };

    const titulo = compraId ? `Compra ${c?.numero ?? ''}` : 'Nueva compra';
    const base = num(c?.gravada) + num(c?.exenta);
    const cuadra = c?.items.length > 0 && Math.abs(calc.productos - base) <= toleranciaDeCuadre(c.items.length);

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-6xl" ariaLabel={titulo}>
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <ShoppingCart size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">{titulo}</h2>
                    {estado && estado !== 'borrador' && (
                        <Badge size="sm" variant={estado === 'recibida' ? 'success' : 'danger'}>{estado === 'recibida' ? 'Recibida' : 'Anulada'}</Badge>
                    )}
                    {estado === 'borrador' && compraId && <Badge size="sm" variant="warning">Borrador</Badge>}
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                {!c && error ? (
                    <Notice variant="danger" icon={AlertTriangle} bloque>{error}</Notice>
                ) : !c ? (
                    <p className="text-caption text-content-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</p>
                ) : (
                    <div className="flex flex-col gap-5" data-compra>
                        {error && <Notice variant="danger" icon={AlertTriangle} bloque>{error}</Notice>}
                        {detalle && estado !== 'borrador' && (
                            <p className="text-caption text-content-3">
                                {estado === 'recibida' && detalle.recibida_at && <>Recibida el {fechaNumerica(detalle.recibida_at)}{detalle.recibio ? ` por ${shortEmployeeName(detalle.recibio)}` : ''}. </>}
                                {estado === 'anulada' && <>Anulada{detalle.anulo ? ` por ${shortEmployeeName(detalle.anulo)}` : ''}: {detalle.anulada_motivo}</>}
                            </p>
                        )}

                        {editable && (
                            <div className="flex flex-wrap items-center gap-2" data-surface="card">
                                <div className="p-3 flex flex-wrap items-center gap-3 w-full">
                                    <FileJson size={18} className="text-brand-text shrink-0" />
                                    <p className="text-body-sm text-content-2 flex-1 min-w-[200px]">
                                        ¿Tienes el JSON del documento del proveedor? Se llena solo: número, fecha, montos y productos.
                                    </p>
                                    <input ref={archivo} type="file" accept="application/json,.json" className="sr-only" onChange={cargarArchivo} data-testid="json-proveedor" />
                                    <Button size="sm" variant="secondary" icon={FileJson} onClick={() => archivo.current?.click()}>Cargar JSON</Button>
                                </div>
                            </div>
                        )}
                        {editable && emisorDelJson && (
                            <Notice variant="warning" icon={Truck} bloque>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span>{emisorDelJson.nombre || 'El proveedor del documento'} (NIT {emisorDelJson.nit ?? '—'}) todavía no está registrado.</span>
                                    <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAltaProveedor(emisorDelJson)}>Registrarlo</Button>
                                </div>
                            </Notice>
                        )}

                        {/* ── Encabezado del documento ── */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="sm:col-span-2">
                                <span className={ROTULO}>Proveedor</span>
                                <div className="flex gap-2">
                                    <div className="flex-1 min-w-0">
                                        <LiquidSelect value={c.proveedor_id} onChange={(v) => set('proveedor_id')(v ?? '')} options={opcionesProveedor}
                                            placeholder="Elegir proveedor…" icon={Truck} disabled={!editable} clearable={false}
                                            invalid={editable && conProblema.has('proveedor') && !!c.numero} ariaLabel="Proveedor" />
                                    </div>
                                    {editable && <Button variant="secondary" iconOnly icon={Plus} title="Nuevo proveedor" onClick={() => setAltaProveedor({})} />}
                                </div>
                                {proveedor?.relacionada && (
                                    <p className="text-caption text-content-3 mt-1">
                                        Empresa relacionada: es una venta de ella y una compra de Torogoz, y el precio tiene que ser el de mercado.
                                    </p>
                                )}
                            </div>
                            <div>
                                <span className={ROTULO}>Documento</span>
                                <LiquidSelect value={c.tipo_doc} onChange={(v) => set('tipo_doc')(v ?? '03')} options={TIPOS_COMPRA} clearable={false}
                                    icon={FileJson} disabled={!editable} ariaLabel="Tipo de documento" />
                            </div>
                            <PortalInput label="Número de control" name="numero" value={c.numero} readOnly={!editable}
                                onChange={(e) => set('numero')(e.target.value.toUpperCase())} placeholder="DTE-03-…" />
                            <div>
                                <span className={ROTULO}>Fecha del documento</span>
                                {editable ? <LiquidDatePicker value={c.fecha} onChange={(v) => set('fecha')(v || '')} max={hoySV()} />
                                    : <p className="text-body-sm text-content-2 tabular-nums">{c.fecha ? fechaNumerica(c.fecha) : '—'}</p>}
                            </div>
                            <div>
                                <span className={ROTULO}>Condición</span>
                                <LiquidSelect value={String(c.condicion)} onChange={(v) => setC(x => ({ ...x, condicion: Number(v ?? 1), vence: '' }))}
                                    options={[{ value: '1', label: 'Contado' }, { value: '2', label: 'Crédito' }]} clearable={false}
                                    icon={Link2} disabled={!editable} ariaLabel="Condición" />
                            </div>
                            {Number(c.condicion) === 2 && (
                                <div>
                                    <span className={ROTULO}>Vence el pago</span>
                                    {editable ? <LiquidDatePicker value={c.vence} onChange={(v) => set('vence')(v || '')} />
                                        : <p className="text-body-sm text-content-2 tabular-nums">{c.vence ? fechaNumerica(c.vence) : '—'}</p>}
                                </div>
                            )}
                            <PortalInput label="Código de generación (opcional)" name="codigo" value={c.codigo_generacion} readOnly={!editable}
                                onChange={(e) => set('codigo_generacion')(e.target.value.trim().toLowerCase())} className="sm:col-span-2" />
                        </div>

                        {/* ── Productos ── */}
                        <section className="flex flex-col gap-2" aria-label="Productos de la compra">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-body font-black text-content">Productos</h3>
                                {editable && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setC(x => ({ ...x, items: [...x.items, renglonVacio()] }))}>Agregar producto</Button>}
                            </div>
                            {c.items.length === 0 ? (
                                <p className="text-caption text-content-3 py-3">Sin productos todavía. Carga el JSON del proveedor o agrégalos a mano.</p>
                            ) : (
                                <ul className="flex flex-col divide-y divide-divider" data-renglones>
                                    {c.items.map((it, i) => {
                                        const mal = editable && conProblema.has(`item-${i}`);
                                        return (
                                            <li key={it.key} className={`py-3 grid grid-cols-2 md:grid-cols-12 gap-2 items-end ${mal ? 'bg-danger/5 rounded-xl px-2' : ''}`} data-renglon={i}>
                                                <div className="col-span-2 md:col-span-4 min-w-0">
                                                    {it.descripcion_proveedor && (
                                                        <p className="text-micro text-content-3 truncate mb-1" title={it.descripcion_proveedor}>
                                                            {it.codigo_proveedor ? `${it.codigo_proveedor} · ` : ''}{it.descripcion_proveedor}
                                                            {it.recordado && <span className="text-success-text font-bold"> · recordado</span>}
                                                        </p>
                                                    )}
                                                    {editable ? (
                                                        <LiquidSelect value={it.product_id ? String(it.product_id) : ''} onChange={(v) => setItem(i, { product_id: v ? Number(v) : null })}
                                                            options={opcionesProducto} placeholder="Producto del catálogo…" icon={ShoppingCart} compact
                                                            invalid={!it.product_id} ariaLabel={`Producto del renglón ${i + 1}`} />
                                                    ) : (
                                                        <p className="text-body-sm font-bold text-content-2 truncate">{it.nombre ?? catalogo.find(p => p.product_id === it.product_id)?.nombre ?? `Producto ${it.product_id}`}</p>
                                                    )}
                                                </div>
                                                {it.cantidad_doc > 0 && editable ? (
                                                    <PortalInput label="Por caja" name={`upe-${i}`} inputMode="numeric" value={String(it.unidades_por ?? 1)}
                                                        onChange={(e) => setItem(i, cambiarUnidadesPor(it, e.target.value))} className="md:col-span-1"
                                                        title={`${it.cantidad_doc} en el documento del proveedor`} />
                                                ) : <span className="hidden md:block md:col-span-1" />}
                                                <PortalInput label="Unidades" name={`cant-${i}`} inputMode="numeric" value={it.cantidad} readOnly={!editable}
                                                    onChange={(e) => setItem(i, { cantidad: e.target.value })} className="md:col-span-1" />
                                                <PortalInput label="Costo unit." name={`costo-${i}`} inputMode="decimal" value={it.costo_unitario} readOnly={!editable}
                                                    onChange={(e) => setItem(i, { costo_unitario: e.target.value })} className="md:col-span-1"
                                                    helperText={c.tipo_doc === '03' ? 'Sin IVA' : 'Con IVA'} />
                                                <PortalInput label="Lote" name={`lote-${i}`} value={it.lote} readOnly={!editable}
                                                    onChange={(e) => setItem(i, { lote: e.target.value.toUpperCase() })} className="md:col-span-2" />
                                                <div className="md:col-span-2">
                                                    <span className={ROTULO}>Vence</span>
                                                    {editable ? <LiquidDatePicker value={it.vence} onChange={(v) => setItem(i, { vence: v || '' })} compact />
                                                        : <p className="text-body-sm text-content-2 tabular-nums">{it.vence ? fechaNumerica(it.vence) : '—'}</p>}
                                                </div>
                                                <div className="flex items-center justify-end gap-1 md:col-span-1">
                                                    <span className="text-body-sm font-black tabular-nums text-content">{formatMoney(subtotalRenglon(it))}</span>
                                                    {editable && <Button size="sm" variant="ghost" iconOnly icon={Trash2} title="Quitar renglón"
                                                        onClick={() => setC(x => ({ ...x, items: x.items.filter((_, j) => j !== i) }))} />}
                                                </div>
                                                {avisosPrecio[i]?.length > 0 && (
                                                    <div className="col-span-2 md:col-span-12 flex flex-wrap gap-1.5" data-aviso-precio={avisosPrecio[i][0].clave}>
                                                        {avisosPrecio[i].map(a => <Badge key={a.clave} size="sm" variant={a.nivel} uppercase={false}>{a.texto}</Badge>)}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>

                        {conAviso > 0 && (
                            <Notice variant="warning" icon={AlertTriangle} bloque data-testid="aviso-relacionada">
                                {conAviso} producto{conAviso === 1 ? '' : 's'} con precio fuera de lo razonable entre empresas del mismo grupo. Se puede recibir
                                igual, pero conviene que el contador lo revise: entre relacionadas el precio tiene que ser el que se le cobraría a un tercero.
                            </Notice>
                        )}

                        {/* ── Montos del documento contra lo calculado ── */}
                        <section data-surface="card" className="p-4 flex flex-col gap-3" aria-label="Montos del documento">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-body font-black text-content">Montos del documento</h3>
                                <div className="flex items-center gap-2">
                                    <span className={`text-caption font-bold flex items-center gap-1 ${cuadra ? 'text-success-text' : 'text-content-3'}`} data-cuadre={cuadra ? 'si' : 'no'}>
                                        {cuadra ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                                        Productos: {formatMoney(calc.productos)}
                                    </span>
                                    {editable && c.items.length > 0 && <Button size="sm" variant="ghost" icon={Wand2} onClick={copiarCalculado}>Copiar de los productos</Button>}
                                </div>
                            </div>
                            <p className="text-caption text-content-3">Escríbelos como vienen en el papel: la compra sólo se recibe si cuadran con los productos.</p>
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                                <CampoMonto label="Gravado" name="gravada" value={c.gravada} onChange={set('gravada')} disabled={!editable} />
                                <CampoMonto label="Exento" name="exenta" value={c.exenta} onChange={set('exenta')} disabled={!editable} />
                                <CampoMonto label="IVA" name="iva" value={c.iva} onChange={set('iva')} disabled={!editable}
                                    esperado={c.tipo_doc === '03' && c.gravada !== '' ? Math.round(num(c.gravada) * 13) / 100 : undefined} />
                                <CampoMonto label="Percepción 1 %" name="percepcion" value={c.percepcion} onChange={set('percepcion')} disabled={!editable} />
                                <CampoMonto label="Retención" name="retencion" value={c.retencion} onChange={set('retencion')} disabled={!editable} />
                                <CampoMonto label="Total" name="total" value={c.total} onChange={set('total')} disabled={!editable}
                                    esperado={c.gravada !== '' ? totalEsperado(c) : undefined} />
                            </div>
                        </section>

                        {editable && (
                            <PortalTextarea label="Nota (opcional)" name="nota" value={c.nota} onChange={(e) => set('nota')(e.target.value)} rows={2}
                                placeholder="Quién la entregó, faltantes, condiciones…" />
                        )}

                        {editable && problemas.length > 0 && (c.numero || c.items.length > 0) && (
                            <Notice variant="warning" icon={AlertTriangle} bloque>
                                <p className="font-bold mb-1">Para recibirla falta:</p>
                                <ul className="list-disc pl-5 text-caption" data-problemas>
                                    {problemas.slice(0, 6).map((p, k) => <li key={k}>{p.texto}</li>)}
                                    {problemas.length > 6 && <li>y {problemas.length - 6} más.</li>}
                                </ul>
                            </Notice>
                        )}

                        {puedeEditar && estado !== 'anulada' && c.id && (
                            anulando ? (
                                <div className="flex flex-wrap items-end gap-2">
                                    <PortalInput label={estado === 'recibida' ? '¿Por qué se anula la compra?' : '¿Por qué se descarta?'} name="motivo-anular"
                                        value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus className="flex-1 min-w-[220px]"
                                        helperText={estado === 'recibida' ? 'Sólo se puede si todo lo que entró sigue en bodega.' : undefined} />
                                    <Button variant="ghost" onClick={() => setAnulando(false)} disabled={!!ocupado}>Cancelar</Button>
                                    <Button variant="secondary" tone="danger" icon={ocupado === 'anular' ? Loader2 : Ban} disabled={!motivo.trim() || !!ocupado} onClick={anular}>
                                        {estado === 'recibida' ? 'Anular compra' : 'Descartar borrador'}
                                    </Button>
                                </div>
                            ) : (
                                <div>
                                    <Button size="sm" variant="ghost" icon={Ban} onClick={() => { setAnulando(true); setMotivo(''); }}>
                                        {estado === 'recibida' ? 'Anular esta compra' : 'Descartar borrador'}
                                    </Button>
                                </div>
                            )
                        )}
                    </div>
                )}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={!!ocupado}>{editable ? 'Cancelar' : 'Cerrar'}</Button>
                    {editable && (
                        <>
                            <Button variant="secondary" icon={ocupado === 'guardar' ? Loader2 : Save} disabled={!!ocupado || !c?.proveedor_id || !c?.numero.trim()}
                                onClick={() => guardar()}>Guardar borrador</Button>
                            <Button variant="primary" icon={ocupado === 'recibir' ? Loader2 : PackageCheck} disabled={!!ocupado || problemas.length > 0}
                                onClick={() => guardar({ recibir: true })}>Recibir en bodega</Button>
                        </>
                    )}
                </div>
            </LiquidModal.Footer>

            {altaProveedor && (
                <ProveedorModal emisorId={emisor?.id} inicial={altaProveedor} onClose={() => setAltaProveedor(null)}
                    onGuardado={async (id) => {
                        setAltaProveedor(null);
                        const provs = await onProveedores();
                        set('proveedor_id')(String(id));
                        if (jsonCrudo) await aplicarJson(jsonCrudo, provs).catch(() => {});
                    }} />
            )}
        </LiquidModal>
    );
}
