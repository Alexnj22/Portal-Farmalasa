import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { ArrowRight, PackageX, History, AlertTriangle, CheckCircle2, Clock, Wrench, ScanSearch } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { fetchRevisionDePresentaciones, pedirCorreccionDeExistencia, ponerVenceACorreccion, necesitaVence, textoDelSospechoso, minmaxDelCambio, esCarga, presentacionDeCarga } from '@nucleo/data/revisionFactor';
import { aplicarMovimientoInventarioEnErp } from '@nucleo/data/requests';
import { fetchConsultasExistencia, agruparPorProducto, enPresentaciones, textoDeDiferencia } from '@nucleo/data/consultasExistencia';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, venceDelMes, mesDelVence } from '@nucleo/utils/fecha';

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
    // Cuántas salas de cada cambio siguen arriba, en «Existencia por corregir».
    const salasPorCambio = useMemo(() => {
        const m = new Map();
        for (const f of datos?.existencias ?? []) {
            if (!m.has(f.cambio_id)) m.set(f.cambio_id, new Set());
            m.get(f.cambio_id).add(f.erp_sucursal_id);
        }
        return new Map([...m].map(([id, salas]) => [id, salas.size]));
    }, [datos]);
    // Todos los pedidos del producto juntos, con el último conteo de cada sala.
    const consultaAbierta = useMemo(() => new Map(agruparPorProducto(consultas)
        .map(g => [g.erp_product_id, g])), [consultas]);

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
                            {cambios.map(c => <FilaCambio key={c.id} c={c}
                                salasPorCorregir={salasPorCambio.get(c.id) ?? 0} />)}
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
    const conCorreccion = new Set(g.filas.map(f => f.erp_sucursal_id));
    const otras = (consulta?.salas ?? []).filter(s => !conCorreccion.has(s.erp_sucursal_id));
    const respondidas = consulta ? (consulta.salas ?? []).filter(s => !['PENDIENTE', 'RECONTAR'].includes(s.estado)).length : 0;

    return (
        <li data-surface="card" className="border-divider px-3.5 py-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                    <p className="text-body-sm font-black text-content truncate" title={g.nombre}>{g.nombre}</p>
                    {mismoCambio && <CambioDeFactor f={f0} />}
                </div>
                {consulta?.abierta && (
                    <Badge size="sm" uppercase={false} variant="info" icon={ScanSearch}>
                        Conteo pedido · {formatQty(respondidas)} de {formatQty(consulta.salas?.length ?? 0)}
                    </Badge>
                )}
            </div>

            <ul className="divide-y divide-divider border-t border-divider">
                {g.filas.map(f => (
                    <SalaPorCorregir key={`${f.cambio_id}-${f.sentido}-${f.erp_sucursal_id}-${f.lote}-${f.presentacion}`}
                        fila={f} conCambio={!mismoCambio} onHecho={onHecho}
                        conteo={consulta?.salas?.find(s => s.erp_sucursal_id === f.erp_sucursal_id)} />
                ))}
            </ul>

            {/* Las salas a las que también se les preguntó y no tienen nada
                que corregir: un descuadre ahí es otra cosa que revisar. */}
            {otras.length > 0 && (
                <div className="border-t border-divider pt-2 space-y-1">
                    <p className="text-label font-black uppercase tracking-widest text-content-3">Las demás salas</p>
                    <ul className="flex flex-wrap gap-1.5">
                        {otras.map(s => <ConteoDeOtraSala key={s.id} s={s} />)}
                    </ul>
                </div>
            )}

            {/* ¿Hay de verdad lo que el cambio supone? Un solo pedido para
                todas las salas del producto; las salas cuentan a ciegas. */}
            {puedePreguntar && !consulta?.abierta && sinCorregir && (
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

const POR_CONTAR = ['PENDIENTE', 'RECONTAR'];

function ConteoDeOtraSala({ s }) {
    const contada = !POR_CONTAR.includes(s.estado);
    const descuadre = contada && s.diferencia;
    const variant = !contada ? 'neutral' : descuadre ? 'danger' : 'success';
    return (
        <li>
            <Badge size="sm" uppercase={false} variant={variant}
                icon={!contada ? Clock : descuadre ? AlertTriangle : CheckCircle2}>
                {s.sala}
                {!contada ? ' · por contar'
                    : descuadre ? ` · contó ${enPresentaciones(s.contado_texto, s.final?.contado)}, el sistema ${enPresentaciones(s.sistema_texto, s.final?.sistema)}`
                    : ' · cuadra'}
            </Badge>
        </li>
    );
}

// Qué dijo la sala al contar, frente a lo que la corrección supone. Las dos
// cosas en unidades: la corrección carga o descarta exactamente la diferencia
// que el conteo debería encontrar.
function ResultadoDelConteo({ conteo: s, fila: f }) {
    if (!s) return null;
    if (s.estado === 'PENDIENTE') {
        return <p className="text-label font-bold text-content-3 flex items-center gap-1"><Clock size={12} /> Conteo pedido, la sala no ha contado</p>;
    }
    if (s.estado === 'RECONTAR') {
        return <p className="text-label font-bold text-warning-text flex items-center gap-1"><Clock size={12} /> No cuadró la primera vez, la sala está recontando</p>;
    }
    const supone = esCarga(f) ? f.cargar * (presentacionDeCarga(f).factor || 1) : -f.descartar;
    const confirma = (s.diferencia ?? 0) === supone;
    return (
        <div className={`rounded-lg border px-2.5 py-1.5 text-label font-bold ${confirma ? 'border-success/30 bg-success/[0.08] text-success-text' : 'border-warning/30 bg-warning/[0.08] text-warning-text'}`}>
            <p className="flex items-center gap-1">
                {confirma ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                La sala contó {enPresentaciones(s.contado_texto, s.final?.contado)}; el sistema dice {enPresentaciones(s.sistema_texto, s.final?.sistema)}
                {s.recontada ? ' (contado dos veces)' : ''}.
            </p>
            <p className="text-content-2 font-bold">
                {confirma
                    ? 'Confirma la corrección: se puede corregir.'
                    : s.diferencia === 0
                        ? 'Cuadra con lo que hay hoy: no corrijas, la existencia ya está bien.'
                        : `No coincide con la corrección (${textoDeDiferencia(s)}): revisar con la sala antes de corregir.`}
            </p>
        </div>
    );
}

// ─── Una sala (un lote) con la existencia en la unidad vieja ────────────────
function SalaPorCorregir({ fila: f, conCambio, conteo, onHecho }) {
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
    // La fecha de vencimiento: una carga de un perecedero sin ella la rechaza
    // la caja (X-Ray Dol, 2026-10-30). Sale de lo que contó la sala; si no la
    // contó, la escribe quien corrige.
    const pideVence = necesitaVence(f);
    // Como mes ('AAAA-MM'): el empaque no trae día. Se guarda el día 1.
    const [vence, setVence] = useState(mesDelVence(sol?.vence ?? f.vence_contado));
    const venceDia = venceDelMes(vence);
    // Una pendiente que quien puede aplicar ya intentó y no entró: se reintenta
    // desde acá, sin ir a Solicitudes.
    const reintentable = !!sol && !sol.aplicada && sol.status === 'PENDING' && puedeAplicar;
    const sinFecha = pideVence && !sol?.vence;
    const estado = !sol ? null
        : sol.aplicada ? { texto: 'Corregida', variant: 'success', icon: CheckCircle2 }
        : sol.status === 'APPROVED' ? { texto: 'Aprobada, sin aplicar', variant: 'warning', icon: Clock }
        : reintentable ? { texto: 'No se aplicó', variant: 'warning', icon: AlertTriangle }
        : { texto: 'Pedida', variant: 'warning', icon: Clock };

    const corregir = async () => {
        setTrabajando(true);
        try {
            let id = sol?.id;
            if (reintentable) {
                if (pideVence && venceDia && venceDia !== sol.vence) {
                    const { error } = await ponerVenceACorreccion(id, venceDia);
                    if (error) throw error;
                }
            } else {
                id = crypto.randomUUID();
                const { error } = await pedirCorreccionDeExistencia({
                    id, fila: f, usuarioId: user?.id, aprobador: supervisorQueResuelve(employees),
                    vence: pideVence ? venceDia : null,
                });
                if (error) throw error;
            }

            if (!puedeAplicar) {
                useToastStore.getState().showToast('Corrección pedida',
                    'Quien aprueba inventario recibió el aviso. La existencia cambia al aprobarla.', 'success');
            } else {
                const r = await aplicarMovimientoInventarioEnErp(id, 'Corrección por cambio de presentación');
                if (!r?.ok) {
                    useToastStore.getState().showToast('No se aplicó',
                        `La caja no la aceptó: ${r?.error ?? 'sin respuesta'}. Puedes reintentarla desde esta misma tarjeta.`, 'warning');
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
                {reintentable ? (
                    <Button size="sm" variant="primary" icon={Wrench} onClick={() => setConfirmar(true)}>
                        Reintentar
                    </Button>
                ) : estado ? (
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

            {reintentable && (
                <p className="flex items-center gap-1.5 text-label font-bold text-warning-text">
                    <AlertTriangle size={13} strokeWidth={2.5} className="shrink-0" />
                    {sinFecha
                        ? 'La caja no la aceptó: falta la fecha de vencimiento. Escríbela y reintenta.'
                        : 'Se pidió y no entró en la caja. Reintenta para aplicarla.'}
                </p>
            )}
            {(!sol || reintentable) && <ResultadoDelConteo conteo={conteo} fila={f} />}

            <ConfirmModal
                isOpen={confirmar}
                onClose={() => setConfirmar(false)}
                onConfirm={corregir}
                isProcessing={trabajando}
                isDestructive={false}
                title={`Corregir ${f.nombre}`}
                confirmText={reintentable ? 'Aplicar ahora' : puedeAplicar ? 'Corregir ahora' : 'Pedir la corrección'}
                confirmDisabled={pideVence && !venceDia}
                message={(
                    <span className="block space-y-3 text-left">
                        <span className="block">
                            {carga
                                ? <>En {f.sala} se cargan <b>{formatQty(f.cargar)} {enCarga}</b> y queda {formatQty(f.quedan)} {pres}.</>
                                : <>En {f.sala} se descartan <b>{formatQty(f.descartar)}</b> y quedan {formatQty(f.quedan)} {pres}.</>}
                            {carga && f.sobran > 0 && ` Sobran ${formatQty(f.sobran)} sueltas que no se pueden sacar.`}
                            {!carga && f.sueltas > 0 && ` Las ${formatQty(f.sueltas)} sueltas también salen.`}
                        </span>
                        {pideVence && (
                            <CampoMesAnio label="Vence (mes y año)" value={vence} onChange={setVence} />
                        )}
                        <span className="block text-content-3">
                            {carga
                                ? `Sólo si en la sala hay ${formatQty(f.muestra)} ${pres} ${f.muestra === 1 ? 'entera' : 'enteras'}.`
                                : 'Si en la sala hay más, no corrijas: avisa.'}
                            {' '}
                            {puedeAplicar ? 'Se aplica enseguida.' : 'La aplica quien aprueba inventario.'}
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
function FilaCambio({ c, salasPorCorregir }) {
    const r = c.resultado ?? {};
    const minmax = Array.isArray(r.minmax) ? r.minmax : [];
    // `procesar_cambios_de_factor` sólo deja `existencia_por_corregir` cuando
    // alguna sala quedó contada en la unidad vieja; sin la clave, no hay nada
    // que ajustar (ninguna fila con una caja vieja entera, o la existencia ya
    // estaba en otra presentación). Pedido del usuario, 2026-10-30: «cuando
    // pase eso, que lo diga».
    const tocoExistencia = Array.isArray(r.existencia_por_corregir) && r.existencia_por_corregir.length > 0;
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
            {c.procesado_at && r.factor_antes != null && (
                !tocoExistencia ? (
                    <p className="flex items-center gap-1.5 text-label font-bold text-success-text">
                        <CheckCircle2 size={13} strokeWidth={2.5} className="shrink-0" />
                        La existencia no necesita ajuste.
                    </p>
                ) : salasPorCorregir > 0 ? (
                    <p className="flex items-center gap-1.5 text-label font-bold text-warning-text">
                        <AlertTriangle size={13} strokeWidth={2.5} className="shrink-0" />
                        {salasPorCorregir === 1 ? 'Falta ajustar la existencia de 1 sala' : `Falta ajustar la existencia de ${salasPorCorregir} salas`}: está arriba, en «Existencia por corregir».
                    </p>
                ) : (
                    <p className="flex items-center gap-1.5 text-label font-bold text-content-3">
                        <CheckCircle2 size={13} strokeWidth={2.5} className="shrink-0" />
                        La existencia ya no tiene nada por ajustar.
                    </p>
                )
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
