import os
import cv2
import numpy as np
import base64
from datetime import datetime
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from ultralytics import YOLO
from database import (init_db, get_events, get_events_count, clear_events, add_snapshot, get_snapshots, 
                      delete_snapshot, start_detection_session, end_detection_session, delete_detection_session,
                      update_session_status, update_session_snapshot, get_session_snapshots)

# --- CONFIGURATION ---
UPLOAD_FOLDER = 'static/uploads'
PREDICT_FOLDER = 'static/predictions'
SNAPSHOTS_FOLDER = 'static/snapshots'
MODEL_PATH = 'best.pt'

# Create folders if they don't exist
os.makedirs(SNAPSHOTS_FOLDER, exist_ok=True)

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000"], supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins=["http://localhost:3000", "http://127.0.0.1:3000"], async_mode='threading')

# Initialize database
init_db()

# Load Model
try:
    model = YOLO(MODEL_PATH)
    print(f"YOLO model loaded successfully from {MODEL_PATH}")
except Exception as e:
    print(f"Error loading model: {e}")

# --- GLOBAL STATE ---
CRITICAL_TIME_THRESHOLD = 30  # 30 seconds of continuous fire detection for critical alert
fire_detection_start_time = None  # Track when fire was first detected
smoke_detection_start_time = None  # Track when smoke was first detected
current_alert_status = "SAFE"
last_snapshot_time = 0  # Prevent snapshot spam

# Session tracking
current_fire_session_id = None
current_smoke_session_id = None
current_firefighter_session_id = None
current_person_session_id = None
current_fire_session_status = None
current_smoke_session_status = None
fire_session_start_time = None  # Track session start for duration calculation
smoke_session_start_time = None
firefighter_session_start_time = None
person_session_start_time = None

# Snapshot interval tracking (capture every 10 seconds)
SNAPSHOT_INTERVAL = 10
fire_last_snapshot_second = -SNAPSHOT_INTERVAL  # Last second a fire snapshot was taken
smoke_last_snapshot_second = -SNAPSHOT_INTERVAL  # Last second a smoke snapshot was taken
firefighter_last_snapshot_second = -SNAPSHOT_INTERVAL  # Last second a firefighter snapshot was taken
person_last_snapshot_second = -SNAPSHOT_INTERVAL  # Last second a person snapshot was taken

# --- HELPER FUNCTIONS ---
def apply_contextual_logic(result, detections):
    global fire_detection_start_time, smoke_detection_start_time, current_alert_status

    is_fire = any(d['class'] == 'fire' for d in detections)
    is_smoke = any(d['class'] == 'smoke' for d in detections)
    
    current_time = datetime.now().timestamp()
    is_critical_alert = False
    fire_duration = 0
    
    # Track fire detection time
    if is_fire:
        if fire_detection_start_time is None:
            fire_detection_start_time = current_time
        fire_duration = current_time - fire_detection_start_time
    else:
        fire_detection_start_time = None
    
    # Track smoke detection time (separate from fire)
    if is_smoke:
        if smoke_detection_start_time is None:
            smoke_detection_start_time = current_time
    else:
        smoke_detection_start_time = None
    
    # Critical alert ONLY for fire detected for more than 30 seconds
    if is_fire and fire_duration >= CRITICAL_TIME_THRESHOLD:
        current_alert_status = f"CRITICAL: FIRE DETECTED FOR {int(fire_duration)}s!"
        is_critical_alert = True
    elif is_fire:
        current_alert_status = f"WARNING: Fire detected ({int(fire_duration)}s / {CRITICAL_TIME_THRESHOLD}s)"
    elif is_smoke:
        smoke_duration = current_time - smoke_detection_start_time if smoke_detection_start_time else 0
        current_alert_status = f"CAUTION: Smoke detected ({int(smoke_duration)}s)"
    else:
        current_alert_status = "SAFE"

    return is_critical_alert, current_alert_status, fire_duration

