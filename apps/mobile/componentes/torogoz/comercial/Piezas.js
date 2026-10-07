// Las piezas de las pantallas comerciales de Torogoz (clientes, catálogo,
// compras, proveedores, solicitudes, empresa): el color de la marca, la
// empresa que factura, el interruptor con su explicación, la hoja para elegir
// de una lista LARGA (las 774 actividades de Hacienda, el catálogo entero) y
// la dirección con los códigos de Hacienda en cascada.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fetchEmisor } from '@nucleo/data/distribucion';
import { departamentosMH, municipiosMH, distritosMH } from '@nucleo/data/geoCodigosMH';
import { cargarActividades } from '@nucleo/utils/distribucionComun';
import ConAurora from '../../ConAurora';
import Vidrio from '../../Vidrio';
import { colorSistema } from '../../Formulario';
import { Campo } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { Rotulo } from '../../personas/Formulario';

/** El color de la distribuidora (COLORES_DISTRIBUIDORA.petroleo). */
export const PETROLEO = '#0f6e7d';

/** La empresa que factura (una sola fila). Se relee al volver a la pantalla. */
export function useEmisor() {
  const [emisor, setEmisor] = useState(undefined);   // undefined = cargando; null = no hay
  const cargar = useCallback(() => fetchEmisor().then(setEmisor).catch(() => setEmisor(null)), []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  return { emisor, recargar: cargar };
}

/** Las filas que se tocaron en una lista viajan acá a su pantalla (la dirección sólo lleva el id). */
const elegidas = new Map();
export const guardarElegida = (tipo, fila) => elegidas.set(`${tipo}:${fila?.id ?? fila?.product_id}`, fila);
export const elegida = (tipo, id) => elegidas.get(`${tipo}:${id}`) ?? null;

/** Un interruptor con su rótulo y, si hace falta, la explicación debajo. */
export function Interruptor({ rotulo, ayuda, valor, onCambiar, deshabilitado }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, opacity: deshabilitado ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
        {ayuda ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{ayuda}</Text> : null}
      </View>
      <Switch value={!!valor} disabled={deshabilitado} trackColor={{ true: PETROLEO }}
        onValueChange={(v) => { Haptics.selectionAsync().catch(() => {}); onCambiar(v); }} />
    </View>
  );
}

/** Un aviso con color (rojo, ámbar, azul) dentro de una tarjeta de vidrio. */
export function Nota({ texto, tono = 'info', titulo }) {
  const color = tono === 'danger' ? MARCA.rojo : tono === 'warning' ? MARCA.ambar : tono === 'success' ? MARCA.verde : MARCA.azulClaro;
  return (
    <Vidrio radio={18} tinte={`${color}26`}>
      <View style={{ padding: 12, gap: 4 }}>
        {titulo ? <Text style={{ color, fontSize: 15, fontWeight: '700' }}>{titulo}</Text> : null}
        <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{texto}</Text>
      </View>
    </Vidrio>
  );
}

const MAX_VISIBLES = 80;

/**
 * Elegir UNA opción de una lista larga: el renglón muestra lo elegido y abre
 * una hoja con buscador. Sin texto se muestran las primeras 80 y un aviso de
 * que hay más — 774 renglones de una vez traban la hoja.
 * `opciones` = [{ id, label, detalle? }].
 */
