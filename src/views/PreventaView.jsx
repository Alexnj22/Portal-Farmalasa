import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Ban, ClipboardList, Minus, Package, Pencil, Plus, Receipt, RefreshCw, Send, ShoppingCart, Trash2,
    UserPen, UserPlus, UserRound, X,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import LiquidSelect from '../components/common/LiquidSelect';
import SegmentedControl from '../components/common/SegmentedControl';
import PortalInput from '../components/common/PortalInput';
import SearchInput from '../components/common/SearchInput';
import AvisoDeFalta from '../components/common/AvisoDeFalta';
import ConfirmModal from '../components/common/ConfirmModal';
import { irAlCampo } from '../plataforma/irAlCampo';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarClientes } from '@nucleo/data/customers';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import { anularPreventa, cotizarPreventa, enviarPreventaDirecta, fetchPreventasDeSala } from '@nucleo/data/preventas';
import {
    MAX_PRODUCTOS, PAGOS, agregarLinea, estadoDePreventa, faltaParaEnviar, faltanParaCcf, lineasDeVenta,
    lineasParaCotizar, nombreDeLista, opcionesDePrecio, porQueEsaLista, sePuedeAnular, sePuedeCorregir, totalesDe,
} from '@nucleo/utils/preventaDirecta';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

// ═══════════════════════════════════════════════════════════════════════════
// Preventa — vender desde el portal y que la venta llegue armada a caja.
//
// Segunda vuelta (2026-11-16, usuario: «no es nada práctico»):
// · El cliente se busca, se EDITA y se CREA aquí mismo, con el editor de
//   clientes del portal (`editCliente`): no hay que salir a Clientes.
// · Crédito fiscal dice qué datos le faltan al cliente y abre su editor.
// · Tipo de pago: efectivo, tarjeta, transferencia, crédito o cheque.
// · Los productos van en filas compactas; el buscador queda arriba, Enter
//   agrega el primero y el foco vuelve solo para el siguiente.
// · Otro precio se elige viendo el monto de cada lista. Quien puede elegirlo
//   (`preventa.can_approve`) ES quien autoriza: no se le pide motivo; queda
//   anotado en la preventa y en el registro.
// · Si en la sucursal no alcanza, dice en qué sucursal hay.
//
// El precio lo decide la base (`preventa_cotizar`) y lo vuelve a calcular
// antes de mandar. Corregir reescribe la MISMA preventa en caja; anular la
// borra; las dos sólo mientras no se facture.
// ═══════════════════════════════════════════════════════════════════════════

const PESTANAS = [
    { key: 'nueva', label: 'Vender', icon: ShoppingCart },
    { key: 'hoy', label: 'Preventas', icon: ClipboardList },
];
const DOCUMENTOS = [
    { value: 'consumidor_final', label: 'Factura' },
    { value: 'credito_fiscal', label: 'Crédito fiscal' },
];
const VACIA = { cliente: null, lineas: [], documento: 'consumidor_final', pago: 'contado', nota: '', corrigiendo: null };

