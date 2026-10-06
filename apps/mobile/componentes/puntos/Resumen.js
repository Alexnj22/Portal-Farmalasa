// El resumen del programa de puntos, NATIVO — la pestaña Resumen de
// `PuntosView`: si el motor anda, las cifras del día y del mes, los últimos 30
// días (acumulado como área, canjeado como línea), el mes por sala con sus dos
// barras, los que más tienen y cuándo vence lo que se debe. Todo con el
// selector Puntos / Dólares del portal. Las cuentas que no son de la base
// salen del núcleo (`puntosCuenta`).
//
// Las tarjetas de la red (Se les debe, Acumulado, Canjeado, Pueden canjear)
// tienen su propio permiso (`puntos_tarjetas`), como en el portal.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchAvisosDePuntos, fetchCuentasPorAsignar, fetchResumenDePuntos, fetchSerieDePuntos, fetchTableroDePuntos } from '@nucleo/data/puntos';
import { dolaresDePuntos, motorQuieto, puntosTexto } from '@nucleo/utils/puntosTexto';
import { cambioContraAnterior, serieDeVencimientos } from '@nucleo/utils/puntosCuenta';
import { formatMoney, formatMoneyCorto } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../Segmentos';
import { Aviso } from '../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Grafica from '../metas/Graficas';

