import React, { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { esOperativa } from '@nucleo/store/slices/requestsSlice';
import { fetchApprovalRequestById } from '@nucleo/data/requests';
import { reglasDeBandeja } from '@nucleo/utils/bandejaDeSolicitudes';
import { useDecidirSolicitud } from '@nucleo/hooks/useDecidirSolicitud';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

const ModalSolicitud = lazy(() =>
    import('../solicitudes/TarjetaSolicitud').then(m => ({ default: m.ModalSolicitud })));

/* Decidir una solicitud SIN salir del Inicio (paso 3 de la propuesta de
 * widgets, 2026-11-05).
 *
 * No es una tercera forma de aprobar: abre el MISMO diálogo que usan la
 * bandeja de Solicitudes y la campana (`ModalSolicitud`), con su detalle a la
 * vista, y decide con el MISMO `useDecidirSolicitud`. Aprobar sin haber visto
 * lo que se aprueba es justo lo que se le quitó a la campana, así que acá
 * tampoco hay un «Aprobar» suelto en la fila.
 *
 * Quién puede decidir sale de `reglasDeBandeja`, la regla de la bandeja, con
 * el permiso del ÁMBITO de cada solicitud: el Inicio mezcla las de sala y las
 * personales, y cada una se decide con el suyo. Sin permiso el diálogo se
 * abre igual, sólo para mirar.
 *
 * La fila del widget es un resumen (`id, type, employee_id, metadata`), así
 * que al tocarla se relee la solicitud entera: es también lo que evita
 * ofrecer «Aprobar» sobre algo que otra persona ya resolvió. */
export function useSolicitudEnInicio({ onResuelta } = {}) {
    const { user, hasPermission, getScope } = useAuth();
    const employees = useStaff(s => s.employees);
    const miId = String(user?.id ?? '');

    const employeesById = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);

    const [abierta, setAbierta] = useState(null);   // la fila completa
    const [cargandoId, setCargandoId] = useState(null);

    const cerrar = useCallback(() => setAbierta(null), []);
    const { decidir, ocupado } = useDecidirSolicitud({
        onAplicado: ({ req }) => { setAbierta(null); onResuelta?.(req.id); },
    });

    const puedeDecidir = useCallback((req) => {
        const modulo = esOperativa(req?.type) ? 'requests' : 'requests_personales';
        const soloMio = getScope(modulo) === 'MINE';
        const canApprove = hasPermission(modulo, 'can_approve') && !soloMio;
        return reglasDeBandeja({ miId, soloMio, canApprove, hasPermission }).puedeDecidir(req);
    }, [getScope, hasPermission, miId]);

    // Sin try/finally a propósito: el compilador de React abandona el
    // componente con él (medido en `useAccionesDeAviso`).
    const abrir = useCallback(async (id) => {
        if (!id || cargandoId) return;
        setCargandoId(id);
        const { data, error } = await fetchApprovalRequestById(id).then(r => r, e => ({ error: e }));
        setCargandoId(null);
        // `.single()` sin fila es PGRST116: la solicitud ya no está (o el RLS
        // dejó de mostrarla), que no es lo mismo que una lectura rota.
        if (!data || error?.code === 'PGRST116') {
            if (!error || error.code === 'PGRST116') {
                useToastStore.getState().showToast('Ya no está', 'Esta solicitud ya no está disponible.', 'info');
                onResuelta?.(id);
                return;
            }
            useToastStore.getState().showToast('No se pudo abrir',
                mensajeAmigable(error, 'No se pudo leer la solicitud.'), 'error');
            return;
        }
        if (data.status !== 'PENDING') {
            useToastStore.getState().showToast('Ya estaba resuelta',
                'Alguien más la decidió mientras tanto.', 'info');
            onResuelta?.(data.id);
            return;
        }
        setAbierta(data);
    }, [cargandoId, onResuelta]);

    const dialogo = abierta && (
        <Suspense fallback={null}>
            <ModalSolicitud
                key={abierta.id}
                req={abierta}
                canApprove={puedeDecidir(abierta)}
                employeesById={employeesById}
                ocupado={ocupado}
                onCerrar={() => !ocupado && cerrar()}
                onDecidir={decidir}
            />
        </Suspense>
    );

    return { abrir, cargandoId, dialogo };
}
