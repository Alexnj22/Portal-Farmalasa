// Compras a partes relacionadas de Torogoz, NATIVO — `ReporteRelacionadas` del
// portal: lo que la distribuidora le compró a empresas del grupo en el año, con
// las referencias de precio de mercado y los mismos avisos que la compra. Es
// papel de trabajo para el contador: el F-982 y el margen los decide él.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fetchRelacionadas } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { aniosRecientes, csvRelacionadas, filasRelacionadas } from '@nucleo/utils/distribucionReportes';
import { hoySV } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { MenuDeFiltros } from '../../../Filtros';
import { colorSistema } from '../../../Formulario';
import { Aviso, Dato } from '../../../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../../../inicio/Kpi';
import { MARCA } from '../../../inicio/marca';
import Segmentos from '../../../Segmentos';
import { Chapa, Ficha, PETROLEO, Vacio } from '../piezas';
import { compartirArchivo } from './compartir';

export default function Relacionadas({ buscar }) {
  const anios = useMemo(() => aniosRecientes(hoySV()).map((a) => ({ id: a.key, label: a.label })), []);
  const [anio, setAnio] = useState(anios[0].id);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const hasta = anio === anios[0].id ? hoySV() : `${anio}-12-31`;
      setDatos(await fetchRelacionadas({ desde: `${anio}-01-01`, hasta }));
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    } finally {
      setCargando(false);
    }
  }, [anio, anios]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => filasRelacionadas(datos, buscar), [datos, buscar]);
  const conAviso = filas.filter((f) => f.avisos.length).length;
  const r = datos?.resumen ?? {};
  const extra = !cargando && filas.length
    ? { icono: 'square.and.arrow.up', etiqueta: 'Compartir CSV', onPress: () => compartirArchivo(csvRelacionadas(filas, anio), { reporte: 'relacionadas', anio }) }
    : null;
  const m = (n) => (n ? formatMoney(Number(n)) : '—');

  return (
    <View style={{ gap: 12 }}>
      <MenuDeFiltros grupos={[]} extra={extra} />
      <Segmentos opciones={anios} activa={anio} onCambiar={setAnio} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <FilaDeKpis>
        <Kpi icono="ShoppingCart" rotulo="Comprado a relacionadas" color={PETROLEO} valor={formatMoney(Number(datos?.anio?.total ?? 0))}
          apoyo={`${formatQty(Number(r.compras ?? 0))} compras en ${anio} (sin IVA)`} />
        <Kpi icono="Landmark" rotulo="IVA de esas compras" color={MARCA.verde} valor={formatMoney(Number(r.iva ?? 0))} apoyo="Crédito fiscal" />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="AlertTriangle" rotulo="Productos con aviso" color={MARCA.ambar} valor={formatQty(conAviso)} pide={conAviso > 0} apoyo="Precio fuera de lo razonable" />
      </FilaDeKpis>
      <View style={{ marginHorizontal: 16 }}>
        <Aviso texto="Entre empresas del mismo grupo el precio tiene que ser el de mercado, el que se le cobraría a un tercero. Si las operaciones con relacionadas del año superan el monto que fija el Código Tributario, se presenta el informe de precios de transferencia (F-982). El margen y si aplica el informe los confirma el contador." />
      </View>
      {cargando ? <ActivityIndicator style={{ marginTop: 16 }} /> : filas.length === 0 ? (
        <Vacio titulo="Sin compras a relacionadas" texto="Marca al proveedor como «empresa relacionada» y sus compras aparecen aquí." />
      ) : filas.map((f) => (
        <Ficha key={f.product_id}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.nombre}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${formatQty(Number(f.unidades))} unidades · ${formatMoney(Number(f.pagado))}`}</Text>
          {f.avisos.map((a) => <Chapa key={a.clave} variante={a.nivel} texto={a.texto} />)}
          <Dato primero rotulo="Pagado c/u" valor={formatMoney(Number(f.pagado_u))} fuerte />
          <Dato rotulo="Costo Farmalasa" valor={m(f.ref?.costo_farmalasa)} />
          <Dato rotulo="Mayoreo sin IVA" valor={m(f.ref?.mayoreo_sin_iva)} />
          <Dato rotulo="Venta Torogoz" valor={m(f.ref?.precio_torogoz_sin_iva)} />
        </Ficha>
      ))}
    </View>
  );
}
