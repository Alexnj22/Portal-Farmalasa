// Un renglón de una compra a proveedor: el producto del catálogo (con lo que
// decía el documento del proveedor encima), por caja, unidades, costo, lote y
// vencimiento, su subtotal y —si el proveedor es relacionada— los avisos de
// precio fuera de mercado. Editable sólo mientras la compra es borrador.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { cambiarUnidadesPor, subtotalRenglon } from '@nucleo/utils/distribucionCompras';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';
import Vidrio from '../../Vidrio';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';
import { Pildora } from '../../avisos/Piezas';
import Fecha from '../../formulario/Fecha';
import { CampoConRotulo } from '../../personas/Formulario';
import { ElegirLargo, PETROLEO, colorDe } from './Piezas';

function Medio({ children }) {
  return <View style={{ flex: 1, minWidth: 130 }}>{children}</View>;
}

export default function RenglonDeCompra({ it, i, editable, tipoDoc, opcionesProducto, nombreDe, mal, avisos = [], onCambiar, onQuitar }) {
  return (
    <Vidrio radio={20} tinte={mal ? `${MARCA.rojo}1F` : undefined}>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>{`Renglón ${i + 1}`}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(subtotalRenglon(it))}</Text>
          {editable ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Quitar renglón ${i + 1}`} hitSlop={8}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); onQuitar(); }}
              style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: 10, borderRadius: 17, justifyContent: 'center', backgroundColor: `${MARCA.rojo}26`, opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '700' }}>Quitar</Text>
            </Pressable>
          ) : null}
        </View>
        {it.descripcion_proveedor ? (
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
            {`${it.codigo_proveedor ? `${it.codigo_proveedor} · ` : ''}${it.descripcion_proveedor}`}
            {it.recordado ? <Text style={{ color: MARCA.verde, fontWeight: '700' }}> · recordado</Text> : null}
          </Text>
        ) : null}
        {editable ? (
          <ElegirLargo valor={it.product_id ? String(it.product_id) : ''} opciones={opcionesProducto} textoBoton="Producto del catálogo…"
            rotulo="Producto" error={!it.product_id ? 'Elige el producto del catálogo.' : undefined}
            onCambiar={(v) => onCambiar({ product_id: v ? Number(v) : null })} />
        ) : <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{nombreDe(it)}</Text>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {it.cantidad_doc > 0 && editable ? (
            <Medio>
              <CampoConRotulo rotulo={`Por caja (${it.cantidad_doc} en el doc.)`} value={String(it.unidades_por ?? 1)} keyboardType="number-pad"
                onChangeText={(v) => onCambiar(cambiarUnidadesPor(it, v), true)} />
            </Medio>
          ) : null}
          <Medio>
            <CampoConRotulo rotulo="Unidades" value={it.cantidad} editable={editable} keyboardType="number-pad" onChangeText={(v) => onCambiar({ cantidad: v })} />
          </Medio>
          <Medio>
            <CampoConRotulo rotulo={`Costo unit. (${tipoDoc === '03' ? 'sin IVA' : 'con IVA'})`} value={it.costo_unitario} editable={editable}
              keyboardType="decimal-pad" onChangeText={(v) => onCambiar({ costo_unitario: v })} />
          </Medio>
          <Medio>
            <CampoConRotulo rotulo="Lote" value={it.lote} editable={editable} autoCapitalize="characters"
              onChangeText={(v) => onCambiar({ lote: v.toUpperCase() })} />
          </Medio>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Vence</Text>
          {!editable ? <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>{it.vence ? fechaNumerica(it.vence) : '—'}</Text>
            : it.vence ? <Fecha valor={it.vence} onCambiar={(v) => onCambiar({ vence: v })} />
              : <Text onPress={() => onCambiar({ vence: hoySV() })} style={{ color: PETROLEO, fontSize: 15, fontWeight: '600' }}>Poner fecha</Text>}
        </View>
        {avisos.length ? (
          <View style={{ gap: 6 }}>
            {avisos.map((a) => <Pildora key={a.clave} texto={a.texto} color={colorDe(a.nivel)} />)}
          </View>
        ) : null}
      </View>
    </Vidrio>
  );
}
