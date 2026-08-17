import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, KeyRound, ScanLine, Send, UserCircle2 } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import EsperaDeCarne from '../common/EsperaDeCarne';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import { entregarBolsas, identificarPorCarne, identificarPorUsuario } from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import useCapturaDeCarne from '../../hooks/useCapturaDeCarne';
import { useToastStore } from '../../store/toastStore';

/**
 * Entregar el efectivo de la sala a quien lo recolecta.
 *
 * Es el paso que el usuario describió así (2026-08-16): «el dependiente de la
 * sala abre el módulo, marca entregar dinero, selecciona los días, y confirma;
 * al confirmar pide que se escanee el carné (o poner usuario y contraseña) y
 * queda registrado quién lo recibió».
 *
 * ── Se elige por DÍA, no bolsa por bolsa ───────────────────────────────────
 * Una sala junta dos o tres bolsas por día y entrega cada tres días, así que lo
 * que la persona tiene delante son «los días que se lleva», no ocho folios
 * sueltos. Cada día se marca entero; el detalle queda visible debajo para poder
 * cotejarlo contra las bolsas físicas antes de firmar.
 *
 * ── El carné dice QUIÉN es: no hay lista de personas ───────────────────────
 * Corregido el 2026-08-17, mirando la pantalla: «¿por qué pregunta quién se
 * lleva el efectivo y sale el select? solo debe haber el selector de días (como
 * ya está) y la pantalla activa de espera de escanear, así como apoyo».
 *
 * Tenía razón, y no es sólo un paso de más: elegir un nombre y DESPUÉS pedirle
 * el carné son dos formas de contestar la misma pregunta, y la lista obligaba a
 * publicarle a la sala la nómina entera —quien recolecta suele ser de
 * administración— para que eligiera a alguien que el carné iba a identificar de
 * todos modos. Hoy se escanea y listo: `probar_identidad_por_carne` resuelve a
 * la persona y emite el vale en la misma llamada.
 *
 * El lector es el camino normal, y ahí sólo vale el escaneo —como en el apoyo de
 * un pedido—: un código tecleado lo escribe cualquiera que lo sepa, y lo que
 * esto registra es que alguien ESTUVO acá con su carné. El detector vive en
 * `hooks/useCapturaDeCarne` y el panel en `components/common/EsperaDeCarne` —
 * los mismos que usa el apoyo, para que se vean y se comporten igual.
 *
 * ── «Autenticar por usuario» es la escotilla, no la lista de vuelta ────────
 * La pidió el usuario el 2026-08-17 al ver la pantalla sólo-escaneo. Un lector
 * sucio o un carné despegado dejarían a la sala sin poder entregar el efectivo
 * del día, y la única salida sería el papel a mano — justo lo que esto vino a
 * reemplazar. Sigue sin haber desplegable de personas: **el usuario ES el
 * nombre** de quien se identifica, igual que el carné, y la contraseña lo
 * prueba. Elegir un nombre de una lista nunca probó nada.
 *
 * Mientras el formulario está abierto, la captura del lector se APAGA: es un
 * `keydown` global y una ráfaga con el foco puesto en «usuario» escribiría el
 * carné, a la vista, dentro de un campo de texto. Es el mismo defecto que se
 * corrigió en el login (v2.638.0).
 *
 * ── Los montos NO se muestran acá ──────────────────────────────────────────
 * «no pongas el total de dinero, solo las bolsas. los totales de dinero no los
 * deben ver los dependientes, solo quien tenga permisos». `verMontos` es
 * `bolsas_ver_montos`, el mismo canon que `facturacion_ver_montos`. Lo que la
 * sala entrega son bolsas cerradas y etiquetadas: para cotejarlas contra lo
 * físico alcanzan el folio y el día.
 *
 * ── Por qué la identidad va acá y no en la remesa ──────────────────────────
 * Éste es el momento de mayor riesgo del circuito: el efectivo sale de la sala y
 * todavía no llegó a administración — no está ni de un lado ni del otro. Sacar
 * una remesa, en cambio, no la pide: quien recibe es el cliente y lo identifica
 * la boleta del POS. Esa diferencia vive en el catálogo
 * (`bolsas_tipos_salida.pide_receptor`), no en un `if` escrito acá.
 */

