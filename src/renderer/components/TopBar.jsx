import React from 'react';
import { Settings, HelpCircle, Database } from 'lucide-react';
import './TopBar.css';

const TopBar = ({ onSettingsClick, onHelpClick, currentView }) => {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="app-logo">
          <Database className="logo-icon" size={24} />
          <span className="app-name">MS Console</span>
        </div>
        <span className="app-subtitle">MS Database Explorer</span>
      </div>
      
      <div className="topbar-right">
        <button
          className={`topbar-btn ${currentView === 'settings' ? 'active' : ''}`}
          onClick={onSettingsClick}
          title="Settings"
        >
          <Settings size={20} />
        </button>
        <button
          className="topbar-btn"
          onClick={onHelpClick}
          title="Help"
        >
          <HelpCircle size={20} />
        </button>
      </div>
    </header>
  );
};

export default TopBar;
