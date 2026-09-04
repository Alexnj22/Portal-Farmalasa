import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import IdentidadDeQuienRetira from './IdentidadDeQuienRetira';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import { entregarBolsas } from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useToastStore } from '../../store/toastStore';
import { saldoDeBolsa } from '../../utils/bolsasReparto';

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
 * Desde el 2026-08-19 el bloque entero es `IdentidadDeQuienRetira`: la salida de
 * una bolsa pide lo mismo («así debe salir en todos los que lo requiera») y dos
 * copias del mismo panel dejan de verse igual en cuanto una se toca.
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

/* ── El día SIEMPRE dice su fecha ───────────────────────────────────────────
 *
 * «que salga siempre la fecha, no ayer» (usuario, 2026-08-26). El motivo largo
 * está en `CircuitoDeBolsas`, junto al mismo par de funciones: quien entrega el
 * efectivo tiene el sobre en la mano y el sobre dice una fecha, así que «Ayer»
 * obliga a una resta mental — y deja de ser cierto solo, sin que nada falle,
 * apenas la pantalla cruza la medianoche abierta.
 *
 * Las dos pantallas del circuito lo dicen igual a propósito: dos formas de
 * nombrar el mismo día obligan a traducir entre una y otra. */
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const fechaDelDia = (fecha) => new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
});
const esHoy = (fecha) => fecha === hoySV();
const rotularDia = (fecha) => (esHoy(fecha) ? 'Hoy' : fechaDelDia(fecha));
const subrotuloDia = (fecha) => (esHoy(fecha) ? fechaDelDia(fecha) : null);

export default function EntregaDeBolsas({
    abierto, bolsas, saldoDe, nombreSala, verMontos = false, onClose, onHecho,
}) {
    const showToast = useToastStore((s) => s.showToast);

    const [dias, setDias] = useState(() => new Set());
    // Quién se lo lleva y su vale: los DOS salen del servidor —del carné o del
    // usuario probado—, nunca de un control de la pantalla.
    const [persona, setPersona] = useState(null);
    const [vale, setVale] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    const alIdentificar = useCallback(({ persona: p, vale: v }) => {
        setPersona(p);
        setVale(v);
    }, []);

    /** Vuelve a la espera de identidad: el vale de antes ya no sirve para nada. */
    const olvidarLaIdentidad = useCallback(() => {
        setPersona(null);
        setVale(null);
    }, []);

    // Al cerrar se olvida TODO, y el vale el primero: es un permiso de un solo
    // uso que vive 5 minutos. Lo tecleado dentro del bloque de identidad lo
    // olvida el propio bloque cuando se apaga.
    useEffect(() => {
        if (abierto) return;
        setDias(new Set());
        setPersona(null);
        setVale(null);
        setError(null);
    }, [abierto]);

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
                total: lista.reduce((a, b) => a + (saldoDe ? saldoDe(b) : saldoDeBolsa(b)), 0),
            }))
            .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    }, [bolsas, saldoDe]);

    // Preseleccionar TODOS los días al abrir: entregar todo lo que hay es el
    // caso normal, y desmarcar es más rápido que marcar de a uno.
    useEffect(() => {
        if (!abierto) return;
        setDias(new Set(porDia.map((d) => d.fecha)));
        // Acá se bajaba el motor de impresión: la entrega terminaba imprimiendo
        // un comprobante. Se quitó el 2026-08-24 —«ya queda registrado»—, así
        // que entregar ya no toca la ticketera ni depende de tener una.
        // Sólo al abrir: si siguiera a `porDia`, recargar la lista de fondo
        // volvería a marcar los días que la persona acaba de desmarcar.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto]);

    const elegidas = useMemo(
        () => porDia.filter((d) => dias.has(d.fecha)).flatMap((d) => d.lista),
        [porDia, dias],
    );
    const total = useMemo(
        () => elegidas.reduce((a, b) => a + (saldoDe ? saldoDe(b) : saldoDeBolsa(b)), 0),
        [elegidas, saldoDe],
    );

    const alternarDia = useCallback((fecha) => setDias((prev) => {
        const s = new Set(prev);
        if (s.has(fecha)) s.delete(fecha); else s.add(fecha);
        return s;
    }), []);

    const falta = useMemo(() => {
        if (!elegidas.length) return 'Falta elegir qué días se lleva.';
        if (!persona || !vale) return 'Falta identificar a quien se lo lleva.';
        return null;
    }, [elegidas, persona, vale]);

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
                                    aria-label={`Entregar las bolsas del ${fechaDelDia(d.fecha)}`}
                                />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline justify-between gap-2">
                                    <span className="min-w-0 capitalize">
                                        <span className="text-label font-bold text-content">
                                            {rotularDia(d.fecha)}
                                        </span>
                                        {subrotuloDia(d.fecha) && (
                                            <span className="text-caption text-content-3">
                                                {' '}· {subrotuloDia(d.fecha)}
                                            </span>
                                        )}
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
                    del usuario. Debajo, la escotilla para el carné que no lee.

                    El lector se enciende sólo con el diálogo abierto: es un
                    `keydown` global y no debe existir mientras no se esté
                    pidiendo un carné. Acá no hay ningún campo de texto que la
                    ráfaga pueda ensuciar, que es lo que sí pasa en la salida de
                    una bolsa — ver el encabezado de `IdentidadDeQuienRetira`. */}
                {porDia.length > 0 && (
                    <IdentidadDeQuienRetira
                        activo={!!abierto && !guardando}
                        persona={persona}
                        onIdentificada={alIdentificar}
                        onOlvidar={olvidarLaIdentidad}
                        bloqueado={guardando}
                    />
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
