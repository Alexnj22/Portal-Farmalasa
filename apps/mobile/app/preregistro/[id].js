// Un pre-registro de la app de clientes, NATIVO — el `ResolverModal` del
// portal. Busca la ficha por DOCUMENTO (nunca por nombre) y la vincula, o lo
// descarta. Lo hace `app_preregistro_resolver`, la misma función del portal.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { buscarFichasPorDocumento, resolverPreregistro } from '@nucleo/data/ofertasClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { preregistroElegido } from '../../componentes/ofertas/preregistro';
import { fallo, listo } from '../../componentes/Progreso';

export default function Preregistro() {
  const pre = preregistroElegido();
  const [fichas, setFichas] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!pre) return;
    buscarFichasPorDocumento(pre.documento).then(setFichas).catch(() => setFichas([]));
  }, [pre]);
  if (!pre) return <Aviso tono="freno" texto="No se encontró el pre-registro." />;

  const hacer = async (accion, customerId) => {
    setOcupado(true);
    try {
      await resolverPreregistro(pre.id, accion, customerId);
      listo(accion === 'vincular' ? 'Pre-registro vinculado' : 'Pre-registro descartado', '');
      router.back();
    } catch (e) {
      fallo('No se pudo completar', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setOcupado(false);
    }
  };
  const descartar = () => Alert.alert('Descartar pre-registro', `${pre.nombre} deja de aparecer aquí. Si de verdad es cliente, la sala lo registra en caja.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Descartar', style: 'destructive', onPress: () => hacer('descartar') },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pre-registro', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Seccion titulo="Se unió desde la app">
          <Dato primero rotulo="Nombre" valor={pre.nombre} />
          <Dato rotulo="Documento" valor={pre.documento} />
          <Dato rotulo="Teléfono" valor={pre.telefono} />
          {pre.email ? <Dato rotulo="Correo" valor={pre.email} /> : null}
          {pre.fecha_nacimiento ? <Dato rotulo="Nacimiento" valor={fechaTexto(pre.fecha_nacimiento, { day: 'numeric', month: 'long', year: 'numeric' })} /> : null}
          <Dato rotulo="Acepta promociones" valor={pre.acepta_promociones ? 'Sí' : 'No'} />
          <Dato rotulo="Fecha" valor={fechaTexto(pre.created_at, { day: 'numeric', month: 'long' })} />
        </Seccion>
        <Seccion titulo="Fichas con ese documento">
          {fichas == null ? <ActivityIndicator /> : fichas.length ? fichas.map((c, i) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{c.name}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{[c.dui, c.nit, c.phone].filter(Boolean).join(' · ')}</Text>
              </View>
              <Pressable disabled={ocupado} onPress={() => { Haptics.selectionAsync().catch(() => {}); hacer('vincular', c.id); }}
                style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: MARCA.azul, opacity: ocupado ? 0.5 : pressed ? 0.8 : 1 })}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Vincular</Text>
              </Pressable>
            </View>
          )) : <Aviso tono="cuidado" texto="No hay ficha con ese documento. Hay que crearla en caja con estos datos; la app la reconocerá sola." />}
        </Seccion>
        <BotonGrande texto="Descartar" color={MARCA.rojo} borde onPress={descartar} deshabilitado={ocupado} />
      </ScrollView>
    </>
  );
}
