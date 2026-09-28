/**
 * Todo lo de un cliente en el programa de puntos.
 *
 * Reemplaza al panel «Puntos» de la ficha del cliente (pedido del usuario,
 * 2026-09-25: «en clientes lo quitamos, mejor que esté aquí»). Y lleva a editar
 * la ficha sin salir de la vista: abre el MISMO modal que usa Clientes
 * (`openModal('editCliente')`), no una copia.
 *
 * ── El rediseño del mismo día («más moderno, más interactivo») ─────────────
 * Tres lecturas, de lo general a lo particular:
 *
 *   1. el saldo y en qué se fue lo acumulado — una barra que reparte lo ganado
 *      entre disponible, canjeado y vencido, con su leyenda;
 *   2. la historia por mes — una gráfica que es además un CONTROL: tocar un mes
 *      deja sólo sus movimientos;
 *   3. los movimientos agrupados por mes, filtrables por tipo, cada uno con su
 *      sala por nombre y su valor en dólares.
 *
 * Todo sale de UNA lectura (`puntos_panel_cliente`); la historia por mes, la
 * composición y los grupos se derivan acá de los movimientos, así que no pueden
 * contradecir a la lista que se ve debajo.
 */
import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import {
    Star, Pencil, TrendingUp, Gift, Undo2, CalendarX, Wrench, History, CalendarClock, IdCard, Phone,
    ShoppingBag, X, KeyRound, BarChart3, Receipt, Cake, SlidersHorizontal,
} from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import SegmentedControl from '../../components/common/SegmentedControl';
import SearchInput from '../../components/common/SearchInput';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import { LoadingState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, fechaTexto } from '@nucleo/utils/fecha';
import { fetchPuntosCliente, ajustarPuntos } from '@nucleo/data/puntos';
import CodigoDeAcceso from './CodigoDeAcceso';

// `recharts` viaja en su chunk: el modal se abre sin esperarlo.
const GraficaCliente = lazy(() => import('./GraficasPuntos').then((m) => ({ default: m.GraficaCliente })));

const pts = (n) => formatQty(Number(n) || 0);
// 100 puntos = US$1.00 (cláusula 4 del reglamento).
const dolares = (n) => formatMoney((Number(n) || 0) / 100);

// Cada tipo de movimiento con su ícono. El color va en la BURBUJA del ícono;
// el texto y el número quedan en tinta normal (DESIGN: el texto no lleva el
// color de la serie).
const TIPO = {
    compra:      { icono: ShoppingBag, rotulo: 'Compra',      burbuja: 'bg-success/10 text-success-text' },
    cumpleanos:  { icono: Cake,        rotulo: 'Cumpleaños',  burbuja: 'bg-brand/10 text-brand-text' },
    ajuste:      { icono: Wrench,      rotulo: 'Ajuste',      burbuja: 'bg-surface-card-hover text-content-3' },
    canje:       { icono: Gift,        rotulo: 'Canje',       burbuja: 'bg-warning/10 text-warning-text' },
    // La factura del canje se anuló y los puntos volvieron (2026-09-28).
    canje_devuelto: { icono: Undo2,    rotulo: 'Canje devuelto', burbuja: 'bg-success/10 text-success-text' },
    anulacion:   { icono: Undo2,       rotulo: 'Compra anulada', burbuja: 'bg-danger/10 text-danger-text' },
    vencimiento: { icono: CalendarX,   rotulo: 'Vencimiento', burbuja: 'bg-surface-card-hover text-content-3' },
};
const FILTROS = [
    { value: 'todos',  label: 'Todos' },
    { value: 'entran', label: 'Acumulados' },
    { value: 'salen',  label: 'Canjes' },
];
const DE_A = 40;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (clave) => {
    const [a, m] = clave.split('-').map(Number);
    return `${MESES[m - 1]} ${a}`;
};

export default function ClientePuntosModal({ open, customerId, puedeEditarFicha, puedeAjustar, enPortal, onEditar, onClose }) {
    if (!customerId) return null;
    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-4xl" ariaLabel="Puntos del cliente">
            <Cuerpo key={customerId} customerId={customerId} puedeEditarFicha={puedeEditarFicha}
                puedeAjustar={puedeAjustar} enPortal={enPortal}
                onEditar={onEditar} onClose={onClose} />
        </LiquidModal>
    );
}

