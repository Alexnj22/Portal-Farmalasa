// Utilidad de Torogoz, NATIVO — `ReporteUtilidad` del portal: la venta sin IVA
// contra el costo que se congeló al vender. Lo vendido antes de que existiera
// el costo usa el promedio de hoy y se marca «estimado»; lo que no tiene costo
// de ninguna forma queda FUERA del margen y se dice cuánto es (con costo cero
// inflaría la utilidad). La gráfica es la de «Venta y utilidad por día» del
// portal: el área es la venta, las barras la utilidad.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { fetchUtilidad } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { PERIODOS, rangoDe } from '@nucleo/utils/distribucionComun';
import { AGRUPAR_UTILIDAD, gruposDeUtilidad, margen, serieDeUtilidad } from '@nucleo/utils/distribucionReportes';
import { formatMoney, formatMoneyCorto, formatQty } from '@nucleo/utils/formatNumber';
import { FiltrosActivos, MenuDeFiltros } from '../../../Filtros';
import { colorSistema } from '../../../Formulario';
import { Aviso, Seccion } from '../../../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../../../inicio/Kpi';
import { MARCA } from '../../../inicio/marca';
import Grafica from '../../../metas/Graficas';
import { Chapa, Ficha, PETROLEO, Vacio } from '../piezas';

const PAGINA = 50;

/** La barra del margen: roja bajo 10 %, ámbar bajo 20 %, verde arriba. El ancho ES el dato. */
function BarraMargen({ pct }) {
  if (pct === null) return <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>—</Text>;
  const color = pct < 10 ? MARCA.rojo : pct < 20 ? MARCA.ambar : MARCA.verde;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: 130 }}>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.2)', overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(3, Math.min(100, pct))}%`, height: '100%', borderRadius: 3, backgroundColor: color }} />
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], width: 46, textAlign: 'right' }}>{`${pct.toFixed(1)}%`}</Text>
    </View>
  );
}

