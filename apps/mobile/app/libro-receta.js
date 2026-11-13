// Libro bajo receta, NATIVO — la pestaña «Libro bajo receta» de Bitácoras en el
// portal: los renglones del mes de la sala (`fetchLibro`, JSON armado en la
// base), con lo que le falta a cada uno (`faltantesDelRenglon`). Tocar uno
// pendiente lo completa en `app/receta/[id].js`; el mes se cambia con ‹ ›.
//
// Lo que se lee acá es el libro que exige la norma: cada renglón dice su folio,
// el producto, cuánto se entregó, a quién y quién lo recetó.
//
// Como en el portal, son DOS libros —Antibióticos y Otros bajo receta— cada uno
// con su cuenta y su CSV; el buscador acepta el folio en cualquiera de sus
// formas, el medicamento, el lote, el paciente, el médico o la junta; el orden
// se elige en el menú de filtros; y tocar un renglón abre el folio entero
// (`app/folio.js`).
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useEnTramos } from '../componentes/alFinal';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { CLASE_ANTIBIOTICO, ESTADO_RENGLON, LIBROS, faltantesDelRenglon, fetchLibro } from '@nucleo/data/bitacoras';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { correrMes, etiquetaMes, fechaTexto, hoySV, ultimoDiaDelMes } from '@nucleo/utils/fecha';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { csvDelLibroBajoReceta } from '@nucleo/utils/libroBajoReceta';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Cargando, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Segmentos from '../componentes/Segmentos';
import FijoArriba from '../componentes/FijoArriba';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { compartirCsv } from '../componentes/fiscal/csv';
import { fallo } from '../componentes/Progreso';

const COLOR = { warning: MARCA.ambar, success: MARCA.verde, neutral: colorSistema.texto2, danger: MARCA.rojo };

export default function LibroReceta() {
  const { sala: salaParam } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const sala = String(salaParam || salaDelUsuario(user) || '');
  const nombre = (sucursales || []).find((b) => String(b.id) === sala)?.name ?? '';
  const puedeCompletar = hasPermission('bitacoras_tab_libro', 'can_edit');
  const [mes, setMes] = useState(hoySV().slice(0, 7));
  const [vista, setVista] = useState('pendiente');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [clase, setClase] = useState(CLASE_ANTIBIOTICO);
  const [orden, setOrden] = useState('folio:desc');
  const [texto, setTexto] = useState('');
  const busca = useTextoRebotado(texto).trim();

  const cargar = useCallback(async () => {
    const hoy = hoySV();
    const hasta = mes === hoy.slice(0, 7) ? hoy : ultimoDiaDelMes(mes);
    const r = await fetchLibro(sala, { desde: `${mes}-01`, hasta });
    setError(r.error ? 'No se pudo cargar el libro.' : null);
    setFilas(r.renglones || []);
  }, [sala, mes]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Cuántos hay en cada libro, para que el que no se mira no desaparezca.
  const delLibro = useMemo(() => (filas || []).filter((r) => (r.clase || CLASE_ANTIBIOTICO) === clase), [filas, clase]);
  const cuenta = useMemo(() => {
    const c = { pendiente: 0, completa: 0, todas: 0 };
    for (const r of delLibro) { c.todas += 1; if (r.estado === 'pendiente') c.pendiente += 1; if (r.estado === 'completa') c.completa += 1; }
    return c;
  }, [delLibro]);
  const visibles = useMemo(() => {
    const base = delLibro
      .filter((r) => vista === 'todas' || r.estado === vista)
      .filter((r) => !busca || tokenMatch(busca, r.folio_txt, String(r.folio), r.producto_nombre, r.lote, r.paciente,
        r.medico, r.numero_junta, r.cliente, r.vendedor, r.correlativo_doc));
    // El mismo orden que la tabla del portal: por el campo crudo, vacíos al final.
    const [campo, dir] = orden.split(':');
    const signo = dir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const ka = a[campo]; const kb = b[campo];
      if (ka === kb) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      return (ka > kb ? 1 : -1) * signo;
    });
  }, [delLibro, vista, busca, orden]);
  const grupos = [{ id: 'estado', titulo: 'Estado', activa: vista, porDefecto: 'pendiente', onCambiar: setVista, opciones: [{ id: 'pendiente', label: 'Pendientes' }, { id: 'completa', label: 'Completos' }, { id: 'todas', label: 'Todos' }] }, { id: 'orden', titulo: 'Ordenar', activa: orden, porDefecto: 'folio:desc', onCambiar: setOrden, opciones: [
    ['folio', 'Folio'], ['fecha', 'Fecha'], ['producto_nombre', 'Medicamento'], ['cantidad', 'Cantidad'], ['lote', 'Lote'], ['paciente', 'Paciente'], ['estado', 'Estado'],
  ].flatMap(([k, l]) => [{ id: `${k}:desc`, label: `${l} ↓` }, { id: `${k}:asc`, label: `${l} ↑` }]) }];
  const tramo = useEnTramos(visibles, 40, `${vista}|${clase}|${busca}|${orden}`);
  const esEsteMes = mes === hoySV().slice(0, 7);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_FIJA, title: 'Libro bajo receta',
        headerSearchBarOptions: { placeholder: 'Folio, medicamento, lote, paciente o médico', hideWhenScrolling: false, onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') } }} />
      <MenuDeFiltros grupos={grupos} />
      <FijoArriba><Segmentos activa={clase} onCambiar={setClase} opciones={LIBROS.map((l) => ({ id: l.clave, label: l.corto }))} /></FijoArriba>
      <ScrollView {...tramo.scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {nombre ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 20 }}>{nombre}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16 }}>
          <Paso texto="‹" onPress={() => setMes((m) => correrMes(m, -1))} />
          <Text style={{ flex: 1, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{etiquetaMes(mes)}</Text>
          <Paso texto="›" deshabilitado={esEsteMes} onPress={() => setMes((m) => correrMes(m, 1))} />
        </View>
        {delLibro.length ? (
          <Pressable hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-end', marginHorizontal: 20, minHeight: 32, justifyContent: 'center' }}
            onPress={() => compartirCsv({ ...csvDelLibroBajoReceta(delLibro, { clase, sucursalNombre: nombre, periodo: mes }), modulo: 'bitacoras' }).catch((e) => fallo('No se pudo compartir', e?.message || ''))}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>{`Descargar ${LIBROS.find((l) => l.clave === clase)?.label.toLowerCase() ?? 'el libro'} (CSV)`}</Text>
          </Pressable>
        ) : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <Cargando /> : visibles.length ? tramo.visibles.map((r) => {
          const estado = ESTADO_RENGLON[r.estado] ?? { label: r.estado, variant: 'neutral' };
          const faltan = faltantesDelRenglon(r);
          const tocable = r.estado === 'pendiente' && puedeCompletar;
          return (
            <Pressable key={r.id}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/folio', params: { sala, anio: String(r.anio), folio: String(r.folio), clase: r.clase || CLASE_ANTIBIOTICO, id: String(r.id), fecha: String(r.fecha).slice(0, 10) } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
              <Vidrio radio={20} interactivo>
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
                    <Text style={{ color: colorSistema.acento, fontSize: 14 }}>{tocable ? 'Completar ›' : 'Ver ›'}</Text>
                  </View>
                </View>
              </Vidrio>
            </Pressable>
          );
        }) : (
          <Vacio titulo={vista === 'pendiente' ? 'No hay renglones pendientes este mes.' : 'Sin renglones este mes.'} />
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
