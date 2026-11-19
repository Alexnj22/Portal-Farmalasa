// Una frase del día de la app de clientes, NATIVO — el `FraseModal` del
// portal: el texto (hasta `FRASE_MAX` letras), el tipo (cambia el color de la
// tarjeta en la app) y cuándo sale: en la cola o un día específico. Lo que
// falta y la fila que se guarda salen del núcleo (`faltaEnFrase`,
// `filaDeFrase`). Una por día: se avisa antes de que la base la rechace. Una
// frase de la cola que ya salió no se pasa a un día (la base lo rechaza).
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { guardarFrase } from '@nucleo/data/ofertasClientes';
import { CATEGORIAS_DE_FRASE, FRASE_MAX, diaDeFrase, faltaEnFrase, filaDeFrase } from '@nucleo/utils/ofertasClientes';
import { sumarDias } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { leer } from '../../componentes/comercial/elegido';
import { volver } from '../../componentes/volver';

const CATEGORIA = Object.fromEntries(CATEGORIAS_DE_FRASE.map((c) => [c.value, c.label]));
const CUANDO = [{ id: 'cola', label: 'En la cola' }, { id: 'dia', label: 'Un día específico' }];
// El tono de la tarjeta en la app, por tipo (el portal lo pinta con degradado).
const colorDeTipo = (c) => (c === 'salud' ? MARCA.verde : c === 'calma' ? MARCA.azul : MARCA.violeta);

export default function Frase() {
  const { frase, frases } = useMemo(() => leer('frase-app') ?? { frase: {}, frases: [] }, []);
  const nueva = !frase.id;
  const yaSalio = !!frase.mostrada_el;
  const clave = `frase-app:${frase.id ?? 'nueva'}`;
  const hoy = diaDeFrase();
  const [f, setF] = useState(() => loadDraft(clave) ?? {
    texto: frase.texto ?? '', categoria: frase.categoria ?? 'animo',
    programada: !!frase.fecha, fecha: frase.fecha ?? sumarDias(hoy, 1), activa: frase.activa ?? true,
  });
  useEffect(() => { saveDraft(clave, f); }, [clave, f]);
  const [guardando, setGuardando] = useState(false);
  const cambiar = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const choca = f.programada && (frases ?? []).find((x) => x.id !== frase.id && x.activa && x.fecha === f.fecha);
  const queFalta = faltaEnFrase(f) ?? (choca ? { texto: 'Ese día ya tiene frase: elige otro día.', campo: 'fecha' } : null);
  const largo = f.texto.trim().length;

  const guardar = async () => {
    setGuardando(true); trabajando('Guardando…');
    try {
      await guardarFrase(frase.id, filaDeFrase(f));
      clearDraft(clave);
      listo('Frase guardada', '');
      volver('/ofertas-clientes');
    } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.')); }
    setGuardando(false);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: nueva ? 'Nueva frase del día' : 'Editar frase' }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Seccion titulo="Frase" pie={`${largo} de ${FRASE_MAX} letras. Lo ideal es menos de 90. Sin autor. Los consejos de salud, generales y sin dosis.`}>
            <Campo maxLength={FRASE_MAX} placeholder="Ej. Un paso pequeño también es avanzar." value={f.texto} onChangeText={cambiar('texto')} />
          </Seccion>
          <Seccion titulo="Tipo" pie="Cambia el color de la tarjeta en la app.">
            <Opciones valor={f.categoria} onCambiar={cambiar('categoria')} opciones={CATEGORIAS_DE_FRASE.map((c) => ({ id: c.value, label: c.label }))} />
          </Seccion>
          {!yaSalio ? (
            <Seccion titulo="Cuándo sale" pie="En la cola sale el próximo día libre, en el orden en que se cargaron. Un día específico le gana a la cola.">
              <Opciones valor={f.programada ? 'dia' : 'cola'} onCambiar={(v) => cambiar('programada')(v === 'dia')} opciones={CUANDO} />
            </Seccion>
          ) : null}
          {!yaSalio && f.programada ? (
            <Seccion titulo="Día">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Sale el</Text>
                <Fecha valor={f.fecha} onCambiar={cambiar('fecha')} />
              </View>
              {choca ? <Aviso tono="cuidado" texto={`Ese día ya tiene frase: «${choca.texto}». Elige otro día o pausa aquélla.`} /> : null}
              {f.fecha < hoy && !choca ? <Aviso tono="cuidado" texto="Ese día ya pasó: la frase no va a salir." /> : null}
            </Seccion>
          ) : null}
          {largo > 0 ? (
            <View style={{ borderRadius: 20, padding: 16, backgroundColor: colorDeTipo(f.categoria) }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, opacity: 0.9 }}>
                {`FRASE DEL DÍA · ${(CATEGORIA[f.categoria] ?? '').toUpperCase()}`}
              </Text>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 4 }}>{f.texto.trim()}</Text>
            </View>
          ) : null}
          {queFalta && !guardando ? <Aviso tono="cuidado" texto={queFalta.texto} /> : null}
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.azul} onPress={guardar} deshabilitado={!!queFalta || guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
