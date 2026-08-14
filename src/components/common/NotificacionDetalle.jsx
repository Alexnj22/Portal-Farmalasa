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
    const personasDeSolicitudes = useStaff(s => s.personasDeSolicitudes);
    const resolverPersonas      = useStaff(s => s.resolverPersonasDeSolicitudes);

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

    /* Las dos personas de la solicitud pueden no estar en el maestro de
     * personal: `employees_select` esconde a los cargos `is_su`, y el aprobador
     * real del portal tiene uno. Sin este respaldo, el detalle dentro de la
     * campana muestra «Sin registro» donde va quien aprobó. Se pide al llegar la
     * fila, y sólo lo que falte. */
    useEffect(() => {
        if (!fila) return;
        // Min/Max guarda a quien decidió como el CORREO con el que entró, no
        // como un uuid: va por la otra entrada, con la misma clave que después
        // usa `buscarPersona` para encontrarlo.
        if (esMinMax) resolverPersonas([fila.requested_by_id], [fila.decided_by]);
        else          resolverPersonas([fila.employee_id, fila.approver_id]);
    }, [fila, esMinMax, resolverPersonas]);

    const employeesById = useMemo(() => {
        const m = new Map();
        (employees ?? []).forEach(e => m.set(String(e.id), e));
        Object.entries(personasDeSolicitudes || {}).forEach(([id, p]) => {
            if (!m.has(id)) m.set(id, p);
        });
        return m;
    }, [employees, personasDeSolicitudes]);

    // El empleado se resuelve al PINTAR y no dentro de la carga: el maestro de
    // personal puede llegar después que la solicitud —son dos fuentes—, y
    // sellarlo en el estado dejaría la ficha sin nombre hasta que alguien
    // volviera a desplegarla.
    const req = useMemo(() => {
        if (!fila) return null;
        // El tercer parámetro le pone cara a las dos personas del ajuste: su
        // tabla las guarda como texto —un uuid y el correo de quien decidió— y
        // sin el buscador la ficha muestra la dirección de correo pelada. El
        // respaldo va después del maestro y con la misma clave: quien decide un
        // Min/Max suele ser un cargo que el maestro esconde.
        if (esMinMax) {
            const enElMaestro = buscadorDePersonas(employees);
            return adaptarMinMax(fila, sucursalId => ERP_NAMES[sucursalId],
                (k) => enElMaestro(k) ?? (k ? (personasDeSolicitudes?.[String(k)] ?? null) : null));
        }
        return {
            ...fila,
            employee: employeesById.get(String(fila.employee_id)) ?? null,
            approver: employeesById.get(String(fila.approver_id)) ?? null,
        };
    }, [fila, esMinMax, employees, employeesById, personasDeSolicitudes]);

    if (error) {
        return <p className="text-label font-semibold text-danger-text px-1 py-2">{error}</p>;
    }

    if (!req) {
        return <div className="py-1"><SkeletonText lines={4} /></div>;
    }

    return (
        /* SIN techo ni scroll propio (2026-08-14).
         *
         * Tenía `max-h-[42vh] overflow-y-auto overscroll-contain`, puesto para
         * que un descarte de seis líneas con fotos no empujara las demás
         * notificaciones fuera del alcance. Lo que hacía en el teléfono era lo
         * contrario: medido en WebKit iPhone 13, con el detalle abierto había
         * DOS contenedores anidados desbordando a la vez —éste y la lista—, los
         * dos con `contain`. El dedo caía sobre el detalle, lo llevaba a su
         * fondo y ahí quedaba trabado: el gesto no puede seguir en el padre.
         *
         * Con un solo recorrido —el de la lista— el detalle largo simplemente se
         * sigue deslizando, que es lo que un teléfono espera. */
        <div className="pr-0.5">
            <Suspense fallback={<div className="py-1"><SkeletonText lines={4} /></div>}>
                <DetalleSolicitud req={req} employeesById={employeesById} />
            </Suspense>
        </div>
    );
}
