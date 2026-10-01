// Anotar lo que faltó en una bolsa YA recibida, NATIVO — lo que el portal
// ofrece al escanear una bolsa recibida (`ConfirmarPorCodigo.jsx`): dentro de
// las 48 h (`sePuedeDeclararTarde`, del núcleo), se dice qué no venía, renglón
// por renglón, y queda como faltante para aclarar (`declararFaltanteTardio`).
// Fuera del plazo, se dice y no se ofrece.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { fetchTrasladoPorCodigo } from '@nucleo/data/traslados';
import { declararFaltanteTardio, HORAS_PARA_DECLARAR_TARDE, renglonesDeLaBolsa, sePuedeDeclararTarde } from '@nucleo/data/faltantes';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

export default function FaltanteTardio() {
  const { codigo } = useLocalSearchParams();
  const [t, setT] = useState(undefined);
  const [faltan, setFaltan] = useState({});   // posicion → cantidad (texto)
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchTrasladoPorCodigo(String(codigo || '')).then(({ traslado }) => { if (vivo) setT(traslado ?? null); });
    return () => { vivo = false; };
  }, [codigo]);

  if (t === undefined) return <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Lo que faltó' }} />;
  const renglones = renglonesDeLaBolsa(t);
  const puede = sePuedeDeclararTarde(t);
  const declarados = renglones
    .map((r) => ({ posicion: r.posicion, cantidad: Number(faltan[r.posicion]) || 0, nota: nota.trim() || null, max: Number(r.cantidad) || 0 }))
    .filter((r) => r.cantidad > 0);
  const deMas = declarados.find((r) => r.cantidad > r.max);

  const anotar = async () => {
    setEnviando(true); trabajando('Anotando lo que faltó…');
    const id = t?.id ?? t?.envio_bolsa?.id;
    const r = await declararFaltanteTardio(id, declarados.map(({ max, ...x }) => x));
    setEnviando(false);
    if (!r.ok) { fallo('No se pudo anotar', r.error ?? 'Intenta de nuevo.'); return; }
    listo('Faltante anotado', `${r.declarados} renglón(es) quedan por aclarar`);
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Lo que faltó' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {!t ? <Aviso tono="freno" texto="No encontramos esa bolsa." /> : (
            <>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700', marginHorizontal: 4 }}>
                {`${t.origen ?? t.envio_bolsa?.origen_branch_name ?? '—'} → ${t.destino ?? t.envio_bolsa?.branch_name ?? '—'}`}
              </Text>
              <Aviso tono="nota" texto={`Esta bolsa ya se recibió${t.recibio ? ` (la recibió ${t.recibio})` : ''}.`} />
              {!puede ? <Aviso tono="freno" texto={`Pasaron más de ${HORAS_PARA_DECLARAR_TARDE} horas: ya no se puede anotar lo que faltó.`} /> : (
                <>
                  <Seccion titulo="¿Qué no venía?">
                    {renglones.map((r, i) => (
                      <View key={r.posicion} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{r.descripcion}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Venían ${r.cantidad}`}</Text>
                        </View>
                        <View style={{ width: 80 }}>
                          <Campo multiline={false} value={faltan[r.posicion] ?? ''} placeholder="0" keyboardType="number-pad" style={{ textAlign: 'center' }}
                            onChangeText={(v) => setFaltan((f) => ({ ...f, [r.posicion]: v.replace(/\D/g, '') }))} />
                        </View>
                      </View>
                    ))}
                  </Seccion>
                  <Campo value={nota} onChangeText={setNota} placeholder="Nota (opcional)" />
                  {deMas ? <Aviso tono="freno" texto="No pueden faltar más de los que venían." /> : null}
                  <BotonGrande texto={enviando ? 'Anotando…' : 'Anotar lo que faltó'} color={MARCA.rojo}
                    deshabilitado={enviando || !declarados.length || !!deMas} onPress={anotar} />
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
