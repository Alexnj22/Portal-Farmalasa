import React, { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowDownLeft, ArrowUpRight, Ban, CheckCircle2, Layers, Wallet, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, FileText, Gift, History, Minus, Package, PackageSearch, Pencil, Plus, Receipt,
    RefreshCw, Send, ShoppingBag, ShoppingCart, Trash2, UserPen, UserPlus, UserRound, X,
} from 'lucide-react';
import { MonitorSmartphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import LiquidSelect from '../components/common/LiquidSelect';
import Popover from '../components/common/Popover';
import LiquidModal from '../components/common/LiquidModal';
import SegmentedControl from '../components/common/SegmentedControl';
import PortalInput from '../components/common/PortalInput';
import SearchInput from '../components/common/SearchInput';
import ConfirmModal from '../components/common/ConfirmModal';
import TituloDeSeccion from '../components/common/TituloDeSeccion';
import ClienteAvatar from './chat-clientes/ClienteAvatar';
import { irAlCampo } from '../plataforma/irAlCampo';
import useAnclaje from '../plataforma/useAnclaje';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useCoarsePointer } from '../plataforma/useCoarsePointer';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarClientes } from '@nucleo/data/customers';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import {
    anularPreventa, cotizarPreventa, enviarPreventaDirecta, fetchClienteDePreventa, fetchPreventasDeSala, fotosDeProductos, lotesDePreventa,
    ensayarCobro,
} from '@nucleo/data/preventas';
import { estadoDeCaja } from '@nucleo/data/bolsas';
import {
    MAX_PRODUCTOS, NOMBRE_DE_PROGRAMA, PAGOS, agregarLinea, datosQueFaltan, descuentoDePuntos, estadoDePreventa,
    faltanParaCcf, diferenciasDelCobro, lineasDeVenta, lineasParaCotizar, lineasParaEnviar, maximoDePuntos, opcionesDePresentacion, montoDelCorreo, mesDeVencimiento, mismoLote, planDeLotes, queCompletar, nombreDeComprobante, nombreDeLista, opcionesDePrecio,
    porQueEsaLista, problemasDeVenta, sePuedeAnular, sePuedeCorregir, totalesDe, vencePronto,
} from '@nucleo/utils/preventaDirecta';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { datosDeLoBuscado, esContribuyente } from '@nucleo/utils/clienteValidacion';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { esDemo, marcarCobradaEnMuestra } from '../components/timeclock/demoDelKiosco';

// Lo que sólo hace falta al apretar un botón no viaja con la vista.
const FormularioPedirASala = lazy(() =>
    import('./dashboard/inventario/PanelDeInventario').then((m) => ({ default: m.FormularioPedirASala })));
const DialogoApartar = lazy(() => import('../components/caja/DialogoApartar'));

// ═══════════════════════════════════════════════════════════════════════════
// Preventa — vender desde el portal y que la venta llegue armada a caja.
//
// Quinta vuelta (2026-11-16, usuario: «ocupa demasiado espacio, debe ser más
// compacto pero igual de informativo; los datos del cliente bien
// estructurados, avisar si falta un dato importante, ver sus últimas compras;
// los avisos se salen del cuadro y deben dar sugerencias; validaciones más
// agresivas y visuales»):
// · El cliente en un bloque denso: cara, nombre, tipo y nivel en una fila;
//   sus cifras al lado; sus datos en una grilla donde lo que falta se ve
//   («Falta»), y una franja que dice qué falta con «Completar datos».
// · «Suele llevar» (lo que más compra en 12 meses) y «Últimas compras»
//   (las 5 últimas con sus productos): todo se agrega con un toque.
// · Validación: TODOS los problemas a la vez (`problemasDeVenta`), cada uno
//   con qué hacer y un botón que lo hace (dejar lo que alcanza, pedir a otra
//   sucursal, apartar, quitar, completar datos, cambiar a Factura…). La fila
//   con problema se pinta en rojo y el campo culpable queda marcado.
//
// Cuarta vuelta: sucursal en la píldora (`FilterBar.Sucursal`), fotos del
// cliente y de los productos, y teclado con las mismas teclas que la caja:
//     F2 · F8 · Ctrl+Enter  enviar a caja        F3 · /  buscar producto
//     F4  buscar cliente                          F6      vaciar (confirma)
//     F7  existencia en otras sucursales          Supr    quitar el producto
//     ↑ ↓ en un buscador recorre la lista, Enter elige, Esc limpia; en los
//     productos ← → cambia de campo, ↑ ↓ de producto, Enter vuelve al buscador.
// El foco va solo a donde sigue el trabajo; en el teléfono no se enfoca nada
// solo (abriría el teclado encima de la pantalla).
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
    { value: 'consumidor_final', label: 'Factura', icon: Receipt, description: 'Consumidor final' },
    { value: 'credito_fiscal', label: 'Crédito fiscal', icon: FileText, description: 'Con NIT y NRC' },
];
const DIAS = [{ value: '1', label: 'Hoy' }, { value: '7', label: '7 días' }, { value: '30', label: '30 días' }];
const VACIA = { cliente: null, lineas: [], documento: 'consumidor_final', pago: 'contado', puntos: '', nota: '', corrigiendo: null };
// Cobrando en el kiosco: la misma mano, con lo que hace falta para cobrar.
const TECLAS_COBRO = [['F2', 'Cobrar'], ['F9', 'Escribir lo recibido'], ['F3', 'Buscar producto'], ['F4', 'Cambiar cliente'],
    ['F7', 'Ver en otras sucursales'], ['F10', 'Anular la preventa'], ['Supr', 'Quitar el producto elegido'], ['Esc', 'Cerrar la preventa sin cobrar']];
const TECLAS = [['F2', 'Enviar'], ['F3', 'Producto'], ['F4', 'Cliente'], ['F7', 'Otras sucursales'], ['F6', 'Vaciar'], ['Supr', 'Quitar']];
const ID_BUSCAR_PRODUCTO = 'preventa-buscar-producto';
const ID_BUSCAR_CLIENTE = 'preventa-buscar-cliente';
const enfocar = (id) => { const el = document.getElementById(id); if (el) { el.focus(); el.select?.(); } };
const claveDe = (l) => `${l.producto_id}-${l.factor}`;
const conMayuscula = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/**
 * `enKiosco` (2026-11-17): la venta dentro del kiosco de caja. Sin el marco de
 * la vista (el kiosco ya tiene su barra); las pestañas van arriba del cuerpo.
 * El cuerpo y los diálogos son los mismos.
 */
