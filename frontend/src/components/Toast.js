import React, { useState, useEffect, useCallback } from 'react';
import './Toast.css';

// Toast Container manages multiple toasts
export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

// Individual Toast component
function Toast({ id, type, title, message, onClose }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const icons = {
    fire: '🔥',
    smoke: '💨',
    critical: '🚨',
    success: '✅',
    info: 'ℹ️'
  };

  return (
    <div className={`toast toast-${type}`}>
      <div className="toast-icon">{icons[type] || icons.info}</div>
      <div className="toast-content">
        <div className="toast-title">{title}</div>
        <div className="toast-message">{message}</div>
      </div>
      <button className="toast-close" onClick={onClose}>×</button>
      <div className="toast-progress"></div>
    </div>
  );
}

// Custom hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

export default Toast;
