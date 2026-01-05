import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, AlertCircle, ArrowDown, Loader2, X, Settings } from 'lucide-react';
import MessageBubble from './MessageBubble';
import ToolCallPanel from './ToolCallPanel';
import './ChatView.css';

const ChatView = ({
  conversation,
  onUpdateMessages,
  settings,
  backendPort,
  backendStatus,
  isApiKeyMissing,
  onOpenSettings,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentToolCalls, setCurrentToolCalls] = useState([]);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [dismissedBanners, setDismissedBanners] = useState({
    apiKey: false,
    backend: false,
  });
  
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  
  // Reset dismissed banners when settings change
  useEffect(() => {
    setDismissedBanners({ apiKey: false, backend: false });
  }, [settings.openaiApiKey]);
  
  // Auto-scroll to bottom
  const scrollToBottom = useCallback((force = false) => {
    if (messagesEndRef.current) {
      const container = messagesContainerRef.current;
      const isNearBottom = container 
        ? container.scrollHeight - container.scrollTop - container.clientHeight < 100
        : true;
      
      if (force || isNearBottom) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        setShowScrollButton(false);
      }
    }
  }, []);
  
  // Check scroll position
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      setShowScrollButton(!isNearBottom && isStreaming);
    }
  }, [isStreaming]);
  
  // Scroll on new messages or streaming
  useEffect(() => {
    scrollToBottom();
  }, [conversation.messages, streamingContent, scrollToBottom]);
  
  // Focus input on load
  useEffect(() => {
    if (inputRef.current && !isApiKeyMissing) {
      inputRef.current.focus();
    }
  }, [conversation.id, isApiKeyMissing]);
  
  // Dismiss a banner
  const dismissBanner = (bannerType) => {
    setDismissedBanners(prev => ({ ...prev, [bannerType]: true }));
  };
  
  // Send message with streaming via IPC (avoids CORS issues)
  const sendMessage = async () => {
    const message = inputValue.trim();
    if (!message || isStreaming) return;
    
    // Clear input
    setInputValue('');
    setIsStreaming(true);
    setStreamingContent('');
    setCurrentToolCalls([]);
    
    // Add user message
    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };
    
    const updatedMessages = [...conversation.messages, userMessage];
    onUpdateMessages(updatedMessages);
    
    // Prepare conversation history for API
    const conversationHistory = conversation.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
    
    // Track state for event handling
    let fullContent = '';
    let toolCalls = [];
    let hasError = false;
    
    console.log(`[MSConsole] Sending message via IPC`);
    console.log(`[MSConsole] Model: ${settings.model}`);
    console.log(`[MSConsole] Message: ${message.substring(0, 50)}...`);
    
    // Set up event listener for streaming events
    const cleanup = window.electronAPI.onChatEvent((event) => {
      console.log(`[MSConsole] Received event: ${event.type}`);
      
      switch (event.type) {
        case 'token':
          fullContent += event.content;
          if (settings.streamTokens) {
            setStreamingContent(fullContent);
          }
          break;
          
        case 'tool_call_start':
          if (settings.showToolCalls) {
            const newToolCall = {
              id: event.tool_id,
              name: event.tool_name,
              arguments: event.arguments,
              result: null,
              status: 'running',
            };
            toolCalls = [...toolCalls, newToolCall];
            setCurrentToolCalls([...toolCalls]);
          }
          break;
          
        case 'tool_call_end':
          if (settings.showToolCalls) {
            toolCalls = toolCalls.map(tc =>
              tc.id === event.tool_id
                ? { ...tc, result: event.result, status: 'complete' }
                : tc
            );
            setCurrentToolCalls([...toolCalls]);
          }
          break;
          
        case 'done':
          fullContent = event.content || fullContent;
          // Always show final content, regardless of streamTokens setting
          setStreamingContent(fullContent);
          break;
          
        case 'error':
          hasError = true;
          console.error('[MSConsole] Stream error:', event.message);
          
          // Add error message
          const errorMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Error: ${event.message}. Please check your settings and try again.`,
            isError: true,
            timestamp: Date.now(),
          };
          onUpdateMessages([...updatedMessages, errorMessage]);
          
          // Clean up
          cleanup();
          setIsStreaming(false);
          setStreamingContent('');
          setCurrentToolCalls([]);
          break;
      }
    });
    
    try {
      // Start the chat stream via IPC
      const result = await window.electronAPI.chatStream(message, conversationHistory, settings.model);
      
      console.log('[MSConsole] Stream completed:', result);
      
      // Clean up event listener
      cleanup();
      
      // If no error occurred, add the assistant message
      if (!hasError && fullContent) {
        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: fullContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: Date.now(),
        };
        onUpdateMessages([...updatedMessages, assistantMessage]);
      } else if (!hasError && !fullContent) {
        // No content received - something went wrong
        const errorMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'No response received from the assistant. Please try again.',
          isError: true,
          timestamp: Date.now(),
        };
        onUpdateMessages([...updatedMessages, errorMessage]);
      }
      
    } catch (error) {
      console.error('[MSConsole] Chat error:', error);
      cleanup();
      
      // Add error message
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error.message}. Please check your settings and try again.`,
        isError: true,
        timestamp: Date.now(),
      };
      onUpdateMessages([...updatedMessages, errorMessage]);
      
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      setCurrentToolCalls([]);
    }
  };
  
  // Handle input key press
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  
  // Cancel streaming via IPC
  const cancelStreaming = async () => {
    try {
      await window.electronAPI.cancelChat();
      console.log('[MSConsole] Chat cancelled');
    } catch (error) {
      console.error('[MSConsole] Failed to cancel chat:', error);
    }
  };
  
  // Show API key prompt banner (not an error, just informative)
  const showApiKeyBanner = isApiKeyMissing && !dismissedBanners.apiKey;
  
  // Show backend error banner only when we have an API key but backend isn't running
  const showBackendBanner = !isApiKeyMissing && 
    backendStatus.status !== 'running' && 
    backendStatus.status !== 'checking' && 
    !dismissedBanners.backend;
  
  return (
    <div className="chat-view">
      {/* Info banner for missing API key - friendly prompt, not an error */}
      {showApiKeyBanner && (
        <div className="info-banner">
          <Settings size={18} />
          <span>Welcome! Please configure your OpenAI API key to get started.</span>
          <button className="banner-btn" onClick={onOpenSettings}>
            Open Settings
          </button>
          <button 
            className="banner-close" 
            onClick={() => dismissBanner('apiKey')}
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}
      
      {/* Backend status indicator - only show if API key is set but backend has issues */}
      {showBackendBanner && (
        <div className="warning-banner warning-backend">
          <AlertCircle size={18} />
          <span>
            Backend status: {backendStatus.status}
            {backendStatus.message && ` - ${backendStatus.message}`}
          </span>
          <button 
            className="banner-close" 
            onClick={() => dismissBanner('backend')}
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}
      
      {/* Messages area */}
      <div 
        className="messages-container" 
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {conversation.messages.length === 0 && !isStreaming ? (
          <div className="empty-state">
            <img src="../../assets/icon.png" alt="MS Console" className="empty-icon" />
            <h2>Welcome to MS Console</h2>
            <p>
              Ask questions about the UCSF Multiple Sclerosis database.
              I can help you explore tables, run queries, and analyze data.
            </p>
            {isApiKeyMissing ? (
              <div className="setup-prompt">
                <p className="setup-text">To get started, please configure your OpenAI API key in Settings.</p>
                <button className="setup-btn" onClick={onOpenSettings}>
                  <Settings size={18} />
                  Open Settings
                </button>
              </div>
            ) : (
              <div className="example-queries">
                <span className="example-label">Try asking:</span>
                <button 
                  className="example-btn"
                  onClick={() => setInputValue('What tables are available in the database?')}
                >
                  "What tables are available?"
                </button>
                <button 
                  className="example-btn"
                  onClick={() => setInputValue('Show me the structure of the patients table')}
                >
                  "Show me the patients table structure"
                </button>
                <button 
                  className="example-btn"
                  onClick={() => setInputValue('How many patients are in the database?')}
                >
                  "How many patients are there?"
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="messages-list">
            {conversation.messages.map((msg) => (
              <div key={msg.id} className="message-wrapper">
                <MessageBubble message={msg} />
                {msg.toolCalls && settings.showToolCalls && (
                  <div className="tool-calls-container">
                    {msg.toolCalls.map((tc) => (
                      <ToolCallPanel key={tc.id} toolCall={tc} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            
            {/* Streaming content */}
            {isStreaming && (
              <div className="message-wrapper">
                {currentToolCalls.length > 0 && settings.showToolCalls && (
                  <div className="tool-calls-container">
                    {currentToolCalls.map((tc) => (
                      <ToolCallPanel key={tc.id} toolCall={tc} />
                    ))}
                  </div>
                )}
                {streamingContent && (
                  <MessageBubble 
                    message={{
                      role: 'assistant',
                      content: streamingContent,
                      isStreaming: true,
                    }} 
                  />
                )}
                {!streamingContent && currentToolCalls.length === 0 && (
                  <div className="streaming-indicator">
                    <Loader2 size={16} className="spinner-icon" />
                    <span>Thinking...</span>
                  </div>
                )}
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
        
        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button 
            className="scroll-bottom-btn"
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDown size={16} />
            Jump to latest
          </button>
        )}
      </div>
      
      {/* Input area */}
      <div className="input-container">
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isApiKeyMissing 
              ? "Configure API key in Settings to start chatting..." 
              : "Ask a question about the MS database..."
            }
            disabled={isStreaming || isApiKeyMissing}
            rows={1}
            className="chat-input"
          />
          <button
            onClick={isStreaming ? cancelStreaming : sendMessage}
            disabled={(!inputValue.trim() && !isStreaming) || isApiKeyMissing}
            className={`send-btn ${isStreaming ? 'cancel' : ''}`}
            title={isStreaming ? 'Cancel' : 'Send message'}
          >
            {isStreaming ? (
              <div className="spinner" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        <div className="input-hint">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
};

export default ChatView;
