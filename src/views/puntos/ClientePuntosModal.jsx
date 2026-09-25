/**
 * Todo lo de un cliente en el programa de puntos.
 *
 * Reemplaza al panel «Puntos» de la ficha del cliente (pedido del usuario,
 * 2026-09-25: «en clientes lo quitamos, mejor que esté aquí»). Muestra el saldo,
 * lo acumulado y lo canjeado, cuándo vence, cada movimiento, las cuentas del
 * sistema anterior que se le asignaron y el código de acceso a «Mis puntos». Y
 * lleva a editar la ficha sin salir de la vista: abre el MISMO modal que usa
 * Clientes (`openModal('editCliente')`), no una copia.
 *
 * Se lee del libro del portal (`puntos_panel_cliente`), que desde la migración
 * es el espejo del sistema anterior y desde el arranque, la única verdad.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
    Star, Pencil, TrendingUp, Gift, Undo2, CalendarX, Wrench, History, CalendarClock, IdCard, Phone,
} from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { LoadingState } from '../../components/common/StateViews';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { formatMoney, formatQty } from '../../utils/formatNumber';
import { fechaNumerica, fechaTexto } from '../../utils/fecha';
import { fetchPuntosCliente } from '../../data/puntos';
import CodigoDeAcceso from './CodigoDeAcceso';

const pts = (n) => formatQty(Number(n) || 0);
const dolares = (n) => formatMoney((Number(n) || 0) / 100);

// Cada tipo de movimiento con su ícono y su rótulo. El color va en el ÍCONO y
// en el signo; el texto queda en tinta normal.
const TIPO = {
    compra:      { icono: TrendingUp, rotulo: 'Compra',      tono: 'text-success-text' },
    ajuste:      { icono: Wrench,     rotulo: 'Ajuste',      tono: 'text-content-3' },
    canje:       { icono: Gift,       rotulo: 'Canje',       tono: 'text-warning-text' },
    anulacion:   { icono: Undo2,      rotulo: 'Anulación',   tono: 'text-danger-text' },
    vencimiento: { icono: CalendarX,  rotulo: 'Vencimiento', tono: 'text-content-3' },
};
const DE_A = 40;

export default function ClientePuntosModal({ open, customerId, puedeEditarFicha, onEditar, onClose }) {
    if (!customerId) return null;
    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-3xl" ariaLabel="Puntos del cliente">
            <Cuerpo key={customerId} customerId={customerId} puedeEditarFicha={puedeEditarFicha}
                onEditar={onEditar} onClose={onClose} />
        </LiquidModal>
    );
}

function Cuerpo({ customerId, puedeEditarFicha, onEditar, onClose }) {
    const showToast = useToastStore((s) => s.showToast);
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [mostrar, setMostrar] = useState(DE_A);

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
    }, [customerId, showToast]);

    const cliente = datos?.cliente;
    const cuenta = datos?.cuenta;
    const movimientos = useMemo(() => cuenta?.movimientos ?? [], [cuenta]);
    const proximo = (cuenta?.vencimientos ?? [])[0] ?? null;

    return (
        <>
            <LiquidModal.Header>
                {/* En el teléfono el botón baja: al lado del nombre lo cortaba. */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 w-full">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <Star size={18} className="text-brand-text shrink-0" />
                            <h2 className="text-title font-black text-content break-words sm:truncate">
                                {cliente?.nombre ?? 'Cliente'}
                            </h2>
                        </div>
                        <p className="text-caption text-content-3 mt-1 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                            <span className="inline-flex items-center gap-1.5"><IdCard size={12} />{cliente?.dui || 'Sin DUI'}</span>
                            <span className="inline-flex items-center gap-1.5"><Phone size={12} />{cliente?.telefono || 'Sin teléfono'}</span>
                        </p>
                    </div>
                    {cliente && (
                        <Button variant="secondary" size="sm" icon={Pencil} onClick={() => onEditar(cliente)}>
                            {puedeEditarFicha ? 'Editar cliente' : 'Ver ficha'}
                        </Button>
                    )}
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                {cargando ? <LoadingState label="Buscando los puntos del cliente…" /> : !cliente ? (
                    <Notice variant="warning" bloque>No se encontró el cliente.</Notice>
                ) : (
                    <div className="flex flex-col gap-6">
                        {!cliente.acumula && (
                            <Notice variant="info" bloque>
                                Esta ficha es de un convenio: sus compras no acumulan puntos.
                            </Notice>
                        )}

                        {/* El saldo es el dato: va grande y solo. */}
                        <div data-surface="card" className="p-5 flex flex-col sm:flex-row sm:items-end gap-5">
                            <div className="min-w-0 flex-1">
                                <p className="text-caption font-bold text-content-3">Puntos disponibles</p>
                                <p className="text-5xl font-black tabular-nums text-content leading-none mt-2">
                                    {pts(cuenta?.saldo)}
                                </p>
                                <p className="text-body-sm text-content-2 mt-2">
                                    Equivalen a <span className="font-black tabular-nums">{dolares(cuenta?.saldo)}</span> de descuento
                                </p>
                            </div>
                            <div className="grid grid-cols-3 gap-4 sm:gap-6">
                                <Cifra rotulo="Acumulados" valor={pts(cuenta?.ganados)} />
                                <Cifra rotulo="Canjeados" valor={pts(cuenta?.usados)} />
                                <Cifra rotulo="Próximo vencimiento"
                                    valor={proximo ? pts(proximo.puntos) : '—'}
                                    sub={proximo ? fechaTexto(proximo.vence_el) : 'Nada por vencer'} />
                            </div>
                        </div>

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

                        <section className="flex flex-col gap-2">
                            <Titulo icono={CalendarClock}>Movimientos</Titulo>
                            {movimientos.length === 0 ? (
                                <p className="text-body-sm text-content-3">Sin movimientos todavía.</p>
                            ) : (
                                <div className="flex flex-col divide-y divide-divider">
                                    {movimientos.slice(0, mostrar).map((m) => {
                                        const t = TIPO[m.tipo] ?? TIPO.ajuste;
                                        const Icono = t.icono;
                                        const positivo = Number(m.puntos) > 0;
                                        // El rótulo ya dice «Compra» o «Canje»: del motivo se
                                        // quita esa palabra para no leer «Compra · compra».
                                        const detalle = String(m.motivo ?? '')
                                            .replace(/^(compra|canje)(\s·\s)?/i, '').trim();
                                        return (
                                            <div key={`${m.tipo}-${m.id}`} className="flex items-center gap-3 py-2.5 min-w-0">
                                                <span className={`shrink-0 ${t.tono}`}><Icono size={16} /></span>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-body-sm font-bold text-content truncate">
                                                        {t.rotulo}{detalle ? <span className="font-normal text-content-3"> · {detalle}</span> : null}
                                                    </p>
                                                    <p className="text-caption text-content-3 tabular-nums">
                                                        {fechaNumerica(m.fecha)}{m.sucursal ? ` · ${m.sucursal}` : ''}
                                                    </p>
                                                </div>
                                                <span className="text-body-sm font-black tabular-nums shrink-0 text-content">
                                                    {positivo ? '+' : '−'}{pts(Math.abs(Number(m.puntos)))}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {movimientos.length > mostrar && (
                                <div className="flex justify-center pt-1">
                                    <Button variant="ghost" size="sm" onClick={() => setMostrar((n) => n + DE_A)}>
                                        Ver {Math.min(DE_A, movimientos.length - mostrar)} más de {movimientos.length - mostrar}
                                    </Button>
                                </div>
                            )}
                        </section>

                        <section className="flex flex-col gap-2">
                            <Titulo icono={Star}>Acceso a Mis puntos</Titulo>
                            <CodigoDeAcceso customerId={cliente.id} nombre={cliente.nombre || ''}
                                puedeEditar={puedeEditarFicha} />
                        </section>
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

function Cifra({ rotulo, valor, sub }) {
    return (
        <div className="min-w-0">
            <p className="text-caption text-content-3">{rotulo}</p>
            <p className="text-title font-black tabular-nums text-content">{valor}</p>
            {sub && <p className="text-caption text-content-3 truncate">{sub}</p>}
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