function Cuerpo({ customerId, puedeEditarFicha, puedeAjustar, enPortal, onEditar, onClose }) {
    const showToast = useToastStore((s) => s.showToast);
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [mostrar, setMostrar] = useState(DE_A);
    const [filtro, setFiltro] = useState('todos');
    const [mesElegido, setMesElegido] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [unidad, setUnidad] = useState('puntos');
    // Sube después de un ajuste: se relee el estado de cuenta entero, así el
    // saldo que se ve es el que la base dice, no una suma hecha acá.
    const [version, setVersion] = useState(0);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const d = await fetchPuntosCliente(customerId);
                if (vivo) setDatos(d);
            } catch (e) {
                if (vivo) showToast('No se pudo cargar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [customerId, showToast, version]);

    const cliente = datos?.cliente;
    const cuenta = datos?.cuenta;
    const salas = useMemo(() => datos?.salas ?? {}, [datos]);
    const sala = (codigo) => (codigo ? salas[codigo] ?? codigo : null);
    const movimientos = useMemo(() => cuenta?.movimientos ?? [], [cuenta]);
    const vencimientos = cuenta?.vencimientos ?? [];
    const proximo = vencimientos[0] ?? null;

    // En qué se fue lo acumulado. Se cuenta desde los movimientos y no desde
    // `usados`, que suma canjes y vencimientos en un solo número.
    const reparto = useMemo(() => {
        let canjeado = 0; let vencido = 0; let anulado = 0;
        for (const m of movimientos) {
            const p = Math.abs(Number(m.puntos) || 0);
            if (m.tipo === 'canje') canjeado += p;
            else if (m.tipo === 'vencimiento') vencido += p;
            else if (m.tipo === 'anulacion') anulado += p;
        }
        return { canjeado, vencido, anulado };
    }, [movimientos]);

    // La historia por mes, con el saldo al cierre de cada uno. El saldo se
    // reconstruye HACIA ATRÁS desde el de hoy: es el único dato firme, y así el
    // último mes cierra exactamente en lo que dice la tarjeta de arriba.
    const meses = useMemo(() => {
        const porMes = new Map();
        for (const m of movimientos) {
            const clave = String(m.fecha).slice(0, 7);
            const fila = porMes.get(clave) ?? { mes: clave, acumulado: 0, canjeado: 0, neto: 0 };
            const p = Number(m.puntos) || 0;
            // Un canje devuelto no es algo ganado: resta de lo canjeado del mes.
            if (m.tipo === 'canje_devuelto') fila.canjeado -= p;
            else if (p > 0) fila.acumulado += p;
            if (m.tipo === 'canje') fila.canjeado += -p;
            fila.neto += p;
            porMes.set(clave, fila);
        }
        const lista = [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes));
        let saldo = Number(cuenta?.saldo) || 0;
        for (const f of lista) { f.saldo = saldo; saldo -= f.neto; }
        // Los últimos 18 meses con movimiento: más no entra legible en el modal.
        return lista.slice(0, 18).reverse();
    }, [movimientos, cuenta]);

    // El documento y quién, por movimiento (`puntos_panel_cliente.detalle`).
    // Un canje devuelto comparte los datos de su canje.
    const detalle = useMemo(() => datos?.detalle ?? {}, [datos]);
    const infoDe = useCallback((m) => detalle[`${m.tipo === 'canje_devuelto' ? 'canje' : m.tipo}-${m.id}`] ?? {},
        [detalle]);

    const filtrados = useMemo(() => {
        const q = busqueda.trim();
        return movimientos.filter((m) => {
            const p = Number(m.puntos) || 0;
            if (filtro === 'entran' && p <= 0) return false;
            if (filtro === 'salen' && m.tipo !== 'canje') return false;
            if (mesElegido && String(m.fecha).slice(0, 7) !== mesElegido) return false;
            if (!q) return true;
            // Por documento, número de movimiento, quién, sala o motivo.
            const i = infoDe(m);
            return tokenMatch(q, i.documento, String(m.id), i.quien, salas[m.sucursal] ?? m.sucursal,
                m.motivo, String(Math.abs(p)));
        });
    }, [movimientos, filtro, mesElegido, busqueda, infoDe, salas]);

    // Agrupados por mes, sobre la tanda visible.
    const grupos = useMemo(() => {
        const out = [];
        for (const m of filtrados.slice(0, mostrar)) {
            const clave = String(m.fecha).slice(0, 7);
            let g = out[out.length - 1];
            if (!g || g.clave !== clave) { g = { clave, filas: [], entra: 0, sale: 0 }; out.push(g); }
            g.filas.push(m);
            const p = Number(m.puntos) || 0;
            if (p > 0) g.entra += p; else g.sale += -p;
        }
        return out;
    }, [filtrados, mostrar]);

    const cambiarFiltro = (v) => { setFiltro(v); setMostrar(DE_A); };
    const elegirMes = (m) => { setMesElegido(m); setMostrar(DE_A); };
    const ultimaCompra = movimientos.find((m) => m.tipo === 'compra');

    return (
        <>
            <LiquidModal.Header>
                {/* Compacto a propósito: el encabezado queda fijo, y en el teléfono
                    el nombre en tres renglones se comía un tercio de la pantalla.
                    El nombre cabe en dos renglones; el botón, a su lado, sólo con
                    el ícono en el teléfono. */}
                <div className="flex items-start justify-between gap-3 w-full">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-brand/10 text-brand-text flex items-center justify-center shrink-0">
                            <Star size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-body-lg sm:text-title font-black text-content line-clamp-2 sm:truncate leading-tight">
                                {cliente?.nombre ?? 'Cliente'}
                            </h2>
                            <p className="text-caption text-content-3 mt-0.5 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><IdCard size={12} />{cliente?.dui || 'Sin DUI'}</span>
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Phone size={12} />{cliente?.telefono || 'Sin teléfono'}</span>
                            </p>
                        </div>
                    </div>
                    {cliente && (
                        <>
                            {/* El `hidden` va en un envoltorio: puesto en el botón,
                                su propio `inline-flex` le ganaba y salían los dos. */}
                            <span className="hidden sm:block shrink-0">
                                <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onEditar(cliente)}>
                                    {puedeEditarFicha ? 'Editar cliente' : 'Ver ficha'}
                                </Button>
                            </span>
                            <span className="sm:hidden shrink-0">
                                <Button variant="secondary" size="sm" icon={Pencil} iconOnly onClick={() => onEditar(cliente)}
                                    title={puedeEditarFicha ? 'Editar cliente' : 'Ver ficha'}
                                    aria-label={puedeEditarFicha ? 'Editar cliente' : 'Ver ficha'} />
                            </span>
                        </>
                    )}
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                {cargando ? <LoadingState label="Buscando los puntos del cliente…" /> : !cliente ? (
                    <Notice variant="warning" bloque>No se encontró el cliente.</Notice>
                ) : (
                    <div className="flex flex-col gap-5">
                        {!cliente.acumula && (
                            <Notice variant="info" bloque>
                                Esta ficha es de un convenio: sus compras no acumulan puntos.
                            </Notice>
                        )}

                        {/* ── 1 · El saldo, y en qué se fue lo acumulado ─────
                            Una sola tarjeta: el saldo manda y los cuatro datos lo
                            acompañan. Eran cinco tarjetas —casi dos pantallas en
                            el teléfono— para seis números. */}
                        <div data-surface="card" className="p-4 sm:p-5 grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-5 min-w-0">
                            <div className="flex flex-col gap-4 min-w-0">
                                <div>
                                    <p className="text-caption font-bold text-content-3">Puntos disponibles</p>
                                    <p className="text-4xl sm:text-5xl font-black tabular-nums text-content leading-none mt-2">
                                        {pts(cuenta?.saldo)}
                                    </p>
                                    <p className="text-body-sm text-content-2 mt-2">
                                        Equivalen a <span className="font-black tabular-nums">{dolares(cuenta?.saldo)}</span> de descuento
                                    </p>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <p className="text-caption font-bold text-content-3">
                                        De los {pts(cuenta?.ganados)} acumulados
                                    </p>
                                    <Reparto ganados={Number(cuenta?.ganados) || 0} saldo={Number(cuenta?.saldo) || 0} {...reparto} />
                                </div>
                            </div>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 content-center md:border-l md:border-divider md:pl-5">
                                <Dato icono={TrendingUp} rotulo="Acumulados"
                                    valor={pts(cuenta?.ganados)} sub={dolares(cuenta?.ganados)} />
                                <Dato icono={Gift} rotulo="Canjeados"
                                    valor={pts(reparto.canjeado)} sub={dolares(reparto.canjeado)} />
                                <Dato icono={CalendarClock} rotulo="Próximo vencimiento"
                                    valor={proximo ? pts(proximo.puntos) : '—'}
                                    sub={proximo ? fechaTexto(proximo.vence_el, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Nada por vencer'} />
                                <Dato icono={Receipt} rotulo="Última compra"
                                    valor={ultimaCompra ? fechaTexto(ultimaCompra.fecha, { day: 'numeric', month: 'short' }) : '—'}
                                    sub={ultimaCompra ? (sala(ultimaCompra.sucursal) ?? '') : 'Sin compras'} />
                            </dl>
                        </div>

                        {/* El acceso sube, justo debajo del saldo (pedido del usuario,
                            2026-09-28): es lo que se usa con el cliente enfrente —
                            «¿cuánto tengo?, mándamelo»—, no un dato del fondo. */}
                        <CodigoDeAcceso customerId={cliente.id} nombre={cliente.nombre || ''}
                            telefono={cliente.telefono} puedeEditar={puedeEditarFicha} />

                        {puedeAjustar && (
                            <AjustarPuntos customerId={cliente.id} nombre={cliente.nombre}
                                saldo={Number(cuenta?.saldo) || 0} habilitado={enPortal}
                                onHecho={() => setVersion((v) => v + 1)} />
                        )}

                        {/* ── 2 · La historia por mes (tocar un mes filtra) ── */}
                        {meses.length > 0 && (
                            <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-3 min-w-0">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <Titulo icono={BarChart3}>Historia por mes</Titulo>
                                        <p className="text-caption text-content-3 mt-1">Toca un mes para ver solo sus movimientos.</p>
                                    </div>
                                    <SegmentedControl size="sm" value={unidad} onChange={setUnidad} label="Ver en"
                                        options={[
                                            { value: 'puntos', label: 'Puntos' },
                                            { value: 'dolares', label: 'Dólares' },
                                        ]} />
                                </div>
                                <Suspense fallback={<div className="animate-pulse rounded-card bg-surface-card-hover" style={{ height: 170 }} />}>
                                    <GraficaCliente meses={meses} unidad={unidad} activo={mesElegido} onElegir={elegirMes} />
                                </Suspense>
                            </section>
                        )}

                        {/* ── 3 · Los movimientos ─────────────────────────── */}
                        <section className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <Titulo icono={History}>Movimientos</Titulo>
                                <div className="flex flex-wrap items-center gap-2">
                                    {mesElegido && (
                                        <Button variant="ghost" size="sm" icon={X} onClick={() => elegirMes(null)}>
                                            <span className="capitalize">{nombreMes(mesElegido)}</span>
                                        </Button>
                                    )}
                                    <SearchInput size="sm" value={busqueda}
                                        onChange={(v) => { setBusqueda(v); setMostrar(DE_A); }}
                                        placeholder="Documento o vendedor…"
                                        ariaLabel="Buscar en los movimientos del cliente" />
                                    <SegmentedControl size="sm" value={filtro} onChange={cambiarFiltro}
                                        label="Tipo de movimiento" options={FILTROS} />
                                </div>
                            </div>

                            {filtrados.length === 0 ? (
                                <p className="text-body-sm text-content-3 py-4 text-center">
                                    {movimientos.length === 0 ? 'Sin movimientos todavía.' : 'Nada con ese filtro.'}
                                </p>
                            ) : (
                                <div className="flex flex-col gap-4">
                                    {grupos.map((g) => (
                                        <div key={g.clave} data-surface="card" className="overflow-hidden min-w-0">
                                            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-divider">
                                                <p className="text-caption font-black text-content-2 capitalize">{nombreMes(g.clave)}</p>
                                                <p className="text-caption text-content-3 tabular-nums">
                                                    {g.entra > 0 && <span>+{pts(g.entra)}</span>}
                                                    {g.entra > 0 && g.sale > 0 && <span> · </span>}
                                                    {g.sale > 0 && <span>−{pts(g.sale)}</span>}
                                                </p>
                                            </div>
                                            <div className="flex flex-col divide-y divide-divider">
                                                {g.filas.map((m) => <Movimiento key={`${m.tipo}-${m.id}`} m={m} sala={sala(m.sucursal)} info={infoDe(m)} />)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {filtrados.length > mostrar && (
                                <div className="flex justify-center">
                                    <Button variant="ghost" size="sm" onClick={() => setMostrar((n) => n + DE_A)}>
                                        Ver {Math.min(DE_A, filtrados.length - mostrar)} más de {filtrados.length - mostrar}
                                    </Button>
                                </div>
                            )}
                        </section>

                        {vencimientos.length > 1 && (
                            <section className="flex flex-col gap-2">
                                <Titulo icono={CalendarClock}>Cuándo vencen</Titulo>
                                <div className="flex flex-wrap gap-2">
                                    {vencimientos.map((v) => (
                                        <span key={v.vence_el} data-surface="card"
                                            className="px-3 py-2 text-caption text-content-2 tabular-nums">
                                            <span className="font-black text-content">{pts(v.puntos)}</span> el {fechaNumerica(v.vence_el)}
                                        </span>
                                    ))}
                                </div>
                            </section>
                        )}

                        {(datos.cuentas_anteriores ?? []).length > 0 && (
                            <section className="flex flex-col gap-2">
                                <Titulo icono={History}>Del sistema anterior</Titulo>
                                {datos.cuentas_anteriores.map((a) => (
                                    <p key={a.id} className="text-caption text-content-2">
                                        Cuenta <span className="font-bold tabular-nums">{a.id}</span>
                                        {a.como === 'manual'
                                            ? <> · asignada a mano el {fechaNumerica(a.cuando)}{a.nota ? ` — «${a.nota}»` : ''}</>
                                            : <> · pasó por su DUI</>}
                                    </p>
                                ))}
                            </section>
                        )}

                    </div>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex items-center justify-between gap-3 w-full">
                    <p className="text-caption text-content-3 whitespace-nowrap">
                        {movimientos.length > 0 && `${pts(movimientos.length)} movimientos`}
                    </p>
                    <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                </div>
            </LiquidModal.Footer>
        </>
    );
}

/**
 * Lo acumulado, repartido: cuánto sigue disponible, cuánto se canjeó y cuánto
 * venció. Una barra apilada — el ANCHO es el dato, por eso `data-medida="dato"`
 * (el barrido del teléfono no le exige el alto de un dedo).
 */
function Reparto({ ganados, saldo, canjeado, vencido, anulado }) {
    if (ganados <= 0) return null;
    const partes = [
        { clave: 'saldo',    rotulo: 'Disponibles', valor: saldo,    color: 'bg-[var(--chart-1)]' },
        { clave: 'canjeado', rotulo: 'Canjeados',   valor: canjeado, color: 'bg-[var(--chart-6)]' },
        { clave: 'vencido',  rotulo: 'Vencidos',    valor: vencido,  color: 'bg-content-3' },
        { clave: 'anulado',  rotulo: 'Anulados',    valor: anulado,  color: 'bg-danger' },
    ].filter((p) => p.valor > 0);
    return (
        <div className="flex flex-col gap-2">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-card-hover gap-0.5" data-medida="dato"
                role="img" aria-label={partes.map((p) => `${p.rotulo} ${pts(p.valor)}`).join(', ')}>
                {partes.map((p) => (
                    <span key={p.clave} className={`h-full ${p.color}`} style={{ width: `${(p.valor / ganados) * 100}%` }} />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
                {partes.map((p) => (
                    <span key={p.clave} className="inline-flex items-center gap-1.5 text-caption text-content-3">
                        <span className={`w-2 h-2 rounded-full ${p.color}`} />
                        {p.rotulo} <span className="font-bold text-content-2 tabular-nums">{Math.round((p.valor / ganados) * 100)}%</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

// Los motivos más comunes, para que el libro se pueda leer después. «Otro»
// obliga a escribir la nota.
const MOTIVOS_DE_AJUSTE = [
    { value: 'Cumpleaños', label: 'Cumpleaños' },
    { value: 'Promoción', label: 'Promoción' },
    { value: 'Reclamo del cliente', label: 'Reclamo del cliente' },
    { value: 'Corrección', label: 'Corrección' },
    { value: 'Otro', label: 'Otro' },
];

/**
 * Dar o quitar puntos a mano (decisión del usuario, 2026-09-28: «debe haber
 * una forma de asignar puntos y restar manual, sólo con permiso»). El permiso
 * es `puntos_ajustar` y la base lo vuelve a exigir; también exige el motivo y
 * rechaza quitar más de lo que el cliente tiene. Antes del arranque la base lo
 * rechaza —el saldo todavía lo manda el sistema anterior— y acá se dice por qué.
 */
function AjustarPuntos({ customerId, nombre, saldo, habilitado, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const [abierto, setAbierto] = useState(false);
    const [sentido, setSentido] = useState('dar');
    const [cantidad, setCantidad] = useState('');
    const [motivo, setMotivo] = useState('');
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);

    if (!habilitado) {
        return (
            <p className="text-caption text-content-3 flex items-center gap-2">
                <SlidersHorizontal size={14} className="shrink-0" />
                Dar o quitar puntos se habilita el 1 de octubre, cuando el programa pasa al portal.
            </p>
        );
    }
    if (!abierto) {
        return (
            <div>
                <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={() => setAbierto(true)}>
                    Dar o quitar puntos
                </Button>
            </div>
        );
    }

    const n = Number(cantidad) || 0;
    const quitaDeMas = sentido === 'quitar' && n > saldo;
    const falta = !n ? 'Escribe cuántos puntos.' : !motivo ? 'Elige el motivo.'
        : motivo === 'Otro' && !nota.trim() ? 'Con «Otro», escribe el detalle.'
        : quitaDeMas ? `Tiene ${pts(saldo)} puntos; no se le pueden quitar ${pts(n)}.` : null;

    const guardar = async () => {
        if (falta) return;
        setGuardando(true);
        try {
            // La bitácora la anota `ajustarPuntos` (D3).
            const r = await ajustarPuntos({ customerId, puntos: sentido === 'dar' ? n : -n, motivo, nota }, { nombre });
            showToast(sentido === 'dar' ? 'Puntos dados' : 'Puntos quitados',
                `Ahora tiene ${pts(r?.saldo)} puntos.`, 'success');
            setAbierto(false); setCantidad(''); setMotivo(''); setNota('');
            onHecho?.();
        } catch (e) {
            showToast('No se pudo ajustar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Titulo icono={SlidersHorizontal}>Dar o quitar puntos</Titulo>
                <SegmentedControl size="sm" value={sentido} onChange={setSentido} label="Qué hacer"
                    options={[{ value: 'dar', label: 'Dar' }, { value: 'quitar', label: 'Quitar' }]} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PortalInput label="Puntos" name="puntos_ajuste" value={cantidad} inputMode="numeric"
                    placeholder="50"
                    onChange={(e) => setCantidad(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    helperText={n ? `Equivalen a ${dolares(n)}` : undefined} />
                <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="text-caption font-bold text-content-2">Motivo</span>
                    <LiquidSelect value={motivo} onChange={setMotivo} options={MOTIVOS_DE_AJUSTE}
                        placeholder="Elegir motivo" clearable={false} ariaLabel="Motivo del ajuste" />
                </div>
            </div>
            <PortalInput label="Detalle" name="nota_ajuste" value={nota}
                placeholder={motivo === 'Otro' ? 'Obligatorio con «Otro»' : 'Opcional: ticket, promoción, quién lo pidió'}
                onChange={(e) => setNota(e.target.value.slice(0, 200))} />
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className={`text-caption ${falta ? 'text-content-3' : 'text-content-2'}`}>
                    {falta ?? `${sentido === 'dar' ? 'Se le darán' : 'Se le quitarán'} ${pts(n)} puntos (${dolares(n)}). Quedará con ${pts(sentido === 'dar' ? saldo + n : saldo - n)}.`}
                </p>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</Button>
                    <Button variant="primary" size="sm" onClick={guardar} disabled={!!falta || guardando} loading={guardando}>
                        {sentido === 'dar' ? 'Dar puntos' : 'Quitar puntos'}
                    </Button>
                </div>
            </div>
        </section>
    );
}

/** Un dato del saldo: rótulo con su ícono, el número y una línea de contexto. */
function Dato({ icono: Icono, rotulo, valor, sub }) {
    return (
        <div className="min-w-0">
            <dt className="text-caption font-bold text-content-3 flex items-center gap-1.5 truncate">
                <Icono size={13} className="shrink-0" /> {rotulo}
            </dt>
            <dd className="text-body-lg font-black tabular-nums text-content leading-tight mt-1 truncate">{valor}</dd>
            {sub && <dd className="text-caption text-content-3 truncate">{sub}</dd>}
        </div>
    );
}

// Cómo se dice quién hizo el movimiento (2026-09-28). En lo automático —la
// compra, el canje— la persona es quien vendió.
const ROL = { 'vendió': 'Vendió', 'ajustó': 'Ajustó' };

function Movimiento({ m, sala, info = {} }) {
    const t = TIPO[m.tipo] ?? TIPO.ajuste;
    const Icono = t.icono;
    const p = Number(m.puntos) || 0;
    // El rótulo ya dice «Compra» o «Canje»: del motivo se quita esa palabra
    // para no leer «Compra · compra». Y si ya se sabe el documento, se muestra
    // ése en vez del «ticket …» del sistema anterior.
    let detalle = String(m.motivo ?? '')
        .replace(/^(compra anulada|canje aplicado en el sistema de ventas|la factura del canje se anuló|compra|canje|cortesía cumpleaños)(\s·\s)?/i, '')
        .trim();
    if (info.documento) {
        detalle = detalle.replace(/^(ticket\s+)?[0-9A-Za-z_-]+(\s·\s)?/, (x) => (x.includes(info.documento) || /ticket|DTE-|^\d/.test(x) ? '' : x)).trim();
        detalle = [info.documento, detalle].filter(Boolean).join(' · ');
    }
    // Regla del portal: quien hizo algo sale con FOTO y nombre + apellido
    // (`AvatarConEstado` + `shortEmployeeName`). Va en su propia línea: en el
    // teléfono, pegado a la fecha y la sala, se cortaba en «Vendió Monic…».
    const persona = info.quien && info.quien !== 'Automático'
        ? { id: info.quien_id, name: info.quien } : null;
    return (
        <div className="flex items-center gap-3 px-4 py-3 min-w-0">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${t.burbuja}`}>
                <Icono size={16} />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-body-sm font-bold text-content truncate">
                    {m.tipo === 'ajuste' && p > 0 ? 'Puntos dados' : m.tipo === 'ajuste' ? 'Puntos quitados' : t.rotulo}
                    {detalle ? <span className="font-normal text-content-3"> · {detalle}</span> : null}
                </p>
                <p className="text-caption text-content-3 tabular-nums truncate">
                    {fechaNumerica(m.fecha)}{sala ? ` · ${sala}` : ''}
                </p>
                {persona ? (
                    <p className="text-caption text-content-3 flex items-center gap-1.5 mt-1 min-w-0">
                        <AvatarConEstado emp={persona} px={18} radio="rounded-full" marco="" />
                        <span className="truncate">
                            {ROL[info.rol] ?? ''} <span className="font-bold text-content-2">{shortEmployeeName(persona)}</span>
                        </span>
                    </p>
                ) : info.quien === 'Automático' ? (
                    <p className="text-caption text-content-3 mt-1">Automático</p>
                ) : null}
            </div>
            <div className="text-right shrink-0">
                <p className="text-body-sm font-black tabular-nums text-content">
                    {p > 0 ? '+' : '−'}{pts(Math.abs(p))}
                </p>
                <p className="text-caption text-content-3 tabular-nums">{dolares(Math.abs(p))}</p>
            </div>
        </div>
    );
}

function Titulo({ icono: Icono, children }) {
    return (
        <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
            <Icono size={14} /> {children}
        </h3>
    );
}
