// Los premios del raspable de un nivel o de un rango de mayoreo, NATIVO — el
// `EditorDePremios` de `NivelesDelPrograma` del portal. Cada premio es de
// PUNTOS, de PRODUCTO (se entrega en la sala y se descarga del inventario) o
// PROMOCIONAL (sale del inventario de regalos). El peso es la probabilidad
// relativa; al lado, cuánto sale cada uno. Sin premios en descuento: la caja
// no cobra porcentajes. La forma de cada fila la dicta el núcleo
// (`filaDePremio` / `premiosLimpios`), la misma que valida la base.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { fetchPromocionales } from '@nucleo/data/puntos';
import { fetchPresentaciones } from '@nucleo/data/inventoryMovements';
import { CUPO_POR, TIPOS_DE_PREMIO, filaDePremio, probabilidadDePremio } from '@nucleo/utils/nivelesDePuntos';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Opciones } from '../formulario/Piezas';
import Segmentos from '../Segmentos';
import Vidrio from '../Vidrio';
import BuscadorProducto from '../compras/BuscadorProducto';
import { MARCA } from '../inicio/marca';

const Rotulo = ({ children }) => <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</Text>;

function FilaDeProducto({ p, poner, puedeEditar }) {
  const [buscando, setBuscando] = useState(!p.product_id);
  const [presentaciones, setPresentaciones] = useState(null);
  useEffect(() => {
    if (!p.product_id) return undefined;
    let vivo = true;
    Promise.resolve(fetchPresentaciones([p.product_id]))
      .then(({ porProducto }) => { if (vivo) setPresentaciones(porProducto.get(Number(p.product_id)) ?? []); })
      .catch(() => { if (vivo) setPresentaciones([]); });
    return () => { vivo = false; };
  }, [p.product_id]);
  if (buscando && puedeEditar) {
    return (
      <BuscadorProducto
        onElegir={(prod) => { poner({ product_id: Number(prod.id), nombre: prod.nombre, presentacion_tipo: '', factor: null }); setBuscando(false); }}
        onCancelar={() => setBuscando(false)} />
    );
  }
  const opciones = (presentaciones ?? []).map((x) => ({ id: `${x.tipo}|${x.factor}`, label: `${x.tipo} (${x.factor})` }));
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{p.nombre || 'Sin producto'}</Text>
        {puedeEditar ? (
          <Pressable onPress={() => setBuscando(true)} hitSlop={8} accessibilityRole="button" style={{ minHeight: 40, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Cambiar</Text>
          </Pressable>
        ) : null}
      </View>
      <Rotulo>Presentación</Rotulo>
      {presentaciones == null && p.product_id ? <ActivityIndicator /> : opciones.length ? (
        puedeEditar
          ? <Opciones opciones={opciones} valor={p.presentacion_tipo && p.factor ? `${p.presentacion_tipo}|${p.factor}` : ''}
            onCambiar={(v) => { const [t, f] = String(v).split('|'); poner({ presentacion_tipo: t, factor: Number(f) }); }} />
          : <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.presentacion_tipo ? `${p.presentacion_tipo} (${p.factor})` : '—'}</Text>
      ) : <Aviso tono="cuidado" texto="Ese producto no tiene presentaciones." />}
      <Rotulo>Cantidad</Rotulo>
      <Campo multiline={false} value={p.cantidad} editable={puedeEditar} keyboardType="number-pad" placeholder="1 a 20"
        onChangeText={(v) => poner({ cantidad: v.replace(/\D/g, '') })} accessibilityLabel="Cantidad" />
    </View>
  );
}

