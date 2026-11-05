import React, { useCallback, useEffect, useRef, useState } from 'react';
import useRefrescoEnVivo from '@nucleo/hooks/useRefrescoEnVivo';
import { SkeletonText } from '../../components/common/StateViews';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fetchMesEnCurso } from '@nucleo/data/metas';
import { useAuth } from '@nucleo/context/AuthContext';
import RankingVendedores from '../metas/RankingVendedores';
import { useResumenWidget } from './tamanoWidget';
import { rankingDeVendedores } from '@nucleo/utils/metasUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

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
    const { hasPermission, user } = useAuth();
    const vistaCompleta = hasPermission('dash_vendedores_vista_completa');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Sólo la ÚLTIMA lectura escribe: una respuesta lenta de un ciclo anterior
    // —o de la sala de antes— no pisa a una más nueva.
    const secuencia = useRef(0);
    const cargar = useCallback(() => {
        const mia = ++secuencia.current;
        fetchMesEnCurso(selectedBranchId)
            .then((d) => { if (mia === secuencia.current) { setData(d); setError(null); setLoading(false); } })
            .catch((err) => { if (mia === secuencia.current) { setError(mensajeAmigable(err, 'No se pudo cargar el ranking')); setLoading(false); } });
    }, [selectedBranchId]);

    // Se refresca solo, igual que el widget de la meta: un ranking congelado
    // desde las 8 de la mañana miente sobre quién va ganando. Con la pestaña
    // oculta no consulta; al volver, lee una vez si ya venció el ciclo.
    useEffect(() => {
        cargar();
        return () => { secuencia.current += 1; };
    }, [cargar]);
    useRefrescoEnVivo(cargar, { ms: REFRESCO_MS });

    // El vistazo decía «Ranking del mes» y nada más: en una tarjeta angosta era
    // una caja vacía. Ahora dice quién va primero —con el mismo orden del
    // ranking (`rankingDeVendedores`)—.
    //
    // Y si quien mira VENDE (está en el ranking), en chico lo que le importa es
    // SU puesto, no el del líder (2026-11-05). La meta es por sala, no por
    // persona, así que no hay un «avance contra tu meta» que mostrar: el puesto
    // es la medida que existe.
    const filas = data ? rankingDeVendedores(data, 'total').filas ?? [] : [];
    const primero = filas[0] ?? null;
    const miPuesto = user?.id != null ? filas.findIndex(v => String(v.employee_id) === String(user.id)) : -1;
    useResumenWidget(loading ? null
        : error ? { texto: 'No se pudo cargar', tono: 'danger' }
        : !primero ? { texto: 'Sin ventas este mes' }
        : miPuesto > 0 ? { valor: `#${miPuesto + 1}`, texto: `tu puesto de ${filas.length} · va primero ${shortEmployeeName(primero.nombre)}`, tono: 'brand' }
        : miPuesto === 0 ? { valor: '#1', texto: `vas primero de ${filas.length}`, tono: 'success' }
        : { valor: '#1', texto: shortEmployeeName(primero.nombre) });

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
