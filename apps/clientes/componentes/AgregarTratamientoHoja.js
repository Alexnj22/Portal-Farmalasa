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
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import Presionable from './Presionable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { Boton, RADIO, Seccion } from './ui';
import { fecha, nombrePropio } from '../lib/formato';
import { useSesion } from '../lib/sesion';
import { useTema } from '../tema/tema';
import { CANTIDADES_RAPIDAS, CANTIDAD_MAX, CANTIDAD_MIN, cantidadTexto, fraccionTexto, moverCantidad } from '../lib/dosis';

const DOSIS = CANTIDADES_RAPIDAS.map((v) => ({ v, texto: fraccionTexto(v) }));
const DIAS = [7, 15, 30, 60, 90];
const OTRO = 'otro';
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
  const [otrosDias, setOtrosDias] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';

  useEffect(() => {
    let vivo = true;
    pedir('tratamiento_candidatos').then((r) => { if (vivo) setLista(r?.ok ? r.productos : { error: r?.mensaje ?? 'Revisa tu conexión.' }); });
    return () => { vivo = false; };
  }, [pedir]);

  const visibles = useMemo(() => {
    if (!Array.isArray(lista)) return [];
    const q = sinTildes(busca.trim());
    return q ? lista.filter((p) => sinTildes(p.nombre).includes(q)) : lista;
  }, [lista, busca]);

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
    alCerrar(true);
  };

  const pildoras = (opciones, valor, poner, etiqueta) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
      {opciones.map((o) => {
        const elegida = o.v === valor;
        return (
          <Presionable key={o.v} onPress={() => { Haptics.selectionAsync().catch(() => {}); poner(o.v); }}
            accessibilityRole="radio" accessibilityState={{ selected: elegida }} accessibilityLabel={etiqueta(o)}
            style={({ pressed }) => ({ flexGrow: 1, minWidth: 56, minHeight: 48, paddingVertical: 6, borderRadius: RADIO.medio, alignItems: 'center', justifyContent: 'center',
              backgroundColor: elegida ? t.color.magenta : superficie, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: elegida ? '#FFFFFF' : colorSistema.texto, textAlign: 'center', paddingHorizontal: 4 }}>{o.texto}</Text>
          </Presionable>
        );
      })}
    </View>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => alCerrar(false)}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 18 }}>
          {elegido ? (
            <Presionable onPress={() => { setElegido(null); setError(null); }} hitSlop={12} accessibilityRole="button"
              style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: t.color.magentaTexto }}>Atrás</Text>
            </Presionable>
          ) : <View style={{ minWidth: 44 }} />}
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colorSistema.texto }}>Agregar medicamento</Text>
          <Presionable onPress={() => alCerrar(false)} hitSlop={12} accessibilityRole="button"
            style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Cerrar</Text>
          </Presionable>
        </View>

        {!elegido ? (
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: ins.bottom + 24, gap: 12 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
              Elige un medicamento que tomas y no aparece en tu lista. Te avisamos antes de que se te acabe, contando desde tu última compra.
            </Text>
            <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar en lo que has comprado" placeholderTextColor={colorSistema.texto3}
              autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Buscar medicamento"
              style={{ minHeight: 44, borderRadius: RADIO.medio, paddingHorizontal: 14, fontSize: 16, color: colorSistema.texto, backgroundColor: superficie }} />
            {lista == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
            {lista?.error ? <Text style={{ fontSize: 14, color: t.color.peligroTexto }}>{lista.error}</Text> : null}
            {Array.isArray(lista) && !visibles.length ? (
              <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto3, marginTop: 12, textAlign: 'center' }}>
                {busca.trim() ? 'No encontramos ese medicamento entre tus compras del último año.' : 'No encontramos medicamentos en tus compras del último año que no estén ya en tu lista.'}
              </Text>
            ) : null}
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
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4, paddingBottom: ins.bottom + 24, gap: 16 }}>
            <View style={{ backgroundColor: superficie, borderRadius: RADIO.medio, padding: 16, gap: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{nombrePropio(elegido.nombre)}</Text>
              <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Última compra {fecha(elegido.ultima)}</Text>
            </View>
            {elegido.pide === 'dosis' ? (
              <>
                <Seccion>¿Cuántas tomas al día?</Seccion>
                {pildoras(DOSIS, CANTIDADES_RAPIDAS.includes(dosis) ? dosis : null, setDosis, (o) => `${cantidadTexto(o.v)} al día`)}
                <Contador superficie={superficie} etiqueta="Al día" valor={cantidadTexto(dosis)}
                  menos={{ etiqueta: 'Un cuarto menos', alTocar: () => setDosis((d) => moverCantidad(d, -1)), apagado: dosis <= CANTIDAD_MIN }}
                  mas={{ etiqueta: 'Un cuarto más', alTocar: () => setDosis((d) => moverCantidad(d, 1)), apagado: dosis >= CANTIDAD_MAX }} />
                <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
                  Tabletas, cápsulas o sobres en total al día, de ¼ en ¼. Si lo tomas día por medio, elige la mitad de lo que tomas ese día.
                </Text>
              </>
            ) : elegido.pide === 'dias' ? (
              <>
                <Seccion>¿Cuántos días te dura una compra?</Seccion>
                {pildoras([...DIAS.map((d) => ({ v: d, texto: String(d) })), { v: OTRO, texto: 'Otro' }], otrosDias ? OTRO : dias,
                  (v) => { if (v === OTRO) setOtrosDias(true); else { setOtrosDias(false); setDias(v); } },
                  (o) => (o.v === OTRO ? 'Otro número de días' : `${o.texto} días`))}
                {otrosDias ? (
                  <Contador superficie={superficie} etiqueta="Me dura" valor={`${dias} ${dias === 1 ? 'día' : 'días'}`}
                    menos={{ etiqueta: 'Un día menos', alTocar: () => setDias((d) => Math.max(1, d - 1)), apagado: dias <= 1 }}
                    mas={{ etiqueta: 'Un día más', alTocar: () => setDias((d) => Math.min(365, d + 1)), apagado: dias >= 365 }} />
                ) : null}
                <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
                  De este producto no podemos saber cuánto dura: dinos más o menos cada cuánto se te acaba.
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

// Una fila «etiqueta  −  valor  +» (2026-11-03). Los botones miden 32 + 6 de
// `hitSlop` por lado = 44 pt de dedo; la fila baja de renglón con letra grande.
function Contador({ superficie, etiqueta, valor, menos, mas }) {
  const t = useTema();
  const boton = (b, sf) => (
    <Presionable onPress={() => { if (b.apagado) return; Haptics.selectionAsync().catch(() => {}); b.alTocar(); }} disabled={!!b.apagado}
      accessibilityRole="button" accessibilityLabel={b.etiqueta} accessibilityState={{ disabled: !!b.apagado }} hitSlop={6}
      style={({ pressed }) => ({ minWidth: 32, minHeight: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: b.apagado ? 0.35 : 1,
        transform: [{ scale: pressed ? 0.92 : 1 }], backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' })}>
      <Icono sf={sf} respaldo={sf === 'minus' ? '−' : '+'} tam={13} color={colorSistema.texto} />
    </Presionable>
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', backgroundColor: superficie, borderRadius: RADIO.medio, padding: 14 }}>
      <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: '600', color: colorSistema.texto2 }}>{etiqueta}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {boton(menos, 'minus')}
        <Text accessibilityLiveRegion="polite" style={{ flexShrink: 1, fontSize: 18, fontWeight: '900', color: colorSistema.texto, minWidth: 96, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{valor}</Text>
        {boton(mas, 'plus')}
      </View>
    </View>
  );
}
