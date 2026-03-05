# Fire Detection System

This project is a real-time Fire and Smoke detection system that leverages Computer Vision (YOLO) and a web-based dashboard for monitoring. It detects fire, smoke, firefighters, and persons in video streams and provides real-time alerts and historical logging.

## Features

- **Real-time Detection:** Detects Fire, Smoke, Firefighters, and Persons using a YOLOv8 model.
- **Live Monitoring Dashboard:** A React-based frontend to view the live video feed and detection status.
- **Alert System:**
    - **Critical:** Fire detected for > 30 seconds.
    - **Warning:** Fire detected.
    - **Caution:** Smoke detected.
    - **Safe:** No threats detected.
- **Session Tracking:** Tracks the duration of fire/smoke events.
- **Snapshot Capture:** Automatically saves snapshots of detections every 10 seconds.
- **Historical Logs:** View past detection events and snapshots.
- **WebSocket Integration:** Real-time updates to the frontend without page refreshes.

## Tech Stack

### Backend
- **Language:** Python
- **Framework:** Flask (with Flask-SocketIO)
- **Message Broker & State:** Redis
- **Task Queue:** Celery
- **ML Model:** YOLOv8 (Ultralytics)
- **Computer Vision:** OpenCV
- **Database:** SQLite
- **Dependencies:** `flask`, `flask-cors`, `ultralytics`, `pillow`, `numpy`, `opencv-python-headless`, `celery`, `redis`, `flask-socketio`

### Frontend
- **Framework:** React.js
- **Styling:** CSS
- **Libraries:** `react-router-dom`, `recharts` (for potential charts), `socket.io-client`

## Project Structure

```
FireDetection/
├── run.sh                  # One-click startup script for all services
├── backend/                # Python Flask Backend
│   ├── app.py              # Main application entry point (WebSocket API)
│   ├── tasks.py            # Celery background tasks (YOLO inference)
│   ├── state_manager.py    # Redis state management wrapper
│   ├── database.py         # SQLite database interactions
│   ├── best.pt             # Trained YOLO model weights
│   ├── requirements.txt    # Python dependencies
│   ├── static/             # Generated snapshots and uploads
│   └── *.db                # SQLite databases
└── frontend/               # React Frontend
    ├── src/                # Source code
    ├── public/             # Static assets
    ├── package.json        # Node.js dependencies
    └── README.md           # Frontend specific readme
```

## Installation & Usage

### Prerequisites
- Python 3.8+ (Anaconda recommended)
- Node.js & npm
- Redis (`brew install redis` on Mac or `sudo apt install redis` on Linux)

### Quick Start (Recommended)

1. Ensure the Redis server is installed on your machine.
2. Install Python backend dependencies:
```bash
cd backend
pip install -r requirements.txt
cd ..
```
3. Install React frontend dependencies:
```bash
cd frontend
npm install
cd ..
```
4. Start all services instantly using the run script from the root directory:
```bash
chmod +x run.sh
./run.sh
```
*This will automatically launch the Redis server, Celery worker pool, Flask backend (on port 5001), and React frontend (on port 3000) simultaneously.*

### Manual Startup Step-by-Step

If you prefer to run services individually in separate terminals:

**1. Start Redis Server**
```bash
redis-server
```

**2. Start Celery Background Worker**
```bash
cd backend
python -m celery -A tasks.celery worker -l info -c 1
```

**3. Start Flask Backend**
```bash
cd backend
python app.py
```
*The backend will run on `http://0.0.0.0:5001`.*

**4. Start React Frontend**
```bash
cd frontend
npm start
```
*The frontend will run on `http://localhost:3000`.*

## API & Socket Events

### WebSocket Events
- **`video_frame`**: (Client -> Server) Sends base64 encoded video frames for processing.
- **`detection_result`**: (Server -> Client) Returns processed frames with bounding boxes and alert status.
- **`new_event`**: (Server -> Client) Emits when a new detection session starts.
- **`events_history`**: (Server -> Client) Sends the list of past events.

### REST API Endpoints
- **GET** `/api/snapshots`: Get a list of saved snapshots.
- **GET** `/api/session/<id>/snapshots`: Get snapshots for a specific session.
- **DELETE** `/api/snapshots/<id>`: Delete a snapshot.
- **GET** `/static/snapshots/<filename>`: Serve snapshot images.
