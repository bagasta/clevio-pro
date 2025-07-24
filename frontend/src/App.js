import React, { useState, useEffect } from "react";
import "./App.css";
import axios from "axios";
import ManageSessions from "./components/ManageSessions";
const API = "http://localhost:3001";

// === Utility axios instance dengan Interceptor 401 ===
const api = axios.create({ baseURL: API });
api.interceptors.request.use(
  config => {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = "Bearer " + token;
    return config;
  },
  error => Promise.reject(error)
);

// ==== Interceptor RESPONSE (Logout jika 401) ====
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem("token");
      window.location.reload(); // Paksa reload, langsung ke halaman login
    }
    return Promise.reject(err);
  }
);

// === LOGIN COMPONENT ===
function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const handleLogin = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const res = await axios.post(API + "/login", { username, password });
      localStorage.setItem("token", res.data.token);
      onLogin();
    } catch {
      setErr("Username/password salah");
    }
    setLoading(false);
  };
  return (
    <div className="login-bg">
      <form className="login-card" onSubmit={handleLogin}>
        <h2>Masuk Dashboard</h2>
        <input className="input-main" placeholder="Username" value={username} autoFocus onChange={e => setUsername(e.target.value)} />
        <input className="input-main" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="btn-main" type="submit" disabled={loading}>{loading ? "Loading..." : "Login"}</button>
        {err && <div style={{color:"red",marginTop:10}}>{err}</div>}
      </form>
    </div>
  );
}

// === SESSION MANAGER ===
function SessionManager({ sessionId, setSessionId, sessions, reloadSessions }) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [newSession, setNewSession] = useState("");
  const [loading, setLoading] = useState(false);
  const [waStatus, setWaStatus] = useState("");

  useEffect(() => {
    const found = sessions.find(x => x.session_id === sessionId);
    setWebhookUrl(found ? found.webhook_url : "");
    if (sessionId) {
      api.get(`/sessions/${sessionId}/status`)
        .then(res => setWaStatus(res.data.status))
        .catch(() => setWaStatus(""));
    } else {
      setWaStatus("");
    }
  }, [sessionId, sessions]);

  const handleInitWA = async () => {
    if (!sessionId) return;
    setLoading(true);
    await api.post(`/sessions/${sessionId}/init`);
    setLoading(false);
    reloadSessions();
  };

  const handleAddSession = async () => {
    if (!newSession) return;
    setLoading(true);
    await api.post("/sessions", { sessionId: newSession, webhookUrl });
    setNewSession("");
    reloadSessions();
    setLoading(false);
  };

  const handleUpdateWebhook = async () => {
    if (!sessionId) return;
    setLoading(true);
    await api.put(`/sessions/${sessionId}/webhook`, { webhookUrl });
    reloadSessions();
    setLoading(false);
  };

  return (
    <div>
      <h2 className="section-title">Pilih / Kelola Session</h2>
      <label style={{fontWeight:"bold",marginBottom:3}}>Pilih Session:</label>
      <select className="input-main" value={sessionId} onChange={e => setSessionId(e.target.value)}>
        <option value="">-- Pilih Session --</option>
        {sessions.map(sess => (
          <option key={sess.session_id} value={sess.session_id}>
            {sess.session_id}
          </option>
        ))}
      </select>
      {sessionId && waStatus !== "connected" &&
        <button className="btn-main" style={{marginTop:8}} onClick={handleInitWA} disabled={loading}>
          Inisialisasi WA
        </button>
      }

      <label style={{marginTop:12,display:"block",fontWeight:"bold"}}>Webhook URL:</label>
      <input
        className="input-main"
        value={webhookUrl}
        placeholder="Webhook URL"
        onChange={e => setWebhookUrl(e.target.value)}
      />
      <button className="btn-main" disabled={!sessionId || loading} onClick={handleUpdateWebhook}>Update Webhook</button>

      <div className="divider" />
      <label style={{fontWeight:"bold",marginBottom:3}}>Tambah Session Baru:</label>
      <input
        className="input-main"
        placeholder="SessionId baru"
        value={newSession}
        onChange={e => setNewSession(e.target.value)}
      />
      <button className="btn-main" disabled={!newSession || loading} onClick={handleAddSession}>Tambah Session</button>
    </div>
  );
}

// === QR SCANNER ===
function QRScanner({ sessionId }) {
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState("");
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!sessionId) {
      setQr(null); setStatus(""); setInfo(null);
      return;
    }
    let polling = true;
    const fetch = async () => {
      try {
        const statusRes = await api.get(`/sessions/${sessionId}/status`);
        setStatus(statusRes.data.status);
        setInfo(statusRes.data.info || null);
      } catch { setStatus(""); setInfo(null); }
      try {
        const qrRes = await api.get(`/sessions/${sessionId}/qr`);
        setQr(qrRes.data.qr);
      } catch { setQr(null); }
    };
    fetch();
    const interval = setInterval(() => { if(polling) fetch(); }, 1600);
    return () => { polling = false; clearInterval(interval); };
  }, [sessionId]);

  if (!sessionId) return null;
  return (
    <div className="qr-container">
      <h2 className="section-title">QR Scanner</h2>
      <div className="qr-box">
        {status === "connected" ? (
          <div style={{ color: "#219653", fontWeight: "bold", textAlign: "center" }}>
            Sudah terhubung ✅
            {info?.pushname && <div style={{fontSize:15, marginTop:8}}><b>{info.pushname}</b></div>}
          </div>
        ) : qr ? (
          <img src={qr} alt="QR" style={{width:150, height:150, borderRadius:10}} />
        ) : (
          <div style={{
            background: "#e4eefd",
            width: 150,
            height: 150,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 12, color: "#2176ff", fontWeight: "bold"
          }}>QR</div>
        )}
      </div>
      <div style={{ fontSize: 13, color: "#2176ff", marginTop: 8 }}>
        {status === "connected"
          ? "WhatsApp sudah terhubung"
          : "Scan QR di WhatsApp (Perangkat Tertaut)"}
      </div>
    </div>
  );
}

