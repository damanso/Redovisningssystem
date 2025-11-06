# 🚀 Quick Start - Redovisning Mobile App

**Snabbast väg från kod till körande iOS-app på din iPhone!**

## 📋 Vad du behöver

### Hårdvara
- ✅ **Mac** (macOS 12+)
- ✅ **iPhone eller iPad** (iOS 13.4+)
- ✅ **USB-kabel** för att ansluta enheten

### Programvara (installera dessa först)
1. **Xcode** (från App Store) - **MÅSTE VARA INSTALLERAD**
2. **Node.js 18+** från [nodejs.org](https://nodejs.org)
3. **CocoaPods**: `sudo gem install cocoapods`

### Apple Konto
- ✅ Apple ID (gratis utvecklingskonto fungerar!)
- Gå till [developer.apple.com](https://developer.apple.com) och logga in

---

## ⚡ Snabbstart i 3 Steg

### STEG 1: Initiera Projektet 🏗️

Du har två alternativ:

#### Alternativ A: Automatiskt Script (Rekommenderat)
```bash
cd mobile
chmod +x scripts/init-react-native.sh
./scripts/init-react-native.sh
```

Detta script:
- Skapar backup av nuvarande kod
- Initierar ett nytt React Native projekt
- Kopierar all din anpassade kod
- Installerar alla dependencies
- Kör CocoaPods för iOS

#### Alternativ B: Manuellt (Om script failar)
```bash
# 1. Skapa backup
cd ..
mv mobile mobile_backup

# 2. Initiera React Native
npx react-native init RedovisningApp --template react-native-template-typescript
mv RedovisningApp mobile
cd mobile

# 3. Kopiera din kod
cp -r ../mobile_backup/src ./
cp ../mobile_backup/App.tsx ./
cp ../mobile_backup/package.json ./package.json.backup

# 4. Merga dependencies manuellt
# Öppna package.json och package.json.backup
# Kopiera dependencies från backup till package.json

# 5. Installera
npm install
cd ios && pod install && cd ..
```

---

### STEG 2: Konfigurera Xcode 🍎

```bash
# Öppna workspace (INTE .xcodeproj!)
open ios/RedovisningApp.xcworkspace
```

#### I Xcode:
1. **Välj projektet** "RedovisningApp" i vänster panel

2. **Välj target** "RedovisningApp"

3. **Gå till fliken** "Signing & Capabilities"

4. **Välj ditt team:**
   - Klicka på "Team" dropdown
   - Om inget team finns: klicka "Add Account" och logga in med Apple ID
   - Välj ditt personliga team

5. **Ändra Bundle Identifier (VIKTIGT!):**
   ```
   Från: com.redovisningapp
   Till:   com.DITTNAMN.redovisning
   ```
   (Ersätt DITTNAMN med något unikt)

6. **Verifiera att Xcode skapar provisioning profile** ✅

---

### STEG 3: Anslut iPhone & Kör 📱

#### På din iPhone/iPad:
1. **Anslut via USB** till din Mac

2. **Aktivera utvecklarläge:**
   - Inställningar → Sekretess & Säkerhet
   - Scrolla ner → Utvecklarläge → Aktivera
   - Starta om enheten

3. **Lita på datorn:**
   - När dialog visas: "Trust This Computer?"
   - Tryck **Trust** (Lita på)

#### I Xcode:
1. **Välj din enhet** i dropdown (bredvid Play-knappen)
   - Välj din iPhone/iPad under "iOS Device"

2. **Tryck Play ▶️** eller **⌘R**

3. **Vänta på build** (första gången tar 2-5 minuter)

#### På din iPhone (första gången):
1. Ett felmeddelande visas: **"Untrusted Developer"**

2. Gå till iPhone:
   ```
   Inställningar → Allmänt → VPN & Enhetshantering
   ```

3. Under **DEVELOPER APP**, tryck på ditt Apple ID

4. Tryck **"Trust ditt@email.com"**

5. Bekräfta **Trust** igen

6. **Gå tillbaka till hemskärmen och öppna appen!** 🎉

---

## 🎯 Troubleshooting - Snabba Lösningar

### "Failed to build iOS project"
```bash
cd mobile
./scripts/clean.sh
./scripts/setup-ios.sh
```

### "No provisioning profile found"
1. Xcode → Preferences → Accounts
2. Klicka på ditt Apple ID
3. Klicka "Download Manual Profiles"
4. Ändra Bundle Identifier till något annat

### "Command PhaseScriptExecution failed"
```bash
cd mobile
npm start -- --reset-cache

# I ny terminal
npm run ios
```

### "Unable to install app"
1. Lås upp din iPhone
2. Starta om både iPhone och Mac
3. Koppla ur och sätt tillbaka USB-kabeln
4. Xcode → Product → Clean Build Folder (⇧⌘K)

### Metro Bundler fungerar inte
```bash
# Terminal 1
cd mobile
npm start

# Terminal 2
cd mobile
npm run ios
```

---

## 🔧 Konfigurera Backend API

Redigera `mobile/.env`:
```bash
# Hitta din Macs IP-adress:
# System Settings → Network → WiFi → Details → TCP/IP
# Exempel: 192.168.1.100

# Sedan uppdatera .env:
API_URL=http://192.168.1.100:3000/api
```

**Viktigt:** Din iPhone och Mac måste vara på samma WiFi-nätverk!

---

## 📱 Kör Appen

### Via Xcode (Rekommenderat)
```bash
open ios/RedovisningApp.xcworkspace
# Tryck ▶️ Play
```

### Via Kommandorad
```bash
cd mobile
npm run ios -- --device "Din iPhones Namn"
```

### På Simulator (för snabb utveckling)
```bash
cd mobile
npm run ios
# Startar automatiskt på simulator
```

---

## 📚 Mer Information

- **Detaljerad iOS Guide**: [IOS_SETUP_GUIDE.md](./IOS_SETUP_GUIDE.md)
- **Projekt Init Guide**: [COMPLETE_PROJECT_INIT_GUIDE.md](./COMPLETE_PROJECT_INIT_GUIDE.md)
- **App Documentation**: [README.md](./README.md)

---

## ✅ Checklista

Gå igenom denna lista:

- [ ] Xcode installerat från App Store
- [ ] Node.js 18+ installerat
- [ ] CocoaPods installerat (`pod --version` fungerar)
- [ ] React Native projekt initierat (`npm install` kört)
- [ ] CocoaPods installerat för iOS (`pod install` kört)
- [ ] Xcode workspace öppnat (`.xcworkspace` INTE `.xcodeproj`)
- [ ] Team valt i Signing & Capabilities
- [ ] Bundle Identifier ändrat till något unikt
- [ ] iPhone ansluten via USB
- [ ] Utvecklarläge aktiverat på iPhone
- [ ] Datorn betrodd på iPhone
- [ ] Enhet vald i Xcode
- [ ] Build och kör (⌘R)
- [ ] Developer betrodd på iPhone (Inställningar)
- [ ] App startar på iPhone! 🎉

---

## 🆘 Behöver Hjälp?

1. **Läs igenom** [IOS_SETUP_GUIDE.md](./IOS_SETUP_GUIDE.md) för detaljer
2. **Kör clean script** om något går fel: `./scripts/clean.sh`
3. **React Native Docs**: [reactnative.dev/docs/environment-setup](https://reactnative.dev/docs/environment-setup)
4. **Stack Overflow**: Sök efter felmeddelandet

---

## 🎉 Success!

Om appen startar på din iPhone har du:
- ✅ Byggt en React Native app
- ✅ Konfigurerat iOS signing
- ✅ Installerat på fysisk enhet
- ✅ Kan nu utveckla och testa!

**Nästa steg:**
1. Börja utveckla features
2. Testa olika screens
3. Konfigurera push notifications
4. Förbered för App Store

**Lycka till med din app-utveckling!** 🚀📱
