import sqlite3
import os
from datetime import datetime

DATABASE_PATH = 'fire_detection.db'

def get_db_connection():
    """Create a database connection."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Detection Sessions table - stores start/end times for detection events
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS detection_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time TEXT NOT NULL,
            end_time TEXT,
            detection_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'warning',
            duration_seconds INTEGER DEFAULT 0,
            snapshot_filename TEXT
        )
    ''')
    
    # Snapshots table - now linked to sessions with capture timing
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            timestamp TEXT NOT NULL,
            filename TEXT NOT NULL,
            detection_type TEXT NOT NULL,
            confidence REAL NOT NULL,
            is_critical INTEGER DEFAULT 0,
            capture_second INTEGER DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES detection_sessions(id)
        )
    ''')
    
    # Add session_id column if it doesn't exist (for existing databases)
    try:
        cursor.execute('ALTER TABLE snapshots ADD COLUMN session_id INTEGER')
    except:
        pass
    
    try:
        cursor.execute('ALTER TABLE snapshots ADD COLUMN capture_second INTEGER DEFAULT 0')
    except:
        pass
    
    conn.commit()
    conn.close()
    print("Database initialized successfully")

def start_detection_session(detection_type, status='warning'):
    """Start a new detection session."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO detection_sessions (start_time, detection_type, status)
        VALUES (?, ?, ?)
    ''', (datetime.now().isoformat(), detection_type, status))
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return session_id

def update_session_status(session_id, status, duration):
    """Update session status and duration."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE detection_sessions 
        SET status = ?, duration_seconds = ?
        WHERE id = ?
    ''', (status, duration, session_id))
    conn.commit()
    conn.close()

def end_detection_session(session_id, duration):
    """End a detection session with final duration."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE detection_sessions 
        SET end_time = ?, duration_seconds = ?
        WHERE id = ?
    ''', (datetime.now().isoformat(), duration, session_id))
    conn.commit()
    conn.close()

def delete_detection_session(session_id):
    """Delete a detection session (used for sessions with duration <= 10 seconds)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    # Also delete any snapshots linked to this session
    cursor.execute('DELETE FROM snapshots WHERE session_id = ?', (session_id,))
    cursor.execute('DELETE FROM detection_sessions WHERE id = ?', (session_id,))
    conn.commit()
    conn.close()

def get_events(limit=100):
    """Get recent detection sessions from the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, start_time as timestamp, end_time, detection_type as type, 
               status, duration_seconds as duration, snapshot_filename
        FROM detection_sessions 
        ORDER BY start_time DESC 
        LIMIT ?
    ''', (limit,))
    events = [dict(row) for row in cursor.fetchall()]
    # Convert status to is_critical for frontend compatibility
    for event in events:
        event['is_critical'] = event['status'] == 'critical'
    conn.close()
    return events

def get_events_count():
    """Get total count of detection sessions in the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) as count FROM detection_sessions')
    result = cursor.fetchone()
    conn.close()
    return result['count'] if result else 0

def update_session_snapshot(session_id, filename):
    """Update a session with its snapshot filename."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE detection_sessions 
        SET snapshot_filename = ?
        WHERE id = ?
    ''', (filename, session_id))
    conn.commit()
    conn.close()

def clear_events():
    """Clear all detection sessions from the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM detection_sessions')
    conn.commit()
    conn.close()

def add_snapshot(filename, detection_type, confidence, is_critical, session_id=None, capture_second=0):
    """Add a snapshot record to the database linked to a session."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO snapshots (session_id, timestamp, filename, detection_type, confidence, is_critical, capture_second)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (session_id, datetime.now().isoformat(), filename, detection_type, confidence, 1 if is_critical else 0, capture_second))
    snapshot_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return snapshot_id

def get_session_snapshots(session_id):
    """Get all snapshots for a specific session."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, timestamp, filename, detection_type as type, confidence, is_critical, capture_second
        FROM snapshots 
        WHERE session_id = ?
        ORDER BY capture_second ASC
    ''', (session_id,))
    snapshots = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return snapshots

def get_snapshots(limit=50):
    """Get recent snapshots from the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, timestamp, filename, detection_type as type, confidence, is_critical 
        FROM snapshots 
        ORDER BY timestamp DESC 
        LIMIT ?
    ''', (limit,))
    snapshots = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return snapshots

def delete_snapshot(snapshot_id):
    """Delete a snapshot by ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT filename FROM snapshots WHERE id = ?', (snapshot_id,))
    row = cursor.fetchone()
    if row:
        cursor.execute('DELETE FROM snapshots WHERE id = ?', (snapshot_id,))
        conn.commit()
        conn.close()
        return row['filename']
    conn.close()
    return None
