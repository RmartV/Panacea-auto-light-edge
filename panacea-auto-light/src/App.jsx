import { useState, useEffect } from 'react';
import mqtt from 'mqtt';
import './App.css';

const DISPLAY_TYPES = [
  { id: 'number',      label: 'Number',      icon: '123' },
  { id: 'meter',       label: 'Meter',       icon: 'MTR' },
  { id: 'speedometer', label: 'Gauge',       icon: 'GAU' },
  { id: 'bar',         label: 'Bar',         icon: 'BAR' },
];

/* ── Display components ── */
function DisplayNumber({ value, isDark }) {
  return (
    <div className="disp-number-wrap">
      <div className={`node-card-value ${isDark ? 'dark' : ''}`}>
        {value !== null ? value : '—'}
      </div>
    </div>
  );
}

function DisplayMeter({ value }) {
  const pct = value !== null ? Math.min(100, Math.round((Number(value) / 1023) * 100)) : 0;
  const color = pct < 49 ? 'var(--accent-green)' : pct < 75 ? '#f59e0b' : '#ef4444';
  return (
    <div className="disp-meter-wrap">
      <div className="disp-meter-track">
        <div className="disp-meter-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="disp-meter-label" style={{ color }}>{value !== null ? `${pct}%` : '—'}</span>
    </div>
  );
}

function DisplaySpeedometer({ value }) {
  const raw = value !== null ? Math.min(1023, Math.max(0, Number(value))) : 0;
  const pct = raw / 1023;
  const angle = -135 + pct * 270;
  const r = 36;
  const cx = 50, cy = 54;
  const toRad = (d) => (d * Math.PI) / 180;
  const arcX = (deg) => cx + r * Math.cos(toRad(deg - 90));
  const arcY = (deg) => cy + r * Math.sin(toRad(deg - 90));
  const trackStart = { x: arcX(-135), y: arcY(-135) };
  const trackEnd   = { x: arcX(135),  y: arcY(135)  };
  const fillEnd    = { x: arcX(-135 + pct * 270), y: arcY(-135 + pct * 270) };
  const largeFill  = pct * 270 > 180 ? 1 : 0;
  const color      = raw < 500 ? 'var(--accent-green)' : raw < 800 ? '#f59e0b' : '#ef4444';

  return (
    <div className="disp-gauge-wrap">
      <svg viewBox="0 0 100 70" className="disp-gauge-svg">
        <path
          d={`M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 1 1 ${trackEnd.x} ${trackEnd.y}`}
          fill="none" stroke="#1e1e20" strokeWidth="6" strokeLinecap="round"
        />
        {value !== null && (
          <path
            d={`M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeFill} 1 ${fillEnd.x} ${fillEnd.y}`}
            fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          />
        )}
        <text x="50" y="52" textAnchor="middle" fontSize="13" fontFamily="'IBM Plex Mono'" fill={value !== null ? color : '#444'}>
          {value !== null ? value : '—'}
        </text>
      </svg>
    </div>
  );
}

function DisplayBar({ value }) {
  const segments = 12;
  const filled = value !== null ? Math.round((Number(value) / 1023) * segments) : 0;
  return (
    <div className="disp-bar-wrap">
      {Array.from({ length: segments }).map((_, i) => {
        const active = i < filled;
        const color  = i < 6 ? 'var(--accent-green)' : i < 9 ? '#f59e0b' : '#ef4444';
        return (
          <div
            key={i}
            className="disp-bar-seg"
            style={{ background: active ? color : '#1e1e20' }}
          />
        );
      })}
      <span className="disp-bar-label">{value !== null ? value : '—'}</span>
    </div>
  );
}

function NodeDisplay({ type, value, isDark }) {
  switch (type) {
    case 'meter':       return <DisplayMeter value={value} />;
    case 'speedometer': return <DisplaySpeedometer value={value} />;
    case 'bar':         return <DisplayBar value={value} />;
    default:            return <DisplayNumber value={value} isDark={isDark} />;
  }
}

