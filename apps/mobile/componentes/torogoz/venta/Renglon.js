// Un renglón de la venta, como tarjeta: producto, lote y existencia arriba;
// cantidad, presentación, precio·lista y descuento abajo; el importe a la
// derecha. Lo que dice cada línea es lo mismo que el renglón del portal.
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { listasDe, precioDe } from '@nucleo/utils/distribucionPrecios';
import { mesVence, soloNumero } from '@nucleo/utils/distribucionVenta';
import Vidrio from '../../Vidrio';
import { colorSistema } from '../../Formulario';
import { Campo } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { Eleccion, Etiqueta, PETROLEO } from './Piezas';

function Paso({ texto, onPress, deshabilitado, etiqueta }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} hitSlop={6}
      accessibilityRole="button" accessibilityLabel={etiqueta}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.18)', opacity: deshabilitado ? 0.35 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

const Linea = ({ children, color, fuerte }) => (
  <Text style={{ color: color ?? colorSistema.texto2, fontSize: 13, fontWeight: fuerte ? '700' : '400' }}>{children}</Text>
);

export default function Renglon({ l, lineas, idx, conIva, listaEfectiva, existencias, onCambiar, onRepartir, onSumar, onQuitar, onPerdida }) {
  const nombre = l.p?.nombre ?? `Producto ${l.product_id}`;
  const visto = (p) => (conIva ? p : p / 1.13);
  // Una presentación ya tomada por OTRO renglón del mismo producto y lote no se ofrece.
  const ocupadas = new Set(lineas.filter(o => o.clave !== l.clave && o.product_id === l.product_id
    && String(o.lote_id ?? '') === String(l.lote_id ?? '')).map(o => o.presentacion));
  const opcPres = l.presentaciones.filter(x => !ocupadas.has(x.presentacion))
    .map(x => ({ value: x.presentacion, label: x.unidades > 1 ? `${x.presentacion} · ${x.unidades} u.` : x.presentacion }));
  const opcListas = l.p ? listasDe(idx, l.p.product_id, l.presentacion).map(x => {
    const pr = precioDe(idx, l.p, l.presentacion, x.id);
    return { value: String(x.id), label: `${formatMoney(visto(pr?.precio ?? 0))} · Lista ${x.nombre}` };
  }) : [];
  const nombreLista = l.r?.listaId != null ? idx.listas.find(x => x.id === l.r.listaId)?.nombre : null;
  const porPresentacion = l.presentaciones.find(x => x.presentacion === l.presentacion)?.unidades ?? 1;
  const errDesc = l.descMalo ? 'No es un número' : l.pasaImporte ? 'Pasa del importe' : null;
  const opcLotes = l.libres.map(x => ({
    value: String(x.id), label: `${x.lote} · vence ${mesVence(x.vence)} · hay ${x.libre} u.`,
    deshabilitada: x.libre < l.por && x.id !== l.lote?.id,
  }));
  const motivoPerdida = l.quien.length ? `No hay más: ${l.quien.join(' y ')} lo está vendiendo`
    : l.hay ? `Sólo hay ${l.hay} en existencia` : 'Sin existencia en ningún lote';

  return (
    <Vidrio radio={20}>
      <View style={{ padding: 14, gap: 10, backgroundColor: l.porAprobar ? `${MARCA.ambar}14` : undefined }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{nombre}</Text>
            <Linea>
              {[l.hay != null ? `Total ${l.hay}` : null,
                l.lote ? `Lote ${l.lote.lote} · ${l.libreLote} u. · vence ${mesVence(l.lote.vence)}` : existencias ? 'Sin lote' : null,
                porPresentacion > 1 ? `${l.presentacion} de ${porPresentacion} u.` : null,
                nombreLista ? `Lista ${nombreLista}` : null].filter(Boolean).join(' · ')}
            </Linea>
            {l.faltaExistencia ? <Linea color={MARCA.rojo} fuerte>{`Faltan ${l.faltan}${l.quien.length ? ` · ${l.quien.join(' y ')} lo está vendiendo` : ''}`}</Linea> : null}
            {l.noVa ? <Linea color={MARCA.rojo} fuerte>No se le vende a este cliente</Linea> : null}
            {l.sinPrecio ? <Linea color={MARCA.rojo} fuerte>Sin precio en esta presentación</Linea> : null}
            {!l.porAprobar && l.descEstado === 'rechazado' && !l.descValor ? <Linea>Descuento rechazado</Linea> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{formatMoney(l.doc?.importe ?? 0)}</Text>
            {l.doc?.descuento > 0 ? <Linea color={MARCA.verde}>{`−${formatMoney(l.doc.descuento)}${l.delCatalogo ? ' · catálogo' : ''}`}</Linea> : null}
            {l.porAprobar ? <Etiqueta tono="cuidado" texto="Descuento por aprobar" /> : null}
            {l.otraLista ? <Etiqueta tono="marca" texto="Otra lista" /> : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Cantidad</Text>
          <Paso texto="−" etiqueta="Uno menos" deshabilitado={(l.n ?? 0) <= 1} onPress={() => onSumar(-1)} />
          <Campo multiline={false} keyboardType="decimal-pad" value={l.cantidad} selectTextOnFocus accessibilityLabel={`Cantidad de ${nombre}`}
            onChangeText={(t) => onCambiar({ cantidad: soloNumero(t) })} onEndEditing={() => onRepartir({})}
            style={{ width: 72, textAlign: 'center', fontWeight: '800', borderWidth: !l.n || l.n <= 0 ? 1 : 0, borderColor: MARCA.rojo }} />
          <Paso texto="+" etiqueta="Uno más" onPress={() => onSumar(1)} />
        </View>
        {opcPres.length > 1 ? (
          <Eleccion rotulo="Presentación" valor={l.presentacion} opciones={opcPres} onCambiar={(v) => onRepartir({ presentacion: v, lista_id: '' })} />
        ) : null}
        {opcListas.length > 1 ? (
          <Eleccion rotulo={`Precio ${conIva ? 'c/IVA' : 's/IVA'}`} valor={l.r?.listaId != null ? String(l.r.listaId) : ''} opciones={opcListas}
            onCambiar={(v) => onCambiar({ lista_id: v && Number(v) !== listaEfectiva ? v : '' })} />
        ) : (
          <View style={{ flexDirection: 'row', minHeight: 32, alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{`Precio ${conIva ? 'c/IVA' : 's/IVA'}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 16, fontVariant: ['tabular-nums'] }}>{l.r ? formatMoney(l.doc?.precioUni ?? visto(l.r.precio)) : '—'}</Text>
          </View>
        )}
        {opcLotes.length > 1 ? (
          <Eleccion rotulo="Lote" valor={l.lote ? String(l.lote.id) : ''} opciones={opcLotes} mensaje="Primero vence, primero sale."
            onCambiar={(v) => onRepartir({ lote_id: Number(v) })} />
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>Descuento</Text>
          <Campo multiline={false} keyboardType="decimal-pad" value={l.descValor} placeholder="0" selectTextOnFocus accessibilityLabel={`Descuento de ${nombre}`}
            onChangeText={(t) => onCambiar({ descValor: soloNumero(t) })}
            style={{ width: 90, textAlign: 'right', borderWidth: errDesc ? 1 : 0, borderColor: MARCA.rojo }} />
          <Pressable accessibilityRole="button" accessibilityLabel={l.descTipo === 'pct' ? 'En porcentaje, tocar para pasar a dólares' : 'En dólares, tocar para pasar a porcentaje'}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar({ descTipo: l.descTipo === 'pct' ? 'monto' : 'pct', descValor: '' }); }}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: `${PETROLEO}33`, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '900' }}>{l.descTipo === 'pct' ? '%' : '$'}</Text>
          </Pressable>
        </View>
        {errDesc ? <Linea color={MARCA.rojo} fuerte>{errDesc}</Linea> : null}
        {l.porAprobar ? <Linea color={MARCA.ambar} fuerte>{`−${formatMoney(conIva ? l.desc : l.desc / 1.13)} por aprobar`}</Linea> : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 2 }}>
          <Pressable onPress={onQuitar} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button">
            <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
          </Pressable>
          {l.faltaExistencia ? (
            <Pressable hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button"
              onPress={() => onPerdida({ producto: { product_id: l.product_id, nombre, motivo: motivoPerdida }, cantidad: l.faltan, clave: l.clave })}>
              <Text style={{ color: MARCA.ambar, fontSize: 15, fontWeight: '700' }}>Anotar venta perdida</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Vidrio>
  );
}
