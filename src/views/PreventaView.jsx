import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ClipboardList, Minus, Pencil, Plus, Receipt, RefreshCw, Search, Send, ShoppingCart, Trash2, UserRound, X } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import LiquidSelect from '../components/common/LiquidSelect';
import SegmentedControl from '../components/common/SegmentedControl';
import PortalInput from '../components/common/PortalInput';
import PortalTextarea from '../components/common/PortalTextarea';
import AvisoDeFalta from '../components/common/AvisoDeFalta';
import ConfirmModal from '../components/common/ConfirmModal';
import BuscadorDeProducto from '../components/common/BuscadorDeProducto';
import BuscarFicha from '../components/caja/BuscarFicha';
import { irAlCampo } from '../plataforma/irAlCampo';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { anularPreventa, cotizarPreventa, enviarPreventaDirecta, fetchPreventasDeSala } from '@nucleo/data/preventas';
import {
    LISTAS_AUTORIZABLES, MAX_PRODUCTOS, agregarLinea, estadoDePreventa, faltaParaEnviar, lineasDeVenta,
    lineasParaCotizar, nombreDeLista, porQueEsaLista, sePuedeAnular, sePuedeCorregir, totalesDe,
} from '@nucleo/utils/preventaDirecta';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

// ═══════════════════════════════════════════════════════════════════════════
// Preventa — vender desde el portal y que la venta llegue armada a caja
// (2026-11-16, pedido del usuario: «que sirva para generar ventas y lleguen a
// caja; ahí debe poder corregir, validar y confirmar todo»).
//
// · El PRECIO lo decide el cliente, en la base (`preventa_cotizar`): Público
//   para cliente frecuente o sin datos, Preferente para todo cliente, el de su
//   condición para el mayorista y Mayoreo Plus para el personal. Otro precio
//   sólo con `preventa.can_approve` y un motivo.
// · VALIDAR es continuo: cada cambio vuelve a cotizar (precio, existencia en la
//   sucursal, presentación) y el botón dice qué falta.
// · CORREGIR reescribe la MISMA preventa en caja (mismo número), mientras no
//   se facture. ANULAR la borra de caja.
// · La venta a medio armar se guarda sola (borrador): la sesión se cierra por
//   inactividad y lo escrito no se pierde.
// ═══════════════════════════════════════════════════════════════════════════

const PESTANAS = [
    { key: 'nueva', label: 'Vender', icon: ShoppingCart },
    { key: 'hoy', label: 'Preventas', icon: ClipboardList },
];
const DOCUMENTOS = [
    { value: 'consumidor_final', label: 'Consumidor final' },
    { value: 'credito_fiscal', label: 'Crédito fiscal' },
];
const VACIA = { cliente: null, lineas: [], documento: 'consumidor_final', nota: '', motivoPrecio: '', corrigiendo: null };

