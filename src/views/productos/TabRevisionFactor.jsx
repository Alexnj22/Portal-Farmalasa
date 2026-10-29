import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { ArrowRight, PackageX, History, AlertTriangle, CheckCircle2, Clock, Wrench, ScanSearch } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { fetchRevisionDePresentaciones, pedirCorreccionDeExistencia, causaDeCorreccion, textoDelSospechoso, minmaxDelCambio, esCarga, presentacionDeCarga } from '@nucleo/data/revisionFactor';
import { aplicarMovimientoInventarioEnErp } from '@nucleo/data/requests';
import { fetchConsultasExistencia } from '@nucleo/data/consultasExistencia';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';

// Pedirle a la sala que cuente antes de corregir. Diferido: sólo hace falta al
// apretar el botón.
const NuevaConsultaExistencia = lazy(() => import('../../components/inventario/NuevaConsultaExistencia'));

/**
 * Revisión de factor — pedido del usuario, 2026-10-15: «poder ver en algún
 * lugar esto, que me notifique al cambiarse o al haber un producto incorrecto
 * con su factor, y que de un solo corrija».
 *
 * Cuando la caja cambia el tamaño de una presentación (CAJA 1x30 → 1x1), el
 * portal ya convierte SOLO las ventas y el MIN·MAX (`procesar_cambios_de_factor`).
 * Lo que no puede hacer solo es la existencia: la caja no la convierte, y
 * cambiar existencia es una decisión. Esta pestaña es donde se toma, con el
 * porqué y el de→a a la vista, y con un clic: crea la solicitud de siempre
 * —descarte si la presentación se achicó, carga si creció (2026-10-29)— y, si
 * quien la pide puede aprobar inventario, la aplica enseguida.
 *
 * Las filas salen de la foto que sacó el proceso al convertir y sólo mientras
 * sigan como estaban: una compra que llegó después no se ofrece para descartar.
 */
