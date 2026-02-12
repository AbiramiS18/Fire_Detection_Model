import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Sidebar.css';

function Sidebar({ isCollapsed, toggleSidebar }) {
  const location = useLocation();

  const handleLinkClick = () => {
    // Close sidebar after clicking a link
    if (toggleSidebar) {
      toggleSidebar();
    }
  };

  return (
    <>
      {/* Overlay when sidebar is open */}
      {!isCollapsed && <div className="sidebar-overlay" onClick={toggleSidebar}></div>}
      
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="fire-icon">&#128293;</span>
            <span className="brand-text">FireGuard AI</span>
          </div>
          <button className="sidebar-close" onClick={toggleSidebar} title="Close menu">
            &#10005;
          </button>
        </div>
        
        <nav className="sidebar-nav">
          <Link 
            to="/" 
            className={`sidebar-link ${location.pathname === '/' ? 'active' : ''}`}
            onClick={handleLinkClick}
          >
            <span className="sidebar-icon">&#128249;</span>
            <span className="sidebar-text">Detection</span>
          </Link>
          <Link 
            to="/dashboard" 
            className={`sidebar-link ${location.pathname === '/dashboard' ? 'active' : ''}`}
            onClick={handleLinkClick}
          >
            <span className="sidebar-icon">&#128202;</span>
            <span className="sidebar-text">Dashboard</span>
          </Link>
        </nav>
        
        <div className="sidebar-footer">
          <div className="sidebar-version">v1.0.0</div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;

