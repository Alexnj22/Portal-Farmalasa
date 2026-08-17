import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Sparkles, Thermometer } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { fetchBitacoraDia, hoySV, pendientesDelDia } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Las bitácoras en el Inicio.
//
// ── Es el ATAJO, no el proceso ─────────────────────────────────────────────
// Acá va lo único que hay que saber sin abrir nada: qué toca AHORA y qué se
// pasó de hora. Anotar la lectura y corregirla viven en el módulo. Es la misma
// regla que el usuario fijó para las bolsas de efectivo: «el widget es para
// acceder fácil, pero debe haber una vista donde se haga todo el proceso».
//
// ── El libro bajo receta tiene su PROPIA baldosa ───────────────────────────
// Son dos trabajos que no se parecen: anotar la temperatura es una tarea de
// reloj y la hace quien esté; completar un renglón del libro es una tarea de
// memoria que caduca. Y el número vive en UN solo sitio — dos baldosas
// contando lo mismo terminan discrepando, y entonces ninguna se puede creer.
//
// ── Lo que se cuenta sale del MISMO cálculo que la vista ───────────────────
// `pendientesDelDia` es una sola función y la usan las dos pantallas. Dos
// contadores escritos por separado terminan dando cifras distintas de lo
// mismo, y entonces ninguna de las dos se puede creer.
// ═══════════════════════════════════════════════════════════════════════════

const REFRESCO_MS = 5 * 60 * 1000;

export default function WidgetBitacoras() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const miSala = user?.branchId ?? user?.branch_id ?? null;

    const [dia, setDia] = useState(null);
    const [cargando, setCargando] = useState(true);

    const cargar = useCallback(async () => {
        if (!miSala) { setCargando(false); return; }
        const { dia: d } = await fetchBitacoraDia(miSala, hoySV());
        setDia(d);
        setCargando(false);
    }, [miSala]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y refresco cada 5 min
        cargar();
        const t = setInterval(cargar, REFRESCO_MS);
        return () => clearInterval(t);
    }, [cargar]);

    const resumen = useMemo(() => pendientesDelDia(dia), [dia]);

    if (cargando) return <SkeletonText lines={3} />;

    if (!miSala) {
        return <EmptyState icon={Thermometer} compact
            title="Sin sala asignada"
            subtitle="Las bitácoras son de una sala." />;
    }

    const alDia = resumen.abiertas === 0 && resumen.vencidas === 0;

    return (
        <div className="flex flex-col gap-3 h-full">
            {/* Lo urgente primero y con su color: una franja abierta es trabajo
                de ahora, una vencida ya es un hueco en el libro. */}
            {resumen.vencidas > 0 && (
                <Notice variant="danger" icon={AlertTriangle} compact>
                    {resumen.vencidas} {resumen.vencidas === 1 ? 'lectura se pasó' : 'lecturas se pasaron'} de hora
                </Notice>
            )}
            {resumen.abiertas > 0 && (
                <Notice variant="warning" icon={Thermometer} compact>
                    {resumen.abiertas} {resumen.abiertas === 1 ? 'lectura toca' : 'lecturas tocan'} ahora
                </Notice>
            )}
            {alDia && resumen.total > 0 && (
                <Notice variant="success" icon={CheckCircle2} compact>
                    Al día — {resumen.hechas} de {resumen.total} registradas
                </Notice>
            )}

            {resumen.desvios > 0 && (
                <p className="text-label text-danger-text font-bold flex items-center gap-1">
                    <AlertTriangle size={12} />
                    {resumen.desvios} fuera de rango hoy
                </p>
            )}

            {resumen.total === 0 && (
                <EmptyState icon={Sparkles} compact
                    title="Sin pendientes"
                    subtitle="Hoy no hay nada que anotar." />
            )}

            <div className="mt-auto">
                <Button variant="primary" size="sm" icon={Thermometer}
                    onClick={() => navigate('/bitacoras')}>
                    Anotar
                </Button>
            </div>
        </div>
    );
}
