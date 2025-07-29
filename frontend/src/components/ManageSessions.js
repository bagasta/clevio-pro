import React, { useEffect, useState } from "react";
import api from "../api";

const ManageSessions = () => {
  const [sessions, setSessions] = useState([]);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ session_id: "", webhook_url: "" });
  const [loading, setLoading] = useState(false);

  const loadSessions = () => {
    api.get(`/sessions`).then(res => setSessions(res.data.sessions || []));
  };

  useEffect(() => { loadSessions(); }, []);

  const startEdit = (sess) => {
    setEditId(sess.session_id);
    setForm({ session_id: sess.session_id, webhook_url: sess.webhook_url || "" });
  };

  const cancelEdit = () => {
    setEditId(null);
    setForm({ session_id: "", webhook_url: "" });
  };

  const saveEdit = async () => {
    if (!editId) return;
    setLoading(true);
    await api.put(`/sessions/${editId}`, {
      newSessionId: form.session_id,
      webhookUrl: form.webhook_url
    });
    setLoading(false);
    cancelEdit();
    loadSessions();
  };

  const resetSession = async (id) => {
    await api.post(`/sessions/${id}/reset`);
    loadSessions();
  };

  const deleteSession = async (id) => {
    if (!window.confirm("Hapus session ini?")) return;
    await api.delete(`/sessions/${id}`);
    loadSessions();
  };

  return (
    <div>
      <h2 className="section-title">Manage Session</h2>
      <div className="table-scroll">
        <table className="msg-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Webhook</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center" }}>Belum ada session</td>
              </tr>
            )}
            {sessions.map(sess => (
              editId === sess.session_id ? (
                <tr key={sess.session_id}>
                  <td>
                    <input
                      className="input-main"
                      value={form.session_id}
                      onChange={e => setForm({ ...form, session_id: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input-main"
                      value={form.webhook_url}
                      onChange={e => setForm({ ...form, webhook_url: e.target.value })}
                    />
                  </td>
                  <td>
                    <button className="btn-main" onClick={saveEdit} disabled={loading}>Simpan</button>
                    <button className="btn-main" onClick={cancelEdit}>Batal</button>
                  </td>
                </tr>
              ) : (
                <tr key={sess.session_id}>
                  <td>{sess.session_id}</td>
                  <td>{sess.webhook_url || "-"}</td>
                  <td>
                    <button className="btn-main" onClick={() => resetSession(sess.session_id)}>Scan ulang</button>
                    <button className="btn-main" onClick={() => startEdit(sess)}>Edit</button>
                    <button className="btn-main" onClick={() => deleteSession(sess.session_id)}>Hapus</button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ManageSessions;

