/**
 * La pestaña «Escanear» de Puntos (pedido del dueño, 2026-10-15: «debemos
 * tener un lugar para escanear y que nos dé toda la info del cliente, y a
 * futuro venderle»).
 *
 * ── Cómo entra el código ────────────────────────────────────────────────────
 * La tarjeta del cliente (app Puntos Salud) trae un código de barras Code 128
 * con su código de 7 caracteres y un QR con la dirección de «Mis puntos». Los
 * lectores de mano de las salas escriben como un TECLADO: el código y un
 * Enter. Por eso el campo nace enfocado y busca al Enter, y si el foco se fue
 * a otra parte de la pantalla (se tocó un botón), la primera tecla lo trae de
 * vuelta: con la persona en fila, «primero haga clic en el campo» es un paso
 * que nadie recuerda.
 *
 * El mismo campo acepta la dirección entera del QR, el DUI o el teléfono —el
 * cliente que no trae la tarjeta—. Qué es cada cosa lo decide
 * `leerEntradaDeTarjeta` (núcleo, el mismo de la app). Un NOMBRE no se busca
 * acá: el lector no escribe nombres, y para eso está Consulta.
 *
 * Con la cámara (el teléfono del portal), `LectorDeCodigo`: la librería entra
 * por `await import()` sólo al abrirlo.
 *
 * ── Un teléfono, dos fichas ─────────────────────────────────────────────────
 * La base devuelve CANDIDATOS. Con uno se abre directo; con varios se elige —
 * mostrar «el primero» sería mostrarle a la caja los datos de otra persona.
 *
 * Abrir un expediente queda en la bitácora (`fetchExpedienteDelCliente`).
 */
import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { ScanLine, Camera, Search, Users, ChevronRight, AlertTriangle } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import SearchInput from '../../components/common/SearchInput';
import { LoadingState } from '../../components/common/StateViews';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clickable } from '@nucleo/utils/clickable';
import { buscarClientePorTarjeta, fetchExpedienteDelCliente } from '@nucleo/data/puntos';
import { leerEntradaDeTarjeta, NOMBRE_DE_ENTRADA } from '@nucleo/utils/expedienteDelCliente';
import ExpedienteDelCliente from './ExpedienteDelCliente';
import EntregarPremioEscaneado from './EntregarPremioEscaneado';
import { leerCodigoDePremio } from '@nucleo/utils/codigoDePremio';

const LectorDeCodigo = lazy(() => import('../../components/common/LectorDeCodigo'));

