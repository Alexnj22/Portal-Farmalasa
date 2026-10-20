// El reglamento y el aviso de privacidad, pintados con texto NATIVO
// (2026-10-14). Lo usa Android en app/legal.js.
//
// Por qué no la vista web: en Android abrir cualquiera de los dos cerraba la
// app. La página es HTML liviano (encabezado, cláusulas numeradas y una tabla),
// pero la WebView vivía dentro de una pantalla del stack nativo que entra con
// la animación del sistema (`slide_from_right`, app/_layout.js): una WebView de
// Android dentro de un fragmento que se anima es el cierre nativo conocido de
// react-native-webview + react-native-screens (SIGSEGV en el hilo de render, sin
// error de JavaScript — por eso `app_errores` no tiene nada). En vez de pelear
// con la capa de dibujo, se baja la MISMA página publicada —sigue siendo la
// única fuente de verdad, la que se archiva como prueba del consentimiento— y
// se pinta con <Text>: sin WebView no hay nada nativo que se pueda caer, y se
// lee con la tipografía y el tamaño de letra del teléfono.
//
// El lector entiende lo que esas dos páginas usan: h1/h2/h3, párrafos, listas
// numeradas, una tabla de dos columnas y negritas/cursivas. Lo demás (estilos,
// el logo embebido, scripts) se descarta.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Vacio } from './ui';
import { colorSistema } from './sistema';
import { useTema } from '../tema/tema';

const cache = new Map();

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…' };
const decodificar = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return ENTIDADES[e.toLowerCase()] ?? m;
});

