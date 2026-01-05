/**
 * MS Console - Electron Main Process
 * Manages application windows, settings persistence, and Python backend communication
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const Store = require('electron-store');
const http = require('http');

// Initialize secure settings store
const store = new Store({
  name: 'msconsole-config',
  encryptionKey: 'msconsole-secure-key-2024', // In production, use a more secure approach
  schema: {
    openaiApiKey: { type: 'string', default: '' },
    model: { type: 'string', default: 'gpt-5.2' },
    mysqlHost: { type: 'string', default: 'queryms.ucsf.edu' },
    mysqlPort: { type: 'string', default: '3306' },
    mysqlUsername: { type: 'string', default: 'medcp' },
    mysqlPassword: { type: 'string', default: 'Medcp_aiqueries_123#@!' },
    mysqlDatabase: { type: 'string', default: 'imsms' },
    showToolCalls: { type: 'boolean', default: true },
    streamTokens: { type: 'boolean', default: true },
    conversations: { type: 'array', default: [] },
  },
});

let mainWindow = null;
let pythonProcess = null;
let pythonPort = 8765;
let isBackendReady = false;

/**
 * Get the Python executable path based on the platform
 */
function getPythonPath() {
  if (process.platform === 'win32') {
    return 'python';
  }
  return 'python3';
}

/**
 * Get the Python server script path
 */
function getPythonScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'python', 'msconsole_server.py');
  }
  return path.join(__dirname, '..', '..', 'python', 'msconsole_server.py');
}

/**
 * Start the Python backend server
 */
