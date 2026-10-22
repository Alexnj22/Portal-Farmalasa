// Editar un nivel de Puntos Salud o un rango del Cliente Mayorista, NATIVO —
// `TarjetaDeNivel` / `TarjetaDeRango` de `NivelesDelPrograma` del portal.
// Un nivel: nombre, umbral de compra en 12 meses, puntos por dólar, cumpleaños,
// horas para retirar una reserva y días de anticipo de las ofertas. Un rango:
// sólo el cumpleaños. En los dos más altos, además, los premios del raspable.
//
// Viaja SÓLO lo que cambió (`cambiosDeNivel` / `cambiosDeRango`, núcleo) con el
// motivo, y queda en el historial. Lo escrito se guarda como borrador: la
// sesión se cierra sola y una tabla de premios a medio armar no se pierde.
// La base vuelve a validar todo y exige `puntos_tab_niveles` can_edit.
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { guardarNivelDePuntos, guardarRangoMayoreoDePuntos } from '@nucleo/data/puntos';
import {
  CAMPOS_NIVEL, cambiosDeNivel, cambiosDeRango, costoDelRaspableTexto, formDeNivel, formDeRango, premiosLimpios,
} from '@nucleo/utils/nivelesDePuntos';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import EditorDePremios from '../componentes/puntos/EditorDePremios';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { leer } from '../componentes/comercial/elegido';
import { volver } from '../componentes/volver';

const Rotulo = ({ texto }) => <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{texto}</Text>;
const Ayuda = ({ texto }) => (texto ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{texto}</Text> : null);

export default function PuntosNivel() {
  const { tipo, clave } = useLocalSearchParams();
  const dato = useMemo(() => leer('puntos-nivel'), []);
  const fila = dato?.fila && dato.fila.clave === clave ? dato.fila : null;
  const esNivel = tipo !== 'rango';
  const conRaspable = !!dato?.conRaspable;
  const esEntrada = !!dato?.esEntrada;
  const puedeEditar = !!dato?.puedeEditar;
  const llave = `puntos_${esNivel ? 'nivel' : 'mayoreo'}_${clave}`;
  const desdeFila = useMemo(() => (fila ? (esNivel ? formDeNivel(fila) : formDeRango(fila)) : null), [fila, esNivel]);
  const [form, setForm] = useState(() => loadDraft(llave) ?? desdeFila);
  const [guardando, setGuardando] = useState(false);

  if (!fila || !form) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Nivel' }} />
        <View style={{ padding: 16 }}><Aviso tono="freno" texto="Vuelve a Puntos › Niveles y elige el nivel otra vez." /></View>
      </>
    );
  }

  const cambios = esNivel ? cambiosDeNivel(form, fila, conRaspable) : cambiosDeRango(form, fila, conRaspable);
  const hayCambios = Object.keys(cambios).length > 0;
  // Sólo lo que la persona cambia se guarda como borrador (igual que el portal).
  const poner = (campo, v) => setForm((f) => { const n = { ...f, [campo]: v }; saveDraft(llave, n); return n; });
  const costo = conRaspable ? costoDelRaspableTexto(premiosLimpios(form.cupon_premios), fila.cupon_mensual) : null;
  const nombre = esNivel ? (form.nombre || fila.nombre) : fila.nombre;

  const descartar = () => { clearDraft(llave); setForm(desdeFila); };
  const guardar = () => Alert.alert(`¿Guardar ${esNivel ? 'el nivel' : 'el rango'} ${nombre}?`,
    'Rige desde ahora para todos los clientes de este nivel y queda en el historial.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true); trabajando('Guardando…');
        try {
          if (esNivel) await guardarNivelDePuntos(fila.clave, cambios, form.nota);
          else await guardarRangoMayoreoDePuntos(fila.clave, cambios, form.nota);
          clearDraft(llave);
          listo('Guardado', `${esNivel ? 'Nivel' : 'Rango'} ${nombre}`);
          volver('/puntos');
        } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); }
        setGuardando(false);
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `${esNivel ? 'Nivel' : 'Rango'} ${fila.nombre}`, headerLargeTitle: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}>
          {!puedeEditar ? <Aviso texto="Puedes ver la configuración, pero no cambiarla." /> : null}
          {esNivel ? (
            <Seccion titulo="El nivel">
              {CAMPOS_NIVEL.map((c) => {
                const fijo = esEntrada && c.key === 'desde';
                return (
                  <View key={c.key} style={{ gap: 4 }}>
                    <Rotulo texto={c.prefix ? `${c.label} (${c.prefix})` : c.label} />
                    <Campo multiline={false} value={form[c.key]} editable={puedeEditar && !fijo} accessibilityLabel={c.label}
                      keyboardType={c.tipo === 'number' ? 'decimal-pad' : 'default'}
                      onChangeText={(v) => poner(c.key, c.tipo === 'number' ? v.replace(/[^0-9.]/g, '') : v)} />
                    <Ayuda texto={fijo ? 'El nivel de entrada empieza en $0.' : c.ayuda} />
                  </View>
                );
              })}
            </Seccion>
          ) : (
            <Seccion titulo="El rango" pie="Sólo persona natural con fecha de nacimiento.">
              <Rotulo texto="Puntos de cumpleaños" />
              <Campo multiline={false} value={form.puntos_cumpleanos} editable={puedeEditar} keyboardType="number-pad"
                onChangeText={(v) => poner('puntos_cumpleanos', v.replace(/\D/g, ''))} accessibilityLabel="Puntos de cumpleaños" />
            </Seccion>
          )}

          {conRaspable ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>Raspable del mes</Text>
              <EditorDePremios premios={form.cupon_premios} puedeEditar={puedeEditar} alCambiar={(l) => poner('cupon_premios', l)} />
              {costo ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{costo}</Text> : null}
            </View>
          ) : null}

          {puedeEditar && hayCambios ? (
            <Seccion titulo="Guardar">
              <Rotulo texto="Motivo del cambio (opcional)" />
              <Campo value={form.nota} onChangeText={(v) => poner('nota', v)} placeholder="Ej.: premios de noviembre" accessibilityLabel="Motivo del cambio" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><BotonGrande texto="Descartar" borde deshabilitado={guardando} onPress={descartar} /></View>
                <View style={{ flex: 1 }}><BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.azul} deshabilitado={guardando} onPress={guardar} /></View>
              </View>
            </Seccion>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
