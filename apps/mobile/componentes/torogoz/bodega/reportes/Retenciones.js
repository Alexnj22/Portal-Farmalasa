// Retenciones y percepciones de Torogoz, NATIVO — `ReporteRetenciones` del
// portal: el resumen fiscal del mes (referencial: la liquidación la hace el
// contador) y cuatro listados sacados de los libros de ventas y de compras, cada
// uno con su archivo. Los listados y los archivos salen del núcleo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { fetchLibroCompras, fetchLibrosVentas } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { archivoDeRetencion, listadosDeRetenciones, resumenFiscal, totalesConsumidor, totalesContribuyente } from '@nucleo/utils/distribucionReportes';
import { mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../../../Formulario';
import { Aviso, Seccion } from '../../../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../../../inicio/Kpi';
import { MARCA } from '../../../inicio/marca';
import PasoDeMes from '../../../PasoDeMes';
import BotonPaquete from './Paquete';
import { PETROLEO } from '../piezas';
import { compartirArchivo } from './compartir';

export default function Retenciones() {
  const [mes, setMes] = useState(mesSV);
  const [ventas, setVentas] = useState(null);
  const [compras, setCompras] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const [desde, hasta] = rangoDelMes(mes);
      const [v, c] = await Promise.all([fetchLibrosVentas({ desde, hasta }), fetchLibroCompras({ desde, hasta })]);
      setVentas(v); setCompras(c);
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    } finally {
      setCargando(false);
    }
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const r = useMemo(() => resumenFiscal({ tc: totalesContribuyente(ventas?.contribuyente), tf: totalesConsumidor(ventas?.consumidor), compras }), [ventas, compras]);
  const listados = useMemo(() => listadosDeRetenciones(ventas, compras), [ventas, compras]);

  return (
    <View style={{ gap: 12 }}>
      <PasoDeMes mes={mes} onCambiar={setMes} />
      <View style={{ marginHorizontal: 16 }}><BotonPaquete mes={mes} /></View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <FilaDeKpis>
        <Kpi icono="Landmark" rotulo="Débito fiscal" color={PETROLEO} valor={formatMoney(r.debito)} apoyo="Contribuyentes + consumidor" />
        <Kpi icono="Receipt" rotulo="Crédito fiscal" color={MARCA.verde} valor={formatMoney(r.credito)} apoyo="De las compras del mes" />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="Percent" rotulo="Impuesto (referencial)" color={MARCA.ambar} valor={formatMoney(r.impuesto)} apoyo="Débito − crédito; lo liquida el contador" />
      </FilaDeKpis>
      {cargando ? <ActivityIndicator style={{ marginTop: 16 }} /> : listados.map((l) => (
        <View key={l.clave} style={{ marginHorizontal: 16 }}>
          <Seccion>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{l.titulo}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{l.sub}</Text>
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(l.total)}</Text>
            </View>
            {l.n === 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin documentos este mes.</Text> : (
              <>
                {l.filas.slice(0, 6).map((f, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{f[0]}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12, fontFamily: 'Menlo' }} numberOfLines={1}>{f[1]}</Text>
                    </View>
                    <Text style={{ color: Number(f[2]) < 0 ? MARCA.rojo : colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(f[2]))}</Text>
                  </View>
                ))}
                {l.n > 6 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`y ${l.n - 6} más en el archivo.`}</Text> : null}
              </>
            )}
            <Pressable disabled={!l.n} onPress={() => compartirArchivo(archivoDeRetencion(l, mes), { reporte: `retenciones-${l.clave}`, mes })}
              style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', opacity: !l.n ? 0.35 : pressed ? 0.6 : 1 })} accessibilityRole="button">
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Compartir CSV</Text>
            </Pressable>
          </Seccion>
        </View>
      ))}
    </View>
  );
}
