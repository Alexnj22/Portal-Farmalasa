import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, DoorOpen, Landmark, Lock, Scale, Wallet } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Button from '../components/common/Button';
import CarrilCards from '../components/common/CarrilCards';
import LiquidModal from '../components/common/LiquidModal';
import Notice from '../components/common/Notice';
import PortalInput from '../components/common/PortalInput';
import StatCard from '../components/common/StatCard';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import {
    abrirCaja, anotarIngreso, cerrarElDia, estadoDeCaja, fetchValesPendientes, hacerCorte,
} from '../data/bolsas';
import { formatMoney } from '../utils/formatNumber';
import { mensajeAmigable } from '../utils/errorMessages';

/**
 * Mi caja — el turno de esta sala, ahora.
 *
 * ── Por qué una sola pantalla y no cuatro ──────────────────────────────────
 * Abrir, anotar, cortar y cerrar son actos del MISMO turno y comparten estado.
 * Repartirlos obligaría a saltar de pantalla para seguir un solo día de caja, y
 * una sala tiene una caja: una vista de «aperturas» sería una lista de un
 * elemento con filtros que no recortan nada. Lo que SÍ es una lista —el
 * historial de todas las salas— vive en Cortes, que es la pantalla de mirar.
 *
 * ── El conteo a ciegas ─────────────────────────────────────────────────────
 * Al cortar se pide UN número: el efectivo contado. La pantalla NO dice cuánto
 * debería haber, y no es un olvido — es el control entero. La otra pantalla lo
 * muestra antes de teclear y su total sale de tres casillas que escribe la
 * misma persona, así que inflando la de tarjeta la diferencia queda en cero.
 * Acá lo esperado llega recién en la respuesta, junto con la diferencia.
 *
 * ⚠️ Y sólo vale si el corte se hace únicamente desde acá: mientras la sala
 * pueda cortar en la otra pantalla, ahí ve el esperado.
 */
const VACIO = [];

