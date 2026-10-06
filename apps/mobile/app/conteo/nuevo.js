// Crear un conteo de inventario, NATIVO — `NuevoConteoModal` del portal. Tres
// ejes independientes (qué se cuenta, con cuánto detalle, contra qué
// existencia) y el filtro que viaja al servidor salen del núcleo
// (`ALCANCES_DE_CONTEO`, `pedidoDeConteo`); lo crea `crearConteoInventario`,
// la misma acción del store que usa el portal (snapshot + bitácora).
//
// El cíclico muestra la composición de la muestra antes de crearla
// (`previewMuestraCiclica`): se sortea en el servidor, así que es indicativa
// del reparto, no de los productos exactos.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchBranchIdsConInventario, searchActiveProductsForConteo } from '@nucleo/data/conteoInventario';
import { fetchLaboratoriosBasic } from '@nucleo/data/laboratorios';
import {
  ALCANCES_DE_CONTEO, FUENTES_DE_CONTEO, MODOS_DE_CONTEO, SEGMENTO_DE_MUESTRA_LABEL, SEGMENTO_DE_MUESTRA_ORDEN,
  TAMANO_CICLICO_DEFAULT, pedidoDeConteo,
} from '@nucleo/utils/conteoDeInventario';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

const AYUDA = {
  CICLICO: 'Una muestra del mes, priorizando lo que hace más que no se cuenta y lo bajo receta.',
  TOTAL: 'Todo lo que la sala tiene en existencia.',
  LABORATORIO: 'Todos los productos de un laboratorio.',
  BAJO_RECETA: 'Los productos bajo receta de la sala.',
  MANUAL: 'Sólo los productos que elijas.',
};

