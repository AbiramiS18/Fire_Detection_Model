import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('isAuthenticated') === 'true';
  });
  const [user, setUser] = useState(() => {
    return localStorage.getItem('user') || null;
  });

  useEffect(() => {
    localStorage.setItem('isAuthenticated', isAuthenticated);
    if (user) {
      localStorage.setItem('user', user);
    } else {
      localStorage.removeItem('user');
    }
  }, [isAuthenticated, user]);

  // Valid credentials - In production, this would be verified against a backend API
  const VALID_CREDENTIALS = {
    admin: 'admin123',
    user: 'user123',
    demo: 'demo123'
  };

  const login = (username, password) => {
    // Check if username and password are provided
    if (!username || !password) {
      return { success: false, error: 'Please enter username and password' };
    }

    // Check if username exists
    if (!VALID_CREDENTIALS.hasOwnProperty(username)) {
      return { success: false, error: 'Invalid username' };
    }

    // Check if password is correct
    if (VALID_CREDENTIALS[username] !== password) {
      return { success: false, error: 'Password is wrong' };
    }

    // Credentials are valid
    setIsAuthenticated(true);
    setUser(username);
    return { success: true };
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUser(null);
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('user');
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
