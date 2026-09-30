// El escáner de la app: la cámara a pantalla completa con un marco al centro,
// la linterna y una vibración al leer. Lee QR y los códigos de barras de
// siempre (Code 128, EAN, UPC). Se usa para recibir cajas de traslado y para
// buscar productos; quien lo abre decide qué hacer con el código.
//
// Lo que ya se leyó no se vuelve a entregar durante un rato: la cámara ve el
// mismo código treinta veces por segundo, y sin ese freno una caja se
// «recibiría» treinta veces.
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Vidrio from './Vidrio';
import { iconoDe } from '../tema/iconos';

const TIPOS = ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'datamatrix'];
const ESPERA_MISMO_CODIGO = 2500;

function BotonRedondo({ icono, onPress, activo, etiqueta }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={8}>
      <Vidrio radio={28} interactivo tinte={activo ? 'rgba(255,214,10,0.45)' : undefined}>
        <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
          <Host matchContents><Icon name={iconoDe(icono)} size={24} color="#FFFFFF" /></Host>
        </View>
      </Vidrio>
    </Pressable>
  );
}

/**
 * @param visible
 * @param titulo     lo que se está escaneando («Recibir caja»)
 * @param ayuda      una línea bajo el título
 * @param onCodigo   (codigo) => void | Promise — si devuelve `false`, el
 *                   escáner sigue abierto (el código no era el buscado)
 * @param onCerrar
 * @param pie        lo que va abajo (p. ej. «3 de 5 cajas»)
 */
export default function Escaner({ visible, titulo, ayuda, onCodigo, onCerrar, pie }) {
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [linterna, setLinterna] = useState(false);
  const ultimo = useRef({ codigo: null, en: 0 });
  const ocupado = useRef(false);
  const margen = useSafeAreaInsets();

  useEffect(() => { if (visible && permiso && !permiso.granted && permiso.canAskAgain) pedirPermiso(); }, [visible, permiso, pedirPermiso]);
  useEffect(() => { if (!visible) setLinterna(false); }, [visible]);

  const leido = async ({ data }) => {
    const ahora = Date.now();
    if (!data || ocupado.current) return;
    if (ultimo.current.codigo === data && ahora - ultimo.current.en < ESPERA_MISMO_CODIGO) return;
    ultimo.current = { codigo: data, en: ahora };
    ocupado.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    try { await onCodigo?.(String(data).trim()); } finally { ocupado.current = false; }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCerrar}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {permiso?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={linterna}
            barcodeScannerSettings={{ barcodeTypes: TIPOS }} onBarcodeScanned={leido} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>La app necesita la cámara para escanear</Text>
            {permiso && !permiso.canAskAgain ? (
              <Pressable onPress={() => Linking.openSettings()}>
                <Text style={{ color: '#0A84FF', fontSize: 17 }}>Abrir Ajustes</Text>
              </Pressable>
            ) : (
              <Pressable onPress={pedirPermiso}><Text style={{ color: '#0A84FF', fontSize: 17 }}>Permitir la cámara</Text></Pressable>
            )}
          </View>
        )}

        {/* El marco: cuatro esquinas, donde va el código. */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={{ width: 260, height: 180 }}>
            {[['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']].map(([v, h]) => (
              <View key={v + h} style={{ position: 'absolute', [v]: 0, [h]: 0, width: 36, height: 36, borderColor: '#FFFFFF',
                [`border${v === 'top' ? 'Top' : 'Bottom'}Width`]: 4, [`border${h === 'left' ? 'Left' : 'Right'}Width`]: 4,
                [`border${v === 'top' ? 'Top' : 'Bottom'}${h === 'left' ? 'Left' : 'Right'}Radius`]: 14 }} />
            ))}
          </View>
        </View>

        <View style={{ position: 'absolute', top: margen.top + 12, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Vidrio radio={20}>
              <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{titulo}</Text>
                {ayuda ? <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 }}>{ayuda}</Text> : null}
              </View>
            </Vidrio>
          </View>
          <BotonRedondo icono="X" etiqueta="Cerrar" onPress={onCerrar} />
        </View>

        <View style={{ position: 'absolute', bottom: margen.bottom + 24, left: 16, right: 16, alignItems: 'center', gap: 14 }}>
          {pie ? <Vidrio radio={18}><View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>{pie}</View></Vidrio> : null}
          <BotonRedondo icono={linterna ? 'Flashlight' : 'FlashlightOff'} activo={linterna} etiqueta="Linterna" onPress={() => setLinterna((v) => !v)} />
        </View>
      </View>
    </Modal>
  );
}