function startPythonBackend() {
  return new Promise((resolve, reject) => {
    const pythonPath = getPythonPath();
    const scriptPath = getPythonScriptPath();
    
    console.log(`[Backend] Starting Python backend...`);
    console.log(`[Backend] Python path: ${pythonPath}`);
    console.log(`[Backend] Script path: ${scriptPath}`);
    
    // Check if script exists
    const fs = require('fs');
    if (!fs.existsSync(scriptPath)) {
      console.error(`[Backend] Script not found: ${scriptPath}`);
      reject(new Error(`Python script not found: ${scriptPath}`));
      return;
    }
    
    // Set environment variables for the Python process
    const env = {
      ...process.env,
      OPENAI_API_KEY: store.get('openaiApiKey') || '',
      OPENAI_MODEL: store.get('model') || 'gpt-5.2',
      MYSQL_HOST: store.get('mysqlHost') || 'queryms.ucsf.edu',
      MYSQL_PORT: store.get('mysqlPort') || '3306',
      MYSQL_USERNAME: store.get('mysqlUsername') || 'medcp',
      MYSQL_PASSWORD: store.get('mysqlPassword') || 'Medcp_aiqueries_123#@!',
      MYSQL_DATABASE: store.get('mysqlDatabase') || 'imsms',
      SERVER_PORT: String(pythonPort),
    };
    
    console.log(`[Backend] Server port: ${pythonPort}`);
    console.log(`[Backend] API key configured: ${env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
    
    pythonProcess = spawn(pythonPath, [scriptPath], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    pythonProcess.stdout.on('data', (data) => {
      const message = data.toString();
      console.log(`[Python] ${message}`);
      
      // Check if server started successfully
      if (message.includes('Server started') || message.includes('Uvicorn running') || message.includes('Application startup complete')) {
        isBackendReady = true;
        resolve(true);
      }
    });
    
    pythonProcess.stderr.on('data', (data) => {
      const message = data.toString();
      console.log(`[Python stderr] ${message}`);
      // Uvicorn logs to stderr
      if (message.includes('Uvicorn running') || message.includes('Started server') || message.includes('Application startup complete')) {
        isBackendReady = true;
        resolve(true);
      }
    });
    
    pythonProcess.on('error', (error) => {
      console.error('[Backend] Failed to start Python process:', error);
      reject(error);
    });
    
    pythonProcess.on('close', (code) => {
      console.log(`[Backend] Python process exited with code ${code}`);
      isBackendReady = false;
      pythonProcess = null;
    });
    
    // Timeout for startup - try health checks
    setTimeout(async () => {
      if (!isBackendReady) {
        console.log('[Backend] Startup timeout, checking health...');
        try {
          await checkBackendHealth(5, 1000);
          isBackendReady = true;
          console.log('[Backend] Health check passed');
          resolve(true);
        } catch (err) {
          console.log('[Backend] Health check failed:', err.message);
          // Don't reject - the backend might still be starting
          resolve(false);
        }
      }
    }, 3000);
  });
}

/**
 * Stop the Python backend server
 */
function stopPythonBackend() {
  if (pythonProcess) {
    console.log('Stopping Python backend...');
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
    isBackendReady = false;
  }
}

/**
 * Check if the Python backend is healthy with optional retries
 */
function checkBackendHealth(retries = 1, delay = 500) {
  return new Promise((resolve, reject) => {
    const attempt = (attemptsLeft) => {
      const options = {
        hostname: '127.0.0.1',  // Use IPv4 explicitly to avoid IPv6 issues
        port: pythonPort,
        path: '/health',
        method: 'GET',
        timeout: 5000,
      };
      
      const req = http.request(options, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else if (attemptsLeft > 0) {
          setTimeout(() => attempt(attemptsLeft - 1), delay);
        } else {
          reject(new Error(`Health check failed: ${res.statusCode}`));
        }
      });
      
      req.on('error', (error) => {
        if (attemptsLeft > 0) {
          setTimeout(() => attempt(attemptsLeft - 1), delay);
        } else {
          reject(error);
        }
      });
      
      req.on('timeout', () => {
        req.destroy();
        if (attemptsLeft > 0) {
          setTimeout(() => attempt(attemptsLeft - 1), delay);
        } else {
          reject(new Error('Health check timeout'));
        }
      });
      
      req.end();
    };
    
    attempt(retries);
  });
}

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,  // Allow cross-origin requests from file:// to localhost
    },
    titleBarStyle: 'default',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
  });
  
  // Load the React app
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }
  
  // DevTools can be opened manually with Ctrl+Shift+I or Cmd+Option+I
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================================
// IPC Handlers
// ============================================================================

// Settings handlers
ipcMain.handle('settings:get', async (event, key) => {
  if (key) {
    return store.get(key);
  }
  return store.store;
});

ipcMain.handle('settings:set', async (event, key, value) => {
  store.set(key, value);
  
  // Restart Python backend if relevant settings changed
  if (['openaiApiKey', 'model', 'mysqlHost', 'mysqlPort', 'mysqlUsername', 'mysqlPassword', 'mysqlDatabase'].includes(key)) {
    if (pythonProcess) {
      stopPythonBackend();
      setTimeout(() => startPythonBackend(), 1000);
    }
  }
  
  return true;
});

ipcMain.handle('settings:getAll', async () => {
  return {
    openaiApiKey: store.get('openaiApiKey'),
    model: store.get('model'),
    mysqlHost: store.get('mysqlHost'),
    mysqlPort: store.get('mysqlPort'),
    mysqlUsername: store.get('mysqlUsername'),
    mysqlPassword: store.get('mysqlPassword'),
    mysqlDatabase: store.get('mysqlDatabase'),
    showToolCalls: store.get('showToolCalls'),
    streamTokens: store.get('streamTokens'),
  };
});

ipcMain.handle('settings:setAll', async (event, settings) => {
  console.log('[Settings] Saving settings...');
  
  Object.entries(settings).forEach(([key, value]) => {
    store.set(key, value);
  });
  
  console.log('[Settings] Settings saved, restarting backend...');
  
  // Always stop existing backend
  stopPythonBackend();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Start backend (it needs to run even without API key for health checks)
  try {
    await startPythonBackend();
    console.log('[Settings] Backend restarted successfully');
    
    // Give extra time for initialization
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Verify health
    try {
      await checkBackendHealth(3, 1000);
      console.log('[Settings] Backend health verified');
    } catch (healthErr) {
      console.log('[Settings] Backend health check failed, but continuing:', healthErr.message);
    }
  } catch (error) {
    console.error('[Settings] Backend restart failed:', error);
  }
  
  return true;
});

// Backend status handler
ipcMain.handle('backend:status', async () => {
  try {
    if (!pythonProcess) {
      return { status: 'stopped', message: 'Python backend not running' };
    }
    
    await checkBackendHealth();
    return { status: 'running', message: 'Backend is healthy', port: pythonPort };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
});

ipcMain.handle('backend:restart', async () => {
  stopPythonBackend();
  await new Promise(resolve => setTimeout(resolve, 1000));
  await startPythonBackend();
  return { status: 'restarted' };
});

ipcMain.handle('backend:getPort', async () => {
  return pythonPort;
});

// Conversation storage handlers
ipcMain.handle('conversations:get', async () => {
  return store.get('conversations') || [];
});

ipcMain.handle('conversations:save', async (event, conversations) => {
  store.set('conversations', conversations);
  return true;
});

// Test connection handler
ipcMain.handle('test:connection', async () => {
  try {
    // Test backend health
    await checkBackendHealth();
    
    // Test OpenAI connection via backend
    const response = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({ test: true });
      
      const options = {
        hostname: '127.0.0.1',  // Use IPv4 explicitly to avoid IPv6 issues
        port: pythonPort,
        path: '/test-connection',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 30000,
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ success: false, error: 'Invalid response' });
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection test timeout'));
      });
      
      req.write(postData);
      req.end();
    });
    
    return response;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Chat streaming handler - proxies requests to avoid CORS issues
let currentChatRequest = null;

ipcMain.handle('chat:stream', async (event, { message, conversationHistory, model }) => {
  const sender = event.sender;
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      message,
      conversation_history: conversationHistory || [],
      model: model || store.get('model') || 'gpt-5.2',
    });
    
    console.log(`[Chat] Starting stream request to port ${pythonPort}`);
    console.log(`[Chat] Message: ${message.substring(0, 50)}...`);
    
    const options = {
      hostname: '127.0.0.1',
      port: pythonPort,
      path: '/chat/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    
    currentChatRequest = http.request(options, (res) => {
      console.log(`[Chat] Response status: ${res.statusCode}`);
      
      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => {
          console.error(`[Chat] Error response: ${errorData}`);
          sender.send('chat:event', { type: 'error', message: `HTTP ${res.statusCode}: ${errorData}` });
          resolve({ success: false, error: errorData });
        });
        return;
      }
      
      let buffer = '';
      
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        
        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));
              console.log(`[Chat] Event: ${eventData.type}`);
              sender.send('chat:event', eventData);
            } catch (e) {
              // Ignore parse errors for incomplete data
            }
          }
        }
      });
      
      res.on('end', () => {
        console.log('[Chat] Stream ended');
        currentChatRequest = null;
        resolve({ success: true });
      });
      
      res.on('error', (error) => {
        console.error('[Chat] Response error:', error);
        sender.send('chat:event', { type: 'error', message: error.message });
        currentChatRequest = null;
        resolve({ success: false, error: error.message });
      });
    });
    
    currentChatRequest.on('error', (error) => {
      console.error('[Chat] Request error:', error);
      sender.send('chat:event', { type: 'error', message: error.message });
      currentChatRequest = null;
      resolve({ success: false, error: error.message });
    });
    
    currentChatRequest.write(postData);
    currentChatRequest.end();
  });
});

ipcMain.handle('chat:cancel', async () => {
  if (currentChatRequest) {
    console.log('[Chat] Cancelling request');
    currentChatRequest.destroy();
    currentChatRequest = null;
    return { cancelled: true };
  }
  return { cancelled: false };
});

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(async () => {
  // Start Python backend first
  try {
    await startPythonBackend();
    console.log('Python backend started successfully');
  } catch (error) {
    console.error('Failed to start Python backend:', error);
  }
  
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopPythonBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopPythonBackend();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Error', `An unexpected error occurred: ${error.message}`);
});
