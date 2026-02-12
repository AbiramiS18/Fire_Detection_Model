import React from 'react';
import './ImageModal.css';

function ImageModal({ isOpen, onClose, snapshot, baseUrl }) {
  if (!isOpen || !snapshot) return null;

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        
        <div className="modal-image-container">
          <img 
            src={`${baseUrl}/static/snapshots/${snapshot.filename}`} 
            alt="Detection snapshot"
            className="modal-image"
          />
        </div>
        
        <div className="modal-details">
          <div className="detail-row">
            <span className="detail-label">Detection Type:</span>
            <span className={`detail-value type-${snapshot.type}`}>
              {snapshot.type === 'fire' ? '🔥' : '💨'} {snapshot.type.toUpperCase()}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Confidence:</span>
            <span className="detail-value">{(snapshot.confidence * 100).toFixed(1)}%</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Captured:</span>
            <span className="detail-value">{formatTime(snapshot.timestamp)}</span>
          </div>
          {snapshot.is_critical ? (
            <div className="detail-critical">🚨 Critical Alert</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ImageModal;
