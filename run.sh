#!/bin/bash

echo "Starting Fire Detection System..."

# Function to cleanly kill background processes on exit
cleanup() {
    echo "Shutting down services..."
    kill $REDIS_PID
    kill $CELERY_PID
    kill $BACKEND_PID
    kill $FRONTEND_PID
    exit
}

# Trap terminal exits
trap cleanup SIGINT SIGTERM

# 1. Start Redis Server
echo "[1/4] Starting Redis Server..."
redis-server > redis.log 2>&1 &
REDIS_PID=$!
sleep 2

# 2. Start Celery Worker
echo "[2/4] Starting Celery Worker..."
cd backend
python -m celery -A tasks.celery worker -l info -c 1 > celery.log 2>&1 &
CELERY_PID=$!
sleep 2

# 3. Start Flask Backend
echo "[3/4] Starting Flask Backend..."
python app.py > backend.log 2>&1 &
BACKEND_PID=$!
cd ..
sleep 2

# 4. Start React Frontend
echo "[4/4] Starting React Frontend..."
cd frontend
npm start > frontend.log 2>&1 &
FRONTEND_PID=$!

echo ""
echo "✅ All services started successfully!"
echo "➡️ Redis        (PID: $REDIS_PID)"
echo "➡️ Celery       (PID: $CELERY_PID)"
echo "➡️ Flask        (PID: $BACKEND_PID)"
echo "➡️ React        (PID: $FRONTEND_PID)"
echo ""
echo "Press Ctrl+C to terminate all processes."

# Keep script running
wait
