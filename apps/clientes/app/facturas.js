// Mis facturas (2026-10-07): las facturas de consumidor final y los créditos
// fiscales del último año, con su documento electrónico: el PDF (se abre dentro
// de la app, con compartir), el JSON (para la contabilidad) y la consulta
// pública de Hacienda. Si un documento todavía no estaba guardado, se pide.
import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as FS from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Cargando, Pantalla, Tarjeta, Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';
import { useSesion } from '../lib/sesion';
import { dolares, fecha } from '../lib/formato';
import { suave, useTema } from '../tema/tema';

const TIPO = {
  consumidor_final: { texto: 'Consumidor final', sf: 'doc.text.fill' },
  credito_fiscal: { texto: 'Crédito fiscal', sf: 'building.2.fill' },
  nota_credito: { texto: 'Nota de crédito', sf: 'arrow.uturn.backward.circle.fill' },
};

export default function Facturas() {
  const pedir = useSesion((s) => s.pedir);
  const [d, setD] = useState(null);
  const [filtro, setFiltro] = useState('todas');
  const [refrescando, setRefrescando] = useState(false);
  const [ocupada, setOcupada] = useState(null);
  const cargar = useCallback(async () => { const r = await pedir('mis_facturas'); setD((ant) => (r?.ok || !ant?.ok ? r : ant)); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  const abrir = async (f, formato) => {
    Haptics.selectionAsync().catch(() => {});
    setOcupada(`${f.id}${formato}`);
    try {
      let url = formato === 'pdf' ? f.pdf : f.json;
      if (!url) {
        const r = await pedir('factura_documento', { id: f.id, formato });
        if (!r?.ok) { Alert.alert('No disponible', r?.mensaje ?? 'Intenta más tarde.'); return; }
        url = r.url;
      }
      if (formato === 'pdf') { await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }); return; }
      const destino = `${FS.cacheDirectory}${f.codigo}.json`;
      const archivo = await FS.downloadAsync(url, destino);
      await Share.share({ url: archivo.uri, title: `Factura ${f.correlativo ?? f.codigo}` });
    } catch { Alert.alert('No se pudo abrir', 'Revisa tu conexión e intenta de nuevo.'); } finally { setOcupada(null); }
  };

  if (!d) return <Cargando />;
  if (!d.ok) return <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}><Vacio titulo="No se pudieron cargar">{d.mensaje ?? 'Revisa tu conexión.'}</Vacio></Pantalla>;
  const lista = d.facturas.filter((f) => filtro === 'todas' || f.tipo === filtro);
  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {[['todas', 'Todas'], ['consumidor_final', 'Consumidor final'], ['credito_fiscal', 'Crédito fiscal']].map(([k, t]) => (
          <Chip key={k} texto={t} activo={filtro === k} alTocar={() => setFiltro(k)} />
        ))}
      </View>
      {!lista.length ? <Vacio titulo="Sin facturas">Aquí aparecen las facturas de tus compras del último año.</Vacio> : null}
      {lista.map((f) => <Factura key={f.id} f={f} ocupada={ocupada} alAbrir={abrir} />)}
    </Pantalla>
  );
}

function Chip({ texto, activo, alTocar }) {
  const t = useTema();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} accessibilityRole="button" accessibilityState={{ selected: activo }}
      style={{ minHeight: 34, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center',
        backgroundColor: activo ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)') }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: activo ? '#FFFFFF' : colorSistema.texto }}>{texto}</Text>
    </Pressable>
  );
}

function Factura({ f, ocupada, alAbrir }) {
  const t = useTema();
  const tipo = TIPO[f.tipo] ?? TIPO.consumidor_final;
  return (
    <Tarjeta estilo={{ gap: 12, opacity: f.anulada ? 0.6 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
          backgroundColor: suave(f.tipo === 'credito_fiscal' ? t.color.magenta : t.color.verde, t.oscuro ? 0.26 : 0.15) }}>
          <Icono sf={tipo.sf} respaldo="" tam={18} color={f.tipo === 'credito_fiscal' ? t.color.magentaTexto : t.color.verdeTexto} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>{tipo.texto}{f.anulada ? ' · anulada' : ''}</Text>
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{fecha(f.fecha)} · {f.sala}</Text>
        </View>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(f.total)}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Accion sf="doc.richtext.fill" texto="PDF" cargando={ocupada === `${f.id}pdf`} alTocar={() => alAbrir(f, 'pdf')} />
        <Accion sf="curlybraces" texto="JSON" cargando={ocupada === `${f.id}json`} alTocar={() => alAbrir(f, 'json')} />
        <Accion sf="checkmark.shield.fill" texto="Hacienda" alTocar={() => WebBrowser.openBrowserAsync(f.hacienda).catch(() => {})} />
      </View>
    </Tarjeta>
  );
}

function Accion({ sf, texto, alTocar, cargando }) {
  const t = useTema();
  return (
    <Pressable onPress={alTocar} disabled={cargando} accessibilityRole="button" accessibilityLabel={texto}
      style={({ pressed }) => ({ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 12,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', opacity: cargando ? 0.5 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Icono sf={sf} respaldo="" tam={14} color={colorSistema.texto} />
      <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto }}>{cargando ? '…' : texto}</Text>
    </Pressable>
  );
}
