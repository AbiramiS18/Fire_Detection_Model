import os
import cv2
import numpy as np
import base64
from datetime import datetime
from celery import Celery
from flask_socketio import SocketIO
from ultralytics import YOLO

from database import (add_snapshot, start_detection_session, end_detection_session, 
                      delete_detection_session, update_session_status, update_session_snapshot)
from state_manager import StateManager

# --- CONFIGURATION ---
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
celery = Celery('tasks', broker=redis_url, backend=redis_url)

# SocketIO client configured to use Redis as message queue for emitting to frontend
socketio = SocketIO(message_queue=redis_url)

MODEL_PATH = 'best.pt'
SNAPSHOTS_FOLDER = 'static/snapshots'
os.makedirs(SNAPSHOTS_FOLDER, exist_ok=True)

# Load Model
try:
    model = YOLO(MODEL_PATH)
    print(f"YOLO model loaded successfully from {MODEL_PATH}")
except Exception as e:
    print(f"Error loading model: {e}")

CRITICAL_TIME_THRESHOLD = 30
SNAPSHOT_INTERVAL = 10

def apply_contextual_logic(result, detections):
    is_fire = any(d['class'] == 'fire' for d in detections)
    is_smoke = any(d['class'] == 'smoke' for d in detections)
    
    current_time = datetime.now().timestamp()
    is_critical_alert = False
    fire_duration = 0
    
    # Track fire detection time
    fire_detection_start_time = StateManager.get_float('fire_detection_start_time')
    if is_fire:
        if fire_detection_start_time is None:
            fire_detection_start_time = current_time
            StateManager.set('fire_detection_start_time', current_time)
        fire_duration = current_time - fire_detection_start_time
    else:
        StateManager.delete('fire_detection_start_time')
    
    # Track smoke detection time (separate from fire)
    smoke_detection_start_time = StateManager.get_float('smoke_detection_start_time')
    if is_smoke:
        if smoke_detection_start_time is None:
            smoke_detection_start_time = current_time
            StateManager.set('smoke_detection_start_time', current_time)
    else:
        StateManager.delete('smoke_detection_start_time')
    
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
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{detection_type}_{timestamp}_{capture_second}s.jpg"
    filepath = os.path.join(SNAPSHOTS_FOLDER, filename)
    
    cv2.imwrite(filepath, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    add_snapshot(filename, detection_type, confidence, is_critical, session_id, capture_second)
    return filename

@celery.task(name="process_video_frame")
def process_video_frame(frame_data):
    try:
        nparr = np.frombuffer(base64.b64decode(frame_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise ValueError("Could not decode image.")

        results = model.predict(source=frame, verbose=False, conf=0.25)
        result = results[0]

        detections = []
        for box in result.boxes:
            class_id = int(box.cls[0])
            detections.append({
                "class": model.names[class_id],
                "confidence": float(box.conf[0])
            })
        
        is_critical_alert, status_message, fire_duration = apply_contextual_logic(result, detections)
        plotted_frame = result.plot()

        is_fire = any(d['class'] == 'fire' for d in detections)
        is_smoke = any(d['class'] == 'smoke' for d in detections)
        is_firefighter = any(d['class'] == 'firefighter' for d in detections)
        is_person = any(d['class'] == 'person' for d in detections)
        
        current_time = datetime.now().timestamp()
        
        # --- Fire session management ---
        current_fire_session_id = StateManager.get_int('current_fire_session_id')
        current_fire_session_status = StateManager.get_str('current_fire_session_status')
        fire_session_start_time = StateManager.get_float('fire_session_start_time')
        fire_last_snapshot_second = StateManager.get_int('fire_last_snapshot_second', -SNAPSHOT_INTERVAL)
        
        if is_fire:
            if current_fire_session_id is None:
                status = 'critical' if is_critical_alert else 'warning'
                current_fire_session_id = start_detection_session('fire', status)
                StateManager.set('current_fire_session_id', current_fire_session_id)
                StateManager.set('current_fire_session_status', status)
                
                fire_session_start_time = current_time
                StateManager.set('fire_session_start_time', fire_session_start_time)
                
                socketio.emit('new_event', {
                    'timestamp': datetime.now().isoformat(),
                    'type': 'fire',
                    'is_critical': is_critical_alert,
                    'duration': 0,
                    'status': status
                })
            else:
                session_duration = int(current_time - fire_session_start_time) if fire_session_start_time else 0
                new_status = 'critical' if is_critical_alert else 'warning'
                if new_status == 'critical' and current_fire_session_status == 'warning':
                    end_detection_session(current_fire_session_id, session_duration)
                    
                    current_fire_session_id = start_detection_session('fire', 'critical')
                    StateManager.set('current_fire_session_id', current_fire_session_id)
                    StateManager.set('current_fire_session_status', 'critical')
                    
                    fire_session_start_time = current_time
                    StateManager.set('fire_session_start_time', fire_session_start_time)
                    
                    socketio.emit('new_event', {
                        'timestamp': datetime.now().isoformat(),
                        'type': 'fire',
                        'is_critical': True,
                        'duration': 0,
                        'status': 'critical'
                    })
                else:
                    update_session_status(current_fire_session_id, new_status, session_duration)
        else:
            if current_fire_session_id is not None:
                final_duration = int(current_time - fire_session_start_time) if fire_session_start_time else 0
                if final_duration > 10:
                    end_detection_session(current_fire_session_id, final_duration)
                else:
                    delete_detection_session(current_fire_session_id)
                
                StateManager.delete('current_fire_session_id')
                StateManager.delete('current_fire_session_status')
                StateManager.delete('fire_session_start_time')
                StateManager.delete('fire_last_snapshot_second')

        # --- Smoke session management ---
        current_smoke_session_id = StateManager.get_int('current_smoke_session_id')
        smoke_session_start_time = StateManager.get_float('smoke_session_start_time')
        smoke_last_snapshot_second = StateManager.get_int('smoke_last_snapshot_second', -SNAPSHOT_INTERVAL)

        if is_smoke and not is_fire:
            if current_smoke_session_id is None:
                current_smoke_session_id = start_detection_session('smoke', 'warning')
                StateManager.set('current_smoke_session_id', current_smoke_session_id)
                
                smoke_session_start_time = current_time
                StateManager.set('smoke_session_start_time', smoke_session_start_time)
                
                socketio.emit('new_event', {
                    'timestamp': datetime.now().isoformat(),
                    'type': 'smoke',
                    'is_critical': False,
                    'duration': 0,
                    'status': 'warning'
                })
        else:
            if current_smoke_session_id is not None:
                smoke_dur = int(current_time - smoke_session_start_time) if smoke_session_start_time else 0
                if smoke_dur > 10:
                    end_detection_session(current_smoke_session_id, smoke_dur)
                else:
                    delete_detection_session(current_smoke_session_id)
                
                StateManager.delete('current_smoke_session_id')
                StateManager.delete('smoke_session_start_time')
                StateManager.delete('smoke_last_snapshot_second')

        # --- Firefighter session management ---
        current_firefighter_session_id = StateManager.get_int('current_firefighter_session_id')
        firefighter_session_start_time = StateManager.get_float('firefighter_session_start_time')
        firefighter_last_snapshot_second = StateManager.get_int('firefighter_last_snapshot_second', -SNAPSHOT_INTERVAL)

        if is_firefighter:
            if current_firefighter_session_id is None:
                current_firefighter_session_id = start_detection_session('firefighter', 'info')
                StateManager.set('current_firefighter_session_id', current_firefighter_session_id)
                
                firefighter_session_start_time = current_time
                StateManager.set('firefighter_session_start_time', firefighter_session_start_time)
                
                socketio.emit('new_event', {
                    'timestamp': datetime.now().isoformat(),
                    'type': 'firefighter',
                    'is_critical': False,
                    'duration': 0,
                    'status': 'info'
                })
        else:
            if current_firefighter_session_id is not None:
                ff_dur = int(current_time - firefighter_session_start_time) if firefighter_session_start_time else 0
                if ff_dur > 10:
                    end_detection_session(current_firefighter_session_id, ff_dur)
                else:
                    delete_detection_session(current_firefighter_session_id)
                
                StateManager.delete('current_firefighter_session_id')
                StateManager.delete('firefighter_session_start_time')
                StateManager.delete('firefighter_last_snapshot_second')

        # --- Person session management ---
        current_person_session_id = StateManager.get_int('current_person_session_id')
        person_session_start_time = StateManager.get_float('person_session_start_time')
        person_last_snapshot_second = StateManager.get_int('person_last_snapshot_second', -SNAPSHOT_INTERVAL)

        if is_person:
            if current_person_session_id is None:
                current_person_session_id = start_detection_session('person', 'info')
                StateManager.set('current_person_session_id', current_person_session_id)
                
                person_session_start_time = current_time
                StateManager.set('person_session_start_time', person_session_start_time)
                
                socketio.emit('new_event', {
                    'timestamp': datetime.now().isoformat(),
                    'type': 'person',
                    'is_critical': False,
                    'duration': 0,
                    'status': 'info'
                })
        else:
            if current_person_session_id is not None:
                person_dur = int(current_time - person_session_start_time) if person_session_start_time else 0
                if person_dur > 10:
                    end_detection_session(current_person_session_id, person_dur)
                else:
                    delete_detection_session(current_person_session_id)
                
                StateManager.delete('current_person_session_id')
                StateManager.delete('person_session_start_time')
                StateManager.delete('person_last_snapshot_second')

        # --- Save Snapshots ---
        if is_fire and current_fire_session_id and fire_session_start_time:
            session_duration = int(current_time - fire_session_start_time)
            if session_duration >= fire_last_snapshot_second + SNAPSHOT_INTERVAL:
                StateManager.set('fire_last_snapshot_second', session_duration)
                snapshot_filename = save_snapshot(
                    plotted_frame, 'fire', 
                    detections[0]['confidence'] if detections else 0.5, 
                    is_critical_alert,
                    current_fire_session_id,
                    session_duration
                )
                if snapshot_filename:
                    update_session_snapshot(current_fire_session_id, snapshot_filename)
        
        if is_smoke and current_smoke_session_id and smoke_session_start_time:
            session_duration = int(current_time - smoke_session_start_time)
            if session_duration >= smoke_last_snapshot_second + SNAPSHOT_INTERVAL:
                StateManager.set('smoke_last_snapshot_second', session_duration)
                smoke_conf = next((d['confidence'] for d in detections if d['class'] == 'smoke'), 0.5)
                snapshot_filename = save_snapshot(
                    plotted_frame, 'smoke', 
                    smoke_conf, False,
                    current_smoke_session_id,
                    session_duration
                )
                if snapshot_filename:
                    update_session_snapshot(current_smoke_session_id, snapshot_filename)
        
        if is_firefighter and current_firefighter_session_id and firefighter_session_start_time:
            session_duration = int(current_time - firefighter_session_start_time)
            if session_duration >= firefighter_last_snapshot_second + SNAPSHOT_INTERVAL:
                StateManager.set('firefighter_last_snapshot_second', session_duration)
                ff_conf = next((d['confidence'] for d in detections if d['class'] == 'firefighter'), 0.5)
                snapshot_filename = save_snapshot(
                    plotted_frame, 'firefighter', 
                    ff_conf, False,
                    current_firefighter_session_id,
                    session_duration
                )
                if snapshot_filename:
                    update_session_snapshot(current_firefighter_session_id, snapshot_filename)
        
        if is_person and current_person_session_id and person_session_start_time:
            session_duration = int(current_time - person_session_start_time)
            if session_duration >= person_last_snapshot_second + SNAPSHOT_INTERVAL:
                StateManager.set('person_last_snapshot_second', session_duration)
                person_conf = next((d['confidence'] for d in detections if d['class'] == 'person'), 0.5)
                snapshot_filename = save_snapshot(
                    plotted_frame, 'person', 
                    person_conf, False,
                    current_person_session_id,
                    session_duration
                )
                if snapshot_filename:
                    update_session_snapshot(current_person_session_id, snapshot_filename)
        
        # 7. Encode and emit
        _, buffer = cv2.imencode('.jpg', plotted_frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        encoded_image = base64.b64encode(buffer).decode('utf-8')

        socketio.emit('detection_result', {
            'frame': encoded_image,
            'detections': detections,
            'alert_status': status_message,
            'is_critical': is_critical_alert
        })

    except Exception as e:
        print(f"Processing Error: {e}")
        socketio.emit('detection_result', {'error': 'Backend processing error.'})