// === CHAT HISTORY ===
function ChatHistory({ sessionId }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    if (!sessionId) { setLogs([]); return; }
    let polling = true;
    const fetch = async () => {
      try {
        const res = await api.get(`/sessions/${sessionId}/logs`);
        setLogs(res.data.logs || []);
      } catch { setLogs([]); }
    };
    fetch();
    const interval = setInterval(() => { if(polling) fetch(); }, 2200);
    return () => { polling = false; clearInterval(interval); };
  }, [sessionId]);

  return (
    <div className="history-card">
      <h3 className="section-title">Riwayat Pesan</h3>
      <div className="table-scroll">
        <table className="msg-table">
          <thead>
          <tr>
            <th>Tipe</th>
            <th>Pengirim</th>
            <th>Penerima</th>
            <th>Isi Pesan</th>
            <th>Waktu</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: "center" }}>Belum ada data</td>
            </tr>
          ) : logs.map((log, i) => (
            <tr key={i}>
              <td>{log.type}</td>
              <td>{log.from || "-"}</td>
              <td>{log.to || "-"}</td>
              <td>{log.body || (log.caption || "-")}</td>
              <td>{log.timestamp ? (new Date(log.timestamp * 1000)).toLocaleString() : "-"}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

// === MAIN APP ===
function App() {
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("token"));
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [waStatus, setWaStatus] = useState("");
  const [waInfo, setWaInfo] = useState(null);
  const [menu, setMenu] = useState("dashboard");

  useEffect(() => {
    if (loggedIn) reloadSessions();
  }, [loggedIn]);
  function reloadSessions() {
    api.get("/sessions").then(res => setSessions(res.data.sessions));
  }

  useEffect(() => {
    if (!sessionId || !loggedIn) { setWaStatus(""); setWaInfo(null); return; }
    let polling = true;
    const fetch = async () => {
      try {
        const res = await api.get(`/sessions/${sessionId}/status`);
        setWaStatus(res.data.status);
        setWaInfo(res.data.info || null);
      } catch { setWaStatus(""); setWaInfo(null); }
    };
    fetch();
    const interval = setInterval(() => { if(polling) fetch(); }, 2000);
    return () => { polling = false; clearInterval(interval); };
  }, [sessionId, loggedIn]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setLoggedIn(false);
    setSessions([]);
    setSessionId("");
    setWaStatus("");
    setWaInfo(null);
  };

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div className="dashboard-root">
      <aside className="sidebar">
        <div className="sidebar-logo">Clevio<span>PRO</span></div>
        <nav>
          <div
            className={`sidebar-item ${menu === "dashboard" ? "active" : ""}`}
            onClick={() => setMenu("dashboard")}
          >
            Dashboard
          </div>
          <div
            className={`sidebar-item ${menu === "manage" ? "active" : ""}`}
            onClick={() => setMenu("manage")}
          >
            Manage Session
          </div>
        </nav>
      </aside>
      <div className="main-content">
        <header className="header">
          <div className="header-title">Whatsapp Management</div>
          <div className="header-session">
            {sessionId && (
              <div>
                Session: <b>{sessionId}</b>
                <div style={{fontSize:13, marginTop:2}}>
                  Status: {waStatus === "connected" ? (
                    <span style={{color: "#21ba45", fontWeight:600}}>Sudah terhubung ✅
                      {waInfo?.pushname && <> (<b>{waInfo.pushname}</b>)</>}
                    </span>
                  ) : waStatus === "initializing" ? (
                    <span style={{color: "#e69500"}}>Belum scan QR</span>
                  ) : (
                    <span style={{color: "#db2828"}}>Belum terinisialisasi</span>
                  )}
                </div>
              </div>
            )}
            <button
              onClick={handleLogout}
              style={{
                marginTop: 6, marginLeft: 15, background: "#fff",
                border: "1px solid #2176ff", color: "#2176ff", borderRadius: 6,
                fontWeight: 500, padding: "3px 16px", cursor: "pointer"
              }}
            >Logout</button>
          </div>
        </header>
        {menu === "dashboard" && (
          <div className="dashboard-flex">
            <div className="dashboard-section">
              <SessionManager
                sessionId={sessionId}
                setSessionId={setSessionId}
                sessions={sessions}
                reloadSessions={reloadSessions}
              />
              <QRScanner sessionId={sessionId} />
            </div>
            <div className="dashboard-section flex-grow">
              <ChatHistory sessionId={sessionId} />
            </div>
          </div>
        )}
        {menu === "manage" && (
          <div className="dashboard-section">
            <ManageSessions />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
