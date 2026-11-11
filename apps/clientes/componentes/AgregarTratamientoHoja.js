// «Agregar un medicamento que tomo» (2026-10-29). La lista automática de Mis
// tratamientos sólo ve los crónicos que se compran con regularidad y alcanzan
// para tomarlos a diario; se quedan fuera quien lo toma día por medio y lo que
// no viene en tabletas (insulina, inhaladores, cremas). Acá el cliente los
// agrega él mismo.
//
// Sólo se ofrece lo que compró en el último año (`tratamiento_candidatos`): el
// aviso cuenta desde su última compra. Según el producto se pregunta una cosa
// (`pide`): cuántas toma al día, cuántos días le dura una compra, o nada
// (anticonceptivos y semanales: su ciclo es fijo).
//
// 2026-11-03: la dosis de ¼ en ¼ (¼ ½ 1 2 3 y un contador hasta 10,
// lib/dosis.js) y los días con «Otro» y contador; las píldoras bajan de
// renglón con letra grande en vez de cortarse.
//
// 2026-11-11 (usuario: «que me permita agregar cualquiera, no solo los que
// compré»): al escribir, además de lo comprado se busca en todo el catálogo
// (`tratamiento_buscar`, la regla única de búsqueda). Lo que nunca compró aquí
// se cuenta desde hoy y siempre pregunta cuántos días le dura.
//
// 2026-11-04: al agregar no se cierra de golpe — un último paso ofrece
// «Recordarme tomarlo» (lo siguiente que casi todos hacen). Al elegirlo, la
// hoja se cierra con el product_id y la pantalla abre la de tomas.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import Presionable from './Presionable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { Boton, RADIO, Seccion } from './ui';
import { Atajos, Caja, Contador } from './Pasos';
import { fecha, nombrePropio } from '../lib/formato';
import { useSesion } from '../lib/sesion';
import { DISPONIBLE as TOMAS } from '../lib/tomas';
import { useTema } from '../tema/tema';
import { CANTIDADES_RAPIDAS, CANTIDAD_MAX, CANTIDAD_MIN, CANTIDAD_PASO, cantidadDe, fraccionTexto } from '../lib/dosis';