export default function PreventaView({ openModal }) {
    const { user, hasPermission, getScope } = useAuth();
    const toast = useToastStore((s) => s.addToast);
    const todas = getScope('preventa') === 'ALL';
    const puedeVender = hasPermission('preventa', 'can_edit');
    const puedeAutorizar = hasPermission('preventa', 'can_approve');
    const puedeEditarClientes = hasPermission('clientes', 'can_edit');
    const puedeCrearClientes = hasPermission('clientes_crear');
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
    const [venta, setVenta] = useState(() => ({ ...VACIA, ...(loadDraft(claveBorrador) ?? {}) }));
    const salaPrevia = useRef(claveBorrador);
    useEffect(() => {
        if (salaPrevia.current === claveBorrador) return;
        salaPrevia.current = claveBorrador;
        setVenta({ ...VACIA, ...(loadDraft(claveBorrador) ?? {}) }); // eslint-disable-line react-hooks/set-state-in-effect -- al cambiar de sucursal se carga SU borrador
    }, [claveBorrador]);
    useEffect(() => {
        if (venta.lineas.length || venta.cliente) saveDraft(claveBorrador, venta);
        else clearDraft(claveBorrador);
    }, [venta, claveBorrador]);
    const cambiar = (cambio) => setVenta((v) => ({ ...v, ...cambio }));

    // ── Cotizar en cada cambio (y al volver del editor del cliente) ───────
    const [cotizacion, setCotizacion] = useState(null);
    const [cotizando, setCotizando] = useState(false);
    const [errorCotizar, setErrorCotizar] = useState('');
    const [vuelta, setVuelta] = useState(0);
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
        }, 200);
        return () => { vivo = false; clearTimeout(t); };
    }, [sala, clienteId, pedido, vuelta]);

    const filaDe = (l) => (cotizacion?.lineas ?? []).find((x) => x.producto_id === l.producto_id && x.factor === l.factor);
    const totales = totalesDe(cotizacion);
    const falta = errorCotizar ? { texto: errorCotizar, campo: null }
        : faltaParaEnviar({ lineas: venta.lineas, cotizacion, cotizando, documento: venta.documento, pago: venta.pago });
    const faltanCcf = venta.documento === 'credito_fiscal' && cotizacion ? faltanParaCcf(cotizacion.cliente) : [];

    const ponerLinea = (i, cambio) => cambiar({ lineas: venta.lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)) });
    const quitarLinea = (i) => cambiar({ lineas: venta.lineas.filter((_, j) => j !== i) });

    // ── El cliente: elegir, editar, crear (el editor del portal) ──────────
    const elegirCliente = (c) => cambiar({ cliente: c ? { id: c.id, name: c.name } : null });
    const editarCliente = () => {
        if (!venta.cliente) return;
        openModal?.('editCliente', {
            id: venta.cliente.id, nombre: venta.cliente.name, canEdit: puedeEditarClientes,
            onSaved: () => setVuelta((n) => n + 1),
        });
    };
    const crearCliente = () => {
        openModal?.('editCliente', {
            nombre: 'Nuevo cliente', canEdit: true,
            onSaved: (r) => { if (r?.id) elegirCliente({ id: r.id, name: r.name }); setVuelta((n) => n + 1); },
        });
    };

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
            branchId: sala, customerId: clienteId, documento: venta.documento, pago: venta.pago, nota: venta.nota,
            lineas: lineasParaCotizar(venta.lineas), preventaId: venta.corrigiendo?.id ?? null,
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
            pago: p.venta?.pago ?? 'contado',
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
    const pestanas = PESTANAS.map((t) => (t.key === 'hoy' && enCaja ? { ...t, label: `Preventas (${enCaja})` } : t));

    return (
        <GlassViewLayout icon={Receipt} title="Preventa" transparentBody
            filtersContent={<ViewTabBar tabs={pestanas} activeTab={pestana} onTabChange={setPestana} />}>
            <div className="p-3 md:p-5 space-y-3">
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
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
                            <div className="space-y-3 min-w-0">
                                {venta.corrigiendo && (
                                    <Notice variant="info">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="flex-1">
                                                Corrigiendo la preventa {venta.corrigiendo.referencia ? `#${venta.corrigiendo.referencia}` : venta.corrigiendo.codigo}.
                                                Al guardar, cambia la misma en caja.
                                            </span>
                                            <Button size="sm" variant="ghost" icon={X} onClick={() => setVenta(VACIA)}>Cancelar</Button>
                                        </div>
                                    </Notice>
                                )}

                                <Cliente cliente={venta.cliente} cotizacion={cotizacion}
                                    puedeEditar={puedeEditarClientes} puedeCrear={puedeCrearClientes}
                                    onElegir={elegirCliente} onEditar={editarCliente} onCrear={crearCliente} />

                                <section data-surface="card" className="p-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-caption font-black text-content-2 uppercase tracking-widest flex items-center gap-1.5">
                                            <ShoppingCart size={13} /> Productos
                                        </h2>
                                        <span className="ml-auto text-micro text-content-3">{venta.lineas.length} de {MAX_PRODUCTOS}</span>
                                    </div>
                                    <BuscarProducto onElegir={(p) => cambiar({ lineas: agregarLinea(venta.lineas, p, 1) })} />
                                    {venta.lineas.length === 0 ? (
                                        <p className="text-body-sm text-content-3 py-4 text-center">Busca un producto para empezar.</p>
                                    ) : (
                                        <div className="divide-y divide-border-subtle">
                                            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_130px_118px_150px_80px_36px] gap-2 px-1 pb-1 text-micro font-black text-content-3 uppercase tracking-widest">
                                                <span>Producto</span><span>Presentación</span><span className="text-center">Cantidad</span>
                                                <span>Precio</span><span className="text-right">Subtotal</span><span />
                                            </div>
                                            {venta.lineas.map((l, i) => (
                                                <Linea key={`${l.producto_id}-${l.factor}`} linea={l} fila={filaDe(l)} cotizando={cotizando}
                                                    puedeAutorizar={puedeAutorizar} listaCliente={cotizacion?.lista}
                                                    onCambiar={(c) => ponerLinea(i, c)} onQuitar={() => quitarLinea(i)} />
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>

                            <aside data-surface="card" className="p-3 space-y-3 lg:sticky lg:top-3">
                                <SegmentedControl label="Documento" value={venta.documento} options={DOCUMENTOS}
                                    onChange={(v) => cambiar({ documento: v })} />
                                {faltanCcf.length > 0 && (
                                    <Notice variant="warning">
                                        <p>Para crédito fiscal le falta: {faltanCcf.join(', ')}.</p>
                                        <div className="mt-2">
                                            {venta.cliente
                                                ? <Button size="sm" variant="secondary" icon={UserPen} onClick={editarCliente}>Completar datos</Button>
                                                : <span className="text-micro">Elige o crea el cliente arriba.</span>}
                                        </div>
                                    </Notice>
                                )}

                                <div className="space-y-1.5">
                                    <SegmentedControl label="Pago" value={venta.pago} options={PAGOS}
                                        onChange={(v) => cambiar({ pago: v })} />
                                    {venta.pago === 'credito' && (cotizacion?.generico || !venta.cliente) && (
                                        <p className="text-micro text-warning-text">El crédito necesita un cliente con sus datos.</p>
                                    )}
                                </div>

                                <dl className="space-y-0.5 text-body-sm border-t border-subtle pt-2">
                                    <div className="flex justify-between"><dt className="text-content-3">Productos · unidades</dt>
                                        <dd className="tabular-nums">{totales.productos} · {totales.unidades}</dd></div>
                                    {totales.ahorro > 0 && (
                                        <div className="flex justify-between"><dt className="text-content-3">Ahorra el cliente</dt>
                                            <dd className="tabular-nums text-success-text font-bold">{formatMoney(totales.ahorro)}</dd></div>
                                    )}
                                    <div className="flex items-end justify-between pt-1">
                                        <dt className="text-caption font-bold text-content-2">Total</dt>
                                        <dd className={`text-title font-black tabular-nums ${cotizando ? 'text-content-3' : 'text-content'}`}>
                                            {formatMoney(totales.total)}
                                        </dd>
                                    </div>
                                </dl>

                                <PortalInput compact label="Nota para caja" value={venta.nota} maxLength={60}
                                    onChange={(e) => cambiar({ nota: e.target.value })} placeholder="Opcional" />
                                <AvisoDeFalta motivo={falta?.texto} onIr={falta?.campo ? () => irAlCampo(falta.campo) : null} />
                                <Button className="w-full" size="lg" icon={venta.corrigiendo ? Pencil : Send} loading={enviando}
                                    disabled={!puedeVender || Boolean(falta)} onClick={enviar}>
                                    {venta.corrigiendo ? 'Guardar corrección' : 'Enviar a caja'}
                                </Button>
                                {!puedeVender && <p className="text-micro text-content-3">Puedes mirar, pero no enviar preventas.</p>}
                                {(venta.lineas.length > 0 || venta.cliente) && !venta.corrigiendo && (
                                    <Button className="w-full" variant="ghost" size="sm" icon={Trash2} onClick={() => setVenta(VACIA)}>
                                        Empezar de nuevo
                                    </Button>
                                )}
                                <p className="text-micro text-content-3">Llega a caja de {nombreSala} con tu nombre como vendedor.</p>
                            </aside>
                        </div>
                    )
                )}

                {sala && pestana === 'hoy' && (
                    <section className="space-y-2">
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

// ── El cliente: buscar, ver sus datos, editar o crear ─────────────────────
function Cliente({ cliente, cotizacion, puedeEditar, puedeCrear, onElegir, onEditar, onCrear }) {
    const [texto, setTexto] = useState('');
    const q = useTextoRebotado(texto, 250);
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    useEffect(() => {
        let vivo = true;
        if (cliente || q.trim().length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
        setBuscando(true);
        buscarClientes(q, { select: 'id, name, dui, nit, nrc, phone, categoria', limite: 6 }).then(({ data, error }) => {
            if (!vivo) return;
            setBuscando(false);
            if (error) console.error('PreventaView: no se pudo buscar el cliente', error);
            setResultados(data ?? []);
        });
        return () => { vivo = false; };
    }, [q, cliente]);

    const c = cotizacion?.cliente;
    const elegir = (x) => { onElegir(x); setTexto(''); };
    return (
        <section data-surface="card" className="p-3 space-y-2" data-campo="cliente">
            <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-caption font-black text-content-2 uppercase tracking-widest flex items-center gap-1.5">
                    <UserRound size={13} /> Cliente
                </h2>
                <Badge variant={cotizacion?.generico ? 'neutral' : 'success'} size="sm" uppercase={false}>
                    Precio {nombreDeLista(cotizacion?.lista)}
                </Badge>
                <span className="text-micro text-content-3 hidden sm:inline">{porQueEsaLista(cotizacion?.lista, cotizacion?.generico ?? !cliente)}</span>
                {puedeCrear && !cliente && (
                    <Button size="xs" variant="ghost" icon={UserPlus} className="ml-auto" onClick={onCrear}>Cliente nuevo</Button>
                )}
            </div>
            {cliente ? (
                <div className="flex items-center gap-3 rounded-lg border border-border-subtle px-3 py-2">
                    <div className="min-w-0 flex-1">
                        <p className="text-body-sm font-bold text-content truncate">{cliente.name}</p>
                        <p className="text-micro text-content-3 truncate">
                            {[c?.categoria, c?.nit && `NIT ${c.nit}`, !c?.nit && c?.dui && `DUI ${c.dui}`, c?.nrc && `NRC ${c.nrc}`, c?.phone]
                                .filter(Boolean).join(' · ') || 'Sin datos'}
                        </p>
                    </div>
                    {puedeEditar && <Button size="sm" variant="secondary" icon={UserPen} onClick={onEditar}>Editar datos</Button>}
                    <Button size="sm" variant="ghost" icon={X} aria-label="Quitar cliente" onClick={() => onElegir(null)} />
                </div>
            ) : (
                <>
                    <SearchInput value={texto} onChange={setTexto} placeholder="Nombre, DUI, NIT o teléfono · sin cliente va como frecuente"
                        ariaLabel="Buscar al cliente" />
                    {buscando && <p className="text-micro text-content-3">Buscando…</p>}
                    {resultados.length > 0 && (
                        <ul className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
                            {resultados.map((x) => (
                                <li key={x.id}>
                                    <button type="button" onClick={() => elegir(x)}
                                        className="w-full text-left px-3 py-1.5 min-h-[var(--tap-min)] flex items-center gap-2 hover:bg-surface-card-hover active:scale-[0.99]">
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-body-sm font-semibold text-content truncate">{x.name}</span>
                                            <span className="block text-micro text-content-3 truncate">
                                                {[x.nit && `NIT ${x.nit}`, !x.nit && x.dui && `DUI ${x.dui}`, x.nrc && `NRC ${x.nrc}`, x.phone].filter(Boolean).join(' · ') || 'Sin documento'}
                                            </span>
                                        </span>
                                        {x.categoria && x.categoria !== 'Consumidor' && <Badge size="sm" variant="info" uppercase={false}>{x.categoria}</Badge>}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {puedeCrear && !buscando && q.trim().length >= 3 && (
                        <Button size="xs" variant="ghost" icon={UserPlus} onClick={onCrear}>
                            {resultados.length ? 'No es ninguno: crear cliente' : 'No aparece: crear cliente'}
                        </Button>
                    )}
                </>
            )}
        </section>
    );
}

// ── Buscar producto: compacto, Enter agrega el primero, el foco se queda ──
function BuscarProducto({ onElegir }) {
    const [texto, setTexto] = useState('');
    const q = useTextoRebotado(texto, 150);
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        let vivo = true;
        if (q.trim().length < 2) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
        setBuscando(true);
        buscarProductosMinMax(q, 8).then(({ filas }) => {
            if (!vivo) return;
            setResultados(filas ?? []);
            setBuscando(false);
        });
        return () => { vivo = false; };
    }, [q]);
    const elegir = (p) => {
        onElegir(p);
        setTexto('');
        setResultados([]);
        ref.current?.focus();
    };
    return (
        <div data-campo="buscarProducto" className="space-y-1"
            onKeyDown={(e) => { if (e.key === 'Enter' && resultados[0]) { e.preventDefault(); elegir(resultados[0]); } }}>
            <SearchInput ref={ref} value={texto} onChange={setTexto} placeholder="Buscar producto o escanear · Enter agrega el primero"
                ariaLabel="Buscar producto" />
            {buscando && resultados.length === 0 && <p className="text-micro text-content-3">Buscando…</p>}
            {!buscando && q.trim().length >= 2 && resultados.length === 0 && <p className="text-micro text-content-3">Sin resultados.</p>}
            {resultados.length > 0 && (
                <ul data-surface="dropdown" className="rounded-lg border border-border-subtle divide-y divide-border-subtle max-h-72 overflow-y-auto">
                    {resultados.map((p, i) => (
                        <li key={p.id}>
                            <button type="button" onClick={() => elegir(p)}
                                className={`w-full text-left px-3 py-1.5 min-h-[var(--tap-min)] flex items-center gap-2 hover:bg-surface-card-hover active:scale-[0.99] ${i === 0 ? 'bg-surface-card-hover' : ''}`}>
                                <Package size={13} className="text-content-3 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-body-sm font-semibold text-content truncate">{p.nombre}</span>
                                    {p.principio_activo && <span className="block text-micro text-content-3 truncate">{p.principio_activo}</span>}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Un producto de la venta, en una fila ──────────────────────────────────
function Linea({ linea, fila, cotizando, puedeAutorizar, listaCliente, onCambiar, onQuitar }) {
    const presentaciones = (fila?.presentaciones ?? [{ factor: linea.factor, tipo: '…' }])
        .map((p) => ({ value: String(p.factor), label: p.tipo }));
    const cant = Number(linea.cantidad) || 0;
    const opciones = opcionesDePrecio(fila?.precios);
    const precioCliente = fila && !linea.lista ? fila.precio : null;
    const opcionesPrecio = [
        { value: '', label: `Del cliente${precioCliente != null ? ` · ${formatMoney(precioCliente)}` : ''}` },
        ...opciones.map((o) => ({ value: o.lista, label: `${o.nombre} · ${formatMoney(o.precio)}` })),
    ];
    return (
        <div className="py-2 px-1" data-campo={`linea-${linea.producto_id}-${linea.factor}`}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_130px_118px_150px_80px_36px] gap-x-2 gap-y-1.5 items-center">
                <div className="min-w-0 col-span-1">
                    <p className="text-body-sm font-semibold text-content leading-tight truncate" title={fila?.nombre ?? linea.nombre}>
                        {fila?.nombre ?? linea.nombre}
                    </p>
                    <p className="text-micro text-content-3 flex flex-wrap items-center gap-x-1.5">
                        {fila?.bajo_receta && <span className="text-warning-text font-bold">Bajo Receta</span>}
                        {fila && <span>Existencia {fila.existencia}</span>}
                        {fila?.lista && !linea.lista && fila.lista !== listaCliente && <span>· {nombreDeLista(fila.lista)} en esta presentación</span>}
                    </p>
                </div>
                <Button size="sm" variant="ghost" icon={X} aria-label="Quitar producto" onClick={onQuitar} className="md:hidden" />
                <div className="col-span-2 md:col-span-1 flex flex-wrap md:contents items-center gap-2">
                    <div className="w-32 md:w-auto">
                        <LiquidSelect clearable={false} value={String(linea.factor)} options={presentaciones} aria-label="Presentación"
                            onChange={(v) => onCambiar({ factor: Number(v) || 1 })} />
                    </div>
                    <div className="flex items-center gap-0.5">
                        <Button size="xs" variant="ghost" icon={Minus} aria-label="Una menos" onClick={() => onCambiar({ cantidad: Math.max(1, cant - 1) })} />
                        <div className="w-14">
                            <PortalInput compact inputMode="numeric" value={String(linea.cantidad)} aria-label="Cantidad"
                                onChange={(e) => onCambiar({ cantidad: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                        </div>
                        <Button size="xs" variant="ghost" icon={Plus} aria-label="Una más" onClick={() => onCambiar({ cantidad: Math.min(999, cant + 1) })} />
                    </div>
                    <div className="min-w-[9rem] flex-1 md:flex-none">
                        {puedeAutorizar ? (
                            <LiquidSelect clearable={false} value={linea.lista ?? ''} options={opcionesPrecio} aria-label="Precio"
                                onChange={(v) => onCambiar({ lista: v || null })} />
                        ) : (
                            <p className="text-body-sm tabular-nums text-content-2">
                                {fila?.precio != null ? formatMoney(fila.precio) : '…'}
                                <span className="text-micro text-content-3"> {nombreDeLista(fila?.lista)}</span>
                            </p>
                        )}
                    </div>
                    <p className={`ml-auto md:ml-0 text-right text-body font-black tabular-nums ${cotizando ? 'text-content-3' : 'text-content'}`}>
                        {fila ? formatMoney(fila.subtotal) : '…'}
                    </p>
                    <Button size="sm" variant="ghost" icon={X} aria-label="Quitar producto" onClick={onQuitar} className="hidden md:inline-flex" />
                </div>
            </div>
            {fila?.error && (
                <p className="mt-1 text-micro text-danger-text font-semibold">
                    {fila.error}
                    {fila.otras?.length > 0 && (
                        <span className="text-content-3 font-normal"> Hay en {fila.otras.map((o) => `${o.sucursal} (${o.disponibles})`).join(', ')}.</span>
                    )}
                </p>
            )}
        </div>
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
    const pago = PAGOS.find((x) => x.value === p.venta?.pago)?.label;
    return (
        <li data-surface="card" className="p-3 flex flex-col gap-2">
            <button type="button" onClick={() => setAbierta((a) => !a)} className="flex items-center gap-3 text-left min-h-[var(--tap-min)] active:scale-[0.99]">
                <span className="text-title font-black tabular-nums text-content w-16 shrink-0">{p.externo_ref ? `#${p.externo_ref}` : '—'}</span>
                <span className="flex-1 min-w-0">
                    <span className="block text-body-sm font-bold text-content truncate">{p.cliente ?? 'Cliente frecuente'}</span>
                    <span className="block text-micro text-content-3 truncate">
                        {p.codigo} · {hora12(p.enviada_at ?? p.created_at)} · {shortEmployeeName({ name: p.vendedor })}
                        {pago ? ` · ${pago}` : ''}{p.venta?.documento === 'credito_fiscal' ? ' · Crédito fiscal' : ''}
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
