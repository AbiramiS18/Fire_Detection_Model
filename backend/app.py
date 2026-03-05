import os
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from database import (init_db, get_events, get_events_count, clear_events, get_snapshots, 
                      delete_snapshot, get_session_snapshots)

# Import Celery task
from tasks import process_video_frame

# --- CONFIGURATION ---
UPLOAD_FOLDER = 'static/uploads'
PREDICT_FOLDER = 'static/predictions'
SNAPSHOTS_FOLDER = 'static/snapshots'

# Create folders if they don't exist
os.makedirs(SNAPSHOTS_FOLDER, exist_ok=True)

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000"], supports_credentials=True)

# Initialize SocketIO with Redis message queue
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
socketio = SocketIO(app, cors_allowed_origins=["http://localhost:3000", "http://127.0.0.1:3000"], async_mode='threading', message_queue=redis_url)

# Initialize database
init_db()

# --- WEBSOCKET EVENT HANDLERS ---
@socketio.on('video_frame')
def handle_video_frame(data):
    if not data or 'frame' not in data:
        return
    
    # Dispatch inference to Celery task asynchronously
    process_video_frame.delay(data['frame'])

@socketio.on('get_events')
def handle_get_events():
    """Send stored events from database."""
    events = get_events(limit=100)
    total_count = get_events_count()
    emit('events_history', {'events': events, 'total_count': total_count})

@socketio.on('clear_events')
def handle_clear_events():
    """Clear all stored events in database."""
    clear_events()
    emit('events_history', {'events': []})

# --- REST API ENDPOINTS ---
@app.route('/api/snapshots', methods=['GET'])
def api_get_snapshots():
    """Get list of saved snapshots."""
    snapshots = get_snapshots(limit=50)
    return jsonify({'snapshots': snapshots})

@app.route('/api/session/<int:session_id>/snapshots', methods=['GET'])
def api_get_session_snapshots(session_id):
    """Get all snapshots for a specific detection session."""
    snapshots = get_session_snapshots(session_id)
    return jsonify({'snapshots': snapshots, 'session_id': session_id})

@app.route('/api/snapshots/<int:snapshot_id>', methods=['DELETE'])
def api_delete_snapshot(snapshot_id):
    """Delete a snapshot."""
    filename = delete_snapshot(snapshot_id)
    if filename:
        filepath = os.path.join(SNAPSHOTS_FOLDER, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({'success': True})
    return jsonify({'error': 'Snapshot not found'}), 404

@app.route('/static/snapshots/<path:filename>')
def serve_snapshot(filename):
    """Serve snapshot images."""
    return send_from_directory(SNAPSHOTS_FOLDER, filename)

if __name__ == '__main__':
    print("Starting Flask SocketIO Server with Redis Message Queue...")
    socketio.run(app, debug=False, host='0.0.0.0', port=5001)