import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { SkeletonText } from './StateViews';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { fetchApprovalRequestById } from '../../data/requests';
import { fetchMinMaxChangeRequestById } from '../../data/minmaxRequests';
import { adaptarMinMax } from '../../store/slices/requestsSlice';
import { ERP_NAMES } from '../../constants/erp';
import { buscadorDePersonas } from '../../views/solicitudes/movimientoTexto';
import { mensajeAmigable } from '../../utils/errorMessages';

// El detalle de una solicitud, DENTRO de la campana.
//
// El aviso decía «QA Testing solicita cambiar el cliente de 0000081059_COF…» y
// se cortaba a tres renglones: para saber qué producto se descarta, de qué
// factura se habla o de cuánto a cuánto va un Min/Max había que salir a
// Solicitudes. O sea que decidir desde la campana era decidir a ciegas — el
// mismo punto ciego que ya se había corregido un nivel más abajo cuando el
// diálogo de aprobar/rechazar pasó a mostrar el detalle antes de la decisión.
//
// ── Se REUSA `DetalleSolicitud`, no se escribe otro ────────────────────────
// Es el canónico de las tres pantallas de solicitudes y cubre los trece tipos,
// con las líneas de producto, las fotos de evidencia y los bloques de
// facturación. Escribir acá una versión «para el panel» habría sido la cuarta
// copia, y la historia del archivo es justamente que las copias se separan.
//
// Va por `lazy` a propósito: la campana vive en `AppLayout`, o sea que viaja en
// el chunk que se baja SIEMPRE, y el detalle sólo hace falta cuando alguien
// despliega una fila. Sin el `lazy`, cada carga del portal pagaría el detalle de
// solicitudes aunque nadie abriera la campana.
const DetalleSolicitud = lazy(() => import('../../views/solicitudes/DetalleSolicitud'));

/**
 * @param notif  La notificación. Necesita `metadata.request_id`; con
 *               `metadata.request_type === 'MINMAX'` la solicitud se busca en la
 *               otra tabla (ver abajo).
 */
export default function NotificacionDetalle({ notif }) {
    const employees = useStaff(s => s.employees);

    const [fila,  setFila]  = useState(null);
    const [error, setError] = useState('');

    const id       = notif.metadata?.request_id ?? null;
    const esMinMax = notif.metadata?.request_type === 'MINMAX';

    // Min/Max vive en `minmax_change_requests`, con otras columnas y otro ciclo.
    // `adaptarMinMax` es el MISMO adaptador que usa el centro de solicitudes
    // para mezclarlas con las demás: sin él habría que decidir acá otra vez qué
    // columna es el motivo y cuál el estado, y las dos lecturas se separarían.
    useEffect(() => {
        if (!id) return;
        let vivo = true;
        // Sin limpiar el error acá: sería un `setState` sincrónico en el cuerpo
        // del efecto (render en cascada, lo marca `react-hooks/set-state-in-effect`)
        // y encima no haría falta — este componente se monta al desplegar la fila
        // y se desmonta al cerrarla, así que su estado nace limpio cada vez.
        const pedir = esMinMax
            ? fetchMinMaxChangeRequestById(id)
            : fetchApprovalRequestById(id);

        pedir
            .then(({ data, error: err }) => {
                if (!vivo) return;
                if (err) throw err;
                if (!data) { setError('Esta solicitud ya no está disponible.'); return; }
                setFila(data);
            })
            .catch(err => { if (vivo) setError(mensajeAmigable(err, 'No se pudo abrir el detalle.')); });

        return () => { vivo = false; };
    }, [id, esMinMax]);

    const employeesById = useMemo(() => {
        const m = new Map();
        (employees ?? []).forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);

    // El empleado se resuelve al PINTAR y no dentro de la carga: el maestro de
    // personal puede llegar después que la solicitud —son dos fuentes—, y
    // sellarlo en el estado dejaría la ficha sin nombre hasta que alguien
    // volviera a desplegarla.
    const req = useMemo(() => {
        if (!fila) return null;
        // El tercer parámetro le pone cara a las dos personas del ajuste: su
        // tabla las guarda como texto —un uuid y el correo de quien decidió— y
        // sin el buscador la ficha muestra la dirección de correo pelada.
        if (esMinMax) return adaptarMinMax(fila, sucursalId => ERP_NAMES[sucursalId],
            buscadorDePersonas(employees));
        return {
            ...fila,
            employee: employeesById.get(String(fila.employee_id)) ?? null,
            approver: employeesById.get(String(fila.approver_id)) ?? null,
        };
    }, [fila, esMinMax, employees, employeesById]);

    if (error) {
        return <p className="text-label font-semibold text-danger-text px-1 py-2">{error}</p>;
    }

    if (!req) {
        return <div className="py-1"><SkeletonText lines={4} /></div>;
    }

    return (
        // Techo propio: el detalle de un descarte con seis líneas y sus fotos es
        // más alto que la lista entera, y sin tope empuja las demás
        // notificaciones fuera del alcance del scroll del panel.
        <div className="max-h-[42vh] overflow-y-auto overscroll-contain pr-0.5
                        [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <Suspense fallback={<div className="py-1"><SkeletonText lines={4} /></div>}>
                <DetalleSolicitud req={req} employeesById={employeesById} />
            </Suspense>
        </div>
    );
}
