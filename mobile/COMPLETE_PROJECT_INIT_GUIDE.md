# Komplett Guide: Initiera React Native Projektet

Denna guide hjälper dig att initiera det kompletta React Native projektet från den befintliga kodbasen.

## Viktigt: Du har två alternativ

### Alternativ 1: Använd React Native CLI (Rekommenderat för snabb start)
Detta skapar native iOS och Android projekt automatiskt.

### Alternativ 2: Använd Expo (Enklare men vissa begränsningar)
Om du vill ha en enklare setup utan Xcode-konfiguration initialt.

---

## ALTERNATIV 1: React Native CLI (Komplett Native Setup)

### Steg 1: Förberedelser
```bash
# Kontrollera att du har Node.js installerat
node --version  # Ska vara 18 eller högre

# Kontrollera att du har npm
npm --version

# Installera React Native CLI globalt (om inte redan installerat)
npm install -g react-native-cli

# För iOS - Installera CocoaPods
sudo gem install cocoapods
```

### Steg 2: Initiera React Native Projektet
```bash
# Gå till Redovisningssystem root-mappen
cd /path/to/Redovisningssystem

# Ta backup av din befintliga mobile-mapp
mv mobile mobile_backup

# Initiera ett nytt React Native projekt
npx react-native init RedovisningApp --template react-native-template-typescript

# Byt namn på mappen till mobile
mv RedovisningApp mobile
```

### Steg 3: Ersätt med Din Kod
```bash
cd mobile

# Ta bort default-filerna
rm -rf src/
rm App.tsx

# Kopiera tillbaka din kod från backup
cp -r ../mobile_backup/src ./
cp -r ../mobile_backup/App.tsx ./
cp -r ../mobile_backup/package.json ./package.json.custom

# Merga package.json dependencies
# Öppna både package.json och package.json.custom
# Kopiera alla dependencies från .custom till huvudfilen
```

### Steg 4: Installera Alla Dependencies
```bash
# Installera alla npm packages
npm install

# Installera specifika packages från vår app
npm install @react-navigation/native@^6.1.17
npm install @react-navigation/stack@^6.3.29
npm install @react-navigation/bottom-tabs@^6.5.20
npm install @react-native-async-storage/async-storage@^1.23.1
npm install axios@^1.6.8
npm install react-native-camera@^4.2.1
npm install react-native-vision-camera@^3.9.2
npm install react-native-image-picker@^7.1.2
npm install react-native-permissions@^4.1.5
npm install react-native-safe-area-context@^4.10.1
npm install react-native-screens@^3.31.1
npm install react-native-gesture-handler@^2.16.2
npm install react-native-reanimated@^3.10.1
npm install @react-native-community/netinfo@^11.3.1
npm install react-native-sqlite-storage@^6.0.1
npm install date-fns@^3.6.0
npm install zustand@^4.5.2
npm install react-native-vector-icons@^10.1.0
npm install react-native-chart-kit@^6.12.0
npm install react-native-svg@^15.2.0
npm install react-native-push-notification@^8.1.1

# För iOS - Installera pods
cd ios
pod install
cd ..
```

### Steg 5: Kopiera Konfigurationsfiler
```bash
# Kopiera alla config-filer från backup
cp ../mobile_backup/.eslintrc.js ./
cp ../mobile_backup/.prettierrc.js ./
cp ../mobile_backup/babel.config.js ./
cp ../mobile_backup/metro.config.js ./
cp ../mobile_backup/tsconfig.json ./
cp ../mobile_backup/jest.config.js ./
cp ../mobile_backup/.env.example ./
cp ../mobile_backup/README.md ./
cp ../mobile_backup/IOS_SETUP_GUIDE.md ./

# Kopiera iOS-konfiguration
cp ../mobile_backup/ios/Podfile ./ios/
cp ../mobile_backup/ios/RedovisningApp/Info.plist ./ios/RedovisningApp/

# Kopiera Android-konfiguration
cp -r ../mobile_backup/android/* ./android/
```

### Steg 6: Uppdatera iOS Permissions
Öppna `ios/RedovisningApp/Info.plist` och verifiera att alla permissions finns:
- NSCameraUsageDescription
- NSPhotoLibraryUsageDescription
- NSPhotoLibraryAddUsageDescription
- UIBackgroundModes (remote-notification)

### Steg 7: Konfigurera Android
Uppdatera `android/app/src/main/AndroidManifest.xml` med:
- CAMERA permission
- READ_EXTERNAL_STORAGE permission
- WRITE_EXTERNAL_STORAGE permission
- Push notification services

### Steg 8: Testa Projektet
```bash
# Starta Metro Bundler
npm start

# I ny terminal - Kör iOS
npm run ios

# Eller kör Android
npm run android
```

---

## ALTERNATIV 2: Snabb Setup med Befintlig Kod (Kräver Manuell Xcode Config)

Om du vill använda den befintliga koden direkt utan att återskapa projektet:

