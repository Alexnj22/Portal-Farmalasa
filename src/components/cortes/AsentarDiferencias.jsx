import React, { useCallback, useMemo, useState } from 'react';
import { Landmark, Printer, Undo2 } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import useSobreviveAlCierre from '../../hooks/useSobreviveAlCierre';
import { asentarDiferencias, justificarDiferencia } from '../../data/cortes';
import { construirComprobanteDeAsiento } from '../../utils/corteComprobante';
import { imprimirDocumento } from '../../utils/ticketPrint';
import { mensajeAmigable } from '../../utils/errorMessages';
import { formatMoney } from '../../utils/formatNumber';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { useAuth } from '../../context/AuthContext';

/**
 * Marcar como registradas las diferencias que ya se anotaron en el sistema.
 *
 * «Ya veremos cómo hacer para crear el ingreso en el sistema de un solo. Lo que
 * haríamos es hacer un solo ingreso / vale, y en el portal estarían bien
 * definidos» (usuario, 2026-08-14). O sea: allá UN documento por el total, acá
 * el detalle fila por fila. Esta pantalla es la que las une — anota el número
 * con que quedó el documento en todas las que cubre.
 *
 * El portal NO lo crea allá: sigue en pie la decisión de que sólo observa.
 *
 * ── Por qué se agrupa por sala Y por signo ─────────────────────────────────
 * Un faltante entra dinero y un sobrante lo saca: allá son un ingreso y un vale,
 * dos documentos distintos con dos números distintos. Mezclarlos en una misma
 * referencia haría imposible cuadrarlos después, y el servidor lo rechaza. La
 * sala separa porque cada caja lleva su propio movimiento.
 *
 * ── La salida que faltaba: «esta no lleva movimiento» ──────────────────────
 * Hasta el 2026-09-04 el único botón de esta pantalla decía «Marcar registrado»,
 * o sea que daba por hecho que toda diferencia resuelta mueve dinero. No es
 * cierto: la tercera vía —«ya se encontró la causa»— no mueve nada. Y como el
 * formulario de resolución llegaba con la vía PRESELECCIONADA por el signo,
 * escribir la causa y guardar sin tocar el segmentado la guardaba como retiro.
 * Pasó con el sobrante de $50 de Salud 5 del 31-ago, cuya causa decía
 * literalmente «ya se encontro la causa»: el portal le pedía después un vale por
 * dinero que nadie iba a sacar del cajón.
 *
 * Quien descubre ese error lo descubre ACÁ, que es donde el portal se lo pide.
 * La corrección existía —anular y resolver de nuevo— pero vivía en la tarjeta
 * del corte, tres pantallas atrás. Ahora está en la fila, y la hace el servidor
 * en una sola transacción (`justificar_diferencia_corte`).
 */

const clave = (d) => `${d.branch_id}|${Number(d.monto) < 0 ? 'ENTRA' : 'SALE'}`;

