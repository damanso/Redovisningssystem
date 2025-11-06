# Redovisning Mobile App

A React Native mobile application for managing accounting, invoices, customers, and receipts on-the-go.

## Features

- **Authentication**: Secure login and registration
- **Dashboard**: Real-time business metrics and statistics
- **Customer Management**: Create, view, and manage customers
- **Invoice Management**: Create, send, and track invoices
- **Receipt Scanning**: Scan receipts with camera and OCR processing
- **Offline Support**: Works offline with automatic synchronization
- **Push Notifications**: Get notified about important events

## Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v18 or higher)
- npm or yarn
- React Native CLI
- Xcode (for iOS development on macOS)
- Android Studio (for Android development)
- CocoaPods (for iOS dependencies)

## Installation

1. **Navigate to the mobile directory**:
   ```bash
   cd mobile
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Install iOS dependencies** (macOS only):
   ```bash
   cd ios && pod install && cd ..
   ```

4. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and update the API_URL to point to your backend server.

## Running the App

### iOS

```bash
npm run ios
```

Or open `ios/RedovisningApp.xcworkspace` in Xcode and run.

### Android

```bash
npm run android
```

Or open the `android` folder in Android Studio and run.

## Development

### Start Metro Bundler

```bash
npm start
```

### Run Tests

```bash
npm test
```

### Lint Code

```bash
npm run lint
```

## Project Structure

```
mobile/
├── src/
│   ├── components/       # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   ├── Loading.tsx
│   │   └── EmptyState.tsx
│   ├── navigation/       # Navigation configuration
│   │   ├── RootNavigator.tsx
│   │   ├── AuthNavigator.tsx
│   │   ├── MainNavigator.tsx
│   │   ├── InvoiceNavigator.tsx
│   │   ├── CustomerNavigator.tsx
│   │   └── ReceiptNavigator.tsx
│   ├── screens/          # Screen components
│   │   ├── auth/
│   │   │   ├── LoginScreen.tsx
│   │   │   └── RegisterScreen.tsx
│   │   ├── dashboard/
│   │   │   └── DashboardScreen.tsx
│   │   ├── customers/
│   │   │   ├── CustomerListScreen.tsx
│   │   │   ├── CustomerDetailScreen.tsx
│   │   │   └── CustomerCreateScreen.tsx
│   │   ├── invoices/
│   │   │   ├── InvoiceListScreen.tsx
│   │   │   ├── InvoiceDetailScreen.tsx
│   │   │   └── InvoiceCreateScreen.tsx
│   │   ├── receipts/
│   │   │   ├── ReceiptListScreen.tsx
│   │   │   ├── ReceiptDetailScreen.tsx
│   │   │   └── ReceiptScanScreen.tsx
│   │   └── more/
│   │       └── MoreScreen.tsx
│   ├── services/         # API and business logic
│   │   ├── api.ts
│   │   ├── storage.ts
│   │   ├── sync.ts
│   │   └── notifications.ts
│   ├── store/            # State management (Zustand)
│   │   ├── authStore.ts
│   │   ├── customerStore.ts
│   │   ├── invoiceStore.ts
│   │   └── dashboardStore.ts
│   ├── types/            # TypeScript type definitions
│   │   └── index.ts
│   └── utils/            # Utility functions
├── App.tsx               # Root component
├── index.js              # Entry point
├── package.json
├── tsconfig.json
└── README.md
```

## Key Technologies

- **React Native**: Cross-platform mobile framework
- **TypeScript**: Type-safe development
- **React Navigation**: Navigation library
- **Zustand**: State management
- **AsyncStorage**: Local storage
- **Axios**: HTTP client
- **React Native Camera**: Camera functionality
- **React Native Image Picker**: Image selection
- **Push Notifications**: FCM/APNS integration
- **NetInfo**: Network connectivity monitoring

## API Integration

The app communicates with the backend API. Configure the API endpoint in `.env`:

```
API_URL=http://localhost:3000/api
```

For production, update this to your production API URL.

## Offline Functionality

The app supports offline mode:

- **Local Storage**: Data is cached locally using AsyncStorage
- **Automatic Sync**: Changes are synced automatically when online
- **Pending Queue**: Offline changes are queued and synced when connection is restored
- **Conflict Resolution**: Server data takes precedence in conflicts

## Push Notifications

### iOS Setup

1. Configure APNS in Apple Developer Portal
2. Update `ios/RedovisningApp/Info.plist` with notification settings
3. Set `APNS_KEY_ID` in `.env`

### Android Setup

1. Configure FCM in Firebase Console
2. Download `google-services.json` to `android/app/`
3. Set `FCM_SERVER_KEY` in `.env`

## Camera Permissions

### iOS

Update `ios/RedovisningApp/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>We need access to your camera to scan receipts</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>We need access to your photo library to select receipt images</string>
```

### Android

Permissions are automatically handled by `react-native-permissions`.

## Building for Production

### iOS

1. Open Xcode
2. Select your signing team
3. Archive the app
4. Upload to App Store Connect

Or use the command:
```bash
npm run build:ios
```

### Android

Generate a signed APK:

```bash
npm run build:android
```

The APK will be located at `android/app/build/outputs/apk/release/`.

## Troubleshooting

### Metro Bundler Issues

```bash
npm start -- --reset-cache
```

### iOS Build Errors

```bash
cd ios && pod install && cd ..
```

### Android Build Errors

```bash
cd android && ./gradlew clean && cd ..
```

### Clear All Caches

```bash
npm start -- --reset-cache
rm -rf node_modules
npm install
cd ios && pod install && cd ..
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Write/update tests
4. Submit a pull request

## License

MIT

## Support

For support, email support@redovisning.com or open an issue on GitHub.

## Changelog

### Version 1.0.0 (2024-11-06)
- Initial release
- Authentication system
- Customer management
- Invoice management
- Receipt scanning with OCR
- Dashboard with statistics
- Offline support
- Push notifications
