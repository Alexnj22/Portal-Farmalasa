// Consulta de precios, NATIVA — el widget «Consulta de precios» del Inicio del
// portal (2026-11-15). En la app la búsqueda vive en la barra (como Buscar):
// se escribe el producto o el principio activo y tocar uno abre sus precios
// por presentación (`/precio/[id]`). Sólo productos con existencia, igual que
// el portal (`buscar_inventario_global_v2`).
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Presionable as Pressable } from '../componentes/Tocable';
import Indicador from '../componentes/Indicador';
import { buscarInventarioGlobalV2 } from '@nucleo/data/inventory';
import { MIN_LETRAS_BUSQUEDA, resumirPorProducto } from '@nucleo/utils/consultaInventario';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Vacio } from '../componentes/formulario/Piezas';
import Vidrio from '../componentes/Vidrio';
import IconoFijo from '../componentes/IconoFijo';
import { iconoDe } from '../tema/iconos';

const TOPE = 20;

export default function ConsultaPrecios() {
  const [texto, setTexto, aplicado] = useBusqueda();
  const [estado, setEstado] = useState({ cargando: false, lista: [], error: null });
  const q = aplicado.trim();
  const buscando = q.length >= MIN_LETRAS_BUSQUEDA;

  useEffect(() => {
    if (!buscando) { setEstado({ cargando: false, lista: [], error: null }); return undefined; }
    let vivo = true;
    setEstado((e) => ({ ...e, cargando: true }));
    buscarInventarioGlobalV2(q, TOPE).then((r) => {
      if (!vivo) return;
      setEstado({ cargando: false, lista: r.error ? [] : resumirPorProducto(r.filas), error: r.error ? mensajeAmigable(r.error) : null });
    });
    return () => { vivo = false; };
  }, [q, buscando]);

  const abrir = (p) => p.erp_product_id && router.push({ pathname: '/precio/[id]', params: { id: String(p.erp_product_id), nombre: p.descripcion } });

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA,
        title: 'Consulta de precios',
        headerSearchBarOptions: {
          placement: 'stacked',
          hideWhenScrolling: false,
          placeholder: 'Producto o principio activo',
          autoCapitalize: 'none',
          autoFocus: true,
          onChangeText: (e) => setTexto(e.nativeEvent.text),
          onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        {!texto ? <Vacio icono="Tag" titulo="Busca un producto" detalle="Sus precios por presentación y lo que hay en tu sucursal." /> : null}
        {texto && !buscando ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 24 }}>Escribe al menos {MIN_LETRAS_BUSQUEDA} letras.</Text>
        ) : null}
        {estado.error ? <Aviso tono="freno" texto={estado.error} /> : null}
        {buscando && estado.cargando && !estado.lista.length ? <Indicador /> : null}
        {estado.lista.length ? (
          <Vidrio radio={20}>
            {estado.lista.map((p, i) => (
              <Pressable key={p.erp_product_id ?? p.descripcion} onPress={() => abrir(p)} style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, minHeight: 44,
                borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador,
                backgroundColor: pressed ? colorSistema.separador : 'transparent',
              })}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colorSistema.acentoTinte, alignItems: 'center', justifyContent: 'center' }}>
                  <IconoFijo name={iconoDe('Tag')} size={18} color={colorSistema.acento} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }} numberOfLines={2}>{p.descripcion}</Text>
                  {p.principioActivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{p.principioActivo}</Text> : null}
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text>
              </Pressable>
            ))}
          </Vidrio>
        ) : null}
        {buscando && !estado.cargando && !estado.error && !estado.lista.length ? (
          <Vacio icono="Search" titulo={`Ningún producto con existencia dice «${q}»`} detalle="Revisa la ortografía o prueba con el principio activo." />
        ) : null}
      </ScrollView>
    </>
  );
}