export function ElegirLargo({ rotulo, requerido, valor, opciones, onCambiar, vacio = null, error, deshabilitado, cargando, textoBoton }) {
  const [abierta, setAbierta] = useState(false);
  const [texto, setTexto] = useState('');
  const actual = opciones.find((o) => String(o.id) === String(valor ?? ''));
  const coinciden = useMemo(() => opciones.filter((o) => !texto.trim() || tokenMatch(texto, o.label, o.detalle || '')), [opciones, texto]);
  const filas = [...(vacio != null && !texto.trim() ? [{ id: '', label: vacio }] : []), ...coinciden.slice(0, MAX_VISIBLES)];
  return (
    <View style={{ gap: 8 }}>
      {rotulo ? <Rotulo texto={rotulo} requerido={requerido} /> : null}
      <Pressable disabled={deshabilitado || cargando} accessibilityRole="button" accessibilityLabel={rotulo}
        onPress={() => { Haptics.selectionAsync().catch(() => {}); setTexto(''); setAbierta(true); }}
        style={({ pressed }) => ({ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: 'rgba(127,127,127,0.16)', borderWidth: error ? 1 : 0, borderColor: MARCA.rojo, opacity: deshabilitado ? 0.5 : pressed ? 0.7 : 1 })}>
        <Text style={{ flex: 1, color: actual ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>
          {cargando ? 'Cargando…' : actual?.label ?? textoBoton ?? vacio ?? 'Elegir…'}
        </Text>
        {deshabilitado ? null : <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>›</Text>}
      </Pressable>
      {error ? <Text style={{ color: MARCA.rojo, fontSize: 12, marginLeft: 2 }}>{error}</Text> : null}
      {abierta ? (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAbierta(false)}>
          <ConAurora>
            <View style={{ padding: 20, paddingBottom: 8, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{rotulo ?? 'Elegir'}</Text>
                <Pressable onPress={() => setAbierta(false)} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
                </Pressable>
              </View>
              {opciones.length > 8 ? <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Buscar" autoCorrect={false} autoFocus /> : null}
            </View>
            <FlatList data={filas} keyExtractor={(o) => String(o.id)} keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
              ListFooterComponent={coinciden.length > MAX_VISIBLES
                ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginTop: 10 }}>{`Hay ${coinciden.length - MAX_VISIBLES} más: escribe para encontrarla.`}</Text>
                : !coinciden.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginTop: 10 }}>Nada con ese texto.</Text> : null}
              renderItem={({ item: o, index }) => (
                <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(String(o.id), o); setAbierta(false); }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 8,
                    borderTopWidth: index ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{o.label}</Text>
                    {o.detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{o.detalle}</Text> : null}
                  </View>
                  {String(valor ?? '') === String(o.id) ? <Text style={{ color: PETROLEO, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
                </Pressable>
              )} />
          </ConAurora>
        </Modal>
      ) : null}
    </View>
  );
}

/** La actividad económica: el catálogo de Hacienda, cargado al abrir el formulario. */
export function ElegirActividad({ valor, onCambiar, error, deshabilitado, requerido }) {
  const [actividades, setActividades] = useState(null);
  useEffect(() => {
    let vivo = true;
    cargarActividades().then((a) => { if (vivo) setActividades(a.map((x) => ({ id: x.value, label: x.label, desc: x.desc }))); })
      .catch(() => { if (vivo) setActividades([]); });
    return () => { vivo = false; };
  }, []);
  return (
    <ElegirLargo rotulo="Actividad económica" requerido={requerido} valor={valor} opciones={actividades ?? []} cargando={!actividades}
      deshabilitado={deshabilitado} error={error} textoBoton="Buscar actividad…"
      onCambiar={(id, o) => onCambiar(id, o?.desc ?? '')} />
  );
}

/**
 * La dirección con los CÓDIGOS de Hacienda (es lo que viaja en el documento).
 * Cambiar el departamento borra municipio y distrito; cambiar el municipio, el
 * distrito — igual que el portal.
 */
export function ElegirUbicacion({ f, setF, deshabilitado }) {
  const deps = useMemo(() => departamentosMH().map((o) => ({ id: o.value, label: o.label })), []);
  const muns = useMemo(() => municipiosMH(f.departamento).map((o) => ({ id: o.value, label: o.label })), [f.departamento]);
  const diss = useMemo(() => distritosMH(f.departamento, f.municipio).map((o) => ({ id: o.value, label: o.label })), [f.departamento, f.municipio]);
  return (
    <>
      <ElegirLargo rotulo="Departamento" valor={f.departamento} opciones={deps} deshabilitado={deshabilitado}
        onCambiar={(v) => setF((p) => ({ ...p, departamento: v, municipio: '', distrito: '' }))} />
      <ElegirLargo rotulo="Municipio" valor={f.municipio} opciones={muns} deshabilitado={deshabilitado || !f.departamento}
        onCambiar={(v) => setF((p) => ({ ...p, municipio: v, distrito: '' }))} />
      <ElegirLargo rotulo="Distrito" valor={f.distrito} opciones={diss} deshabilitado={deshabilitado || !f.municipio}
        onCambiar={(v) => setF((p) => ({ ...p, distrito: v }))} />
    </>
  );
}

/** El gris de lo neutro, en hexadecimal: la píldora le pega transparencia y a un color del sistema no se le puede. */
export const GRIS = '#8E8E93';

/** Una píldora de estado: el color de la variante del portal. */
export const colorDe = (variant) => ({ success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, info: MARCA.azulClaro }[variant] ?? GRIS);
