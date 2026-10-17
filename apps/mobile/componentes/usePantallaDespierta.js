// La pantalla no se apaga mientras se cuenta efectivo (pedido del usuario,
// 2026-10-17): contar bolsas, hacer el corte o confirmarlo lleva minutos con
// el teléfono quieto en la mesa, y si se bloquea a la mitad hay que volver a
// entrar —o peor, la sesión se cierra sola y el conteo se pierde—.
//
// Va atado al FOCO y no al montaje: en una pila de expo-router la pantalla de
// abajo sigue montada al abrir otra encima, así que `useKeepAwake` a secas la
// dejaría despierta también fuera del conteo. Cada pantalla usa su propia
// etiqueta para que salir de una no apague la otra.
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export default function usePantallaDespierta(etiqueta, activa = true) {
  useFocusEffect(useCallback(() => {
    if (!activa) return undefined;
    Promise.resolve(activateKeepAwakeAsync(etiqueta)).catch(() => {});
    return () => { Promise.resolve(deactivateKeepAwake(etiqueta)).catch(() => {}); };
  }, [etiqueta, activa]));
}
