// «Qué hay de nuevo» en Android (2026-10-14): la hoja inferior de Material 3
// (ModalBottomSheet de Compose), la misma pieza y los mismos colores de
// superficie que las hojas de opciones de `HojasAndroid` / `HojaDeOpciones`:
// se arrastra para cerrar y el gesto de volver la cierra primero.
//
// La lista vive en lib/novedades.js. La monta la raíz (app/_layout.js).
import { useRef } from 'react';
import { useColorScheme } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Button, Column, Host, ModalBottomSheet, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { useTema } from '../tema/tema';

export default function NovedadesHoja({ novedades, alCerrar }) {
  const t = useTema();
  const oscuro = useColorScheme() === 'dark';
  const hoja = useRef(null);
  const cerrado = useRef(false);
  const terminar = () => { if (!cerrado.current) { cerrado.current = true; alCerrar(); } };
  // surfaceContainerHigh de Material 3, como HojasAndroid.
  const fondo = oscuro ? '#2B2930' : '#F7F2FA';
  const tinta = oscuro ? '#FFFFFF' : '#000000';
  const tenue = oscuro ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)';
  // El botón baja la hoja con su animación y recién ahí avisa.
  const continuar = () => {
    Haptics.selectionAsync().catch(() => {});
    const p = hoja.current?.hide?.();
    if (p?.then) p.then(terminar, terminar); else terminar();
  };
  return (
    <Host style={{ position: 'absolute', width: 1, height: 1 }}>
      <ModalBottomSheet ref={hoja} onDismissRequest={terminar} containerColor={fondo} contentColor={tinta}>
        <Column verticalArrangement={{ spacedBy: 18 }} modifiers={[padding(24, 4, 24, 28)]}>
          <Text color={tinta} style={{ typography: 'headlineSmall' }}>{novedades.titulo ?? 'Qué hay de nuevo'}</Text>
          {novedades.cosas.slice(0, 3).map((c) => (
            <Column key={c.titulo} verticalArrangement={{ spacedBy: 2 }}>
              <Text color={tinta} style={{ typography: 'titleMedium' }}>{c.titulo}</Text>
              <Text color={tenue} style={{ typography: 'bodyMedium' }}>{c.detalle}</Text>
            </Column>
          ))}
          <Button onClick={continuar} colors={{ containerColor: t.color.magenta, contentColor: '#FFFFFF' }} modifiers={[fillMaxWidth()]}>
            <Text color="#FFFFFF" style={{ typography: 'labelLarge' }}>Continuar</Text>
          </Button>
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}