/* ── Main App ── */
function App() {
  const [apiKey, setApiKey]         = useState('');
  const [username, setUsername]     = useState('');
  const [client, setClient]         = useState(null);
  const [status, setStatus]         = useState('Disconnected');
  const [nodes, setNodes]           = useState({});
  const [feedInput, setFeedInput]   = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [typeInput, setTypeInput]   = useState('number');
  const [feedError, setFeedError]   = useState('');

  const handleConnect = (e) => {
    e.preventDefault();
    if (!apiKey) return;
    setStatus('Connecting');

    const mqttClient = mqtt.connect('wss://io.adafruit.com:443/mqtt', {
      username,
      password: apiKey,
      clientId: `panacea_web_${Math.random().toString(16).substring(2, 8)}`,
    });

    mqttClient.on('connect', () => setStatus('Connected'));

    mqttClient.on('message', (topic, message) => {
      const feed = topic.split('/').pop();
      const raw  = message.toString().trim();
      let value  = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.value !== undefined) value = String(parsed.value);
      } catch {}
      setNodes((prev) => {
        if (!prev[feed]) return prev;
        return { ...prev, [feed]: { ...prev[feed], value } };
      });
    });

    mqttClient.on('error', (err) => {
      console.error(err);
      setStatus('Error');
      mqttClient.end();
    });

    setClient(mqttClient);
  };

  const handleAddFeed = (e) => {
    e.preventDefault();
    const feed  = feedInput.trim().toLowerCase();
    const label = labelInput.trim();
    if (!feed || !label) return;
    if (nodes[feed]) { setFeedError('Feed already added.'); return; }
    setFeedError('');
    client.subscribe(`${username}/feeds/${feed}`, (err) => {
      if (err) { setFeedError(`Could not subscribe to "${feed}".`); return; }
      setNodes((prev) => ({ ...prev, [feed]: { feed, label, value: null, type: typeInput } }));
      setFeedInput('');
      setLabelInput('');
      setTypeInput('number');
    });
  };

  const handleRemoveFeed = (feed) => {
    if (client) client.unsubscribe(`${username}/feeds/${feed}`);
    setNodes((prev) => { const n = { ...prev }; delete n[feed]; return n; });
  };

  const handleDisconnect = () => {
    if (client) { client.end(); setClient(null); }
    setStatus('Disconnected');
    setNodes({});
    setFeedInput(''); setLabelInput(''); setFeedError('');
  };

  useEffect(() => () => { if (client) client.end(); }, [client]);

  const isConnected = status === 'Connected';
  const dotClass    = status.toLowerCase().split(' ')[0];
  const nodeList    = Object.values(nodes);

  return (
    <div className="container">
      <div className="card">

        <header className="header">
          <div className="header-titles">
            <p className="header-eyebrow">Panacea</p>
            <h1>Auto Light Edge</h1>
          </div>
          <div className="status-indicator">
            <div className={`status-dot ${dotClass}`} />
            <span>{status}</span>
          </div>
        </header>

        {!isConnected && (
          <form className="connection-form" onSubmit={handleConnect}>
            <div className="input-group">
              <label>Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" required />
            </div>
            <div className="input-group">
              <label>Adafruit IO Key</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="aio_···" required />
            </div>
            <button type="submit" className="btn-primary">Connect</button>
          </form>
        )}

        {isConnected && (
          <div className="dashboard">

            {/* Add feed form */}
            <form className="add-feed-form" onSubmit={handleAddFeed}>
              <div className="add-feed-grid">
                <div className="input-group">
                  <label>Feed Slug</label>
                  <input
                    type="text"
                    value={feedInput}
                    onChange={(e) => { setFeedInput(e.target.value); setFeedError(''); }}
                    placeholder="feed-slug"
                  />
                </div>
                <div className="input-group">
                  <label>Display Label</label>
                  <input
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    placeholder="Shelf A"
                  />
                </div>
              </div>

              {/* Display type picker */}
              <div className="type-picker">
                {DISPLAY_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`type-btn ${typeInput === t.id ? 'active' : ''}`}
                    onClick={() => setTypeInput(t.id)}
                  >
                    <span className="type-btn-icon">{t.icon}</span>
                    <span className="type-btn-label">{t.label}</span>
                  </button>
                ))}
              </div>

              {feedError && <p className="feed-error">{feedError}</p>}
              <button type="submit" className="btn-primary" disabled={!feedInput || !labelInput}>
                Add Node
              </button>
            </form>

            {/* Node cards */}
            <div className="nodes-grid">
              {nodeList.length === 0 && (
                <p className="nodes-empty">Add a node above to start listening…</p>
              )}
              {nodeList.map(({ feed, label, value, type }) => {
                const numeric = Number(value);
                const isDark  = value !== null && !isNaN(numeric) && numeric < 500;
                return (
                  <div key={feed} className={`node-card node-card--${type}`}>
                    <div className="node-card-header">
                      <div>
                        <p className="node-card-name">{label}</p>
                        <p className="node-card-feed">{feed}</p>
                      </div>
                      <div className="node-card-header-right">
                        <div className="node-card-led">
                          <div className={`node-card-dot ${isDark ? 'on' : 'off'}`} />
                          <span className={`node-card-led-label ${isDark ? 'on' : 'off'}`}>
                            {value !== null ? (isDark ? 'on' : 'off') : '···'}
                          </span>
                        </div>
                        <button className="btn-remove" onClick={() => handleRemoveFeed(feed)} title="Remove">✕</button>
                      </div>
                    </div>
                    <div className="node-card-display">
                      <NodeDisplay type={type} value={value} isDark={isDark} />
                    </div>
                  </div>
                );
              })}
            </div>

            <hr className="dashboard-divider" />
            <button onClick={handleDisconnect} className="btn-secondary">Disconnect</button>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;