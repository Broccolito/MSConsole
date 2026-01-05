import React, { useState } from 'react';
import { Plus, MessageSquare, Trash2, Edit2, Check, X } from 'lucide-react';
import './Sidebar.css';

const Sidebar = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onRenameConversation,
  onDeleteConversation,
}) => {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  
  const handleStartEdit = (conv, e) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditName(conv.name);
  };
  
  const handleSaveEdit = (e) => {
    e.stopPropagation();
    if (editName.trim()) {
      onRenameConversation(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName('');
  };
  
  const handleCancelEdit = (e) => {
    e.stopPropagation();
    setEditingId(null);
    setEditName('');
  };
  
  const handleDelete = (id, e) => {
    e.stopPropagation();
    if (window.confirm('Delete this conversation?')) {
      onDeleteConversation(id);
    }
  };
  
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={onNewConversation}>
          <Plus size={18} />
          <span>New Chat</span>
        </button>
      </div>
      
      <div className="conversations-list">
        {conversations.map(conv => (
          <div
            key={conv.id}
            className={`conversation-item ${conv.id === activeConversationId ? 'active' : ''}`}
            onClick={() => onSelectConversation(conv.id)}
          >
            <MessageSquare size={16} className="conv-icon" />
            
            {editingId === conv.id ? (
              <div className="edit-name-container" onClick={e => e.stopPropagation()}>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveEdit(e);
                    if (e.key === 'Escape') handleCancelEdit(e);
                  }}
                  autoFocus
                  className="edit-name-input"
                />
                <button className="edit-btn save" onClick={handleSaveEdit}>
                  <Check size={14} />
                </button>
                <button className="edit-btn cancel" onClick={handleCancelEdit}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <span className="conv-name">{conv.name}</span>
                <div className="conv-actions">
                  <button
                    className="conv-action-btn"
                    onClick={(e) => handleStartEdit(conv, e)}
                    title="Rename"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="conv-action-btn delete"
                    onClick={(e) => handleDelete(conv.id, e)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      
      <div className="sidebar-footer">
        <div className="sidebar-info">
          <span className="info-text">UCSF MS Database</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
