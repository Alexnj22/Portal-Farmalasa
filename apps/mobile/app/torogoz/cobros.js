// Torogoz › Cuentas por cobrar, NATIVO — el `TabCobros` del portal: quién le
// debe a la distribuidora, desde cuándo, y cobrarle. Todo sale de
// `dist_cartera()` en una llamada (borrador 0014).
//
// Arriba lo que importa de un vistazo —cuánto hay en la calle, cuánto está
// atrasado, qué vence esta semana y cuánto se cobró este mes— y la antigüedad
// de saldos como una barra: el ancho de cada tramo ES su parte del total, y
// tocar un tramo filtra. El segmentado separa con saldo, atrasados y los que
// deben más que su límite (`VISTAS_CARTERA`). Tocar un cliente abre su cuenta,
// donde se cobra. Las reglas de la lista salen del núcleo (`distribucionCartera`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchCartera, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { clientesDeLaCartera, TRAMOS, usoDelLimite, VISTAS_CARTERA } from '@nucleo/utils/distribucionCartera';
import { rotuloTipoCliente } from '@nucleo/utils/distribucionComun';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Segmentos from '../../componentes/Segmentos';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { useMasAlFinal } from '../../componentes/ListaPaginada';

const PETROLEO = '#0f6e7d';
const POR_PAGINA = 50;
// Suben de gravedad, igual que en el portal: verde, ámbar, naranja, rojo.
const COLOR_TRAMO = { al_dia: MARCA.verde, '1_30': MARCA.ambar, '31_60': '#F97316', '61_90': MARCA.rojo, mas_90: '#BE123C' };

function Antiguedad({ antiguedad, tramo, onTramo }) {
  const total = antiguedad.reduce((a, t) => a + Number(t.monto), 0) || 1;
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>Antigüedad de saldos</Text>
            {tramo ? <Pressable onPress={() => onTramo('')} hitSlop={8}><Text style={{ color: PETROLEO, fontSize: 15, fontWeight: '700' }}>Ver todos</Text></Pressable> : null}
          </View>
          <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: 'rgba(127,127,127,0.15)' }}>
            {antiguedad.map((t) => (
              <View key={t.tramo} style={{ width: `${(Number(t.monto) / total) * 100}%`, backgroundColor: COLOR_TRAMO[t.tramo], opacity: tramo && tramo !== t.tramo ? 0.3 : 1 }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TRAMOS.map((t) => {
              const monto = Number(antiguedad.find((a) => a.tramo === t.key)?.monto ?? 0);
              const activo = tramo === t.key;
              return (
                <Pressable key={t.key} accessibilityRole="button" accessibilityState={{ selected: activo }}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); onTramo(activo ? '' : t.key); }}
                  style={({ pressed }) => ({ width: '31%', minHeight: 64, borderRadius: 14, padding: 10, gap: 2,
                    borderWidth: activo ? 1.5 : 0.5, borderColor: activo ? PETROLEO : colorSistema.separador,
                    backgroundColor: activo ? `${PETROLEO}22` : 'transparent', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR_TRAMO[t.key] }} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{t.label}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(monto, { decimales: 0 })}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${Math.round((monto / total) * 100)}%`}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Vidrio>
    </View>
  );
}

function Cliente({ c }) {
  const { saldo, limite, uso, sobre } = usoDelLimite(c);
  const vencido = Number(c.vencido) > 0;
  const abrir = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/torogoz/cartera/[id]', params: { id: String(c.id), nombre: c.nombre ?? '', ruta: c.ruta ?? '', telefono: c.telefono ?? '' } });
  };
  return (
    <Pressable onPress={abrir} style={{ marginHorizontal: 16 }} accessibilityRole="button" accessibilityLabel={c.nombre}>
      {({ pressed }) => (
        <Vidrio radio={20} interactivo>
          <View style={{ padding: 14, gap: 8, transform: [{ scale: pressed ? 0.98 : 1 }] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{c.nombre}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                  {`${rotuloTipoCliente(c.tipo)} · ${c.ruta ?? 'sin ruta'} · ${c.cuentas} documento${Number(c.cuentas) === 1 ? '' : 's'}`}
                </Text>
              </View>
              {vencido ? <Pildora texto={`${c.dias_atraso} días`} color={Number(c.dias_atraso) > 60 ? MARCA.rojo : MARCA.ambar} /> : <Pildora texto="Al día" color={MARCA.verde} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(saldo)}</Text>
              {vencido ? <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>{`${formatMoney(c.vencido)} atrasado`}</Text> : null}
            </View>
            <View style={{ gap: 4 }}>
              <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.18)', overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(3, uso * 100)}%`, height: 5, backgroundColor: sobre ? MARCA.rojo : uso > 0.8 ? MARCA.ambar : MARCA.verde }} />
              </View>
              <Text style={{ color: sobre ? MARCA.rojo : colorSistema.texto2, fontSize: 12 }}>
                {`${sobre ? 'Sobre el límite' : 'Límite'} ${formatMoney(limite, { decimales: 0 })} · último cobro ${c.ultimo_cobro ? fechaNumerica(c.ultimo_cobro) : 'nunca'}`}
              </Text>
            </View>
          </View>
        </Vidrio>
      )}
    </Pressable>
  );
}

