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

const DOSIS = [{ v: 0.5, texto: '½' }, { v: 1, texto: '1' }, { v: 1.5, texto: '1½' }, { v: 2, texto: '2' }, { v: 3, texto: '3' }];
const DIAS = [7, 15, 30, 60, 90];
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
    <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
      {opciones.map((o) => {
        const elegida = o.v === valor;
        return (
          <Presionable key={o.v} onPress={() => { Haptics.selectionAsync().catch(() => {}); poner(o.v); }}
            accessibilityRole="radio" accessibilityState={{ selected: elegida }} accessibilityLabel={etiqueta(o)}
            style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: RADIO.medio, alignItems: 'center', justifyContent: 'center',
              backgroundColor: elegida ? t.color.magenta : superficie, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: elegida ? '#FFFFFF' : colorSistema.texto }}>{o.texto}</Text>
          </Presionable>
        );
      })}
    </View>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => alCerrar(false)}>
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18 }}>
          {elegido ? (
            <Presionable onPress={() => { setElegido(null); setError(null); }} hitSlop={12} accessibilityRole="button"
              style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: t.color.magentaTexto }}>Atrás</Text>
            </Presionable>
          ) : <View style={{ minWidth: 44 }} />}
          <Text style={{ fontSize: 18, fontWeight: '800', color: colorSistema.texto }}>Agregar medicamento</Text>
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
                      <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto }} numberOfLines={2}>{nombrePropio(p.nombre)}</Text>
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
                {pildoras(DOSIS, dosis, setDosis, (o) => `${o.texto} al día`)}
                <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, marginTop: -6, marginLeft: 4 }}>
                  Tabletas, cápsulas o sobres en total al día. Si lo tomas día por medio, elige ½.
                </Text>
              </>
            ) : elegido.pide === 'dias' ? (
              <>
                <Seccion>¿Cuántos días te dura una compra?</Seccion>
                {pildoras(DIAS.map((d) => ({ v: d, texto: String(d) })), dias, setDias, (o) => `${o.texto} días`)}
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
