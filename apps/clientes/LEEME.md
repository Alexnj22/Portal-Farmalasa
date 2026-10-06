# Puntos Salud — la app del cliente

Detalle y decisiones: `docs/APP-CLIENTES-2026-10-05.md`.

- Habla con UNA sola puerta: la edge function `app-clientes` (`lib/api.js`). No
  hay cliente de Supabase ni cuenta de Auth: la sesión es un token en el
  llavero (`lib/sesion.js`).
- Del portal sólo toma los colores (`@nucleo/constants/tokens.json`, ver
  `metro.config.js`). No se escribe un color a mano.
- Las pestañas usan la barra del sistema (`NativeTabs`), como la app del
  personal.

## Correrla

```bash
cd apps/clientes
npm install
# .env (no va al repo)
#   EXPO_PUBLIC_SUPABASE_URL=…
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=…
npx expo start
```

Compilar para la tienda: `npx eas-cli@latest build --profile clientes`
(primero `eas init` para crear el proyecto y su `projectId`, que también
necesitan los avisos).
