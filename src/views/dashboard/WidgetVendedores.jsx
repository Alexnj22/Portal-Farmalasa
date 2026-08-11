import React, { useCallback, useEffect, useState } from 'react';
import { SkeletonText } from '../../components/common/StateViews';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchMesEnCurso } from '../../data/metas';
import { useAuth } from '../../context/AuthContext';
import RankingVendedores from '../metas/RankingVendedores';

// Quién está vendiendo, en el Inicio de la sala. Es el MISMO componente que usa
// el tablero del módulo (`RankingVendedores`): el ranking, el promedio y el
// interruptor «total / por día trabajado» viven en un solo lugar. Si esta
// pantalla trajera su propia copia, un día una diría una cosa y la otra otra.
//
// El scope lo impone el servidor: con alcance de una sola sala el parámetro se
// ignora y devuelve la suya. Acá no hay candado que valga — el del navegador es
// decorativo.
const REFRESCO_MS = 5 * 60 * 1000;

export default function WidgetVendedores({ selectedBranchId = null }) {
    // `dash_vendedores_vista_completa` decide si el ranking dice montos o
    // porcentajes. El módulo Metas —que es supervisión— usa el mismo componente
    // sin la prop y ve siempre la versión completa.
    const { hasPermission } = useAuth();
    const vistaCompleta = hasPermission('dash_vendedores_vista_completa');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const cargar = useCallback(() => {
        let vivo = true;
        fetchMesEnCurso(selectedBranchId)
            .then((d) => { if (vivo) { setData(d); setError(null); setLoading(false); } })
            .catch((err) => { if (vivo) { setError(mensajeAmigable(err, 'No se pudo cargar el ranking')); setLoading(false); } });
        return () => { vivo = false; };
    }, [selectedBranchId]);

    // Se refresca solo, igual que el widget de la meta: un ranking congelado
    // desde las 8 de la mañana miente sobre quién va ganando.
    useEffect(() => {
        const cancelar = cargar();
        const timer = setInterval(cargar, REFRESCO_MS);
        const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
        document.addEventListener('visibilitychange', alVolver);
        return () => {
            cancelar();
            clearInterval(timer);
            document.removeEventListener('visibilitychange', alVolver);
        };
    }, [cargar]);

    if (loading) return <div className="p-1"><SkeletonText lines={5} /></div>;

    if (error) {
        return (
            <div className="h-full flex items-center justify-center px-4 text-center">
                <p className="text-body-sm font-bold text-danger-text">{error}</p>
            </div>
        );
    }

    if (!data) return null;

    // `compacto`: dentro de un widget la nota al pie sobra — el espacio es poco
    // y la regla del promedio ya la dice cada fila.
    return <RankingVendedores data={data} compacto vistaCompleta={vistaCompleta} />;
}
