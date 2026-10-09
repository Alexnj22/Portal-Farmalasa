// Contar un producto por mililitros, NATIVO — `MililitrosModal` del portal: lo
// que trae una unidad (el vial) y hasta cuatro dosis; al cobrar se elige una y
// salen las aplicaciones (10 ml a 2.5 → 4). Cuatro casillas fijas por lo mismo
// que el portal: «2,5» es un número en español. La lectura y la validación son
// las del núcleo (`leerMililitros`).
import { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fijarMililitros } from '@nucleo/data/inyecciones';
import { CASILLAS_DE_DOSIS, leerMililitros } from '@nucleo/utils/inyeccionesAjustes';
import { aplicacionesPorDosis, fmtMl } from '@nucleo/utils/inyeccionDosis';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { leer } from '../componentes/comercial/elegido';
import { volver } from '../componentes/volver';

export default function InyeccionMl() {
  const fila = useMemo(() => leer('inyeccion-ml'), []);
  const [contenido, setContenido] = useState(fila?.contenido_ml != null ? fmtMl(fila.contenido_ml) : '');
  const [dosis, setDosis] = useState(() => [...(fila?.opciones_ml || []).map(fmtMl), ...Array(CASILLAS_DE_DOSIS).fill('')].slice(0, CASILLAS_DE_DOSIS));
  const [guardando, setGuardando] = useState(false);
  const { c, lista, valido } = leerMililitros(contenido, dosis);

  const escribir = async (valores, titulo, texto) => {
    setGuardando(true); trabajando('Guardando…');
    try {
      await fijarMililitros({ erpProductId: fila.erp_product_id, ...valores });
      useStaffStore.getState().appendAuditLog('INYECCION_ML', String(fila.erp_product_id),
        { producto: fila.descripcion, contenido_ml: valores.contenidoMl, dosis_ml: valores.dosisMl ?? null, desde: 'app' });
      listo(titulo, texto);
      volver('/inyecciones');
    } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); }
    setGuardando(false);
  };
  const guardarMl = () => Alert.alert('Contar por mililitros', `${fmtMl(c)} ml por unidad; al cobrar se elige ${lista.map((d) => `${fmtMl(d)} ml`).join(' o ')}.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: () => escribir({ contenidoMl: c, dosisMl: lista }, 'Guardado por mililitros', 'Al cobrar se pregunta cuánto se pone.') },
  ]);
  const dejar = () => Alert.alert('Dejar de contar por ml', 'Vuelve a regir el número de aplicaciones por unidad.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Dejar de contar', style: 'destructive', onPress: () => escribir({ contenidoMl: null }, 'Vuelve a contar aplicaciones', 'Rige el número de aplicaciones por unidad.') },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Por mililitros' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        {!fila ? <Aviso tono="freno" texto="Vuelve a la lista y elige el producto otra vez." /> : (
          <>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{fila.descripcion}</Text>
            <Seccion titulo="Cuánto trae una unidad (ml)">
              <Campo multiline={false} keyboardType="decimal-pad" placeholder="10" value={contenido} onChangeText={setContenido} />
            </Seccion>
            <Seccion titulo="Cuánto se pone por aplicación (ml)" pie="Al cobrar se elige una.">
              {dosis.map((d, i) => (
                <Campo key={i} multiline={false} keyboardType="decimal-pad" placeholder={i === 0 ? '2' : i === 1 ? '2.5' : `Dosis ${i + 1}`} value={d}
                  onChangeText={(t) => setDosis((x) => x.map((v, j) => (j === i ? t : v)))} />
              ))}
            </Seccion>
            {c != null && lista.length ? (
              <Seccion titulo="Así se cuenta">
                {lista.map((d) => (
                  <View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{`${fmtMl(d)} ml`}</Text>
                    <Text style={{ color: d > c ? MARCA.rojo : colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
                      {d > c ? `pasa de ${fmtMl(c)} ml` : `${aplicacionesPorDosis(c, d)} aplicaciones por unidad`}
                    </Text>
                  </View>
                ))}
              </Seccion>
            ) : null}
            <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} deshabilitado={!valido || guardando} onPress={guardarMl} />
            {fila.contenido_ml != null ? <BotonGrande texto="Dejar de contar por ml" borde color={MARCA.rojo} deshabilitado={guardando} onPress={dejar} /> : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
