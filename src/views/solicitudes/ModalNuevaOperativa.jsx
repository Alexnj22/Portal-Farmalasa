import React, { useState, useMemo, lazy, Suspense } from 'react';
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
 * ── El traslado también entra, y por la MISMA puerta (2026-08-18) ─────────
 * «Pedir a otra sala» abre `FormularioPedirASala`, o sea el cuerpo de la
 * consulta de inventario. Entre el 15 y el 18 de agosto abría en cambio un
 * formulario propio, y esa versión producía solicitudes sin lote: detrás de
 * este menú no hay ninguna pantalla de lotes, así que el producto viajaba sin
 * decir de dónde sacarlo. Es exactamente la copia que este archivo existe para
 * no hacer — y acá se pagó en datos, no en líneas.
 *
 * Su `PedirTrasladoModal` se abre ENCIMA de esta ventana, igual que encima de
 * la baldosa del tablero: es la misma pantalla en los dos sitios, con la misma
 * profundidad de diálogos.
 */

const FormularioAjuste = lazy(() =>
    import('../dashboard/WidgetInventoryMovement').then(m => ({ default: m.FormularioAjuste })));
const FormularioFacturacion = lazy(() =>
    import('../dashboard/WidgetAnnulmentRequest').then(m => ({ default: m.FormularioFacturacion })));
const FormularioMinMax = lazy(() =>
    import('../dashboard/WidgetMinMaxRequest').then(m => ({ default: m.FormularioMinMax })));
const FormularioPedirASala = lazy(() =>
    import('../dashboard/WidgetInventorySearch').then(m => ({ default: m.FormularioPedirASala })));

const Cargando = () => (
    <div className="flex-1 min-h-[220px] grid place-items-center">
        <Loader2 size={22} className="animate-spin text-content-3" strokeWidth={2.5} />
    </div>
);

export default function ModalNuevaOperativa({ onClose, hasPermission, branchIdUsuario, alcanceTodas, onEnviado }) {
    const disponibles = useMemo(() => familiasDisponibles(hasPermission), [hasPermission]);

    // Con una sola familia disponible no hay nada que elegir: se entra directo
    // a su formulario. Un menú de una opción es un clic que no informa.
    const [familia, setFamilia] = useState(() => (disponibles.length === 1 ? disponibles[0].key : null));

    const erpPropio = BRANCH_A_ERP[branchIdUsuario] ?? null;
    const [erp, setErp] = useState(() => String(erpPropio ?? 5));
    const [branchFactura, setBranchFactura] = useState(() => String(branchIdUsuario ?? ''));

    /* Lo escrito en el buscador de «Pedir a otra sala». Vive acá y no adentro
       de `FormularioPedirASala` porque la baldosa del tablero lo guarda AFUERA
       de su modal —así sobrevive a cerrarlo y volver a abrirlo— y el componente
       no puede imponerle a una de las dos el comportamiento de la otra. */
    const [q, setQ] = useState('');

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
            /* La consulta de inventario pide más ancho que un formulario: sus
               filas llevan producto, salas, unidades y lotes. Es el MISMO
               `max-w-3xl` de su baldosa en el tablero — la pantalla es una sola,
               así que su ancho también. */
            maxWidth={familia === 'traslado' ? 'max-w-3xl' : 'max-w-2xl'}
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
                        {/* Sin selector de sucursal: acá la sala que RECIBE es
                            siempre la de quien pide —un traslado necesita un
                            destino y ese destino es su sala—, y la que entrega
                            se elige adentro, entre las que de verdad tienen el
                            producto. Ofrecer el selector de arriba dejaría
                            pedirle a nombre de otra sala, que es lo que la base
                            rechaza. */}
                        {familia === 'traslado' && (
                            <FormularioPedirASala query={q} onQueryChange={setQ} onSolicitado={onEnviado} />
                        )}
                    </Suspense>
                );
            }}
        </ModalConRanuras>
    );
}
