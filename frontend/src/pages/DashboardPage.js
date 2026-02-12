import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import ImageModal from '../components/ImageModal';
import './DashboardPage.css';

const SOCKET_SERVER_URL = "http://localhost:5001";

function DashboardPage() {
  const socketRef = useRef(null);
  const [events, setEvents] = useState([]);
  const [totalEventsCount, setTotalEventsCount] = useState(0);
  const [snapshots, setSnapshots] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [stats, setStats] = useState({
    fireEvents: 0,
    criticalAlerts: 0,
    smokeEvents: 0,
    firefighterEvents: 0,
    personEvents: 0
  });
  const [chartTimeFilter, setChartTimeFilter] = useState('24h'); // 24h, month, year
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()); // 0-11
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [fullscreenView, setFullscreenView] = useState(null); // null, 'events', 'snapshots'
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFilters, setExportFilters] = useState({
    dateRange: 'all', // all, 24h, week, month
    type: 'all', // all, fire, smoke, firefighter, person
    severity: 'all' // all, critical, warning
  });
  
  // Event Log filters, pagination, and sorting
  const [eventLogPage, setEventLogPage] = useState(1);
  const [eventLogMonth, setEventLogMonth] = useState('all'); // 'all' or 0-11
  const [eventLogYear, setEventLogYear] = useState('all'); // 'all' or year number
  const [eventLogType, setEventLogType] = useState('all'); // 'all', 'fire', 'smoke', 'critical'
  const [eventLogSortBy, setEventLogSortBy] = useState('timestamp'); // 'timestamp', 'type', 'status', 'duration'
  const [eventLogSortDir, setEventLogSortDir] = useState('desc'); // 'asc' or 'desc'
  const [selectedEventImage, setSelectedEventImage] = useState(null); // For event log image modal
  const [eventsPerPage, setEventsPerPage] = useState(10);
  const [sessionSnapshots, setSessionSnapshots] = useState([]); // For gallery view
  const [showGalleryModal, setShowGalleryModal] = useState(false);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  
  // Generate year options (last 5 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({length: 5}, (_, i) => currentYear - i);

  // Fetch snapshots
  const fetchSnapshots = async () => {
    try {
      const response = await fetch(`${SOCKET_SERVER_URL}/api/snapshots`);
      const data = await response.json();
      setSnapshots(data.snapshots || []);
    } catch (error) {
      console.error('Error fetching snapshots:', error);
    }
  };

  const deleteSnapshot = async (snapshotId) => {
    try {
      await fetch(`${SOCKET_SERVER_URL}/api/snapshots/${snapshotId}`, {
        method: 'DELETE'
      });
      setSnapshots(prev => prev.filter(s => s.id !== snapshotId));
    } catch (error) {
      console.error('Error deleting snapshot:', error);
    }
  };

  // Fetch snapshots for a specific session
  const fetchSessionSnapshots = async (sessionId) => {
    try {
      const response = await fetch(`${SOCKET_SERVER_URL}/api/session/${sessionId}/snapshots`);
      const data = await response.json();
      setSessionSnapshots(data.snapshots || []);
      setShowGalleryModal(true);
    } catch (error) {
      console.error('Error fetching session snapshots:', error);
    }
  };

  // Handle ESC key to close fullscreen views
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (selectedSnapshot) {
        setSelectedSnapshot(null);
      } else if (fullscreenView) {
        setFullscreenView(null);
      }
    }
  }, [selectedSnapshot, fullscreenView]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    socketRef.current = io(SOCKET_SERVER_URL, { transports: ['polling'] });

    socketRef.current.on('connect', () => {
      setIsConnected(true);
      socketRef.current.emit('get_events');
      fetchSnapshots();
    });

    socketRef.current.on('events_history', (data) => {
      setEvents(data.events || []);
      setTotalEventsCount(data.total_count || data.events?.length || 0);
      calculateStats(data.events || []);
    });

    socketRef.current.on('new_event', (event) => {
      setEvents(prev => [event, ...prev].slice(0, 100));
      setTotalEventsCount(prev => prev + 1);
      updateStats(event);
      fetchSnapshots();
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  const calculateStats = (eventList) => {
    const fireEvents = eventList.filter(e => e.type === 'fire').length;
    const smokeEvents = eventList.filter(e => e.type === 'smoke').length;
    const criticalAlerts = eventList.filter(e => e.is_critical).length;
    const firefighterEvents = eventList.filter(e => e.type === 'firefighter').length;
    const personEvents = eventList.filter(e => e.type === 'person').length;
    setStats({
      fireEvents,
      criticalAlerts,
      smokeEvents,
      firefighterEvents,
      personEvents
    });
  };

  const updateStats = (event) => {
    setStats(prev => ({
      fireEvents: prev.fireEvents + (event.type === 'fire' ? 1 : 0),
      criticalAlerts: prev.criticalAlerts + (event.is_critical ? 1 : 0),
      smokeEvents: prev.smokeEvents + (event.type === 'smoke' ? 1 : 0),
      firefighterEvents: prev.firefighterEvents + (event.type === 'firefighter' ? 1 : 0),
      personEvents: prev.personEvents + (event.type === 'person' ? 1 : 0)
    }));
  };

  const clearEvents = () => {
    socketRef.current.emit('clear_events');
    setEvents([]);
    setTotalEventsCount(0);
    setStats({ fireEvents: 0, criticalAlerts: 0, smokeEvents: 0, firefighterEvents: 0, personEvents: 0 });
  };

  // Critical alerts bar chart data based on time filter
  const criticalChartData = useMemo(() => {
    const criticalEvents = events.filter(e => e.is_critical);
    if (criticalEvents.length === 0) return [];

    const now = new Date();
    let startDate, endDate, groupBy;

    switch (chartTimeFilter) {
      case '24h':
        startDate = new Date(now - 24 * 60 * 60 * 1000);
        endDate = now;
        groupBy = 'hour';
        break;
      case 'month':
        startDate = new Date(selectedYear, selectedMonth, 1);
        endDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);
        groupBy = 'day';
        break;
      case 'year':
        startDate = new Date(selectedYear, 0, 1);
        endDate = new Date(selectedYear, 11, 31, 23, 59, 59);
        groupBy = 'month';
        break;
      default:
        startDate = new Date(now - 24 * 60 * 60 * 1000);
        endDate = now;
        groupBy = 'hour';
    }

    const filtered = criticalEvents.filter(e => {
      const eventDate = new Date(e.timestamp);
      return eventDate >= startDate && eventDate <= endDate;
    });
    const grouped = {};

    filtered.forEach(event => {
      const date = new Date(event.timestamp);
      let key;
      let sortKey;

      if (groupBy === 'hour') {
        key = `${String(date.getHours()).padStart(2, '0')}:00`;
        sortKey = date.getHours();
      } else if (groupBy === 'day') {
        // Show day with month abbreviation for clarity (e.g., "Dec 23")
        key = `${monthNames[date.getMonth()].substring(0, 3)} ${date.getDate()}`;
        sortKey = date.getDate();
      } else {
        key = monthNames[date.getMonth()].substring(0, 3);
        sortKey = date.getMonth();
      }

      if (!grouped[key]) {
        grouped[key] = { time: key, alerts: 0, sortKey };
      }
      grouped[key].alerts++;
    });

    // Sort chronologically by sortKey
    return Object.values(grouped).sort((a, b) => a.sortKey - b.sortKey);
  }, [events, chartTimeFilter, selectedMonth, selectedYear, monthNames]);

  // Filtered and sorted events for Event Log page
  const filteredEvents = useMemo(() => {
    let filtered = [...events];
    
    // Note: Events with duration <= 10 seconds are now filtered at the database level
    
    // Filter by month
    if (eventLogMonth !== 'all') {
      filtered = filtered.filter(e => {
        const date = new Date(e.timestamp);
        return date.getMonth() === Number(eventLogMonth);
      });
    }
    
    // Filter by year
    if (eventLogYear !== 'all') {
      filtered = filtered.filter(e => {
        const date = new Date(e.timestamp);
        return date.getFullYear() === Number(eventLogYear);
      });
    }
    
    // Filter by type
    if (eventLogType === 'fire') {
      filtered = filtered.filter(e => e.type === 'fire');
    } else if (eventLogType === 'smoke') {
      filtered = filtered.filter(e => e.type === 'smoke');
    } else if (eventLogType === 'critical') {
      filtered = filtered.filter(e => e.is_critical);
    }
    
    // Sort by selected column
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (eventLogSortBy) {
        case 'timestamp':
          comparison = new Date(a.timestamp) - new Date(b.timestamp);
          break;
        case 'type':
          comparison = (a.type || '').localeCompare(b.type || '');
          break;
        case 'status':
          comparison = (a.is_critical ? 1 : 0) - (b.is_critical ? 1 : 0);
          break;
        case 'duration':
          comparison = (a.duration || 0) - (b.duration || 0);
          break;
        default:
          comparison = new Date(a.timestamp) - new Date(b.timestamp);
      }
      return eventLogSortDir === 'desc' ? -comparison : comparison;
    });
    
    return filtered;
  }, [events, eventLogMonth, eventLogYear, eventLogType, eventLogSortBy, eventLogSortDir]);

  // Toggle sort for column headers
  const handleColumnSort = (column) => {
    if (eventLogSortBy === column) {
      setEventLogSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setEventLogSortBy(column);
      setEventLogSortDir('desc');
    }
  };

  // Get sort icon for column
  const getSortIcon = (column) => {
    if (eventLogSortBy !== column) return '⇅';
    return eventLogSortDir === 'desc' ? '↓' : '↑';
  };

  // Pagination calculations
  const totalEventPages = Math.ceil(filteredEvents.length / eventsPerPage);
  const paginatedEvents = filteredEvents.slice(
    (eventLogPage - 1) * eventsPerPage,
    eventLogPage * eventsPerPage
  );

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', minute: '2-digit', second: '2-digit' 
    });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatDuration = (duration, endTime) => {
    // If we have end_time, calculate and show duration
    if (duration !== undefined && duration !== null) {
      if (duration === 0 && !endTime) {
        return 'Ongoing';
      }
      if (duration >= 60) {
        const mins = Math.floor(duration / 60);
        const secs = duration % 60;
        return `${mins}m ${secs}s`;
      }
      return `${duration}s`;
    }
    return 'N/A';
  };

  // Get filtered data for export
  const getFilteredExportData = useCallback(() => {
    let filtered = [...events];
    const now = new Date();

    // Filter by date range
    if (exportFilters.dateRange !== 'all') {
      let cutoff;
      switch (exportFilters.dateRange) {
        case '24h':
          cutoff = new Date(now - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
          break;
        default:
          cutoff = new Date(0);
      }
      filtered = filtered.filter(e => new Date(e.timestamp) > cutoff);
    }

    // Filter by type
    if (exportFilters.type !== 'all') {
      filtered = filtered.filter(e => e.type === exportFilters.type);
    }

    // Filter by severity
    if (exportFilters.severity !== 'all') {
      if (exportFilters.severity === 'critical') {
        filtered = filtered.filter(e => e.is_critical);
      } else {
        filtered = filtered.filter(e => !e.is_critical);
      }
    }

    return filtered;
  }, [events, exportFilters]);

  // Export to CSV
  const exportToCSV = () => {
    const data = getFilteredExportData();
    if (data.length === 0) {
      alert('No data to export with current filters');
      return;
    }

    const headers = ['Timestamp', 'Date', 'Time', 'Type', 'Confidence', 'Severity'];
    const rows = data.map(e => [
      e.timestamp,
      formatDate(e.timestamp),
      formatTime(e.timestamp),
      e.type.toUpperCase(),
      `${(e.confidence * 100).toFixed(1)}%`,
      e.is_critical ? 'CRITICAL' : 'Warning'
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = URL.createObjectURL(blob);
    link.download = `fire-detection-report-${timestamp}.csv`;
    link.click();
    setShowExportModal(false);
  };

  // Fullscreen Event Log Page
  if (fullscreenView === 'events') {
    return (
      <div className="fullscreen-page">
        <div className="fullscreen-header">
          <h1>&#128203; Event Log</h1>
          <div className="fullscreen-actions">
            <button className="btn-close" onClick={() => setFullscreenView(null)}>
              &#10005; Close
            </button>
          </div>
        </div>
        
        {/* Filters Bar */}
        <div className="event-log-filters">
          <div className="filter-group">
            <label>Month</label>
            <select 
              className="filter-select"
              value={eventLogMonth}
              onChange={(e) => { setEventLogMonth(e.target.value); setEventLogPage(1); }}
            >
              <option value="all">All Months</option>
              {monthNames.map((name, idx) => (
                <option key={idx} value={idx}>{name}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label>Year</label>
            <select 
              className="filter-select"
              value={eventLogYear}
              onChange={(e) => { setEventLogYear(e.target.value); setEventLogPage(1); }}
            >
              <option value="all">All Years</option>
              {yearOptions.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label>Type</label>
            <select 
              className="filter-select"
              value={eventLogType}
              onChange={(e) => { setEventLogType(e.target.value); setEventLogPage(1); }}
            >
              <option value="all">All Types</option>
              <option value="fire">Fire Only</option>
              <option value="smoke">Smoke Only</option>
              <option value="critical">Critical Only</option>
            </select>
          </div>
          
          <div className="filter-info">
            Showing {filteredEvents.length} events
          </div>
        </div>
        
        <div className="fullscreen-content">
          {paginatedEvents.length > 0 ? (
            <>
              <table className="events-table fullscreen-table">
                <thead>
                  <tr>
                    <th className="sortable-th" onClick={() => handleColumnSort('timestamp')}>
                      Date/Time <span className="sort-icon">{getSortIcon('timestamp')}</span>
                    </th>
                    <th className="sortable-th" onClick={() => handleColumnSort('type')}>
                      Type <span className="sort-icon">{getSortIcon('type')}</span>
                    </th>
                    <th className="sortable-th" onClick={() => handleColumnSort('duration')}>
                      Duration <span className="sort-icon">{getSortIcon('duration')}</span>
                    </th>
                    <th className="sortable-th" onClick={() => handleColumnSort('status')}>
                      Status <span className="sort-icon">{getSortIcon('status')}</span>
                    </th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedEvents.map((event, idx) => (
                    <tr key={idx} className={event.is_critical ? 'critical-row' : ''}>
                      <td className="datetime-cell">
                        <div className="datetime-display">
                          <span className="date-text">{formatDate(event.timestamp)}</span>
                          <span className="time-text">{formatTime(event.timestamp)}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`type-badge ${event.type}`}>
                          {event.type === 'fire' ? '🔥' : '💨'} {(event.type || '').toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span className="duration-badge">
                          {formatDuration(event.duration, event.end_time)}
                        </span>
                      </td>
                      <td>
                        {event.is_critical ? (
                          <span className="status-critical">🚨 CRITICAL</span>
                        ) : (
                          <span className="status-normal">⚠️ Warning</span>
                        )}
                      </td>
                      <td className="info-cell">
                        {event.id && (
                          <button 
                            className="info-btn"
                            onClick={() => fetchSessionSnapshots(event.id)}
                            title="View Screenshots"
                          >
                            ⓘ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Pagination */}
              <div className="pagination">
                <div className="page-size-selector">
                  <label>Show:</label>
                  <select 
                    value={eventsPerPage} 
                    onChange={(e) => {
                      setEventsPerPage(Number(e.target.value));
                      setEventLogPage(1);
                    }}
                    className="page-size-select"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
                <button 
                  className="pagination-btn"
                  onClick={() => setEventLogPage(1)}
                  disabled={eventLogPage === 1}
                >
                  &#171; First
                </button>
                <button 
                  className="pagination-btn"
                  onClick={() => setEventLogPage(p => Math.max(1, p - 1))}
                  disabled={eventLogPage === 1}
                >
                  &#8249; Prev
                </button>
                <span className="pagination-info">
                  Page {eventLogPage} of {totalEventPages || 1}
                </span>
                <button 
                  className="pagination-btn"
                  onClick={() => setEventLogPage(p => Math.min(totalEventPages, p + 1))}
                  disabled={eventLogPage === totalEventPages || totalEventPages === 0}
                >
                  Next &#8250;
                </button>
                <button 
                  className="pagination-btn"
                  onClick={() => setEventLogPage(totalEventPages)}
                  disabled={eventLogPage === totalEventPages || totalEventPages === 0}
                >
                  Last &#187;
                </button>
              </div>
            </>
          ) : (
            <div className="no-events">
              <div className="no-events-icon">&#128493;</div>
              <h3>No Events Found</h3>
              <p>{events.length > 0 ? 'Try adjusting your filters' : 'Start a detection session to see events here'}</p>
            </div>
          )}
        </div>
        
        {/* Session Snapshots Gallery Modal */}
        {showGalleryModal && (
          <div className="gallery-modal" onClick={() => { setShowGalleryModal(false); setSessionSnapshots([]); }}>
            <div className="gallery-modal-content" onClick={e => e.stopPropagation()}>
              <button className="close-modal" onClick={() => { setShowGalleryModal(false); setSessionSnapshots([]); }}>×</button>
              <h2 className="gallery-title">📸 Detection Screenshots</h2>
              {sessionSnapshots.length > 0 ? (
                <div className="gallery-grid">
                  {sessionSnapshots.map((snapshot, idx) => (
                    <div key={idx} className="gallery-item" onClick={() => setSelectedEventImage(`${SOCKET_SERVER_URL}/static/snapshots/${snapshot.filename}`)}>
                      <img 
                        src={`${SOCKET_SERVER_URL}/static/snapshots/${snapshot.filename}`}
                        alt={`Snapshot at ${snapshot.capture_second}s`}
                      />
                      <div className="gallery-item-info">
                        <span className="capture-time">⏱ {snapshot.capture_second}s</span>
                        <span className={`capture-type ${snapshot.type}`}>{snapshot.type?.toUpperCase()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-snapshots-msg">
                  <p>No screenshots captured for this session.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Single Image Viewer Modal */}
        {selectedEventImage && (
          <div className="image-modal" onClick={() => setSelectedEventImage(null)}>
            <div className="image-modal-content" onClick={e => e.stopPropagation()}>
              <button className="close-modal" onClick={() => setSelectedEventImage(null)}>×</button>
              <img src={selectedEventImage} alt="Event Snapshot" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main Dashboard View
  return (
    <div className="dashboard-page">
      <ImageModal 
        isOpen={!!selectedSnapshot}
        onClose={() => setSelectedSnapshot(null)}
        snapshot={selectedSnapshot}
        baseUrl={SOCKET_SERVER_URL}
      />

      {/* Export Modal */}
      {showExportModal && (
        <div className="export-modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="export-modal" onClick={(e) => e.stopPropagation()}>
            <div className="export-modal-header">
              <h2>&#128229; Export Report</h2>
              <button className="modal-close" onClick={() => setShowExportModal(false)}>&#10005;</button>
            </div>
            <div className="export-modal-body">
              <div className="export-filter-group">
                <label>Date Range</label>
                <div className="export-filter-options">
                  {['all', '24h', 'week', 'month'].map(option => (
                    <button 
                      key={option}
                      className={`export-filter-btn ${exportFilters.dateRange === option ? 'active' : ''}`}
                      onClick={() => setExportFilters(prev => ({...prev, dateRange: option}))}
                    >
                      {option === 'all' ? 'All Time' : option === '24h' ? 'Last 24h' : option === 'week' ? 'Last Week' : 'Last Month'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="export-filter-group">
                <label>Detection Type</label>
                <div className="export-filter-options">
                  {['all', 'fire', 'smoke', 'firefighter', 'person'].map(option => (
                    <button 
                      key={option}
                      className={`export-filter-btn ${exportFilters.type === option ? 'active' : ''}`}
                      onClick={() => setExportFilters(prev => ({...prev, type: option}))}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="export-filter-group">
                <label>Severity</label>
                <div className="export-filter-options">
                  {['all', 'critical', 'warning'].map(option => (
                    <button 
                      key={option}
                      className={`export-filter-btn ${exportFilters.severity === option ? 'active' : ''}`}
                      onClick={() => setExportFilters(prev => ({...prev, severity: option}))}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="export-preview">
                <span>{getFilteredExportData().length} events match filters</span>
              </div>
            </div>
            <div className="export-modal-footer">
              <button className="btn-cancel" onClick={() => setShowExportModal(false)}>Cancel</button>
              <button className="btn-download" onClick={exportToCSV}>
                &#128196; Download CSV
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>&#128202; Detection Dashboard</h1>
          <p>Monitor detection events and captured snapshots</p>
        </div>
        <div className="header-actions">
          <button className="btn-export" onClick={() => setShowExportModal(true)}>
            &#128229; Export Report
          </button>
          <span className={`connection-badge ${isConnected ? 'connected' : ''}`}>
            <span className="dot"></span>
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-row">
        <div className="stat-card fire">
          <div className="stat-icon">&#128293;</div>
          <div className="stat-info">
            <span className="stat-number">{stats.fireEvents}</span>
            <span className="stat-label">Fire</span>
          </div>
        </div>
        <div className="stat-card critical">
          <div className="stat-icon">&#128680;</div>
          <div className="stat-info">
            <span className="stat-number">{stats.criticalAlerts}</span>
            <span className="stat-label">Critical</span>
          </div>
        </div>
        <div className="stat-card smoke">
          <div className="stat-icon">&#128168;</div>
          <div className="stat-info">
            <span className="stat-number">{stats.smokeEvents}</span>
            <span className="stat-label">Smoke</span>
          </div>
        </div>
        <div className="stat-card firefighter">
          <div className="stat-icon">&#128658;</div>
          <div className="stat-info">
            <span className="stat-number">{stats.firefighterEvents}</span>
            <span className="stat-label">Firefighter</span>
          </div>
        </div>
        <div className="stat-card person">
          <div className="stat-icon">&#128100;</div>
          <div className="stat-info">
            <span className="stat-number">{stats.personEvents}</span>
            <span className="stat-label">Person</span>
          </div>
        </div>
      </div>

      {/* Critical Alerts Bar Chart */}
      <div className="chart-section">
        <div className="chart-card full-width">
          <div className="chart-header">
            <h3>&#128680; Critical Fire Alerts Timeline</h3>
            <div className="chart-filters">
              <select 
                className="filter-select"
                value={chartTimeFilter}
                onChange={(e) => setChartTimeFilter(e.target.value)}
              >
                <option value="24h">Last 24 Hours</option>
                <option value="month">By Month</option>
                <option value="year">By Year</option>
              </select>
              
              {chartTimeFilter === 'month' && (
                <>
                  <select 
                    className="filter-select"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  >
                    {monthNames.map((name, index) => (
                      <option key={index} value={index}>{name}</option>
                    ))}
                  </select>
                  <select 
                    className="filter-select"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                  >
                    {yearOptions.map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </>
              )}
              
              {chartTimeFilter === 'year' && (
                <select 
                  className="filter-select"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                >
                  {yearOptions.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {criticalChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={criticalChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="time" stroke="#888" fontSize={12} />
                <YAxis stroke="#888" fontSize={12} allowDecimals={false} />
                <Tooltip 
                  contentStyle={{ 
                    background: 'rgba(30,30,46,0.95)', 
                    border: '1px solid rgba(255,82,82,0.3)',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#fff' }}
                />
                <Bar 
                  dataKey="alerts" 
                  fill="#ff5252" 
                  radius={[4, 4, 0, 0]}
                  name="Critical Alerts"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="no-chart-data">
              <span>✅</span> No critical alerts in this time period
            </div>
          )}
        </div>
      </div>

      {/* Quick Access Cards */}
      <div className="quick-access-row">
        <div 
          className="quick-access-card events-card"
          onClick={() => setFullscreenView('events')}
        >
          <div className="quick-access-icon">📋</div>
          <div className="quick-access-info">
            <h3>Event Log</h3>
            <p>{totalEventsCount} events recorded</p>
          </div>
          <div className="quick-access-arrow">→</div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
