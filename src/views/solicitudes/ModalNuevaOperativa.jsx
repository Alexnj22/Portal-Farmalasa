import React, { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { PackageMinus, ChevronRight, Loader2 } from 'lucide-react';
import { ModalConRanuras } from '../dashboard/LanzadorSolicitud';
import { FAMILIAS, familiasDisponibles } from './familiasOperativas';
import LiquidSelect from '../../components/common/LiquidSelect';
import {
    ERP_NAMES, ERP_ORDEN, BRANCH_A_ERP, ERP_UBICACION_POR_SUCURSAL,
} from '../../constants/erp';

/**
 * «Nueva solicitud» en Solicitudes de Sucursal.
 *
 * ── Por qué no hay formularios nuevos acá ─────────────────────────────────
 * Los tres que abre son **los mismos** que las baldosas del tablero: el ajuste
 * de inventario, la modificación a facturación y el ajuste de Min/Max. Vivían
 * encerrados dentro de sus widgets —sin exportar— así que la única puerta era
 * la baldosa: quien entraba al centro de solicitudes a ver la cola no tenía
 * desde dónde abrir una, y tenía que volver al inicio.
 *
 * Escribir versiones propias habría sido la cuarta copia de cada uno. Lo que se
 * hizo fue exportarlos y separar de `LanzadorSolicitud` su modal con ranuras,
 * que es la mitad que no depende de la baldosa.
 *
 * ── Se cargan tarde, a propósito ──────────────────────────────────────────
 * Los tres archivos suman ~3,000 líneas con sus catálogos. Importados de
 * frente viajarían en el paquete de la vista y se pagarían al ENTRAR a
 * Solicitudes, que es lo que hace todo el mundo, para un botón que aprieta
 * poca gente. Con `lazy` el peso lo paga quien lo abre.
 *
 * ── El traslado entra, pero no por acá adentro ────────────────────────────
 * Desde el 2026-08-15 «Pedir a otra sala» es la cuarta familia. Su formulario
 * ya tiene primera pantalla —el buscador de producto se extrajo a
 * `BuscadorDeProducto`, así que no hubo que escribirle uno propio, que era la
 * copia que este archivo existe para no hacer—, pero vive dentro de su propio
 * `LiquidModal`. Meterlo en una ranura serían dos diálogos encimados, así que
 * lo que se hace es avisar hacia arriba (`onPedirTraslado`): esta ventana se
 * cierra y la pantalla abre la otra.
 */

const FormularioAjuste = lazy(() =>
    import('../dashboard/WidgetInventoryMovement').then(m => ({ default: m.FormularioAjuste })));
const FormularioFacturacion = lazy(() =>
    import('../dashboard/WidgetAnnulmentRequest').then(m => ({ default: m.FormularioFacturacion })));
const FormularioMinMax = lazy(() =>
    import('../dashboard/WidgetMinMaxRequest').then(m => ({ default: m.FormularioMinMax })));

const Cargando = () => (
    <div className="flex-1 min-h-[220px] grid place-items-center">
        <Loader2 size={22} className="animate-spin text-content-3" strokeWidth={2.5} />
    </div>
);

export default function ModalNuevaOperativa({ onClose, hasPermission, branchIdUsuario, alcanceTodas, onPedirTraslado }) {
    const disponibles = useMemo(() => familiasDisponibles(hasPermission), [hasPermission]);

    // Con una sola familia disponible no hay nada que elegir: se entra directo
    // a su formulario. Un menú de una opción es un clic que no informa.
    const [familia, setFamilia] = useState(() => (disponibles.length === 1 ? disponibles[0].key : null));

    /* El traslado no se dibuja acá: se delega. Va en un efecto y no en el
       `onClick` porque hay DOS caminos hasta acá —el clic en la baldosa y el
       atajo de arriba cuando es la única familia disponible— y sólo uno pasa
       por el clic. Con la comprobación en un solo sitio, quien tenga
       únicamente este permiso abriría un modal vacío. */
    useEffect(() => {
        if (familia === 'traslado') onPedirTraslado?.();
    }, [familia, onPedirTraslado]);

    const erpPropio = BRANCH_A_ERP[branchIdUsuario] ?? null;
    const [erp, setErp] = useState(() => String(erpPropio ?? 5));
    const [branchFactura, setBranchFactura] = useState(() => String(branchIdUsuario ?? ''));

    const elegida = FAMILIAS.find(f => f.key === familia) ?? null;

    // El selector de sala se ofrece SOLO con alcance sobre todas. Con alcance
    // de sucursal la base rechaza cualquier otra, así que ofrecerlo prometería
    // un alcance que no existe.
    const selectorErp = alcanceTodas ? (
        <LiquidSelect
            value={erp}
            onChange={v => setErp(v ?? String(erpPropio ?? 5))}
            options={ERP_ORDEN.map(id => ({ value: String(id), label: ERP_NAMES[id] }))}
            placeholder="Sucursal..."
            clearable={false}
        />
    ) : null;

    const selectorSala = alcanceTodas ? (
        <LiquidSelect
            value={branchFactura}
            onChange={v => setBranchFactura(v ?? String(branchIdUsuario ?? ''))}
            options={Object.entries(BRANCH_A_ERP)
                .map(([bid, eid]) => ({ value: String(bid), label: ERP_NAMES[eid], orden: ERP_ORDEN.indexOf(eid) }))
                .sort((a, b) => a.orden - b.orden)}
            placeholder="Sucursal..."
            clearable={false}
        />
    ) : null;

    const erpNum   = Number(erp);
    const branchDe = Number(Object.keys(BRANCH_A_ERP).find(b => BRANCH_A_ERP[b] === erpNum) ?? 0) || null;

    return (
        <ModalConRanuras
            icon={elegida?.icon ?? PackageMinus}
            label={elegida?.label ?? 'Nueva solicitud'}
            descripcion={elegida?.desc ?? 'Qué se va a pedir'}
            onClose={onClose}
        >
            {(cerrar) => {
                if (!familia) {
                    return (
                        <div className="flex flex-col gap-2 flex-1 min-h-0">
                            {disponibles.map(({ key, icon: Icon, label, desc, color, bg, iconBg }) => (
                                <button key={key} type="button" onClick={() => setFamilia(key)}
                                    className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left hover:translate-y-[var(--lift-hover)] transition-all ${bg}`}>
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                                        <Icon size={15} strokeWidth={2} className={color} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-body-sm font-black ${color}`}>{label}</p>
                                        <p className="text-caption text-content-3 mt-0.5">{desc}</p>
                                    </div>
                                    <ChevronRight size={13} strokeWidth={2.5} className="text-content-3 shrink-0" />
                                </button>
                            ))}
                        </div>
                    );
                }

                // El traslado se abre por fuera; mientras el aviso viaja hacia
                // arriba, esta ventana muestra el mismo giro que las otras en
                // vez de un hueco.
                if (familia === 'traslado') return <Cargando />;

                return (
                    <Suspense fallback={<Cargando />}>
                        {familia === 'inventario' && (
                            <FormularioAjuste
                                erpSucursalId={erpNum}
                                branchId={branchDe}
                                branchName={ERP_NAMES[erpNum] ?? ''}
                                erpUbicacionId={ERP_UBICACION_POR_SUCURSAL[erpNum] ?? null}
                                selectorSucursal={selectorErp}
                                onHecho={cerrar}
                            />
                        )}
                        {familia === 'facturacion' && (
                            <div className="flex flex-col gap-3 flex-1 min-h-0">
                                {selectorSala}
                                <FormularioFacturacion selectedBranchId={alcanceTodas ? branchFactura : null} />
                            </div>
                        )}
                        {familia === 'minmax' && (
                            <div className="flex flex-col gap-3 flex-1 min-h-0">
                                {selectorErp}
                                <FormularioMinMax selectedErp={erpNum} />
                            </div>
                        )}
                    </Suspense>
                );
            }}
        </ModalConRanuras>
    );
}
