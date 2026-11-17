import React, { Suspense, lazy, useState } from 'react';
import { ArrowLeft, ChevronRight, Clock3, KeyRound, LogOut, Receipt, RefreshCw, ScanBarcode, ShoppingCart, Wallet, WifiOff, X } from 'lucide-react';
import PortalInput from '../common/PortalInput';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Notice from '../common/Notice';
import SegmentedControl from '../common/SegmentedControl';
import AvatarConEstado from '../common/AvatarConEstado';
import { LoadingState, SkeletonText } from '../common/StateViews';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { useAuth } from '@nucleo/context/AuthContext';
import useKioscoDeCaja from './useKioscoDeCaja';
import { esperaTexto, minutosDesde, tonoDeEspera, useColaDeCaja } from './datosDeLaCola';
import { Anillo, Etiquetas, Pide } from './piezasDelKiosco';

// Kiosco de caja (diseño elegido el 2026-11-17).
//
// La cola vive SIEMPRE en una columna a la izquierda, también mientras se
// vende o se hace un corte; a la derecha está el trabajo. Cada ticket dice a
// quién se cobra y quién lo vendió. Tocar un ticket abre la MISMA pantalla de
// venta cargada con esa preventa, para corregir y cobrar ahí.
const MiCajaView = lazy(() => import('../../views/MiCajaView'));
const PreventaView = lazy(() => import('../../views/PreventaView'));

const ACCIONES = {
    vender: { label: 'Vender', icon: ShoppingCart, description: 'Arma la venta y mándala a la cola.', pide: 'Pasa tu carné para vender' },
    caja: { label: 'Caja', icon: Wallet, description: 'Apertura, cortes y cierre del día.', pide: 'Pasa tu carné para abrir la caja' },
    marcar: { label: 'Marcar', icon: Clock3, description: 'Entrada, salida o descanso.' },
};


// El vendedor como persona: la misma forma que entiende AvatarConEstado.
// Los nombres llegan en mayúsculas: en la cola se leen como nombre propio.
const nombreVisible = (t) => String(t).toLocaleLowerCase('es').replace(/(^|[\s.,])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('es'));

const vendedorDe = (p) => (p.vendedor ? { id: p.vendedor_id ?? null, name: p.vendedor, photo: p.vendedor_foto ?? null } : null);

/** Una persona en una línea: foto y nombre corto. */
function Persona({ persona, px = 20, rotulo, className = '' }) {
    if (!persona) return null;
    return (
        <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
            <AvatarConEstado emp={persona} px={px} mostrarChip={false} pendientes={false} />
            <span className="truncate">{rotulo ? `${rotulo} ` : ''}{shortEmployeeName(persona)}</span>
        </span>
    );
}