export default function PreventaView() {
    const { user, hasPermission, getScope } = useAuth();
    const toast = useToastStore((s) => s.addToast);
    const todas = getScope('preventa') === 'ALL';
    const puedeVender = hasPermission('preventa', 'can_edit');
    const puedeAutorizar = hasPermission('preventa', 'can_approve');
    const miSala = user?.branchId ?? user?.branch_id ?? null;
    const branches = useStaff((st) => st.branches);
    const salas = useMemo(() => (branches || []).filter((b) => b.type === 'FARMACIA')
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true })), [branches]);

    const [pestana, setPestana] = usePestanaEnUrl(PESTANAS, 'nueva', 'tab');
    const opcionesSala = salas.map((b) => ({ value: String(b.id), label: b.name }));
    const [salaUrl, setSalaUrl] = usePestanaEnUrl(opcionesSala, String(miSala ?? opcionesSala[0]?.value ?? ''), 'sala');
    const sala = todas ? Number(salaUrl) || null : miSala;
    const nombreSala = salas.find((b) => Number(b.id) === Number(sala))?.name ?? '';

    // ── El borrador: una venta por sucursal y persona ─────────────────────
    const claveBorrador = `preventa-${sala ?? 'x'}`;
    const [venta, setVenta] = useState(() => loadDraft(claveBorrador) ?? VACIA);
    const salaPrevia = useRef(claveBorrador);
    useEffect(() => {
        if (salaPrevia.current === claveBorrador) return;
        salaPrevia.current = claveBorrador;
        setVenta(loadDraft(claveBorrador) ?? VACIA); // eslint-disable-line react-hooks/set-state-in-effect -- al cambiar de sucursal se carga SU borrador
    }, [claveBorrador]);
    useEffect(() => {
        if (venta.lineas.length || venta.cliente) saveDraft(claveBorrador, venta);
        else clearDraft(claveBorrador);
    }, [venta, claveBorrador]);
    const cambiar = (cambio) => setVenta((v) => ({ ...v, ...cambio }));

    // ── Cotizar en cada cambio ────────────────────────────────────────────
    const [cotizacion, setCotizacion] = useState(null);
    const [cotizando, setCotizando] = useState(false);
    const [errorCotizar, setErrorCotizar] = useState('');
    const pedido = useMemo(() => JSON.stringify(lineasParaCotizar(venta.lineas)), [venta.lineas]);
    const clienteId = venta.cliente?.id ?? null;
    useEffect(() => {
        if (!sala) return undefined;
        let vivo = true;
        setCotizando(true); // eslint-disable-line react-hooks/set-state-in-effect -- marca la cotización en curso
        const t = setTimeout(() => {
            cotizarPreventa(sala, clienteId, JSON.parse(pedido))
                .then((c) => { if (vivo) { setCotizacion(c); setErrorCotizar(''); } })
                .catch((e) => { if (vivo) setErrorCotizar(e?.message ?? 'No se pudieron revisar los precios.'); })
                .finally(() => { if (vivo) setCotizando(false); });
        }, 250);
        return () => { vivo = false; clearTimeout(t); };
    }, [sala, clienteId, pedido]);

    const filaDe = (l) => (cotizacion?.lineas ?? []).find((x) => x.producto_id === l.producto_id && x.factor === l.factor);
    const totales = totalesDe(cotizacion);
    const falta = errorCotizar ? { texto: errorCotizar, campo: null }
        : faltaParaEnviar({ lineas: venta.lineas, cotizacion, cotizando, documento: venta.documento, motivoPrecio: venta.motivoPrecio });

    const ponerLinea = (i, cambio) => cambiar({ lineas: venta.lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)) });
    const quitarLinea = (i) => cambiar({ lineas: venta.lineas.filter((_, j) => j !== i) });

    // ── Las preventas de la sucursal ──────────────────────────────────────
    const [dias, setDias] = useState('1');
    const [lista, setLista] = useState(null);
    const [errorLista, setErrorLista] = useState('');
    const recargar = useCallback(() => {
        if (!sala) return;
        fetchPreventasDeSala(sala, Number(dias))
            .then((l) => { setLista(l); setErrorLista(''); })
            .catch((e) => setErrorLista(e?.message ?? 'No se pudieron leer las preventas.'));
    }, [sala, dias]);
    useEffect(() => { recargar(); }, [recargar]);

    // ── Enviar o corregir ─────────────────────────────────────────────────
    const [enviando, setEnviando] = useState(false);
    const [resultado, setResultado] = useState(null);
    const enviar = async () => {
        if (falta || enviando) return;
        setEnviando(true);
        const r = await enviarPreventaDirecta({
            branchId: sala, customerId: clienteId, documento: venta.documento, nota: venta.nota,
            lineas: lineasParaCotizar(venta.lineas), preventaId: venta.corrigiendo?.id ?? null,
            motivoPrecio: venta.lineas.some((l) => l.lista) ? venta.motivoPrecio.trim() : null,
        });
        setEnviando(false);
        if (!r?.ok) { toast(r?.error ?? 'No se pudo mandar a caja.', 'error'); return; }
        setResultado({ ...r, total: totales.total, cliente: venta.cliente?.name ?? null });
        setVenta(VACIA);
        clearDraft(claveBorrador);
        recargar();
    };

    const corregir = (p) => {
        setVenta({
            ...VACIA, lineas: lineasDeVenta(p.venta),
            cliente: p.customer_id ? { id: p.customer_id, name: p.cliente } : null,
            documento: p.venta?.documento === 'credito_fiscal' ? 'credito_fiscal' : 'consumidor_final',
            corrigiendo: { id: p.id, codigo: p.codigo, referencia: p.externo_ref },
        });
        setResultado(null);
        setPestana('nueva');
    };
    const repetir = (p) => {
        setVenta({ ...VACIA, lineas: lineasDeVenta(p.venta), cliente: p.customer_id ? { id: p.customer_id, name: p.cliente } : null });
        setResultado(null);
        setPestana('nueva');
    };
    const [porAnular, setPorAnular] = useState(null);
    const anular = async () => {
        const p = porAnular;
        setPorAnular(null);
        const r = await anularPreventa(p.id);
        if (!r?.ok) { toast(r?.error ?? 'No se pudo anular.', 'error'); return; }
        toast(`Preventa ${p.externo_ref ? `#${p.externo_ref}` : p.codigo} anulada.`, 'success');
        recargar();
    };

    const enCaja = (lista ?? []).filter((p) => p.estado === 'viva').length;

    return (
        <GlassViewLayout icon={Receipt} title="Preventa" transparentBody
            filtersContent={<ViewTabBar tabs={PESTANAS} activeTab={pestana} onTabChange={setPestana} />}>
            <div className="p-4 md:p-6 space-y-4">
                {todas && opcionesSala.length > 0 && (
                    <div className="max-w-xs">
                        <LiquidSelect label="Sucursal" clearable={false} value={String(sala ?? '')} options={opcionesSala}
                            onChange={(v) => setSalaUrl(v)} />
                    </div>
                )}
                {!sala && <Notice variant="warning">Tu usuario no tiene sucursal asignada.</Notice>}

                {sala && pestana === 'nueva' && (
                    resultado ? (
                        <Hecho resultado={resultado} onOtra={() => setResultado(null)} onVer={() => { setResultado(null); setPestana('hoy'); }} />
                    ) : (
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
                            <div className="space-y-4 min-w-0">
                                {venta.corrigiendo && (
                                    <Notice variant="info">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="flex-1">
                                                Corrigiendo la preventa {venta.corrigiendo.referencia ? `#${venta.corrigiendo.referencia}` : venta.corrigiendo.codigo}.
                                                Al guardar, se cambia la misma en caja.
                                            </span>
                                            <Button size="sm" variant="ghost" icon={X} onClick={() => setVenta(VACIA)}>Cancelar</Button>
                                        </div>
                                    </Notice>
                                )}

                                <section data-surface="card" className="p-4 space-y-3" data-campo="cliente">
                                    <h2 className="text-caption font-black text-content-2 uppercase tracking-widest flex items-center gap-2">
                                        <UserRound size={14} /> Cliente
                                    </h2>
                                    <BuscarFicha ficha={venta.cliente} rotulo="Cliente"
                                        ayuda="Búscalo por nombre o documento. Sin cliente, va como cliente frecuente."
                                        onElegir={(c) => cambiar({ cliente: c ? { id: c.id, name: c.name } : null })} />
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant={cotizacion?.generico ? 'neutral' : 'success'} uppercase={false}>
                                            Precio {nombreDeLista(cotizacion?.lista)}
                                        </Badge>
                                        <span className="text-micro text-content-3">{porQueEsaLista(cotizacion?.lista, cotizacion?.generico ?? !venta.cliente)}</span>
                                        {venta.cliente && (
                                            <Button size="xs" variant="ghost" icon={X} onClick={() => cambiar({ cliente: null, documento: 'consumidor_final' })}>
                                                Quitar cliente
                                            </Button>
                                        )}
                                    </div>
                                    <SegmentedControl label="Documento" value={venta.documento} options={DOCUMENTOS}
                                        onChange={(v) => cambiar({ documento: v })} />
                                    {venta.documento === 'credito_fiscal' && cotizacion && !cotizacion.cliente?.nrc && (
                                        <Notice variant="warning">Este cliente no tiene NRC: complétalo en Clientes o usa Consumidor final.</Notice>
                                    )}
                                </section>

                                <section data-surface="card" className="p-4 space-y-3">
                                    <h2 className="text-caption font-black text-content-2 uppercase tracking-widest flex items-center gap-2">
                                        <ShoppingCart size={14} /> Productos
                                        <span className="ml-auto normal-case tracking-normal font-semibold text-content-3">
                                            {venta.lineas.length} de {MAX_PRODUCTOS}
                                        </span>
                                    </h2>
                                    <div data-campo="buscarProducto">
                                        <BuscadorDeProducto placeholder="Buscar producto por nombre o código…"
                                            invitacion={{ icono: Search, texto: 'Escribe el nombre del producto' }}
                                            onElegir={(p) => cambiar({ lineas: agregarLinea(venta.lineas, p, 1) })} />
                                    </div>
                                    {venta.lineas.length === 0 && (
                                        <p className="text-body-sm text-content-3 py-6 text-center">Todavía no hay productos en la venta.</p>
                                    )}
                                    <ul className="flex flex-col gap-2">
                                        {venta.lineas.map((l, i) => (
                                            <Linea key={`${l.producto_id}-${l.factor}`} linea={l} fila={filaDe(l)} cotizando={cotizando}
                                                puedeAutorizar={puedeAutorizar} listaCliente={cotizacion?.lista}
                                                onCambiar={(c) => ponerLinea(i, c)} onQuitar={() => quitarLinea(i)} />
                                        ))}
                                    </ul>
                                </section>
                            </div>

                            <aside data-surface="card" className="p-4 space-y-3 lg:sticky lg:top-4">
                                <h2 className="text-caption font-black text-content-2 uppercase tracking-widest">Resumen</h2>
                                <dl className="space-y-1 text-body-sm">
                                    <div className="flex justify-between"><dt className="text-content-3">Productos</dt><dd className="tabular-nums">{totales.productos}</dd></div>
                                    <div className="flex justify-between"><dt className="text-content-3">Unidades</dt><dd className="tabular-nums">{totales.unidades}</dd></div>
                                    {totales.ahorro > 0 && (
                                        <div className="flex justify-between"><dt className="text-content-3">Ahorro del cliente</dt>
                                            <dd className="tabular-nums text-success-text font-bold">{formatMoney(totales.ahorro)}</dd></div>
                                    )}
                                </dl>
                                <div className="flex items-end justify-between border-t border-subtle pt-3">
                                    <span className="text-caption font-bold text-content-2">Total</span>
                                    <span className="text-title font-black tabular-nums text-content">{formatMoney(totales.total)}</span>
                                </div>
                                {venta.lineas.some((l) => l.lista) && (
                                    <div data-campo="motivoPrecio">
                                        <PortalTextarea rows={2} value={venta.motivoPrecio} onChange={(e) => cambiar({ motivoPrecio: e.target.value })}
                                            placeholder="¿Por qué va otro precio? (obligatorio)" />
                                    </div>
                                )}
                                <PortalInput compact label="Nota para caja (opcional)" value={venta.nota} maxLength={60}
                                    onChange={(e) => cambiar({ nota: e.target.value })} placeholder="Ej. paga con tarjeta" />
                                <AvisoDeFalta motivo={falta?.texto} onIr={falta?.campo ? () => irAlCampo(falta.campo) : null} />
                                <Button className="w-full" icon={venta.corrigiendo ? Pencil : Send} loading={enviando}
                                    disabled={!puedeVender || Boolean(falta)} onClick={enviar}>
                                    {venta.corrigiendo ? 'Guardar corrección en caja' : 'Enviar a caja'}
                                </Button>
                                {!puedeVender && <p className="text-micro text-content-3">Puedes mirar, pero no enviar preventas.</p>}
                                {(venta.lineas.length > 0 || venta.cliente) && !venta.corrigiendo && (
                                    <Button className="w-full" variant="ghost" size="sm" icon={Trash2} onClick={() => setVenta(VACIA)}>
                                        Vaciar la venta
                                    </Button>
                                )}
                                <p className="text-micro text-content-3">
                                    Llega a caja de {nombreSala} con tu nombre como vendedor. La caja la factura y el portal la marca sola.
                                </p>
                            </aside>
                        </div>
                    )
                )}

                {sala && pestana === 'hoy' && (
                    <section className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <SegmentedControl label="Desde" value={dias} onChange={setDias}
                                options={[{ value: '1', label: 'Hoy' }, { value: '7', label: '7 días' }, { value: '30', label: '30 días' }]} />
                            <span className="text-body-sm text-content-3">{enCaja} en caja sin facturar</span>
                            <Button size="sm" variant="ghost" icon={RefreshCw} className="ml-auto" onClick={recargar}>Actualizar</Button>
                        </div>
                        {errorLista && <Notice variant="danger">{errorLista}</Notice>}
                        {lista && lista.length === 0 && <p className="text-body-sm text-content-3 py-8 text-center">No hay preventas en este periodo.</p>}
                        <ul className="flex flex-col gap-2">
                            {(lista ?? []).map((p) => (
                                <Tarjeta key={p.id} p={p} puedeVender={puedeVender}
                                    onCorregir={() => corregir(p)} onRepetir={() => repetir(p)} onAnular={() => setPorAnular(p)} />
                            ))}
                        </ul>
                    </section>
                )}
            </div>

            <ConfirmModal isOpen={Boolean(porAnular)} onClose={() => setPorAnular(null)} onConfirm={anular}
                title={`¿Anular la preventa ${porAnular?.externo_ref ? `#${porAnular.externo_ref}` : porAnular?.codigo ?? ''}?`}
                message="Se borra de caja y ya no se puede facturar. No se puede deshacer." confirmText="Anular" />
        </GlassViewLayout>
    );
}

// ── Un producto de la venta ───────────────────────────────────────────────
function Linea({ linea, fila, cotizando, puedeAutorizar, listaCliente, onCambiar, onQuitar }) {
    const presentaciones = (fila?.presentaciones ?? [{ factor: linea.factor, tipo: '…' }])
        .map((p) => ({ value: String(p.factor), label: p.tipo }));
    const cant = Number(linea.cantidad) || 0;
    const rebajado = fila && fila.precio_regular > fila.precio;
    return (
        <li className="rounded-xl border border-subtle p-3 flex flex-col gap-2" data-campo={`linea-${linea.producto_id}-${linea.factor}`}>
            <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-bold text-content leading-snug">{fila?.nombre ?? linea.nombre}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        {fila?.bajo_receta && <Badge variant="warning" size="sm" uppercase={false}>Bajo Receta</Badge>}
                        {fila && <span className="text-micro text-content-3">Existencia: {fila.existencia} u.</span>}
                        {fila?.lista && fila.lista !== listaCliente && !linea.lista && (
                            <span className="text-micro text-content-3">· precio {nombreDeLista(fila.lista)} en esta presentación</span>
                        )}
                    </div>
                </div>
                <button type="button" aria-label="Quitar producto" onClick={onQuitar}
                    className="min-h-[var(--tap-min)] min-w-[var(--tap-min)] flex items-center justify-center rounded-lg text-content-3 active:scale-[0.97]">
                    <X size={16} />
                </button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <div className="w-40">
                    <LiquidSelect label="Presentación" clearable={false} value={String(linea.factor)} options={presentaciones}
                        onChange={(v) => onCambiar({ factor: Number(v) || 1 })} />
                </div>
                <div className="flex items-end gap-1">
                    <Button size="sm" variant="ghost" icon={Minus} aria-label="Una menos" onClick={() => onCambiar({ cantidad: Math.max(1, cant - 1) })} />
                    <div className="w-20">
                        <PortalInput label="Cantidad" inputMode="numeric" value={String(linea.cantidad)}
                            onChange={(e) => onCambiar({ cantidad: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                    </div>
                    <Button size="sm" variant="ghost" icon={Plus} aria-label="Una más" onClick={() => onCambiar({ cantidad: Math.min(999, cant + 1) })} />
                </div>
                {puedeAutorizar && (
                    <div className="w-40">
                        <LiquidSelect label="Otro precio" placeholder="El del cliente" clearable value={linea.lista ?? ''}
                            options={LISTAS_AUTORIZABLES} onChange={(v) => onCambiar({ lista: v || null })} />
                    </div>
                )}
                <div className="ml-auto text-right">
                    {fila?.precio != null && (
                        <p className="text-micro text-content-3 tabular-nums">
                            {rebajado && <span className="line-through mr-1">{formatMoney(fila.precio_regular)}</span>}
                            {formatMoney(fila.precio)} c/u
                        </p>
                    )}
                    <p className={`text-body font-black tabular-nums ${cotizando ? 'text-content-3' : 'text-content'}`}>
                        {fila ? formatMoney(fila.subtotal) : '…'}
                    </p>
                </div>
            </div>
            {fila?.error && <Notice variant="danger">{fila.error}</Notice>}
        </li>
    );
}

// ── Lo que quedó en caja ──────────────────────────────────────────────────
function Hecho({ resultado, onOtra, onVer }) {
    return (
        <section data-surface="card" className="p-6 max-w-lg mx-auto text-center space-y-3">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest">
                {resultado.corregida ? 'Corrección guardada en caja' : 'Preventa en caja'}
            </p>
            <p className="text-display font-black tabular-nums text-brand-text">#{resultado.referencia}</p>
            <p className="text-body text-content-2">
                {resultado.cliente ?? 'Cliente frecuente'} · {formatMoney(resultado.total_caja ?? resultado.total)}
            </p>
            <p className="text-body-sm text-content-3">Dile al cliente que pase a caja con el número #{resultado.referencia}.</p>
            {(resultado.avisos ?? []).map((a) => <Notice key={a} variant="warning">{a}</Notice>)}
            <div className="flex flex-wrap justify-center gap-2 pt-2">
                <Button icon={Plus} onClick={onOtra}>Nueva preventa</Button>
                <Button variant="ghost" icon={ClipboardList} onClick={onVer}>Ver preventas</Button>
            </div>
        </section>
    );
}

// ── Una preventa de la lista ──────────────────────────────────────────────
function Tarjeta({ p, puedeVender, onCorregir, onRepetir, onAnular }) {
    const [abierta, setAbierta] = useState(false);
    const est = estadoDePreventa(p);
    return (
        <li data-surface="card" className="p-3 flex flex-col gap-2">
            <button type="button" onClick={() => setAbierta((a) => !a)} className="flex items-center gap-3 text-left min-h-[var(--tap-min)] active:scale-[0.99]">
                <span className="text-title font-black tabular-nums text-content w-16 shrink-0">{p.externo_ref ? `#${p.externo_ref}` : '—'}</span>
                <span className="flex-1 min-w-0">
                    <span className="block text-body-sm font-bold text-content truncate">{p.cliente ?? 'Cliente frecuente'}</span>
                    <span className="block text-micro text-content-3 truncate">
                        {p.codigo} · {hora12(p.enviada_at ?? p.created_at)} · {shortEmployeeName({ name: p.vendedor })}
                        {p.corregida_veces > 0 ? ` · corregida ${p.corregida_veces}×` : ''}
                    </span>
                </span>
                <span className="text-right shrink-0">
                    <span className="block text-body font-black tabular-nums">{formatMoney(p.total)}</span>
                    <Badge variant={est.tono} size="sm" uppercase={false}>{est.texto}</Badge>
                </span>
            </button>
            {abierta && (
                <div className="flex flex-col gap-2 border-t border-subtle pt-2">
                    <ul className="text-body-sm text-content-2 space-y-0.5">
                        {(p.venta?.renglones ?? []).map((r) => (
                            <li key={`${r.producto_id}-${r.factor}`} className="flex justify-between gap-2">
                                <span className="min-w-0 truncate">{r.cantidad} × {r.nombre}</span>
                                <span className="tabular-nums shrink-0">{formatMoney(r.subtotal)}</span>
                            </li>
                        ))}
                    </ul>
                    {p.factura && <p className="text-micro text-content-3">Factura {p.factura}</p>}
                    {p.error && <Notice variant={p.estado === 'viva' ? 'warning' : 'danger'}>{p.error}</Notice>}
                    {(p.avisos ?? []).map((a) => <Notice key={a} variant="warning">{a}</Notice>)}
                    {puedeVender && (
                        <div className="flex flex-wrap gap-2">
                            {sePuedeCorregir(p) && <Button size="sm" icon={Pencil} onClick={onCorregir}>Corregir</Button>}
                            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRepetir}>Repetir venta</Button>
                            {sePuedeAnular(p) && <Button size="sm" variant="ghost" icon={Ban} onClick={onAnular}>Anular</Button>}
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}
