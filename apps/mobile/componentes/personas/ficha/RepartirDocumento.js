// «Este documento nombra a más gente. ¿Se lo pongo a todos?» — la hoja nativa
// del diálogo del portal (`AsignarDocumentoAVarios`), con las MISMAS piezas del
// núcleo: el cruce de nombres contra el personal (`cruzarConElPadron`), las
// fichas a las que les falta ese documento (`fichasSinDocumento`) y el reparto
// (`repartirDocumento`).
//
// Es una pregunta y no una acción automática: un documento en el expediente
// equivocado no se deshace con un botón, y la lista la leyó un modelo sobre una
// foto. La app propone y la persona decide:
//  · la ficha abierta ya lo tiene (apagada);
//  · quien tiene ficha se le escribe ahora;
//  · el nombre sin ficha queda en espera y se le pega cuando la registren.
// Si el nombre del papel no es el de la ficha, se PROPONE la que coincide
// («¿Es …?») y hay que confirmarla; si no, se elige entre las fichas a las que
// les falta el documento.
import { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Presionable as Pressable } from '../../Tocable';
import * as Haptics from 'expo-haptics';
import { cruzarConElPadron, fichasSinDocumento, repartirDocumento, mensajeDelReparto } from '@nucleo/data/documentosCompartidos';
import { resumenDelReparto } from '@nucleo/utils/lecturaDeDocumento';
import ConAurora from '../../ConAurora';
import EncabezadoDeHoja from '../../EncabezadoDeHoja';
import MarcaDeEleccion from '../../MarcaDeEleccion';
import { colorSistema } from '../../Formulario';
import { Aviso, BotonGrande } from '../../formulario/Piezas';
import { Pildora } from '../../avisos/Piezas';
import { MARCA } from '../../inicio/marca';
import { Elegir } from '../Formulario';
import { Enlace } from './Piezas';

/**
 * @param {string[]} nombres     los que leyó el documento
 * @param {object}   documento   la entrada de `employee_documents` ya subida
 * @param {string}   rotulo      cómo se llama el documento
 * @param {Array}    empleados   el personal cargado
 * @param {string}   [fichaAbierta] id de la ficha que se está editando
 * @param {Function} onCerrar
 * @param {Function} onTerminar  recibe `{ titulo, texto }` para el aviso
 */
