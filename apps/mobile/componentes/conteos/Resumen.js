// Las cifras de un conteo, NATIVAS — las tarjetas de `ConteoDetailView`:
// avance, sin contar (y cuántos contadores), productos (y cuántos agregados a
// mano), no ubicados, diferencias (y cuántas recontadas) y el faltante con su
// sobrante en dinero.
//
// Las diferencias sólo salen si el conteo deja ver el sistema a este cargo
// (`ver_sistema`): en un conteo ciego contarlas ya diría dónde está la cifra.
// El dinero, además, pide `conteo_inventario_ver_montos`, como en el portal.
import { View } from 'react-native';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import Kpi, { FilaDeKpis, Avance } from '../inicio/Kpi';
import { MARCA } from '../inicio/marca';
import { colorSistema } from '../Formulario';

export default function Resumen({ resumen, abierto, verMontos }) {
  if (!resumen) return null;
  const {
    total_items: items = 0, total_productos: productos = 0, contados = 0, pendientes = 0,
    sin_ubicar: sinUbicar = 0, recontados = 0, contadores = 0, agregados = 0,
    con_diferencia: conDifRenglones = 0, valor_faltante: faltBruto = 0, valor_sobrante: sobraBruto = 0, ver_sistema: ver,
    productos_con_diferencia: prodDif, renglones_reacomodo: reacomodados = 0,
    faltante_neto: faltNeto, sobrante_neto: sobraNeto, valor_reacomodado: valorReacomodo = 0,
  } = resumen;
  // Netas por producto (igual que el portal): lo que sólo cambió de lote —sale
  // de «sin lote» y entra en su lote— no es diferencia ni faltante.
  const conDif = prodDif ?? conDifRenglones;
  const falt = Number(faltNeto ?? faltBruto) || 0;
  const sobra = Number(sobraNeto ?? sobraBruto) || 0;
  const muestraSobrante = !(falt > 0) && sobra > 0;
  const apoyoDif = reacomodados > 0
    ? `${formatQty(reacomodados)} renglón${reacomodados === 1 ? '' : 'es'} sólo cambi${reacomodados === 1 ? 'ó' : 'aron'} de lote`
    : (recontados > 0 ? `${formatQty(recontados)} recontada${recontados === 1 ? '' : 's'}` : (prodDif != null ? 'productos que no cuadran' : 'contra la existencia'));
  const apoyoMonto = [
    falt > 0 && sobra > 0 ? `sobrante ${formatMoney(sobra)}` : null,
    Number(valorReacomodo) > 0 ? `${formatMoney(valorReacomodo)} sólo cambia de lote` : null,
  ].filter(Boolean).join(' · ') || (falt > 0 || muestraSobrante ? 'por producto, neto' : 'cuadra');
  const pct = items > 0 ? Math.round((contados / items) * 100) : 0;
  const tarjetas = [
    <Kpi key="avance" icono="CheckCircle2" rotulo="Avance" valor={`${pct}%`} apoyo={`${formatQty(contados)} de ${formatQty(items)} renglones`}
      color={pendientes === 0 ? MARCA.verde : MARCA.azulClaro} visual={<Avance parte={contados} total={items} color={pendientes === 0 ? MARCA.verde : MARCA.azulClaro} />} />,
    <Kpi key="sin" icono="Clock" rotulo="Sin contar" valor={formatQty(pendientes)} pide={pendientes > 0}
      apoyo={contadores > 0 ? `${formatQty(contadores)} contador${contadores === 1 ? '' : 'es'}` : 'nada pendiente'} color={pendientes > 0 ? MARCA.ambar : MARCA.verde} />,
    <Kpi key="prod" icono="Package" rotulo="Productos" valor={formatQty(productos)}
      apoyo={agregados > 0 ? `${formatQty(agregados)} agregado${agregados === 1 ? '' : 's'} a mano` : 'en este conteo'} color={MARCA.azulClaro} />,
    <Kpi key="nou" icono="PackageMinus" rotulo="No ubicados" valor={formatQty(sinUbicar)} pide={sinUbicar > 0}
      apoyo="buscados y no están" color={sinUbicar > 0 ? MARCA.rojo : colorSistema.texto2} />,
    ver ? <Kpi key="dif" icono="AlertTriangle" rotulo={prodDif != null ? 'Con diferencia' : 'Diferencias'} valor={formatQty(conDif)} pide={conDif > 0}
      apoyo={apoyoDif} color={conDif > 0 ? MARCA.ambar : colorSistema.texto2} /> : null,
    ver && verMontos ? <Kpi key="falt" icono="DollarSign" rotulo={`${muestraSobrante ? 'Sobrante' : 'Faltante'}${abierto ? ' parcial' : ''}`}
      valor={formatMoney(muestraSobrante ? sobra : falt)} pide={falt > 0}
      apoyo={apoyoMonto} color={falt > 0 ? MARCA.rojo : colorSistema.texto2} /> : null,
  ].filter(Boolean);
  const filas = [];
  for (let i = 0; i < tarjetas.length; i += 2) filas.push(tarjetas.slice(i, i + 2));
  return filas.map((f, i) => <FilaDeKpis key={i}>{f}{f.length === 1 ? <View style={{ flex: 1 }} /> : null}</FilaDeKpis>);
}
