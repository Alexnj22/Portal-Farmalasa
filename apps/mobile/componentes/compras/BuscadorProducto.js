// Elegir el producto a mano en «Cargar compra» — el `BuscadorProducto` del
// portal: busca por nombre con la regla del portal (`buscarProductos` de
// `cargarCompra`) y muestra el código de barras para distinguir parecidos.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { buscarProductos } from '@nucleo/data/cargarCompra';
import { colorSistema } from '../Formulario';
import { Campo } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

export default function BuscadorProducto({ onElegir, onCancelar }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [parecidos, setParecidos] = useState(false);
  const [buscando, setBuscando] = useState(false);
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setRes([]); return; }
      setBuscando(true);
      const { filas, aproximado } = await Promise.resolve(buscarProductos(q)).catch(() => ({ filas: [] }));
      if (vivo) { setRes(filas ?? []); setParecidos(!!aproximado); setBuscando(false); }
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [q]);
  return (
    <View style={{ gap: 6, paddingTop: 6 }}>
      <Campo multiline={false} autoFocus value={q} onChangeText={setQ} placeholder="Buscar el producto por nombre…" />
      {parecidos && res.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`No hay uno exacto para «${q}»: estos se parecen.`}</Text> : null}
      {buscando ? <ActivityIndicator /> : res.map((p) => (
        <Pressable key={p.id} onPress={() => onElegir(p)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
          {p.codigo_barras ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.codigo_barras}</Text> : null}
        </Pressable>
      ))}
      {q.trim().length >= 3 && !buscando && !res.length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Nada coincide con «${q}».`}</Text> : null}
      <Pressable onPress={onCancelar} style={{ minHeight: 40, justifyContent: 'center' }}>
        <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Cancelar</Text>
      </Pressable>
    </View>
  );
}