// ¿El foco está en algo donde se escribe? Ahí la tecla es de ese campo.
const esEditable = (el) => !!el && (el.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// Con mouse (la computadora de la caja, donde está el lector) el campo nace
// enfocado. En el teléfono no: enfocarlo abre el teclado encima de la pantalla
// y ahí se escanea con la cámara.
const conPunteroFino = () => {
    try { return window.matchMedia('(pointer: fine)').matches; } catch { return true; }
};

export default function EscanearCliente({ onVerPuntos, onVerFicha, puedeEditarFicha, miSala = null, puedeAdministrarPremios = false }) {
    const [entrada, setEntrada] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [aviso, setAviso] = useState(null);           // { variante, texto }
    const [candidatos, setCandidatos] = useState(null); // { modo, clientes } con 2+
    const [expediente, setExpediente] = useState(null);
    const [camara, setCamara] = useState(false);
    const campoRef = useRef(null);
    // Descarta la respuesta de un escaneo viejo: dos tarjetas seguidas no
    // pueden terminar mostrando la primera porque tardó más.
    const pedidoRef = useRef(0);
    // Un código de premio del raspable (2026-10-19): se entrega desde aquí mismo.
    const [premioEscaneado, setPremioEscaneado] = useState(null);
    const cerrarPremio = useCallback(() => { setPremioEscaneado(null); campoRef.current?.focus(); }, []);

    // La primera tecla con el foco fuera de un campo vuelve al lector.
    useEffect(() => {
        const alTeclear = (e) => {
            if (camara || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
            if (esEditable(document.activeElement)) return;
            // Con un diálogo abierto (el perfil de puntos, la ficha) la tecla
            // es de él.
            if (document.querySelector('[role="dialog"]')) return;
            campoRef.current?.focus();
        };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, [camara]);

    const abrir = useCallback(async (cliente, modo) => {
        const mio = ++pedidoRef.current;
        setBuscando(true);
        setCandidatos(null);
        setAviso(null);
        try {
            const exp = await fetchExpedienteDelCliente(cliente.customer_id, { como: modo, nombre: cliente.nombre });
            if (mio !== pedidoRef.current) return;
            if (!exp) setAviso({ variante: 'warning', texto: 'La ficha de ese cliente ya no existe.' });
            setExpediente(exp ?? null);
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            setAviso({ variante: 'danger', texto: mensajeAmigable(e) });
        } finally {
            if (mio === pedidoRef.current) setBuscando(false);
        }
    }, []);

    const buscar = useCallback(async (texto, { enfocar = true } = {}) => {
        const premio = leerCodigoDePremio(texto);
        if (premio) {
            setEntrada('');
            setAviso(null);
            setPremioEscaneado(premio);
            return;
        }
        const leido = leerEntradaDeTarjeta(texto);
        // El campo se vacía siempre: el próximo cliente escanea sobre limpio.
        setEntrada('');
        if (enfocar) campoRef.current?.focus();
        if (leido.tipo === 'nada') {
            if (String(texto ?? '').trim()) {
                setAviso({ variante: 'warning', texto: 'Eso no es un código de tarjeta, un DUI ni un teléfono. Para buscar por nombre, usa Consulta.' });
            }
            return;
        }
        const mio = ++pedidoRef.current;
        setBuscando(true);
        setAviso(null);
        setCandidatos(null);
        try {
            const r = await buscarClientePorTarjeta(leido.valor);
            if (mio !== pedidoRef.current) return;
            const lista = r?.clientes ?? [];
            const modo = r?.modo ?? leido.tipo;
            if (lista.length === 0) {
                setBuscando(false);
                setExpediente(null);
                setAviso({
                    variante: 'warning',
                    texto: modo === 'codigo'
                        ? 'Esa tarjeta no está registrada. Pídele al cliente su DUI o su teléfono.'
                        : `Ningún cliente con ${NOMBRE_DE_ENTRADA[modo] ?? 'ese dato'}.`,
                });
                return;
            }
            if (lista.length === 1) {
                await abrir(lista[0], modo);
                return;
            }
            setBuscando(false);
            setExpediente(null);
            setCandidatos({ modo, clientes: lista });
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            setBuscando(false);
            setAviso({ variante: 'danger', texto: mensajeAmigable(e) });
        }
    }, [abrir]);

    // Estables: `LectorDeCodigo` reinicia la cámara si cambian.
    const leerDeCamara = useCallback((codigo) => buscar(codigo, { enfocar: false }), [buscar]);
    const cerrarCamara = useCallback(() => setCamara(false), []);
    const [enfocarAlEntrar] = useState(conPunteroFino);

    const alTeclear = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            buscar(entrada);
        }
    };

    return (
        <div className="flex flex-col gap-4 min-w-0">
            <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-3 min-w-0">
                <div>
                    <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                        <ScanLine size={14} /> Escanear tarjeta
                    </h3>
                    <p className="text-caption text-content-3 mt-1">
                        Pasa la tarjeta del cliente por el lector, o escribe su código, su DUI o su teléfono.
                        Para entregar un premio del raspable, escanea el código del premio en la app del cliente.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                    <div className="flex-1 min-w-0" role="search" aria-label="Escanear la tarjeta del cliente">
                        <SearchInput ref={campoRef} value={entrada} onChange={setEntrada} onKeyDown={alTeclear}
                            placeholder="Código, DUI o teléfono" autoFocus={enfocarAlEntrar} loading={buscando} />
                    </div>
                    <div className="flex gap-2">
                        <Button variant="primary" icon={Search} onClick={() => buscar(entrada)}
                            disabled={!entrada.trim() || buscando}>
                            Buscar
                        </Button>
                        <Button variant="secondary" icon={Camera} onClick={() => setCamara(true)}>
                            Cámara
                        </Button>
                    </div>
                </div>
            </section>

            {aviso && (
                <Notice variant={aviso.variante} icon={AlertTriangle} bloque>{aviso.texto}</Notice>
            )}

            {candidatos && (
                <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-2 min-w-0">
                    <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                        <Users size={14} /> {candidatos.clientes.length} clientes con {NOMBRE_DE_ENTRADA[candidatos.modo] ?? 'ese dato'}
                    </h3>
                    <p className="text-caption text-content-3">Pregúntale su nombre y elige el suyo.</p>
                    <div className="flex flex-col divide-y divide-divider">
                        {candidatos.clientes.map((c) => (
                            <div key={c.customer_id}
                                {...clickable(() => abrir(c, candidatos.modo), { label: `Abrir a ${c.nombre}` })}
                                className="flex items-center gap-3 py-2.5 min-h-[var(--tap-min)] rounded-btn cursor-pointer active:scale-[0.99] transition-transform">
                                <div className="min-w-0 flex-1">
                                    <p className="text-body-sm font-bold text-content truncate">{c.nombre || 'Sin nombre'}</p>
                                    <p className="text-caption text-content-3 tabular-nums truncate">
                                        {[c.dui, c.telefono].filter(Boolean).join(' · ') || 'Sin documento'}
                                    </p>
                                </div>
                                <ChevronRight size={16} className="text-content-3 shrink-0" />
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {buscando && !expediente && <LoadingState label="Buscando al cliente…" />}

            {expediente && (
                <ExpedienteDelCliente exp={expediente} puedeEditarFicha={puedeEditarFicha}
                    onVerPuntos={(c) => onVerPuntos?.(c.id)}
                    onVerFicha={(c) => onVerFicha?.(c)} />
            )}

            {premioEscaneado && (
                <EntregarPremioEscaneado codigo={premioEscaneado} miSala={miSala}
                    puedeAdministrar={puedeAdministrarPremios} onCerrar={cerrarPremio} />
            )}

            {camara && (
                <Suspense fallback={null}>
                    <LectorDeCodigo abierto={camara} titulo="Escanear tarjeta del cliente"
                        onCerrar={cerrarCamara} onLeer={leerDeCamara} />
                </Suspense>
            )}
        </div>
    );
}