/** La columna de la cola: compacta, la más vieja arriba. Cada fila se toca. */
function ColumnaDeCola({ cola, problema, leyendo, ahora, leer, elegida, onElegir }) {
    return (
        <aside aria-label="Preventas en caja" data-surface="page-header"
            className="md:sticky md:top-0 md:h-[100dvh] md:w-[232px] xl:w-[264px] 2xl:w-[300px] shrink-0 md:border-r border-b md:border-b-0 border-border-card flex flex-col">
            <div className="h-[var(--barra-kiosco)] shrink-0 px-4 flex items-center justify-between gap-3 border-b border-border-card">
                <h2 className="text-title font-bold text-content flex items-center gap-2">
                    En caja {cola && <Badge size="sm" variant={cola.length ? 'info' : 'neutral'}>{cola.length}</Badge>}
                </h2>
                <Button variant="ghost" size="sm" icon={RefreshCw} iconOnly loading={leyendo} onClick={leer} aria-label="Actualizar la cola" />
            </div>
            {problema && <div className="px-5 pb-3"><Notice variant="warning" icon={WifiOff}>{problema}</Notice></div>}
            <div className="flex-1 overflow-y-auto px-2 py-2">
                {cola == null ? <div className="p-3"><SkeletonText lines={5} /></div>
                    : cola.length === 0 ? (
                        <div className="px-2 py-12 flex flex-col items-center gap-2 text-center">
                            <Receipt size={32} strokeWidth={1.5} className="text-content-3" aria-hidden="true" />
                            <p className="text-body-sm text-content-3">Nadie esperando.</p>
                        </div>
                    ) : (
                        <ol className="flex flex-col gap-1.5">
                            {cola.map((p, i) => {
                                const min = minutosDesde(p.enviada_at, ahora);
                                const activa = elegida === p.id;
                                const primero = i === 0;
                                return (
                                    <li key={p.id}>
                                        <button type="button" onClick={() => onElegir(activa ? null : p.id)} aria-pressed={activa} data-interactive
                                            className={`w-full text-left rounded-[var(--radius-card-anidada)] p-2.5 flex gap-2.5 items-start transition-colors duration-[var(--dur-fast)] active:scale-[0.99] ${activa ? 'bg-brand/15 ring-2 ring-brand/45' : 'hover:bg-brand/5'}`}>
                                            <span className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-body font-bold tabular-nums ${primero || activa ? 'bg-brand text-white' : 'bg-surface-input text-content'}`}>
                                                {p.referencia || '—'}
                                            </span>
                                            <span className="min-w-0 flex-1 flex flex-col gap-1">
                                                <span className="flex items-baseline justify-between gap-2">
                                                    <span className="text-body font-semibold text-content truncate">{p.cliente ? nombreVisible(p.cliente) : 'Cliente frecuente'}</span>
                                                    <span className="shrink-0 text-body font-bold tabular-nums text-content">{p.total != null ? formatMoney(Number(p.total)) : ''}</span>
                                                </span>
                                                <Persona persona={vendedorDe(p)} className="text-label text-content-3" rotulo="Vendió" />
                                                <span className="flex gap-1 overflow-hidden [mask-image:linear-gradient(to_right,black_85%,transparent)]">
                                                    <Badge size="sm" variant={tonoDeEspera(min)} dot>{esperaTexto(min)}</Badge>
                                                    <Etiquetas p={p} />
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
            </div>
        </aside>
    );
}

function Accion({ k, grande = false, activa, onClick }) {
    const a = ACCIONES[k];
    const Icono = a.icon;
    return (
        <Button variant={activa || grande ? 'primary' : 'secondary'} onClick={onClick} aria-pressed={activa}
            className={`!h-auto w-full !justify-start !items-start !text-left !rounded-[var(--radius-card)] ${grande ? '!p-7 h-full' : '!gap-4 !p-5'}`}>
            <span className={`flex w-full ${grande ? 'flex-col gap-6' : 'items-center gap-4'}`}>
                <span className={`shrink-0 rounded-2xl flex items-center justify-center ${grande ? 'w-16 h-16 bg-surface-card/15' : 'w-12 h-12 bg-brand/10 text-brand-text'}`}>
                    <Icono size={grande ? 32 : 24} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 flex flex-col gap-1">
                    <span className={`${grande ? 'text-display' : 'text-title'} font-bold leading-none`}>{a.label}</span>
                    <span className={`${grande ? 'text-body-lg' : 'text-body-sm'} font-normal opacity-80`}>{a.description}</span>
                </span>
                {!grande && <ChevronRight size={20} className="self-center opacity-60" aria-hidden="true" />}
            </span>
        </Button>
    );
}

// Elegido lo que se va a hacer, se pide quién es: el carné por el lector o,
// sin carné, usuario y contraseña (pedido del usuario, 2026-11-17).
function Acceso({ titulo, icono: Icono, entrando, aviso, conClave, setConClave, onClave, onVolver }) {
    const [usuario, setUsuario] = useState('');
    const [clave, setClave] = useState('');
    const enviar = (e) => { e.preventDefault(); onClave(usuario.trim(), clave); };
    return (
        <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto gap-5">
            <Button variant="ghost" icon={ArrowLeft} onClick={onVolver} disabled={entrando} className="self-start">Volver</Button>
            <section data-surface="card" className="p-6 flex flex-col gap-5">
                <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-xl bg-brand/10 text-brand-text flex items-center justify-center">
                        <Icono size={22} aria-hidden="true" />
                    </span>
                    <h1 className="text-title-lg font-black text-content">{titulo}</h1>
                </div>
                {conClave ? (
                    <form onSubmit={enviar} className="flex flex-col gap-3">
                        <PortalInput label="Usuario" name="usuario" autoComplete="username" value={usuario} autoFocus
                            onChange={(e) => setUsuario(e.target.value)} disabled={entrando} />
                        <PortalInput label="Contraseña" name="clave" type="password" autoComplete="current-password" value={clave}
                            onChange={(e) => setClave(e.target.value)} disabled={entrando} />
                        {aviso && <p className="text-body-sm text-warning-text" role="alert">{aviso}</p>}
                        <Button type="submit" size="lg" loading={entrando} disabled={!usuario.trim() || !clave}>Entrar</Button>
                        <Button variant="ghost" icon={ScanBarcode} onClick={() => setConClave(false)} disabled={entrando}>Usar mi carné</Button>
                    </form>
                ) : (
                    <>
                        <Pide titulo={entrando ? 'Abriendo…' : 'Pasa tu carné por el lector'}
                            detalle="Lo que hagas queda a tu nombre." aviso={aviso} />
                        <Button variant="secondary" icon={KeyRound} onClick={() => setConClave(true)} disabled={entrando}>
                            No tengo mi carné: entrar con usuario
                        </Button>
                    </>
                )}
            </section>
        </div>
    );
}

export default function CajaDelKiosco({
    ahora, onSalir, panelMarcador, marcadorOcupado, feedbackAbierto, onMarcadorActivo,
}) {
    const {
        user, equipo, abierta, marcando, accion, setAccion,
        entrando, aviso, restante, vista, setVista, terminar, conClave, setConClave, entrarConClave,
    } = useKioscoDeCaja({ marcadorOcupado, feedbackAbierto, onMarcadorActivo });
    const datosCola = useColaDeCaja();
    // El carné abre la sesión de cualquiera; lo que puede hacer lo dice su cargo.
    // Sin esto, alguien sin permiso entraba a Vender y veía un error rojo.
    const { hasPermission, rolePerms } = useAuth();
    const puede = { vender: hasPermission('preventa', 'can_edit'), caja: hasPermission('caja_vales', 'can_edit') };
    const [elegida, setElegida] = useState(null);
    const detalle = elegida ? datosCola.cola?.find((p) => p.id === elegida) : null;
    // `rolePerms` null = todavía no se leyó: no se acusa a nadie mientras carga.
    const sinPermiso = abierta && rolePerms != null && !puede[detalle ? 'vender' : vista];

    // Entrada / Salida: lleva a la caja con ese diálogo ya abierto.
    const [dialogoCaja, setDialogoCaja] = useState({ n: 0, cual: null });
    // Entrada / Salida desde la venta: abre la caja con ese diálogo y, al
    // cerrarlo, vuelve a la venta tal como estaba (sigue montada detrás).
    const abrirEnCaja = (cual) => {
        setDialogoCaja((d) => ({ n: d.n + 1, cual }));
        setVista('caja');
    };
    // A la caja por la pestaña: sin diálogo abierto.
    const irA = (v) => {
        if (v === 'caja') setDialogoCaja((d) => ({ n: d.n + 1, cual: null }));
        setVista(v);
    };

    // Cobrar pide sesión: sin ella, el ticket queda elegido y se pide el carné.
    const elegirTicket = (id) => {
        setElegida(id);
        if (id && !abierta) setAccion('vender');
    };

    const tocar = (k) => {
        setAccion((x) => (x === k ? null : k));
    };
    const pedida = accion && ACCIONES[accion];

    return (
        <div className="relative z-base flex-1 w-full flex flex-col md:flex-row [--barra-kiosco:4.5rem]">
            <ColumnaDeCola {...datosCola} elegida={detalle ? elegida : null} onElegir={elegirTicket} />

            <div className="flex-1 min-w-0 flex flex-col">
                <header className="h-[var(--barra-kiosco)] shrink-0 px-6 flex items-center justify-between gap-4 border-b border-border-card">
                    {abierta ? (
                        <>
                            <div className="flex items-center gap-3 min-w-0">
                                <AvatarConEstado emp={user} px={48} mostrarChip={false} />
                                <div className="min-w-0 leading-tight">
                                    <p className="text-title font-bold text-content truncate">{shortEmployeeName(user)}</p>
                                    <p className="text-label text-content-3">{equipo.branchName}</p>
                                </div>
                            </div>
                            {detalle && vista !== 'caja' ? (
                                <div className="flex items-center gap-3 rounded-[var(--radius-btn)] bg-brand/10 pl-4 pr-1 py-1">
                                    <Wallet size={18} className="text-brand-text" aria-hidden="true" />
                                    <span className="text-body font-bold text-content">Cobrando la #{detalle.referencia}</span>
                                    <Button size="sm" variant="ghost" icon={X} onClick={() => setElegida(null)}>Cerrar preventa <kbd className="ml-1 rounded border border-border-card px-1 text-micro font-bold">Esc</kbd></Button>
                                </div>
                            ) : (
                            <SegmentedControl className="kiosco-nav" label="Qué estás haciendo" tone="brand"
                                options={['vender', 'caja'].map((v) => ({ value: v, label: ACCIONES[v].label, icon: ACCIONES[v].icon }))}
                                value={vista} onChange={irA} />
                            )}
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <Anillo restante={restante} />
                                    <span className={`text-label leading-tight ${restante <= 30_000 ? 'text-warning-text font-semibold' : 'text-content-3'}`}>
                                        Se cierra sola<br />si no la usas
                                    </span>
                                </div>
                                <Button variant="secondary" icon={LogOut} onClick={terminar}>Terminar</Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-3 min-w-0">
                                <img src="/Logo192.png" alt="" className="w-10 h-10 object-contain" draggable="false" />
                                <div className="leading-tight">
                                    <p className="text-title font-bold text-content">{equipo.branchName || 'Kiosco de caja'}</p>
                                    <p className="text-label text-content-3 first-letter:uppercase">
                                        {fechaTexto(ahora, { weekday: 'long', day: 'numeric', month: 'long' })}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <p className="text-title-lg font-bold tabular-nums text-content">{hora12(ahora)}</p>
                                <Button variant="ghost" size="sm" icon={LogOut} iconOnly onClick={onSalir} aria-label="Salir del kiosco" />
                            </div>
                        </>
                    )}
                </header>

                <main className="flex-1 px-6 py-5 flex flex-col">
                    {/* Cobrar abre la MISMA pantalla de venta, cargada con la
                        preventa: se corrige presentación, cantidad, cliente o
                        pago con las mismas validaciones, y se cobra ahí. Una
                        venta propia a medias sigue en su borrador. */}
                    <div className="flex-1 flex flex-col">
                        {sinPermiso ? (
                            <div className="mx-auto w-full max-w-lg py-10 flex flex-col gap-4">
                                <Notice variant="warning" bloque>
                                    <p className="font-bold">Tu cargo no puede {detalle || vista === 'vender' ? 'vender' : 'usar la caja'} en este kiosco.</p>
                                    <p>Pide a un cajero o a tu jefe de sucursal que lo haga.</p>
                                </Notice>
                                <div className="flex flex-wrap gap-2">
                                    {!detalle && vista === 'vender' && puede.caja && <Button variant="secondary" icon={Wallet} onClick={() => irA('caja')}>Ir a la caja</Button>}
                                    {!detalle && vista === 'caja' && puede.vender && <Button variant="secondary" icon={ShoppingCart} onClick={() => irA('vender')}>Ir a vender</Button>}
                                    {detalle && <Button variant="secondary" icon={X} onClick={() => setElegida(null)}>Cerrar preventa</Button>}
                                    <Button icon={LogOut} onClick={terminar}>Terminar</Button>
                                </div>
                            </div>
                        ) : abierta ? (
                            <Suspense fallback={<LoadingState />}>
                                {/* La venta NO se desmonta al ir a la caja: lo editado
                                    sigue ahí al volver. */}
                                <div className={vista === 'caja' ? 'hidden' : 'flex-1 flex flex-col'}>
                                    {detalle ? (
                                        <PreventaView key={detalle.id} enKiosco cobrando={detalle} activa={vista !== 'caja'}
                                            onMovimientoDeCaja={abrirEnCaja}
                                            onTerminarCobro={() => { setElegida(null); datosCola.leer(); }} />
                                    ) : (
                                        <PreventaView enKiosco activa={vista !== 'caja'} onMovimientoDeCaja={abrirEnCaja} />
                                    )}
                                </div>
                                {vista === 'caja' && (
                                    <MiCajaView key={dialogoCaja.n} comoPestana abrirAlEntrar={dialogoCaja.cual}
                                        alCerrarDialogo={dialogoCaja.cual ? () => setVista('vender') : undefined} />
                                )}
                            </Suspense>
                        ) : marcando ? (
                            <div className="mx-auto w-full max-w-xl py-6 flex flex-col gap-3">
                                {panelMarcador}
                                {!marcadorOcupado && <Button variant="ghost" icon={X} onClick={() => setAccion(null)}>Volver</Button>}
                            </div>
                        ) : pedida ? (
                            <Acceso titulo={detalle ? `Cobrar la #${detalle.referencia}` : pedida.label} icono={detalle ? Receipt : pedida.icon}
                                entrando={entrando} aviso={aviso} conClave={conClave} setConClave={setConClave}
                                onClave={entrarConClave} onVolver={() => { setElegida(null); setAccion(null); }} />
                        ) : (
                            <div className="flex-1 flex flex-col gap-5 justify-center max-w-4xl w-full mx-auto">
                                <div>
                                    <h1 className="text-title-lg font-black text-content">¿Qué vas a hacer?</h1>
                                    <p className="text-body-sm text-content-3">Toca un ticket de la izquierda para cobrarlo.</p>
                                </div>
                                <div className="grid gap-4 md:grid-cols-[1.4fr_1fr] md:grid-rows-2">
                                    <div className="md:row-span-2"><Accion k="vender" grande activa={accion === 'vender'} onClick={() => tocar('vender')} /></div>
                                    <Accion k="caja" activa={accion === 'caja'} onClick={() => tocar('caja')} />
                                    <Accion k="marcar" activa={accion === 'marcar'} onClick={() => tocar('marcar')} />
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}
