// La nota de crédito de descuento de una factura, dentro de la revisión de
// «Cargar compra» (2026-11-25).
//
// Vijosa factura todas las unidades al precio lleno y manda las de regalo
// (26+4, 100+20…) en una nota de crédito aparte. La función `cargar-compra-erp`
// la encuentra sola, carga la compra por la factura MENOS la nota (como lo
// hace Bodega a mano) y reparte la nota según la regalía de cada producto
// (`compra_regalia`). Aquí se ve qué nota se tomó, cuánto llevó cada producto
// y se anota la regalía que falte. Si la nota que se tomó no es de esta
// factura, se puede dejar fuera.
import { useState } from 'react';
import { Gift } from 'lucide-react';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import Checkbox from '../../components/common/Checkbox';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { guardarRegalia } from '@nucleo/data/cargarCompra';
import { useToastStore } from '@nucleo/store/toastStore';

const MODO = {
    regalias: 'Cada producto lleva sus regalías. El resto del descuento va parejo en todos.',
    proporcional: 'Ningún producto tiene su regalía anotada. El descuento va parejo en todos. Anota la regalía de cada producto para que su costo sea exacto.',
    escalado: 'Las regalías suman más que la nota. Se ajustaron a lo que dice la nota. Revisa las regalías anotadas.',
    producto: 'Toda la nota es descuento de un solo producto y baja su costo.',
};

export default function NotaDeDescuento({ nota, emisorNit, puedeEditar, sinNota, onSinNota, onCambio, onProducto }) {
    const [edit, setEdit] = useState({});
    const [guardando, setGuardando] = useState(null);
    if (!nota?.notas?.length) return null;

    const total = nota.notas.reduce((a, n) => a + Number(n.total || 0), 0);
    const cercana = nota.notas.some(n => n.como === 'cercana');
    const producto = Number.isInteger(nota.producto) ? nota.renglones.find(r => r.renglon === nota.producto) : null;
    const valor = (r, k) => edit[r.renglon]?.[k] ?? (r.nivel?.[k] != null ? String(r.nivel[k]) : '');
    const poner = (r, k, v) => setEdit(e => ({ ...e, [r.renglon]: { compra: valor(r, 'compra'), regalo: valor(r, 'regalo'), [k]: v.replace(/\D/g, '') } }));
    const cambiado = (r) => edit[r.renglon] && (valor(r, 'compra') !== String(r.nivel?.compra ?? '') || valor(r, 'regalo') !== String(r.nivel?.regalo ?? ''));

    const guardar = async (r) => {
        const c = valor(r, 'compra'), g = valor(r, 'regalo');
        const quitar = c === '' && g === '';
        if (!quitar && !(Number(c) > 0 && Number(g) > 0)) {
            useToastStore.getState().showToast('Regalía incompleta', 'Escribe cuántas se compran y cuántas van de regalo.', 'warning');
            return;
        }
        setGuardando(r.renglon);
        const { ok, error } = await guardarRegalia({
            nit: emisorNit, codigo: r.codigo, descripcion: r.descripcion,
            compra: quitar ? null : Number(c), regalo: quitar ? null : Number(g),
        });
        setGuardando(null);
        if (!ok) { useToastStore.getState().showToast('No se guardó la regalía', error, 'danger'); return; }
        setEdit(e => { const x = { ...e }; delete x[r.renglon]; return x; });
        onCambio?.();
    };

    return (
        <div data-surface="card" className="mt-3 px-4 py-3">
            <div className="flex items-start gap-3">
                <Gift size={18} className="text-accent shrink-0 mt-0.5" aria-hidden />
                <div className="min-w-0 flex-1">
                    <p className="text-body font-bold text-content">
                        Nota de crédito de descuento · {formatMoney(total)}
                    </p>
                    <p className="text-label text-content-2 mt-0.5">
                        {nota.notas.map(n => n.numero_control).filter(Boolean).join(' · ')}
                    </p>
                    {nota.aplicada ? (
                        <p className="text-label text-content-2 mt-1">
                            La compra entra por la factura menos esta nota. {MODO[nota.modo] ?? ''}
                        </p>
                    ) : (
                        <p className="text-label text-content-2 mt-1">
                            Esta nota no se aplica. La compra entra por el total de la factura.
                        </p>
                    )}
                </div>
            </div>

            {cercana && (
                <Notice variant="info" compact className="mt-2">
                    La nota no dice a qué factura va. Es la que llegó junto con esta.
                </Notice>
            )}
            {puedeEditar && (
                <div className="mt-2">
                    <Checkbox size="sm" label="Esta nota no es de esta factura" checked={!!sinNota}
                        onChange={() => onSinNota?.(!sinNota)} />
                </div>
            )}
            {producto && (
                <Notice variant="info" compact className="mt-2"
                    action={puedeEditar ? <Button size="xs" variant="secondary" onClick={() => onProducto?.(null)}>Repartir entre todos</Button> : null}>
                    Descuento de {producto.descripcion}: −{formatMoney(producto.rebaja)}.
                </Notice>
            )}

            {nota.aplicada && (
                <div className="mt-3 divide-y divide-divider">
                    {nota.renglones.filter(r => Number(r.rebaja) > 0 || r.nivel || Number(r.precio) > 0).map(r => (
                        <div key={r.renglon} className="py-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_7rem] gap-x-4 gap-y-2 items-center">
                            <div className="min-w-0">
                                <p className="text-label font-bold text-content truncate">{r.descripcion}</p>
                                <p className="text-micro text-content-3 tabular-nums">
                                    {r.codigo} · {r.cantidad} a {formatMoney(r.precio)}
                                    {Number(r.regalo) > 0 && <> · <b className="text-content-2">{r.regalo} de regalo</b></>}
                                </p>
                            </div>
                            <div className="flex items-end gap-2">
                                <div className="w-20">
                                    <PortalInput compact labelDenso label="Compra" inputMode="numeric" readOnly={!puedeEditar}
                                        value={valor(r, 'compra')} onChange={e => poner(r, 'compra', e.target.value)} />
                                </div>
                                <span className="pb-2 text-label text-content-3">+</span>
                                <div className="w-20">
                                    <PortalInput compact labelDenso label="Regalo" inputMode="numeric" readOnly={!puedeEditar}
                                        value={valor(r, 'regalo')} onChange={e => poner(r, 'regalo', e.target.value)} />
                                </div>
                                {puedeEditar && cambiado(r) && (
                                    <Button size="sm" variant="primary" loading={guardando === r.renglon} onClick={() => guardar(r)}>
                                        Guardar
                                    </Button>
                                )}
                                {puedeEditar && !cambiado(r) && nota.producto !== r.renglon && (
                                    <Button size="sm" variant="ghost" onClick={() => onProducto?.(r.renglon)}>
                                        Descuento de este producto
                                    </Button>
                                )}
                            </div>
                            <p className="text-label tabular-nums text-content sm:text-right">
                                <span className="sm:hidden text-content-3">Descuento: </span>−{formatMoney(r.rebaja)}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
