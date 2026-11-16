import React, { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    Ban, ClipboardList, Gift, Minus, Package, PackageSearch, Pencil, Plus, Receipt, RefreshCw, Send, ShoppingBag,
    ShoppingCart, Trash2, UserPen, UserPlus, UserRound, X,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidModal from '../components/common/LiquidModal';
import SegmentedControl from '../components/common/SegmentedControl';
import PortalInput from '../components/common/PortalInput';
import SearchInput from '../components/common/SearchInput';
import AvisoDeFalta from '../components/common/AvisoDeFalta';
import ConfirmModal from '../components/common/ConfirmModal';
import ClienteAvatar from './chat-clientes/ClienteAvatar';
import { irAlCampo } from '../plataforma/irAlCampo';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useCoarsePointer } from '../plataforma/useCoarsePointer';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarClientes } from '@nucleo/data/customers';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import {
    anularPreventa, cotizarPreventa, enviarPreventaDirecta, fetchClienteDePreventa, fetchPreventasDeSala, fotosDeProductos,
} from '@nucleo/data/preventas';
import {
    MAX_PRODUCTOS, NOMBRE_DE_PROGRAMA, PAGOS, agregarLinea, descuentoDePuntos, estadoDePreventa, faltaParaEnviar,
    faltanParaCcf, lineasDeVenta, lineasParaCotizar, maximoDePuntos, nombreDeLista, opcionesDePrecio, porQueEsaLista,
    sePuedeAnular, sePuedeCorregir, totalesDe,
} from '@nucleo/utils/preventaDirecta';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

// Lo que sólo hace falta al apretar un botón no viaja con la vista.
const FormularioPedirASala = lazy(() =>
    import('./dashboard/inventario/PanelDeInventario').then((m) => ({ default: m.FormularioPedirASala })));
const DialogoApartar = lazy(() => import('../components/caja/DialogoApartar'));

// ═══════════════════════════════════════════════════════════════════════════
// Preventa — vender desde el portal y que la venta llegue armada a caja.
//
// Cuarta vuelta (2026-11-16, usuario: «moderno, fácil, eficiente, intuitivo,
// que funcione con las teclas y los focus estén donde deben»):
// · La sucursal se elige en la píldora del cuerpo (`FilterBar.Sucursal`),
//   junto a las acciones de la vista, como en el resto del portal.
// · La foto del cliente (la que subió desde la app) y la de cada producto.
// · Teclado de punta a punta, con las MISMAS teclas que la caja y la venta de
//   Distribución, para que nadie aprenda dos mapas:
//     F2 · F8 · Ctrl+Enter  enviar a caja        F3 · /  buscar producto
//     F4  buscar cliente                          F6      vaciar (con confirmación)
//     F7  existencia en otras sucursales          Supr    quitar el producto
//     ↑ ↓ en un buscador recorre la lista, Enter elige, Esc limpia.
//     En los productos: ← → cambia de campo, ↑ ↓ de producto, Enter vuelve
//     al buscador.
// · El foco va solo a donde sigue el trabajo: al abrir, al buscador; al
//   elegir cliente, a productos; al agregar uno, a su cantidad; al quitarlo
//   o cerrar un diálogo, de vuelta al buscador. En el teléfono no se enfoca
//   nada solo (abriría el teclado encima de la pantalla).
//
// Tercera vuelta: ficha del cliente (tipo, nivel, puntos), descuento por
// puntos (renglón «DESCUENTO POR PUNTOS SALUD» a $0.01 por punto), tipo de
// pago en un select, existencia en otras sucursales y apartar.
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
const DIAS = [{ value: '1', label: 'Hoy' }, { value: '7', label: '7 días' }, { value: '30', label: '30 días' }];
const VACIA = { cliente: null, lineas: [], documento: 'consumidor_final', pago: 'contado', puntos: '', nota: '', corrigiendo: null };
const TECLAS = [
    ['F2', 'Enviar a caja'], ['F3', 'Buscar producto'], ['F4', 'Buscar cliente'], ['F7', 'Otras sucursales'],
    ['F6', 'Vaciar'], ['Supr', 'Quitar producto'], ['↑ ↓', 'Moverse'], ['Esc', 'Limpiar búsqueda'],
];
const ID_BUSCAR_PRODUCTO = 'preventa-buscar-producto';
const ID_BUSCAR_CLIENTE = 'preventa-buscar-cliente';
const enfocar = (id) => { const el = document.getElementById(id); if (el) { el.focus(); el.select?.(); } };