### Steg 1: Installera Dependencies
```bash
cd mobile
npm install
```

### Steg 2: Fixa Native Modules för iOS
```bash
# Installera pods
cd ios
pod install
cd ..
```

### Steg 3: Skapa Xcode Project Manuellt

Eftersom vi inte har en fullständig `.xcodeproj`, behöver du:

1. **Öppna Xcode**
2. **File → New → Project**
3. Välj **iOS → App**
4. Projektnamn: `RedovisningApp`
5. Organization Identifier: `com.redovisning` (eller ditt eget)
6. Språk: **Objective-C** eller **Swift**
7. Spara i `mobile/ios/`

8. **Länka React Native**:
   - Gå till projekt settings
   - Under **Build Phases**, lägg till React Native via CocoaPods
   - Kör `pod install` igen

9. **Konfigurera Build Settings**:
   - Header Search Paths: `$(SRCROOT)/../node_modules/react-native/React`
   - Library Search Paths: `$(SRCROOT)/../node_modules/react-native/Libraries`

### Steg 4: Lägg till AppDelegate kod

Ersätt innehållet i `AppDelegate.m` (eller `.swift`) med React Native bootstrap-kod.

**Detta alternativ är mer komplext och rekommenderas INTE för nybörjare.**

---

## ALTERNATIV 3: Använd Expo (Lättast för snabb start)

Om du vill komma igång snabbt utan att hantera native kod initialt:

### Steg 1: Installera Expo CLI
```bash
npm install -g expo-cli
```

### Steg 2: Skapa Expo Project
```bash
# Från Redovisningssystem root
expo init mobile-expo --template blank-typescript
cd mobile-expo
```

### Steg 3: Kopiera Kod
```bash
# Kopiera src-mappen
cp -r ../mobile/src ./

# Kopiera App.tsx
cp ../mobile/App.tsx ./
```

### Steg 4: Anpassa package.json
Expo har vissa begränsningar - vissa native modules fungerar inte direkt:
- `react-native-camera` → Använd `expo-camera` istället
- `react-native-vision-camera` → Använd `expo-camera` istället
- Push notifications → Använd `expo-notifications`

### Steg 5: Installera Expo Equivalents
```bash
expo install expo-camera
expo install expo-image-picker
expo install expo-notifications
expo install expo-secure-store
expo install @react-navigation/native
expo install @react-navigation/stack
expo install @react-navigation/bottom-tabs
npm install axios zustand date-fns
```

### Steg 6: Anpassa Imports
Uppdatera imports i din kod:
```typescript
// Före
import {launchCamera} from 'react-native-image-picker';

// Efter
import * as ImagePicker from 'expo-image-picker';
```

### Steg 7: Kör Expo
```bash
expo start

# Scanna QR-koden med Expo Go app på din iPhone
```

**Fördelar med Expo:**
- Ingen Xcode/Android Studio behövs för utveckling
- Testa direkt på din telefon med Expo Go app
- Enklare att komma igång

**Nackdelar med Expo:**
- Vissa native modules fungerar inte
- Större app-storlek
- Mindre kontroll över native kod

---

## Rekommendation: Vilket alternativ ska jag välja?

### Välj ALTERNATIV 1 (React Native CLI) om:
- ✅ Du vill ha full kontroll
- ✅ Du behöver alla native features (kamera, push notifications, etc.)
- ✅ Du är bekväm med Xcode och Android Studio
- ✅ Du planerar att publicera till App Store

### Välj ALTERNATIV 3 (Expo) om:
- ✅ Du vill testa snabbt
- ✅ Du inte vill hantera native kod ännu
- ✅ Du är nybörjare på React Native
- ✅ Du vill utveckla utan Mac (för iOS)

---

## Nästa Steg Efter Initering

Oavsett vilket alternativ du valde:

1. **Konfigurera .env fil**
   ```bash
   cp .env.example .env
   # Uppdatera API_URL
   ```

2. **Testa appen lokalt**
   ```bash
   npm start
   ```

3. **Följ IOS_SETUP_GUIDE.md** för iOS-specifik setup

4. **Bygg för produktion** när du är redo

---

## Felsökning

### "Command not found: react-native"
```bash
npm install -g react-native-cli
```

### "Unable to resolve module..."
```bash
npm start -- --reset-cache
```

### "CocoaPods could not find compatible versions"
```bash
cd ios
pod repo update
pod install
cd ..
```

### "SDK location not found" (Android)
Skapa `android/local.properties`:
```properties
sdk.dir=/Users/dittnamn/Library/Android/sdk
```

---

## Hjälp och Support

Om du stöter på problem:
1. Kontrollera [React Native Troubleshooting](https://reactnative.dev/docs/troubleshooting)
2. Sök på [Stack Overflow](https://stackoverflow.com/questions/tagged/react-native)
3. Läs [IOS_SETUP_GUIDE.md](./IOS_SETUP_GUIDE.md) för iOS-specifika problem

**Lycka till!** 🚀
