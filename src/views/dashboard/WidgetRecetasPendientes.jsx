import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, Building2, CheckCircle2, PenLine, Pill } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import ListRow from '../../components/common/ListRow';
import Notice from '../../components/common/Notice';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { faltantesDelRenglon, fetchLibro } from '@nucleo/data/bitacoras';
import { useResumenWidget } from './tamanoWidget';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { diasEntre, fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { BRANCH_A_ERP, ERP_ORDEN } from '@nucleo/constants/erp';
import useRefrescoEnVivo from '@nucleo/hooks/useRefrescoEnVivo';

/* El formulario se baja al apretar «Completar», no al entrar al Inicio: arrastra
 * el canónico de archivo, el desplegable y el buscador de médico, y la baldosa
 * se ve entera sin tocar nada. Mismo criterio que `SalidaDeBolsa` en el widget
 * de bolsas. */
const CompletarRenglon = lazy(() => import('../../components/bitacoras/CompletarRenglon'));

// ═══════════════════════════════════════════════════════════════════════════
// Las ventas bajo receta que esperan su receta.
//
// ── Por qué es un widget APARTE del de bitácoras ───────────────────────────
// Son dos trabajos que no se parecen. Anotar la temperatura es una tarea de
// reloj —toca a las 8, a las 12 y a las 16— y la hace quien esté. Completar un
// renglón del libro es una tarea de MEMORIA: hay que acordarse de quién se
// llevó el medicamento y con qué receta, y eso se pierde con las horas. Meter
// las dos en la misma baldosa hace que la urgente tape a la que caduca.
//
// ── Se COMPLETA desde acá, no sólo se cuenta ───────────────────────────────
// El renglón se «confirma» agregando la información que falta, así que un
// widget que sólo dijera «hay 3 pendientes» obligaría a navegar, cambiar de
// pestaña y buscar la fila. Acá se abre el mismo formulario del módulo — es el
// mismo componente, no una segunda versión que se desincroniza.
//
// ── Los más viejos primero ─────────────────────────────────────────────────
// Al revés que el libro, que se lee del folio más nuevo hacia atrás. Acá lo que
// importa es lo que se está por olvidar: una venta de hace cuatro días es la
// que ya casi nadie puede reconstruir.
// ═══════════════════════════════════════════════════════════════════════════

const REFRESCO_MS = 5 * 60 * 1000;
// ── La ventana NO se recorta por antigüedad ────────────────────────────────
// Eran 30 días, y eso hacía justo lo contrario de lo que este widget existe
// para hacer: un renglón que cumplía 31 días SALÍA de la pantalla y no volvía
// nunca. El pendiente que más urge es el más viejo, así que envejecer no puede
// ser la forma de desaparecer. El año en curso es el horizonte —el libro se
// folia por año— y el tope de filas sigue siendo el que evita que la tarjeta
// crezca sin límite.
const DIAS_ATRAS  = 400;
const MAX_FILAS   = 6;

const fmtFecha = (f) => (f
    ? fechaTexto(f, { day: '2-digit', month: 'short' })
    : '—');

const diasDesde = (f) => Math.max(0, diasEntre(f, hoySV()));

export default function WidgetRecetasPendientes({ onVacio } = {}) {
    const { user, hasPermission, getScope } = useAuth();
    const navigate = useNavigate();
    const puedeCompletar = hasPermission('bitacoras', 'can_edit');
    // El botón al libro sólo si la pantalla se puede abrir: un botón que
    // termina en «sin permiso» enseña a no apretarlo.
    const puedeVerLibro = hasPermission('bitacoras', 'can_view');
    const miSala = user?.branchId ?? user?.branch_id ?? null;
    const branches = useStaff((st) => st.branches);

    // ── Con alcance ALL se elige la sala ───────────────────────────────────
    // Quien ve todas las salas trabaja desde Administración, que no dispensa:
    // con su propia sala la baldosa decía «Aquí no se dispensa» para siempre.
    // Se le ofrecen las salas de ventas, en el orden en que el negocio las
    // nombra, y arranca en la primera. Con BRANCH no cambia nada: es su sala.
    const alcanceTodas = getScope?.('dash_recetas_pendientes') === 'ALL';
    const salasQueDispensan = useMemo(() => ERP_ORDEN
        .map((erp) => Object.keys(BRANCH_A_ERP).find((b) => BRANCH_A_ERP[b] === erp))
        .map((id) => (branches || []).find((b) => String(b.id) === String(id)))
        .filter((b) => b && (b.type || 'FARMACIA') === 'FARMACIA')
        .map((b) => ({ value: String(b.id), label: b.name })), [branches]);
    const [salaElegida, setSalaElegida] = useState('');
    const sala = alcanceTodas
        ? (salaElegida || salasQueDispensan[0]?.value || null)
        : miSala;

    // Sólo las salas de ventas dispensan. En Bodega o Administración un «sin
    // pendientes» se leería como «todo al día», cuando en realidad ahí no se
    // vende — y ese matiz importa cuando el widget existe para no olvidarse.
    const dispensa = (branches || []).some(
        b => String(b.id) === String(sala) && (b.type || 'FARMACIA') === 'FARMACIA');

    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    // Un fallo de lectura NO es «Sin pendientes»: se dice.
    const [error, setError] = useState(null);
    const [completando, setCompletando] = useState(null);

    // Sólo la última lectura escribe: al cambiar de sala, la respuesta de la
    // anterior no puede pisar a la nueva.
    const secuencia = useRef(0);
    const cargar = useCallback(async () => {
        const mia = ++secuencia.current;
        if (!sala || !dispensa) { setCargando(false); return; }
        const hoy = hoySV();
        const { renglones, error: fallo } = await fetchLibro(sala, {
            desde: sumarDias(hoy, -DIAS_ATRAS), hasta: hoy, estado: 'pendiente',
        });
        if (mia !== secuencia.current) return;
        if (fallo) {
            console.error('WidgetRecetasPendientes: no se pudo leer el libro', fallo);
            setError(fallo);
            setCargando(false);
            return;
        }
        setError(null);
        // Los más viejos primero: son los que se están por olvidar.
        setFilas([...renglones].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))));
        setCargando(false);
    }, [sala, dispensa]);

    // La carga inicial acá; el refresco, con `useRefrescoEnVivo`: con la
    // pestaña oculta no consulta y, al volver, lee una vez si ya venció.
    useEffect(() => {
        cargar(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de sala
        return () => { secuencia.current += 1; };
    }, [cargar]);
    useRefrescoEnVivo(cargar, { ms: REFRESCO_MS });

    const elegirSala = (val) => {
        if (!val || String(val) === String(sala)) return;
        setCargando(true);
        setError(null);
        setFilas([]);
        setSalaElegida(String(val));
    };

    const viejasVistazo = filas.filter(r => diasDesde(r.fecha) >= 2).length;
    useResumenWidget(cargando ? null
        : !sala ? { texto: 'Sin sala asignada' }
        : !dispensa ? { texto: 'Aquí no se dispensa' }
        : error ? { texto: 'No se pudo leer', tono: 'danger' }
        : filas.length ? { valor: filas.length, texto: viejasVistazo > 0 ? `por completar · ${viejasVistazo} con 2+ días` : 'por completar', tono: viejasVistazo > 0 ? 'danger' : 'warning' }
        : { texto: 'Sin pendientes' });

    const selector = alcanceTodas && salasQueDispensan.length > 1 ? (
        <div className="shrink-0 px-2 pt-2">
            <LiquidSelect
                value={String(sala ?? '')}
                onChange={elegirSala}
                options={salasQueDispensan}
                placeholder="Sala"
                ariaLabel="Sala de ventas"
                icon={Building2}
                clearable={false}
                compact
            />
        </div>
    ) : null;

    // Vacío de verdad (sin error y ya leído): el Inicio lo baja a una fila en el
    // teléfono. Sin avisar, la tarjeta ocupaba su alto entero para una línea.
    const vacio = !cargando && !error && !filas.length;
    useEffect(() => { onVacio?.(vacio); }, [vacio, onVacio]);

    let contenido;
    if (cargando) {
        contenido = <div className="p-2"><SkeletonText lines={3} /></div>;
    } else if (!sala) {
        contenido = <EmptyState icon={Pill} compact
            title="Sin sala asignada"
            subtitle="El libro bajo receta es de una sala de ventas." />;
    } else if (!dispensa) {
        contenido = <EmptyState icon={Pill} compact
            title="Aquí no se dispensa"
            subtitle="El libro bajo receta es de las salas de ventas." />;
    } else if (error) {
        contenido = <EmptyState linea icon={AlertTriangle}
            title="No se pudieron leer las recetas"
            subtitle={mensajeAmigable(error, 'Revisa la conexión e intenta de nuevo.')} />;
    } else if (!filas.length) {
        // La ventana es el año (ver `DIAS_ATRAS`), no el mes: el texto lo dice
        // sin prometer un período que no se miró.
        contenido = <EmptyState icon={CheckCircle2} compact
            title="Sin pendientes"
            subtitle="Todas las ventas bajo receta tienen su receta completa." />;
    } else {
        // Una venta de más de un día ya cuesta reconstruirla: quién se la llevó
        // y con qué receta se olvida rápido, y ese olvido es el hueco del libro.
        const viejas = filas.filter(r => diasDesde(r.fecha) >= 2).length;
        const sobran = filas.length > MAX_FILAS;
        // ── El alto de la baldosa ───────────────────────────────────────────
        // `WidgetCard` le da a su cuerpo `overflow-hidden`: lo que no entra se
        // CORTA. La lista se desplaza dentro de la tarjeta y el pie —cuántos
        // faltan y el botón al libro— queda fijo abajo, como en los cortes.
        contenido = (
            <>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-2">
                    {viejas > 0 && (
                        <Notice variant="danger" icon={AlertTriangle} compact>
                            {viejas} {viejas === 1 ? 'lleva' : 'llevan'} 2 días o más sin completar
                        </Notice>
                    )}

                    <ul className="space-y-1.5 min-w-0">
                        {filas.slice(0, MAX_FILAS).map((r) => {
                            const faltan = faltantesDelRenglon(r);
                            const dias = diasDesde(r.fecha);
                            return (
                                <li key={r.id}>
                                    <ListRow
                                        surface="card"
                                        density="sm"
                                        tone={dias >= 2 ? 'danger' : null}
                                        icon={Pill}
                                        title={r.producto_nombre}
                                        subtitle={`${r.folio_txt} · ${fmtFecha(r.fecha)} · ${r.cliente || 'sin cliente'}`}
                                        trailing={puedeCompletar ? (
                                            <Button variant="primary" size="xs" icon={PenLine}
                                                onClick={() => setCompletando(r)}>
                                                Completar
                                            </Button>
                                        ) : (
                                            <Badge variant="warning" size="sm" uppercase={false}>
                                                faltan {faltan.length}
                                            </Badge>
                                        )}
                                    />
                                </li>
                            );
                        })}
                    </ul>
                </div>

                {/* Lo que no entra NO se esconde en silencio: el número dice
                    cuánto falta ver, y el botón lleva al libro entero. */}
                {(sobran || puedeVerLibro) && (
                    <div className="shrink-0 flex flex-wrap items-center gap-2 px-2 py-2 border-t border-divider">
                        {sobran && (
                            <span className="text-label text-content-3">
                                y {filas.length - MAX_FILAS} más
                            </span>
                        )}
                        {puedeVerLibro && (
                            <Button variant="secondary" size="sm" icon={BookOpen} className="ml-auto"
                                onClick={() => navigate('/bitacoras')}>
                                Ver el libro
                            </Button>
                        )}
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            {selector}
            {contenido}

            {completando && (
                <Suspense fallback={null}>
                    <CompletarRenglon
                        renglon={completando}
                        branchId={sala}
                        onCerrar={(hubo) => { setCompletando(null); if (hubo) cargar(); }}
                    />
                </Suspense>
            )}
        </div>
    );
}