/** HTML → bloques: `{ tipo: 'h1'|'h2'|'h3'|'p'|'li'|'fila', partes, num?, celdas?, clase? }`. */
export function leerDocumento(html) {
  let cuerpo = String(html);
  const ini = cuerpo.search(/<body[^>]*>/i);
  if (ini >= 0) cuerpo = cuerpo.slice(ini);
  cuerpo = cuerpo.replace(/<(style|script|svg|head)[\s\S]*?<\/\1>/gi, '').replace(/<img[^>]*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const bloques = [];
  const listas = []; // contadores de <ol>/<ul> abiertos
  let actual = null;
  let fila = null;
  let celda = null;
  let negrita = 0;
  let cursiva = 0;
  const cerrar = () => { if (actual && actual.partes.some((p) => p.texto.trim())) bloques.push(actual); actual = null; };
  const abrir = (tipo, extra = {}) => { cerrar(); actual = { tipo, partes: [], ...extra }; };
  const agregar = (texto) => {
    const destino = celda ?? actual;
    if (!destino) { if (!texto.trim()) return; abrir('p'); return agregar(texto); }
    destino.partes.push({ texto, negrita: negrita > 0, cursiva: cursiva > 0 });
    return undefined;
  };
  const re = /<\/?([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(cuerpo))) {
    if (m[3] != null) { agregar(decodificar(m[3]).replace(/\s+/g, ' ')); continue; }
    const etiqueta = m[1].toLowerCase();
    const cierra = m[0][1] === '/';
    const clase = (m[2].match(/class="([^"]*)"/i) || [])[1] || '';
    if (['h1', 'h2', 'h3', 'p'].includes(etiqueta)) { if (cierra) cerrar(); else abrir(etiqueta, { clase }); continue; }
    if (etiqueta === 'ol' || etiqueta === 'ul') { cerrar(); if (cierra) listas.pop(); else listas.push({ n: 0, ordenada: etiqueta === 'ol' }); continue; }
    if (etiqueta === 'li') {
      if (cierra) { cerrar(); continue; }
      const l = listas[listas.length - 1];
      if (l) l.n += 1;
      abrir('li', { num: l?.ordenada ? `${l.n}.` : '•' });
      continue;
    }
    if (etiqueta === 'tr') {
      if (cierra) { if (fila && fila.celdas.length) bloques.push(fila); fila = null; celda = null; } else { cerrar(); fila = { tipo: 'fila', celdas: [], partes: [] }; }
      continue;
    }
    if (etiqueta === 'td' || etiqueta === 'th') {
      if (cierra) { celda = null; continue; }
      if (fila) { celda = { partes: [], encabezado: etiqueta === 'th' }; fila.celdas.push(celda); }
      continue;
    }
    if (etiqueta === 'strong' || etiqueta === 'b') { negrita += cierra ? -1 : 1; continue; }
    if (etiqueta === 'em' || etiqueta === 'i') { cursiva += cierra ? -1 : 1; continue; }
    if (etiqueta === 'br') { agregar('\n'); continue; }
    if (['div', 'section', 'table', 'thead', 'tbody'].includes(etiqueta)) cerrar();
  }
  cerrar();
  // Limpieza: espacios al borde de cada bloque y alrededor de los saltos.
  const limpiar = (partes) => {
    // Las partes seguidas con el mismo estilo se juntan (así «1» + « Objeto»
    // es «1 Objeto», y un salto no deja el espacio de la línea siguiente).
    const juntas = [];
    for (const p of partes) {
      const u = juntas[juntas.length - 1];
      if (u && u.negrita === p.negrita && u.cursiva === p.cursiva) u.texto += p.texto; else juntas.push({ ...p });
    }
    const out = juntas.map((p) => ({ ...p, texto: p.texto.replace(/ *\n */g, '\n') }));
    for (let i = 1; i < out.length; i++) if (out[i - 1].texto.endsWith('\n')) out[i].texto = out[i].texto.replace(/^ +/, '');
    if (out.length) { out[0].texto = out[0].texto.replace(/^\s+/, ''); out[out.length - 1].texto = out[out.length - 1].texto.replace(/\s+$/, ''); }
    return out.filter((p) => p.texto);
  };
  return bloques.map((b) => (b.tipo === 'fila'
    ? { ...b, celdas: b.celdas.map((c) => ({ ...c, partes: limpiar(c.partes) })) }
    : { ...b, partes: limpiar(b.partes) }));
}

function Partes({ partes, estilo }) {
  return (
    <Text style={estilo} selectable>
      {partes.map((p, i) => (
        <Text key={i} style={{ fontWeight: p.negrita ? '700' : undefined, fontStyle: p.cursiva ? 'italic' : undefined }}>{p.texto}</Text>
      ))}
    </Text>
  );
}

// `alFinal` (opcional, 2026-10-14): se llama UNA vez cuando la persona llegó al
// final del texto — o enseguida, si el documento entero cabe sin desplazar. Lo
// usa la página «Reglas y privacidad» del primer inicio (app/guia.js), que
// además lo pinta `incrustado`: dentro de otra pantalla que se desplaza, con
// menos relleno y sin el margen del borde inferior del teléfono.
//
// `alAvanzar` y `pie` (opcionales, 2026-10-20, «no se entiende […] que debe leer
// todo»): `alAvanzar(fraccion)` cuenta cuánto se bajó (0 a 1) para que la guía
// pinte una barra de lectura, y `pie` va DEBAJO de la última línea — ahí la guía
// pone «Siguiente: Aviso de privacidad», justo donde la persona termina. No
// cambian qué cuenta como «leído»: eso sigue siendo `alFinal`.
export default function DocumentoLegal({ url, alFinal, alAvanzar, pie, incrustado = false }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const [bloques, setBloques] = useState(() => cache.get(url) ?? null);
  const [error, setError] = useState(false);
  const cargar = useCallback(async () => {
    setError(false);
    try {
      const r = await fetch(url, { headers: { Accept: 'text/html' } });
      if (!r.ok) throw new Error(String(r.status));
      const b = leerDocumento(await r.text());
      if (!b.length) throw new Error('vacío');
      cache.set(url, b);
      setBloques(b);
    } catch {
      if (!cache.get(url)) setError(true);
    }
  }, [url]);
  useEffect(() => { cargar(); }, [cargar]);
  const avisado = useRef(false);
  const alto = useRef({ vista: 0, contenido: 0, pie: 0 });
  const revisarFinal = (y = 0) => {
    // El `pie` no es texto del documento: no se le exige a nadie bajar hasta él.
    const { vista, pie: altoPie } = alto.current;
    const contenido = alto.current.contenido - altoPie;
    if (!vista || contenido <= 0) return; // todavía sin medir
    if (alAvanzar) alAvanzar(contenido <= vista ? 1 : Math.min(1, Math.max(0, y / (contenido - vista))));
    if (!alFinal || avisado.current) return;
    if (y + vista >= contenido - 24) { avisado.current = true; alFinal(); }
  };
  useEffect(() => { avisado.current = false; }, [url]);

  if (error) return <Vacio titulo="No se pudo abrir" accion="Reintentar" alAccion={cargar}>Revisa tu conexión y vuelve a intentar.</Vacio>;
  if (!bloques) return <ActivityIndicator style={{ marginTop: 40 }} color={t.color.magenta} />;
  return (
    <ScrollView nestedScrollEnabled={incrustado} scrollEventThrottle={64}
      onLayout={(e) => { alto.current.vista = e.nativeEvent.layout.height; revisarFinal(); }}
      onContentSizeChange={(_w, h) => { alto.current.contenido = h; revisarFinal(); }}
      onScroll={alFinal || alAvanzar ? (e) => revisarFinal(e.nativeEvent.contentOffset.y) : undefined}
      contentContainerStyle={{ padding: incrustado ? 16 : 20, paddingBottom: incrustado ? 24 : 32 + ins.bottom, gap: 12, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
      {bloques.map((b, i) => {
        if (b.tipo === 'h1') return <Partes key={i} partes={b.partes} estilo={{ fontSize: 26, lineHeight: 32, fontWeight: '800', color: colorSistema.texto }} />;
        if (b.tipo === 'h2' || b.tipo === 'h3') {
          // «1 Objeto» (el número va en su propia caja en la página) → «1. Objeto».
          const partes = b.partes.map((p, j) => (j === 0 ? { ...p, texto: p.texto.replace(/^(\d+)\s+/, '$1. ') } : p));
          return <Partes key={i} partes={partes} estilo={{ marginTop: 14, fontSize: b.tipo === 'h2' ? 20 : 17, lineHeight: 26, fontWeight: '700', color: t.color.magentaTexto }} />;
        }
        if (b.tipo === 'li') {
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
              <Text style={{ minWidth: 22, fontSize: 16, lineHeight: 24, fontWeight: '700', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{b.num}</Text>
              <Partes partes={b.partes} estilo={{ flex: 1, fontSize: 16, lineHeight: 24, color: colorSistema.texto }} />
            </View>
          );
        }
        if (b.tipo === 'fila') {
          const encabezado = b.celdas.every((c) => c.encabezado);
          if (encabezado) return null; // «De quién / Qué se guarda»: cada fila ya lo dice sola.
          return (
            <View key={i} style={{ gap: 4, padding: 14, borderRadius: 12, backgroundColor: colorSistema.superficie, borderWidth: 1, borderColor: colorSistema.contornoSuave }}>
              {b.celdas.map((c, j) => (
                <Partes key={j} partes={c.partes} estilo={j === 0
                  ? { fontSize: 16, lineHeight: 22, fontWeight: '700', color: colorSistema.texto }
                  : { fontSize: 15, lineHeight: 22, color: colorSistema.texto2 }} />
              ))}
            </View>
          );
        }
        const chico = ['vigencia', 'patrono', 'fiscal'].some((c) => b.clase?.includes(c));
        return <Partes key={i} partes={b.partes} estilo={chico
          ? { fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }
          : { fontSize: 16, lineHeight: 24, color: colorSistema.texto }} />;
      })}
      {pie ? <View onLayout={(e) => { alto.current.pie = e.nativeEvent.layout.height + 12; revisarFinal(); }}>{pie}</View> : null}
    </ScrollView>
  );
}
