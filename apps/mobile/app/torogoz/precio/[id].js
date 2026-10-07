// Torogoz · el precio de un producto del catálogo, NATIVO — el `PrecioModal`
// del portal: precio con IVA, venta libre, si se ofrece en los pedidos y el
// descuento del catálogo (%, vigencia y el tope para dar más). `id = nuevo`
// agrega un producto: se busca por nombre, principio activo o código.
//
// Las cuentas —centavos exactos, % entre 0 y 100, «desde» antes de «hasta»,
// si con el descuento queda bajo el costo— son las del núcleo
// (`leerFormularioDePrecio`), las mismas del portal. Bajo el costo AVISA y no
// bloquea: una liquidación de vencimiento puede ser justo lo que se quiere.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { agregarAlCatalogo, fetchCatalogo, guardarPrecio, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { buscarProductos } from '@nucleo/data/busquedaProductos';
import { anotar } from '@nucleo/data/audit';
import { leerFormularioDePrecio } from '@nucleo/utils/distribucionComercial';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema, Formulario } from '../../../componentes/Formulario';
import { BotonGrande, Campo, Seccion } from '../../../componentes/formulario/Piezas';
import { CampoConRotulo } from '../../../componentes/personas/Formulario';
import Fecha from '../../../componentes/formulario/Fecha';
import { fallo, listo, trabajando } from '../../../componentes/Progreso';
import { volver } from '../../../componentes/volver';
import { Interruptor, Nota, PETROLEO, elegida, useEmisor } from '../../../componentes/torogoz/comercial/Piezas';

/** Una fecha opcional: el selector, o «Poner fecha» si no hay. */
function FechaOpcional({ rotulo, valor, onCambiar }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 10 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      {valor ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Fecha valor={valor} onCambiar={onCambiar} />
          <Text onPress={() => onCambiar('')} style={{ color: PETROLEO, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
        </View>
      ) : <Text onPress={() => onCambiar(hoySV())} style={{ color: PETROLEO, fontSize: 15, fontWeight: '600' }}>Poner fecha</Text>}
    </View>
  );
}

