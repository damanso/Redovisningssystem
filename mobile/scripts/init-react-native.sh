#!/bin/bash

# Initialize React Native Project Script
# This script creates a fresh React Native project and copies your custom code into it

set -e  # Exit on error

echo "🚀 React Native Project Initialization Script"
echo "=============================================="
echo ""

# Check if running in the mobile directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the mobile/ directory"
    exit 1
fi

# Warning
echo "⚠️  WARNING: This script will:"
echo "   1. Create a backup of current mobile folder"
echo "   2. Initialize a fresh React Native project"
echo "   3. Copy your custom code into the new project"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

# Get parent directory
PARENT_DIR=$(dirname $(pwd))
BACKUP_DIR="${PARENT_DIR}/mobile_backup_$(date +%Y%m%d_%H%M%S)"
MOBILE_DIR=$(pwd)

# Step 1: Create backup
echo ""
echo "📦 Step 1: Creating backup..."
cp -r "$MOBILE_DIR" "$BACKUP_DIR"
echo "✅ Backup created at: $BACKUP_DIR"

# Step 2: Go to parent directory
cd "$PARENT_DIR"

# Step 3: Initialize new React Native project
echo ""
echo "📦 Step 2: Initializing new React Native project..."
echo "This may take a few minutes..."
npx react-native init RedovisningApp --template react-native-template-typescript

# Step 4: Rename to mobile
echo ""
echo "📦 Step 3: Setting up directory structure..."
rm -rf mobile
mv RedovisningApp mobile
cd mobile

# Step 5: Copy custom code
echo ""
echo "📦 Step 4: Copying your custom code..."

# Copy source code
rm -rf src App.tsx
cp -r "$BACKUP_DIR/src" ./
cp "$BACKUP_DIR/App.tsx" ./
cp "$BACKUP_DIR/index.js" ./

# Copy configuration files
echo "  - Copying configuration files..."
cp "$BACKUP_DIR/.eslintrc.js" ./ 2>/dev/null || true
cp "$BACKUP_DIR/.prettierrc.js" ./ 2>/dev/null || true
cp "$BACKUP_DIR/babel.config.js" ./
cp "$BACKUP_DIR/metro.config.js" ./ 2>/dev/null || true
cp "$BACKUP_DIR/tsconfig.json" ./
cp "$BACKUP_DIR/jest.config.js" ./ 2>/dev/null || true
cp "$BACKUP_DIR/.env.example" ./ 2>/dev/null || true

# Copy documentation
cp "$BACKUP_DIR/README.md" ./ 2>/dev/null || true
cp "$BACKUP_DIR/IOS_SETUP_GUIDE.md" ./ 2>/dev/null || true
cp "$BACKUP_DIR/COMPLETE_PROJECT_INIT_GUIDE.md" ./ 2>/dev/null || true

# Copy scripts
mkdir -p scripts
cp -r "$BACKUP_DIR/scripts/"* ./scripts/ 2>/dev/null || true

# Copy iOS configuration
echo "  - Copying iOS configuration..."
cp "$BACKUP_DIR/ios/Podfile" ./ios/ 2>/dev/null || true
cp "$BACKUP_DIR/ios/RedovisningApp/Info.plist" ./ios/RedovisningApp/ 2>/dev/null || true

# Copy Android configuration
echo "  - Copying Android configuration..."
cp "$BACKUP_DIR/android/build.gradle" ./android/ 2>/dev/null || true
cp "$BACKUP_DIR/android/app/build.gradle" ./android/app/ 2>/dev/null || true
cp "$BACKUP_DIR/android/app/src/main/AndroidManifest.xml" ./android/app/src/main/ 2>/dev/null || true
cp -r "$BACKUP_DIR/android/app/src/main/res/"* ./android/app/src/main/res/ 2>/dev/null || true

# Step 6: Merge package.json dependencies
echo ""
echo "📦 Step 5: Merging package.json dependencies..."

# Save the generated package.json
cp package.json package.json.generated

# Create a Node script to merge dependencies
cat > merge-deps.js << 'EOF'
const fs = require('fs');

const generated = JSON.parse(fs.readFileSync('package.json.generated', 'utf8'));
const backup = JSON.parse(fs.readFileSync('../../' + process.argv[2] + '/package.json', 'utf8'));

// Merge dependencies
generated.dependencies = {
  ...generated.dependencies,
  ...backup.dependencies
};

// Merge devDependencies
generated.devDependencies = {
  ...generated.devDependencies,
  ...backup.devDependencies
};

// Keep scripts from backup
generated.scripts = {
  ...generated.scripts,
  ...backup.scripts
};

fs.writeFileSync('package.json', JSON.stringify(generated, null, 2));
console.log('✅ Dependencies merged successfully');
EOF

node merge-deps.js "$(basename $BACKUP_DIR)"
rm merge-deps.js package.json.generated

# Step 7: Install dependencies
echo ""
echo "📦 Step 6: Installing dependencies..."
npm install

# Step 8: iOS setup
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo ""
    echo "🍎 Step 7: Setting up iOS..."
    cd ios
    pod install
    cd ..
fi

echo ""
echo "✅ React Native project initialized successfully!"
echo ""
echo "📦 Backup location: $BACKUP_DIR"
echo ""
echo "📱 Next steps:"
echo "1. Review and update .env file"
echo "2. For iOS:"
echo "   - Open ios/RedovisningApp.xcworkspace in Xcode"
echo "   - Configure signing & capabilities"
echo "   - Run: npm run ios"
echo ""
echo "3. For Android:"
echo "   - Run: npm run android"
echo ""
echo "📖 See IOS_SETUP_GUIDE.md for detailed iOS instructions"
