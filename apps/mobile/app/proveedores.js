// Proveedores, NATIVO — el directorio (`ProveedoresView` › Listado): cada
// proveedor con su nombre comercial, NIT y NRC, su categoría, cuántos
// documentos le hemos recibido y cuándo fue la última compra. Busca por
// nombre, alias o NIT; filtra por categoría. Tocar uno abre su ficha
// (`proveedor/[id]`) con lo que le debemos.
//
// Clasificar, la deducibilidad del IVA y vincular con el registro de compras
// se hacen en el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchProveedorCategorias, fetchProveedoresMaestro } from '@nucleo/data/proveedores';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { guardarProveedores } from '../componentes/compras/proveedores';

const POR_PAGINA = 40;

export default function Proveedores() {
  const [filas, setFilas] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState('todas');
  const [activos, setActivos] = useState('activos');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([fetchProveedoresMaestro(), fetchProveedorCategorias()]);
      guardarProveedores(d);
      setFilas(d); setCategorias(c.data || []); setError(null);
    } catch (e) { setError(mensajeAmigable(e)); setFilas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setMostrar(POR_PAGINA); }, [texto, categoria, activos]);

  const q = texto.trim();
  const visibles = useMemo(() => (filas || []).filter((r) => {
    if (activos === 'activos' && r.activo === false) return false;
    if (categoria === 'sin' && r.categoria_id) return false;
    if (categoria !== 'todas' && categoria !== 'sin' && String(r.categoria_id) !== categoria) return false;
    return !q || tokenMatch(q, r.nombre, r.alias, r.nombre_comercial, r.nit, r.nrc);
  }).sort((a, b) => (Number(b.docs_count) || 0) - (Number(a.docs_count) || 0)), [filas, q, categoria, activos]);

  const grupos = [
    { id: 'categoria', titulo: 'Categoría', activa: categoria, porDefecto: 'todas', onCambiar: setCategoria,
      opciones: [{ id: 'todas', label: 'Todas' }, { id: 'sin', label: 'Sin categoría' }, ...categorias.map((c) => ({ id: String(c.id), label: c.nombre }))] },
    { id: 'activos', titulo: 'Estado', activa: activos, porDefecto: 'activos', onCambiar: setActivos,
      opciones: [{ id: 'activos', label: 'Activos' }, { id: 'todos', label: 'Todos' }] },
  ];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Proveedores', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Nombre, alias o NIT', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {filas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${visibles.length.toLocaleString('es-SV')} proveedores`}</Text> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.slice(0, mostrar).map((r) => (
          <Pressable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/proveedor/[id]', params: { id: String(r.id) } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              <View style={{ padding: 12, gap: 4 }}>
                <Text style={{ color: r.activo === false ? colorSistema.texto2 : colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{r.alias || r.nombre_comercial || r.nombre}</Text>
                {(r.alias || r.nombre_comercial) && r.nombre ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{r.nombre}</Text> : null}
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                  {[r.nit ? `NIT ${r.nit}` : null, `${Number(r.docs_count || 0).toLocaleString('es-SV')} docs`, r.ultima_vez_visto ? `última ${fechaTexto(r.ultima_vez_visto, { day: 'numeric', month: 'short', year: 'numeric' })}` : null].filter(Boolean).join(' · ')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {r.categoria_nombre ? <Pildora texto={r.categoria_nombre} color={MARCA.azulClaro} /> : <Pildora texto="Sin categoría" color={MARCA.ambar} />}
                  {r.activo === false ? <Pildora texto="Inactivo" color={colorSistema.texto2} /> : null}
                </View>
              </View>
            </Vidrio>
          </Pressable>
        ))}
        {filas && visibles.length > mostrar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setMostrar((n) => n + POR_PAGINA)} /></View> : null}
        {filas && !visibles.length && !error ? (
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{q ? 'Ningún proveedor con esa búsqueda' : 'Sin proveedores'}</Text>
        ) : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Clasificar y deducibilidad (portal)" borde color={colorSistema.texto2}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/proveedores', nombre: 'Proveedores' } })} />
        </View>
      </ScrollView>
    </>
  );
}
