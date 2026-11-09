// Escanear un producto (2026-11-09): lee el código de barras y abre su ficha.
// Un código que no se reconoce NO quiere decir que no haya el producto (cambian
// de código con el tiempo): se ofrece buscarlo por nombre o preguntar.
import { useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Boton, Pantalla, Tarjeta } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { llamar } from '../lib/api';
import { navegar } from '../lib/navegar';

const TIPOS = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'];

export default function Escaner() {
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [estado, setEstado] = useState('leyendo'); // leyendo | buscando | sin_coincidencia | error
  const ocupado = useRef(false);

  const alLeer = async ({ data }) => {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado('buscando');
    Haptics.selectionAsync().catch(() => {});
    const r = await llamar('catalogo_por_codigo', { codigo: data }).catch(() => null);
    if (r?.ok && r.id) { router.replace(`/producto/${r.id}`); return; }
    setEstado(r?.ok ? 'sin_coincidencia' : 'error');
  };
  const otraVez = () => { ocupado.current = false; setEstado('leyendo'); };

  if (!permiso) return <Pantalla conPestanas={false}><ActivityIndicator /></Pantalla>;
  if (!permiso.granted) {
    return (
      <Pantalla conPestanas={false}>
        <Tarjeta estilo={{ gap: 12 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>Permite usar la cámara</Text>
          <Text style={{ fontSize: 15, color: colorSistema.texto2 }}>La usamos solo mientras escaneas el código de un producto.</Text>
          <Boton alTocar={pedirPermiso}>Permitir</Boton>
        </Tarjeta>
      </Pantalla>
    );
  }
  if (estado === 'sin_coincidencia' || estado === 'error') {
    const sinRed = estado === 'error';
    return (
      <Pantalla conPestanas={false}>
        <Tarjeta estilo={{ gap: 12 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{sinRed ? 'No se pudo buscar' : 'No reconocimos este código'}</Text>
          <Text style={{ fontSize: 15, color: colorSistema.texto2 }}>{sinRed ? 'Revisa tu conexión e intenta de nuevo.' : 'Puede que lo tengamos con otro código. Búscalo por nombre o pregúntanos.'}</Text>
          <Boton alTocar={otraVez}>Escanear otra vez</Boton>
          {sinRed ? null : <Boton tipo="secundario" alTocar={() => router.back()}>Buscar por nombre</Boton>}
          {sinRed ? null : <Boton tipo="secundario" alTocar={() => navegar('/chat')}>Preguntar a la farmacia</Boton>}
        </Tarjeta>
      </Pantalla>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: TIPOS }}
        onBarcodeScanned={estado === 'leyendo' ? alLeer : undefined} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <View style={{ width: '78%', height: 150, borderRadius: 18, borderWidth: 3, borderColor: '#FFFFFF' }} />
        {estado === 'buscando'
          ? <ActivityIndicator color="#FFFFFF" />
          : <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>Apunta al código de barras</Text>}
      </View>
    </View>
  );
}