export default function PreventaView({ openModal, enKiosco = false, cobrando = null, onTerminarCobro, activa = true, onMovimientoDeCaja }) {
    const { user, hasPermission, getScope } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const navigate = useNavigate();
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
    // Cobrando (kiosco de caja): la venta sale de la preventa y no del borrador.
    const claveBorrador = cobrando ? `cobro-${cobrando.id}` : `preventa-${sala ?? 'x'}`;
    const [venta, setVenta] = useState(() => (cobrando ? ventaDeCobro(cobrando, puedeAutorizar) : { ...VACIA, ...(loadDraft(claveBorrador) ?? {}) }));
    const salaPrevia = useRef(claveBorrador);
    useEffect(() => {
        if (salaPrevia.current === claveBorrador) return;
        salaPrevia.current = claveBorrador;
        setVenta({ ...VACIA, ...(loadDraft(claveBorrador) ?? {}) });
    }, [claveBorrador]);
    useEffect(() => {
        if (cobrando) return;
        if (venta.lineas.length || venta.cliente) saveDraft(claveBorrador, venta);
        else clearDraft(claveBorrador);
    }, [venta, claveBorrador, cobrando]);
    const cambiar = (cambio) => setVenta((v) => ({ ...v, ...cambio }));

    // La cola del kiosco trae sólo el resumen del ticket (nombre, cantidad,
    // subtotal). La venta completa —productos, presentación, lote, cliente—
    // se lee de la preventa misma. Sin esto el cobro abría VACÍO (Salud 4,
    // 2026-11-17: en la muestra funcionaba porque trae la venta entera).
    const [cargaCobro, setCargaCobro] = useState(cobrando && !cobrando.venta ? 'cargando' : null);
    useEffect(() => {
        if (!cobrando || cobrando.venta || !sala) return undefined;
        let vivo = true;
        fetchPreventasDeSala(sala, 2).then((filas) => {
            if (!vivo) return;
            const p = filas.find((f) => Number(f.id) === Number(cobrando.id));
            if (!p?.venta) { setCargaCobro('No se pudo abrir esta preventa. Cóbrala en la caja.'); return; }
            setVenta(ventaDeCobro({ ...p, referencia: cobrando.referencia ?? p.externo_ref }, puedeAutorizar));
            setCargaCobro(null);
        }).catch(() => { if (vivo) setCargaCobro('No se pudo abrir esta preventa. Intenta de nuevo.'); });
        return () => { vivo = false; };
    }, [cobrando, sala, puedeAutorizar]);

    // ── El foco: una orden que se cumple después de pintar ────────────────
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

    // ── La ficha del cliente: foto, tipo, nivel, puntos, compras ──────────
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

    // ── Los lotes de cada producto en la sucursal (en el orden de caja) ───
    const [lotes, setLotes] = useState(() => new Map());
    const idsDeLotes = [...new Set(venta.lineas.map((l) => l.producto_id))].sort((a, b) => a - b).join(',');
    useEffect(() => {
        if (!sala || !idsDeLotes) { setLotes(new Map()); return undefined; }
        let vivo = true;
        lotesDePreventa(sala, idsDeLotes.split(','))
            .then((m) => { if (vivo) setLotes(m); })
            .catch((e) => { if (vivo) console.error('PreventaView: lotes', e); });
        return () => { vivo = false; };
    }, [sala, idsDeLotes, vuelta]);

    const filaDe = (l) => (cotizacion?.lineas ?? []).find((x) => x.producto_id === l.producto_id && x.factor === l.factor);
    const totales = totalesDe(cotizacion);
    const puntos = Math.trunc(Number(venta.puntos) || 0);
    const descPuntos = descuentoDePuntos(puntos, info?.puntos?.valor);
    const aPagar = Math.max(0, Math.round((totales.total - descPuntos) * 100) / 100);
    const maxPuntos = maximoDePuntos(info, totales.total);

    // Todo lo que impide enviar, con qué hacer. Las acciones que el usuario
    // no puede usar no se ofrecen.
    const problemas = useMemo(() => {
        if (errorCotizar) return [{ clave: 'cotizar', titulo: errorCotizar, ayuda: 'Revisa la conexión e intenta de nuevo.', acciones: [{ id: 'reintentar', label: 'Reintentar' }] }];
        return problemasDeVenta({ lineas: venta.lineas, cotizacion: cotizando ? null : cotizacion, documento: venta.documento,
            pago: venta.pago, puntos, infoCliente: info, hayCliente: Boolean(venta.cliente) })
            .map((p) => ({ ...p, acciones: p.acciones.filter((a) => (a.id !== 'apartar' || puedeApartar) && (a.id !== 'editar' || puedeEditarClientes)) }));
    }, [errorCotizar, venta.lineas, venta.documento, venta.pago, venta.cliente, cotizacion, cotizando, puntos, info, puedeApartar, puedeEditarClientes]);
    const revisando = !errorCotizar && venta.lineas.length > 0 && (cotizando || !cotizacion);
    const problemaDeLinea = (l) => problemas.find((p) => p.linea === claveDe(l));
    const clienteConProblema = problemas.some((p) => p.clave === 'ccf' || p.clave === 'credito');
    const faltanCcf = venta.documento === 'credito_fiscal' && venta.cliente && cotizacion ? faltanParaCcf(cotizacion.cliente) : [];

    const ponerLinea = (i, cambio) => cambiar({ lineas: venta.lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)) });
    const quitarLinea = (i) => { cambiar({ lineas: venta.lineas.filter((_, j) => j !== i) }); alBuscador(); };
    const agregarProducto = (p, cantidad = 1) => {
        if (venta.lineas.length >= MAX_PRODUCTOS && !venta.lineas.some((l) => l.producto_id === Number(p.id) && l.factor === 1)) {
            showToast('Llegaste al tope', `Una preventa lleva hasta ${MAX_PRODUCTOS} productos. Envía esta y empieza otra.`, 'warning');
            return;
        }
        cambiar({ lineas: agregarLinea(venta.lineas, p, 1).map((l) => (l.producto_id === Number(p.id) && l.factor === 1 && cantidad > 1
            ? { ...l, cantidad: Math.min(999, (Number(l.cantidad) || 0) - 1 + cantidad) } : l)) });
        if (!tactil) setFoco({ cantidad: `${Number(p.id)}-1` });
    };
    const agregarVarios = (productos) => {
        let lineas = venta.lineas;
        for (const p of productos) {
            if (lineas.length >= MAX_PRODUCTOS) break;
            lineas = agregarLinea(lineas, { id: p.producto_id, nombre: p.nombre, foto_url: p.foto_url }, 1);
        }
        cambiar({ lineas });
        showToast('Agregados', `${productos.length} producto(s) de esa compra. Revisa las cantidades.`, 'success');
        alBuscador();
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
            completar: queCompletar(venta.documento, info ?? cotizacion?.cliente),
            onSaved: () => setVuelta((n) => n + 1),
        });
    };
    const crearCliente = (buscado = '') => {
        openModal?.('editCliente', {
            nombre: 'Nuevo cliente', canEdit: true, inicial: datosDeLoBuscado(buscado),
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

    // ── Lo que hace cada sugerencia ───────────────────────────────────────
    const resolver = (p, a) => {
        const i = p.linea ? venta.lineas.findIndex((l) => claveDe(l) === p.linea) : -1;
        const linea = i >= 0 ? venta.lineas[i] : null;
        const nombre = linea ? (filaDe(linea)?.nombre ?? linea.nombre) : '';
        switch (a.id) {
            case 'buscar': enfocar(ID_BUSCAR_PRODUCTO); break;
            case 'ajustar': if (i >= 0) { ponerLinea(i, { cantidad: a.valor }); if (!tactil) setFoco({ cantidad: p.linea }); } break;
            case 'otras': setConsulta(nombre); break;
            case 'apartar': setApartar({ producto: linea ? { id: linea.producto_id, nombre } : null }); break;
            case 'quitar': if (i >= 0) quitarLinea(i); break;
            case 'editar': editarCliente(); break;
            case 'cliente': setFoco({ id: ID_BUSCAR_CLIENTE }); break;
            case 'factura': cambiar({ documento: 'consumidor_final' }); break;
            case 'ccf': cambiar({ documento: 'credito_fiscal' }); break;
            case 'contado': cambiar({ pago: 'contado' }); break;
            case 'puntos': cambiar({ puntos: a.valor ? String(a.valor) : '' }); break;
            case 'reintentar': setVuelta((n) => n + 1); break;
            default: break;
        }
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
    const bloqueada = problemas.length > 0 || revisando;
    const enviar = async () => {
        if (bloqueada || enviando || !puedeVender) return;
        setEnviando(true);
        const r = await enviarPreventaDirecta({
            branchId: sala, customerId: clienteId, documento: venta.documento, pago: venta.pago, puntos, nota: venta.nota,
            lineas: lineasParaEnviar(venta.lineas), preventaId: venta.corrigiendo?.id ?? null,
            // Lo que se ve es lo que se manda: si la base calcula otro total, frena.
            totalEsperado: aPagar,
        });
        setEnviando(false);
        if (!r?.ok) { showToast('No llegó a caja', `${r?.error ?? 'Algo falló.'} Revisa la venta e intenta de nuevo.`, 'error'); setVuelta((n) => n + 1); return; }
        setResultado({ ...r, total: aPagar, puntos, cliente: venta.cliente?.name ?? null });
        setVenta(VACIA);
        clearDraft(claveBorrador);
        recargar();
    };
    const nuevaVenta = () => { setResultado(null); setFoco({ id: ID_BUSCAR_CLIENTE }); };

    // ── Cobrar (kiosco de caja) ───────────────────────────────────────────
    const [recibido, setRecibido] = useState('');
    const [cobrada, setCobrada] = useState(null);
    const recibidoNum = Number(recibido) || 0;
    const enEfectivo = venta.pago === 'contado';
    const faltaEfectivo = enEfectivo && recibidoNum < aPagar;
    const cobroConectado = esDemo();
    // Mientras el cobro no está encendido, el kiosco puede REVISARLO: la caja
    // contesta qué cobraría, sin cobrar (`preventa-caja`, acción `cobrar`).
    const [revision, setRevision] = useState(null);
    const revisarCobro = async () => {
        if (!cobrando?.id || revision?.cargando) return;
        setRevision({ cargando: true });
        const r = await ensayarCobro(cobrando.id, enEfectivo ? recibidoNum : aPagar);
        setRevision(r);
    };
    const cobrarEnKiosco = () => {
        if (bloqueada || faltaEfectivo || !cobroConectado) return;
        // En la muestra no se emite nada: se ve cómo queda al terminar.
        marcarCobradaEnMuestra(cobrando.id);
        setCobrada({
            referencia: cobrando.referencia, total: aPagar, cliente: venta.cliente?.name ?? null,
            documento: venta.documento, pago: venta.pago,
            recibido: enEfectivo ? recibidoNum : null, vuelto: enEfectivo ? Math.round((recibidoNum - aPagar) * 100) / 100 : null,
        });
    };

    const corregir = (p) => {
        setVenta({
            ...VACIA, lineas: lineasDeVenta(p.venta).map((l) => (puedeAutorizar ? l : { ...l, lista: null })),
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
        setVenta({ ...VACIA, lineas: lineasDeVenta(p.venta).map((l) => (puedeAutorizar ? l : { ...l, lista: null })), cliente: p.customer_id ? { id: p.customer_id, name: p.cliente } : null });
        setResultado(null);
        setPestana('nueva');
        alBuscador();
    };
    const [porAnular, setPorAnular] = useState(null);
    // Ya no está en caja (la borraron allá): se pregunta antes de cerrarla aquí.
    const [borradaEnCaja, setBorradaEnCaja] = useState(null);
    const anular = async () => {
        const p = porAnular;
        setPorAnular(null);
        const r = await anularPreventa(p.id);
        if (!r?.ok && r?.no_en_caja) { setBorradaEnCaja(p); return; }
        if (!r?.ok) { showToast('No se pudo anular', r?.error ?? 'Intenta de nuevo.', 'error'); return; }
        showToast('Preventa anulada', `La ${p.externo_ref ? `#${p.externo_ref}` : p.codigo} ya no está en caja.`, 'success');
        if (p.desdeCobro) onTerminarCobro?.(); else recargar();
    };
    const cerrarBorrada = async () => {
        const p = borradaEnCaja;
        setBorradaEnCaja(null);
        const r = await anularPreventa(p.id, true);
        if (!r?.ok) { showToast('No se pudo anular', r?.error ?? 'Intenta de nuevo.', 'error'); return; }
        showToast('Preventa anulada', `La ${p.externo_ref ? `#${p.externo_ref}` : p.codigo} ya no está en caja.`, 'success');
        if (p.desdeCobro) onTerminarCobro?.(); else recargar();
    };
    // Anular la preventa que se está cobrando (2026-11-18): desde el kiosco,
    // con el botón o con F10. Es el MISMO Anular de la lista de Preventas: su
    // confirmación, su permiso y su caso «la borraron en caja». Al anularla se
    // cierra el cobro y la cola se vuelve a leer.
    const anulableEnCobro = Boolean(cobrando) && puedeVender && sePuedeAnular(cobrando);
    const pedirAnularCobro = () => {
        if (!anulableEnCobro) return;
        setPorAnular({ id: cobrando.id, externo_ref: cobrando.referencia, codigo: cobrando.codigo, desdeCobro: true });
    };
    const [porVaciar, setPorVaciar] = useState(false);
    const vaciar = () => { setPorVaciar(false); setVenta(VACIA); setFoco({ id: ID_BUSCAR_CLIENTE }); };
    const pedirVaciar = () => { if (venta.lineas.length || venta.cliente || venta.corrigiendo) setPorVaciar(true); };

    // ── Al abrir Vender: el foco al primer buscador que haga falta ────────
    const vendiendo = activa && Boolean(sala) && (pestana === 'nueva' || enKiosco) && !resultado && !cobrada;
    useEffect(() => {
        if (!vendiendo || tactil) return;
        setFoco({ id: venta.cliente || venta.lineas.length ? ID_BUSCAR_PRODUCTO : ID_BUSCAR_CLIENTE });
    }, [vendiendo, tactil]); // eslint-disable-line react-hooks/exhaustive-deps -- sólo al entrar, no en cada cambio de la venta

    // ── Teclas de la pantalla: las mismas de la caja ──────────────────────
    // Aprietan el MISMO botón que el ratón (si está deshabilitado, nada pasa).
    const acciones = useRef({});
    acciones.current = {
        vendiendo, cobrando: Boolean(cobrando), cerrarCobro: onTerminarCobro, lineas: venta.lineas, pedirVaciar, quitarLinea,
        existencias: (nombre) => setConsulta((c) => (c != null ? null : nombre ?? '')),
        anularCobro: () => pedirAnularCobro(),
    };
    useEffect(() => {
        const alTeclado = (e) => {
            const a = acciones.current;
            if (!a.vendiendo) return;
            if (document.querySelector('[role="dialog"]')) return; // con un diálogo abierto, las teclas son suyas
            const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
            const k = e.key;
            // Esc cierra la preventa, salvo que esté cerrando una lista abierta.
            if (k === 'Escape' && a.cobrando && !document.querySelector('[role="listbox"]')) {
                e.preventDefault(); a.cerrarCobro?.(); return;
            }
            const fila = e.target?.closest?.('[data-fila]');
            if (k === 'F2' || k === 'F8' || (k === 'Enter' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                const boton = document.querySelector('[data-accion-enviar]');
                if (boton && !boton.disabled) boton.click();
                else document.querySelector('[data-problema] button')?.focus(); // no se puede: el foco al primer pendiente
            } else if (k === 'F3' || (k === '/' && !enCampo)) { e.preventDefault(); enfocar(ID_BUSCAR_PRODUCTO); }
            else if (k === 'F4') {
                e.preventDefault();
                if (document.getElementById(ID_BUSCAR_CLIENTE)) enfocar(ID_BUSCAR_CLIENTE);
                else document.querySelector('[data-accion-cambiar-cliente]')?.focus();
            } else if (k === 'F6') { e.preventDefault(); if (!a.cobrando) a.pedirVaciar(); }
            else if (k === 'F10' && a.cobrando) { e.preventDefault(); a.anularCobro?.(); }
            else if (k === 'F9' && a.cobrando) { e.preventDefault(); const c = document.querySelector('input[name="recibido"]'); c?.focus(); c?.select(); }
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

    // Entrada / Salida sólo con la caja abierta y el día sin cerrar: con la
    // caja cerrada no tienen sentido (lo pidió el usuario, 2026-11-17). Se
    // pregunta al entrar y al volver de la caja, donde se abre o se cierra.
    const [cajaViva, setCajaViva] = useState(false);
    useEffect(() => {
        if (!enKiosco || !onMovimientoDeCaja || !sala || !activa) return undefined;
        let vivo = true;
        estadoDeCaja(sala).then((e) => {
            if (!vivo) return;
            const z = (e?.cortes || []).some((c) => c.tipo === 'Z');
            setCajaViva(!e?.error && e?.abierta === true && !z);
        });
        return () => { vivo = false; };
    }, [enKiosco, onMovimientoDeCaja, sala, activa]);

    // La píldora del cuerpo: la sucursal (para quien ve todas) y las acciones.
    // En el kiosco, rótulos cortos: caben las cuatro junto al buscador.
    const accionesVender = [
        { key: 'existencias', icon: PackageSearch, label: enKiosco ? 'Existencias' : 'Otras sucursales', onClick: () => setConsulta('') },
        ...(puedeApartar ? [{ key: 'apartar', icon: ShoppingBag, label: enKiosco ? 'Apartar' : 'Apartar o encargar', onClick: () => setApartar({}) }] : []),
        ...(onMovimientoDeCaja && cajaViva ? [
            { key: 'entrada', icon: ArrowDownLeft, label: 'Entrada', onClick: () => onMovimientoDeCaja('ingreso') },
            { key: 'salida', icon: ArrowUpRight, label: 'Salida', onClick: () => onMovimientoDeCaja('salida') },
        ] : []),
    ];
    const accionesLista = [{ key: 'actualizar', icon: RefreshCw, label: 'Actualizar', onClick: recargar }];

    const barra = (
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
    );

    const Marco = enKiosco ? MarcoDeKiosco : GlassViewLayout;
    return (
        <Marco icon={Receipt} title="Preventa" transparentBody
            filtersContent={enKiosco ? null : <ViewTabBar tabs={pestanas} activeTab={pestana} onTabChange={setPestana} />}>
            <div className={enKiosco ? 'space-y-3' : 'p-3 md:p-4 space-y-3'}>
                {!sala && <Notice variant="warning">Tu usuario no tiene sucursal asignada.</Notice>}
                {/* La píldora canónica: sucursal (quien ve todas) y las acciones. */}
                {/* En el kiosco no hay pestañas ni sucursal que elegir: la cola
                    de la izquierda ES la lista de preventas, y la sucursal es la
                    del equipo. Quedan las dos acciones, en la misma línea. */}
                {sala && !enKiosco && (
                    <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                        <p className="flex-1 min-w-0 text-body-sm text-content-3">
                            {pestana === 'nueva'
                                ? <>Llega a caja de <span className="font-bold text-content">{nombreSala}</span> con tu nombre como vendedor.</>
                                : <>{enCaja} en caja sin facturar</>}
                        </p>
                        <div className="flex justify-end items-center gap-2 min-w-0">
                            {hasPermission('caja_vales', 'can_view') && (
                                <Button variant="secondary" icon={MonitorSmartphone}
                                    onClick={() => navigate(`/preventa/kiosco${todas ? `?sala=${sala}` : ''}`)}>Kiosco de caja</Button>
                            )}
                            {barra}
                        </div>
                    </div>
                )}
                {sala && (pestana === 'nueva' || enKiosco) && (
                    cobrada ? (
                        <CobroHecho cobro={cobrada} onSiguiente={onTerminarCobro} />
                    ) : resultado ? (
                        <Hecho resultado={resultado} onOtra={nuevaVenta} onVer={() => { setResultado(null); setPestana('hoy'); }} />
                    ) : (
                        <div className={`grid gap-3 items-start ${cobrando ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : 'lg:grid-cols-[minmax(0,1fr)_340px]'}`}>
                            <div className="space-y-3 min-w-0">
                                {cargaCobro && (
                                    cargaCobro === 'cargando'
                                        ? <Notice compact>Abriendo la preventa…</Notice>
                                        : <Notice variant="warning" compact>{cargaCobro}</Notice>
                                )}
                                {cobrando && !enKiosco && (
                                    <Notice variant="info" compact action={<Button size="sm" variant="ghost" icon={X} onClick={onTerminarCobro}>Volver a la cola</Button>}>
                                        Cobrando la #{cobrando.referencia}. Lo que corrijas aquí sale en la factura.
                                    </Notice>
                                )}
                                {venta.corrigiendo && !cobrando && (
                                    <Notice variant="info" compact action={
                                        <Button size="sm" variant="ghost" icon={X} onClick={() => { setVenta(VACIA); setFoco({ id: ID_BUSCAR_CLIENTE }); }}>Cancelar</Button>}>
                                        Corrigiendo la preventa {venta.corrigiendo.referencia ? `#${venta.corrigiendo.referencia}` : venta.corrigiendo.codigo}. Al guardar, cambia la misma en caja.
                                    </Notice>
                                )}

                                <Cliente holgada={enKiosco} cliente={venta.cliente} info={info} cotizacion={cotizacion} alerta={clienteConProblema}
                                    faltanCcf={faltanCcf} puedeEditar={puedeEditarClientes} puedeCrear={puedeCrearClientes}
                                    onElegir={elegirCliente} onEditar={editarCliente} onCrear={crearCliente}
                                    onAgregar={(p) => agregarProducto({ id: p.producto_id, nombre: p.nombre, foto_url: p.foto_url })}
                                    onAgregarVarios={agregarVarios} />

                                <section data-surface="card" className="p-3 space-y-2">
                                    {/* En el kiosco, las dos acciones van junto al buscador:
                                        son de productos, y así no quedan sueltas arriba. */}
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 min-w-0"><BuscarProducto onElegir={agregarProducto} /></div>
                                        {enKiosco && accionesVender.map((a) => (
                                            <Button key={a.key} variant="secondary" icon={a.icon} onClick={a.onClick} className="shrink-0">{a.label}</Button>
                                        ))}
                                    </div>
                                    {venta.lineas.length === 0 ? (
                                        <p className="flex items-center justify-center gap-2 py-4 text-body-sm text-content-3">
                                            <Package size={18} strokeWidth={1.5} /> Busca o escanea un producto para empezar.
                                        </p>
                                    ) : (
                                        <div className="space-y-1" onKeyDown={navegarRenglones}>
                                            <div className="max-md:hidden grid grid-cols-[minmax(0,1fr)_168px_112px_208px_84px_32px] gap-2 pl-3 pr-1 text-micro font-black text-content-3 uppercase tracking-widest">
                                                <span>Producto <span className="tabular-nums normal-case tracking-normal font-semibold">· {venta.lineas.length}{venta.lineas.length >= MAX_PRODUCTOS - 5 ? ` de ${MAX_PRODUCTOS}` : ''}</span></span><span>Presentación</span><span className="text-center">Cantidad</span>
                                                <span>Precio</span><span className="text-right">Subtotal</span><span />
                                            </div>
                                            {venta.lineas.map((l, i) => (
                                                <Linea key={claveDe(l)} indice={i} linea={l} fila={filaDe(l)} cotizando={cotizando}
                                                    problema={problemaDeLinea(l)} onResolver={resolver}
                                                    foto={l.foto_url ?? fotos.get(l.producto_id) ?? null}
                                                    puedeAutorizar={puedeAutorizar} listaCliente={cotizacion?.lista} lotes={lotes.get(l.producto_id)}
                                                    onCambiar={(c) => ponerLinea(i, c)} onQuitar={() => quitarLinea(i)} onListo={alBuscador} />
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>

                            <aside data-surface="card" className="p-3 space-y-2.5 lg:sticky lg:top-3 min-w-0">
                                <SegmentedControl label="Comprobante" layout="block" columns={2} value={venta.documento}
                                    options={cobrando ? DOCUMENTOS.map((d) => ({ ...d, description: undefined })) : DOCUMENTOS}
                                    onChange={(v) => cambiar({ documento: v })} />
                                <LiquidSelect label="Tipo de pago" clearable={false} value={venta.pago} options={PAGOS}
                                    invalid={problemas.some((p) => p.clave === 'credito')}
                                    onChange={(v) => cambiar({ pago: v || 'contado' })} />

                                {info?.puntos?.puede_canjear && (!enKiosco || info.puntos.disponibles >= info.puntos.minimo_canje) && (
                                    // Los puntos como un bloque propio: cuánto tiene, cuánto descuenta y un toque para usarlos.
                                    <div className="rounded-xl bg-success/10 p-2.5 space-y-2" data-campo="puntos">
                                        <div className="flex items-center gap-2">
                                            <Gift size={16} className="shrink-0 text-success-text" />
                                            <p className="flex-1 min-w-0 text-body-sm text-content">
                                                <span className="font-black tabular-nums">{info.puntos.disponibles}</span> puntos
                                                <span className="text-micro text-content-3"> · desde {info.puntos.minimo_canje}</span>
                                            </p>
                                            {puntos > 0 && descPuntos > 0 && (
                                                <span className="text-body-sm font-black tabular-nums text-success-text">−{formatMoney(descPuntos)}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 min-w-0">
                                                <PortalInput compact name="puntos" inputMode="numeric" value={String(venta.puntos ?? '')} aria-label="Puntos a canjear"
                                                    placeholder="Puntos a usar" hasError={problemas.some((p) => p.clave === 'puntos')}
                                                    onChange={(e) => cambiar({ puntos: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
                                            </div>
                                            {maxPuntos >= info.puntos.minimo_canje && String(maxPuntos) !== String(venta.puntos) && (
                                                <Button size="sm" variant="secondary" onClick={() => cambiar({ puntos: String(maxPuntos) })}>
                                                    Usar {maxPuntos}
                                                </Button>
                                            )}
                                            {puntos > 0 && <Button size="sm" variant="ghost" icon={X} iconOnly aria-label="No usar puntos" onClick={() => cambiar({ puntos: '' })} />}
                                        </div>
                                        {info.puntos.comprometidos > 0 && (
                                            <p className="text-micro text-content-3">{info.puntos.comprometidos} ya apartados en otra preventa.</p>
                                        )}
                                    </div>
                                )}

                                <dl className="space-y-0.5 text-body-sm border-t border-subtle pt-2.5">
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

                                {!cobrando && (
                                    <PortalInput compact label="Nota para caja" name="nota" value={venta.nota} maxLength={60}
                                        onChange={(e) => cambiar({ nota: e.target.value })} placeholder="Opcional" />
                                )}

                                <Pendientes problemas={problemas} revisando={revisando} onResolver={resolver} />

                                {cobrando ? (
                                    <>
                                        {enEfectivo && (
                                            <div className="space-y-2 border-t border-subtle pt-2.5">
                                                <PortalInput compact label="Recibido" name="recibido" prefix="$" inputMode="decimal" value={recibido}
                                                    placeholder="0.00" onChange={(e) => setRecibido(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} />
                                                <div className="grid grid-cols-4 gap-1.5">
                                                    {billetesPara(aPagar).map(([rotulo, monto]) => (
                                                        <Button key={rotulo} size="xs" variant={recibidoNum === monto ? 'primary' : 'secondary'}
                                                            onClick={() => setRecibido(monto.toFixed(2))}>{rotulo}</Button>
                                                    ))}
                                                </div>
                                                <div className="flex items-baseline justify-between">
                                                    <span className="text-body-sm font-semibold text-content-2">Vuelto</span>
                                                    <span className={`text-title-lg font-black tabular-nums ${recibidoNum && !faltaEfectivo ? 'text-success-text' : 'text-content-3'}`}>
                                                        {recibidoNum && !faltaEfectivo ? formatMoney(recibidoNum - aPagar) : '—'}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        <Button className="w-full" size="lg" icon={Wallet} disabled={bloqueada || faltaEfectivo || !cobroConectado}
                                            onClick={cobrarEnKiosco} data-accion-enviar>
                                            {problemas.length > 0
                                                ? `Resuelve ${problemas.length} pendiente${problemas.length > 1 ? 's' : ''}`
                                                : faltaEfectivo ? 'Escribe lo recibido' : `Cobrar ${formatMoney(aPagar)}`}
                                        </Button>
                                        {anulableEnCobro && (
                                            <Button className="w-full" variant="secondary" tone="danger" size="sm" icon={Ban} onClick={pedirAnularCobro}>
                                                Anular la preventa
                                            </Button>
                                        )}
                                        {!cobroConectado && (
                                            <>
                                                <p className="text-micro text-content-3">El cobro todavía no está conectado.</p>
                                                <Button className="w-full" variant="secondary" size="sm" loading={revision?.cargando} onClick={revisarCobro}>Revisar cobro en la caja</Button>
                                                {revision && !revision.cargando && (
                                                    revision.ok && !revision.motivo
                                                        ? <Notice variant="success" compact>Todo cuadra: {revision.renglones} producto{revision.renglones === 1 ? '' : 's'}, {formatMoney(revision.totales?.total ?? 0)}. Listo para cobrar.</Notice>
                                                        : <Notice variant="warning" compact>{revision.motivo || revision.error}</Notice>
                                                )}
                                            </>
                                        )}
                                        {!tactil && (
                                            <div className="border-t border-subtle pt-2.5 space-y-1.5">
                                                <p className="text-micro font-semibold text-content-2">Teclas rápidas</p>
                                                <ul className="grid grid-cols-1 gap-1 text-micro text-content-2">
                                                    {TECLAS_COBRO.map(([k, que]) => (
                                                        <li key={k} className="flex items-center gap-2">
                                                            <kbd className="min-w-9 text-center rounded border border-border-card bg-surface-card-hover px-1 font-bold text-content">{k}</kbd>{que}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </>
                                ) : (<>

                                <Button className="w-full" size="lg" icon={venta.corrigiendo ? Pencil : Send} loading={enviando}
                                    disabled={!puedeVender || bloqueada} onClick={enviar} data-accion-enviar>
                                    {problemas.length > 0
                                        ? `Resuelve ${problemas.length} pendiente${problemas.length > 1 ? 's' : ''}`
                                        : venta.corrigiendo ? 'Guardar corrección' : 'Enviar a caja'}
                                    {!tactil && !problemas.length && <kbd aria-hidden="true" className="ml-1 text-micro font-bold opacity-60">F2</kbd>}
                                </Button>
                                {/* Vaciar es de toda la venta (cliente, productos, pago): va con ella. */}
                                <Button className="w-full" size="sm" variant="ghost" icon={Trash2} onClick={pedirVaciar}
                                    disabled={!(venta.lineas.length || venta.cliente || venta.corrigiendo)}>Vaciar venta</Button>
                                {!puedeVender && <p className="text-micro text-content-3">Puedes mirar, pero no enviar preventas.</p>}
                                {!tactil && (
                                    <p className="hidden lg:flex flex-wrap gap-x-2.5 gap-y-1 text-micro text-content-3">
                                        {TECLAS.map(([k, que]) => (
                                            <span key={k} className="inline-flex items-center gap-1">
                                                <kbd className="rounded border border-border-card bg-surface-card-hover px-1 font-bold text-content-2">{k}</kbd>{que}
                                            </span>
                                        ))}
                                    </p>
                                )}
                                </>)}
                            </aside>
                        </div>
                    )
                )}

                {sala && !enKiosco && pestana === 'hoy' && (
                    <section className="space-y-2">
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
            <ConfirmModal isOpen={Boolean(borradaEnCaja)} onClose={() => setBorradaEnCaja(null)} onConfirm={cerrarBorrada}
                title={`La ${borradaEnCaja?.externo_ref ? `#${borradaEnCaja.externo_ref}` : borradaEnCaja?.codigo ?? ''} ya no está en caja`}
                message="¿La borraron en caja? Si es así, se marca anulada aquí. Si se facturó, aparece como facturada en un momento."
                confirmText="Sí, la borraron" />
            <ConfirmModal isOpen={porVaciar} onClose={() => { setPorVaciar(false); alBuscador(); }} onConfirm={vaciar}
                title={venta.corrigiendo ? '¿Dejar de corregir?' : '¿Vaciar la venta?'}
                message={venta.corrigiendo ? 'La preventa en caja queda como estaba.' : 'Se quitan el cliente y los productos.'}
                confirmText={venta.corrigiendo ? 'Dejar de corregir' : 'Vaciar'} />
        </Marco>
    );
}

/** El marco de la venta en el kiosco: sólo las pestañas, sin título. */
function MarcoDeKiosco({ filtersContent, children }) {
    return (
        <div className="flex flex-col gap-3">
            {filtersContent}
            {children}
        </div>
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
function Miniatura({ src, tamano = 'w-9 h-9' }) {
    const [rota, setRota] = useState(false);
    const [previa, setPrevia] = useState(src);
    if (src !== previa) { setPrevia(src); setRota(false); }
    return (
        <span className={`${tamano} shrink-0 rounded-lg bg-surface-card-hover border border-border-card overflow-hidden flex items-center justify-center`}>
            {src && !rota
                ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setRota(true)} className="w-full h-full object-contain" />
                : <Package size={14} strokeWidth={1.5} className="text-content-3" />}
        </span>
    );
}

// ── Lo que falta para enviar: todo junto, cada cosa con qué hacer ─────────
function Pendientes({ problemas, revisando, onResolver }) {
    if (revisando && !problemas.length) {
        return <p className="text-micro text-content-3">Revisando precios y existencia…</p>;
    }
    if (!problemas.length) return null;
    const vacia = problemas.length === 1 && problemas[0].clave === 'vacia';
    return (
        <div role="status" className={`rounded-xl border p-2 space-y-2 min-w-0 ${vacia ? 'border-border-subtle bg-surface-card-hover' : 'border-danger/40 bg-danger/5'}`}>
            {!vacia && (
                <p className="text-micro font-black uppercase tracking-widest text-danger-text flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Antes de enviar · {problemas.length}
                </p>
            )}
            <ul className="space-y-2">
                {problemas.map((p) => (
                    <li key={p.clave} data-problema className="min-w-0">
                        <button type="button" onClick={() => p.campo && irAlCampo(p.campo)}
                            className={`block w-full text-left text-label font-semibold leading-snug break-words rounded focus-visible:outline-2 focus-visible:outline-brand ${vacia ? 'text-content-2' : 'text-danger-text'}`}>
                            {p.titulo}
                        </button>
                        {p.ayuda && <p className="text-micro text-content-2 leading-snug break-words mt-0.5">{p.ayuda}</p>}
                        {p.acciones.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                                {p.acciones.map((a) => (
                                    <Button key={`${a.id}-${a.label}`} size="xs" variant="secondary" onClick={() => onResolver(p, a)}>{a.label}</Button>
                                ))}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ── El cliente: buscar, ver su ficha, editar o crear ──────────────────────
function Cliente({ holgada = false, cliente, info, cotizacion, alerta, faltanCcf, puedeEditar, puedeCrear, onElegir, onEditar, onCrear, onAgregar, onAgregarVarios }) {
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
        <section data-surface="card" data-campo="cliente"
            className={`p-3 space-y-2.5 transition-shadow ${alerta ? 'ring-2 ring-danger/45' : ''}`}>
            {cliente ? (
                <FichaDelCliente holgada={holgada} cliente={cliente} info={info} cotizacion={cotizacion} faltanCcf={faltanCcf} puedeEditar={puedeEditar}
                    onEditar={onEditar} onQuitar={() => onElegir(null)} onAgregar={onAgregar} onAgregarVarios={onAgregarVarios} />
            ) : (
                <>
                    <div className="flex items-center gap-2">
                        <h2 className="shrink-0 text-caption font-black text-content-2 uppercase tracking-widest flex items-center gap-1.5">
                            <UserRound size={13} /> Cliente
                        </h2>
                        <div className="flex-1 min-w-0">
                            <SearchInput id={ID_BUSCAR_CLIENTE} value={texto} onChange={setTexto} loading={buscando}
                                placeholder="Nombre, DUI, NIT o teléfono" ariaLabel="Buscar cliente" onKeyDown={nav.onKeyDown}
                                combobox={{ lista: idLista, abierto, activo: abierto ? `${idLista}-${nav.activo}` : null }} />
                        </div>
                        {puedeCrear && <Button variant="secondary" icon={UserPlus} onClick={() => onCrear(q)}>Nuevo</Button>}
                    </div>
                    {abierto && (
                        <ul id={idLista} role="listbox" aria-label="Clientes encontrados"
                            className="rounded-xl border border-border-card divide-y divide-divider overflow-hidden">
                            {resultados.map((x, i) => (
                                <li key={x.id} id={`${idLista}-${i}`} role="option" aria-selected={i === nav.activo}
                                    onMouseEnter={() => nav.setActivo(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(x)}
                                    className={`px-3 py-1.5 min-h-[var(--tap-min)] flex items-center gap-3 cursor-pointer active:scale-[0.99] ${i === nav.activo ? 'bg-brand/10' : ''}`}>
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
                    <p className="text-micro text-content-3">
                        {!buscando && q.trim().length >= 3 && !abierto
                            ? <>No aparece «{q.trim()}».</>
                            : <>Sin cliente va como frecuente, con precio {nombreDeLista(cotizacion?.lista ?? 'descuento_1')}. Con cliente gana su precio y sus puntos.</>}
                    </p>
                    {/* No está: se ofrece crearlo con lo que ya se escribió (DUI, teléfono o nombre). */}
                    {puedeCrear && !buscando && q.trim().length >= 3 && !abierto && (
                        <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => onCrear(q)}>
                            {(() => {
                                const d = datosDeLoBuscado(q);
                                return d.dui ? `Crear cliente con DUI ${d.dui}` : d.phone ? `Crear cliente con teléfono ${d.phone}`
                                    : d.name ? `Crear «${d.name}»` : 'Crear cliente';
                            })()}
                        </Button>
                    )}
                </>
            )}
        </section>
    );
}

// ── La ficha: quién es, qué datos tiene (y cuáles faltan), qué compra ─────
function FichaDelCliente({ holgada = false, cliente, info, cotizacion, faltanCcf, puedeEditar, onEditar, onQuitar, onAgregar, onAgregarVarios }) {
    const p = info?.puntos;
    const tipo = info?.empleado ? 'Empleado' : info?.programa === 'mayorista'
        ? `Mayorista${info?.mayorista?.precio === 'mayoreo_plus' ? ' Plus' : ''}${info?.rango ? ` · ${info.rango}` : ''}`
        : NOMBRE_DE_PROGRAMA[info?.programa] ?? '';
    const faltan = datosQueFaltan(info);
    // A un consumidor no se le marcan los datos fiscales: el aviso de la venta ya dice que cambie la categoría.
    const ccf = new Set(esContribuyente(info?.categoria) ? faltanCcf : []);
    // Los datos, siempre en el mismo orden: lo vacío se ve como «Falta».
    // NIT, NRC y giro son del contribuyente: a un consumidor no se le piden,
    // salvo que ya los tenga o que la venta vaya con crédito fiscal.
    const fiscal = new Set(['NIT', 'NRC', 'Giro']);
    const datos = [
        ['DUI', info?.dui, ccf.has('DUI')], ['NIT', info?.nit, ccf.has('NIT')], ['NRC', info?.nrc, ccf.has('NRC')],
        ['Teléfono', info?.phone, false], ['Correo', info?.email, false], ['Giro', info?.giro, ccf.has('Giro')],
        ['Dirección', info?.direccion, ccf.has('Dirección')],
    ].filter(([k, v, pide]) => !fiscal.has(k) || esContribuyente(info?.categoria) || String(v ?? '').trim() || pide);
    const importante = (k) => faltan.some((f) => f === k || (f === 'DUI o NIT' && (k === 'DUI' || k === 'NIT')));
    // Lo que tiene, en una línea que se lee de corrido; lo que falta, aparte y
    // nombrado una sola vez (antes era una grilla de «Falta» en rojo).
    const tiene = datos.filter(([, v]) => String(v ?? '').trim());
    const faltaCcf = datos.filter(([, v, exigido]) => !String(v ?? '').trim() && exigido).map(([k]) => k);
    const faltaOtro = datos.filter(([k, v, exigido]) => !String(v ?? '').trim() && !exigido && importante(k)).map(([k]) => k);
    const listaDe = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] ?? '').replace('Teléfono', 'teléfono')
        .replace('Correo', 'correo').replace('Giro', 'giro').replace('Dirección', 'dirección');
    return (
        <div className={holgada ? 'space-y-3' : 'space-y-2'}>
            <div className={`flex items-start min-w-0 ${holgada ? 'gap-4' : 'gap-3'}`}>
                {/* La foto que subió desde la app, dentro del aro de su nivel (el mismo del chat). */}
                <ClienteAvatar size="lg" conversacion={{
                    cliente: cliente.name, foto_url: info?.foto ?? null, nivel: info?.nivel?.toLowerCase() ?? null,
                    es_mayoreo: info?.programa === 'mayorista', rango: info?.rango ?? null, es_team: Boolean(info?.empleado),
                }} />
                <div className={`min-w-0 flex-1 ${holgada ? 'space-y-1.5' : 'space-y-1'}`}>
                    <div className="flex items-center gap-2 min-w-0">
                        <p className={`min-w-0 ${holgada ? 'text-title' : 'text-body'} font-bold text-content leading-tight truncate`} title={cliente.name}>{cliente.name}</p>
                        {info && (faltaCcf.length > 0 || faltaOtro.length > 0) && (
                            // Lo que falta, chico y al lado del nombre: un toque abre sus datos.
                            <button type="button" onClick={puedeEditar ? onEditar : undefined} disabled={!puedeEditar}
                                aria-label={`${faltaCcf.length ? `Para crédito fiscal falta ${listaDe(faltaCcf)}. ` : ''}${faltaOtro.length ? `Falta ${listaDe(faltaOtro)}.` : ''} Completar datos`}
                                className={`shrink min-w-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-brand ${faltaCcf.length ? 'bg-danger/10 text-danger-text' : 'bg-warning/10 text-warning-text'}`}>
                                <AlertTriangle size={11} className="shrink-0" />
                                <span className="truncate">Falta {listaDe([...faltaCcf, ...faltaOtro])}</span>
                            </button>
                        )}
                        <span className="flex-1" />
                        <div className="flex items-center gap-0.5 shrink-0 -mt-1">
                            {puedeEditar && <Button size="sm" variant="ghost" icon={UserPen} iconOnly aria-label="Editar datos del cliente" onClick={onEditar} />}
                            <Button size="sm" variant="ghost" icon={X} iconOnly aria-label="Cambiar de cliente" onClick={onQuitar} data-accion-cambiar-cliente />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                        <Badge size="sm" variant={cotizacion?.generico ? 'neutral' : 'success'} uppercase={false}
                            title={porQueEsaLista(cotizacion?.lista, cotizacion?.generico)}>Precio {nombreDeLista(cotizacion?.lista)}</Badge>
                        {info?.categoria && <Badge size="sm" variant={info.categoria === 'Consumidor' ? 'neutral' : 'info'} uppercase={false}>{info.categoria}</Badge>}
                        {tipo && <Badge size="sm" variant="neutral" uppercase={false}>{tipo}</Badge>}
                        {info?.nivel && <Badge size="sm" variant="warning" uppercase={false}>{info.nivel}</Badge>}
                    </div>
                    {info && tiene.length > 0 && (
                        <p className={`${holgada ? 'text-body-sm' : 'text-micro'} text-content-2 truncate`}>
                            {tiene.map(([k, v], i) => (
                                <span key={k}>
                                    {i > 0 && <span className="text-content-3" aria-hidden> · </span>}
                                    {k !== 'Teléfono' && k !== 'Dirección' && <span className="text-content-3">{k} </span>}
                                    <span className="font-semibold text-content tabular-nums">{v}</span>
                                </span>
                            ))}
                        </p>
                    )}
                </div>
                {info && <SaldoDelCliente puntos={p} compra12m={info.compra_12m} ultima={info.ultima_compra} />}
            </div>

            {info && (info.frecuentes?.length > 0 || info.ultimas_compras?.length > 0) && (
                <div className={holgada ? 'pt-3 border-t border-subtle' : undefined}>
                    <Historial info={info} onAgregar={onAgregar} onAgregarVarios={onAgregarVarios} />
                </div>
            )}
        </div>
    );
}

// ── Puntos y compras del cliente, a la derecha de la ficha ───────────────
// El aro se llena hacia el mínimo para canjear: lleno = ya puede usarlos.
function SaldoDelCliente({ puntos: p, compra12m, ultima }) {
    const minimo = Number(p?.minimo_canje) || 0;
    const disp = Number(p?.disponibles) || 0;
    const avance = p ? (minimo > 0 ? Math.min(1, disp / minimo) : 1) : 0;
    const listo = Boolean(p?.puede_canjear) && disp >= minimo && disp > 0;
    const R = 19, C = 2 * Math.PI * R;
    return (
        <div className="hidden sm:flex items-center gap-3 shrink-0 pl-3 border-l border-subtle">
            {p && (
                <button type="button" disabled={!p.puede_canjear}
                    onClick={() => {
                        // Al bloque de puntos del cobro, con el campo listo para escribir.
                        const campo = document.querySelector('[data-campo="puntos"] input');
                        campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        campo?.focus({ preventScroll: true });
                    }}
                    aria-label={!p.puede_canjear ? 'Este cliente no canjea puntos' : `${disp} puntos, canjea desde ${minimo}. Usar puntos`}
                    className="flex items-center gap-2 rounded-xl p-1 -m-1 text-left enabled:hover:bg-surface-card-hover active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-brand">
                    <span className="relative w-12 h-12 shrink-0">
                        <svg viewBox="0 0 48 48" className="w-12 h-12 -rotate-90" aria-hidden>
                            <circle cx="24" cy="24" r={R} fill="none" strokeWidth="4" className="stroke-current text-content-3/20" />
                            <circle cx="24" cy="24" r={R} fill="none" strokeWidth="4" strokeLinecap="round"
                                strokeDasharray={C} strokeDashoffset={C * (1 - avance)}
                                className={`stroke-current transition-[stroke-dashoffset] duration-[var(--dur-slow)] ease-out ${listo ? 'text-success' : 'text-warning'}`} />
                        </svg>
                        <Gift size={16} className={`absolute inset-0 m-auto ${listo ? 'text-success-text' : 'text-content-3'}`} />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-title font-black tabular-nums leading-none text-content">{disp}</span>
                        <span className={`block text-micro font-semibold ${listo ? 'text-success-text' : 'text-content-3'}`}>
                            {!p.puede_canjear ? 'No canjea' : listo ? `puntos · ${formatMoney(descuentoDePuntos(disp, p.valor))}` : `faltan ${minimo - disp}`}
                        </span>
                    </span>
                </button>
            )}
            <div className="text-micro leading-snug">
                <p><span className="font-black tabular-nums text-body-sm text-content">{compra12m != null ? formatMoney(compra12m) : '—'}</span></p>
                <p className="text-content-3">en 12 meses</p>
                {ultima && <p className="text-content-3 truncate max-w-[8rem]" title={ultima.sucursal ?? ''}>última {fechaTexto(ultima.fecha)}</p>}
            </div>
        </div>
    );
}

// ── Lo que suele llevar y sus últimas compras: todo se agrega de un toque ─
function Historial({ info, onAgregar, onAgregarVarios }) {
    const [abierto, setAbierto] = useState(false);
    const frecuentes = info.frecuentes ?? [];
    const ultimas = info.ultimas_compras ?? [];
    return (
        <div className="flex items-center gap-2 min-w-0">
            {frecuentes.length > 0 && <span className="shrink-0 text-micro font-bold text-content-3">Suele llevar</span>}
            {frecuentes.length > 0 ? <SueleLlevar frecuentes={frecuentes} onAgregar={onAgregar} /> : <span className="flex-1" />}
            {ultimas.length > 0 && (
                <Button size="xs" variant="ghost" icon={History} onClick={() => setAbierto(true)} className="shrink-0">
                    Últimas · {ultimas.length}
                </Button>
            )}
            {abierto && (
                <LiquidModal open onClose={() => setAbierto(false)} maxWidth="max-w-2xl" ariaLabel="Últimas compras del cliente">
                    <LiquidModal.Header icono={History} titulo="Últimas compras"
                        subtitulo={`${info.name} · ${info.compra_12m != null ? `${formatMoney(info.compra_12m)} en 12 meses` : 'sin compras en el año'}`}
                        onClose={() => setAbierto(false)} />
                    <LiquidModal.Body>
                        <div className="space-y-3">
                            {frecuentes.length > 0 && (
                                <section className="space-y-1.5">
                                    <TituloDeSeccion nivel="tarjeta">Lo que más compra en el año</TituloDeSeccion>
                                    <ul className="grid sm:grid-cols-2 gap-1.5">
                                        {frecuentes.map((f) => (
                                            <li key={f.producto_id} className="flex items-center gap-2 rounded-lg bg-surface-card-hover px-2 py-1.5 min-w-0">
                                                <Miniatura src={f.foto_url} tamano="w-8 h-8" />
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-body-sm font-semibold text-content truncate">{f.nombre}</span>
                                                    <span className="block text-micro text-content-3">{f.veces} {f.veces === 1 ? 'vez' : 'veces'} · última {fechaTexto(f.ultima)}</span>
                                                </span>
                                                <Button size="xs" variant="ghost" icon={Plus} onClick={() => onAgregar(f)}>Agregar</Button>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                            {ultimas.map((u) => {
                                const vendibles = (u.productos ?? []).filter((x) => x.activo && x.producto_id);
                                return (
                                    <section key={u.id} data-surface="card" className="p-3 space-y-2">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                            <p className="text-body-sm font-bold text-content tabular-nums">{fechaTexto(u.fecha)}</p>
                                            <p className="text-micro text-content-3">{u.sucursal} · {nombreDeComprobante(u.tipo_documento)}</p>
                                            <p className="ml-auto text-body font-black tabular-nums text-content">{formatMoney(Number(u.total))}</p>
                                        </div>
                                        <ul className="divide-y divide-divider">
                                            {(u.productos ?? []).map((x, i) => (
                                                <li key={`${x.producto_id}-${i}`} className="flex items-center gap-2 py-1.5 min-w-0">
                                                    <Miniatura src={x.foto_url} tamano="w-8 h-8" />
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-body-sm text-content truncate">{x.nombre}</span>
                                                        <span className="block text-micro text-content-3">
                                                            {Number(x.cantidad)} {x.presentacion ?? ''}{x.activo ? '' : ' · ya no se vende'}
                                                        </span>
                                                    </span>
                                                    <span className="text-body-sm font-semibold tabular-nums text-content-2">{formatMoney(Number(x.total ?? 0))}</span>
                                                    {x.activo && x.producto_id
                                                        ? <Button size="xs" variant="ghost" icon={Plus} onClick={() => onAgregar(x)}>Agregar</Button>
                                                        : <span className="w-[4.5rem]" />}
                                                </li>
                                            ))}
                                        </ul>
                                        {vendibles.length > 1 && (
                                            <div className="flex justify-end">
                                                <Button size="sm" variant="secondary" icon={RefreshCw}
                                                    onClick={() => { onAgregarVarios(vendibles); setAbierto(false); }}>Agregar toda la compra</Button>
                                            </div>
                                        )}
                                    </section>
                                );
                            })}
                        </div>
                    </LiquidModal.Body>
                </LiquidModal>
            )}
        </div>
    );
}

// «Suele llevar» en una sola fila: se desliza con las flechas de los bordes
// (o con el dedo), sin barra de desplazamiento a la vista. Cada flecha sólo
// aparece si hay más productos de ese lado.
function SueleLlevar({ frecuentes, onAgregar }) {
    const pista = useRef(null);
    const [bordes, setBordes] = useState({ izq: false, der: false });
    const medir = useCallback(() => {
        const el = pista.current;
        if (!el) return;
        setBordes({ izq: el.scrollLeft > 2, der: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    }, []);
    useEffect(() => {
        medir();
        const el = pista.current;
        const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(medir) : null;
        if (ro) ro.observe(el);
        return () => ro?.disconnect();
    }, [medir, frecuentes]);
    const mover = (dir) => pista.current?.scrollBy({ left: dir * pista.current.clientWidth * 0.8, behavior: 'smooth' });
    return (
        <div className="min-w-0 flex-1">
            <div className="relative min-w-0">
                <div ref={pista} onScroll={medir} className="flex gap-1.5 overflow-x-auto scrollbar-hide overscroll-contain scroll-smooth">
                    {frecuentes.map((f) => (
                        <button key={f.producto_id} type="button" onClick={() => onAgregar(f)}
                            title={`Agregar ${f.nombre} · lo compró ${f.veces} ${f.veces === 1 ? 'vez' : 'veces'} en el año`}
                            className="shrink-0 max-w-[12rem] flex items-center gap-1.5 rounded-full border border-border-card bg-surface-card-hover p-0.5 pr-2.5 text-left min-h-[var(--tap-min)] md:min-h-0 transition-colors hover:border-brand/50 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-brand">
                            <span className="relative shrink-0">
                                <Miniatura src={f.foto_url} tamano="w-7 h-7" />
                                <span className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full bg-brand text-white flex items-center justify-center" aria-hidden>
                                    <Plus size={9} strokeWidth={3} />
                                </span>
                            </span>
                            <span className="min-w-0 truncate text-micro font-semibold text-content">{f.nombre}</span>
                            <span className="shrink-0 text-micro font-bold tabular-nums text-content-3">{f.veces}×</span>
                        </button>
                    ))}
                </div>
                {/* El centrado va en el contenedor: en el botón, su propio movimiento al
                    pasar el cursor pisaba el translate y la flecha se iba hacia abajo. */}
                {bordes.izq && (
                    <span className="absolute inset-y-0 left-0 flex items-center">
                        <Button size="xs" variant="secondary" icon={ChevronLeft} iconOnly aria-label="Ver los anteriores" tabIndex={-1}
                            onClick={() => mover(-1)} className="rounded-full shadow-md" />
                    </span>
                )}
                {bordes.der && (
                    <span className="absolute inset-y-0 right-0 flex items-center">
                        <Button size="xs" variant="secondary" icon={ChevronRight} iconOnly aria-label="Ver más" tabIndex={-1}
                            onClick={() => mover(1)} className="rounded-full shadow-md" />
                    </span>
                )}
            </div>
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
            {!buscando && q.trim().length >= 2 && !abierto && (
                <p className="text-micro text-content-3">Sin resultados para «{q.trim()}». Prueba con el principio activo o menos letras.</p>
            )}
            {abierto && (
                <ul id={idLista} role="listbox" aria-label="Productos encontrados"
                    className="rounded-xl border border-border-card divide-y divide-divider max-h-72 overflow-y-auto overscroll-contain">
                    {resultados.map((p, i) => (
                        <li key={p.id} id={`${idLista}-${i}`} role="option" aria-selected={i === nav.activo}
                            onMouseEnter={() => nav.setActivo(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(p)}
                            className={`px-3 py-1.5 min-h-[var(--tap-min)] flex items-center gap-3 cursor-pointer active:scale-[0.99] ${i === nav.activo ? 'bg-brand/10' : ''}`}>
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
// Con problema: borde y fondo rojos, el campo culpable marcado, y debajo qué
// pasa y qué hacer, con sus botones.
function Linea({ indice, linea, fila, foto, lotes, cotizando, problema, puedeAutorizar, listaCliente, onCambiar, onQuitar, onListo, onResolver }) {
    const pres = opcionesDePresentacion(fila, linea);
    const presentaciones = pres.options;
    const cant = Number(linea.cantidad) || 0;
    // Sólo los precios a los que tiene acceso el cliente: el suyo y los más altos.
    const opciones = opcionesDePrecio(fila?.precios, fila?.lista_auto);
    // El precio que le toca al cliente sale ya marcado; elegir otro lo
    // autoriza, y volver al suyo quita la autorización (`lista: null`).
    const opcionesPrecio = opciones.map((o) => ({ value: o.lista, label: `${o.nombre} · ${formatMoney(o.precio)}` }));
    const listaElegida = (linea.lista && opciones.some((o) => o.lista === linea.lista) ? linea.lista : null)
        ?? fila?.lista ?? listaCliente ?? '';
    const nombre = fila?.nombre ?? linea.nombre;
    const malaCantidad = problema && (problema.tipo === 'existencia' || problema.tipo === 'cantidad');
    return (
        <div data-fila={indice} data-campo={`linea-${linea.producto_id}-${linea.factor}`}
            className={`rounded-lg border-l-[3px] py-1.5 pl-2 pr-1 transition-colors ${problema
                ? 'border-danger bg-danger/5' : 'border-transparent focus-within:bg-brand/5 hover:bg-surface-card-hover'}`}>
            <div className="grid max-md:grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_168px_112px_208px_84px_32px] gap-x-2 gap-y-1.5 items-center">
                <div className="min-w-0 flex items-center gap-2">
                    <Miniatura src={foto} />
                    <div className="min-w-0">
                        <p className="text-body-sm font-semibold text-content leading-tight truncate" title={nombre}>{nombre}</p>
                        <p className="text-micro text-content-3 flex flex-wrap items-center gap-x-1.5">
                            {fila?.bajo_receta && <span className="text-warning-text font-bold">Bajo Receta</span>}
                            {fila && <span className={malaCantidad ? 'text-danger-text font-bold' : ''}>Existencia {fila.existencia}</span>}
                            {fila?.lista && !linea.lista && fila.lista !== listaCliente && <span>· {nombreDeLista(fila.lista)} aquí</span>}
                        </p>
                    </div>
                </div>
                <span className="md:hidden"><Button size="sm" variant="ghost" icon={X} iconOnly aria-label={`Quitar ${nombre}`} onClick={onQuitar} /></span>
                <div className="max-md:col-span-2 max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-2 md:contents">
                    <div className="max-md:w-32 md:w-full min-w-0" data-col="0">
                        <LiquidSelect compact clearable={false} value={pres.value} options={presentaciones} ariaLabel={`Presentación de ${nombre}`}
                            invalid={problema?.tipo === 'precio'} disabled={presentaciones.length < 2} onChange={(v) => onCambiar(pres.leer(v))} />
                    </div>
                    <div className="flex items-center justify-center gap-0.5 min-w-0" data-col="1">
                        {/* Un cobro con monto va una sola vez: el monto ya es el total. */}
                        <Button size="xs" variant="ghost" icon={Minus} iconOnly aria-label="Una menos" tabIndex={-1} disabled={Boolean(fila?.cobro_con_monto)}
                            onClick={() => onCambiar({ cantidad: Math.max(1, cant - 1) })} />
                        <div className="w-14">
                            <PortalInput compact inputMode="numeric" name={`cantidad-${linea.producto_id}-${linea.factor}`}
                                value={String(linea.cantidad)} aria-label={`Cantidad de ${nombre}`} hasError={Boolean(malaCantidad)} readOnly={Boolean(fila?.cobro_con_monto)}
                                onFocus={(e) => e.target.select()}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onListo(); } }}
                                onChange={(e) => onCambiar({ cantidad: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                        </div>
                        <Button size="xs" variant="ghost" icon={Plus} iconOnly aria-label="Una más" tabIndex={-1} disabled={Boolean(fila?.cobro_con_monto)}
                            onClick={() => onCambiar({ cantidad: Math.min(999, cant + 1) })} />
                    </div>
                    <div className="max-md:min-w-[9rem] max-md:flex-1 md:w-full md:min-w-0" data-col="2">
                        {fila?.cobro_con_monto ? (
                            // Cobro con monto: lo escribe administración (neto + IVA), o pega el correo.
                            <PortalInput compact prefix="$" inputMode="decimal" name={`monto-${linea.producto_id}`}
                                value={linea.monto ?? ''} placeholder="Neto + IVA" aria-label={`Monto de ${nombre}: neto más IVA`}
                                hasError={problema?.tipo === 'precio'}
                                onPaste={(e) => {
                                    const m = montoDelCorreo(e.clipboardData?.getData('text'));
                                    if (!m) return;
                                    e.preventDefault();
                                    onCambiar({ monto: m.monto });
                                }}
                                onChange={(e) => onCambiar({ monto: e.target.value.replace(/[^\d.]/g, '').replace(/^(\d{0,5})(\.\d{0,2})?.*$/, '$1$2') })} />
                        ) : fila && !opcionesPrecio.length ? (
                            <p className="text-body-sm font-semibold text-danger-text">Sin precio</p>
                        ) : puedeAutorizar ? (
                            <LiquidSelect compact clearable={false} value={listaElegida} options={opcionesPrecio} ariaLabel={`Precio de ${nombre}`}
                                onChange={(v) => onCambiar({ lista: !v || v === (fila?.lista_auto ?? (fila?.lista && !linea.lista ? fila.lista : listaCliente)) ? null : v })} />
                        ) : (
                            <p className="text-body-sm tabular-nums text-content-2">
                                {fila?.precio != null ? formatMoney(fila.precio) : '…'}
                                <span className="text-micro text-content-3"> {nombreDeLista(fila?.lista)}</span>
                            </p>
                        )}
                    </div>
                    <p className={`max-md:ml-auto text-right text-body-sm font-black tabular-nums ${cotizando ? 'text-content-3' : problema ? 'text-danger-text line-through' : 'text-content'}`}>
                        {fila ? formatMoney(fila.subtotal) : '…'}
                    </p>
                    <div className="max-md:hidden" data-col="3">
                        <Button size="sm" variant="ghost" icon={X} iconOnly aria-label={`Quitar ${nombre} (Supr)`} onClick={onQuitar} />
                    </div>
                </div>
            </div>
            {/* El lote va en su propia fila, a lo ancho: metido bajo el nombre
                se partía en tres renglones en la columna angosta (kiosco de
                Salud 4, 2026-11-17). */}
            <div className="pl-10 md:pl-11">
                <Lotes lotes={lotes} cantidad={cant} factor={linea.factor} nombre={nombre} elegido={linea.lote}
                    presentacion={fila?.tipo ?? presentaciones.find((p) => p.value === pres.value)?.label}
                    onElegir={(lote) => onCambiar({ lote })} />
            </div>
            {problema && (
                <div className="mt-1.5 md:pl-11 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                    <p className="min-w-0 flex-1 basis-60 text-micro leading-snug break-words">
                        <span className="font-bold text-danger-text">{conMayuscula(problema.titulo.replace(/^[^:]+:\s*/, ''))}</span>{' '}
                        <span className="text-content-2">{problema.ayuda}</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                        {problema.acciones.map((a) => (
                            <Button key={`${a.id}-${a.label}`} size="xs" variant={a.id === 'quitar' ? 'ghost' : 'secondary'}
                                onClick={() => onResolver(problema, a)}>{a.label}</Button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── De qué lote sale ──────────────────────────────────────────────────────
// La caja usa los lotes en el orden en que llegan (GENERICO primero, después
// el que vence antes). Al lado de la existencia va el primero del que sale; al
// tocarlo, todos con lo que tiene cada uno y cuánto se lleva de él.
function Lotes({ lotes, cantidad, factor, presentacion, elegido, nombre, onElegir }) {
    const [abierto, setAbierto] = useState(false);
    const cerrar = useCallback(() => setAbierto(false), []);
    const id = useId();
    const { btnRef, caja } = useAnclaje(abierto, cerrar, id);
    if (!lotes?.length) return null;
    const hoy = hoySV();
    const vigente = lotes.some((l) => mismoLote(l, elegido)) ? elegido : null;
    const plan = planDeLotes(lotes, cantidad, factor, vigente);
    const usados = plan.lotes.filter((l) => l.enteras || l.sueltas);
    const primero = usados[0] ?? plan.lotes[0];
    const vencido = (l) => Boolean(l.vence) && l.vence < hoy;
    const cuando = (l) => (!l.vence ? 'sin fecha' : vencido(l) ? `venció ${mesDeVencimiento(l.vence)}` : `vence ${mesDeVencimiento(l.vence)}`);
    const tono = (l) => (vencido(l) ? 'text-danger-text font-bold' : vencePronto(l.vence, hoy) ? 'text-warning-text font-bold' : '');
    const f = Math.max(1, Number(factor) || 1);
    const cuanto = (l) => [l.enteras ? `${l.enteras} ${String(presentacion || '').toLowerCase()}` : '', l.sueltas ? `${l.sueltas} u.` : '']
        .filter(Boolean).join(' + ');
    const pres = String(presentacion || 'presentación').toLowerCase();
    // Lo que daría cada lote si se elige: nada → no se puede elegir (antes
    // quedaba marcado y caja sacaba todo de otros); una parte → se avisa.
    const aporte = (l) => {
        const p = planDeLotes(lotes, cantidad, factor, l).lotes.find((x) => mismoLote(x, l));
        return (p?.enteras ?? 0) + (p?.sueltas ?? 0);
    };
    const alcanza = (l) => (Number(l.unidades) || 0) >= (Number(cantidad) || 0) * f;
    // El elegido no da nada (no completa ni una) o sólo una parte: hay que traer otro.
    const elegidoNoDa = Boolean(vigente) && !usados.some((l) => mismoLote(l, vigente));
    const elegidoNoAlcanza = Boolean(vigente) && (elegidoNoDa || usados.length > 1);
    const otros = usados.filter((l) => !mismoLote(l, vigente)).map((l) => l.lote);
    const nombresDe = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] ?? '');
    return (
        <>
            {/* Control de lote: siempre a la vista de qué lote sale y cuánto de cada uno. */}
            <button ref={btnRef} type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} aria-haspopup="dialog"
                aria-label={`Lotes de ${nombre}: ${(usados.length ? usados : [primero]).map((l) => `${l.lote}, ${cuando(l)}${cuanto(l) ? `, sale ${cuanto(l)}` : ''}`).join('; ')}. Cambiar lote`}
                className={`mt-0.5 inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border p-1 pr-2 min-h-[var(--tap-min)] md:min-h-0 text-left transition-colors active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-brand ${elegidoNoAlcanza
                    ? 'border-warning/40 bg-warning/10' : vigente ? 'border-brand/40 bg-brand/10' : 'border-border-card bg-surface-card-hover hover:border-brand/50'}`}>
                {(usados.length ? usados : [primero]).map((l) => (
                    <span key={`${l.lote}-${l.vence}`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-surface-card px-1.5 py-0.5 text-caption">
                        <Layers size={12} className="shrink-0 text-content-3" />
                        <span className="text-content-3">Lote</span>
                        <span className="font-black text-content">{l.lote}</span>
                        <span className={tono(l) || 'text-content-2'}>{cuando(l)}</span>
                        {cuanto(l) && <span className="font-black tabular-nums text-brand-text">· sale {cuanto(l)}</span>}
                    </span>
                ))}
                {plan.armada && <span className="text-caption font-bold text-brand-text">armada</span>}
                <span className="inline-flex items-center gap-0.5 text-caption font-semibold text-content-2">
                    {lotes.length > 1 ? 'Cambiar' : 'Ver'}<ChevronDown size={12} />
                </span>
            </button>
            {elegidoNoAlcanza && (
                <p className="mt-0.5 flex items-start gap-1 text-caption font-bold text-warning-text">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span>
                        {elegidoNoDa
                            ? <>El lote {vigente.lote} no completa {Number(cantidad) || 0} {pres}. Sale del lote {nombresDe(otros)}: trae ese.</>
                            : <>El lote {vigente.lote} no alcanza. Lo demás sale del lote {nombresDe(otros)}: trae también ese.</>}
                    </span>
                </p>
            )}
            <Popover abierto={abierto} caja={caja} id={id} lado="izquierda" ariaLabel={`Lotes de ${nombre}`}
                className="w-[22rem] p-2 space-y-1.5">
                <p className="px-1 text-micro font-black text-content-3 uppercase tracking-widest">Lotes en esta sucursal</p>
                <div role="radiogroup" aria-label="De qué lote sale" className="space-y-1">
                    <button type="button" role="radio" aria-checked={!vigente} onClick={() => { onElegir(null); cerrar(); }}
                        className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-caption active:scale-[0.97] ${!vigente ? 'bg-brand/10 ring-1 ring-brand/30' : 'hover:bg-surface-card-hover'}`}>
                        <span className="flex-1 font-semibold text-content">Automático</span>
                        <span className="text-content-3">primero el que vence antes</span>
                    </button>
                    {plan.lotes.map((l) => {
                        const este = mismoLote(l, vigente);
                        const sale = cuanto(l);
                        const da = aporte(l);
                        const nota = da === 0 ? `no completa ${f > 1 ? `una ${pres}` : 'lo que pides'}` : !alcanza(l) ? 'no alcanza solo' : null;
                        return (
                            <button key={`${l.lote}-${l.vence}`} type="button" role="radio" aria-checked={este} disabled={da === 0 && !este}
                                onClick={() => { onElegir({ lote: l.lote, vence: l.vence ?? null }); cerrar(); }}
                                className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-caption active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${este ? 'bg-brand/10 ring-1 ring-brand/30' : 'enabled:hover:bg-surface-card-hover'}`}>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-semibold text-content">{l.lote}</span>
                                    {nota && <span className={`block text-micro ${da === 0 ? 'text-content-3' : 'text-warning-text font-semibold'}`}>{nota}</span>}
                                </span>
                                <span className={tono(l) || 'text-content-2'}>{cuando(l)}</span>
                                <span className="w-14 text-right tabular-nums text-content-2">{l.unidades} u.</span>
                                <span className="w-24 text-right tabular-nums font-bold text-brand-text truncate">{sale ? `sale ${sale}` : ''}</span>
                            </button>
                        );
                    })}
                </div>
                {plan.armada && (
                    <p className="px-1 text-micro text-content-2">
                        Ningún lote completa {f > 1 ? `la ${String(presentacion || 'presentación').toLowerCase()}` : 'lo que pides'}: se arma con unidades de varios lotes y se cobra al precio de la {String(presentacion || 'presentación').toLowerCase()}.
                    </p>
                )}
                {plan.faltan > 0 && <p className="px-1 text-micro font-bold text-danger-text">Con estos lotes no se completan {plan.faltan}.</p>}
            </Popover>
        </>
    );
}

// ── Lo que quedó en caja ──────────────────────────────────────────────────
// La venta de una preventa que llegó a caja, lista para cobrar.
function ventaDeCobro(p, puedeAutorizar) {
    return {
        ...VACIA, lineas: lineasDeVenta(p.venta).map((l) => (puedeAutorizar ? l : { ...l, lista: null })),
        cliente: p.customer_id ? { id: p.customer_id, name: p.cliente } : null,
        documento: p.venta?.documento === 'credito_fiscal' ? 'credito_fiscal' : 'consumidor_final',
        pago: p.venta?.pago ?? 'contado', puntos: p.venta?.puntos ? String(p.venta.puntos) : '',
        corrigiendo: { id: p.id, codigo: p.codigo, referencia: p.referencia, cobro: true },
    };
}

// Atajos de efectivo: exacto y los billetes que suelen entregar.
function billetesPara(total) {
    const t = Math.round(total * 100) / 100;
    const montos = [t, Math.ceil(t), Math.ceil(t / 5) * 5, Math.ceil(t / 10) * 10, Math.ceil(t / 20) * 20, Math.ceil(t / 50) * 50];
    const vistos = new Set();
    return montos.filter((m) => m > 0 && !vistos.has(m) && vistos.add(m)).slice(0, 4)
        .map((m, i) => [i === 0 ? 'Exacto' : formatMoney(m).replace(/\.00$/, ''), m]);
}

function CobroHecho({ cobro, onSiguiente }) {
    return (
        <section data-surface="card" className="p-6 md:p-8 max-w-lg mx-auto text-center flex flex-col items-center gap-4">
            <span className="w-16 h-16 rounded-full bg-success/15 text-success-text flex items-center justify-center">
                <CheckCircle2 size={36} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1">
                <p className="text-title font-black text-content">Venta cobrada</p>
                <p className="text-body text-content-2">
                    #{cobro.referencia} · {cobro.cliente ?? 'Cliente frecuente'} · {DOCUMENTOS.find((d) => d.value === cobro.documento)?.label}
                </p>
            </div>
            <dl className="w-full flex flex-col gap-1.5 text-body border-y border-subtle py-3">
                <div className="flex justify-between"><dt className="text-content-3">Total</dt><dd className="font-bold tabular-nums">{formatMoney(cobro.total)}</dd></div>
                {cobro.recibido != null && (
                    <div className="flex justify-between"><dt className="text-content-3">Recibido</dt><dd className="tabular-nums">{formatMoney(cobro.recibido)}</dd></div>
                )}
                {cobro.vuelto != null ? (
                    <div className="flex items-baseline justify-between pt-1"><dt className="font-bold text-content">Vuelto</dt>
                        <dd className="text-display font-black tabular-nums text-success-text leading-none">{formatMoney(cobro.vuelto)}</dd></div>
                ) : (
                    <div className="flex justify-between"><dt className="text-content-3">Pago</dt><dd>{PAGOS.find((x) => x.value === cobro.pago)?.label}</dd></div>
                )}
            </dl>
            <Notice variant="info" compact>En la muestra no se emitió ni se imprimió nada.</Notice>
            <Button size="lg" icon={ChevronRight} onClick={onSiguiente} autoFocus>Siguiente en la cola</Button>
        </section>
    );
}

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
                {p.externo_ref
                    ? <span className="text-title font-black tabular-nums text-content w-16 shrink-0">#{p.externo_ref}</span>
                    : (
                        // Sin número de caja todavía: el estado en lugar de un guion.
                        <span className={`w-16 shrink-0 flex justify-center ${est.tono === 'danger' ? 'text-danger-text' : 'text-content-3'}`}>
                            {est.tono === 'danger' ? <Ban size={22} /> : <Receipt size={22} />}
                        </span>
                    )}
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
                    {p.total != null && <span className="block text-body font-black tabular-nums">{formatMoney(p.total)}</span>}
                    <Badge variant={est.tono} size="sm" uppercase={false}>{est.texto}</Badge>
                    {p.cobro_distinto?.alerta && <Badge variant="danger" size="sm" uppercase={false}>Se cobró distinto</Badge>}
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
                    {p.cobro_distinto && (
                        <Notice variant={p.cobro_distinto.alerta ? 'danger' : 'info'}>
                            Se prometió {formatMoney(p.cobro_distinto.total_prometido)} y se facturó {formatMoney(p.cobro_distinto.total_cobrado)}.
                            <ul className="mt-1 space-y-0.5">
                                {diferenciasDelCobro(p.cobro_distinto).map((d) => (
                                    <li key={d.nombre}><span className="font-semibold">{d.nombre}</span>: {d.texto}</li>
                                ))}
                            </ul>
                        </Notice>
                    )}
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
