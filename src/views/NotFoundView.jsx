import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { EmptyState } from '../components/common/StateViews';
import Button from '../components/common/Button';

/**
 * NotFoundView — ruta inexistente (D3.7, 2026-07-27).
 *
 * Antes el catch-all hacía `<Navigate to={defaultRedirect} replace />`: un
 * redirect SILENCIOSO al primer módulo con permiso. El usuario tecleaba una
 * URL vieja o rota y aterrizaba en una pantalla distinta sin explicación,
 * sin forma de saber si el enlace estaba mal o si le faltaba permiso.
 *
 * Se construye sobre el `EmptyState` compartido en vez de inventar un layout
 * propio: una ruta inexistente ES un estado vacío —no hay nada que mostrar—
 * y el sistema ya resolvió cómo se ve eso.
 *
 * Muestra la ruta pedida porque es el dato que convierte "algo falló" en
 * "este enlace está mal": permite copiarla en un reporte o notar el typo.
 */
export default function NotFoundView() {
    const navigate = useNavigate();
    const { pathname } = useLocation();

    return (
        <EmptyState
            icon={Compass}
            title="Esta página no existe"
            subtitle={`No encontramos nada en ${pathname}. Puede que el enlace esté desactualizado o que la dirección tenga un error.`}
            glowClass="bg-chart-3/30"
            iconClass="text-chart-3-text"
            action={
                <Button icon={Home} onClick={() => navigate('/', { replace: true })}>
                    Volver al inicio
                </Button>
            }
        />
    );
}
