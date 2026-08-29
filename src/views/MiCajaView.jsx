import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { ArrowDownLeft, ArrowUpRight, DoorOpen, Landmark, Lock, Scale, Wallet } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Button from '../components/common/Button';
import CarrilCards from '../components/common/CarrilCards';
import LiquidModal from '../components/common/LiquidModal';
import Notice from '../components/common/Notice';
import FileField from '../components/common/FileField';
import PortalInput from '../components/common/PortalInput';
import StatCard from '../components/common/StatCard';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import {
    abrirCaja, anotarIngreso, anotarSalida, cerrarElDia, estadoDeCaja, fetchBolsas,
    fetchMovimientosDelPortal, fetchSaldos, fetchValesPendientes, hacerCorte,
    leerBoleta, pedirCorreccion, subirComprobante,
} from '../data/bolsas';

/* Sacar dinero de una bolsa se mudó acá desde Bolsas (pedido del usuario,
 * 29-ago): todo lo que mueve efectivo vive en la caja. Es el MISMO componente,
 * no una copia — arrastra su catálogo de motivos, la lectura de la boleta, la
 * identidad de quien retira y el reparto entre bolsas. Va diferido porque
 * arrastra el editor de fotos, y la mayoría de las visitas a esta pantalla no
 * sacan dinero de una bolsa. */
