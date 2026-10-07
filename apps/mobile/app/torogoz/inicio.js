// Torogoz · Inicio, NATIVO — el tablero de la distribuidora (`TabTablero` del
// portal): ventas, documentos, ticket, clientes y unidades contra el período
// anterior; la venta por día con la curva del período anterior; la dona de
// rutas, los rankings de vendedores, productos y clientes; cuándo se vende;
// los tipos de cliente y las formas de pago; y lo que pide atención.
//
// Todo sale de `dist_tablero` en UNA llamada. El período, la ruta y el
// vendedor van en la dirección (como en el portal) y valen para todo: tocar
// una ruta en la dona o un vendedor en su ranking filtra; otra vez, suelta.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { fetchTablero, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { PERIODOS, rangoDe, rotuloTipoCliente } from '@nucleo/utils/distribucionComun';
import { horasDelDia, maximoDe, repartoDeFormas, semanaCompleta, serieDiaria } from '@nucleo/utils/distribucionTablero';
import { formatMoney, formatMoneyCorto, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { signPhotosDeep } from '@nucleo/utils/storageFiles';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
import Segmentos from '../../componentes/Segmentos';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Widget, { Esqueleto, Renglon, Vacio } from '../../componentes/inicio/Widget';
import Grafica from '../../componentes/metas/Graficas';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';
import { Aviso } from '../../componentes/formulario/Piezas';
import { Dona, FilaRanking, FormasDePago, Puesto, Punto, Variacion, colorDe } from '../../componentes/torogoz/tablero/Piezas';

const PETROLEO = '#0f6e7d';
const VISIBLES = 5;
const num = (v) => Number(v) || 0;
const OPCIONES_PERIODO = PERIODOS.map((p) => ({ id: p.key, label: p.label }));

export default function TorogozInicio() {
  const params = useLocalSearchParams();
  const periodo = PERIODOS.some((p) => p.key === params.periodo) ? params.periodo : '30d';
  const ruta = typeof params.ruta === 'string' ? params.ruta : '';
  const vendedor = typeof params.vendedor === 'string' ? params.vendedor : '';
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState('');
  const [actualizado, setActualizado] = useState(null);
  const [metrica, setMetrica] = useState('ventas');
  const [cuando, setCuando] = useState('dia');
  const [todos, setTodos] = useState({});

  const { desde, hasta } = useMemo(() => rangoDe(periodo), [periodo]);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const d = await fetchTablero({ desde, hasta, ruta, vendedor });
      await signPhotosDeep(d?.por_vendedor ?? []).catch(() => {});
      setDatos(d);
      setActualizado(new Date());
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, ruta, vendedor]);
  useEffect(() => { setCargando(true); cargar(); }, [cargar]);

  const filtrar = (clave, valor) => router.setParams({ [clave]: valor || undefined });

  const r = datos?.resumen ?? {};
  const a = datos?.anterior ?? {};
  const rutas = datos?.por_ruta ?? [];
  const vendedores = datos?.por_vendedor ?? [];
  const tipos = datos?.por_tipo ?? [];
  const productos = datos?.top_productos ?? [];
  const clientes = datos?.top_clientes ?? [];
  const reparto = useMemo(() => repartoDeFormas(datos?.formas_pago), [datos]);
  const serie = useMemo(() => serieDiaria(datos?.serie), [datos]);
  const semana = useMemo(() => semanaCompleta(datos?.por_dia_semana).map((f) => ({ ...f, tenue: !f.mejor })), [datos]);
  const horas = useMemo(() => horasDelDia(datos?.por_hora), [datos]);
  const sinVentas = !cargando && datos && num(r.documentos) === 0;
  const recorte = (clave, lista) => (todos[clave] ? lista : lista.slice(0, VISIBLES));
  const verTodos = (clave, lista) => (lista.length > VISIBLES ? {
    accion: todos[clave] ? 'Ver menos' : `Ver los ${lista.length}`,
    onAbrir: () => setTodos((t) => ({ ...t, [clave]: !t[clave] })),
  } : {});

  const grupos = [
    { id: 'ruta', titulo: 'Ruta', porDefecto: '', activa: ruta, onCambiar: (v) => filtrar('ruta', v),
      opciones: [{ id: '', label: 'Todas las rutas' }, ...(datos?.filtros?.rutas ?? []).map((x) => ({ id: x, label: x }))] },
    { id: 'vendedor', titulo: 'Vendedor', porDefecto: '', activa: vendedor, onCambiar: (v) => filtrar('vendedor', v),
      opciones: [{ id: '', label: 'Todos los vendedores' }, ...(datos?.filtros?.vendedores ?? []).map((v) => ({ id: v.id, label: shortEmployeeName(v) }))] },
  ];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Inicio', headerLargeTitle: false }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos opciones={OPCIONES_PERIODO} activa={periodo} onCambiar={(v) => router.setParams({ periodo: v })} />
        <FiltrosActivos grupos={grupos} />
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
          {fechaNumerica(desde)}{desde !== hasta ? ` – ${fechaNumerica(hasta)}` : ''}{actualizado ? ` · al ${hora12(actualizado)}` : ''}
        </Text>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {sinVentas ? (
          <View style={{ marginHorizontal: 16 }}>
            <Aviso texto={`No hay ventas en este período${ruta || vendedor ? ' con esos filtros' : ''}. Prueba con un período más largo.`} />
          </View>
        ) : null}

        <FilaDeKpis>
          <Kpi icono="Wallet" rotulo="Ventas" color={PETROLEO} valor={cargando ? '…' : formatMoneyCorto(num(r.ventas))} apoyo={<Variacion actual={r.ventas} antes={a.ventas} />} />
          <Kpi icono="Receipt" rotulo="Documentos" color={MARCA.azulClaro} valor={cargando ? '…' : formatQty(num(r.documentos))} apoyo={<Variacion actual={r.documentos} antes={a.documentos} />} />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="ShoppingCart" rotulo="Ticket promedio" color={MARCA.violetaClaro} valor={cargando ? '…' : formatMoney(num(r.ticket))} apoyo={<Variacion actual={r.ticket} antes={a.ticket} />} />
          <Kpi icono="Users" rotulo="Clientes" color={MARCA.verde} valor={cargando ? '…' : formatQty(num(r.clientes))} apoyo={<Variacion actual={r.clientes} antes={a.clientes} />} />
        </FilaDeKpis>
        <FilaDeKpis>
          <Kpi icono="Package" rotulo="Unidades" color="#1192E8" valor={cargando ? '…' : formatQty(num(r.unidades))} apoyo="Vendidas en el período" />
          <Kpi icono="ClipboardList" rotulo="Preventas" color={MARCA.ambar} pide={num(datos?.preventas?.total) > 0}
            valor={cargando ? '…' : formatMoneyCorto(num(datos?.preventas?.monto))} apoyo={`${formatQty(num(datos?.preventas?.total))} por facturar`}
            onPress={() => router.push('/torogoz/pedidos?vista=pendientes')} />
        </FilaDeKpis>

        <Widget titulo={metrica === 'ventas' ? 'Ventas por día' : 'Documentos por día'} icono="TrendingUp" color={PETROLEO}>
          <View style={{ gap: 10 }}>
            <Segmentos margen={0} opciones={[{ id: 'ventas', label: 'Ventas' }, { id: 'documentos', label: 'Documentos' }]} activa={metrica} onCambiar={setMetrica} />
            {metrica === 'ventas' && num(r.devuelto) > 0 ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Ya descuenta ${formatMoney(num(r.devuelto))} en devoluciones (notas de crédito).`}</Text>
            ) : null}
            {cargando && !datos ? <Esqueleto lineas={4} /> : (
              <Grafica key={`${metrica}-${periodo}-${ruta}-${vendedor}`} datos={serie} alto={170}
                series={metrica === 'ventas'
                  ? [{ clave: 'ventas', rotulo: 'Este período', color: PETROLEO, tipo: 'area' }, { clave: 'anterior', rotulo: `Período anterior (${formatMoneyCorto(num(a.ventas))})`, color: '#8D8D99', tipo: 'linea' }]
                  : [{ clave: 'documentos', rotulo: 'Documentos', color: PETROLEO, tipo: 'barra' }]}
                formato={(v) => (metrica === 'ventas' ? formatMoney(v) : `${formatQty(v)} documentos`)}
                formatoEje={metrica === 'ventas' ? formatMoneyCorto : (v) => formatQty(v)}
                detalle={(f) => (metrica === 'ventas' ? `${formatQty(f.documentos)} documentos` : formatMoney(f.ventas))}
                resumen={<Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{metrica === 'ventas' ? formatMoney(num(r.ventas)) : `${formatQty(num(r.documentos))} documentos`}</Text>} />
            )}
          </View>
        </Widget>

        <Widget titulo="Ventas por ruta" icono="Truck" color={PETROLEO} cuenta={ruta ? 1 : 0}>
          {cargando && !datos ? <Esqueleto /> : rutas.length ? (
            <View style={{ gap: 6 }}>
              <Dona datos={rutas} clave="ruta" activo={ruta || null} onElegir={(v) => filtrar('ruta', v)} />
              {rutas.map((x, i) => (
                <FilaRanking key={x.ruta} primero={i === 0} color={colorDe(i)} activo={ruta === x.ruta}
                  onPress={() => filtrar('ruta', ruta === x.ruta ? '' : x.ruta)}
                  izquierda={<Punto color={colorDe(i)} />} titulo={x.ruta} valor={formatMoneyCorto(num(x.ventas))}
                  proporcion={num(x.ventas) / maximoDe(rutas)}
                  detalle={`${formatQty(num(x.documentos))} documentos · ${formatQty(num(x.clientes))} clientes`} />
              ))}
            </View>
          ) : <Vacio texto="Sin ventas en el período." />}
        </Widget>

        <Widget titulo="Vendedores" icono="Medal" color={MARCA.ambar} {...verTodos('vendedores', vendedores)}>
          {cargando && !datos ? <Esqueleto /> : vendedores.length ? recorte('vendedores', vendedores).map((v, i) => (
            <FilaRanking key={v.id} primero={i === 0} activo={vendedor === v.id} color={PETROLEO}
              onPress={() => filtrar('vendedor', vendedor === v.id ? '' : v.id)}
              izquierda={(
                <View>
                  <Avatar empleado={v} tamano={34} />
                  {i === 0 ? <Text style={{ position: 'absolute', top: -6, right: -6, fontSize: 13 }}>🏆</Text> : null}
                </View>
              )}
              titulo={shortEmployeeName(v) || 'Vendedor'} valor={formatMoneyCorto(num(v.ventas))}
              proporcion={num(v.ventas) / maximoDe(vendedores)}
              detalle={`${formatQty(num(v.documentos))} documentos · ${formatQty(num(v.clientes))} clientes`} />
          )) : <Vacio texto="Sin ventas en el período." />}
        </Widget>

        <Widget titulo="Productos más vendidos" icono="Package" color={MARCA.verde} {...verTodos('productos', productos)}>
          {cargando && !datos ? <Esqueleto /> : productos.length ? recorte('productos', productos).map((p, i) => (
            <FilaRanking key={p.product_id} primero={i === 0} color={MARCA.verde} izquierda={<Puesto n={i + 1} />}
              titulo={p.nombre} valor={formatMoneyCorto(num(p.ventas))} proporcion={num(p.ventas) / maximoDe(productos)}
              detalle={`${formatQty(num(p.unidades))} unidades · en ${formatQty(num(p.documentos))} documentos`} />
          )) : <Vacio texto="Sin ventas en el período." />}
        </Widget>

        <Widget titulo="Mejores clientes" icono="Users" color="#6929C4" {...verTodos('clientes', clientes)}>
          {cargando && !datos ? <Esqueleto /> : clientes.length ? recorte('clientes', clientes).map((c, i) => (
            <FilaRanking key={c.id} primero={i === 0} color="#6929C4" izquierda={<Puesto n={i + 1} />}
              titulo={c.nombre} valor={formatMoneyCorto(num(c.ventas))} proporcion={num(c.ventas) / maximoDe(clientes)}
              detalle={`${rotuloTipoCliente(c.tipo)} · ${formatQty(num(c.documentos))} compras · última ${fechaNumerica(c.ultima)}`} />
          )) : <Vacio texto="Sin ventas en el período." />}
        </Widget>

        <Widget titulo="Cuándo se vende" icono="Clock" color="#1192E8">
          <View style={{ gap: 10 }}>
            <Segmentos margen={0} opciones={[{ id: 'dia', label: 'Por día' }, { id: 'hora', label: 'Por hora' }]} activa={cuando} onCambiar={setCuando} />
            {cargando && !datos ? <Esqueleto /> : cuando === 'dia' ? (
              <Grafica key="semana" datos={semana} alto={140} series={[{ clave: 'ventas', rotulo: 'Ventas', color: MARCA.verde, tipo: 'barra' }]}
                formato={(v) => formatMoney(v)} formatoEje={formatMoneyCorto} detalle={(f) => `${formatQty(f.documentos)} documentos`}
                resumen={<Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Resaltado, el día que más se vende. Desliza para ver cada día.</Text>} />
            ) : (
              <Grafica key="horas" datos={horas} alto={140} series={[{ clave: 'documentos', rotulo: 'Documentos', color: '#6929C4', tipo: 'barra' }]}
                formato={(v) => `${formatQty(v)} documentos`} formatoEje={(v) => formatQty(v)} detalle={(f) => formatMoney(f.ventas)}
                resumen={<Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Documentos emitidos a cada hora.</Text>} />
            )}
          </View>
        </Widget>

        <Widget titulo="Clientes y cobro" icono="CreditCard" color={MARCA.violetaClaro}>
          {cargando && !datos ? <Esqueleto /> : (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Dona datos={tipos} clave="tipo" tamano={112} rotulo={rotuloTipoCliente} />
                <View style={{ flex: 1, gap: 6 }}>
                  {tipos.map((t, i) => (
                    <View key={t.tipo} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Punto color={colorDe(i)} />
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{rotuloTipoCliente(t.tipo)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{formatMoneyCorto(num(t.ventas))}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>Formas de pago</Text>
              <FormasDePago reparto={reparto} />
            </View>
          )}
        </Widget>

        <Widget titulo="Sin comprar hace +30 días" icono="CalendarClock" color={MARCA.ambar} cuenta={num(datos?.inactivos?.total)}>
          {cargando && !datos ? <Esqueleto /> : (datos?.inactivos?.lista ?? []).length ? (datos.inactivos.lista.slice(0, 4).map((c, i) => (
            <Renglon key={c.id} primero={i === 0} titulo={c.nombre}
              detalle={`${c.ultima ? `Última compra ${fechaNumerica(c.ultima)}` : 'Nunca ha comprado'} · ${c.ruta ?? ''}`}
              derecha="Vender" colorDerecha={PETROLEO} onPress={() => router.push(`/torogoz/venta?cliente=${c.id}`)} />
          ))) : <Vacio texto="Todos compraron este mes" bien />}
        </Widget>

        <Widget titulo="Lotes que vencen en 90 días" icono="Boxes" color={MARCA.rojo} cuenta={num(datos?.inventario?.por_vencer_total)}>
          {cargando && !datos ? <Esqueleto /> : (datos?.inventario?.por_vencer ?? []).length ? datos.inventario.por_vencer.slice(0, 3).map((l, i) => (
            <Renglon key={l.id} primero={i === 0} titulo={l.nombre} detalle={`Lote ${l.lote}`}
              derecha={`${formatQty(num(l.existencia))} u. · ${num(l.dias)} d`} colorDerecha={num(l.dias) <= 30 ? MARCA.rojo : MARCA.ambar} />
          )) : <Vacio texto="Ningún lote por vencer" bien />}
        </Widget>

        <FilaDeKpis>
          <Kpi icono="PackageMinus" rotulo="Ventas perdidas" color={MARCA.rojo} pide={num(datos?.perdidas?.pendientes) > 0}
            valor={cargando ? '…' : formatQty(num(datos?.perdidas?.pendientes))} apoyo={datos?.perdidas?.top?.[0]?.producto ?? 'Sin pendientes'}
            onPress={() => router.push('/torogoz/perdidas')} />
          <Kpi icono="Boxes" rotulo="Inventario" color={PETROLEO} valor={cargando ? '…' : formatMoneyCorto(num(datos?.inventario?.valor))}
            apoyo={`${formatQty(num(datos?.inventario?.sin_existencia))} sin existencia`} onPress={() => router.push('/torogoz/inventario')} />
        </FilaDeKpis>
      </ScrollView>
    </>
  );
}
