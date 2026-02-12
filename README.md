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
- **ML Model:** YOLOv8 (Ultralytics)
- **Computer Vision:** OpenCV
- **Database:** SQLite
- **Dependencies:** `flask`, `flask-cors`, `ultralytics`, `pillow`, `numpy`, `opencv-python-headless`

### Frontend
- **Framework:** React.js
- **Styling:** CSS
- **Libraries:** `react-router-dom`, `recharts` (for potential charts), `socket.io-client`

## Project Structure

```
FireDetection/
├── backend/                # Python Flask Backend
│   ├── app.py              # Main application entry point
│   ├── database.py         # Database interactions
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
- Python 3.8+
- Node.js & npm

### 1. Setup Backend

Navigate to the `backend` directory and install the required Python packages.

```bash
cd backend
pip install -r requirements.txt
```

Start the Flask server.

```bash
python app.py
```
*The backend will run on `http://0.0.0.0:5001`.*

### 2. Setup Frontend

Open a new terminal, navigate to the `frontend` directory, and install the Node.js dependencies.

```bash
cd frontend
npm install
```

Start the React development server.

```bash
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
