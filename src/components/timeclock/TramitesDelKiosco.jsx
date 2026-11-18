import React, { Suspense, lazy } from 'react';
import { BRANCH_A_ERP, ERP_NAMES, ERP_UBICACION_POR_SUCURSAL } from '@nucleo/constants/erp';
import { TRAMITES } from './tramites';
import { LoadingState } from '../common/StateViews';
import { ModalConRanuras } from '../../views/dashboard/LanzadorSolicitud';
import { SoloModalCtx } from '../../views/dashboard/soloModal';

// Los trámites de Inicio · Operación en el kiosco de caja (usuario, 2026-11-18:
// «no quiero esos widgets, quiero unos botones como los demás, que abran los
// modales de esos widgets»).
//
// Cada botón abre EL MISMO modal que su baldosa del Inicio: las baldosas se
// montan dentro de `SoloModalCtx`, que hace que `LanzadorSolicitud` no pinte la
// tarjeta y abra el modal directo. Los widgets que no son baldosa (precios,
// recetas…) van dentro de un modal con ranuras. Cada uno con SU permiso: lo
// que el cargo de quien entró no puede usar, no sale. Clientes no está: Vender
// ya busca, crea y corrige al cliente.
const BaldosaFacturacion = lazy(() => import('../../views/dashboard/baldosas/BaldosaFacturacion'));
const BaldosaMinMax = lazy(() => import('../../views/dashboard/baldosas/BaldosaMinMax'));
const BaldosaInventario = lazy(() => import('../../views/dashboard/baldosas/BaldosaInventario'));
const WidgetInventorySearch = lazy(() => import('../../views/dashboard/WidgetInventorySearch'));
const WidgetTransferRequests = lazy(() => import('../../views/dashboard/WidgetTransferRequests'));
const WidgetBitacoras = lazy(() => import('../../views/dashboard/WidgetBitacoras'));
const WidgetRecetasPendientes = lazy(() => import('../../views/dashboard/WidgetRecetasPendientes'));
const WidgetReservas = lazy(() => import('../../views/dashboard/WidgetReservas'));
const WidgetConsultaPrecios = lazy(() => import('../../views/dashboard/WidgetConsultaPrecios'));

function Contenido({ clave, sala, todas }) {
    const erp = BRANCH_A_ERP[sala] ?? null;
    switch (clave) {
        case 'facturacion': return <BaldosaFacturacion selectedBranchId={todas('dash_annulment_req') ? String(sala) : null} />;
        case 'inventario': return <BaldosaInventario erpSucursalId={erp} branchId={Number(sala)} branchName={ERP_NAMES[erp] ?? ''}
            erpUbicacionId={ERP_UBICACION_POR_SUCURSAL[erp] ?? null} />;
        case 'existencias': return <WidgetInventorySearch />;
        case 'traslados': return <WidgetTransferRequests />;
        case 'minmax': return <BaldosaMinMax selectedErp={erp} />;
        case 'precios': return <WidgetConsultaPrecios />;
        case 'reservas': return <WidgetReservas />;
        case 'recetas': return <WidgetRecetasPendientes />;
        case 'bitacoras': return <WidgetBitacoras />;
        default: return null;
    }
}

/** El modal de un trámite, abierto. `onCerrar` al cerrarlo. */
export default function TramiteAbierto({ clave, sala, todas, onCerrar }) {
    const t = TRAMITES.find((x) => x.clave === clave);
    if (!t) return null;
    if (t.baldosa) {
        return (
            <SoloModalCtx.Provider value={{ onCerrar }}>
                <Suspense fallback={null}>
                    <Contenido clave={clave} sala={sala} todas={todas} />
                </Suspense>
            </SoloModalCtx.Provider>
        );
    }
    return (
        <ModalConRanuras icon={t.icon} label={t.label} descripcion={t.description} maxWidth="max-w-3xl" onClose={onCerrar}>
            {() => (
                <div className="min-h-[50vh] flex flex-col">
                    <Suspense fallback={<LoadingState className="flex-1" />}>
                        <Contenido clave={clave} sala={sala} todas={todas} />
                    </Suspense>
                </div>
            )}
        </ModalConRanuras>
    );
}