export default function AsentarDiferencias({ abierto, diferencias = [], nombreSala = {}, onClose, onHecho }) {
    const { user } = useAuth();
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);

    // Lo que se pinta sobrevive al cierre: el panel sigue montado unos cuadros
    // haciendo su salida y leer la lista directo lo vaciaría en el primer frame.
    // El `|| []` va DENTRO del memo: afuera crea un array nuevo en cada render y
    // la dependencia cambia siempre, o sea que el memo no memoriza nada.
    const visibles = useSobreviveAlCierre(abierto ? diferencias : null);

    const [excluidas, setExcluidas] = useState(() => new Set());
    const [refs, setRefs] = useState(() => new Map());
    const [ocupada, setOcupada] = useState(null);
    // El último asiento registrado, para poder reimprimir su papel sin cerrar.
    // Se guarda acá y no se relee: al registrar, esas filas salen de la lista de
    // pendientes, así que el dato del que salió el papel ya no está en pantalla.
    const [ultimo, setUltimo] = useState(null);
    // La corrección de una fila: cuál se está corrigiendo y con qué texto.
    const [corrigiendo, setCorrigiendo] = useState(null);
    const [motivoCorregir, setMotivoCorregir] = useState('');
    const [causaCorregir, setCausaCorregir] = useState('');

    const grupos = useMemo(() => {
        const m = new Map();
        for (const d of visibles || []) {
            const k = clave(d);
            if (!m.has(k)) {
                m.set(k, { k, branchId: d.branch_id, entra: Number(d.monto) < 0, filas: [] });
            }
            m.get(k).filas.push(d);
        }
        return [...m.values()];
    }, [visibles]);

    const alternar = useCallback((id) => {
        setExcluidas((prev) => {
            const s = new Set(prev);
            if (s.has(id)) s.delete(id); else s.add(id);
            return s;
        });
    }, []);

    /**
     * El papel que respalda el movimiento acumulado. Se anexa al ingreso o al
     * vale del sistema y lo desarma diferencia por diferencia — allá queda un
     * monto solo y sin esto nada dice de qué está hecho.
     *
     * `ok: true` de la ticketera significa RECIBIDO, no «salió papel».
     */
    const imprimirAsiento = useCallback(async (asiento) => {
        const r = await imprimirDocumento(construirComprobanteDeAsiento({
            sala: nombreSala[asiento.branchId] || '',
            entra: asiento.entra,
            referencia: asiento.ref,
            filas: asiento.filas,
            registradoPor: user?.name || '',
            cuando: asiento.cuando,
            // El asiento se anexa al documento que se hizo EN esa caja, así que
            // el papel tiene que salir ahí. Si esta computadora no tiene la
            // ticketera, va a la cola de esa sucursal.
        }), { sala: asiento.branchId });
        if (!r.ok) showToast?.('No se pudo imprimir', r.detalle, 'error');
        return r.ok;
    }, [nombreSala, user, showToast]);

    const registrar = useCallback(async (g) => {
        const incluidas = g.filas.filter((d) => !excluidas.has(d.id));
        const ids = incluidas.map((d) => d.id);
        const ref = (refs.get(g.k) || '').trim();
        if (!ids.length || !ref) return;

        setOcupada(g.k);
        const { error } = await asentarDiferencias(ids, ref);
        if (error) {
            setOcupada(null);
            showToast?.('No se pudo registrar', mensajeAmigable(error, 'Vuelve a cargar la lista.'), 'error');
            return;
        }
        appendAuditLog?.('CORTE_CAJA_DIFERENCIAS_ASENTADAS', user?.id, {
            sucursal: nombreSala[g.branchId] || '', referencia: ref, cuantas: ids.length,
        });
        showToast?.(
            g.entra ? 'Ingreso registrado' : 'Vale registrado',
            `${ids.length} ${ids.length === 1 ? 'diferencia' : 'diferencias'} con el número ${ref}`,
            'success',
        );

        // Se guarda ANTES de imprimir y de recargar: al recargar, estas filas
        // salen de la lista de pendientes y el papel se quedaría sin su detalle.
        const asiento = {
            branchId: g.branchId, entra: g.entra, ref, filas: incluidas,
            cuando: new Date().toISOString(),
        };
        setUltimo(asiento);
        await imprimirAsiento(asiento);
        setOcupada(null);
        onHecho?.();
    }, [excluidas, refs, showToast, appendAuditLog, user, nombreSala, onHecho, imprimirAsiento]);

    const abrirCorreccion = useCallback((d) => {
        setCorrigiendo(d.id);
        setMotivoCorregir('');
        // La causa arranca con la que ya tenía: casi siempre es la buena y lo que
        // estuvo mal fue la vía. Se deja editable porque el usuario pidió las dos
        // mitades — «debe permitir poner causa, y corregir la diferencia».
        setCausaCorregir(d.causa || '');
    }, []);

    const corregir = useCallback(async (d) => {
        const motivo = motivoCorregir.trim();
        if (!motivo) return;

        setOcupada(`dif:${d.id}`);
        const { error } = await justificarDiferencia(d.id, motivo, causaCorregir);
        setOcupada(null);
        if (error) {
            showToast?.('No se pudo corregir', mensajeAmigable(error, 'Vuelve a cargar la lista.'), 'error');
            return;
        }
        appendAuditLog?.('CORTE_CAJA_DIFERENCIA_CORREGIDA', user?.id, {
            diferencia_id: d.id, corte_id: d.corte_id, sucursal: nombreSala[d.branch_id] || '',
            fecha: d.fecha, monto: d.monto, via_anterior: d.via, motivo, causa: causaCorregir,
        });
        showToast?.('Diferencia corregida',
            'Queda como causa encontrada: no mueve dinero, así que sale de esta lista.', 'success');
        setCorrigiendo(null);
        setMotivoCorregir('');
        setCausaCorregir('');
        onHecho?.();
    }, [motivoCorregir, causaCorregir, showToast, appendAuditLog, user, nombreSala, onHecho]);

    return (
        <LiquidModal
            open={!!abierto}
            onClose={ocupada ? undefined : onClose}
            maxWidth="max-w-2xl"
            className="h-fit"
            ariaLabel="Registrar las diferencias en el sistema"
        >
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Registrar en el sistema</h3>
                    <p className="text-caption text-content-3">
                        Un solo movimiento por sala cubre varias diferencias
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                <Notice variant="info" icon={Landmark}>
                    <span className="font-bold">Primero se anota allá, después se marca aquí</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Haz un movimiento por el total de cada grupo y escribe con qué número
                        quedó. Se anota en cada una de las diferencias que cubre.
                    </span>
                    {/* La lista da por hecho que cada fila mueve dinero, y hay
                        una que no: la que ya tiene explicación. Decirlo acá es
                        lo que evita que alguien haga un vale para cerrar el
                        aviso. */}
                    <span className="block mt-1.5 font-normal text-content-2">
                        Si alguna ya tiene su explicación y no hay dinero que mover, corrígela
                        con <span className="font-bold">No lleva movimiento</span>. También
                        puedes cerrar y dejarlas pendientes.
                    </span>
                </Notice>

                {grupos.map((g) => {
                    const incluidas = g.filas.filter((d) => !excluidas.has(d.id));
                    const total = incluidas.reduce((a, d) => a + Math.abs(Number(d.monto)), 0);
                    const ref = refs.get(g.k) || '';
                    return (
                        <div key={g.k} data-surface="card" className="p-3 space-y-2">
                            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                <span className="text-label font-bold text-content">
                                    {nombreSala[g.branchId] || `Sucursal ${g.branchId}`}
                                </span>
                                <span className="text-caption text-content-2">
                                    {g.entra ? 'Entra a caja' : 'Sale de caja'}
                                </span>
                            </div>

                            {g.filas.map((d) => (
                                <div key={d.id} className="space-y-2">
                                    <div className="flex items-start gap-2">
                                        <div className="min-w-0 flex-1">
                                            <Checkbox
                                                name={`asentar-${d.id}`}
                                                checked={!excluidas.has(d.id)}
                                                onChange={() => alternar(d.id)}
                                                label={`${d.fecha} · ${formatMoney(Math.abs(Number(d.monto)))}`}
                                                description={d.causa}
                                            />
                                        </div>
                                        {/* Con rótulo y no sólo ícono: es una acción
                                            que cambia lo que significa la fila, y
                                            nadie la va a descubrir tanteando. */}
                                        {corrigiendo !== d.id && (
                                            <Button
                                                variant="ghost" size="sm" icon={Undo2}
                                                className="shrink-0"
                                                disabled={!!ocupada}
                                                onClick={() => abrirCorreccion(d)}
                                            >
                                                No lleva movimiento
                                            </Button>
                                        )}
                                    </div>

                                    {corrigiendo === d.id && (
                                        <div data-surface="card" className="p-3 space-y-2">
                                            <Notice variant="info">
                                                <span className="font-bold">Queda como «ya se encontró la causa»</span>
                                                <span className="block mt-0.5 font-normal text-content-2">
                                                    No entra ni sale dinero: sale de esta lista y no va
                                                    en el {g.entra ? 'ingreso' : 'vale'}. La resolución
                                                    anterior se anula y queda en la bitácora del corte.
                                                </span>
                                            </Notice>
                                            <PortalTextarea
                                                label="Por qué se corrige"
                                                name={`motivo-corregir-${d.id}`}
                                                value={motivoCorregir}
                                                onChange={(e) => setMotivoCorregir(e.target.value)}
                                                rows={2}
                                                placeholder="Qué estaba mal en la resolución anterior"
                                            />
                                            <PortalTextarea
                                                label="Causa"
                                                name={`causa-corregir-${d.id}`}
                                                value={causaCorregir}
                                                onChange={(e) => setCausaCorregir(e.target.value)}
                                                rows={2}
                                                placeholder="De dónde salió la diferencia"
                                            />
                                            <div className="flex items-center justify-end gap-1.5">
                                                <Button variant="ghost" size="sm"
                                                    disabled={!!ocupada}
                                                    onClick={() => setCorrigiendo(null)}>
                                                    Volver
                                                </Button>
                                                <Button variant="primary" size="sm"
                                                    loading={ocupada === `dif:${d.id}`}
                                                    disabled={!motivoCorregir.trim() || !causaCorregir.trim()}
                                                    onClick={() => corregir(d)}>
                                                    Corregir
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}

                            <div className="flex items-baseline justify-between gap-3 pt-1">
                                <span className="text-caption font-black uppercase tracking-widest text-content-3">
                                    Total del {g.entra ? 'ingreso' : 'vale'}
                                </span>
                                <span className="text-body font-bold tabular-nums text-content">
                                    {formatMoney(total)}
                                </span>
                            </div>

                            <div className="flex items-end gap-2">
                                <div className="flex-1 min-w-0">
                                    <PortalInput
                                        label={`Número del ${g.entra ? 'ingreso' : 'vale'}`}
                                        name={`ref-${g.k}`}
                                        value={ref}
                                        onChange={(e) => setRefs((prev) => new Map(prev).set(g.k, e.target.value))}
                                        placeholder="Con qué número quedó"
                                    />
                                </div>
                                <Button
                                    variant="primary"
                                    onClick={() => registrar(g)}
                                    loading={ocupada === g.k}
                                    disabled={!ref.trim() || !incluidas.length || !!ocupada}
                                >
                                    Marcar registrado
                                </Button>
                            </div>
                        </div>
                    );
                })}

                {/* Volver a imprimir el último, sin cerrar. La ticketera dice
                    «recibido», nunca «salió papel»: si se atascó el rollo, esta
                    es la salida — y después de recargar, la lista ya no tiene el
                    detalle con que se armó. */}
                {ultimo && (
                    <div data-surface="card" className="p-3 flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <span className="text-label font-bold text-content">
                                {ultimo.entra ? 'Ingreso' : 'Vale'} {ultimo.ref}
                            </span>
                            <span className="block text-caption text-content-3">
                                {nombreSala[ultimo.branchId] || ''} · {ultimo.filas.length}{' '}
                                {ultimo.filas.length === 1 ? 'diferencia' : 'diferencias'}
                            </span>
                        </div>
                        <Button variant="secondary" size="sm" icon={Printer}
                            onClick={() => imprimirAsiento(ultimo)}>
                            Volver a imprimir
                        </Button>
                    </div>
                )}

                {!grupos.length && (
                    <Notice variant="success">No queda ninguna diferencia por registrar.</Notice>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose} disabled={!!ocupada}>Cerrar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
