import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, PackageX, History, AlertTriangle, CheckCircle2, Clock, Wrench } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { fetchRevisionDePresentaciones, pedirCorreccionDeExistencia, causaDeCorreccion, textoDelSospechoso, minmaxDelCambio } from '@nucleo/data/revisionFactor';
import { aplicarMovimientoInventarioEnErp } from '@nucleo/data/requests';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';

/**
 * Revisión de factor — pedido del usuario, 2026-10-15: «poder ver en algún
 * lugar esto, que me notifique al cambiarse o al haber un producto incorrecto
 * con su factor, y que de un solo corrija».
 *
 * Cuando la caja cambia el tamaño de una presentación (CAJA 1x30 → 1x1), el
 * portal ya convierte SOLO las ventas y el MIN·MAX (`procesar_cambios_de_factor`).
 * Lo que no puede hacer solo es la existencia: la caja no la convierte, y
 * descartar existencia es una decisión. Esta pestaña es donde se toma, con el
 * porqué y el de→a a la vista, y con un clic: crea la solicitud de descarte de
 * siempre y, si quien la pide puede aprobar inventario, la aplica enseguida.
 */
export default function TabRevisionFactor() {
    const [datos, setDatos] = useState(null);   // null = cargando

    const cargar = useCallback(() => {
        let cancelado = false;
        fetchRevisionDePresentaciones().then(({ data, error }) => {
            if (cancelado) return;
            if (error) {
                useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error');
                setDatos({ cambios: [], existencias: [], sospechosos: [] });
                return;
            }
            setDatos(data);
        });
        return () => { cancelado = true; };
    }, []);

    useEffect(() => cargar(), [cargar]);

    if (datos === null) {
        return <div className="p-4"><SkeletonText lines={6} /></div>;
    }

    const { cambios = [], existencias = [], sospechosos = [] } = datos;

    return (
        <div className="space-y-6">
            <Seccion icono={PackageX} titulo="Existencia por corregir" cuenta={existencias.length}
                bajada="La caja no convierte la existencia cuando cambia el tamaño de la presentación: queda contada en la unidad vieja.">
                {existencias.length === 0
                    ? <EmptyState linea icon={CheckCircle2} title="Sin existencia por corregir" />
                    : (
                        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                            {existencias.map(f => (
                                <FilaExistencia key={`${f.cambio_id}-${f.erp_sucursal_id}-${f.lote}-${f.presentacion}`}
                                    fila={f} onHecho={cargar} />
                            ))}
                        </ul>
                    )}
            </Seccion>

            <Seccion icono={AlertTriangle} titulo="Factor que no cuadra" cuenta={sospechosos.length}
                bajada="Productos cuyo tamaño de presentación no coincide entre el catálogo, la existencia o las ventas recientes. Se corrigen en la ficha del producto de la caja; al corregirlo, el portal convierte lo demás solo.">
                {sospechosos.length === 0
                    ? <EmptyState linea icon={CheckCircle2} title="Sin factores que no cuadren" />
                    : (
                        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                            {sospechosos.map(s => <FilaSospechoso key={s.clave} s={s} />)}
                        </ul>
                    )}
            </Seccion>

            <Seccion icono={History} titulo="Cambios de presentación" cuenta={cambios.length}
                bajada="Lo que cambió en los últimos 120 días y lo que el portal convirtió solo.">
                {cambios.length === 0
                    ? <EmptyState linea icon={CheckCircle2} title="Sin cambios de presentación recientes" />
                    : (
                        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                            {cambios.map(c => <FilaCambio key={c.id} c={c} />)}
                        </ul>
                    )}
            </Seccion>
        </div>
    );
}

function Seccion({ icono: Icono, titulo, cuenta, bajada, children }) {
    return (
        <section className="space-y-2.5">
            <header className="flex items-start gap-2.5">
                <Icono size={16} className="text-content-3 shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="min-w-0">
                    <h3 className="text-body font-black text-content">
                        {titulo}
                        {cuenta > 0 && <span className="text-content-3 tabular-nums"> · {formatQty(cuenta)}</span>}
                    </h3>
                    <p className="text-label font-bold text-content-3">{bajada}</p>
                </div>
            </header>
            {children}
        </section>
    );
}

