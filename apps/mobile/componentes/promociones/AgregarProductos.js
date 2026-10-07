// Elegir VARIOS productos para una promoción, NATIVO — el `AgregarProductos`
// del portal: por nombre (la búsqueda es LITERAL y se ve entera, para desmarcar
// lo que no va) o por laboratorio (la campaña se negocia con uno). Por
// categoría no: `products` no la tiene. Usa `fetchProductosParaPromocion`, la
// misma consulta del portal.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fetchLaboratoriosConProductos, fetchProductosParaPromocion } from '@nucleo/data/promociones';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Opciones } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

export default function AgregarProductos({ yaElegidos = [], onAgregar, ocupado = false }) {
  const [modo, setModo] = useState('texto');
  const [texto, setTexto] = useState('');
  const q = useTextoRebotado(texto).trim();
  const [labs, setLabs] = useState([]);
  const [lab, setLab] = useState(null);
  const [lista, setLista] = useState(null);
  const [marcados, setMarcados] = useState(() => new Set());
  const [error, setError] = useState(null);
  const ya = useMemo(() => new Set(yaElegidos.map(Number)), [yaElegidos]);

  useEffect(() => { fetchLaboratoriosConProductos().then(setLabs).catch(() => setLabs([])); }, []);
  useEffect(() => {
    const buscar = modo === 'texto' ? (q.length >= 3 ? { texto: q } : null) : (lab ? { laboratorioId: lab.id } : null);
    if (!buscar) { setLista(null); return undefined; }
    let vivo = true;
    setLista(undefined);
    fetchProductosParaPromocion(buscar)
      .then((r) => {
        if (!vivo) return;
        const productos = r?.productos ?? [];
        setLista(productos);
        setError(null);
        // Por laboratorio se marca todo lo nuevo: el camino corto es quitar lo que no va.
        setMarcados(new Set(modo === 'laboratorio' ? productos.filter((p) => !ya.has(Number(p.id))).map((p) => Number(p.id)) : []));
      })
      .catch((e) => { if (vivo) { setLista([]); setError(mensajeAmigable(e, 'No se pudo buscar.')); } });
    return () => { vivo = false; };
  }, [modo, q, lab, ya]);

  const alternar = (id) => {
    Haptics.selectionAsync().catch(() => {});
    setMarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const elegirLab = () => {
    const opciones = [...labs.map((l) => (l.productos ? `${l.nombre} · ${l.productos}` : l.nombre)), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Laboratorio', options: opciones, cancelButtonIndex: opciones.length - 1 },
      (i) => { if (i < labs.length) setLab(labs[i]); });
  };
  const agregar = () => {
    const prods = (lista || []).filter((p) => marcados.has(Number(p.id)));
    if (!prods.length) return;
    onAgregar(prods);
    setMarcados(new Set());
    setTexto('');
  };

  return (
    <View style={{ gap: 10 }}>
      <Opciones valor={modo} onCambiar={(m) => { setModo(m); setLista(null); }} opciones={[
        { id: 'texto', label: 'Por nombre', detalle: 'Escribe al menos 3 letras' },
        { id: 'laboratorio', label: 'Por laboratorio', detalle: 'Trae todos sus productos marcados' },
      ]} />
      {modo === 'texto' ? (
        <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Ej. leche, ensure, pedialyte" />
      ) : (
        <Pressable onPress={elegirLab} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{lab ? lab.nombre : 'Elegir laboratorio…'}</Text>
        </Pressable>
      )}
      {error ? <Aviso tono="freno" texto={error} /> : null}
      {lista === undefined ? <ActivityIndicator /> : null}
      {Array.isArray(lista) ? (
        lista.length ? (
          <View>
            {lista.map((p, i) => {
              const yaEsta = ya.has(Number(p.id));
              const on = yaEsta || marcados.has(Number(p.id));
              return (
                <Pressable key={p.id} disabled={yaEsta} onPress={() => alternar(Number(p.id))}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: yaEsta ? 0.5 : pressed ? 0.6 : 1 })}>
                  <Text style={{ fontSize: 18, color: on ? MARCA.azulClaro : colorSistema.texto2 }}>{on ? '☑︎' : '☐'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{p.nombre}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{yaEsta ? 'Ya está en la promoción' : (p.laboratorio_nombre || '')}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin productos con eso.</Text>
      ) : null}
      {marcados.size ? <BotonGrande texto={ocupado ? 'Agregando…' : `Agregar ${marcados.size} producto${marcados.size === 1 ? '' : 's'}`} onPress={agregar} deshabilitado={ocupado} /> : null}
    </View>
  );
}
