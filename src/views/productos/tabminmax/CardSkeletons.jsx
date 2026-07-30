import StatCard from '../../../components/common/StatCard';

/**
 * El esqueleto de las tarjetas de costo. Ya no dibuja barras propias: `StatCard`
 * tiene `loading`, y con él el hueco mide EXACTAMENTE lo que va a medir la
 * tarjeta cargada — antes eran cajas a mano de otro alto, así que la fila daba
 * un salto al llegar los datos.
 */
export default function CardSkeletons({ isBodega }) {
    const count = isBodega ? 2 : 4;
    return Array.from({ length: count }).map((_, i) => (
        <StatCard key={i} icon={() => null} label="" value="" loading />
    ));
}