export default function PreventaView({ openModal }) {
    const { user, hasPermission, getScope } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const tactil = useCoarsePointer();
    const todas = getScope('preventa') === 'ALL';
    const puedeVender = hasPermission('preventa', 'can_edit');
    const puedeAutorizar = hasPermission('preventa', 'can_approve');
    const puedeEditarClientes = hasPermission('clientes', 'can_edit');
    const puedeCrearClientes = hasPermission('clientes_crear');
    const puedeApartar = hasPermission('reservas', 'can_edit') || hasPermission('dash_reservas', 'can_edit');
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
        setVenta({ ...VACIA, ...(loadDraft(claveBorrador) ?? {}) });
    }, [claveBorrador]);
    useEffect(() => {
        if (venta.lineas.length || venta.cliente) saveDraft(claveBorrador, venta);
        else clearDraft(claveBorrador);
    }, [venta, claveBorrador]);
    const cambiar = (cambio) => setVenta((v) => ({ ...v, ...cambio }));

    // ── El foco: una orden que se cumple después de pintar ────────────────
    // `{ id }` enfoca ese elemento; `{ cantidad: 'pid-factor' }` el campo de
    // cantidad de ese producto, con el número seleccionado para reescribirlo.
    const [foco, setFoco] = useState(null);
    useEffect(() => {
        if (!foco) return;
        if (foco.cantidad) enfocar(`cantidad-${foco.cantidad}`);
        else if (foco.id) enfocar(foco.id);
        setFoco(null);  
    }, [foco]);
    const alBuscador = useCallback(() => { if (!tactil) setFoco({ id: ID_BUSCAR_PRODUCTO }); }, [tactil]);

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
        setCotizando(true);  
        const t = setTimeout(() => {
            cotizarPreventa(sala, clienteId, JSON.parse(pedido))
                .then((c) => { if (vivo) { setCotizacion(c); setErrorCotizar(''); } })
                .catch((e) => { if (vivo) setErrorCotizar(mensajeAmigable(e, 'No se pudieron revisar los precios.')); })
                .finally(() => { if (vivo) setCotizando(false); });
        }, 200);
        return () => { vivo = false; clearTimeout(t); };
    }, [sala, clienteId, pedido, vuelta]);

    // ── La ficha del cliente: foto, tipo, nivel, puntos ───────────────────
    const [info, setInfo] = useState(null);
    useEffect(() => {
        if (!sala || !clienteId) { setInfo(null); return undefined; }  
        let vivo = true;
        fetchClienteDePreventa(sala, clienteId)
            .then((d) => { if (vivo) setInfo(d); })
            .catch((e) => { if (vivo) { setInfo(null); console.error('PreventaView: ficha del cliente', e); } });
        return () => { vivo = false; };
    }, [sala, clienteId, vuelta]);

    // ── Las fotos de los productos que entraron sin pasar por el buscador ─
    const [fotos, setFotos] = useState(() => new Map());
    const sinFoto = venta.lineas.filter((l) => !l.foto_url && !fotos.has(l.producto_id)).map((l) => l.producto_id).join(',');
    useEffect(() => {
        if (!sinFoto) return undefined;
        let vivo = true;
        fotosDeProductos(sinFoto.split(',')).then((m) => {
            if (vivo) setFotos((prev) => new Map([...prev, ...sinFoto.split(',').map((id) => [Number(id), m.get(Number(id)) ?? null])]));
        });
        return () => { vivo = false; };
    }, [sinFoto]);

    const filaDe = (l) => (cotizacion?.lineas ?? []).find((x) => x.producto_id === l.producto_id && x.factor === l.factor);
    const totales = totalesDe(cotizacion);
    const puntos = Math.trunc(Number(venta.puntos) || 0);
    const descPuntos = descuentoDePuntos(puntos, info?.puntos?.valor);
    const aPagar = Math.max(0, Math.round((totales.total - descPuntos) * 100) / 100);
    const falta = errorCotizar ? { texto: errorCotizar, campo: null }
        : faltaParaEnviar({ lineas: venta.lineas, cotizacion, cotizando, documento: venta.documento, pago: venta.pago, puntos, infoCliente: info });
    const faltanCcf = venta.documento === 'credito_fiscal' && cotizacion ? faltanParaCcf(cotizacion.cliente) : [];
    const maxPuntos = maximoDePuntos(info, totales.total);

    const ponerLinea = (i, cambio) => cambiar({ lineas: venta.lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)) });
    const quitarLinea = (i) => { cambiar({ lineas: venta.lineas.filter((_, j) => j !== i) }); alBuscador(); };
    const agregarProducto = (p) => {
        if (venta.lineas.length >= MAX_PRODUCTOS && !venta.lineas.some((l) => l.producto_id === Number(p.id) && l.factor === 1)) {
            showToast('Llegaste al tope', `Una preventa lleva hasta ${MAX_PRODUCTOS} productos.`, 'warning');
            return;
        }
        cambiar({ lineas: agregarLinea(venta.lineas, p, 1) });
        if (!tactil) setFoco({ cantidad: `${Number(p.id)}-1` });
    };

    // ── El cliente: elegir, editar, crear (el editor del portal) ──────────
    const elegirCliente = (c) => {
        cambiar({ cliente: c ? { id: c.id, name: c.name, phone: c.phone ?? null } : null, puntos: '' });
        if (!tactil) setFoco({ id: c ? ID_BUSCAR_PRODUCTO : ID_BUSCAR_CLIENTE });
    };
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

    // ── Otras sucursales y apartar ────────────────────────────────────────
    const [consulta, setConsulta] = useState(null);      // texto con que se abre la consulta de inventario
    const [apartar, setApartar] = useState(null);        // { producto } o {}
    const cerrarConsulta = () => { setConsulta(null); alBuscador(); };
    const cerrarApartar = () => { setApartar(null); alBuscador(); };
    const cobrar = async ({ clave, monto, apartado, pago, papel }) => {
        const { cobrarAnticipo } = await import('../components/caja/cobrarAnticipo');
        const r = await cobrarAnticipo({ sala, nombreSala, userId: user?.id, quienAtiende: user?.name, clave, monto, apartado, pago, papel });
        if (!r.ok) { showToast('No se pudo cobrar', mensajeAmigable(r.error), 'error'); return false; }
        showToast(r.aviso ? 'Anticipo cobrado, con un pendiente' : 'Anticipo cobrado',
            r.aviso ?? `${r.apartado.codigo} · saldo ${formatMoney(Number(r.apartado.saldo ?? 0))} al retirar`, r.aviso ? 'warning' : 'success');
        if (r.papel) showToast('No se imprimió la constancia', mensajeAmigable(r.papel), 'warning');
        return r.apartado;
    };

    // ── Las preventas de la sucursal ──────────────────────────────────────
    const [dias, setDias] = useState('1');
    const [lista, setLista] = useState(null);
    const [errorLista, setErrorLista] = useState('');
    const recargar = useCallback(() => {
        if (!sala) return;
        fetchPreventasDeSala(sala, Number(dias))
            .then((l) => { setLista(l); setErrorLista(''); })
            .catch((e) => setErrorLista(mensajeAmigable(e, 'No se pudieron leer las preventas.')));
    }, [sala, dias]);
    useEffect(() => { recargar(); }, [recargar]);

    // ── Enviar o corregir ─────────────────────────────────────────────────
    const [enviando, setEnviando] = useState(false);
    const [resultado, setResultado] = useState(null);
    const enviar = async () => {
        if (falta || enviando || !puedeVender) return;
        setEnviando(true);
        const r = await enviarPreventaDirecta({
            branchId: sala, customerId: clienteId, documento: venta.documento, pago: venta.pago, puntos, nota: venta.nota,
            lineas: lineasParaCotizar(venta.lineas), preventaId: venta.corrigiendo?.id ?? null,
        });
        setEnviando(false);
        if (!r?.ok) { showToast('No llegó a caja', r?.error ?? 'Intenta de nuevo.', 'error'); return; }
        setResultado({ ...r, total: aPagar, puntos, cliente: venta.cliente?.name ?? null });
        setVenta(VACIA);
        clearDraft(claveBorrador);
        recargar();
    };
    const nuevaVenta = () => { setResultado(null); setFoco({ id: ID_BUSCAR_CLIENTE }); };

    const corregir = (p) => {
        setVenta({
            ...VACIA, lineas: lineasDeVenta(p.venta),
            cliente: p.customer_id ? { id: p.customer_id, name: p.cliente } : null,
            documento: p.venta?.documento === 'credito_fiscal' ? 'credito_fiscal' : 'consumidor_final',
            pago: p.venta?.pago ?? 'contado', puntos: p.venta?.puntos ? String(p.venta.puntos) : '',
            corrigiendo: { id: p.id, codigo: p.codigo, referencia: p.externo_ref },
        });
        setResultado(null);
        setPestana('nueva');
        alBuscador();
    };
    const repetir = (p) => {
        setVenta({ ...VACIA, lineas: lineasDeVenta(p.venta), cliente: p.customer_id ? { id: p.customer_id, name: p.cliente } : null });
        setResultado(null);
        setPestana('nueva');
        alBuscador();
    };
    const [porAnular, setPorAnular] = useState(null);
    const anular = async () => {
        const p = porAnular;
        setPorAnular(null);
        const r = await anularPreventa(p.id);
        if (!r?.ok) { showToast('No se pudo anular', r?.error ?? 'Intenta de nuevo.', 'error'); return; }
        showToast('Preventa anulada', `La ${p.externo_ref ? `#${p.externo_ref}` : p.codigo} ya no está en caja.`, 'success');
        recargar();
    };
    const [porVaciar, setPorVaciar] = useState(false);
    const vaciar = () => { setPorVaciar(false); setVenta(VACIA); setFoco({ id: ID_BUSCAR_CLIENTE }); };
    const pedirVaciar = () => { if (venta.lineas.length || venta.cliente || venta.corrigiendo) setPorVaciar(true); };

    // ── Al abrir Vender: el foco al primer buscador que haga falta ────────
    const vendiendo = Boolean(sala) && pestana === 'nueva' && !resultado;
    useEffect(() => {
        if (!vendiendo || tactil) return;
        setFoco({ id: venta.cliente || venta.lineas.length ? ID_BUSCAR_PRODUCTO : ID_BUSCAR_CLIENTE });  
    }, [vendiendo, tactil]); // eslint-disable-line react-hooks/exhaustive-deps -- sólo al entrar, no en cada cambio de la venta

    // ── Teclas de la pantalla: las mismas de la caja ──────────────────────
    // Aprietan el MISMO botón que el ratón (si está deshabilitado, nada pasa).
    // Las acciones se leen por ref: el oyente se engancha una vez.
    const acciones = useRef({});
    acciones.current = {
        vendiendo, lineas: venta.lineas, pedirVaciar, quitarLinea,
        existencias: (nombre) => setConsulta((c) => (c != null ? null : nombre ?? '')),
    };
    useEffect(() => {
        const alTeclado = (e) => {
            const a = acciones.current;
            if (!a.vendiendo) return;
            if (document.querySelector('[role="dialog"]')) return; // con un diálogo abierto, las teclas son suyas
            const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
            const k = e.key;
            const fila = e.target?.closest?.('[data-fila]');
            if (k === 'F2' || k === 'F8' || (k === 'Enter' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                document.querySelector('[data-accion-enviar]:not([disabled])')?.click();
            } else if (k === 'F3' || (k === '/' && !enCampo)) { e.preventDefault(); enfocar(ID_BUSCAR_PRODUCTO); }
            else if (k === 'F4') {
                e.preventDefault();
                if (document.getElementById(ID_BUSCAR_CLIENTE)) enfocar(ID_BUSCAR_CLIENTE);
                else document.querySelector('[data-accion-cambiar-cliente]')?.focus();
            } else if (k === 'F6') { e.preventDefault(); a.pedirVaciar(); }
            else if (k === 'F7') {
                e.preventDefault();
                const renglon = fila && a.lineas[Number(fila.dataset.fila)];
                const escrito = document.getElementById(ID_BUSCAR_PRODUCTO)?.value;
                a.existencias(renglon?.nombre ?? escrito ?? '');
            } else if (k === 'Delete' && !enCampo && fila) { e.preventDefault(); a.quitarLinea(Number(fila.dataset.fila)); }
        };
        window.addEventListener('keydown', alTeclado);
        return () => window.removeEventListener('keydown', alTeclado);
    }, []);

    const enCaja = (lista ?? []).filter((p) => p.estado === 'viva').length;
    const pestanas = PESTANAS.map((t) => (t.key === 'hoy' && enCaja ? { ...t, label: `Preventas (${enCaja})` } : t));

    // La píldora del cuerpo: la sucursal (para quien ve todas) y las acciones.
    const accionesVender = [
        { key: 'existencias', icon: PackageSearch, label: 'Otras sucursales', onClick: () => setConsulta('') },
        ...(puedeApartar ? [{ key: 'apartar', icon: ShoppingBag, label: 'Apartar o encargar', onClick: () => setApartar({}) }] : []),
        { key: 'vaciar', icon: Trash2, label: 'Vaciar', soloIcono: true, onClick: pedirVaciar,
            disabled: !(venta.lineas.length || venta.cliente || venta.corrigiendo) },
    ];
    const accionesLista = [{ key: 'actualizar', icon: RefreshCw, label: 'Actualizar', onClick: recargar }];
    const pildora = sala && (
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex-1 min-w-0">
                {pestana === 'nueva' && (
                    <p className="text-body-sm text-content-3">
                        Llega a caja de <span className="font-bold text-content">{nombreSala}</span> con tu nombre como vendedor.
                    </p>
                )}
            </div>
            <div className="flex justify-end min-w-0">
                <FilterBar acciones={pestana === 'nueva' ? accionesVender : accionesLista} activeCount={0}>
                    {todas && opcionesSala.length > 1 && (
                        <FilterBar.Section label="sucursal" fija>
                            <FilterBar.Sucursal value={String(sala ?? '')} onChange={(v) => v && setSalaUrl(v)} options={opcionesSala} ancho="170px" />
                        </FilterBar.Section>
                    )}
                    {pestana === 'hoy' && (
                        <FilterBar.Section label="período">
                            <FilterBar.Opciones value={dias} onChange={setDias} label="Desde" options={DIAS} />
                        </FilterBar.Section>
                    )}
                </FilterBar>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={Receipt} title="Preventa" transparentBody
            filtersContent={<ViewTabBar tabs={pestanas} activeTab={pestana} onTabChange={setPestana} />}>
            <div className="p-3 md:p-5 space-y-3">
                {!sala && <Notice variant="warning">Tu usuario no tiene sucursal asignada.</Notice>}
                {pildora}

                {sala && pestana === 'nueva' && (
                    resultado ? (
                        <Hecho resultado={resultado} onOtra={nuevaVenta} onVer={() => { setResultado(null); setPestana('hoy'); }} />
                    ) : (
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
                            <div className="space-y-3 min-w-0">
                                {venta.corrigiendo && (
                                    <Notice variant="info">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="flex-1">
                                                Corrigiendo la preventa {venta.corrigiendo.referencia ? `#${venta.corrigiendo.referencia}` : venta.corrigiendo.codigo}.
                                                Al guardar, cambia la misma en caja.
                                            </span>
                                            <Button size="sm" variant="ghost" icon={X} onClick={() => { setVenta(VACIA); setFoco({ id: ID_BUSCAR_CLIENTE }); }}>Cancelar</Button>
                                        </div>
                                    </Notice>
                                )}

                                <Cliente cliente={venta.cliente} info={info} cotizacion={cotizacion}
                                    puedeEditar={puedeEditarClientes} puedeCrear={puedeCrearClientes}
                                    onElegir={elegirCliente} onEditar={editarCliente} onCrear={crearCliente} />

                                <section data-surface="card" className="p-3 md:p-4 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-caption font-black text-content-2 uppercase tracking-widest flex items-center gap-1.5">
                                            <ShoppingCart size={13} /> Productos
                                        </h2>
                                        <span className="text-micro text-content-3 tabular-nums">{venta.lineas.length} de {MAX_PRODUCTOS}</span>
                                    </div>
                                    <BuscarProducto onElegir={agregarProducto} />
                                    {venta.lineas.length === 0 ? (
                                        <div className="flex flex-col items-center gap-1.5 py-8 text-content-3">
                                            <Package size={28} strokeWidth={1.5} />
                                            <p className="text-body-sm font-semibold">Busca o escanea un producto para empezar.</p>
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-border-subtle" onKeyDown={navegarRenglones}>
                                            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_130px_118px_160px_84px_36px] gap-2 px-1 pb-1.5 text-micro font-black text-content-3 uppercase tracking-widest">
                                                <span>Producto</span><span>Presentación</span><span className="text-center">Cantidad</span>
                                                <span>Precio</span><span className="text-right">Subtotal</span><span />
                                            </div>
                                            {venta.lineas.map((l, i) => (
                                                <Linea key={`${l.producto_id}-${l.factor}`} indice={i} linea={l} fila={filaDe(l)} cotizando={cotizando}
                                                    foto={l.foto_url ?? fotos.get(l.producto_id) ?? null}
                                                    puedeAutorizar={puedeAutorizar} listaCliente={cotizacion?.lista} puedeApartar={puedeApartar}
                                                    onCambiar={(c) => ponerLinea(i, c)} onQuitar={() => quitarLinea(i)} onListo={alBuscador}
                                                    onOtras={() => setConsulta(filaDe(l)?.nombre ?? l.nombre)}
                                                    onApartar={() => setApartar({ producto: { id: l.producto_id, nombre: filaDe(l)?.nombre ?? l.nombre } })} />
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>

                            <aside data-surface="card" className="p-3 md:p-4 space-y-3 lg:sticky lg:top-3">
                                <SegmentedControl label="Comprobante" value={venta.documento} options={DOCUMENTOS}
                                    onChange={(v) => cambiar({ documento: v })} />
                                {faltanCcf.length > 0 && (
                                    <Notice variant="warning">
                                        <p>Para crédito fiscal le falta: {faltanCcf.join(', ')}.</p>
                                        <div className="mt-2">
                                            {venta.cliente
                                                ? <Button size="sm" variant="secondary" icon={UserPen} onClick={editarCliente}>Completar datos</Button>
                                                : <span className="text-micro">Elige o crea el cliente.</span>}
                                        </div>
                                    </Notice>
                                )}

                                <LiquidSelect label="Tipo de pago" clearable={false} value={venta.pago} options={PAGOS}
                                    onChange={(v) => cambiar({ pago: v || 'contado' })} />
                                {venta.pago === 'credito' && (cotizacion?.generico || !venta.cliente) && (
                                    <p className="text-micro text-warning-text -mt-2">El crédito necesita un cliente con sus datos.</p>
                                )}

                                {info?.puntos?.puede_canjear && (
                                    <div className="space-y-1" data-campo="puntos">
                                        <div className="flex items-end gap-2">
                                            <div className="flex-1">
                                                <PortalInput label="Puntos a canjear" name="puntos" inputMode="numeric" value={String(venta.puntos ?? '')}
                                                    placeholder={`Tiene ${info.puntos.disponibles}`}
                                                    onChange={(e) => cambiar({ puntos: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
                                            </div>
                                            {maxPuntos >= info.puntos.minimo_canje && (
                                                <Button size="sm" variant="secondary" icon={Gift} onClick={() => cambiar({ puntos: String(maxPuntos) })}>
                                                    Usar {maxPuntos}
                                                </Button>
                                            )}
                                        </div>
                                        <p className="text-micro text-content-3">
                                            {puntos > 0 ? `${formatMoney(descPuntos)} de descuento · ` : ''}
                                            {info.puntos.disponibles} disponibles · mínimo {info.puntos.minimo_canje}
                                            {info.puntos.comprometidos > 0 ? ` · ${info.puntos.comprometidos} ya en otra preventa` : ''}
                                        </p>
                                    </div>
                                )}

                                <dl className="space-y-1 text-body-sm border-t border-subtle pt-3">
                                    <div className="flex justify-between"><dt className="text-content-3">Productos · unidades</dt>
                                        <dd className="tabular-nums">{totales.productos} · {totales.unidades}</dd></div>
                                    {(totales.ahorro > 0 || descPuntos > 0) && (
                                        <div className="flex justify-between"><dt className="text-content-3">Subtotal</dt>
                                            <dd className="tabular-nums">{formatMoney(totales.total)}</dd></div>
                                    )}
                                    {totales.ahorro > 0 && (
                                        <div className="flex justify-between"><dt className="text-content-3">Ahorra por su precio</dt>
                                            <dd className="tabular-nums text-success-text font-bold">{formatMoney(totales.ahorro)}</dd></div>
                                    )}
                                    {descPuntos > 0 && (
                                        <div className="flex justify-between"><dt className="text-content-3">Puntos ({puntos})</dt>
                                            <dd className="tabular-nums text-success-text font-bold">−{formatMoney(descPuntos)}</dd></div>
                                    )}
                                    <div className="flex items-end justify-between pt-1">
                                        <dt className="text-caption font-bold text-content-2">A pagar</dt>
                                        <dd className={`text-display font-black tabular-nums leading-none ${cotizando ? 'text-content-3' : 'text-content'}`}>
                                            {formatMoney(aPagar)}
                                        </dd>
                                    </div>
                                </dl>

                                <PortalInput compact label="Nota para caja" name="nota" value={venta.nota} maxLength={60}
                                    onChange={(e) => cambiar({ nota: e.target.value })} placeholder="Opcional" />
                                <AvisoDeFalta motivo={falta?.texto} onIr={falta?.campo ? () => irAlCampo(falta.campo) : null} />
                                <Button className="w-full" size="lg" icon={venta.corrigiendo ? Pencil : Send} loading={enviando}
                                    disabled={!puedeVender || Boolean(falta)} onClick={enviar} data-accion-enviar>
                                    {venta.corrigiendo ? 'Guardar corrección' : 'Enviar a caja'}
                                    {!tactil && <kbd aria-hidden="true" className="ml-1 text-micro font-bold opacity-60">F2</kbd>}
                                </Button>
                                {!puedeVender && <p className="text-micro text-content-3">Puedes mirar, pero no enviar preventas.</p>}
                                {!tactil && <GuiaDeTeclas />}
                            </aside>
                        </div>
                    )
                )}

                {sala && pestana === 'hoy' && (
                    <section className="space-y-2">
                        <p className="text-body-sm text-content-3">{enCaja} en caja sin facturar</p>
                        {errorLista && <Notice variant="danger">{errorLista}</Notice>}
                        {lista && lista.length === 0 && (
                            <div className="flex flex-col items-center gap-1.5 py-10 text-content-3">
                                <ClipboardList size={28} strokeWidth={1.5} />
                                <p className="text-body-sm font-semibold">No hay preventas en este periodo.</p>
                            </div>
                        )}
                        <ul className="flex flex-col gap-2">
                            {(lista ?? []).map((p) => (
                                <Tarjeta key={p.id} p={p} puedeVender={puedeVender}
                                    onCorregir={() => corregir(p)} onRepetir={() => repetir(p)} onAnular={() => setPorAnular(p)} />
                            ))}
                        </ul>
                    </section>
                )}
            </div>

            {consulta != null && (
                <LiquidModal open onClose={cerrarConsulta} maxWidth="max-w-4xl" ariaLabel="Existencia en otras sucursales">
                    <LiquidModal.Header icono={PackageSearch} titulo="Existencia en otras sucursales"
                        subtitulo="Busca el producto y pídelo con «Solicitar»." onClose={cerrarConsulta} />
                    <LiquidModal.Body>
                        <div className="h-[70vh] min-h-0 flex flex-col">
                            <Suspense fallback={<p className="text-body-sm text-content-3 p-4">Cargando…</p>}>
                                <FormularioPedirASala query={consulta} onQueryChange={setConsulta} />
                            </Suspense>
                        </div>
                    </LiquidModal.Body>
                </LiquidModal>
            )}
            {apartar && sala && (
                <Suspense fallback={null}>
                    <DialogoApartar abierto ocupado={false} sala={sala} nombreSala={nombreSala} atiende={user?.name}
                        cobraEnCaja={String(sala) === String(miSala)} onClose={cerrarApartar}
                        inicial={{ cliente: venta.cliente ? { id: venta.cliente.id, name: venta.cliente.name, phone: info?.phone ?? null } : null,
                            producto: apartar.producto ?? null }}
                        onApartado={() => showToast('Listo', 'Quedó en Reservas.', 'success')}
                        onCobrar={cobrar} />
                </Suspense>
            )}

            <ConfirmModal isOpen={Boolean(porAnular)} onClose={() => setPorAnular(null)} onConfirm={anular}
                title={`¿Anular la preventa ${porAnular?.externo_ref ? `#${porAnular.externo_ref}` : porAnular?.codigo ?? ''}?`}
                message="Se borra de caja y ya no se puede facturar. No se puede deshacer." confirmText="Anular" />
            <ConfirmModal isOpen={porVaciar} onClose={() => { setPorVaciar(false); alBuscador(); }} onConfirm={vaciar}
                title={venta.corrigiendo ? '¿Dejar de corregir?' : '¿Vaciar la venta?'}
                message={venta.corrigiendo ? 'La preventa en caja queda como estaba.' : 'Se quitan el cliente y los productos.'}
                confirmText={venta.corrigiendo ? 'Dejar de corregir' : 'Vaciar'} />
        </GlassViewLayout>
    );
}

/*
 * Moverse por los productos con el teclado, como en una hoja (el mismo
 * criterio que la venta de Distribución):
 *   ← →  al campo anterior / siguiente del mismo producto
 *   ↑ ↓  al mismo campo del producto de arriba / abajo
 * En un campo de texto, ← → sólo saltan si el cursor ya está en el borde (o
 * todo está seleccionado). Con un menú abierto las flechas son del menú.
 */
function navegarRenglones(e) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const t = e.target;
    if (t.closest?.('[role="listbox"]') || t.getAttribute?.('aria-expanded') === 'true') return;
    const celda = t.closest?.('[data-col]');
    const fila = t.closest?.('[data-fila]');
    if (!celda || !fila) return;
    if (t.tagName === 'INPUT' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const todo = t.selectionStart === 0 && t.selectionEnd === t.value.length;
        const enBorde = e.key === 'ArrowLeft' ? t.selectionStart === 0 && t.selectionEnd === 0 : t.selectionStart === t.value.length;
        if (!todo && !enBorde) return;
    }
    const col = Number(celda.dataset.col);
    const f = Number(fila.dataset.fila);
    const enfocable = (fi, co) => document.querySelector(`[data-fila="${fi}"] [data-col="${co}"]`)
        ?.querySelector('input:not([disabled]), [role="combobox"]:not([aria-disabled="true"]), button:not([disabled])');
    let el = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const paso = e.key === 'ArrowLeft' ? -1 : 1;
        for (let c = col + paso; c >= 0 && c <= 3 && !el; c += paso) el = enfocable(f, c);
    } else {
        const otra = e.key === 'ArrowUp' ? f - 1 : f + 1;
        el = enfocable(otra, col) ?? enfocable(otra, 1);
    }
    if (!el) return;
    e.preventDefault();
    el.focus();
    if (el.tagName === 'INPUT') el.select();
}

/**
 * Una lista de resultados que se recorre con el teclado sin sacar el foco del
 * buscador: ↑ ↓ mueven el resaltado, Enter elige, Esc limpia. El resaltado
 * vuelve al primero cada vez que cambian los resultados.
 */
function useListaConTeclas(items, onElegir, onLimpiar) {
    const [activo, setActivo] = useState(0);
    const [previos, setPrevios] = useState(items);
    if (items !== previos) { setPrevios(items); setActivo(0); }
    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setActivo((i) => Math.min(i + 1, items.length - 1)); }
        else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter' && items[activo]) { e.preventDefault(); onElegir(items[activo]); }
        else if (e.key === 'Escape') { e.preventDefault(); onLimpiar(); }
    };
    return { activo, setActivo, onKeyDown };
}

// La miniatura de un producto: su foto o la caja vacía. Las fotos del catálogo
// son públicas y van tal cual.
function Miniatura({ src, tamano = 'w-10 h-10' }) {
    const [rota, setRota] = useState(false);
    const [previa, setPrevia] = useState(src);
    if (src !== previa) { setPrevia(src); setRota(false); }
    return (
        <span className={`${tamano} shrink-0 rounded-lg bg-surface-card-hover border border-border-card overflow-hidden flex items-center justify-center`}>
            {src && !rota
                ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setRota(true)} className="w-full h-full object-contain" />
                : <Package size={16} strokeWidth={1.5} className="text-content-3" />}
        </span>
    );
}

function GuiaDeTeclas() {
    return (
        <dl className="hidden lg:grid grid-cols-2 gap-x-3 gap-y-1 border-t border-subtle pt-3 text-micro text-content-3">
            {TECLAS.map(([k, que]) => (
                <div key={k} className="flex items-center gap-1.5 min-w-0">
                    <dt><kbd className="inline-block min-w-[2rem] text-center rounded border border-border-card bg-surface-card-hover px-1 font-bold text-content-2">{k}</kbd></dt>
                    <dd className="truncate">{que}</dd>
                </div>
            ))}
        </dl>
    );
}

// ── El cliente: buscar, ver su ficha, editar o crear ──────────────────────
function Cliente({ cliente, info, cotizacion, puedeEditar, puedeCrear, onElegir, onEditar, onCrear }) {
    const [texto, setTexto] = useState('');
    const q = useTextoRebotado(texto, 250);
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const idLista = useId();
    useEffect(() => {
        let vivo = true;
        if (cliente || q.trim().length < 3) { setResultados([]); setBuscando(false); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
        setBuscando(true);
        buscarClientes(q, { select: 'id, name, dui, nit, nrc, phone, categoria', limite: 6 }).then(({ data, error }) => {
            if (!vivo) return;
            setBuscando(false);
            if (error) console.error('PreventaView: no se pudo buscar el cliente', error);
            setResultados(data ?? []);
        });
        return () => { vivo = false; };
    }, [q, cliente]);

    const elegir = (x) => { setTexto(''); onElegir(x); };
    const nav = useListaConTeclas(resultados, elegir, () => setTexto(''));
    const abierto = resultados.length > 0;
    return (
        <section data-surface="card" className="p-3 md:p-4 space-y-3" data-campo="cliente">
            <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-caption font-black text-content-2 uppercase tracking-widest flex items-center gap-1.5">
                    <UserRound size={13} /> Cliente
                </h2>
                <Badge variant={cotizacion?.generico ? 'neutral' : 'success'} size="sm" uppercase={false}>
                    Precio {nombreDeLista(cotizacion?.lista)}
                </Badge>
                <span className="text-micro text-content-3 hidden sm:inline">{porQueEsaLista(cotizacion?.lista, cotizacion?.generico ?? !cliente)}</span>
            </div>
            {cliente ? (
                <FichaDelCliente cliente={cliente} info={info} puedeEditar={puedeEditar} onEditar={onEditar} onQuitar={() => onElegir(null)} />
            ) : (
                <>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                            <SearchInput id={ID_BUSCAR_CLIENTE} value={texto} onChange={setTexto} loading={buscando}
                                placeholder="Nombre, DUI, NIT o teléfono · sin cliente va como frecuente"
                                ariaLabel="Buscar cliente" onKeyDown={nav.onKeyDown}
                                combobox={{ lista: idLista, abierto, activo: abierto ? `${idLista}-${nav.activo}` : null }} />
                        </div>
                        {puedeCrear && <Button variant="secondary" icon={UserPlus} onClick={onCrear}>Nuevo</Button>}
                    </div>
                    {abierto && (
                        <ul id={idLista} role="listbox" aria-label="Clientes encontrados"
                            className="rounded-xl border border-border-subtle divide-y divide-border-subtle overflow-hidden">
                            {resultados.map((x, i) => (
                                <li key={x.id} id={`${idLista}-${i}`} role="option" aria-selected={i === nav.activo}
                                    onMouseEnter={() => nav.setActivo(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(x)}
                                    className={`px-3 py-2 min-h-[var(--tap-min)] flex items-center gap-3 cursor-pointer active:scale-[0.99] ${i === nav.activo ? 'bg-brand/10' : ''}`}>
                                    <ClienteAvatar conversacion={{ cliente: x.name }} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-body-sm font-semibold text-content truncate">{x.name}</span>
                                        <span className="block text-micro text-content-3 truncate">
                                            {[x.nit && `NIT ${x.nit}`, !x.nit && x.dui && `DUI ${x.dui}`, x.nrc && `NRC ${x.nrc}`, x.phone].filter(Boolean).join(' · ') || 'Sin datos'}
                                        </span>
                                    </span>
                                    {x.categoria && x.categoria !== 'Consumidor' && <Badge size="sm" variant="info" uppercase={false}>{x.categoria}</Badge>}
                                </li>
                            ))}
                        </ul>
                    )}
                    {!buscando && q.trim().length >= 3 && resultados.length === 0 && (
                        <p className="text-micro text-content-3">
                            No aparece «{q.trim()}».{puedeCrear ? ' Créalo con «Nuevo».' : ''}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}

// ── La ficha: quién es, qué precio y beneficios tiene, cómo contactarlo ───
function FichaDelCliente({ cliente, info, puedeEditar, onEditar, onQuitar }) {
    const p = info?.puntos;
    const tipo = info?.empleado ? 'Empleado' : info?.programa === 'mayorista'
        ? `Mayorista${info?.mayorista?.precio === 'mayoreo_plus' ? ' Plus' : ''}${info?.rango ? ` · ${info.rango}` : ''}`
        : NOMBRE_DE_PROGRAMA[info?.programa] ?? '';
    const datos = [
        info?.nit && ['NIT', info.nit], !info?.nit && info?.dui && ['DUI', info.dui], info?.nrc && ['NRC', info.nrc],
        info?.giro && ['Giro', info.giro], info?.phone && ['Teléfono', info.phone], info?.email && ['Correo', info.email],
        info?.direccion && ['Dirección', info.direccion],
    ].filter(Boolean);
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3">
                {/* La foto que subió desde la app, dentro del aro de su nivel (el mismo del chat). */}
                <ClienteAvatar size="lg" animado conversacion={{
                    cliente: cliente.name, foto_url: info?.foto ?? null, nivel: info?.nivel?.toLowerCase() ?? null,
                    es_mayoreo: info?.programa === 'mayorista', rango: info?.rango ?? null, es_team: Boolean(info?.empleado),
                }} />
                <div className="min-w-0 flex-1">
                    <p className="text-body font-bold text-content truncate">{cliente.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {info?.categoria && <Badge size="sm" variant={info.categoria === 'Consumidor' ? 'neutral' : 'info'} uppercase={false}>{info.categoria}</Badge>}
                        {tipo && <Badge size="sm" variant="neutral" uppercase={false}>{tipo}</Badge>}
                        {info?.nivel && <Badge size="sm" variant="warning" uppercase={false}>Nivel {info.nivel}</Badge>}
                    </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {puedeEditar && <Button size="sm" variant="secondary" icon={UserPen} onClick={onEditar}>Editar</Button>}
                    <Button size="sm" variant="ghost" icon={X} iconOnly aria-label="Cambiar de cliente"
                        onClick={onQuitar} data-accion-cambiar-cliente />
                </div>
            </div>
            {info && (
                <div className="grid grid-cols-3 gap-2">
                    <Dato rotulo="Puntos" valor={p ? `${p.disponibles}` : '—'} destacado={p?.puede_canjear && p.disponibles > 0}
                        nota={p ? (p.puede_canjear ? `= ${formatMoney(descuentoDePuntos(p.disponibles, p.valor))}` : 'No canjea') : null} />
                    <Dato rotulo="Compra 12 meses" valor={info.compra_12m != null ? formatMoney(info.compra_12m) : '—'} />
                    <Dato rotulo="Última compra" valor={info.ultima_compra ? fechaTexto(info.ultima_compra.fecha) : '—'}
                        nota={info.ultima_compra ? `${formatMoney(info.ultima_compra.total)} · ${info.ultima_compra.sucursal ?? ''}` : null} />
                </div>
            )}
            {datos.length > 0 && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-micro">
                    {datos.map(([k, v]) => (
                        <div key={k} className="flex gap-1.5 min-w-0">
                            <dt className="text-content-3 shrink-0">{k}</dt>
                            <dd className="text-content-2 truncate" title={v}>{v}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}

function Dato({ rotulo, valor, nota = null, destacado = false }) {
    return (
        <div className={`rounded-xl px-3 py-2 min-w-0 ${destacado ? 'bg-success/10' : 'bg-surface-card-hover'}`}>
            <p className="text-micro text-content-3 truncate">{rotulo}</p>
            <p className={`text-body font-black tabular-nums truncate ${destacado ? 'text-success-text' : 'text-content'}`}>{valor}</p>
            {nota && <p className="text-micro text-content-3 truncate">{nota}</p>}
        </div>
    );
}

// ── Buscar producto: foto, ↑ ↓ y Enter; el lector de código entra igual ──
// 150 ms y dos letras, las medidas de `BuscadorDeProducto`.
function BuscarProducto({ onElegir }) {
    const [texto, setTexto] = useState('');
    const q = useTextoRebotado(texto, 150);
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const idLista = useId();
    useEffect(() => {
        let vivo = true;
        if (q.trim().length < 2) { setResultados([]); setBuscando(false); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- vaciar al borrar
        setBuscando(true);
        buscarProductosMinMax(q, 8).then(({ filas }) => {
            if (!vivo) return;
            setResultados(filas ?? []);
            setBuscando(false);
        });
        return () => { vivo = false; };
    }, [q]);
    const elegir = (p) => { setTexto(''); setResultados([]); onElegir(p); };
    const nav = useListaConTeclas(resultados, elegir, () => setTexto(''));
    const abierto = resultados.length > 0;
    return (
        <div data-campo="buscarProducto" className="space-y-1.5">
            <SearchInput id={ID_BUSCAR_PRODUCTO} value={texto} onChange={setTexto} loading={buscando}
                placeholder="Buscar producto o escanear · Enter agrega el resaltado" ariaLabel="Buscar producto"
                onKeyDown={nav.onKeyDown} combobox={{ lista: idLista, abierto, activo: abierto ? `${idLista}-${nav.activo}` : null }} />
            {!buscando && q.trim().length >= 2 && !abierto && <p className="text-micro text-content-3">Sin resultados para «{q.trim()}».</p>}
            {abierto && (
                <ul id={idLista} role="listbox" aria-label="Productos encontrados"
                    className="rounded-xl border border-border-subtle divide-y divide-border-subtle max-h-80 overflow-y-auto overscroll-contain">
                    {resultados.map((p, i) => (
                        <li key={p.id} id={`${idLista}-${i}`} role="option" aria-selected={i === nav.activo}
                            onMouseEnter={() => nav.setActivo(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(p)}
                            className={`px-3 py-2 min-h-[var(--tap-min)] flex items-center gap-3 cursor-pointer active:scale-[0.99] ${i === nav.activo ? 'bg-brand/10' : ''}`}>
                            <Miniatura src={p.foto_url} />
                            <span className="min-w-0 flex-1">
                                <span className="block text-body-sm font-semibold text-content truncate">{p.nombre}</span>
                                <span className="block text-micro text-content-3 truncate">
                                    {[p.principio_activo, p.laboratorio_nombre].filter(Boolean).join(' · ')}
                                </span>
                            </span>
                            {i === nav.activo && <kbd aria-hidden="true" className="hidden md:inline text-micro font-bold text-content-3">Enter</kbd>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Un producto de la venta, en una fila ──────────────────────────────────
function Linea({ indice, linea, fila, foto, cotizando, puedeAutorizar, listaCliente, puedeApartar, onCambiar, onQuitar, onListo, onOtras, onApartar }) {
    const presentaciones = (fila?.presentaciones ?? [{ factor: linea.factor, tipo: '…' }])
        .map((p) => ({ value: String(p.factor), label: p.tipo }));
    const cant = Number(linea.cantidad) || 0;
    const opciones = opcionesDePrecio(fila?.precios);
    const precioCliente = fila && !linea.lista ? fila.precio : null;
    const opcionesPrecio = [
        { value: '', label: `Del cliente${precioCliente != null ? ` · ${formatMoney(precioCliente)}` : ''}` },
        ...opciones.map((o) => ({ value: o.lista, label: `${o.nombre} · ${formatMoney(o.precio)}` })),
    ];
    const sinExistencia = fila && fila.existencia < cant * linea.factor;
    const nombre = fila?.nombre ?? linea.nombre;
    return (
        <div className="py-2.5 px-1 rounded-lg focus-within:bg-brand/5" data-fila={indice} data-campo={`linea-${linea.producto_id}-${linea.factor}`}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_130px_118px_160px_84px_36px] gap-x-2 gap-y-2 items-center">
                <div className="min-w-0 flex items-center gap-2.5">
                    <Miniatura src={foto} />
                    <div className="min-w-0">
                        <p className="text-body-sm font-semibold text-content leading-tight truncate" title={nombre}>{nombre}</p>
                        <p className="text-micro text-content-3 flex flex-wrap items-center gap-x-1.5">
                            {fila?.bajo_receta && <span className="text-warning-text font-bold">Bajo Receta</span>}
                            {fila && <span className={sinExistencia ? 'text-danger-text font-bold' : ''}>Existencia {fila.existencia}</span>}
                            {fila?.lista && !linea.lista && fila.lista !== listaCliente && <span>· {nombreDeLista(fila.lista)} en esta presentación</span>}
                        </p>
                    </div>
                </div>
                <Button size="sm" variant="ghost" icon={X} iconOnly aria-label={`Quitar ${nombre}`} onClick={onQuitar} className="md:hidden" />
                <div className="col-span-2 md:col-span-1 flex flex-wrap md:contents items-center gap-2">
                    <div className="w-32 md:w-auto" data-col="0">
                        <LiquidSelect clearable={false} value={String(linea.factor)} options={presentaciones} ariaLabel={`Presentación de ${nombre}`}
                            disabled={presentaciones.length < 2} onChange={(v) => onCambiar({ factor: Number(v) || 1 })} />
                    </div>
                    <div className="flex items-center gap-0.5" data-col="1">
                        <Button size="xs" variant="ghost" icon={Minus} iconOnly aria-label="Una menos" tabIndex={-1}
                            onClick={() => onCambiar({ cantidad: Math.max(1, cant - 1) })} />
                        <div className="w-14">
                            <PortalInput compact inputMode="numeric" name={`cantidad-${linea.producto_id}-${linea.factor}`}
                                value={String(linea.cantidad)} aria-label={`Cantidad de ${nombre}`}
                                onFocus={(e) => e.target.select()}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onListo(); } }}
                                onChange={(e) => onCambiar({ cantidad: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                        </div>
                        <Button size="xs" variant="ghost" icon={Plus} iconOnly aria-label="Una más" tabIndex={-1}
                            onClick={() => onCambiar({ cantidad: Math.min(999, cant + 1) })} />
                    </div>
                    <div className="min-w-[9rem] flex-1 md:flex-none" data-col="2">
                        {puedeAutorizar ? (
                            <LiquidSelect clearable={false} value={linea.lista ?? ''} options={opcionesPrecio} ariaLabel={`Precio de ${nombre}`}
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
                    <div className="hidden md:block" data-col="3">
                        <Button size="sm" variant="ghost" icon={X} iconOnly aria-label={`Quitar ${nombre}`} title="Quitar (Supr)" onClick={onQuitar} />
                    </div>
                </div>
            </div>
            {fila?.error && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 md:pl-[3.125rem]">
                    <p className="text-micro text-danger-text font-semibold">
                        {fila.error}
                        {fila.otras?.length > 0 && (
                            <span className="text-content-3 font-normal"> Hay en {fila.otras.map((o) => `${o.sucursal} (${o.disponibles})`).join(', ')}.</span>
                        )}
                    </p>
                    {sinExistencia && (
                        <>
                            <Button size="xs" variant="ghost" icon={PackageSearch} onClick={onOtras}>Solicitar a otra sucursal</Button>
                            {puedeApartar && <Button size="xs" variant="ghost" icon={ShoppingBag} onClick={onApartar}>Apartar o encargar</Button>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Lo que quedó en caja ──────────────────────────────────────────────────
function Hecho({ resultado, onOtra, onVer }) {
    return (
        <section data-surface="card" className="p-6 md:p-8 max-w-lg mx-auto text-center space-y-3">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest">
                {resultado.corregida ? 'Corrección guardada en caja' : 'Preventa en caja'}
            </p>
            <p className="text-display font-black tabular-nums text-brand-text">#{resultado.referencia}</p>
            <p className="text-body text-content-2">
                {resultado.cliente ?? 'Cliente frecuente'} · {formatMoney(resultado.total_caja ?? resultado.total)}
                {resultado.puntos > 0 ? ` · ${resultado.puntos} puntos canjeados` : ''}
            </p>
            <p className="text-body-sm text-content-3">Dile al cliente que pase a caja con el número #{resultado.referencia}.</p>
            {(resultado.avisos ?? []).map((a) => <Notice key={a} variant="warning">{a}</Notice>)}
            <div className="flex flex-wrap justify-center gap-2 pt-2">
                {/* El foco queda aquí: Enter empieza la siguiente. */}
                <Button icon={Plus} onClick={onOtra} autoFocus>Nueva preventa</Button>
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
            <button type="button" onClick={() => setAbierta((a) => !a)} aria-expanded={abierta}
                className="flex items-center gap-3 text-left min-h-[var(--tap-min)] rounded-lg active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-brand">
                <span className="text-title font-black tabular-nums text-content w-16 shrink-0">{p.externo_ref ? `#${p.externo_ref}` : '—'}</span>
                <span className="flex-1 min-w-0">
                    <span className="block text-body-sm font-bold text-content truncate">{p.cliente ?? 'Cliente frecuente'}</span>
                    <span className="block text-micro text-content-3 truncate">
                        {p.codigo} · {hora12(p.enviada_at ?? p.created_at)} · {shortEmployeeName({ name: p.vendedor })}
                        {pago ? ` · ${pago}` : ''}{p.venta?.documento === 'credito_fiscal' ? ' · Crédito fiscal' : ''}
                        {p.venta?.puntos > 0 ? ` · ${p.venta.puntos} puntos` : ''}
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
                        {p.venta?.descuento_puntos > 0 && (
                            <li className="flex justify-between gap-2 text-success-text">
                                <span>Descuento por puntos ({p.venta.puntos})</span>
                                <span className="tabular-nums">−{formatMoney(p.venta.descuento_puntos)}</span>
                            </li>
                        )}
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
