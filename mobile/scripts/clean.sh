#!/bin/bash

# Clean Script - Clears all caches and build artifacts
# Run this if you encounter build issues

echo "🧹 Cleaning Redovisning Mobile App..."
echo "===================================="
echo ""

# Clean npm
echo "📦 Cleaning npm cache..."
npm cache clean --force

# Remove node_modules
echo "📦 Removing node_modules..."
rm -rf node_modules

# Remove package-lock
echo "📦 Removing package-lock.json..."
rm -f package-lock.json

# Clean iOS
if [ -d "ios" ]; then
    echo "🍎 Cleaning iOS..."

    # Remove Pods
    echo "  - Removing Pods..."
    rm -rf ios/Pods
    rm -f ios/Podfile.lock

    # Clean build
    echo "  - Cleaning iOS build..."
    rm -rf ios/build
    rm -rf ~/Library/Developer/Xcode/DerivedData
fi

# Clean Android
if [ -d "android" ]; then
    echo "🤖 Cleaning Android..."

    # Clean gradle
    echo "  - Running gradle clean..."
    cd android
    ./gradlew clean 2>/dev/null || echo "  - Gradle clean skipped (no gradlew)"
    cd ..

    # Remove build folders
    echo "  - Removing build folders..."
    rm -rf android/app/build
    rm -rf android/build
    rm -rf android/.gradle
fi

# Clean Metro bundler cache
echo "📦 Cleaning Metro bundler cache..."
rm -rf $TMPDIR/react-*
rm -rf $TMPDIR/metro-*

echo ""
echo "✅ Clean complete!"
echo ""
echo "📦 Next steps:"
echo "1. Reinstall dependencies: npm install"
echo "2. For iOS: cd ios && pod install && cd .."
echo "3. Start fresh: npm start -- --reset-cache"
echo ""
echo "Or run the setup script:"
echo "  ./scripts/setup-ios.sh    (for iOS)"
echo "  ./scripts/setup-android.sh (for Android)"
