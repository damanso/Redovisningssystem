#!/bin/bash

# iOS Setup Script for Redovisning Mobile App
# This script helps set up the iOS development environment

set -e  # Exit on error

echo "🍎 iOS Setup Script for Redovisning Mobile App"
echo "=============================================="
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ Error: This script must be run on macOS"
    exit 1
fi

# Check Node.js
echo "📦 Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org"
    exit 1
fi
NODE_VERSION=$(node -v)
echo "✅ Node.js $NODE_VERSION installed"

# Check npm
echo "📦 Checking npm..."
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi
NPM_VERSION=$(npm -v)
echo "✅ npm $NPM_VERSION installed"

# Check CocoaPods
echo "📦 Checking CocoaPods..."
if ! command -v pod &> /dev/null; then
    echo "⚠️  CocoaPods is not installed"
    echo "Installing CocoaPods..."
    sudo gem install cocoapods
fi
POD_VERSION=$(pod --version)
echo "✅ CocoaPods $POD_VERSION installed"

# Check Xcode
echo "📦 Checking Xcode..."
if ! command -v xcodebuild &> /dev/null; then
    echo "❌ Xcode is not installed"
    echo "Please install Xcode from the App Store"
    exit 1
fi
XCODE_VERSION=$(xcodebuild -version | head -n 1)
echo "✅ $XCODE_VERSION installed"

# Install npm dependencies
echo ""
echo "📦 Installing npm dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo ""
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✅ .env file created from .env.example"
    echo "⚠️  Please update API_URL in .env file"
fi

# Install iOS dependencies
echo ""
echo "📦 Installing iOS dependencies (CocoaPods)..."
cd ios
pod install
cd ..

echo ""
echo "✅ iOS setup complete!"
echo ""
echo "📱 Next steps:"
echo "1. Update API_URL in .env file"
echo "2. Open ios/RedovisningApp.xcworkspace in Xcode"
echo "3. Select your development team in Signing & Capabilities"
echo "4. Change Bundle Identifier to something unique"
echo "5. Connect your iOS device via USB"
echo "6. Build and run (⌘R in Xcode)"
echo ""
echo "Or run: npm run ios"
echo ""
echo "📖 For detailed instructions, see IOS_SETUP_GUIDE.md"
