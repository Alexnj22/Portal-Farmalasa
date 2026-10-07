import React, { useState, useEffect, useRef } from 'react';
import { PackageX, Search, Loader2, Pill, Package, CheckCircle2 } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import { buscarEnSrs } from '@nucleo/data/srs';
import { anotarVentaPerdida, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { leerMonto } from './comun';
import { medicamentoDeSrs } from '@nucleo/utils/distribucionBodega';

// «Venta perdida»: lo que un cliente pidió y no se le pudo vender. Pedido del
// usuario (2026-09-29), como el botón de la caja: «si ingreso un producto y no
// hay stock, que salga agregar ventas perdidas, o la ventana para agregar un
// producto (que busque en la SRS si es medicamento, o si es insumo que mande el
// nombre)».
//
// Tres caminos, y la fila guarda cuál fue (`origen`), porque de eso depende
// cuánto se le puede creer al nombre:
//   · catalogo — viene de la venta: un producto del catálogo sin existencia.
//   · srs      — un medicamento que no está en el catálogo, elegido del
//                registro de la SRS (nombre, principio activo, laboratorio y
//                número de registro salen de ahí, no de lo que se escribió).
//   · insumo   — lo que no está en la SRS (gasas, jeringas…): el nombre a mano.

const deSrs = medicamentoDeSrs;

export default function VentaPerdidaModal({ emisorId, cliente, pedidoId = null, producto = null, cantidad = 1, buscado = '', onClose, onGuardado }) {
    const desdeCatalogo = !!producto;
    const [tipo, setTipo] = useState('medicamento');
    const [q, setQ] = useState(buscado);
    const [resultados, setResultados] = useState(null);
    const [buscando, setBuscando] = useState(false);
    const [errorSrs, setErrorSrs] = useState('');
    const [elegido, setElegido] = useState(null);
    const [nombreInsumo, setNombreInsumo] = useState(buscado);
    const [cant, setCant] = useState(String(cantidad || 1));
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const pedido = useRef(0);

    // La búsqueda en la SRS sale sola al escribir (con pausa), como el buscador de la venta.
    useEffect(() => {
        if (desdeCatalogo || tipo !== 'medicamento') return undefined;
        const texto = q.trim();
        if (texto.length < 3) return undefined;
        const mio = ++pedido.current;
        const t = setTimeout(async () => {
            setBuscando(true);
            setErrorSrs('');
            try {
                const json = await buscarEnSrs(texto, { porPagina: 8 });
                if (mio !== pedido.current) return;
                setResultados((json.data ?? []).map(deSrs).filter(r => r.nombre));
            } catch (e) {
                if (mio !== pedido.current) return;
                console.error('venta perdida: SRS', e);
                setErrorSrs('El registro de la SRS no respondió. Si es urgente, anótalo como insumo con el nombre.');
                setResultados(null);
            } finally {
                if (mio === pedido.current) setBuscando(false);
            }
        }, 400);
        return () => clearTimeout(t);
    }, [q, tipo, desdeCatalogo]);

    const n = leerMonto(cant);
    const nombreFinal = desdeCatalogo ? producto.nombre : tipo === 'medicamento' ? elegido?.nombre : nombreInsumo.trim();
    const falta = !nombreFinal ? (tipo === 'medicamento' && !desdeCatalogo ? 'Elige el medicamento de la lista.' : 'Escribe el nombre del insumo.')
        : !(n > 0) ? 'La cantidad tiene que ser mayor que cero.' : null;

    const guardar = async () => {
        if (falta || guardando) return;
        setGuardando(true);
        setError('');
        const origen = desdeCatalogo ? 'catalogo' : tipo === 'medicamento' ? 'srs' : 'insumo';
        try {
            const id = await anotarVentaPerdida({
                emisorId, clienteId: cliente?.id, productId: producto?.product_id ? Number(producto.product_id) : null, pedidoId,
                origen, producto: nombreFinal, cantidad: n, buscado: desdeCatalogo ? null : q,
                registroSrs: origen === 'srs' ? elegido.registro : null,
                principioActivo: origen === 'srs' ? elegido.principio : null,
                laboratorio: origen === 'srs' ? elegido.laboratorio : null,
            });
            useStaff.getState().appendAuditLog('DISTRIBUCION_VENTA_PERDIDA', String(id), { origen, producto: nombreFinal, cantidad: n });
            onGuardado?.({ id, producto: nombreFinal, cantidad: n });
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-xl" ariaLabel="Venta perdida">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <PackageX size={18} className="text-warning-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">Venta perdida{cliente ? ` · ${cliente.nombre}` : ''}</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-3" onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.name === 'cantidad-perdida') { e.preventDefault(); guardar(); }
                }}>
                    <p className="text-caption text-content-3">
                        Lo que el cliente pidió y no se le pudo vender. Queda en la lista de Ventas perdidas para comprarlo.
                    </p>
                    {desdeCatalogo ? (
                        <div className="rounded-xl border border-divider p-3 flex items-center gap-2.5">
                            <Package size={16} className="text-content-3 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-body-sm font-bold text-content truncate">{producto.nombre}</p>
                                <p className="text-caption text-content-3">{producto.motivo ?? 'Sin existencia'}</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <SegmentedControl value={tipo} onChange={(v) => { setTipo(v); setElegido(null); }} label="Qué es"
                                options={[{ value: 'medicamento', label: 'Medicamento' }, { value: 'insumo', label: 'Insumo' }]} />
                            {tipo === 'medicamento' ? (
                                <div className="flex flex-col gap-2">
                                    <PortalInput icon={buscando ? Loader2 : Search} name="buscar-srs" value={q} autoFocus
                                        label="Buscar en el registro de la SRS" placeholder="Nombre comercial o principio activo…"
                                        onChange={(e) => { setQ(e.target.value); setElegido(null); }} />
                                    {errorSrs && <Notice variant="warning" compact>{errorSrs}</Notice>}
                                    {q.trim().length < 3 && <p className="text-caption text-content-3">Escribe al menos tres letras.</p>}
                                    {resultados && q.trim().length >= 3 && resultados.length === 0 && !buscando && (
                                        <p className="text-caption text-content-3">
                                            La SRS no tiene nada con ese nombre.{' '}
                                            <button type="button" className="font-bold text-brand-text underline" onClick={() => { setTipo('insumo'); setNombreInsumo(q); }}>Anotarlo como insumo</button>
                                        </p>
                                    )}
                                    {resultados?.length > 0 && q.trim().length >= 3 && (
                                        <div className="rounded-xl border border-divider overflow-hidden max-h-64 overflow-y-auto" role="listbox" aria-label="Medicamentos de la SRS">
                                            {resultados.map((r, k) => {
                                                const activo = elegido === r;
                                                return (
                                                    <button key={`${r.registro}-${k}`} type="button" role="option" aria-selected={activo} data-srs={k}
                                                        onClick={() => setElegido(r)}
                                                        className={`w-full flex items-start gap-2.5 px-3 min-h-[var(--tap-min)] py-2 text-left border-b border-divider last:border-b-0 active:scale-[0.99] transition-transform ${activo ? 'bg-brand/10' : 'hover:bg-surface-card-hover'}`}>
                                                        {activo ? <CheckCircle2 size={16} className="text-brand-text shrink-0 mt-0.5" /> : <Pill size={16} className="text-content-3 shrink-0 mt-0.5" />}
                                                        <span className="min-w-0">
                                                            <span className="block text-body-sm font-bold text-content truncate">{r.nombre}{!r.activo && <span className="text-caption text-content-3 font-normal"> · registro inactivo</span>}</span>
                                                            <span className="block text-caption text-content-3 truncate">
                                                                {[r.principio, r.forma, r.laboratorio, r.registro && `Reg. ${r.registro}`].filter(Boolean).join(' · ')}
                                                            </span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <PortalInput name="nombre-insumo" value={nombreInsumo} autoFocus label="Nombre del insumo"
                                    placeholder="Ej.: gasa estéril 4x4, jeringa 5 ml" onChange={(e) => setNombreInsumo(e.target.value)} />
                            )}
                        </>
                    )}
                    <PortalInput name="cantidad-perdida" inputMode="decimal" value={cant} label="Cantidad que pidió" className="max-w-[10rem]"
                        autoFocus={desdeCatalogo} onFocus={(e) => e.target.select()}
                        onChange={(e) => setCant(e.target.value.replace(/[^0-9.]/g, ''))} />
                    {error && <Notice variant="danger" compact>{error}</Notice>}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                    {falta && <p className="mr-auto text-caption text-content-3">{falta}</p>}
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button variant="primary" icon={guardando ? Loader2 : PackageX} disabled={!!falta || guardando} onClick={guardar} data-guardar-perdida>
                        Anotar venta perdida
                    </Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