export default function RepartirDocumento({ nombres, documento, rotulo, empleados, fichaAbierta, onCerrar, onTerminar }) {
  const filas = useMemo(() => cruzarConElPadron(nombres, empleados, fichaAbierta), [nombres, empleados, fichaAbierta]);
  // Arrancan todas marcadas menos la que ya lo tiene: si el papel los nombra,
  // lo normal es que les corresponda.
  const [marcados, setMarcados] = useState(() => new Set(filas.filter((f) => !f.esLaAbierta).map((f) => f.nombre)));
  const [elegidas, setElegidas] = useState(() => new Map());
  const [sinDocumento, setSinDocumento] = useState(null); // null = cargando
  const [falloLista, setFalloLista] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const hayQueElegir = filas.some((f) => !f.empleado);

  useEffect(() => {
    if (!hayQueElegir || !documento?.category) return undefined;
    let vivo = true;
    fichasSinDocumento(documento.category)
      .then((lista) => { if (vivo) setSinDocumento(lista); })
      .catch(() => { if (vivo) { setSinDocumento([]); setFalloLista(true); } });
    return () => { vivo = false; };
  }, [hayQueElegir, documento?.category]);

  const elegir = (nombre, ficha) => setElegidas((prev) => {
    const m = new Map(prev);
    if (ficha) m.set(nombre, ficha); else m.delete(nombre);
    return m;
  });
  const fichaDe = (f) => f.empleado || elegidas.get(f.nombre) || null;
  const alternar = (nombre) => {
    Haptics.selectionAsync().catch(() => {});
    setMarcados((prev) => { const s = new Set(prev); if (s.has(nombre)) s.delete(nombre); else s.add(nombre); return s; });
  };
  const marcadas = filas.filter((f) => marcados.has(f.nombre) && !f.esLaAbierta);
  const conFicha = marcadas.filter((f) => fichaDe(f));
  const sinFicha = marcadas.filter((f) => !fichaDe(f));

  const confirmar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await repartirDocumento(conFicha.map((f) => fichaDe(f).id), sinFicha.map((f) => f.nombre), documento);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onTerminar({ titulo: 'Documento repartido', texto: resumenDelReparto(r) });
    } catch (e) {
      // No se cierra: se puede reintentar sin volver a subir el documento.
      setError(mensajeDelReparto(e));
    } finally { setGuardando(false); }
  };

  const textoDelBoton = guardando ? 'Asignando…' : `Asignar a ${marcadas.length}`;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!guardando} onRequestClose={() => { if (!guardando) onCerrar(); }}>
      <ConAurora>
        <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
          <EncabezadoDeHoja titulo={`Nombra a ${filas.length} persona${filas.length === 1 ? '' : 's'}`} subtitulo={rotulo} onCerrar={onCerrar} ocupado={guardando} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10 }} keyboardShouldPersistTaps="handled">
            <Aviso texto="Es el mismo papel para todos. Marca a quiénes se les debe adjuntar." />
            {filas.map((f) => {
              const puesto = f.esLaAbierta;
              const activo = marcados.has(f.nombre) && !puesto;
              const elegida = elegidas.get(f.nombre) || null;
              const ficha = f.empleado || elegida;
              // Las fichas que otra fila ya eligió no se ofrecen otra vez.
              const tomadas = new Set([...elegidas.entries()].filter(([n]) => n !== f.nombre).map(([, e]) => e.id));
              const opciones = (sinDocumento || [])
                .filter((e) => e.id !== fichaAbierta && !tomadas.has(e.id))
                .map((e) => ({ id: String(e.id), label: e.name }));
              const proponer = !f.empleado && !elegida && f.posible && !tomadas.has(f.posible.id);
              const detalle = puesto ? 'Es la persona que estás editando. Ya lo tiene.'
                : f.empleado ? `Ya registrada: ${f.empleado.name}`
                  : elegida ? `Persona elegida: ${elegida.name}`
                    : 'Todavía no está registrada. Se le adjunta cuando la registren.';
              return (
                <View key={f.nombre} style={{ borderRadius: 16, backgroundColor: colorSistema.fila, opacity: puesto ? 0.6 : 1,
                  borderWidth: activo ? 2 : 0, borderColor: `${MARCA.azul}73` }}>
                  <Pressable disabled={puesto || guardando} onPress={() => alternar(f.nombre)}
                    accessibilityRole="checkbox" accessibilityState={{ checked: activo, disabled: puesto }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 44 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text>
                    </View>
                    {f.ambiguo ? <Pildora texto="Hay dos iguales" color={MARCA.ambar} /> : null}
                    {!puesto ? <Pildora texto={ficha ? 'Registrada' : 'En espera'} color={ficha ? MARCA.verde : MARCA.ambar} /> : null}
                    {!puesto ? <MarcaDeEleccion elegida={activo} multiple /> : null}
                  </Pressable>
                  {!puesto && !f.empleado && activo ? (
                    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
                      {proponer ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{`¿Es ${f.posible.name}?`}</Text>
                          <Enlace texto="Sí, es esa persona" onPress={() => elegir(f.nombre, f.posible)} deshabilitado={guardando} />
                        </View>
                      ) : null}
                      <Elegir rotulo={proponer ? 'No es esa. Elegir otra persona' : 'Elegir a la persona (si ya está registrada)'}
                        valor={elegida ? String(elegida.id) : ''} opciones={opciones} vacio="Dejar en espera"
                        deshabilitado={guardando || sinDocumento === null}
                        onCambiar={(id) => elegir(f.nombre, (sinDocumento || []).find((e) => String(e.id) === String(id)) || null)} />
                    </View>
                  ) : null}
                </View>
              );
            })}
            {falloLista ? <Aviso tono="cuidado" texto="No se pudo cargar el personal. Los que no están registrados quedan en espera." /> : null}
            {filas.some((f) => f.ambiguo) ? <Aviso tono="cuidado" texto="Hay más de una persona con el mismo nombre. Revisa sus datos antes de darlo por adjuntado." /> : null}
            {error ? <Aviso tono="freno" texto={error} /> : null}
          </ScrollView>
          <View style={{ padding: 16, gap: 8 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${conFicha.length} ya registradas${sinFicha.length ? ` · ${sinFicha.length} en espera` : ''}`}</Text>
            <BotonGrande texto={textoDelBoton} color={MARCA.azul} deshabilitado={guardando || !marcadas.length} onPress={confirmar} />
            <Enlace texto="Sólo a esta persona" onPress={onCerrar} deshabilitado={guardando} />
          </View>
        </SafeAreaView>
      </ConAurora>
    </Modal>
  );
}
