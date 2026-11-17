// El QR de la computadora, abierto en la APP (2026-11-17).
//
// La computadora pinta `portal.farmasalud.lat/foto/<código>`. Con la app
// instalada, ese enlace abre esta pantalla (enlaces universales: `app.json` y
// `public/.well-known/`); sin ella, la página `/foto` del portal. Las dos hacen
// lo mismo y hablan con el MISMO núcleo (`capturaDesdeElTelefono`): comprobar
// el código, mandar la foto o el texto, y los mismos mensajes cuando algo falla.
//
// Lo que cambia es la herramienta: acá el papel se toma con el escáner del
// SISTEMA (el de Notas en el iPhone, el de Google en Android), que encuentra
// las esquinas mientras se apunta, endereza la hoja y trae su filtro. La web
// hace lo mismo con su editor, pero después de disparar.
//
// La captura dice QUÉ pide y CUÁNTAS caben:
//   · modo `qr`               → el lector, y viaja el texto del código.
//   · modo `dui` / `dos_caras` → frente y reverso, unidos en una imagen.
//   · modo `foto`, clase `documento` → el escáner; varias hojas = un PDF.
//   · modo `foto`, clase `retrato` / `libre` → la cámara, la foto tal cual.
//   · `varias: false` → una sola: la nueva reemplaza a la anterior.
//
// Sin sesión, como la web: la llave es el código (cinco minutos, un solo uso).
// `_layout.js` deja pasar `foto` sin mandar a `/entrar`.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { capturaVigente, mandarBase64, mandarTexto } from '@nucleo/data/capturaDesdeElTelefono';
import { pdfDeJpegs } from '@nucleo/utils/hojasEnPdf';
import { colorSistema } from '../../componentes/Formulario';
import { BotonGrande } from '../../componentes/formulario/Piezas';
import { FONDO_CONTROL, MARCA, tintaSobre } from '../../componentes/inicio/marca';
import { Presionable as Pressable } from '../../componentes/Tocable';
import IconoFijo from '../../componentes/IconoFijo';
import { iconoDe } from '../../tema/iconos';
import Escaner from '../../componentes/Escaner';
import UnirCaras from '../../componentes/UnirCaras';
import { escanearDocumento } from '../../componentes/escanearDocumento';

// El mismo tamaño que la web (`reducirParaMandar`): 1600 px del lado mayor al
// 85% deja un papel legible en ~400 kB y nunca se agranda una foto chica.
const LADO = 1600;
const TOPE_HOJAS = 20;
const VENCIDO = 'Este código ya se usó o venció. Pide uno nuevo en la computadora.';

async function reducir(uri) {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const { width = 0, height = 0 } = original;
  const ref = Math.max(width, height) > LADO
    ? await ImageManipulator.manipulate(uri).resize(width >= height ? { width: LADO } : { height: LADO }).renderAsync()
    : original;
  const hecha = await ref.saveAsync({ compress: 0.85, format: SaveFormat.JPEG, base64: true });
  return { uri: hecha.uri, base64: hecha.base64 };
}

const aBytes = (b64) => {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
};
// En tandas: `fromCharCode(...todo)` revienta la pila con varios megas.
const aBase64 = (u) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Cámara o galería del sistema, para lo que no es un papel (o sin escáner). */
async function delPicker(desdeCamara, cuantas = 1) {
  const permiso = desdeCamara ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) {
    Alert.alert('Sin permiso', desdeCamara ? 'La app necesita la cámara para tomar la foto.' : 'La app necesita tus fotos para elegir una.');
    return [];
  }
  const op = { mediaTypes: ['images'], quality: 0.9 };
  const r = desdeCamara ? await ImagePicker.launchCameraAsync(op)
    : await ImagePicker.launchImageLibraryAsync({ ...op, allowsMultipleSelection: cuantas > 1, selectionLimit: cuantas });
  if (r.canceled) return [];
  return (r.assets || []).map((a) => a.uri);
}

function Encabezado({ modo, para, documento }) {
  const rotulo = modo === 'qr' ? 'Código QR para la computadora' : modo === 'dui' ? 'DUI para la computadora'
    : modo === 'dos_caras' ? 'Dos caras para la computadora' : 'Foto para la computadora';
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>{rotulo}</Text>
      {para ? <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>{para}</Text> : null}
      {modo === 'dos_caras' && documento ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
          {documento.charAt(0).toUpperCase() + documento.slice(1)}
        </Text>
      ) : null}
    </View>
  );
}

