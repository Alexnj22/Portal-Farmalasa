// Pestaña «Regalías» de Cargar compra (2026-11-25).
//
// El banco de regalías por proveedor: cada producto (por su código en la
// factura del proveedor) con su nivel compra + regalo, quién lo cambió y el
// historial de cambios, que no se borra. Es el mismo banco que usa la carga
// para repartir la nota de crédito de descuento (`repartirNotaDeDescuento`);
// aquí se mantiene sin esperar a que llegue una factura.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Gift, History } from 'lucide-react';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import ConfirmModal from '../../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fetchProveedoresParaRegalias, fetchRegaliasDeProveedor, guardarRegalia } from '@nucleo/data/cargarCompra';
import { useToastStore } from '@nucleo/store/toastStore';

const COLS_PRODUCTOS = [
    { key: 'producto', label: 'Producto', align: 'left' },
    { key: 'regalia',  label: 'Regalía (compra + regalo)', align: 'left' },
    { key: 'por',      label: 'Último cambio', align: 'left', hideBelow: 'lg' },
];
const COLS_HISTORIAL = [
    { key: 'fecha',    label: 'Fecha', align: 'left' },
    { key: 'producto', label: 'Producto', align: 'left' },
    { key: 'cambio',   label: 'Cambio', align: 'left' },
    { key: 'por',      label: 'Quién', align: 'left', hideBelow: 'md' },
];
const VISTAS = [
    { value: 'productos', label: 'Productos' },
    { value: 'historial', label: 'Historial' },
];

const nivel = (c, r) => (c != null && r != null ? `${c} + ${r}` : null);
function textoDelCambio(h) {
    const antes = nivel(h.compra_antes, h.regalo_antes), despues = nivel(h.compra_despues, h.regalo_despues);
    if (h.accion === 'alta') return `Nueva: ${despues}`;
    if (h.accion === 'baja') return `Quitada (era ${antes})`;
    return `${antes} → ${despues}`;
}

function Quien({ id, nombre, cuando }) {
    if (!id) return <span className="text-content-3">—</span>;
    return (
        <span className="inline-flex items-center gap-1.5 min-w-0">
            <AvatarConEstado emp={{ id, name: nombre }} px={20} marco="" />
            <span className="truncate">{shortEmployeeName(nombre ?? '')}</span>
            {cuando && <span className="text-micro text-content-3 tabular-nums">· {fechaHora12(cuando)}</span>}
        </span>
    );
}

