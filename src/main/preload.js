/**
 * MS Console - Electron Preload Script
 * Provides a secure bridge between renderer and main processes
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  setSettings: (settings) => ipcRenderer.invoke('settings:setAll', settings),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  
  // Backend status
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  getBackendPort: () => ipcRenderer.invoke('backend:getPort'),
  
  // Test connection
  testConnection: () => ipcRenderer.invoke('test:connection'),
  
  // Conversations persistence
  getConversations: () => ipcRenderer.invoke('conversations:get'),
  saveConversations: (conversations) => ipcRenderer.invoke('conversations:save', conversations),
  
  // Chat streaming - use IPC to avoid CORS issues
  chatStream: (message, conversationHistory, model) => {
    return ipcRenderer.invoke('chat:stream', { message, conversationHistory, model });
  },
  
  // Listen for chat stream events
  onChatEvent: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('chat:event', listener);
    // Return cleanup function
    return () => ipcRenderer.removeListener('chat:event', listener);
  },
  
  // Cancel ongoing chat request
  cancelChat: () => ipcRenderer.invoke('chat:cancel'),
  
  // Platform info
  platform: process.platform,
});

// Expose the API base URL for the Python backend
contextBridge.exposeInMainWorld('backendAPI', {
  getBaseUrl: async () => {
    const port = await ipcRenderer.invoke('backend:getPort');
    return `http://127.0.0.1:${port}`;  // Use 127.0.0.1 to avoid IPv6 issues
  },
});
