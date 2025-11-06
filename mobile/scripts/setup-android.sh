#!/bin/bash

# Android Setup Script for Redovisning Mobile App
# This script helps set up the Android development environment

set -e  # Exit on error

echo "🤖 Android Setup Script for Redovisning Mobile App"
echo "================================================"
echo ""

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

# Check Java
echo "📦 Checking Java..."
if ! command -v java &> /dev/null; then
    echo "❌ Java is not installed"
    echo "Please install Java JDK 11 or higher"
    exit 1
fi
JAVA_VERSION=$(java -version 2>&1 | head -n 1)
echo "✅ $JAVA_VERSION installed"

# Check Android SDK
echo "📦 Checking Android SDK..."
if [ -z "$ANDROID_HOME" ]; then
    echo "⚠️  ANDROID_HOME is not set"
    echo "Please install Android Studio and set ANDROID_HOME"
    echo "Example: export ANDROID_HOME=$HOME/Library/Android/sdk"
    exit 1
fi
echo "✅ ANDROID_HOME is set to: $ANDROID_HOME"

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

# Create local.properties for Android
echo ""
echo "📝 Creating android/local.properties..."
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
echo "✅ local.properties created"

echo ""
echo "✅ Android setup complete!"
echo ""
echo "📱 Next steps:"
echo "1. Update API_URL in .env file"
echo "2. Connect your Android device via USB or start an emulator"
echo "3. Enable USB debugging on your device"
echo "4. Run: npm run android"
echo ""
echo "Or open android/ folder in Android Studio"
