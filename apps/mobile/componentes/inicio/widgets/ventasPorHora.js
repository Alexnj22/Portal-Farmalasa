// «Ventas por día y hora» — el widget del tablero del portal que dice cuándo
// se llena una sala: los últimos 90 días promediados por día de la semana y
// por hora. La ALTURA de cada barra son los tickets; el COLOR, cuánta gente
// hace falta (`nivelDeVolumen` del núcleo, tokens `--txvol-*`).
//
//   · Días  — lunes a domingo (percentil 75 de sus horas). Tocar un día abre
//             sus horas.
//   · Horas — el promedio de cada hora sobre toda la semana.
//
// Pedido del usuario del 2026-09-30: «no veo la venta por hora ni día, ese
// widget no está». El cálculo es el MISMO del portal (`promediosDeVentas`,
// que salió de `DashboardView.jsx` ese día), y la lectura ahora pagina: 90
// días de una sala pasaban de las 1000 filas y el promedio se hacía con un
// pedazo.
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fetchBranchHourlySalesRange } from '@nucleo/data/dashboard';
import { ERP_BODEGA, BRANCH_A_ERP, ordenDeSala } from '@nucleo/constants/erp';
import { nivelDeVolumen, promediosDeVentas } from '@nucleo/utils/inicio';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import Widget, { Esqueleto, Vacio } from '../Widget';
import { useDato } from '../useDato';
import { COLOR_VOLUMEN, LeyendaDeVolumen } from '../MiniSala';
import Segmentos from '../../Segmentos';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../marca';

const DIAS = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };
const DIAS_LARGOS = { 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado' };
const hora = (h) => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`);

function Barras({ items, rotulo, onTocar, alto = 120 }) {
  const max = Math.max(1, ...items.map((i) => i.avg));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: alto + 34 }}>
      {items.map((it) => {
        const h = it.avg > 0 ? Math.max((it.avg / max) * alto, alto * 0.08) : 2;
        return (
          <Pressable key={rotulo(it)} disabled={!onTocar} onPress={() => { Haptics.selectionAsync().catch(() => {}); onTocar?.(it); }}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: colorSistema.texto2, fontSize: 10, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{it.avg || ''}</Text>
            <View style={{ width: '100%', height: h, borderRadius: 5, backgroundColor: COLOR_VOLUMEN[nivelDeVolumen(it.avg)], opacity: it.avg > 0 ? 1 : 0.3 }} />
            <Text style={{ color: colorSistema.texto2, fontSize: 10 }} numberOfLines={1}>{rotulo(it)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function VentasPorHora({ ctx }) {
  // Las salas con ventas, en el orden del negocio: La Popular y Salud 1…n.
  const salas = useMemo(() => (ctx.sucursales || [])
    .filter((b) => BRANCH_A_ERP[Number(b.id)] != null && BRANCH_A_ERP[Number(b.id)] !== ERP_BODEGA)
    .sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [ctx.sucursales]);
  const propia = ctx.alcanceSalaVentas ? String(ctx.sala ?? '') : null;
  const [elegida, setElegida] = useState(null);
  const salaId = propia || elegida || (salas[0] ? String(salas[0].id) : null);
  const sala = salas.find((b) => String(b.id) === salaId) || (ctx.sucursales || []).find((b) => String(b.id) === salaId);
  const [vista, setVista] = useState('dias');
  const [dia, setDia] = useState(null);

  const { dato, cargando } = useDato(salaId ? `ventas-hora:${salaId}:${hoySV()}` : null, async () => {
    const { data, error } = await fetchBranchHourlySalesRange(salaId, sumarDias(hoySV(), -90));
    if (error) throw error;
    return data;
  });
  const p = useMemo(() => (dato ? promediosDeVentas(dato, sala) : null), [dato, sala]);

  const elegirSala = () => {
    if (propia || salas.length < 2) return;
    const nombres = salas.map((b) => b.name);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Sala', options: [...nombres, 'Cancelar'], cancelButtonIndex: nombres.length },
        (i) => { if (i < nombres.length) { setElegida(String(salas[i].id)); setDia(null); } },
      );
    } else {
      const i = salas.findIndex((b) => String(b.id) === salaId);
      setElegida(String(salas[(i + 1) % salas.length].id)); setDia(null);
    }
  };

  const items = !p ? [] : dia != null ? p.porDia[dia] : vista === 'dias' ? p.dias : p.horas;

  return (
    <Widget titulo="Ventas por día y hora" icono="BarChart2" color={MARCA.azul}>
      <View style={{ gap: 12 }}>
        <Pressable onPress={elegirSala} disabled={!!propia || salas.length < 2}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{sala?.name ?? '—'}</Text>
          {!propia && salas.length > 1 ? <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar ›</Text> : null}
        </Pressable>
        {dia == null ? (
          <Segmentos opciones={[{ id: 'dias', label: 'Días' }, { id: 'horas', label: 'Horas' }]} activa={vista}
            onCambiar={setVista} margen={0} />
        ) : (
          <Pressable onPress={() => setDia(null)}>
            <Text style={{ color: colorSistema.acento, fontSize: 15 }}>‹ Toda la semana · <Text style={{ fontWeight: '700' }}>{DIAS_LARGOS[dia]}</Text></Text>
          </Pressable>
        )}
        {cargando && !dato ? <Esqueleto lineas={3} /> : !p || !p.diasConDatos ? <Vacio texto="Sin ventas en los últimos 90 días." /> : (
          <>
            <Barras items={items}
              rotulo={(it) => (it.day != null && dia == null && vista === 'dias' ? DIAS[it.day] : hora(it.hour))}
              onTocar={dia == null && vista === 'dias' ? (it) => setDia(it.day) : null} />
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
              {dia == null && vista === 'dias'
                ? 'Tickets por hora en un día típico (últimos 90 días). Toca un día para ver sus horas.'
                : `Tickets promedio por hora${dia != null ? ` los ${DIAS_LARGOS[dia]}` : ''} (últimos 90 días).`}
            </Text>
            <LeyendaDeVolumen />
          </>
        )}
      </View>
    </Widget>
  );
}
