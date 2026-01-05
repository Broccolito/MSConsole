#!/usr/bin/env node

/**
 * Setup script for MSConsole Python environment
 * Creates a virtual environment using the runtime Python and installs dependencies
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const RUNTIME_PYTHON = path.join(PROJECT_ROOT, 'runtime', 'bin', 'python3');
const VENV_PATH = path.join(PROJECT_ROOT, 'venv');
const REQUIREMENTS_FILE = path.join(PROJECT_ROOT, 'python', 'requirements.txt');

console.log('='.repeat(60));
console.log('MSConsole Python Environment Setup');
console.log('='.repeat(60));

// Check if runtime Python exists
if (!fs.existsSync(RUNTIME_PYTHON)) {
  console.error(`\n❌ Runtime Python not found at: ${RUNTIME_PYTHON}`);
  console.error('Please ensure the runtime folder is properly set up.');
  process.exit(1);
}

console.log(`\n✓ Found runtime Python: ${RUNTIME_PYTHON}`);

// Check Python version
function checkPythonVersion() {
  return new Promise((resolve, reject) => {
    const proc = spawn(RUNTIME_PYTHON, ['--version']);

    proc.stdout.on('data', (data) => {
      console.log(`✓ Python version: ${data.toString().trim()}`);
      resolve();
    });

    proc.stderr.on('data', (data) => {
      console.log(`✓ Python version: ${data.toString().trim()}`);
      resolve();
    });

    proc.on('error', reject);
  });
}

// Create virtual environment
function createVenv() {
  return new Promise((resolve, reject) => {
    console.log(`\n📦 Creating virtual environment at: ${VENV_PATH}`);

    // Remove existing venv if it exists
    if (fs.existsSync(VENV_PATH)) {
      console.log('   Removing existing virtual environment...');
      fs.rmSync(VENV_PATH, { recursive: true, force: true });
    }

    const proc = spawn(RUNTIME_PYTHON, ['-m', 'venv', VENV_PATH], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('✓ Virtual environment created successfully');

        // Fix symlinks to be relative for packaging
        fixSymlinks();

        resolve();
      } else {
        reject(new Error(`Failed to create virtual environment (exit code ${code})`));
      }
    });

    proc.on('error', reject);
  });
}

// Fix Python symlinks to use relative paths
function fixSymlinks() {
  const venvBinPath = path.join(VENV_PATH, 'bin');
  const venvLibPath = path.join(VENV_PATH, 'lib');
  const pythonSymlink = path.join(venvBinPath, 'python3');

  // Remove the absolute symlink
  if (fs.existsSync(pythonSymlink)) {
    fs.unlinkSync(pythonSymlink);

    // Copy the actual Python binary instead
    const runtimePython = RUNTIME_PYTHON;
    fs.copyFileSync(runtimePython, pythonSymlink);
    fs.chmodSync(pythonSymlink, 0o755);

    console.log('   Fixed Python binary symlink');
  }

  // Symlink the runtime lib directory to venv/lib for shared libraries
  // Use relative path for portability when packaged
  const runtimeLibPath = path.join(PROJECT_ROOT, 'runtime', 'lib', 'libpython3.12.dylib');
  const venvLibFile = path.join(venvLibPath, 'libpython3.12.dylib');

  if (fs.existsSync(runtimeLibPath) && !fs.existsSync(venvLibFile)) {
    // Use relative path: from venv/lib to runtime/lib/libpython3.12.dylib
    // That's: ../../runtime/lib/libpython3.12.dylib
    const relativePath = '../../runtime/lib/libpython3.12.dylib';
    fs.symlinkSync(relativePath, venvLibFile);
    console.log('   Created lib symlink for shared libraries');
  }
}

// Install dependencies
function installDependencies() {
  return new Promise((resolve, reject) => {
    console.log(`\n📚 Installing Python dependencies from: ${REQUIREMENTS_FILE}`);

    const venvPip = process.platform === 'win32'
      ? path.join(VENV_PATH, 'Scripts', 'pip.exe')
      : path.join(VENV_PATH, 'bin', 'pip');

    if (!fs.existsSync(venvPip)) {
      reject(new Error(`pip not found in virtual environment: ${venvPip}`));
      return;
    }

    const proc = spawn(venvPip, ['install', '-r', REQUIREMENTS_FILE], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('✓ Dependencies installed successfully');
        resolve();
      } else {
        reject(new Error(`Failed to install dependencies (exit code ${code})`));
      }
    });

    proc.on('error', reject);
  });
}

// Main setup function
async function setup() {
  try {
    await checkPythonVersion();
    await createVenv();
    await installDependencies();

    console.log('\n' + '='.repeat(60));
    console.log('✅ Python environment setup complete!');
    console.log('='.repeat(60));
    console.log('\nYou can now run: npm start\n');
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ Setup failed:', error.message);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

// Run setup
setup();
