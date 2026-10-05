#!/usr/bin/env bash
# Compila Puntos Salud en ESTA Mac y la sube a TestFlight — sin los servidores
# de Expo (EAS), así que no cuesta nada por versión.
#
#   ./subir-ios.sh            → sube la versión con el siguiente número de compilación
#
# Necesita, una sola vez, una llave de API de App Store Connect en
# ~/.claves-farmalasa/ (fuera del repositorio):
#   AuthKey_<KEY_ID>.p8   y   asc.env  con  ASC_KEY_ID=…  y  ASC_ISSUER_ID=…
# Con la llave, Xcode firma en la nube (crea el certificado y el perfil solo) y
# la subida no pide contraseña ni código de verificación.
#
# El proyecto `ios/` se REGENERA cada vez (`expo prebuild --clean`): no se
# commitea y no se edita a mano; lo nativo se configura en app.json.
set -euo pipefail
cd "$(dirname "$0")"

CLAVES="$HOME/.claves-farmalasa"
[ -f "$CLAVES/asc.env" ] || { echo "Falta $CLAVES/asc.env (ASC_KEY_ID y ASC_ISSUER_ID)"; exit 1; }
# shellcheck disable=SC1091
source "$CLAVES/asc.env"
LLAVE="$CLAVES/AuthKey_${ASC_KEY_ID}.p8"
[ -f "$LLAVE" ] || { echo "Falta la llave $LLAVE"; exit 1; }

EQUIPO="ZZWA3Q7Q35"
# Producción: la app de la tienda habla con el proyecto real. Nunca el código
# de pruebas (EXPO_PUBLIC_PRUEBA_CODIGO) en una compilación de tienda.
export EXPO_PUBLIC_SUPABASE_URL="https://sacecdkdmsdvgqnrsett.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_cdFHhrbNAqfoA7FIsEgL3A_COHXzBoz"
unset EXPO_PUBLIC_PRUEBA_CODIGO

# El número de compilación sube solo: Apple rechaza dos subidas con el mismo.
NUEVO=$(node -e "
  const fs=require('fs'); const p='app.json'; const a=JSON.parse(fs.readFileSync(p));
  a.expo.ios.buildNumber=String(Number(a.expo.ios.buildNumber||'0')+1);
  fs.writeFileSync(p, JSON.stringify(a,null,2)+'\n'); console.log(a.expo.ios.buildNumber);")
echo "→ Compilación $NUEVO"

npx expo prebuild -p ios --clean
SALIDA="$(mktemp -d)"
xcodebuild -workspace ios/PuntosSalud.xcworkspace -scheme PuntosSalud -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$SALIDA/PuntosSalud.xcarchive" \
  DEVELOPMENT_TEAM="$EQUIPO" CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$LLAVE" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  archive | tail -20

cat > "$SALIDA/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$EQUIPO</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST

xcodebuild -exportArchive -archivePath "$SALIDA/PuntosSalud.xcarchive" \
  -exportOptionsPlist "$SALIDA/ExportOptions.plist" -exportPath "$SALIDA/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$LLAVE" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" | tail -20

echo "✓ Compilación $NUEVO subida. Aparece en App Store Connect → TestFlight en 10–30 minutos."
echo "  Commitea el app.json con el número nuevo."
