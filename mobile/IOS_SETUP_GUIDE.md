# iOS Setup Guide - Apple Utvecklingskonto

Denna guide hjälper dig att sätta upp och köra Redovisning-appen på en iOS-enhet via ditt Apple utvecklingskonto.

## Förutsättningar

### 1. Hårdvara och Programvara
- **Mac** med macOS 12.0 eller senare
- **Xcode 14.0** eller senare (installera från App Store)
- **Node.js 18+** och npm
- **CocoaPods** (installera med: `sudo gem install cocoapods`)
- **iOS-enhet** med iOS 13.4 eller senare (rekommenderat för testning)

### 2. Apple Utvecklingskonto
- **Apple ID** registrerat som utvecklare
- Gå till [Apple Developer Program](https://developer.apple.com/programs/)
- Du kan använda ett **gratis utvecklingskonto** för testning på egen enhet
- För App Store distribution behövs ett **betalt konto** ($99/år)

## Steg 1: Installera Beroenden

```bash
# Navigera till mobile-mappen
cd mobile

# Installera Node.js dependencies
npm install

# Installera iOS dependencies med CocoaPods
cd ios
pod install
cd ..
```

## Steg 2: Öppna Projektet i Xcode

```bash
# Öppna Xcode workspace (INTE .xcodeproj!)
open ios/RedovisningApp.xcworkspace
```

## Steg 3: Konfigurera Signing & Capabilities

### 3.1 Välj Ditt Team
1. I Xcode, välj projektet **RedovisningApp** i Project Navigator (vänster panel)
2. Välj target **RedovisningApp**
3. Gå till fliken **Signing & Capabilities**
4. Under **Team**, välj ditt Apple Developer Team
   - Om du inte ser ditt team, klicka på **Add Account** och logga in med ditt Apple ID
   - För första gången kan du behöva skapa ett team

### 3.2 Ändra Bundle Identifier (Viktig!)
Bundle Identifier måste vara unik. Ändra från standardvärdet:

1. Under **Bundle Identifier**, ändra från `com.redovisningapp` till något unikt, t.ex.:
   ```
   com.dittnamn.redovisning
   ```
   eller
   ```
   com.dittforetag.redovisning
   ```

2. Xcode kommer automatiskt att skapa en provisioning profile

### 3.3 Aktivera Capabilities
Följande capabilities är redan konfigurerade i koden, men dubbelkolla:

1. **Push Notifications** - För notiser
2. **Background Modes** - För background sync
   - Remote notifications

## Steg 4: Konfigurera Din iOS-Enhet

### 4.1 Aktivera Utvecklarläge på iPhone/iPad
1. Anslut din iOS-enhet till Mac:en med USB-kabel
2. På iOS-enheten:
   - Gå till **Inställningar** → **Sekretess & Säkerhet**
   - Scrolla ner och aktivera **Utvecklarläge**
   - Starta om enheten när du blir ombedd
3. När enheten startat om, godkänn "Enable Developer Mode"

### 4.2 Lita på Dator
När du ansluter enheten första gången:
1. En dialog visas på iOS-enheten: **"Trust This Computer?"**
2. Tryck **Trust** (Lita på)
3. Ange enhetens låskod

## Steg 5: Välj Enhet i Xcode

1. I Xcode toolbar längst upp, klicka på enhetsväljaren (till vänster om Play-knappen)
2. Under **iOS Device**, välj din anslutna enhet
3. Om enheten inte syns:
   - Kontrollera USB-anslutningen
   - Öppna **Window** → **Devices and Simulators** (⇧⌘2)
   - Din enhet ska visas där

## Steg 6: Bygg och Kör Appen

### Metod 1: Via Xcode (Rekommenderat första gången)
1. Klicka på **Play-knappen** (▶) eller tryck **⌘R**
2. Xcode kommer att:
   - Bygga projektet
   - Installera appen på din enhet
   - Starta appen automatiskt

### Metod 2: Via Kommandorad
```bash
# Från mobile-mappen
npm run ios -- --device "Din iPhones Namn"
```

## Steg 7: Lita på Utvecklaren på iOS-Enheten

Första gången du kör en app från ditt utvecklingskonto:

1. Appen kommer att installeras men inte starta
2. Ett felmeddelande visas om "Untrusted Developer"
3. På iOS-enheten, gå till:
   ```
   Inställningar → Allmänt → VPN & Enhetshantering
   ```
4. Under **DEVELOPER APP**, tryck på ditt Apple ID
5. Tryck **Trust "ditt@email.com"**
6. Bekräfta genom att trycka **Trust** igen
7. Gå tillbaka och starta appen från hemskärmen

## Steg 8: Konfigurera Backend API

### 8.1 Uppdatera API URL
Redigera `.env`-filen i mobile-mappen:

```bash
# För lokal utveckling (Mac och iPhone på samma WiFi)
API_URL=http://DIN-MAC-IP:3000/api

# Hitta din Mac's IP:
# System Settings → Network → WiFi → Details → TCP/IP
# Exempel: API_URL=http://192.168.1.100:3000/api

# För production
API_URL=https://din-backend.com/api
```

### 8.2 Tillåt HTTP i Development
Info.plist är redan konfigurerad för att tillåta HTTP till localhost i utveckling.

För andra HTTP-adresser, lägg till i Info.plist:
```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSExceptionDomains</key>
    <dict>
        <key>192.168.1.100</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
        </dict>
    </dict>
</dict>
```

## Steg 9: Testa Appen

### Grundläggande Test
1. **Login Screen** - Testa inloggning
2. **Dashboard** - Kontrollera att data laddas
3. **Kamera** - Testa kvittoskanning (behöver kameratillstånd)
4. **Offline Mode** - Stäng av WiFi och testa offline-funktioner

### Debug i Xcode
- Öppna **Console** i Xcode (View → Debug Area → Show Debug Area)
- Se console.log output från React Native

## Felsökning

### Problem: "Failed to build iOS project"
**Lösning:**
```bash
cd ios
pod deintegrate
pod install
cd ..
```

### Problem: "No provisioning profiles found"
**Lösning:**
1. Kontrollera att du har valt rätt Team i Signing & Capabilities
2. Ändra Bundle Identifier till något unikt
3. Xcode → Preferences → Accounts → Ladda om konton

### Problem: "Unable to install app"
**Lösning:**
1. Kontrollera att enheten är låst upp
2. Lita på datorn på iOS-enheten
3. Rensa bygget: Product → Clean Build Folder (⇧⌘K)

### Problem: "Command PhaseScriptExecution failed"
**Lösning:**
```bash
# Rensa cache
npm start -- --reset-cache

# Eller
rm -rf node_modules
npm install
cd ios && pod install && cd ..
```

### Problem: "Developer Mode Required"
**Lösning:**
1. Gå till iOS Settings → Privacy & Security
2. Aktivera Developer Mode
3. Starta om enheten

### Problem: Metro Bundler Connection Issues
**Lösning:**
```bash
# Starta Metro Bundler manuellt
npm start

# I ny terminal, bygg och kör
npm run ios
```

## Distribution till TestFlight (Valfritt)

### För att distribuera till beta-testare via TestFlight:

1. **Arkivera Appen**
   ```
   Xcode → Product → Archive
   ```

2. **Uppladdning till App Store Connect**
   - När arkivering är klar, öppnas Organizer
   - Välj arkivet och klicka **Distribute App**
   - Välj **App Store Connect**
   - Följ guiden

3. **Konfigurera i App Store Connect**
   - Gå till [App Store Connect](https://appstoreconnect.apple.com)
   - Välj din app
   - Gå till TestFlight-fliken
   - Lägg till testare

## Best Practices för Development

### 1. Använd Simulator för Snabb Development
```bash
# Kör på iOS Simulator (snabbare för UI-ändringar)
npm run ios
```

### 2. Hot Reload
- Skaka enheten eller tryck **⌘D** i simulatorn
- Välj "Enable Fast Refresh"

### 3. Debugging
- **React Native Debugger**: [https://github.com/jhen0409/react-native-debugger](https://github.com/jhen0409/react-native-debugger)
- **Flipper**: Bygg-in debugging tool

### 4. Performance Profiling
- Xcode → Product → Profile
- Använd Instruments för performance-analys

## Nästa Steg

1. **Testa på flera enheter** - iPhone och iPad
2. **Konfigurera Push Notifications** med APNS
3. **Implementera Analytics** (t.ex. Firebase)
4. **Förbered för App Store** - Screenshots, beskrivning, etc.

## Support och Resurser

- **React Native Docs**: [https://reactnative.dev](https://reactnative.dev)
- **Apple Developer**: [https://developer.apple.com/ios](https://developer.apple.com/ios)
- **Xcode Help**: Help → Xcode Help i menyn

## Checklista innan Production

- [ ] Alla permissions är förklarade i Info.plist
- [ ] Bundle Identifier är unik och korrekt
- [ ] API URL pekar på production server
- [ ] HTTPS används för alla API-anrop (ej HTTP)
- [ ] App icon är satt (alla storlekar)
- [ ] Launch Screen är konfigurerad
- [ ] Version number och build number är uppdaterade
- [ ] Testade på flera enheter och iOS-versioner
- [ ] Privacy Policy URL är tillgänglig
- [ ] App Store metadata är komplett
- [ ] Screenshots för alla enhetstyper
- [ ] App Store Review Guidelines är följda

## Kontakt

För frågor eller problem, kontakta:
- **Email**: support@redovisning.com
- **GitHub Issues**: [Project Repository]

---

**Lycka till med din iOS-utveckling!** 🍎📱
