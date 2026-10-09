// La cuenta de puntos de un cliente, NATIVO — lo que `ClientePuntosModal` del
// portal muestra para revisar un saldo antes de un canje: cuánto tiene (en
// dólares primero: «$4.20 de descuento» se entiende, «420 puntos» no), en qué
// se fue lo que ganó (disponible, canjeado, vencido, anulado), su historia por
// mes —tocar una barra filtra los movimientos de ese mes—, qué vence y cada
// movimiento con quién lo hizo, filtrable por Todos / Acumulados / Canjes.
// Las cuentas salen del núcleo (`puntosCuenta`), las mismas del portal.
//
// Abajo, el código de acceso del cliente (`componentes/puntos/CodigoDeAcceso`)
// y dar o quitar puntos a mano (`componentes/puntos/AjustarPuntos`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchPuntosCliente } from '@nucleo/data/puntos';
import { claveDeMovimiento, detalleDeMovimiento, dolaresDePuntos, montoDeVenta, puntosTexto, rotuloDeMovimiento, valeTexto } from '@nucleo/utils/puntosTexto';
import { FILTROS_DE_MOVIMIENTO, mesesDeCuenta, movimientoPasaFiltro, partesDelReparto, repartoDeCuenta } from '@nucleo/utils/puntosCuenta';
import { fechaNumerica, fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../../componentes/Segmentos';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { useMasAlFinal } from '../../componentes/ListaPaginada';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import { Grilla, Pildora } from '../../componentes/avisos/Piezas';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import Grafica, { BarraDePartes } from '../../componentes/metas/Graficas';
import { COLOR_ACUMULADO, COLOR_CANJEADO, ejeDe, etiquetaMes } from '../../componentes/puntos/Resumen';
import CodigoDeAcceso from '../../componentes/puntos/CodigoDeAcceso';
import AjustarPuntos from '../../componentes/puntos/AjustarPuntos';

const ROL = { 'vendió': 'Vendió', 'ajustó': 'Ajustó' };
const MINIMO = 100;
const COLOR_PARTE = { saldo: COLOR_ACUMULADO, canjeado: COLOR_CANJEADO, vencido: '#8E8E93', anulado: MARCA.rojo };
const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesLargo = (clave) => { const [a, m] = clave.split('-').map(Number); return `${NOMBRE_MES[m - 1]} ${a}`; };

export default function PuntosCliente() {
  const { id, nombre } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [mostrar, setMostrar] = useState(30);
  const alFinal = useMasAlFinal(() => setMostrar((n) => n + 30));
  const [filtro, setFiltro] = useState('todos');
  const [mesElegido, setMesElegido] = useState(null);
  const [unidad, setUnidad] = useState('puntos');
  const [recargando, setRecargando] = useState(false);
  const cargar = useCallback(async () => {
    try { setD(await fetchPuntosCliente(Number(id))); setError(null); } catch (e) { setError(mensajeAmigable(e)); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const cuenta = d?.cuenta || {};
  const saldo = Number(cuenta.saldo) || 0;
  const movs = useMemo(() => cuenta.movimientos || [], [cuenta.movimientos]);
  const titulo = d?.cliente?.nombre || nombre || 'Cliente';
  const reparto = useMemo(() => repartoDeCuenta(movs), [movs]);
  const partes = partesDelReparto({ ganados: cuenta.ganados, saldo, ...reparto }).map((p) => ({ ...p, color: COLOR_PARTE[p.clave] }));
  const meses = useMemo(() => mesesDeCuenta(movs, saldo, 18), [movs, saldo]);
  const filtrados = useMemo(() => movs.filter((m) => movimientoPasaFiltro(m, filtro, mesElegido)), [movs, filtro, mesElegido]);
  const proximo = (cuenta.vencimientos || [])[0];
  const ultimaCompra = movs.find((m) => m.tipo === 'compra');
  const indiceMes = mesElegido ? meses.findIndex((m) => m.mes === mesElegido) : -1;

  // Los movimientos agrupados por mes, sobre la tanda visible.
  const grupos = useMemo(() => {
    const out = [];
    for (const m of filtrados.slice(0, mostrar)) {
      const clave = String(m.fecha).slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.clave !== clave) { g = { clave, filas: [], entra: 0, sale: 0 }; out.push(g); }
      g.filas.push(m);
      const p = Number(m.puntos) || 0;
      if (p > 0) g.entra += p; else g.sale += -p;
    }
    return out;
  }, [filtrados, mostrar]);

  const fila = (m, i) => {
    const info = d.detalle?.[claveDeMovimiento(m)] || {};
    const p = Number(m.puntos) || 0;
    const detalle = detalleDeMovimiento(m, info);
    const persona = info.quien && info.quien !== 'Automático' ? { id: info.quien_id, name: info.quien } : null;
    return (
      <View key={claveDeMovimiento(m)} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>
            {rotuloDeMovimiento(m)}{detalle ? <Text style={{ fontWeight: '400', color: colorSistema.texto2 }}>{` · ${detalle}`}</Text> : null}
          </Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[montoDeVenta(m, info), fechaNumerica(m.fecha), d.salas?.[m.sucursal] ?? m.sucursal].filter(Boolean).join(' · ')}</Text>
          {persona ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Avatar empleado={persona} tamano={18} />
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${ROL[info.rol] ?? ''} ${shortEmployeeName(persona)}`.trim()}</Text>
            </View>
          ) : info.quien === 'Automático' ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Automático</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: p > 0 ? MARCA.verde : colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{`${p > 0 ? '+' : '−'}${puntosTexto(Math.abs(p))}`}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{valeTexto(p)}</Text>
        </View>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Puntos', headerLargeTitle: false }} />
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {!d && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
        {d ? (
          <>
            <Vidrio radio={24} tinte="rgba(140,198,63,0.12)">
              <View style={{ padding: 18, gap: 6 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '700' }} numberOfLines={2}>{titulo}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[d.cliente?.dui, d.cliente?.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 40, fontWeight: '800', marginTop: 6 }}>{dolaresDePuntos(saldo)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${puntosTexto(saldo)} puntos de descuento`}</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {d.cliente?.acumula === false ? <Pildora texto="Esta ficha no acumula" color={colorSistema.texto2} />
                    : saldo >= MINIMO ? <Pildora texto="Puede canjear" color={MARCA.verde} />
                      : <Pildora texto={`Le faltan ${puntosTexto(MINIMO - saldo)} para canjear`} color={MARCA.ambar} />}
                </View>
                {partes.length ? (
                  <View style={{ gap: 6, marginTop: 8 }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{`De los ${puntosTexto(cuenta.ganados)} acumulados`}</Text>
                    <BarraDePartes partes={partes} total={cuenta.ganados} />
                  </View>
                ) : null}
              </View>
            </Vidrio>
            <Grilla celdas={[
              { rotulo: 'Acumulados', valor: `${puntosTexto(cuenta.ganados)}\n${dolaresDePuntos(cuenta.ganados)}` },
              { rotulo: 'Canjeados', valor: `${puntosTexto(reparto.canjeado)}\n${dolaresDePuntos(reparto.canjeado)}` },
              { rotulo: 'Próximo vencimiento', valor: `${proximo ? puntosTexto(proximo.puntos) : '—'}\n${proximo ? fechaTexto(proximo.vence_el, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Nada por vencer'}` },
              { rotulo: 'Última compra', valor: `${ultimaCompra ? fechaTexto(ultimaCompra.fecha, { day: 'numeric', month: 'short' }) : '—'}\n${ultimaCompra ? (d.salas?.[ultimaCompra.sucursal] ?? '') : 'Sin compras'}` },
            ]} />
            {meses.length ? (
              <Vidrio radio={20}>
                <View style={{ padding: 14, gap: 10 }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>Mes a mes</Text>
                  <Segmentos margen={0} activa={unidad} onCambiar={setUnidad} opciones={[{ id: 'puntos', label: 'Puntos' }, { id: 'dolares', label: 'Dólares' }]} />
                  <Grafica alto={150} activo={indiceMes >= 0 ? indiceMes : null}
                    datos={meses.map((m) => ({ etiqueta: etiquetaMes(m.mes), titulo: mesLargo(m.mes), mes: m.mes, acumulado: m.acumulado, canjeado: m.canjeado, saldo: m.saldo }))}
                    series={[{ clave: 'acumulado', rotulo: 'Acumulados', color: COLOR_ACUMULADO, tipo: 'barra' }, { clave: 'canjeado', rotulo: 'Canjeados', color: COLOR_CANJEADO, tipo: 'barra' }]}
                    formato={(v) => (unidad === 'dolares' ? dolaresDePuntos(v) : `${puntosTexto(v)} pts`)} formatoEje={ejeDe(unidad)}
                    detalle={(f) => `Quedaron ${puntosTexto(f.saldo)} pts`}
                    onTocar={(i) => { Haptics.selectionAsync().catch(() => {}); const m = meses[i]?.mes; setMesElegido((x) => (x === m ? null : m)); setMostrar(30); }}
                    resumen={<Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Toca un mes para ver sólo sus movimientos.</Text>} />
                </View>
              </Vidrio>
            ) : null}
            {(cuenta.vencimientos || []).length ? (
              <Seccion titulo="Por vencer">
                {(cuenta.vencimientos || []).map((v) => (
                  <Text key={v.vence_el} style={{ color: colorSistema.texto, fontSize: 15 }}>{`${puntosTexto(v.puntos)} puntos (${dolaresDePuntos(v.puntos)}) el ${fechaNumerica(v.vence_el)}`}</Text>
                ))}
              </Seccion>
            ) : null}
            <Segmentos margen={0} activa={filtro} onCambiar={(v) => { setFiltro(v); setMostrar(30); }} opciones={FILTROS_DE_MOVIMIENTO.map((f) => ({ id: f.value, label: f.label }))} />
            {mesElegido ? (
              <Pressable onPress={() => setMesElegido(null)} style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.55 : 1 })} accessibilityLabel="Quitar el filtro del mes">
                <Pildora texto={`${mesLargo(mesElegido)}  ✕`} color={MARCA.azulClaro} />
              </Pressable>
            ) : null}
            {grupos.length ? grupos.map((g) => (
              <Seccion key={g.clave} titulo={`${mesLargo(g.clave)} · +${puntosTexto(g.entra)} · −${puntosTexto(g.sale)}`}>
                {g.filas.map(fila)}
              </Seccion>
            )) : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{movs.length ? 'Ningún movimiento con ese filtro.' : 'Todavía no tiene movimientos.'}</Text>}
            {filtrados.length > mostrar ? <BotonGrande texto="Ver más" borde onPress={() => setMostrar((n) => n + 30)} /> : null}
            {(d.cuentas_anteriores || []).length ? (
              <Seccion titulo="Del sistema anterior">
                {d.cuentas_anteriores.map((a) => (
                  <Text key={a.id} style={{ color: colorSistema.texto, fontSize: 14 }}>
                    {`Cuenta ${a.id}${a.como === 'manual' ? ` · asignada a mano el ${fechaNumerica(a.cuando)}${a.nota ? ` — «${a.nota}»` : ''}` : ' · pasó por su DUI'}`}
                  </Text>
                ))}
              </Seccion>
            ) : null}
            {d?.cliente?.id != null ? (
              <CodigoDeAcceso customerId={d.cliente.id} nombre={d.cliente.nombre || ''} telefono={d.cliente.telefono}
                puedeEditar={hasPermission('clientes', 'can_edit')} />
            ) : null}
            {d?.cliente?.id != null && hasPermission('puntos_ajustar', 'can_view') ? (
              <AjustarPuntos customerId={d.cliente.id} nombre={d.cliente.nombre || ''} saldo={saldo} onHecho={cargar} />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
