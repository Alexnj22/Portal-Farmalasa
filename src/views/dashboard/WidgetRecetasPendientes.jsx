import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, CheckCircle2, PenLine, Pill } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ListRow from '../../components/common/ListRow';
import Notice from '../../components/common/Notice';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { correrDia, faltantesDelRenglon, fetchLibro, hoySV } from '../../data/bitacoras';

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
const DIAS_ATRAS  = 30;
const MAX_FILAS   = 6;

const fmtFecha = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    : '—');

const diasDesde = (f) => Math.max(0, Math.round(
    (Date.parse(`${hoySV()}T12:00:00Z`) - Date.parse(`${f}T12:00:00Z`)) / 86_400_000));

export default function WidgetRecetasPendientes() {
    const { user, hasPermission } = useAuth();
    const navigate = useNavigate();
    const puedeCompletar = hasPermission('bitacoras', 'can_edit');
    const miSala = user?.branchId ?? user?.branch_id ?? null;

    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [completando, setCompletando] = useState(null);

    const cargar = useCallback(async () => {
        if (!miSala) { setCargando(false); return; }
        const hoy = hoySV();
        const { renglones } = await fetchLibro(miSala, {
            desde: correrDia(hoy, -DIAS_ATRAS), hasta: hoy, estado: 'pendiente',
        });
        // Los más viejos primero: son los que se están por olvidar.
        setFilas([...renglones].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))));
        setCargando(false);
    }, [miSala]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y refresco cada 5 min
        cargar();
        const t = setInterval(cargar, REFRESCO_MS);
        return () => clearInterval(t);
    }, [cargar]);

    if (cargando) return <SkeletonText lines={3} />;

    if (!miSala) {
        return <EmptyState icon={Pill} compact
            title="Sin sala asignada"
            subtitle="El libro bajo receta es de una sala." />;
    }

    if (!filas.length) {
        return (
            <EmptyState icon={CheckCircle2} compact
                title="Sin pendientes"
                subtitle="Todas las ventas bajo receta del mes tienen su receta completa." />
        );
    }

    // Una venta de más de un día ya cuesta reconstruirla: quién se la llevó y
    // con qué receta se olvida rápido, y ese olvido es el hueco del libro.
    const viejas = filas.filter(r => diasDesde(r.fecha) >= 2).length;

    return (
        <div className="flex flex-col gap-2 h-full">
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

            {/* Lo que no entra NO se esconde en silencio: el número dice cuánto
                falta ver, y el botón lleva al libro entero. */}
            <div className="mt-auto flex flex-wrap items-center gap-2">
                {filas.length > MAX_FILAS && (
                    <span className="text-label text-content-3">
                        y {filas.length - MAX_FILAS} más
                    </span>
                )}
                <Button variant="secondary" size="sm" icon={BookOpen}
                    onClick={() => navigate('/bitacoras')}>
                    Ver el libro
                </Button>
            </div>

            {completando && (
                <Suspense fallback={null}>
                    <CompletarRenglon
                        renglon={completando}
                        branchId={miSala}
                        onCerrar={(hubo) => { setCompletando(null); if (hubo) cargar(); }}
                    />
                </Suspense>
            )}
        </div>
    );
}