export default function RegaliasProveedor({ puedeEditar }) {
    const [proveedores, setProveedores] = useState(null);
    const [nit, setNit] = useState('');
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    const [vista, setVista] = useState('productos');
    const [busca, setBusca] = useState('');
    const [edit, setEdit] = useState({});
    const [guardando, setGuardando] = useState(null);
    const [aQuitar, setAQuitar] = useState(null);

    useEffect(() => {
        fetchProveedoresParaRegalias().then(({ proveedores: p, error: e }) => {
            setError(e ?? '');
            setProveedores(p);
            setNit(n => n || p[0]?.nit || '');
        });
    }, []);

    const cargar = useCallback(async (n) => {
        if (!n) return;
        setDatos(null);
        const r = await fetchRegaliasDeProveedor(n);
        setError(r.error ?? '');
        setDatos(r);
    }, []);
    useEffect(() => { cargar(nit); setEdit({}); }, [nit, cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- lee al cambiar de proveedor

    const opciones = useMemo(() => (proveedores ?? []).map(p => ({
        value: p.nit,
        label: p.regalias > 0 ? `${p.nombre} · ${p.regalias} con regalía` : p.nombre,
    })), [proveedores]);

    const productos = useMemo(() => (datos?.productos ?? [])
        .filter(x => !busca || tokenMatch(busca, x.producto ?? '', x.codigo)), [datos, busca]);
    const historial = useMemo(() => (datos?.historial ?? [])
        .filter(x => !busca || tokenMatch(busca, x.descripcion ?? '', x.codigo_proveedor)), [datos, busca]);
    const conRegalia = (datos?.productos ?? []).filter(x => x.compra != null).length;

    const valor = (x, k) => edit[x.codigo]?.[k] ?? (x[k] != null ? String(x[k]) : '');
    const poner = (x, k, v) => setEdit(e => ({ ...e, [x.codigo]: { compra: valor(x, 'compra'), regalo: valor(x, 'regalo'), [k]: v.replace(/\D/g, '') } }));
    const cambiado = (x) => !!edit[x.codigo] && (valor(x, 'compra') !== String(x.compra ?? '') || valor(x, 'regalo') !== String(x.regalo ?? ''));

    const guardar = async (x, quitar = false) => {
        const c = valor(x, 'compra'), g = valor(x, 'regalo');
        if (!quitar && !(Number(c) > 0 && Number(g) > 0)) {
            useToastStore.getState().showToast('Regalía incompleta', 'Escribe cuántas se compran y cuántas van de regalo.', 'warning');
            return;
        }
        setGuardando(x.codigo);
        const { ok, error: e } = await guardarRegalia({
            nit, codigo: x.codigo, descripcion: x.descripcion ?? x.producto,
            compra: quitar ? null : Number(c), regalo: quitar ? null : Number(g),
        });
        setGuardando(null);
        if (!ok) { useToastStore.getState().showToast('No se guardó la regalía', e, 'danger'); return; }
        useToastStore.getState().showToast(quitar ? 'Regalía quitada' : 'Regalía guardada', x.producto ?? x.codigo, 'success');
        setEdit(s => { const n = { ...s }; delete n[x.codigo]; return n; });
        setAQuitar(null);
        cargar(nit);
    };

    return (
        <div className="space-y-3">
            <Notice variant="info" icon={Gift} compact>
                La regalía de cada producto se anota una vez. Cuando el proveedor manda las regalías en una nota de crédito, la carga baja el costo de cada producto con este nivel.
            </Notice>
            {error && <Notice variant="danger">{error}</Notice>}

            <div className="flex flex-wrap items-end gap-3">
                <div className="w-full sm:w-96">
                    <LiquidSelect value={nit} onChange={v => v && setNit(v)} options={opciones}
                        placeholder="Proveedor" ariaLabel="Proveedor" clearable={false} searchable />
                </div>
                <SegmentedControl options={VISTAS} value={vista} onChange={setVista} />
                <div className="w-full sm:w-72">
                    <PortalInput compact label="Buscar producto o código" value={busca} onChange={e => setBusca(e.target.value)} />
                </div>
                {datos && (
                    <span className="text-label text-content-3 tabular-nums">
                        {conRegalia} de {datos.productos.length} con regalía
                    </span>
                )}
            </div>

            {vista === 'productos' ? (
                <DataTable columns={COLS_PRODUCTOS} dense loading={datos === null}
                    empty={{ icon: Gift, message: 'Este proveedor no tiene productos emparejados' }}
                    movil={{ identidad: 'producto', ancla: 'regalia', apilada: true, acciones: 'mantener' }}>
                    {productos.map((x, i) => (
                        <DataRow key={x.codigo} index={i}>
                            <DataCell>
                                <p className="font-bold text-content">{x.producto ?? 'Producto sin emparejar'}</p>
                                <p className="text-micro text-content-3 tabular-nums">{x.codigo}</p>
                            </DataCell>
                            <DataCell>
                                <div className="flex items-end gap-2">
                                    <div className="w-20">
                                        <PortalInput compact labelDenso label="Compra" inputMode="numeric" readOnly={!puedeEditar}
                                            value={valor(x, 'compra')} onChange={e => poner(x, 'compra', e.target.value)} />
                                    </div>
                                    <span className="pb-2 text-label text-content-3">+</span>
                                    <div className="w-20">
                                        <PortalInput compact labelDenso label="Regalo" inputMode="numeric" readOnly={!puedeEditar}
                                            value={valor(x, 'regalo')} onChange={e => poner(x, 'regalo', e.target.value)} />
                                    </div>
                                    {puedeEditar && cambiado(x) && (
                                        <Button size="sm" loading={guardando === x.codigo} onClick={() => guardar(x)}>Guardar</Button>
                                    )}
                                    {puedeEditar && !cambiado(x) && x.compra != null && (
                                        <Button size="sm" variant="ghost" loading={guardando === x.codigo} onClick={() => setAQuitar(x)}>Quitar</Button>
                                    )}
                                </div>
                            </DataCell>
                            <DataCell>
                                {x.compra != null ? <Quien id={x.actualizado_por} nombre={x.actualizado_por_nombre} cuando={x.updated_at} /> : <span className="text-content-3">Sin regalía</span>}
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            ) : (
                <DataTable columns={COLS_HISTORIAL} dense loading={datos === null}
                    empty={{ icon: History, message: 'Sin cambios de regalías para este proveedor' }}
                    movil={{ identidad: 'producto', ancla: 'cambio' }}>
                    {historial.map((h, i) => (
                        <DataRow key={h.id} index={i}>
                            <DataCell className="tabular-nums">{fechaHora12(h.created_at)}</DataCell>
                            <DataCell>
                                <p className="font-bold text-content">{h.descripcion ?? h.codigo_proveedor}</p>
                                <p className="text-micro text-content-3 tabular-nums">{h.codigo_proveedor}</p>
                            </DataCell>
                            <DataCell className="tabular-nums">{textoDelCambio(h)}</DataCell>
                            <DataCell><Quien id={h.cambiado_por} nombre={h.cambiado_por_nombre} /></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            )}
            {aQuitar && (
                <ConfirmModal isOpen onClose={() => guardando !== aQuitar.codigo && setAQuitar(null)} onConfirm={() => guardar(aQuitar, true)}
                    isProcessing={guardando === aQuitar.codigo}
                    title="Quitar regalía"
                    message={`«${aQuitar.producto ?? aQuitar.codigo}» deja de tener la regalía ${aQuitar.compra} + ${aQuitar.regalo}. Queda en el historial.`}
                    confirmText="Quitar" />
            )}
        </div>
    );
}
