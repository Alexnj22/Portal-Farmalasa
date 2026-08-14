import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, ShieldCheck } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidAvatar from '../common/LiquidAvatar';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalTextarea from '../common/PortalTextarea';
import SegmentedControl from '../common/SegmentedControl';
import useSobreviveAlCierre from '../../hooks/useSobreviveAlCierre';
import { fetchMovimientos, fetchPersonas, resolverCorte } from '../../data/cortes';
import { contraste, notaDeCifra, severidad, sugerenciasDeCorte } from '../../utils/cortesDiagnostico';
import { mensajeAmigable } from '../../utils/errorMessages';
import { formatMoney } from '../../utils/formatNumber';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';

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

const iniciales = (nombre) => String(nombre || '?')
    .trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export default function CorteDetalleModal({
    corte,
    nombreSala = {},
    modoInicial = null,
    onClose,
    onResuelto,
    origen = 'modulo',
}) {
    const { user, hasPermission } = useAuth();
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');

    // Lo que se PINTA sobrevive al cierre: el panel sigue montado ~240ms
    // haciendo su salida, y leer `corte` directo lo vaciaría en el primer frame.
    const visible = useSobreviveAlCierre(corte);

    const [movs, setMovs] = useState([]);
    const [personas, setPersonas] = useState(() => new Map());
    const [modo, setModo] = useState(modoInicial);
    const [motivo, setMotivo] = useState(MOTIVOS[0]);
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);

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
    }

    // Los movimientos del día: sólo hacen falta para explicar una diferencia,
    // así que se piden al abrir un corte y no junto con la lista.
    useEffect(() => {
        if (!abierto || branchId == null || !fecha) return;
        let vivo = true;
        fetchMovimientos({ branchId, fecha }).then((data) => { if (vivo) setMovs(data || []); });
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

    const sugerencias = useMemo(
        () => (visible ? sugerenciasDeCorte(visible, movs) : []),
        [visible, movs],
    );
    const explicacion = useMemo(() => (visible ? notaDeCifra(visible) : null), [visible]);

    const sev = severidad(visible?.tramo);
    const ct = visible ? contraste(visible) : null;
    const revisar = !!ct?.enDisputa && !ct.porCobrosCredito;
    const esZ = visible?.tipo === 'Z';
    const pendiente = visible?.estado === 'PENDIENTE';
    const puedeFirmar = pendiente && !esZ && puedeResolver;

    const guardar = useCallback(async () => {
        if (!corte || !modo) return;
        const estado = modo === 'confirmar' ? 'CONFIRMADO' : 'DESCARTADO';
        setGuardando(true);
        const { error } = await resolverCorte(corte.id, estado, {
            motivo: modo === 'descartar' ? motivo : null,
            observaciones: nota,
        });
        setGuardando(false);
        if (error) {
            showToast?.('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return;
        }
        appendAuditLog?.(estado === 'CONFIRMADO' ? 'CORTE_CAJA_CONFIRMADO' : 'CORTE_CAJA_DESCARTADO', user?.id, {
            corte_id: corte.id,
            sucursal: nombreSala[corte.branch_id],
            fecha: corte.fecha,
            hora: corte.hora,
            diferencia: corte.tramo,
            motivo: modo === 'descartar' ? motivo : undefined,
            origen,
        });
        showToast?.(
            estado === 'CONFIRMADO' ? 'Corte confirmado' : 'Corte descartado',
            `${nombreSala[corte.branch_id] || ''} · ${hhmm(corte.hora)}`.trim(), 'success',
        );
        onResuelto?.(corte, estado);
        onClose?.();
    }, [corte, modo, motivo, nota, showToast, appendAuditLog, user, nombreSala, origen, onResuelto, onClose]);

    return (
        <LiquidModal
            open={abierto}
            onClose={guardando ? undefined : onClose}
            maxWidth="max-w-2xl"
            className="max-h-[88vh] h-fit"
            ariaLabel={`Corte de las ${hhmm(visible?.hora)}`}
        >
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Corte de las {hhmm(visible?.hora)}</h3>
                    <p className="text-caption text-content-3 truncate">
                        {nombreSala[visible?.branch_id] || (visible ? `Sucursal ${visible.branch_id}` : '')}
                        {visible?.fecha ? ` · ${fechaLarga(visible.fecha)}` : ''}
                        {visible?.empleado_texto ? ` · ${visible.empleado_texto}` : ''}
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

                        <div data-surface="card"
                            data-tono={sev === 'ok' ? undefined : sev === 'falta' ? 'danger' : 'warning'}
                            className="p-4">
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
                                <div className="flex justify-between gap-3">
                                    <span>Se contó</span>
                                    <span className="tabular-nums">{formatMoney(visible.total_declarado)}</span>
                                </div>
                                {visible.tramo !== visible.acumulado && (
                                    <div className="flex justify-between gap-3">
                                        <span>Acumulado del día hasta esta hora</span>
                                        <span className="tabular-nums">{conSigno(visible.acumulado ?? 0)}</span>
                                    </div>
                                )}
                            </div>
                        </div>

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
                                        ? 'Queda firmado a tu nombre y con la hora. Lee lo de abajo antes de firmar y, si puedes, deja escrito qué se encontró.'
                                        : 'Descartar lo saca de la cuenta del día: los cortes que vengan después ya no lo toman como referencia. Es para un conteo mal hecho, no para una diferencia que no cuadra.'}
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
                                {modo === 'descartar' && (
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
                                        ? 'Qué se encontró, o por qué se acepta la diferencia'
                                        : 'Algo que ayude a entender el descarte'}
                                />
                            </div>
                        )}

                        {explicacion && (
                            <Notice variant={explicacion.tono === 'danger' ? 'danger' : 'info'}
                                icon={explicacion.tono === 'danger' ? AlertTriangle : undefined}>
                                <span className="font-bold">{explicacion.titulo}</span>
                                <span className="block mt-0.5 font-normal text-content-2">{explicacion.detalle}</span>
                            </Notice>
                        )}

                        {sev === 'ok' && pendiente && !esZ && (
                            <Notice variant="success" icon={ShieldCheck}>
                                Este corte cuadra al centavo. No hay nada que investigar.
                            </Notice>
                        )}

                        {/* La decisión, con quien la firmó: nombre, foto y hora.
                            Nunca un id suelto — quien lee esto está revisando el
                            dinero de alguien y merece saber quién dio el visto. */}
                        {!pendiente && (
                            <div data-surface="card" className="p-3 flex items-center gap-3">
                                <LiquidAvatar
                                    src={persona?.photo_url}
                                    alt={persona?.name || 'Quien resolvió el corte'}
                                    fallbackText={iniciales(persona?.name)}
                                    className="w-10 h-10 rounded-full shrink-0"
                                />
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

                        {sugerencias.length > 0 && (
                            <div>
                                <div className="text-caption font-bold uppercase tracking-wide text-content-3 mb-1.5">Qué revisar</div>
                                <div className="space-y-2">
                                    {sugerencias.map((s, i) => (
                                        <Notice key={i} variant={s.tono === 'danger' ? 'danger' : s.tono === 'warning' ? 'warning' : 'info'}>
                                            <span className="font-bold">{s.titulo}</span>
                                            <span className="block mt-0.5 font-normal text-content-2">{s.detalle}</span>
                                        </Notice>
                                    ))}
                                </div>
                            </div>
                        )}

                        {revisar && (
                            <Notice variant="danger" icon={AlertTriangle}>
                                <span className="font-bold">Revisa las cifras antes de firmar</span>
                                <span className="block mt-0.5 font-normal text-content-2">
                                    Las dos cuentas de este corte no coinciden entre sí y la diferencia no
                                    se explica por los cobros de crédito. No conviene dar por bueno un
                                    faltante con esta información.
                                </span>
                            </Notice>
                        )}

                    </>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                {puedeFirmar ? (
                    modo ? (
                        <>
                            <Button variant="ghost" onClick={() => setModo(null)} disabled={guardando}>Volver</Button>
                            <Button variant={modo === 'confirmar' ? 'primary' : 'destructive'}
                                onClick={guardar} loading={guardando}>
                                {modo === 'confirmar' ? 'Confirmar corte' : 'Descartar corte'}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="secondary" icon={Ban} onClick={() => setModo('descartar')}>Descartar</Button>
                            <Button variant="primary" icon={CheckCircle2} onClick={() => setModo('confirmar')}>Confirmar</Button>
                        </>
                    )
                ) : (
                    <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
