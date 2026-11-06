La app del personal de Farmalasa: Expo + React Native + Expo Router, en
**JavaScript**. No es una app independiente: es la otra cara del portal web y
usa su mismo núcleo. Leer también `LEEME.md` (cómo está armada y cómo correrla)
y el `CLAUDE.md` de la raíz del repo, cuyas reglas valen acá igual.

## Expo cambió — no confiar en lo que uno recuerda

Expo rompe APIs en cada SDK. Antes de escribir código que toque una API de
Expo o de React Native:

1. Leer la versión mayor de `expo` en `apps/mobile/package.json`.
2. Abrir la documentación de esa versión: `https://docs.expo.dev/versions/v<mayor>.0.0/`.
3. Para lo demás, `https://docs.expo.dev/llms.txt` (índice de toda la
   documentación, con correcciones a errores comunes) y seguir el enlace a la
   página concreta. Nunca contestar de memoria.

## Cómo está armada (lo que NO es como en una app Expo genérica)

- **Rutas en `app/`** (no `src/app/`), todas `.js`: cada archivo es una
  pantalla y `_layout.js` define el navegador; las pestañas están en `app/(tabs)/`.
  El código que no es ruta va fuera de `app/`: `componentes/`, `tema/`,
  `plataforma/`, `motor/`.
- **El núcleo NO se copia.** `metro.config.js` resuelve `@nucleo/…` a `src/` del
  portal: sesión, permisos, consultas y reglas son el mismo código que la web.
  Si falta algo en el núcleo, se agrega en `src/` (con las reglas del
  `CLAUDE.md` raíz y sus gates), nunca una copia acá. Todo paquete que el núcleo
  importe (`react`, `zustand`, `@supabase/supabase-js`…) va en el
  `package.json` de ESTA app: con dos copias de React los hooks revientan.
- **`plataforma/`** son los adaptadores del dispositivo (`@plataforma/…`), con
  los mismos nombres y el mismo contrato que `src/plataforma/` de la web. Lo que
  todavía no existe en el teléfono lanza con `pendiente(...)`; nunca devuelve un
  vacío que se lea como dato. Ver `plataforma/LEEME.md`.
- **Estrategia mixta**: `pantallas.js` (`PANTALLAS_DE_LA_APP`) lista las rutas
  del portal que ya son nativas; el resto se abre como el portal dentro de la
  app con la MISMA sesión (`componentes/PortalIncrustado.js`,
  `componentes/sesionCompartida.js`). Mientras el portal está abierto, él es el único que
  renueva el token: dos renovadores sobre el mismo token cierran la sesión.
- **Un módulo nuevo del portal nace también nativo acá**: su pantalla en
  `app/` y su entrada en `pantallas.js`, o una excepción con motivo en
  `scripts/app-nativa-gate.mjs`. Lo vigila `npm run gate:app-nativa` (en el
  pre-commit cuando el commit toca `pantallas.js`, `moduleMap.js` o `App.jsx`).
- **Variantes por plataforma**: iOS con SwiftUI vía `@expo/ui` (archivos
  `.ios.js` cuando hace falta), Android con las piezas Material en archivos
  `.android.js` junto al genérico (`HojaDeOpciones.android.js`,
  `Interruptor.android.js`…). Al cambiar un componente, revisar si tiene gemelos.
- **Colores** sólo de `tema/tema.js`, que lee `src/constants/tokens.json` del
  portal. No se escribe un color a mano.
- **Nativo**: `ios/` y `android/` se generan (no están en el repo); lo nativo se
  configura en `app.json`/`app.config.js`, `plugins/` y `targets/` (widgets y
  extensiones de iOS con `@bacons/apple-targets`). Nunca editar `ios/` ni
  `android/` a mano. Un paquete con código nativo no corre en Expo Go: hace
  falta un binario nuevo.

## Comandos

```bash
cd apps/mobile
npx expo install <paquete>   # SIEMPRE en vez de npm install <paquete>: elige la versión del SDK
npx expo start               # servidor de desarrollo (Expo Go, o `w` para el navegador)
npx expo-doctor              # dependencias y configuración
npx expo install --fix       # corrige versiones incompatibles
```

- **El `.env` de esta app apunta al entorno de PRUEBAS, nunca a producción**
  (variables `EXPO_PUBLIC_*`; cómo armarlo, en `LEEME.md`). No va al repo.
- **No hay lint ni typecheck configurados en esta app** (es JavaScript, y el
  `eslint.config.js` de la raíz ignora `apps/`). No correr `npx expo lint`:
  instala y crea una configuración nueva. Para verificar, abrir la pantalla en
  el emulador o el teléfono contra el entorno de pruebas
  (`docs/PRUEBA-EN-TELEFONO-REAL.md`), y si se tocó el núcleo, los gates de la
  raíz (`npm run gate:nucleo`, `gate:alias`, `test`).

## Compilar y publicar — sin EAS

El repo NO usa los servidores de Expo (EAS) para compilar ni para publicar:
cada versión costaría. `eas.json` existe sólo para que los scripts lean de un
perfil las variables `EXPO_PUBLIC_*` de producción. Desde la raíz del repo:

```bash
node scripts/subir-ios.mjs apps/mobile interna       # compila en esta Mac con Xcode y sube a TestFlight
node scripts/subir-android.mjs apps/mobile interna   # compila con Android Studio y sube a Google Play (pista internal)
```

Nunca `eas build`, `eas submit` ni `eas update`. La actualización por aire
(`npm run app:actualizar -- "Qué cambia"`) existe sólo para la app de clientes
(`apps/clientes`); en esta app, un cambio llega a los teléfonos con un binario
nuevo.
