import React, { useState, useEffect } from 'react';
import { X, Save, RefreshCw, CheckCircle, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import './SettingsView.css';

const AVAILABLE_MODELS = [
  { id: 'gpt-5.2', name: 'GPT-5.2 (Recommended)' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
];

const SettingsView = ({ settings, onSave, onClose, backendStatus }) => {
  const [formData, setFormData] = useState(settings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showDbPassword, setShowDbPassword] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveMessage, setSaveMessage] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Check if model is custom
  useEffect(() => {
    const isKnownModel = AVAILABLE_MODELS.some(m => m.id === settings.model);
    if (!isKnownModel && settings.model) {
      setUseCustomModel(true);
      setCustomModel(settings.model);
    }
  }, [settings.model]);
  
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setSaveMessage(null);
  };
  
  const handleModelChange = (value) => {
    if (value === 'custom') {
      setUseCustomModel(true);
    } else {
      setUseCustomModel(false);
      handleChange('model', value);
    }
  };
  
  const handleCustomModelChange = (value) => {
    setCustomModel(value);
    handleChange('model', value);
  };
  
  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    
    try {
      const dataToSave = {
        ...formData,
        model: useCustomModel ? customModel : formData.model,
      };
      
      await onSave(dataToSave);
      setSaveMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (error) {
      setSaveMessage({ type: 'error', text: `Failed to save: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    
    try {
      const result = await window.electronAPI.testConnection();
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, error: error.message });
    } finally {
      setIsTesting(false);
    }
  };
  
  const handleRestartBackend = async () => {
    try {
      await window.electronAPI.restartBackend();
      setSaveMessage({ type: 'success', text: 'Backend restarted!' });
    } catch (error) {
      setSaveMessage({ type: 'error', text: `Failed to restart: ${error.message}` });
    }
  };
  
  return (
    <div className="settings-view">
      <div className="settings-container">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>
        
        <div className="settings-content">
          {/* API Settings */}
          <section className="settings-section">
            <h3>OpenAI API</h3>
            
            <div className="form-group">
              <label htmlFor="apiKey">API Key *</label>
              <div className="input-with-toggle">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  id="apiKey"
                  value={formData.openaiApiKey}
                  onChange={(e) => handleChange('openaiApiKey', e.target.value)}
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <span className="form-hint">
                Get your API key from{' '}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                  platform.openai.com
                </a>
              </span>
            </div>
            
            <div className="form-group">
              <label htmlFor="model">Model</label>
              <select
                id="model"
                value={useCustomModel ? 'custom' : formData.model}
                onChange={(e) => handleModelChange(e.target.value)}
              >
                {AVAILABLE_MODELS.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
                <option value="custom">Custom Model...</option>
              </select>
              
              {useCustomModel && (
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => handleCustomModelChange(e.target.value)}
                  placeholder="Enter custom model name"
                  className="custom-model-input"
                />
              )}
            </div>
          </section>
          
          {/* Display Options */}
          <section className="settings-section">
            <h3>Display Options</h3>
            
            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.showToolCalls}
                  onChange={(e) => handleChange('showToolCalls', e.target.checked)}
                />
                <span>Show tool calls in chat</span>
              </label>
              <span className="form-hint">
                Display database queries and their results in the conversation
              </span>
            </div>
            
            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.streamTokens}
                  onChange={(e) => handleChange('streamTokens', e.target.checked)}
                />
                <span>Stream responses</span>
              </label>
              <span className="form-hint">
                Show assistant responses as they're generated (token-by-token)
              </span>
            </div>
          </section>
          
          {/* Advanced Settings */}
          <section className="settings-section">
            <button 
              className="advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? '▼' : '▶'} Advanced Database Settings
            </button>
            
            {showAdvanced && (
              <div className="advanced-settings">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="mysqlHost">MySQL Host</label>
                    <input
                      type="text"
                      id="mysqlHost"
                      value={formData.mysqlHost}
                      onChange={(e) => handleChange('mysqlHost', e.target.value)}
                      placeholder="queryms.ucsf.edu"
                    />
                  </div>
                  
                  <div className="form-group small">
                    <label htmlFor="mysqlPort">Port</label>
                    <input
                      type="text"
                      id="mysqlPort"
                      value={formData.mysqlPort}
                      onChange={(e) => handleChange('mysqlPort', e.target.value)}
                      placeholder="3306"
                    />
                  </div>
                </div>
                
                <div className="form-group">
                  <label htmlFor="mysqlDatabase">Database Name</label>
                  <input
                    type="text"
                    id="mysqlDatabase"
                    value={formData.mysqlDatabase}
                    onChange={(e) => handleChange('mysqlDatabase', e.target.value)}
                    placeholder="imsms"
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="mysqlUsername">Username</label>
                  <input
                    type="text"
                    id="mysqlUsername"
                    value={formData.mysqlUsername}
                    onChange={(e) => handleChange('mysqlUsername', e.target.value)}
                    placeholder="medcp"
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="mysqlPassword">Password</label>
                  <div className="input-with-toggle">
                    <input
                      type={showDbPassword ? 'text' : 'password'}
                      id="mysqlPassword"
                      value={formData.mysqlPassword}
                      onChange={(e) => handleChange('mysqlPassword', e.target.value)}
                      placeholder="Database password"
                    />
                    <button
                      type="button"
                      className="toggle-visibility"
                      onClick={() => setShowDbPassword(!showDbPassword)}
                    >
                      {showDbPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
          
          {/* Backend Status */}
          <section className="settings-section">
            <h3>Backend Status</h3>
            <div className="status-panel">
              <div className="status-indicator">
                {backendStatus.status === 'running' ? (
                  <CheckCircle size={18} className="status-icon success" />
                ) : (
                  <AlertCircle size={18} className="status-icon error" />
                )}
                <span>
                  Python Backend: {backendStatus.status}
                  {backendStatus.port && ` (port ${backendStatus.port})`}
                </span>
              </div>
              
              <button 
                className="secondary-btn"
                onClick={handleRestartBackend}
              >
                <RefreshCw size={16} />
                Restart Backend
              </button>
            </div>
          </section>
          
          {/* Test Connection */}
          <section className="settings-section">
            <h3>Test Connection</h3>
            <button 
              className="test-btn"
              onClick={handleTestConnection}
              disabled={isTesting || !formData.openaiApiKey}
            >
              {isTesting ? (
                <>
                  <Loader2 size={16} className="spinner-icon" />
                  Testing...
                </>
              ) : (
                'Test OpenAI & Database Connection'
              )}
            </button>
            
            {testResult && (
              <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                {testResult.success ? (
                  <>
                    <CheckCircle size={18} />
                    <span>All connections successful!</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={18} />
                    <div className="test-details">
                      {testResult.results ? (
                        <>
                          <div>OpenAI: {testResult.results.openai.success ? '✓' : `✗ ${testResult.results.openai.message}`}</div>
                          <div>Database: {testResult.results.database.success ? '✓' : `✗ ${testResult.results.database.message}`}</div>
                        </>
                      ) : (
                        <span>{testResult.error}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
          
          {/* Save Message */}
          {saveMessage && (
            <div className={`save-message ${saveMessage.type}`}>
              {saveMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
              <span>{saveMessage.text}</span>
            </div>
          )}
        </div>
        
        <div className="settings-footer">
          <button className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="primary-btn"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="spinner-icon" />
                Saving...
              </>
            ) : (
              <>
                <Save size={16} />
                Save Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
