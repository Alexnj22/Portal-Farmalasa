// Reglas de despacho, NATIVO — la pestaña «Reglas» de Pedidos del portal
// (`TabReglas`): en qué presentación, de a cuánto y con qué etiqueta sale cada
// producto de Bodega. Las cuentas de arriba (con regla, sin regla, nuevos del
// mes), los filtros del portal (con/sin regla, sólo los nuevos, laboratorio) y
// la búsqueda con su regla (`fetchProductsWithLabPage`, paginada en el
// servidor). Los laboratorios ocultos en MIN·MAX no aparecen, igual que allá.
//
// Tocar un producto abre su regla (`pedido/regla/[id]`); editar pide
// `pedidos_tab_reglas` con permiso de edición.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchActiveProductsCount, fetchAllDispatchRules, fetchLaboratorios, fetchNewProductsThisMonth, fetchProductsWithLabPage } from '@nucleo/data/dispatchRules';
import { rotuloDeRegla } from '@nucleo/utils/reglasDeDespacho';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../../componentes/Filtros';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';

const POR_PAGINA = 40;

function Cuenta({ rotulo, valor, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Vidrio radio={18}>
        <View style={{ padding: 12, gap: 2 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{rotulo}</Text>
          <Text style={{ color: color ?? colorSistema.texto, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor ?? '—'}</Text>
        </View>
      </Vidrio>
    </View>
  );
}

export default function ReglasDeDespacho() {
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const [conRegla, setConRegla] = useState('');
  const [nuevos, setNuevos] = useState('no');
  const [lab, setLab] = useState('todos');
  const [labs, setLabs] = useState(null);
  const [ocultos, setOcultos] = useState(null);
  const [reglas, setReglas] = useState(null);
  const [cuentas, setCuentas] = useState({ total: null, nuevos: null, idsNuevos: new Set() });
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({ filas: [], total: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const pedido = useRef(0);

  useEffect(() => {
    Promise.resolve(fetchLaboratorios()).then(({ data }) => {
      const filas = data ?? [];
      setOcultos(filas.filter((l) => l.ocultar_en_minmax).map((l) => l.id));
      setLabs(filas.filter((l) => !l.ocultar_en_minmax && l.nombre).map((l) => ({ id: String(l.id), label: l.nombre })));
    }).catch(() => { setOcultos([]); setLabs([]); });
  }, []);

  // Las reglas y las cuentas: se releen al volver de editar una.
  const cargarReglas = useCallback(async () => {
    try {
      const ahora = new Date();
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
      const [todas, total, mes] = await Promise.all([fetchAllDispatchRules(), fetchActiveProductsCount(), fetchNewProductsThisMonth(inicioMes)]);
      const mapa = {};
      for (const r of todas ?? []) mapa[r.erp_product_id] = { ...r, dispatch_tipo: r.presentaciones?.tipo ?? null };
      setReglas(mapa);
      setCuentas({ total: total.count ?? 0, nuevos: mes.count ?? 0, idsNuevos: new Set((mes.data ?? []).map((p) => p.id)) });
    } catch (e) {
      setError(mensajeAmigable(e));
      setReglas((r) => r ?? {});
    }
  }, []);
  useFocusEffect(useCallback(() => { cargarReglas(); }, [cargarReglas]));
  useEffect(() => { setPagina(1); }, [busqueda, conRegla, nuevos, lab]);

  const idsConRegla = useMemo(() => Object.keys(reglas ?? {}).map(Number), [reglas]);
  const cargar = useCallback(async () => {
    if (reglas == null || ocultos == null) return;
    const yo = ++pedido.current;
    setCargando(true);
    try {
      const { data, count, error: e } = await fetchProductsWithLabPage({
        offset: (pagina - 1) * POR_PAGINA, pageSize: POR_PAGINA, hiddenLabs: ocultos, labId: lab === 'todos' ? null : Number(lab),
        sortKey: 'laboratorio_nombre', ascending: true, term: busqueda.length >= 2 ? busqueda : '',
        ruleFilter: conRegla, ruleIds: idsConRegla, soloNuevos: nuevos === 'si', newIds: cuentas.idsNuevos,
      });
      if (yo !== pedido.current) return;
      if (e) throw e;
      setError(null);
      setDatos((d) => ({ filas: pagina === 1 ? (data ?? []) : [...d.filas, ...(data ?? [])], total: count ?? 0 }));
    } catch (e) {
      if (yo === pedido.current) setError(mensajeAmigable(e));
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [reglas, ocultos, pagina, lab, busqueda, conRegla, idsConRegla, nuevos, cuentas.idsNuevos]);
  useEffect(() => { cargar(); }, [cargar]);

  const conCuenta = idsConRegla.length;
  const grupos = [
    { id: 'regla', titulo: 'Regla', activa: conRegla, porDefecto: '', onCambiar: setConRegla,
      opciones: [{ id: '', label: 'Todos' }, { id: 'con', label: 'Con regla' }, { id: 'sin', label: 'Sin regla' }] },
    { id: 'nuevos', titulo: 'Nuevos', activa: nuevos, porDefecto: 'no', onCambiar: setNuevos,
      opciones: [{ id: 'no', label: 'Todos los productos' }, { id: 'si', label: `Sólo los nuevos de ${fechaTexto(hoySV(), { month: 'long' })}` }] },
    { id: 'lab', titulo: 'Laboratorio', activa: lab, porDefecto: 'todos', onCambiar: setLab,
      opciones: [{ id: 'todos', label: 'Todos' }, ...(labs ?? [])] },
  ];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reglas de despacho', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Producto o laboratorio', onChangeText: (e) => setTexto(e.nativeEvent.text) } }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16 }}>
          <Cuenta rotulo="Con regla" valor={reglas ? conCuenta : null} color={MARCA.verde} />
          <Cuenta rotulo="Sin regla" valor={cuentas.total != null ? Math.max(0, cuentas.total - conCuenta) : null} color={MARCA.ambar} />
          <Cuenta rotulo="Nuevos del mes" valor={cuentas.nuevos} />
        </View>
        <FiltrosActivos grupos={grupos} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        <View style={{ marginHorizontal: 16 }}>
          <Vidrio radio={22}>
            <View style={{ paddingVertical: 4 }}>
              {datos.filas.map((p, i) => {
                const regla = reglas?.[p.id];
                const rot = rotuloDeRegla(regla);
                return (
                  <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/pedido/regla/[id]', params: { id: String(p.id), nombre: p.nombre, lab: p.laboratorio_nombre ?? '' } }); }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56,
                      borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, backgroundColor: pressed ? 'rgba(127,127,127,0.15)' : 'transparent' })}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{p.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{[p.laboratorio_nombre, cuentas.idsNuevos.has(p.id) ? 'nuevo' : null, regla?.notes].filter(Boolean).join(' · ')}</Text>
                    </View>
                    {p.es_antibiotico ? <Pildora texto="Bajo Receta" color={MARCA.ambar} /> : null}
                    <Pildora texto={rot ?? 'Sin regla'} color={rot ? MARCA.violetaClaro : colorSistema.texto2} />
                  </Pressable>
                );
              })}
              {cargando ? <ActivityIndicator style={{ marginVertical: 14 }} /> : !datos.filas.length ? (
                <Text style={{ color: colorSistema.texto2, textAlign: 'center', padding: 20, fontSize: 15 }}>Ningún producto con estos filtros.</Text>
              ) : null}
            </View>
          </Vidrio>
        </View>
        {!cargando && datos.filas.length < datos.total ? (
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto={`Ver más (${datos.total - datos.filas.length})`} borde onPress={() => setPagina((p) => p + 1)} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