const SalidaDeBolsa = lazy(() => import('../components/bolsas/SalidaDeBolsa'));
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
    const [bolsas, setBolsas] = useState(VACIO);
    const [movimientos, setMovimientos] = useState(VACIO);
    const [corrigiendo, setCorrigiendo] = useState(null);

    const nombreSala = useMemo(
        () => branches.find((b) => String(b.id) === String(sala))?.name || '',
        [branches, sala],
    );

    const cargar = useCallback(async () => {
        if (!sala) { setCargando(false); return; }
        setCargando(true);
        const [e, v, abiertas, movs] = await Promise.all([
            estadoDeCaja(sala), fetchValesPendientes(),
            fetchBolsas({ estados: ['ABIERTA', 'ENTREGADA', 'CONTADA'] }),
            fetchMovimientosDelPortal(sala),
        ]);
        setMovimientos(movs);
        setEstado(e.error ? null : e);
        setPendientes((v.filas || []).filter((p) => String(p.branch_id) === String(sala)));
        // Sólo las de esta sala y con su saldo: `SalidaDeBolsa` elige la más
        // vieja que alcance sola, y sin el saldo no puede elegir.
        const mias = (abiertas || []).filter((b) => String(b.branch_id) === String(sala));
        const saldos = await fetchSaldos(mias.map((b) => b.id));
        setBolsas(mias.map((b) => ({ ...b, ...(saldos.get(b.id) || {}) })));
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
                                Al hacer el corte se anota <b>un solo vale de caja</b> con estas {pendientes.length} salidas.
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
                                        {/* La salida del CAJÓN, no la de una bolsa: ésa vive en
                                            Bolsas, con su bolsa elegida y su vale consolidado. */}
                                        <Button variant="secondary" icon={ArrowUpRight} onClick={() => setDialogo('salida')}>
                                            Anotar una salida
                                        </Button>
                                        {bolsas.length > 0 && (
                                            <Button variant="secondary" icon={Landmark} onClick={() => setDialogo('bolsa')}>
                                                Sacar de una bolsa
                                            </Button>
                                        )}
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

                        {movimientos.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-caption font-black uppercase tracking-widest text-content-2">
                                    Anotado hoy desde el portal
                                </h3>
                                {movimientos.map((m) => (
                                    <div key={m.id} data-surface="card"
                                        className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="min-w-0">
                                            <p className={`text-body-sm font-medium ${m.anulado_at ? 'text-content-3 line-through' : 'text-content'}`}>
                                                {m.concepto}
                                            </p>
                                            <p className="text-caption text-content-3">
                                                {m.tipo === 'ENTRADA' ? 'Entró' : 'Salió'}
                                                {m.numero_boleta ? ` · boleta ${m.numero_boleta}` : ''}
                                                {m.erp_movimiento_id ? '' : ' · sin llegar a la caja'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className={`tabular-nums font-bold ${m.tipo === 'ENTRADA' ? 'text-success-text' : 'text-warning-text'}`}>
                                                {m.tipo === 'SALIDA' ? '−' : ''}{formatMoney(m.monto)}
                                            </span>
                                            {puedeOperar && !m.anulado_at && (
                                                <Button variant="ghost" size="sm" onClick={() => setCorrigiendo(m)}>
                                                    Corregir
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
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

            <DialogoMovimiento abierto={dialogo === 'ingreso' || dialogo === 'salida'}
                entra={dialogo === 'ingreso'} ocupado={ocupado} sala={sala} userId={user?.id}
                onClose={() => setDialogo(null)}
                onAnotar={(datos) => correr(
                    () => (dialogo === 'ingreso' ? anotarIngreso : anotarSalida)({ sala, ...datos }),
                    dialogo === 'ingreso' ? 'Ingreso anotado.' : 'Salida anotada.',
                )} />

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

            {dialogo === 'bolsa' && (
                <Suspense fallback={null}>
                    <SalidaDeBolsa abierto bolsas={bolsas} saldos={null}
                        onClose={() => setDialogo(null)}
                        onHecho={() => { setDialogo(null); cargar(); }} />
                </Suspense>
            )}

            <DialogoCorregir movimiento={corrigiendo} ocupado={ocupado}
                onClose={() => setCorrigiendo(null)}
                onPedir={(que, motivo, montoNuevo) => correr(
                    () => pedirCorreccion({ sala, movimiento: corrigiendo.id, que, motivo, montoNuevo }),
                    'Queda pedido. Alguien tiene que aprobarlo.',
                ).then(() => setCorrigiendo(null))} />

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

/**
 * Un movimiento del cajón: entra o sale. Un solo diálogo para los dos porque es
 * el mismo acto con el signo dado vuelta — y dos diálogos gemelos se separan el
 * día que alguien mejora uno.
 *
 * ── La foto manda sobre lo tecleado ────────────────────────────────────────
 * Si el papel es una boleta —el pago de un recibo, una remesa del POS—, la foto
 * llena el monto y el número. Es la misma lectura que usa la salida de bolsa, y
 * el criterio es el de allá: lo que dice el papel gana, porque el papel es la
 * verdad de la operación y un número tecleado encima sólo puede alejarse de él.
 */
function DialogoMovimiento({ abierto, entra, ocupado, sala, userId, onClose, onAnotar }) {
    const [monto, setMonto] = useState('');
    const [concepto, setConcepto] = useState('');
    const [boleta, setBoleta] = useState('');
    // El tercer campo cambia con el sentido, porque así son los dos formularios
    // del sistema: el ingreso pide «código de vendedor» y el vale pide «recibe».
    // Es el mismo cuadro y por eso comparte estado.
    const [extra, setExtra] = useState('');
    const [foto, setFoto] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [aviso, setAviso] = useState(null);
    const valido = Number(monto) > 0 && concepto.trim().length > 2;

    // Al elegir la foto se lee sola: pedirle a alguien que además apriete un
    // botón para que la lean es pedirle que haga el trabajo dos veces.
    const alElegirFoto = async (f) => {
        setFoto(f);
        setAviso(null);
        if (!f) return;
        setLeyendo(true);
        const r = await leerBoleta(f, {
            entidad: null,
            numeroBoleta: boleta.trim() || null,
            monto: Number(monto) || null,
        });
        setLeyendo(false);
        if (r?.error) { setAviso('No se pudo leer la foto. Puedes escribir el monto a mano.'); return; }
        const leido = r?.leido || {};
        const llenados = [];
        if (Number.isFinite(Number(leido.monto)) && Number(leido.monto) > 0) {
            setMonto(String(leido.monto)); llenados.push('el monto');
        }
        if (leido.numero) { setBoleta(String(leido.numero)); llenados.push('el número'); }
        setAviso(llenados.length
            ? `La foto llenó ${llenados.join(' y ')}.`
            : 'La foto no traía monto ni número legibles.');
    };

    const guardar = async () => {
        let fotoUrl = null;
        if (foto) {
            try { fotoUrl = await subirComprobante(foto, { salaId: sala, userId }); } catch { fotoUrl = null; }
        }
        onAnotar({
            monto: Number(monto), concepto: concepto.trim(),
            boleta: boleta.trim() || null, fotoUrl,
            ...(entra ? { vendedor: extra.trim() } : { recibe: extra.trim() }),
        });
    };

    return (
        <Marco abierto={abierto} onClose={onClose}
            titulo={entra ? 'Anotar un ingreso' : 'Anotar una salida'}
            bajada={entra
                ? 'Dinero que entra a la caja y no es una venta: el pago de un recibo, un depósito a cuenta.'
                : 'Dinero que sale del cajón. Si sale de una bolsa, se registra en Bolsas y no aquí.'}>
            <FileField label="Foto de la boleta" accept="image/*" value={foto}
                onChange={alElegirFoto} hint={leyendo ? 'Leyendo la foto…' : undefined} />
            {aviso && <p className="text-caption text-content-2">{aviso}</p>}
            <PortalInput label="Monto" inputMode="decimal" value={monto}
                onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
            <PortalInput label="Número de boleta" value={boleta}
                onChange={(e) => setBoleta(e.target.value)} placeholder="000375" />
            <PortalInput label="Concepto" value={concepto} maxLength={50}
                onChange={(e) => setConcepto(e.target.value)}
                placeholder={entra ? 'Pago de CAESS' : 'Compra de agua fría'} />
            <PortalInput label={entra ? 'Código de vendedor' : 'Quién recibe'}
                value={extra} maxLength={60}
                onChange={(e) => setExtra(e.target.value)}
                placeholder={entra ? 'opcional' : 'nombre de quien se lleva el efectivo'} />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || leyendo || !valido} onClick={guardar}>
                    Anotar
                </Button>
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
                            Se anotó un vale de caja de {formatMoney(resultado.vale.monto)} antes del corte.
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
                    Antes del corte se anota un <b>vale de caja</b> con {pendientes} salida{pendientes === 1 ? '' : 's'} del día.
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

/**
 * Pedir que se anule o se corrija un movimiento ya anotado.
 *
 * Pide, no cambia: lo que ya está del otro lado lo corrige quien aprueba. Es la
 * misma decisión que el portal ya toma para anular una factura, y por eso va por
 * la misma bandeja en vez de tener una cola propia donde algo se quede esperando
 * sin que nadie lo mire.
 */
function DialogoCorregir({ movimiento, ocupado, onClose, onPedir }) {
    const [que, setQue] = useState('ANULAR');
    const [motivo, setMotivo] = useState('');
    const [montoNuevo, setMontoNuevo] = useState('');
    if (!movimiento) return null;
    const valido = motivo.trim().length >= 5
        && (que === 'ANULAR' || Number(montoNuevo) > 0);

    return (
        <Marco abierto onClose={onClose} titulo="Pedir una corrección"
            bajada={`${movimiento.concepto} · ${formatMoney(movimiento.monto)}`}>
            <div className="flex gap-2">
                <Button size="sm" variant={que === 'ANULAR' ? 'primary' : 'secondary'}
                    onClick={() => setQue('ANULAR')}>Anularlo</Button>
                <Button size="sm" variant={que === 'MONTO' ? 'primary' : 'secondary'}
                    onClick={() => setQue('MONTO')}>Corregir el monto</Button>
            </div>
            {que === 'MONTO' && (
                <PortalInput label="Monto correcto" inputMode="decimal" value={montoNuevo}
                    onChange={(e) => setMontoNuevo(e.target.value)} placeholder="0.00" />
            )}
            <PortalInput label="Motivo" value={motivo} maxLength={200}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Se anotó dos veces" />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button variant="primary" disabled={ocupado || !valido}
                    onClick={() => onPedir(que, motivo.trim(), que === 'MONTO' ? Number(montoNuevo) : null)}>
                    Pedir
                </Button>
            </div>
        </Marco>
    );
}
