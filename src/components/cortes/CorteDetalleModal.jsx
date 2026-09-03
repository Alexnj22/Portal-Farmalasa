import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, RotateCcw, ShieldCheck } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import AvatarConEstado from '../common/AvatarConEstado';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalTextarea from '../common/PortalTextarea';
import SegmentedControl from '../common/SegmentedControl';
import ResolverDiferencia from './ResolverDiferencia';
import useSobreviveAlCierre from '../../hooks/useSobreviveAlCierre';
import {
    fetchAbonosDelDia, fetchDiferencias, fetchMovimientos, fetchPersonas, fetchVentasPorPago,
    reabrirCorte,
} from '../../data/cortes';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useToastStore } from '../../store/toastStore';
import {
    cobrosDeCredito, desgloseDelCierre, entroEnEfectivo, formasFueraDelComprobante, noContoEfectivo,
    notaDeCifra, severidad, sugerenciasDeCorte,
} from '../../utils/cortesDiagnostico';
import { formatMoney } from '../../utils/formatNumber';
import { useAuth } from '../../context/AuthContext';
import useResolverCorte from '../../hooks/useResolverCorte';

/**
 * El detalle de un corte de caja, y el único sitio donde se confirma o descarta.
 *
 * Vive fuera de la vista porque lo abren DOS pantallas —el módulo y la baldosa
 * del Inicio— y es donde se muestra la información con la que alguien decide si
 * a una sala le faltó dinero. Dos copias de esta pantalla significan dos
 * explicaciones distintas del mismo corte, que es exactamente lo que hay que
 * evitar cuando el resultado es señalar a una persona.
 *
 * Y es la «alerta con información» que pidió el usuario (2026-08-14): un corte
 * CON diferencia no se confirma ni se descarta a ciegas desde una lista. Quien
 * decide ve primero cuánto es, de dónde sale la cifra, qué revisar, y recién
 * después firma. Los que cuadran al centavo sí se confirman de un clic — no hay
 * nada que leer.
 *
 * ── Props ──────────────────────────────────────────────────────────────────
 *   corte        el corte YA pasado por `conTramoPorSalaYDia` (necesita `tramo`)
 *   nombreSala   mapa branch_id → nombre
 *   modoInicial  'confirmar' | 'descartar' | null — con cuál abre
 *   onResuelto   se llama después de guardar, para que el llamador recargue
 *   origen       queda en la bitácora: de qué pantalla salió la decisión
 */

const MOTIVOS = ['Conteo de prueba', 'Se contó mal', 'Corte repetido'];

// El motivo del descarte de un corte SIN CONTEO no se elige: ya se sabe cuál
// es. Ofrecerle «Se contó mal» a un corte donde no se contó nada invita a
// escribir en la bitácora algo que no pasó.
const MOTIVO_SIN_CONTEO = 'No se contó el efectivo';

// Por qué se reabre una firma. Salen de los casos reales del 13 y 14 de agosto:
// un corte confirmado sobre un conteo malo (Salud 1, −$621.17), uno que había
// que descartar porque la sala lo rehizo, y la diferencia que después apareció.
const MOTIVOS_REABRIR = ['Se firmó por error', 'El corte se rehizo', 'Apareció la causa'];

const TONO_TEXTO = { ok: 'text-success-text', sobra: 'text-warning-text', falta: 'text-danger-text' };

const hhmm = (hora) => String(hora || '').slice(0, 5);

const conSigno = (n) => (n > 0 ? `+${formatMoney(n)}` : formatMoney(n));

// Se capitaliza acá y NO con `capitalize` de CSS: la clase toca cada palabra,
// así que «jueves, 13 de agosto» salía «Jueves, 13 De Agosto» — y en el mismo
// renglón viven el nombre de la sala y el de la persona, que tienen sus propias
// mayúsculas.
const fechaLarga = (fecha) => {
    if (!fecha) return '';
    const t = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
    return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Cuándo se firmó la decisión, en hora de la sala. */
const selloDeTiempo = (iso) => (iso
    ? new Date(iso).toLocaleString('es-SV', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        hour12: true, timeZone: 'America/El_Salvador',
    })
    : '');

// Las iniciales de respaldo las resuelve `AvatarConEstado` con
// `shortEmployeeName`, el mismo respaldo del resto del portal.

