// Piezas de «Cargar compra» en la app: las comparten la lista
// (`app/cargar-compra.js`), la compra armada (`app/propuesta-compra/[id].js`) y
// sus pestañas. Las reglas son del núcleo (`@nucleo/utils/cargaDeCompra`,
// `@nucleo/data/cargarCompra`); acá sólo hay cómo se ven en el teléfono.
import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { venceNormal } from '@nucleo/utils/cobroDeAplicacion';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cambiarPausaDeCompras } from '@nucleo/data/cargarCompra';
import { Presionable as Pressable } from '../Tocable';
import ConAurora from '../ConAurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import HojaDeEleccion from '../HojaDeEleccion';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';

export const plural = (n, uno, muchos) => `${n} ${Number(n) === 1 ? uno : muchos}`;
export const fmtFecha = (iso) => fechaNumerica(iso, { anio: 'corto', vacio: '—' });

// Lo que pasó con el documento en Bodega (el `ESTADO_CARGA` del portal).
export const ESTADO_CARGA = {
  pendiente: ['Pendiente', 'gris'],
  enviando: ['Mandándose…', 'azul'],
  verificada: ['Cargada en Bodega', 'verde'],
  sin_verificar: ['Por confirmar', 'ambar'],
  fallida: ['No entró', 'rojo'],
};
/** El color de un tono, leído al pintar (en Android sigue al sistema). */
export const colorDe = (tono) => (tono === 'verde' ? MARCA.verde : tono === 'ambar' ? MARCA.ambar : tono === 'rojo' ? MARCA.rojo
  : tono === 'azul' ? MARCA.azulClaro : colorSistema.texto2);
export const estadoDeCarga = (fila) => ESTADO_CARGA[fila?.estado] ?? ESTADO_CARGA.pendiente;

/** Un enlace de acción dentro de una tarjeta (blanco de dedo de 44). */
export function Accion({ texto, color, onPress, ocupado, deshabilitado }) {
  const apagado = ocupado || deshabilitado;
  return (
    <Pressable disabled={apagado} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: apagado ? 0.4 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: color ?? MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{ocupado ? 'Un momento…' : texto}</Text>
    </Pressable>
  );
}