export default function TabRevisionFactor() {
    const [datos, setDatos] = useState(null);   // null = cargando

    const [consultas, setConsultas] = useState([]);

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
        // Los conteos ya pedidos, para no ofrecer pedir otro encima. Si no se
        // pueden leer (sin permiso de conteo) el botón sigue, y el servidor
        // frena el duplicado igual.
        fetchConsultasExistencia().then(({ data }) => { if (!cancelado) setConsultas(data); });
        return () => { cancelado = true; };
    }, []);

    useEffect(() => cargar(), [cargar]);

    // Una tarjeta por producto, con sus salas adentro: el mismo cambio de
    // presentación pega en varias salas y verlas sueltas invitaba a pedir el
    // mismo conteo una vez por tarjeta.
    const porProducto = useMemo(() => {
        const m = new Map();
        for (const f of datos?.existencias ?? []) {
            if (!m.has(f.erp_product_id)) m.set(f.erp_product_id, { erp_product_id: f.erp_product_id, nombre: f.nombre, filas: [] });
            m.get(f.erp_product_id).filas.push(f);
        }
        return [...m.values()];
    }, [datos]);
    const consultaAbierta = useMemo(() => new Map(consultas
        .filter(c => !c.cerrada_at)
        .map(c => [c.erp_product_id, c])), [consultas]);

    if (datos === null) {
        return <div className="p-4"><SkeletonText lines={6} /></div>;
    }

    const { cambios = [], existencias = [], sospechosos = [] } = datos;

    return (
        <div className="space-y-6">
            <Seccion icono={PackageX} titulo="Existencia por corregir" cuenta={porProducto.length}
                bajada="La caja no convierte la existencia cuando cambia el tamaño de la presentación: queda contada en la unidad vieja. Si la caja se achicó sobra existencia; si creció, falta.">
                {existencias.length === 0
                    ? <EmptyState linea icon={CheckCircle2} title="Sin existencia por corregir" />
                    : (
                        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                            {porProducto.map(g => (
                                <TarjetaProducto key={g.erp_product_id} grupo={g}
                                    consulta={consultaAbierta.get(g.erp_product_id)} onHecho={cargar} />
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
                bajada="Lo que cambió en los últimos 120 días: las ventas que el portal convirtió solo y cómo quedó el MIN·MAX.">
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

// ─── Un producto con su existencia en la unidad vieja, sala por sala ────────
function TarjetaProducto({ grupo: g, consulta, onHecho }) {
    const { hasPermission } = useAuth();
    const [preguntar, setPreguntar] = useState(false);
    const puedePreguntar = hasPermission('conteo_inventario', 'can_edit');

    const f0 = g.filas[0];
    const presDe = (f) => f.tipo_cambio ?? f.presentacion;
    // El de→a va arriba una sola vez cuando todas las salas comparten el mismo
    // cambio, que es lo normal; si no, cada sala lleva el suyo.
    const mismoCambio = g.filas.every(f => presDe(f) === presDe(f0) && f.de === f0.de && f.a === f0.a);
    const salas = [...new Map(g.filas.map(f => [f.erp_sucursal_id, f.sala])).entries()];
    const sinCorregir = g.filas.some(f => !f.solicitud);
    const respondidas = consulta ? (consulta.salas ?? []).filter(s => !['PENDIENTE', 'RECONTAR'].includes(s.estado)).length : 0;

    return (
        <li data-surface="card" className="border-divider px-3.5 py-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                    <p className="text-body-sm font-black text-content truncate" title={g.nombre}>{g.nombre}</p>
                    {mismoCambio && <CambioDeFactor f={f0} />}
                </div>
                {consulta && (
                    <Badge size="sm" uppercase={false} variant="info" icon={ScanSearch}>
                        Conteo pedido · {formatQty(respondidas)} de {formatQty(consulta.salas?.length ?? 0)}
                    </Badge>
                )}
            </div>

            <ul className="divide-y divide-divider border-t border-divider">
                {g.filas.map(f => (
                    <SalaPorCorregir key={`${f.cambio_id}-${f.sentido}-${f.erp_sucursal_id}-${f.lote}-${f.presentacion}`}
                        fila={f} conCambio={!mismoCambio} onHecho={onHecho} />
                ))}
            </ul>

            {/* ¿Hay de verdad lo que el cambio supone? Un solo pedido para
                todas las salas del producto; las salas cuentan a ciegas. */}
            {puedePreguntar && !consulta && sinCorregir && (
                <Button size="sm" variant="secondary" icon={ScanSearch} onClick={() => setPreguntar(true)}>
                    {salas.length === 1 ? `Pedir conteo a ${salas[0][1]}` : `Pedir conteo a las ${salas.length} salas`}
                </Button>
            )}
            {preguntar && (
                <Suspense fallback={null}>
                    <NuevaConsultaExistencia producto={{ id: g.erp_product_id, nombre: g.nombre }}
                        salasIniciales={salas.map(([id]) => id)} origen="revision_factor"
                        motivoInicial={`Cambio de presentación: antes 1 ${presDe(f0)} = ${f0.de}, ahora = ${f0.a}`}
                        onCerrar={() => setPreguntar(false)} onCreada={onHecho} />
                </Suspense>
            )}
        </li>
    );
}

function CambioDeFactor({ f }) {
    const pres = f.tipo_cambio ?? f.presentacion;
    return (
        <p className="flex flex-wrap items-center gap-x-2 text-label font-bold">
            <span className="text-content-3">1 {pres} = {formatQty(f.de)}</span>
            <ArrowRight size={12} className="text-content-3" />
            <span className="text-content">1 {pres} = {formatQty(f.a)}</span>
        </p>
    );
}

// ─── Una sala (un lote) con la existencia en la unidad vieja ────────────────
function SalaPorCorregir({ fila: f, conCambio, onHecho }) {
    const { user, hasPermission } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const [confirmar, setConfirmar] = useState(false);
    const [trabajando, setTrabajando] = useState(false);

    const puedeAplicar = hasPermission('requests_inventario', 'can_approve');
    const sol = f.solicitud;
    const carga = esCarga(f);
    const pres = String(f.tipo_cambio ?? f.presentacion ?? '').toLowerCase();
    // Crece: dónde entra la carga y cómo se ve hoy lo que había. Con una
    // presentación de 1 (el blíster que la caja creó junto con el cambio) la
    // existencia vieja se ve en ésa; sin ella, como unidades sueltas.
    const enCarga = String(presentacionDeCarga(f).tipo ?? '').toLowerCase();
    const comoSeVe = presentacionDeCarga(f).factor === 1 && enCarga !== pres ? enCarga : 'unidades sueltas';
    // Aprobada no es aplicada: si la caja rechazó el ajuste, la solicitud queda
    // aprobada y la existencia sigue igual. «Corregida» sólo cuando entró.
    const estado = !sol ? null
        : sol.aplicada ? { texto: 'Corregida', variant: 'success', icon: CheckCircle2 }
        : sol.status === 'APPROVED' ? { texto: 'Aprobada, sin aplicar', variant: 'warning', icon: Clock }
        : { texto: 'Pedida', variant: 'warning', icon: Clock };

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
                    useToastStore.getState().showToast('Existencia corregida', carga
                        ? `${f.nombre} en ${f.sala}: se cargaron ${formatQty(f.cargar)} ${enCarga}.`
                        : `${f.nombre} en ${f.sala}: ${formatQty(f.muestra)} → ${formatQty(f.quedan)}.`, 'success');
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
        <li className="py-2.5 last:pb-0 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-body-sm font-bold text-content truncate">{f.sala}</p>
                    {(f.lote || f.vence) && (
                        <p className="text-label font-bold text-content-3 truncate">
                            {f.lote ? `lote ${f.lote}` : ''}{f.lote && f.vence ? ' · ' : ''}
                            {f.vence ? `vence ${fechaNumerica(f.vence)}` : ''}
                        </p>
                    )}
                    {conCambio && <CambioDeFactor f={f} />}
                </div>
                {estado ? (
                    <Badge size="sm" uppercase={false} variant={estado.variant} icon={estado.icon}>
                        {estado.texto}
                    </Badge>
                ) : (
                    <Button size="sm" variant="primary" icon={Wrench} onClick={() => setConfirmar(true)}>
                        Corregir
                    </Button>
                )}
            </div>

            {carga ? (
                <p className="text-label font-bold text-content-2">
                    Había <span className="tabular-nums">{formatQty(f.muestra)}</span> {pres}, hoy cuenta{' '}
                    <span className="tabular-nums">{formatQty(f.muestra)}</span> {comoSeVe}
                    {' '}· se cargan <span className="tabular-nums text-success-text">{formatQty(f.cargar)}</span> {enCarga}
                </p>
            ) : (
                <p className="text-label font-bold text-content-2">
                    Muestra <span className="tabular-nums">{formatQty(f.muestra)}</span>, son{' '}
                    <span className="tabular-nums text-content">{formatQty(f.quedan)}</span>
                    {' '}· se descartan <span className="tabular-nums text-danger-text">{formatQty(f.descartar)}</span>
                    {f.sueltas > 0 && (
                        <span className="text-warning-text">
                            {' '}· sobran {formatQty(f.sueltas)} unidades sueltas que no forman una {pres}
                        </span>
                    )}
                </p>
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
                            <b>Qué pasó:</b> la presentación cambió de tamaño: antes 1 {f.tipo_cambio ?? f.presentacion} = {formatQty(f.de)},
                            {' '}ahora 1 {f.tipo_cambio ?? f.presentacion} = {formatQty(f.a)}. La caja no convierte la existencia,
                            {carga
                                ? <> así que las {formatQty(f.muestra)} {pres} que había en {f.sala}{f.lote ? ` (lote ${f.lote})` : ''} quedaron contadas como {formatQty(f.muestra)} {comoSeVe}.</>
                                : <> así que en {f.sala}{f.lote ? ` (lote ${f.lote})` : ''} quedó mostrando {formatQty(f.muestra)}.</>}
                        </span>
                        <span className="block">
                            {carga ? (
                                <>
                                    <b>Qué se hace:</b> se cargan {formatQty(f.cargar)} {enCarga} y la sala vuelve a tener {formatQty(f.quedan)} {pres}.
                                    {f.sobran > 0 && ` Quedan además ${formatQty(f.sobran)} unidades sueltas de más que no se pueden sacar: no forman una ${pres}.`}
                                </>
                            ) : (
                                <>
                                    <b>Qué se hace:</b> se descartan {formatQty(f.descartar)} y quedan {formatQty(f.quedan)}.
                                    {f.sueltas > 0 && ` Las ${formatQty(f.sueltas)} unidades sueltas no alcanzan para una ${pres} y también salen.`}
                                </>
                            )}
                        </span>
                        <span className="block">
                            <b>Lo que queda escrito en el movimiento:</b> «{causaDeCorreccion(f)}»
                        </span>
                        <span className="block text-content-3">
                            {carga
                                ? `Corregí sólo si en la sala hay ${formatQty(f.muestra)} ${pres} enteras. Si lo que hay son ${formatQty(f.muestra)} ${comoSeVe}, no corrijas: la existencia ya está bien.`
                                : 'Si en la sala de verdad hay más, no corrijas: avisá para revisarlo.'}
                            {' '}
                            {puedeAplicar
                                ? 'Se aplica en la caja enseguida.'
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
