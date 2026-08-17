import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, CheckCircle2, Sparkles, Thermometer } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import {
    fetchBitacoraDia, fetchLibro, hoySV, pendientesDelDia,
} from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Las bitácoras en el Inicio.
//
// ── Es el ATAJO, no el proceso ─────────────────────────────────────────────
// Acá va lo único que hay que saber sin abrir nada: qué toca AHORA, qué se
// pasó de hora, y cuántos renglones del libro esperan su receta. Anotar la
// lectura, corregirla y completar el libro viven en el módulo. Es la misma
// regla que el usuario fijó para las bolsas de efectivo: «el widget es para
// acceder fácil, pero debe haber una vista donde se haga todo el proceso».
//
// ── Lo que se cuenta sale del MISMO cálculo que la vista ───────────────────
// `pendientesDelDia` es una sola función y la usan las dos pantallas. Dos
// contadores escritos por separado terminan dando cifras distintas de lo
// mismo, y entonces ninguna de las dos se puede creer.
// ═══════════════════════════════════════════════════════════════════════════

const REFRESCO_MS = 5 * 60 * 1000;

const primerDiaDelMes = (f) => `${String(f).slice(0, 7)}-01`;

export default function WidgetBitacoras() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const miSala = user?.branchId ?? user?.branch_id ?? null;

    const [dia, setDia] = useState(null);
    const [pendientesLibro, setPendientesLibro] = useState(0);
    const [cargando, setCargando] = useState(true);

    const cargar = useCallback(async () => {
        if (!miSala) { setCargando(false); return; }
        const hoy = hoySV();
        const [{ dia: d }, { renglones }] = await Promise.all([
            fetchBitacoraDia(miSala, hoy),
            fetchLibro(miSala, { desde: primerDiaDelMes(hoy), hasta: hoy, estado: 'pendiente' }),
        ]);
        setDia(d);
        setPendientesLibro(renglones.length);
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

            {pendientesLibro > 0 && (
                <Notice variant="warning" icon={BookOpen} compact>
                    {pendientesLibro} bajo receta {pendientesLibro === 1 ? 'espera' : 'esperan'} su receta
                </Notice>
            )}

            {resumen.total === 0 && pendientesLibro === 0 && (
                <EmptyState icon={Sparkles} compact
                    title="Sin pendientes"
                    subtitle="Hoy no hay nada que anotar." />
            )}

            <div className="mt-auto flex flex-wrap gap-2">
                <Button variant="primary" size="sm" icon={Thermometer}
                    onClick={() => navigate('/bitacoras')}>
                    Anotar
                </Button>
                {pendientesLibro > 0 && (
                    <Button variant="secondary" size="sm" icon={BookOpen}
                        onClick={() => navigate('/bitacoras')}>
                        Ver el libro
                    </Button>
                )}
            </div>
        </div>
    );
}