export default function NuevoConteo() {
  const { user, getScope, hasPermission } = useAuth();
  const branches = useStaffStore((s) => s.branches);
  const crearConteoInventario = useStaffStore((s) => s.crearConteoInventario);
  const previewMuestraCiclica = useStaffStore((s) => s.previewMuestraCiclica);
  const soloSuSala = getScope?.('conteo_inventario') !== 'ALL';

  const [sala, setSala] = useState(soloSuSala ? String(user?.branchId || '') : '');
  const [alcance, setAlcance] = useState('CICLICO');
  const [modo, setModo] = useState('LOTE');
  const [fuente, setFuente] = useState('HOJA');
  const [tamano, setTamano] = useState(String(TAMANO_CICLICO_DEFAULT));
  const [lab, setLab] = useState(null);
  const [labs, setLabs] = useState([]);
  const [textoLab, setTextoLab] = useState('');
  const [productos, setProductos] = useState([]);
  const [textoProd, setTextoProd] = useState('');
  const terminoProd = useTextoRebotado(textoProd).trim();
  const [resProd, setResProd] = useState([]);
  const [conInventario, setConInventario] = useState(null);
  const [vista, setVista] = useState(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    fetchBranchIdsConInventario().then(({ data }) => setConInventario(new Set((data || []).map((r) => String(r.branch_id)))));
  }, []);
  useEffect(() => {
    if (alcance !== 'LABORATORIO' || labs.length) return;
    fetchLaboratoriosBasic().then(({ data }) => setLabs(data || []));
  }, [alcance, labs.length]);
  useEffect(() => {
    if (alcance !== 'MANUAL' || terminoProd.length < 2) { setResProd([]); return; }
    let vivo = true;
    searchActiveProductsForConteo(terminoProd).then(({ data }) => { if (vivo) setResProd((data || []).filter((p) => !productos.some((x) => x.id === p.id))); });
    return () => { vivo = false; };
  }, [alcance, terminoProd, productos]);

  const tam = parseInt(tamano, 10);
  useEffect(() => {
    if (alcance !== 'CICLICO' || !sala || !Number.isInteger(tam) || tam < 1) { setVista(null); return; }
    let vivo = true;
    setCargandoVista(true);
    previewMuestraCiclica(parseInt(sala, 10), tam)
      .then((d) => { if (vivo) setVista(d); })
      .catch(() => { if (vivo) setVista(null); })
      .finally(() => { if (vivo) setCargandoVista(false); });
    return () => { vivo = false; };
  }, [alcance, sala, tam, previewMuestraCiclica]);

  const salas = useMemo(() => (branches || [])
    .filter((b) => !conInventario || conInventario.has(String(b.id)))
    .map((b) => ({ value: String(b.id), label: b.name })), [branches, conInventario]);
  const labsVisibles = useMemo(() => (textoLab.trim() ? labs.filter((l) => tokenMatch(textoLab, l.nombre)) : labs).slice(0, 12), [labs, textoLab]);
  const pedido = pedidoDeConteo({ scopeType: alcance, laboratorioId: lab?.id, tamano, productos });
  const falta = !sala ? 'Elige la sucursal.' : pedido.falta;

  const elegirSala = () => {
    if (soloSuSala) return;
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Sucursal', options: [...salas.map((s) => s.label), 'Cancelar'], cancelButtonIndex: salas.length },
      (i) => { if (i < salas.length) setSala(salas[i].value); },
    );
  };

  const crear = async () => {
    if (falta || creando) return;
    setCreando(true);
    try {
      const id = await crearConteoInventario({
        branchId: parseInt(sala, 10), scopeType: alcance, scopeFilter: pedido.scopeFilter, erpProductIds: pedido.erpProductIds, modo, fuenteSistema: fuente,
      });
      listo('Conteo iniciado', 'Se generó el snapshot de inventario.');
      router.replace({ pathname: '/conteo/[id]', params: { id: String(id) } });
    } catch (e) {
      fallo('No se pudo crear el conteo', mensajeAmigable(e));
    } finally {
      setCreando(false);
    }
  };

  if (!hasPermission('conteo_inventario', 'can_edit')) {
    return <View style={{ padding: 16 }}><Aviso tono="freno" texto="Tu cargo no puede crear conteos." /></View>;
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Nuevo conteo', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
          <Seccion titulo="Sucursal">
            <Pressable onPress={elegirSala} disabled={soloSuSala} style={({ pressed }) => ({ flexDirection: 'row', minHeight: 40, alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{salas.find((s) => s.value === sala)?.label ?? (branches || []).find((b) => String(b.id) === sala)?.name ?? 'Elegir'}</Text>
              {soloSuSala ? null : <Text style={{ color: colorSistema.acento, fontSize: 16 }}>Cambiar  ›</Text>}
            </Pressable>
          </Seccion>

          <Seccion titulo="Qué se cuenta" pie={AYUDA[alcance]}>
            <Opciones opciones={ALCANCES_DE_CONTEO.map((o) => ({ id: o.value, label: o.label }))} valor={alcance} onCambiar={setAlcance} />
          </Seccion>

          {alcance === 'CICLICO' ? (
            <Seccion titulo="Tamaño de la muestra">
              <Campo multiline={false} keyboardType="number-pad" value={tamano} onChangeText={setTamano} placeholder={String(TAMANO_CICLICO_DEFAULT)} />
              {cargandoVista ? <ActivityIndicator /> : vista?.muestra ? (
                <View style={{ gap: 4 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                    {SEGMENTO_DE_MUESTRA_ORDEN.filter((k) => vista.muestra[k] != null).map((k) => `${SEGMENTO_DE_MUESTRA_LABEL[k]}: ${vista.muestra[k]}`).join(' · ') || 'Sin productos para la muestra.'}
                  </Text>
                  {vista.cobertura ? (
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {`Universo de la sucursal: ${vista.cobertura.universo} productos · ${vista.cobertura.nunca_contados} nunca contados · ${vista.cobertura.mas_de_6_meses} sin contarse hace más de 6 meses.`}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Seccion>
          ) : null}

          {alcance === 'LABORATORIO' ? (
            <Seccion titulo="Laboratorio">
              {lab ? (
                <Pressable onPress={() => setLab(null)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{lab.nombre}</Text>
                  <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Cambiar</Text>
                </Pressable>
              ) : (
                <>
                  <Campo multiline={false} value={textoLab} onChangeText={setTextoLab} placeholder="Buscar laboratorio" />
                  {labsVisibles.map((l, i) => (
                    <Pressable key={l.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setLab(l); setTextoLab(''); }}
                      style={({ pressed }) => ({ paddingVertical: 9, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{l.nombre}</Text>
                    </Pressable>
                  ))}
                </>
              )}
            </Seccion>
          ) : null}

          {alcance === 'MANUAL' ? (
            <Seccion titulo={`Productos · ${productos.length}`}>
              {productos.map((p) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                  <Pressable onPress={() => setProductos((x) => x.filter((y) => y.id !== p.id))} hitSlop={8}>
                    <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                  </Pressable>
                </View>
              ))}
              <Campo multiline={false} value={textoProd} onChangeText={setTextoProd} placeholder="Buscar producto" autoCorrect={false} />
              {resProd.slice(0, 8).map((p, i) => (
                <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setProductos((x) => [...x, p]); setTextoProd(''); }}
                  style={({ pressed }) => ({ paddingVertical: 9, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                  {p.laboratorios?.nombre ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.laboratorios.nombre}</Text> : null}
                </Pressable>
              ))}
            </Seccion>
          ) : null}

          <Seccion titulo="Detalle de cada renglón">
            <Opciones opciones={MODOS_DE_CONTEO.map((o) => ({ id: o.value, label: o.label }))} valor={modo} onCambiar={setModo} />
          </Seccion>
          <Seccion titulo="Contra qué existencia" pie={fuente === 'HOJA' ? 'Lo contado se compara con la existencia de cuando se imprimió la hoja: una venta en el medio no aparece como diferencia.' : 'Lo contado se compara con la existencia del momento en que se teclea.'}>
            <Opciones opciones={FUENTES_DE_CONTEO.map((o) => ({ id: o.value, label: o.label }))} valor={fuente} onCambiar={setFuente} />
          </Seccion>

          {falta ? <Aviso texto={falta} /> : null}
          <BotonGrande texto={creando ? 'Creando…' : 'Crear el conteo'} onPress={crear} deshabilitado={!!falta || creando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