const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const correrDia = (fecha, dias) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};
const rotularDia = (fecha) => {
    const hoy = hoySV();
    if (fecha === hoy) return 'Hoy';
    if (fecha === correrDia(hoy, -1)) return 'Ayer';
    return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
};

export default function EntregaDeBolsas({
    abierto, bolsas, saldoDe, nombreSala, verMontos = false, onClose, onHecho,
}) {
    const showToast = useToastStore((s) => s.showToast);

    const [dias, setDias] = useState(() => new Set());
    // Quién se lo lleva y su vale: los DOS salen del servidor —del carné o del
    // usuario probado—, nunca de un control de la pantalla.
    const [persona, setPersona] = useState(null);
    const [vale, setVale] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    // 'CARNE' es el camino normal; 'CLAVE' es la escotilla.
    const [metodo, setMetodo] = useState('CARNE');
    const [usuario, setUsuario] = useState('');
    const [clave, setClave] = useState('');

    /** Lo que devuelven las dos comprobaciones se trata igual. */
    const recibirIdentidad = useCallback((r, siFalla) => {
        if (r.error) { setError(mensajeAmigable(r.error, siFalla)); return; }
        if (r.motivo) { setError(r.motivo); return; }
        setPersona(r.persona);
        setVale(r.vale);
        // El secreto se olvida apenas se manda, salga bien o mal.
        setClave('');
    }, []);

    const alEscanear = useCallback(async (codigo) => {
        setLeyendo(true);
        setError(null);
        try {
            recibirIdentidad(await identificarPorCarne(codigo), 'No se pudo confirmar el carné.');
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo confirmar el carné.'));
        } finally {
            setLeyendo(false);
        }
    }, [recibirIdentidad]);

    const alAutenticar = useCallback(async () => {
        if (!usuario.trim() || !clave || leyendo) return;
        setLeyendo(true);
        setError(null);
        try {
            recibirIdentidad(
                await identificarPorUsuario(usuario, clave),
                'No se pudo confirmar la identidad.',
            );
        } catch (e) {
            setClave('');
            setError(mensajeAmigable(e, 'No se pudo confirmar la identidad.'));
        } finally {
            setLeyendo(false);
        }
    }, [usuario, clave, leyendo, recibirIdentidad]);

    // La captura del lector se apaga con el formulario abierto — ver el
    // encabezado: una ráfaga con el foco en «usuario» publicaría el carné.
    const { teclas, manual, limpiar } = useCapturaDeCarne(
        !!abierto && !guardando && metodo === 'CARNE', alEscanear,
    );

    /** Vuelve a la espera de identidad: el vale de antes ya no sirve para nada. */
    const olvidarLaIdentidad = useCallback(() => {
        setPersona(null);
        setVale(null);
        setClave('');
        limpiar();
    }, [limpiar]);

    const cambiarMetodo = useCallback((v) => {
        setMetodo(v);
        setError(null);
        setClave('');
        limpiar();
    }, [limpiar]);

    // Al cerrar se olvida TODO, y el secreto y el vale los primeros: uno es una
    // contraseña ajena y el otro un permiso de un solo uso que vive 5 minutos.
    useEffect(() => {
        if (abierto) return;
        setDias(new Set());
        setPersona(null);
        setVale(null);
        setError(null);
        setMetodo('CARNE');
        setUsuario('');
        setClave('');
        limpiar();
    }, [abierto, limpiar]);

    // Los días con bolsas en la sala, del más viejo al más nuevo: lo que lleva
    // más tiempo esperando es lo que primero hay que sacar.
    const porDia = useMemo(() => {
        const m = new Map();
        for (const b of bolsas || []) {
            if (!m.has(b.fecha)) m.set(b.fecha, []);
            m.get(b.fecha).push(b);
        }
        return [...m.entries()]
            .map(([fecha, lista]) => ({
                fecha,
                lista: [...lista].sort((a, b) => String(a.hora).localeCompare(String(b.hora))),
                total: lista.reduce((a, b) => a + Number(saldoDe?.(b) ?? b.monto_inicial ?? 0), 0),
            }))
            .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    }, [bolsas, saldoDe]);

    // Preseleccionar TODOS los días al abrir: entregar todo lo que hay es el
    // caso normal, y desmarcar es más rápido que marcar de a uno.
    useEffect(() => {
        if (!abierto) return;
        setDias(new Set(porDia.map((d) => d.fecha)));
        // El motor de impresión se baja al ABRIR, no después de firmar la
        // entrega: es un `import()` y tras un despliegue el chunk viejo ya no
        // está, así que falla y el portal se recarga — con la entrega ya
        // escrita y sin comprobante. Ver el mismo comentario en `SalidaDeBolsa`.
        import('../../utils/ticketPrint').catch(() => {});
        import('../../utils/bolsaComprobante').catch(() => {});
        // Sólo al abrir: si siguiera a `porDia`, recargar la lista de fondo
        // volvería a marcar los días que la persona acaba de desmarcar.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto]);

    const elegidas = useMemo(
        () => porDia.filter((d) => dias.has(d.fecha)).flatMap((d) => d.lista),
        [porDia, dias],
    );
    const total = useMemo(
        () => elegidas.reduce((a, b) => a + Number(saldoDe?.(b) ?? b.monto_inicial ?? 0), 0),
        [elegidas, saldoDe],
    );

    const alternarDia = useCallback((fecha) => setDias((prev) => {
        const s = new Set(prev);
        if (s.has(fecha)) s.delete(fecha); else s.add(fecha);
        return s;
    }), []);

    const falta = useMemo(() => {
        if (!elegidas.length) return 'Falta elegir qué días se lleva.';
        if (!persona || !vale) {
            return metodo === 'CARNE'
                ? 'Falta escanear el carné de quien se lo lleva.'
                : 'Falta el usuario y la contraseña de quien se lo lleva.';
        }
        return null;
    }, [elegidas, persona, vale, metodo]);

    const confirmar = useCallback(async () => {
        if (falta || guardando) return;
        setGuardando(true);
        setError(null);
        try {
            const { data: entrega, error: err } = await entregarBolsas(
                elegidas.map((b) => b.id), persona.id, vale,
            );
            if (err) {
                // El vale se gasta en el servidor y vive 5 minutos: si algo
                // falló, el que había ya no vale y hay que volver a escanear.
                olvidarLaIdentidad();
                setError(mensajeAmigable(err, 'Vuelve a escanear el carné.'));
                return;
            }

            showToast?.('Efectivo entregado',
                `${entrega.folio} · ${elegidas.length} ${elegidas.length === 1 ? 'bolsa' : 'bolsas'}`,
                'success');
            onHecho?.(entrega, elegidas);
            onClose?.();
        } catch (e) {
            olvidarLaIdentidad();
            setError(mensajeAmigable(e, 'No se pudo entregar.'));
        } finally {
            setGuardando(false);
        }
    }, [falta, guardando, elegidas, persona, vale, olvidarLaIdentidad, showToast, onHecho, onClose]);

    return (
        <LiquidModal open={!!abierto} onClose={guardando ? undefined : onClose}
            maxWidth="max-w-lg" className="h-fit" ariaLabel="Entregar el efectivo">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Entregar el efectivo</h3>
                    <p className="text-caption text-content-3">
                        {nombreSala ? `${nombreSala} · ` : ''}
                        {porDia.length
                            ? `${porDia.length} ${porDia.length === 1 ? 'día' : 'días'} en la sala`
                            : 'No hay bolsas en la sala'}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {!porDia.length && (
                    <Notice variant="info" icon={AlertTriangle}>
                        <span className="font-bold">No hay nada que entregar</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Las bolsas nacen al confirmar un corte.
                        </span>
                    </Notice>
                )}

                {porDia.map((d) => (
                    <div key={d.fecha} data-surface="card" className="p-3">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <span className="mt-0.5 shrink-0">
                                <Checkbox
                                    size="sm"
                                    checked={dias.has(d.fecha)}
                                    onChange={() => alternarDia(d.fecha)}
                                    aria-label={`Entregar las bolsas del ${rotularDia(d.fecha)}`}
                                />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline justify-between gap-2">
                                    <span className="text-label font-bold text-content capitalize">
                                        {rotularDia(d.fecha)}
                                    </span>
                                    {/* La cifra sólo para quien tiene el permiso.
                                        Lo que la sala coteja contra lo físico es
                                        el folio pegado a cada bolsa. */}
                                    <span className="text-label font-bold tabular-nums text-content shrink-0">
                                        {verMontos
                                            ? formatMoney(d.total)
                                            : `${d.lista.length} ${d.lista.length === 1 ? 'bolsa' : 'bolsas'}`}
                                    </span>
                                </span>
                                <span className="block text-caption text-content-3 mt-0.5">
                                    {verMontos && `${d.lista.length} ${d.lista.length === 1 ? 'bolsa' : 'bolsas'} · `}
                                    {d.lista.map((b) => b.folio).join(', ')}
                                </span>
                            </span>
                        </label>
                    </div>
                ))}

                {/* ── Quién se lo lleva: lo contesta el carné ────────────────
                    Mientras no hay nadie reconocido, la pantalla ESPERA el
                    escaneo. Es el mismo panel del apoyo de un pedido, a pedido
                    del usuario. Debajo, la escotilla para el carné que no lee. */}
                {porDia.length > 0 && !persona && (
                    <div data-surface="card" className="p-3 space-y-3">
                        {metodo === 'CARNE' ? (
                            <EsperaDeCarne
                                teclas={teclas} manual={manual} ocupado={leyendo}
                                ayuda={<>Pasa por el lector el carné<br />de quien se lleva el efectivo</>}
                            />
                        ) : (
                            <>
                                <p className="text-body-sm text-content-2 text-center">
                                    El usuario y la contraseña de quien se lleva el efectivo
                                </p>
                                <PortalInput
                                    label="Usuario" name="usuario-recibe"
                                    value={usuario} onChange={(e) => setUsuario(e.target.value)}
                                    placeholder="Su usuario del portal"
                                    autoComplete="off"
                                />
                                <PortalInput
                                    label="Contraseña" name="clave-recibe" type="password"
                                    value={clave} onChange={(e) => setClave(e.target.value)}
                                    placeholder="••••••••"
                                    autoComplete="off"
                                    onKeyDown={(e) => { if (e.key === 'Enter') alAutenticar(); }}
                                />
                                <Button variant="primary" size="sm" icon={KeyRound} className="w-full"
                                    loading={leyendo}
                                    disabled={!usuario.trim() || !clave}
                                    onClick={alAutenticar}>
                                    Comprobar
                                </Button>
                            </>
                        )}

                        {/* El lector es el camino normal, así que la escotilla es
                            secundaria y dice a dónde lleva. */}
                        <Button variant="ghost" size="sm" className="w-full"
                            icon={metodo === 'CARNE' ? KeyRound : ScanLine}
                            onClick={() => cambiarMetodo(metodo === 'CARNE' ? 'CLAVE' : 'CARNE')}>
                            {metodo === 'CARNE' ? 'Autenticar por usuario' : 'Volver al lector de carné'}
                        </Button>
                    </div>
                )}

                {persona && (
                    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-success/10 border border-success/30
                        animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-base)]">
                        {persona.photo_url
                            ? <img src={persona.photo_url} alt=""
                                className="w-12 h-12 rounded-full object-cover border-2 border-border-card shadow" />
                            : (
                                <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center shrink-0">
                                    <UserCircle2 size={24} className="text-success" />
                                </div>
                            )}
                        <div className="min-w-0 flex-1">
                            <p className="font-bold text-success-text text-body-lg truncate">{persona.name}</p>
                            <p className="text-label text-success-text mt-0.5">Se lleva el efectivo</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={olvidarLaIdentidad} disabled={guardando}>
                            No es
                        </Button>
                    </div>
                )}

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex items-center justify-between gap-3 w-full flex-wrap">
                    <span className="text-caption text-content-3 min-w-0 truncate">
                        {falta || 'Se imprime el comprobante que firman los dos'}
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                        <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                        <Button variant="primary" icon={Send} loading={guardando}
                            disabled={!!falta} onClick={confirmar}>
                            Entregar {elegidas.length
                                ? (verMontos
                                    ? `${elegidas.length} · ${formatMoney(total)}`
                                    : `${elegidas.length} ${elegidas.length === 1 ? 'bolsa' : 'bolsas'}`)
                                : ''}
                        </Button>
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
