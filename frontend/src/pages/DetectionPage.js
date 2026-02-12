import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './DetectionPage.css';

const SOCKET_SERVER_URL = "http://localhost:5001";

function DetectionPage() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const isStreamingRef = useRef(false);
  const audioRef = useRef(null);
  const lastAlertTimeRef = useRef(0);
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [resultFrame, setResultFrame] = useState(null);
  const [alertStatus, setAlertStatus] = useState("Ready to start detection");
  const [detections, setDetections] = useState([]);
  const [isCritical, setIsCritical] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDualView, setShowDualView] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [screenshotFeedback, setScreenshotFeedback] = useState(false);

  // Play alert sound
  const playAlertSound = useCallback((type) => {
    if (isMuted) return;
    
    const now = Date.now();
    // Prevent sound spam - minimum 2 seconds between alerts
    if (now - lastAlertTimeRef.current < 2000) return;
    lastAlertTimeRef.current = now;

    // Use Web Audio API for alert sounds
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'critical') {
      oscillator.frequency.value = 880; // Higher pitch for critical
      gainNode.gain.value = 0.3;
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.5);
    } else {
      oscillator.frequency.value = 440; // Normal pitch for warning
      gainNode.gain.value = 0.2;
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.3);
    }
  }, [isMuted]);

  // Store playAlertSound in a ref so socket useEffect doesn't depend on it
  const playAlertSoundRef = useRef(playAlertSound);
  useEffect(() => {
    playAlertSoundRef.current = playAlertSound;
  }, [playAlertSound]);

  // Socket connection setup
  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER_URL, { transports: ['polling'] });

    socketRef.current.on('connect', () => {
      console.log('Connected to backend');
      setIsConnected(true);
      // No popup notification - just update the connection status in UI
    });

    socketRef.current.on('detection_result', (data) => {
      if (data.frame) {
        setResultFrame(`data:image/jpeg;base64,${data.frame}`);
        setIsLoading(false);

        // Update UI state but no popup toasts - just update the status bar
        if (data.is_critical) {
          playAlertSoundRef.current('critical');
        }
      }
      setDetections(data.detections || []);
      setAlertStatus(data.alert_status || "Processing...");
      setIsCritical(data.is_critical || false);
    });

    socketRef.current.on('disconnect', () => {
      console.log('Disconnected from backend');
      setIsConnected(false);
      // No popup notification - connection status shown in status bar
    });

    return () => {
      socketRef.current.disconnect();
      const video = videoRef.current;
      if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // Empty dependency array - socket only connects once

  const sendFrames = useCallback(() => {
    if (!isStreamingRef.current || !videoRef.current || !canvasRef.current || !socketRef.current?.connected) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (canvas.width > 0 && canvas.height > 0) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64Data = canvas.toDataURL('image/jpeg', 0.5)
                               .replace(/^data:image\/(png|jpeg);base64,/, "");
      socketRef.current.emit('video_frame', { frame: base64Data });
    }

    setTimeout(sendFrames, 500);
  }, []);

  const startStream = useCallback(async () => {
    try {
      setIsLoading(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      isStreamingRef.current = true;
      setIsStreaming(true);

      // No popup notification - status shown in status bar
      setTimeout(sendFrames, 500);
    } catch (err) {
      console.error("Error accessing webcam: ", err);
      setAlertStatus("Error: Could not access webcam");
      setIsLoading(false);
      // Log error but no popup
    }
  }, [sendFrames]);

  const stopStream = useCallback(() => {
    isStreamingRef.current = false;
    setIsStreaming(false);
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    setResultFrame(null);
    setAlertStatus("Session ended");
    // No popup notification - status shown in status bar
  }, []);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Screenshot function
  const takeScreenshot = useCallback(() => {
    if (!resultFrame) return;
    
    // Create a link element to download the image
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `fire-detection-${timestamp}.png`;
    link.href = resultFrame;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Show feedback
    setScreenshotFeedback(true);
    setTimeout(() => setScreenshotFeedback(false), 1500);
  }, [resultFrame]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      const key = e.code;
      
      // Mute toggle - M key (only for alert sounds, not video)
      if (key === 'KeyM') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIsMuted(prev => !prev);
        return;
      }
      
      // Fullscreen toggle - F key
      if (key === 'KeyF') {
        e.preventDefault();
        e.stopPropagation();
        setIsFullscreen(prev => !prev);
        return;
      }
      
      // Screenshot - S key
      if (key === 'KeyS') {
        e.preventDefault();
        e.stopPropagation();
        takeScreenshot();
        return;
      }
      
      // Start/Stop stream - Space key
      if (key === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        if (isStreaming) {
          stopStream();
        } else if (isConnected) {
          startStream();
        }
        return;
      }
    };

    // Use capture phase to intercept events before they reach video elements
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isStreaming, isConnected, takeScreenshot, startStream, stopStream]);

  return (
    <div className={`detection-page ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      {/* Hidden video and canvas */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden-video" />
      <canvas ref={canvasRef} style={{ display: 'none' }} />


      {/* Status Bar */}
      <div className={`status-bar ${isCritical ? 'critical' : isStreaming ? 'active' : 'idle'}`}>
        <div className="status-indicator">
          <span className="status-dot"></span>
          <span className="status-text">{alertStatus}</span>
        </div>
        <div className="status-controls">
          <button 
            type="button"
            className={`icon-btn ${isMuted ? 'muted' : ''}`} 
            onClick={(e) => {
              e.stopPropagation();
              setIsMuted(!isMuted);
            }}
            title={isMuted ? 'Unmute Alerts (M)' : 'Mute Alerts (M)'}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
          <div className="connection-status">
            <span className={`connection-dot ${isConnected ? 'connected' : ''}`}></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>

      <div className="main-content">
        {/* Video Feed Card */}
        <div className={`video-card ${isFullscreen ? 'fullscreen' : ''}`}>
          <div className="card-header">
            <h3>📹 {showDualView ? 'Dual View' : 'AI Detection Feed'}</h3>
            <div className="controls">
              <button 
                type="button"
                className="icon-btn" 
                onClick={takeScreenshot}
                title="Take Screenshot (S)"
                disabled={!resultFrame}
              >
                📸
              </button>
              <button 
                type="button"
                className="icon-btn" 
                onClick={() => setShowDualView(!showDualView)}
                title={showDualView ? 'Single View' : 'Dual View'}
                disabled={!isStreaming}
              >
                {showDualView ? '◻️' : '◫'}
              </button>
              <button 
                type="button"
                className="icon-btn" 
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
              >
                {isFullscreen ? '⛶' : '⛶'}
              </button>
              {!isStreaming ? (
                <button type="button" className="btn-start" onClick={startStream} disabled={!isConnected}>
                  <span>▶</span> Start
                </button>
              ) : (
                <button type="button" className="btn-stop" onClick={stopStream}>
                  <span>■</span> Stop
                </button>
              )}
            </div>
          </div>
          
          <div className={`video-container ${showDualView ? 'dual-view' : ''}`}>
            {showDualView && isStreaming && (
              <div className="raw-feed-container">
                <div className="feed-label">Raw Feed</div>
                <video 
                  ref={(el) => {
                    if (el && videoRef.current && videoRef.current.srcObject) {
                      el.srcObject = videoRef.current.srcObject;
                      el.play();
                    }
                  }}
                  autoPlay 
                  playsInline 
                  muted 
                  className="raw-video-feed"
                />
              </div>
            )}
            <div className={`ai-feed-container ${showDualView ? 'half' : ''}`}>
              {showDualView && <div className="feed-label">AI Analysis</div>}
              {isLoading ? (
                <div className="loading-skeleton">
                  <div className="skeleton-shimmer"></div>
                  <div className="skeleton-text">Initializing AI detection...</div>
                </div>
              ) : resultFrame ? (
                <>
                  <img src={resultFrame} alt="AI Detection" className="detection-feed" />
                  {screenshotFeedback && (
                    <div className="screenshot-feedback">
                      📸 Screenshot saved!
                    </div>
                  )}
                </>
              ) : (
                <div className="placeholder-feed">
                  <div className="placeholder-icon">📷</div>
                  <p>Click "Start Detection" to begin monitoring</p>
                </div>
              )}
            </div>
          </div>
          
          {isFullscreen && (
            <button className="exit-fullscreen" onClick={toggleFullscreen}>
              ✕ Exit Fullscreen
            </button>
          )}
        </div>

        {/* Side Panel */}
        {!isFullscreen && (
          <div className="side-panel">
            {/* Current Detections */}
            <div className="detections-card">
              <h3>🎯 Current Detections</h3>
              <div className="detections-list">
                {detections.length > 0 ? (
                  detections.map((det, idx) => (
                    <div key={idx} className={`detection-item ${det.class}`}>
                      <span className="detection-icon">
                        {det.class === 'fire' ? '🔥' : '💨'}
                      </span>
                      <span className="detection-type">{det.class.toUpperCase()}</span>
                      <div className="detection-confidence-bar">
                        <div 
                          className="confidence-fill" 
                          style={{ width: `${det.confidence * 100}%` }}
                        ></div>
                      </div>
                      <span className="detection-confidence">
                        {(det.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="no-detections">
                    <span>✓</span> No threats detected
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DetectionPage;
