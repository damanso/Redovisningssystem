#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function checkFile(filePath, description) {
  const fullPath = path.join(process.cwd(), filePath);
  if (fs.existsSync(fullPath)) {
    log(`✓ ${description}`, 'green');
    return true;
  } else {
    log(`✗ ${description} saknas`, 'red');
    return false;
  }
}

async function checkDocker() {
  try {
    const { stdout } = await execAsync('docker ps');
    const containers = stdout.toLowerCase();

    const checks = [
      { name: 'PostgreSQL', pattern: 'postgres' },
      { name: 'MongoDB', pattern: 'mongo' },
      { name: 'Redis', pattern: 'redis' }
    ];

    let allRunning = true;
    for (const check of checks) {
      if (containers.includes(check.pattern)) {
        log(`✓ ${check.name} container körs`, 'green');
      } else {
        log(`✗ ${check.name} container körs inte`, 'red');
        allRunning = false;
      }
    }

    return allRunning;
  } catch (error) {
    log('✗ Kunde inte kontrollera Docker containers', 'red');
    log('  Kör: docker-compose up -d', 'yellow');
    return false;
  }
}

async function checkNodeModules(dir, name) {
  const modulesPath = path.join(process.cwd(), dir, 'node_modules');
  if (fs.existsSync(modulesPath)) {
    log(`✓ ${name} dependencies installerade`, 'green');
    return true;
  } else {
    log(`✗ ${name} dependencies saknas`, 'red');
    log(`  Kör: cd ${dir} && npm install`, 'yellow');
    return false;
  }
}

async function main() {
  log('\n=== Verifierar projektsetup ===\n', 'blue');

  let allChecks = [];

  // Check project structure
  log('📁 Projektstruktur:', 'blue');
  allChecks.push(await checkFile('frontend/package.json', 'Frontend package.json'));
  allChecks.push(await checkFile('backend/package.json', 'Backend package.json'));
  allChecks.push(await checkFile('docker-compose.yml', 'Docker Compose config'));
  allChecks.push(await checkFile('backend/src/app.ts', 'Backend app.ts'));
  allChecks.push(await checkFile('backend/src/server.ts', 'Backend server.ts'));
  allChecks.push(await checkFile('database/migrations/001_initial_schema.sql', 'Database migration'));

  console.log();

  // Check dependencies
  log('📦 Dependencies:', 'blue');
  allChecks.push(await checkNodeModules('frontend', 'Frontend'));
  allChecks.push(await checkNodeModules('backend', 'Backend'));

  console.log();

  // Check environment files
  log('🔧 Miljövariabler:', 'blue');
  allChecks.push(await checkFile('backend/.env', 'Backend .env'));
  allChecks.push(await checkFile('frontend/.env', 'Frontend .env'));

  console.log();

  // Check Docker containers
  log('🐳 Docker Containers:', 'blue');
  allChecks.push(await checkDocker());

  console.log();

  // Summary
  const passed = allChecks.filter(Boolean).length;
  const total = allChecks.length;

  if (passed === total) {
    log(`\n✓ Alla kontroller godkända (${passed}/${total})`, 'green');
    log('\n🚀 Projektet är redo att köras!', 'green');
    log('\nNästa steg:', 'blue');
    log('  1. cd backend && npm run dev', 'yellow');
    log('  2. cd frontend && npm run dev (i ny terminal)', 'yellow');
  } else {
    log(`\n⚠ ${total - passed} kontroller misslyckades`, 'yellow');
    log('\nÅtgärda problemen ovan och kör sedan detta skript igen.', 'yellow');
  }

  console.log();
}

main().catch(console.error);
