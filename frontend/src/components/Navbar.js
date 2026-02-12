import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Navbar.css';

function Navbar({ toggleSidebar, sidebarCollapsed }) {
  const { user, logout } = useAuth();
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : true; // Default to dark
  });
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle('light-mode', !isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  const handleLogout = () => {
    logout();
    setShowProfileMenu(false);
  };

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <button 
          className="menu-toggle" 
          onClick={toggleSidebar}
          title="Toggle menu"
        >
          <span className="menu-icon">&#9776;</span>
        </button>
        <h1 className="navbar-title">Fire Detection System</h1>
      </div>
      <div className="navbar-actions">
        <button 
          className="theme-toggle" 
          onClick={toggleTheme}
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDarkMode ? '☀️' : '🌙'}
        </button>
        
        {/* Profile Dropdown */}
        <div className="profile-dropdown" ref={profileRef}>
          <button 
            className="profile-btn"
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            title="Profile"
          >
            <span className="profile-emoji">&#128100;</span>
          </button>
          
          {showProfileMenu && (
            <div className="profile-menu">
              <div className="profile-menu-header">
                <span className="profile-avatar">&#128100;</span>
                <span className="profile-name">{user || 'User'}</span>
              </div>
              <div className="profile-menu-divider"></div>
              <button className="profile-menu-item logout" onClick={handleLogout}>
                <span>&#128682;</span>
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
