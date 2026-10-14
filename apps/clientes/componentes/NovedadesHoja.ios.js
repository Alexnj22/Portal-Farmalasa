// «Qué hay de nuevo» en iPhone (2026-10-14): la hoja del SISTEMA (SwiftUI
// `.sheet`), del alto de su contenido y con el asa para bajarla — como la que
// muestra cualquier app de Apple después de actualizarse. Todo en SwiftUI: el
// ícono es el SF Symbol, el texto respeta el tamaño de letra del teléfono y el
// botón es el de vidrio de iOS 26, igual que `BotonNativo.ios.js`.
//
// La lista vive en lib/novedades.js. La monta la raíz (app/_layout.js).
import { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { BottomSheet, Button, Group, HStack, Host, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle, controlSize, fixedSize, font, foregroundStyle, frame, padding, presentationDragIndicator, tint,
} from '@expo/ui/swift-ui/modifiers';
import { useTema } from '../tema/tema';

export default function NovedadesHoja({ novedades, alCerrar }) {
  const t = useTema();
  const [abierta, setAbierta] = useState(true);
  const cerrado = useRef(false);
  // Una sola vez, la llame quien la llame: el gesto de bajarla avisa por
  // `onIsPresentedChange` y, al terminar la animación, por `onDismiss`.
  const terminar = () => { if (!cerrado.current) { cerrado.current = true; alCerrar(); } };
  useEffect(() => {
    if (abierta) return undefined;
    // Respaldo por si `onDismiss` no llega: el tiempo de la animación de la hoja.
    const reloj = setTimeout(terminar, 500);
    return () => clearTimeout(reloj);
  }, [abierta]);
  const magenta = String(t.color.magenta).toUpperCase();
  return (
    <Host style={{ position: 'absolute', width: 1, height: 1 }}>
      <BottomSheet isPresented={abierta} onIsPresentedChange={setAbierta} onDismiss={terminar} fitToContents>
        <Group modifiers={[presentationDragIndicator('visible')]}>
          <VStack alignment="leading" spacing={20} modifiers={[padding({ horizontal: 24, top: 32, bottom: 16 })]}>
            <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' })]}>{novedades.titulo ?? 'Qué hay de nuevo'}</Text>
            {novedades.cosas.slice(0, 3).map((c) => (
              <HStack key={c.titulo} spacing={14} alignment="top">
                <Image systemName={c.sf} size={22} color={magenta} modifiers={[frame({ width: 32 })]} />
                <VStack alignment="leading" spacing={2}>
                  <Text modifiers={[font({ textStyle: 'headline' })]}>{c.titulo}</Text>
                  <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                    fixedSize({ horizontal: false, vertical: true })]}>{c.detalle}</Text>
                </VStack>
              </HStack>
            ))}
            <Button
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setAbierta(false); }}
              modifiers={[buttonStyle('glassProminent'), controlSize('large'), tint(magenta), padding({ top: 6 })]}>
              <Text modifiers={[frame({ maxWidth: 10000 })]}>Continuar</Text>
            </Button>
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