def save_snapshot(frame, detection_type, confidence, is_critical, session_id=None, capture_second=0):
    """Save a detection snapshot linked to a session."""
    # Generate filename with timestamp and capture second
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{detection_type}_{timestamp}_{capture_second}s.jpg"
    filepath = os.path.join(SNAPSHOTS_FOLDER, filename)
    
    # Save the image
    cv2.imwrite(filepath, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    
    # Save to database with session link
    add_snapshot(filename, detection_type, confidence, is_critical, session_id, capture_second)
    
    print(f"Snapshot saved: {filename} (session {session_id}, {capture_second}s)")
    return filename

# --- WEBSOCKET EVENT HANDLERS ---
@socketio.on('video_frame')
def handle_video_frame(data):
    global fire_detection_start_time, smoke_detection_start_time, current_alert_status
    global current_fire_session_id, current_smoke_session_id
    global current_firefighter_session_id, current_person_session_id
    global current_fire_session_status, current_smoke_session_status
    global fire_session_start_time, smoke_session_start_time
    global firefighter_session_start_time, person_session_start_time
    global fire_last_snapshot_second, smoke_last_snapshot_second
    global firefighter_last_snapshot_second, person_last_snapshot_second
    
    if not data or 'frame' not in data:
        return
    
    try:
        # 1. Decode the frame
        nparr = np.frombuffer(base64.b64decode(data['frame']), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise ValueError("Could not decode image.")

        # 2. Run Inference
        results = model.predict(source=frame, verbose=False, conf=0.25)
        result = results[0]

        # 3. Extract Detection Data
        detections = []
        for box in result.boxes:
            class_id = int(box.cls[0])
            detections.append({
                "class": model.names[class_id],
                "confidence": float(box.conf[0])
            })
        
        # 4. Apply Contextual Logic
        is_critical_alert, status_message, fire_duration = apply_contextual_logic(result, detections)

        # 5. Plot the result onto the frame
        plotted_frame = result.plot()

        # 6. Manage detection sessions
        is_fire = any(d['class'] == 'fire' for d in detections)
        is_smoke = any(d['class'] == 'smoke' for d in detections)
        is_firefighter = any(d['class'] == 'firefighter' for d in detections)
        is_person = any(d['class'] == 'person' for d in detections)
        
        # Fire session management
        if is_fire:
            current_time = datetime.now().timestamp()
            if current_fire_session_id is None:
                # Start new fire session
                status = 'critical' if is_critical_alert else 'warning'
                current_fire_session_id = start_detection_session('fire', status)
                current_fire_session_status = status
                fire_session_start_time = current_time  # Track when session started
                # Emit new session start
                socketio.emit('new_event', {
                    'timestamp': datetime.now().isoformat(),
                    'type': 'fire',
                    'is_critical': is_critical_alert,
                    'duration': 0,
                    'status': status
                })
            else:
                # Calculate current session duration
                session_duration = int(current_time - fire_session_start_time) if fire_session_start_time else 0
                # Check if status changed from warning to critical
                new_status = 'critical' if is_critical_alert else 'warning'
                if new_status == 'critical' and current_fire_session_status == 'warning':
                    # End warning session with its duration
                    end_detection_session(current_fire_session_id, session_duration)
                    # Start new critical session
                    current_fire_session_id = start_detection_session('fire', 'critical')
                    current_fire_session_status = 'critical'
                    fire_session_start_time = current_time  # Reset start time for new session
                    # Emit new critical session
                    socketio.emit('new_event', {
                        'timestamp': datetime.now().isoformat(),
                        'type': 'fire',
                        'is_critical': True,
                        'duration': 0,
                        'status': 'critical'
                    })
                else:
                    # Just update duration
                    update_session_status(current_fire_session_id, new_status, session_duration)
        else:
            if current_fire_session_id is not None:
                # End fire session - calculate final duration from stored start time
                current_time = datetime.now().timestamp()
                final_duration = int(current_time - fire_session_start_time) if fire_session_start_time else 0
                
                # Only keep events with duration > 10 seconds
                if final_duration > 10:
                    end_detection_session(current_fire_session_id, final_duration)
                else:
                    # Delete short sessions from database
                    delete_detection_session(current_fire_session_id)
                
                current_fire_session_id = None
                current_fire_session_status = None
                fire_session_start_time = None
                fire_last_snapshot_second = -SNAPSHOT_INTERVAL  # Reset snapshot timing
        
        # Smoke session management
        if is_smoke and not is_fire:  # Only track smoke if no fire
            current_time = datetime.now().timestamp()
            if current_smoke_session_id is None:
                current_smoke_session_id = start_detection_session('smoke', 'warning')
                smoke_session_start_time = current_time  # Track when smoke session started
                socketio.emit('new_event', {
                    'timestamp': datetime.now().isoformat(),
                    'type': 'smoke',
                    'is_critical': False,
                    'duration': 0,
                    'status': 'warning'
                })
        else:
            if current_smoke_session_id is not None:
                current_time = datetime.now().timestamp()
                smoke_dur = int(current_time - smoke_session_start_time) if smoke_session_start_time else 0
                
                # Only keep events with duration > 10 seconds
                if smoke_dur > 10:
                    end_detection_session(current_smoke_session_id, smoke_dur)
                else:
                    delete_detection_session(current_smoke_session_id)
                
                current_smoke_session_id = None
                smoke_session_start_time = None
                smoke_last_snapshot_second = -SNAPSHOT_INTERVAL  # Reset snapshot timing
        
        # Firefighter session management (track when firefighter is detected)
        if is_firefighter:
            current_time = datetime.now().timestamp()
            if current_firefighter_session_id is None:
                current_firefighter_session_id = start_detection_session('firefighter', 'info')
                firefighter_session_start_time = current_time
                socketio.emit('new_event', {
                    'timestamp': datetime.now().isoformat(),
                    'type': 'firefighter',
                    'is_critical': False,
                    'duration': 0,
                    'status': 'info'
                })
        else:
            if current_firefighter_session_id is not None:
                current_time = datetime.now().timestamp()
                ff_dur = int(current_time - firefighter_session_start_time) if firefighter_session_start_time else 0
                
                # Only keep events with duration > 10 seconds
                if ff_dur > 10:
                    end_detection_session(current_firefighter_session_id, ff_dur)
                else:
                    delete_detection_session(current_firefighter_session_id)
                
                current_firefighter_session_id = None
                firefighter_session_start_time = None
                firefighter_last_snapshot_second = -SNAPSHOT_INTERVAL  # Reset snapshot timing
        
        # Person session management (track when person is detected)
        if is_person:
            current_time = datetime.now().timestamp()
            if current_person_session_id is None:
                current_person_session_id = start_detection_session('person', 'info')
                person_session_start_time = current_time
                socketio.emit('new_event', {
                    'timestamp': datetime.now().isoformat(),
                    'type': 'person',
                    'is_critical': False,
                    'duration': 0,
                    'status': 'info'
                })
        else:
            if current_person_session_id is not None:
                current_time = datetime.now().timestamp()
                person_dur = int(current_time - person_session_start_time) if person_session_start_time else 0
                
                # Only keep events with duration > 10 seconds
                if person_dur > 10:
                    end_detection_session(current_person_session_id, person_dur)
                else:
                    delete_detection_session(current_person_session_id)
                
                current_person_session_id = None
                person_session_start_time = None
                person_last_snapshot_second = -SNAPSHOT_INTERVAL  # Reset snapshot timing
        
        # Save snapshots at 10-second intervals for ALL detection events
        # Fire detection (both critical and warning)
        if is_fire and current_fire_session_id and fire_session_start_time:
            current_time = datetime.now().timestamp()
            session_duration = int(current_time - fire_session_start_time)
            # Check if we should take a snapshot (every 10 seconds)
            if session_duration >= fire_last_snapshot_second + SNAPSHOT_INTERVAL:
                fire_last_snapshot_second = session_duration
                snapshot_filename = save_snapshot(
                    plotted_frame, 'fire', 
                    detections[0]['confidence'] if detections else 0.5, 
                    is_critical_alert,
                    current_fire_session_id,
                    session_duration
                )
                if snapshot_filename:
                    update_session_snapshot(current_fire_session_id, snapshot_filename)
        
        # Smoke detection
        if is_smoke and current_smoke_session_id and smoke_session_start_time:
            current_time = datetime.now().timestamp()
            session_duration = int(current_time - smoke_session_start_time)
            # Check if we should take a snapshot (every 10 seconds)
            if session_duration >= smoke_last_snapshot_second + SNAPSHOT_INTERVAL:
                smoke_last_snapshot_second = session_duration
                smoke_conf = next((d['confidence'] for d in detections if d['class'] == 'smoke'), 0.5)
                snapshot_filename = save_snapshot(
                    plotted_frame, 'smoke', 
                    smoke_conf, 
                    False,
                    current_smoke_session_id,
                    session_duration
                )
                if snapshot_filename:
                    update_session_snapshot(current_smoke_session_id, snapshot_filename)
        
        # Firefighter detection
        if is_firefighter and current_firefighter_session_id and firefighter_session_start_time:
            current_time = datetime.now().timestamp()
            session_duration = int(current_time - firefighter_session_start_time)
            # Check if we should take a snapshot (every 10 seconds)
            if session_duration >= firefighter_last_snapshot_second + SNAPSHOT_INTERVAL:
                firefighter_last_snapshot_second = session_duration
                ff_conf = next((d['confidence'] for d in detections if d['class'] == 'firefighter'), 0.5)
                snapshot_filename = save_snapshot(
                    plotted_frame, 'firefighter', 
                    ff_conf, 
                    False,
                    current_firefighter_session_id,
                    session_duration
                )
                if snapshot_filename:
                    update_session_snapshot(current_firefighter_session_id, snapshot_filename)
        
        # Person detection
        if is_person and current_person_session_id and person_session_start_time:
            current_time = datetime.now().timestamp()
            session_duration = int(current_time - person_session_start_time)
            # Check if we should take a snapshot (every 10 seconds)
            if session_duration >= person_last_snapshot_second + SNAPSHOT_INTERVAL:
                person_last_snapshot_second = session_duration
                person_conf = next((d['confidence'] for d in detections if d['class'] == 'person'), 0.5)
                snapshot_filename = save_snapshot(
                    plotted_frame, 'person', 
                    person_conf, 
                    False,
                    current_person_session_id,
                    session_duration
                )
                if snapshot_filename:
                    update_session_snapshot(current_person_session_id, snapshot_filename)
        
        # 7. Encode and send
        _, buffer = cv2.imencode('.jpg', plotted_frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        encoded_image = base64.b64encode(buffer).decode('utf-8')

        emit('detection_result', {
            'frame': encoded_image,
            'detections': detections,
            'alert_status': status_message,
            'is_critical': is_critical_alert
        })

    except Exception as e:
        print(f"Processing Error: {e}")
        emit('detection_result', {'error': 'Backend processing error.'})

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
    print("Starting Flask SocketIO Server with SQLite...")
    socketio.run(app, debug=False, host='0.0.0.0', port=5001)