// Extracted from TabPedidos.jsx (Bloque 6.C)
import { PackageCheck, AlertTriangle, PackageX, Truck, Database, UserPlus } from 'lucide-react';
import Badge from '../../../components/common/Badge';
import LiquidAvatar from '../../../components/common/LiquidAvatar';
import Button from '../../../components/common/Button';
import Notice from '../../../components/common/Notice';
import { shortEmployeeName } from '../../../utils/nameUtils';

// Mismas etiquetas que LLEGADA_TIPO_INFO en PostCompletionSection.jsx (solo
// el texto — el estilo de esta tarjeta sigue el patrón "completado" propio
// de este componente, ver bloque "Confirmado en Sistema de Ventas").
const LLEGADA_TIPO_LABEL = {
    completa:    'sin novedad',
    caja_danada: 'caja dañada',
    falta_caja:  'caja faltante',
    mixto:       'daños + faltantes',
};

// Quién apoya la recepción NO se dibuja acá: es del pedido entero, no de este
// bloque de botones, y vive con nombre en la línea de tiempo (ver
// `LifecycleTimeline`, bloque «Apoyo en recepción»). Acá había una pila de caras
// de 16px sin nombre, repetida en dos filas de este mismo componente.
//
// ── Los seis avisos son `Notice`, no seis divs (2026-08-15) ────────────────
// Este bloque tenía la anatomía de `Notice` —ícono + texto + acción a la
// derecha, sobre un tinte semántico— escrita a mano SEIS veces, con tres
// discrepancias que sólo se ven al ponerlas en columna: dos bordes al /20 y dos
// al /30 para el mismo tinte al /10, el ícono de «Llegada confirmada» pintado
// con el acento crudo (`text-success`) mientras su texto usaba el `-text`
// —justo el bug que el encabezado de `Notice` documenta y da 2.16:1—, y el
// intercambio ícono↔spinner armado a mano en dos botones que ya lo traen en
// `loading`. Repetir el canónico es cómo se desincronizan: importarlo no es
// adoptarlo.
//
// La legibilidad de estos avisos NO se arregló acá: su causa era el material
// (§5.bis.1 de DESIGN.md, el escalón anidado iba al revés en Liquid claro).
// Sobre eso siguen quedando cortos contra AA y está anotado allá.
export default function ReceptionActions({ llegadaOk, erpOk, onMarkLlegada, onOpenRecibir, onOpenReenvioModal, onSegundaLlegada, onApoyo, busy, llegadaEmp, erpEmp, pendientesCount = 0, llegadaTipo, reenviosHistorial = [], faltaCajas = [], cajasDanadas = [], hasFaltaItems = false, reenvioBodygaAt = null, segundaLlegadaAt = null, canEdit = true }) {
    // Sin permiso para gestionar pedidos NO se pinta ningún botón. Antes se
    // pintaban todos y ninguno podía funcionar: la base rechaza la escritura y
    // el 2026-08-14 eso costó una recepción entera, contada dos veces contra
    // una pantalla que decía que sí. Los avisos de estado se quedan —ver qué
    // pasó con el pedido es lo que sí puede hacer— pero sin nada que apretar.
    const accion = (btn) => canEdit ? btn : null;
    // `photo || photo_url`: el bucket de fotos es privado, así que la URL que se
    // puede pintar es la FIRMADA y vive en `photo`; `photo_url` es la cruda que
    // se guarda en la base. Mirando sólo `photo_url`, la cara de quien confirmó
    // la llegada salía como un monigote gris aunque su foto estuviera ahí — dos
    // renglones más arriba, en la línea de tiempo, se veía bien.
    const empChip = (emp) => emp ? (
        <span className="flex items-center gap-1 text-caption text-content-3">
            <LiquidAvatar
                src={emp.photo || emp.photo_url}
                alt=""
                fallbackText={shortEmployeeName(emp)}
                className="w-4 h-4 rounded-full border border-border-card shadow-sm shrink-0 text-micro"
            />
            <span className="whitespace-nowrap">{shortEmployeeName(emp)}</span>
        </span>
    ) : null;

    const apoyoBtn = (
        <Button variant="secondary" icon={UserPlus} onClick={onApoyo}>Apoyo</Button>
    );

    // Estado de reenvíos — ciclo pendiente de llegada
    // Fallback para pedidos viejos: si no hay historial pero reenvio_bodega_at está seteado, sintetizar un ciclo virtual
    const cicloEnCamino = reenviosHistorial.find(c => c.sent_at && !c.arrived_at)
        ?? (reenvioBodygaAt && !segundaLlegadaAt && faltaCajas.length > 0
            ? { sent_at: reenvioBodygaAt, cajas: faltaCajas, ciclo: 1, _legacy: true }
            : null);
    const hasFaltaPendiente  = faltaCajas.length > 0;
    const hasDanadaPendiente = cajasDanadas.length > 0;

    // ¿Cuántos ciclos de reenvío se han completado? (todos tienen arrived_at)
    // Para pedidos viejos: "resuelto" cuando segunda_llegada_at está seteado
    const todosReenviosResueltos = reenviosHistorial.length > 0
        ? reenviosHistorial.every(c => c.arrived_at)
        : !!segundaLlegadaAt;

    return (
        <div className="border-t border-divider px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 mb-2">
                {/* `content-2` y no `content-3`: es el encabezado de la sección,
                    no un dato secundario, y medido sobre la tarjeta pintada el
                    terciario daba 2.86:1 (4.2 ya con el material arreglado) —
                    los dos por debajo de AA. El secundario da 5.3:1. */}
                <span className="text-caption font-semibold text-content-2 uppercase tracking-wide">Recepción</span>
                {!canEdit && (
                    <Badge variant="neutral" size="sm" uppercase={false}>Solo lectura — tu cargo no recibe pedidos</Badge>
                )}
            </div>

            {/* Paso 1: Llegada — solo visible cuando aún no confirmada */}
            {!llegadaOk && (
                <Notice variant="info" icon={PackageCheck}
                    action={accion(<Button loading={busy === 'llegada'} onClick={onMarkLlegada}>Confirmar</Button>)}>
                    Paso 1 — Confirmar llegada de cajas
                </Notice>
            )}

            {/* Confirmado: llegada de cajas (7A.5) */}
            {llegadaOk && (
                <Notice variant="success" icon={PackageCheck} action={empChip(llegadaEmp)}>
                    Llegada confirmada{llegadaTipo && LLEGADA_TIPO_LABEL[llegadaTipo] ? ` — ${LLEGADA_TIPO_LABEL[llegadaTipo]}` : ''}
                </Notice>
            )}

            {/* Badges compactos: cajas dañadas + faltantes */}
            {llegadaOk && (hasDanadaPendiente || (hasFaltaPendiente && !cicloEnCamino && !todosReenviosResueltos)) && (
                <div className="flex flex-wrap gap-1.5">
                    {hasDanadaPendiente && cajasDanadas.map(n => (
                        <Badge key={`d${n}`} variant="warning" icon={AlertTriangle} uppercase={false}>#{n} dañada</Badge>
                    ))}
                    {hasFaltaPendiente && !cicloEnCamino && !todosReenviosResueltos && faltaCajas.map(n => (
                        <Badge key={`f${n}`} variant="danger" icon={PackageX} uppercase={false}>#{n} no llegó</Badge>
                    ))}
                </div>
            )}

            {/* Banner: reenvío en camino — mostrar por cada ciclo activo */}
            {llegadaOk && cicloEnCamino && (
                <Notice variant="chart-3" icon={Truck}
                    action={accion(
                        <Button tone="chart-3" disabled={!!busy} loading={busy === 'segunda_llegada'}
                            onClick={onSegundaLlegada}>Confirmar llegada</Button>,
                    )}>
                    {reenviosHistorial.length > 1 ? `Reenvío ${cicloEnCamino.ciclo} en camino` : 'Reenvío en camino'}
                    {(cicloEnCamino.cajas ?? []).length > 0 && ` — caja${cicloEnCamino.cajas.length > 1 ? 's' : ''} ${cicloEnCamino.cajas.map(n => `#${n}`).join(', ')}`}
                    {(cicloEnCamino.electrolits ?? 0) > 0 && ` · ${cicloEnCamino.electrolits} Electrolit`}
                    {(cicloEnCamino.especiales ?? []).length > 0 && ` · ${cicloEnCamino.especiales.join(', ')}`}
                </Notice>
            )}

            {/* Revisar items del reenvío (después de confirmar la segunda llegada) */}
            {llegadaOk && todosReenviosResueltos && !hasFaltaPendiente && hasFaltaItems && (
                <Notice variant="chart-3" icon={Database}
                    action={accion(<Button tone="chart-3" disabled={!!busy} onClick={onOpenReenvioModal}>Revisar</Button>)}>
                    Revisar caja del reenvío en Sistema de Ventas
                </Notice>
            )}

            {/* Paso 2: Confirmar en Sistema de Ventas */}
            {llegadaOk && !erpOk && (
                <Notice variant="chart-3" icon={Database}
                    /* Dos botones en la ranura, así que van envueltos — pero la
                       envoltura sólo existe si hay algo adentro: `accion()`
                       devuelve null sin permiso, y un `<span>` vacío igual
                       dispara la ranura del canónico y deja un hueco. */
                    action={canEdit ? (
                        <span className="flex items-center gap-1.5">
                            {apoyoBtn}
                            <Button tone="chart-3" disabled={!!busy} onClick={onOpenRecibir}>Confirmar</Button>
                        </span>
                    ) : null}>
                    Paso 2 — Confirmar en Sistema de Ventas {pendientesCount > 0 ? `(${pendientesCount})` : ''}
                </Notice>
            )}

            {/* Completado en ERP */}
            {erpOk && (
                <Notice variant="success" icon={Database} action={empChip(erpEmp)}>
                    Confirmado en Sistema de Ventas
                </Notice>
            )}
        </div>
    );
}