export default function EditorDePremios({ premios, alCambiar, puedeEditar }) {
  const lista = premios ?? [];
  const ponerVarios = (i, cambios) => alCambiar(lista.map((p, j) => (j === i ? { ...p, ...cambios } : p)));
  const [promos, setPromos] = useState(null);
  const hayPromo = lista.some((p) => p.tipo === 'promocional');
  useEffect(() => {
    if (!hayPromo || promos) return undefined;
    let vivo = true;
    Promise.resolve(fetchPromocionales())
      .then((r) => { if (vivo) setPromos((r?.promocionales ?? []).filter((x) => x.activo)); })
      .catch(() => { if (vivo) setPromos([]); });
    return () => { vivo = false; };
  }, [hayPromo, promos]);

  return (
    <View style={{ gap: 10 }}>
      {!lista.length ? <Aviso texto="Sin premios: no se da raspable aquí." /> : null}
      {lista.map((p, i) => (
        <Vidrio key={i} radio={16}>
          <View style={{ padding: 12, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '800' }}>{`Premio ${i + 1}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{`Sale ${probabilidadDePremio(lista, p)}`}</Text>
              {puedeEditar ? (
                <Pressable onPress={() => alCambiar(lista.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quitar premio"
                  style={{ minHeight: 40, justifyContent: 'center', paddingLeft: 6 }}>
                  <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
                </Pressable>
              ) : null}
            </View>
            {puedeEditar ? (
              <Segmentos margen={0} activa={p.tipo ?? 'puntos'} opciones={TIPOS_DE_PREMIO.map((t) => ({ id: t.value, label: t.label }))}
                onCambiar={(v) => ponerVarios(i, { ...filaDePremio({ peso: p.peso }), tipo: v })} />
            ) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{TIPOS_DE_PREMIO.find((t) => t.value === (p.tipo ?? 'puntos'))?.label}</Text>}
            <Rotulo>Peso</Rotulo>
            <Campo multiline={false} value={p.peso ?? ''} editable={puedeEditar} keyboardType="number-pad" placeholder="Probabilidad relativa"
              onChangeText={(v) => ponerVarios(i, { peso: v.replace(/\D/g, '') })} accessibilityLabel="Peso" />
            {(p.tipo ?? 'puntos') === 'puntos' ? (
              <>
                <Rotulo>Puntos</Rotulo>
                <Campo multiline={false} value={p.puntos ?? ''} editable={puedeEditar} keyboardType="number-pad" placeholder="1 a 10,000 · 100 puntos = $1"
                  onChangeText={(v) => ponerVarios(i, { puntos: v.replace(/\D/g, '') })} accessibilityLabel="Puntos" />
              </>
            ) : null}
            {p.tipo === 'producto' ? <FilaDeProducto p={p} puedeEditar={puedeEditar} poner={(c) => ponerVarios(i, c)} /> : null}
            {p.tipo === 'promocional' ? (
              <>
                <Rotulo>Regalo</Rotulo>
                {promos == null ? <ActivityIndicator /> : !promos.length
                  ? <Aviso tono="cuidado" texto="No hay regalos en el catálogo: créalos en la pestaña Premios." />
                  : puedeEditar ? (
                    <Opciones opciones={promos.map((x) => ({ id: x.id, label: x.nombre }))} valor={p.promocional_id ?? ''}
                      onCambiar={(v) => ponerVarios(i, { promocional_id: Number(v), nombre: promos.find((x) => Number(x.id) === Number(v))?.nombre ?? '' })} />
                  ) : <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre || '—'}</Text>}
              </>
            ) : null}
            {p.tipo === 'producto' || p.tipo === 'promocional' ? (
              <>
                <Rotulo>Cupo al mes</Rotulo>
                <Campo multiline={false} value={p.cupo ?? ''} editable={puedeEditar} keyboardType="number-pad" placeholder="Sin cupo"
                  onChangeText={(v) => ponerVarios(i, { cupo: v.replace(/\D/g, '') })} accessibilityLabel="Cupo al mes" />
                {Number(p.cupo) > 0 ? (
                  puedeEditar
                    ? <Segmentos margen={0} activa={p.cupo_por ?? 'general'} opciones={CUPO_POR.map((c) => ({ id: c.value, label: c.label }))}
                      onCambiar={(v) => ponerVarios(i, { cupo_por: v })} />
                    : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{CUPO_POR.find((c) => c.value === (p.cupo_por ?? 'general'))?.label}</Text>
                ) : null}
              </>
            ) : null}
          </View>
        </Vidrio>
      ))}
      {puedeEditar && lista.length < 12 ? <BotonGrande texto="Agregar premio" borde onPress={() => alCambiar([...lista, filaDePremio({})])} /> : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
        El peso es la probabilidad relativa: «Sale» dice cuánto sale cada uno. Un producto se entrega en la sala y se descarga del inventario; un promocional sale del inventario de regalos de esa sala. Un premio sin existencia, sin cupo o que ya no cabe en el tope del mes no se sortea: sale otro de la lista. «En cada sucursal» cuenta en la sala donde se retira: la que ya entregó su cupo del mes no lo entrega, y se retira en otra. No hay premios en descuento: la caja no cobra porcentajes.
      </Text>
    </View>
  );
}
