import React, { useState, useEffect, useCallback } from 'react';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SettingsView from './components/SettingsView';
import { v4 as uuidv4 } from 'uuid';

const App = () => {
  // View state
  const [currentView, setCurrentView] = useState('chat');
  
  // Settings state
  const [settings, setSettings] = useState({
    openaiApiKey: '',
    model: 'gpt-5.2',
    mysqlHost: 'queryms.ucsf.edu',
    mysqlPort: '3306',
    mysqlUsername: 'medcp',
    mysqlPassword: '',
    mysqlDatabase: 'imsms',
    showToolCalls: true,
    streamTokens: true,
  });
  
  // Conversations state
  const [conversations, setConversations] = useState([
    { id: 'default', name: 'MS Console', messages: [], createdAt: Date.now() }
  ]);
  const [activeConversationId, setActiveConversationId] = useState('default');
  
  // Backend status
  const [backendStatus, setBackendStatus] = useState({ status: 'checking' });
  const [backendPort, setBackendPort] = useState(8765);
  
  // Load settings and conversations on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load settings
        const savedSettings = await window.electronAPI.getSettings();
        if (savedSettings) {
          setSettings(prev => ({ ...prev, ...savedSettings }));
        }
        
        // Load conversations
        const savedConvs = await window.electronAPI.getConversations();
        if (savedConvs && savedConvs.length > 0) {
          setConversations(savedConvs);
          setActiveConversationId(savedConvs[0].id);
        }
        
        // Get backend port
        const port = await window.electronAPI.getBackendPort();
        setBackendPort(port);
        
        // Check backend status
        await checkBackendStatus();
        
        // No longer auto-redirect to settings - let user see welcome screen
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    };
    
    loadData();
    
    // Poll backend status
    const statusInterval = setInterval(checkBackendStatus, 30000);
    return () => clearInterval(statusInterval);
  }, []);
  
  // Check backend status
  const checkBackendStatus = async () => {
    try {
      const status = await window.electronAPI.getBackendStatus();
      setBackendStatus(status);
    } catch (error) {
      setBackendStatus({ status: 'error', message: error.message });
    }
  };
  
  // Save settings
  const handleSaveSettings = async (newSettings) => {
    try {
      await window.electronAPI.setSettings(newSettings);
      setSettings(newSettings);
      
      // Recheck backend after settings change
      setTimeout(checkBackendStatus, 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  };
  
  // Create new conversation
  const handleNewConversation = useCallback(() => {
    const newConv = {
      id: uuidv4(),
      name: `Chat ${conversations.length}`,
      messages: [],
      createdAt: Date.now(),
    };
    
    const updatedConvs = [newConv, ...conversations];
    setConversations(updatedConvs);
    setActiveConversationId(newConv.id);
    
    // Persist
    window.electronAPI.saveConversations(updatedConvs);
    
    // Switch to chat view
    setCurrentView('chat');
  }, [conversations]);
  
  // Update conversation messages
  const handleUpdateMessages = useCallback((conversationId, messages) => {
    setConversations(prev => {
      const updated = prev.map(conv => 
        conv.id === conversationId 
          ? { ...conv, messages } 
          : conv
      );
      
      // Persist
      window.electronAPI.saveConversations(updated);
      
      return updated;
    });
  }, []);
  
  // Rename conversation
  const handleRenameConversation = useCallback((conversationId, newName) => {
    setConversations(prev => {
      const updated = prev.map(conv =>
        conv.id === conversationId
          ? { ...conv, name: newName }
          : conv
      );
      
      window.electronAPI.saveConversations(updated);
      return updated;
    });
  }, []);
  
  // Delete conversation
  const handleDeleteConversation = useCallback((conversationId) => {
    setConversations(prev => {
      const updated = prev.filter(conv => conv.id !== conversationId);
      
      // If deleting active conversation, switch to first available
      if (conversationId === activeConversationId && updated.length > 0) {
        setActiveConversationId(updated[0].id);
      } else if (updated.length === 0) {
        // Create a new default conversation
        const newDefault = {
          id: uuidv4(),
          name: 'MS Console',
          messages: [],
          createdAt: Date.now(),
        };
        updated.push(newDefault);
        setActiveConversationId(newDefault.id);
      }
      
      window.electronAPI.saveConversations(updated);
      return updated;
    });
  }, [activeConversationId]);
  
  // Get active conversation
  const activeConversation = conversations.find(c => c.id === activeConversationId) || conversations[0];
  
  // Check if API key is missing
  const isApiKeyMissing = !settings.openaiApiKey;
  
  return (
    <div className="app-container">
      <TopBar 
        onSettingsClick={() => setCurrentView('settings')}
        onHelpClick={() => {/* TODO: Help modal */}}
        currentView={currentView}
      />
      
      <div className="app-content">
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={(id) => {
            setActiveConversationId(id);
            setCurrentView('chat');
          }}
          onNewConversation={handleNewConversation}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
        />
        
        <main className="main-content">
          {currentView === 'settings' ? (
            <SettingsView
              settings={settings}
              onSave={handleSaveSettings}
              onClose={() => setCurrentView('chat')}
              backendStatus={backendStatus}
            />
          ) : (
            <ChatView
              conversation={activeConversation}
              onUpdateMessages={(messages) => handleUpdateMessages(activeConversation.id, messages)}
              settings={settings}
              backendPort={backendPort}
              backendStatus={backendStatus}
              isApiKeyMissing={isApiKeyMissing}
              onOpenSettings={() => setCurrentView('settings')}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