export default function MiCajaView() {
    // `VACIO` estable y no `|| []`: un arreglo nuevo en cada render invalida
    // los `useMemo` que dependen de él.
    const branches = useStaff((s) => s.branches) ?? VACIO;
    const { user, hasPermission, getScope } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const puedeOperar = hasPermission('caja_vales', 'can_edit');
    const alcanceTodas = getScope('cortes_caja') === 'ALL';

    const [sala, setSala] = useState(() => user?.branch_id ?? null);
    const [estado, setEstado] = useState(null);
    const [pendientes, setPendientes] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [ocupado, setOcupado] = useState(false);
    const [dialogo, setDialogo] = useState(null);   // 'abrir' | 'ingreso' | 'corte' | 'cerrar'
    const [resultado, setResultado] = useState(null);

    const nombreSala = useMemo(
        () => branches.find((b) => String(b.id) === String(sala))?.name || '',
        [branches, sala],
    );

    const cargar = useCallback(async () => {
        if (!sala) { setCargando(false); return; }
        setCargando(true);
        const [e, v] = await Promise.all([estadoDeCaja(sala), fetchValesPendientes()]);
        setEstado(e.error ? null : e);
        setPendientes((v.filas || []).filter((p) => String(p.branch_id) === String(sala)));
        setCargando(false);
    }, [sala]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de sala

    const totalPendiente = pendientes.reduce((s, p) => s + Number(p.monto || 0), 0);

    const correr = async (fn, exito) => {
        setOcupado(true);
        const r = await fn();
        setOcupado(false);
        if (r.error) { showToast(mensajeAmigable(r.error), 'error'); return null; }
        if (exito) showToast(exito, 'success');
        setDialogo(null);
        cargar();
        return r;
    };

    if (!sala) {
        return (
            <GlassViewLayout icon={Wallet} title="Mi caja">
                <div className="p-4 md:p-6">
                    <EmptyState compact icon={Wallet} title="Sin sala"
                        subtitle="Tu ficha no tiene una sala asignada, así que no hay caja que mostrar." />
                </div>
            </GlassViewLayout>
        );
    }

    return (
        <GlassViewLayout icon={Wallet} title={`Mi caja${nombreSala ? ` · ${nombreSala}` : ''}`}>
            <div className="p-4 md:p-6 space-y-6">

                {alcanceTodas && branches.length > 1 && (
                    <div className="flex gap-2 flex-wrap">
                        {branches.map((b) => (
                            <Button key={b.id} size="sm"
                                variant={String(b.id) === String(sala) ? 'primary' : 'secondary'}
                                onClick={() => setSala(b.id)}>
                                {b.name}
                            </Button>
                        ))}
                    </div>
                )}

                {cargando && <LoadingState label="Mirando la caja" />}

                {!cargando && (
                    <>
                        <Notice variant={estado?.abierta ? 'success' : 'info'}
                            icon={estado?.abierta ? DoorOpen : Lock}>
                            <span className="font-bold">
                                {estado?.abierta ? 'La caja está abierta' : 'La caja está cerrada'}
                            </span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                {estado?.abierta
                                    ? `Caja ${estado.caja} · turno ${estado.turno}`
                                    : 'Nadie puede vender hasta abrirla.'}
                            </span>
                        </Notice>

                        <CarrilCards ariaLabel="Lo que falta anotarle a la caja">
                            <StatCard icon={ArrowUpRight} label="Salidas por anotar"
                                value={pendientes.length}
                                iconBg="bg-warning/10" iconCls="text-warning-text"
                                valueCls={pendientes.length ? 'text-warning-text' : undefined} />
                            <StatCard icon={Landmark} label="Suman"
                                value={formatMoney(totalPendiente)} />
                        </CarrilCards>

                        {pendientes.length > 0 && (
                            <Notice variant="warning" icon={Landmark}>
                                Al hacer el corte se anota <b>un solo vale</b> con estas {pendientes.length} salidas.
                                Salieron de una bolsa del día que la caja tiene abierto, así que sigue
                                esperando ese dinero.
                            </Notice>
                        )}

                        {puedeOperar && (
                            <div className="flex gap-2 flex-wrap">
                                {!estado?.abierta && (
                                    <Button variant="primary" icon={DoorOpen} onClick={() => setDialogo('abrir')}>
                                        Abrir la caja
                                    </Button>
                                )}
                                {estado?.abierta && (
                                    <>
                                        <Button variant="secondary" icon={ArrowDownLeft} onClick={() => setDialogo('ingreso')}>
                                            Anotar un ingreso
                                        </Button>
                                        <Button variant="primary" icon={Scale} onClick={() => { setResultado(null); setDialogo('corte'); }}>
                                            Hacer el corte
                                        </Button>
                                        <Button variant="ghost" icon={Lock} onClick={() => setDialogo('cerrar')}>
                                            Cerrar el día
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}

                        {!puedeOperar && (
                            <Notice variant="info" icon={Lock}>
                                Puedes ver el estado de la caja, pero no operarla desde el portal.
                            </Notice>
                        )}
                    </>
                )}
            </div>

            <DialogoAbrir abierto={dialogo === 'abrir'} ocupado={ocupado}
                onClose={() => setDialogo(null)}
                onAbrir={(monto) => correr(() => abrirCaja({ sala, montoApertura: monto }), 'La caja quedó abierta.')} />

            <DialogoIngreso abierto={dialogo === 'ingreso'} ocupado={ocupado}
                onClose={() => setDialogo(null)}
                onAnotar={(monto, concepto) => correr(() => anotarIngreso({ sala, monto, concepto }), 'Ingreso anotado.')} />

            <DialogoCorte abierto={dialogo === 'corte'} ocupado={ocupado} resultado={resultado}
                pendientes={pendientes.length}
                onClose={() => { setDialogo(null); setResultado(null); }}
                onCortar={async (efectivo) => {
                    setOcupado(true);
                    const r = await hacerCorte({ sala, efectivo });
                    setOcupado(false);
                    if (r.error) { showToast(mensajeAmigable(r.error), 'error'); return; }
                    setResultado(r);
                    cargar();
                }} />

            <DialogoCerrar abierto={dialogo === 'cerrar'} ocupado={ocupado}
                onClose={() => setDialogo(null)}
                onCerrar={() => correr(() => cerrarElDia(sala), 'El día quedó cerrado.')} />
        </GlassViewLayout>
    );
}

function Marco({ abierto, onClose, titulo, bajada, children }) {
    if (!abierto) return null;
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-sm" ariaLabel={titulo}>
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">{titulo}</h3>
                    {bajada && <p className="text-body-sm text-content-2 mt-1">{bajada}</p>}
                </div>
                {children}
            </div>
        </LiquidModal>
    );
}

function DialogoAbrir({ abierto, ocupado, onClose, onAbrir }) {
    const [monto, setMonto] = useState('');
    return (
        <Marco abierto={abierto} onClose={onClose} titulo="Abrir la caja"
            bajada="Con cuánto efectivo arranca la caja. Si arranca en cero, déjalo vacío.">
            {/* Texto y no `type="number"`: el campo numérico nativo no tiene
                separador decimal en el teléfono, y esto es dinero. */}
            <PortalInput label="Monto de apertura" inputMode="decimal" value={monto}
                onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado}
                    onClick={() => onAbrir(Number(monto || 0))}>Abrir</Button>
            </div>
        </Marco>
    );
}

function DialogoIngreso({ abierto, ocupado, onClose, onAnotar }) {
    const [monto, setMonto] = useState('');
    const [concepto, setConcepto] = useState('');
    const valido = Number(monto) > 0 && concepto.trim().length > 2;
    return (
        <Marco abierto={abierto} onClose={onClose} titulo="Anotar un ingreso"
            bajada="Dinero que entra a la caja y no es una venta: el pago de un recibo, un depósito a cuenta.">
            <PortalInput label="Monto" inputMode="decimal" value={monto}
                onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
            <PortalInput label="Concepto" value={concepto} maxLength={50}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder="Pago de CAESS, boleta 000375" />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || !valido}
                    onClick={() => onAnotar(Number(monto), concepto.trim())}>Anotar</Button>
            </div>
        </Marco>
    );
}

function DialogoCorte({ abierto, ocupado, resultado, pendientes, onClose, onCortar }) {
    const [efectivo, setEfectivo] = useState('');
    const valido = efectivo !== '' && Number(efectivo) >= 0;

    // Con resultado, la pantalla cambia de trabajo: ya no pide un número, dice
    // cómo salió. Son dos momentos y no dos diálogos porque es el mismo acto.
    if (resultado) {
        const dif = Number(resultado.diferencia || 0);
        const cuadro = Math.abs(dif) < 0.005;
        return (
            <Marco abierto={abierto} onClose={onClose} titulo={cuadro ? 'El corte cuadró' : 'El corte tiene diferencia'}>
                <div className="space-y-1 text-body-sm">
                    <p className="text-content-2">Contaste <b className="text-content tabular-nums">{formatMoney(resultado.contado)}</b></p>
                    <p className="text-content-2">La caja esperaba <b className="text-content tabular-nums">{formatMoney(resultado.esperado)}</b></p>
                    <p className={`text-h3 font-bold tabular-nums ${cuadro ? 'text-success-text' : dif > 0 ? 'text-warning-text' : 'text-danger-text'}`}>
                        {dif > 0 ? '+' : ''}{formatMoney(dif)}
                    </p>
                    {resultado.vale && (
                        <p className="text-caption text-content-3">
                            Se anotó un vale de {formatMoney(resultado.vale.monto)} antes del corte.
                        </p>
                    )}
                    {!resultado.ok && (
                        <p className="text-caption text-danger-text">
                            El corte no quedó registrado: {resultado.respuesta || 'el sistema lo rechazó'}
                        </p>
                    )}
                </div>
                <div className="flex justify-end">
                    <Button variant="primary" onClick={onClose}>Entendido</Button>
                </div>
            </Marco>
        );
    }

    return (
        <Marco abierto={abierto} onClose={onClose} titulo="Hacer el corte"
            bajada="Cuenta el efectivo de la caja y escribe cuánto hay. No se muestra cuánto debería haber: eso aparece después.">
            {pendientes > 0 && (
                <Notice variant="info" icon={Landmark}>
                    Antes del corte se anota un vale con {pendientes} salida{pendientes === 1 ? '' : 's'} del día.
                </Notice>
            )}
            <PortalInput label="Efectivo contado" inputMode="decimal" value={efectivo}
                onChange={(e) => setEfectivo(e.target.value)} placeholder="0.00" autoFocus />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || !valido}
                    onClick={() => onCortar(Number(efectivo))}>Hacer el corte</Button>
            </div>
        </Marco>
    );
}

function DialogoCerrar({ abierto, ocupado, onClose, onCerrar }) {
    return (
        <Marco abierto={abierto} onClose={onClose} titulo="Cerrar el día"
            bajada="Cierra el turno y emite el cierre del día. Después de esto la caja queda cerrada hasta mañana.">
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado} onClick={onCerrar}>Cerrar el día</Button>
            </div>
        </Marco>
    );
}
