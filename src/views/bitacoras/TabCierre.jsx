import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, CheckCircle2, Clock, LockOpen, Printer, Thermometer } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import PeriodStepper from '../../components/common/PeriodStepper';
import PortalTextarea from '../../components/common/PortalTextarea';
import { LoadingState } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import {
    cerrarMes, correrPeriodo, fetchCierres, fetchMesImpreso, fetchResumenMes, hoySV, periodoDe, reabrirMes,
} from '../../data/bitacoras';
import { registrarEgreso } from '../../data/egreso';
import { imprimirMesDeBitacoras } from '../../utils/bitacoraPrint';
import { abrirVentanaDeImpresion, VENTANA_BLOQUEADA } from '../../utils/ventanaDeImpresion';
import { logoComoDataUrl, LOGO_DE_LA_EMPRESA } from '../../utils/marcaDeLaSala';

// ═══════════════════════════════════════════════════════════════════════════
// El cierre de mes del regente.
//
// ── Un mes IMPERFECTO se puede cerrar, y el cierre guarda cuán imperfecto era
// Es la decisión de fondo de esta pantalla y va contra el instinto. Exigir que
// esté todo completo para poder firmar le enseña a la gente a INVENTAR las
// lecturas que faltan, y ahí el registro deja de valer para siempre: ya no se
// sabe cuál es real. «Se cerró agosto con 4 faltantes de 186» es defendible
// ante un inspector — muestra un sistema que sabe lo que le falta. Lo que se
// esconde es lo que hunde una inspección.
//
// Por eso el botón nunca se deshabilita por tener faltantes, y el resumen los
// muestra en grande antes de firmar en vez de esconderlos.
// ═══════════════════════════════════════════════════════════════════════════