export default function PrecioTorogoz() {
  const { id } = useLocalSearchParams();
  const nuevo = id === 'nuevo';
  const { hasPermission } = useAuth();
  const puede = !!hasPermission?.('distribucion_config', 'can_edit');
  const { emisor } = useEmisor();
  const [item, setItem] = useState(() => (nuevo ? {} : elegida('precio', id)));
  const [producto, setProducto] = useState(null);
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [precio, setPrecio] = useState(() => (!nuevo && item ? String(item.precio_con_iva) : ''));
  const [libre, setLibre] = useState(() => (!nuevo && item ? item.venta_libre : false));
  const [activo, setActivo] = useState(() => (!nuevo && item ? item.activo : true));
  const [descPct, setDescPct] = useState(() => (!nuevo && item && Number(item.descuento_pct) ? String(Number(item.descuento_pct)) : ''));
  const [descDesde, setDescDesde] = useState(() => (!nuevo && item ? item.descuento_desde ?? '' : ''));
  const [descHasta, setDescHasta] = useState(() => (!nuevo && item ? item.descuento_hasta ?? '' : ''));
  const [tope, setTope] = useState(() => (!nuevo && item && item.descuento_max_pct != null ? String(Number(item.descuento_max_pct)) : ''));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const buscado = useTextoRebotado(texto);

  // Abierto desde un enlace: el renglón se busca en el catálogo.
  useEffect(() => {
    if (nuevo || item) return undefined;
    let vivo = true;
    fetchCatalogo().then((r) => {
      if (!vivo) return;
      const p = r.find((x) => String(x.product_id) === String(id));
      if (!p) { setError('Ese producto no está en el catálogo.'); return; }
      setItem(p); setPrecio(String(p.precio_con_iva)); setLibre(p.venta_libre); setActivo(p.activo);
      setDescPct(Number(p.descuento_pct) ? String(Number(p.descuento_pct)) : '');
      setDescDesde(p.descuento_desde ?? ''); setDescHasta(p.descuento_hasta ?? '');
      setTope(p.descuento_max_pct != null ? String(Number(p.descuento_max_pct)) : '');
    }).catch((e) => { if (vivo) setError(mensajeDeDistribucion(e)); });
    return () => { vivo = false; };
  }, [id, nuevo, item]);

  useEffect(() => {
    if (!nuevo || buscado.trim().length < 2) { setOpciones([]); return undefined; }
    let vivo = true;
    setBuscando(true);
    buscarProductos(buscado, { select: 'id, nombre, es_antibiotico, requiere_receta, regulado', limite: 30 })
      .then(({ data, error: e }) => {
        if (!vivo) return;
        if (e) { setError('No se pudo buscar el producto.'); return; }
        setOpciones(data ?? []);
      })
      .catch(() => { if (vivo) setError('No se pudo buscar el producto.'); })
      .finally(() => { if (vivo) setBuscando(false); });
    return () => { vivo = false; };
  }, [buscado, nuevo]);

  // Lo escrito sobrevive a que la sesión se cierre sola (gate:borradores).
  const { recuperado, descartar } = useBorrador(!nuevo && emisor?.id && item ? `distribucion-precio-${emisor.id}-${item.product_id}` : null,
    { precio, libre, activo, descPct, descDesde, descHasta, tope });
  const repuesto = useRef(false);
  useEffect(() => {
    if (repuesto.current || !recuperado) return;
    repuesto.current = true;
    if (recuperado.precio != null) setPrecio(recuperado.precio);
    if (recuperado.libre != null) setLibre(recuperado.libre);
    if (recuperado.activo != null) setActivo(recuperado.activo);
    setDescPct(recuperado.descPct ?? ''); setDescDesde(recuperado.descDesde ?? '');
    setDescHasta(recuperado.descHasta ?? ''); setTope(recuperado.tope ?? '');
  }, [recuperado]);

  if (!nuevo && !item) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Precio' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {error ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>{error}</Text> : <ActivityIndicator />}
        </View>
      </>
    );
  }

  const controlado = nuevo
    ? !!(producto && (producto.es_antibiotico || producto.requiere_receta || producto.regulado))
    : item.controlado;
  const costo = nuevo ? null : Number(item.costo_promedio ?? 0) || null;
  const l = leerFormularioDePrecio({ precio, descPct, tope, descDesde, descHasta, costo });
  const listoParaGuardar = puede && (nuevo ? !!producto : true) && l.valido && !guardando && !!emisor?.id;

  const guardar = () => {
    const nombre = nuevo ? producto.nombre : item.nombre;
    Alert.alert(nuevo ? 'Agregar al catálogo' : 'Guardar precio', `${nombre}\n${formatMoney(l.precioNum)} con IVA${l.pctNum ? ` · ${l.pctNum} % de descuento` : ''}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true); setError('');
        trabajando('Guardando el precio…');
        try {
          const libreFinal = libre && !controlado;
          if (nuevo) {
            await agregarAlCatalogo(emisor.id, producto.id, l.precioNum, libreFinal);
            if (l.descuento.descuento_pct || l.descuento.descuento_max_pct != null) await guardarPrecio(emisor.id, producto.id, l.descuento);
          } else {
            await guardarPrecio(emisor.id, item.product_id, { precio_con_iva: l.precioNum, venta_libre: libreFinal, activo, ...l.descuento });
          }
          anotar('DISTRIBUCION_PRECIO', String(nuevo ? producto.id : item.product_id),
            { precio_con_iva: l.precioNum, venta_libre: libreFinal, ...l.descuento,
              antes: nuevo ? null : { precio_con_iva: item.precio_con_iva, descuento_pct: item.descuento_pct, descuento_max_pct: item.descuento_max_pct } });
          descartar();
          listo(nuevo ? 'Producto agregado' : 'Precio guardado', nombre);
          volver('/torogoz/catalogo');
        } catch (e) {
          const m = mensajeDeDistribucion(e);
          setError(m); fallo('No se pudo guardar', m);
        } finally { setGuardando(false); }
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nuevo ? 'Agregar producto' : item.nombre }} />
      <Formulario contentContainerStyle={{ paddingHorizontal: 16, gap: 18, paddingBottom: 60 }}>
        {error ? <Nota tono="danger" texto={error} /> : null}
        {nuevo ? (
          <Seccion titulo="Producto">
            {producto ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto.nombre}</Text>
                <Text onPress={() => setProducto(null)} style={{ color: PETROLEO, fontSize: 15, fontWeight: '600' }}>Cambiar</Text>
              </View>
            ) : (
              <>
                <Campo multiline={false} value={texto} onChangeText={setTexto} autoCorrect={false} autoFocus
                  placeholder="Nombre, principio activo o código de barras" />
                {buscando ? <ActivityIndicator /> : null}
                {!buscando && buscado.trim().length >= 2 && !opciones.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nada con ese texto.</Text> : null}
                {buscado.trim().length < 2 ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Escribe al menos dos letras.</Text> : null}
                {opciones.map((p, i) => (
                  <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setProducto(p); }}
                    style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{p.nombre}</Text>
                  </Pressable>
                ))}
              </>
            )}
          </Seccion>
        ) : null}

        <Seccion titulo="Precio">
          <CampoConRotulo rotulo="Precio con IVA ($)" value={precio} editable={puede} keyboardType="decimal-pad" onChangeText={setPrecio}
            error={precio !== '' && l.precioNum === null ? 'Escribe un monto, por ejemplo 1.95' : undefined} />
          {l.precioNum !== null ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {`Lo que paga el cliente con Factura. En Crédito Fiscal: ${formatMoney(l.precioNum / 1.13)} + IVA.`}
            </Text>
          ) : null}
          <Interruptor rotulo="Venta libre" ayuda="Se puede vender a tiendas y supermercados." valor={libre && !controlado}
            deshabilitado={!puede || controlado} onCambiar={setLibre} />
          {controlado ? <Nota texto="Es antibiótico, con receta o regulado: sólo se le vende a farmacias." /> : null}
          {!nuevo ? <Interruptor rotulo="Se ofrece en los pedidos" valor={activo} deshabilitado={!puede} onCambiar={setActivo} /> : null}
        </Seccion>

        <Seccion titulo="Descuento">
          <CampoConRotulo rotulo="Descuento del catálogo (%)" value={descPct} placeholder="0" editable={puede} keyboardType="decimal-pad"
            onChangeText={setDescPct} error={l.pctMalo ? 'Entre 0 y 100' : undefined} />
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Entra solo al vender y no pide aprobación.</Text>
          <CampoConRotulo rotulo="Tope para dar más (%)" value={tope} placeholder={`Empresa: ${Number(emisor?.descuento_max_pct ?? 0)}`} editable={puede}
            keyboardType="decimal-pad" onChangeText={setTope} error={l.topeMalo ? 'Entre 0 y 100' : undefined} />
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Hasta ahí lo da quien tiene permiso; más, pide aprobación.</Text>
          {l.pctNum > 0 && puede ? (
            <>
              <FechaOpcional rotulo="Desde (opcional)" valor={descDesde} onCambiar={setDescDesde} />
              <FechaOpcional rotulo="Hasta (opcional)" valor={descHasta} onCambiar={setDescHasta} />
            </>
          ) : null}
          {l.fechasMal ? <Nota tono="danger" texto="«Desde» va antes de «Hasta»." /> : null}
          {l.pctNum > 0 && l.finalSinIva !== null ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {`Con el descuento: ${formatMoney(l.precioNum * (1 - l.pctNum / 100))} con IVA${costo !== null ? ` · costo ${formatMoney(costo * 1.13)} con IVA` : ''}.`}
            </Text>
          ) : null}
          {l.bajoCosto ? <Nota tono="warning" texto="Con este descuento se vende bajo el costo. Se puede guardar igual (por ejemplo, para sacar un vencimiento)." /> : null}
        </Seccion>

        {puede ? <BotonGrande texto="Guardar" color={PETROLEO} deshabilitado={!listoParaGuardar} onPress={guardar} /> : null}
      </Formulario>
    </>
  );
}