export default function CorteDetalleModal({
    corte,
    nombreSala = {},
    modoInicial = null,
    onClose,
    onResuelto,
    origen = 'modulo',
}) {
    const { hasPermission } = useAuth();
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');
    // La escritura es la misma que la del módulo, el Inicio y la campana.
    const { resolver, ocupadoId, dialogoDeEntrega } = useResolverCorte({ nombreSala, origen });

    // Lo que se PINTA sobrevive al cierre: el panel sigue montado ~240ms
    // haciendo su salida, y leer `corte` directo lo vaciaría en el primer frame.
    const visible = useSobreviveAlCierre(corte);

    const showToast = useToastStore((s) => s.showToast);
    const [movs, setMovs] = useState([]);
    const [personas, setPersonas] = useState(() => new Map());
    const [modo, setModo] = useState(modoInicial);
    const [motivo, setMotivo] = useState(MOTIVOS[0]);
    const [nota, setNota] = useState('');
    const [diferencia, setDiferencia] = useState(null);
    const [recarga, setRecarga] = useState(0);
    const [reabriendo, setReabriendo] = useState(false);
    const [ventas, setVentas] = useState(null);
    // `null` mientras no se pidió; después `{ filas, pude }`. Los tres estados
    // son distintos y la pantalla los dice distinto: sin pedir, sin permiso, y
    // sin cobros ese día.
    const [abonos, setAbonos] = useState(null);

    const abierto = !!corte;
    const corteId = corte?.id ?? null;
    const branchId = corte?.branch_id ?? null;
    const fecha = corte?.fecha ?? null;
    const resueltoPor = corte?.resuelto_por ?? null;

    // Al abrir OTRO corte —o el mismo con otro botón— se reinicia el
    // formulario. El ajuste va en RENDER y no en un efecto: es el patrón que
    // React documenta para «reaccionar a un cambio de prop», y el proyecto
    // prohíbe `setState` dentro de `useEffect`. La clave lleva el id y NO el
    // objeto: la lista se recarga sola y reconstruye las filas, así que
    // comparar identidades borraría lo escrito en cada refresco.
    const claveForm = abierto ? `${corteId}|${modoInicial ?? ''}` : null;
    const [clavePrevia, setClavePrevia] = useState(claveForm);
    if (claveForm && claveForm !== clavePrevia) {
        setClavePrevia(claveForm);
        setModo(modoInicial);
        setMotivo(MOTIVOS[0]);
        setNota('');
        setMovs([]);
        setDiferencia(null);
        setVentas(null);
        setAbonos(null);
    }

    // Cómo se resolvió su diferencia, si ya se resolvió. Se pide por fecha
    // porque el RPC devuelve el rango con las personas anidadas — un corte
    // suelto no tiene endpoint propio y no vale la pena inventarlo para una
    // fila. `recarga` la vuelve a pedir después de resolver o anular.
    useEffect(() => {
        if (!abierto || !corteId || !fecha) return;
        let vivo = true;
        fetchDiferencias({ desde: fecha, hasta: fecha }).then((filas) => {
            if (!vivo) return;
            setDiferencia((filas || []).find((d) => d.corte_id === corteId && !d.anulada_at) || null);
        });
        return () => { vivo = false; };
    }, [abierto, corteId, fecha, recarga]);

    // La venta por forma de pago. Hace falta para TODO corte, no sólo para el
    // cierre: el comprobante no imprime transferencias ni cheques, así que es la
    // única pista de un sobrante que no se puede encontrar mirando el papel. Son
    // ~4 filas agrupadas por sala y día, no las facturas.
    useEffect(() => {
        if (!abierto || branchId == null || !fecha) return;
        let vivo = true;
        fetchVentasPorPago({ desde: fecha, hasta: fecha }).then((filas) => {
            if (vivo) setVentas((filas || []).filter((v) => String(v.branch_id) === String(branchId)));
        });
        return () => { vivo = false; };
    }, [abierto, branchId, fecha]);

    // Los movimientos del día: sólo hacen falta para explicar una diferencia,
    // así que se piden al abrir un corte y no junto con la lista.
    useEffect(() => {
        if (!abierto || branchId == null || !fecha) return;
        let vivo = true;
        fetchMovimientos({ branchId, fecha }).then((data) => { if (vivo) setMovs(data || []); });
        return () => { vivo = false; };
    }, [abierto, branchId, fecha]);

    // Los cobros de crédito del día, con su hora. Es lo que permite decir a QUÉ
    // corte pertenece cada uno en vez de suponerlo — la suposición es lo que
    // marcó +$66.01 de sobrante inexistente en Salud 3 el 1-sep.
    useEffect(() => {
        if (!abierto || branchId == null || !fecha) return;
        let vivo = true;
        fetchAbonosDelDia({ branchId, fecha }).then((r) => { if (vivo) setAbonos(r); });
        return () => { vivo = false; };
    }, [abierto, branchId, fecha]);

    // Quién firmó la decisión. Se pide por corte porque el nombre y la foto
    // tienen que verse SIEMPRE que haya una decisión, y el listado de personal
    // no está cargado para quien sólo tiene el módulo de cortes. Se guarda en
    // un mapa —y no en «la persona actual»— para no tener que blanquearla con
    // un `setState` en el efecto cuando el corte no tiene autor.
    useEffect(() => {
        if (!abierto || !resueltoPor) return;
        let vivo = true;
        fetchPersonas([resueltoPor]).then((filas) => {
            if (vivo && filas[0]) setPersonas((prev) => new Map(prev).set(resueltoPor, filas[0]));
        });
        return () => { vivo = false; };
    }, [abierto, resueltoPor]);

    // Sale de `visible`, no de `corte`: al cerrar, `corte` pasa a nulo en el
    // mismo tick y la cara desaparecería antes que el panel.
    const persona = visible?.resuelto_por ? personas.get(visible.resuelto_por) || null : null;

    const tope = useRef(null);
    useEffect(() => {
        if (modo) tope.current?.scrollIntoView({ block: 'start' });
    }, [modo]);

    // Las formas que el comprobante no nombra: transferencia, cheque, bitcoin.
    const invisibles = useMemo(() => formasFueraDelComprobante(ventas), [ventas]);

    // Antes de `sugerencias`, que lo usa: leerlo después de su `const` lanza en
    // cada render y el aviso llega minificado (`gate:tdz`).
    const cobros = useMemo(
        () => (visible ? cobrosDeCredito(visible, abonos?.filas || []) : null),
        [visible, abonos],
    );

    const sugerencias = useMemo(
        () => (visible ? sugerenciasDeCorte(visible, movs, invisibles, cobros) : []),
        [visible, movs, invisibles, cobros],
    );
    const explicacion = useMemo(() => (visible ? notaDeCifra(visible) : null), [visible]);

    // No hay un segundo aviso de «revisa las cifras»: `notaDeCifra` ya devuelve
    // el suyo —en tono `danger`— exactamente en el mismo caso (las dos cuentas
    // en disputa y no por los cobros de crédito). Eran dos avisos con el mismo
    // texto en la misma pantalla, uno arriba y otro al fondo.
    const sev = severidad(visible?.tramo);
    const esZ = visible?.tipo === 'Z';
    /* Una LECTURA (tipo X) no contó efectivo: no tiene esperado ni diferencia,
     * así que no hay nada que firmar ni que reabrir. Aparece desde el 31-ago —
     * ver la nota de `TarjetaCorte`, donde vive el porqué completo.
     *
     * `noEsConteo` y no `esZ` en las tres decisiones: lo que las gobierna es
     * «esto contó dinero», que era lo mismo mientras sólo hubiera dos tipos. */
    const esX = visible?.tipo === 'X';
    /* Y uno tipo C que salió con el efectivo en cero tampoco contó — ver
     * `noContoEfectivo`. */
    const sinConteo = noContoEfectivo(visible);
    /* ── «No contó» y «no hay nada que decidir» NO son lo mismo ────────────
     * El cierre del día y la lectura no admiten NINGUNA decisión. Un corte sin
     * conteo admite exactamente UNA —descartarlo— y hay que tomarla: mientras
     * siga pendiente la sala no cierra el día.
     *
     * Estaban juntos en un solo `noEsConteo` y por eso Salud 4 quedó trabada el
     * 2-sep: este mismo modal decía «lo que corresponde es descartarlo» con el
     * pie sin un solo botón. El texto y los botones se leen en la misma
     * pantalla; que se contradigan no lo caza ningún gate. */
    const sinDecision = esZ || esX;
    const noEsConteo = sinDecision || sinConteo;
    // El desglose del cierre: su monto es venta, no efectivo. Ver el bloque de
    // `desgloseDelCierre`, que es donde vive el porqué.
    const cierre = useMemo(() => desgloseDelCierre(visible, ventas), [visible, ventas]);
    const pendiente = visible?.estado === 'PENDIENTE';
    const puedeFirmar = pendiente && !sinDecision && puedeResolver;
    // Confirmar es lo único que el sin conteo NO puede: no hay conteo que dar
    // por bueno. Lo rechaza también `resolver_corte_caja`, que es donde manda.
    const puedeConfirmar = puedeFirmar && !sinConteo;
    // Reabrir es de la propia sala (decisión del usuario, 2026-08-14): la misma
    // gente que firma puede corregir su firma, escribiendo por qué.
    const puedeReabrir = !pendiente && !sinDecision && puedeResolver;

    const abrirReapertura = useCallback(() => {
        setMotivo(MOTIVOS_REABRIR[0]);
        setModo('reabrir');
    }, []);

    const guardar = useCallback(async () => {
        if (!corte || !modo) return;
        const estado = modo === 'confirmar' ? 'CONFIRMADO' : 'DESCARTADO';
        const ok = await resolver(corte, estado, {
            motivo: modo === 'descartar' ? (sinConteo ? MOTIVO_SIN_CONTEO : motivo) : null,
            observaciones: nota,
        });
        if (!ok) return;
        onResuelto?.(corte, estado);
        onClose?.();
    }, [corte, modo, motivo, nota, sinConteo, resolver, onResuelto, onClose]);

    /**
     * Volver a abrir una firma. El motivo es obligatorio y queda en la bitácora:
     * `resuelto_por`/`resuelto_at` guardan sólo la última decisión, así que sin
     * el registro la firma anterior desaparecería sin dejar rastro — y el caso
     * que lo hizo falta es justamente uno donde alguien firmó por error.
     */
    const reabrir = useCallback(async () => {
        if (!corte || reabriendo) return;
        setReabriendo(true);
        const { error } = await reabrirCorte(corte.id, motivo);
        setReabriendo(false);
        if (error) {
            showToast?.('No se pudo reabrir', mensajeAmigable(error, 'Vuelve a intentar.'), 'error');
            return;
        }
        showToast?.('Corte reabierto', 'Vuelve a quedar pendiente de confirmar.', 'success');
        onResuelto?.(corte, 'PENDIENTE');
        onClose?.();
    }, [corte, reabriendo, motivo, showToast, onResuelto, onClose]);

    return (
        <>
        <LiquidModal
            open={abierto}
            onClose={ocupadoId ? undefined : onClose}
            maxWidth="max-w-2xl"
            className="h-fit"
            ariaLabel={`Corte de las ${hhmm(visible?.hora)}`}
        >
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Corte de las {hhmm(visible?.hora)}</h3>
                    <p className="text-caption text-content-3 truncate">
                        {nombreSala[visible?.branch_id] || (visible ? `Sucursal ${visible.branch_id}` : '')}
                        {visible?.fecha ? ` · ${fechaLarga(visible.fecha)}` : ''}
                        {/* El nombre sale de quién lo hizo en el portal. El del
                            sistema de la caja es el de la cuenta de la sala, y en
                            tres salas lleva el nombre de una persona que no cortó. */}
                        {visible?.hizo?.name ? ` · ${visible.hizo.name}` : ''}
                        {/* Y quién recibió la caja: confirmar el corte cierra el
                            turno, así que son los dos nombres del mismo acto. */}
                        {visible?.recibe?.name ? ` → ${visible.recibe.name}` : ''}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {visible && (
                    <>
                        {/* Al pasar a firmar, el cuerpo vuelve arriba. Sin esto,
                            quien venía leyendo «Qué revisar» y aprieta el botón
                            del pie se queda mirando la mitad de la pantalla:
                            aparece el formulario arriba y él no lo ve. */}
                        <span ref={tope} aria-hidden="true" className="block h-0" />

                        {/* ── El cierre del día NO es un conteo de caja ────────
                            Su monto es todo lo VENDIDO, con la tarjeta y el
                            crédito adentro. Mostrarlo con los rótulos del corte
                            de caja —«Debía haber en caja», «Se contó»— decía
                            algo falso: en La Popular del 13-ago afirmaba que se
                            contaron $1,678.83 cuando en la caja hubo $1,602.88.
                            Lo levantó el usuario mirando la pantalla, que es la
                            única forma de ver un rótulo que miente sobre un
                            número correcto.

                            Y el corte de caja va SIN `data-tono`: el marco de
                            color repetía lo que ya dice la cifra —el número está
                            en rojo o en ámbar, a cuerpo grande y arriba de
                            todo—. Con el anillo además, el bloque más importante
                            competía con los cuatro de «Qué revisar», y cuando
                            todo resalta no resalta nada. El color se reserva
                            para la cifra. */}
                        {esZ ? (
                            <div data-surface="card" className="p-4">
                                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                    <span className="text-caption text-content-2">Se vendió en el día</span>
                                    <span className="text-2xl font-bold tabular-nums text-content">
                                        {formatMoney(cierre.total)}
                                    </span>
                                </div>
                                {/* Las formas se PINTAN COMO VENGAN, no dos fijas.
                                    Con «tarjeta» y «crédito» escritos a mano, una
                                    transferencia no desaparecía de la pantalla:
                                    desaparecía DENTRO del efectivo, que es peor
                                    —el número seguía cuadrando y decía de más—.
                                    Pasó con los $2.20 de Salud 2 del 13-ago. */}
                                <div className="mt-3 space-y-1 text-caption">
                                    {cierre.formas.map((f) => (
                                        <div key={f.tipo} className="flex justify-between gap-3 text-content-3">
                                            <span className="capitalize">{f.tipo}</span>
                                            <span className="tabular-nums">{formatMoney(f.total)}</span>
                                        </div>
                                    ))}
                                    {/* El efectivo va destacado: es el único que
                                        pasó por la caja, y por lo tanto el único
                                        que los cortes del día cuentan. */}
                                    <div className="flex justify-between gap-3 pt-1.5 mt-1.5 border-t border-divider text-content font-bold">
                                        <span>Entró en efectivo</span>
                                        <span className="tabular-nums">{formatMoney(cierre.efectivo)}</span>
                                    </div>
                                </div>
                            </div>
                        ) : esX ? (
                            /* La lectura NO tiene cifra que mostrar. Su total es
                               el número que se le mandó al formulario, no un
                               dinero contado ni unas ventas, y pintarlo en el
                               lugar donde va la diferencia le daría un sentido
                               que no tiene. Se dice qué es y se acabó. */
                            <div data-surface="card" className="p-4 space-y-1">
                                <div className="text-caption font-bold text-content">Esto es una lectura, no un corte</div>
                                <p className="text-caption text-content-2">
                                    Sólo imprime las ventas del turno: no cuenta el efectivo, así que no
                                    tiene diferencia ni hay nada que confirmar. El efectivo lo cuenta el
                                    corte de caja del mismo turno.
                                </p>
                            </div>
                        ) : sinConteo ? (
                            /* Tampoco hay cifra que mostrar acá, y por un motivo
                               más caro: SÍ había una, y era falsa. El portal
                               restaba el cero contra el esperado del día y
                               anunciaba un faltante del tamaño de la caja, con
                               el botón de cobrárselo a alguien al lado. Se dice
                               qué pasó y qué hacer. */
                            <div data-surface="card" className="p-4 space-y-1">
                                <div className="text-caption font-bold text-content">Este corte no contó el efectivo</div>
                                <p className="text-caption text-content-2">
                                    El comprobante dice <span className="tabular-nums">$0.00</span> de
                                    efectivo contado y aun así lo da por exacto, así que no hay diferencia
                                    que firmar. Suele pasar cuando el corte se manda sin escribir cuánto
                                    se contó. Lo que corresponde es descartarlo y volver a hacerlo.
                                </p>
                                <p className="text-caption text-content-3 pt-1">
                                    El efectivo del día lo cuenta el corte que sí se hizo. Su cifra no se
                                    repite en esta pantalla a propósito: dos números del mismo día en dos
                                    pantallas es justo lo que hace dudar del bueno.
                                </p>
                            </div>
                        ) : (
                        <div data-surface="card" className="p-4">
                            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                <span className="text-caption text-content-2">
                                    {visible.tramo === visible.acumulado
                                        ? 'Diferencia de este corte'
                                        : 'Diferencia desde el corte anterior'}
                                </span>
                                <span className={`text-2xl font-bold tabular-nums ${TONO_TEXTO[sev]}`}>
                                    {conSigno(visible.tramo ?? 0)}
                                </span>
                            </div>
                            <div className="mt-2 space-y-1 text-caption text-content-3">
                                <div className="flex justify-between gap-3">
                                    <span>Debía haber en caja</span>
                                    <span className="tabular-nums">{formatMoney(visible.esperadoUsado ?? visible.esperado)}</span>
                                </div>
                                {/* El puente hasta el papel. Quien mira esta
                                    pantalla suele tener el comprobante en la
                                    mano, y ahí dice otro número: sin estas dos
                                    líneas el de arriba parece inventado. Sólo
                                    aparecen cuando hay algo que explicar. */}
                                {cobros?.sinContar > 0.005 && (
                                    <>
                                        <div className="flex justify-between gap-3 pl-3 text-content-3">
                                            <span>El comprobante dice</span>
                                            <span className="tabular-nums">{formatMoney(visible.tk_total_caja)}</span>
                                        </div>
                                        <div className="flex justify-between gap-3 pl-3 text-content-3">
                                            <span>Cobros de crédito en efectivo</span>
                                            <span className="tabular-nums">+{formatMoney(cobros.sinContar)}</span>
                                        </div>
                                    </>
                                )}
                                <div className="flex justify-between gap-3">
                                    <span>Se contó</span>
                                    <span className="tabular-nums">{formatMoney(visible.total_declarado)}</span>
                                </div>
                                {visible.tramo !== visible.acumulado && (
                                    <div className="flex justify-between gap-3">
                                        <span>Acumulado hasta esta hora</span>
                                        <span className="tabular-nums">{conSigno(visible.acumulado ?? 0)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        )}

                        {/* Nota al pie del desglose, no un aviso: explica los
                            números de arriba y no cambia lo que hay que hacer.
                            Mismo criterio que `notaDeCifra`. */}
                        {esZ && (
                            <p className="text-caption text-content-2 -mt-2 px-1">
                                <span className="font-bold text-content">La tarjeta y el crédito no pasan por la caja.</span>{' '}
                                La tarjeta se cobra por el POS, y el crédito entra recién cuando el
                                cliente paga — ahí aparece como cobro de crédito en un corte
                                posterior. Los cortes del día sólo cuentan el efectivo.
                            </p>
                        )}

                        {/* El aviso de firma: sólo cuando hay algo que leer antes
                            de decidir. Va arriba de todo porque es lo que cambia
                            lo que se debe hacer. */}
                        {modo && puedeFirmar && sev !== 'ok' && (
                            <Notice variant={modo === 'confirmar' ? 'warning' : 'danger'} icon={AlertTriangle}>
                                <span className="font-bold">
                                    {modo === 'confirmar'
                                        ? `Vas a dar por bueno un corte con ${sev === 'falta' ? 'faltante' : 'sobrante'} de ${formatMoney(Math.abs(visible.tramo ?? 0))}`
                                        : `Vas a descartar un corte con ${sev === 'falta' ? 'faltante' : 'sobrante'} de ${formatMoney(Math.abs(visible.tramo ?? 0))}`}
                                </span>
                                <span className="block mt-0.5 font-normal text-content-2">
                                    {modo === 'confirmar'
                                        ? 'Queda firmado a tu nombre y con la hora. Si sabes qué pasó, escríbelo abajo.'
                                        : 'Sale de la cuenta del día y los cortes siguientes ya no lo toman en cuenta. Es para un conteo mal hecho, no para una diferencia que no cuadra.'}
                                </span>
                            </Notice>
                        )}

                        {/* ── El formulario va ACÁ ARRIBA, no al final ─────────
                            Reportado por el usuario (2026-08-14): «al dar
                            descartar se va de un solo a escribir, pero hay
                            computadoras que son menos altas, por lo que se salta
                            toda la información de arriba». Con el motivo y la
                            nota al final, en una pantalla baja el cuerpo abre
                            mostrando el formulario y la cifra queda arriba del
                            pliegue — o sea que se firma sin haber visto cuánto.

                            Acá, los tres bloques que importan para decidir —el
                            monto, el aviso y lo que hay que escribir— entran
                            juntos en el primer pantallazo a cualquier alto, y
                            el diagnóstico largo («Qué revisar») queda abajo,
                            que es donde se lo busca a propósito. */}
                        {puedeFirmar && modo && (
                            <div className="space-y-3">
                                {/* Una de N opciones es `SegmentedControl`, no
                                    tres botones cuyo `variant` mira `=== motivo`
                                    (§15.3). Además de verse igual en todo el
                                    portal, trae el `radiogroup` que hace que un
                                    lector anuncie «2 de 3». */}
                                {modo === 'descartar' && !sinConteo && (
                                    <div>
                                        <div className="text-caption font-black uppercase tracking-widest text-content-3 mb-1.5">
                                            Motivo del descarte
                                        </div>
                                        <SegmentedControl
                                            label="Motivo del descarte"
                                            tone="danger"
                                            value={motivo}
                                            onChange={setMotivo}
                                            options={MOTIVOS.map((m) => ({ value: m, label: m }))}
                                        />
                                    </div>
                                )}
                                <PortalTextarea
                                    label={modo === 'confirmar' ? 'Observación (opcional)' : 'Detalle (opcional)'}
                                    name="nota"
                                    value={nota}
                                    onChange={(e) => setNota(e.target.value)}
                                    rows={2}
                                    placeholder={modo === 'confirmar'
                                        ? 'Qué se encontró, o por qué se acepta'
                                        : 'Por qué se descarta'}
                                />
                            </div>
                        )}

                        {/* Explicar de dónde sale la cifra NO es una alerta: es
                            la nota al pie del número. Sólo cuando las dos cuentas
                            del origen están en disputa —y hay plata sin explicar—
                            cambia lo que se debe hacer, y ahí sí va como aviso.
                            El caso informativo era una caja azul del mismo peso
                            visual que un faltante, compitiendo con la cifra que
                            venía a explicar. */}
                        {explicacion && (explicacion.alerta ? (
                            <Notice variant="danger" icon={AlertTriangle}>
                                <span className="font-bold">{explicacion.titulo}</span>
                                <span className="block mt-0.5 font-normal text-content-2">{explicacion.detalle}</span>
                            </Notice>
                        ) : (
                            <p className="text-caption text-content-2 -mt-2 px-1">
                                <span className="font-bold text-content">{explicacion.titulo}.</span>{' '}
                                {explicacion.detalle}
                            </p>
                        ))}

                        {sev === 'ok' && pendiente && !noEsConteo && (
                            <Notice variant="success" icon={ShieldCheck}>
                                Este corte cuadra al centavo. No hay nada que investigar.
                            </Notice>
                        )}

                        {/* La decisión, con quien la firmó: nombre, foto y hora.
                            Nunca un id suelto — quien lee esto está revisando el
                            dinero de alguien y merece saber quién dio el visto. */}
                        {!pendiente && (
                            <div data-surface="card" className="p-3 flex items-center gap-3">
                                <AvatarConEstado emp={persona} px={40} radio="rounded-full" marco="" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {visible.estado === 'CONFIRMADO'
                                            ? <Badge variant="success" size="sm" icon={CheckCircle2}>Confirmado</Badge>
                                            : <Badge variant="neutral" size="sm" icon={Ban}>Descartado</Badge>}
                                        <span className="text-caption text-content-3 tabular-nums">
                                            {selloDeTiempo(visible.resuelto_at)}
                                        </span>
                                    </div>
                                    <div className="text-label font-bold text-content truncate">
                                        {persona?.name || 'Sin registrar quién'}
                                    </div>
                                    {(visible.motivo_descarte || visible.observaciones) && (
                                        <div className="text-caption text-content-3">
                                            {visible.motivo_descarte}
                                            {visible.motivo_descarte && visible.observaciones ? ' · ' : ''}
                                            {visible.observaciones}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Reabrir una firma. El motivo es obligatorio: es lo que
                            queda en la bitácora, y sin él la decisión anterior se
                            perdería sin que nadie sepa por qué cambió. */}
                        {modo === 'reabrir' && puedeReabrir && (
                            <div className="space-y-3">
                                <Notice variant="warning" icon={AlertTriangle}>
                                    <span className="font-bold">
                                        Vas a reabrir un corte que ya está {visible.estado === 'CONFIRMADO' ? 'confirmado' : 'descartado'}
                                    </span>
                                    <span className="block mt-0.5 font-normal text-content-2">
                                        Vuelve a quedar pendiente y los cortes siguientes de la sala
                                        se recalculan. Queda registrado quién lo reabrió y por qué.
                                    </span>
                                </Notice>
                                <div>
                                    <div className="text-caption font-black uppercase tracking-widest text-content-3 mb-1.5">
                                        Por qué se reabre
                                    </div>
                                    <SegmentedControl
                                        label="Por qué se reabre"
                                        tone="warning"
                                        value={motivo}
                                        onChange={setMotivo}
                                        options={MOTIVOS_REABRIR.map((m) => ({ value: m, label: m }))}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Qué se hizo con el faltante o el sobrante. Va después
                            de la firma porque primero se decide si el corte vale
                            y recién después qué se hace con su diferencia. */}
                        {!noEsConteo && modo !== 'reabrir' && (
                            <ResolverDiferencia
                                corte={visible}
                                nombreSala={nombreSala}
                                diferencia={diferencia}
                                personasResueltas={diferencia?.personas || []}
                                puedeResolver={puedeResolver}
                                origen={origen}
                                onCambio={() => setRecarga((n) => n + 1)}
                            />
                        )}

                        {/* ── Una LISTA, no cuatro alarmas ────────────────────
                            Cada pista salía como su propio `Notice` de color, y
                            eran hasta cuatro: rojo, ámbar, ámbar, azul. Pero
                            ninguna es un veredicto —son hipótesis para ir a
                            mirar, en orden de qué tan barato es descartarlas—, y
                            pintadas así le disputaban la atención a la cifra y
                            entre ellas.

                            El orden ES la jerarquía y ya lo calcula
                            `sugerenciasDeCorte` (el múltiplo exacto primero). El
                            número delante lo dice sin gastar un color: se lee
                            «empezá por la 1». */}
                        {/* Las formas que el comprobante no nombra. Va como
                            nota y no como aviso —no cambia lo que hay que
                            hacer—, pero tiene que estar: sin ella, ese dinero es
                            invisible desde el papel y quien busca el descuadre
                            no sabe siquiera que existió. El cierre no la lleva
                            porque su desglose ya las lista una por una. */}
                        {!esZ && invisibles.length > 0 && (
                            <p className="text-caption text-content-2 px-1">
                                <span className="font-bold text-content">
                                    Este día se cobraron{' '}
                                    {invisibles.map((f) => `${formatMoney(Math.abs(f.total))} por ${f.tipo}`).join(' y ')}.
                                </span>{' '}
                                Ese dinero no pasa por la caja y el comprobante no lo nombra.
                            </p>
                        )}

                        {/* ── Los cobros de crédito, uno por uno y con su hora ──
                            El comprobante imprime «COBROS CREDITO» como un solo
                            número del día, y los movimientos del sistema de la
                            caja llegan sin hora y con el mismo concepto para
                            todos («POR ABONO A CREDITO»). Con eso, el 1-sep en
                            Salud 3 esa línea valía $66.10 y detrás había nueve
                            renglones idénticos: no se podía saber cuáles habían
                            entrado antes de contar el efectivo.

                            Desde que el cobro se hace en el portal esa hora es
                            un dato, así que acá se dice a qué corte pertenece
                            cada uno en vez de deducirlo — deducirlo es lo que
                            marcó +$66.01 de un sobrante que no existía. */}
                        {!noEsConteo && cobros
                            && (cobros.cobros > 0 || cobros.antes.length > 0 || cobros.despues.length > 0) && (
                            <div data-surface="card" className="p-3">
                                {/* ── La cifra de arriba es la SUMA DE LO QUE HAY DEBAJO ──
                                    Estaba `cobros.cobros ?? cobros.hasta`, o sea lo que
                                    contó el COMPROBANTE. Y el comprobante no cuenta los
                                    cobros hechos desde el portal: el origen los registra
                                    como movimiento del día y los deja fuera de su suma
                                    (ver `contraste`). Así que en Salud 3 el 3-sep esa
                                    línea decía **$0.00** encima de cuatro cobros por
                                    $65.54, y un número pegado a un rótulo, arriba de
                                    cuatro renglones, se lee como la suma de esos cuatro
                                    renglones. El `??` no salvaba nada: `0` no es `null`.

                                    Ahora manda el dato del portal, que es el real y el
                                    único que puede cuadrar con la lista. Lo que contó el
                                    comprobante ya se dice donde sirve —en la nota de «no
                                    contó los cobros de crédito», con el esperado
                                    corregido— y no compite con este total.

                                    El respaldo se conserva para el caso en que el portal
                                    no tiene nada que listar (cobros hechos en la pantalla
                                    de la caja, o sin permiso para verlos): ahí la cifra
                                    del comprobante es la única que existe, y ponerla en
                                    cero borraría un dinero que sí entró. */}
                                <div className="flex items-baseline justify-between gap-3 mb-2">
                                    <span className="text-caption font-black uppercase tracking-widest text-content-3">
                                        Cobros de crédito
                                    </span>
                                    <span className="text-label font-bold tabular-nums text-content">
                                        {formatMoney(cobros.antes.length ? cobros.hasta : (cobros.cobros ?? 0))}
                                    </span>
                                </div>

                                {/* Sin permiso NO se pinta una lista vacía: eso se
                                    lee igual que «ese día no hubo cobros», y quien
                                    revisa un descuadre se quedaría sin buscar. */}
                                {abonos && !abonos.pude ? (
                                    <p className="text-caption text-content-2">
                                        No puedes ver el detalle de estos cobros. El comprobante los suma,
                                        pero para verlos uno por uno hace falta el permiso de la caja.
                                    </p>
                                ) : cobros.antes.length === 0 && cobros.despues.length === 0 ? (
                                    <p className="text-caption text-content-2">
                                        Ninguno se cobró desde el portal, así que no se sabe a qué hora entró
                                        cada uno. Los que se cobren desde el portal sí quedan con su hora.
                                    </p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {cobros.antes.map((a) => (
                                            <li key={a.id} className="flex items-baseline justify-between gap-3">
                                                <span className="min-w-0 flex items-baseline gap-2">
                                                    <span className="text-caption tabular-nums text-content-3 shrink-0">
                                                        {hhmm(a.hora)}
                                                    </span>
                                                    <span className="text-caption text-content truncate">{a.cliente}</span>
                                                </span>
                                                <span className="flex items-baseline gap-2 shrink-0">
                                                    {/* La forma se nombra SÓLO cuando no
                                                        es efectivo: escribir «Efectivo» en
                                                        todas las filas gasta la atención
                                                        justo en la que hay que mirar. */}
                                                    {!entroEnEfectivo(a) && (
                                                        <span className="text-caption text-warning-text">{a.forma}</span>
                                                    )}
                                                    <span className="text-caption font-bold tabular-nums text-content">
                                                        {formatMoney(a.monto)}
                                                    </span>
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {/* Las tres notas al pie. Cada una contesta una
                                    pregunta distinta y ninguna es un veredicto,
                                    así que van como nota y no como aviso. */}
                                {(cobros.noEfectivo > 0.005
                                    || cobros.sinContar > 0.005
                                    || cobros.despues.length > 0
                                    || (cobros.antes.length > 0 && cobros.brecha < -0.005)) && (
                                    <div className="mt-2.5 pt-2 border-t border-divider space-y-1 text-caption text-content-2">
                                        {/* Va primera porque es la única que
                                            cambia la cifra de arriba: las otras
                                            explican, ésta corrige. */}
                                        {cobros.sinContar > 0.005 && (
                                            <p>
                                                <span className="font-bold text-content">
                                                    {formatMoney(cobros.sinContar)} entraron en efectivo y el comprobante no los cuenta.
                                                </span>{' '}
                                                Ese dinero sí está en el cajón, así que se le suma a lo que
                                                debía haber en caja. Sin sumarlo, el conteo aparece como un
                                                sobrante que nadie hizo.
                                            </p>
                                        )}
                                        {cobros.noEfectivo > 0.005 && (
                                            <p>
                                                <span className="font-bold text-content">
                                                    {formatMoney(cobros.noEfectivo)} no entraron en efectivo.
                                                </span>{' '}
                                                Ese dinero no pasó por la caja y el comprobante tampoco lo cuenta,
                                                así que no hay que buscarlo en el cajón.
                                            </p>
                                        )}
                                        {cobros.despues.length > 0 && (
                                            <p>
                                                <span className="font-bold text-content">
                                                    {cobros.despues.length === 1
                                                        ? 'Un cobro más entró después de este corte'
                                                        : `${cobros.despues.length} cobros más entraron después de este corte`}
                                                    {' '}({formatMoney(cobros.despues.reduce((t, a) => t + Number(a.monto || 0), 0))}).
                                                </span>{' '}
                                                Pertenecen al corte siguiente, no a éste.
                                            </p>
                                        )}
                                        {cobros.antes.length > 0 && cobros.brecha < -0.005 && (
                                            <p>
                                                De los {formatMoney(cobros.cobros)} que cuenta el comprobante,{' '}
                                                {formatMoney(cobros.hasta)} se cobraron desde el portal. El resto se
                                                cargó en la pantalla de la caja y no tiene hora.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {sugerencias.length > 0 && (
                            <div data-surface="card" className="p-3">
                                <div className="text-caption font-black uppercase tracking-widest text-content-3 mb-2">
                                    Qué revisar
                                </div>
                                <ol className="space-y-2.5">
                                    {sugerencias.map((s, i) => (
                                        <li key={i} className="flex gap-2.5">
                                            <span className="text-caption font-bold text-content-3 tabular-nums shrink-0 w-4 text-right mt-0.5">
                                                {i + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="text-label font-bold text-content">{s.titulo}</div>
                                                <div className="text-caption text-content-2">{s.detalle}</div>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        )}

                    </>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                {puedeFirmar ? (
                    modo ? (
                        <>
                            <Button variant="ghost" onClick={() => setModo(null)} disabled={!!ocupadoId}>Volver</Button>
                            <Button variant={modo === 'confirmar' ? 'primary' : 'destructive'}
                                onClick={guardar} loading={!!ocupadoId}>
                                {modo === 'confirmar' ? 'Confirmar corte' : 'Descartar corte'}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant={sinConteo ? 'destructive' : 'secondary'} icon={Ban}
                                onClick={() => setModo('descartar')}>Descartar</Button>
                            {puedeConfirmar && (
                                <Button variant="primary" icon={CheckCircle2} onClick={() => setModo('confirmar')}>Confirmar</Button>
                            )}
                        </>
                    )
                ) : modo === 'reabrir' ? (
                    <>
                        <Button variant="ghost" onClick={() => setModo(null)} disabled={reabriendo}>Volver</Button>
                        <Button variant="destructive" icon={RotateCcw} onClick={reabrir} loading={reabriendo}>
                            Reabrir corte
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                        {puedeReabrir && (
                            <Button variant="ghost" icon={RotateCcw} onClick={abrirReapertura}>Reabrir</Button>
                        )}
                    </>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
        {/* «¿Quién recibe la caja?» — sale ENCIMA de este detalle cuando se
            confirma, y quien confirmó sigue esperando en su `await` hasta que
            se firme o se saltee. Sin pintarlo, la confirmación no termina
            nunca. Ver `useResolverCorte`. */}
        {dialogoDeEntrega}
        </>
    );
}