export default function Utilidad({ buscar }) {
  const [periodo, setPeriodo] = useState('30d');
  const [agrupar, setAgrupar] = useState('producto');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [cuantos, setCuantos] = useState(PAGINA);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try { setDatos(await fetchUtilidad(rangoDe(periodo))); } catch (e) { setError(mensajeDeDistribucion(e)); } finally { setCargando(false); }
  }, [periodo]);
  useEffect(() => { setCuantos(PAGINA); cargar(); }, [cargar]);

  const r = datos?.resumen ?? {};
  const venta = Number(r.venta ?? 0);
  const costo = Number(r.costo ?? 0);
  const pctTotal = margen(venta, costo);
  const filas = useMemo(() => gruposDeUtilidad(datos, agrupar, buscar), [datos, agrupar, buscar]);
  const serie = useMemo(() => serieDeUtilidad(datos?.por_dia).map((d) => ({ ...d, etiqueta: String(Number(String(d.fecha).slice(8, 10))) })), [datos]);
  // Un día con pérdida queda como barra mínima: su cifra (negativa) sale en la etiqueta al tocarlo.

  const grupos = [
    { id: 'periodo', titulo: 'Período', activa: periodo, porDefecto: '30d', onCambiar: setPeriodo, opciones: PERIODOS.map((p) => ({ id: p.key, label: p.label })) },
    { id: 'agrupar', titulo: 'Agrupar', activa: agrupar, porDefecto: 'producto', onCambiar: (v) => { setCuantos(PAGINA); setAgrupar(v); },
      opciones: AGRUPAR_UTILIDAD.map((a) => ({ id: a.value, label: a.label })) },
  ];

  return (
    <View style={{ gap: 12 }}>
      <MenuDeFiltros grupos={grupos} />
      <FiltrosActivos grupos={grupos} />
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
        {`${PERIODOS.find((p) => p.key === periodo)?.label} · ${AGRUPAR_UTILIDAD.find((a) => a.value === agrupar)?.label.toLowerCase()}`}
      </Text>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <FilaDeKpis>
        <Kpi icono="Receipt" rotulo="Venta sin IVA" color={PETROLEO} valor={cargando && !datos ? '…' : formatMoney(venta)}
          apoyo={`${formatQty(Number(r.documentos ?? 0))} documentos${Number(r.devuelto) > 0 ? ` · ${formatMoney(Number(r.devuelto))} devuelto` : ''}`} />
        <Kpi icono="DollarSign" rotulo="Costo de lo vendido" color={MARCA.violetaClaro} valor={cargando && !datos ? '…' : formatMoney(costo)} apoyo="Al costo del día de la venta" />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="TrendingUp" rotulo="Utilidad bruta" color={MARCA.verde} valor={cargando && !datos ? '…' : formatMoney(venta - costo)} pide={venta - costo < 0} apoyo="Venta menos costo" />
        <Kpi icono="Percent" rotulo="Margen" color={MARCA.ambar} valor={pctTotal === null ? '—' : `${pctTotal.toFixed(1)}%`} apoyo="Sobre la venta sin IVA" />
      </FilaDeKpis>

      {!cargando && Number(r.sin_costo) > 0 ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="cuidado" texto={`${formatMoney(Number(r.sin_costo))} de venta son de ${formatQty(Number(r.productos_sin_costo))} productos que todavía no tienen costo (nunca entraron por una compra). No se cuentan en la utilidad: con costo cero la inflarían.`} />
        </View>
      ) : null}
      {!cargando && Number(r.estimado) > 0 ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso texto={`${formatMoney(Number(r.estimado))} de venta son de antes de que se guardara el costo al vender: usan el costo promedio de hoy y se marcan «estimado».`} />
        </View>
      ) : null}

      {serie.length > 1 ? (
        <View style={{ marginHorizontal: 16 }}>
          <Seccion titulo="Venta y utilidad por día">
            <Grafica key={periodo} datos={serie} alto={190}
              series={[{ clave: 'venta', rotulo: 'Venta sin IVA', color: PETROLEO, tipo: 'area' }, { clave: 'utilidad', rotulo: 'Utilidad', color: MARCA.verde, tipo: 'barra' }]}
              formato={(v, s) => `${s.rotulo}: ${formatMoney(v)}`} formatoEje={formatMoneyCorto}
              detalle={(f) => `Venta ${formatMoney(f.venta)} · utilidad ${formatMoney(f.utilidad)}`}
              resumen={<Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{formatMoney(venta - costo)}</Text>} />
          </Seccion>
        </View>
      ) : null}

      {cargando && !datos ? <ActivityIndicator style={{ marginTop: 16 }} /> : filas.length === 0 ? (
        buscar ? <Vacio titulo="Sin resultados" texto="Nada coincide con la búsqueda." /> : <Vacio titulo="Sin ventas" texto="No hay ventas en el período." />
      ) : (
        <>
          {filas.slice(0, cuantos).map((g) => {
            const util = Number(g.venta) - Number(g.costo);
            return (
              <Ficha key={`${g.por}-${g.clave}`}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{g.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {`${formatQty(Number(g.unidades))} unidades · venta ${formatMoney(Number(g.venta))} · costo ${formatMoney(Number(g.costo))}`}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {g.estimado ? <Chapa variante="info" texto="estimado" /> : null}
                      {Number(g.sin_costo) > 0 ? <Chapa variante="warning" texto={`${formatMoney(Number(g.sin_costo))} sin costo`} /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={{ color: util < 0 ? MARCA.rojo : colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(util)}</Text>
                    <BarraMargen pct={margen(g.venta, g.costo)} />
                  </View>
                </View>
              </Ficha>
            );
          })}
          {filas.length > cuantos ? (
            <Pressable onPress={() => setCuantos((n) => n + PAGINA)} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>{`Ver ${Math.min(PAGINA, filas.length - cuantos)} más`}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}
