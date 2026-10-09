// Proveedores, NATIVO — el directorio (`ProveedoresView` › Listado): cada
// proveedor con su nombre comercial, NIT y NRC, su categoría, cuántos
// documentos le hemos recibido y cuándo fue la última compra. Busca por
// nombre, alias o NIT; filtra por categoría. Tocar uno abre su ficha
// (`proveedor/[id]`) con lo que le debemos.
//
// Filtros del portal: categoría, clase contable, vínculo con el registro de
// compras, deducibilidad del IVA (sin clasificar / propuesta / confirmada) e
// inactivos; y los mismos órdenes (documentos, última compra, nombre,
// categoría). La ficha edita lo mismo que el portal; la revisión de
// deducibilidad por regla es `proveedores-fiscal` y la categoría en lote,
// `proveedores-lote`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchProveedorCategorias, fetchProveedoresMaestro } from '@nucleo/data/proveedores';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { CLASE_LABELS } from '@nucleo/utils/proveedorFicha';
import { ESTADO_CLASIF } from '@nucleo/utils/f07Catalogos';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { useMasAlFinal } from '../componentes/ListaPaginada';
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
  const [clase, setClase] = useState('todas');
  const [vinculo, setVinculo] = useState('todos');
  const [deduc, setDeduc] = useState('todas');
  const [orden, setOrden] = useState('docs');
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
  useEffect(() => { setMostrar(POR_PAGINA); }, [texto, categoria, activos, clase, vinculo, deduc, orden]);
  const claseDe = useMemo(() => new Map(categorias.map((c) => [String(c.id), c.clase])), [categorias]);

  const q = texto.trim();
  const visibles = useMemo(() => (filas || []).filter((r) => {
    if (activos === 'activos' && r.activo === false) return false;
    if (categoria === 'sin' && r.categoria_id) return false;
    if (categoria !== 'todas' && categoria !== 'sin' && String(r.categoria_id) !== categoria) return false;
    if (clase !== 'todas' && claseDe.get(String(r.categoria_id)) !== clase) return false;
    if (vinculo === 'si' && !r.supplier_id) return false;
    if (vinculo === 'no' && r.supplier_id) return false;
    if (deduc !== 'todas' && (r.clasificacion_estado || 'pendiente') !== deduc) return false;
    return !q || tokenMatch(q, r.nombre, r.alias, r.nombre_comercial, r.nit, r.nrc);
  }).sort((a, b) => {
    if (orden === 'nombre') return String(a.alias || a.nombre).localeCompare(String(b.alias || b.nombre), 'es');
    if (orden === 'categoria') return String(a.categoria_nombre || 'zzz').localeCompare(String(b.categoria_nombre || 'zzz'), 'es');
    if (orden === 'ultima') return String(b.ultima_vez_visto || '').localeCompare(String(a.ultima_vez_visto || ''));
    return (Number(b.docs_count) || 0) - (Number(a.docs_count) || 0);
  }), [filas, q, categoria, activos, clase, vinculo, deduc, orden, claseDe]);

  const grupos = [
    { id: 'categoria', titulo: 'Categoría', activa: categoria, porDefecto: 'todas', onCambiar: setCategoria,
      opciones: [{ id: 'todas', label: 'Todas' }, { id: 'sin', label: 'Sin categoría' }, ...categorias.map((c) => ({ id: String(c.id), label: c.nombre }))] },
    { id: 'clase', titulo: 'Clase', activa: clase, porDefecto: 'todas', onCambiar: setClase,
      opciones: [{ id: 'todas', label: 'Todas' }, ...Object.entries(CLASE_LABELS).map(([k, v]) => ({ id: k, label: v }))] },
    { id: 'vinculo', titulo: 'Vínculo', activa: vinculo, porDefecto: 'todos', onCambiar: setVinculo,
      opciones: [{ id: 'todos', label: 'Todos' }, { id: 'si', label: 'Vinculados' }, { id: 'no', label: 'Sin vincular' }] },
    { id: 'deduc', titulo: 'Deducibilidad', activa: deduc, porDefecto: 'todas', onCambiar: setDeduc,
      opciones: [{ id: 'todas', label: 'Todas' }, ...Object.entries(ESTADO_CLASIF).map(([k, v]) => ({ id: k, label: v.label }))] },
    { id: 'activos', titulo: 'Estado', activa: activos, porDefecto: 'activos', onCambiar: setActivos,
      opciones: [{ id: 'activos', label: 'Activos' }, { id: 'todos', label: 'Incluir inactivos' }] },
    { id: 'orden', titulo: 'Ordenar', activa: orden, porDefecto: 'docs', onCambiar: setOrden,
      opciones: [{ id: 'docs', label: 'Más documentos' }, { id: 'ultima', label: 'Última compra' }, { id: 'nombre', label: 'Nombre' }, { id: 'categoria', label: 'Categoría' }] },
  ];

  // Al llegar abajo se pinta la página siguiente sola; «Ver más» queda de respaldo.
  const alFinal = useMasAlFinal(() => setMostrar((n) => n + POR_PAGINA), !!filas && visibles.length > mostrar);

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
      <ScrollView {...alFinal} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Revisar la deducibilidad por regla" borde onPress={() => router.push('/proveedores-fiscal')} /></View>
        <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Categoría en lote" borde onPress={() => router.push('/proveedores-lote')} /></View>
        {filas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${visibles.length.toLocaleString('es-SV')} proveedores`}</Text> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.slice(0, mostrar).map((r) => (
          <Pressable key={r.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/proveedor/[id]', params: { id: String(r.id) } }); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              <View style={{ padding: 12, gap: 4 }}>
                <Text style={{ color: r.activo === false ? colorSistema.texto2 : colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.alias || r.nombre_comercial || r.nombre}</Text>
                {(r.alias || r.nombre_comercial) && r.nombre ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{r.nombre}</Text> : null}
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {[r.nit ? `NIT ${r.nit}` : null, `${Number(r.docs_count || 0).toLocaleString('es-SV')} docs`, r.ultima_vez_visto ? `última ${fechaTexto(r.ultima_vez_visto, { day: 'numeric', month: 'short', year: 'numeric' })}` : null].filter(Boolean).join(' · ')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {r.categoria_nombre ? <Pildora texto={r.categoria_nombre} color={MARCA.azulClaro} /> : <Pildora texto="Sin categoría" color={MARCA.ambar} />}
                  {r.clasificacion_estado && r.clasificacion_estado !== 'confirmada' ? <Pildora texto={`IVA: ${ESTADO_CLASIF[r.clasificacion_estado]?.label ?? r.clasificacion_estado}`} color={r.clasificacion_estado === 'pendiente' ? MARCA.ambar : MARCA.azulClaro} /> : null}
                  {r.iva_deducible === false ? <Pildora texto="No deducible" color={colorSistema.texto2} /> : null}
                  {!r.supplier_id ? <Pildora texto="Sin vincular" color={MARCA.ambar} /> : null}
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
      </ScrollView>
    </>
  );
}