function BotonIcono({ texto, icono, onPress, principal }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, minHeight: 52, borderRadius: 16, paddingHorizontal: 10, flexDirection: 'row', gap: 8,
        alignItems: 'center', justifyContent: 'center', backgroundColor: principal ? MARCA.azul : FONDO_CONTROL,
        opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <IconoFijo name={iconoDe(icono)} size={20} color={principal ? tintaSobre(MARCA.azul) : MARCA.azulClaro} />
      <Text numberOfLines={1} style={{ color: principal ? tintaSobre(MARCA.azul) : colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Pequeno({ texto, onPress, deshabilitado, peligro }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} accessibilityRole="button" accessibilityLabel={texto} hitSlop={6}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: FONDO_CONTROL, opacity: deshabilitado ? 0.3 : pressed ? 0.7 : 1 })}>
      <Text style={{ color: peligro ? MARCA.rojo : colorSistema.texto, fontSize: 17, fontWeight: '800' }}>
        {texto === 'Subir' ? '↑' : texto === 'Bajar' ? '↓' : '✕'}
      </Text>
    </Pressable>
  );
}

export default function FotoParaLaComputadora() {
  const { secreto } = useLocalSearchParams();
  const [estado, setEstado] = useState('comprobando');   // comprobando · listo · mandando · hecho · error
  const [motivo, setMotivo] = useState('');
  const [captura, setCaptura] = useState(null);           // { para, modo, documento, clase, forma, varias }
  const [hojas, setHojas] = useState([]);                 // [{ uri, base64 }]
  const [caras, setCaras] = useState({ frente: null, reverso: null });
  const [uniendo, setUniendo] = useState(null);           // { frente, reverso } en base64 mientras se unen
  const [leyendo, setLeyendo] = useState(false);
  const [preparando, setPreparando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await capturaVigente(String(secreto || ''));
      if (!vivo) return;
      if (!r?.ok) { setEstado('error'); setMotivo(VENCIDO); return; }
      setCaptura(r);
      setEstado('listo');
    })();
    return () => { vivo = false; };
  }, [secreto]);

  const modo = captura?.modo || 'foto';
  const esPapel = (captura?.clase || 'documento') === 'documento';
  const varias = captura?.varias !== false;
  const dosCaras = modo === 'dui' || modo === 'dos_caras';

  const fallo = (m) => { setEstado('error'); setMotivo(m); };
  const resultado = (r) => {
    if (r.ok) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); setEstado('hecho'); }
    else fallo(r.motivo);
  };

  /** Reduce lo que se tomó y lo suma (o lo reemplaza, si cabe una sola). */
  const sumar = async (uris) => {
    if (!uris.length) return;
    setPreparando(true);
    try {
      const listas = [];
      for (const u of uris) listas.push(await reducir(u));
      Haptics.selectionAsync().catch(() => {});
      setHojas((prev) => (varias ? [...prev, ...listas].slice(0, TOPE_HOJAS) : listas.slice(0, 1)));
    } catch {
      Alert.alert('No se pudo abrir la foto', 'Intenta tomarla de nuevo.');
    } finally {
      setPreparando(false);
    }
  };

  const tomar = async () => {
    if (esPapel) {
      const cuantas = varias ? Math.max(1, TOPE_HOJAS - hojas.length) : 1;
      const r = await escanearDocumento({ maxHojas: cuantas });
      if (r.disponible) {
        if (r.sobraron > 0) Alert.alert(varias ? 'Demasiadas hojas' : 'Aquí va una sola', varias
          ? `Se tomaron las primeras ${r.fotos.length}.` : 'Se usó la primera hoja que escaneaste.');
        return sumar(r.fotos.map((f) => f.uri));
      }
    }
    return sumar(await delPicker(true));
  };
  const deGaleria = async () => sumar(await delPicker(false, varias ? Math.max(1, TOPE_HOJAS - hojas.length) : 1));

  const tomarCara = async (cara, desdeGaleria = false) => {
    let uris = [];
    if (!desdeGaleria) {
      const r = await escanearDocumento({ maxHojas: 1 });
      if (r.disponible) uris = r.foto ? [r.foto.uri] : [];
      else uris = await delPicker(true);
    } else {
      uris = await delPicker(false);
    }
    if (!uris.length) return;
    setPreparando(true);
    try {
      const lista = await reducir(uris[0]);
      Haptics.selectionAsync().catch(() => {});
      setCaras((prev) => ({ ...prev, [cara]: lista }));
    } catch {
      Alert.alert('No se pudo abrir la foto', 'Intenta tomarla de nuevo.');
    } finally {
      setPreparando(false);
    }
  };

  const mover = (i, paso) => setHojas((prev) => {
    const j = i + paso;
    if (j < 0 || j >= prev.length) return prev;
    const copia = [...prev];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    return copia;
  });

  const enviar = async () => {
    if (!hojas.length) return;
    setEstado('mandando');
    try {
      if (hojas.length === 1) return resultado(await mandarBase64(String(secreto), hojas[0].base64, 'image/jpeg'));
      const pdf = pdfDeJpegs(hojas.map((h) => aBytes(h.base64)));
      return resultado(await mandarBase64(String(secreto), aBase64(pdf), 'application/pdf'));
    } catch (e) {
      // Las hojas se quedan: reintentar es volver a mandar, no volver a tomar.
      fallo(e?.message || 'No se pudieron unir las fotos. Quita alguna e intenta de nuevo.');
    }
  };

  const enviarCaras = () => {
    if (!caras.frente || !caras.reverso) return;
    setEstado('mandando');
    setUniendo({ frente: caras.frente.base64, reverso: caras.reverso.base64 });
  };

  const leido = async (texto) => {
    setLeyendo(false);
    setEstado('mandando');
    resultado(await mandarTexto(String(secreto), texto));
  };

  const cerrar = () => router.replace('/');
  const sePuedeReintentar = !/venció|usó/.test(motivo);

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20 }}>
        {captura ? <Encabezado modo={modo} para={captura.para} documento={captura.documento} /> : null}

        {estado === 'comprobando' ? (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <ActivityIndicator />
            <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>Comprobando el código…</Text>
          </View>
        ) : null}

        {estado === 'listo' && modo === 'qr' ? (
          <View style={{ gap: 12 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>
              Apunta la cámara al código QR. Lo que lea aparece solo en la computadora.
            </Text>
            <BotonIcono texto="Escanear el código" icono="ScanLine" principal onPress={() => setLeyendo(true)} />
          </View>
        ) : null}

        {estado === 'listo' && dosCaras ? (
          <View style={{ gap: 12 }}>
            {[{ cara: 'frente', rotulo: 'Frente', ayuda: modo === 'dui' ? 'El lado de la foto y el número' : 'El lado principal' },
              { cara: 'reverso', rotulo: 'Reverso', ayuda: modo === 'dui' ? 'El lado de la dirección' : 'El otro lado' }].map(({ cara, rotulo, ayuda }) => (
              <View key={cara} style={{ borderRadius: 16, padding: 12, gap: 10, backgroundColor: colorSistema.fila }}>
                <Pressable onPress={() => tomarCara(cara)} accessibilityRole="button"
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, opacity: pressed ? 0.8 : 1 })}>
                  {caras[cara] ? (
                    <Image source={{ uri: caras[cara].uri }} style={{ width: 80, height: 50, borderRadius: 8 }} />
                  ) : (
                    <View style={{ width: 80, height: 50, borderRadius: 8, backgroundColor: FONDO_CONTROL, alignItems: 'center', justifyContent: 'center' }}>
                      <IconoFijo name={iconoDe('Escaner')} size={20} color={colorSistema.texto2} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{rotulo}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{caras[cara] ? 'Toca para tomarla de nuevo' : ayuda}</Text>
                  </View>
                  {caras[cara] ? <IconoFijo name={iconoDe('CheckCircle2')} size={20} color={MARCA.verde} /> : null}
                </Pressable>
                <Pressable onPress={() => tomarCara(cara, true)} accessibilityRole="button" hitSlop={6}
                  style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}>
                  <IconoFijo name={iconoDe('Galeria')} size={16} color={MARCA.azulClaro} />
                  <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{rotulo} de la galería</Text>
                </Pressable>
              </View>
            ))}
            <BotonGrande texto={caras.frente && caras.reverso ? 'Mandar las dos caras' : 'Toma las dos caras'}
              deshabilitado={!caras.frente || !caras.reverso || preparando} onPress={enviarCaras} />
          </View>
        ) : null}

        {estado === 'listo' && modo === 'foto' ? (
          <View style={{ gap: 12 }}>
            {hojas.length ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {hojas.length === 1 ? '1 foto lista' : `${hojas.length} fotos · en este orden`}
                </Text>
                {hojas.length === 1 && !varias ? (
                  <Image source={{ uri: hojas[0].uri }} resizeMode="contain"
                    style={{ width: '100%', height: 260, borderRadius: 14, backgroundColor: FONDO_CONTROL }} />
                ) : hojas.map((h, i) => (
                  <View key={h.uri} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 14, backgroundColor: colorSistema.fila }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '800', width: 22, textAlign: 'center' }}>{i + 1}</Text>
                    <Image source={{ uri: h.uri }} style={{ width: 44, height: 56, borderRadius: 8 }} />
                    <View style={{ flex: 1 }} />
                    <Pequeno texto="Subir" deshabilitado={i === 0} onPress={() => mover(i, -1)} />
                    <Pequeno texto="Bajar" deshabilitado={i === hojas.length - 1} onPress={() => mover(i, 1)} />
                    <Pequeno texto="Quitar" peligro onPress={() => setHojas((prev) => prev.filter((_, j) => j !== i))} />
                  </View>
                ))}
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <BotonIcono principal={!hojas.length} icono={esPapel ? 'Escaner' : 'Camara'} onPress={tomar}
                texto={!hojas.length ? (esPapel ? 'Escanear' : 'Tomar la foto') : varias ? 'Agregar otra' : 'Tomar otra'} />
              <BotonIcono texto="Galería" icono="Galeria" onPress={deGaleria} />
            </View>
            {preparando ? <ActivityIndicator /> : null}
            {hojas.length ? (
              <BotonGrande texto={hojas.length === 1 ? 'Mandar la foto' : `Mandar las ${hojas.length} fotos`}
                deshabilitado={preparando} onPress={enviar} />
            ) : null}
            <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>
              {!hojas.length
                ? (esPapel
                  ? (varias ? 'El escáner encuentra las esquinas y endereza la hoja. Si son varias, se mandan todas juntas.'
                    : 'El escáner encuentra las esquinas y endereza la hoja.')
                  : 'Aparece sola en la computadora.')
                : hojas.length === 1
                  ? (varias ? 'Puedes agregar más o mandar esta ya. Aparece sola en la computadora.' : 'Mándala o toma otra. Aparece sola en la computadora.')
                  : 'Se mandan juntas. Acomódalas con las flechas antes de mandar.'}
            </Text>
          </View>
        ) : null}

        {estado === 'mandando' ? (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <ActivityIndicator />
            <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>
              {modo === 'qr' ? 'Mandando el código…' : dosCaras ? 'Mandando las dos caras…'
                : hojas.length > 1 ? `Mandando las ${hojas.length} fotos…` : 'Mandando la foto…'}
            </Text>
          </View>
        ) : null}

        {estado === 'hecho' ? (
          <View style={{ alignItems: 'center', gap: 8 }}>
            <IconoFijo name={iconoDe('CheckCircle2')} size={44} color={MARCA.verde} />
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Lista</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center' }}>Ya está en la computadora.</Text>
            <View style={{ alignSelf: 'stretch', marginTop: 12 }}><BotonGrande texto="Cerrar" onPress={cerrar} /></View>
          </View>
        ) : null}

        {estado === 'error' ? (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <IconoFijo name={iconoDe('AlertTriangle')} size={40} color={MARCA.rojo} />
            <Text style={{ color: MARCA.rojo, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{motivo}</Text>
            <View style={{ alignSelf: 'stretch', marginTop: 8, gap: 10 }}>
              {sePuedeReintentar && captura ? <BotonGrande texto="Intentar de nuevo" onPress={() => setEstado('listo')} /> : null}
              <BotonGrande texto="Cerrar" borde onPress={cerrar} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Escaner visible={leyendo} titulo="Escanear el código QR" onCodigo={leido} onCerrar={() => setLeyendo(false)} />

      {uniendo ? (
        <UnirCaras caras={uniendo}
          onListo={async (b64) => { setUniendo(null); resultado(await mandarBase64(String(secreto), b64, 'image/jpeg')); }}
          onError={(m) => { setUniendo(null); fallo(m); }} />
      ) : null}
    </>
  );
}