// Lo que suele durar una compra (2026-11-04: atajos + contador, como en la
// hoja de tomas; antes cinco píldoras y un «Otro» que abría el contador).
const DIAS = [7, 15, 30, 45, 60, 90];
const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export default function AgregarTratamientoHoja({ alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [lista, setLista] = useState(null);
  const [busca, setBusca] = useState('');
  const [elegido, setElegido] = useState(null);
  const [dosis, setDosis] = useState(1);
  const [dias, setDias] = useState(30);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [agregado, setAgregado] = useState(false);
  const [catalogo, setCatalogo] = useState({ q: '', productos: [], cargando: false });
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';

  useEffect(() => {
    let vivo = true;
    pedir('tratamiento_candidatos').then((r) => { if (vivo) setLista(r?.ok ? r.productos : { error: r?.mensaje ?? 'Revisa tu conexión.' }); });
    return () => { vivo = false; };
  }, [pedir]);

  // El catálogo entero, con una pausa al escribir para no pedir por cada letra.
  useEffect(() => {
    const q = busca.trim();
    if (q.length < 2) { setCatalogo({ q: '', productos: [], cargando: false }); return undefined; }
    let vivo = true;
    setCatalogo((c) => ({ ...c, cargando: true }));
    const id = setTimeout(() => {
      pedir('tratamiento_buscar', { q }).then((r) => {
        if (vivo) setCatalogo({ q, productos: r?.ok && Array.isArray(r.productos) ? r.productos : [], cargando: false });
      });
    }, 350);
    return () => { vivo = false; clearTimeout(id); };
  }, [busca, pedir]);

  const visibles = useMemo(() => {
    if (!Array.isArray(lista)) return [];
    const q = sinTildes(busca.trim());
    return q ? lista.filter((p) => sinTildes(p.nombre).includes(q)) : lista;
  }, [lista, busca]);

  // Del catálogo, lo que no salió ya entre sus compras.
  const otros = useMemo(() => {
    const ya = new Set(visibles.map((p) => p.product_id));
    return catalogo.productos.filter((p) => !ya.has(p.product_id));
  }, [catalogo.productos, visibles]);

  const agregar = async () => {
    if (!elegido || guardando) return;
    setGuardando(true); setError(null);
    const r = await pedir('tratamiento_agregar', {
      product_id: elegido.product_id,
      dosis: elegido.pide === 'dosis' ? dosis : null,
      dias: elegido.pide === 'dias' ? dias : null,
    });
    setGuardando(false);
    if (!r?.ok) { setError(r?.mensaje ?? 'No se pudo agregar. Revisa tu conexión.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // En la web no hay avisos de toma: se cierra como antes.
    if (!TOMAS) { alCerrar(true); return; }
    setAgregado(true);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => alCerrar(agregado)}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 18 }}>
          {elegido && !agregado ? (
            <Presionable onPress={() => { setElegido(null); setError(null); }} hitSlop={12} accessibilityRole="button"
              style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: t.color.magentaTexto }}>Atrás</Text>
            </Presionable>
          ) : <View style={{ minWidth: 44 }} />}
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colorSistema.texto }}>Agregar medicamento</Text>
          <Presionable onPress={() => alCerrar(agregado)} hitSlop={12} accessibilityRole="button"
            style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 17, fontWeight: agregado ? '700' : '600', color: agregado ? t.color.magentaTexto : colorSistema.texto }}>{agregado ? 'Listo' : 'Cerrar'}</Text>
          </Presionable>
        </View>

        {agregado ? (
          <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 32, paddingBottom: ins.bottom + 24, gap: 14, alignItems: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: superficie }}>
              <Icono sf="checkmark.circle.fill" respaldo="✓" tam={40} color={t.color.verdeTexto} />
            </View>
            <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '800', textAlign: 'center', color: colorSistema.texto }}>Agregado a tus tratamientos</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, textAlign: 'center', color: colorSistema.texto2, maxWidth: 340 }}>
              Te avisaremos antes de que se te acabe {nombrePropio(elegido.nombre)}. ¿Quieres que también te recordemos cada toma?
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
              <View style={{ minHeight: 52, justifyContent: 'center' }}>
                <Boton alTocar={() => alCerrar(true, elegido.product_id)}>Recordarme tomarlo</Boton>
              </View>
              <View style={{ minHeight: 48, justifyContent: 'center' }}>
                <Boton tipo="secundario" alTocar={() => alCerrar(true)}>Ahora no</Boton>
              </View>
            </View>
          </ScrollView>
        ) : !elegido ? (
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: ins.bottom + 24, gap: 12 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
              Busca el medicamento que tomas, lo hayas comprado aquí o no. Te avisamos antes de que se te acabe.
            </Text>
            <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar medicamento" placeholderTextColor={colorSistema.texto3}
              autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Buscar medicamento"
              style={{ minHeight: 44, borderRadius: RADIO.medio, paddingHorizontal: 14, fontSize: 16, color: colorSistema.texto, backgroundColor: superficie }} />
            {lista == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
            {lista?.error ? <Text style={{ fontSize: 14, color: t.color.peligroTexto }}>{lista.error}</Text> : null}
            {Array.isArray(lista) && !visibles.length && !otros.length && !catalogo.cargando ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto3, marginTop: 12, textAlign: 'center' }}>
                {busca.trim().length >= 2 ? 'No encontramos ese medicamento.' : 'Escribe el nombre del medicamento para buscarlo.'}
              </Text>
            ) : null}
            {visibles.length && otros.length ? <Seccion>De tus compras</Seccion> : null}
            {visibles.length ? (
              <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, overflow: 'hidden' }}>
                {visibles.map((p, i) => (
                  <Presionable key={p.product_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setElegido(p); }}
                    accessibilityRole="button" accessibilityLabel={nombrePropio(p.nombre)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10,
                      borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador ?? 'rgba(128,128,128,0.25)',
                      backgroundColor: pressed ? (t.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') : 'transparent' })}>
                    <Icono sf="pills.fill" respaldo="💊" tam={16} color={t.color.magentaTexto} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto }}>{nombrePropio(p.nombre)}</Text>
                      <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Última compra {fecha(p.ultima)}</Text>
                    </View>
                    <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} />
                  </Presionable>
                ))}
              </View>
            ) : null}
            {otros.length ? (
              <>
                <Seccion>{visibles.length ? 'Otros medicamentos' : 'Medicamentos'}</Seccion>
                <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, overflow: 'hidden' }}>
                  {otros.map((p, i) => <FilaProducto key={p.product_id} p={p} primera={!i} alElegir={setElegido} />)}
                </View>
              </>
            ) : null}
            {catalogo.cargando ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: ins.bottom + 24, gap: 16 }}>
            <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, padding: 16, gap: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{nombrePropio(elegido.nombre)}</Text>
              <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>{elegido.ultima ? `Última compra ${fecha(elegido.ultima)}` : 'Empezamos a contar desde hoy'}</Text>
            </View>
            {elegido.pide === 'dosis' ? (
              <>
                <Seccion>¿Cuánto tomas al día, en total?</Seccion>
                <Caja superficie={superficie}>
                  <Contador valor={dosis} texto={cantidadDe(dosis, elegido.nombre)} detalle="al día" min={CANTIDAD_MIN} max={CANTIDAD_MAX} paso={CANTIDAD_PASO}
                    etiquetaMenos="Un cuarto menos" etiquetaMas="Un cuarto más" alCambiar={setDosis} />
                  <Atajos opciones={CANTIDADES_RAPIDAS.map((v) => ({ v, texto: fraccionTexto(v), etiqueta: `${cantidadDe(v, elegido.nombre)} al día` }))}
                    valor={dosis} alElegir={setDosis} />
                </Caja>
                <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
                  Sumando todas las tomas del día. Si lo tomas día por medio, elige la mitad de lo que tomas ese día.
                </Text>
              </>
            ) : elegido.pide === 'dias' ? (
              <>
                <Seccion>{elegido.ultima ? '¿Cuántos días te dura una compra?' : '¿Para cuántos días te alcanza lo que tienes?'}</Seccion>
                <Caja superficie={superficie}>
                  <Contador valor={dias} texto={`${dias} ${dias === 1 ? 'día' : 'días'}`} min={1} max={365} salto={7}
                    etiquetaMenos="Un día menos" etiquetaMas="Un día más" alCambiar={setDias} />
                  <Atajos opciones={DIAS.map((d) => ({ v: d, texto: String(d), etiqueta: `${d} días` }))} valor={dias} alElegir={setDias} />
                </Caja>
                <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
                  {elegido.ultima ? 'De este producto no podemos saber cuánto dura: dinos más o menos cada cuánto se te acaba.' : 'Contamos desde hoy y te avisamos unos días antes de que se acabe.'}
                </Text>
              </>
            ) : (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
                Este medicamento tiene un ciclo fijo: te avisamos cuando se acabe lo que compraste.
              </Text>
            )}
            {error ? <Text style={{ fontSize: 14, color: t.color.peligroTexto }}>{error}</Text> : null}
            <View style={{ minHeight: 52, justifyContent: 'center', marginTop: 8 }}>
              {guardando ? <ActivityIndicator /> : <Boton alTocar={agregar}>Agregar a mis tratamientos</Boton>}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// Una fila de la lista del catálogo: lo mismo que las de sus compras, sin la
// fecha que no tiene.
function FilaProducto({ p, primera, alElegir }) {
  const t = useTema();
  return (
    <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); alElegir(p); }}
      accessibilityRole="button" accessibilityLabel={nombrePropio(p.nombre)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10,
        borderTopWidth: primera ? 0 : 0.5, borderTopColor: colorSistema.separador ?? 'rgba(128,128,128,0.25)',
        backgroundColor: pressed ? (t.oscuro ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') : 'transparent' })}>
      <Icono sf="pills.fill" respaldo="💊" tam={16} color={t.color.magentaTexto} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto }}>{nombrePropio(p.nombre)}</Text>
        {p.ultima ? <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Última compra {fecha(p.ultima)}</Text> : null}
      </View>
      <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} />
    </Presionable>
  );
}