const nombreMes = (p) => {
    const [a, m] = String(p).split('-').map(Number);
    const txt = new Date(Date.UTC(a, m - 1, 1))
        .toLocaleDateString('es-SV', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    // Sólo la PRIMERA letra. La clase `capitalize` de CSS pone mayúscula en cada
    // palabra y dejaba «Julio De 2026».
    return txt.charAt(0).toUpperCase() + txt.slice(1);
};

const pct = (hechas, esperadas) => (esperadas > 0 ? Math.round((hechas / esperadas) * 100) : null);

// `null` se pinta «—», no «100%». Un mes sin nada esperado no es un mes
// cumplido: es un mes que no aplica, y decir 100% sería firmar un logro vacío.
const rotularPct = (p) => (p === null ? '—' : `${p}%`);
const tonoPct = (p) => (p === null ? undefined : p === 100 ? 'success' : 'warning');

/** Un número del resumen, con su rótulo. El tono lo pone quien lo usa. */
function Cifra({ valor, label, tono }) {
    const color = tono === 'danger' ? 'text-danger-text'
        : tono === 'warning' ? 'text-warning-text'
        : tono === 'success' ? 'text-success-text' : 'text-content';
    return (
        <div data-surface="card" className="p-3">
            <p className={`text-title font-black tabular-nums ${color}`}>{valor}</p>
            <p className="text-label font-bold uppercase tracking-widest text-content-3">{label}</p>
        </div>
    );
}

export default function TabCierre({ branchId, fechaVista }) {
    const { hasPermission } = useAuth();
    const puedeFirmar = hasPermission('bitacoras_cerrar_mes', 'can_edit');
    const puedeImprimir = hasPermission('bitacoras_descargar', 'can_view');

    // Arranca en el mes ANTERIOR al de la fecha que se está mirando: el mes en
    // curso no se puede cerrar todavía, así que abrir ahí mostraría siempre un
    // botón que no se puede apretar.
    const [periodo, setPeriodo] = useState(() => correrPeriodo(periodoDe(fechaVista), -1));
    const [resumen, setResumen] = useState(null);
    const [cierres, setCierres] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [obs, setObs] = useState('');
    const [motivo, setMotivo] = useState('');
    const [reabriendo, setReabriendo] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [imprimiendo, setImprimiendo] = useState(false);
    const [error, setError] = useState(null);

    const cargar = useCallback(async () => {
        if (!branchId) return;
        setCargando(true);
        const [{ resumen: r, error: e1 }, { cierres: c }] = await Promise.all([
            fetchResumenMes(branchId, periodo),
            fetchCierres(branchId),
        ]);
        setResumen(r);
        setCierres(c);
        setError(e1?.message ?? null);
        setCargando(false);
    }, [branchId, periodo]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y al cambiar el período
    useEffect(() => { cargar(); }, [cargar]);

    const enCurso = periodo >= periodoDe(hoySV());
    const cerrado = Boolean(resumen?.cerrado);

    const historia = useMemo(
        () => cierres.filter(c => c.periodo === periodo),
        [cierres, periodo],
    );

    const firmar = useCallback(async () => {
        setGuardando(true);
        setError(null);
        const { error: err } = await cerrarMes({ branchId, periodo, observaciones: obs });
        setGuardando(false);
        if (err) { setError(err); return; }
        setObs('');
        cargar();
    }, [branchId, periodo, obs, cargar]);

    // El papel se arma con SU PROPIA consulta, no con el resumen que ya está en
    // pantalla: lo impreso tiene que ser una foto coherente del mes entero
    // —grilla, limpieza y libro— tomada en un solo momento.
    //
    // La ventana se abre SINCRÓNICA acá, antes de la consulta: después de un
    // `await` el bloqueador de emergentes la mata por no venir de un gesto. Y
    // si la consulta falla, hay que cerrarla — una ventana en blanco que se
    // queda abierta se lee como que el papel salió mal, no como que no salió.
    const imprimir = useCallback(async () => {
        const win = abrirVentanaDeImpresion({ ancho: 1000, alto: 900 });
        if (!win) { setError(VENTANA_BLOQUEADA); return; }
        setImprimiendo(true);
        setError(null);
        // El logo se pide EN PARALELO: es una imagen chica y no tiene por qué
        // sumarle su ida y vuelta a la del mes. Si no viene, el papel sale
        // igual con el nombre de la empresa en texto.
        const [{ mes, error: err }, logo] = await Promise.all([
            fetchMesImpreso(branchId, periodo),
            logoComoDataUrl(LOGO_DE_LA_EMPRESA),
        ]);
        setImprimiendo(false);
        if (err) {
            try { win.close(); } catch { /* ya no está */ }
            setError(err.message ?? 'No se pudo armar el mes para imprimir.');
            return;
        }
        const r = imprimirMesDeBitacoras(win, mes, logo);
        if (!r.ok) { setError(r.motivo); return; }

        // El mes impreso ES una salida de datos del portal, y hasta el
        // 2026-09-03 era la única que no se anotaba — justo la del módulo del
        // que trata el protocolo de supervisión del sistema electrónico, que
        // declara que «toda salida de datos queda anotada».
        //
        // Va DESPUÉS de imprimir y no antes: anotar un egreso que no ocurrió
        // ensucia la línea base con salidas que nadie hizo. `registrarEgreso`
        // nunca lanza, así que no puede impedir que el papel salga.
        registrarEgreso('bitacoras', {
            formato: 'pdf',
            filas: mes?.areas?.length ?? null,
            detalle: { periodo, branch_id: branchId, sucursal: mes?.sucursal ?? null },
        });
    }, [branchId, periodo]);

    const reabrir = useCallback(async () => {
        setGuardando(true);
        setError(null);
        const { error: err } = await reabrirMes({ branchId, periodo, motivo });
        setGuardando(false);
        if (err) { setError(err); return; }
        setMotivo('');
        setReabriendo(false);
        cargar();
    }, [branchId, periodo, motivo, cargar]);

    const L = resumen?.lecturas;
    const Li = resumen?.limpiezas;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <PeriodStepper
                    unit="mes"
                    onPrev={() => setPeriodo(p => correrPeriodo(p, -1))}
                    onNext={() => setPeriodo(p => correrPeriodo(p, 1))}
                    nextDisabled={periodo >= periodoDe(hoySV())}
                >
                    <span className="text-body-sm font-bold text-content-2">{nombreMes(periodo)}</span>
                </PeriodStepper>

                <div className="flex items-center gap-2">
                    {cerrado
                        ? <Badge variant="success" size="md" uppercase={false} icon={CheckCircle2}>Mes cerrado y firmado</Badge>
                        : enCurso
                            ? <Badge variant="neutral" size="md" uppercase={false} icon={Clock}>Todavía en curso</Badge>
                            : <Badge variant="warning" size="md" uppercase={false}>Sin cerrar</Badge>}

                    {puedeImprimir && !cargando && resumen && !resumen.sin_dias && (
                        <Button variant="secondary" size="sm" icon={Printer}
                            onClick={imprimir} loading={imprimiendo}>
                            Imprimir el mes
                        </Button>
                    )}
                </div>
            </div>

            {cargando ? <LoadingState label="Calculando el mes…" /> : !resumen ? (
                <Notice variant="danger" icon={AlertTriangle}>No se pudo calcular el resumen del mes.</Notice>
            ) : resumen.sin_dias ? (
                <Notice variant="info">Ese mes es anterior a la puesta en marcha de las bitácoras.</Notice>
            ) : (
                <>
                    <section className="space-y-3">
                        <h4 className="text-body-sm font-black uppercase tracking-widest text-content-3">
                            Lecturas de temperatura y humedad
                        </h4>
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                            <Cifra valor={rotularPct(pct(L.hechas, L.esperadas))} label="Cumplimiento"
                                tono={tonoPct(pct(L.hechas, L.esperadas))} />
                            <Cifra valor={`${L.hechas}/${L.esperadas}`} label="Anotadas" />
                            <Cifra valor={L.faltantes} label="Faltantes" tono={L.faltantes > 0 ? 'danger' : 'success'} />
                            <Cifra valor={L.tarde} label="Fuera de hora" tono={L.tarde > 0 ? 'warning' : undefined} />
                            <Cifra valor={L.fuera_de_rango} label="Fuera de rango" tono={L.fuera_de_rango > 0 ? 'warning' : undefined} />
                        </div>

                        {/* Una desviación sin acción correctiva es peor que el
                            faltante: prueba que se vio y no se actuó (RTS 5.6.5). */}
                        {L.sin_accion > 0 && (
                            <Notice variant="danger" icon={AlertTriangle}>
                                <span className="font-bold">
                                    {L.sin_accion} {L.sin_accion === 1 ? 'lectura fuera de rango' : 'lecturas fuera de rango'} sin acción correctiva anotada.
                                </span>
                                <span className="block mt-0.5 font-normal text-content-2">
                                    Hay que completarlas antes de firmar: la norma pide investigar la
                                    desviación y dejar constancia de qué se hizo.
                                </span>
                            </Notice>
                        )}

                        {L.fuera_de_plan > 0 && (
                            <Notice variant="info" compact>
                                {L.fuera_de_plan} {L.fuera_de_plan === 1 ? 'lectura quedó' : 'lecturas quedaron'} fuera
                                del plan del área (otro día u otra franja). Se anotaron y cuentan como trabajo hecho,
                                pero no cierran un hueco del plan.
                            </Notice>
                        )}
                    </section>

                    <section className="space-y-3">
                        <h4 className="text-body-sm font-black uppercase tracking-widest text-content-3">Limpieza y orden</h4>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                            <Cifra valor={rotularPct(pct(Li.hechas, Li.esperadas))} label="Cumplimiento"
                                tono={tonoPct(pct(Li.hechas, Li.esperadas))} />
                            <Cifra valor={`${Li.hechas}/${Li.esperadas}`} label="Registradas" />
                            <Cifra valor={Li.faltantes} label="Faltantes" tono={Li.faltantes > 0 ? 'danger' : 'success'} />
                        </div>

                        {/* Abierto por área: un solo porcentaje para «la sala, las
                            vitrinas y el baño» no contesta CUÁL de los tres se
                            está dejando, que es lo que hay que saber antes de
                            firmar. El servicio sanitario además tiene ítems
                            propios en la guía (2.15 y 2.16). */}
                        {(resumen.limpieza_por_area || []).length > 1 && (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {resumen.limpieza_por_area.map(a => (
                                    <div key={a.area_id} data-surface="card" className="p-3 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-body-sm font-bold text-content truncate">{a.nombre}</p>
                                            <p className="text-label text-content-3 tabular-nums">
                                                {a.hechas} de {a.esperadas} · {a.tarde} fuera de hora
                                            </p>
                                        </div>
                                        <Badge variant={a.faltantes > 0 ? 'warning' : 'success'} size="sm" uppercase={false}>
                                            {a.faltantes > 0 ? `${a.faltantes} sin registrar` : 'Completa'}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {(resumen.calibracion_vencida || []).length > 0 && (
                        <Notice variant="danger" icon={Thermometer}>
                            <span className="font-bold">Hay instrumentos con la calibración vencida.</span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                {resumen.calibracion_vencida.map(c => `${c.area}${c.instrumento ? ` (${c.instrumento})` : ''}`).join(', ')}.
                                Un termómetro sin certificado vigente invalida las lecturas que tomó.
                            </span>
                        </Notice>
                    )}

                    {(resumen.por_area || []).length > 0 && (
                        <section className="space-y-2">
                            <h4 className="text-body-sm font-black uppercase tracking-widest text-content-3">Por área</h4>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {resumen.por_area.map(a => (
                                    <div key={a.area_id} data-surface="card" className="p-3 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-body-sm font-bold text-content truncate">{a.nombre}</p>
                                            <p className="text-label text-content-3 tabular-nums">
                                                {a.hechas} de {a.esperadas} · {a.tarde} fuera de hora
                                            </p>
                                        </div>
                                        <Badge variant={a.faltantes > 0 ? 'warning' : 'success'} size="sm" uppercase={false}>
                                            {a.faltantes > 0 ? `${a.faltantes} sin anotar` : 'Completa'}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* La firma. El botón NO se deshabilita por tener faltantes
                        —ver el encabezado del archivo—; sólo por no tener el
                        permiso, por estar el mes en curso o por estar ya cerrado. */}
                    {!cerrado && !enCurso && puedeFirmar && (
                        <section data-surface="card" className="p-4 space-y-3">
                            <h4 className="text-body font-black text-content">Dar por finalizado {nombreMes(periodo).toLowerCase()}</h4>
                            {L.faltantes + Li.faltantes > 0 && (
                                <Notice variant="warning" icon={AlertTriangle}>
                                    <span className="font-bold">
                                        El mes se puede cerrar así, y el cierre va a guardar que quedaron {L.faltantes + Li.faltantes} registros sin anotar.
                                    </span>
                                    <span className="block mt-0.5 font-normal text-content-2">
                                        Es a propósito: un cierre que exige perfección enseña a inventar las
                                        lecturas que faltan. Lo que está medido y anotado es un hallazgo menor;
                                        lo que se esconde es lo que hunde una inspección.
                                    </span>
                                </Notice>
                            )}
                            <PortalTextarea
                                label="Observaciones del regente (opcional)" name="observaciones"
                                value={obs} onChange={(e) => setObs(e.target.value)} rows={3}
                                placeholder="Por ejemplo: las cuatro lecturas faltantes son del 12 y 13, cuando la sala cerró por el corte de energía."
                            />
                            <Button variant="primary" icon={CalendarCheck} onClick={firmar} loading={guardando}>
                                Firmar y cerrar el mes
                            </Button>
                        </section>
                    )}

                    {!cerrado && !enCurso && !puedeFirmar && (
                        <Notice variant="info">
                            El mes lo da por finalizado el regente. Aquí puedes revisar cómo va.
                        </Notice>
                    )}

                    {cerrado && puedeFirmar && (
                        <section data-surface="card" className="p-4 space-y-3">
                            {!reabriendo ? (
                                <Button variant="ghost" icon={LockOpen} onClick={() => setReabriendo(true)}>
                                    Reabrir el mes
                                </Button>
                            ) : (
                                <>
                                    <Notice variant="warning" icon={AlertTriangle}>
                                        <span className="font-bold">Reabrir un mes firmado queda registrado.</span>
                                        <span className="block mt-0.5 font-normal text-content-2">
                                            Con quién, cuándo y por qué. Un mes que se reabrió tres veces cuenta
                                            esa historia, y eso también es información.
                                        </span>
                                    </Notice>
                                    <PortalTextarea
                                        label="Por qué se reabre" name="motivo" required
                                        value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                                        placeholder="Apareció el registro en papel de las lecturas del 12."
                                    />
                                    <div className="flex gap-2">
                                        <Button variant="ghost" onClick={() => setReabriendo(false)} disabled={guardando}>
                                            Cancelar
                                        </Button>
                                        <Button variant="primary" onClick={reabrir} loading={guardando} disabled={!motivo.trim()}>
                                            Reabrir
                                        </Button>
                                    </div>
                                </>
                            )}
                        </section>
                    )}

                    {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                    {historia.length > 0 && (
                        <section className="space-y-2">
                            <h4 className="text-body-sm font-black uppercase tracking-widest text-content-3">
                                Qué pasó con este mes
                            </h4>
                            <ul className="space-y-1">
                                {historia.map(c => (
                                    <li key={c.id} className="text-label text-content-2">
                                        <span className="font-bold">{c.accion === 'cerrar' ? 'Cerrado' : 'Reabierto'}</span>
                                        {' · '}
                                        <span className="tabular-nums">{new Date(c.created_at).toLocaleString('es-SV')}</span>
                                        {c.motivo ? ` · ${c.motivo}` : ''}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
