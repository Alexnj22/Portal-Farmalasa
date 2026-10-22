// Un regalo promocional del programa de puntos, NATIVO — `DialogoRegalo` de
// `PremiosDelPrograma` del portal. Cuatro modos (`modo`):
//   · nuevo / editar — nombre, descripción, costo de uno y si está activo.
//   · entrada — sumar (o restar, con motivo) al inventario de una sucursal.
//   · enviar — de una sucursal a otra; la de destino lo confirma al recibirlo.
// Qué le falta para guardarse lo dice el núcleo (`faltaEnRegalo`), lo mismo
// del portal. Lo escrito se guarda como borrador. Sólo administración (quien
// edita los niveles); la base lo vuelve a exigir.
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ajustarPromocional, enviarPromocional, guardarPromocional } from '@nucleo/data/puntos';
import { TITULO_DIALOGO_REGALO, faltaEnRegalo } from '@nucleo/utils/nivelesDePuntos';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import Interruptor from '../componentes/Interruptor';
import SelectorDeSala from '../componentes/inicio/SelectorDeSala';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { leer } from '../componentes/comercial/elegido';
import { volver } from '../componentes/volver';

const Rotulo = ({ texto }) => <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{texto}</Text>;

export default function PuntosRegalo() {
  const { modo: modoParam } = useLocalSearchParams();
  const dato = useMemo(() => leer('puntos-regalo'), []);
  const modo = dato?.modo ?? String(modoParam ?? 'nuevo');
  const promo = dato?.promo ?? null;
  const sucursales = useStaffStore((s) => s.branches);
  const salas = useMemo(() => (sucursales || []).map((b) => ({ id: b.id, label: b.name })), [sucursales]);
  const bodega = salas.find((o) => /bodega/i.test(o.label))?.id ?? '';
  // El borrador sobrevive al cierre de sesión por inactividad (la misma llave del portal).
  const llave = `puntos_regalo_${modo}_${promo?.id ?? 'nuevo'}`;
  const [f, setF] = useState(() => loadDraft(llave) ?? ({
    nombre: promo?.nombre ?? '', descripcion: promo?.descripcion ?? '',
    costo: promo?.costo != null ? String(promo.costo) : '', activo: promo?.activo ?? true,
    sala: bodega, hacia: dato?.hacia ?? '', cantidad: dato?.cantidad ? String(dato.cantidad) : '', nota: '',
  }));
  const [guardando, setGuardando] = useState(false);
  const poner = (k, v) => setF((x) => { const n = { ...x, [k]: v }; saveDraft(llave, n); return n; });
  const n = Number(f.cantidad);
  const falta = faltaEnRegalo(modo, f);
  const necesitaPromo = modo !== 'nuevo';

  const guardar = async () => {
    setGuardando(true); trabajando('Guardando…');
    try {
      if (modo === 'nuevo' || modo === 'editar') {
        await guardarPromocional({ id: promo?.id ?? null, nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null,
          costo: f.costo === '' ? null : Number(f.costo), activo: f.activo });
        listo('Regalo guardado', f.nombre.trim());
      } else if (modo === 'entrada') {
        const queda = await ajustarPromocional(promo.id, Number(f.sala), n, f.nota);
        listo(n > 0 ? 'Entrada anotada' : 'Ajuste anotado', `Quedan ${queda}`);
      } else {
        await enviarPromocional(promo.id, Number(f.sala), Number(f.hacia), n);
        listo('Envío anotado', 'La sucursal lo confirma al recibirlo.');
      }
      clearDraft(llave);
      volver('/puntos');
    } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); }
    setGuardando(false);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: TITULO_DIALOGO_REGALO[modo] ?? 'Regalo', headerLargeTitle: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}>
          {necesitaPromo && !promo ? <Aviso tono="freno" texto="Vuelve a Puntos › Premios y elige el regalo otra vez." /> : (
            <>
              {promo && modo !== 'editar' ? <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{promo.nombre}</Text> : null}
              {modo === 'nuevo' || modo === 'editar' ? (
                <Seccion titulo="El regalo" pie="El costo sirve para saber cuánto cuesta el programa en regalos.">
                  <Rotulo texto="Nombre" />
                  <Campo multiline={false} value={f.nombre} maxLength={80} placeholder="Termo Salud" onChangeText={(v) => poner('nombre', v)} accessibilityLabel="Nombre" />
                  <Rotulo texto="Descripción (opcional)" />
                  <Campo value={f.descripcion} onChangeText={(v) => poner('descripcion', v)} accessibilityLabel="Descripción" />
                  <Rotulo texto="Costo de uno (opcional, $)" />
                  <Campo multiline={false} value={f.costo} keyboardType="decimal-pad" placeholder="0.00"
                    onChangeText={(v) => poner('costo', v.replace(/[^0-9.]/g, ''))} accessibilityLabel="Costo de uno" />
                  {modo === 'editar' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Activo (se puede poner en el raspable)</Text>
                      <Interruptor value={!!f.activo} onValueChange={(v) => poner('activo', v)} accessibilityLabel="Activo" />
                    </View>
                  ) : null}
                </Seccion>
              ) : null}
              {modo === 'entrada' ? (
                <Seccion titulo="Entrada o ajuste">
                  <Rotulo texto="Sucursal" />
                  <SelectorDeSala salas={salas} activa={f.sala} onCambiar={(v) => poner('sala', v)} />
                  <Rotulo texto="Cantidad" />
                  <Campo multiline={false} value={f.cantidad} keyboardType="numbers-and-punctuation" placeholder="10, o -2 para restar"
                    onChangeText={(v) => poner('cantidad', v.replace(/[^0-9-]/g, ''))} accessibilityLabel="Cantidad" />
                  <Rotulo texto={n < 0 ? 'Por qué se resta' : 'Nota (opcional)'} />
                  <Campo value={f.nota} onChangeText={(v) => poner('nota', v)} accessibilityLabel="Nota" />
                </Seccion>
              ) : null}
              {modo === 'enviar' ? (
                <Seccion titulo="Envío" pie={promo?.existencias?.[f.sala] != null ? `Hay ${promo.existencias[f.sala]} en el origen.` : 'En el origen no hay existencias anotadas.'}>
                  <Rotulo texto="Desde" />
                  <SelectorDeSala salas={salas} activa={f.sala} onCambiar={(v) => poner('sala', v)} />
                  <Rotulo texto="Hacia" />
                  <SelectorDeSala salas={salas} activa={f.hacia} onCambiar={(v) => poner('hacia', v)} />
                  <Rotulo texto="Cantidad" />
                  <Campo multiline={false} value={f.cantidad} keyboardType="number-pad" onChangeText={(v) => poner('cantidad', v.replace(/\D/g, ''))} accessibilityLabel="Cantidad" />
                </Seccion>
              ) : null}
              {falta ? <Aviso tono="cuidado" texto={falta} /> : null}
              <BotonGrande texto={guardando ? 'Guardando…' : modo === 'enviar' ? 'Enviar' : 'Guardar'} color={MARCA.azul}
                deshabilitado={!!falta || guardando} onPress={guardar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