/** Una cifra de resumen arriba de una lista. */
export function Cuenta({ rotulo, valor, sub, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Vidrio radio={20}>
        <View style={{ padding: 12, gap: 2 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{rotulo}</Text>
          <Text style={{ color: color ?? colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{valor ?? '—'}</Text>
          {sub ? <Text style={{ color: colorSistema.texto2, fontSize: 11 }} numberOfLines={1}>{sub}</Text> : null}
        </View>
      </Vidrio>
    </View>
  );
}

/** Un rótulo chico sobre un campo. */
export function Rotulo({ children }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{children}</Text>;
}

/** Botón con forma de campo que abre una lista para elegir. */
export function CampoDeEleccion({ texto, vacio, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colorSistema.acentoTinte,
        opacity: deshabilitado ? 0.4 : pressed ? 0.7 : 1 })}>
      <Text style={{ color: texto ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }} numberOfLines={1}>{texto || vacio}</Text>
    </Pressable>
  );
}

const MAXIMO = 200;
/**
 * Elegir UNA opción de una lista larga (proveedor, laboratorio, categoría):
 * en iPhone la hoja con buscador, en Android la de Material.
 * `opciones`: `[{ id, label, detalle? }]`.
 */
export function ElegirDeLista({ visible, titulo, opciones, valor, onElegir, onCerrar }) {
  const [texto, setTexto] = useState('');
  const filas = useMemo(() => (texto.trim() ? opciones.filter((o) => tokenMatch(texto, o.label, o.detalle || '')) : opciones), [texto, opciones]);
  if (!visible) return null;
  const cerrar = () => { setTexto(''); onCerrar(); };
  const elegir = (id) => { onElegir(id); setTexto(''); onCerrar(); };
  if (Platform.OS === 'android') return <HojaDeEleccion titulo={titulo} valor={valor} opciones={opciones} maximo={MAXIMO} onElegir={onElegir} onCerrar={cerrar} />;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={cerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo={titulo} onCerrar={cerrar} />
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Buscar" autoCorrect={false} autoFocus clearButtonMode="while-editing" />
        </View>
        <FlatList data={filas.slice(0, MAXIMO)} keyExtractor={(o) => String(o.id)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
          ListEmptyComponent={<Text style={{ color: colorSistema.texto2, fontSize: 15, marginTop: 12 }}>Nada coincide con la búsqueda.</Text>}
          ListFooterComponent={filas.length > MAXIMO ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginTop: 12 }}>{`Hay ${filas.length - MAXIMO} más: escribe para encontrarlas.`}</Text> : null}
          renderItem={({ item: o, index }) => (
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); elegir(String(o.id)); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingVertical: 8,
                borderTopWidth: index ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{o.label}</Text>
                {o.detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{o.detalle}</Text> : null}
              </View>
              {String(valor) === String(o.id) ? <Text style={{ color: MARCA.azulClaro, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
            </Pressable>
          )} />
      </ConAurora>
    </Modal>
  );
}

/** El vencimiento como se lee en la caja (MM/AAAA), guardado como AAAA-MM. */
const aPantalla = (v) => (/^\d{4}-\d{2}$/.test(String(v)) ? `${String(v).slice(5, 7)}/${String(v).slice(0, 4)}` : String(v ?? ''));
export function CampoVence({ valor, onCambiar, editable = true }) {
  const [texto, setTexto] = useState(() => aPantalla(valor));
  const [antes, setAntes] = useState(valor);
  if (valor !== antes) { setAntes(valor); if (venceNormal(texto) !== valor) setTexto(aPantalla(valor)); }
  return (
    <Campo multiline={false} editable={editable} value={texto} placeholder="MM/AAAA" keyboardType="numbers-and-punctuation" maxLength={7}
      onChangeText={(t) => {
        const limpio = String(t).replace(/[^\d/]/g, '').slice(0, 7);
        setTexto(limpio);
        const v = venceNormal(limpio);
        onCambiar(/^\d{4}-\d{2}$/.test(v) ? v : limpio);
      }} />
  );
}

/* ── La pausa de escrituras (el `PausaDeEscrituras` del portal) ─────────────
 * Pausado, el servidor rechaza toda escritura al sistema; la app además no
 * ofrece esos botones. Quién puede cambiarla lo decide la base (`puede_cambiar`). */
export function PausaDeCompras({ estado, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [guardando, setG] = useState(false);
  if (!estado) return null;
  const pausada = !!estado.pausada;
  if (!pausada && !estado.puede_cambiar) return null;
  const cambiar = async () => {
    setG(true); trabajando(pausada ? 'Reanudando…' : 'Pausando…');
    const { estado: e, error } = await cambiarPausaDeCompras(!pausada, pausada ? null : motivo.trim());
    setG(false);
    if (error) { fallo('No se pudo cambiar', error); return; }
    listo(pausada ? 'Compras reanudadas' : 'Compras en pausa');
    setAbierto(false); setMotivo('');
    onCambio?.(e);
  };
  return (
    <View style={{ marginHorizontal: 16, gap: 6 }}>
      {pausada ? (
        <Vidrio radio={20}>
          <View style={{ padding: 14, gap: 6 }}>
            <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '800' }}>{`Cargar compra está en pausa${estado.motivo ? `: ${estado.motivo}` : ''}.`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {['No se registran compras, productos nuevos ni traslados a sucursales.',
                estado.por_nombre ? `Lo pausó ${shortEmployeeName(estado.por_nombre)}` : null,
                estado.desde ? `el ${fechaNumerica(estado.desde.slice(0, 10))}.` : null].filter(Boolean).join(' ')}
            </Text>
            {estado.puede_cambiar ? <Accion texto="Reanudar" onPress={() => setAbierto(true)} /> : null}
          </View>
        </Vidrio>
      ) : (
        <View style={{ alignItems: 'flex-end' }}><Accion texto="Pausar compras" color={colorSistema.texto2} onPress={() => setAbierto(true)} /></View>
      )}
      {abierto ? (
        <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={() => !guardando && setAbierto(false)}>
          <ConAurora>
            <EncabezadoDeHoja titulo={pausada ? 'Reanudar compras' : 'Pausar compras'} onCerrar={() => !guardando && setAbierto(false)} ocupado={guardando} />
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
                {pausada ? <Aviso texto="Se vuelven a registrar compras." /> : (
                  <>
                    <Aviso texto="En pausa no se registran compras, productos nuevos, traslados a sucursales ni salidas de erróneos. Puedes seguir revisando." />
                    <Seccion titulo="Motivo">
                      <Campo value={motivo} onChangeText={setMotivo} placeholder="Ej.: revisando una carga con diferencias" />
                    </Seccion>
                  </>
                )}
                <BotonGrande texto={guardando ? 'Un momento…' : pausada ? 'Reanudar' : 'Pausar'} color={pausada ? MARCA.azul : MARCA.rojo}
                  deshabilitado={guardando || (!pausada && !motivo.trim())} onPress={cambiar} />
              </ScrollView>
            </KeyboardAvoidingView>
          </ConAurora>
        </Modal>
      ) : null}
    </View>
  );
}

/* ── Lo que la compra armada le cuenta a la lista al cerrarse ────────────────
 * La lista ofrece «Deshacer» después de sacar una factura (como el portal):
 * la compra armada deja acá qué se sacó y la lista lo toma al volver. */
let sacada = null;
export const avisarSacada = (x) => { sacada = x; };
export const tomarSacada = () => { const x = sacada; sacada = null; return x; };
