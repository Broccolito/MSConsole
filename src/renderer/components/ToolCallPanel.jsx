import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, Check, Loader2, Copy } from 'lucide-react';
import './ToolCallPanel.css';

const ToolCallPanel = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [argsCopied, setArgsCopied] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);
  
  const isRunning = toolCall.status === 'running';
  const isComplete = toolCall.status === 'complete';
  
  const handleCopyArgs = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(JSON.stringify(toolCall.arguments, null, 2));
      setArgsCopied(true);
      setTimeout(() => setArgsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  const handleCopyResult = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(toolCall.result || '');
      setResultCopied(true);
      setTimeout(() => setResultCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  // Get a friendly name for the tool
  const getToolDisplayName = (name) => {
    switch (name) {
      case 'list_tables':
        return 'List Database Tables';
      case 'execute_query':
        return 'Execute SQL Query';
      default:
        return name;
    }
  };
  
  return (
    <div className={`tool-call-panel ${isRunning ? 'running' : ''} ${isComplete ? 'complete' : ''}`}>
      <button 
        className="tool-call-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="tool-call-title">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Wrench size={14} className="tool-icon" />
          <span className="tool-name">{getToolDisplayName(toolCall.name)}</span>
        </div>
        
        <div className="tool-call-status">
          {isRunning && (
            <>
              <Loader2 size={14} className="spinner-icon" />
              <span>Running...</span>
            </>
          )}
          {isComplete && (
            <>
              <Check size={14} className="check-icon" />
              <span>Complete</span>
            </>
          )}
        </div>
      </button>
      
      {isExpanded && (
        <div className="tool-call-body">
          {/* Arguments section */}
          <div className="tool-section">
            <div className="section-header">
              <span className="section-title">Arguments</span>
              <button 
                className="copy-btn"
                onClick={handleCopyArgs}
                title="Copy arguments"
              >
                {argsCopied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
            <pre className="tool-content">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
          
          {/* Result section */}
          {toolCall.result && (
            <div className="tool-section">
              <div className="section-header">
                <span className="section-title">Result</span>
                <button 
                  className="copy-btn"
                  onClick={handleCopyResult}
                  title="Copy result"
                >
                  {resultCopied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <pre className="tool-content result">
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallPanel;
