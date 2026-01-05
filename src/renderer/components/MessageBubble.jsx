import React, { useState } from 'react';
import { User, Bot, Copy, Check, AlertTriangle } from 'lucide-react';
import './MessageBubble.css';

const MessageBubble = ({ message }) => {
  const [copied, setCopied] = useState(false);
  
  const isUser = message.role === 'user';
  const isError = message.isError;
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  // Simple markdown-like rendering
  const renderContent = (content) => {
    if (!content) return null;
    
    // Split by code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, index) => {
      // Code block
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.slice(3, -3).split('\n');
        const language = lines[0].trim();
        const code = language ? lines.slice(1).join('\n') : lines.join('\n');
        
        return (
          <pre key={index} className="code-block">
            {language && <div className="code-language">{language}</div>}
            <code>{code}</code>
          </pre>
        );
      }
      
      // Regular text with inline formatting
      return (
        <span key={index}>
          {part.split('\n').map((line, lineIndex) => (
            <React.Fragment key={lineIndex}>
              {lineIndex > 0 && <br />}
              {renderInlineContent(line)}
            </React.Fragment>
          ))}
        </span>
      );
    });
  };
  
  // Render inline markdown (bold, code, etc.)
  const renderInlineContent = (text) => {
    // Bold
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    return <span dangerouslySetInnerHTML={{ __html: text }} />;
  };
  
  return (
    <div className={`message-bubble ${isUser ? 'user' : 'assistant'} ${isError ? 'error' : ''}`}>
      <div className="message-avatar">
        {isUser ? (
          <User size={18} />
        ) : (
          <Bot size={18} />
        )}
      </div>
      
      <div className="message-content">
        <div className="message-header">
          <span className="message-role">{isUser ? 'You' : 'MS Console'}</span>
          {message.isStreaming && (
            <span className="streaming-badge">Generating...</span>
          )}
        </div>
        
        <div className="message-text">
          {isError && <AlertTriangle size={16} className="error-icon" />}
          {renderContent(message.content)}
          {message.isStreaming && <span className="cursor-blink">▋</span>}
        </div>
        
        {!isUser && !message.isStreaming && (
          <div className="message-actions">
            <button 
              className="action-btn"
              onClick={handleCopy}
              title="Copy to clipboard"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