export const COLOR_ACUMULADO = MARCA.azulClaro;
export const COLOR_CANJEADO = MARCA.ambar;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaDia = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} ${MESES[m - 1]}`; };
export const etiquetaMes = (clave) => { const [a, m] = String(clave).slice(0, 7).split('-').map(Number); return `${MESES[m - 1]} ${String(a).slice(2)}`; };
const corto = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));

/** Cómo se escribe una cifra de puntos según la unidad elegida. */
export const cifraDe = (unidad) => (unidad === 'dolares' ? (v) => dolaresDePuntos(v) : (v) => `${puntosTexto(v)} pts`);
export const ejeDe = (unidad) => (unidad === 'dolares'
  ? (v) => (v >= 100_000 ? formatMoneyCorto(v / 100) : formatMoney(v / 100, { decimales: 0 }))
  : corto);
const ambos = (v) => `${puntosTexto(v)} pts · ${dolaresDePuntos(v)}`;

const Titulo = ({ children, nota }) => (
  <View style={{ gap: 2 }}>
    <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>{children}</Text>
    {nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{nota}</Text> : null}
  </View>
);
const Panel = ({ children }) => (
  <View style={{ marginHorizontal: 16 }}><Vidrio radio={20}><View style={{ padding: 14, gap: 10 }}>{children}</View></Vidrio></View>
);

export default function Resumen({ onIrA }) {
  const { hasPermission } = useAuth();
  const veTarjetas = hasPermission('puntos_tarjetas', 'can_view');
  const veAvisos = hasPermission('puntos_tab_avisos', 'can_view');
  const vePorAsignar = hasPermission('puntos_tab_por_asignar', 'can_view');
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [unidad, setUnidad] = useState('puntos');
  const cargar = useCallback(async () => {
    try {
      const [r, t, serie, avisos, cuentas] = await Promise.all([
        fetchResumenDePuntos(), fetchTableroDePuntos(), fetchSerieDePuntos(30),
        veAvisos ? fetchAvisosDePuntos().catch(() => null) : Promise.resolve(null),
        vePorAsignar ? fetchCuentasPorAsignar().catch(() => null) : Promise.resolve(null),
      ]);
      setD({ r, t, serie: serie || [], avisos: avisos ? avisos.length : null, porAsignar: cuentas ? cuentas.length : null });
      setError(null);
    } catch (e) { setError(mensajeAmigable(e)); }
  }, [veAvisos, vePorAsignar]);
  useEffect(() => { cargar(); }, [cargar]);
  if (error) return <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View>;
  if (!d) return <ActivityIndicator style={{ marginTop: 24 }} />;

  const { r, t } = d;
  const encendido = !!r.config?.encendido;
  const quieto = motorQuieto(r.ultima_acumulacion, encendido);
  const hoy = r.periodos?.hoy ?? {};
  const deuda = t.deuda ?? {};
  const act = t.mes_actual ?? {};
  const ant = t.mes_anterior ?? {};
  const mesAnt = t.mes_anterior_hasta ? fechaTexto(t.mes_anterior_hasta, { month: 'short' }).replace('.', '') : '';
  const tasa = Number(act.acumulado) > 0 ? Math.round((Number(act.canjeado) / Number(act.acumulado)) * 100) : null;
  const cifra = cifraDe(unidad);
  const salas = r.por_sala ?? [];
  const topeSala = Math.max(1, ...salas.map((s) => Number(s.acumulado) || 0));
  const top = t.top ?? [];
  const topeTop = Math.max(1, ...top.map((c) => Number(c.saldo) || 0));
  const venc = serieDeVencimientos(t.vencimientos, t.hoy);
  const prox = (t.vencimientos || [])[0];
  const abrir = (c) => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/puntos-cliente/[id]', params: { id: String(c.customer_id), nombre: c.nombre } }); };

  return (
    <>
      <View style={{ marginHorizontal: 16 }}>
        {!encendido ? <Aviso tono="freno" texto="La acumulación de puntos está apagada." />
          : quieto ? <Aviso tono="freno" texto={`No se acumulan puntos desde hace ${quieto} minutos, con las salas abiertas.`} />
            : <Aviso tono="nota" texto={r.ultima_acumulacion ? `Funcionando · última acumulación ${fechaHora12(r.ultima_acumulacion)}` : 'Funcionando.'} />}
      </View>
      <FilaDeKpis>
        <Kpi icono="HandCoins" rotulo="Puntos" valor={puntosTexto(r.libro?.puntos)} color={MARCA.azul} apoyo={`Valen ${dolaresDePuntos(r.libro?.puntos)}`} />
        <Kpi icono="Users" rotulo="Clientes" valor={puntosTexto(r.libro?.cuentas_con_saldo)} color={MARCA.azul} apoyo="Con saldo" />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="TrendingUp" rotulo="Acumulados hoy" valor={puntosTexto(hoy.acumulado)} color={MARCA.verde} apoyo={`${dolaresDePuntos(hoy.acumulado)} · ${puntosTexto(hoy.ventas)} ventas`} />
        <Kpi icono="Gift" rotulo="Canjeados hoy" valor={puntosTexto(hoy.canjeado)} color={MARCA.ambar} apoyo={`${dolaresDePuntos(hoy.canjeado)} · ${puntosTexto(hoy.canjes)} canjes`} />
      </FilaDeKpis>
      {d.avisos != null || d.porAsignar != null ? (
        <FilaDeKpis>
          {d.avisos != null ? <Kpi icono="AlertTriangle" rotulo="Avisos" valor={puntosTexto(d.avisos)} color={MARCA.rojo} apoyo="Últimos 60 días" pide={d.avisos > 0} onPress={() => onIrA?.('avisos')} /> : null}
          {d.porAsignar != null ? <Kpi icono="Search" rotulo="Por asignar" valor={puntosTexto(d.porAsignar)} color={colorSistema.texto2} apoyo={`${puntosTexto(r.pendientes?.puntos)} puntos`} /> : null}
        </FilaDeKpis>
      ) : null}
      {veTarjetas ? (
        <>
          <FilaDeKpis>
            <Kpi icono="Wallet" rotulo="Se les debe" valor={dolaresDePuntos(deuda.puntos)} color={MARCA.violeta} apoyo={`${puntosTexto(deuda.puntos)} puntos`} />
            <Kpi icono="Users" rotulo="Pueden canjear" valor={puntosTexto(deuda.listos_clientes)} color={MARCA.azul} apoyo={`${dolaresDePuntos(deuda.listos_puntos)} en puntos`} onPress={() => onIrA?.('consulta')} />
          </FilaDeKpis>
          <FilaDeKpis>
            <Kpi icono="TrendingUp" rotulo="Acumulado" valor={puntosTexto(act.acumulado)} color={MARCA.verde} apoyo={cambioContraAnterior(act.acumulado, ant.acumulado, mesAnt) ?? dolaresDePuntos(act.acumulado)} />
            <Kpi icono="Gift" rotulo="Canjeado" valor={puntosTexto(act.canjeado)} color={MARCA.ambar} apoyo={tasa != null ? `${tasa}% de lo acumulado` : dolaresDePuntos(act.canjeado)} />
          </FilaDeKpis>
        </>
      ) : null}
      <Segmentos activa={unidad} onCambiar={setUnidad} opciones={[{ id: 'puntos', label: 'Puntos' }, { id: 'dolares', label: 'Dólares' }]} />
      <Panel>
        <Titulo>Últimos 30 días</Titulo>
        <Grafica alto={170}
          datos={d.serie.map((x) => ({ etiqueta: etiquetaDia(x.fecha), titulo: fechaTexto(x.fecha, { weekday: 'long', day: 'numeric', month: 'long' }), acumulado: Number(x.acumulado) || 0, canjeado: Number(x.canjeado) || 0 }))}
          series={[{ clave: 'acumulado', rotulo: 'Acumulados', color: COLOR_ACUMULADO, tipo: 'area' }, { clave: 'canjeado', rotulo: 'Canjeados', color: COLOR_CANJEADO, tipo: 'linea' }]}
          formato={(v) => ambos(v)} formatoEje={ejeDe(unidad)}
          resumen={<Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Desliza el dedo sobre la gráfica para ver cada día.</Text>} />
      </Panel>
      <Panel>
        <Titulo nota="Acumulado · canjeado">Este mes, por sala</Titulo>
        {salas.length ? salas.map((s) => (
          <View key={s.sucursal} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{s.sala}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{cifra(s.acumulado)}</Text>{` · ${cifra(s.canjeado)}`}
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.13)' }}>
              <View style={{ height: 6, borderRadius: 3, width: `${((Number(s.acumulado) || 0) / topeSala) * 100}%`, backgroundColor: COLOR_ACUMULADO }} />
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.13)' }}>
              <View style={{ height: 6, borderRadius: 3, width: `${((Number(s.canjeado) || 0) / topeSala) * 100}%`, backgroundColor: COLOR_CANJEADO }} />
            </View>
          </View>
        )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin movimientos este mes</Text>}
      </Panel>
      <Panel>
        <Titulo nota="Toca uno para ver todo lo suyo.">Los que más puntos tienen</Titulo>
        {top.length ? top.map((c, i) => (
          <Pressable key={c.customer_id} onPress={() => abrir(c)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ width: 22, textAlign: 'right', color: colorSistema.texto2, fontSize: 13, fontWeight: '800' }}>{i + 1}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{c.nombre}</Text>
              <View style={{ height: 5, borderRadius: 3, width: `${((Number(c.saldo) || 0) / topeTop) * 100}%`, backgroundColor: COLOR_ACUMULADO }} />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{puntosTexto(c.saldo)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{dolaresDePuntos(c.saldo)}</Text>
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 18, fontWeight: '300' }}>›</Text>
          </Pressable>
        )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin clientes con puntos</Text>}
      </Panel>
      <Panel>
        <Titulo nota={prox ? `Lo próximo: ${puntosTexto(prox.puntos)} puntos (${dolaresDePuntos(prox.puntos)}) en ${fechaTexto(prox.mes, { month: 'long', year: 'numeric' })}.` : 'A los doce meses de la compra.'}>Cuándo vencen</Titulo>
        {(t.vencimientos || []).length ? (
          <Grafica alto={160}
            datos={venc.map((v) => ({ etiqueta: etiquetaMes(v.clave), titulo: etiquetaMes(v.clave), puntos: v.puntos, clientes: v.clientes }))}
            series={[{ clave: 'puntos', rotulo: 'Vencen', color: COLOR_ACUMULADO, tipo: 'barra' }]}
            formato={(v) => (Number(v) > 0 ? ambos(v) : 'Nada vence')} formatoEje={ejeDe(unidad)}
            detalle={(f) => (f.puntos > 0 ? `de ${puntosTexto(f.clientes)} clientes` : null)} />
        ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin puntos por vencer</Text>}
      </Panel>
    </>
  );
}