export default function Cobros() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('saldo');
  const [tramo, setTramo] = useState('');
  const [texto, setTexto] = useState('');
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  // Al acercarse al final se pinta la página siguiente sola; «Ver más» queda de respaldo.
  const alFinal = useMasAlFinal(() => setCuantos((n) => n + POR_PAGINA));
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setDatos(await fetchCartera()); setError(null); }
    catch (e) { setError(mensajeDeDistribucion(e)); }
  }, []);
  // Se relee al volver de cobrar: el saldo no se queda viejo.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  useEffect(() => { setCuantos(POR_PAGINA); }, [vista, tramo, texto]);

  const r = datos?.resumen ?? {};
  const visibles = useMemo(() => {
    const q = texto.trim();
    return clientesDeLaCartera(datos?.clientes ?? [], { vista, tramo, coincide: q ? (c) => tokenMatch(q, c.nombre, c.ruta) : null });
  }, [datos, vista, tramo, texto]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Cuentas por cobrar', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Cliente o ruta', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') },
      }} />
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {datos ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Wallet" rotulo="Por cobrar" valor={formatMoney(Number(r.por_cobrar ?? 0), { decimales: 0 })} color={PETROLEO}
                apoyo={`${Number(r.clientes ?? 0)} clientes con saldo`} />
              <Kpi icono="AlertTriangle" rotulo="Atrasado" valor={formatMoney(Number(r.vencido ?? 0), { decimales: 0 })} color={MARCA.rojo}
                pide={Number(r.vencido) > 0} apoyo={`${Number(r.clientes_vencidos ?? 0)} pasados del plazo`}
                onPress={Number(r.vencido) > 0 ? () => setVista('vencidos') : undefined} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="CalendarClock" rotulo="Vence en 7 días" valor={formatMoney(Number(r.vence_7 ?? 0), { decimales: 0 })} color={MARCA.ambar} apoyo="Para cobrar esta semana" />
              <Kpi icono="HandCoins" rotulo="Cobrado este mes" valor={formatMoney(Number(r.cobrado_mes ?? 0), { decimales: 0 })} color={MARCA.verde} apoyo="Cobros sin anular" />
            </FilaDeKpis>
            <Antiguedad antiguedad={datos.antiguedad ?? []} tramo={tramo} onTramo={setTramo} />
          </>
        ) : null}
        <Segmentos activa={vista} onCambiar={setVista} opciones={VISTAS_CARTERA.map((v) => ({ id: v.key, label: v.label }))} />
        {datos ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${visibles.length} cliente${visibles.length === 1 ? '' : 's'} · ${formatMoney(visibles.reduce((t, c) => t + Number(c.saldo || 0), 0))}`}</Text> : null}
        {datos == null && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.slice(0, cuantos).map((c) => <Cliente key={c.id} c={c} />)}
        {visibles.length > cuantos ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande borde color={PETROLEO} texto={`Ver ${Math.min(POR_PAGINA, visibles.length - cuantos)} más · quedan ${visibles.length - cuantos}`} onPress={() => setCuantos((n) => n + POR_PAGINA)} />
          </View>
        ) : null}
        {datos && !visibles.length ? (
          <View style={{ alignItems: 'center', paddingTop: 32, gap: 6, marginHorizontal: 24 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>
              {texto || tramo ? 'Sin resultados' : vista === 'vencidos' ? 'Sin atrasos' : vista === 'limite' ? 'Sin clientes sobre el límite' : 'Sin saldos'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>
              {texto || tramo ? 'Ningún cliente coincide con la búsqueda o el tramo.' : vista === 'vencidos' ? 'Ningún cliente está pasado del plazo.' : vista === 'limite' ? 'Todos deben menos que su crédito aprobado.' : 'Nadie le debe a la distribuidora.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
