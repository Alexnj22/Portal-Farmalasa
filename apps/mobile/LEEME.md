# La app del teléfono (F8)

Plan: `docs/PLAN-NUCLEO-PORTABLE-2026-09-24.md`. Decisión del usuario: la app
tiene que tener **toda la información de todas las pantallas** del portal; la
forma puede ser otra, el contenido no.

## Cómo está armada

- **El núcleo NO se copia.** `metro.config.js` resuelve `@nucleo/…` a `src/` del
  portal: sesión, permisos, consultas y reglas son el mismo código que la web.
- **`plataforma/`** son los adaptadores de este dispositivo (`@plataforma/…`),
  con los mismos nombres que `src/plataforma/`. Ver su `LEEME.md`.
- **Los colores** salen de `src/constants/tokens.json` (temas sólidos) por
  `tema/tema.js`. No se escribe un color a mano.
- **Estrategia mixta** (decisión del usuario): `pantallas.js` lista las rutas
  que ya son nativas; el resto se abre como el portal dentro de la app con la
  MISMA sesión (`componentes/PortalIncrustado.js`, `sesionCompartida.js`).
  Mientras el portal está abierto, él es el único que renueva el token: dos
  renovadores sobre el mismo token hacen que Supabase cierre la sesión.
- Un paquete que el núcleo importe (`react`, `zustand`, `@supabase/supabase-js`)
  va en el `package.json` de ESTA app: Metro lo resuelve desde acá para que no
  haya dos copias de React.

## Correrla

```bash
cd apps/mobile
npm install
# .env (no va al repo): las del entorno de PRUEBAS, nunca producción
#   EXPO_PUBLIC_SUPABASE_URL=…      (VITE_SUPABASE_URL de .env.staging)
#   EXPO_PUBLIC_SUPABASE_ANON_KEY=… (VITE_SUPABASE_ANON_KEY de .env.staging)
#   EXPO_PUBLIC_PORTAL_URL=http://10.0.2.2:5199   (portal local visto desde el emulador;
#       levantarlo con `npx vite --mode staging --host 0.0.0.0 --port 5199` en la raíz)
npx expo start          # Expo Go en el teléfono, o `w` para el navegador
```

Cuenta de pruebas: la del entorno de pruebas (ver CLAUDE.md del portal).