// ─── Un lote con la existencia en la unidad vieja ───────────────────────────
function FilaExistencia({ fila: f, onHecho }) {
    const { user, hasPermission } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const [confirmar, setConfirmar] = useState(false);
    const [trabajando, setTrabajando] = useState(false);

    const puedeAplicar = hasPermission('requests_inventario', 'can_approve');
    const sol = f.solicitud;

    const corregir = async () => {
        setTrabajando(true);
        try {
            const id = crypto.randomUUID();
            const { error } = await pedirCorreccionDeExistencia({
                id, fila: f, usuarioId: user?.id, aprobador: supervisorQueResuelve(employees),
            });
            if (error) throw error;

            if (!puedeAplicar) {
                useToastStore.getState().showToast('Corrección pedida',
                    'Quien aprueba inventario recibió el aviso. La existencia cambia al aprobarla.', 'success');
            } else {
                const r = await aplicarMovimientoInventarioEnErp(id, 'Corrección por cambio de presentación');
                if (!r?.ok) {
                    useToastStore.getState().showToast('La corrección quedó pedida',
                        `No se pudo aplicar todavía: ${r?.error ?? 'sin respuesta'}. Queda en Solicitudes para reintentar.`, 'warning');
                } else {
                    useToastStore.getState().showToast('Existencia corregida',
                        `${f.nombre} en ${f.sala}: ${formatQty(f.muestra)} → ${formatQty(f.quedan)}.`, 'success');
                }
            }
            setConfirmar(false);
            onHecho?.();
        } catch (e) {
            useToastStore.getState().showToast('Error', mensajeAmigable(e), 'error');
        } finally {
            setTrabajando(false);
        }
    };

    return (
        <li data-surface="card" className="border-divider px-3.5 py-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-body-sm font-black text-content truncate" title={f.nombre}>{f.nombre}</p>
                    <p className="text-label font-bold text-content-3 truncate">
                        {f.sala}{f.lote ? ` · lote ${f.lote}` : ''}
                        {f.vence ? ` · vence ${fechaNumerica(f.vence)}` : ''}
                    </p>
                </div>
                {sol && (
                    <Badge size="sm" uppercase={false}
                        variant={sol.status === 'APPROVED' ? 'success' : 'warning'}
                        icon={sol.status === 'APPROVED' ? CheckCircle2 : Clock}>
                        {sol.status === 'APPROVED' ? 'Corregida' : 'Pedida'}
                    </Badge>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm font-bold">
                <span className="text-content-3">1 {f.presentacion} = {formatQty(f.de)}</span>
                <ArrowRight size={13} className="text-content-3" />
                <span className="text-content">1 {f.presentacion} = {formatQty(f.a)}</span>
            </div>

            <p className="text-label font-bold text-content-2">
                Muestra <span className="tabular-nums">{formatQty(f.muestra)}</span>, son{' '}
                <span className="tabular-nums text-content">{formatQty(f.quedan)}</span>
                {' '}· se descartan <span className="tabular-nums text-danger-text">{formatQty(f.descartar)}</span>
                {f.sueltas > 0 && (
                    <span className="text-warning-text">
                        {' '}· sobran {formatQty(f.sueltas)} unidades sueltas que no forman una {f.presentacion.toLowerCase()}
                    </span>
                )}
            </p>

            {!sol && (
                <Button size="sm" variant="primary" icon={Wrench} onClick={() => setConfirmar(true)}>
                    Corregir en la caja
                </Button>
            )}

            <ConfirmModal
                isOpen={confirmar}
                onClose={() => setConfirmar(false)}
                onConfirm={corregir}
                isProcessing={trabajando}
                isDestructive={false}
                title={`Corregir ${f.nombre}`}
                confirmText={puedeAplicar ? 'Corregir ahora' : 'Pedir la corrección'}
                message={(
                    <span className="block space-y-2 text-left">
                        <span className="block">
                            <b>Qué pasó:</b> la presentación cambió de tamaño: antes 1 {f.presentacion} = {formatQty(f.de)},
                            {' '}ahora 1 {f.presentacion} = {formatQty(f.a)}. La caja no convierte la existencia,
                            {' '}así que en {f.sala}{f.lote ? ` (lote ${f.lote})` : ''} quedó mostrando {formatQty(f.muestra)}.
                        </span>
                        <span className="block">
                            <b>Qué se hace:</b> se descartan {formatQty(f.descartar)} y quedan {formatQty(f.quedan)}.
                            {f.sueltas > 0 && ` Las ${formatQty(f.sueltas)} unidades sueltas no alcanzan para una ${f.presentacion.toLowerCase()} y también salen.`}
                        </span>
                        <span className="block">
                            <b>Lo que queda escrito en el movimiento:</b> «{causaDeCorreccion(f)}»
                        </span>
                        <span className="block text-content-3">
                            {puedeAplicar
                                ? 'Se aplica en la caja enseguida. Si en la sala de verdad hay más, no corrijas: avisá para revisarlo.'
                                : 'Se manda a quien aprueba inventario; la existencia cambia cuando la apruebe.'}
                        </span>
                    </span>
                )}
            />
        </li>
    );
}

// ─── Un factor que no cuadra ─────────────────────────────────────────────────
// Por qué no cuadra: `textoDelSospechoso` (núcleo), el mismo texto de la app.
function FilaSospechoso({ s }) {
    return (
        <li data-surface="card" className="border-divider px-3.5 py-3 space-y-1">
            <div className="flex items-start justify-between gap-2">
                <p className="text-body-sm font-black text-content truncate min-w-0" title={s.nombre}>{s.nombre}</p>
                <Badge size="sm" variant="warning" uppercase={false}>{s.presentacion}</Badge>
            </div>
            <p className="text-label font-bold text-content-2">{textoDelSospechoso(s)}</p>
        </li>
    );
}

// ─── Un cambio ya procesado ──────────────────────────────────────────────────
function FilaCambio({ c }) {
    const r = c.resultado ?? {};
    const minmax = Array.isArray(r.minmax) ? r.minmax : [];
    return (
        <li data-surface="card" className="border-divider px-3.5 py-3 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
                <p className="text-body-sm font-black text-content truncate min-w-0" title={c.nombre}>{c.nombre}</p>
                <span className="text-label font-bold text-content-3 shrink-0 tabular-nums">
                    {c.procesado_at ? fechaNumerica(c.procesado_at) : 'en proceso'}
                </span>
            </div>
            {r.factor_antes != null && (
                <p className="text-label font-bold text-content-2">
                    Antes {formatQty(r.factor_antes)} por unidad de venta, ahora {formatQty(r.factor_ahora)}.
                    {' '}Se convirtieron {formatQty(r.ventas_convertidas ?? 0)} ventas.
                </p>
            )}
            {minmax.length > 0 && (
                <p className="text-label font-bold text-content-3">
                    MIN·MAX: {minmaxDelCambio(r)}
                </p>
            )}
            {(r.ventas_sin_convertir ?? 0) > 0 && (
                <p className="text-label font-bold text-warning-text">
                    {formatQty(r.ventas_sin_convertir)} ventas con otro tamaño de caja quedaron como estaban: revisar si es la misma caja.
                </p>
            )}
        </li>
    );
}
