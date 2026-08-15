// Extracted from TabPedidos.jsx (Bloque 6.C)
import { useRef, useEffect } from 'react';
import Badge from '../../../components/common/Badge';
import LiquidAvatar from '../../../components/common/LiquidAvatar';
import { shortEmployeeName } from '../../../utils/nameUtils';
import { Truck, CheckCircle2, AlertCircle, Check, AlertTriangle, PackageX } from 'lucide-react';

// El tipo de llegada, como variante del canónico `Badge`. Era un par
// bg/borde/texto escrito a mano y un glifo de texto por caso ('✓', '⚠', '!'),
// pintados en un `<span>` con `rounded-full` fijo: la forma no seguía al tema
// y el «!» no es un ícono, es un signo de admiración suelto.
const LLEGADA_TIPO_INFO = {
    completa:    { variant: 'success', icon: Check,         label: 'Recibido sin novedad' },
    caja_danada: { variant: 'warning', icon: AlertTriangle, label: 'Caja dañada' },
    falta_caja:  { variant: 'danger',  icon: PackageX,      label: 'Caja faltante' },
    mixto:       { variant: 'chart-4', icon: AlertCircle,   label: 'Daños y faltantes' },
};

export default function PostCompletionSection({ row, difItems = [], empMap = new Map(), onNeedItems, itemsLoaded }) {
    // Auto-load items once per card so dif counts are accurate
    const calledRef = useRef(false);
    useEffect(() => {
        if (!itemsLoaded && !calledRef.current && onNeedItems) {
            calledRef.current = true;
            onNeedItems();
        }
    }, [itemsLoaded, onNeedItems]);

    const tipoInfo = LLEGADA_TIPO_INFO[row.llegada_tipo] ?? null;
    const reenvios = (row.reenvios_historial ?? []);
    const difResueltas   = difItems.filter(d => d.resolucion_status === 'confirmada').length;
    const difPendientes  = difItems.filter(d => d.resolucion_status !== 'confirmada').length;
    const hasCajasDanadas = (row.cajas_danadas ?? []).length > 0;
    const llegadaEmp = row.llegada_fisica_por ? empMap.get(row.llegada_fisica_por) : null;

    return (
        <div className="border-t border-divider px-4 py-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <p className="text-caption font-bold text-content-2 uppercase tracking-wide">Resumen de recepción</p>
                {/* Reportado el 2026-08-15: «sigo sin ver la foto de Dolores, y
                    pon nombre y apellido». Dos bugs en el mismo renglón, y los
                    dos porque este bloque no usaba los canónicos:

                    1 · `photo_url` es la URL CRUDA y el bucket de fotos es
                        privado, así que el `<img>` daba 403 — y como
                        `photo_url` SÍ existe, el ternario nunca caía en el
                        ícono de respaldo: quedaba un círculo vacío, que es peor
                        que no poner nada. La firmada vive en `photo` (la pone
                        `signPhotosDeep` en el arranque). Dos renglones más
                        arriba, en la línea de tiempo, la misma cara se veía
                        bien porque allá sí se lee `photo || photo_url`.
                    2 · `name.split(' ')[0]` es sólo el PRIMER NOMBRE, así que
                        se leía «DOLORES» a secas. El nombre del portal es
                        `shortEmployeeName` —primer nombre + primer apellido— y
                        además sale de `first_names`/`last_names`, que es donde
                        el dato está separado de verdad: partir `name` por
                        espacios adivina dónde estaba la frontera.

                    `LiquidAvatar` cierra el caso de raíz: si la foto falla
                    igual, pinta las iniciales en vez de un hueco. */}
                {llegadaEmp && (
                    <span className="flex items-center gap-1.5 text-caption text-content-3">
                        <LiquidAvatar
                            src={llegadaEmp.photo || llegadaEmp.photo_url}
                            alt=""
                            fallbackText={shortEmployeeName(llegadaEmp)}
                            className="w-4 h-4 rounded-full border border-border-card shadow-sm shrink-0 text-micro"
                        />
                        <span className="whitespace-nowrap">{shortEmployeeName(llegadaEmp)}</span>
                    </span>
                )}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {tipoInfo && (
                    <Badge variant={tipoInfo.variant} icon={tipoInfo.icon} uppercase={false}>{tipoInfo.label}</Badge>
                )}
                {hasCajasDanadas && (
                    <Badge variant="warning" uppercase={false} icon={AlertTriangle}>Caja{row.cajas_danadas.length > 1 ? 's' : ''} {row.cajas_danadas.map(n => `#${n}`).join(', ')} dañada{row.cajas_danadas.length > 1 ? 's' : ''}</Badge>
                )}
                {reenvios.length > 0 && (
                    <Badge variant="chart-3" icon={Truck} uppercase={false}>{reenvios.length} reenvío{reenvios.length > 1 ? 's' : ''}</Badge>
                )}
                {difResueltas > 0 && (
                    <Badge variant="success" icon={CheckCircle2} uppercase={false}>{difResueltas} dif. resuelta{difResueltas > 1 ? 's' : ''}</Badge>
                )}
                {difPendientes > 0 && (
                    <Badge variant="warning" icon={AlertCircle} uppercase={false}>{difPendientes} dif. pendiente{difPendientes > 1 ? 's' : ''}</Badge>
                )}
            </div>
        </div>
    );
}
