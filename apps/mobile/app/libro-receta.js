// Libro bajo receta, NATIVO — la pestaña «Libro bajo receta» de Bitácoras en el
// portal: los renglones del mes de la sala (`fetchLibro`, JSON armado en la
// base), con lo que le falta a cada uno (`faltantesDelRenglon`). Tocar uno
// pendiente lo completa en `app/receta/[id].js`; el mes se cambia con ‹ ›.
//
// Lo que se lee acá es el libro que exige la norma: cada renglón dice su folio,
// el producto, cuánto se entregó, a quién y quién lo recetó.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ESTADO_RENGLON, faltantesDelRenglon, fetchLibro } from '@nucleo/data/bitacoras';
import { correrMes, etiquetaMes, fechaTexto, hoySV, ultimoDiaDelMes } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const COLOR = { warning: MARCA.ambar, success: MARCA.verde, neutral: colorSistema.texto2, danger: MARCA.rojo };

export default function LibroReceta() {
  const { sala: salaParam } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const sala = String(salaParam || salaDelUsuario(user) || '');
  const nombre = (sucursales || []).find((b) => String(b.id) === sala)?.name ?? '';
  const puedeCompletar = hasPermission('bitacoras', 'can_edit');
  const [mes, setMes] = useState(hoySV().slice(0, 7));
  const [vista, setVista] = useState('pendiente');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const hoy = hoySV();
    const hasta = mes === hoy.slice(0, 7) ? hoy : ultimoDiaDelMes(mes);
    const r = await fetchLibro(sala, { desde: `${mes}-01`, hasta });
    setError(r.error ? 'No se pudo cargar el libro.' : null);
    setFilas(r.renglones || []);
  }, [sala, mes]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const cuenta = useMemo(() => {
    const c = { pendiente: 0, completa: 0, todas: 0 };
    for (const r of filas || []) { c.todas += 1; if (r.estado === 'pendiente') c.pendiente += 1; if (r.estado === 'completa') c.completa += 1; }
    return c;
  }, [filas]);
  const visibles = (filas || []).filter((r) => vista === 'todas' || r.estado === vista);
  const esEsteMes = mes === hoySV().slice(0, 7);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Libro bajo receta', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {nombre ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 20 }}>{nombre}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16 }}>
          <Paso texto="‹" onPress={() => setMes((m) => correrMes(m, -1))} />
          <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{etiquetaMes(mes)}</Text>
          <Paso texto="›" deshabilitado={esEsteMes} onPress={() => setMes((m) => correrMes(m, 1))} />
        </View>
        <Segmentos activa={vista} onCambiar={setVista} opciones={[
          { id: 'pendiente', label: `Pendientes · ${cuenta.pendiente}` },
          { id: 'completa', label: `Completos · ${cuenta.completa}` },
          { id: 'todas', label: 'Todos' },
        ]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 32 }} /> : visibles.length ? visibles.map((r) => {
          const estado = ESTADO_RENGLON[r.estado] ?? { label: r.estado, variant: 'neutral' };
          const faltan = faltantesDelRenglon(r);
          const tocable = r.estado === 'pendiente' && puedeCompletar;
          return (
            <Pressable key={r.id} disabled={!tocable}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/receta/[id]', params: { id: String(r.id), sala, fecha: String(r.fecha).slice(0, 10) } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={20} interactivo={tocable}>
                <View style={{ padding: 14, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{r.producto_nombre}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`×${r.cantidad}`}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[r.folio_txt, fechaTexto(String(r.fecha).slice(0, 10), { day: 'numeric', month: 'short' }), r.paciente || r.cliente].filter(Boolean).join(' · ')}
                  </Text>
                  {r.medico ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Recetó: ${r.medico}`}</Text> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Pildora texto={estado.label} color={COLOR[estado.variant] ?? MARCA.azulClaro} />
                    {faltan.length ? <Text style={{ color: MARCA.ambar, fontSize: 13, flex: 1 }}>{`Falta ${faltan.join(', ')}`}</Text> : null}
                    {tocable ? <Text style={{ color: colorSistema.acento, fontSize: 14 }}>Completar ›</Text> : null}
                  </View>
                </View>
              </Vidrio>
            </Pressable>
          );
        }) : (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40, fontSize: 15 }}>
            {vista === 'pendiente' ? 'No hay renglones pendientes este mes.' : 'Sin renglones este mes.'}
          </Text>
        )}
      </ScrollView>
    </>
  );
}

function Paso({ texto, onPress, deshabilitado }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.18)', opacity: deshabilitado ? 0.3 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}
